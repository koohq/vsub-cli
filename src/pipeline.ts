import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pc from "picocolors";
import {
  createCachedChapters,
  createCachedSummary,
  createCachedTranscription,
  type GeneratedCacheContext,
  isChaptersCacheValid,
  isSummaryCacheValid,
  isTranscriptionCacheValid,
  loadMediaCache,
  saveChaptersCache,
  saveSummaryCache,
  saveTranscriptionCache,
  type TranscriptionCacheContext,
} from "./cache.js";
import {
  type AppConfig,
  ensureApiKeys,
  getConfig,
  resolveRefine,
  resolveReflowLimits,
} from "./config.js";
import {
  burnSubtitlesToVideo,
  checkFfmpeg,
  embedSubtitlesToVideo,
  extractAudio,
  isAudioFile,
  isVideoFile,
  listSoftSubtitleContainers,
  type SubtitleTrackInput,
  supportsSoftSubtitles,
} from "./ffmpeg.js";
import {
  type ChapterItem,
  type ChaptersFormat,
  formatChapters,
  formatEntries,
  formatSummary,
  MIN_YOUTUBE_CHAPTERS,
  normalizeChapters,
  type OutputFormat,
  parseOutputFormats,
  type SummaryFormat,
  type SummaryResult,
} from "./formatter.js";
import { computeGlossaryHash, extractWhisperPromptHints, parseGlossary } from "./glossary.js";
import { getI18n, type I18nMessages, type SupportedLanguage } from "./i18n/index.js";
import { getLanguageDisplayName, parseTargetLanguages, resolveTargetLang } from "./languages.js";
import { refineSourceEntries } from "./refine.js";
import { type EnsureWritableResult, ensureWritableTargets } from "./safety.js";
import {
  type BilingualOrder,
  mergeBilingualEntries,
  parseSrt,
  parseSrtTime,
  reflowSrtEntries,
  type SrtEntry,
} from "./srt.js";
import { LLM_PROVIDER_LABELS, type LlmProvider } from "./text/providers.js";
import { createTextModel, resolveLlmSettings } from "./text/select.js";
import { generateChapters, generateSummary } from "./text/tasks.js";
import {
  createTranscriber,
  resolveSttSettings,
  STT_PROVIDER_LABELS,
  type SttProvider,
  type SttSettings,
} from "./transcribe/select.js";
import { transcribeAudioSegments } from "./transcribe/transcriber.js";
import { buildEntriesFromWords, type WordChunk } from "./transcribe/words.js";
import { resolveConcurrency, resolveContextWindowSize, translateToTargets } from "./translation.js";
import { createSpinner, formatFileSize, formatSummaryBox, showSpinnerNotice } from "./ui.js";

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

/**
 * Resolves the destination path for embedded soft subtitles video output.
 */
export function resolveEmbeddedVideoPath(
  mediaPath: string,
  outputOption?: string | undefined,
  outputDir?: string | undefined,
): string {
  const resolvedMedia = path.resolve(process.cwd(), mediaPath);
  const mediaExt = path.extname(resolvedMedia);
  const mediaBaseName = path.basename(resolvedMedia, mediaExt);
  const effectiveDir = outputDir
    ? path.resolve(process.cwd(), outputDir)
    : path.dirname(resolvedMedia);
  const targetExt = isVideoFile(resolvedMedia) ? mediaExt : ".mp4";

  if (outputOption) {
    const resolvedOut = path.resolve(process.cwd(), outputOption);
    if (isVideoFile(resolvedOut)) {
      return resolvedOut;
    }
    const parsedOut = path.parse(resolvedOut);
    return path.join(parsedOut.dir, `${parsedOut.name}.embedded${targetExt}`);
  }

  return path.join(effectiveDir, `${mediaBaseName}.embedded${targetExt}`);
}

/**
 * Resolves the destination path for burnt-in subtitles video output.
 */
export function resolveBurntVideoPath(
  mediaPath: string,
  langTag: string,
  isMultiLang: boolean,
  outputOption?: string | undefined,
  outputDir?: string | undefined,
): string {
  const resolvedMedia = path.resolve(process.cwd(), mediaPath);
  const mediaExt = path.extname(resolvedMedia);
  const mediaBaseName = path.basename(resolvedMedia, mediaExt);
  const effectiveOutputDir = outputDir
    ? path.resolve(process.cwd(), outputDir)
    : path.dirname(resolvedMedia);

  if (outputOption) {
    const resolvedOut = path.resolve(process.cwd(), outputOption);
    const parsedOut = path.parse(resolvedOut);
    if (isMultiLang) {
      return path.join(parsedOut.dir, `${parsedOut.name}.${langTag}.subbed.mp4`);
    }
    if (parsedOut.ext === ".mp4") {
      return resolvedOut;
    }
    return path.join(parsedOut.dir, `${parsedOut.name}.subbed.mp4`);
  }

  return path.join(effectiveOutputDir, `${mediaBaseName}.${langTag}.subbed.mp4`);
}

