#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { ensureApiKeys, getConfig, getGlobalConfigPath, saveGlobalConfig } from "./config.js";
import { checkFfmpeg, extractAudio } from "./ffmpeg.js";
import { translateSrtEntries } from "./gemini.js";
import { transcribeAudioSegments } from "./groq.js";
import { stringifySrt } from "./srt.js";

const program = new Command();

program
  .name("vsub")
  .description(
    "CLI tool to extract audio from video, transcribe speech via Groq API, and generate multilingual SRT subtitles via Gemini API.",
  );

// Subcommand: config
const configCmd = program.command("config").description("Manage global configuration settings");

configCmd
  .command("path")
  .description("Display global configuration file path")
  .action(() => {
    console.log(`Configuration file path: ${getGlobalConfigPath()}`);
  });

configCmd
  .command("show")
  .description("Display current settings")
  .action(() => {
    const configPath = getGlobalConfigPath();
    const resolvedConfig = getConfig();

    console.log(`\n📁 Config File: ${configPath}`);
    console.log("----------------------------------------");
    console.log(
      `Groq API Key   : ${resolvedConfig.groqApiKey ? `${resolvedConfig.groqApiKey.slice(0, 4)}...${resolvedConfig.groqApiKey.slice(-4)}` : "(Not configured)"}`,
    );
    console.log(
      `Gemini API Key : ${resolvedConfig.geminiApiKey ? `${resolvedConfig.geminiApiKey.slice(0, 4)}...${resolvedConfig.geminiApiKey.slice(-4)}` : "(Not configured)"}`,
    );
    console.log(`FFmpeg Path    : ${resolvedConfig.ffmpegPath}`);
    console.log("----------------------------------------\n");
  });

configCmd
  .command("set")
  .description("Save API Keys or FFmpeg path to global config")
  .option("--groq-key <key>", "Groq API Key")
  .option("--gemini-key <key>", "Gemini API Key")
  .option("--ffmpeg-path <path>", "Path to ffmpeg executable")
  .action((options: { groqKey?: string; geminiKey?: string; ffmpegPath?: string }) => {
    if (!options.groqKey && !options.geminiKey && !options.ffmpegPath) {
      console.log(
        "⚠️ Please specify settings to save. (Example: vsub config set --groq-key YOUR_KEY)",
      );
      return;
    }

    saveGlobalConfig({
      ...(options.groqKey ? { groqApiKey: options.groqKey.trim() } : {}),
      ...(options.geminiKey ? { geminiApiKey: options.geminiKey.trim() } : {}),
      ...(options.ffmpegPath ? { ffmpegPath: options.ffmpegPath.trim() } : {}),
    });

    console.log(`✅ Configuration updated and saved: ${getGlobalConfigPath()}`);
  });

configCmd
  .command("init")
  .description("Initialize API Keys interactively")
  .action(async () => {
    const config = getConfig();
    await ensureApiKeys({
      ...config,
      groqApiKey: "",
      geminiApiKey: "",
    });
  });

