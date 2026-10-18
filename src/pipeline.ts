import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pc from "picocolors";
import {
  isChaptersCacheValid,
  isSummaryCacheValid,
  isTranscriptionCacheValid,
  isTranslationCacheValid,
  loadMediaCache,
  saveChaptersCache,
  saveSummaryCache,
  saveTranscriptionCache,
  saveTranslationCache,
} from "./cache.js";
import { DEFAULT_GEMINI_MODEL, DEFAULT_GROQ_MODEL, ensureApiKeys, getConfig } from "./config.js";
import {
  burnSubtitlesToVideo,
  checkFfmpeg,
  embedSubtitlesToVideo,
  extractAudio,
  isAudioFile,
  isVideoFile,
  type SubtitleTrackInput,
} from "./ffmpeg.js";
import {
  type ChapterItem,
  type ChaptersFormat,
  formatChapters,
  formatEntries,
  formatSummary,
  type OutputFormat,
  parseOutputFormats,
  type SummaryFormat,
  type SummaryResult,
} from "./formatter.js";
import { generateChapters, generateSummary, translateSrtEntries } from "./gemini.js";
import { computeGlossaryHash, extractWhisperPromptHints, parseGlossary } from "./glossary.js";
import { transcribeAudioSegments } from "./groq.js";
import { getI18n, type SupportedLanguage } from "./i18n/index.js";
import { getLanguageDisplayName, parseTargetLanguages } from "./languages.js";