/**
 * Detects whether any output path conflicts with the input media path or another output path.
 * Comparison is case-insensitive on fully resolved paths.
 */
export function findOutputPathConflict(
  inputPath: string,
  outputPaths: string[],
): string | undefined {
  const normalizedInput = path.resolve(process.cwd(), inputPath).toLowerCase();
  const seenOutputs = new Set<string>();

  for (const outputPath of outputPaths) {
    const normalizedOutput = path.resolve(process.cwd(), outputPath).toLowerCase();
    if (normalizedOutput === normalizedInput || seenOutputs.has(normalizedOutput)) {
      return outputPath;
    }
    seenOutputs.add(normalizedOutput);
  }

  return undefined;
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
  llmProvider?: string | undefined;
  llmModel?: string | undefined;
  groqModel?: string | undefined;
  sttProvider?: string | undefined;
  sttModel?: string | undefined;
  silentSttHint?: boolean | undefined;
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
  refine?: boolean | undefined;
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
  sttProvider: SttProvider;
  sttModel: string;
  llmProvider: LlmProvider;
  llmModel: string;
  refinement?:
    | {
        changedLines: number;
        totalLines: number;
        cached: boolean;
        fallbackChunks: number;
      }
    | undefined;
  cacheStatus?:
    | {
        transcriptionHit?: boolean | undefined;
        cachedLanguages?: string[] | undefined;
      }
    | undefined;
}

/**
 * Resolves transcription cache context according to CLI options, raw config, and glossary hints.
 */
