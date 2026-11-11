import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type CachedChapters,
  type CachedRefinement,
  type CachedSummary,
  clearCache,
  computeEntriesHash,
  createCachedChapters,
  createCachedRefinement,
  createCachedSummary,
  createCachedTranscription,
  createCachedTranslation,
  createPartialTranslation,
  type GeneratedCacheContext,
  getCacheDir,
  getCacheStats,
  getFileCacheKey,
  getPartialTranslationChunks,
  isChaptersCacheValid,
  isRefinementCacheValid,
  isSummaryCacheValid,
  isTranscriptionCacheValid,
  isTranslationCacheValid,
  loadMediaCache,
  type RefinementCacheContext,
  saveChaptersCache,
  saveRefinementCache,
  saveSummaryCache,
  saveTranscriptionCache,
  saveTranslationCache,
  type TranscriptionCacheContext,
  type TranslationCacheContext,
} from "./cache.js";
import { DEFAULT_GEMINI_MODEL, DEFAULT_GROQ_MODEL } from "./config.js";
import type { SrtEntry } from "./srt.js";
import { DEFAULT_OPENROUTER_LLM_MODEL } from "./text/openrouter.js";
import { DEFAULT_CONTEXT_WINDOW_SIZE } from "./text/tasks.js";
import { DEFAULT_OPENROUTER_STT_MODEL } from "./transcribe/openrouter.js";

