import {
  createCachedTranslation,
  isTranslationCacheValid,
  type MediaCacheData,
  saveTranslationCache,
  type TranslationCacheContext,
} from "./cache.js";
import { computeGlossaryHash, parseGlossary } from "./glossary.js";
import { getI18n, type SupportedLanguage } from "./i18n/index.js";
import type { SrtEntry } from "./srt.js";
import type { TextModel } from "./text/model.js";
import { LLM_PROVIDER_LABELS, type LlmProvider } from "./text/providers.js";
import { DEFAULT_CONTEXT_WINDOW_SIZE, translateSrtEntries } from "./text/tasks.js";
import type { ProgressSpinner } from "./ui.js";

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
  glossaryInput?: string | undefined;
  contextWindowSize: number;
  concurrency?: number | undefined;
  /** LLM provider and model shown in the spinner and stored in the cache. */
  llm: {
    provider: LlmProvider;
    model: string;
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
  const totalChunks = Math.max(1, Math.ceil(params.sourceEntries.length / 50));
  let totalGlossaryTerms = 0;
  const i18n = getI18n(params.lang);

  for (let i = 0; i < params.targetLanguages.length; i++) {
    const targetL = params.targetLanguages[i] ?? "ja";

    if (params.shouldSkip?.(targetL)) {
      skippedLanguages.push(targetL);
      resultsByLang.set(targetL, params.sourceEntries);
      continue;
    }

    const glossaryMap = params.glossaryInput
      ? parseGlossary(params.glossaryInput, targetL)
      : undefined;
    const glossaryHash = glossaryMap ? computeGlossaryHash(glossaryMap) : undefined;
    if (glossaryMap) {
      totalGlossaryTerms = Math.max(totalGlossaryTerms, Object.keys(glossaryMap).length);
    }

    const providerLabel = LLM_PROVIDER_LABELS[params.llm.provider];

    const cacheContext: TranslationCacheContext = {
      sourceEntries: params.sourceEntries,
      prompt: params.prompt,
      glossaryHash,
      provider: params.llm.provider,
      model: params.llm.model,
      contextWindowSize: params.contextWindowSize,
    };

    const cachedTranslation = params.mediaCache?.translations?.[targetL.toLowerCase()];
    const isCacheValid =
      params.useCache && isTranslationCacheValid(cachedTranslation, cacheContext);

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

    if (!textModel) {
      textModel = await params.getTextModel();
    }

    const initialText = isMultiLang
      ? `${params.prefix}${params.messages.translatingMulti(providerLabel, params.llm.model, i + 1, params.targetLanguages.length, targetL.toUpperCase(), 1, totalChunks)}`
      : `${params.prefix}${params.messages.translatingSingle(providerLabel, params.llm.model, targetL, 1, totalChunks)}`;

    params.spinner.start(initialText);

    const translatedEntries = await translateSrtEntries(
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
        glossary: glossaryMap,
        concurrency: params.concurrency,
        lang: params.lang,
        contextWindowSize: params.contextWindowSize,
      },
    );

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
