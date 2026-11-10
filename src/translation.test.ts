import { beforeEach, describe, expect, it, vi } from "vitest";
import * as cacheModule from "./cache.js";
import type { SrtEntry } from "./srt.js";
import type { TextModel } from "./text/model.js";
import * as tasksModule from "./text/tasks.js";
import {
  resolveConcurrency,
  resolveContextWindowSize,
  type TranslateToTargetsParams,
  translateToTargets,
} from "./translation.js";
import type { ProgressSpinner } from "./ui.js";

describe("src/translation.ts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("resolveContextWindowSize", () => {
    it("should return default if undefined or NaN", () => {
      expect(resolveContextWindowSize(undefined)).toBe(5);
      expect(resolveContextWindowSize("abc")).toBe(5);
    });

    it("should floor and clamp positive numbers", () => {
      expect(resolveContextWindowSize("10.7")).toBe(10);
      expect(resolveContextWindowSize(-3)).toBe(0);
    });
  });

  describe("resolveConcurrency", () => {
    it("should parse valid positive numbers", () => {
      expect(resolveConcurrency("4")).toBe(4);
      expect(resolveConcurrency(3.8)).toBe(3);
    });

    it("should fall back to fallbackValue if optionValue is undefined, but return undefined if optionValue is non-positive or NaN", () => {
      expect(resolveConcurrency(undefined, 2)).toBe(2);
      expect(resolveConcurrency("0", 2)).toBeUndefined();
      expect(resolveConcurrency("-1", 2)).toBeUndefined();
      expect(resolveConcurrency("invalid", 2)).toBeUndefined();
      expect(resolveConcurrency(undefined, undefined)).toBeUndefined();
    });
  });

  describe("translateToTargets", () => {
    const sampleEntries: SrtEntry[] = [
      { id: 1, startTime: "00:00:01,000", endTime: "00:00:02,000", text: "Hello" },
    ];

    const mockSpinner: ProgressSpinner = {
      start: vi.fn(),
      updateText: vi.fn(),
      succeed: vi.fn(),
      fail: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      stop: vi.fn(),
    };

    const mockModel: TextModel = {
      logLabel: "MockModel",
      model: "mock-model",
      limits: { defaultConcurrency: 3 },
      generateJson: vi.fn(),
      classifyError: () => "retry",
      formatModelNotFound: () => "not found",
    };

    function createParams(overrides?: Partial<TranslateToTargetsParams>): TranslateToTargetsParams {
      return {
        sourceEntries: sampleEntries,
        targetLanguages: ["ja"],
        cacheFilePath: "dummy.mp4",
        mediaCache: null,
        useCache: true,
        noCache: false,
        contextWindowSize: 5,
        llm: { provider: "gemini", model: "gemini-3.8-flash" },
        getTextModel: vi.fn().mockResolvedValue(mockModel),
        messages: {
          translatingSingle: (_provider, model, lang, cur, tot) =>
            `Translating to ${lang} (${cur}/${tot}) via ${model}`,
          translatingMulti: (_provider, model, idx, total, lang, cur, tot) =>
            `Translating [${idx}/${total}] to ${lang} (${cur}/${tot}) via ${model}`,
        },
        spinner: mockSpinner,
        prefix: "",
        verbose: false,
        lang: "en",
        ...overrides,
      };
    }

    it("should not call getTextModel or translateSrtEntries when cache hits", async () => {
      const translateSpy = vi.spyOn(tasksModule, "translateSrtEntries");
      const saveCacheSpy = vi.spyOn(cacheModule, "saveTranslationCache");

      const cacheContext: cacheModule.TranslationCacheContext = {
        sourceEntries: sampleEntries,
        prompt: undefined,
        glossaryHash: undefined,
        model: "gemini-3.8-flash",
        contextWindowSize: 5,
      };

      const params = createParams({
        targetLanguages: ["ja"],
        mediaCache: {
          version: 1,
          mediaPath: "dummy.mp4",
          mediaSize: 1000,
          mediaMtimeMs: 12345,
          createdAt: 1000,
          updatedAt: 1000,
          translations: {
            ja: cacheModule.createCachedTranslation("ja", cacheContext, [
              { id: 1, startTime: "00:00:01,000", endTime: "00:00:02,000", text: "こんにちは" },
            ]),
          },
        },
      });

      const result = await translateToTargets(params);

      expect(params.getTextModel).not.toHaveBeenCalled();
      expect(translateSpy).not.toHaveBeenCalled();
      expect(saveCacheSpy).not.toHaveBeenCalled();
      expect(result.cachedLanguages).toEqual(["ja"]);
      expect(result.translatedLanguages).toEqual(["ja"]);
      expect(result.resultsByLang.get("ja")).toEqual([
        { id: 1, startTime: "00:00:01,000", endTime: "00:00:02,000", text: "こんにちは" },
      ]);
    });

    it("should not call getTextModel when all languages hit cache", async () => {
      const cacheContext: cacheModule.TranslationCacheContext = {
        sourceEntries: sampleEntries,
        prompt: undefined,
        glossaryHash: undefined,
        model: "gemini-3.8-flash",
        contextWindowSize: 5,
      };

      const params = createParams({
        targetLanguages: ["ja", "es"],
        mediaCache: {
          version: 1,
          mediaPath: "dummy.mp4",
          mediaSize: 1000,
          mediaMtimeMs: 12345,
          createdAt: 1000,
          updatedAt: 1000,
          translations: {
            ja: cacheModule.createCachedTranslation("ja", cacheContext, [
              { id: 1, startTime: "00:00:01,000", endTime: "00:00:02,000", text: "こんにちは" },
            ]),
            es: cacheModule.createCachedTranslation("es", cacheContext, [
              { id: 1, startTime: "00:00:01,000", endTime: "00:00:02,000", text: "Hola" },
            ]),
          },
        },
      });

      const result = await translateToTargets(params);

      expect(params.getTextModel).not.toHaveBeenCalled();
      expect(result.cachedLanguages).toEqual(["ja", "es"]);
      expect(result.translatedLanguages).toEqual(["ja", "es"]);
    });

    it("should call getTextModel exactly once even if multiple languages miss cache", async () => {
      vi.spyOn(tasksModule, "translateSrtEntries").mockResolvedValue([
        { id: 1, startTime: "00:00:01,000", endTime: "00:00:02,000", text: "Translated" },
      ]);
      vi.spyOn(cacheModule, "saveTranslationCache").mockImplementation(() => {});

      const params = createParams({
        targetLanguages: ["ja", "es"],
        mediaCache: null, // miss all
      });

      const result = await translateToTargets(params);

      expect(params.getTextModel).toHaveBeenCalledTimes(1);
      expect(result.translatedLanguages).toEqual(["ja", "es"]);
      expect(result.cachedLanguages).toEqual([]);
    });

    it("should not save cache when noCache is true", async () => {
      vi.spyOn(tasksModule, "translateSrtEntries").mockResolvedValue([
        { id: 1, startTime: "00:00:01,000", endTime: "00:00:02,000", text: "Translated" },
      ]);
      const saveCacheSpy = vi
        .spyOn(cacheModule, "saveTranslationCache")
        .mockImplementation(() => {});

      const params = createParams({
        targetLanguages: ["ja"],
        noCache: true,
      });

      await translateToTargets(params);
      expect(saveCacheSpy).not.toHaveBeenCalled();
    });

    it("should map skipped languages to sourceEntries and add to skippedLanguages", async () => {
      const params = createParams({
        targetLanguages: ["ja", "en"],
        shouldSkip: (lang) => lang === "en",
      });

      vi.spyOn(tasksModule, "translateSrtEntries").mockResolvedValue([
        { id: 1, startTime: "00:00:01,000", endTime: "00:00:02,000", text: "こんにちは" },
      ]);
      vi.spyOn(cacheModule, "saveTranslationCache").mockImplementation(() => {});

      const result = await translateToTargets(params);

      expect(result.skippedLanguages).toEqual(["en"]);
      expect(result.translatedLanguages).toEqual(["ja"]);
      expect(result.resultsByLang.get("en")).toEqual(sampleEntries);
    });

    it("should pass correct spinner index counting skipped languages", async () => {
      vi.spyOn(tasksModule, "translateSrtEntries").mockResolvedValue(sampleEntries);
      vi.spyOn(cacheModule, "saveTranslationCache").mockImplementation(() => {});

      const params = createParams({
        targetLanguages: ["en", "ja"], // en is skipped (index 0, so langIdx 1), ja is translated (index 1, so langIdx 2)
        shouldSkip: (lang) => lang === "en",
      });

      await translateToTargets(params);

      // Should have started spinner for JA with langIdx = 2 out of 2 langs
      expect(mockSpinner.start).toHaveBeenCalledWith(
        "Translating [2/2] to JA (1/1) via gemini-3.8-flash",
      );
    });

    it("should correctly compute totalGlossaryTerms", async () => {
      vi.spyOn(tasksModule, "translateSrtEntries").mockResolvedValue(sampleEntries);
      vi.spyOn(cacheModule, "saveTranslationCache").mockImplementation(() => {});

      const params = createParams({
        targetLanguages: ["ja"],
        glossaryInput: "foo=bar,baz=qux",
      });

      const result = await translateToTargets(params);
      expect(result.totalGlossaryTerms).toBe(2);
    });
  });
});
