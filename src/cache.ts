import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_GEMINI_MODEL, DEFAULT_GROQ_MODEL } from "./config.js";
import type { ChapterItem, SummaryResult } from "./formatter.js";
import type { SrtEntry } from "./srt.js";
import { DEFAULT_OPENROUTER_LLM_MODEL } from "./text/openrouter.js";
import type { LlmProvider } from "./text/providers.js";
import { DEFAULT_OPENROUTER_STT_MODEL } from "./transcribe/openrouter.js";
import type { SttProvider } from "./transcribe/providers.js";
import type { WordChunk } from "./transcribe/words.js";

export interface CachedTranscription {
  diarize?: true | undefined;
  detectedLanguage?: string | undefined;
  provider?: SttProvider | undefined;
  entries: SrtEntry[];
  /** Raw word timings; subtitles are rebuilt from these with the current options. */
  wordChunks?: WordChunk[] | undefined;
  model?: string | undefined;
  baseUrl?: string | undefined;
  prompt?: string | undefined;
  createdAt: number;
}

export interface CachedRefinement {
  contextHash?: string | undefined;
  provider?: LlmProvider | undefined;
  model?: string | undefined;
  baseUrl?: string | undefined;
  prompt?: string | undefined;
  glossaryHash?: string | undefined;
  /** computeEntriesHash() of the entries that were refined (after building and reflow). */
  sourceHash?: string | undefined;
  entries: SrtEntry[];
  createdAt: number;
}

export interface CachedTranslation {
  contextHash?: string | undefined;
  targetLang: string;
  provider?: LlmProvider | undefined;
  model?: string | undefined;
  baseUrl?: string | undefined;
  prompt?: string | undefined;
  glossaryHash?: string | undefined;
  sourceHash?: string | undefined;
  contextWindowSize?: number | undefined;
  /** Chunk size used when the partial chunks were saved. */
  chunkSize?: number | undefined;
  /** Finished translations keyed by zero-based chunk index while incomplete. */
  partialChunks?: Record<string, string[]> | undefined;
  entries: SrtEntry[];
  createdAt: number;
}

export interface CachedChapters {
  targetLang: string;
  provider?: LlmProvider | undefined;
  model?: string | undefined;
  baseUrl?: string | undefined;
  prompt?: string | undefined;
  glossaryHash?: string | undefined;
  sourceHash?: string | undefined;
  chapters: ChapterItem[];
  createdAt: number;
}

export interface CachedSummary {
  targetLang: string;
  provider?: LlmProvider | undefined;
  model?: string | undefined;
  baseUrl?: string | undefined;
  prompt?: string | undefined;
  glossaryHash?: string | undefined;
  sourceHash?: string | undefined;
  summary: SummaryResult;
  createdAt: number;
}

export interface TranscriptionCacheContext {
  diarize?: boolean | undefined;
  provider?: SttProvider | undefined;
  prompt?: string | undefined;
  model?: string | undefined;
  baseUrl?: string | undefined;
}

function normalizeCacheString(value?: string): string {
  return value === undefined ? "" : value.trim();
}

function normalizeModelForProvider(provider: SttProvider, model?: string): string {
  const norm = normalizeCacheString(model);
  if (norm !== "") return norm;
  if (provider === "openai-compatible") return "";
  return provider === "openrouter" ? DEFAULT_OPENROUTER_STT_MODEL : DEFAULT_GROQ_MODEL;
}

function normalizeModelForLlmProvider(provider: LlmProvider, model?: string): string {
  const norm = normalizeCacheString(model);
  if (norm !== "") return norm;
  if (provider === "openai-compatible") return "";
  return provider === "openrouter" ? DEFAULT_OPENROUTER_LLM_MODEL : DEFAULT_GEMINI_MODEL;
}

/**
 * Checks if cached transcription matches current prompt and model requirements.
 */
