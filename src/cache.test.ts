import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearCache,
  getCacheDir,
  getCacheStats,
  getFileCacheKey,
  isTranscriptionCacheValid,
  isTranslationCacheValid,
  loadMediaCache,
  saveTranscriptionCache,
  saveTranslationCache,
} from "./cache.js";
import type { SrtEntry } from "./srt.js";

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
    it("should check transcription cache prompt and model match", () => {
      const cached = {
        entries: [],
        prompt: "MyWhisperPrompt",
        model: "whisper-large-v3-turbo",
        createdAt: Date.now(),
      };
      expect(isTranscriptionCacheValid(cached)).toBe(true);
      expect(isTranscriptionCacheValid(cached, "MyWhisperPrompt")).toBe(true);
      expect(isTranscriptionCacheValid(cached, "MyWhisperPrompt", "whisper-large-v3-turbo")).toBe(
        true,
      );
      expect(isTranscriptionCacheValid(cached, "DifferentPrompt")).toBe(false);
      expect(isTranscriptionCacheValid(cached, "MyWhisperPrompt", "whisper-large-v3")).toBe(false);
      expect(isTranscriptionCacheValid(undefined)).toBe(false);
    });

    it("should check translation cache prompt, glossaryHash, and model match", () => {
      const cached = {
        targetLang: "ja",
        entries: [],
        model: "gemini-3.7-flash",
        prompt: "MyPrompt",
        glossaryHash: "hash123",
        createdAt: Date.now(),
      };
      expect(isTranslationCacheValid(cached)).toBe(true);
      expect(isTranslationCacheValid(cached, "MyPrompt", "hash123")).toBe(true);
      expect(isTranslationCacheValid(cached, "MyPrompt", "hash123", "gemini-3.7-flash")).toBe(true);
      expect(isTranslationCacheValid(cached, "DifferentPrompt", "hash123")).toBe(false);
      expect(isTranslationCacheValid(cached, "MyPrompt", "differentHash")).toBe(false);
      expect(isTranslationCacheValid(cached, "MyPrompt", "hash123", "gemini-2.5-flash")).toBe(
        false,
      );
      expect(isTranslationCacheValid(undefined)).toBe(false);
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
