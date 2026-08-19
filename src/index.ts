#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import pc from "picocolors";
import { ensureApiKeys, getConfig, getGlobalConfigPath, saveGlobalConfig } from "./config.js";
import { checkFfmpeg, extractAudio, isAudioFile } from "./ffmpeg.js";
import { formatEntries, parseOutputFormats } from "./formatter.js";
import { translateSrtEntries } from "./gemini.js";
import { transcribeAudioSegments } from "./groq.js";
import { parseSrt } from "./srt.js";
import { createSpinner, formatFileSize, formatSummaryBox } from "./ui.js";

const program = new Command();

program
  .name("vsub")
  .description(
    "CLI tool to extract audio from video/audio files, transcribe speech via Groq API, and generate multilingual subtitles (.srt, .vtt, .txt, .json) via Gemini API.",
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

// Subcommand: translate
program
  .command("translate")
  .description(
    "Directly translate an existing subtitle file (.srt) into target language(s) via Gemini API",
  )
  .argument("<subtitle-file>", "Input subtitle file path (.srt)")
  .option("-t, --target-lang <lang>", "Target language code (e.g., ja, en, es)", "ja")
  .option(
    "-f, --format <formats>",
    "Output formats: comma-separated list of srt, vtt, txt, json",
    "srt",
  )
  .option("-o, --output <path>", "Output path or base name for the generated subtitle file")
  .option("--gemini-key <key>", "Gemini API Key override")
  .option("--verbose", "Output detailed log messages", false)
  .action(async (subtitleFile: string, _actionOptions: Record<string, unknown>, cmd: Command) => {
    const options = cmd.optsWithGlobals<{
      targetLang: string;
      format: string;
      output?: string;
      geminiKey?: string;
      verbose?: boolean;
    }>();
    const startTime = Date.now();
    const verbose = Boolean(options.verbose);
    const spinner = createSpinner("", { isSilent: verbose });
    const outputFiles: string[] = [];

    try {
      const outputFormats = parseOutputFormats(options.format);
      const resolvedSubtitlePath = path.resolve(process.cwd(), subtitleFile);

      if (!fs.existsSync(resolvedSubtitlePath)) {
        throw new Error(`字幕ファイルが見つかりません: ${resolvedSubtitlePath}`);
      }

      const rawConfig = getConfig();
      if (options.geminiKey) {
        rawConfig.geminiApiKey = options.geminiKey.trim();
      }

      // Ensure Gemini API key (Groq key not required for translate subcommand)
      const config = await ensureApiKeys(rawConfig, {
        requireGroq: false,
        requireGemini: true,
      });

      console.log(
        `\n🌐 ${pc.bold("vsub-cli translate")} - 字幕翻訳開始: ${pc.cyan(path.basename(resolvedSubtitlePath))}`,
      );

      // 1. Read and parse subtitle file
      spinner.start("📖 [1/3] 字幕ファイルを読み込み・パース中...");
      const fileContent = fs.readFileSync(resolvedSubtitlePath, "utf-8");
      const srtEntries = parseSrt(fileContent);

      if (srtEntries.length === 0) {
        throw new Error(
          `字幕ファイルからエントリを読み取れませんでした（SRT 形式であることを確認してください）: ${path.basename(resolvedSubtitlePath)}`,
        );
      }

      spinner.succeed(
        `📖 [1/3] 字幕ファイル読み込み完了 - ${srtEntries.length} 行のエントリを検出`,
      );

      // 2. Gemini Translation
      const totalChunks = Math.max(1, Math.ceil(srtEntries.length / 50));
      spinner.start(
        `🌐 [2/3] Gemini API で ${options.targetLang} に翻訳中 [1/${totalChunks} チャンク]...`,
      );

      const finalEntries = await translateSrtEntries(
        srtEntries,
        options.targetLang,
        config.geminiApiKey,
        verbose,
        (currentChunk, chunksCount) => {
          spinner.updateText(
            `🌐 [2/3] Gemini API で ${options.targetLang} に翻訳中 [${currentChunk}/${chunksCount} チャンク]...`,
          );
        },
      );

      spinner.succeed(
        `🌐 [2/3] Gemini 翻訳完了 (${options.targetLang}) - ${finalEntries.length} 行`,
      );

      // 3. Save output subtitle files
      spinner.start("💾 [3/3] 字幕ファイルを保存中...");

      const subDir = path.dirname(resolvedSubtitlePath);
      const subExt = path.extname(resolvedSubtitlePath);
      let subBaseName = path.basename(resolvedSubtitlePath, subExt);

      // If base name ends with language tag like .en, .ja, strip it to avoid .en.ja
      // e.g. sample.en.srt -> sample -> sample.ja.srt
      const langSuffixMatch = subBaseName.match(/^(.+)\.([a-zA-Z]{2,3})$/);
      if (langSuffixMatch?.[1]) {
        subBaseName = langSuffixMatch[1];
      }

      if (options.output) {
        const resolvedOut = path.resolve(process.cwd(), options.output);
        if (outputFormats.length === 1) {
          const fmt = outputFormats[0] ?? "srt";
          fs.writeFileSync(resolvedOut, formatEntries(finalEntries, fmt), "utf-8");
          outputFiles.push(resolvedOut);
        } else {
          const parsedOut = path.parse(resolvedOut);
          for (const fmt of outputFormats) {
            const outFilePath = path.join(parsedOut.dir, `${parsedOut.name}.${fmt}`);
            fs.writeFileSync(outFilePath, formatEntries(finalEntries, fmt), "utf-8");
            outputFiles.push(outFilePath);
          }
        }
      } else {
        for (const fmt of outputFormats) {
          const outFilePath = path.join(subDir, `${subBaseName}.${options.targetLang}.${fmt}`);
          fs.writeFileSync(outFilePath, formatEntries(finalEntries, fmt), "utf-8");
          outputFiles.push(outFilePath);
        }
      }

      const formatListStr = outputFormats.map((f) => f.toUpperCase()).join(", ");
      spinner.succeed(`💾 [3/3] 字幕ファイルを保存完了 (${formatListStr})`);

      // 4. Output Summary Box
      const durationMs = Date.now() - startTime;
      console.log(
        "\n" +
          formatSummaryBox({
            mediaFile: path.basename(resolvedSubtitlePath),
            mediaType: "subtitle",
            durationMs,
            targetLanguage: options.targetLang,
            entriesCount: finalEntries.length,
            outputFiles,
            skippedTranslation: false,
          }) +
          "\n",
      );
    } catch (error) {
      spinner.fail(
        `処理中にエラーが発生しました: ${error instanceof Error ? error.message : String(error)}`,
      );
      if (verbose && error instanceof Error && error.stack) {
        console.error(error.stack);
      }
      process.exit(1);
    }
  });

// Main action (Media processing)
program
  .argument("[media-file]", "Target video or audio file path (.mp4, .mp3, .wav, .m4a, .mov, etc.)")
  .option("-t, --target-lang <lang>", "Target language code (e.g., ja, en, es)", "ja")
  .option(
    "-f, --format <formats>",
    "Output formats: comma-separated list of srt, vtt, txt, json",
    "srt",
  )
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
      mediaFile: string | undefined,
      _actionOptions: Record<string, unknown>,
      cmd: Command,
    ) => {
      const options = cmd.optsWithGlobals<{
        targetLang: string;
        format: string;
        output?: string;
        ffmpegPath?: string;
        keepAudio?: boolean;
        noTranslate?: boolean;
        saveOriginal?: boolean;
        forceTranslate?: boolean;
        verbose?: boolean;
      }>();
      if (!mediaFile) {
        program.help();
        return;
      }

      const startTime = Date.now();
      const verbose = Boolean(options.verbose);
      const spinner = createSpinner("", { isSilent: verbose });
      const outputFiles: string[] = [];

      try {
        const outputFormats = parseOutputFormats(options.format);
        const resolvedMediaPath = path.resolve(process.cwd(), mediaFile);
        const rawConfig = getConfig(options.ffmpegPath);

        // Ensure API Key availability (Groq key is required; Gemini key will be validated lazily if translation is needed)
        const config = await ensureApiKeys(rawConfig, {
          requireGemini: false,
        });
        await checkFfmpeg(config.ffmpegPath);

        const isAudio = isAudioFile(resolvedMediaPath);
        const mediaTypeName = isAudio ? "audio" : "video";
        const mediaIcon = isAudio ? "🎵" : "🎬";

        console.log(
          `\n${mediaIcon} ${pc.bold("vsub-cli")} - 処理開始: ${pc.cyan(path.basename(resolvedMediaPath))}`,
        );

        // 1. Audio extraction / optimization
        const audioAction = isAudio ? "最適化中" : "抽出中";
        const audioDoneAction = isAudio ? "最適化完了" : "抽出完了";
        spinner.start(`🔊 [1/4] 音声を${audioAction} (16kHz mono / low bitrate)...`);
        const { audioPaths, cleanup } = await extractAudio(
          resolvedMediaPath,
          config.ffmpegPath,
          verbose,
        );

        let totalAudioBytes = 0;
        for (const p of audioPaths) {
          try {
            totalAudioBytes += fs.statSync(p).size;
          } catch {
            // ignore
          }
        }
        spinner.succeed(
          `🔊 [1/4] 音声${audioDoneAction} (${audioPaths.length} セグメント / ${formatFileSize(totalAudioBytes)})`,
        );

        try {
          // 2. Transcription with Groq
          const initialGroqText =
            audioPaths.length > 1
              ? `🎙️ [2/4] Groq Whisper API で文字起こし中 [1/${audioPaths.length}]...`
              : "🎙️ [2/4] Groq Whisper API で文字起こし中...";
          spinner.start(initialGroqText);

          const { entries: srtEntries, detectedLanguage } = await transcribeAudioSegments(
            audioPaths,
            config.groqApiKey,
            verbose,
            (current, total) => {
              if (total > 1) {
                spinner.updateText(
                  `🎙️ [2/4] Groq Whisper API で文字起こし中 [${current}/${total}]...`,
                );
              }
            },
          );

          if (srtEntries.length === 0) {
            spinner.warn("⚠️ [2/4] 文字起こし結果から有効な字幕エントリが検出されませんでした");
          } else {
            const langDisplay = detectedLanguage ? ` (言語: ${detectedLanguage})` : "";
            spinner.succeed(
              `🎙️ [2/4] 文字起こし完了${langDisplay} - ${srtEntries.length} 行の字幕を生成`,
            );
          }

          const isSameLanguage = Boolean(
            detectedLanguage && detectedLanguage.toLowerCase() === options.targetLang.toLowerCase(),
          );

          const skipTranslation =
            Boolean(options.noTranslate) || (isSameLanguage && !options.forceTranslate);

          const mediaDir = path.dirname(resolvedMediaPath);
          const mediaExt = path.extname(resolvedMediaPath);
          const mediaBaseName = path.basename(resolvedMediaPath, mediaExt);

          // Save original raw subtitles if requested
          if (options.saveOriginal) {
            const rawLang = detectedLanguage || "raw";
            const isNameConflict =
              rawLang.toLowerCase() === options.targetLang.toLowerCase() && !skipTranslation;
            const baseOriginalName = isNameConflict
              ? `${mediaBaseName}.orig`
              : `${mediaBaseName}.${rawLang}`;

            const savedOriginalNames: string[] = [];
            for (const fmt of outputFormats) {
              const originalFilename = `${baseOriginalName}.${fmt}`;
              const originalPath = path.join(mediaDir, originalFilename);
              fs.writeFileSync(originalPath, formatEntries(srtEntries, fmt), "utf-8");
              outputFiles.push(originalPath);
              savedOriginalNames.push(originalFilename);
            }
            spinner.info(`📄 原文字幕を保存: ${savedOriginalNames.join(", ")}`);
          }

          let finalEntries = srtEntries;
          const outputLang = skipTranslation
            ? detectedLanguage || options.targetLang
            : options.targetLang;

          if (skipTranslation) {
            if (options.noTranslate) {
              spinner.info("ℹ️ [3/4] [--no-translate] Gemini 翻訳をスキップしました");
            } else if (isSameLanguage) {
              spinner.info(
                `ℹ️ [3/4] 検出言語 ("${detectedLanguage}") がターゲット言語 ("${options.targetLang}") と同一のため翻訳をスキップ (--force-translate で強制実行可能)`,
              );
            }
          } else {
            // Ensure Gemini key before proceeding with translation
            const activeConfig = await ensureApiKeys(config, { requireGemini: true });

            const totalChunks = Math.max(1, Math.ceil(srtEntries.length / 50));
            spinner.start(
              `🌐 [3/4] Gemini API で ${options.targetLang} に翻訳中 [1/${totalChunks} チャンク]...`,
            );

            finalEntries = await translateSrtEntries(
              srtEntries,
              options.targetLang,
              activeConfig.geminiApiKey,
              verbose,
              (currentChunk, chunksCount) => {
                spinner.updateText(
                  `🌐 [3/4] Gemini API で ${options.targetLang} に翻訳中 [${currentChunk}/${chunksCount} チャンク]...`,
                );
              },
            );

            spinner.succeed(
              `🌐 [3/4] Gemini 翻訳完了 (${options.targetLang}) - ${finalEntries.length} 行`,
            );
          }

          // 4. Save output subtitle files
          spinner.start("💾 [4/4] 字幕ファイルを保存中...");

          if (options.output) {
            const resolvedOut = path.resolve(process.cwd(), options.output);
            if (outputFormats.length === 1) {
              const fmt = outputFormats[0] ?? "srt";
              fs.writeFileSync(resolvedOut, formatEntries(finalEntries, fmt), "utf-8");
              outputFiles.push(resolvedOut);
            } else {
              const parsedOut = path.parse(resolvedOut);
              for (const fmt of outputFormats) {
                const outFilePath = path.join(parsedOut.dir, `${parsedOut.name}.${fmt}`);
                fs.writeFileSync(outFilePath, formatEntries(finalEntries, fmt), "utf-8");
                outputFiles.push(outFilePath);
              }
            }
          } else {
            for (const fmt of outputFormats) {
              const outFilePath = path.join(mediaDir, `${mediaBaseName}.${outputLang}.${fmt}`);
              fs.writeFileSync(outFilePath, formatEntries(finalEntries, fmt), "utf-8");
              outputFiles.push(outFilePath);
            }
          }

          const formatListStr = outputFormats.map((f) => f.toUpperCase()).join(", ");
          spinner.succeed(`💾 [4/4] 字幕ファイルを保存完了 (${formatListStr})`);

          // 5. Output Summary Box
          const durationMs = Date.now() - startTime;
          console.log(
            "\n" +
              formatSummaryBox({
                mediaFile: path.basename(resolvedMediaPath),
                mediaType: mediaTypeName,
                durationMs,
                audioSegmentsCount: audioPaths.length,
                audioTotalBytes: totalAudioBytes,
                detectedLanguage,
                targetLanguage: outputLang,
                entriesCount: finalEntries.length,
                outputFiles,
                skippedTranslation: skipTranslation,
              }) +
              "\n",
          );
        } finally {
          if (!options.keepAudio) {
            await cleanup();
          } else {
            spinner.info(`ℹ️ [--keep-audio] 中間音声ファイルを保持: ${audioPaths.join(", ")}`);
          }
        }
      } catch (error) {
        spinner.fail(
          `処理中にエラーが発生しました: ${error instanceof Error ? error.message : String(error)}`,
        );
        if (verbose && error instanceof Error && error.stack) {
          console.error(error.stack);
        }
        process.exit(1);
      }
    },
  );

program.parse(process.argv);
