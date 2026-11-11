import {
  createCachedRefinement,
  isRefinementCacheValid,
  type MediaCacheData,
  type RefinementCacheContext,
  saveRefinementCache,
} from "./cache.js";
import { computeGlossaryHash, parseGlossary } from "./glossary.js";
import { getI18n, type SupportedLanguage } from "./i18n/index.js";
import type { SrtEntry } from "./srt.js";
import type { TextModel } from "./text/model.js";
import { LLM_PROVIDER_LABELS, type LlmProvider } from "./text/providers.js";
import { DEFAULT_CHUNK_SIZE, refineSrtEntries } from "./text/tasks.js";
import { type ProgressSpinner, showSpinnerNotice } from "./ui.js";

export interface RefineSourceEntriesParams {
  sourceEntries: SrtEntry[];
  detectedLanguage?: string | undefined;
  glossaryTargetLang?: string | undefined;
  /** File the refinement cache belongs to (the media file). */
  cacheFilePath: string;
  mediaCache: MediaCacheData | null;
  useCache: boolean; // !noCache && !fresh
  noCache: boolean; // do not save
  cacheDir?: string | undefined;
  prompt?: string | undefined;
  glossaryInput?: string | undefined;
  concurrency?: number | undefined;
  /** LLM provider and model shown in the spinner and stored in the cache. */
  llm: {
    provider: LlmProvider;
    model: string;
  };
  /** Called at most once on cache miss (pipeline checks the key lazily). */
  getTextModel: () => Promise<TextModel>;
  spinner: ProgressSpinner;
  prefix: string;
  verbose: boolean;
  lang: SupportedLanguage;
}

export interface RefineSourceEntriesResult {
  entries: SrtEntry[];
  changedLines: number;
  totalLines: number;
  cached: boolean;
  fallbackChunks: number;
}

function countChangedLines(source: SrtEntry[], refined: SrtEntry[]): number {
  let changed = 0;
  for (let i = 0; i < source.length; i++) {
    if (source[i]?.text !== refined[i]?.text) {
      changed++;
    }
  }
  return changed;
}

/**
 * Refines ASR transcript entries before saving original subtitles or translating,
 * using cache when valid and resolving the text model lazily on cache miss.
 */
export async function refineSourceEntries(
  params: RefineSourceEntriesParams,
): Promise<RefineSourceEntriesResult> {
  if (params.sourceEntries.length === 0) {
    return {
      entries: [],
      changedLines: 0,
      totalLines: 0,
      cached: false,
      fallbackChunks: 0,
    };
  }

  const i18n = getI18n(params.lang);
  const glossaryMap = params.glossaryInput
    ? parseGlossary(params.glossaryInput, params.glossaryTargetLang, params.lang)
    : undefined;
  const glossaryHash = glossaryMap ? computeGlossaryHash(glossaryMap) : undefined;

  const cacheContext: RefinementCacheContext = {
    sourceEntries: params.sourceEntries,
    provider: params.llm.provider,
    model: params.llm.model,
    prompt: params.prompt,
    glossaryHash,
  };

  const cachedRefinement = params.mediaCache?.refinement;
  if (
    params.useCache &&
    cachedRefinement &&
    isRefinementCacheValid(cachedRefinement, cacheContext)
  ) {
    const changedLines = countChangedLines(params.sourceEntries, cachedRefinement.entries);
    params.spinner.succeed(
      `${params.prefix}${i18n.pipeline.step2Refined(changedLines, params.sourceEntries.length, true)}`,
    );
    return {
      entries: cachedRefinement.entries,
      changedLines,
      totalLines: params.sourceEntries.length,
      cached: true,
      fallbackChunks: 0,
    };
  }

  const textModel = await params.getTextModel();
  const providerLabel = LLM_PROVIDER_LABELS[params.llm.provider];
  const totalChunks = Math.max(1, Math.ceil(params.sourceEntries.length / DEFAULT_CHUNK_SIZE));

  params.spinner.start(
    `${params.prefix}${i18n.pipeline.step2Refining(providerLabel, params.llm.model, 1, totalChunks)}`,
  );

  const refined = await refineSrtEntries(
    params.sourceEntries,
    textModel,
    params.verbose,
    (currentChunk, chunksCount) => {
      params.spinner.updateText(
        `${params.prefix}${i18n.pipeline.step2Refining(providerLabel, params.llm.model, currentChunk, chunksCount)}`,
      );
    },
    {
      language: params.detectedLanguage,
      notes: params.prompt,
      glossary: glossaryMap,
      concurrency: params.concurrency,
      lang: params.lang,
    },
  );

  if (!params.noCache && refined.fallbackChunks === 0) {
    saveRefinementCache(
      params.cacheFilePath,
      createCachedRefinement(cacheContext, refined.entries),
      params.cacheDir,
    );
  }

  const changedLines = countChangedLines(params.sourceEntries, refined.entries);
  params.spinner.succeed(
    `${params.prefix}${i18n.pipeline.step2Refined(changedLines, params.sourceEntries.length, false)}`,
  );

  if (refined.fallbackChunks > 0) {
    showSpinnerNotice(
      params.spinner,
      params.verbose,
      "warn",
      `${params.prefix}${i18n.pipeline.step2RefineFallbackWarn(refined.fallbackChunks, refined.totalChunks)}`,
    );
  }

  return {
    entries: refined.entries,
    changedLines,
    totalLines: params.sourceEntries.length,
    cached: false,
    fallbackChunks: refined.fallbackChunks,
  };
}
