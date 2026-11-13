import {
  createCachedSceneNotes,
  createCachedTranslation,
  createPartialTranslation,
  type GeneratedCacheContext,
  getPartialTranslationChunks,
  isSceneNotesCacheValid,
  isTranslationCacheValid,
  loadMediaCache,
  type MediaCacheData,
  saveSceneNotesCache,
  saveTranslationCache,
  type TranslationCacheContext,
} from "./cache.js";
import { computeContextHash } from "./context-notes.js";
import { computeGlossaryHash, parseGlossary } from "./glossary.js";
import { getI18n, type SupportedLanguage } from "./i18n/index.js";
import type { SrtEntry } from "./srt.js";
import type { TextModel } from "./text/model.js";
import { LLM_PROVIDER_LABELS, type LlmProvider } from "./text/providers.js";
import {
  DEFAULT_CHUNK_SIZE,
  DEFAULT_CONTEXT_WINDOW_SIZE,
  generateSceneNotes,
  SCENE_NOTES_PROMPT_ID,
  translateSrtEntries,
} from "./text/tasks.js";
import { type ProgressSpinner, showSpinnerNotice } from "./ui.js";

export interface TranslateToTargetsParams {
  sourceEntries: SrtEntry[];
  targetLanguages: string[];
  /** File the translation cache belongs to (the media file or the subtitle file). */
  cacheFilePath: string;
  mediaCache: MediaCacheData | null;
  useCache: boolean; // !noCache && !fresh
  noCache: boolean; // do not save
  cacheDir?: string | undefined;
  prompt?: string | undefined;
  contextNotes?: string | undefined;
  autoContext?: boolean | undefined;
  glossaryInput?: string | undefined;
  contextWindowSize: number;
  concurrency?: number | undefined;
  /** LLM provider and model shown in the spinner and stored in the cache. */
  llm: {
    provider: LlmProvider;
    model: string;
    baseUrl?: string | undefined;
  };
  /** Called at most once, on the first cache miss (pipeline checks the key lazily). */
  getTextModel: () => Promise<TextModel>;
  /** Returns true to skip a language; the caller prints its own reason. */
  shouldSkip?: ((targetLang: string) => boolean) | undefined;
  messages: {
    translatingSingle: (
      provider: string,
      model: string,
      lang: string,
      current: number,
      total: number,
    ) => string;
    translatingMulti: (
      provider: string,
      model: string,
      langIdx: number,
      langs: number,
      lang: string,
      current: number,
      total: number,
    ) => string;
  };
  spinner: ProgressSpinner;
  prefix: string;
  verbose: boolean;
  lang: SupportedLanguage;
}

export interface TranslateToTargetsResult {
  resultsByLang: Map<string, SrtEntry[]>; // skipped languages map to sourceEntries
  translatedLanguages: string[]; // translated or cached
  cachedLanguages: string[];
  skippedLanguages: string[];
  totalGlossaryTerms: number;
}

export class TranslationStoppedError extends Error {
  constructor(
    cause: unknown,
    public readonly targetLang: string,
    public readonly savedChunks: number,
    public readonly totalChunks: number,
  ) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = "TranslationStoppedError";
  }
}

/** Returns the shared recovery hint only for translations with saved progress. */
export function getTranslationResumeHint(error: unknown, lang?: string): string | undefined {
  if (!(error instanceof TranslationStoppedError)) return undefined;
  return getI18n(lang).pipeline.translationSaved(
    error.targetLang.toUpperCase(),
    error.savedChunks,
    error.totalChunks,
  );
}

export function resolveContextWindowSize(
  optionValue: string | number | undefined,
  defaultValue = DEFAULT_CONTEXT_WINDOW_SIZE,
): number {
  if (optionValue === undefined) return defaultValue;
  const num = Number(optionValue);
  if (Number.isNaN(num)) return defaultValue;
  return Math.max(0, Math.floor(num));
}

export function resolveConcurrency(
  optionValue: string | number | undefined,
  fallbackValue?: number | undefined,
): number | undefined {
  if (optionValue !== undefined) {
    const num = Number(optionValue);
    if (!Number.isNaN(num) && num > 0) {
      return Math.floor(num);
    }
    return undefined;
  }
  if (fallbackValue !== undefined && !Number.isNaN(fallbackValue) && fallbackValue > 0) {
    return Math.floor(fallbackValue);
  }
  return undefined;
}

