import fs from "node:fs";
import path from "node:path";
import pc from "picocolors";
import { loadMediaCache } from "./cache.js";
import { ensureApiKeys, getConfig } from "./config.js";
import { formatEntries, parseOutputFormats } from "./formatter.js";
import { DEFAULT_LANGUAGE, getI18n, normalizeLanguage } from "./i18n/index.js";
import { parseTargetLanguages, resolveTargetLang } from "./languages.js";
import { parseBilingualOrder, resolveOutputFilePaths } from "./pipeline.js";
import { ensureWritableTargets } from "./safety.js";
import { mergeBilingualEntries, parseSrt, reflowSrtEntries } from "./srt.js";
import { createGeminiTextModel, resolveGeminiModel } from "./text/gemini.js";
import { resolveConcurrency, resolveContextWindowSize, translateToTargets } from "./translation.js";
import { createSpinner, formatSummaryBox } from "./ui.js";
import { notifyUpdateIfAvailable } from "./updater.js";

export interface TranslateCommandOptions {
  targetLang?: string | undefined;
  format: string;
  output?: string | undefined;
  stdout?: boolean | undefined;
  overwrite?: boolean | undefined;
  backup?: boolean | undefined;
  bilingual?: boolean | undefined;
  bilingualOrder?: string | undefined;
  prompt?: string | undefined;
  glossary?: string | undefined;
  concurrency?: string | undefined;
  geminiModel?: string | undefined;
  noCache?: boolean | undefined;
  fresh?: boolean | undefined;
  cacheDir?: string | undefined;
  contextWindow?: string | undefined;
  geminiKey?: string | undefined;
  maxLength?: string | undefined;
  maxDuration?: string | undefined;
  noReflow?: boolean | undefined;
  verbose?: boolean | undefined;
  lang?: string | undefined;
  noUpdateCheck?: boolean | undefined;
}

export async function runTranslateCommand(
  subtitleFile: string,
  options: TranslateCommandOptions,
): Promise<void> {
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
    const outputFormats = parseOutputFormats(options.format, lang);
    const targetLanguages = parseTargetLanguages(
      resolveTargetLang(options.targetLang, rawConfig.targetLang),
      lang,
    );

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

    const geminiModel = resolveGeminiModel(options.geminiModel, config);

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
    const subtitleCache = useCache ? loadMediaCache(resolvedSubtitlePath, options.cacheDir) : null;

    const translationPrompt = options.prompt?.trim() || config.prompt;
    const glossaryInput = options.glossary?.trim() || config.glossary;
    const resolvedConcurrency = resolveConcurrency(options.concurrency, config.concurrency);
    const resolvedContextWindow = resolveContextWindowSize(options.contextWindow);

    const translationResult = await translateToTargets({
      sourceEntries: srtEntries,
      targetLanguages,
      cacheFilePath: resolvedSubtitlePath,
      mediaCache: subtitleCache,
      useCache,
      noCache: Boolean(options.noCache),
      cacheDir: options.cacheDir,
      prompt: translationPrompt,
      glossaryInput,
      contextWindowSize: resolvedContextWindow,
      concurrency: resolvedConcurrency,
      modelName: geminiModel,
      getTextModel: async () => createGeminiTextModel(config.geminiApiKey, geminiModel),
      messages: {
        translatingSingle: tm.step2TranslatingSingle,
        translatingMulti: tm.step2TranslatingMulti,
      },
      spinner,
      prefix: "",
      verbose,
      lang: normalizeLanguage(lang) ?? DEFAULT_LANGUAGE,
    });

    const langListDisplay = targetLanguages.map((l) => l.toUpperCase()).join(", ");
    spinner.succeed(tm.step2Done(langListDisplay, srtEntries.length));

    // 3. Save output subtitle files or write to stdout
    if (isStdout) {
      const tLang = targetLanguages[0] ?? "ja";
      let entries = translationResult.resultsByLang.get(tLang) ?? srtEntries;
      if (isBilingual) {
        entries = mergeBilingualEntries(srtEntries, entries, { order: bilingualOrder });
      }
      const fmt = outputFormats[0] ?? "srt";
      const formatted = formatEntries(entries, fmt);
      process.stdout.write(formatted.endsWith("\n") ? formatted : `${formatted}\n`);
    } else {
      spinner.start(tm.step3Saving);

      for (const tLang of targetLanguages) {
        let entries = translationResult.resultsByLang.get(tLang) ?? srtEntries;
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
              glossaryTermsCount:
                translationResult.totalGlossaryTerms > 0
                  ? translationResult.totalGlossaryTerms
                  : undefined,
              geminiModel,
              cacheStatus:
                translationResult.cachedLanguages.length > 0
                  ? { cachedLanguages: translationResult.cachedLanguages }
                  : undefined,
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
}