describe("cache module", () => {
  let tempDir: string;
  let testMediaFile: string;
  let customCacheDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vsub-cache-test-"));
    testMediaFile = path.join(tempDir, "sample.mp4");
    customCacheDir = path.join(tempDir, "custom-cache");
    fs.writeFileSync(testMediaFile, "dummy media file content");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe("partial translations", () => {
    const sourceEntries = Array.from({ length: 51 }, (_, index) => ({
      id: index + 1,
      startTime: "00:00:00,000",
      endTime: "00:00:01,000",
      text: `Line ${index}`,
    }));
    const context: TranslationCacheContext = {
      sourceEntries,
      provider: "gemini",
      model: "test-model",
      prompt: "Notes",
      glossaryHash: "terms",
      contextWindowSize: 5,
    };
    const chunks = { "0": Array<string>(50).fill("Translated"), "1": ["Last"] };

    it("round trips valid chunks without exposing an incomplete translation as complete", () => {
      const cached = createPartialTranslation("ja", context, 50, chunks);
      expect(cached.entries).toEqual([]);
      expect(getPartialTranslationChunks(cached, "ja", context, 50)).toEqual(chunks);
      expect(isTranslationCacheValid(cached, context)).toBe(false);
      expect(
        isTranslationCacheValid(createCachedTranslation("ja", context, sourceEntries), context),
      ).toBe(true);
    });

    it.each([
      { sourceEntries: sourceEntries.slice(1) },
      { provider: "openrouter" as const },
      { model: "other" },
      { prompt: "Other" },
      { glossaryHash: "other" },
      { contextWindowSize: 0 },
    ])("rejects a changed cache context %s", (change) => {
      expect(
        getPartialTranslationChunks(
          createPartialTranslation("ja", context, 50, chunks),
          "ja",
          { ...context, ...change },
          50,
        ),
      ).toEqual({});
    });

    it("rejects changed language or chunk size and drops only malformed chunks", () => {
      const cached = createPartialTranslation("ja", context, 50, chunks);
      expect(getPartialTranslationChunks(cached, "en", context, 50)).toEqual({});
      expect(getPartialTranslationChunks(cached, "ja", context, 25)).toEqual({});
      const malformed = {
        ...cached,
        partialChunks: {
          ...chunks,
          "0": ["Too short"],
          "2": ["Outside"],
          "-1": [],
          "01": ["Alias"],
          "1.5": [],
        },
      };
      expect(getPartialTranslationChunks(malformed, "ja", context, 50)).toEqual({ "1": ["Last"] });
      const nonString = JSON.parse(
        JSON.stringify({ ...cached, partialChunks: { ...chunks, "1": [123] } }),
      ) as typeof cached;
      expect(getPartialTranslationChunks(nonString, "ja", context, 50)).toEqual({
        "0": chunks["0"],
      });
    });
  });

  describe("getCacheDir", () => {
    it("should return custom directory when provided", () => {
      const dir = getCacheDir("my-custom-cache");
      expect(dir).toBe(path.resolve(process.cwd(), "my-custom-cache"));
    });

    it("should respect VSUB_CACHE_DIR environment variable", () => {
      const originalEnv = process.env["VSUB_CACHE_DIR"];
      process.env["VSUB_CACHE_DIR"] = path.join(tempDir, "env-cache");
      try {
        const dir = getCacheDir();
        expect(dir).toBe(path.resolve(path.join(tempDir, "env-cache")));
      } finally {
        if (originalEnv !== undefined) {
          process.env["VSUB_CACHE_DIR"] = originalEnv;
        } else {
          delete process.env["VSUB_CACHE_DIR"];
        }
      }
    });

    it("should return default cache directory on the platform", () => {
      const dir = getCacheDir();
      expect(typeof dir).toBe("string");
      expect(dir.length).toBeGreaterThan(0);
    });
  });

  describe("getFileCacheKey", () => {
    it("should return consistent 64-character sha256 hash for identical file state", () => {
      const key1 = getFileCacheKey(testMediaFile);
      const key2 = getFileCacheKey(testMediaFile);
      expect(key1).toHaveLength(64);
      expect(key1).toBe(key2);
    });

    it("should change hash when file size changes", () => {
      const key1 = getFileCacheKey(testMediaFile);
      fs.appendFileSync(testMediaFile, " additional bytes");
      const key2 = getFileCacheKey(testMediaFile);
      expect(key1).not.toBe(key2);
    });

    const sampleBytes = 1024 * 1024;

    async function expectContentChange(content: Buffer, offset: number) {
      fs.writeFileSync(testMediaFile, content);
      fs.utimesSync(testMediaFile, 1000, 1000);
      const key = getFileCacheKey(testMediaFile);
      content[offset] = 1;
      fs.writeFileSync(testMediaFile, content);
      fs.utimesSync(testMediaFile, 1000, 1000);
      vi.resetModules();
      const nextRun = await import("./cache.js");
      expect(nextRun.getFileCacheKey(testMediaFile)).not.toBe(key);
    }

    it("uses the same key for identical content under another name and directory", () => {
      const copy = path.join(tempDir, "archive", "renamed.mp4");
      fs.mkdirSync(path.dirname(copy));
      fs.copyFileSync(testMediaFile, copy);
      expect(getFileCacheKey(copy)).toBe(getFileCacheKey(testMediaFile));
    });

    it("keeps the key when only the modification time changes", () => {
      const key = getFileCacheKey(testMediaFile);
      fs.utimesSync(testMediaFile, 1000, 1000);
      expect(getFileCacheKey(testMediaFile)).toBe(key);
    });

    it.each([0, 2 * sampleBytes, 5 * sampleBytes - 1])(
      "detects a changed sampled byte at offset %i in a large file",
      (offset) => expectContentChange(Buffer.alloc(5 * sampleBytes), offset),
    );

    it.each([0, sampleBytes, 2 * sampleBytes, 3 * sampleBytes - 1])(
      "detects a changed byte anywhere in a file of at most 3 MiB at offset %i",
      (offset) => expectContentChange(Buffer.alloc(3 * sampleBytes), offset),
    );

    it.each([0, 3 * sampleBytes, 5 * sampleBytes + 1])(
      "hashes the v2 size prefix and sampled bytes in order for size %i",
      (size) => {
        const content = Buffer.alloc(size);
        for (let index = 0; index < size; index++) content[index] = index % 251;
        fs.writeFileSync(testMediaFile, content);
        const hash = crypto.createHash("sha256").update(`v2:${size}:`);
        if (size <= 3 * sampleBytes) {
          hash.update(content);
        } else {
          for (const offset of [0, Math.floor((size - sampleBytes) / 2), size - sampleBytes]) {
            hash.update(content.subarray(offset, offset + sampleBytes));
          }
        }
        expect(getFileCacheKey(testMediaFile)).toBe(hash.digest("hex"));
      },
    );

    it.each(["mtime", "size"])("memoizes reads until the file %s changes", (change) => {
      const read = vi.spyOn(fs, "readSync");
      const key = getFileCacheKey(testMediaFile);
      const reads = read.mock.calls.length;
      expect(reads).toBeGreaterThan(0);
      expect(getFileCacheKey(testMediaFile)).toBe(key);
      expect(read).toHaveBeenCalledTimes(reads);
      if (change === "mtime") {
        const content = fs.readFileSync(testMediaFile);
        content[0] = 1;
        fs.writeFileSync(testMediaFile, content);
        fs.utimesSync(testMediaFile, 1000, 1000);
      } else {
        fs.appendFileSync(testMediaFile, "extra");
      }
      const readsBeforeRehash = read.mock.calls.length;
      expect(getFileCacheKey(testMediaFile)).not.toBe(key);
      expect(read.mock.calls.length).toBeGreaterThan(readsBeforeRehash);
    });
  });

  describe("computeEntriesHash", () => {
    const baseEntries: SrtEntry[] = [
      { id: 1, startTime: "00:00:00,000", endTime: "00:00:02,000", text: "Entry 1" },
      { id: 2, startTime: "00:00:02,500", endTime: "00:00:05,000", text: "Entry 2" },
    ];
    const baseHash = computeEntriesHash(baseEntries);

    it.each([
      {
        name: "identical entries",
        entries: [
          { id: 1, startTime: "00:00:00,000", endTime: "00:00:02,000", text: "Entry 1" },
          { id: 2, startTime: "00:00:02,500", endTime: "00:00:05,000", text: "Entry 2" },
        ],
        expectEqual: true,
      },
      {
        name: "different text",
        entries: [
          { id: 1, startTime: "00:00:00,000", endTime: "00:00:02,000", text: "Different text" },
          { id: 2, startTime: "00:00:02,500", endTime: "00:00:05,000", text: "Entry 2" },
        ],
        expectEqual: false,
      },
      {
        name: "different startTime",
        entries: [
          { id: 1, startTime: "00:00:00,500", endTime: "00:00:02,000", text: "Entry 1" },
          { id: 2, startTime: "00:00:02,500", endTime: "00:00:05,000", text: "Entry 2" },
        ],
        expectEqual: false,
      },
      {
        name: "different endTime",
        entries: [
          { id: 1, startTime: "00:00:00,000", endTime: "00:00:03,000", text: "Entry 1" },
          { id: 2, startTime: "00:00:02,500", endTime: "00:00:05,000", text: "Entry 2" },
        ],
        expectEqual: false,
      },
      {
        name: "different order",
        entries: [
          { id: 2, startTime: "00:00:02,500", endTime: "00:00:05,000", text: "Entry 2" },
          { id: 1, startTime: "00:00:00,000", endTime: "00:00:02,000", text: "Entry 1" },
        ],
        expectEqual: false,
      },
    ])("should return $name hash consistency ($expectEqual)", ({ entries, expectEqual }) => {
      const hash = computeEntriesHash(entries);
      if (expectEqual) {
        expect(hash).toBe(baseHash);
      } else {
        expect(hash).not.toBe(baseHash);
      }
    });
  });

  describe("loadMediaCache and saveTranscriptionCache", () => {
    const sampleEntries: SrtEntry[] = [
      { id: 1, startTime: "00:00:00,000", endTime: "00:00:02,000", text: "Hello world" },
      { id: 2, startTime: "00:00:02,500", endTime: "00:00:05,000", text: "Testing cache" },
    ];

    it("should return null when cache does not exist", () => {
      const cache = loadMediaCache(testMediaFile, customCacheDir);
      expect(cache).toBeNull();
    });

    it("should save and load transcription cache correctly", () => {
      saveTranscriptionCache(
        testMediaFile,
        {
          detectedLanguage: "en",
          entries: sampleEntries,
          model: "whisper-large-v3-turbo",
          createdAt: Date.now(),
        },
        customCacheDir,
      );

      const cache = loadMediaCache(testMediaFile, customCacheDir);
      expect(cache).not.toBeNull();
      expect(cache?.version).toBe(2);
      expect(cache?.transcription?.detectedLanguage).toBe("en");
      expect(cache?.transcription?.entries).toHaveLength(2);
      expect(cache?.transcription?.entries[0]?.text).toBe("Hello world");
      expect(cache?.transcription?.model).toBe("whisper-large-v3-turbo");
    });

    it("loads after moving the file and records the current path on the next save", () => {
      const transcription = createCachedTranscription({}, sampleEntries, "en");
      saveTranscriptionCache(testMediaFile, transcription, customCacheDir);
      const cacheFile = path.join(customCacheDir, `${getFileCacheKey(testMediaFile)}.json`);
      const saved = JSON.parse(fs.readFileSync(cacheFile, "utf-8"));
      expect(saved.version).toBe(2);
      expect(saved.mediaPath).toBe(testMediaFile);
      expect(saved).not.toHaveProperty("mediaMtimeMs");
      const moved = path.join(tempDir, "renamed.mp4");
      fs.renameSync(testMediaFile, moved);
      expect(loadMediaCache(moved, customCacheDir)?.transcription).toEqual(transcription);
      saveTranscriptionCache(moved, transcription, customCacheDir);
      expect(loadMediaCache(moved, customCacheDir)?.mediaPath).toBe(moved);
    });

    it("rejects changed content with the same path, size, and mtime on the next run", async () => {
      fs.utimesSync(testMediaFile, 1000, 1000);
      saveTranscriptionCache(
        testMediaFile,
        createCachedTranscription({}, sampleEntries),
        customCacheDir,
      );
      const stat = fs.statSync(testMediaFile);
      fs.writeFileSync(testMediaFile, Buffer.alloc(stat.size, 1));
      fs.utimesSync(testMediaFile, stat.atime, stat.mtime);
      vi.resetModules();
      const nextRun = await import("./cache.js");
      expect(nextRun.loadMediaCache(testMediaFile, customCacheDir)).toBeNull();
    });

    it("rejects a v2 cache with a different media size", () => {
      const cacheFile = path.join(customCacheDir, `${getFileCacheKey(testMediaFile)}.json`);
      fs.mkdirSync(customCacheDir);
      fs.writeFileSync(cacheFile, JSON.stringify({ version: 2, mediaSize: 0 }));
      expect(loadMediaCache(testMediaFile, customCacheDir)).toBeNull();
    });

    it("should store wordChunks in createCachedTranscription only when given", () => {
      const wordChunks = [{ offsetSeconds: 0, words: [{ start: 0, end: 0.5, text: "あ" }] }];

      expect(createCachedTranscription({}, sampleEntries, "en", wordChunks).wordChunks).toEqual(
        wordChunks,
      );
      expect("wordChunks" in createCachedTranscription({}, sampleEntries, "en")).toBe(false);
    });

    it("should round-trip wordChunks through saveTranscriptionCache and loadMediaCache", () => {
      const wordChunks = [
        { offsetSeconds: 0, words: [{ start: 0, end: 0.5, text: "あ" }] },
        { offsetSeconds: 300, words: [] },
      ];
      saveTranscriptionCache(
        testMediaFile,
        createCachedTranscription({}, sampleEntries, "en", wordChunks),
        customCacheDir,
      );

      expect(loadMediaCache(testMediaFile, customCacheDir)?.transcription?.wordChunks).toEqual(
        wordChunks,
      );
    });

    it("should invalidate cache if target media file was modified", async () => {
      saveTranscriptionCache(
        testMediaFile,
        {
          detectedLanguage: "en",
          entries: sampleEntries,
          createdAt: Date.now(),
        },
        customCacheDir,
      );

      // Verify loaded
      expect(loadMediaCache(testMediaFile, customCacheDir)).not.toBeNull();

      // Modify the media file
      await new Promise((resolve) => setTimeout(resolve, 50));
      fs.appendFileSync(testMediaFile, " modified");

      // Now it should return null because size and mtime changed
      expect(loadMediaCache(testMediaFile, customCacheDir)).toBeNull();
    });
  });

  describe("legacy cache migration", () => {
    function writeLegacyCache() {
      const stat = fs.statSync(testMediaFile);
      const key = crypto
        .createHash("sha256")
        .update(`v1:${path.resolve(testMediaFile)}:${stat.size}:${stat.mtimeMs}`)
        .digest("hex");
      const legacyFile = path.join(customCacheDir, `${key}.json`);
      const cacheFile = path.join(customCacheDir, `${getFileCacheKey(testMediaFile)}.json`);
      const entries: SrtEntry[] = [
        { id: 1, startTime: "00:00:00,000", endTime: "00:00:01,000", text: "Test" },
      ];
      const context = { sourceEntries: entries, contextWindowSize: 5 };
      const legacy = {
        version: 1,
        mediaPath: path.resolve(testMediaFile),
        mediaSize: stat.size,
        mediaMtimeMs: stat.mtimeMs,
        transcription: createCachedTranscription({}, entries, "en"),
        refinement: createCachedRefinement(context, entries),
        translations: { ja: createCachedTranslation("ja", context, entries) },
        chapters: { ja: createCachedChapters("ja", context, []) },
        summaries: {
          ja: createCachedSummary("ja", context, {
            title: "Test",
            summary: "Test summary",
            keyPoints: [],
            topics: [],
          }),
        },
        createdAt: 1000,
        updatedAt: 2000,
      };
      fs.mkdirSync(customCacheDir);
      fs.writeFileSync(legacyFile, JSON.stringify(legacy));
      const { mediaMtimeMs: _mtime, ...rest } = legacy;
      return { legacyFile, cacheFile, legacy, migrated: { ...rest, version: 2 } };
    }

    it("migrates all fields and timestamps and reads v2 on subsequent loads", () => {
      const { legacyFile, cacheFile, migrated } = writeLegacyCache();
      expect(loadMediaCache(testMediaFile, customCacheDir)).toEqual(migrated);
      expect(JSON.parse(fs.readFileSync(cacheFile, "utf-8"))).toEqual(migrated);
      expect(fs.existsSync(legacyFile)).toBe(false);
      expect(loadMediaCache(testMediaFile, customCacheDir)).toEqual(migrated);
    });

    it.each(["version", "mediaPath", "mediaSize", "mediaMtimeMs", "corrupt"])(
      "leaves legacy cache untouched when %s is invalid",
      (field) => {
        const { legacyFile, cacheFile, legacy } = writeLegacyCache();
        fs.writeFileSync(
          legacyFile,
          field === "corrupt" ? "{" : JSON.stringify({ ...legacy, [field]: "invalid" }),
        );
        expect(loadMediaCache(testMediaFile, customCacheDir)).toBeNull();
        expect(fs.existsSync(legacyFile)).toBe(true);
        expect(fs.existsSync(cacheFile)).toBe(false);
      },
    );

    it.each(["valid", "wrong size", "wrong version", "corrupt"])(
      "does not fall back to legacy when the v2 file is %s",
      (state) => {
        const { legacyFile, cacheFile, migrated } = writeLegacyCache();
        const data = { ...migrated };
        if (state === "wrong size") data.mediaSize++;
        if (state === "wrong version") data.version = 1;
        fs.writeFileSync(cacheFile, state === "corrupt" ? "{" : JSON.stringify(data));
        expect(loadMediaCache(testMediaFile, customCacheDir)).toEqual(
          state === "valid" ? migrated : null,
        );
        expect(fs.existsSync(legacyFile)).toBe(true);
      },
    );

    it("preserves other legacy fields when saving a transcription", () => {
      const { legacyFile, migrated } = writeLegacyCache();
      const transcription = createCachedTranscription({}, [], "ja");
      saveTranscriptionCache(testMediaFile, transcription, customCacheDir);
      expect(loadMediaCache(testMediaFile, customCacheDir)).toEqual({
        ...migrated,
        transcription,
        updatedAt: expect.any(Number),
      });
      expect(fs.existsSync(legacyFile)).toBe(false);
    });

    it.each(["writeFileSync", "unlinkSync"] as const)(
      "returns migrated data even if %s fails",
      (operation) => {
        const { legacyFile, cacheFile, migrated } = writeLegacyCache();
        vi.spyOn(fs, operation).mockImplementation(() => {
          throw new Error("Test failure");
        });
        expect(loadMediaCache(testMediaFile, customCacheDir)).toEqual(migrated);
        expect(fs.existsSync(legacyFile)).toBe(true);
        expect(fs.existsSync(cacheFile)).toBe(operation === "unlinkSync");
      },
    );
  });

  describe("saveTranslationCache", () => {
    const sampleJaEntries: SrtEntry[] = [
      { id: 1, startTime: "00:00:00,000", endTime: "00:00:02,000", text: "こんにちは世界" },
      { id: 2, startTime: "00:00:02,500", endTime: "00:00:05,000", text: "キャッシュのテスト" },
    ];

    const sampleZhEntries: SrtEntry[] = [
      { id: 1, startTime: "00:00:00,000", endTime: "00:00:02,000", text: "你好世界" },
      { id: 2, startTime: "00:00:02,500", endTime: "00:00:05,000", text: "测试缓存" },
    ];

    it("should save multiple language translations independently and cumulatively", () => {
      // Save JA
      saveTranslationCache(
        testMediaFile,
        "ja",
        {
          targetLang: "ja",
          model: "gemini-3.7-flash",
          entries: sampleJaEntries,
          createdAt: Date.now(),
        },
        customCacheDir,
      );

      let cache = loadMediaCache(testMediaFile, customCacheDir);
      expect(cache?.translations?.["ja"]?.entries).toHaveLength(2);
      expect(cache?.translations?.["ja"]?.entries[0]?.text).toBe("こんにちは世界");
      expect(cache?.translations?.["zh"]).toBeUndefined();

      // Save ZH
      saveTranslationCache(
        testMediaFile,
        "zh",
        {
          targetLang: "zh",
          model: "gemini-3.7-flash",
          entries: sampleZhEntries,
          createdAt: Date.now(),
        },
        customCacheDir,
      );

      cache = loadMediaCache(testMediaFile, customCacheDir);
      expect(cache?.translations?.["ja"]?.entries).toHaveLength(2);
      expect(cache?.translations?.["zh"]?.entries).toHaveLength(2);
      expect(cache?.translations?.["zh"]?.entries[0]?.text).toBe("你好世界");
    });

    it("should preserve prompt and glossaryHash in translation cache", () => {
      saveTranslationCache(
        testMediaFile,
        "ja",
        {
          targetLang: "ja",
          prompt: "CustomPrompt",
          glossaryHash: "a1b2c3d4",
          entries: sampleJaEntries,
          createdAt: Date.now(),
        },
        customCacheDir,
      );

      const cache = loadMediaCache(testMediaFile, customCacheDir);
      expect(cache?.translations?.["ja"]?.prompt).toBe("CustomPrompt");
      expect(cache?.translations?.["ja"]?.glossaryHash).toBe("a1b2c3d4");
    });
  });

  describe("isTranscriptionCacheValid and isTranslationCacheValid", () => {
    describe("isTranscriptionCacheValid", () => {
      const table: Array<{
        name: string;
        savedContext: { prompt?: string | undefined; model?: string | undefined };
        currentContext: TranscriptionCacheContext;
        isUndefinedCached?: boolean | undefined;
        expected: boolean;
      }> = [
        {
          name: "all identical",
          savedContext: { prompt: "MyPrompt", model: "whisper-large-v3-turbo" },
          currentContext: { prompt: "MyPrompt", model: "whisper-large-v3-turbo" },
          expected: true,
        },
        {
          name: "prompt attached first, then detached",
          savedContext: { prompt: "MyPrompt", model: "whisper-large-v3-turbo" },
          currentContext: { prompt: undefined, model: "whisper-large-v3-turbo" },
          expected: false,
        },
        {
          name: "prompt omitted first, then attached",
          savedContext: { prompt: undefined, model: "whisper-large-v3-turbo" },
          currentContext: { prompt: "MyPrompt", model: "whisper-large-v3-turbo" },
          expected: false,
        },
        {
          name: "prompt differing only in leading/trailing whitespace",
          savedContext: { prompt: "  MyPrompt  ", model: "whisper-large-v3-turbo" },
          currentContext: { prompt: "MyPrompt", model: "whisper-large-v3-turbo" },
          expected: true,
        },
        {
          name: "model differs",
          savedContext: { prompt: "MyPrompt", model: "whisper-large-v3-turbo" },
          currentContext: { prompt: "MyPrompt", model: "whisper-large-v3" },
          expected: false,
        },
        {
          name: "cached has no model and current is DEFAULT_GROQ_MODEL",
          savedContext: { prompt: "MyPrompt", model: undefined },
          currentContext: { prompt: "MyPrompt", model: DEFAULT_GROQ_MODEL },
          expected: true,
        },
        {
          name: "cached has no model and current is different model",
          savedContext: { prompt: "MyPrompt", model: undefined },
          currentContext: { prompt: "MyPrompt", model: "whisper-large-v3" },
          expected: false,
        },
        {
          name: "cached is undefined",
          savedContext: { prompt: "MyPrompt", model: "whisper-large-v3-turbo" },
          currentContext: { prompt: "MyPrompt", model: "whisper-large-v3-turbo" },
          isUndefinedCached: true,
          expected: false,
        },
      ];

      it.each(table)(
        "$name -> $expected",
        ({ savedContext, currentContext, isUndefinedCached, expected }) => {
          const cached = isUndefinedCached
            ? undefined
            : createCachedTranscription(savedContext, []);
          expect(isTranscriptionCacheValid(cached, currentContext)).toBe(expected);
        },
      );

      describe("provider-aware transcription cache validity", () => {
        it("considers legacy cached entry without provider as groq with DEFAULT_GROQ_MODEL", () => {
          const legacyCached = {
            entries: [],
            createdAt: Date.now(),
            model: "whisper-large-v3-turbo",
          };
          expect(
            isTranscriptionCacheValid(legacyCached, {
              provider: "groq",
              model: DEFAULT_GROQ_MODEL,
            }),
          ).toBe(true);
          expect(
            isTranscriptionCacheValid(legacyCached, {
              provider: "openrouter",
              model: DEFAULT_OPENROUTER_STT_MODEL,
            }),
          ).toBe(false);
        });

        it("considers legacy cached entry without model as DEFAULT_GROQ_MODEL", () => {
          const legacyCached = {
            entries: [],
            createdAt: Date.now(),
          };
          expect(
            isTranscriptionCacheValid(legacyCached, {
              provider: "groq",
              model: DEFAULT_GROQ_MODEL,
            }),
          ).toBe(true);
          expect(
            isTranscriptionCacheValid(legacyCached, {
              provider: "openrouter",
              model: DEFAULT_OPENROUTER_STT_MODEL,
            }),
          ).toBe(false);
        });

        it("treats openrouter entry with empty model as DEFAULT_OPENROUTER_STT_MODEL", () => {
          const cached = {
            provider: "openrouter" as const,
            entries: [],
            createdAt: Date.now(),
          };
          expect(
            isTranscriptionCacheValid(cached, {
              provider: "openrouter",
              model: DEFAULT_OPENROUTER_STT_MODEL,
            }),
          ).toBe(true);
          expect(
            isTranscriptionCacheValid(cached, {
              provider: "openrouter",
              model: "other-openrouter-model",
            }),
          ).toBe(false);
        });

        it("saves provider in createCachedTranscription when provided in context", () => {
          const cached = createCachedTranscription(
            { provider: "openrouter", model: DEFAULT_OPENROUTER_STT_MODEL },
            [],
          );
          expect(cached.provider).toBe("openrouter");
        });
      });
    });

    describe("isTranslationCacheValid", () => {
      const defaultSource: SrtEntry[] = [
        { id: 1, startTime: "00:00:00,000", endTime: "00:00:02,000", text: "Hello" },
      ];
      const defaultTranslated: SrtEntry[] = [
        { id: 1, startTime: "00:00:00,000", endTime: "00:00:02,000", text: "こんにちは" },
      ];
      const baseContext: TranslationCacheContext = {
        sourceEntries: defaultSource,
        prompt: "Base prompt",
        glossaryHash: "glossary123",
        model: "gemini-3.7-flash",
        contextWindowSize: DEFAULT_CONTEXT_WINDOW_SIZE,
      };

      const table: Array<{
        name: string;
        savedContext: TranslationCacheContext;
        currentContext: TranslationCacheContext;
        transformCached?:
          | ((
              cached: ReturnType<typeof createCachedTranslation>,
            ) => ReturnType<typeof createCachedTranslation>)
          | undefined;
        isUndefinedCached?: boolean | undefined;
        expected: boolean;
      }> = [
        {
          name: "all identical",
          savedContext: baseContext,
          currentContext: baseContext,
          expected: true,
        },
        {
          name: "sourceEntries different text",
          savedContext: baseContext,
          currentContext: {
            ...baseContext,
            sourceEntries: [
              { id: 1, startTime: "00:00:00,000", endTime: "00:00:02,000", text: "Different" },
            ],
          },
          expected: false,
        },
        {
          name: "sourceEntries different timestamp",
          savedContext: baseContext,
          currentContext: {
            ...baseContext,
            sourceEntries: [
              { id: 1, startTime: "00:00:01,000", endTime: "00:00:03,000", text: "Hello" },
            ],
          },
          expected: false,
        },
        {
          name: "prompt attached first, then detached",
          savedContext: { ...baseContext, prompt: "Translate politely" },
          currentContext: { ...baseContext, prompt: undefined },
          expected: false,
        },
        {
          name: "prompt omitted first, then attached",
          savedContext: { ...baseContext, prompt: undefined },
          currentContext: { ...baseContext, prompt: "Translate politely" },
          expected: false,
        },
        {
          name: "glossaryHash attached first, then detached",
          savedContext: { ...baseContext, glossaryHash: "ghash1" },
          currentContext: { ...baseContext, glossaryHash: undefined },
          expected: false,
        },
        {
          name: "glossaryHash omitted first, then attached",
          savedContext: { ...baseContext, glossaryHash: undefined },
          currentContext: { ...baseContext, glossaryHash: "ghash1" },
          expected: false,
        },
        {
          name: "model attached first, then detached",
          savedContext: { ...baseContext, model: "gemini-3.7-flash" },
          currentContext: { ...baseContext, model: undefined },
          expected: false,
        },
        {
          name: "model omitted first, then attached",
          savedContext: { ...baseContext, model: undefined },
          currentContext: { ...baseContext, model: "gemini-3.7-flash" },
          expected: false,
        },
        {
          name: "contextWindowSize differs",
          savedContext: { ...baseContext, contextWindowSize: 2 },
          currentContext: { ...baseContext, contextWindowSize: 5 },
          expected: false,
        },
        {
          name: "prompt differing only in leading/trailing whitespace",
          savedContext: { ...baseContext, prompt: "  Base prompt  " },
          currentContext: { ...baseContext, prompt: "Base prompt" },
          expected: true,
        },
        {
          name: "legacy format without sourceHash",
          savedContext: baseContext,
          currentContext: baseContext,
          transformCached: (cached) => {
            const copy = { ...cached };
            delete copy.sourceHash;
            return copy;
          },
          expected: false,
        },
        {
          name: "legacy format without contextWindowSize",
          savedContext: baseContext,
          currentContext: baseContext,
          transformCached: (cached) => {
            const copy = { ...cached };
            delete copy.contextWindowSize;
            return copy;
          },
          expected: false,
        },
        {
          name: "cached is undefined",
          savedContext: baseContext,
          currentContext: baseContext,
          isUndefinedCached: true,
          expected: false,
        },
      ];

      it.each(table)(
        "$name -> $expected",
        ({ savedContext, currentContext, transformCached, isUndefinedCached, expected }) => {
          let cached: ReturnType<typeof createCachedTranslation> | undefined;
          if (isUndefinedCached) {
            cached = undefined;
          } else {
            cached = createCachedTranslation("ja", savedContext, defaultTranslated);
            if (transformCached) {
              cached = transformCached(cached);
            }
          }
          expect(isTranslationCacheValid(cached, currentContext)).toBe(expected);
        },
      );
    });

    describe.each([
      {
        target: "chapters",
        createFn: (context: GeneratedCacheContext) =>
          createCachedChapters("ja", context, [{ timestamp: "00:00", seconds: 0, title: "Intro" }]),
        validateFn: isChaptersCacheValid,
      },
      {
        target: "summary",
        createFn: (context: GeneratedCacheContext) =>
          createCachedSummary("ja", context, {
            title: "Title",
            summary: "Summary text",
            keyPoints: ["Point 1"],
            topics: [],
          }),
        validateFn: isSummaryCacheValid,
      },
    ])("isChaptersCacheValid and isSummaryCacheValid ($target)", ({ createFn, validateFn }) => {
      const defaultSource: SrtEntry[] = [
        { id: 1, startTime: "00:00:00,000", endTime: "00:00:02,000", text: "Hello" },
      ];
      const baseContext: GeneratedCacheContext = {
        sourceEntries: defaultSource,
        prompt: "Base prompt",
        model: "gemini-3.7-flash",
      };

      type GeneratedCacheItem = CachedChapters | CachedSummary;

      const table: Array<{
        name: string;
        savedContext: GeneratedCacheContext;
        currentContext: GeneratedCacheContext;
        transformCached?: ((cached: GeneratedCacheItem) => GeneratedCacheItem) | undefined;
        isUndefinedCached?: boolean | undefined;
        expected: boolean;
      }> = [
        {
          name: "all identical",
          savedContext: baseContext,
          currentContext: baseContext,
          expected: true,
        },
        {
          name: "sourceEntries different text",
          savedContext: baseContext,
          currentContext: {
            ...baseContext,
            sourceEntries: [
              { id: 1, startTime: "00:00:00,000", endTime: "00:00:02,000", text: "Different" },
            ],
          },
          expected: false,
        },
        {
          name: "prompt attached first, then detached",
          savedContext: { ...baseContext, prompt: "Chapter prompt" },
          currentContext: { ...baseContext, prompt: undefined },
          expected: false,
        },
        {
          name: "prompt omitted first, then attached",
          savedContext: { ...baseContext, prompt: undefined },
          currentContext: { ...baseContext, prompt: "Chapter prompt" },
          expected: false,
        },
        {
          name: "model attached first, then detached",
          savedContext: { ...baseContext, model: "gemini-3.7-flash" },
          currentContext: { ...baseContext, model: undefined },
          expected: false,
        },
        {
          name: "model omitted first, then attached",
          savedContext: { ...baseContext, model: undefined },
          currentContext: { ...baseContext, model: "gemini-3.7-flash" },
          expected: false,
        },
        {
          name: "legacy format without sourceHash",
          savedContext: baseContext,
          currentContext: baseContext,
          transformCached: (cached) => {
            const copy = { ...cached };
            delete (copy as { sourceHash?: string | undefined }).sourceHash;
            return copy;
          },
          expected: false,
        },
        {
          name: "cached is undefined",
          savedContext: baseContext,
          currentContext: baseContext,
          isUndefinedCached: true,
          expected: false,
        },
      ];

      it.each(table)(
        "$name -> $expected",
        ({ savedContext, currentContext, transformCached, isUndefinedCached, expected }) => {
          let cached: GeneratedCacheItem | undefined;
          if (isUndefinedCached) {
            cached = undefined;
          } else {
            cached = createFn(savedContext);
            if (transformCached) {
              cached = transformCached(cached);
            }
          }
          expect(validateFn(cached as never, currentContext)).toBe(expected);
        },
      );
    });

    describe("LLM provider cache validity (translation, chapters, summary)", () => {
      const defaultSource: SrtEntry[] = [
        { id: 1, startTime: "00:00:00,000", endTime: "00:00:02,000", text: "Hello" },
      ];
      const defaultTranslated: SrtEntry[] = [
        { id: 1, startTime: "00:00:00,000", endTime: "00:00:02,000", text: "こんにちは" },
      ];

      it("should treat legacy translation cache without provider as gemini", () => {
        const cached = createCachedTranslation(
          "ja",
          {
            sourceEntries: defaultSource,
            model: "gemini-3.8-flash",
            contextWindowSize: DEFAULT_CONTEXT_WINDOW_SIZE,
          },
          defaultTranslated,
        );
        delete (cached as { provider?: string }).provider;

        // Matches gemini context (default or explicit)
        expect(
          isTranslationCacheValid(cached, {
            sourceEntries: defaultSource,
            provider: "gemini",
            model: "gemini-3.8-flash",
            contextWindowSize: DEFAULT_CONTEXT_WINDOW_SIZE,
          }),
        ).toBe(true);
        expect(
          isTranslationCacheValid(cached, {
            sourceEntries: defaultSource,
            model: "gemini-3.8-flash",
            contextWindowSize: DEFAULT_CONTEXT_WINDOW_SIZE,
          }),
        ).toBe(true);

        // Misses when context is openrouter
        expect(
          isTranslationCacheValid(cached, {
            sourceEntries: defaultSource,
            provider: "openrouter",
            model: "gemini-3.8-flash",
            contextWindowSize: DEFAULT_CONTEXT_WINDOW_SIZE,
          }),
        ).toBe(false);
      });

      it("should match openrouter translation cache on openrouter and miss on gemini", () => {
        const cached = createCachedTranslation(
          "ja",
          {
            sourceEntries: defaultSource,
            provider: "openrouter",
            model: "google/gemini-3.8-flash",
            contextWindowSize: DEFAULT_CONTEXT_WINDOW_SIZE,
          },
          defaultTranslated,
        );

        expect(
          isTranslationCacheValid(cached, {
            sourceEntries: defaultSource,
            provider: "openrouter",
            model: "google/gemini-3.8-flash",
            contextWindowSize: DEFAULT_CONTEXT_WINDOW_SIZE,
          }),
        ).toBe(true);

        expect(
          isTranslationCacheValid(cached, {
            sourceEntries: defaultSource,
            provider: "gemini",
            model: "google/gemini-3.8-flash",
            contextWindowSize: DEFAULT_CONTEXT_WINDOW_SIZE,
          }),
        ).toBe(false);
      });

      it("should normalize empty or omitted model to provider default model in translation", () => {
        const cachedGemini = createCachedTranslation(
          "ja",
          {
            sourceEntries: defaultSource,
            provider: "gemini",
            model: undefined,
            contextWindowSize: DEFAULT_CONTEXT_WINDOW_SIZE,
          },
          defaultTranslated,
        );
        expect(
          isTranslationCacheValid(cachedGemini, {
            sourceEntries: defaultSource,
            provider: "gemini",
            model: "gemini-3.8-flash",
            contextWindowSize: DEFAULT_CONTEXT_WINDOW_SIZE,
          }),
        ).toBe(true);

        const cachedOpenRouter = createCachedTranslation(
          "ja",
          {
            sourceEntries: defaultSource,
            provider: "openrouter",
            model: "google/gemini-3.8-flash",
            contextWindowSize: DEFAULT_CONTEXT_WINDOW_SIZE,
          },
          defaultTranslated,
        );
        expect(
          isTranslationCacheValid(cachedOpenRouter, {
            sourceEntries: defaultSource,
            provider: "openrouter",
            model: undefined,
            contextWindowSize: DEFAULT_CONTEXT_WINDOW_SIZE,
          }),
        ).toBe(true);
      });

      it("should treat legacy chapters and summary cache without provider as gemini", () => {
        const chaptersCached = createCachedChapters(
          "ja",
          {
            sourceEntries: defaultSource,
            model: "gemini-3.8-flash",
          },
          [{ timestamp: "00:00", seconds: 0, title: "Intro" }],
        );
        delete (chaptersCached as { provider?: string }).provider;

        expect(
          isChaptersCacheValid(chaptersCached, {
            sourceEntries: defaultSource,
            provider: "gemini",
            model: "gemini-3.8-flash",
          }),
        ).toBe(true);
        expect(
          isChaptersCacheValid(chaptersCached, {
            sourceEntries: defaultSource,
            provider: "openrouter",
            model: "gemini-3.8-flash",
          }),
        ).toBe(false);

        const summaryCached = createCachedSummary(
          "ja",
          {
            sourceEntries: defaultSource,
            model: "gemini-3.8-flash",
          },
          {
            title: "T",
            summary: "S",
            keyPoints: [],
            topics: [],
          },
        );
        delete (summaryCached as { provider?: string }).provider;

        expect(
          isSummaryCacheValid(summaryCached, {
            sourceEntries: defaultSource,
            provider: "gemini",
            model: "gemini-3.8-flash",
          }),
        ).toBe(true);
        expect(
          isSummaryCacheValid(summaryCached, {
            sourceEntries: defaultSource,
            provider: "openrouter",
            model: "gemini-3.8-flash",
          }),
        ).toBe(false);
      });

      it("should match openrouter chapters and summary cache on openrouter and miss on gemini", () => {
        const chaptersCached = createCachedChapters(
          "ja",
          {
            sourceEntries: defaultSource,
            provider: "openrouter",
            model: "google/gemini-3.8-flash",
          },
          [{ timestamp: "00:00", seconds: 0, title: "Intro" }],
        );
        expect(
          isChaptersCacheValid(chaptersCached, {
            sourceEntries: defaultSource,
            provider: "openrouter",
            model: "google/gemini-3.8-flash",
          }),
        ).toBe(true);
        expect(
          isChaptersCacheValid(chaptersCached, {
            sourceEntries: defaultSource,
            provider: "gemini",
            model: "google/gemini-3.8-flash",
          }),
        ).toBe(false);

        const summaryCached = createCachedSummary(
          "ja",
          {
            sourceEntries: defaultSource,
            provider: "openrouter",
            model: "google/gemini-3.8-flash",
          },
          {
            title: "T",
            summary: "S",
            keyPoints: [],
            topics: [],
          },
        );
        expect(
          isSummaryCacheValid(summaryCached, {
            sourceEntries: defaultSource,
            provider: "openrouter",
            model: "google/gemini-3.8-flash",
          }),
        ).toBe(true);
        expect(
          isSummaryCacheValid(summaryCached, {
            sourceEntries: defaultSource,
            provider: "gemini",
            model: "google/gemini-3.8-flash",
          }),
        ).toBe(false);
      });
    });
  });

  describe("saveChaptersCache and saveSummaryCache", () => {
    it("should save and load chapters cache", () => {
      saveChaptersCache(
        testMediaFile,
        "ja",
        {
          targetLang: "ja",
          model: "gemini-3.8-flash",
          prompt: "test prompt",
          chapters: [{ timestamp: "00:00", seconds: 0, title: "Opening" }],
          createdAt: Date.now(),
        },
        customCacheDir,
      );

      const cache = loadMediaCache(testMediaFile, customCacheDir);
      expect(cache?.chapters?.["ja"]?.chapters[0]?.title).toBe("Opening");
      expect(cache?.chapters?.["ja"]?.model).toBe("gemini-3.8-flash");
    });

    it("should save and load summary cache", () => {
      saveSummaryCache(
        testMediaFile,
        "en",
        {
          targetLang: "en",
          model: "gemini-3.8-flash",
          prompt: "test summary prompt",
          summary: {
            title: "Test Overview",
            summary: "Brief overview",
            keyPoints: ["Key point A"],
            topics: [{ timestamp: "00:10", title: "Topic 1", description: "Details" }],
          },
          createdAt: Date.now(),
        },
        customCacheDir,
      );

      const cache = loadMediaCache(testMediaFile, customCacheDir);
      expect(cache?.summaries?.["en"]?.summary.title).toBe("Test Overview");
      expect(cache?.summaries?.["en"]?.summary.keyPoints).toEqual(["Key point A"]);
    });
  });

  describe("getCacheStats and clearCache", () => {
    it("should report 0 stats when cache dir is empty", () => {
      const stats = getCacheStats(customCacheDir);
      expect(stats.count).toBe(0);
      expect(stats.totalBytes).toBe(0);
    });

    it("should accurately count files and total size, and clear cache", () => {
      const file2 = path.join(tempDir, "sample2.mp4");
      fs.writeFileSync(file2, "second media file");

      saveTranscriptionCache(testMediaFile, { entries: [], createdAt: Date.now() }, customCacheDir);
      saveTranscriptionCache(file2, { entries: [], createdAt: Date.now() }, customCacheDir);

      const stats = getCacheStats(customCacheDir);
      expect(stats.count).toBe(2);
      expect(stats.totalBytes).toBeGreaterThan(0);

      const result = clearCache(customCacheDir);
      expect(result.deletedCount).toBe(2);
      expect(result.freedBytes).toBe(stats.totalBytes);

      const afterStats = getCacheStats(customCacheDir);
      expect(afterStats.count).toBe(0);
      expect(afterStats.totalBytes).toBe(0);
    });
  });

  describe("refinement cache validity and persistence", () => {
    const secondSourceLine: SrtEntry = {
      id: 2,
      startTime: "00:00:02,500",
      endTime: "00:00:05,000",
      text: "Same line",
    };
    const defaultSource: SrtEntry[] = [
      { id: 1, startTime: "00:00:00,000", endTime: "00:00:02,000", text: "Misheard word" },
      secondSourceLine,
    ];
    const defaultRefined: SrtEntry[] = [
      { id: 1, startTime: "00:00:00,000", endTime: "00:00:02,000", text: "Corrected word" },
      secondSourceLine,
    ];
    const baseContext: RefinementCacheContext = {
      sourceEntries: defaultSource,
      provider: "gemini",
      model: DEFAULT_GEMINI_MODEL,
      prompt: "Base notes",
      glossaryHash: "glossaryhash123",
    };

    const validityTable: Array<{
      name: string;
      savedContext: RefinementCacheContext;
      currentContext: RefinementCacheContext;
      transformCached?: ((cached: CachedRefinement) => CachedRefinement) | undefined;
      isUndefinedCached?: boolean | undefined;
      expected: boolean;
    }> = [
      {
        name: "all identical",
        savedContext: baseContext,
        currentContext: baseContext,
        expected: true,
      },
      {
        name: "sourceEntries different text",
        savedContext: baseContext,
        currentContext: {
          ...baseContext,
          sourceEntries: [
            { id: 1, startTime: "00:00:00,000", endTime: "00:00:02,000", text: "Changed" },
            secondSourceLine,
          ],
        },
        expected: false,
      },
      {
        name: "sourceEntries different timestamp",
        savedContext: baseContext,
        currentContext: {
          ...baseContext,
          sourceEntries: [
            { id: 1, startTime: "00:00:00,500", endTime: "00:00:02,000", text: "Misheard word" },
            secondSourceLine,
          ],
        },
        expected: false,
      },
      {
        name: "cached entry count differs",
        savedContext: baseContext,
        currentContext: baseContext,
        transformCached: (cached) => ({ ...cached, entries: cached.entries.slice(0, 1) }),
        expected: false,
      },
      {
        name: "prompt attached first, then detached",
        savedContext: { ...baseContext, prompt: "Context note" },
        currentContext: { ...baseContext, prompt: undefined },
        expected: false,
      },
      {
        name: "prompt omitted first, then attached",
        savedContext: { ...baseContext, prompt: undefined },
        currentContext: { ...baseContext, prompt: "Context note" },
        expected: false,
      },
      {
        name: "prompt differs only in whitespace",
        savedContext: { ...baseContext, prompt: "  Base notes  " },
        currentContext: { ...baseContext, prompt: "Base notes" },
        expected: true,
      },
      {
        name: "glossaryHash attached first, then detached",
        savedContext: { ...baseContext, glossaryHash: "hashA" },
        currentContext: { ...baseContext, glossaryHash: undefined },
        expected: false,
      },
      {
        name: "glossaryHash differs",
        savedContext: { ...baseContext, glossaryHash: "hashA" },
        currentContext: { ...baseContext, glossaryHash: "hashB" },
        expected: false,
      },
      {
        name: "provider differs",
        savedContext: { ...baseContext, provider: "gemini" },
        currentContext: { ...baseContext, provider: "openrouter" },
        expected: false,
      },
      {
        name: "missing provider in cached defaults to gemini (hits gemini)",
        savedContext: { ...baseContext, provider: undefined },
        currentContext: { ...baseContext, provider: "gemini" },
        expected: true,
      },
      {
        name: "missing provider in cached defaults to gemini (misses openrouter)",
        savedContext: { ...baseContext, provider: undefined },
        currentContext: { ...baseContext, provider: "openrouter" },
        expected: false,
      },
      {
        name: "model differs",
        savedContext: { ...baseContext, model: DEFAULT_GEMINI_MODEL },
        currentContext: { ...baseContext, model: "gemini-2.5-flash" },
        expected: false,
      },
      {
        name: "omitted gemini model normalizes to DEFAULT_GEMINI_MODEL",
        savedContext: { ...baseContext, provider: "gemini", model: undefined },
        currentContext: { ...baseContext, provider: "gemini", model: DEFAULT_GEMINI_MODEL },
        expected: true,
      },
      {
        name: "omitted openrouter model normalizes to DEFAULT_OPENROUTER_LLM_MODEL",
        savedContext: {
          ...baseContext,
          provider: "openrouter",
          model: DEFAULT_OPENROUTER_LLM_MODEL,
        },
        currentContext: { ...baseContext, provider: "openrouter", model: undefined },
        expected: true,
      },
      {
        name: "missing sourceHash",
        savedContext: baseContext,
        currentContext: baseContext,
        transformCached: (cached) => {
          const copy = { ...cached };
          delete copy.sourceHash;
          return copy;
        },
        expected: false,
      },
      {
        name: "cached is undefined",
        savedContext: baseContext,
        currentContext: baseContext,
        isUndefinedCached: true,
        expected: false,
      },
    ];

    it.each(validityTable)(
      "isRefinementCacheValid: $name -> $expected",
      ({ savedContext, currentContext, transformCached, isUndefinedCached, expected }) => {
        let cached: CachedRefinement | undefined;
        if (!isUndefinedCached) {
          cached = createCachedRefinement(savedContext, defaultRefined);
          if (transformCached) {
            cached = transformCached(cached);
          }
        }
        expect(isRefinementCacheValid(cached, currentContext)).toBe(expected);
      },
    );

    function readRawCacheJson(): Record<string, unknown> {
      const cacheFile = path.join(customCacheDir, `${getFileCacheKey(testMediaFile)}.json`);
      return JSON.parse(fs.readFileSync(cacheFile, "utf-8")) as Record<string, unknown>;
    }

    it("saveRefinementCache preserves transcription, translations, chapters, and summaries", () => {
      saveTranscriptionCache(
        testMediaFile,
        createCachedTranscription({}, defaultSource, "en"),
        customCacheDir,
      );
      saveTranslationCache(
        testMediaFile,
        "ja",
        createCachedTranslation(
          "ja",
          {
            sourceEntries: defaultSource,
            model: DEFAULT_GEMINI_MODEL,
            contextWindowSize: DEFAULT_CONTEXT_WINDOW_SIZE,
          },
          defaultRefined,
        ),
        customCacheDir,
      );
      saveChaptersCache(
        testMediaFile,
        "ja",
        createCachedChapters("ja", { sourceEntries: defaultSource }, [
          { timestamp: "00:00", seconds: 0, title: "Intro" },
        ]),
        customCacheDir,
      );
      saveSummaryCache(
        testMediaFile,
        "ja",
        createCachedSummary(
          "ja",
          { sourceEntries: defaultSource },
          { title: "T", summary: "S", keyPoints: [], topics: [] },
        ),
        customCacheDir,
      );

      const refinement = createCachedRefinement(baseContext, defaultRefined);
      saveRefinementCache(testMediaFile, refinement, customCacheDir);

      const loaded = loadMediaCache(testMediaFile, customCacheDir);
      expect(loaded?.refinement).toEqual(refinement);
      expect(loaded?.transcription?.entries).toEqual(defaultSource);
      expect(loaded?.translations?.["ja"]?.entries).toEqual(defaultRefined);
      expect(loaded?.chapters?.["ja"]?.chapters).toHaveLength(1);
      expect(loaded?.summaries?.["ja"]?.summary.title).toBe("T");
    });

    const saveCases: Array<{
      name: string;
      runSave: () => void;
      checkTranslationsInitialized?: boolean | undefined;
    }> = [
      {
        name: "saveTranscriptionCache",
        runSave: () =>
          saveTranscriptionCache(
            testMediaFile,
            createCachedTranscription({}, defaultSource, "en"),
            customCacheDir,
          ),
        checkTranslationsInitialized: true,
      },
      {
        name: "saveTranslationCache",
        runSave: () =>
          saveTranslationCache(
            testMediaFile,
            "ja",
            createCachedTranslation(
              "ja",
              {
                sourceEntries: defaultSource,
                contextWindowSize: DEFAULT_CONTEXT_WINDOW_SIZE,
              },
              defaultRefined,
            ),
            customCacheDir,
          ),
      },
      {
        name: "saveChaptersCache",
        runSave: () =>
          saveChaptersCache(
            testMediaFile,
            "ja",
            createCachedChapters("ja", { sourceEntries: defaultSource }, []),
            customCacheDir,
          ),
      },
      {
        name: "saveSummaryCache",
        runSave: () =>
          saveSummaryCache(
            testMediaFile,
            "ja",
            createCachedSummary(
              "ja",
              { sourceEntries: defaultSource },
              { title: "T", summary: "S", keyPoints: [], topics: [] },
            ),
            customCacheDir,
          ),
      },
    ];

    it.each(saveCases)(
      "$name does not emit refinement key when never saved",
      ({ runSave, checkTranslationsInitialized }) => {
        runSave();
        const raw = readRawCacheJson();
        expect(Object.hasOwn(raw, "refinement")).toBe(false);
        if (checkTranslationsInitialized) {
          expect(raw["translations"]).toEqual({});
        }
      },
    );

    it.each(saveCases)("$name preserves existing refinement", ({ runSave }) => {
      const refinement = createCachedRefinement(baseContext, defaultRefined);
      saveRefinementCache(testMediaFile, refinement, customCacheDir);

      runSave();

      const loaded = loadMediaCache(testMediaFile, customCacheDir);
      expect(loaded?.refinement).toEqual(refinement);
    });
  });
});