export function isTranscriptionCacheValid(
  cached: CachedTranscription | undefined,
  context: TranscriptionCacheContext,
): boolean {
  if (!cached) return false;
  if (Boolean(cached.diarize) !== Boolean(context.diarize)) return false;
  if (normalizeCacheString(cached.prompt) !== normalizeCacheString(context.prompt)) {
    return false;
  }
  const cachedProvider: SttProvider = cached.provider ?? "groq";
  const contextProvider: SttProvider = context.provider ?? "groq";
  if (
    contextProvider === "openai-compatible" &&
    normalizeCacheString(cached.baseUrl) !== normalizeCacheString(context.baseUrl)
  )
    return false;
  if (cachedProvider !== contextProvider) {
    return false;
  }
  if (
    normalizeModelForProvider(cachedProvider, cached.model) !==
    normalizeModelForProvider(contextProvider, context.model)
  ) {
    return false;
  }
  return true;
}

/**
 * Creates a CachedTranscription object bound to the given context and entries.
 */
export function createCachedTranscription(
  context: TranscriptionCacheContext,
  entries: SrtEntry[],
  detectedLanguage?: string | undefined,
  wordChunks?: WordChunk[] | undefined,
): CachedTranscription {
  return {
    detectedLanguage,
    provider: context.provider,
    baseUrl: context.provider === "openai-compatible" ? context.baseUrl : undefined,
    model: context.model,
    prompt: context.prompt,
    entries,
    ...(wordChunks ? { wordChunks } : {}),
    ...(context.diarize ? { diarize: true } : {}),
    createdAt: Date.now(),
  };
}

/**
 * Computes a sha256 hash of subtitle entries, including speaker labels only when present.
 */
export function computeEntriesHash(entries: SrtEntry[]): string {
  const payload = JSON.stringify(
    entries.map((e) => [e.id, e.startTime, e.endTime, e.text, ...(e.speaker ? [e.speaker] : [])]),
  );
  return crypto.createHash("sha256").update(payload).digest("hex");
}

export interface TranslationCacheContext {
  contextHash?: string | undefined;
  sourceEntries: SrtEntry[];
  provider?: LlmProvider | undefined;
  prompt?: string | undefined;
  glossaryHash?: string | undefined;
  model?: string | undefined;
  baseUrl?: string | undefined;
  contextWindowSize: number;
}

export interface RefinementCacheContext {
  contextHash?: string | undefined;
  sourceEntries: SrtEntry[];
  provider?: LlmProvider | undefined;
  model?: string | undefined;
  baseUrl?: string | undefined;
  prompt?: string | undefined;
  glossaryHash?: string | undefined;
}

export interface GeneratedCacheContext {
  sourceEntries: SrtEntry[];
  provider?: LlmProvider | undefined;
  prompt?: string | undefined;
  glossaryHash?: string | undefined;
  model?: string | undefined;
  baseUrl?: string | undefined;
}

function isLlmSourceCacheValid(
  cached:
    | {
        sourceHash?: string | undefined;
        provider?: LlmProvider | undefined;
        prompt?: string | undefined;
        model?: string | undefined;
        baseUrl?: string | undefined;
      }
    | undefined,
  context: GeneratedCacheContext,
): boolean {
  if (!cached) return false;
  if (!cached.sourceHash || cached.sourceHash !== computeEntriesHash(context.sourceEntries)) {
    return false;
  }
  if (normalizeCacheString(cached.prompt) !== normalizeCacheString(context.prompt)) {
    return false;
  }
  const cachedProvider: LlmProvider = cached.provider ?? "gemini";
  const contextProvider: LlmProvider = context.provider ?? "gemini";
  if (
    contextProvider === "openai-compatible" &&
    normalizeCacheString(cached.baseUrl) !== normalizeCacheString(context.baseUrl)
  )
    return false;
  if (cachedProvider !== contextProvider) {
    return false;
  }
  if (
    normalizeModelForLlmProvider(cachedProvider, cached.model) !==
    normalizeModelForLlmProvider(contextProvider, context.model)
  ) {
    return false;
  }
  return true;
}

/**
 * Checks if cached refinement matches current source entries, prompt, glossary, and model requirements.
 */