export function resolveTranscriptionContext(
  rawConfig: Pick<AppConfig, "whisperPrompt" | "glossary">,
  stt: SttSettings,
  overrides?: {
    whisperPrompt?: string | undefined;
    glossary?: string | undefined;
  },
): TranscriptionCacheContext {
  let whisperPrompt: string | undefined;
  if (stt.provider !== "openrouter") {
    const glossaryInput = overrides?.glossary?.trim() || rawConfig.glossary;
    whisperPrompt = overrides?.whisperPrompt?.trim() || rawConfig.whisperPrompt;
    if (!whisperPrompt && glossaryInput) {
      whisperPrompt = extractWhisperPromptHints(glossaryInput);
    }
  }
  return {
    provider: stt.provider,
    model: stt.model,
    prompt: whisperPrompt,
  };
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

  let rawConfig = getConfig(options.ffmpegPath, options.lang);
  const lang = options.lang ?? rawConfig.lang ?? "en";
  const i18n = getI18n(lang);
  const m = i18n.pipeline;

  const { config: resolvedSttConfig, stt } = resolveSttSettings(
    rawConfig,
    {
      sttProvider: options.sttProvider,
      sttModel: options.sttModel,
      groqModel: options.groqModel,
    },
    lang,
  );
  const { config: resolvedLlmConfig, llm } = resolveLlmSettings(
    resolvedSttConfig,
    {
      llmProvider: options.llmProvider,
      llmModel: options.llmModel,
      geminiModel: options.geminiModel,
    },
    lang,
  );
  rawConfig = resolvedLlmConfig;

  const outputFormats = parseOutputFormats(options.format || "srt", lang);
  const targetLanguages = parseTargetLanguages(
    resolveTargetLang(options.targetLang, rawConfig.targetLang),
    lang,
  );

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

  const isAudio = isAudioFile(resolvedMediaPath);
  if (options.burn && isAudio) {
    throw new Error(m.cannotBurnAudio);
  }
  if (options.embed && isAudio) {
    throw new Error(m.cannotEmbedAudio);
  }

  const mediaDir = path.dirname(resolvedMediaPath);
  const mediaExt = path.extname(resolvedMediaPath);
  const mediaBaseName = path.basename(resolvedMediaPath, mediaExt);

  const embeddedVideoPath = options.embed
    ? resolveEmbeddedVideoPath(resolvedMediaPath, options.output, options.outputDir)
    : undefined;
  if (embeddedVideoPath && !supportsSoftSubtitles(embeddedVideoPath)) {
    const ext = path.extname(embeddedVideoPath).toLowerCase();
    const supported = listSoftSubtitleContainers();
    throw new Error(m.embedUnsupportedContainer(path.basename(embeddedVideoPath), ext, supported));
  }

  const outputNamesVideo = Boolean(
    (options.burn || options.embed) && options.output && isVideoFile(options.output),
  );

  const subtitleTargetsByLang = new Map<string, { format: OutputFormat; filePath: string }[]>();
  for (const targetL of targetLanguages) {
    subtitleTargetsByLang.set(
      targetL,
      resolveOutputFilePaths(
        mediaDir,
        mediaBaseName,
        targetL,
        outputFormats,
        options.output,
        !(isMultiLang || outputNamesVideo),
        isBilingual,
        options.outputDir,
      ),
    );
  }

  const burntVideoPathsByLang = new Map<string, string>();
  if (options.burn) {
    for (const targetL of targetLanguages) {
      const langTag = isBilingual ? `${targetL}.bilingual` : targetL;
      burntVideoPathsByLang.set(
        targetL,
        resolveBurntVideoPath(
          resolvedMediaPath,
          langTag,
          isMultiLang,
          options.output,
          options.outputDir,
        ),
      );
    }
  }

  const predictedTargets: string[] = [];
  if (!isStdout) {
    for (const targetL of targetLanguages) {
      const targets = subtitleTargetsByLang.get(targetL) ?? [];
      for (const { filePath } of targets) {
        predictedTargets.push(filePath);
      }
    }
    if (options.burn) {
      for (const targetL of targetLanguages) {
        const burntPath = burntVideoPathsByLang.get(targetL);
        if (burntPath) {
          predictedTargets.push(burntPath);
        }
      }
    }
    if (embeddedVideoPath) {
      predictedTargets.push(embeddedVideoPath);
    }

    const conflictTarget = findOutputPathConflict(resolvedMediaPath, predictedTargets);
    if (conflictTarget) {
      throw new Error(m.outputPathConflict(path.basename(conflictTarget)));
    }
  }

  // If outputDir is specified, ensure it exists
  const effectiveOutputDir = options.outputDir
    ? path.resolve(process.cwd(), options.outputDir)
    : mediaDir;
  if (!isStdout && options.outputDir && !fs.existsSync(effectiveOutputDir)) {
    fs.mkdirSync(effectiveOutputDir, { recursive: true });
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

  const glossaryInput = options.glossary?.trim() || rawConfig.glossary;
  const transcriptionContext = resolveTranscriptionContext(rawConfig, stt, {
    whisperPrompt: options.whisperPrompt,
    glossary: glossaryInput,
  });

  const { maxLength: resolvedMaxLength, maxDuration: resolvedMaxDuration } = resolveReflowLimits(
    options,
    rawConfig.maxLength,
  );

  const noReflow = Boolean(options.noReflow);

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
  let wordChunks: WordChunk[] | undefined;
  let detectedLanguage: string | undefined;
  let transcriptionCacheHit = false;
  let audioPaths: string[] = [];
  let totalAudioBytes = 0;
  let cleanupAudio: (() => Promise<void>) | null = null;

  const isTranscriptionCacheMatch =
    useCache && isTranscriptionCacheValid(mediaCache?.transcription, transcriptionContext);

  if (isTranscriptionCacheMatch && mediaCache?.transcription) {
    transcriptionCacheHit = true;
    srtEntries = mediaCache.transcription.entries;
    wordChunks = mediaCache.transcription.wordChunks;
    detectedLanguage = mediaCache.transcription.detectedLanguage;

    const langDisplay = detectedLanguage ? ` (${detectedLanguage.toUpperCase()})` : "";
    showSpinnerNotice(spinner, verbose, "info", `${prefix}${m.step1SkipCache}`);
    spinner.succeed(`${prefix}${m.step2UseCached(langDisplay, srtEntries.length)}`);
  } else {
    // Ensure API Key and FFmpeg only when transcription is needed
    const config = await ensureApiKeys(rawConfig, {
      requireGroq: stt.provider === "groq",
      requireOpenRouter: stt.provider === "openrouter",
      requireGemini: false,
      lang,
    });
    rawConfig = config;
    await checkFfmpeg(config.ffmpegPath);

    if (stt.source === "auto" && stt.provider === "groq" && !isStdout && !options.silentSttHint) {
      showSpinnerNotice(spinner, verbose, "info", `${prefix}${m.sttGroqAutoHint}`);
    }

    // 1. Audio extraction / optimization
    const audioStartMsg = isAudio ? m.step1Optimizing : m.step1Extracting;
    spinner.start(`${prefix}${audioStartMsg}`);
    const transcriber = createTranscriber(config, stt.provider);
    const extractResult = await extractAudio(
      resolvedMediaPath,
      config.ffmpegPath,
      transcriber.limits,
      verbose,
    );
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

    // 2. Transcription
    const providerLabel = STT_PROVIDER_LABELS[stt.provider];
    const initialText = `${prefix}${m.step2Transcribing(
      providerLabel,
      stt.model,
      audioPaths.length > 1 ? 1 : undefined,
      audioPaths.length > 1 ? audioPaths.length : undefined,
    )}`;
    spinner.start(initialText);

    const transcriptResult = await transcribeAudioSegments(
      audioPaths,
      transcriber,
      verbose,
      (current, total) => {
        if (total > 1) {
          spinner.updateText(
            `${prefix}${m.step2Transcribing(providerLabel, stt.model, current, total)}`,
          );
        }
      },
      {
        model: stt.model,
        ...(transcriptionContext.prompt ? { prompt: transcriptionContext.prompt } : {}),
        ...(extractResult.durations ? { durations: extractResult.durations } : {}),
      },
    );

    srtEntries = transcriptResult.entries;
    wordChunks = transcriptResult.wordChunks;
    detectedLanguage = transcriptResult.detectedLanguage;

    if (srtEntries.length === 0) {
      showSpinnerNotice(spinner, verbose, "warn", `${prefix}${m.step2NoEntries}`);
    } else {
      const langDisplay = detectedLanguage ? ` (${detectedLanguage.toUpperCase()})` : "";
      spinner.succeed(`${prefix}${m.step2Done(langDisplay, srtEntries.length)}`);

      if (!options.noCache) {
        saveTranscriptionCache(
          resolvedMediaPath,
          createCachedTranscription(transcriptionContext, srtEntries, detectedLanguage, wordChunks),
          options.cacheDir,
        );
      }
    }
  }

  const rawEntriesCount = srtEntries.length;
  if (wordChunks) {
    srtEntries = buildEntriesFromWords(wordChunks, {
      maxLength: resolvedMaxLength,
      maxDuration: resolvedMaxDuration,
      noLimits: noReflow,
    });
  } else if (!noReflow && srtEntries.length > 0) {
    srtEntries = reflowSrtEntries(srtEntries, {
      maxLength: resolvedMaxLength,
      maxDuration: resolvedMaxDuration,
    });
    if (verbose && srtEntries.length !== rawEntriesCount) {
      console.error(
        `${prefix}[Reflow] Adjusted subtitle segments: ${rawEntriesCount} -> ${srtEntries.length} entries`,
      );
    }
  }

  try {
    let activeConfig: ReturnType<typeof getConfig> | null = null;
    let sharedTextModel: ReturnType<typeof createTextModel> | null = null;
    const getTextModel = async () => {
      if (!activeConfig) {
        activeConfig = await ensureApiKeys(rawConfig, {
          requireGroq: false,
          requireGemini: llm.provider === "gemini",
          requireOpenRouter: llm.provider === "openrouter",
          lang,
        });
      }
      if (!sharedTextModel) {
        sharedTextModel = createTextModel(activeConfig, llm, { lang });
      }
      return sharedTextModel;
    };

    const translationPrompt = options.prompt?.trim() || rawConfig.prompt;
    const resolvedConcurrency = resolveConcurrency(options.concurrency, rawConfig.concurrency);

    let refinementResult: ProcessMediaResult["refinement"];
    if (resolveRefine(options.refine, rawConfig.refine)) {
      const refined = await refineSourceEntries({
        sourceEntries: srtEntries,
        detectedLanguage,
        glossaryTargetLang: targetLanguages[0],
        cacheFilePath: resolvedMediaPath,
        mediaCache,
        useCache,
        noCache: Boolean(options.noCache),
        cacheDir: options.cacheDir,
        prompt: translationPrompt,
        glossaryInput,
        concurrency: resolvedConcurrency,
        llm: {
          provider: llm.provider,
          model: llm.model,
        },
        getTextModel,
        spinner,
        prefix,
        verbose,
        lang,
      });
      srtEntries = refined.entries;
      refinementResult = {
        changedLines: refined.changedLines,
        totalLines: refined.totalLines,
        cached: refined.cached,
        fallbackChunks: refined.fallbackChunks,
      };
    }

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
        lang,
      });
      if (rawSafety.backedUp.length > 0) {
        safetyCheck.backedUp.push(...rawSafety.backedUp);
      }

      if (!rawSafety.proceed) {
        const skippedOriginalNames = outputFormats.map((fmt) => `${baseOriginalName}.${fmt}`);
        showSpinnerNotice(
          spinner,
          verbose,
          "info",
          `${prefix}${m.skippedOriginal(skippedOriginalNames.join(", "))}`,
        );
      } else {
        const savedOriginalNames: string[] = [];
        for (const fmt of outputFormats) {
          const originalFilename = `${baseOriginalName}.${fmt}`;
          const originalPath = path.join(effectiveOutputDir, originalFilename);
          fs.writeFileSync(originalPath, formatEntries(srtEntries, fmt), "utf-8");
          outputFiles.push(originalPath);
          savedOriginalNames.push(originalFilename);
        }
        showSpinnerNotice(
          spinner,
          verbose,
          "info",
          `${prefix}${m.savedOriginal(savedOriginalNames.join(", "))}`,
        );
      }
    }

    // 3. Text Generation Translation for each target language
    const resolvedContextWindow = resolveContextWindowSize(options.contextWindow);

    const {
      resultsByLang,
      skippedLanguages,
      translatedLanguages,
      cachedLanguages,
      totalGlossaryTerms,
    } = await translateToTargets({
      sourceEntries: srtEntries,
      targetLanguages,
      cacheFilePath: resolvedMediaPath,
      mediaCache,
      useCache,
      noCache: Boolean(options.noCache),
      cacheDir: options.cacheDir,
      prompt: translationPrompt,
      glossaryInput,
      contextWindowSize: resolvedContextWindow,
      concurrency: resolvedConcurrency,
      llm: {
        provider: llm.provider,
        model: llm.model,
      },
      getTextModel,
      shouldSkip: (targetL) => {
        const isSameLanguage = Boolean(
          detectedLanguage && detectedLanguage.toLowerCase() === targetL.toLowerCase(),
        );
        const shouldSkip =
          Boolean(options.noTranslate) || (isSameLanguage && !options.forceTranslate);

        if (shouldSkip) {
          if (options.noTranslate) {
            showSpinnerNotice(
              spinner,
              verbose,
              "info",
              `${prefix}🌐 [3/4] [--no-translate] ${targetL.toUpperCase()}`,
            );
          } else if (isSameLanguage) {
            showSpinnerNotice(
              spinner,
              verbose,
              "info",
              `${prefix}${m.step3SkippedSameLang(detectedLanguage?.toUpperCase() ?? "", targetL.toUpperCase())}`,
            );
          }
        }

        return shouldSkip;
      },
      messages: {
        translatingSingle: (provider, model, targetL, cur, tot) =>
          m.step3TranslatingSingle(provider, model, targetL, cur, tot),
        translatingMulti: (provider, model, idx, cnt, targetL, cur, tot) =>
          m.step3TranslatingMulti(provider, model, idx, cnt, targetL, cur, tot),
      },
      spinner,
      prefix,
      verbose,
      lang,
    });

    if (translatedLanguages.length > 0) {
      const langListDisplay = translatedLanguages.map((l) => l.toUpperCase()).join(", ");
      const providerLabel = LLM_PROVIDER_LABELS[llm.provider];
      spinner.succeed(
        `${prefix}${m.step3AllDone(providerLabel, langListDisplay, srtEntries.length, translatedLanguages.length > 0 && cachedLanguages.length === translatedLanguages.length)}`,
      );
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
        const targets = subtitleTargetsByLang.get(targetL) ?? [];
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

            const burntVideoPath = burntVideoPathsByLang.get(targetL);
            if (!burntVideoPath) {
              continue;
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

          if (embeddedVideoPath && subtitleTracks.length > 0) {
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
      whisperPrompt: transcriptionContext.prompt,
      prompt: translationPrompt,
      glossaryTermsCount: totalGlossaryTerms > 0 ? totalGlossaryTerms : undefined,
      sttProvider: stt.provider,
      sttModel: stt.model,
      llmProvider: llm.provider,
      llmModel: llm.model,
      refinement: refinementResult,
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
        showSpinnerNotice(
          spinner,
          verbose,
          "info",
          `${prefix}${m.keptAudio(audioPaths.join(", "))}`,
        );
      }
    }
  }
}

