#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import pc from "picocolors";
import { type BatchPipelineOptions, runBatchPipeline } from "./batch.js";
import {
  clearCache,
  getCacheDir,
  getCacheStats,
  isTranslationCacheValid,
  loadMediaCache,
  saveTranslationCache,
} from "./cache.js";
import {
  DEFAULT_GEMINI_MODEL,
  ensureApiKeys,
  getConfig,
  getGlobalConfigPath,
  saveGlobalConfig,
} from "./config.js";
import { burnSubtitlesToVideo, checkFfmpeg, isVideoFile } from "./ffmpeg.js";
import { formatEntries, type OutputFormat, parseOutputFormats } from "./formatter.js";
import { translateSrtEntries } from "./gemini.js";
import { computeGlossaryHash, parseGlossary } from "./glossary.js";
import { runInitWizard } from "./init.js";
import { parseTargetLanguages } from "./languages.js";
import { printLicenses } from "./licenses.js";
import { type ProcessMediaOptions, processMediaPipeline } from "./pipeline.js";
import { ensureWritableTargets } from "./safety.js";
import type { BilingualOrder, SrtEntry } from "./srt.js";
import { mergeBilingualEntries, parseSrt } from "./srt.js";
import { createSpinner, formatFileSize, formatSummaryBox } from "./ui.js";

/**
 * Validates and normalizes bilingual order option.
 */
function parseBilingualOrder(input?: string): BilingualOrder {
  if (!input) return "original-first";
  const normalized = input.trim().toLowerCase();
  if (normalized === "original-first" || normalized === "target-first") {
    return normalized;
  }
  throw new Error(
    `サポートされていないバイリンガル順序です: "${input}". 利用可能な順序: "original-first", "target-first"`,
  );
}

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
  isBilingual = false,
): { format: OutputFormat; filePath: string }[] {
  const langTag = isBilingual ? `${lang}.bilingual` : lang;
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
      filePath: path.join(parsedOut.dir, `${parsedOut.name}.${langTag}.${fmt}`),
    }));
  }

  return formats.map((fmt) => ({
    format: fmt,
    filePath: path.join(baseDir, `${baseName}.${langTag}.${fmt}`),
  }));
}

const program = new Command();

program
  .name("vsub")
  .version("1.0.0")
  .description(
    "CLI tool to extract audio from video/audio files, transcribe speech via Groq API, and generate multilingual subtitles (.srt, .vtt, .txt, .json) via Gemini API.",
  );

// Subcommand: licenses
program
  .command("licenses")
  .description("Display third-party open source licenses and legal notices")
  .option("--full", "Display full license text for all bundled dependencies")
  .action((options: { full?: boolean }) => {
    printLicenses({ full: options.full });
  });

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
    if (resolvedConfig.geminiModel) {
      console.log(`Gemini Model   : ${resolvedConfig.geminiModel}`);
    }
    if (resolvedConfig.groqModel) {
      console.log(`Groq Model     : ${resolvedConfig.groqModel}`);
    }
    console.log("----------------------------------------\n");
  });

