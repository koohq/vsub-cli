#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import pc from "picocolors";
import {
  clearCache,
  getCacheDir,
  getCacheStats,
  isTranscriptionCacheValid,
  isTranslationCacheValid,
  loadMediaCache,
  saveTranscriptionCache,
  saveTranslationCache,
} from "./cache.js";
import { ensureApiKeys, getConfig, getGlobalConfigPath, saveGlobalConfig } from "./config.js";
import { checkFfmpeg, extractAudio, isAudioFile } from "./ffmpeg.js";
import { formatEntries, type OutputFormat, parseOutputFormats } from "./formatter.js";
import { translateSrtEntries } from "./gemini.js";
import { computeGlossaryHash, extractWhisperPromptHints, parseGlossary } from "./glossary.js";
import { transcribeAudioSegments } from "./groq.js";
import { parseTargetLanguages } from "./languages.js";
import type { SrtEntry } from "./srt.js";
import { parseSrt } from "./srt.js";
import { createSpinner, formatFileSize, formatSummaryBox } from "./ui.js";

/**
 * Resolves destination file paths for output formats, handling single-language and multi-language naming.
 */
function resolveOutputFilePaths(
  baseDir: string,
  baseName: string,
  lang: string,
  formats: OutputFormat[],
  outputOption?: string,
  isSingleLanguage = true,
): { format: OutputFormat; filePath: string }[] {
  if (outputOption) {
    const resolvedOut = path.resolve(process.cwd(), outputOption);
    const parsedOut = path.parse(resolvedOut);
    if (isSingleLanguage) {
      if (formats.length === 1) {
        return [{ format: formats[0] ?? "srt", filePath: resolvedOut }];
      }
      return formats.map((fmt) => ({
        format: fmt,
        filePath: path.join(parsedOut.dir, `${parsedOut.name}.${fmt}`),
      }));
    }
    return formats.map((fmt) => ({
      format: fmt,
      filePath: path.join(parsedOut.dir, `${parsedOut.name}.${lang}.${fmt}`),
    }));
  }

  return formats.map((fmt) => ({
    format: fmt,
    filePath: path.join(baseDir, `${baseName}.${lang}.${fmt}`),
  }));
}

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
    if (resolvedConfig.whisperPrompt) {
      console.log(`Whisper Prompt : "${resolvedConfig.whisperPrompt}"`);
    }
    if (resolvedConfig.prompt) {
      console.log(`Translate Prompt: "${resolvedConfig.prompt}"`);
    }
    if (resolvedConfig.glossary) {
      console.log(`Glossary       : "${resolvedConfig.glossary}"`);
    }
    console.log("----------------------------------------\n");
  });

configCmd
  .command("set")
  .description("Save API Keys, prompts, glossary, or FFmpeg path to global config")
  .option("--groq-key <key>", "Groq API Key")
  .option("--gemini-key <key>", "Gemini API Key")
  .option("--ffmpeg-path <path>", "Path to ffmpeg executable")
  .option("--whisper-prompt <text>", "Default Whisper recognition prompt hint")
  .option("--prompt <instruction>", "Default Gemini translation instruction prompt")
  .option("--glossary <path-or-terms>", "Default glossary file path (JSON) or inline terms")
  .action(
    (options: {
      groqKey?: string;
      geminiKey?: string;
      ffmpegPath?: string;
      whisperPrompt?: string;
      prompt?: string;
      glossary?: string;
    }) => {
      if (
        !options.groqKey &&
        !options.geminiKey &&
        !options.ffmpegPath &&
        !options.whisperPrompt &&
        !options.prompt &&
        !options.glossary
      ) {
        console.log(
          "⚠️ Please specify settings to save. (Example: vsub config set --groq-key YOUR_KEY)",
        );
        return;
      }

      saveGlobalConfig({
        ...(options.groqKey ? { groqApiKey: options.groqKey.trim() } : {}),
        ...(options.geminiKey ? { geminiApiKey: options.geminiKey.trim() } : {}),
        ...(options.ffmpegPath ? { ffmpegPath: options.ffmpegPath.trim() } : {}),
        ...(options.whisperPrompt ? { whisperPrompt: options.whisperPrompt.trim() } : {}),
        ...(options.prompt ? { prompt: options.prompt.trim() } : {}),
        ...(options.glossary ? { glossary: options.glossary.trim() } : {}),
      });

      console.log(`✅ Configuration updated and saved: ${getGlobalConfigPath()}`);
    },
  );

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

