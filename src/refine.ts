import {
  createCachedRefinement,
  isRefinementCacheValid,
  type MediaCacheData,
  type RefinementCacheContext,
  saveRefinementCache,
} from "./cache.js";
import { computeContextHash } from "./context-notes.js";
import { computeGlossaryHash, type FlatGlossary, parseGlossary } from "./glossary.js";
import { getI18n, type SupportedLanguage } from "./i18n/index.js";
import type { SrtEntry } from "./srt.js";
import type { TextModel } from "./text/model.js";
import {
  LLM_PROVIDER_LABELS,
  type LlmProvider,
  type LlmReasoningEffort,
} from "./text/providers.js";
import { DEFAULT_CHUNK_SIZE, refineSrtEntries } from "./text/tasks.js";
import { type ProgressSpinner, showSpinnerNotice } from "./ui.js";

export interface RefineSourceEntriesParams {
  sourceEntries: SrtEntry[];
  detectedLanguage?: string | undefined;
  glossaryTargetLang?: string | undefined;
  /** Input file the refinement cache belongs to. */
  cacheFilePath: string;
  mediaCache: MediaCacheData | null;
  useCache: boolean; // !noCache && !fresh
  noCache: boolean; // do not save
  cacheDir?: string | undefined;
  prompt?: string | undefined;
  contextNotes?: string | undefined;
  glossaryInput?: string | undefined;
  glossary?: FlatGlossary | undefined;
  cacheSlot?: "refinement" | "textTaskRefinement" | undefined;
  messages?:
    | {
        refining(provider: string, model: string, current: number, total: number): string;
        refined(changed: number, total: number, cached: boolean): string;
        fallbackWarn(fallbackChunks: number, totalChunks: number): string;
      }
    | undefined;
  warn?: ((message: string) => void) | undefined;
  concurrency?: number | undefined;
  /** LLM provider and model shown in the spinner and stored in the cache. */
  llm: {
    provider: LlmProvider;
    model: string;
    baseUrl?: string | undefined;
    reasoningEffort?: LlmReasoningEffort | undefined;
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

type RefinementLookupParams = Pick<
  RefineSourceEntriesParams,
  | "sourceEntries"
  | "llm"
  | "prompt"
  | "contextNotes"
  | "glossary"
  | "glossaryInput"
  | "glossaryTargetLang"
  | "lang"
  | "mediaCache"
  | "useCache"
  | "cacheSlot"
>;

function resolveGlossary(params: RefinementLookupParams): FlatGlossary | undefined {
  return (
    params.glossary ??
    (params.glossaryInput
      ? parseGlossary(params.glossaryInput, params.glossaryTargetLang, params.lang)
      : undefined)
  );
}

function refinementCacheContext(params: RefinementLookupParams): RefinementCacheContext {
  const glossary = resolveGlossary(params);
  return {
    sourceEntries: params.sourceEntries,
    ...params.llm,
    prompt: params.prompt,
    glossaryHash: glossary ? computeGlossaryHash(glossary) : undefined,
    contextHash: params.contextNotes ? computeContextHash(params.contextNotes) : undefined,
  };
}

/** Looks up corrected entries without creating a model or changing the cache. */
export function findCachedRefinement(params: RefinementLookupParams): SrtEntry[] | undefined {
  if (!params.useCache) return undefined;
  const cached = params.mediaCache?.[params.cacheSlot ?? "refinement"];
  return cached && isRefinementCacheValid(cached, refinementCacheContext(params))
    ? cached.entries
    : undefined;
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
  const messages = params.messages ?? {
    refining: i18n.pipeline.step2Refining,
    refined: i18n.pipeline.step2Refined,
    fallbackWarn: i18n.pipeline.step2RefineFallbackWarn,
  };
  const glossaryMap = resolveGlossary(params);
  const cacheParams = { ...params, glossary: glossaryMap };
  const cachedEntries = findCachedRefinement(cacheParams);
  if (cachedEntries) {
    const changedLines = countChangedLines(params.sourceEntries, cachedEntries);
    params.spinner.succeed(
      `${params.prefix}${messages.refined(changedLines, params.sourceEntries.length, true)}`,
    );
    return {
      entries: cachedEntries,
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
    `${params.prefix}${messages.refining(providerLabel, params.llm.model, 1, totalChunks)}`,
  );

  const refined = await refineSrtEntries(
    params.sourceEntries,
    textModel,
    params.verbose,
    (currentChunk, chunksCount) => {
      params.spinner.updateText(
        `${params.prefix}${messages.refining(providerLabel, params.llm.model, currentChunk, chunksCount)}`,
      );
    },
    {
      language: params.detectedLanguage,
      notes: params.prompt,
      contextNotes: params.contextNotes,
      glossary: glossaryMap,
      concurrency: params.concurrency,
      lang: params.lang,
    },
  );

  if (!params.noCache && refined.fallbackChunks === 0) {
    saveRefinementCache(
      params.cacheFilePath,
      createCachedRefinement(refinementCacheContext(cacheParams), refined.entries),
      params.cacheDir,
      ...(params.cacheSlot ? ([params.cacheSlot] as const) : []),
    );
  }

  const changedLines = countChangedLines(params.sourceEntries, refined.entries);
  params.spinner.succeed(
    `${params.prefix}${messages.refined(changedLines, params.sourceEntries.length, false)}`,
  );

  if (refined.fallbackChunks > 0) {
    const message = `${params.prefix}${messages.fallbackWarn(refined.fallbackChunks, refined.totalChunks)}`;
    if (params.warn) params.warn(message);
    else showSpinnerNotice(params.spinner, params.verbose, "warn", message);
  }

  return {
    entries: refined.entries,
    changedLines,
    totalLines: params.sourceEntries.length,
    cached: false,
    fallbackChunks: refined.fallbackChunks,
  };
}