configCmd
  .command("set")
  .description(
    "Save API Keys, models, prompts, glossary, concurrency, or FFmpeg path to global config",
  )
  .option("--groq-key <key>", "Groq API Key")
  .option("--gemini-key <key>", "Gemini API Key")
  .option("--ffmpeg-path <path>", "Path to ffmpeg executable")
  .option("--gemini-model <model>", "Default Gemini translation model (e.g. gemini-3.8-flash)")
  .option(
    "--groq-model <model>",
    "Default Groq Whisper transcription model (e.g. whisper-large-v3-turbo)",
  )
  .option("--whisper-prompt <text>", "Default Whisper recognition prompt hint")
  .option("--prompt <instruction>", "Default Gemini translation instruction prompt")
  .option("--glossary <path-or-terms>", "Default glossary file path (JSON) or inline terms")
  .option(
    "--concurrency <number>",
    "Default concurrent translation requests to Gemini API (e.g. 3)",
  )
  .action(
    (options: {
      groqKey?: string;
      geminiKey?: string;
      ffmpegPath?: string;
      geminiModel?: string;
      groqModel?: string;
      whisperPrompt?: string;
      prompt?: string;
      glossary?: string;
      concurrency?: string;
    }) => {
      let concurrencyNum: number | undefined;
      if (options.concurrency) {
        const n = Number(options.concurrency);
        if (!Number.isNaN(n) && n > 0) {
          concurrencyNum = Math.floor(n);
        }
      }

      if (
        !options.groqKey &&
        !options.geminiKey &&
        !options.ffmpegPath &&
        !options.geminiModel &&
        !options.groqModel &&
        !options.whisperPrompt &&
        !options.prompt &&
        !options.glossary &&
        concurrencyNum === undefined
      ) {
        console.log(
          "⚠️ Please specify settings to save. (Example: vsub config set --gemini-model gemini-3.8-flash)",
        );
        return;
      }

      saveGlobalConfig({
        ...(options.groqKey ? { groqApiKey: options.groqKey.trim() } : {}),
        ...(options.geminiKey ? { geminiApiKey: options.geminiKey.trim() } : {}),
        ...(options.ffmpegPath ? { ffmpegPath: options.ffmpegPath.trim() } : {}),
        ...(options.geminiModel ? { geminiModel: options.geminiModel.trim() } : {}),
        ...(options.groqModel ? { groqModel: options.groqModel.trim() } : {}),
        ...(options.whisperPrompt ? { whisperPrompt: options.whisperPrompt.trim() } : {}),
        ...(options.prompt ? { prompt: options.prompt.trim() } : {}),
        ...(options.glossary ? { glossary: options.glossary.trim() } : {}),
        ...(concurrencyNum !== undefined ? { concurrency: concurrencyNum } : {}),
      });

      console.log(`✅ Configuration updated and saved: ${getGlobalConfigPath()}`);
    },
  );

configCmd
  .command("init")
  .description(
    "Interactive setup wizard to configure API keys and preferences (alias to vsub init)",
  )
  .action(async () => {
    await runInitWizard();
  });