// Subcommand: cache
const cacheCmd = program
  .command("cache")
  .description("Manage intermediate transcription and translation cache");

cacheCmd
  .command("path")
  .description("Display cache directory path")
  .option("--cache-dir <path>", "Custom cache directory")
  .action((options: { cacheDir?: string }) => {
    console.log(`Cache directory: ${getCacheDir(options.cacheDir)}`);
  });

cacheCmd
  .command("stats")
  .description("Display cache usage and entry counts")
  .option("--cache-dir <path>", "Custom cache directory")
  .action((options: { cacheDir?: string }) => {
    const stats = getCacheStats(options.cacheDir);
    console.log(`\n📁 Cache Directory : ${stats.cacheDir}`);
    console.log("----------------------------------------");
    console.log(`Cached Files     : ${stats.count} files`);
    console.log(`Total Size       : ${formatFileSize(stats.totalBytes)}`);
    console.log("----------------------------------------\n");
  });

cacheCmd
  .command("clean")
  .description("Delete all intermediate cache files")
  .option("--cache-dir <path>", "Custom cache directory")
  .action((options: { cacheDir?: string }) => {
    const result = clearCache(options.cacheDir);
    console.log(
      `✅ Cleared ${result.deletedCount} cache files (${formatFileSize(result.freedBytes)} freed) from: ${result.cacheDir}`,
    );
  });

