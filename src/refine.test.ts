import { beforeEach, describe, expect, it, vi } from "vitest";
import * as cacheModule from "./cache.js";
import { type RefineSourceEntriesParams, refineSourceEntries } from "./refine.js";
import type { SrtEntry } from "./srt.js";
import type { TextModel } from "./text/model.js";
import * as tasksModule from "./text/tasks.js";
import type { ProgressSpinner } from "./ui.js";

describe("src/refine.ts", () => {
  const sampleEntries: SrtEntry[] = [
    { id: 1, startTime: "00:00:01,000", endTime: "00:00:02,000", text: "誤認識のテスト" },
    { id: 2, startTime: "00:00:02,500", endTime: "00:00:04,000", text: "変更なしの行" },
  ];

  const refinedSampleEntries: SrtEntry[] = [
    { id: 1, startTime: "00:00:01,000", endTime: "00:00:02,000", text: "正しい表現のテスト" },
    { id: 2, startTime: "00:00:02,500", endTime: "00:00:04,000", text: "変更なしの行" },
  ];

  let mockSpinner: ProgressSpinner;
  let mockModel: TextModel;
  let getTextModelMock: ReturnType<typeof vi.fn<() => Promise<TextModel>>>;
  let refineSpy: ReturnType<typeof vi.spyOn>;
  let saveCacheSpy: ReturnType<typeof vi.spyOn>;

  function createParams(overrides?: Partial<RefineSourceEntriesParams>): RefineSourceEntriesParams {
    return {
      sourceEntries: sampleEntries,
      detectedLanguage: "ja",
      glossaryTargetLang: "en",
      cacheFilePath: "dummy.mp4",
      mediaCache: null,
      useCache: true,
      noCache: false,
      llm: { provider: "gemini", model: "gemini-3.8-flash" },
      getTextModel: getTextModelMock,
      spinner: mockSpinner,
      prefix: "",
      verbose: false,
      lang: "en",
      ...overrides,
    };
  }

  function createMediaCacheWithRefinement(entries: SrtEntry[]): cacheModule.MediaCacheData {
    const cacheContext: cacheModule.RefinementCacheContext = {
      sourceEntries: sampleEntries,
      provider: "gemini",
      model: "gemini-3.8-flash",
      prompt: undefined,
      glossaryHash: undefined,
    };
    return {
      version: 1,
      mediaPath: "dummy.mp4",
      mediaSize: 1000,
      mediaMtimeMs: 12345,
      createdAt: 1000,
      updatedAt: 1000,
      refinement: cacheModule.createCachedRefinement(cacheContext, entries),
    };
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    mockSpinner = {
      start: vi.fn().mockReturnThis(),
      updateText: vi.fn().mockReturnThis(),
      succeed: vi.fn().mockReturnThis(),
      fail: vi.fn().mockReturnThis(),
      info: vi.fn().mockReturnThis(),
      warn: vi.fn().mockReturnThis(),
      stop: vi.fn().mockReturnThis(),
    };
    mockModel = {
      logLabel: "MockModel",
      model: "mock-model",
      limits: { defaultConcurrency: 3 },
      generateJson: vi.fn(),
      classifyError: () => "retry",
      formatModelNotFound: () => "not found",
    };
    getTextModelMock = vi.fn().mockResolvedValue(mockModel);
    refineSpy = vi.spyOn(tasksModule, "refineSrtEntries").mockResolvedValue({
      entries: refinedSampleEntries,
      fallbackChunks: 0,
      totalChunks: 1,
    });
    saveCacheSpy = vi.spyOn(cacheModule, "saveRefinementCache").mockImplementation(() => {});
  });

  it("returns immediately without calling model, cache, or spinner when sourceEntries is empty", async () => {
    const result = await refineSourceEntries(createParams({ sourceEntries: [] }));

    expect(result).toEqual({
      entries: [],
      changedLines: 0,
      totalLines: 0,
      cached: false,
      fallbackChunks: 0,
    });
    expect(getTextModelMock).not.toHaveBeenCalled();
    expect(refineSpy).not.toHaveBeenCalled();
    expect(saveCacheSpy).not.toHaveBeenCalled();
    expect(mockSpinner.start).not.toHaveBeenCalled();
    expect(mockSpinner.succeed).not.toHaveBeenCalled();
  });

  it("uses cached refinement without calling getTextModel or saving cache when cache hits", async () => {
    const mediaCache = createMediaCacheWithRefinement(refinedSampleEntries);
    const result = await refineSourceEntries(createParams({ mediaCache }));

    expect(getTextModelMock).not.toHaveBeenCalled();
    expect(refineSpy).not.toHaveBeenCalled();
    expect(saveCacheSpy).not.toHaveBeenCalled();
    expect(result).toEqual({
      entries: refinedSampleEntries,
      changedLines: 1,
      totalLines: 2,
      cached: true,
      fallbackChunks: 0,
    });
    expect(mockSpinner.succeed).toHaveBeenCalledWith(
      "✍️ [2/4] Transcript refined - 1/2 lines changed [⚡ Cached]",
    );
  });

  it("calls getTextModel, refines, and saves cache on cache miss", async () => {
    const result = await refineSourceEntries(createParams({ mediaCache: null }));

    expect(getTextModelMock).toHaveBeenCalledTimes(1);
    expect(refineSpy).toHaveBeenCalledTimes(1);
    expect(saveCacheSpy).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      entries: refinedSampleEntries,
      changedLines: 1,
      totalLines: 2,
      cached: false,
      fallbackChunks: 0,
    });
    expect(mockSpinner.start).toHaveBeenCalledWith(
      "✍️ [2/4] Refining transcript via Gemini (gemini-3.8-flash) [1/1 chunks]...",
    );
    expect(mockSpinner.succeed).toHaveBeenCalledWith(
      "✍️ [2/4] Transcript refined - 1/2 lines changed",
    );
    expect(mockSpinner.warn).not.toHaveBeenCalled();
  });

  it("warns once and skips saving cache when fallbackChunks > 0", async () => {
    refineSpy.mockResolvedValueOnce({
      entries: sampleEntries,
      fallbackChunks: 1,
      totalChunks: 2,
    });

    const result = await refineSourceEntries(createParams());

    expect(saveCacheSpy).not.toHaveBeenCalled();
    expect(result.fallbackChunks).toBe(1);
    expect(result.changedLines).toBe(0);
    expect(mockSpinner.warn).toHaveBeenCalledTimes(1);
    expect(mockSpinner.warn).toHaveBeenCalledWith(
      "⚠️ [2/4] Refinement kept the original text for 1/2 chunks (the model's answer did not match the input lines)",
    );
  });

  it("ignores cached refinement when useCache is false (--fresh) and saves new cache when noCache is false", async () => {
    const mediaCache = createMediaCacheWithRefinement([
      { id: 1, startTime: "00:00:01,000", endTime: "00:00:02,000", text: "Old cached" },
      { id: 2, startTime: "00:00:02,500", endTime: "00:00:04,000", text: "変更なしの行" },
    ]);

    const result = await refineSourceEntries(
      createParams({ mediaCache, useCache: false, noCache: false }),
    );

    expect(getTextModelMock).toHaveBeenCalledTimes(1);
    expect(refineSpy).toHaveBeenCalledTimes(1);
    expect(saveCacheSpy).toHaveBeenCalledTimes(1);
    expect(result.cached).toBe(false);
    expect(result.entries).toEqual(refinedSampleEntries);
  });

  it("does not read or save cache when useCache is false and noCache is true", async () => {
    const mediaCache = createMediaCacheWithRefinement(refinedSampleEntries);

    await refineSourceEntries(createParams({ mediaCache, useCache: false, noCache: true }));

    expect(getTextModelMock).toHaveBeenCalledTimes(1);
    expect(refineSpy).toHaveBeenCalledTimes(1);
    expect(saveCacheSpy).not.toHaveBeenCalled();
  });

  it("resolves language-keyed glossary using glossaryTargetLang and forwards prompt as notes", async () => {
    const glossaryInput = JSON.stringify({
      en: { OpenRouter: "OpenRouter", "vsub-cli": "vsub" },
      zh: { OpenRouter: "OpenRouter-ZH" },
    });

    await refineSourceEntries(
      createParams({
        glossaryInput,
        glossaryTargetLang: "en",
        prompt: "Technical talk about CLI tools",
      }),
    );

    expect(refineSpy).toHaveBeenCalledWith(
      sampleEntries,
      mockModel,
      false,
      expect.any(Function),
      expect.objectContaining({
        language: "ja",
        notes: "Technical talk about CLI tools",
        glossary: { OpenRouter: "OpenRouter", "vsub-cli": "vsub" },
      }),
    );
  });
});