export function isRefinementCacheValid(
  cached: CachedRefinement | undefined,
  context: RefinementCacheContext,
): boolean {
  if (!cached || !isLlmSourceCacheValid(cached, context)) {
    return false;
  }
  if (cached.entries.length === 0 || cached.entries.length !== context.sourceEntries.length) {
    return false;
  }
  if (normalizeCacheString(cached.contextHash) !== normalizeCacheString(context.contextHash)) {
    return false;
  }
  if (normalizeCacheString(cached.glossaryHash) !== normalizeCacheString(context.glossaryHash)) {
    return false;
  }
  return true;
}

/**
 * Creates a CachedRefinement object bound to the given context and refined entries.
 */
export function createCachedRefinement(
  context: RefinementCacheContext,
  refinedEntries: SrtEntry[],
): CachedRefinement {
  return {
    provider: context.provider,
    baseUrl: context.provider === "openai-compatible" ? context.baseUrl : undefined,
    model: context.model,
    prompt: context.prompt,
    glossaryHash: context.glossaryHash,
    sourceHash: computeEntriesHash(context.sourceEntries),
    entries: refinedEntries,
    contextHash: context.contextHash,
    createdAt: Date.now(),
  };
}

/**
 * Checks if cached translation matches current source entries, prompt, glossary, and model requirements.
 */
export function isTranslationCacheValid(
  cached: CachedTranslation | undefined,
  context: TranslationCacheContext,
): boolean {
  return (
    hasTranslationCacheContext(cached, context) &&
    cached !== undefined &&
    cached.entries.length > 0 &&
    cached.entries.length === context.sourceEntries.length
  );
}

function hasTranslationCacheContext(
  cached: CachedTranslation | undefined,
  context: TranslationCacheContext,
): boolean {
  if (!cached || !isLlmSourceCacheValid(cached, context)) return false;
  if (normalizeCacheString(cached.contextHash) !== normalizeCacheString(context.contextHash)) {
    return false;
  }
  if (normalizeCacheString(cached.glossaryHash) !== normalizeCacheString(context.glossaryHash)) {
    return false;
  }
  if (cached.contextWindowSize !== context.contextWindowSize) {
    return false;
  }
  return true;
}

/** Creates an incomplete translation using the same cache context as a full result. */
export function createPartialTranslation(
  targetLang: string,
  context: TranslationCacheContext,
  chunkSize: number,
  partialChunks: Record<string, string[]>,
): CachedTranslation {
  return { ...createCachedTranslation(targetLang, context, []), chunkSize, partialChunks };
}

/** Selects only well-formed chunks whose context matches the current translation. */
export function getPartialTranslationChunks(
  cached: CachedTranslation | undefined,
  targetLang: string,
  context: TranslationCacheContext,
  chunkSize: number,
): Record<string, string[]> {
  if (
    !cached ||
    !hasTranslationCacheContext(cached, context) ||
    cached.targetLang !== targetLang ||
    cached.chunkSize !== chunkSize ||
    !cached.partialChunks ||
    cached.entries.length !== 0
  )
    return {};

  const totalChunks = Math.ceil(context.sourceEntries.length / chunkSize);
  const chunks: Record<string, string[]> = {};
  for (const [key, texts] of Object.entries(cached.partialChunks)) {
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0 || index >= totalChunks || String(index) !== key)
      continue;
    const expectedLength = Math.min(chunkSize, context.sourceEntries.length - index * chunkSize);
    if (
      Array.isArray(texts) &&
      texts.length === expectedLength &&
      texts.every((text) => typeof text === "string")
    ) {
      chunks[key] = texts;
    }
  }
  return chunks;
}

/**
 * Creates a CachedTranslation object bound to the given context and translated entries.
 */
export function createCachedTranslation(
  targetLang: string,
  context: TranslationCacheContext,
  translatedEntries: SrtEntry[],
): CachedTranslation {
  return {
    targetLang,
    provider: context.provider,
    baseUrl: context.provider === "openai-compatible" ? context.baseUrl : undefined,
    model: context.model,
    prompt: context.prompt,
    glossaryHash: context.glossaryHash,
    sourceHash: computeEntriesHash(context.sourceEntries),
    contextWindowSize: context.contextWindowSize,
    entries: translatedEntries,
    contextHash: context.contextHash,
    createdAt: Date.now(),
  };
}

