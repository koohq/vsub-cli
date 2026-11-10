import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type CachedChapters,
  type CachedSummary,
  clearCache,
  computeEntriesHash,
  createCachedChapters,
  createCachedSummary,
  createCachedTranscription,
  createCachedTranslation,
  type GeneratedCacheContext,
  getCacheDir,
  getCacheStats,
  getFileCacheKey,
  isChaptersCacheValid,
  isSummaryCacheValid,
  isTranscriptionCacheValid,
  isTranslationCacheValid,
  loadMediaCache,
  saveChaptersCache,
  saveSummaryCache,
  saveTranscriptionCache,
  saveTranslationCache,
  type TranscriptionCacheContext,
  type TranslationCacheContext,
} from "./cache.js";
import { DEFAULT_GROQ_MODEL } from "./config.js";
import type { SrtEntry } from "./srt.js";
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
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
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

    it("should change hash when file size or modification time changes", async () => {
      const key1 = getFileCacheKey(testMediaFile);
      // Change content and ensure mtime updates
      await new Promise((resolve) => setTimeout(resolve, 50));
      fs.appendFileSync(testMediaFile, " additional bytes");
      const key2 = getFileCacheKey(testMediaFile);
      expect(key1).not.toBe(key2);
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
      expect(cache?.version).toBe(1);
      expect(cache?.transcription?.detectedLanguage).toBe("en");
      expect(cache?.transcription?.entries).toHaveLength(2);
      expect(cache?.transcription?.entries[0]?.text).toBe("Hello world");
      expect(cache?.transcription?.model).toBe("whisper-large-v3-turbo");
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
});