// Subcommand: translate
program
  .command("translate")
  .description(
    "Directly translate an existing subtitle file (.srt) into target language(s) via Gemini API",
  )
  .argument("<subtitle-file>", "Input subtitle file path (.srt)")
  .option(
    "-t, --target-lang <langs>",
    "Target language code(s), comma-separated (e.g., ja, en, es, zh-TW)",
    "ja",
  )
  .option(
    "-f, --format <formats>",
    "Output formats: comma-separated list of srt, vtt, txt, json",
    "srt",
  )
  .option("-o, --output <path>", "Output path or base name for the generated subtitle file")
  .option("--prompt <instruction>", "Additional instruction prompt for Gemini translation")
  .option(
    "--glossary <path-or-terms>",
    "Glossary file path (JSON) or inline terms (key=val,key=val)",
  )
  .option("--no-cache", "Do not use or save intermediate translation cache", false)
  .option(
    "--fresh",
    "Ignore existing cache and generate fresh translations, overwriting cache",
    false,
  )
  .option("--cache-dir <path>", "Custom cache directory")
  .option("--gemini-key <key>", "Gemini API Key override")
  .option("--verbose", "Output detailed log messages", false)
  .action(async (subtitleFile: string, _actionOptions: Record<string, unknown>, cmd: Command) => {
    const options = cmd.optsWithGlobals<{
      targetLang: string;
      format: string;
      output?: string;
      prompt?: string;
      glossary?: string;
      noCache?: boolean;
      fresh?: boolean;
      cacheDir?: string;
      geminiKey?: string;
      verbose?: boolean;
    }>();
    const startTime = Date.now();
    const verbose = Boolean(options.verbose);
    const spinner = createSpinner("", { isSilent: verbose });
    const outputFiles: string[] = [];

    try {
      const outputFormats = parseOutputFormats(options.format);
      const targetLanguages = parseTargetLanguages(options.targetLang);
      const isMultiLang = targetLanguages.length > 1;
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

      // 2. Gemini Translation for each target language (with cache support)
      const useCache = !options.noCache && !options.fresh;
      const subtitleCache = useCache
        ? loadMediaCache(resolvedSubtitlePath, options.cacheDir)
        : null;
      const totalChunks = Math.max(1, Math.ceil(srtEntries.length / 50));
      const resultsByLang = new Map<string, SrtEntry[]>();
      const cachedLanguages: string[] = [];

      const translationPrompt = options.prompt?.trim() || config.prompt;
      const glossaryInput = options.glossary?.trim() || config.glossary;
      let totalGlossaryTerms = 0;

      for (let i = 0; i < targetLanguages.length; i++) {
        const lang = targetLanguages[i] ?? "ja";
        const glossaryMap = glossaryInput ? parseGlossary(glossaryInput, lang) : undefined;
        const glossaryHash = glossaryMap ? computeGlossaryHash(glossaryMap) : undefined;
        if (glossaryMap) {
          totalGlossaryTerms = Math.max(totalGlossaryTerms, Object.keys(glossaryMap).length);
        }

        const cachedTranslation = subtitleCache?.translations?.[lang.toLowerCase()];
        const isCacheValid =
          useCache && isTranslationCacheValid(cachedTranslation, translationPrompt, glossaryHash);

        if (isCacheValid && cachedTranslation && cachedTranslation.entries.length > 0) {
          resultsByLang.set(lang, cachedTranslation.entries);
          cachedLanguages.push(lang);
          if (isMultiLang) {
            spinner.info(
              `  ✔ ${lang.toUpperCase()} 翻訳 (キャッシュ利用: ${cachedTranslation.entries.length} 行)`,
            );
          }
          continue;
        }

        const initialText = isMultiLang
          ? `🌐 [2/3] Gemini API で翻訳中 (${i + 1}/${targetLanguages.length} 言語: ${lang.toUpperCase()} [1/${totalChunks} チャンク])...`
          : `🌐 [2/3] Gemini API で ${lang} に翻訳中 [1/${totalChunks} チャンク]...`;

        spinner.start(initialText);

        const translatedEntries = await translateSrtEntries(
          srtEntries,
          lang,
          config.geminiApiKey,
          verbose,
          (currentChunk, chunksCount) => {
            if (isMultiLang) {
              spinner.updateText(
                `🌐 [2/3] Gemini API で翻訳中 (${i + 1}/${targetLanguages.length} 言語: ${lang.toUpperCase()} [${currentChunk}/${chunksCount} チャンク])...`,
              );
            } else {
              spinner.updateText(
                `🌐 [2/3] Gemini API で ${lang} に翻訳中 [${currentChunk}/${chunksCount} チャンク]...`,
              );
            }
          },
          {
            prompt: translationPrompt,
            glossary: glossaryMap,
          },
        );

        resultsByLang.set(lang, translatedEntries);

        // Save translation result to cache
        if (!options.noCache) {
          saveTranslationCache(
            resolvedSubtitlePath,
            lang,
            {
              targetLang: lang,
              prompt: translationPrompt,
              glossaryHash,
              entries: translatedEntries,
              createdAt: Date.now(),
            },
            options.cacheDir,
          );
        }

        if (isMultiLang) {
          spinner.info(`  ✔ ${lang.toUpperCase()} 翻訳完了 (${translatedEntries.length} 行)`);
        }
      }

      const langListDisplay = targetLanguages.map((l) => l.toUpperCase()).join(", ");
      spinner.succeed(`🌐 [2/3] Gemini 翻訳完了 (${langListDisplay}) - ${srtEntries.length} 行`);

      // 3. Save output subtitle files
      spinner.start("💾 [3/3] 字幕ファイルを保存中...");

      const subDir = path.dirname(resolvedSubtitlePath);
      const subExt = path.extname(resolvedSubtitlePath);
      let subBaseName = path.basename(resolvedSubtitlePath, subExt);

      // If base name ends with language tag like .en, .ja, strip it to avoid .en.ja
      const langSuffixMatch = subBaseName.match(/^(.+)\.([a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,4})?)$/);
      if (langSuffixMatch?.[1]) {
        subBaseName = langSuffixMatch[1];
      }

      for (const lang of targetLanguages) {
        const entries = resultsByLang.get(lang) ?? srtEntries;
        const targets = resolveOutputFilePaths(
          subDir,
          subBaseName,
          lang,
          outputFormats,
          options.output,
          !isMultiLang,
        );
        for (const { format, filePath } of targets) {
          fs.writeFileSync(filePath, formatEntries(entries, format), "utf-8");
          outputFiles.push(filePath);
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
            targetLanguages,
            entriesCount: srtEntries.length,
            outputFiles,
            skippedTranslation: false,
            prompt: translationPrompt,
            glossaryTermsCount: totalGlossaryTerms > 0 ? totalGlossaryTerms : undefined,
            cacheStatus: cachedLanguages.length > 0 ? { cachedLanguages } : undefined,
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
  .option(
    "-t, --target-lang <langs>",
    "Target language code(s), comma-separated (e.g., ja, en, es, zh-TW)",
    "ja",
  )
  .option(
    "-f, --format <formats>",
    "Output formats: comma-separated list of srt, vtt, txt, json",
    "srt",
  )
  .option("-o, --output <path>", "Output path or base name for the generated subtitle file(s)")
  .option(
    "--ffmpeg-path <path>",
    "Path to ffmpeg executable (searches VSUB_FFMPEG_PATH or PATH if omitted)",
  )
  .option("--whisper-prompt <text>", "Prompt hint for Groq Whisper speech recognition")
  .option("--prompt <instruction>", "Additional instruction prompt for Gemini translation")
  .option(
    "--glossary <path-or-terms>",
    "Glossary file path (JSON) or inline terms (key=val,key=val)",
  )
  .option("--no-cache", "Do not use or save intermediate transcription/translation cache", false)
  .option(
    "--fresh",
    "Ignore existing cache and generate fresh transcription/translations, overwriting cache",
    false,
  )
  .option("--cache-dir <path>", "Custom cache directory")
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
        whisperPrompt?: string;
        prompt?: string;
        glossary?: string;
        noCache?: boolean;
        fresh?: boolean;
        cacheDir?: string;
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
        const targetLanguages = parseTargetLanguages(options.targetLang);
        const isMultiLang = targetLanguages.length > 1;
        const resolvedMediaPath = path.resolve(process.cwd(), mediaFile);
        const rawConfig = getConfig(options.ffmpegPath);

        const glossaryInput = options.glossary?.trim() || rawConfig.glossary;
        let whisperPrompt = options.whisperPrompt?.trim() || rawConfig.whisperPrompt;
        if (!whisperPrompt && glossaryInput) {
          whisperPrompt = extractWhisperPromptHints(glossaryInput);
        }

        const isAudio = isAudioFile(resolvedMediaPath);
        const mediaTypeName = isAudio ? "audio" : "video";
        const mediaIcon = isAudio ? "🎵" : "🎬";

        console.log(
          `\n${mediaIcon} ${pc.bold("vsub-cli")} - 処理開始: ${pc.cyan(path.basename(resolvedMediaPath))}`,
        );

        const useCache = !options.noCache && !options.fresh;
        const mediaCache = useCache ? loadMediaCache(resolvedMediaPath, options.cacheDir) : null;

        let srtEntries: SrtEntry[] = [];
        let detectedLanguage: string | undefined;
        let transcriptionCacheHit = false;
        let audioPaths: string[] = [];
        let totalAudioBytes = 0;
        let cleanupAudio: (() => Promise<void>) | null = null;

        // Check if cached transcription is available and compatible with whisperPrompt
        const isTranscriptionCacheMatch =
          useCache && isTranscriptionCacheValid(mediaCache?.transcription, whisperPrompt);

        if (isTranscriptionCacheMatch && mediaCache?.transcription) {
          transcriptionCacheHit = true;
          srtEntries = mediaCache.transcription.entries;
          detectedLanguage = mediaCache.transcription.detectedLanguage;

          const langDisplay = detectedLanguage ? ` (言語: ${detectedLanguage.toUpperCase()})` : "";
          spinner.info(
            `🔊 [1/4] 文字起こしキャッシュが存在するため音声抽出をスキップ [⚡ キャッシュ利用]`,
          );
          spinner.succeed(
            `🎙️ [2/4] キャッシュされた文字起こし結果を利用${langDisplay} - ${srtEntries.length} 行の字幕 [⚡ キャッシュ利用]`,
          );
        } else {
          // Ensure Groq API Key and FFmpeg only when transcription is needed
          const config = await ensureApiKeys(rawConfig, {
            requireGroq: true,
            requireGemini: false,
          });
          await checkFfmpeg(config.ffmpegPath);

          // 1. Audio extraction / optimization
          const audioAction = isAudio ? "最適化中" : "抽出中";
          const audioDoneAction = isAudio ? "最適化完了" : "抽出完了";
          spinner.start(`🔊 [1/4] 音声を${audioAction} (16kHz mono / low bitrate)...`);
          const extractResult = await extractAudio(resolvedMediaPath, config.ffmpegPath, verbose);
          audioPaths = extractResult.audioPaths;
          cleanupAudio = extractResult.cleanup;

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

          // 2. Transcription with Groq
          const initialGroqText =
            audioPaths.length > 1
              ? `🎙️ [2/4] Groq Whisper API で文字起こし中 [1/${audioPaths.length}]...`
              : "🎙️ [2/4] Groq Whisper API で文字起こし中...";
          spinner.start(initialGroqText);

          const transcriptResult = await transcribeAudioSegments(
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
            whisperPrompt ? { prompt: whisperPrompt } : undefined,
          );

          srtEntries = transcriptResult.entries;
          detectedLanguage = transcriptResult.detectedLanguage;

          if (srtEntries.length === 0) {
            spinner.warn("⚠️ [2/4] 文字起こし結果から有効な字幕エントリが検出されませんでした");
          } else {
            const langDisplay = detectedLanguage ? ` (言語: ${detectedLanguage})` : "";
            spinner.succeed(
              `🎙️ [2/4] 文字起こし完了${langDisplay} - ${srtEntries.length} 行の字幕を生成`,
            );

            // Save transcription to cache
            if (!options.noCache) {
              saveTranscriptionCache(
                resolvedMediaPath,
                {
                  detectedLanguage,
                  prompt: whisperPrompt,
                  entries: srtEntries,
                  createdAt: Date.now(),
                },
                options.cacheDir,
              );
            }
          }
        }

        const mediaDir = path.dirname(resolvedMediaPath);
        const mediaExt = path.extname(resolvedMediaPath);
        const mediaBaseName = path.basename(resolvedMediaPath, mediaExt);

        try {
          // Save original raw subtitles if requested
          if (options.saveOriginal && srtEntries.length > 0) {
            const rawLang = detectedLanguage || "raw";
            const baseOriginalName = `${mediaBaseName}.${rawLang}`;

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

          // 3. Gemini Translation for each target language
          const resultsByLang = new Map<string, SrtEntry[]>();
          const skippedLanguages: string[] = [];
          const translatedLanguages: string[] = [];
          const cachedLanguages: string[] = [];

          let activeConfig: ReturnType<typeof getConfig> | null = null;
          const totalChunks = Math.max(1, Math.ceil(srtEntries.length / 50));
          const translationPrompt = options.prompt?.trim() || rawConfig.prompt;
          let totalGlossaryTerms = 0;

          for (let i = 0; i < targetLanguages.length; i++) {
            const lang = targetLanguages[i] ?? "ja";
            const isSameLanguage = Boolean(
              detectedLanguage && detectedLanguage.toLowerCase() === lang.toLowerCase(),
            );
            const shouldSkip =
              Boolean(options.noTranslate) || (isSameLanguage && !options.forceTranslate);

            if (shouldSkip) {
              skippedLanguages.push(lang);
              resultsByLang.set(lang, srtEntries);

              if (options.noTranslate) {
                spinner.info(
                  `ℹ️ [3/4] [--no-translate] ${lang.toUpperCase()} の Gemini 翻訳をスキップしました`,
                );
              } else if (isSameLanguage) {
                spinner.info(
                  `ℹ️ [3/4] 検出言語 (${detectedLanguage?.toUpperCase()}) と一致するため ${lang.toUpperCase()} の翻訳をスキップしました`,
                );
              }
              continue;
            }

            const glossaryMap = glossaryInput ? parseGlossary(glossaryInput, lang) : undefined;
            const glossaryHash = glossaryMap ? computeGlossaryHash(glossaryMap) : undefined;
            if (glossaryMap) {
              totalGlossaryTerms = Math.max(totalGlossaryTerms, Object.keys(glossaryMap).length);
            }

            const cachedTranslation = mediaCache?.translations?.[lang.toLowerCase()];
            const isCacheValid =
              useCache &&
              isTranslationCacheValid(cachedTranslation, translationPrompt, glossaryHash);

            if (isCacheValid && cachedTranslation && cachedTranslation.entries.length > 0) {
              // Translation cache hit for this language
              resultsByLang.set(lang, cachedTranslation.entries);
              cachedLanguages.push(lang);
              translatedLanguages.push(lang);

              if (isMultiLang) {
                spinner.info(
                  `  ✔ ${lang.toUpperCase()} 翻訳 (キャッシュ利用: ${cachedTranslation.entries.length} 行) [⚡ キャッシュ利用]`,
                );
              }
              continue;
            }

            // Ensure Gemini key before running translation
            if (!activeConfig) {
              activeConfig = await ensureApiKeys(rawConfig, {
                requireGroq: false,
                requireGemini: true,
              });
            }

            const initialText = isMultiLang
              ? `🌐 [3/4] Gemini API で翻訳中 (${i + 1}/${targetLanguages.length} 言語: ${lang.toUpperCase()} [1/${totalChunks} チャンク])...`
              : `🌐 [3/4] Gemini API で ${lang} に翻訳中 [1/${totalChunks} チャンク]...`;

            spinner.start(initialText);

            const translatedEntries = await translateSrtEntries(
              srtEntries,
              lang,
              activeConfig.geminiApiKey,
              verbose,
              (currentChunk, chunksCount) => {
                if (isMultiLang) {
                  spinner.updateText(
                    `🌐 [3/4] Gemini API で翻訳中 (${i + 1}/${targetLanguages.length} 言語: ${lang.toUpperCase()} [${currentChunk}/${chunksCount} チャンク])...`,
                  );
                } else {
                  spinner.updateText(
                    `🌐 [3/4] Gemini API で ${lang} に翻訳中 [${currentChunk}/${chunksCount} チャンク]...`,
                  );
                }
              },
              {
                prompt: translationPrompt,
                glossary: glossaryMap,
              },
            );

            resultsByLang.set(lang, translatedEntries);
            translatedLanguages.push(lang);

            // Save language translation to cache
            if (!options.noCache) {
              saveTranslationCache(
                resolvedMediaPath,
                lang,
                {
                  targetLang: lang,
                  prompt: translationPrompt,
                  glossaryHash,
                  entries: translatedEntries,
                  createdAt: Date.now(),
                },
                options.cacheDir,
              );
            }

            if (isMultiLang) {
              spinner.info(`  ✔ ${lang.toUpperCase()} 翻訳完了 (${translatedEntries.length} 行)`);
            }
          }

          if (translatedLanguages.length > 0) {
            const langListDisplay = translatedLanguages.map((l) => l.toUpperCase()).join(", ");
            spinner.succeed(
              `🌐 [3/4] Gemini 翻訳完了 (${langListDisplay}) - ${srtEntries.length} 行`,
            );
          }

          // 4. Save output subtitle files
          spinner.start("💾 [4/4] 字幕ファイルを保存中...");

          for (const lang of targetLanguages) {
            const entries = resultsByLang.get(lang) ?? srtEntries;
            const targets = resolveOutputFilePaths(
              mediaDir,
              mediaBaseName,
              lang,
              outputFormats,
              options.output,
              !isMultiLang,
            );
            for (const { format, filePath } of targets) {
              fs.writeFileSync(filePath, formatEntries(entries, format), "utf-8");
              outputFiles.push(filePath);
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
                audioSegmentsCount: audioPaths.length > 0 ? audioPaths.length : undefined,
                audioTotalBytes: totalAudioBytes > 0 ? totalAudioBytes : undefined,
                detectedLanguage,
                targetLanguages,
                skippedLanguages,
                entriesCount: srtEntries.length,
                outputFiles,
                skippedTranslation: skippedLanguages.length === targetLanguages.length,
                whisperPrompt,
                prompt: translationPrompt,
                glossaryTermsCount: totalGlossaryTerms > 0 ? totalGlossaryTerms : undefined,
                cacheStatus:
                  transcriptionCacheHit || cachedLanguages.length > 0
                    ? {
                        transcriptionHit: transcriptionCacheHit,
                        cachedLanguages,
                      }
                    : undefined,
              }) +
              "\n",
          );
        } finally {
          if (cleanupAudio) {
            if (!options.keepAudio) {
              await cleanupAudio();
            } else {
              spinner.info(`ℹ️ [--keep-audio] 中間音声ファイルを保持: ${audioPaths.join(", ")}`);
            }
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