/**
 * Checks if cached chapters match current prompt, model, and source entries requirements.
 */
export function isChaptersCacheValid(
  cached: CachedChapters | undefined,
  context: GeneratedCacheContext,
): boolean {
  return isGeneratedCacheValid(cached, context);
}

/**
 * Checks if cached summary matches current prompt, model, and source entries requirements.
 */
export function isSummaryCacheValid(
  cached: CachedSummary | undefined,
  context: GeneratedCacheContext,
): boolean {
  return isGeneratedCacheValid(cached, context);
}

function isGeneratedCacheValid(
  cached: CachedChapters | CachedSummary | undefined,
  context: GeneratedCacheContext,
): boolean {
  return (
    isLlmSourceCacheValid(cached, context) &&
    normalizeCacheString(cached?.glossaryHash) === normalizeCacheString(context.glossaryHash)
  );
}

function createCachedTextTask<T extends { chapters: ChapterItem[] } | { summary: SummaryResult }>(
  targetLang: string,
  context: GeneratedCacheContext,
  content: T,
) {
  return {
    targetLang,
    provider: context.provider,
    baseUrl: context.provider === "openai-compatible" ? context.baseUrl : undefined,
    model: context.model,
    prompt: context.prompt,
    glossaryHash: context.glossaryHash,
    sourceHash: computeEntriesHash(context.sourceEntries),
    ...content,
    createdAt: Date.now(),
  };
}

/**
 * Creates a CachedChapters object bound to the given context and chapters.
 */
export function createCachedChapters(
  targetLang: string,
  context: GeneratedCacheContext,
  chapters: ChapterItem[],
): CachedChapters {
  return createCachedTextTask(targetLang, context, { chapters });
}

/**
 * Creates a CachedSummary object bound to the given context and summary.
 */
export function createCachedSummary(
  targetLang: string,
  context: GeneratedCacheContext,
  summary: SummaryResult,
): CachedSummary {
  return createCachedTextTask(targetLang, context, { summary });
}

export interface MediaCacheData {
  version: 2;
  /** Absolute path where the media was last seen (informational; not part of the key). */
  mediaPath: string;
  mediaSize: number;
  transcription?: CachedTranscription | undefined;
  refinement?: CachedRefinement | undefined;
  translations?: Record<string, CachedTranslation> | undefined;
  chapters?: Record<string, CachedChapters> | undefined;
  summaries?: Record<string, CachedSummary> | undefined;
  createdAt: number;
  updatedAt: number;
}

/**
 * Resolves the directory path for storing cache files.
 */
export function getCacheDir(customDir?: string): string {
  if (customDir) {
    return path.resolve(process.cwd(), customDir);
  }
  if (process.env["VSUB_CACHE_DIR"]) {
    return path.resolve(process.env["VSUB_CACHE_DIR"]);
  }

  const isWindows = process.platform === "win32";
  if (isWindows) {
    const localAppData =
      process.env["LOCALAPPDATA"] ||
      process.env["APPDATA"] ||
      path.join(os.homedir(), "AppData", "Local");
    return path.join(localAppData, "vsub", "cache");
  }

  const cacheHome = process.env["XDG_CACHE_HOME"] || path.join(os.homedir(), ".cache");
  return path.join(cacheHome, "vsub");
}

const SAMPLE_BYTES = 1024 * 1024;
const fileCacheKeys = new Map<string, { size: number; mtimeMs: number; key: string }>();