import { type EnsureWritableResult, ensureWritableTargets } from "./safety.js";
import {
  type BilingualOrder,
  mergeBilingualEntries,
  parseSrt,
  reflowSrtEntries,
  type SrtEntry,
} from "./srt.js";
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
  stdout?: boolean | undefined;
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
  embed?: boolean | undefined;
  keepAudio?: boolean | undefined;
  noTranslate?: boolean | undefined;
  saveOriginal?: boolean | undefined;
  forceTranslate?: boolean | undefined;
  verbose?: boolean | undefined;
  silentSummary?: boolean | undefined;
  logPrefix?: string | undefined;
  lang?: SupportedLanguage | undefined;
  contextWindow?: string | number | undefined;
  maxLength?: number | string | undefined;
  maxDuration?: number | string | undefined;
  noReflow?: boolean | undefined;
  burnPosition?: string | undefined;
  burnFontSize?: number | string | undefined;
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
  stdoutContent?: string | undefined;
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
  const isStdout = Boolean(options.stdout || options.output === "-");
  const prefix = options.logPrefix ? `${options.logPrefix} ` : "";
  const spinner = createSpinner("", {
    isSilent: verbose,
    stream: isStdout ? process.stderr : undefined,
  });
  const outputFiles: string[] = [];

  const rawConfig = getConfig(options.ffmpegPath, options.lang);
  const lang = options.lang ?? rawConfig.lang ?? "en";
  const i18n = getI18n(lang);
  const m = i18n.pipeline;

  const outputFormats = parseOutputFormats(options.format || "srt");
  const targetLanguages = parseTargetLanguages(options.targetLang || "ja");

  if (isStdout) {
    if (outputFormats.length > 1) {
      throw new Error(m.stdoutSingleFormatOnly);
    }
    if (targetLanguages.length > 1) {
      throw new Error(m.stdoutSingleLangOnly);
    }
    if (options.burn) {
      throw new Error(m.stdoutCannotBurn);
    }
    if (options.embed) {
      throw new Error(m.stdoutCannotEmbed);
    }
  }

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
  if (!isStdout && options.outputDir && !fs.existsSync(effectiveOutputDir)) {
    fs.mkdirSync(effectiveOutputDir, { recursive: true });
  }

  // Pre-check output file safety before expensive operations (skipped in stdout mode)
  const predictedTargets: string[] = [];
  if (!isStdout) {
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

    if (options.embed) {
      let embeddedVideoPath: string;
      const targetExt = isVideoFile(resolvedMediaPath) ? mediaExt : ".mp4";
      if (options.output) {
        const resolvedOut = path.resolve(process.cwd(), options.output);
        const parsedOut = path.parse(resolvedOut);
        if (isVideoFile(resolvedOut)) {
          embeddedVideoPath = resolvedOut;
        } else {
          embeddedVideoPath = path.join(parsedOut.dir, `${parsedOut.name}.embedded${targetExt}`);
        }
      } else {
        embeddedVideoPath = path.join(effectiveOutputDir, `${mediaBaseName}.embedded${targetExt}`);
      }
      predictedTargets.push(embeddedVideoPath);
    }
  }

  const safetyCheck: EnsureWritableResult = isStdout
    ? { proceed: true, backedUp: [], existingFiles: [] }
    : await ensureWritableTargets(predictedTargets, {
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

  const noReflow = Boolean(options.noReflow);

  const isAudio = isAudioFile(resolvedMediaPath);
  if (options.burn && isAudio) {
    throw new Error(m.cannotBurnAudio);
  }
  if (options.embed && isAudio) {
    throw new Error(m.cannotEmbedAudio);
  }

  const mediaTypeName = isAudio ? "audio" : "video";
  const mediaIcon = isAudio ? "🎵" : "🎬";

  if (!options.silentSummary && !isStdout) {
    console.log(
      `\n${mediaIcon} ${pc.bold(m.startProcessing(pc.cyan(path.basename(resolvedMediaPath))))}`,
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

  const rawEntriesCount = srtEntries.length;
  if (!noReflow && srtEntries.length > 0) {
    srtEntries = reflowSrtEntries(srtEntries, {
      maxLength: resolvedMaxLength,
      maxDuration: resolvedMaxDuration,
    });
    if (verbose && srtEntries.length !== rawEntriesCount) {
      console.log(
        `${prefix}[Reflow] Adjusted subtitle segments: ${rawEntriesCount} -> ${srtEntries.length} entries`,
      );
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
      spinner.info(`${prefix}${m.savedOriginal(savedOriginalNames.join(", "))}`);
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
        isTranslationCacheValid(cachedTranslation, translationPrompt, glossaryHash, geminiModel) &&
        cachedTranslation?.entries.length === srtEntries.length;

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
      const contextWindowVal =
        options.contextWindow !== undefined ? Number(options.contextWindow) : undefined;
      const resolvedContextWindow =
        contextWindowVal !== undefined && !Number.isNaN(contextWindowVal)
          ? Math.max(0, Math.floor(contextWindowVal))
          : undefined;

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
          contextWindowSize: resolvedContextWindow,
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

    // 4. Save output subtitle files / generate stdout content
    let stdoutContent: string | undefined;

    if (isStdout) {
      const targetL = targetLanguages[0] ?? "ja";
      let entries = resultsByLang.get(targetL) ?? srtEntries;
      if (isBilingual) {
        entries = mergeBilingualEntries(srtEntries, entries, { order: bilingualOrder });
      }
      const fmt = outputFormats[0] ?? "srt";
      stdoutContent = formatEntries(entries, fmt);
    } else {
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

        if ((options.burn || options.embed) && !savedSrtPathsByLang.has(targetL)) {
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

      try {
        // 5. Burn subtitles to video if --burn option is specified
        if (options.burn) {
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
                burntVideoPath = path.join(
                  parsedOut.dir,
                  `${parsedOut.name}.${langTag}.subbed.mp4`,
                );
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
              position: options.burnPosition ?? rawConfig.burnPosition,
              fontSize: options.burnFontSize ?? rawConfig.burnFontSize,
              lang,
            });

            outputFiles.push(burntVideoPath);

            if (isMultiLang) {
              spinner.info(
                `${prefix}  ✔ ${targetL.toUpperCase()} -> ${path.basename(burntVideoPath)}`,
              );
            }
          }

          spinner.succeed(`${prefix}${m.burnDone}`);
        }

        // 6. Embed soft subtitles to video if --embed option is specified
        if (options.embed) {
          spinner.start(`${prefix}${m.embedStarting}`);

          const subtitleTracks: SubtitleTrackInput[] = [];
          for (const targetL of targetLanguages) {
            const srtPathToUse = savedSrtPathsByLang.get(targetL);
            if (!srtPathToUse || !fs.existsSync(srtPathToUse)) {
              continue;
            }
            const displayName = getLanguageDisplayName(targetL);
            const title = isBilingual ? `${displayName} (Bilingual)` : displayName;
            subtitleTracks.push({
              path: srtPathToUse,
              language: targetL,
              title,
            });
          }

          if (subtitleTracks.length > 0) {
            let embeddedVideoPath: string;
            const targetExt = isVideoFile(resolvedMediaPath) ? mediaExt : ".mp4";
            if (options.output) {
              const resolvedOut = path.resolve(process.cwd(), options.output);
              const parsedOut = path.parse(resolvedOut);
              if (isVideoFile(resolvedOut)) {
                embeddedVideoPath = resolvedOut;
              } else {
                embeddedVideoPath = path.join(
                  parsedOut.dir,
                  `${parsedOut.name}.embedded${targetExt}`,
                );
              }
            } else {
              embeddedVideoPath = path.join(
                effectiveOutputDir,
                `${mediaBaseName}.embedded${targetExt}`,
              );
            }

            await embedSubtitlesToVideo(resolvedMediaPath, subtitleTracks, embeddedVideoPath, {
              ffmpegPath: rawConfig.ffmpegPath,
              verbose,
            });

            outputFiles.push(embeddedVideoPath);
            spinner.succeed(`${prefix}${m.embedDone}`);
          }
        }
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
      stdoutContent,
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

    if (!options.silentSummary && !isStdout) {
      console.log(`\n${formatSummaryBox(result, lang)}\n`);
    }

    return result;
  } finally {
    if (cleanupAudio) {
      if (!options.keepAudio) {
        await cleanupAudio();
      } else {
        spinner.info(`${prefix}${m.keptAudio(audioPaths.join(", "))}`);
      }
    }
  }
}

export interface ResolveTranscriptOptions {
  filePath: string;
  groqModel?: string | undefined;
  whisperPrompt?: string | undefined;
  noCache?: boolean | undefined;
  fresh?: boolean | undefined;
  cacheDir?: string | undefined;
  verbose?: boolean | undefined;
  lang?: SupportedLanguage | undefined;
  spinner?: ReturnType<typeof createSpinner> | undefined;
  prefix?: string | undefined;
}

export interface ResolveTranscriptResult {
  entries: SrtEntry[];
  detectedLanguage?: string | undefined;
  fromCache: boolean;
  isSubtitleFile: boolean;
}

/**
 * Resolves transcript entries from an existing .srt file or media file (with cache support).
 */
export async function resolveTranscriptEntries(
  options: ResolveTranscriptOptions,
): Promise<ResolveTranscriptResult> {
  const resolvedPath = path.resolve(options.filePath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`File not found: ${resolvedPath}`);
  }

  const isSrt = resolvedPath.toLowerCase().endsWith(".srt");

  if (isSrt) {
    const content = fs.readFileSync(resolvedPath, "utf-8");
    const entries = parseSrt(content);
    return {
      entries,
      fromCache: false,
      isSubtitleFile: true,
    };
  }

  const useCache = !options.noCache && !options.fresh;
  const mediaCache = useCache ? loadMediaCache(resolvedPath, options.cacheDir) : null;
  const isMatch =
    useCache &&
    isTranscriptionCacheValid(mediaCache?.transcription, options.whisperPrompt, options.groqModel);

  if (isMatch && mediaCache?.transcription) {
    return {
      entries: mediaCache.transcription.entries,
      detectedLanguage: mediaCache.transcription.detectedLanguage,
      fromCache: true,
      isSubtitleFile: false,
    };
  }

  // Not cached, transcribe via Groq
  const rawConfig = getConfig(undefined, options.lang);
  const config = await ensureApiKeys(rawConfig, {
    requireGroq: true,
    requireGemini: false,
    lang: options.lang,
  });
  await checkFfmpeg(config.ffmpegPath);

  const verbose = Boolean(options.verbose);
  const extractResult = await extractAudio(resolvedPath, config.ffmpegPath, verbose);
  const audioPaths = extractResult.audioPaths;

  try {
    const transcriptResult = await transcribeAudioSegments(
      audioPaths,
      config.groqApiKey,
      verbose,
      undefined,
      {
        model: options.groqModel,
        ...(options.whisperPrompt ? { prompt: options.whisperPrompt } : {}),
        ...(extractResult.durations ? { durations: extractResult.durations } : {}),
      },
    );

    if (!options.noCache) {
      saveTranscriptionCache(
        resolvedPath,
        {
          detectedLanguage: transcriptResult.detectedLanguage,
          model: options.groqModel,
          prompt: options.whisperPrompt,
          entries: transcriptResult.entries,
          createdAt: Date.now(),
        },
        options.cacheDir,
      );
    }

    return {
      entries: transcriptResult.entries,
      detectedLanguage: transcriptResult.detectedLanguage,
      fromCache: false,
      isSubtitleFile: false,
    };
  } finally {
    if (extractResult.cleanup) {
      await extractResult.cleanup();
    }
  }
}

export interface ProcessChaptersOptions {
  inputFile: string;
  targetLang?: string | undefined;
  format?: ChaptersFormat | undefined;
  output?: string | undefined;
  stdout?: boolean | undefined;
  overwrite?: boolean | undefined;
  backup?: boolean | undefined;
  geminiModel?: string | undefined;
  groqModel?: string | undefined;
  whisperPrompt?: string | undefined;
  prompt?: string | undefined;
  noCache?: boolean | undefined;
  fresh?: boolean | undefined;
  cacheDir?: string | undefined;
  verbose?: boolean | undefined;
  lang?: SupportedLanguage | undefined;
}

export interface ProcessChaptersResult {
  inputFile: string;
  outputFile?: string | undefined;
  chapters: ChapterItem[];
  formattedOutput: string;
  durationMs: number;
  fromCache: boolean;
  transcriptionFromCache: boolean;
}

/**
 * Pipeline to generate chapters from media or subtitle files.
 */
export async function processChaptersPipeline(
  options: ProcessChaptersOptions,
): Promise<ProcessChaptersResult> {
  const startTime = Date.now();
  const verbose = Boolean(options.verbose);
  const isStdout = Boolean(options.stdout || options.output === "-");
  const lang = options.lang || "en";
  const i18n = getI18n(lang);
  const cm = i18n.chapters;

  const resolvedInput = path.resolve(options.inputFile);
  if (!fs.existsSync(resolvedInput)) {
    throw new Error(i18n.pipeline.mediaNotFound(resolvedInput));
  }

  const format = options.format || "txt";
  const rawConfig = getConfig(undefined, lang);
  const targetLang = options.targetLang?.trim() || rawConfig.targetLang || "ja";
  const geminiModel = options.geminiModel?.trim() || rawConfig.geminiModel || DEFAULT_GEMINI_MODEL;
  const groqModel = options.groqModel?.trim() || rawConfig.groqModel || DEFAULT_GROQ_MODEL;

  let outputPath: string | undefined;
  if (!isStdout) {
    if (options.output) {
      outputPath = path.resolve(process.cwd(), options.output);
    } else {
      const parsed = path.parse(resolvedInput);
      const ext = format === "json" ? "json" : format === "vtt" ? "vtt" : "txt";
      outputPath = path.join(parsed.dir, `${parsed.name}.chapters.${ext}`);
    }

    const safetyCheck = await ensureWritableTargets([outputPath], {
      overwrite: options.overwrite,
      backup: options.backup,
      lang,
    });
    if (!safetyCheck.proceed) {
      throw new Error(i18n.pipeline.conflictAbort);
    }
  }

  if (!isStdout) {
    console.log(`\n📑 ${pc.bold(cm.started(pc.cyan(path.basename(resolvedInput))))}`);
  }

  const spinner = createSpinner("", { isSilent: verbose || isStdout });

  // Check chapters cache
  const useCache = !options.noCache && !options.fresh;
  const isSrt = resolvedInput.toLowerCase().endsWith(".srt");
  const mediaCache = useCache && !isSrt ? loadMediaCache(resolvedInput, options.cacheDir) : null;
  const cachedChapters = mediaCache?.chapters?.[targetLang.toLowerCase()];

  if (
    useCache &&
    isChaptersCacheValid(cachedChapters, options.prompt, geminiModel) &&
    cachedChapters
  ) {
    const chapters = cachedChapters.chapters;
    spinner.succeed(cm.step2Cached(chapters.length));

    const formattedOutput = formatChapters(chapters, format);
    if (isStdout) {
      process.stdout.write(formattedOutput);
    } else if (outputPath) {
      fs.writeFileSync(outputPath, formattedOutput, "utf-8");
      spinner.succeed(cm.step3Saved(pc.cyan(path.basename(outputPath))));
    }

    return {
      inputFile: resolvedInput,
      outputFile: outputPath,
      chapters,
      formattedOutput,
      durationMs: Date.now() - startTime,
      fromCache: true,
      transcriptionFromCache: true,
    };
  }

  // Ensure Gemini API Key
  const config = await ensureApiKeys(rawConfig, {
    requireGemini: true,
    requireGroq: false,
    lang,
  });

  // Step 1: Resolve transcript entries
  spinner.start(cm.step1Resolve);
  const transcriptResult = await resolveTranscriptEntries({
    filePath: resolvedInput,
    groqModel,
    whisperPrompt: options.whisperPrompt,
    noCache: options.noCache,
    fresh: options.fresh,
    cacheDir: options.cacheDir,
    verbose,
    lang,
    spinner,
  });

  if (transcriptResult.entries.length === 0) {
    spinner.fail(cm.noEntries);
    throw new Error(cm.noEntries);
  }
  spinner.succeed(cm.step1Parsed(transcriptResult.entries.length));

  // Step 2: Generate chapters with Gemini
  spinner.start(cm.step2Generating(geminiModel, targetLang.toUpperCase()));
  const chapters = await generateChapters(transcriptResult.entries, config.geminiApiKey, {
    targetLang,
    model: geminiModel,
    prompt: options.prompt,
    lang,
    verbose,
  });
  spinner.succeed(cm.step2Done(chapters.length));

  // Save chapters to cache if media file
  if (!options.noCache && !isSrt) {
    saveChaptersCache(
      resolvedInput,
      targetLang,
      {
        targetLang,
        model: geminiModel,
        prompt: options.prompt,
        chapters,
        createdAt: Date.now(),
      },
      options.cacheDir,
    );
  }

  // Step 3: Format and save or stdout
  const formattedOutput = formatChapters(chapters, format);
  if (isStdout) {
    process.stdout.write(formattedOutput);
  } else if (outputPath) {
    spinner.start(cm.step3Saving);
    fs.writeFileSync(outputPath, formattedOutput, "utf-8");
    spinner.succeed(cm.step3Saved(pc.cyan(path.basename(outputPath))));
  }

  return {
    inputFile: resolvedInput,
    outputFile: outputPath,
    chapters,
    formattedOutput,
    durationMs: Date.now() - startTime,
    fromCache: false,
    transcriptionFromCache: transcriptResult.fromCache,
  };
}

export interface ProcessSummaryOptions {
  inputFile: string;
  targetLang?: string | undefined;
  format?: SummaryFormat | undefined;
  output?: string | undefined;
  stdout?: boolean | undefined;
  overwrite?: boolean | undefined;
  backup?: boolean | undefined;
  geminiModel?: string | undefined;
  groqModel?: string | undefined;
  whisperPrompt?: string | undefined;
  prompt?: string | undefined;
  noCache?: boolean | undefined;
  fresh?: boolean | undefined;
  cacheDir?: string | undefined;
  verbose?: boolean | undefined;
  lang?: SupportedLanguage | undefined;
}

export interface ProcessSummaryResult {
  inputFile: string;
  outputFile?: string | undefined;
  summary: SummaryResult;
  formattedOutput: string;
  durationMs: number;
  fromCache: boolean;
  transcriptionFromCache: boolean;
}

/**
 * Pipeline to generate structured summary from media or subtitle files.
 */
export async function processSummaryPipeline(
  options: ProcessSummaryOptions,
): Promise<ProcessSummaryResult> {
  const startTime = Date.now();
  const verbose = Boolean(options.verbose);
  const isStdout = Boolean(options.stdout || options.output === "-");
  const lang = options.lang || "en";
  const i18n = getI18n(lang);
  const sm = i18n.summarize;

  const resolvedInput = path.resolve(options.inputFile);
  if (!fs.existsSync(resolvedInput)) {
    throw new Error(i18n.pipeline.mediaNotFound(resolvedInput));
  }

  const format = options.format || "md";
  const rawConfig = getConfig(undefined, lang);
  const targetLang = options.targetLang?.trim() || rawConfig.targetLang || "ja";
  const geminiModel = options.geminiModel?.trim() || rawConfig.geminiModel || DEFAULT_GEMINI_MODEL;
  const groqModel = options.groqModel?.trim() || rawConfig.groqModel || DEFAULT_GROQ_MODEL;

  let outputPath: string | undefined;
  if (!isStdout) {
    if (options.output) {
      outputPath = path.resolve(process.cwd(), options.output);
    } else {
      const parsed = path.parse(resolvedInput);
      const ext = format === "json" ? "json" : format === "txt" ? "txt" : "md";
      outputPath = path.join(parsed.dir, `${parsed.name}.summary.${ext}`);
    }

    const safetyCheck = await ensureWritableTargets([outputPath], {
      overwrite: options.overwrite,
      backup: options.backup,
      lang,
    });
    if (!safetyCheck.proceed) {
      throw new Error(i18n.pipeline.conflictAbort);
    }
  }

  if (!isStdout) {
    console.log(`\n📝 ${pc.bold(sm.started(pc.cyan(path.basename(resolvedInput))))}`);
  }

  const spinner = createSpinner("", { isSilent: verbose || isStdout });

  // Check summary cache
  const useCache = !options.noCache && !options.fresh;
  const isSrt = resolvedInput.toLowerCase().endsWith(".srt");
  const mediaCache = useCache && !isSrt ? loadMediaCache(resolvedInput, options.cacheDir) : null;
  const cachedSummary = mediaCache?.summaries?.[targetLang.toLowerCase()];

  if (
    useCache &&
    isSummaryCacheValid(cachedSummary, options.prompt, geminiModel) &&
    cachedSummary
  ) {
    const summary = cachedSummary.summary;
    spinner.succeed(sm.step2Cached);

    const formattedOutput = formatSummary(summary, format);
    if (isStdout) {
      process.stdout.write(formattedOutput);
    } else if (outputPath) {
      fs.writeFileSync(outputPath, formattedOutput, "utf-8");
      spinner.succeed(sm.step3Saved(pc.cyan(path.basename(outputPath))));
    }

    return {
      inputFile: resolvedInput,
      outputFile: outputPath,
      summary,
      formattedOutput,
      durationMs: Date.now() - startTime,
      fromCache: true,
      transcriptionFromCache: true,
    };
  }

  // Ensure Gemini API Key
  const config = await ensureApiKeys(rawConfig, {
    requireGemini: true,
    requireGroq: false,
    lang,
  });

  // Step 1: Resolve transcript entries
  spinner.start(sm.step1Resolve);
  const transcriptResult = await resolveTranscriptEntries({
    filePath: resolvedInput,
    groqModel,
    whisperPrompt: options.whisperPrompt,
    noCache: options.noCache,
    fresh: options.fresh,
    cacheDir: options.cacheDir,
    verbose,
    lang,
    spinner,
  });

  if (transcriptResult.entries.length === 0) {
    spinner.fail(sm.noEntries);
    throw new Error(sm.noEntries);
  }
  spinner.succeed(sm.step1Parsed(transcriptResult.entries.length));

  // Step 2: Generate summary with Gemini
  spinner.start(sm.step2Generating(geminiModel, targetLang.toUpperCase()));
  const summary = await generateSummary(transcriptResult.entries, config.geminiApiKey, {
    targetLang,
    model: geminiModel,
    prompt: options.prompt,
    lang,
    verbose,
  });
  spinner.succeed(sm.step2Done);

  // Save summary to cache if media file
  if (!options.noCache && !isSrt) {
    saveSummaryCache(
      resolvedInput,
      targetLang,
      {
        targetLang,
        model: geminiModel,
        prompt: options.prompt,
        summary,
        createdAt: Date.now(),
      },
      options.cacheDir,
    );
  }

  // Step 3: Format and save or stdout
  const formattedOutput = formatSummary(summary, format);
  if (isStdout) {
    process.stdout.write(formattedOutput);
  } else if (outputPath) {
    spinner.start(sm.step3Saving);
    fs.writeFileSync(outputPath, formattedOutput, "utf-8");
    spinner.succeed(sm.step3Saved(pc.cyan(path.basename(outputPath))));
  }

  return {
    inputFile: resolvedInput,
    outputFile: outputPath,
    summary,
    formattedOutput,
    durationMs: Date.now() - startTime,
    fromCache: false,
    transcriptionFromCache: transcriptResult.fromCache,
  };
}