// Subcommand: init (Top-level wizard)
program
  .command("init")
  .description(
    "Interactive setup wizard to verify and configure Groq API, Gemini API, FFmpeg, and preferences",
  )
  .action(async () => {
    await runInitWizard();
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
  .option("-w, --overwrite", "Overwrite existing output files without confirmation prompt", false)
  .option("--backup", "Create backup (.bak) of existing output files before overwriting", false)
  .option(
    "-b, --bilingual",
    "Generate bilingual subtitles combining original and translated text",
    false,
  )
  .option(
    "--bilingual-order <order>",
    "Order of bilingual subtitles: original-first (default) or target-first",
    "original-first",
  )
  .option("--prompt <instruction>", "Additional instruction prompt for Gemini translation")
  .option(
    "--glossary <path-or-terms>",
    "Glossary file path (JSON) or inline terms (key=val,key=val)",
  )
  .option("--concurrency <number>", "Number of concurrent translation requests to Gemini API")
  .option("--gemini-model <model>", "Gemini model to use for translation")
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
      overwrite?: boolean;
      backup?: boolean;
      bilingual?: boolean;
      bilingualOrder?: string;
      prompt?: string;
      glossary?: string;
      concurrency?: string;
      geminiModel?: string;
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
      const isBilingual = Boolean(options.bilingual);
      const bilingualOrder = parseBilingualOrder(options.bilingualOrder);
      const resolvedSubtitlePath = path.resolve(process.cwd(), subtitleFile);

      if (!fs.existsSync(resolvedSubtitlePath)) {
        throw new Error(`字幕ファイルが見つかりません: ${resolvedSubtitlePath}`);
      }

      const subDir = path.dirname(resolvedSubtitlePath);
      const subExt = path.extname(resolvedSubtitlePath);
      let subBaseName = path.basename(resolvedSubtitlePath, subExt);

      // If base name ends with language tag like .en, .ja, strip it to avoid .en.ja
      const langSuffixMatch = subBaseName.match(/^(.+)\.([a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,4})?)$/);
      if (langSuffixMatch?.[1]) {
        subBaseName = langSuffixMatch[1];
      }

      // Pre-check output file safety before performing API calls
      const predictedTargets: string[] = [];
      for (const lang of targetLanguages) {
        const targets = resolveOutputFilePaths(
          subDir,
          subBaseName,
          lang,
          outputFormats,
          options.output,
          !isMultiLang,
          isBilingual,
        );
        for (const { filePath } of targets) {
          predictedTargets.push(filePath);
        }
      }

      const safetyCheck = await ensureWritableTargets(predictedTargets, {
        overwrite: options.overwrite,
        backup: options.backup,
      });

      if (!safetyCheck.proceed) {
        console.log(
          "⚠️  処理を中止しました。(--overwrite または --backup を指定して再実行できます)",
        );
        return;
      }

      if (safetyCheck.backedUp.length > 0) {
        for (const { original, backup } of safetyCheck.backedUp) {
          console.log(
            `📦 バックアップを作成しました: ${pc.cyan(path.basename(original))} -> ${pc.yellow(path.basename(backup))}`,
          );
        }
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

      const geminiModel = options.geminiModel?.trim() || config.geminiModel;

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
      const concurrencyVal = options.concurrency ? Number(options.concurrency) : config.concurrency;
      const resolvedConcurrency =
        concurrencyVal && !Number.isNaN(concurrencyVal) && concurrencyVal > 0
          ? Math.floor(concurrencyVal)
          : undefined;
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
          useCache &&
          isTranslationCacheValid(cachedTranslation, translationPrompt, glossaryHash, geminiModel);

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

        const effectiveGeminiModel = geminiModel || DEFAULT_GEMINI_MODEL;
        const initialText = isMultiLang
          ? `🌐 [2/3] Gemini (${effectiveGeminiModel}) で翻訳中 (${i + 1}/${targetLanguages.length} 言語: ${lang.toUpperCase()} [1/${totalChunks} チャンク])...`
          : `🌐 [2/3] Gemini (${effectiveGeminiModel}) で ${lang} に翻訳中 [1/${totalChunks} チャンク]...`;

        spinner.start(initialText);

        const translatedEntries = await translateSrtEntries(
          srtEntries,
          lang,
          config.geminiApiKey,
          verbose,
          (currentChunk, chunksCount) => {
            if (isMultiLang) {
              spinner.updateText(
                `🌐 [2/3] Gemini (${effectiveGeminiModel}) で翻訳中 (${i + 1}/${targetLanguages.length} 言語: ${lang.toUpperCase()} [${currentChunk}/${chunksCount} チャンク])...`,
              );
            } else {
              spinner.updateText(
                `🌐 [2/3] Gemini (${effectiveGeminiModel}) で ${lang} に翻訳中 [${currentChunk}/${chunksCount} チャンク]...`,
              );
            }
          },
          {
            prompt: translationPrompt,
            glossary: glossaryMap,
            concurrency: resolvedConcurrency,
            model: geminiModel,
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
              model: geminiModel,
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

      for (const lang of targetLanguages) {
        let entries = resultsByLang.get(lang) ?? srtEntries;
        if (isBilingual) {
          entries = mergeBilingualEntries(srtEntries, entries, { order: bilingualOrder });
        }
        const targets = resolveOutputFilePaths(
          subDir,
          subBaseName,
          lang,
          outputFormats,
          options.output,
          !isMultiLang,
          isBilingual,
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
            bilingual: isBilingual ? { order: bilingualOrder } : undefined,
            backedUpFiles:
              safetyCheck.backedUp.length > 0
                ? safetyCheck.backedUp.map((b) => b.backup)
                : undefined,
            outputFiles,
            skippedTranslation: false,
            prompt: translationPrompt,
            glossaryTermsCount: totalGlossaryTerms > 0 ? totalGlossaryTerms : undefined,
            geminiModel: geminiModel || DEFAULT_GEMINI_MODEL,
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

// Subcommand: burn
program
  .command("burn")
  .description(
    "Burn an existing subtitle file (.srt) directly into a video file via FFmpeg (hardsub)",
  )
  .argument("<video-file>", "Input video file path (.mp4, .mkv, .mov, etc.)")
  .argument("<subtitle-file>", "Input subtitle file path (.srt)")
  .option("-o, --output <path>", "Output video file path (default: <video>.subbed.mp4)")
  .option("-w, --overwrite", "Overwrite existing output files without confirmation prompt", false)
  .option("--backup", "Create backup (.bak) of existing output files before overwriting", false)
  .option(
    "--ffmpeg-path <path>",
    "Path to ffmpeg executable (searches VSUB_FFMPEG_PATH or PATH if omitted)",
  )
  .option("--verbose", "Output detailed log messages", false)
  .action(
    async (
      videoFile: string,
      subtitleFile: string,
      _actionOptions: Record<string, unknown>,
      cmd: Command,
    ) => {
      const options = cmd.optsWithGlobals<{
        output?: string;
        overwrite?: boolean;
        backup?: boolean;
        ffmpegPath?: string;
        verbose?: boolean;
      }>();
      const startTime = Date.now();
      const verbose = Boolean(options.verbose);
      const spinner = createSpinner("", { isSilent: verbose });

      try {
        const resolvedVideoPath = path.resolve(process.cwd(), videoFile);
        const resolvedSubtitlePath = path.resolve(process.cwd(), subtitleFile);

        if (!fs.existsSync(resolvedVideoPath)) {
          throw new Error(`動画ファイルが見つかりません: ${resolvedVideoPath}`);
        }
        if (!isVideoFile(resolvedVideoPath)) {
          throw new Error(
            `動画ファイル以外の形式には字幕を焼き込めません: ${path.basename(resolvedVideoPath)}`,
          );
        }
        if (!fs.existsSync(resolvedSubtitlePath)) {
          throw new Error(`字幕ファイルが見つかりません: ${resolvedSubtitlePath}`);
        }

        const rawConfig = getConfig(options.ffmpegPath);
        await checkFfmpeg(rawConfig.ffmpegPath);

        let resolvedOutputPath: string;
        if (options.output) {
          resolvedOutputPath = path.resolve(process.cwd(), options.output);
        } else {
          const videoDir = path.dirname(resolvedVideoPath);
          const videoExt = path.extname(resolvedVideoPath);
          const videoBase = path.basename(resolvedVideoPath, videoExt);
          resolvedOutputPath = path.join(videoDir, `${videoBase}.subbed.mp4`);
        }

        // Pre-check output video file safety
        const safetyCheck = await ensureWritableTargets([resolvedOutputPath], {
          overwrite: options.overwrite,
          backup: options.backup,
        });

        if (!safetyCheck.proceed) {
          console.log(
            "⚠️  処理を中止しました。(--overwrite または --backup を指定して再実行できます)",
          );
          return;
        }

        if (safetyCheck.backedUp.length > 0) {
          for (const { original, backup } of safetyCheck.backedUp) {
            console.log(
              `📦 バックアップを作成しました: ${pc.cyan(path.basename(original))} -> ${pc.yellow(path.basename(backup))}`,
            );
          }
        }

        console.log(
          `\n🎬 ${pc.bold("vsub-cli burn")} - 字幕焼き込み開始: ${pc.cyan(path.basename(resolvedVideoPath))} + ${pc.cyan(path.basename(resolvedSubtitlePath))}`,
        );

        spinner.start("🎬 FFmpeg で字幕を動画に焼き込み中 (libx264)...");
        await burnSubtitlesToVideo(resolvedVideoPath, resolvedSubtitlePath, resolvedOutputPath, {
          ffmpegPath: rawConfig.ffmpegPath,
          verbose,
        });
        spinner.succeed("🎬 字幕の動画焼き込みが完了しました");

        const durationMs = Date.now() - startTime;
        let outStats: fs.Stats | undefined;
        try {
          outStats = fs.statSync(resolvedOutputPath);
        } catch {
          // ignore
        }

        let entriesCount = 0;
        try {
          const subContent = fs.readFileSync(resolvedSubtitlePath, "utf-8");
          const parsed = parseSrt(subContent);
          entriesCount = parsed.length;
        } catch {
          // ignore
        }

        console.log(
          "\n" +
            formatSummaryBox({
              mediaFile: path.basename(resolvedVideoPath),
              mediaType: "video",
              durationMs,
              entriesCount,
              backedUpFiles:
                safetyCheck.backedUp.length > 0
                  ? safetyCheck.backedUp.map((b) => b.backup)
                  : undefined,
              outputFiles: [
                outStats
                  ? `${resolvedOutputPath} (${formatFileSize(outStats.size)})`
                  : resolvedOutputPath,
              ],
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
    },
  );

// Subcommand: batch
program
  .command("batch")
  .description(
    "Process multiple media files in bulk (directories, multiple files, or glob patterns)",
  )
  .argument("<targets...>", "Target files, directories, or glob patterns")
  .option("-r, --recursive", "Recursively search directories for media files", true)
  .option("--no-recursive", "Do not recursively search subdirectories")
  .option("-o, --output-dir <dir>", "Directory to output generated subtitle and video files")
  .option("--fail-fast", "Abort remaining batch jobs immediately on first error", false)
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
  .option("-w, --overwrite", "Overwrite existing output files without confirmation prompt", false)
  .option("--backup", "Create backup (.bak) of existing output files before overwriting", false)
  .option(
    "-b, --bilingual",
    "Generate bilingual subtitles combining original and translated text",
    false,
  )
  .option(
    "--bilingual-order <order>",
    "Order of bilingual subtitles: original-first (default) or target-first",
    "original-first",
  )
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
  .option("--concurrency <number>", "Number of concurrent translation requests to Gemini API")
  .option("--gemini-model <model>", "Gemini model to use for translation")
  .option("--groq-model <model>", "Groq Whisper model to use for transcription")
  .option("--no-cache", "Do not use or save intermediate transcription/translation cache", false)
  .option(
    "--fresh",
    "Ignore existing cache and generate fresh transcription/translations, overwriting cache",
    false,
  )
  .option("--cache-dir <path>", "Custom cache directory")
  .option("--burn", "Burn generated subtitles directly into output video (hardsub)", false)
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
  .action(async (targets: string[], _actionOptions: Record<string, unknown>, cmd: Command) => {
    const options = cmd.optsWithGlobals<
      BatchPipelineOptions & { format: string; targetLang: string }
    >();
    try {
      const summary = await runBatchPipeline({
        ...options,
        targets,
      });
      if (summary.failedCount > 0) {
        process.exit(1);
      }
    } catch (error) {
      console.error(
        pc.red(
          `\n✖ バッチ処理中に致命的なエラーが発生しました: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
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
  .option("-w, --overwrite", "Overwrite existing output files without confirmation prompt", false)
  .option("--backup", "Create backup (.bak) of existing output files before overwriting", false)
  .option(
    "-b, --bilingual",
    "Generate bilingual subtitles combining original and translated text",
    false,
  )
  .option(
    "--bilingual-order <order>",
    "Order of bilingual subtitles: original-first (default) or target-first",
    "original-first",
  )
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
  .option("--concurrency <number>", "Number of concurrent translation requests to Gemini API")
  .option("--gemini-model <model>", "Gemini model to use for translation")
  .option("--groq-model <model>", "Groq Whisper model to use for transcription")
  .option("--no-cache", "Do not use or save intermediate transcription/translation cache", false)
  .option(
    "--fresh",
    "Ignore existing cache and generate fresh transcription/translations, overwriting cache",
    false,
  )
  .option("--cache-dir <path>", "Custom cache directory")
  .option("--burn", "Burn generated subtitles directly into output video (hardsub)", false)
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
      const options = cmd.optsWithGlobals<ProcessMediaOptions>();
      if (!mediaFile) {
        program.help();
        return;
      }

      try {
        await processMediaPipeline({
          ...options,
          mediaFile,
        });
      } catch (error) {
        console.error(
          pc.red(
            `\n✖ 処理中にエラーが発生しました: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
        if (options.verbose && error instanceof Error && error.stack) {
          console.error(error.stack);
        }
        process.exit(1);
      }
    },
  );

program.parse(process.argv);
