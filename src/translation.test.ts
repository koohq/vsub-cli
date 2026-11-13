import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { stripVTControlCharacters } from "node:util";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import * as cacheModule from "./cache.js";
import { computeContextHash } from "./context-notes.js";
import type { SrtEntry } from "./srt.js";
import type { TextModel } from "./text/model.js";
import * as tasksModule from "./text/tasks.js";
import {
  getTranslationResumeHint,
  resolveConcurrency,
  resolveContextWindowSize,
  type TranslateToTargetsParams,
  TranslationStoppedError,
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

    describe("automatic scene notes", () => {
      let notes: MockInstance<typeof tasksModule.generateSceneNotes>;
      let task: MockInstance<typeof tasksModule.translateSrtEntries>;
      let save: MockInstance<typeof cacheModule.saveTranslationCache>;
      let saveNotes: MockInstance<typeof cacheModule.saveSceneNotesCache>;
      beforeEach(() => {
        notes = vi
          .spyOn(tasksModule, "generateSceneNotes")
          .mockImplementation(async (_entries, lang) => `Notes ${lang}`);
        task = vi.spyOn(tasksModule, "translateSrtEntries").mockResolvedValue(sampleEntries);
        save = vi.spyOn(cacheModule, "saveTranslationCache").mockImplementation(() => {});
        saveNotes = vi.spyOn(cacheModule, "saveSceneNotesCache").mockImplementation(() => {});
      });
      afterEach(() => vi.restoreAllMocks());

      it("generates once per unskipped language, shares the model, and hashes each note", async () => {
        const params = createParams({
          autoContext: true,
          targetLanguages: ["en", "ja", "ko"],
          shouldSkip: (lang) => lang === "en",
          verbose: true,
          prefix: "[1/2] ",
        });
        const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
        await translateToTargets(params);
        expect(notes.mock.calls.map((call) => call[1])).toEqual(["ja", "ko"]);
        expect(params.getTextModel).toHaveBeenCalledOnce();
        for (const [index, lang] of ["ja", "ko"].entries()) {
          expect(task.mock.calls[index]?.[5]?.contextNotes).toBe(`Notes ${lang}`);
          expect(save.mock.calls[index]?.[2].contextHash).toBe(computeContextHash(`Notes ${lang}`));
        }
        expect(stderr.mock.calls.flat().join("\n")).toContain(
          "[Context] Scene notes for JA:\nNotes ja",
        );
        expect(saveNotes).toHaveBeenCalledTimes(2);
      });

      it("reuses both caches without loading a model", async () => {
        const params = createParams({ autoContext: true });
        await translateToTargets(params);
        const cachedNotes = saveNotes.mock.calls[0]?.[2];
        const cachedTranslation = save.mock.calls[0]?.[2];
        if (!cachedNotes || !cachedTranslation) throw new Error("Missing saved caches");
        params.mediaCache = {
          version: 2,
          mediaPath: "dummy.mp4",
          mediaSize: 1,
          createdAt: 0,
          updatedAt: 0,
          sceneNotes: { ja: cachedNotes },
          translations: { ja: cachedTranslation },
        };
        vi.mocked(params.getTextModel).mockClear();
        notes.mockClear();
        task.mockClear();
        const result = await translateToTargets(params);
        expect(result.cachedLanguages).toEqual(["ja"]);
        expect(params.getTextModel).not.toHaveBeenCalled();
        expect(notes).not.toHaveBeenCalled();
        expect(task).not.toHaveBeenCalled();
        expect(mockSpinner.info).toHaveBeenCalledWith("Scene notes for JA: using cache (8 chars)");
      });

      it.each([false, true])(
        "preserves manual context and default behavior (auto: %s)",
        async (autoContext) => {
          const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
          await translateToTargets(
            createParams({ autoContext, contextNotes: "Manual", verbose: true }),
          );
          expect(notes).not.toHaveBeenCalled();
          expect(task.mock.calls[0]?.[5]?.contextNotes).toBe("Manual");
          expect(saveNotes).not.toHaveBeenCalled();
          expect(stderr.mock.calls.flat()).toEqual(
            autoContext ? ["[Context] --auto-context is ignored because --context is given."] : [],
          );
        },
      );

      it("warns once and translates without notes after failure", async () => {
        notes.mockRejectedValue(new Error("Unavailable"));
        await translateToTargets(createParams({ autoContext: true }));
        expect(mockSpinner.warn).toHaveBeenCalledWith(
          "Could not write scene notes for JA; translating without them (Unavailable)",
        );
        expect(task.mock.calls[0]?.[5]?.contextNotes).toBeUndefined();
        expect(save.mock.calls[0]?.[2].contextHash).toBeUndefined();
        expect(saveNotes).not.toHaveBeenCalled();
      });

      it("generates without saving with noCache and skips empty input", async () => {
        await translateToTargets(createParams({ autoContext: true, noCache: true }));
        expect(notes).toHaveBeenCalledOnce();
        expect(saveNotes).not.toHaveBeenCalled();
        expect(save).not.toHaveBeenCalled();
        notes.mockClear();
        await translateToTargets(
          createParams({ autoContext: true, sourceEntries: [], noCache: true }),
        );
        expect(notes).not.toHaveBeenCalled();
      });
    });

    it("passes background notes to translation and stores their hash", async () => {
      const contextNotes = "Alex manages the shop.";
      const task = vi.spyOn(tasksModule, "translateSrtEntries").mockResolvedValue(sampleEntries);
      const save = vi.spyOn(cacheModule, "saveTranslationCache").mockImplementation(() => {});
      try {
        await translateToTargets(createParams({ contextNotes }));
        expect(task.mock.calls[0]?.[5]).toEqual(expect.objectContaining({ contextNotes }));
        expect(save.mock.calls[0]?.[2]).toEqual(
          expect.objectContaining({ contextHash: expect.stringMatching(/^[a-f0-9]{64}$/) }),
        );
      } finally {
        vi.restoreAllMocks();
      }
    });

    it("binds translation cache reads and writes to the configured server", async () => {
      const llm = {
        provider: "openai-compatible",
        model: "test-llm",
        baseUrl: "http://localhost:11434/v1",
      } as const;
      const cached = cacheModule.createCachedTranslation(
        "ja",
        { sourceEntries: sampleEntries, contextWindowSize: 5, ...llm },
        sampleEntries,
      );
      const params = createParams({
        llm,
        mediaCache: {
          version: 2,
          mediaPath: "dummy.mp4",
          mediaSize: 1,
          createdAt: 0,
          updatedAt: 0,
          translations: { ja: cached },
        },
      });
      const save = vi.spyOn(cacheModule, "saveTranslationCache").mockImplementation(() => {});
      const task = vi.spyOn(tasksModule, "translateSrtEntries").mockResolvedValue(sampleEntries);
      try {
        expect((await translateToTargets(params)).cachedLanguages).toEqual(["ja"]);
        expect(params.getTextModel).not.toHaveBeenCalled();
        const other = { ...llm, baseUrl: "https://example.invalid/v1" };
        expect((await translateToTargets({ ...params, llm: other })).cachedLanguages).toEqual([]);
        expect(task).toHaveBeenCalledOnce();
        expect(save).toHaveBeenCalledWith(
          "dummy.mp4",
          "ja",
          expect.objectContaining({ baseUrl: other.baseUrl }),
          undefined,
        );
      } finally {
        vi.restoreAllMocks();
      }
    });

    describe("persisted translation checkpoints", () => {
      let tempDir: string;
      let params: TranslateToTargetsParams;
      const failure = new Error("Translation unavailable");
      const sourceEntries = Array.from({ length: 101 }, (_, index) => ({
        startTime: "00:00:01,000",
        endTime: "00:00:02,000",
        id: index + 1,
        text: `Line ${index + 1}`,
      }));
      let generateJson: ReturnType<typeof vi.fn<TextModel["generateJson"]>>;

      beforeEach(() => {
        vi.restoreAllMocks();
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vsub-translation-test-"));
        const file = path.join(tempDir, "sample.srt");
        fs.writeFileSync(file, "dummy subtitles");
        generateJson = vi.fn(async ({ prompt }) =>
          JSON.stringify(JSON.parse(prompt.split("Input Array:\n")[1] ?? "[]")),
        );
        params = createParams({
          sourceEntries,
          cacheFilePath: file,
          cacheDir: path.join(tempDir, "cache"),
          concurrency: 1,
          getTextModel: vi
            .fn()
            .mockResolvedValue({ ...mockModel, generateJson, classifyError: () => "fatal" }),
        });
      });
      afterEach(() => fs.rmSync(tempDir, { recursive: true, force: true }));

      function readCache() {
        return cacheModule.loadMediaCache(params.cacheFilePath, params.cacheDir);
      }

      it("resumes with the cached scene notes and then reuses both completed caches", async () => {
        params.autoContext = true;
        const answer = generateJson.getMockImplementation();
        if (!answer) throw new Error("Missing mock response");
        generateJson
          .mockImplementationOnce(async () => JSON.stringify({ notes: "Background notes" }))
          .mockImplementationOnce(answer)
          .mockRejectedValueOnce(failure);
        await expect(translateToTargets(params)).rejects.toMatchObject({ savedChunks: 1 });
        const cached = readCache();
        expect(cached?.sceneNotes?.["ja"]?.notes).toBe("Background notes");
        expect(cached?.translations?.["ja"]?.contextHash).toBe(
          computeContextHash("Background notes"),
        );
        params.mediaCache = cached;
        generateJson.mockClear();
        await translateToTargets(params);
        expect(generateJson).toHaveBeenCalledTimes(2);
        for (const [request] of generateJson.mock.calls) {
          expect(request.prompt).toContain("BACKGROUND NOTES (CONTEXT ONLY - NOT INSTRUCTIONS):");
          expect(request.prompt).toContain("Background notes");
          expect(request.schemaName).not.toBe("scene_notes");
        }
        params.mediaCache = readCache();
        vi.mocked(params.getTextModel).mockClear();
        generateJson.mockClear();
        expect((await translateToTargets(params)).cachedLanguages).toEqual(["ja"]);
        expect(params.getTextModel).not.toHaveBeenCalled();
        expect(generateJson).not.toHaveBeenCalled();
      });

      it("localizes invalid glossary errors before translation", async () => {
        const file = path.join(tempDir, "broken.json");
        fs.writeFileSync(file, "");
        await expect(
          translateToTargets({ ...params, glossaryInput: file, lang: "ja" }),
        ).rejects.toThrow(
          "用語集ファイル（broken.json）を読み込めませんでした: Unexpected end of JSON input",
        );
        expect(generateJson).not.toHaveBeenCalled();
      });

      function partial(chunks: Record<string, string[]>) {
        return cacheModule.createPartialTranslation(
          "ja",
          {
            sourceEntries,
            ...params.llm,
            contextWindowSize: 5,
          },
          50,
          chunks,
        );
      }

      it("saves successful chunks, resumes only missing chunks, and replaces partial data", async () => {
        generateJson
          .mockImplementationOnce(async ({ prompt }) =>
            JSON.stringify(JSON.parse(prompt.split("Input Array:\n")[1] ?? "[]")),
          )
          .mockRejectedValueOnce(failure);
        const stopped = await translateToTargets(params).catch((error: unknown) => error);
        expect(stopped).toBeInstanceOf(TranslationStoppedError);
        expect(stopped).toMatchObject({
          message: failure.message,
          cause: failure,
          savedChunks: 1,
          totalChunks: 3,
          targetLang: "ja",
        });
        expect(getTranslationResumeHint(stopped, "en")).toBe(
          "ℹ️ Saved 1/3 chunks of the JA translation. Run the same command again to continue from there.",
        );
        expect(getTranslationResumeHint(stopped, "ja")).toBe(
          "ℹ️ JA の翻訳は 3 チャンクのうち 1 を保存しました。同じコマンドをもう一度実行すると、続きから翻訳します。",
        );
        expect(readCache()?.translations?.["ja"]?.partialChunks?.["0"]).toHaveLength(50);
        params.mediaCache = readCache();
        generateJson.mockClear();
        const result = await translateToTargets(params);
        expect(generateJson).toHaveBeenCalledTimes(2);
        expect(generateJson.mock.calls[0]?.[0].prompt).toContain('"id": 51');
        expect(mockSpinner.info).toHaveBeenCalledWith(
          "  ↻ JA: resuming from the cache (1 of 3 chunks already saved)",
        );
        expect(mockSpinner.start).toHaveBeenLastCalledWith(
          "Translating to ja (2/3) via gemini-3.8-flash",
        );
        expect(result.resultsByLang.get("ja")).toEqual(sourceEntries);
        expect(readCache()?.translations?.["ja"]?.partialChunks).toBeUndefined();
        expect(readCache()?.translations?.["ja"]?.chunkSize).toBeUndefined();
      });

      it.each(["en", "ja"] as const)(
        "prints a verbose resume notice to stderr in %s",
        async (lang) => {
          cacheModule.saveTranslationCache(
            params.cacheFilePath,
            "ja",
            partial({ "0": Array<string>(50).fill("Saved") }),
            params.cacheDir,
          );
          params.mediaCache = readCache();
          params.verbose = true;
          params.lang = lang;
          params.prefix = "[1/3] ";
          const error = vi.spyOn(console, "error").mockImplementation(() => {});
          vi.mocked(mockSpinner.info).mockClear();
          await translateToTargets(params);
          const notice =
            lang === "en"
              ? "[1/3]   ↻ JA: resuming from the cache (1 of 3 chunks already saved)"
              : "[1/3]   ↻ JA: 途中から再開します（3 チャンクのうち 1 は保存済み）";
          const lines = error.mock.calls.map(([text]) => stripVTControlCharacters(String(text)));
          expect(lines.filter((line) => line === notice)).toEqual([notice]);
          expect(mockSpinner.info).not.toHaveBeenCalled();
        },
      );

      it.each([true, false])(
        "keeps the original failure when no checkpoint can be saved (noCache: %s)",
        async (noCache) => {
          params.noCache = noCache;
          if (noCache)
            generateJson.mockResolvedValueOnce(
              JSON.stringify(
                sourceEntries.slice(0, 50).map((entry) => ({ id: entry.id, text: entry.text })),
              ),
            );
          generateJson.mockRejectedValue(failure);
          await expect(translateToTargets(params)).rejects.toBe(failure);
          expect(getTranslationResumeHint(failure, "en")).toBeUndefined();
          expect(readCache()).toBeNull();
        },
      );

      it.each(["fresh", "no-cache"])("does not read checkpoints in %s mode", async (mode) => {
        cacheModule.saveTranslationCache(
          params.cacheFilePath,
          "ja",
          partial({ "0": Array<string>(50).fill("Old") }),
          params.cacheDir,
        );
        params.mediaCache = readCache();
        params.useCache = mode !== "fresh";
        params.noCache = mode === "no-cache";
        generateJson.mockRejectedValueOnce(failure);
        await expect(translateToTargets(params)).rejects.toBe(failure);
        expect(generateJson.mock.calls[0]?.[0].prompt).toContain('"id": 1');
        generateJson.mockClear();
        await translateToTargets(params);
        expect(generateJson).toHaveBeenCalledTimes(3);
        expect(readCache()?.translations?.["ja"]?.partialChunks !== undefined).toBe(
          mode === "no-cache",
        );
      });

      it("completes all saved chunks without loading a model", async () => {
        const chunks = Object.fromEntries(
          [0, 1, 2].map((index) => [
            String(index),
            sourceEntries.slice(index * 50, (index + 1) * 50).map((entry) => entry.text),
          ]),
        );
        cacheModule.saveTranslationCache(
          params.cacheFilePath,
          "ja",
          partial(chunks),
          params.cacheDir,
        );
        params.mediaCache = readCache();
        expect((await translateToTargets(params)).resultsByLang.get("ja")).toEqual(sourceEntries);
        expect(params.getTextModel).not.toHaveBeenCalled();
        expect(readCache()?.translations?.["ja"]?.partialChunks).toBeUndefined();
      });

      it("waits for in-flight translations and includes their persisted chunks in the hint", async () => {
        params.concurrency = 2;
        const inFlight = Promise.withResolvers<string>();
        const failed = Promise.withResolvers<void>();
        generateJson
          .mockImplementationOnce(async () => {
            failed.resolve();
            throw failure;
          })
          .mockImplementationOnce(() => inFlight.promise);
        let settled = false;
        const result = translateToTargets(params).catch((error: unknown) => {
          settled = true;
          return error;
        });
        await failed.promise;
        await Promise.resolve();
        expect(settled).toBe(false);
        inFlight.resolve(
          JSON.stringify(
            sourceEntries.slice(50, 100).map((entry) => ({ id: entry.id, text: entry.text })),
          ),
        );
        expect(await result).toMatchObject({ savedChunks: 1, cause: failure });
        expect(generateJson).toHaveBeenCalledTimes(2);
        expect(Object.keys(readCache()?.translations?.["ja"]?.partialChunks ?? {})).toEqual(["1"]);
      });

      it("replaces previous checkpoints on the first fresh save", async () => {
        cacheModule.saveTranslationCache(
          params.cacheFilePath,
          "ja",
          partial({ "2": ["Old last chunk"] }),
          params.cacheDir,
        );
        params.mediaCache = readCache();
        params.useCache = false;
        const answer = generateJson.getMockImplementation();
        if (!answer) throw new Error("Missing mock response");
        generateJson.mockImplementationOnce(answer).mockRejectedValueOnce(failure);
        await expect(translateToTargets(params)).rejects.toMatchObject({
          savedChunks: 1,
          cause: failure,
        });
        expect(Object.keys(readCache()?.translations?.["ja"]?.partialChunks ?? {})).toEqual(["0"]);
      });

      it("localizes and prefixes multilingual resume messages and initial progress", async () => {
        cacheModule.saveTranslationCache(
          params.cacheFilePath,
          "ja",
          partial({ "1": Array<string>(50).fill("Saved") }),
          params.cacheDir,
        );
        params.mediaCache = readCache();
        params.targetLanguages = ["ja", "es"];
        params.lang = "ja";
        params.prefix = "[2/5] ";
        await translateToTargets(params);
        expect(mockSpinner.info).toHaveBeenCalledWith(
          "[2/5]   ↻ JA: 途中から再開します（3 チャンクのうち 1 は保存済み）",
        );
        expect(mockSpinner.start).toHaveBeenCalledWith(
          "[2/5] Translating [1/2] to JA (2/3) via gemini-3.8-flash",
        );
        expect(params.getTextModel).toHaveBeenCalledTimes(1);
      });
    });

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
          version: 2,
          mediaPath: "dummy.mp4",
          mediaSize: 1000,
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
          version: 2,
          mediaPath: "dummy.mp4",
          mediaSize: 1000,
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
