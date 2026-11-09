import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_GROQ_MODEL } from "./config.js";
import type { ChapterItem, SummaryResult } from "./formatter.js";
import type { SrtEntry } from "./srt.js";
import type { WordChunk } from "./transcribe/words.js";

export interface CachedTranscription {
  detectedLanguage?: string | undefined;
  entries: SrtEntry[];
  /** Raw word timings; subtitles are rebuilt from these with the current options. */
  wordChunks?: WordChunk[] | undefined;
  model?: string | undefined;
  prompt?: string | undefined;
  createdAt: number;
}

export interface CachedTranslation {
  targetLang: string;
  model?: string | undefined;
  prompt?: string | undefined;
  glossaryHash?: string | undefined;
  sourceHash?: string | undefined;
  contextWindowSize?: number | undefined;
  entries: SrtEntry[];
  createdAt: number;
}

export interface CachedChapters {
  targetLang: string;
  model?: string | undefined;
  prompt?: string | undefined;
  sourceHash?: string | undefined;
  chapters: ChapterItem[];
  createdAt: number;
}

export interface CachedSummary {
  targetLang: string;
  model?: string | undefined;
  prompt?: string | undefined;
  sourceHash?: string | undefined;
  summary: SummaryResult;
  createdAt: number;
}

export interface TranscriptionCacheContext {
  prompt?: string | undefined;
  model?: string | undefined;
}

function normalizeCacheString(value?: string): string {
  return value === undefined ? "" : value.trim();
}

function normalizeGroqModel(model?: string): string {
  const norm = normalizeCacheString(model);
  return norm === "" ? DEFAULT_GROQ_MODEL : norm;
}

/**
 * Checks if cached transcription matches current prompt and model requirements.
 */
export function isTranscriptionCacheValid(
  cached: CachedTranscription | undefined,
  context: TranscriptionCacheContext,
): boolean {
  if (!cached) return false;
  if (normalizeCacheString(cached.prompt) !== normalizeCacheString(context.prompt)) {
    return false;
  }
  if (normalizeGroqModel(cached.model) !== normalizeGroqModel(context.model)) {
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
    model: context.model,
    prompt: context.prompt,
    entries,
    ...(wordChunks ? { wordChunks } : {}),
    createdAt: Date.now(),
  };
}

/**
 * Computes a sha256 hash representing the subtitle entries (id, startTime, endTime, text).
 */
export function computeEntriesHash(entries: SrtEntry[]): string {
  const payload = JSON.stringify(entries.map((e) => [e.id, e.startTime, e.endTime, e.text]));
  return crypto.createHash("sha256").update(payload).digest("hex");
}

export interface TranslationCacheContext {
  sourceEntries: SrtEntry[];
  prompt?: string | undefined;
  glossaryHash?: string | undefined;
  model?: string | undefined;
  contextWindowSize: number;
}

/**
 * Checks if cached translation matches current source entries, prompt, glossary, and model requirements.
 */
export function isTranslationCacheValid(
  cached: CachedTranslation | undefined,
  context: TranslationCacheContext,
): boolean {
  if (!cached) return false;
  if (!cached.sourceHash || cached.sourceHash !== computeEntriesHash(context.sourceEntries)) {
    return false;
  }
  if (cached.entries.length === 0 || cached.entries.length !== context.sourceEntries.length) {
    return false;
  }
  if (normalizeCacheString(cached.prompt) !== normalizeCacheString(context.prompt)) {
    return false;
  }
  if (normalizeCacheString(cached.glossaryHash) !== normalizeCacheString(context.glossaryHash)) {
    return false;
  }
  if (normalizeCacheString(cached.model) !== normalizeCacheString(context.model)) {
    return false;
  }
  if (cached.contextWindowSize !== context.contextWindowSize) {
    return false;
  }
  return true;
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
    model: context.model,
    prompt: context.prompt,
    glossaryHash: context.glossaryHash,
    sourceHash: computeEntriesHash(context.sourceEntries),
    contextWindowSize: context.contextWindowSize,
    entries: translatedEntries,
    createdAt: Date.now(),
  };
}

export interface GeneratedCacheContext {
  sourceEntries: SrtEntry[];
  prompt?: string | undefined;
  model?: string | undefined;
}

