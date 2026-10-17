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
import { formatEntries, parseOutputFormats } from "./formatter.js";
import { translateSrtEntries } from "./gemini.js";
import { computeGlossaryHash, parseGlossary } from "./glossary.js";
import { getI18n, normalizeLanguage } from "./i18n/index.js";
import { runInitWizard } from "./init.js";
import { parseTargetLanguages } from "./languages.js";
import { printLicenses } from "./licenses.js";
import {
  type ProcessMediaOptions,
  parseBilingualOrder,
  processMediaPipeline,
  resolveOutputFilePaths,
} from "./pipeline.js";
import { ensureWritableTargets } from "./safety.js";
import { mergeBilingualEntries, parseSrt, reflowSrtEntries, type SrtEntry } from "./srt.js";
import { createSpinner, formatFileSize, formatSummaryBox } from "./ui.js";
import {
  checkUpdate,
  cleanOldBinaries,
  formatSelfUpdateSummary,
  formatUpdateNotification,
  isStandaloneBinary,
  notifyUpdateIfAvailable,
  performSelfUpdate,
} from "./updater.js";
import { getCurrentVersion } from "./version.js";

// Clean any leftover .old binaries from prior self-updates
cleanOldBinaries(path.dirname(process.execPath));

const program = new Command();

program
  .name("vsub")
  .version(getCurrentVersion())
  .description(
    "CLI tool to extract audio from video/audio files, transcribe speech via Groq API, and generate multilingual subtitles (.srt, .vtt, .txt, .json) via Gemini API.",
  )
  .option("-l, --lang <lang>", "UI display language (en, ja)")
  .option("--no-update-check", "Disable checking for new version updates", false);