// Main action (Video processing)
program
  .argument("[video-file]", "Target video file path (.mp4, .mkv, .mov, etc.)")
  .option("-t, --target-lang <lang>", "Target language code (e.g., ja, en, es)", "ja")
  .option("-o, --output <path>", "Output path for the generated subtitle file")
  .option(
    "--ffmpeg-path <path>",
    "Path to ffmpeg executable (searches VSUB_FFMPEG_PATH or PATH if omitted)",
  )
  .option("--keep-audio", "Keep intermediate extracted audio files without deleting", false)
  .option("--no-translate", "Skip translation and output raw transcribed subtitles", false)
  .option(
    "--save-original",
    "Save original transcription subtitle file alongside the result",
    false,
  )
  .option(
    "--force-translate",
    "Force Gemini translation even if detected language matches target language",
    false,
  )
  .option("--verbose", "Output detailed log messages", false)
  .action(
    async (
      videoFile: string | undefined,
      options: {
        targetLang: string;
        output?: string;
        ffmpegPath?: string;
        keepAudio?: boolean;
        noTranslate?: boolean;
        saveOriginal?: boolean;
        forceTranslate?: boolean;
        verbose?: boolean;
      },
    ) => {
      if (!videoFile) {
        program.help();
        return;
      }

      try {
        const resolvedVideoPath = path.resolve(process.cwd(), videoFile);
        const rawConfig = getConfig(options.ffmpegPath);
        const verbose = Boolean(options.verbose);

        // Ensure API Key availability (Groq key is required; Gemini key will be validated lazily if translation is needed)
        const config = await ensureApiKeys(rawConfig, {
          requireGemini: false,
        });
        await checkFfmpeg(config.ffmpegPath);

        console.log(`\n🎬 [vsub-cli] Starting process: ${path.basename(resolvedVideoPath)}`);

        // 1. Audio extraction
        console.log("🔊 [1/4] Extracting audio (16kHz mono / low bitrate)...");
        const { audioPaths, cleanup } = await extractAudio(
          resolvedVideoPath,
          config.ffmpegPath,
          verbose,
        );

        try {
          // 2. Transcription with Groq
          console.log("🎙️ [2/4] Transcribing audio with Groq API (Whisper)...");
          const { entries: srtEntries, detectedLanguage } = await transcribeAudioSegments(
            audioPaths,
            config.groqApiKey,
            verbose,
          );

          if (detectedLanguage && verbose) {
            console.log(`ℹ️ [Groq API] Detected speech language: ${detectedLanguage}`);
          }

          if (srtEntries.length === 0) {
            console.warn("⚠️ No valid subtitle entries were detected from transcription results.");
          }

          const isSameLanguage = Boolean(
            detectedLanguage && detectedLanguage.toLowerCase() === options.targetLang.toLowerCase(),
          );

          const skipTranslation =
            Boolean(options.noTranslate) || (isSameLanguage && !options.forceTranslate);

          const videoDir = path.dirname(resolvedVideoPath);
          const videoExt = path.extname(resolvedVideoPath);
          const videoBaseName = path.basename(resolvedVideoPath, videoExt);

          // Save original raw subtitles if requested
          if (options.saveOriginal) {
            const rawLang = detectedLanguage || "raw";
            const isNameConflict =
              rawLang.toLowerCase() === options.targetLang.toLowerCase() && !skipTranslation;
            const originalFilename = isNameConflict
              ? `${videoBaseName}.orig.srt`
              : `${videoBaseName}.${rawLang}.srt`;
            const originalPath = path.join(videoDir, originalFilename);

            fs.writeFileSync(originalPath, stringifySrt(srtEntries), "utf-8");
            console.log(`📄 Saved original transcription subtitle: ${originalPath}`);
          }

          let finalEntries = srtEntries;
          const outputLang = skipTranslation
            ? detectedLanguage || options.targetLang
            : options.targetLang;

          if (skipTranslation) {
            if (options.noTranslate) {
              console.log("ℹ️ [3/4] [--no-translate] Skipping Gemini translation.");
            } else if (isSameLanguage) {
              console.log(
                `ℹ️ [3/4] Skipping Gemini translation (detected language "${detectedLanguage}" matches target language "${options.targetLang}"). Use --force-translate to override.`,
              );
            }
          } else {
            // Ensure Gemini key before proceeding with translation
            const activeConfig = await ensureApiKeys(config, { requireGemini: true });

            console.log(
              `🌐 [3/4] Translating subtitles to ${options.targetLang} with Gemini API (${srtEntries.length} items)...`,
            );
            finalEntries = await translateSrtEntries(
              srtEntries,
              options.targetLang,
              activeConfig.geminiApiKey,
              verbose,
            );
          }

          // 4. Save output SRT
          const finalSrtContent = stringifySrt(finalEntries);
          const outputPath = options.output
            ? path.resolve(process.cwd(), options.output)
            : path.join(videoDir, `${videoBaseName}.${outputLang}.srt`);

          fs.writeFileSync(outputPath, finalSrtContent, "utf-8");
          console.log(`✨ [4/4] Subtitle file saved: ${outputPath}\n`);
        } finally {
          if (!options.keepAudio) {
            await cleanup();
          } else {
            console.log(`ℹ️ [--keep-audio] Kept intermediate audio files: ${audioPaths.join(", ")}`);
          }
        }
      } catch (error) {
        console.error(
          `\n❌ Error occurred: ${error instanceof Error ? error.message : String(error)}\n`,
        );
        process.exit(1);
      }
    },
  );

program.parse(process.argv);
