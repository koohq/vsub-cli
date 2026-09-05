import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pc from "picocolors";
import {
  isTranscriptionCacheValid,
  isTranslationCacheValid,
  loadMediaCache,
  saveTranscriptionCache,
  saveTranslationCache,
} from "./cache.js";
import { DEFAULT_GEMINI_MODEL, DEFAULT_GROQ_MODEL, ensureApiKeys, getConfig } from "./config.js";
import { burnSubtitlesToVideo, checkFfmpeg, extractAudio, isAudioFile } from "./ffmpeg.js";
import { formatEntries, type OutputFormat, parseOutputFormats } from "./formatter.js";
import { translateSrtEntries } from "./gemini.js";
import { computeGlossaryHash, extractWhisperPromptHints, parseGlossary } from "./glossary.js";
import { transcribeAudioSegments } from "./groq.js";
import { getI18n, type SupportedLanguage } from "./i18n/index.js";
import { parseTargetLanguages } from "./languages.js";
import { ensureWritableTargets } from "./safety.js";
import type { BilingualOrder, SrtEntry } from "./srt.js";
import { mergeBilingualEntries } from "./srt.js";
import { createSpinner, formatFileSize, formatSummaryBox } from "./ui.js";

/**
 * Validates and normalizes bilingual order option.
 */
export function parseBilingualOrder(
  input?: string,
  lang?: SupportedLanguage | string,
): BilingualOrder {
  if (!input) return "original-first";
  const normalized = input.trim().toLowerCase();
  if (normalized === "original-first" || normalized === "target-first") {
    return normalized;
  }
  const i18n = getI18n(lang);
  throw new Error(i18n.pipeline.invalidBilingualOrder(input));
}

/**
 * Resolves destination file paths for output formats, handling single-language and multi-language naming.
 */
export function resolveOutputFilePaths(
  baseDir: string,
  baseName: string,
  lang: string,
  formats: OutputFormat[],
  outputOption?: string,
  isSingleLanguage = true,
  isBilingual = false,
  outputDir?: string,
): { format: OutputFormat; filePath: string }[] {
  const langTag = isBilingual ? `${lang}.bilingual` : lang;
  const effectiveBaseDir = outputDir ? path.resolve(process.cwd(), outputDir) : baseDir;

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
    filePath: path.join(effectiveBaseDir, `${baseName}.${langTag}.${fmt}`),
  }));
}

export interface ProcessMediaOptions {
  mediaFile: string;
  targetLang?: string | undefined;
  format?: string | undefined;
  output?: string | undefined;
  outputDir?: string | undefined;
  overwrite?: boolean | undefined;
  backup?: boolean | undefined;
  bilingual?: boolean | undefined;
  bilingualOrder?: string | undefined;
  ffmpegPath?: string | undefined;
  geminiModel?: string | undefined;
  groqModel?: string | undefined;
  whisperPrompt?: string | undefined;
  prompt?: string | undefined;
  glossary?: string | undefined;
  concurrency?: string | number | undefined;
  noCache?: boolean | undefined;
  fresh?: boolean | undefined;
  cacheDir?: string | undefined;
  burn?: boolean | undefined;
  keepAudio?: boolean | undefined;
  noTranslate?: boolean | undefined;
  saveOriginal?: boolean | undefined;
  forceTranslate?: boolean | undefined;
  verbose?: boolean | undefined;
  silentSummary?: boolean | undefined;
  logPrefix?: string | undefined;
  lang?: SupportedLanguage | undefined;
}