// Subcommand: update / upgrade
program
  .command("update")
  .alias("upgrade")
  .description("Update vsub-cli standalone binary to the latest release")
  .option("-f, --force", "Force re-install even if already on the latest version", false)
  .option("--check", "Check for updates without downloading or installing", false)
  .option("--verbose", "Output detailed logs", false)
  .action(
    async (options: { force?: boolean; check?: boolean; verbose?: boolean }, cmd: Command) => {
      const globals = cmd.optsWithGlobals<{ lang?: string }>();
      const rawConfig = getConfig(undefined, globals.lang);
      const lang = globals.lang ?? rawConfig.lang ?? "en";
      const i18n = getI18n(lang);
      const m = i18n.update;

      // Check if running in npm/Node.js environment
      if (!isStandaloneBinary()) {
        console.log(`\n${pc.yellow(`💡 ${m.npmEnvNotice}`)}`);
        console.log(pc.cyan(`   ${m.npmEnvUpdateHint("npm i -g vsub-cli@latest")}\n`));
        return;
      }

      if (options.check) {
        const spinner = createSpinner(m.checking, { isSilent: options.verbose });
        spinner.start();
        const checkResult = await checkUpdate({ force: true });
        if (checkResult?.updateAvailable) {
          spinner.info(
            `v${checkResult.latestVersion} available (current: v${checkResult.currentVersion})`,
          );
          console.log(`\n${formatUpdateNotification(checkResult, lang)}\n`);
        } else {
          spinner.succeed(m.alreadyLatest(getCurrentVersion()));
        }
        return;
      }

      const spinner = createSpinner(m.checking, { isSilent: options.verbose });
      spinner.start();

      try {
        const result = await performSelfUpdate({
          force: options.force,
          lang,
        });

        if (result.alreadyLatest) {
          spinner.succeed(m.alreadyLatest(result.previousVersion));
          return;
        }

        spinner.succeed(m.successTitle);
        console.log(`\n${formatSelfUpdateSummary(result, lang)}\n`);
      } catch (err: unknown) {
        spinner.fail(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    },
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
    console.log(`Display Language: ${resolvedConfig.lang || "en"}`);
    console.log(
      `Groq API Key    : ${resolvedConfig.groqApiKey ? `${resolvedConfig.groqApiKey.slice(0, 4)}...${resolvedConfig.groqApiKey.slice(-4)}` : "(Not configured)"}`,
    );
    console.log(
      `Gemini API Key  : ${resolvedConfig.geminiApiKey ? `${resolvedConfig.geminiApiKey.slice(0, 4)}...${resolvedConfig.geminiApiKey.slice(-4)}` : "(Not configured)"}`,
    );
    console.log(`FFmpeg Path     : ${resolvedConfig.ffmpegPath}`);
    if (resolvedConfig.whisperPrompt) {
      console.log(`Whisper Prompt  : "${resolvedConfig.whisperPrompt}"`);
    }
    if (resolvedConfig.prompt) {
      console.log(`Translate Prompt : "${resolvedConfig.prompt}"`);
    }
    if (resolvedConfig.glossary) {
      console.log(`Glossary        : "${resolvedConfig.glossary}"`);
    }
    if (resolvedConfig.geminiModel) {
      console.log(`Gemini Model    : ${resolvedConfig.geminiModel}`);
    }
    if (resolvedConfig.groqModel) {
      console.log(`Groq Model      : ${resolvedConfig.groqModel}`);
    }
    if (resolvedConfig.maxLength) {
      console.log(`Max Length      : ${resolvedConfig.maxLength} chars`);
    }
    console.log(`Update Check    : ${resolvedConfig.disableUpdateCheck ? "Disabled" : "Enabled"}`);
    console.log("----------------------------------------\n");
  });

configCmd
  .command("set")
  .description(
    "Save API Keys, models, prompts, glossary, concurrency, language, or FFmpeg path to global config",
  )
  .option("-l, --lang <lang>", "UI display language (en, ja)")
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
  .option("--disable-update-check <boolean>", "Disable periodic update checks (true/false)")
  .option("--max-length <chars>", "Default max characters per subtitle entry (e.g. 60)")
  .action(
    (options: {
      lang?: string;
      groqKey?: string;
      geminiKey?: string;
      ffmpegPath?: string;
      geminiModel?: string;
      groqModel?: string;
      whisperPrompt?: string;
      prompt?: string;
      glossary?: string;
      concurrency?: string;
      disableUpdateCheck?: string;
      maxLength?: string;
    }) => {
      let concurrencyNum: number | undefined;
      if (options.concurrency) {
        const n = Number(options.concurrency);
        if (!Number.isNaN(n) && n > 0) {
          concurrencyNum = Math.floor(n);
        }
      }

      let disableUpdateCheckVal: boolean | undefined;
      if (options.disableUpdateCheck !== undefined) {
        const val = String(options.disableUpdateCheck).toLowerCase();
        disableUpdateCheckVal = val === "true" || val === "1";
      }

      let maxLengthNum: number | undefined;
      if (options.maxLength) {
        const n = Number(options.maxLength);
        if (!Number.isNaN(n) && n > 0) {
          maxLengthNum = Math.floor(n);
        }
      }

      const normalizedLang = options.lang ? normalizeLanguage(options.lang) : undefined;
      if (options.lang && !normalizedLang) {
        console.error(
          pc.red(
            `\n✖ Invalid display language: "${options.lang}". Supported languages: "en", "ja"\n`,
          ),
        );
        process.exit(1);
      }

      if (
        !options.lang &&
        !options.groqKey &&
        !options.geminiKey &&
        !options.ffmpegPath &&
        !options.geminiModel &&
        !options.groqModel &&
        !options.whisperPrompt &&
        !options.prompt &&
        !options.glossary &&
        concurrencyNum === undefined &&
        disableUpdateCheckVal === undefined &&
        maxLengthNum === undefined
      ) {
        console.log(
          "⚠️ Please specify settings to save. (Example: vsub config set --gemini-model gemini-3.8-flash)",
        );
        return;
      }

      saveGlobalConfig({
        ...(normalizedLang ? { lang: normalizedLang } : {}),
        ...(options.groqKey ? { groqApiKey: options.groqKey.trim() } : {}),
        ...(options.geminiKey ? { geminiApiKey: options.geminiKey.trim() } : {}),
        ...(options.ffmpegPath ? { ffmpegPath: options.ffmpegPath.trim() } : {}),
        ...(options.geminiModel ? { geminiModel: options.geminiModel.trim() } : {}),
        ...(options.groqModel ? { groqModel: options.groqModel.trim() } : {}),
        ...(options.whisperPrompt ? { whisperPrompt: options.whisperPrompt.trim() } : {}),
        ...(options.prompt ? { prompt: options.prompt.trim() } : {}),
        ...(options.glossary ? { glossary: options.glossary.trim() } : {}),
        ...(concurrencyNum !== undefined ? { concurrency: concurrencyNum } : {}),
        ...(disableUpdateCheckVal !== undefined
          ? { disableUpdateCheck: disableUpdateCheckVal }
          : {}),
        ...(maxLengthNum !== undefined ? { maxLength: maxLengthNum } : {}),
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
  .option(
    "--context-window <lines>",
    "Number of preceding context lines to carry across translation chunks (0 to disable)",
    "5",
  )
  .option("--gemini-key <key>", "Gemini API Key override")
  .option("--max-length <chars>", "Max characters per subtitle entry before automatic splitting")
  .option(
    "--max-duration <seconds>",
    "Max display duration in seconds per subtitle entry (default: 7)",
  )
  .option(
    "--no-reflow",
    "Disable automatic splitting and reflowing of long subtitle segments",
    false,
  )
  .option(
    "--stdout",
    "Output translated subtitles directly to stdout instead of saving to file",
    false,
  )
  .option("--verbose", "Output detailed log messages", false)
  .action(async (subtitleFile: string, _actionOptions: Record<string, unknown>, cmd: Command) => {
    const options = cmd.optsWithGlobals<{
      targetLang: string;
      format: string;
      output?: string;
      stdout?: boolean;
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
      contextWindow?: string;
      geminiKey?: string;
      maxLength?: string;
      maxDuration?: string;
      noReflow?: boolean;
      verbose?: boolean;
      lang?: string;
      noUpdateCheck?: boolean;
    }>();
    const startTime = Date.now();
    const verbose = Boolean(options.verbose);
    const isStdout = Boolean(options.stdout || options.output === "-");
    const rawConfig = getConfig(undefined, options.lang);
    const lang = options.lang ?? rawConfig.lang ?? "en";
    const i18n = getI18n(lang);
    const tm = i18n.translate;

    const spinner = createSpinner("", {
      isSilent: verbose,
      stream: isStdout ? process.stderr : undefined,
    });
    const outputFiles: string[] = [];

    try {
      const outputFormats = parseOutputFormats(options.format);
      const targetLanguages = parseTargetLanguages(options.targetLang);

      if (isStdout) {
        if (outputFormats.length > 1) {
          throw new Error(tm.stdoutSingleFormatOnly);
        }
        if (targetLanguages.length > 1) {
          throw new Error(tm.stdoutSingleLangOnly);
        }
      }

      const isMultiLang = targetLanguages.length > 1;
      const isBilingual = Boolean(options.bilingual);
      const bilingualOrder = parseBilingualOrder(options.bilingualOrder, lang);
      const resolvedSubtitlePath = path.resolve(process.cwd(), subtitleFile);

      if (!fs.existsSync(resolvedSubtitlePath)) {
        throw new Error(tm.subtitleNotFound(resolvedSubtitlePath));
      }

      const subDir = path.dirname(resolvedSubtitlePath);
      const subExt = path.extname(resolvedSubtitlePath);
      let subBaseName = path.basename(resolvedSubtitlePath, subExt);

      // If base name ends with language tag like .en, .ja, strip it to avoid .en.ja
      const langSuffixMatch = subBaseName.match(/^(.+)\.([a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,4})?)$/);
      if (langSuffixMatch?.[1]) {
        subBaseName = langSuffixMatch[1];
      }

      // Pre-check output file safety before performing API calls (skipped in stdout mode)
      const safetyCheck: { proceed: boolean; backedUp: { original: string; backup: string }[] } =
        isStdout
          ? { proceed: true, backedUp: [] }
          : await (async () => {
              const targets: string[] = [];
              for (const tLang of targetLanguages) {
                const resolved = resolveOutputFilePaths(
                  subDir,
                  subBaseName,
                  tLang,
                  outputFormats,
                  options.output,
                  !isMultiLang,
                  isBilingual,
                );
                for (const { filePath } of resolved) {
                  targets.push(filePath);
                }
              }
              return ensureWritableTargets(targets, {
                overwrite: options.overwrite,
                backup: options.backup,
                lang: normalizeLanguage(lang),
              });
            })();

      if (!safetyCheck.proceed) {
        console.log(i18n.safety.aborted);
        return;
      }

      if (safetyCheck.backedUp.length > 0) {
        for (const { original, backup } of safetyCheck.backedUp) {
          console.log(
            `📦 ${i18n.pipeline.backupCreated(pc.cyan(path.basename(original)), pc.yellow(path.basename(backup)))}`,
          );
        }
      }

      if (options.geminiKey) {
        rawConfig.geminiApiKey = options.geminiKey.trim();
      }

      // Ensure Gemini API key (Groq key not required for translate subcommand)
      const config = await ensureApiKeys(rawConfig, {
        requireGroq: false,
        requireGemini: true,
        lang: normalizeLanguage(lang),
      });

      const geminiModel = options.geminiModel?.trim() || config.geminiModel;

      if (!isStdout) {
        console.log(`\n🌐 ${pc.bold(tm.started(pc.cyan(path.basename(resolvedSubtitlePath))))}`);
      }

      // 1. Read and parse subtitle file
      spinner.start(tm.step1Parsing);
      const fileContent = fs.readFileSync(resolvedSubtitlePath, "utf-8");
      let srtEntries = parseSrt(fileContent);

      if (srtEntries.length === 0) {
        throw new Error(tm.step1NoEntries(path.basename(resolvedSubtitlePath)));
      }

      const maxLengthVal = options.maxLength !== undefined ? Number(options.maxLength) : undefined;
      const resolvedMaxLength =
        maxLengthVal !== undefined && !Number.isNaN(maxLengthVal) && maxLengthVal > 0
          ? Math.floor(maxLengthVal)
          : rawConfig.maxLength;

      const maxDurationVal =
        options.maxDuration !== undefined ? Number(options.maxDuration) : undefined;
      const resolvedMaxDuration =
        maxDurationVal !== undefined && !Number.isNaN(maxDurationVal) && maxDurationVal > 0
          ? Math.floor(maxDurationVal)
          : undefined;

      const rawEntriesCount = srtEntries.length;
      if (!options.noReflow && srtEntries.length > 0) {
        srtEntries = reflowSrtEntries(srtEntries, {
          maxLength: resolvedMaxLength,
          maxDuration: resolvedMaxDuration,
        });
        if (verbose && srtEntries.length !== rawEntriesCount) {
          console.log(
            `[Reflow] Adjusted subtitle segments: ${rawEntriesCount} -> ${srtEntries.length} entries`,
          );
        }
      }

      spinner.succeed(tm.step1Parsed(srtEntries.length));

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
      const contextWindowVal =
        options.contextWindow !== undefined ? Number(options.contextWindow) : undefined;
      const resolvedContextWindow =
        contextWindowVal !== undefined && !Number.isNaN(contextWindowVal)
          ? Math.max(0, Math.floor(contextWindowVal))
          : undefined;
      let totalGlossaryTerms = 0;

      for (let i = 0; i < targetLanguages.length; i++) {
        const tLang = targetLanguages[i] ?? "ja";
        const glossaryMap = glossaryInput ? parseGlossary(glossaryInput, tLang) : undefined;
        const glossaryHash = glossaryMap ? computeGlossaryHash(glossaryMap) : undefined;
        if (glossaryMap) {
          totalGlossaryTerms = Math.max(totalGlossaryTerms, Object.keys(glossaryMap).length);
        }

        const cachedTranslation = subtitleCache?.translations?.[tLang.toLowerCase()];
        const isCacheValid =
          useCache &&
          isTranslationCacheValid(
            cachedTranslation,
            translationPrompt,
            glossaryHash,
            geminiModel,
          ) &&
          cachedTranslation?.entries.length === srtEntries.length;

        if (isCacheValid && cachedTranslation && cachedTranslation.entries.length > 0) {
          resultsByLang.set(tLang, cachedTranslation.entries);
          cachedLanguages.push(tLang);
          if (isMultiLang) {
            spinner.info(
              i18n.pipeline.step3Cached(tLang.toUpperCase(), cachedTranslation.entries.length),
            );
          }
          continue;
        }

        const effectiveGeminiModel = geminiModel || DEFAULT_GEMINI_MODEL;
        const initialText = isMultiLang
          ? tm.step2TranslatingMulti(
              effectiveGeminiModel,
              i + 1,
              targetLanguages.length,
              tLang.toUpperCase(),
              1,
              totalChunks,
            )
          : tm.step2TranslatingSingle(effectiveGeminiModel, tLang, 1, totalChunks);

        spinner.start(initialText);

        const translatedEntries = await translateSrtEntries(
          srtEntries,
          tLang,
          config.geminiApiKey,
          verbose,
          (currentChunk, chunksCount) => {
            if (isMultiLang) {
              spinner.updateText(
                tm.step2TranslatingMulti(
                  effectiveGeminiModel,
                  i + 1,
                  targetLanguages.length,
                  tLang.toUpperCase(),
                  currentChunk,
                  chunksCount,
                ),
              );
            } else {
              spinner.updateText(
                tm.step2TranslatingSingle(effectiveGeminiModel, tLang, currentChunk, chunksCount),
              );
            }
          },
          {
            prompt: translationPrompt,
            glossary: glossaryMap,
            concurrency: resolvedConcurrency,
            model: geminiModel,
            lang: normalizeLanguage(lang),
            contextWindowSize: resolvedContextWindow,
          },
        );

        resultsByLang.set(tLang, translatedEntries);

        // Save translation result to cache
        if (!options.noCache) {
          saveTranslationCache(
            resolvedSubtitlePath,
            tLang,
            {
              targetLang: tLang,
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
          spinner.info(i18n.pipeline.step3LangDone(tLang.toUpperCase(), translatedEntries.length));
        }
      }

      const langListDisplay = targetLanguages.map((l) => l.toUpperCase()).join(", ");
      spinner.succeed(tm.step2Done(langListDisplay, srtEntries.length));

      // 3. Save output subtitle files or write to stdout
      if (isStdout) {
        const tLang = targetLanguages[0] ?? "ja";
        let entries = resultsByLang.get(tLang) ?? srtEntries;
        if (isBilingual) {
          entries = mergeBilingualEntries(srtEntries, entries, { order: bilingualOrder });
        }
        const fmt = outputFormats[0] ?? "srt";
        const formatted = formatEntries(entries, fmt);
        process.stdout.write(formatted.endsWith("\n") ? formatted : `${formatted}\n`);
      } else {
        spinner.start(tm.step3Saving);

        for (const tLang of targetLanguages) {
          let entries = resultsByLang.get(tLang) ?? srtEntries;
          if (isBilingual) {
            entries = mergeBilingualEntries(srtEntries, entries, { order: bilingualOrder });
          }
          const targets = resolveOutputFilePaths(
            subDir,
            subBaseName,
            tLang,
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
        spinner.succeed(tm.step3Saved(formatListStr));

        // 4. Output Summary Box
        const durationMs = Date.now() - startTime;
        console.log(
          "\n" +
            formatSummaryBox(
              {
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
                lang: normalizeLanguage(lang),
              },
              lang,
            ) +
            "\n",
        );

        await notifyUpdateIfAvailable({
          lang: normalizeLanguage(lang),
          disableUpdateCheck: Boolean(options.noUpdateCheck || rawConfig.disableUpdateCheck),
        });
      }
    } catch (error) {
      spinner.fail(
        i18n.pipeline.errorOccurred(error instanceof Error ? error.message : String(error)),
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
        lang?: string;
        noUpdateCheck?: boolean;
      }>();
      const startTime = Date.now();
      const verbose = Boolean(options.verbose);
      const rawConfig = getConfig(options.ffmpegPath, options.lang);
      const lang = options.lang ?? rawConfig.lang ?? "en";
      const i18n = getI18n(lang);
      const bm = i18n.burn;

      const spinner = createSpinner("", { isSilent: verbose });

      try {
        const resolvedVideoPath = path.resolve(process.cwd(), videoFile);
        const resolvedSubtitlePath = path.resolve(process.cwd(), subtitleFile);

        if (!fs.existsSync(resolvedVideoPath)) {
          throw new Error(bm.videoNotFound(resolvedVideoPath));
        }
        if (!isVideoFile(resolvedVideoPath)) {
          throw new Error(bm.notVideoFile(path.basename(resolvedVideoPath)));
        }
        if (!fs.existsSync(resolvedSubtitlePath)) {
          throw new Error(bm.subtitleNotFound(resolvedSubtitlePath));
        }

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
          lang: normalizeLanguage(lang),
        });

        if (!safetyCheck.proceed) {
          console.log(i18n.safety.aborted);
          return;
        }

        if (safetyCheck.backedUp.length > 0) {
          for (const { original, backup } of safetyCheck.backedUp) {
            console.log(
              `📦 ${i18n.pipeline.backupCreated(pc.cyan(path.basename(original)), pc.yellow(path.basename(backup)))}`,
            );
          }
        }

        console.log(
          `\n🎬 ${pc.bold(bm.started(pc.cyan(path.basename(resolvedVideoPath)), pc.cyan(path.basename(resolvedSubtitlePath))))}`,
        );

        spinner.start(i18n.pipeline.burnStarting);
        await burnSubtitlesToVideo(resolvedVideoPath, resolvedSubtitlePath, resolvedOutputPath, {
          ffmpegPath: rawConfig.ffmpegPath,
          verbose,
        });
        spinner.succeed(i18n.pipeline.burnDone);

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
            formatSummaryBox(
              {
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
                lang: normalizeLanguage(lang),
              },
              lang,
            ) +
            "\n",
        );

        await notifyUpdateIfAvailable({
          lang: normalizeLanguage(lang),
          disableUpdateCheck: Boolean(options.noUpdateCheck || rawConfig.disableUpdateCheck),
        });
      } catch (error) {
        spinner.fail(
          i18n.pipeline.errorOccurred(error instanceof Error ? error.message : String(error)),
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
  .option(
    "--context-window <lines>",
    "Number of preceding context lines to carry across translation chunks (0 to disable)",
    "5",
  )
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
  .option("--max-length <chars>", "Max characters per subtitle entry before automatic splitting")
  .option(
    "--max-duration <seconds>",
    "Max display duration in seconds per subtitle entry (default: 7)",
  )
  .option(
    "--no-reflow",
    "Disable automatic splitting and reflowing of long subtitle segments",
    false,
  )
  .option("--verbose", "Output detailed log messages", false)
  .action(async (targets: string[], _actionOptions: Record<string, unknown>, cmd: Command) => {
    const options = cmd.optsWithGlobals<
      BatchPipelineOptions & {
        format: string;
        targetLang: string;
        lang?: string;
        noUpdateCheck?: boolean;
      }
    >();
    const rawConfig = getConfig(options.ffmpegPath, options.lang);
    const lang = options.lang ?? rawConfig.lang ?? "en";
    const i18n = getI18n(lang);

    try {
      const summary = await runBatchPipeline({
        ...options,
        lang: normalizeLanguage(lang),
        targets,
      });
      if (summary.failedCount > 0) {
        process.exit(1);
      }

      await notifyUpdateIfAvailable({
        lang: normalizeLanguage(lang),
        disableUpdateCheck: Boolean(options.noUpdateCheck || rawConfig.disableUpdateCheck),
      });
    } catch (error) {
      console.error(
        pc.red(
          `\n✖ ${i18n.batch.fatalError(error instanceof Error ? error.message : String(error))}`,
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
  .option(
    "--context-window <lines>",
    "Number of preceding context lines to carry across translation chunks (0 to disable)",
    "5",
  )
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
  .option("--max-length <chars>", "Max characters per subtitle entry before automatic splitting")
  .option(
    "--max-duration <seconds>",
    "Max display duration in seconds per subtitle entry (default: 7)",
  )
  .option(
    "--no-reflow",
    "Disable automatic splitting and reflowing of long subtitle segments",
    false,
  )
  .option("--stdout", "Output subtitles directly to stdout instead of saving to file", false)
  .option("--verbose", "Output detailed log messages", false)
  .action(
    async (
      mediaFile: string | undefined,
      _actionOptions: Record<string, unknown>,
      cmd: Command,
    ) => {
      const options = cmd.optsWithGlobals<
        ProcessMediaOptions & { lang?: string; noUpdateCheck?: boolean }
      >();
      const rawConfig = getConfig(options.ffmpegPath, options.lang);
      const lang = options.lang ?? rawConfig.lang ?? "en";
      const i18n = getI18n(lang);

      if (!mediaFile) {
        program.help();
        return;
      }

      const isStdout = Boolean(options.stdout || options.output === "-");

      try {
        const result = await processMediaPipeline({
          ...options,
          stdout: isStdout,
          lang: normalizeLanguage(lang),
          mediaFile,
        });

        if (result.stdoutContent !== undefined) {
          process.stdout.write(
            result.stdoutContent.endsWith("\n")
              ? result.stdoutContent
              : `${result.stdoutContent}\n`,
          );
        }

        if (!isStdout) {
          await notifyUpdateIfAvailable({
            lang: normalizeLanguage(lang),
            disableUpdateCheck: Boolean(options.noUpdateCheck || rawConfig.disableUpdateCheck),
          });
        }
      } catch (error) {
        console.error(
          pc.red(
            `\n✖ ${i18n.pipeline.errorOccurred(error instanceof Error ? error.message : String(error))}`,
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