/** Generates a cache key from the file size and sampled content. */
export function getFileCacheKey(filePath: string): string {
  const resolved = path.resolve(filePath);
  const stat = fs.statSync(resolved);
  const cached = fileCacheKeys.get(resolved);
  if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) {
    return cached.key;
  }

  const hash = crypto.createHash("sha256").update(`v2:${stat.size}:`);
  const readSize = Math.min(stat.size, 3 * SAMPLE_BYTES);
  const offsets =
    stat.size <= 3 * SAMPLE_BYTES
      ? [0]
      : [0, Math.floor((stat.size - SAMPLE_BYTES) / 2), stat.size - SAMPLE_BYTES];
  const buffer = Buffer.alloc(stat.size <= 3 * SAMPLE_BYTES ? readSize : SAMPLE_BYTES);
  const fd = fs.openSync(resolved, "r");
  try {
    for (const position of offsets) {
      let offset = 0;
      while (offset < buffer.length) {
        const bytesRead = fs.readSync(
          fd,
          buffer,
          offset,
          buffer.length - offset,
          position + offset,
        );
        if (bytesRead === 0) throw new Error("Unexpected end of file while computing cache key");
        offset += bytesRead;
      }
      hash.update(buffer);
    }
  } finally {
    fs.closeSync(fd);
  }
  const key = hash.digest("hex");
  fileCacheKeys.set(resolved, { size: stat.size, mtimeMs: stat.mtimeMs, key });
  return key;
}

function getLegacyFileCacheKey(resolved: string, stat: fs.Stats): string {
  return crypto
    .createHash("sha256")
    .update(`v1:${resolved}:${stat.size}:${stat.mtimeMs}`)
    .digest("hex");
}

function getCacheFilePath(filePath: string, customCacheDir?: string): string {
  const key = getFileCacheKey(filePath);
  const dir = getCacheDir(customCacheDir);
  return path.join(dir, `${key}.json`);
}

/**
 * Loads content-keyed media data, migrating a matching legacy cache when needed.
 */
export function loadMediaCache(filePath: string, customCacheDir?: string): MediaCacheData | null {
  try {
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved)) {
      return null;
    }
    const stat = fs.statSync(resolved);
    const cacheFile = getCacheFilePath(filePath, customCacheDir);

    if (!fs.existsSync(cacheFile)) {
      const legacyFile = path.join(
        getCacheDir(customCacheDir),
        `${getLegacyFileCacheKey(resolved, stat)}.json`,
      );
      if (!fs.existsSync(legacyFile)) return null;
      const legacy = JSON.parse(fs.readFileSync(legacyFile, "utf-8")) as Omit<
        MediaCacheData,
        "version"
      > & { version: 1; mediaMtimeMs: number };
      if (
        legacy.version !== 1 ||
        legacy.mediaSize !== stat.size ||
        legacy.mediaMtimeMs !== stat.mtimeMs ||
        legacy.mediaPath !== resolved
      ) {
        return null;
      }
      const { mediaMtimeMs: _mtime, ...rest } = legacy;
      const migrated: MediaCacheData = {
        ...rest,
        version: 2,
        mediaPath: resolved,
        mediaSize: stat.size,
      };
      try {
        fs.writeFileSync(cacheFile, JSON.stringify(migrated, null, 2), "utf-8");
        fs.unlinkSync(legacyFile);
      } catch {
        // Non-fatal if cache migration cannot be persisted.
      }
      return migrated;
    }

    const raw = fs.readFileSync(cacheFile, "utf-8");
    const data = JSON.parse(raw) as MediaCacheData;

    if (data.version === 2 && data.mediaSize === stat.size) {
      return data;
    }

    return null;
  } catch {
    return null;
  }
}

function updateMediaCache(
  filePath: string,
  customCacheDir: string | undefined,
  buildPatch: (existing: MediaCacheData | null) => Partial<MediaCacheData>,
): void {
  try {
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved)) return;

    const stat = fs.statSync(resolved);
    const dir = getCacheDir(customCacheDir);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const cacheFile = getCacheFilePath(filePath, customCacheDir);
    const existing = loadMediaCache(filePath, customCacheDir);
    const patch = buildPatch(existing);

    const now = Date.now();
    const data: MediaCacheData = {
      version: 2,
      mediaPath: resolved,
      mediaSize: stat.size,
      transcription: existing?.transcription,
      refinement: existing?.refinement,
      translations: existing?.translations,
      chapters: existing?.chapters,
      summaries: existing?.summaries,
      ...patch,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    fs.writeFileSync(cacheFile, JSON.stringify(data, null, 2), "utf-8");
  } catch {
    // Non-fatal if cache save fails
  }
}