export interface ResolveTranscriptOptions {
  filePath: string;
  sttProvider?: string | undefined;
  sttModel?: string | undefined;
  groqModel?: string | undefined;
  whisperPrompt?: string | undefined;
  glossary?: string | undefined;
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

  const rawConfig = getConfig(undefined, options.lang);
  const lang = options.lang ?? rawConfig.lang ?? "en";
  const { config: resolvedConfig, stt } = resolveSttSettings(
    rawConfig,
    {
      sttProvider: options.sttProvider,
      sttModel: options.sttModel,
      groqModel: options.groqModel,
    },
    lang,
  );
  const transcriptionContext = resolveTranscriptionContext(resolvedConfig, stt, {
    whisperPrompt: options.whisperPrompt,
    glossary: options.glossary,
  });

  const useCache = !options.noCache && !options.fresh;
  const mediaCache = useCache ? loadMediaCache(resolvedPath, options.cacheDir) : null;
  const isMatch =
    useCache && isTranscriptionCacheValid(mediaCache?.transcription, transcriptionContext);

  if (isMatch && mediaCache?.transcription) {
    return {
      entries: mediaCache.transcription.entries,
      detectedLanguage: mediaCache.transcription.detectedLanguage,
      fromCache: true,
      isSubtitleFile: false,
    };
  }

