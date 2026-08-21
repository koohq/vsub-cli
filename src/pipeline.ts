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
import { ensureApiKeys, getConfig } from "./config.js";
import { burnSubtitlesToVideo, checkFfmpeg, extractAudio, isAudioFile } from "./ffmpeg.js";
import { formatEntries, type OutputFormat, parseOutputFormats } from "./formatter.js";
import { translateSrtEntries } from "./gemini.js";
import { computeGlossaryHash, extractWhisperPromptHints, parseGlossary } from "./glossary.js";
import { transcribeAudioSegments } from "./groq.js";
import { parseTargetLanguages } from "./languages.js";
import { ensureWritableTargets } from "./safety.js";
import type { BilingualOrder, SrtEntry } from "./srt.js";
import { mergeBilingualEntries } from "./srt.js";
import { createSpinner, formatFileSize, formatSummaryBox } from "./ui.js";

/**
 * Validates and normalizes bilingual order option.
 */
export function parseBilingualOrder(input?: string): BilingualOrder {
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

  const outputFormats = parseOutputFormats(options.format || "srt");
  const targetLanguages = parseTargetLanguages(options.targetLang || "ja");
  const isMultiLang = targetLanguages.length > 1;
  const isBilingual = Boolean(options.bilingual);
  const bilingualOrder = parseBilingualOrder(options.bilingualOrder);
  const resolvedMediaPath = path.resolve(process.cwd(), options.mediaFile);

  if (!fs.existsSync(resolvedMediaPath)) {
    throw new Error(`メディアファイルが見つかりません: ${resolvedMediaPath}`);
  }

  const rawConfig = getConfig(options.ffmpegPath);
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
  for (const lang of targetLanguages) {
    const targets = resolveOutputFilePaths(
      mediaDir,
      mediaBaseName,
      lang,
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
    for (const lang of targetLanguages) {
      let burntVideoPath: string;
      const langTag = isBilingual ? `${lang}.bilingual` : lang;
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
  });

  if (!safetyCheck.proceed) {
    throw new Error(
      "既存ファイルの競合により処理が中断されました。(--overwrite または --backup を指定してください)",
    );
  }

  if (safetyCheck.backedUp.length > 0) {
    for (const { original, backup } of safetyCheck.backedUp) {
      console.log(
        `${prefix}📦 バックアップを作成しました: ${pc.cyan(path.basename(original))} -> ${pc.yellow(path.basename(backup))}`,
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
    throw new Error(
      "音声ファイルには字幕を焼き込めません。--burn オプションは動画ファイル（.mp4, .mkv, .mov 等）でのみ使用できます。",
    );
  }
  const mediaTypeName = isAudio ? "audio" : "video";
  const mediaIcon = isAudio ? "🎵" : "🎬";

  if (!options.silentSummary) {
    console.log(
      `\n${mediaIcon} ${pc.bold("vsub-cli")} - 処理開始: ${pc.cyan(path.basename(resolvedMediaPath))}`,
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

    const langDisplay = detectedLanguage ? ` (言語: ${detectedLanguage.toUpperCase()})` : "";
    spinner.info(
      `${prefix}🔊 [1/4] 文字起こしキャッシュが存在するため音声抽出をスキップ [⚡ キャッシュ利用]`,
    );
    spinner.succeed(
      `${prefix}🎙️ [2/4] キャッシュされた文字起こし結果を利用${langDisplay} - ${srtEntries.length} 行の字幕 [⚡ キャッシュ利用]`,
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
    spinner.start(`${prefix}🔊 [1/4] 音声を${audioAction} (16kHz mono / low bitrate)...`);
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
      `${prefix}🔊 [1/4] 音声${audioDoneAction} (${audioPaths.length} セグメント / ${formatFileSize(totalAudioBytes)})`,
    );

    // 2. Transcription with Groq
    const initialGroqText =
      audioPaths.length > 1
        ? `${prefix}🎙️ [2/4] Groq Whisper API で文字起こし中 [1/${audioPaths.length}]...`
        : `${prefix}🎙️ [2/4] Groq Whisper API で文字起こし中...`;
    spinner.start(initialGroqText);

    const transcriptResult = await transcribeAudioSegments(
      audioPaths,
      config.groqApiKey,
      verbose,
      (current, total) => {
        if (total > 1) {
          spinner.updateText(
            `${prefix}🎙️ [2/4] Groq Whisper API で文字起こし中 [${current}/${total}]...`,
          );
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
      spinner.warn(`${prefix}⚠️ [2/4] 文字起こし結果から有効な字幕エントリが検出されませんでした`);
    } else {
      const langDisplay = detectedLanguage ? ` (言語: ${detectedLanguage})` : "";
      spinner.succeed(
        `${prefix}🎙️ [2/4] 文字起こし完了${langDisplay} - ${srtEntries.length} 行の字幕を生成`,
      );

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
            `${prefix}ℹ️ [3/4] [--no-translate] ${lang.toUpperCase()} の Gemini 翻訳をスキップしました`,
          );
        } else if (isSameLanguage) {
          spinner.info(
            `${prefix}ℹ️ [3/4] 検出言語 (${detectedLanguage?.toUpperCase()}) と一致するため ${lang.toUpperCase()} の翻訳をスキップしました`,
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
        isTranslationCacheValid(cachedTranslation, translationPrompt, glossaryHash, geminiModel);

      if (isCacheValid && cachedTranslation && cachedTranslation.entries.length > 0) {
        resultsByLang.set(lang, cachedTranslation.entries);
        cachedLanguages.push(lang);
        translatedLanguages.push(lang);

        if (isMultiLang) {
          spinner.info(
            `${prefix}  ✔ ${lang.toUpperCase()} 翻訳 (キャッシュ利用: ${cachedTranslation.entries.length} 行) [⚡ キャッシュ利用]`,
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

      const initialText = isMultiLang
        ? `${prefix}🌐 [3/4] Gemini API で翻訳中 (${i + 1}/${targetLanguages.length} 言語: ${lang.toUpperCase()} [1/${totalChunks} チャンク])...`
        : `${prefix}🌐 [3/4] Gemini API で ${lang} に翻訳中 [1/${totalChunks} チャンク]...`;

      spinner.start(initialText);

      const translatedEntries = await translateSrtEntries(
        srtEntries,
        lang,
        activeConfig.geminiApiKey,
        verbose,
        (currentChunk, chunksCount) => {
          if (isMultiLang) {
            spinner.updateText(
              `${prefix}🌐 [3/4] Gemini API で翻訳中 (${i + 1}/${targetLanguages.length} 言語: ${lang.toUpperCase()} [${currentChunk}/${chunksCount} チャンク])...`,
            );
          } else {
            spinner.updateText(
              `${prefix}🌐 [3/4] Gemini API で ${lang} に翻訳中 [${currentChunk}/${chunksCount} チャンク]...`,
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
      translatedLanguages.push(lang);

      if (!options.noCache) {
        saveTranslationCache(
          resolvedMediaPath,
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
        spinner.info(
          `${prefix}  ✔ ${lang.toUpperCase()} 翻訳完了 (${translatedEntries.length} 行)`,
        );
      }
    }

    if (translatedLanguages.length > 0) {
      const langListDisplay = translatedLanguages.map((l) => l.toUpperCase()).join(", ");
      spinner.succeed(
        `${prefix}🌐 [3/4] Gemini 翻訳完了 (${langListDisplay}) - ${srtEntries.length} 行`,
      );
    }

    // 4. Save output subtitle files
    spinner.start(`${prefix}💾 [4/4] 字幕ファイルを保存中...`);

    const savedSrtPathsByLang = new Map<string, string>();
    const tempSrtFilesToCleanup: string[] = [];

    for (const lang of targetLanguages) {
      let entries = resultsByLang.get(lang) ?? srtEntries;
      if (isBilingual) {
        entries = mergeBilingualEntries(srtEntries, entries, { order: bilingualOrder });
      }
      const targets = resolveOutputFilePaths(
        mediaDir,
        mediaBaseName,
        lang,
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
          savedSrtPathsByLang.set(lang, filePath);
        }
      }

      if (options.burn && !savedSrtPathsByLang.has(lang)) {
        const tempSrtPath = path.join(
          os.tmpdir(),
          `vsub-burn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${lang}.srt`,
        );
        fs.writeFileSync(tempSrtPath, formatEntries(entries, "srt"), "utf-8");
        savedSrtPathsByLang.set(lang, tempSrtPath);
        tempSrtFilesToCleanup.push(tempSrtPath);
      }
    }

    const formatListStr = outputFormats.map((f) => f.toUpperCase()).join(", ");
    spinner.succeed(`${prefix}💾 [4/4] 字幕ファイルを保存完了 (${formatListStr})`);

    // 5. Burn subtitles to video if --burn option is specified
    if (options.burn) {
      try {
        spinner.start(
          `${prefix}🎬 字幕を動画に焼き込み中 (libx264)...${isMultiLang ? ` (0/${targetLanguages.length})` : ""}`,
        );

        for (let i = 0; i < targetLanguages.length; i++) {
          const lang = targetLanguages[i] ?? "ja";
          const srtPathToUse = savedSrtPathsByLang.get(lang);
          if (!srtPathToUse || !fs.existsSync(srtPathToUse)) {
            continue;
          }

          let burntVideoPath: string;
          const langTag = isBilingual ? `${lang}.bilingual` : lang;
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
              `${prefix}🎬 字幕を動画に焼き込み中 (${i + 1}/${targetLanguages.length} 言語: ${lang.toUpperCase()})...`,
            );
          }

          await burnSubtitlesToVideo(resolvedMediaPath, srtPathToUse, burntVideoPath, {
            ffmpegPath: rawConfig.ffmpegPath,
            verbose,
          });

          outputFiles.push(burntVideoPath);

          if (isMultiLang) {
            spinner.info(
              `${prefix}  ✔ ${lang.toUpperCase()} 字幕焼き込み動画を生成: ${path.basename(burntVideoPath)}`,
            );
          }
        }

        spinner.succeed(`${prefix}🎬 字幕の動画焼き込みが完了しました`);
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
      cacheStatus:
        transcriptionCacheHit || cachedLanguages.length > 0
          ? {
              transcriptionHit: transcriptionCacheHit,
              cachedLanguages,
            }
          : undefined,
    };

    if (!options.silentSummary) {
      console.log(`\n${formatSummaryBox(result)}\n`);
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