function isGeneratedCacheValid(
  cached:
    | {
        sourceHash?: string | undefined;
        prompt?: string | undefined;
        model?: string | undefined;
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
  if (normalizeCacheString(cached.model) !== normalizeCacheString(context.model)) {
    return false;
  }
  return true;
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

/**
 * Creates a CachedChapters object bound to the given context and chapters.
 */
export function createCachedChapters(
  targetLang: string,
  context: GeneratedCacheContext,
  chapters: ChapterItem[],
): CachedChapters {
  return {
    targetLang,
    model: context.model,
    prompt: context.prompt,
    sourceHash: computeEntriesHash(context.sourceEntries),
    chapters,
    createdAt: Date.now(),
  };
}

/**
 * Creates a CachedSummary object bound to the given context and summary.
 */
export function createCachedSummary(
  targetLang: string,
  context: GeneratedCacheContext,
  summary: SummaryResult,
): CachedSummary {
  return {
    targetLang,
    model: context.model,
    prompt: context.prompt,
    sourceHash: computeEntriesHash(context.sourceEntries),
    summary,
    createdAt: Date.now(),
  };
}

export interface MediaCacheData {
  version: 1;
  mediaPath: string;
  mediaSize: number;
  mediaMtimeMs: number;
  transcription?: CachedTranscription | undefined;
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

/**
 * Generates a unique cache key based on file path, file size, and modification timestamp.
 */
export function getFileCacheKey(filePath: string): string {
  const resolved = path.resolve(filePath);
  const stat = fs.statSync(resolved);
  const hash = crypto.createHash("sha256");
  hash.update(`v1:${resolved}:${stat.size}:${stat.mtimeMs}`);
  return hash.digest("hex");
}

function getCacheFilePath(filePath: string, customCacheDir?: string): string {
  const key = getFileCacheKey(filePath);
  const dir = getCacheDir(customCacheDir);
  return path.join(dir, `${key}.json`);
}

/**
 * Loads cached media data if the cache file exists and matches current file stat.
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
      return null;
    }

    const raw = fs.readFileSync(cacheFile, "utf-8");
    const data = JSON.parse(raw) as MediaCacheData;

    if (
      data.version === 1 &&
      data.mediaSize === stat.size &&
      data.mediaMtimeMs === stat.mtimeMs &&
      data.mediaPath === resolved
    ) {
      return data;
    }

    return null;
  } catch {
    return null;
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

    const now = Date.now();
    const data: MediaCacheData = {
      version: 1,
      mediaPath: resolved,
      mediaSize: stat.size,
      mediaMtimeMs: stat.mtimeMs,
      transcription,
      translations: existing?.translations ?? {},
      chapters: existing?.chapters,
      summaries: existing?.summaries,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    fs.writeFileSync(cacheFile, JSON.stringify(data, null, 2), "utf-8");
  } catch {
    // Non-fatal if cache save fails
  }
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

    const now = Date.now();
    const translations = existing?.translations ?? {};
    translations[targetLang.toLowerCase()] = translation;

    const data: MediaCacheData = {
      version: 1,
      mediaPath: resolved,
      mediaSize: stat.size,
      mediaMtimeMs: stat.mtimeMs,
      transcription: existing?.transcription,
      translations,
      chapters: existing?.chapters,
      summaries: existing?.summaries,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    fs.writeFileSync(cacheFile, JSON.stringify(data, null, 2), "utf-8");
  } catch {
    // Non-fatal if cache save fails
  }
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

    const now = Date.now();
    const chapters = existing?.chapters ?? {};
    chapters[targetLang.toLowerCase()] = chaptersData;

    const data: MediaCacheData = {
      version: 1,
      mediaPath: resolved,
      mediaSize: stat.size,
      mediaMtimeMs: stat.mtimeMs,
      transcription: existing?.transcription,
      translations: existing?.translations,
      chapters,
      summaries: existing?.summaries,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    fs.writeFileSync(cacheFile, JSON.stringify(data, null, 2), "utf-8");
  } catch {
    // Non-fatal if cache save fails
  }
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

    const now = Date.now();
    const summaries = existing?.summaries ?? {};
    summaries[targetLang.toLowerCase()] = summaryData;

    const data: MediaCacheData = {
      version: 1,
      mediaPath: resolved,
      mediaSize: stat.size,
      mediaMtimeMs: stat.mtimeMs,
      transcription: existing?.transcription,
      translations: existing?.translations,
      chapters: existing?.chapters,
      summaries,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    fs.writeFileSync(cacheFile, JSON.stringify(data, null, 2), "utf-8");
  } catch {
    // Non-fatal if cache save fails
  }
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