export interface ProcessMediaResult {
  mediaFile: string;
  mediaType: "video" | "audio";
  durationMs: number;
  audioSegmentsCount?: number | undefined;
  audioTotalBytes?: number | undefined;
  detectedLanguage?: string | undefined;
  targetLanguages: string[];
  entriesCount: number;
  outputFiles: string[];
  skippedTranslation?: boolean | undefined;
  skippedLanguages?: string[] | undefined;
  whisperPrompt?: string | undefined;
  prompt?: string | undefined;
  glossaryTermsCount?: number | undefined;
  bilingual?: boolean | { order?: string | undefined } | undefined;
  backedUpFiles?: string[] | undefined;
  groqModel?: string | undefined;
  geminiModel?: string | undefined;
  cacheStatus?:
    | {
        transcriptionHit?: boolean | undefined;
        cachedLanguages?: string[] | undefined;
      }
    | undefined;
}

/**
 * Executes the complete media transcription and translation pipeline for a single file.
 */
export async function processMediaPipeline(
  options: ProcessMediaOptions,
): Promise<ProcessMediaResult> {
  const startTime = Date.now();
  const verbose = Boolean(options.verbose);
  const prefix = options.logPrefix ? `${options.logPrefix} ` : "";
  const spinner = createSpinner("", { isSilent: verbose });
  const outputFiles: string[] = [];

  const rawConfig = getConfig(options.ffmpegPath, options.lang);
  const lang = options.lang ?? rawConfig.lang ?? "en";
  const i18n = getI18n(lang);
  const m = i18n.pipeline;

  const outputFormats = parseOutputFormats(options.format || "srt");
  const targetLanguages = parseTargetLanguages(options.targetLang || "ja");
  const isMultiLang = targetLanguages.length > 1;
  const isBilingual = Boolean(options.bilingual);
  const bilingualOrder = parseBilingualOrder(options.bilingualOrder, lang);
  const resolvedMediaPath = path.resolve(process.cwd(), options.mediaFile);

  if (!fs.existsSync(resolvedMediaPath)) {
    throw new Error(m.mediaNotFound(resolvedMediaPath));
  }

  const mediaDir = path.dirname(resolvedMediaPath);
  const mediaExt = path.extname(resolvedMediaPath);
  const mediaBaseName = path.basename(resolvedMediaPath, mediaExt);

  // If outputDir is specified, ensure it exists
  const effectiveOutputDir = options.outputDir
    ? path.resolve(process.cwd(), options.outputDir)
    : mediaDir;
  if (options.outputDir && !fs.existsSync(effectiveOutputDir)) {
    fs.mkdirSync(effectiveOutputDir, { recursive: true });
  }

  // Pre-check output file safety before expensive operations
  const predictedTargets: string[] = [];
  for (const targetL of targetLanguages) {
    const targets = resolveOutputFilePaths(
      mediaDir,
      mediaBaseName,
      targetL,
      outputFormats,
      options.output,
      !isMultiLang,
      isBilingual,
      options.outputDir,
    );
    for (const { filePath } of targets) {
      predictedTargets.push(filePath);
    }
  }

  if (options.burn) {
    for (const targetL of targetLanguages) {
      let burntVideoPath: string;
      const langTag = isBilingual ? `${targetL}.bilingual` : targetL;
      if (options.output) {
        const resolvedOut = path.resolve(process.cwd(), options.output);
        const parsedOut = path.parse(resolvedOut);
        if (isMultiLang) {
          burntVideoPath = path.join(parsedOut.dir, `${parsedOut.name}.${langTag}.subbed.mp4`);
        } else if (parsedOut.ext === ".mp4") {
          burntVideoPath = resolvedOut;
        } else {
          burntVideoPath = path.join(parsedOut.dir, `${parsedOut.name}.subbed.mp4`);
        }
      } else {
        burntVideoPath = path.join(effectiveOutputDir, `${mediaBaseName}.${langTag}.subbed.mp4`);
      }
      predictedTargets.push(burntVideoPath);
    }
  }

  const safetyCheck = await ensureWritableTargets(predictedTargets, {
    overwrite: options.overwrite,
    backup: options.backup,
    lang,
  });

  if (!safetyCheck.proceed) {
    throw new Error(m.conflictAbort);
  }

  if (safetyCheck.backedUp.length > 0) {
    for (const { original, backup } of safetyCheck.backedUp) {
      console.log(
        `${prefix}📦 ${m.backupCreated(pc.cyan(path.basename(original)), pc.yellow(path.basename(backup)))}`,
      );
    }
  }

  const groqModel = options.groqModel?.trim() || rawConfig.groqModel;
  const geminiModel = options.geminiModel?.trim() || rawConfig.geminiModel;

  const glossaryInput = options.glossary?.trim() || rawConfig.glossary;
  let whisperPrompt = options.whisperPrompt?.trim() || rawConfig.whisperPrompt;
  if (!whisperPrompt && glossaryInput) {
    whisperPrompt = extractWhisperPromptHints(glossaryInput);
  }

  const isAudio = isAudioFile(resolvedMediaPath);
  if (options.burn && isAudio) {
    throw new Error(m.cannotBurnAudio);
  }
  const mediaTypeName = isAudio ? "audio" : "video";
  const mediaIcon = isAudio ? "🎵" : "🎬";

  if (!options.silentSummary) {
    console.log(
      `\n${mediaIcon} ${pc.bold("vsub-cli")} - ${m.startProcessing(pc.cyan(path.basename(resolvedMediaPath)))}`,
    );
  }

  const useCache = !options.noCache && !options.fresh;
  const mediaCache = useCache ? loadMediaCache(resolvedMediaPath, options.cacheDir) : null;

  let srtEntries: SrtEntry[] = [];
  let detectedLanguage: string | undefined;
  let transcriptionCacheHit = false;
  let audioPaths: string[] = [];
  let totalAudioBytes = 0;
  let cleanupAudio: (() => Promise<void>) | null = null;

  const isTranscriptionCacheMatch =
    useCache && isTranscriptionCacheValid(mediaCache?.transcription, whisperPrompt, groqModel);

  if (isTranscriptionCacheMatch && mediaCache?.transcription) {
    transcriptionCacheHit = true;
    srtEntries = mediaCache.transcription.entries;
    detectedLanguage = mediaCache.transcription.detectedLanguage;

    const langDisplay = detectedLanguage ? ` (${detectedLanguage.toUpperCase()})` : "";
    spinner.info(`${prefix}${m.step1SkipCache}`);
    spinner.succeed(`${prefix}${m.step2UseCached(langDisplay, srtEntries.length)}`);
  } else {
    // Ensure Groq API Key and FFmpeg only when transcription is needed
    const config = await ensureApiKeys(rawConfig, {
      requireGroq: true,
      requireGemini: false,
    });
    await checkFfmpeg(config.ffmpegPath);

    // 1. Audio extraction / optimization
    const audioStartMsg = isAudio ? m.step1Optimizing : m.step1Extracting;
    spinner.start(`${prefix}${audioStartMsg}`);
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
    const audioDoneMsg = isAudio
      ? m.step1AudioOptimized(audioPaths.length, formatFileSize(totalAudioBytes))
      : m.step1AudioExtracted(audioPaths.length, formatFileSize(totalAudioBytes));
    spinner.succeed(`${prefix}${audioDoneMsg}`);

    // 2. Transcription with Groq
    const effectiveGroqModel = groqModel || DEFAULT_GROQ_MODEL;
    const initialGroqText = `${prefix}${m.step2Transcribing(
      effectiveGroqModel,
      audioPaths.length > 1 ? 1 : undefined,
      audioPaths.length > 1 ? audioPaths.length : undefined,
    )}`;
    spinner.start(initialGroqText);

    const transcriptResult = await transcribeAudioSegments(
      audioPaths,
      config.groqApiKey,
      verbose,
      (current, total) => {
        if (total > 1) {
          spinner.updateText(`${prefix}${m.step2Transcribing(effectiveGroqModel, current, total)}`);
        }
      },
      {
        model: groqModel,
        ...(whisperPrompt ? { prompt: whisperPrompt } : {}),
        ...(extractResult.durations ? { durations: extractResult.durations } : {}),
      },
    );

    srtEntries = transcriptResult.entries;
    detectedLanguage = transcriptResult.detectedLanguage;

    if (srtEntries.length === 0) {
      spinner.warn(`${prefix}${m.step2NoEntries}`);
    } else {
      const langDisplay = detectedLanguage ? ` (${detectedLanguage.toUpperCase()})` : "";
      spinner.succeed(`${prefix}${m.step2Done(langDisplay, srtEntries.length)}`);

      if (!options.noCache) {
        saveTranscriptionCache(
          resolvedMediaPath,
          {
            detectedLanguage,
            model: groqModel,
            prompt: whisperPrompt,
            entries: srtEntries,
            createdAt: Date.now(),
          },
          options.cacheDir,
        );
      }
    }
  }

  try {
    // Save original raw subtitles if requested
    if (options.saveOriginal && srtEntries.length > 0) {
      const rawLang = detectedLanguage || "raw";
      const baseOriginalName = `${mediaBaseName}.${rawLang}`;

      const originalTargets: string[] = [];
      for (const fmt of outputFormats) {
        originalTargets.push(path.join(effectiveOutputDir, `${baseOriginalName}.${fmt}`));
      }

      const rawSafety = await ensureWritableTargets(originalTargets, {
        overwrite: options.overwrite,
        backup: options.backup,
      });
      if (rawSafety.backedUp.length > 0) {
        safetyCheck.backedUp.push(...rawSafety.backedUp);
      }

      const savedOriginalNames: string[] = [];
      for (const fmt of outputFormats) {
        const originalFilename = `${baseOriginalName}.${fmt}`;
        const originalPath = path.join(effectiveOutputDir, originalFilename);
        fs.writeFileSync(originalPath, formatEntries(srtEntries, fmt), "utf-8");
        outputFiles.push(originalPath);
        savedOriginalNames.push(originalFilename);
      }
      spinner.info(`${prefix}📄 原文字幕を保存: ${savedOriginalNames.join(", ")}`);
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
      const targetL = targetLanguages[i] ?? "ja";
      const isSameLanguage = Boolean(
        detectedLanguage && detectedLanguage.toLowerCase() === targetL.toLowerCase(),
      );
      const shouldSkip =
        Boolean(options.noTranslate) || (isSameLanguage && !options.forceTranslate);

      if (shouldSkip) {
        skippedLanguages.push(targetL);
        resultsByLang.set(targetL, srtEntries);

        if (options.noTranslate) {
          spinner.info(`${prefix}ℹ️ [3/4] [--no-translate] ${targetL.toUpperCase()}`);
        } else if (isSameLanguage) {
          spinner.info(
            `${prefix}ℹ️ [3/4] ${m.step3SkippedSameLang(detectedLanguage?.toUpperCase() ?? "", targetL.toUpperCase())}`,
          );
        }
        continue;
      }

      const glossaryMap = glossaryInput ? parseGlossary(glossaryInput, targetL) : undefined;
      const glossaryHash = glossaryMap ? computeGlossaryHash(glossaryMap) : undefined;
      if (glossaryMap) {
        totalGlossaryTerms = Math.max(totalGlossaryTerms, Object.keys(glossaryMap).length);
      }

      const cachedTranslation = mediaCache?.translations?.[targetL.toLowerCase()];
      const isCacheValid =
        useCache &&
        isTranslationCacheValid(cachedTranslation, translationPrompt, glossaryHash, geminiModel);

      if (isCacheValid && cachedTranslation && cachedTranslation.entries.length > 0) {
        resultsByLang.set(targetL, cachedTranslation.entries);
        cachedLanguages.push(targetL);
        translatedLanguages.push(targetL);

        if (isMultiLang) {
          spinner.info(
            `${prefix}${m.step3Cached(targetL.toUpperCase(), cachedTranslation.entries.length)}`,
          );
        }
        continue;
      }

      if (!activeConfig) {
        activeConfig = await ensureApiKeys(rawConfig, {
          requireGroq: false,
          requireGemini: true,
        });
      }

      const concurrencyVal = options.concurrency
        ? Number(options.concurrency)
        : activeConfig.concurrency;
      const resolvedConcurrency =
        concurrencyVal && !Number.isNaN(concurrencyVal) && concurrencyVal > 0
          ? Math.floor(concurrencyVal)
          : undefined;

      const effectiveGeminiModel = geminiModel || DEFAULT_GEMINI_MODEL;
      const initialText = isMultiLang
        ? `${prefix}${m.step3TranslatingMulti(effectiveGeminiModel, i + 1, targetLanguages.length, targetL.toUpperCase(), 1, totalChunks)}`
        : `${prefix}${m.step3TranslatingSingle(effectiveGeminiModel, targetL, 1, totalChunks)}`;

      spinner.start(initialText);

      const translatedEntries = await translateSrtEntries(
        srtEntries,
        targetL,
        activeConfig.geminiApiKey,
        verbose,
        (currentChunk, chunksCount) => {
          if (isMultiLang) {
            spinner.updateText(
              `${prefix}${m.step3TranslatingMulti(effectiveGeminiModel, i + 1, targetLanguages.length, targetL.toUpperCase(), currentChunk, chunksCount)}`,
            );
          } else {
            spinner.updateText(
              `${prefix}${m.step3TranslatingSingle(effectiveGeminiModel, targetL, currentChunk, chunksCount)}`,
            );
          }
        },
        {
          prompt: translationPrompt,
          glossary: glossaryMap,
          concurrency: resolvedConcurrency,
          model: geminiModel,
          lang,
        },
      );

      resultsByLang.set(targetL, translatedEntries);
      translatedLanguages.push(targetL);

      if (!options.noCache) {
        saveTranslationCache(
          resolvedMediaPath,
          targetL,
          {
            targetLang: targetL,
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
        spinner.info(
          `${prefix}${m.step3LangDone(targetL.toUpperCase(), translatedEntries.length)}`,
        );
      }
    }

    if (translatedLanguages.length > 0) {
      const langListDisplay = translatedLanguages.map((l) => l.toUpperCase()).join(", ");
      spinner.succeed(`${prefix}${m.step3AllDone(langListDisplay, srtEntries.length)}`);
    }

    // 4. Save output subtitle files
    spinner.start(`${prefix}${m.step4Saving}`);

    const savedSrtPathsByLang = new Map<string, string>();
    const tempSrtFilesToCleanup: string[] = [];

    for (const targetL of targetLanguages) {
      let entries = resultsByLang.get(targetL) ?? srtEntries;
      if (isBilingual) {
        entries = mergeBilingualEntries(srtEntries, entries, { order: bilingualOrder });
      }
      const targets = resolveOutputFilePaths(
        mediaDir,
        mediaBaseName,
        targetL,
        outputFormats,
        options.output,
        !isMultiLang,
        isBilingual,
        options.outputDir,
      );
      for (const { format, filePath } of targets) {
        fs.writeFileSync(filePath, formatEntries(entries, format), "utf-8");
        outputFiles.push(filePath);
        if (format === "srt") {
          savedSrtPathsByLang.set(targetL, filePath);
        }
      }

      if (options.burn && !savedSrtPathsByLang.has(targetL)) {
        const tempSrtPath = path.join(
          os.tmpdir(),
          `vsub-burn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${targetL}.srt`,
        );
        fs.writeFileSync(tempSrtPath, formatEntries(entries, "srt"), "utf-8");
        savedSrtPathsByLang.set(targetL, tempSrtPath);
        tempSrtFilesToCleanup.push(tempSrtPath);
      }
    }

    const formatListStr = outputFormats.map((f) => f.toUpperCase()).join(", ");
    spinner.succeed(`${prefix}${m.step4Saved(formatListStr)}`);

    // 5. Burn subtitles to video if --burn option is specified
    if (options.burn) {
      try {
        spinner.start(`${prefix}${m.burnStarting}`);

        for (let i = 0; i < targetLanguages.length; i++) {
          const targetL = targetLanguages[i] ?? "ja";
          const srtPathToUse = savedSrtPathsByLang.get(targetL);
          if (!srtPathToUse || !fs.existsSync(srtPathToUse)) {
            continue;
          }

          let burntVideoPath: string;
          const langTag = isBilingual ? `${targetL}.bilingual` : targetL;
          if (options.output) {
            const resolvedOut = path.resolve(process.cwd(), options.output);
            const parsedOut = path.parse(resolvedOut);
            if (isMultiLang) {
              burntVideoPath = path.join(parsedOut.dir, `${parsedOut.name}.${langTag}.subbed.mp4`);
            } else if (parsedOut.ext === ".mp4") {
              burntVideoPath = resolvedOut;
            } else {
              burntVideoPath = path.join(parsedOut.dir, `${parsedOut.name}.subbed.mp4`);
            }
          } else {
            burntVideoPath = path.join(
              effectiveOutputDir,
              `${mediaBaseName}.${langTag}.subbed.mp4`,
            );
          }

          if (isMultiLang) {
            spinner.updateText(
              `${prefix}${m.burnStarting} (${i + 1}/${targetLanguages.length}: ${targetL.toUpperCase()})...`,
            );
          }

          await burnSubtitlesToVideo(resolvedMediaPath, srtPathToUse, burntVideoPath, {
            ffmpegPath: rawConfig.ffmpegPath,
            verbose,
          });

          outputFiles.push(burntVideoPath);

          if (isMultiLang) {
            spinner.info(
              `${prefix}  ✔ ${targetL.toUpperCase()} -> ${path.basename(burntVideoPath)}`,
            );
          }
        }

        spinner.succeed(`${prefix}${m.burnDone}`);
      } finally {
        for (const tempSrt of tempSrtFilesToCleanup) {
          try {
            if (fs.existsSync(tempSrt)) {
              fs.unlinkSync(tempSrt);
            }
          } catch {
            // ignore
          }
        }
      }
    }

    const durationMs = Date.now() - startTime;
    const result: ProcessMediaResult = {
      mediaFile: path.basename(resolvedMediaPath),
      mediaType: mediaTypeName,
      durationMs,
      audioSegmentsCount: audioPaths.length > 0 ? audioPaths.length : undefined,
      audioTotalBytes: totalAudioBytes > 0 ? totalAudioBytes : undefined,
      detectedLanguage,
      targetLanguages,
      skippedLanguages,
      entriesCount: srtEntries.length,
      bilingual: isBilingual ? { order: bilingualOrder } : undefined,
      backedUpFiles:
        safetyCheck.backedUp.length > 0 ? safetyCheck.backedUp.map((b) => b.backup) : undefined,
      outputFiles,
      skippedTranslation: skippedLanguages.length === targetLanguages.length,
      whisperPrompt,
      prompt: translationPrompt,
      glossaryTermsCount: totalGlossaryTerms > 0 ? totalGlossaryTerms : undefined,
      groqModel: groqModel || DEFAULT_GROQ_MODEL,
      geminiModel: geminiModel || DEFAULT_GEMINI_MODEL,
      cacheStatus:
        transcriptionCacheHit || cachedLanguages.length > 0
          ? {
              transcriptionHit: transcriptionCacheHit,
              cachedLanguages,
            }
          : undefined,
    };

    if (!options.silentSummary) {
      console.log(`\n${formatSummaryBox(result, lang)}\n`);
    }

    return result;
  } finally {
    if (cleanupAudio) {
      if (!options.keepAudio) {
        await cleanupAudio();
      } else {
        spinner.info(`${prefix}ℹ️ [--keep-audio] 中間音声ファイルを保持: ${audioPaths.join(", ")}`);
      }
    }
  }
}