  // Not cached, transcribe via provider
  const config = await ensureApiKeys(resolvedConfig, {
    requireGroq: stt.provider === "groq",
    requireOpenRouter: stt.provider === "openrouter",
    requireGemini: false,
    lang,
  });
  await checkFfmpeg(config.ffmpegPath);

  const verbose = Boolean(options.verbose);
  const transcriber = createTranscriber(config, stt.provider);
  const extractResult = await extractAudio(
    resolvedPath,
    config.ffmpegPath,
    transcriber.limits,
    verbose,
  );
  const audioPaths = extractResult.audioPaths;

  try {
    const transcriptResult = await transcribeAudioSegments(
      audioPaths,
      transcriber,
      verbose,
      undefined,
      {
        model: stt.model,
        ...(transcriptionContext.prompt ? { prompt: transcriptionContext.prompt } : {}),
        ...(extractResult.durations ? { durations: extractResult.durations } : {}),
      },
    );

    if (!options.noCache) {
      saveTranscriptionCache(
        resolvedPath,
        createCachedTranscription(
          transcriptionContext,
          transcriptResult.entries,
          transcriptResult.detectedLanguage,
          transcriptResult.wordChunks,
        ),
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

interface TextTaskOptions {
  inputFile: string;
  targetLang?: string | undefined;
  output?: string | undefined;
  stdout?: boolean | undefined;
  overwrite?: boolean | undefined;
  backup?: boolean | undefined;
  geminiModel?: string | undefined;
  llmProvider?: string | undefined;
  llmModel?: string | undefined;
  groqModel?: string | undefined;
  sttProvider?: string | undefined;
  sttModel?: string | undefined;
  whisperPrompt?: string | undefined;
  prompt?: string | undefined;
  glossary?: string | undefined;
  noCache?: boolean | undefined;
  fresh?: boolean | undefined;
  cacheDir?: string | undefined;
  verbose?: boolean | undefined;
  lang?: SupportedLanguage | undefined;
}

function warnTextTask(
  spinner: ReturnType<typeof createSpinner>,
  quiet: boolean,
  message: string,
): void {
  if (quiet) {
    console.error(`⚠ ${message}`);
  } else {
    spinner.warn(message);
  }
}

async function prepareTextTask<Format extends string>(
  options: TextTaskOptions & { format?: Format | undefined },
  presentation: {
    defaultFormat: Format;
    outputSuffix: string;
    extension: (format: Format) => string;
    icon: string;
    started: (file: string) => string;
    singleTargetLang: (used: string, requested: string) => string;
  },
) {
  const verbose = Boolean(options.verbose);
  const isStdout = Boolean(options.stdout || options.output === "-");
  const lang = options.lang || "en";
  const i18n = getI18n(lang);
  const resolvedInput = path.resolve(options.inputFile);
  if (!fs.existsSync(resolvedInput)) {
    throw new Error(i18n.pipeline.mediaNotFound(resolvedInput));
  }

  const format = options.format || presentation.defaultFormat;
  const rawConfig = getConfig(undefined, lang);
  const { config: resolvedConfig, stt } = resolveSttSettings(
    rawConfig,
    {
      sttProvider: options.sttProvider,
      sttModel: options.sttModel,
      groqModel: options.groqModel,
    },
    lang,
  );
  const { config: resolvedLlmConfig, llm } = resolveLlmSettings(
    resolvedConfig,
    {
      llmProvider: options.llmProvider,
      llmModel: options.llmModel,
      geminiModel: options.geminiModel,
    },
    lang,
  );
  const targetLanguages = parseTargetLanguages(
    resolveTargetLang(options.targetLang, resolvedLlmConfig.targetLang),
    lang,
  );
  const targetLang = targetLanguages[0] ?? "ja";
  const glossaryInput = options.glossary?.trim() || rawConfig.glossary;
  const glossary = glossaryInput ? parseGlossary(glossaryInput, targetLang) : undefined;
  const glossaryHash = glossary ? computeGlossaryHash(glossary) : undefined;
  const transcriptionContext = resolveTranscriptionContext(resolvedConfig, stt, {
    whisperPrompt: options.whisperPrompt,
    glossary: options.glossary,
  });

  let outputPath: string | undefined;
  if (!isStdout) {
    if (options.output) {
      outputPath = path.resolve(process.cwd(), options.output);
    } else {
      const parsed = path.parse(resolvedInput);
      const ext = presentation.extension(format);
      outputPath = path.join(parsed.dir, `${parsed.name}.${presentation.outputSuffix}.${ext}`);
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
    console.log(
      `\n${presentation.icon} ${pc.bold(presentation.started(pc.cyan(path.basename(resolvedInput))))}`,
    );
  }

  const spinner = createSpinner("", { isSilent: verbose || isStdout });

  if (options.targetLang?.trim() && targetLanguages.length > 1) {
    warnTextTask(
      spinner,
      isStdout || verbose,
      presentation.singleTargetLang(targetLang, targetLanguages.join(",")),
    );
  }

  // Resolve reusable transcript context before checking the generated result.
  const useCache = !options.noCache && !options.fresh;
  const isSrt = resolvedInput.toLowerCase().endsWith(".srt");
  const mediaCache = useCache && !isSrt ? loadMediaCache(resolvedInput, options.cacheDir) : null;

  const isTranscriptionValid =
    !isSrt && isTranscriptionCacheValid(mediaCache?.transcription, transcriptionContext);
  function generatedCacheContext(sourceEntries: SrtEntry[]): GeneratedCacheContext {
    return {
      sourceEntries,
      provider: llm.provider,
      prompt: options.prompt,
      model: llm.model,
      glossaryHash,
    };
  }

  return {
    verbose,
    isStdout,
    lang,
    resolvedInput,
    format,
    resolvedLlmConfig,
    llm,
    targetLang,
    glossary,
    outputPath,
    spinner,
    useCache,
    isSrt,
    mediaCache,
    cachedSourceEntries: isTranscriptionValid ? mediaCache?.transcription?.entries : undefined,
    generatedCacheContext,
  };
}

type TextTaskPreparation = Awaited<ReturnType<typeof prepareTextTask>>;

async function resolveTextTaskTranscript(
  options: TextTaskOptions,
  prepared: TextTaskPreparation,
  texts: Pick<I18nMessages["chapters"], "step1Resolve" | "noEntries" | "step1Parsed">,
) {
  const { resolvedLlmConfig, llm, lang, spinner, resolvedInput, verbose } = prepared;
  // Ensure Text Model API Key
  const config = await ensureApiKeys(resolvedLlmConfig, {
    requireGemini: llm.provider === "gemini",
    requireOpenRouter: llm.provider === "openrouter",
    requireGroq: false,
    lang,
  });
  const textModel = createTextModel(config, llm, { lang });

  // Step 1: Resolve transcript entries
  spinner.start(texts.step1Resolve);
  const transcriptResult = await resolveTranscriptEntries({
    filePath: resolvedInput,
    sttProvider: options.sttProvider,
    sttModel: options.sttModel,
    groqModel: options.groqModel,
    whisperPrompt: options.whisperPrompt,
    glossary: options.glossary,
    noCache: options.noCache,
    fresh: options.fresh,
    cacheDir: options.cacheDir,
    verbose,
    lang,
    spinner,
  });

  if (transcriptResult.entries.length === 0) {
    spinner.fail(texts.noEntries);
    throw new Error(texts.noEntries);
  }
  spinner.succeed(texts.step1Parsed(transcriptResult.entries.length));

  return { textModel, transcriptResult };
}

function writeTextTaskOutput(
  formattedOutput: string,
  { isStdout, outputPath, spinner }: TextTaskPreparation,
  texts: Pick<I18nMessages["chapters"], "step3Saving" | "step3Saved">,
): void {
  if (isStdout) {
    process.stdout.write(formattedOutput);
  } else if (outputPath) {
    spinner.start(texts.step3Saving);
    fs.writeFileSync(outputPath, formattedOutput, "utf-8");
    spinner.succeed(texts.step3Saved(pc.cyan(path.basename(outputPath))));
  }
}

export interface ProcessChaptersOptions extends TextTaskOptions {
  format?: ChaptersFormat | undefined;
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
  const cm = getI18n(options.lang || "en").chapters;
  const prepared = await prepareTextTask(options, {
    defaultFormat: "txt",
    outputSuffix: "chapters",
    extension: (format) => (format === "json" ? "json" : format === "vtt" ? "vtt" : "txt"),
    icon: "📑",
    started: cm.started,
    singleTargetLang: cm.singleTargetLang,
  });
  const {
    verbose,
    isStdout,
    lang,
    resolvedInput,
    format,
    llm,
    targetLang,
    outputPath,
    spinner,
    useCache,
    isSrt,
    mediaCache,
    cachedSourceEntries,
    generatedCacheContext,
  } = prepared;
  const cachedChapters = mediaCache?.chapters?.[targetLang.toLowerCase()];

  const isChaptersValid =
    useCache &&
    cachedSourceEntries &&
    isChaptersCacheValid(cachedChapters, generatedCacheContext(cachedSourceEntries));

  function finishChapters(
    rawChapters: ChapterItem[],
    entries: SrtEntry[],
    fromCache: boolean,
    transcriptionFromCache: boolean,
  ): ProcessChaptersResult {
    const lastEntry = entries.at(-1);
    const endMilliseconds = lastEntry ? parseSrtTime(lastEntry.endTime) : 0;
    const endSeconds = endMilliseconds > 0 ? endMilliseconds / 1000 : undefined;
    const chapters = normalizeChapters(rawChapters, { targetLang, endSeconds });
    spinner.succeed(fromCache ? cm.step2Cached(chapters.length) : cm.step2Done(chapters.length));
    if (chapters.length < MIN_YOUTUBE_CHAPTERS) {
      warnTextTask(spinner, isStdout || verbose, cm.tooFewChapters(chapters.length));
    }

    // Preserve raw boundaries so future normalization rules can reuse the cache.
    if (!fromCache && !options.noCache && !isSrt) {
      saveChaptersCache(
        resolvedInput,
        targetLang,
        createCachedChapters(targetLang, generatedCacheContext(entries), rawChapters),
        options.cacheDir,
      );
    }

    const formattedOutput = formatChapters(chapters, format, endSeconds);
    writeTextTaskOutput(formattedOutput, prepared, cm);

    return {
      inputFile: resolvedInput,
      outputFile: outputPath,
      chapters,
      formattedOutput,
      durationMs: Date.now() - startTime,
      fromCache,
      transcriptionFromCache,
    };
  }

  if (isChaptersValid && cachedChapters && mediaCache?.transcription) {
    return finishChapters(cachedChapters.chapters, mediaCache.transcription.entries, true, true);
  }

  const { textModel, transcriptResult } = await resolveTextTaskTranscript(options, prepared, cm);

  // Step 2: Generate chapters with LLM
  const providerLabel = LLM_PROVIDER_LABELS[llm.provider];
  spinner.start(cm.step2Generating(providerLabel, llm.model, targetLang.toUpperCase()));
  const chapters = await generateChapters(transcriptResult.entries, textModel, {
    targetLang,
    glossary: prepared.glossary,
    prompt: options.prompt,
    lang,
    verbose,
  });
  return finishChapters(chapters, transcriptResult.entries, false, transcriptResult.fromCache);
}

export interface ProcessSummaryOptions extends TextTaskOptions {
  format?: SummaryFormat | undefined;
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
  const sm = getI18n(options.lang || "en").summarize;
  const prepared = await prepareTextTask(options, {
    defaultFormat: "md",
    outputSuffix: "summary",
    extension: (format) => (format === "json" ? "json" : format === "txt" ? "txt" : "md"),
    icon: "📝",
    started: sm.started,
    singleTargetLang: sm.singleTargetLang,
  });
  const {
    verbose,
    lang,
    resolvedInput,
    format,
    llm,
    targetLang,
    outputPath,
    spinner,
    useCache,
    isSrt,
    mediaCache,
    cachedSourceEntries,
    generatedCacheContext,
  } = prepared;
  const cachedSummary = mediaCache?.summaries?.[targetLang.toLowerCase()];

  const isSummaryValid =
    useCache &&
    cachedSourceEntries &&
    isSummaryCacheValid(cachedSummary, generatedCacheContext(cachedSourceEntries));

  if (isSummaryValid && cachedSummary) {
    const summary = cachedSummary.summary;
    spinner.succeed(sm.step2Cached);

    const formattedOutput = formatSummary(summary, format);
    writeTextTaskOutput(formattedOutput, prepared, sm);

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

  const { textModel, transcriptResult } = await resolveTextTaskTranscript(options, prepared, sm);

  // Step 2: Generate summary with LLM
  const providerLabel = LLM_PROVIDER_LABELS[llm.provider];
  spinner.start(sm.step2Generating(providerLabel, llm.model, targetLang.toUpperCase()));
  const summary = await generateSummary(transcriptResult.entries, textModel, {
    targetLang,
    glossary: prepared.glossary,
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
      createCachedSummary(targetLang, generatedCacheContext(transcriptResult.entries), summary),
      options.cacheDir,
    );
  }

  // Step 3: Format and save or stdout
  const formattedOutput = formatSummary(summary, format);
  writeTextTaskOutput(formattedOutput, prepared, sm);

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