/**
 * Saves or updates transcription results in media cache.
 */
export function saveTranscriptionCache(
  filePath: string,
  transcription: CachedTranscription,
  customCacheDir?: string,
): void {
  updateMediaCache(filePath, customCacheDir, (existing) => ({
    transcription,
    translations: existing?.translations ?? {},
  }));
}

/**
 * Saves or updates transcript refinement results in media cache.
 */
export function saveRefinementCache(
  filePath: string,
  refinement: CachedRefinement,
  customCacheDir?: string,
): void {
  updateMediaCache(filePath, customCacheDir, () => ({
    refinement,
  }));
}

/**
 * Saves or updates translation results for a specific target language in media cache.
 */
export function saveTranslationCache(
  filePath: string,
  targetLang: string,
  translation: CachedTranslation,
  customCacheDir?: string,
): void {
  updateMediaCache(filePath, customCacheDir, (existing) => {
    const translations = existing?.translations ?? {};
    translations[targetLang.toLowerCase()] = translation;
    return { translations };
  });
}

/**
 * Saves or updates chapters results for a specific target language in media cache.
 */
export function saveChaptersCache(
  filePath: string,
  targetLang: string,
  chaptersData: CachedChapters,
  customCacheDir?: string,
): void {
  updateMediaCache(filePath, customCacheDir, (existing) => {
    const chapters = existing?.chapters ?? {};
    chapters[targetLang.toLowerCase()] = chaptersData;
    return { chapters };
  });
}

/**
 * Saves or updates summary results for a specific target language in media cache.
 */
export function saveSummaryCache(
  filePath: string,
  targetLang: string,
  summaryData: CachedSummary,
  customCacheDir?: string,
): void {
  updateMediaCache(filePath, customCacheDir, (existing) => {
    const summaries = existing?.summaries ?? {};
    summaries[targetLang.toLowerCase()] = summaryData;
    return { summaries };
  });
}

export interface CacheStats {
  cacheDir: string;
  count: number;
  totalBytes: number;
}

/**
 * Returns statistics about cached files.
 */
export function getCacheStats(customCacheDir?: string): CacheStats {
  const dir = getCacheDir(customCacheDir);
  if (!fs.existsSync(dir)) {
    return { cacheDir: dir, count: 0, totalBytes: 0 };
  }

  try {
    const files = fs.readdirSync(dir);
    let count = 0;
    let totalBytes = 0;

    for (const file of files) {
      if (file.endsWith(".json")) {
        const filePath = path.join(dir, file);
        try {
          const stat = fs.statSync(filePath);
          if (stat.isFile()) {
            count++;
            totalBytes += stat.size;
          }
        } catch {
          // ignore
        }
      }
    }

    return { cacheDir: dir, count, totalBytes };
  } catch {
    return { cacheDir: dir, count: 0, totalBytes: 0 };
  }
}

export interface ClearCacheResult {
  cacheDir: string;
  deletedCount: number;
  freedBytes: number;
}

/**
 * Clears all cached media metadata and subtitle files.
 */
export function clearCache(customCacheDir?: string): ClearCacheResult {
  const dir = getCacheDir(customCacheDir);
  if (!fs.existsSync(dir)) {
    return { cacheDir: dir, deletedCount: 0, freedBytes: 0 };
  }

  let deletedCount = 0;
  let freedBytes = 0;

  try {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      if (file.endsWith(".json")) {
        const filePath = path.join(dir, file);
        try {
          const stat = fs.statSync(filePath);
          freedBytes += stat.size;
          fs.unlinkSync(filePath);
          deletedCount++;
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // ignore
  }

  return { cacheDir: dir, deletedCount, freedBytes };
}