export async function translateToTargets(
  params: TranslateToTargetsParams,
): Promise<TranslateToTargetsResult> {
  const resultsByLang = new Map<string, SrtEntry[]>();
  const skippedLanguages: string[] = [];
  const translatedLanguages: string[] = [];
  const cachedLanguages: string[] = [];

  let textModel: TextModel | null = null;
  const isMultiLang = params.targetLanguages.length > 1;
  const totalChunks = Math.max(1, Math.ceil(params.sourceEntries.length / DEFAULT_CHUNK_SIZE));
  let totalGlossaryTerms = 0;
  const i18n = getI18n(params.lang);
  if (params.autoContext && params.contextNotes && params.verbose) {
    console.error("[Context] --auto-context is ignored because --context is given.");
  }

  for (let i = 0; i < params.targetLanguages.length; i++) {
    const targetL = params.targetLanguages[i] ?? "ja";

    if (params.shouldSkip?.(targetL)) {
      skippedLanguages.push(targetL);
      resultsByLang.set(targetL, params.sourceEntries);
      continue;
    }

    const glossaryMap = params.glossaryInput
      ? parseGlossary(params.glossaryInput, targetL, params.lang)
      : undefined;
    const glossaryHash = glossaryMap ? computeGlossaryHash(glossaryMap) : undefined;
    if (glossaryMap) {
      totalGlossaryTerms = Math.max(totalGlossaryTerms, Object.keys(glossaryMap).length);
    }

    const providerLabel = LLM_PROVIDER_LABELS[params.llm.provider];

    let contextNotes = params.contextNotes;
    if (params.autoContext && !contextNotes && params.sourceEntries.length > 0) {
      const sceneContext: GeneratedCacheContext = {
        sourceEntries: params.sourceEntries,
        ...params.llm,
        prompt: SCENE_NOTES_PROMPT_ID,
      };
      const cachedNotes = params.mediaCache?.sceneNotes?.[targetL.toLowerCase()];
      const label = targetL.toUpperCase();
      try {
        if (
          params.useCache &&
          !params.noCache &&
          isSceneNotesCacheValid(cachedNotes, sceneContext) &&
          cachedNotes
        ) {
          contextNotes = cachedNotes.notes;
          showSpinnerNotice(
            params.spinner,
            params.verbose,
            "info",
            `${params.prefix}${i18n.pipeline.sceneNotesCached(label, contextNotes.length)}`,
          );
        } else {
          params.spinner.start(`${params.prefix}${i18n.pipeline.sceneNotesCreating(label)}`);
          textModel ??= await params.getTextModel();
          contextNotes = await generateSceneNotes(params.sourceEntries, targetL, textModel, {
            verbose: params.verbose,
            lang: params.lang,
          });
          showSpinnerNotice(
            params.spinner,
            params.verbose,
            "info",
            `${params.prefix}${i18n.pipeline.sceneNotesCreated(label, contextNotes.length)}`,
          );
          if (!params.noCache) {
            saveSceneNotesCache(
              params.cacheFilePath,
              targetL,
              createCachedSceneNotes(targetL, sceneContext, contextNotes),
              params.cacheDir,
            );
          }
        }
        if (params.verbose) console.error(`[Context] Scene notes for ${label}:\n${contextNotes}`);
      } catch (error) {
        contextNotes = undefined;
        showSpinnerNotice(
          params.spinner,
          params.verbose,
          "warn",
          `${params.prefix}${i18n.pipeline.sceneNotesFailed(label, error instanceof Error ? error.message : String(error))}`,
        );
      }
    }
    const contextHash = contextNotes ? computeContextHash(contextNotes) : undefined;

    const cacheContext: TranslationCacheContext = {
      sourceEntries: params.sourceEntries,
      prompt: params.prompt,
      glossaryHash,
      contextHash,
      provider: params.llm.provider,
      baseUrl: params.llm.baseUrl,
      model: params.llm.model,
      contextWindowSize: params.contextWindowSize,
    };

    const cachedTranslation = params.mediaCache?.translations?.[targetL.toLowerCase()];
    const isCacheValid =
      params.useCache &&
      !params.noCache &&
      isTranslationCacheValid(cachedTranslation, cacheContext);

    if (isCacheValid && cachedTranslation) {
      resultsByLang.set(targetL, cachedTranslation.entries);
      cachedLanguages.push(targetL);
      translatedLanguages.push(targetL);

      if (isMultiLang) {
        params.spinner.info(
          `${params.prefix}${i18n.pipeline.step3Cached(targetL.toUpperCase(), cachedTranslation.entries.length)}`,
        );
      }
      continue;
    }

    const completedChunks =
      params.useCache && !params.noCache
        ? getPartialTranslationChunks(cachedTranslation, targetL, cacheContext, DEFAULT_CHUNK_SIZE)
        : {};
    const savedCount = Object.keys(completedChunks).length;
    if (savedCount > 0) {
      showSpinnerNotice(
        params.spinner,
        params.verbose,
        "info",
        `${params.prefix}${i18n.pipeline.translationResuming(targetL.toUpperCase(), savedCount, totalChunks)}`,
      );
    }

    let translatedEntries: SrtEntry[];
    try {
      if (savedCount === totalChunks) {
        translatedEntries = params.sourceEntries.map((entry, index) => ({
          ...entry,
          text:
            completedChunks[String(Math.floor(index / DEFAULT_CHUNK_SIZE))]?.[
              index % DEFAULT_CHUNK_SIZE
            ] ?? entry.text,
        }));
      } else {
        if (!textModel) {
          textModel = await params.getTextModel();
        }

        const initialText = isMultiLang
          ? `${params.prefix}${params.messages.translatingMulti(providerLabel, params.llm.model, i + 1, params.targetLanguages.length, targetL.toUpperCase(), savedCount + 1, totalChunks)}`
          : `${params.prefix}${params.messages.translatingSingle(providerLabel, params.llm.model, targetL, savedCount + 1, totalChunks)}`;

        params.spinner.start(initialText);

        translatedEntries = await translateSrtEntries(
          params.sourceEntries,
          targetL,
          textModel,
          params.verbose,
          (currentChunk, chunksCount) => {
            if (isMultiLang) {
              params.spinner.updateText(
                `${params.prefix}${params.messages.translatingMulti(providerLabel, params.llm.model, i + 1, params.targetLanguages.length, targetL.toUpperCase(), currentChunk, chunksCount)}`,
              );
            } else {
              params.spinner.updateText(
                `${params.prefix}${params.messages.translatingSingle(providerLabel, params.llm.model, targetL, currentChunk, chunksCount)}`,
              );
            }
          },
          {
            prompt: params.prompt,
            contextNotes,
            glossary: glossaryMap,
            concurrency: params.concurrency,
            lang: params.lang,
            contextWindowSize: params.contextWindowSize,
            completedChunks,
            onChunkComplete: (chunkIndex, texts) => {
              if (params.noCache) return;
              completedChunks[String(chunkIndex)] = texts;
              saveTranslationCache(
                params.cacheFilePath,
                targetL,
                createPartialTranslation(
                  targetL,
                  cacheContext,
                  DEFAULT_CHUNK_SIZE,
                  completedChunks,
                ),
                params.cacheDir,
              );
            },
          },
        );
      }
    } catch (error) {
      // Read back persisted progress: cache writes are intentionally non-fatal.
      const saved = params.noCache
        ? {}
        : getPartialTranslationChunks(
            loadMediaCache(params.cacheFilePath, params.cacheDir)?.translations?.[
              targetL.toLowerCase()
            ],
            targetL,
            cacheContext,
            DEFAULT_CHUNK_SIZE,
          );
      const count = Object.keys(saved).length;
      if (count > 0 && (params.useCache || Object.keys(completedChunks).length > 0)) {
        throw new TranslationStoppedError(error, targetL, count, totalChunks);
      }
      throw error;
    }

    resultsByLang.set(targetL, translatedEntries);
    translatedLanguages.push(targetL);

    if (!params.noCache) {
      saveTranslationCache(
        params.cacheFilePath,
        targetL,
        createCachedTranslation(targetL, cacheContext, translatedEntries),
        params.cacheDir,
      );
    }

    if (isMultiLang) {
      params.spinner.info(
        `${params.prefix}${i18n.pipeline.step3LangDone(targetL.toUpperCase(), translatedEntries.length)}`,
      );
    }
  }

  return {
    resultsByLang,
    translatedLanguages,
    cachedLanguages,
    skippedLanguages,
    totalGlossaryTerms,
  };
}
