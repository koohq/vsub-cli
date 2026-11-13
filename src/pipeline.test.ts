import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { stripVTControlCharacters } from "node:util";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import * as cacheModule from "./cache.js";
import {
  createCachedChapters,
  createCachedSummary,
  createCachedTranslation,
  loadMediaCache,
  saveChaptersCache,
  saveSummaryCache,
  saveTranscriptionCache,
  saveTranslationCache,
} from "./cache.js";
import * as configModule from "./config.js";
import { DEFAULT_GEMINI_MODEL, DEFAULT_GROQ_MODEL, saveGlobalConfig } from "./config.js";
import { computeContextHash } from "./context-notes.js";
import {
  burnSubtitlesToVideo,
  checkFfmpeg,
  embedSubtitlesToVideo,
  extractAudio,
} from "./ffmpeg.js";
import type { ChaptersFormat, SummaryFormat } from "./formatter.js";
import { type ChapterItem, secondsToTimestamp } from "./formatter.js";
import * as glossaryModule from "./glossary.js";
import { computeGlossaryHash, extractWhisperPromptHints } from "./glossary.js";
import { getI18n } from "./i18n/index.js";
import { parseTargetLanguages } from "./languages.js";
import {
  findOutputPathConflict,
  parseBilingualOrder,
  processChaptersPipeline,
  processMediaPipeline,
  processSummaryPipeline,
  resolveBurntVideoPath,
  resolveEmbeddedVideoPath,
  resolveOutputFilePaths,
  resolveTranscriptEntries,
  resolveTranscriptionContext,
} from "./pipeline.js";
import * as safetyModule from "./safety.js";
import * as srtModule from "./srt.js";
import { reflowSrtEntries, type SrtEntry } from "./srt.js";
import { isolateConfigAndEnv } from "./test-support/isolate-config-env.js";
import { DEFAULT_OPENROUTER_LLM_MODEL } from "./text/openrouter.js";
import * as selectModule from "./text/select.js";
import {
  DEFAULT_CONTEXT_WINDOW_SIZE,
  generateChapters,
  generateSceneNotes,
  generateSummary,
  refineSrtEntries,
  translateSrtEntries,
} from "./text/tasks.js";
import { DEFAULT_OPENROUTER_STT_MODEL } from "./transcribe/openrouter.js";
import { transcribeAudioSegments } from "./transcribe/transcriber.js";
import { buildEntriesFromWords, type WordChunk } from "./transcribe/words.js";
import * as ui from "./ui.js";

vi.mock("./text/tasks.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./text/tasks.js")>();
  return {
    ...actual,
    refineSrtEntries: vi.fn().mockImplementation(async (entries: SrtEntry[]) => ({
      entries,
      fallbackChunks: 0,
      totalChunks: entries.length === 0 ? 0 : Math.ceil(entries.length / 50),
    })),
    translateSrtEntries: vi.fn().mockImplementation(async (entries: unknown[]) => entries),
    generateSceneNotes: vi.fn().mockResolvedValue("Scene notes"),
    generateChapters: vi.fn().mockResolvedValue([
      { timestamp: "00:00", seconds: 0, title: "Introduction" },
      { timestamp: "01:23", seconds: 83, title: "Getting Started" },
    ]),
    generateSummary: vi.fn().mockResolvedValue({
      title: "Sample Title",
      summary: "Sample Summary Paragraph",
      keyPoints: ["Point 1", "Point 2"],
      topics: [{ timestamp: "00:00", title: "Intro", description: "Details" }],
    }),
  };
});

vi.mock("./ffmpeg.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./ffmpeg.js")>();
  return {
    ...actual,
    checkFfmpeg: vi.fn().mockResolvedValue(undefined),
    extractAudio: vi.fn().mockResolvedValue({ audioPaths: [], cleanup: async () => {} }),
    burnSubtitlesToVideo: vi.fn().mockImplementation(async (_video, _sub, output) => {
      fs.writeFileSync(output, "dummy burnt video");
      return output;
    }),
    embedSubtitlesToVideo: vi.fn().mockImplementation(async (_video, _subs, output) => {
      fs.writeFileSync(output, "dummy embedded video");
      return output;
    }),
  };
});

vi.mock("./transcribe/transcriber.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./transcribe/transcriber.js")>();
  return {
    ...actual,
    transcribeAudioSegments: vi.fn().mockResolvedValue({
      entries: [
        { id: 1, startTime: "00:00:00,000", endTime: "00:00:02,000", text: "Hello mock groq" },
      ],
      detectedLanguage: "en",
    }),
  };
});

describe("pipeline.ts", () => {
  describe("common reasoning effort", () => {
    function setup() {
      vi.clearAllMocks();
      vi.spyOn(console, "log").mockImplementation(() => {});
      const file = path.join(tempDir, "reasoning.mp4");
      fs.writeFileSync(file, "dummy media");
      const spinner = ui.createSpinner("", { isSilent: true });
      vi.spyOn(ui, "createSpinner").mockReturnValue(spinner);
      const start = vi.spyOn(spinner, "start");
      const model = vi.spyOn(selectModule, "createTextModel");
      const options = {
        mediaFile: file,
        inputFile: file,
        cacheDir: path.join(tempDir, "cache"),
        overwrite: true,
        targetLang: "ja",
        lang: "en" as const,
        sttProvider: "groq",
        llmProvider: "gemini",
      };
      return { file, start, model, options };
    }

    it.each(["media", "chapters", "summary"] as const)(
      "rejects invalid %s effort before work",
      async (task) => {
        const { start, options } = setup();
        process.env["VSUB_LLM_REASONING_EFFORT"] = " Bogus ";
        const run =
          task === "media"
            ? processMediaPipeline
            : task === "chapters"
              ? processChaptersPipeline
              : processSummaryPipeline;
        await expect(run(options)).rejects.toThrow('Unsupported reasoning effort: "Bogus"');
        expect(start).not.toHaveBeenCalled();
        expect(checkFfmpeg).not.toHaveBeenCalled();
        expect(transcribeAudioSegments).not.toHaveBeenCalled();
      },
    );

    it("passes effort through refinement, translation, scene notes, chapters and summaries without invalidating transcription", async () => {
      const { file, model, options } = setup();
      const run = async (effort: string) => {
        await processMediaPipeline({
          ...options,
          llmReasoningEffort: effort,
          refine: true,
          autoContext: true,
        });
        await processChaptersPipeline({ ...options, llmReasoningEffort: effort });
        await processSummaryPipeline({ ...options, llmReasoningEffort: effort });
      };
      await run(" Medium ");
      const cache = loadMediaCache(file, options.cacheDir);
      for (const cached of [
        cache?.refinement,
        cache?.translations?.["ja"],
        cache?.sceneNotes?.["ja"],
        cache?.chapters?.["ja"],
        cache?.summaries?.["ja"],
      ])
        expect(cached?.reasoningEffort).toBe("medium");
      for (const call of model.mock.calls) expect(call[1].reasoningEffort).toBe("medium");
      await run("medium");
      expect(refineSrtEntries).toHaveBeenCalledTimes(1);
      expect(translateSrtEntries).toHaveBeenCalledTimes(1);
      expect(generateSceneNotes).toHaveBeenCalledTimes(1);
      expect(generateChapters).toHaveBeenCalledTimes(1);
      expect(generateSummary).toHaveBeenCalledTimes(1);
      await run("high");
      expect(refineSrtEntries).toHaveBeenCalledTimes(2);
      expect(translateSrtEntries).toHaveBeenCalledTimes(2);
      expect(generateSceneNotes).toHaveBeenCalledTimes(2);
      expect(generateChapters).toHaveBeenCalledTimes(2);
      expect(generateSummary).toHaveBeenCalledTimes(2);
      expect(transcribeAudioSegments).toHaveBeenCalledTimes(1);
      expect(loadMediaCache(file, options.cacheDir)?.transcription).toEqual(cache?.transcription);
    });
  });
  it.each(["groq", "openrouter", "openai-compatible"] as const)(
    "gates speaker requests for %s",
    (provider) => {
      const stt = { provider, model: " ElevenLabs/Scribe-v2 ", source: "option" } as const;
      const enabled = resolveTranscriptionContext({ diarize: true }, stt);
      expect(enabled.diarize).toBe(provider === "openrouter" ? true : undefined);
      expect(
        resolveTranscriptionContext({ diarize: true }, stt, { diarize: false }),
      ).not.toHaveProperty("diarize");
      const unsupported = resolveTranscriptionContext(
        { diarize: true },
        { ...stt, model: "other" },
        undefined,
        "en",
      );
      expect(unsupported.diarizeWarning).toEqual(
        provider === "openrouter" ? expect.stringContaining("not requested") : undefined,
      );
    },
  );
  describe("speaker labels through pipelines", () => {
    function setupSpeakers() {
      vi.clearAllMocks();
      vi.spyOn(console, "log").mockImplementation(() => {});
      const notice = vi.spyOn(ui, "showSpinnerNotice");
      const file = path.join(tempDir, "talk.mp4");
      fs.writeFileSync(file, "dummy media");
      process.env["VSUB_OPENROUTER_API_KEY"] = "test-key";
      const words = [
        { start: 0, end: 0.4, text: "Hello", speaker: "speaker_0" },
        { start: 0.4, end: 0.8, text: "there", speaker: "speaker_1" },
      ];
      const wordChunks = [{ offsetSeconds: 0, words }];
      const entries = buildEntriesFromWords(wordChunks);
      const options = {
        mediaFile: file,
        inputFile: file,
        filePath: file,
        cacheDir: path.join(tempDir, "cache"),
        overwrite: true,
        targetLang: "ja",
        lang: "en" as const,
        silentSummary: true,
        diarize: true,
        sttProvider: "openrouter",
        llmProvider: "gemini",
      };
      return { file, options, wordChunks, entries, notice };
    }

    it("rebuilds labeled subtitles from cache, preserves them through refinement, and shares the cache with text tasks", async () => {
      const { file, options, entries, wordChunks } = setupSpeakers();
      vi.mocked(transcribeAudioSegments).mockResolvedValueOnce({
        entries,
        wordChunks,
        detectedLanguage: "en",
      });
      const first = await processMediaPipeline({
        ...options,
        refine: true,
        saveOriginal: true,
        format: "json",
      });
      expect(first.speakersCount).toBe(2);
      expect(transcribeAudioSegments).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        false,
        expect.any(Function),
        expect.objectContaining({ diarize: true }),
      );
      expect(vi.mocked(refineSrtEntries).mock.calls[0]?.[0]).toEqual(entries);
      expect(vi.mocked(translateSrtEntries).mock.calls[0]?.[0]).toEqual(entries);
      const cache = loadMediaCache(file, options.cacheDir)?.transcription;
      expect(cache).toMatchObject({ diarize: true, wordChunks });
      for (const output of first.outputFiles)
        expect(fs.readFileSync(output, "utf8")).not.toContain('"speaker"');
      const second = await processMediaPipeline({ ...options, refine: true, maxLength: 4 });
      expect(second.speakersCount).toBe(2);
      await processChaptersPipeline(options);
      await processSummaryPipeline(options);
      expect(transcribeAudioSegments).toHaveBeenCalledTimes(1);
      expect(vi.mocked(generateChapters).mock.calls[0]?.[0]).toEqual(entries);
      expect(vi.mocked(generateSummary).mock.calls[0]?.[0]).toEqual(entries);
      vi.mocked(transcribeAudioSegments).mockResolvedValueOnce({
        entries: entries.map(({ speaker: _speaker, ...entry }) => entry),
        detectedLanguage: "en",
      });
      await processMediaPipeline({ ...options, diarize: false });
      expect(transcribeAudioSegments).toHaveBeenCalledTimes(2);
      expect(loadMediaCache(file, options.cacheDir)?.transcription).not.toHaveProperty("diarize");
    });

    it.each(["media", "chapters", "summarize"] as const)(
      "warns only when %s actually transcribes an unsupported OpenRouter model",
      async (task) => {
        const { options, notice } = setupSpeakers();
        const run =
          task === "media"
            ? processMediaPipeline
            : task === "chapters"
              ? processChaptersPipeline
              : processSummaryPipeline;
        const opts = { ...options, sttModel: "other-model" };
        await run(opts);
        expect(
          notice.mock.calls.filter(
            (call) => call[2] === "warn" && String(call[3]).includes("--diarize"),
          ),
        ).toHaveLength(1);
        expect(vi.mocked(transcribeAudioSegments).mock.calls[0]?.[4]).not.toHaveProperty("diarize");
        notice.mockClear();
        await run(opts);
        expect(
          notice.mock.calls.filter(
            (call) => call[2] === "warn" && String(call[3]).includes("--diarize"),
          ),
        ).toHaveLength(0);
        expect(transcribeAudioSegments).toHaveBeenCalledTimes(1);
      },
    );

    it.each(["groq", "openai-compatible"] as const)(
      "does not request speakers or warn for %s",
      async (sttProvider) => {
        const { options, notice } = setupSpeakers();
        saveGlobalConfig({
          openaiCompatibleSttBaseUrl: "http://localhost:8000/v1",
          openaiCompatibleSttModel: "test-stt",
        });
        await processMediaPipeline({ ...options, sttProvider });
        expect(vi.mocked(transcribeAudioSegments).mock.calls[0]?.[4]).not.toHaveProperty("diarize");
        expect(
          notice.mock.calls.filter(
            (call) => call[2] === "warn" && String(call[3]).includes("--diarize"),
          ),
        ).toHaveLength(0);
      },
    );
  });
  describe("glossary transcription hints", () => {
    const glossary = Array.from({ length: 100 }, (_, i) => `用語${i}=訳語${i}`).join(", ");
    const stt = { provider: "groq", model: "test-whisper", source: "option" } as const;

    it("localizes errors when resolving Groq glossary hints", () => {
      const file = path.join(tempDir, "broken.json");
      fs.writeFileSync(file, "");
      expect(() => resolveTranscriptionContext({ glossary: file }, stt, undefined, "ja")).toThrow(
        "用語集ファイル（broken.json）を読み込めませんでした: Unexpected end of JSON input",
      );
    });

    it("limits generated Groq prompts to 224 UTF-8 bytes", () => {
      const context = resolveTranscriptionContext({ glossary }, stt);
      expect(context.prompt).toBeTruthy();
      expect(Buffer.byteLength(context.prompt ?? "", "utf8")).toBeLessThanOrEqual(224);
    });

    it.each(["config", "cli"])("preserves explicit long prompts from %s", (source) => {
      const whisperPrompt = "利用者のヒント".repeat(100);
      const context = resolveTranscriptionContext(
        { glossary, ...(source === "config" ? { whisperPrompt } : {}) },
        stt,
        source === "cli" ? { whisperPrompt } : undefined,
      );
      expect(context.prompt).toBe(whisperPrompt);
    });

    it("does not send glossary hints to OpenRouter", () => {
      expect(
        resolveTranscriptionContext({ glossary }, { ...stt, provider: "openrouter" }).prompt,
      ).toBeUndefined();
    });
  });
  let tempDir: string;
  let configHome: string;
  const originalEnv = process.env;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vsub-pipeline-test-"));
    process.env = {
      ...originalEnv,
      VSUB_GEMINI_API_KEY: "test-gemini-api-key",
      VSUB_GROQ_API_KEY: "test-groq-api-key",
    };
    ({ configHome } = isolateConfigAndEnv(tempDir));
  });

  afterEach(() => {
    process.env = originalEnv;
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
    vi.restoreAllMocks();
  });

  it.each(["media", "chapters", "summarize"] as const)(
    "passes Japanese to %s FFmpeg calls",
    async (task) => {
      vi.clearAllMocks();
      vi.spyOn(console, "log").mockImplementation(() => {});
      const mediaFile = path.join(tempDir, "video.mp4");
      fs.writeFileSync(mediaFile, "dummy media");
      const options = { mediaFile, lang: "ja" as const, noCache: true, sttProvider: "groq" };
      if (task === "media") {
        await processMediaPipeline({ ...options, embed: true, targetLang: "ja" });
        expect(embedSubtitlesToVideo).toHaveBeenCalledWith(
          mediaFile,
          expect.anything(),
          expect.anything(),
          expect.objectContaining({ lang: "ja" }),
        );
      } else if (task === "chapters") {
        await processChaptersPipeline({ ...options, inputFile: mediaFile });
      } else {
        await processSummaryPipeline({ ...options, inputFile: mediaFile });
      }
      expect(checkFfmpeg).toHaveBeenCalledWith("ffmpeg", "ja");
      expect(extractAudio).toHaveBeenCalledWith(
        mediaFile,
        "ffmpeg",
        expect.anything(),
        false,
        "ja",
      );
    },
  );

  describe("background notes", () => {
    it.each([false, true])(
      "passes notes to both tasks and invalidates only text caches (file: %s)",
      async (fromFile) => {
        vi.clearAllMocks();
        vi.spyOn(console, "log").mockImplementation(() => {});
        const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
        const mediaFile = path.join(tempDir, "talk.mp4");
        const notesFile = path.join(tempDir, "cast.txt");
        const cacheDir = path.join(tempDir, "cache");
        fs.writeFileSync(mediaFile, "dummy media");
        const entries = [
          { id: 1, startTime: "00:00:00,000", endTime: "00:00:02,000", text: "Hello" },
        ];
        saveTranscriptionCache(
          mediaFile,
          { entries, provider: "groq", detectedLanguage: "en", createdAt: 0 },
          cacheDir,
        );
        const options = {
          mediaFile,
          cacheDir,
          targetLang: "ja",
          refine: true,
          sttProvider: "groq",
          overwrite: true,
          verbose: fromFile,
        };
        const run = async (text: string) => {
          fs.writeFileSync(notesFile, `\uFEFF ${text}\n`);
          await processMediaPipeline({ ...options, context: fromFile ? notesFile : text });
        };
        const notes = "Alex manages the shop.";
        await run(notes);
        expect(vi.mocked(refineSrtEntries).mock.calls[0]?.[4]).toEqual(
          expect.objectContaining({ contextNotes: notes }),
        );
        expect(vi.mocked(translateSrtEntries).mock.calls[0]?.[5]).toEqual(
          expect.objectContaining({ contextNotes: notes }),
        );
        const cache = loadMediaCache(mediaFile, cacheDir);
        expect(cache?.refinement?.contextHash).toBe(computeContextHash(notes));
        expect(cache?.translations?.["ja"]?.contextHash).toBe(computeContextHash(notes));
        const contextLines = stderr.mock.calls
          .map(([line]) => stripVTControlCharacters(String(line)))
          .filter((line) => line.startsWith("[Context]"));
        expect(contextLines).toEqual(
          fromFile ? [`[Context] Background notes from cast.txt (${notes.length} chars)`] : [],
        );
        await run(notes);
        expect(refineSrtEntries).toHaveBeenCalledTimes(1);
        expect(translateSrtEntries).toHaveBeenCalledTimes(1);
        await run("Sam manages the shop.");
        expect(refineSrtEntries).toHaveBeenCalledTimes(2);
        expect(translateSrtEntries).toHaveBeenCalledTimes(2);
        expect(transcribeAudioSegments).not.toHaveBeenCalled();
        expect(loadMediaCache(mediaFile, cacheDir)?.transcription).toEqual(cache?.transcription);
      },
    );

    it.each(["en", "ja"] as const)(
      "fails before output directories, safety checks, keys, or ffmpeg (%s)",
      async (lang) => {
        vi.clearAllMocks();
        const notes = path.join(tempDir, "cast.txt");
        const outputDir = path.join(tempDir, "output");
        fs.writeFileSync(notes, "notes");
        const read = fs.readFileSync;
        vi.spyOn(fs, "readFileSync").mockImplementation((...args) => {
          if (args[0] === notes) throw new Error("denied");
          return read(...args);
        });
        const safety = vi.spyOn(safetyModule, "ensureWritableTargets");
        const ensure = vi.spyOn(configModule, "ensureApiKeys");
        await expect(
          processMediaPipeline({ mediaFile: "talk.mp4", outputDir, context: notes, lang }),
        ).rejects.toThrow(getI18n(lang).common.contextReadFailed("cast.txt", "denied"));
        expect(fs.existsSync(outputDir)).toBe(false);
        expect(safety).not.toHaveBeenCalled();
        expect(ensure).not.toHaveBeenCalled();
        expect(checkFfmpeg).not.toHaveBeenCalled();
      },
    );
  });

  describe("OpenAI-compatible transcription", () => {
    function spyOnSpinnerStart() {
      const spinner = ui.createSpinner("", { isSilent: true });
      vi.spyOn(ui, "createSpinner").mockReturnValue(spinner);
      return vi.spyOn(spinner, "start");
    }

    it("fails before extraction, FFmpeg and spinner start when the URL is missing", async () => {
      const mediaFile = path.join(tempDir, "sample.mp4");
      fs.writeFileSync(mediaFile, "test media");
      saveGlobalConfig({ sttProvider: "openai-compatible", openaiCompatibleSttModel: "test-stt" });
      const ensure = vi.spyOn(configModule, "ensureApiKeys");
      const start = spyOnSpinnerStart();
      vi.mocked(checkFfmpeg).mockClear();
      await expect(
        processMediaPipeline({ mediaFile, noTranslate: true, noCache: true, lang: "en" }),
      ).rejects.toThrow(
        "OpenAI-compatible transcription is not configured:\n- Base URL: set VSUB_OPENAI_COMPATIBLE_STT_BASE_URL or run vsub config set --openai-compatible-stt-base-url <url> (e.g. http://localhost:8000/v1)",
      );
      expect(checkFfmpeg).not.toHaveBeenCalled();
      expect(start).not.toHaveBeenCalled();
      expect(extractAudio).not.toHaveBeenCalled();
      expect(ensure).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          requireGroq: false,
          requireOpenRouter: false,
          requireGemini: false,
        }),
      );
    });

    it.each([processChaptersPipeline, processSummaryPipeline])(
      "rejects missing transcription URL before FFmpeg in text tasks (%#)",
      async (run) => {
        const inputFile = path.join(tempDir, "sample.mp4");
        fs.writeFileSync(inputFile, "test media");
        saveGlobalConfig({
          geminiApiKey: "test-key-1234",
          sttProvider: "openai-compatible",
          openaiCompatibleSttModel: "test-stt",
        });
        vi.mocked(checkFfmpeg).mockClear();
        await expect(run({ inputFile, noCache: true, lang: "en" })).rejects.toThrow(
          "VSUB_OPENAI_COMPATIBLE_STT_BASE_URL",
        );
        expect(checkFfmpeg).not.toHaveBeenCalled();
      },
    );

    it.each(["main", "chapters", "summarize"] as const)(
      "keeps missing LLM settings immediately after key checks in %s",
      async (route) => {
        const inputFile = path.join(tempDir, route === "main" ? "sample.mp4" : "sample.srt");
        fs.writeFileSync(inputFile, "1\n00:00:00,000 --> 00:00:01,000\nTest subtitle\n");
        saveGlobalConfig({
          sttProvider: "groq",
          llmProvider: "openai-compatible",
          openaiCompatibleLlmModel: "test-llm",
        });
        saveTranscriptionCache(inputFile, {
          provider: "groq",
          entries: [
            { id: 1, startTime: "00:00:00,000", endTime: "00:00:01,000", text: "Test subtitle" },
          ],
          createdAt: 0,
        });
        const ensure = vi.spyOn(configModule, "ensureApiKeys");
        const create = vi.spyOn(selectModule, "createTextModel");
        const start = spyOnSpinnerStart();
        const run =
          route === "main"
            ? processMediaPipeline({ mediaFile: inputFile, targetLang: "ja" })
            : route === "chapters"
              ? processChaptersPipeline({ inputFile, noCache: true })
              : processSummaryPipeline({ inputFile, noCache: true });
        await expect(run).rejects.toThrow("VSUB_OPENAI_COMPATIBLE_LLM_BASE_URL");
        expect(ensure).toHaveBeenCalledOnce();
        expect(create).toHaveBeenCalledOnce();
        expect(ensure.mock.invocationCallOrder[0]).toBeLessThan(
          create.mock.invocationCallOrder[0] ?? 0,
        );
        expect(start).not.toHaveBeenCalled();
      },
    );

    it("does not validate unused transcription settings on a cache hit", async () => {
      const mediaFile = path.join(tempDir, "cached.mp4");
      fs.writeFileSync(mediaFile, "test media");
      saveGlobalConfig({ sttProvider: "openai-compatible" });
      saveTranscriptionCache(mediaFile, {
        provider: "openai-compatible",
        entries: [{ id: 1, startTime: "00:00:00,000", endTime: "00:00:01,000", text: "Hello" }],
        createdAt: 0,
      });
      const ensure = vi.spyOn(configModule, "ensureApiKeys");
      await processMediaPipeline({ mediaFile, noTranslate: true });
      expect(extractAudio).not.toHaveBeenCalled();
      expect(ensure).not.toHaveBeenCalled();
    });

    it("includes the URL in the cache context and runs without a key", async () => {
      const mediaFile = path.join(tempDir, "sample.mp4");
      fs.writeFileSync(mediaFile, "test media");
      saveGlobalConfig({
        sttProvider: "openai-compatible",
        openaiCompatibleSttBaseUrl: "http://localhost:8000/v1",
        openaiCompatibleSttModel: "test-stt",
      });
      const save = vi.spyOn(cacheModule, "saveTranscriptionCache");
      await processMediaPipeline({ mediaFile, noTranslate: true, fresh: true });
      expect(save).toHaveBeenCalledWith(
        mediaFile,
        expect.objectContaining({
          baseUrl: "http://localhost:8000/v1",
          provider: "openai-compatible",
        }),
        undefined,
      );
    });
  });

  describe("parseBilingualOrder", () => {
    it("should return original-first by default or when empty", () => {
      expect(parseBilingualOrder()).toBe("original-first");
      expect(parseBilingualOrder("")).toBe("original-first");
      expect(parseBilingualOrder(undefined)).toBe("original-first");
    });

    it("should parse valid order values case-insensitively", () => {
      expect(parseBilingualOrder("original-first")).toBe("original-first");
      expect(parseBilingualOrder("ORIGINAL-FIRST")).toBe("original-first");
      expect(parseBilingualOrder("target-first")).toBe("target-first");
      expect(parseBilingualOrder("TARGET-FIRST")).toBe("target-first");
    });

    it("should throw for invalid order values", () => {
      expect(() => parseBilingualOrder("invalid")).toThrow(/Unsupported bilingual order/);
      expect(() => parseBilingualOrder("invalid", "ja")).toThrow(
        /サポートされていないバイリンガル順序/,
      );
    });
  });

  describe("verbose pipeline notices", () => {
    describe.each(["en", "ja"] as const)("%s", (lang) => {
      const m = getI18n(lang).pipeline;
      const noTranslateMessage =
        lang === "ja"
          ? "🌐 [3/4] [--no-translate] 翻訳をスキップ: EN"
          : "🌐 [3/4] [--no-translate] EN";

      it.each(["", "[1/3]"])(
        "keeps cached and skipped notices visible with prefix %j",
        async (logPrefix) => {
          const mediaFile = path.join(tempDir, "sample.mp4");
          const cacheDir = path.join(tempDir, "cache");
          fs.writeFileSync(mediaFile, "dummy");
          saveTranscriptionCache(
            mediaFile,
            {
              entries: [
                { id: 1, startTime: "00:00:00,000", endTime: "00:00:02,000", text: "Hello" },
              ],
              detectedLanguage: "en",
              createdAt: Date.now(),
            },
            cacheDir,
          );
          vi.spyOn(console, "log").mockImplementation(() => {});
          const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
          for (const noTranslate of [true, false]) {
            stderr.mockClear();
            await processMediaPipeline({
              mediaFile,
              cacheDir,
              targetLang: "en",
              noTranslate,
              verbose: true,
              overwrite: true,
              lang,
              logPrefix,
            });
            const lines = stderr.mock.calls.map(([line]) => stripVTControlCharacters(String(line)));
            const prefix = logPrefix ? `${logPrefix} ` : "";
            expect(lines.join("\n")).not.toContain(m.step2UseCached(" (EN)", 1));
            expect(lines.join("\n")).not.toContain(m.step4Saved("SRT"));
            expect(lines).toEqual([
              `${prefix}${m.step1SkipCache}`,
              `${prefix}${noTranslate ? noTranslateMessage : m.step3SkippedSameLang("EN", "EN")}`,
            ]);
          }
        },
      );

      describe.each([false, true])("verbose: %s", (verbose) => {
        it.each(["hint", "empty", "kept"] as const)("routes the %s notice once", async (notice) => {
          const mediaFile = path.join(tempDir, "sample.mp4");
          const audioFile = path.join(tempDir, "audio.m4a");
          fs.writeFileSync(mediaFile, "dummy");
          fs.writeFileSync(audioFile, "dummy audio");
          vi.mocked(extractAudio).mockResolvedValueOnce({
            audioPaths: [audioFile],
            cleanup: async () => {},
          });
          vi.mocked(transcribeAudioSegments).mockResolvedValueOnce({
            entries:
              notice === "empty"
                ? []
                : [{ id: 1, startTime: "00:00:00,000", endTime: "00:00:02,000", text: "Hello" }],
            detectedLanguage: "en",
          });
          const spinner = ui.createSpinner("", { isSilent: true });
          const kind = notice === "empty" ? "warn" : "info";
          const spinnerNotice = vi.spyOn(spinner, kind);
          vi.spyOn(ui, "createSpinner").mockReturnValue(spinner);
          vi.spyOn(console, "log").mockImplementation(() => {});
          const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
          await processMediaPipeline({
            mediaFile,
            targetLang: "en",
            noTranslate: true,
            noCache: true,
            verbose,
            keepAudio: notice === "kept",
            lang,
          });
          const expected =
            notice === "hint"
              ? m.sttGroqAutoHint
              : notice === "empty"
                ? m.step2NoEntries
                : m.keptAudio(audioFile);
          const lines = stderr.mock.calls.map(([line]) => stripVTControlCharacters(String(line)));
          if (verbose) {
            expect(lines.filter((line) => line === expected)).toEqual([expected]);
            expect(spinnerNotice).not.toHaveBeenCalled();
          } else {
            expect(spinnerNotice.mock.calls.filter(([line]) => line === expected)).toEqual([
              [expected],
            ]);
            expect(stderr).not.toHaveBeenCalled();
          }
        });
      });
    });
  });

  describe("extracted audio cleanup on failure", () => {
    let mediaFile: string;
    let audioFile: string;
    const cleanup = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

    beforeEach(() => {
      mediaFile = path.join(tempDir, "sample.mp4");
      audioFile = path.join(tempDir, "extracted.m4a");
      fs.writeFileSync(mediaFile, "dummy media");
      fs.writeFileSync(audioFile, "dummy audio");
      cleanup.mockClear();
      vi.mocked(extractAudio).mockResolvedValueOnce({ audioPaths: [audioFile], cleanup });
    });

    function runMain(keepAudio = false, verbose = false) {
      return processMediaPipeline({
        mediaFile,
        noTranslate: true,
        fresh: true,
        keepAudio,
        verbose,
        lang: "en",
      });
    }

    it("cleans up once and preserves the transcription error in the main pipeline", async () => {
      const error = new Error("Test transcription failed");
      vi.mocked(transcribeAudioSegments).mockRejectedValueOnce(error);

      await expect(runMain()).rejects.toBe(error);

      expect(cleanup).toHaveBeenCalledExactlyOnceWith();
    });

    it("cleans up once and preserves an error saving the transcription cache", async () => {
      const error = new Error("Test transcription cache save failed");
      const save = vi.spyOn(cacheModule, "saveTranscriptionCache").mockImplementationOnce(() => {
        throw error;
      });

      await expect(runMain()).rejects.toBe(error);

      expect(save).toHaveBeenCalledOnce();
      expect(cleanup).toHaveBeenCalledExactlyOnceWith();
    });

    it.each([false, true])(
      "keeps audio and reports its path once after transcription fails with verbose: %s",
      async (verbose) => {
        const error = new Error("Test transcription failed");
        vi.mocked(transcribeAudioSegments).mockRejectedValueOnce(error);
        const spinner = ui.createSpinner("", { isSilent: true });
        const info = vi.spyOn(spinner, "info");
        vi.spyOn(ui, "createSpinner").mockReturnValue(spinner);
        const stderr = vi.spyOn(console, "error").mockImplementation(() => {});

        await expect(runMain(true, verbose)).rejects.toBe(error);

        expect(cleanup).not.toHaveBeenCalled();
        const expected = getI18n("en").pipeline.keptAudio(audioFile);
        const notices = (verbose ? stderr : info).mock.calls.map(([line]) =>
          stripVTControlCharacters(String(line)),
        );
        expect(notices.filter((line) => line === expected)).toEqual([expected]);
        expect(verbose ? info : stderr).not.toHaveBeenCalled();
      },
    );

    it("cleans up once and preserves the transcription error when resolving text task entries", async () => {
      const error = new Error("Test transcription failed");
      vi.mocked(transcribeAudioSegments).mockRejectedValueOnce(error);

      await expect(
        resolveTranscriptEntries({ filePath: mediaFile, noCache: true, lang: "en" }),
      ).rejects.toBe(error);

      expect(cleanup).toHaveBeenCalledExactlyOnceWith();
    });
  });

  describe("resolveOutputFilePaths", () => {
    it("should resolve single language paths alongside media file", () => {
      const paths = resolveOutputFilePaths("/dir", "video", "ja", ["srt", "vtt"]);
      expect(paths).toEqual([
        { format: "srt", filePath: path.join("/dir", "video.ja.srt") },
        { format: "vtt", filePath: path.join("/dir", "video.ja.vtt") },
      ]);
    });

    it("should resolve paths with bilingual tag", () => {
      const paths = resolveOutputFilePaths("/dir", "video", "ja", ["srt"], undefined, true, true);
      expect(paths).toEqual([
        { format: "srt", filePath: path.join("/dir", "video.ja.bilingual.srt") },
      ]);
    });

    it("should resolve paths when outputDir is specified", () => {
      const outDir = path.join(tempDir, "custom_out");
      const paths = resolveOutputFilePaths(
        "/dir",
        "video",
        "ja",
        ["srt", "json"],
        undefined,
        true,
        false,
        outDir,
      );
      expect(paths).toEqual([
        { format: "srt", filePath: path.join(outDir, "video.ja.srt") },
        { format: "json", filePath: path.join(outDir, "video.ja.json") },
      ]);
    });

    it("should resolve paths when explicit output file option is specified", () => {
      const explicitOut = path.join(tempDir, "custom.srt");
      const paths = resolveOutputFilePaths(
        "/dir",
        "video",
        "ja",
        ["srt"],
        explicitOut,
        true,
        false,
      );
      expect(paths).toEqual([{ format: "srt", filePath: explicitOut }]);
    });
  });

  describe("processMediaPipeline error cases", () => {
    it("should throw error if media file does not exist", async () => {
      const nonExistent = path.join(tempDir, "non_existent.mp4");
      await expect(
        processMediaPipeline({
          mediaFile: nonExistent,
        }),
      ).rejects.toThrow(/Media file not found/);
      await expect(
        processMediaPipeline({
          mediaFile: nonExistent,
          lang: "ja",
        }),
      ).rejects.toThrow(/メディアファイルが見つかりません/);
    });

    it("should throw error if --burn is specified on audio file", async () => {
      const audioFile = path.join(tempDir, "test.mp3");
      fs.writeFileSync(audioFile, "dummy");

      await expect(
        processMediaPipeline({
          mediaFile: audioFile,
          burn: true,
        }),
      ).rejects.toThrow(/Cannot burn subtitles into audio files/);
      await expect(
        processMediaPipeline({
          mediaFile: audioFile,
          burn: true,
          lang: "ja",
        }),
      ).rejects.toThrow(/音声ファイルには字幕を焼き込めません/);
    });

    it("should throw error if --embed is specified on audio file", async () => {
      const audioFile = path.join(tempDir, "test_audio.mp3");
      fs.writeFileSync(audioFile, "dummy");

      await expect(
        processMediaPipeline({
          mediaFile: audioFile,
          embed: true,
        }),
      ).rejects.toThrow(/Cannot embed subtitles into an audio file/);
      await expect(
        processMediaPipeline({
          mediaFile: audioFile,
          embed: true,
          lang: "ja",
        }),
      ).rejects.toThrow(/音声ファイルに字幕トラックを埋め込むことはできません/);
    });

    it("should accept maxLength, maxDuration, and noReflow options without type or schema error", async () => {
      const nonExistent = path.join(tempDir, "non_existent.mp4");
      await expect(
        processMediaPipeline({
          mediaFile: nonExistent,
          maxLength: 50,
          maxDuration: 6,
          noReflow: true,
        }),
      ).rejects.toThrow(/Media file not found/);
    });
  });

  describe("processMediaPipeline stdout mode (--stdout / -o -)", () => {
    it("should throw error if multiple formats are specified with --stdout", async () => {
      const mediaFile = path.join(tempDir, "sample.mp4");
      fs.writeFileSync(mediaFile, "dummy");

      await expect(
        processMediaPipeline({
          mediaFile,
          stdout: true,
          format: "srt,vtt",
        }),
      ).rejects.toThrow(/Cannot specify multiple formats with --stdout/);

      await expect(
        processMediaPipeline({
          mediaFile,
          stdout: true,
          format: "srt,vtt",
          lang: "ja",
        }),
      ).rejects.toThrow(/--stdout 指定時は複数の出力フォーマットを指定できません/);
    });

    it("should throw error if multiple target languages are specified with --stdout", async () => {
      const mediaFile = path.join(tempDir, "sample.mp4");
      fs.writeFileSync(mediaFile, "dummy");

      await expect(
        processMediaPipeline({
          mediaFile,
          stdout: true,
          targetLang: "ja,en",
        }),
      ).rejects.toThrow(/Cannot specify multiple target languages with --stdout/);

      await expect(
        processMediaPipeline({
          mediaFile,
          stdout: true,
          targetLang: "ja,en",
          lang: "ja",
        }),
      ).rejects.toThrow(/--stdout 指定時は複数の言語を指定できません/);
    });

    it("should throw error if --burn is specified with --stdout", async () => {
      const mediaFile = path.join(tempDir, "sample.mp4");
      fs.writeFileSync(mediaFile, "dummy");

      await expect(
        processMediaPipeline({
          mediaFile,
          stdout: true,
          burn: true,
        }),
      ).rejects.toThrow(/Cannot use --burn with --stdout/);

      await expect(
        processMediaPipeline({
          mediaFile,
          output: "-",
          burn: true,
          lang: "ja",
        }),
      ).rejects.toThrow(/--stdout と --burn \(字幕焼き込み\) を同時に指定することはできません/);
    });

    it("should throw error if --embed is specified with --stdout", async () => {
      const mediaFile = path.join(tempDir, "sample_embed.mp4");
      fs.writeFileSync(mediaFile, "dummy");

      await expect(
        processMediaPipeline({
          mediaFile,
          stdout: true,
          embed: true,
        }),
      ).rejects.toThrow(/Cannot use --embed with --stdout/);

      await expect(
        processMediaPipeline({
          mediaFile,
          output: "-",
          embed: true,
          lang: "ja",
        }),
      ).rejects.toThrow(
        /--stdout と --embed \(ソフトサブ埋め込み\) を同時に指定することはできません/,
      );
    });

    it("should generate stdoutContent and not write any files to disk", async () => {
      const mediaFile = path.join(tempDir, "sample.mp4");
      fs.writeFileSync(mediaFile, "dummy content");
      const cacheDir = path.join(tempDir, "cache");

      const mockEntries = [
        {
          id: 1,
          startTime: "00:00:01,000",
          endTime: "00:00:03,000",
          text: "Hello world",
        },
      ];

      saveTranscriptionCache(
        mediaFile,
        {
          detectedLanguage: "en",
          entries: mockEntries,
          createdAt: Date.now(),
        },
        cacheDir,
      );

      saveTranslationCache(
        mediaFile,
        "ja",
        createCachedTranslation(
          "ja",
          {
            sourceEntries: mockEntries,
            model: DEFAULT_GEMINI_MODEL,
            contextWindowSize: DEFAULT_CONTEXT_WINDOW_SIZE,
          },
          [
            {
              id: 1,
              startTime: "00:00:01,000",
              endTime: "00:00:03,000",
              text: "こんにちは世界",
            },
          ],
        ),
        cacheDir,
      );

      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      const result = await processMediaPipeline({
        mediaFile,
        targetLang: "ja",
        format: "srt",
        stdout: true,
        cacheDir,
      });

      expect(result.outputFiles).toEqual([]);
      expect(result.stdoutContent).toContain("こんにちは世界");
      expect(result.stdoutContent).toContain("00:00:01,000 --> 00:00:03,000");

      // Verify no subtitle files were created in tempDir
      const filesInTemp = fs.readdirSync(tempDir);
      const srtFiles = filesInTemp.filter((f) => f.endsWith(".srt"));
      expect(srtFiles).toHaveLength(0);

      // Verify start banner and summary box were NOT logged to console.log
      expect(logSpy).not.toHaveBeenCalled();
    });

    it("should support JSON and TXT format in stdoutContent", async () => {
      const mediaFile = path.join(tempDir, "sample2.mp4");
      fs.writeFileSync(mediaFile, "dummy content 2");
      const cacheDir = path.join(tempDir, "cache");

      saveTranscriptionCache(
        mediaFile,
        {
          detectedLanguage: "ja",
          entries: [
            {
              id: 1,
              startTime: "00:00:00,000",
              endTime: "00:00:02,000",
              text: "テスト字幕",
            },
          ],
          createdAt: Date.now(),
        },
        cacheDir,
      );

      // noTranslate mode with json format
      const jsonResult = await processMediaPipeline({
        mediaFile,
        format: "json",
        output: "-",
        noTranslate: true,
        cacheDir,
      });

      expect(jsonResult.outputFiles).toEqual([]);
      expect(jsonResult.stdoutContent).toBeDefined();
      const parsed = JSON.parse(jsonResult.stdoutContent ?? "[]");
      expect(parsed).toEqual([
        {
          id: 1,
          startTime: "00:00:00,000",
          endTime: "00:00:02,000",
          text: "テスト字幕",
        },
      ]);

      // noTranslate mode with txt format
      const txtResult = await processMediaPipeline({
        mediaFile,
        format: "txt",
        stdout: true,
        noTranslate: true,
        cacheDir,
      });

      expect(txtResult.outputFiles).toEqual([]);
      expect(txtResult.stdoutContent?.trim()).toBe("テスト字幕");
    });
  });

  describe("resolveTranscriptEntries", () => {
    it("should parse .srt file directly without cache or API keys", async () => {
      const srtPath = path.join(tempDir, "sample.srt");
      fs.writeFileSync(
        srtPath,
        "1\n00:00:00,000 --> 00:00:02,000\nHello\n\n2\n00:00:02,500 --> 00:00:05,000\nWorld\n",
      );

      const result = await resolveTranscriptEntries({ filePath: srtPath });
      expect(result.isSubtitleFile).toBe(true);
      expect(result.fromCache).toBe(false);
      expect(result.entries).toHaveLength(2);
      expect(result.entries[0]?.text).toBe("Hello");
    });

    it("should load from transcription cache for media file", async () => {
      const mediaPath = path.join(tempDir, "test.mp4");
      fs.writeFileSync(mediaPath, "dummy video data");
      const cacheDir = path.join(tempDir, "cache");

      saveTranscriptionCache(
        mediaPath,
        {
          detectedLanguage: "ja",
          entries: [
            { id: 1, startTime: "00:00:00,000", endTime: "00:00:02,000", text: "キャッシュ字幕" },
          ],
          createdAt: Date.now(),
        },
        cacheDir,
      );

      const result = await resolveTranscriptEntries({ filePath: mediaPath, cacheDir });
      expect(result.isSubtitleFile).toBe(false);
      expect(result.fromCache).toBe(true);
      expect(result.detectedLanguage).toBe("ja");
      expect(result.entries[0]?.text).toBe("キャッシュ字幕");
    });

    it("should throw if file does not exist", async () => {
      await expect(
        resolveTranscriptEntries({ filePath: path.join(tempDir, "not_found.srt") }),
      ).rejects.toThrow(/File not found/);
    });
  });

  describe("chapters and summary shared steps", () => {
    let inputFile: string;
    let cacheDir: string;

    beforeEach(() => {
      inputFile = path.join(tempDir, "sample.mp4");
      cacheDir = path.join(tempDir, "cache");
      fs.writeFileSync(inputFile, "test media");
      vi.clearAllMocks();
      vi.spyOn(console, "log").mockImplementation(() => {});
      vi.spyOn(console, "error").mockImplementation(() => {});
      saveGlobalConfig({ geminiApiKey: "test-key", groqApiKey: "test-key" });
    });

    type TaskOptions = Omit<Parameters<typeof processChaptersPipeline>[0], "format"> & {
      format?: string | undefined;
    };
    describe.each([
      {
        task: "chapters",
        suffix: "chapters",
        formats: ["txt", "json", "vtt"],
        run: (options: TaskOptions) =>
          processChaptersPipeline({
            ...options,
            format: options.format as ChaptersFormat | undefined,
          }),
        getGenerator: () => generateChapters,
      },
      {
        task: "summarize",
        suffix: "summary",
        formats: ["md", "txt", "json"],
        run: (options: TaskOptions) =>
          processSummaryPipeline({
            ...options,
            format: options.format as SummaryFormat | undefined,
          }),
        getGenerator: () => generateSummary,
      },
    ] as const)("$task", ({ task, suffix, formats, run, getGenerator }) => {
      describe("glossary options", () => {
        const glossary = "Term A=用語A";

        beforeEach(() => {
          process.env["VSUB_OPENROUTER_API_KEY"] = "test-openrouter-api-key";
          vi.spyOn(process.stdout, "write").mockReturnValue(true);
        });

        function runTask(options: Partial<TaskOptions> = {}) {
          return run({ inputFile, cacheDir, stdout: true, sttProvider: "groq", ...options });
        }

        function savedGenerated() {
          const cache = loadMediaCache(inputFile, cacheDir);
          return task === "chapters" ? cache?.chapters?.["ja"] : cache?.summaries?.["ja"];
        }

        it("localizes invalid glossary errors before running the text task", async () => {
          const file = path.join(tempDir, "broken.json");
          fs.writeFileSync(file, "");
          await expect(runTask({ glossary: file, lang: "ja" })).rejects.toThrow(
            "用語集ファイル（broken.json）を読み込めませんでした: Unexpected end of JSON input",
          );
          expect(transcribeAudioSegments).not.toHaveBeenCalled();
          expect(getGenerator()).not.toHaveBeenCalled();
        });

        it.each(["ja,en", "en,ja", "fr"])(
          "reads the glossary once for the first output language %s",
          async (targetLang) => {
            const glossaryPath = path.join(tempDir, "glossary.json");
            const translations = { ja: { "Term A": "用語A" }, en: { "Term A": "Term B" } };
            fs.writeFileSync(glossaryPath, JSON.stringify(translations));
            const parse = vi.spyOn(glossaryModule, "parseGlossary");
            await runTask({ glossary: glossaryPath, targetLang, sttProvider: "openrouter" });
            const first = targetLang.split(",")[0];
            expect(parse).toHaveBeenCalledExactlyOnceWith(glossaryPath, first, "en");
            expect(getGenerator()).toHaveBeenCalledWith(
              expect.anything(),
              expect.anything(),
              expect.objectContaining({
                glossary: first === "ja" ? translations.ja : first === "en" ? translations.en : {},
              }),
            );
          },
        );

        it.each([
          { source: "none", expected: undefined },
          { source: "config", expected: { "Term A": "設定語A" } },
          { source: "env", expected: { "Term A": "環境語A" } },
          { source: "blank option", expected: { "Term A": "環境語A" } },
          { source: "option", expected: { "Term A": "用語A" } },
        ])("resolves glossary precedence from $source", async ({ source, expected }) => {
          if (source !== "none") saveGlobalConfig({ glossary: "Term A=設定語A" });
          if (source !== "none" && source !== "config")
            process.env["VSUB_GLOSSARY"] = "Term A=環境語A";
          await runTask({
            glossary:
              source === "option"
                ? `  ${glossary}  `
                : source === "blank option"
                  ? "  "
                  : undefined,
          });
          expect(getGenerator()).toHaveBeenCalledWith(
            expect.anything(),
            expect.anything(),
            expect.objectContaining({ glossary: expected }),
          );
        });

        it("saves glossary hashes, reuses matching results and regenerates changed results", async () => {
          const options = { glossary, whisperPrompt: "Fixed recognition hint" };
          await runTask(options);
          expect(savedGenerated()?.glossaryHash).toBe(computeGlossaryHash({ "Term A": "用語A" }));
          expect((await runTask(options)).fromCache).toBe(true);
          expect(getGenerator()).toHaveBeenCalledTimes(1);
          expect((await runTask({ ...options, glossary: "Term A=用語B" })).fromCache).toBe(false);
          expect(savedGenerated()?.glossaryHash).toBe(computeGlossaryHash({ "Term A": "用語B" }));
          expect(getGenerator()).toHaveBeenCalledTimes(2);
          expect(transcribeAudioSegments).toHaveBeenCalledTimes(1);
        });

        it("shares the main pipeline's glossary transcription cache on both lookups", async () => {
          await processMediaPipeline({
            mediaFile: inputFile,
            cacheDir,
            stdout: true,
            noTranslate: true,
            sttProvider: "groq",
            glossary,
          });
          expect((await runTask({ glossary })).transcriptionFromCache).toBe(true);
          expect((await runTask({ glossary })).fromCache).toBe(true);
          expect(transcribeAudioSegments).toHaveBeenCalledTimes(1);
          expect(getGenerator()).toHaveBeenCalledTimes(1);
        });

        it.each([undefined, "Explicit recognition hint"])(
          "passes and saves glossary recognition hints (override: %s)",
          async (whisperPrompt) => {
            const prompt = whisperPrompt ?? extractWhisperPromptHints(glossary);
            await runTask({ glossary, whisperPrompt });
            expect(transcribeAudioSegments).toHaveBeenCalledWith(
              expect.anything(),
              expect.anything(),
              false,
              undefined,
              expect.objectContaining({ prompt }),
            );
            expect(loadMediaCache(inputFile, cacheDir)?.transcription?.prompt).toBe(prompt);
          },
        );

        it.each([false, true])(
          "rejects invalid glossary JSON before transcription or generation (cached: %s)",
          async (cached) => {
            if (cached) await runTask();
            vi.mocked(getGenerator()).mockClear();
            vi.mocked(transcribeAudioSegments).mockClear();
            const glossaryPath = path.join(tempDir, "invalid-glossary.json");
            fs.writeFileSync(glossaryPath, "{invalid json");
            await expect(runTask({ glossary: glossaryPath })).rejects.toThrow(
              "Failed to parse glossary file (invalid-glossary.json)",
            );
            expect(getGenerator()).not.toHaveBeenCalled();
            expect(transcribeAudioSegments).not.toHaveBeenCalled();
          },
        );
      });

      describe("single target language", () => {
        let spinner: ReturnType<typeof ui.createSpinner>;

        function targetWarnings() {
          return [...vi.mocked(spinner.warn).mock.calls, ...vi.mocked(console.error).mock.calls]
            .map(([message]) => String(message))
            .filter((message) => /one language only|1 つの言語でだけ/.test(message));
        }

        function englishWarning(used: string, requested: string) {
          const subject = task === "chapters" ? "Chapters" : "Summaries";
          return `${subject} are generated in one language only. Using "${used}", the first of "${requested}".`;
        }

        beforeEach(() => {
          spinner = ui.createSpinner("", { isSilent: true });
          vi.spyOn(spinner, "warn");
          vi.spyOn(spinner, "start");
          vi.spyOn(ui, "createSpinner").mockReturnValue(spinner);
        });

        it.each([
          { targetLang: undefined, expected: "ja" },
          { targetLang: "   ", expected: "ja" },
          { targetLang: "en", expected: "en" },
          { targetLang: "ja, JA", expected: "ja" },
          { targetLang: " EN ", expected: "en" },
        ])("uses $expected without warning for $targetLang", async ({ targetLang, expected }) => {
          saveGlobalConfig({ targetLang: "ja,en" });
          await run({ inputFile, cacheDir, targetLang });
          expect(getGenerator()).toHaveBeenCalledWith(
            expect.anything(),
            expect.anything(),
            expect.objectContaining({ targetLang: expected }),
          );
          expect(targetWarnings()).toEqual([]);
        });

        it.each([
          { targetLang: "ja,en", expected: "ja", requested: "ja,en" },
          { targetLang: " EN , ja, en", expected: "en", requested: "en,ja" },
        ])("warns once using normalized languages for $targetLang", async (options) => {
          await run({ inputFile, cacheDir, targetLang: options.targetLang });
          expect(getGenerator()).toHaveBeenCalledWith(
            expect.anything(),
            expect.anything(),
            expect.objectContaining({ targetLang: options.expected }),
          );
          const message = englishWarning(options.expected, options.requested);
          expect(targetWarnings()).toEqual([message]);
          expect(spinner.warn).toHaveBeenCalledWith(message);
          expect(console.error).not.toHaveBeenCalledWith(`⚠ ${message}`);
          const warningIndex = vi.mocked(spinner.warn).mock.calls.findIndex(([m]) => m === message);
          const warningOrder = vi.mocked(spinner.warn).mock.invocationCallOrder[warningIndex] ?? 0;
          expect(vi.mocked(console.log).mock.invocationCallOrder[0]).toBeLessThan(warningOrder);
          expect(vi.mocked(spinner.start).mock.invocationCallOrder[0]).toBeGreaterThan(
            warningOrder,
          );
        });

        it("localizes the explicit multiple-language warning in Japanese", async () => {
          await run({ inputFile, cacheDir, targetLang: "ja,en", lang: "ja" });
          const subject = task === "chapters" ? "章立て" : "要約";
          expect(targetWarnings()).toEqual([
            `${subject}は 1 つの言語でだけ作ります。"ja,en" の先頭の "ja" を使います。`,
          ]);
        });

        it.each(["cli", "config"])(
          "rejects invalid languages from %s before side effects",
          async (source) => {
            if (source === "config") saveGlobalConfig({ targetLang: "japanese" });
            const loader = vi.spyOn(cacheModule, "loadMediaCache");
            const safety = vi.spyOn(safetyModule, "ensureWritableTargets");
            let expectedError: unknown;
            try {
              parseTargetLanguages("japanese", "en");
            } catch (error) {
              expectedError = error;
            }
            await expect(
              run({ inputFile, cacheDir, targetLang: source === "cli" ? "japanese" : undefined }),
            ).rejects.toThrow(expectedError as Error);
            expect(getGenerator()).not.toHaveBeenCalled();
            expect(loader).not.toHaveBeenCalled();
            expect(safety).not.toHaveBeenCalled();
            expect(console.log).not.toHaveBeenCalled();
            expect(fs.existsSync(path.join(tempDir, `sample.${suffix}.${formats[0]}`))).toBe(false);
          },
        );

        it("saves and reuses the first configured language cache", async () => {
          saveGlobalConfig({ targetLang: "ja,en" });
          await run({ inputFile, cacheDir });
          const mediaCache = loadMediaCache(inputFile, cacheDir);
          const generated = task === "chapters" ? mediaCache?.chapters : mediaCache?.summaries;
          expect(Object.keys(generated ?? {})).toEqual(["ja"]);
          expect(generated?.["ja"]?.targetLang).toBe("ja");
          vi.mocked(getGenerator()).mockClear();
          const result = await run({ inputFile, cacheDir, targetLang: "ja", overwrite: true });
          expect(result.fromCache).toBe(true);
          expect(getGenerator()).not.toHaveBeenCalled();
          expect(targetWarnings()).toEqual([]);
        });

        it.each([{ stdout: true }, { output: "-" }, { verbose: true }])(
          "sends the warning only to stderr for %j",
          async (options) => {
            const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
            const result = await run({ inputFile, cacheDir, targetLang: "ja,en", ...options });
            const message = englishWarning("ja", "ja,en");
            expect(targetWarnings()).toEqual([`⚠ ${message}`]);
            expect(console.error).toHaveBeenCalledWith(`⚠ ${message}`);
            expect(spinner.warn).not.toHaveBeenCalledWith(message);
            if ("verbose" in options) {
              expect(stdout).not.toHaveBeenCalled();
            } else {
              expect(stdout).toHaveBeenCalledExactlyOnceWith(result.formattedOutput);
              expect(console.log).not.toHaveBeenCalled();
            }
          },
        );
      });

      it.each([undefined, "default", "relative"])("pins output path mode %s", async (mode) => {
        for (const format of mode === "default" ? formats : [undefined]) {
          const output =
            mode === "relative"
              ? path.relative(process.cwd(), path.join(tempDir, "custom.out"))
              : undefined;
          const result = await run({ inputFile, cacheDir, format, output, overwrite: true });
          expect(result.outputFile).toBe(
            output
              ? path.resolve(output)
              : path.join(tempDir, `sample.${suffix}.${format ?? formats[0]}`),
          );
        }
      });

      it.each(["noCache", "fresh", "srt"] as const)("pins cache mode %s", async (mode) => {
        await run({ inputFile, cacheDir, overwrite: true });
        vi.mocked(getGenerator()).mockClear();
        const loader = vi.spyOn(cacheModule, "loadMediaCache");
        const saver = vi.spyOn(
          cacheModule,
          task === "chapters" ? "saveChaptersCache" : "saveSummaryCache",
        );
        if (mode === "srt") {
          inputFile = path.join(tempDir, "sample.srt");
          fs.writeFileSync(inputFile, "1\n00:00:00,000 --> 00:02:00,000\nTest transcript\n");
        }
        const result = await run({
          inputFile,
          cacheDir,
          overwrite: true,
          noCache: mode === "noCache",
          fresh: mode === "fresh",
        });
        expect(result.fromCache).toBe(false);
        expect(getGenerator()).toHaveBeenCalledTimes(1);
        if (mode === "fresh") {
          expect(saver).toHaveBeenCalledTimes(1);
        } else {
          expect(loader).not.toHaveBeenCalled();
          expect(saver).not.toHaveBeenCalled();
        }
      });

      it("checks keys before resolving the transcript when generated cache is absent", async () => {
        const keys = vi.spyOn(configModule, "ensureApiKeys");
        const read = vi.spyOn(fs, "readFileSync");
        inputFile = path.join(tempDir, "sample.srt");
        fs.writeFileSync(inputFile, "1\n00:00:00,000 --> 00:02:00,000\nTest transcript\n");
        await run({ inputFile, cacheDir });
        const transcriptRead = read.mock.calls.findIndex(([file]) => file === inputFile);
        expect(transcriptRead).toBeGreaterThanOrEqual(0);
        expect(keys.mock.invocationCallOrder[0]).toBeLessThan(
          read.mock.invocationCallOrder[transcriptRead] ?? 0,
        );
      });

      it("rejects empty transcripts before generation or saving", async () => {
        inputFile = path.join(tempDir, "empty.srt");
        fs.writeFileSync(inputFile, "");
        const saver = vi.spyOn(
          cacheModule,
          task === "chapters" ? "saveChaptersCache" : "saveSummaryCache",
        );
        await expect(run({ inputFile, cacheDir })).rejects.toThrow(getI18n("en")[task].noEntries);
        expect(getGenerator()).not.toHaveBeenCalled();
        expect(saver).not.toHaveBeenCalled();
      });

      it("preserves the saving display on generated and cached paths", async () => {
        const spinner = {
          start: vi.fn().mockReturnThis(),
          succeed: vi.fn().mockReturnThis(),
          fail: vi.fn().mockReturnThis(),
          warn: vi.fn().mockReturnThis(),
        };
        vi.spyOn(ui, "createSpinner").mockReturnValue(
          spinner as unknown as ReturnType<typeof ui.createSpinner>,
        );
        await run({ inputFile, cacheDir, overwrite: true });
        expect(spinner.start).toHaveBeenCalledWith(getI18n("en")[task].step3Saving);
        spinner.start.mockClear();
        await run({ inputFile, cacheDir, overwrite: true });
        expect(spinner.start).toHaveBeenCalledWith(getI18n("en")[task].step3Saving);
        for (const options of [{ stdout: true }, { output: "-" }]) {
          spinner.start.mockClear();
          await run({ inputFile, cacheDir, ...options });
          expect(spinner.start).not.toHaveBeenCalledWith(getI18n("en")[task].step3Saving);
        }
      });
    });

    it.each(["12.7", "0", "abc", "-1"])("pins main reflow limits %s", async (value) => {
      saveGlobalConfig({ geminiApiKey: "test-key", groqApiKey: "test-key", maxLength: 42 });
      const reflow = vi.spyOn(srtModule, "reflowSrtEntries");
      await processMediaPipeline({
        mediaFile: inputFile,
        cacheDir,
        maxLength: value,
        maxDuration: value,
        noCache: true,
      });
      expect(reflow).toHaveBeenCalledWith(expect.anything(), {
        maxLength: value === "12.7" ? 12 : 42,
        maxDuration: value === "12.7" ? 12 : undefined,
      });
    });
  });

  describe("processChaptersPipeline", () => {
    describe("chapter normalization", () => {
      let mediaPath: string;
      let cacheDir: string;
      let sourceEntries: SrtEntry[];
      let spinner: ReturnType<typeof ui.createSpinner>;
      let stdoutSpy: MockInstance<typeof process.stdout.write>;

      function chapters(seconds: number[]): ChapterItem[] {
        return seconds.map((seconds, index) => ({
          timestamp: secondsToTimestamp(seconds),
          seconds,
          title: `Chapter ${String.fromCharCode(65 + index)}`,
        }));
      }

      function saveSource(endTime = "00:01:59,840") {
        sourceEntries = [{ id: 1, startTime: "00:00:00,000", endTime, text: "Sample transcript" }];
        saveTranscriptionCache(
          mediaPath,
          { entries: sourceEntries, detectedLanguage: "en", createdAt: Date.now() },
          cacheDir,
        );
      }

      function prepareChapters(raw: ChapterItem[], cached: boolean) {
        if (cached) {
          saveChaptersCache(
            mediaPath,
            "en",
            createCachedChapters("en", { sourceEntries, model: DEFAULT_GEMINI_MODEL }, raw),
            cacheDir,
          );
        } else {
          vi.mocked(generateChapters).mockResolvedValueOnce(raw);
        }
      }

      function run(options: Partial<Parameters<typeof processChaptersPipeline>[0]> = {}) {
        return processChaptersPipeline({
          inputFile: mediaPath,
          cacheDir,
          targetLang: "en",
          ...options,
        });
      }

      beforeEach(() => {
        mediaPath = path.join(tempDir, "chapters.mp4");
        cacheDir = path.join(tempDir, "cache");
        fs.writeFileSync(mediaPath, "dummy media");
        saveSource();
        vi.mocked(generateChapters).mockClear();
        spinner = ui.createSpinner("", { isSilent: true });
        vi.spyOn(spinner, "start");
        vi.spyOn(spinner, "succeed");
        vi.spyOn(spinner, "warn");
        vi.spyOn(ui, "createSpinner").mockReturnValue(spinner);
        stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
        vi.spyOn(console, "log").mockImplementation(() => {});
        vi.spyOn(console, "error").mockImplementation(() => {});
      });

      it.each([false, true])(
        "normalizes txt output and preserves raw cache (cached: %s)",
        async (cached) => {
          const raw = chapters([0, 31, 62, 88, 117]);
          prepareChapters(raw, cached);
          const result = await run();
          const expected = raw.slice(0, 4);
          expect(result.chapters).toEqual(expected);
          expect(result.formattedOutput).toBe(
            "00:00 Chapter A\n00:31 Chapter B\n01:02 Chapter C\n01:28 Chapter D\n",
          );
          expect(fs.readFileSync(result.outputFile ?? "", "utf8")).toBe(result.formattedOutput);
          expect(loadMediaCache(mediaPath, cacheDir)?.chapters?.["en"]?.chapters).toEqual(raw);
          expect(generateChapters).toHaveBeenCalledTimes(cached ? 0 : 1);
          expect(result.fromCache).toBe(cached);
          expect(spinner.succeed).toHaveBeenCalledWith(
            cached ? "Loaded 4 chapters [⚡ Cached]" : "Generated 4 chapters",
          );
          expect(spinner.warn).not.toHaveBeenCalled();
          expect(console.error).not.toHaveBeenCalled();
        },
      );

      it.each([false, true])("ends VTT at the final subtitle end (cached: %s)", async (cached) => {
        prepareChapters(chapters([0, 31, 62, 88, 117]), cached);
        const result = await run({ format: "vtt", stdout: true });
        expect(result.formattedOutput).toContain("00:01:28.000 --> 00:01:59.840\nChapter D");
        expect(result.formattedOutput).not.toContain("Chapter E");
        expect(stdoutSpy).toHaveBeenCalledExactlyOnceWith(result.formattedOutput);
      });

      it.each([false, true])(
        "warns once after the normalized count and before saving (cached: %s)",
        async (cached) => {
          saveSource("00:00:58,000");
          prepareChapters(chapters([0, 20, 52]), cached);
          const result = await run();
          expect(result.chapters).toEqual(chapters([0, 20]));
          expect(fs.readFileSync(result.outputFile ?? "", "utf8")).toBe(
            "00:00 Chapter A\n00:20 Chapter B\n",
          );
          expect(spinner.succeed).toHaveBeenCalledWith(
            cached ? "Loaded 2 chapters [⚡ Cached]" : "Generated 2 chapters",
          );
          expect(spinner.warn).toHaveBeenCalledExactlyOnceWith(
            getI18n("en").chapters.tooFewChapters(2),
          );
          const succeed = vi.mocked(spinner.succeed);
          const countIndex = succeed.mock.calls.findIndex(([message]) =>
            String(message).includes("2 chapters"),
          );
          const warnOrder = vi.mocked(spinner.warn).mock.invocationCallOrder[0] ?? 0;
          expect(succeed.mock.invocationCallOrder[countIndex]).toBeLessThan(warnOrder);
          expect(succeed.mock.invocationCallOrder.at(-1)).toBeGreaterThan(warnOrder);
          expect(console.error).not.toHaveBeenCalled();
        },
      );

      it.each<{ stdout?: boolean; output?: string; verbose?: boolean; lang: "en" | "ja" }>([
        { stdout: true, lang: "en" },
        { output: "-", lang: "ja" },
        { verbose: true, lang: "en" },
      ])("sends a single warning to stderr with $stdout/$output/$verbose", async (options) => {
        prepareChapters(chapters([0, 20]), false);
        const result = await run(options);
        expect(console.error).toHaveBeenCalledExactlyOnceWith(
          `⚠ ${getI18n(options.lang).chapters.tooFewChapters(2)}`,
        );
        expect(spinner.warn).not.toHaveBeenCalled();
        if (options.verbose) {
          expect(fs.readFileSync(result.outputFile ?? "", "utf8")).toBe(result.formattedOutput);
          expect(stdoutSpy).not.toHaveBeenCalled();
        } else {
          expect(stdoutSpy).toHaveBeenCalledExactlyOnceWith("00:00 Chapter A\n00:20 Chapter B\n");
          expect(console.log).not.toHaveBeenCalled();
        }
      });

      it("warns on stderr when normalization of cached chapters leaves fewer than three", async () => {
        saveSource("00:00:58,000");
        prepareChapters(chapters([0, 20, 52]), true);
        const result = await run({ stdout: true });
        expect(console.error).toHaveBeenCalledExactlyOnceWith(
          `⚠ ${getI18n("en").chapters.tooFewChapters(2)}`,
        );
        expect(stdoutSpy).toHaveBeenCalledExactlyOnceWith("00:00 Chapter A\n00:20 Chapter B\n");
        expect(result.chapters).toEqual(chapters([0, 20]));
        expect(spinner.warn).not.toHaveBeenCalled();
        expect(generateChapters).not.toHaveBeenCalled();
      });

      it.each([false, true])(
        "does not warn for exactly three chapters (cached: %s)",
        async (cached) => {
          prepareChapters(chapters([0, 31, 62]), cached);
          await run({ stdout: true });
          expect(spinner.warn).not.toHaveBeenCalled();
          expect(console.error).not.toHaveBeenCalled();
        },
      );

      it.each(["invalid", "00:00:00,000"])(
        "keeps the final chapter and VTT fallback for unknown end %s",
        async (endTime) => {
          saveSource(endTime);
          prepareChapters(chapters([0, 31, 62, 117]), true);
          const result = await run({ format: "vtt", stdout: true });
          expect(result.chapters).toHaveLength(4);
          expect(result.formattedOutput).toContain("00:01:57.000 --> 00:02:57.000\nChapter D");
        },
      );

      it("uses the last subtitle array element rather than the largest end", async () => {
        sourceEntries.push({
          id: 2,
          startTime: "00:00:20,000",
          endTime: "00:00:58,000",
          text: "Last entry",
        });
        saveTranscriptionCache(
          mediaPath,
          { entries: sourceEntries, detectedLanguage: "en", createdAt: Date.now() },
          cacheDir,
        );
        prepareChapters(chapters([0, 20, 52]), true);
        const result = await run({ stdout: true });
        expect(result.chapters).toEqual(chapters([0, 20]));
      });
    });

    it("should generate chapters from .srt and write to output file", async () => {
      const srtPath = path.join(tempDir, "demo.srt");
      fs.writeFileSync(
        srtPath,
        "1\n00:00:00,000 --> 00:00:05,000\nIntro\n\n2\n00:01:23,000 --> 00:01:40,000\nTopic\n",
      );

      const result = await processChaptersPipeline({
        inputFile: srtPath,
        format: "txt",
      });

      expect(result.chapters).toHaveLength(2);
      const outPath = result.outputFile ?? "";
      expect(outPath).toBe(path.join(tempDir, "demo.chapters.txt"));
      expect(fs.existsSync(outPath)).toBe(true);
      const content = fs.readFileSync(outPath, "utf-8");
      expect(content).toContain("00:00 Introduction");
      expect(content).toContain("01:23 Getting Started");
    });

    it("should output to stdout when stdout: true", async () => {
      const srtPath = path.join(tempDir, "stdout_demo.srt");
      fs.writeFileSync(srtPath, "1\n00:00:00,000 --> 00:01:40,000\nIntro\n");

      const stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
      const result = await processChaptersPipeline({
        inputFile: srtPath,
        stdout: true,
        format: "json",
      });

      expect(stdoutSpy).toHaveBeenCalled();
      expect(result.outputFile).toBeUndefined();
      const parsed = JSON.parse(result.formattedOutput);
      expect(parsed).toHaveLength(2);
      stdoutSpy.mockRestore();
    });

    it("should use cached chapters if available", async () => {
      const mediaPath = path.join(tempDir, "cached_video.mp4");
      fs.writeFileSync(mediaPath, "video bytes");
      const cacheDir = path.join(tempDir, "cache");

      const sourceEntries: SrtEntry[] = [
        { id: 1, startTime: "00:00:00,000", endTime: "00:00:02,000", text: "Cached source" },
      ];
      saveTranscriptionCache(
        mediaPath,
        {
          detectedLanguage: "en",
          entries: sourceEntries,
          createdAt: Date.now(),
        },
        cacheDir,
      );

      saveChaptersCache(
        mediaPath,
        "ja",
        createCachedChapters("ja", { sourceEntries, model: DEFAULT_GEMINI_MODEL }, [
          { timestamp: "00:00", seconds: 0, title: "Cached Opening" },
        ]),
        cacheDir,
      );

      const result = await processChaptersPipeline({
        inputFile: mediaPath,
        targetLang: "ja",
        cacheDir,
      });

      expect(result.fromCache).toBe(true);
      expect(result.chapters[0]?.title).toBe("Cached Opening");
    });
  });

  describe("processSummaryPipeline", () => {
    it("should generate summary from .srt and write to markdown file", async () => {
      const srtPath = path.join(tempDir, "summary_demo.srt");
      fs.writeFileSync(srtPath, "1\n00:00:00,000 --> 00:00:05,000\nIntro discussion\n");

      const result = await processSummaryPipeline({
        inputFile: srtPath,
        format: "md",
      });

      expect(result.summary.title).toBe("Sample Title");
      const outPath = result.outputFile ?? "";
      expect(outPath).toBe(path.join(tempDir, "summary_demo.summary.md"));
      expect(fs.existsSync(outPath)).toBe(true);
      const content = fs.readFileSync(outPath, "utf-8");
      expect(content).toContain("# Sample Title");
      expect(content).toContain("## Summary");
    });

    it("should output summary to stdout when stdout: true", async () => {
      const srtPath = path.join(tempDir, "summary_stdout.srt");
      fs.writeFileSync(srtPath, "1\n00:00:00,000 --> 00:00:05,000\nIntro\n");

      const stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
      const result = await processSummaryPipeline({
        inputFile: srtPath,
        stdout: true,
        format: "txt",
      });

      expect(stdoutSpy).toHaveBeenCalled();
      expect(result.outputFile).toBeUndefined();
      expect(result.formattedOutput).toContain("Sample Title");
      stdoutSpy.mockRestore();
    });

    it("should use cached summary if available", async () => {
      const mediaPath = path.join(tempDir, "summary_cached_video.mp4");
      fs.writeFileSync(mediaPath, "video bytes 2");
      const cacheDir = path.join(tempDir, "cache");

      const sourceEntries: SrtEntry[] = [
        { id: 1, startTime: "00:00:00,000", endTime: "00:00:02,000", text: "Cached source" },
      ];
      saveTranscriptionCache(
        mediaPath,
        {
          detectedLanguage: "en",
          entries: sourceEntries,
          createdAt: Date.now(),
        },
        cacheDir,
      );

      saveSummaryCache(
        mediaPath,
        "ja",
        createCachedSummary(
          "ja",
          { sourceEntries, model: DEFAULT_GEMINI_MODEL },
          {
            title: "Cached Title",
            summary: "Cached summary text",
            keyPoints: ["Cached point"],
            topics: [],
          },
        ),
        cacheDir,
      );

      const result = await processSummaryPipeline({
        inputFile: mediaPath,
        targetLang: "ja",
        cacheDir,
      });

      expect(result.fromCache).toBe(true);
      expect(result.summary.title).toBe("Cached Title");
    });
  });

  describe("processMediaPipeline soft subtitles mode (--embed)", () => {
    it("should embed multi-language subtitle tracks into a single video file", async () => {
      const mediaFile = path.join(tempDir, "sample_multitrack.mp4");
      fs.writeFileSync(mediaFile, "dummy video data");
      const cacheDir = path.join(tempDir, "cache");

      const mockEntries = [
        {
          id: 1,
          startTime: "00:00:01,000",
          endTime: "00:00:03,000",
          text: "Hello",
        },
      ];

      saveTranscriptionCache(
        mediaFile,
        {
          detectedLanguage: "en",
          entries: mockEntries,
          createdAt: Date.now(),
        },
        cacheDir,
      );

      saveTranslationCache(
        mediaFile,
        "ja",
        createCachedTranslation(
          "ja",
          {
            sourceEntries: mockEntries,
            model: DEFAULT_GEMINI_MODEL,
            contextWindowSize: DEFAULT_CONTEXT_WINDOW_SIZE,
          },
          [
            {
              id: 1,
              startTime: "00:00:01,000",
              endTime: "00:00:03,000",
              text: "こんにちは",
            },
          ],
        ),
        cacheDir,
      );

      saveTranslationCache(
        mediaFile,
        "es",
        createCachedTranslation(
          "es",
          {
            sourceEntries: mockEntries,
            model: DEFAULT_GEMINI_MODEL,
            contextWindowSize: DEFAULT_CONTEXT_WINDOW_SIZE,
          },
          [
            {
              id: 1,
              startTime: "00:00:01,000",
              endTime: "00:00:03,000",
              text: "Hola",
            },
          ],
        ),
        cacheDir,
      );

      const result = await processMediaPipeline({
        mediaFile,
        targetLang: "ja,es",
        embed: true,
        cacheDir,
      });

      const embeddedFile = result.outputFiles.find((f) => f.endsWith(".embedded.mp4"));
      expect(embeddedFile).toBeDefined();
      expect(embeddedFile).toBe(path.join(tempDir, "sample_multitrack.embedded.mp4"));
      expect(embeddedFile ? fs.existsSync(embeddedFile) : false).toBe(true);
    });

    it("should respect explicit output path when embedding soft subtitles", async () => {
      const mediaFile = path.join(tempDir, "sample_custom.mp4");
      fs.writeFileSync(mediaFile, "dummy video data");
      const cacheDir = path.join(tempDir, "cache");
      const customOut = path.join(tempDir, "custom_output.mp4");

      saveTranscriptionCache(
        mediaFile,
        {
          detectedLanguage: "ja",
          entries: [
            {
              id: 1,
              startTime: "00:00:00,000",
              endTime: "00:00:02,000",
              text: "テスト",
            },
          ],
          createdAt: Date.now(),
        },
        cacheDir,
      );

      const result = await processMediaPipeline({
        mediaFile,
        targetLang: "ja",
        noTranslate: true,
        embed: true,
        output: customOut,
        cacheDir,
      });

      expect(result.outputFiles).toContain(customOut);
      expect(fs.existsSync(customOut)).toBe(true);
    });
  });

  describe("resolveEmbeddedVideoPath", () => {
    it.each([
      { media: "clip.mp4", out: undefined, outDir: undefined, expected: "clip.embedded.mp4" },
      { media: "clip.avi", out: undefined, outDir: undefined, expected: "clip.embedded.avi" },
      { media: "clip.mp3", out: undefined, outDir: undefined, expected: "clip.embedded.mp4" },
      { media: "clip.avi", out: "out.mkv", outDir: undefined, expected: "out.mkv" },
      { media: "clip.mp4", out: "out.srt", outDir: undefined, expected: "out.embedded.mp4" },
      { media: "clip.avi", out: "out", outDir: undefined, expected: "out.embedded.avi" },
      {
        media: "clip.mp4",
        out: undefined,
        outDir: "dist",
        expected: path.join("dist", "clip.embedded.mp4"),
      },
      { media: "clip.mp4", out: "out.mov", outDir: "dist", expected: "out.mov" },
    ])(
      "resolves $media (out: $out, outDir: $outDir) -> $expected",
      ({ media, out, outDir, expected }) => {
        const mediaPath = path.join(tempDir, media);
        const outputOption = out ? path.join(tempDir, out) : undefined;
        const outputDir = outDir ? path.join(tempDir, outDir) : undefined;
        const expectedPath = path.join(tempDir, expected);
        expect(resolveEmbeddedVideoPath(mediaPath, outputOption, outputDir)).toBe(expectedPath);
      },
    );
  });

  describe("processMediaPipeline --embed container pre-check", () => {
    beforeEach(() => {
      vi.clearAllMocks();
      vi.spyOn(console, "log").mockImplementation(() => {});
    });

    const runEmbed = (
      mediaName: string,
      options: Partial<Parameters<typeof processMediaPipeline>[0]> = {},
    ) => {
      const mediaFile = path.join(tempDir, mediaName);
      if (!fs.existsSync(mediaFile)) {
        fs.writeFileSync(mediaFile, "dummy media bytes");
      }
      return processMediaPipeline({
        mediaFile,
        targetLang: "ja",
        embed: true,
        noCache: true,
        ...options,
      });
    };

    it.each([
      { media: "sample.avi", output: undefined, expectedFile: "sample.embedded.avi" },
      { media: "sample.ts", output: undefined, expectedFile: "sample.embedded.ts" },
      { media: "sample.avi", output: "out.avi", expectedFile: "out.avi" },
      { media: "sample.avi", output: "out.srt", expectedFile: "out.embedded.avi" },
      { media: "sample.mp4", output: "out.flv", expectedFile: "out.flv" },
    ])(
      "rejects unsupported container before calling APIs ($media, output: $output)",
      async ({ media, output, expectedFile }) => {
        const outOption = output ? path.join(tempDir, output) : undefined;
        await expect(runEmbed(media, { output: outOption })).rejects.toThrow(
          `Cannot embed subtitle tracks into "${expectedFile}"`,
        );

        expect(transcribeAudioSegments).not.toHaveBeenCalled();
        expect(translateSrtEntries).not.toHaveBeenCalled();
        expect(embedSubtitlesToVideo).not.toHaveBeenCalled();
      },
    );

    it.each([
      {
        lang: "en" as const,
        expected:
          'Cannot embed subtitle tracks into "sample.embedded.avi": the .avi container does not support soft subtitles (supported: .mp4, .m4v, .mov, .mkv, .webm). Generate the subtitles without --embed, then run "vsub embed <video> <subtitle-file> -o <name>.mkv".',
      },
      {
        lang: "ja" as const,
        expected:
          "「sample.embedded.avi」には字幕トラックを埋め込めません。.avi のコンテナはソフトサブに対応していません（対応: .mp4, .m4v, .mov, .mkv, .webm）。--embed を付けずに字幕を作ってから、「vsub embed <動画> <字幕ファイル> -o <名前>.mkv」を実行してください。",
      },
    ])("formats error message correctly in $lang", async ({ lang, expected }) => {
      await expect(runEmbed("sample.avi", { lang })).rejects.toThrow(expected);
    });

    it.each([
      {
        media: "sample.mp4",
        output: undefined,
        targetLang: "ja",
        expectedFile: "sample.embedded.mp4",
      },
      {
        media: "sample.avi",
        output: "out.mkv",
        targetLang: "ja,es",
        expectedFile: "out.mkv",
      },
    ])(
      "proceeds to embed when container is supported ($media, output: $output)",
      async ({ media, output, targetLang, expectedFile }) => {
        const outOption = output ? path.join(tempDir, output) : undefined;
        const expectedPath = path.join(tempDir, expectedFile);

        const result = await runEmbed(media, { output: outOption, targetLang });

        expect(transcribeAudioSegments).toHaveBeenCalledTimes(1);
        expect(embedSubtitlesToVideo).toHaveBeenCalledWith(
          expect.anything(),
          expect.anything(),
          expectedPath,
          expect.anything(),
        );
        expect(result.outputFiles).toContain(expectedPath);
      },
    );

    it.each([
      { media: "sample.avi", options: { embed: true }, error: /Cannot embed subtitle tracks into/ },
      {
        media: "sample.mp3",
        options: { embed: true },
        error: /Cannot embed subtitles into an audio file/,
      },
      {
        media: "sample.mp3",
        options: { burn: true, embed: false },
        error: /Cannot burn subtitles into audio files/,
      },
    ])(
      "does not create backup files when aborted early ($media, $options)",
      async ({ media, options, error }) => {
        const baseName = path.basename(media, path.extname(media));
        const existingSub = path.join(tempDir, `${baseName}.ja.srt`);
        fs.writeFileSync(existingSub, "existing subtitle content");

        const mediaExt = path.extname(media);
        const filesBefore = fs.readdirSync(tempDir).filter((f) => !f.endsWith(mediaExt));

        await expect(runEmbed(media, { ...options, backup: true })).rejects.toThrow(error);

        const filesAfter = fs.readdirSync(tempDir).filter((f) => !f.endsWith(mediaExt));
        expect(filesAfter).toEqual(filesBefore);
        expect(filesAfter.some((f) => f.endsWith(".bak"))).toBe(false);
      },
    );

    it("does not create outputDir when aborted early for unsupported container", async () => {
      const outDir = path.join(tempDir, "out-dir");
      await expect(runEmbed("sample.avi", { outputDir: outDir })).rejects.toThrow(
        /Cannot embed subtitle tracks into "sample.embedded.avi"/,
      );
      expect(fs.existsSync(outDir)).toBe(false);
    });
  });

  describe("resolveBurntVideoPath", () => {
    it.each([
      {
        media: "clip.mp4",
        langTag: "ja",
        isMultiLang: false,
        out: undefined,
        outDir: undefined,
        expected: "clip.ja.subbed.mp4",
      },
      {
        media: "clip.mp4",
        langTag: "ja.bilingual",
        isMultiLang: false,
        out: undefined,
        outDir: undefined,
        expected: "clip.ja.bilingual.subbed.mp4",
      },
      {
        media: "clip.mp4",
        langTag: "ja",
        isMultiLang: false,
        out: undefined,
        outDir: "dist",
        expected: path.join("dist", "clip.ja.subbed.mp4"),
      },
      {
        media: "clip.mp4",
        langTag: "ja",
        isMultiLang: false,
        out: "out.mp4",
        outDir: undefined,
        expected: "out.mp4",
      },
      {
        media: "clip.mp4",
        langTag: "ja",
        isMultiLang: false,
        out: "out.mkv",
        outDir: undefined,
        expected: "out.subbed.mp4",
      },
      {
        media: "clip.mp4",
        langTag: "ja",
        isMultiLang: false,
        out: "out.srt",
        outDir: undefined,
        expected: "out.subbed.mp4",
      },
      {
        media: "clip.mp4",
        langTag: "ja",
        isMultiLang: true,
        out: "out.mp4",
        outDir: undefined,
        expected: "out.ja.subbed.mp4",
      },
      {
        media: "clip.mp4",
        langTag: "ja",
        isMultiLang: false,
        out: "out.mp4",
        outDir: "dist",
        expected: "out.mp4",
      },
    ])(
      "resolves $media (langTag: $langTag, isMultiLang: $isMultiLang, out: $out, outDir: $outDir) -> $expected",
      ({ media, langTag, isMultiLang, out, outDir, expected }) => {
        const mediaPath = path.join(tempDir, media);
        const outputOption = out ? path.join(tempDir, out) : undefined;
        const outputDir = outDir ? path.join(tempDir, outDir) : undefined;
        const expectedPath = path.join(tempDir, expected);
        expect(
          resolveBurntVideoPath(mediaPath, langTag, isMultiLang, outputOption, outputDir),
        ).toBe(expectedPath);
      },
    );
  });

  describe("findOutputPathConflict", () => {
    it.each([
      {
        name: "returns undefined when outputs are distinct and differ from input",
        input: "input.mp4",
        outputs: ["out.ja.srt", "out.mkv"],
        expected: undefined,
      },
      {
        name: "returns conflict when output matches input",
        input: "input.mp4",
        outputs: ["input.mp4"],
        expected: "input.mp4",
      },
      {
        name: "returns conflict when outputs duplicate each other",
        input: "input.mp4",
        outputs: ["out.mp4", "out.mp4"],
        expected: "out.mp4",
      },
      {
        name: "returns conflict when output matches input case-insensitively",
        input: "input.mp4",
        outputs: ["INPUT.MP4"],
        expected: "INPUT.MP4",
      },
      {
        name: "returns conflict when outputs duplicate case-insensitively",
        input: "input.mp4",
        outputs: ["out.mkv", "OUT.MKV"],
        expected: "OUT.MKV",
      },
    ])("$name", ({ input, outputs, expected }) => {
      const inputPath = path.join(tempDir, input);
      const outputPaths = outputs.map((p) => path.join(tempDir, p));
      const expectedPath = expected ? path.join(tempDir, expected) : undefined;
      expect(findOutputPathConflict(inputPath, outputPaths)).toBe(expectedPath);
    });
  });

  describe("processMediaPipeline output paths", () => {
    const mediaContent = "dummy media bytes";
    let dummyMedia: string;

    beforeEach(() => {
      vi.clearAllMocks();
      vi.spyOn(console, "log").mockImplementation(() => {});
      dummyMedia = path.join(tempDir, "sample.mp4");
      fs.writeFileSync(dummyMedia, mediaContent);
    });

    const runPipeline = (options: Partial<Parameters<typeof processMediaPipeline>[0]> = {}) => {
      return processMediaPipeline({
        mediaFile: dummyMedia,
        targetLang: "ja",
        noCache: true,
        ...options,
      });
    };

    describe("with a video -o", () => {
      const outputCases = [
        {
          name: "embed, -o out.mkv",
          options: { embed: true, output: "out.mkv" },
          subtitles: ["out.ja.srt"],
          burnt: [] as string[],
          embedded: "out.mkv",
        },
        {
          name: "embed, -o out.mkv, format: srt,vtt",
          options: { embed: true, output: "out.mkv", format: "srt,vtt" },
          subtitles: ["out.ja.srt", "out.ja.vtt"],
          burnt: [] as string[],
          embedded: "out.mkv",
        },
        {
          name: "embed, -o out.mkv, bilingual",
          options: { embed: true, output: "out.mkv", bilingual: true },
          subtitles: ["out.ja.bilingual.srt"],
          burnt: [] as string[],
          embedded: "out.mkv",
        },
        {
          name: "embed, -o out.mkv, targetLang: ja,en",
          options: { embed: true, output: "out.mkv", targetLang: "ja,en" },
          subtitles: ["out.ja.srt", "out.en.srt"],
          burnt: [] as string[],
          embedded: "out.mkv",
        },
        {
          name: "embed, -o out.srt",
          options: { embed: true, output: "out.srt" },
          subtitles: ["out.srt"],
          burnt: [] as string[],
          embedded: "out.embedded.mp4",
        },
        {
          name: "burn, -o out.mp4",
          options: { burn: true, output: "out.mp4" },
          subtitles: ["out.ja.srt"],
          burnt: ["out.mp4"],
          embedded: undefined,
        },
        {
          name: "burn, -o out.mkv",
          options: { burn: true, output: "out.mkv" },
          subtitles: ["out.ja.srt"],
          burnt: ["out.subbed.mp4"],
          embedded: undefined,
        },
        {
          name: "burn, -o out.mp4, targetLang: ja,en",
          options: { burn: true, output: "out.mp4", targetLang: "ja,en" },
          subtitles: ["out.ja.srt", "out.en.srt"],
          burnt: ["out.ja.subbed.mp4", "out.en.subbed.mp4"],
          embedded: undefined,
        },
        {
          name: "burn, -o out.srt",
          options: { burn: true, output: "out.srt" },
          subtitles: ["out.srt"],
          burnt: ["out.subbed.mp4"],
          embedded: undefined,
        },
        {
          name: "embed and burn, -o out.mkv",
          options: { embed: true, burn: true, output: "out.mkv" },
          subtitles: ["out.ja.srt"],
          burnt: ["out.subbed.mp4"],
          embedded: "out.mkv",
        },
        {
          name: "none, -o out.mkv",
          options: { output: "out.mkv" },
          subtitles: ["out.mkv"],
          burnt: [] as string[],
          embedded: undefined,
        },
        {
          name: "none, -o out.srt",
          options: { output: "out.srt" },
          subtitles: ["out.srt"],
          burnt: [] as string[],
          embedded: undefined,
        },
        {
          name: "none, -o out.srt, format: srt,vtt",
          options: { output: "out.srt", format: "srt,vtt" },
          subtitles: ["out.srt", "out.vtt"],
          burnt: [] as string[],
          embedded: undefined,
        },
      ];

      it.each(outputCases)(
        "generates correct subtitle, burn and embed paths for $name",
        async ({ options, subtitles, burnt, embedded }) => {
          const outOption = options.output ? path.join(tempDir, options.output) : undefined;
          const expectedSubs = subtitles.map((s) => path.join(tempDir, s));
          const expectedBurnt = burnt.map((b) => path.join(tempDir, b));
          const expectedEmbedded = embedded ? path.join(tempDir, embedded) : undefined;
          const expectedAllOutputs = [
            ...expectedSubs,
            ...expectedBurnt,
            ...(expectedEmbedded ? [expectedEmbedded] : []),
          ];

          const result = await runPipeline({
            ...options,
            output: outOption,
          });

          for (const subPath of expectedSubs) {
            expect(fs.existsSync(subPath)).toBe(true);
            const content = fs.readFileSync(subPath, "utf-8");
            expect(content).toContain("-->");
          }

          const expectedSrtSubs = expectedSubs.filter((sub) => sub.endsWith(".srt"));
          expect(
            vi
              .mocked(burnSubtitlesToVideo)
              .mock.calls.map(([video, sub, output]) => [video, sub, output]),
          ).toEqual(
            expectedBurnt.map((burntPath, i) => [dummyMedia, expectedSrtSubs[i], burntPath]),
          );
          expect(
            vi
              .mocked(embedSubtitlesToVideo)
              .mock.calls.map(([video, tracks, output]) => [
                video,
                tracks.map((track) => track.path),
                output,
              ]),
          ).toEqual(expectedEmbedded ? [[dummyMedia, expectedSrtSubs, expectedEmbedded]] : []);

          expect(result.outputFiles).toEqual(expectedAllOutputs);
        },
      );

      it.each(outputCases)(
        "backs up all target files when backup: true for $name",
        async ({ options, subtitles, burnt, embedded }) => {
          const outOption = options.output ? path.join(tempDir, options.output) : undefined;
          const expectedSubs = subtitles.map((s) => path.join(tempDir, s));
          const expectedBurnt = burnt.map((b) => path.join(tempDir, b));
          const expectedEmbedded = embedded ? path.join(tempDir, embedded) : undefined;
          const expectedAllOutputs = [
            ...expectedSubs,
            ...expectedBurnt,
            ...(expectedEmbedded ? [expectedEmbedded] : []),
          ];

          for (const targetPath of expectedAllOutputs) {
            fs.writeFileSync(targetPath, "pre-existing file content");
          }

          const result = await runPipeline({
            ...options,
            output: outOption,
            backup: true,
          });

          const expectedBackups = expectedAllOutputs.map((p) => `${p}.bak`);
          expect((result.backedUpFiles ?? []).slice().sort()).toEqual(
            expectedBackups.slice().sort(),
          );
        },
      );
    });

    describe("conflict pre-check", () => {
      const conflictCases = [
        {
          name: "embed and burn, -o out.mp4",
          options: { embed: true, burn: true, output: "out.mp4" },
          conflictFile: "out.mp4",
        },
        {
          name: "none, -o sample.mp4",
          options: { output: "sample.mp4" },
          conflictFile: "sample.mp4",
        },
        {
          name: "embed, -o sample.mp4",
          options: { embed: true, output: "sample.mp4" },
          conflictFile: "sample.mp4",
        },
        {
          name: "burn, -o sample.mp4",
          options: { burn: true, output: "sample.mp4" },
          conflictFile: "sample.mp4",
        },
        {
          name: "embed and burn, -o out.mp4, outputDir: out-dir",
          options: { embed: true, burn: true, output: "out.mp4", outputDir: "out-dir" },
          conflictFile: "out.mp4",
        },
      ];

      it.each(conflictCases)(
        "rejects when output conflicts before calling expensive APIs ($name)",
        async ({ options, conflictFile }) => {
          const outOption = options.output ? path.join(tempDir, options.output) : undefined;
          const outDirOption = options.outputDir
            ? path.join(tempDir, options.outputDir)
            : undefined;

          const filesBefore = fs.readdirSync(tempDir);

          await expect(
            runPipeline({
              ...options,
              output: outOption,
              outputDir: outDirOption,
              overwrite: true,
            }),
          ).rejects.toThrow(`Cannot write "${conflictFile}"`);

          expect(extractAudio).not.toHaveBeenCalled();
          expect(transcribeAudioSegments).not.toHaveBeenCalled();
          expect(translateSrtEntries).not.toHaveBeenCalled();
          expect(burnSubtitlesToVideo).not.toHaveBeenCalled();
          expect(embedSubtitlesToVideo).not.toHaveBeenCalled();

          expect(fs.readFileSync(dummyMedia, "utf-8")).toBe(mediaContent);
          expect(fs.readdirSync(tempDir)).toEqual(filesBefore);
        },
      );

      it.each([
        {
          lang: "en" as const,
          expected:
            'Cannot write "out.mp4": the path is the input media file or is also used by another output. Specify a different path with -o.',
        },
        {
          lang: "ja" as const,
          expected:
            "「out.mp4」には書き出せません。入力のメディアファイルか、ほかの出力と同じパスです。-o で別のパスを指定してください。",
        },
      ])("formats error message correctly in $lang", async ({ lang, expected }) => {
        await expect(
          runPipeline({
            embed: true,
            burn: true,
            output: path.join(tempDir, "out.mp4"),
            lang,
          }),
        ).rejects.toThrow(expected);
      });
    });
  });

  describe("processMediaPipeline burn subtitles mode (--burn)", () => {
    it("should pass burnPosition and burnFontSize to burnSubtitlesToVideo", async () => {
      const mediaFile = path.join(tempDir, "sample_burn.mp4");
      fs.writeFileSync(mediaFile, "dummy video data");
      const cacheDir = path.join(tempDir, "cache");

      saveTranscriptionCache(
        mediaFile,
        {
          detectedLanguage: "ja",
          entries: [
            {
              id: 1,
              startTime: "00:00:00,000",
              endTime: "00:00:02,000",
              text: "テスト",
            },
          ],
          createdAt: Date.now(),
        },
        cacheDir,
      );

      const result = await processMediaPipeline({
        mediaFile,
        targetLang: "ja",
        noTranslate: true,
        burn: true,
        burnPosition: "top",
        burnFontSize: "large",
        cacheDir,
      });

      const burntFile = result.outputFiles.find((f) => f.endsWith(".subbed.mp4"));
      expect(burntFile).toBeDefined();
      expect(burntFile ? fs.existsSync(burntFile) : false).toBe(true);

      const { burnSubtitlesToVideo } = await import("./ffmpeg.js");
      expect(burnSubtitlesToVideo).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.objectContaining({
          position: "top",
          fontSize: "large",
        }),
      );
    });
  });

  describe("processMediaPipeline default target language", () => {
    let cacheDir: string;
    let mediaFile: string;

    beforeEach(() => {
      vi.clearAllMocks();
      cacheDir = path.join(tempDir, "cache");
      mediaFile = path.join(tempDir, "sample.mp4");
      fs.writeFileSync(mediaFile, "dummy video data");

      saveTranscriptionCache(
        mediaFile,
        {
          detectedLanguage: "en",
          entries: [
            {
              id: 1,
              startTime: "00:00:00,000",
              endTime: "00:00:02,000",
              text: "Hello world",
            },
          ],
          createdAt: Date.now(),
        },
        cacheDir,
      );
    });

    it.each([
      {
        envTargetLang: "es",
        configFileTargetLang: undefined,
        optionTargetLang: undefined,
        expectedTargetLanguages: ["es"],
        expectedCallLang: "es",
      },
      {
        envTargetLang: undefined,
        configFileTargetLang: "es",
        optionTargetLang: undefined,
        expectedTargetLanguages: ["es"],
        expectedCallLang: "es",
      },
      {
        envTargetLang: "es",
        configFileTargetLang: undefined,
        optionTargetLang: "fr",
        expectedTargetLanguages: ["fr"],
        expectedCallLang: "fr",
      },
      {
        envTargetLang: undefined,
        configFileTargetLang: undefined,
        optionTargetLang: undefined,
        expectedTargetLanguages: ["ja"],
        expectedCallLang: "ja",
      },
    ])(
      "resolves to $expectedTargetLanguages (env: $envTargetLang, config: $configFileTargetLang, option: $optionTargetLang)",
      async ({
        envTargetLang,
        configFileTargetLang,
        optionTargetLang,
        expectedTargetLanguages,
        expectedCallLang,
      }) => {
        if (envTargetLang) {
          process.env["VSUB_TARGET_LANG"] = envTargetLang;
        }
        if (configFileTargetLang) {
          const configDir = path.join(configHome, "vsub");
          fs.mkdirSync(configDir, { recursive: true });
          fs.writeFileSync(
            path.join(configDir, "config.json"),
            JSON.stringify({ targetLang: configFileTargetLang }),
            "utf-8",
          );
        }

        const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
        try {
          const result = await processMediaPipeline({
            mediaFile,
            targetLang: optionTargetLang,
            stdout: true,
            cacheDir,
          });

          expect(result.targetLanguages).toEqual(expectedTargetLanguages);
          expect(vi.mocked(translateSrtEntries).mock.calls[0]?.[1]).toBe(expectedCallLang);
        } finally {
          logSpy.mockRestore();
        }
      },
    );

    it("passes concurrency from config to translateSrtEntries when --concurrency is omitted", async () => {
      saveGlobalConfig({ concurrency: 4 });
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      try {
        await processMediaPipeline({
          mediaFile,
          targetLang: "ja",
          stdout: true,
          cacheDir,
        });

        expect(translateSrtEntries).toHaveBeenCalled();
        const callOptions = vi.mocked(translateSrtEntries).mock.calls[0]?.[5];
        expect(callOptions?.concurrency).toBe(4);
      } finally {
        logSpy.mockRestore();
      }
    });
  });

  describe("processMediaPipeline translation cache binding", () => {
    let cacheDir: string;
    let mediaFile: string;

    beforeEach(() => {
      vi.clearAllMocks();
      cacheDir = path.join(tempDir, "cache-binding");
      mediaFile = path.join(tempDir, "sample-binding.mp4");
      fs.writeFileSync(mediaFile, "dummy video data");
    });

    async function runPipelineTwice(params: {
      initialTranscription: SrtEntry[];
      firstOptions?: Partial<Parameters<typeof processMediaPipeline>[0]>;
      secondTranscription?: SrtEntry[];
      beforeSecondRun?: (() => void) | undefined;
      secondOptions?: Partial<Parameters<typeof processMediaPipeline>[0]>;
    }) {
      saveTranscriptionCache(
        mediaFile,
        {
          detectedLanguage: "en",
          entries: params.initialTranscription,
          createdAt: Date.now(),
        },
        cacheDir,
      );

      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      try {
        const firstResult = await processMediaPipeline({
          mediaFile,
          targetLang: "ja",
          cacheDir,
          stdout: true,
          ...params.firstOptions,
        });

        if (params.secondTranscription) {
          saveTranscriptionCache(
            mediaFile,
            {
              detectedLanguage: "en",
              entries: params.secondTranscription,
              createdAt: Date.now(),
            },
            cacheDir,
          );
        }

        if (params.beforeSecondRun) {
          params.beforeSecondRun();
        }

        const secondResult = await processMediaPipeline({
          mediaFile,
          targetLang: "ja",
          cacheDir,
          stdout: true,
          ...params.secondOptions,
        });

        return { firstResult, secondResult };
      } finally {
        logSpy.mockRestore();
      }
    }

    it("retranslates when transcription changes with same number of entries but different text and timestamps", async () => {
      const transcriptionA: SrtEntry[] = [
        { id: 1, startTime: "00:00:00,000", endTime: "00:00:02,000", text: "Hello world A" },
      ];
      const transcriptionB: SrtEntry[] = [
        { id: 1, startTime: "00:00:04,000", endTime: "00:00:06,000", text: "Hello world B" },
      ];

      const { secondResult } = await runPipelineTwice({
        initialTranscription: transcriptionA,
        secondTranscription: transcriptionB,
      });

      expect(translateSrtEntries).toHaveBeenCalledTimes(2);
      expect(vi.mocked(translateSrtEntries).mock.calls[1]?.[0]).toEqual(transcriptionB);
      expect(secondResult.stdoutContent).toContain("00:00:04,000");
      expect(secondResult.stdoutContent).not.toContain("00:00:00,000");
    });

    it("retranslates when reflow settings produce different text segments with the same entry count", async () => {
      const transcription: SrtEntry[] = [
        {
          id: 1,
          startTime: "00:00:00,000",
          endTime: "00:00:06,000",
          text: "one two three four five six seven eight",
        },
      ];

      const reflow1 = reflowSrtEntries(transcription, { maxLength: 20 });
      const reflow2 = reflowSrtEntries(transcription, { maxLength: 23 });
      expect(reflow1).toHaveLength(2);
      expect(reflow2).toHaveLength(2);
      expect(reflow1[0]?.text).not.toBe(reflow2[0]?.text);

      await runPipelineTwice({
        initialTranscription: transcription,
        firstOptions: { maxLength: 20 },
        secondOptions: { maxLength: 23 },
      });

      expect(translateSrtEntries).toHaveBeenCalledTimes(2);
    });

    it.each([
      {
        name: "prompt attached first, then detached",
        firstOptions: { prompt: "Translate politely" },
        secondOptions: { prompt: undefined },
      },
      {
        name: "prompt omitted first, then attached",
        firstOptions: { prompt: undefined },
        secondOptions: { prompt: "Translate politely" },
      },
      {
        name: "geminiModel specified first, then omitted (default)",
        firstOptions: { geminiModel: "gemini-3.7-flash" },
        secondOptions: { geminiModel: undefined },
      },
      {
        name: "geminiModel omitted (default) first, then specified",
        firstOptions: { geminiModel: undefined },
        secondOptions: { geminiModel: "gemini-3.7-flash" },
      },
    ])("retranslates when $name", async ({ firstOptions, secondOptions }) => {
      const transcription: SrtEntry[] = [
        { id: 1, startTime: "00:00:00,000", endTime: "00:00:02,000", text: "Hello" },
      ];

      await runPipelineTwice({
        initialTranscription: transcription,
        firstOptions,
        secondOptions,
      });

      expect(translateSrtEntries).toHaveBeenCalledTimes(2);
    });

    it("invalidates legacy translation cache without sourceHash and updates it with sourceHash", async () => {
      const transcription: SrtEntry[] = [
        { id: 1, startTime: "00:00:00,000", endTime: "00:00:02,000", text: "Legacy test" },
      ];
      saveTranscriptionCache(
        mediaFile,
        {
          detectedLanguage: "en",
          entries: transcription,
          createdAt: Date.now(),
        },
        cacheDir,
      );

      saveTranslationCache(
        mediaFile,
        "ja",
        {
          targetLang: "ja",
          entries: [{ id: 1, startTime: "00:00:00,000", endTime: "00:00:02,000", text: "古い訳" }],
          createdAt: Date.now(),
        },
        cacheDir,
      );

      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      try {
        const result = await processMediaPipeline({
          mediaFile,
          targetLang: "ja",
          cacheDir,
          stdout: true,
        });

        expect(translateSrtEntries).toHaveBeenCalledTimes(1);
        expect(result.cacheStatus?.transcriptionHit).toBe(true);

        const updatedCache = loadMediaCache(mediaFile, cacheDir);
        expect(updatedCache?.translations?.["ja"]?.sourceHash).toBeDefined();
        expect(typeof updatedCache?.translations?.["ja"]?.sourceHash).toBe("string");
      } finally {
        logSpy.mockRestore();
      }
    });

    it("reuses cache when source entries and options are identical", async () => {
      const transcription: SrtEntry[] = [
        { id: 1, startTime: "00:00:00,000", endTime: "00:00:02,000", text: "Consistent hello" },
      ];

      const { firstResult, secondResult } = await runPipelineTwice({
        initialTranscription: transcription,
      });

      expect(translateSrtEntries).toHaveBeenCalledTimes(1);
      expect(secondResult.stdoutContent).toBe(firstResult.stdoutContent);
    });

    it("reuses cache when maxLength differs but entries are not reflowed because text is short", async () => {
      const transcription: SrtEntry[] = [
        { id: 1, startTime: "00:00:00,000", endTime: "00:00:02,000", text: "Hi" },
      ];

      await runPipelineTwice({
        initialTranscription: transcription,
        firstOptions: { maxLength: 40 },
        secondOptions: { maxLength: 50 },
      });

      expect(translateSrtEntries).toHaveBeenCalledTimes(1);
    });

    it("retranslates when environment variable VSUB_GEMINI_MODEL changes between runs", async () => {
      const transcription: SrtEntry[] = [
        { id: 1, startTime: "00:00:00,000", endTime: "00:00:02,000", text: "Env model test" },
      ];

      await runPipelineTwice({
        initialTranscription: transcription,
        beforeSecondRun: () => {
          process.env["VSUB_GEMINI_MODEL"] = "gemini-3.7-flash";
        },
      });

      expect(translateSrtEntries).toHaveBeenCalledTimes(2);
    });

    it("reuses cache when geminiModel explicitly matches DEFAULT_GEMINI_MODEL and is omitted on second run", async () => {
      const transcription: SrtEntry[] = [
        { id: 1, startTime: "00:00:00,000", endTime: "00:00:02,000", text: "Default model match" },
      ];

      await runPipelineTwice({
        initialTranscription: transcription,
        firstOptions: { geminiModel: DEFAULT_GEMINI_MODEL },
        secondOptions: { geminiModel: undefined },
      });

      expect(translateSrtEntries).toHaveBeenCalledTimes(1);
    });

    it("retranslates when contextWindow changes (2 first, then omitted)", async () => {
      const transcription: SrtEntry[] = [
        { id: 1, startTime: "00:00:00,000", endTime: "00:00:02,000", text: "Context test" },
      ];

      await runPipelineTwice({
        initialTranscription: transcription,
        firstOptions: { contextWindow: 2 },
        secondOptions: { contextWindow: undefined },
      });

      expect(translateSrtEntries).toHaveBeenCalledTimes(2);
    });

    it("reuses translation cache when contextWindow explicitly matches default 5 and is omitted on second run", async () => {
      const transcription: SrtEntry[] = [
        { id: 1, startTime: "00:00:00,000", endTime: "00:00:02,000", text: "Context default test" },
      ];

      await runPipelineTwice({
        initialTranscription: transcription,
        firstOptions: { contextWindow: 5 },
        secondOptions: { contextWindow: undefined },
      });

      expect(translateSrtEntries).toHaveBeenCalledTimes(1);
    });
  });

  describe("transcription, chapters and summary cache binding", () => {
    let cacheDir: string;
    let mediaFile: string;

    beforeEach(() => {
      vi.clearAllMocks();
      cacheDir = path.join(tempDir, "cache-rest");
      mediaFile = path.join(tempDir, "sample-rest.mp4");
      fs.writeFileSync(mediaFile, "dummy video data");
      // Output is silenced for the whole describe; the outer afterEach restores the spies.
      vi.spyOn(console, "log").mockImplementation(() => {});
      vi.spyOn(process.stdout, "write").mockReturnValue(true);
    });

    function runMain(options: Partial<Parameters<typeof processMediaPipeline>[0]> = {}) {
      return processMediaPipeline({
        mediaFile,
        noTranslate: true,
        cacheDir,
        stdout: true,
        ...options,
      });
    }

    function runChapters(options: Partial<Parameters<typeof processChaptersPipeline>[0]> = {}) {
      return processChaptersPipeline({ inputFile: mediaFile, cacheDir, stdout: true, ...options });
    }

    function runSummary(options: Partial<Parameters<typeof processSummaryPipeline>[0]> = {}) {
      return processSummaryPipeline({ inputFile: mediaFile, cacheDir, stdout: true, ...options });
    }

    const generatorTargets = [
      { target: "chapters", run: () => runChapters(), getMock: () => generateChapters },
      { target: "summary", run: () => runSummary(), getMock: () => generateSummary },
    ];

    it.each([
      {
        name: "env VSUB_WHISPER_PROMPT",
        setup: () => {
          process.env["VSUB_WHISPER_PROMPT"] = "prompt from env";
        },
      },
      {
        name: "config file whisperPrompt",
        setup: () => {
          const configDir = path.join(configHome, "vsub");
          fs.mkdirSync(configDir, { recursive: true });
          fs.writeFileSync(
            path.join(configDir, "config.json"),
            JSON.stringify({ whisperPrompt: "prompt from config" }),
            "utf-8",
          );
        },
      },
      {
        name: "env VSUB_GLOSSARY inline",
        setup: () => {
          process.env["VSUB_GLOSSARY"] = "AI=人工知能";
        },
      },
      {
        name: "env VSUB_GROQ_MODEL",
        setup: () => {
          process.env["VSUB_GROQ_MODEL"] = "whisper-large-v3";
        },
      },
      {
        name: "no settings",
        setup: () => {},
      },
    ])(
      "transcribes only once when executing main -> chapters -> summarize -> main ($name)",
      async ({ setup }) => {
        setup();

        await runMain();
        await runChapters();
        await runSummary();
        await runMain();

        expect(transcribeAudioSegments).toHaveBeenCalledTimes(1);
      },
    );

    it.each([
      {
        name: "main whisperPrompt: attached then detached",
        run1: () => runMain({ whisperPrompt: "custom prompt" }),
        run2: () => runMain({ whisperPrompt: undefined }),
      },
      {
        name: "main whisperPrompt: detached then attached",
        run1: () => runMain({ whisperPrompt: undefined }),
        run2: () => runMain({ whisperPrompt: "custom prompt" }),
      },
      {
        name: "main groqModel: attached then detached",
        run1: () => runMain({ groqModel: "whisper-large-v3" }),
        run2: () => runMain({ groqModel: undefined }),
      },
      {
        name: "chapters whisperPrompt: attached then detached",
        run1: () => runChapters({ whisperPrompt: "custom prompt" }),
        run2: () => runChapters({ whisperPrompt: undefined }),
      },
    ])("retranscribes on second run when $name", async ({ run1, run2 }) => {
      await run1();
      expect(transcribeAudioSegments).toHaveBeenCalledTimes(1);
      await run2();
      expect(transcribeAudioSegments).toHaveBeenCalledTimes(2);
    });

    it("reuses transcription cache when groqModel explicitly matches DEFAULT_GROQ_MODEL and is omitted on second run", async () => {
      await runMain({ groqModel: DEFAULT_GROQ_MODEL });
      expect(transcribeAudioSegments).toHaveBeenCalledTimes(1);
      await runMain({ groqModel: undefined });
      expect(transcribeAudioSegments).toHaveBeenCalledTimes(1);
    });

    it.each(generatorTargets)(
      "regenerates $target when transcription entries change in cache",
      async ({ run, getMock }) => {
        const mockFn = getMock();
        const transcriptionA: SrtEntry[] = [
          { id: 1, startTime: "00:00:00,000", endTime: "00:00:02,000", text: "Entry A" },
        ];
        const transcriptionB: SrtEntry[] = [
          { id: 1, startTime: "00:00:00,000", endTime: "00:00:02,000", text: "Entry B" },
        ];

        saveTranscriptionCache(
          mediaFile,
          { detectedLanguage: "en", entries: transcriptionA, createdAt: Date.now() },
          cacheDir,
        );

        await run();
        expect(mockFn).toHaveBeenCalledTimes(1);
        expect(mockFn).toHaveBeenLastCalledWith(
          transcriptionA,
          expect.anything(),
          expect.anything(),
        );

        saveTranscriptionCache(
          mediaFile,
          { detectedLanguage: "en", entries: transcriptionB, createdAt: Date.now() },
          cacheDir,
        );

        await run();
        expect(mockFn).toHaveBeenCalledTimes(2);
        expect(mockFn).toHaveBeenLastCalledWith(
          transcriptionB,
          expect.anything(),
          expect.anything(),
        );
      },
    );

    it.each(generatorTargets)(
      "reuses $target cache when transcription entries are identical",
      async ({ run, getMock }) => {
        const mockFn = getMock();
        await run();
        expect(mockFn).toHaveBeenCalledTimes(1);
        await run();
        expect(mockFn).toHaveBeenCalledTimes(1);
      },
    );

    it.each([
      {
        name: "chapters prompt: attached then detached",
        run1: () => runChapters({ prompt: "Focus on intro" }),
        run2: () => runChapters({ prompt: undefined }),
        getMock: () => generateChapters,
      },
      {
        name: "chapters geminiModel: attached then detached",
        run1: () => runChapters({ geminiModel: "gemini-2.5-flash" }),
        run2: () => runChapters({ geminiModel: undefined }),
        getMock: () => generateChapters,
      },
      {
        name: "summary prompt: attached then detached",
        run1: () => runSummary({ prompt: "Short bullets" }),
        run2: () => runSummary({ prompt: undefined }),
        getMock: () => generateSummary,
      },
      {
        name: "summary geminiModel: attached then detached",
        run1: () => runSummary({ geminiModel: "gemini-2.5-flash" }),
        run2: () => runSummary({ geminiModel: undefined }),
        getMock: () => generateSummary,
      },
    ])("regenerates when $name", async ({ run1, run2, getMock }) => {
      const mockFn = getMock();
      await run1();
      expect(mockFn).toHaveBeenCalledTimes(1);
      await run2();
      expect(mockFn).toHaveBeenCalledTimes(2);
    });

    it("reuses legacy transcription cache without model for both main and chapters", async () => {
      const transcription: SrtEntry[] = [
        { id: 1, startTime: "00:00:00,000", endTime: "00:00:02,000", text: "Legacy Hello" },
      ];
      saveTranscriptionCache(
        mediaFile,
        {
          detectedLanguage: "en",
          entries: transcription,
          createdAt: Date.now(),
        },
        cacheDir,
      );

      await runMain();
      await runChapters();

      expect(transcribeAudioSegments).not.toHaveBeenCalled();
    });
  });

  describe("word timings (wordChunks)", () => {
    let cacheDir: string;
    let mediaFile: string;

    // Group A: 6.5s of Latin words, extended to 7.5s by the 1.5s room before group B.
    // Group B: 40 kana words, which the default limits split.
    const wordChunks: WordChunk[] = [
      {
        offsetSeconds: 0,
        words: [
          ...Array.from({ length: 13 }, (_, i) => ({
            start: i * 0.5,
            end: (i + 1) * 0.5,
            text: `w${i + 1}`,
          })),
          ...Array.from({ length: 40 }, (_, i) => ({
            start: 8 + i * 0.1,
            end: 8 + (i + 1) * 0.1,
            text: "あ",
          })),
        ],
      },
    ];

    beforeEach(() => {
      vi.clearAllMocks();
      cacheDir = path.join(tempDir, "cache-words");
      mediaFile = path.join(tempDir, "sample-words.mp4");
      fs.writeFileSync(mediaFile, "dummy video data");
      vi.spyOn(console, "log").mockImplementation(() => {});
      vi.spyOn(process.stdout, "write").mockReturnValue(true);
      saveTranscriptionCache(
        mediaFile,
        {
          detectedLanguage: "en",
          entries: buildEntriesFromWords(wordChunks),
          wordChunks,
          createdAt: Date.now(),
        },
        cacheDir,
      );
    });

    function runMain(options: Partial<Parameters<typeof processMediaPipeline>[0]> = {}) {
      return processMediaPipeline({
        mediaFile,
        targetLang: "ja",
        cacheDir,
        stdout: true,
        ...options,
      });
    }

    function translatedSource(callIndex = 0): SrtEntry[] {
      return vi.mocked(translateSrtEntries).mock.calls[callIndex]?.[0] as SrtEntry[];
    }

    it("rebuilds subtitles from cached wordChunks without reflow, using the current limits", async () => {
      await runMain({ maxLength: 20, maxDuration: 8 });
      await runMain({ maxLength: 30, maxDuration: 8 });

      const first = buildEntriesFromWords(wordChunks, { maxLength: 20, maxDuration: 8 });
      const second = buildEntriesFromWords(wordChunks, { maxLength: 30, maxDuration: 8 });
      expect(first).not.toEqual(second);
      expect(translatedSource(0)).toEqual(first);
      expect(translatedSource(1)).toEqual(second);
      expect(transcribeAudioSegments).not.toHaveBeenCalled();
    });

    it("does not split an entry that exceeds the default duration after extension", async () => {
      await runMain();

      const source = translatedSource();
      expect(source).toEqual(buildEntriesFromWords(wordChunks, {}));
      expect(source[0]?.endTime).toBe("00:00:07,500");
    });

    it("removes only the limits with noReflow", async () => {
      await runMain({ noReflow: true });

      const source = translatedSource();
      expect(source).toEqual(buildEntriesFromWords(wordChunks, { noLimits: true }));
      expect(source).toHaveLength(2);
    });

    it.each([
      {
        name: "processMediaPipeline",
        run: () => runMain(),
      },
      {
        name: "processChaptersPipeline",
        run: () => processChaptersPipeline({ inputFile: mediaFile, cacheDir, stdout: true }),
      },
    ])("saves wordChunks to the cache after transcribing ($name)", async ({ run }) => {
      const entries = buildEntriesFromWords(wordChunks);
      vi.mocked(transcribeAudioSegments).mockResolvedValueOnce({
        entries,
        detectedLanguage: "en",
        wordChunks,
      });
      fs.rmSync(cacheDir, { recursive: true, force: true });

      await run();

      expect(transcribeAudioSegments).toHaveBeenCalledTimes(1);
      const cached = loadMediaCache(mediaFile, cacheDir)?.transcription;
      expect(cached?.wordChunks).toEqual(wordChunks);
      expect(cached?.entries).toEqual(entries);
    });
  });

  describe("STT provider selection and caching in processMediaPipeline", () => {
    let mediaFile: string;
    let cacheDir: string;

    function mockSpinner() {
      const spinnerInfoSpy = vi.fn();
      vi.spyOn(ui, "createSpinner").mockReturnValue({
        start: vi.fn().mockReturnThis(),
        succeed: vi.fn().mockReturnThis(),
        fail: vi.fn().mockReturnThis(),
        warn: vi.fn().mockReturnThis(),
        info: spinnerInfoSpy,
        updateText: vi.fn().mockReturnThis(),
        stop: vi.fn().mockReturnThis(),
      });
      return { spinnerInfoSpy };
    }

    beforeEach(() => {
      mediaFile = path.join(tempDir, "test_stt_video.mp4");
      fs.writeFileSync(mediaFile, "dummy video content for stt test");
      cacheDir = path.join(tempDir, "cache");
      vi.clearAllMocks();
    });

    it("existing user with Groq, Gemini and generic OPENROUTER_API_KEY uses Groq and shows hint", async () => {
      process.env["OPENROUTER_API_KEY"] = "generic-openrouter-key";
      const { spinnerInfoSpy } = mockSpinner();

      const result = await processMediaPipeline({
        mediaFile,
        cacheDir,
        whisperPrompt: "my-hint",
      });

      expect(result.sttProvider).toBe("groq");
      expect(result.sttModel).toBe(DEFAULT_GROQ_MODEL);
      expect(transcribeAudioSegments).toHaveBeenCalledTimes(1);
      const transcriber = vi.mocked(transcribeAudioSegments).mock.calls[0]?.[1];
      const callOptions = vi.mocked(transcribeAudioSegments).mock.calls[0]?.[4];
      expect(transcriber?.logLabel).toBe("Groq API");
      expect(callOptions?.model).toBe(DEFAULT_GROQ_MODEL);
      expect(callOptions?.prompt).toBe("my-hint");
      expect(spinnerInfoSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "Transcribing with Groq because VSUB_OPENROUTER_API_KEY is not set",
        ),
      );
    });

    it("does not show OpenRouter recommendation tip when VSUB_STT_PROVIDER=groq is set", async () => {
      process.env["VSUB_STT_PROVIDER"] = "groq";
      const { spinnerInfoSpy } = mockSpinner();

      await processMediaPipeline({
        mediaFile,
        cacheDir,
      });

      expect(spinnerInfoSpy).not.toHaveBeenCalledWith(
        expect.stringContaining(
          "Transcribing with Groq because VSUB_OPENROUTER_API_KEY is not set",
        ),
      );
    });

    it("hits legacy cache without provider and does not re-transcribe", async () => {
      saveTranscriptionCache(
        mediaFile,
        {
          detectedLanguage: "en",
          entries: [
            { id: 1, startTime: "00:00:00,000", endTime: "00:00:01,000", text: "Legacy cache" },
          ],
          createdAt: Date.now(),
          model: DEFAULT_GROQ_MODEL,
        },
        cacheDir,
      );

      await processMediaPipeline({
        mediaFile,
        cacheDir,
      });

      expect(transcribeAudioSegments).not.toHaveBeenCalled();
    });

    it("uses OpenRouter when VSUB_OPENROUTER_API_KEY is present, ignores whisperPrompt, and caches provider", async () => {
      process.env["VSUB_OPENROUTER_API_KEY"] = "vsub-openrouter-key";
      const { spinnerInfoSpy } = mockSpinner();

      const result = await processMediaPipeline({
        mediaFile,
        cacheDir,
        whisperPrompt: "ignored-for-openrouter",
      });

      expect(result.sttProvider).toBe("openrouter");
      expect(result.sttModel).toBe(DEFAULT_OPENROUTER_STT_MODEL);
      expect(transcribeAudioSegments).toHaveBeenCalledTimes(1);
      const transcriber = vi.mocked(transcribeAudioSegments).mock.calls[0]?.[1];
      const callOptions = vi.mocked(transcribeAudioSegments).mock.calls[0]?.[4];
      expect(transcriber?.logLabel).toBe("OpenRouter API");
      expect(callOptions?.model).toBe(DEFAULT_OPENROUTER_STT_MODEL);
      expect(callOptions?.prompt).toBeUndefined();
      expect(spinnerInfoSpy).not.toHaveBeenCalledWith(
        expect.stringContaining("Transcribing with Groq because"),
      );

      const cached = loadMediaCache(mediaFile, cacheDir)?.transcription;
      expect(cached?.provider).toBe("openrouter");

      await processMediaPipeline({
        mediaFile,
        cacheDir,
        whisperPrompt: "ignored-for-openrouter",
        overwrite: true,
      });
      expect(transcribeAudioSegments).toHaveBeenCalledTimes(1);
    });

    it("uses generic OPENROUTER_API_KEY when sttProvider: openrouter is explicitly passed", async () => {
      delete process.env["VSUB_OPENROUTER_API_KEY"];
      delete process.env["VSUB_GROQ_API_KEY"];
      process.env["OPENROUTER_API_KEY"] = "generic-openrouter-key";

      const result = await processMediaPipeline({
        mediaFile,
        cacheDir,
        sttProvider: "openrouter",
      });

      expect(result.sttProvider).toBe("openrouter");
      expect(transcribeAudioSegments).toHaveBeenCalledTimes(1);
    });

    it("throws error for missing VSUB_OPENROUTER_API_KEY when only generic key exists and no explicit provider", async () => {
      delete process.env["VSUB_OPENROUTER_API_KEY"];
      delete process.env["VSUB_GROQ_API_KEY"];
      process.env["OPENROUTER_API_KEY"] = "generic-openrouter-key";

      await expect(
        processMediaPipeline({
          mediaFile,
          cacheDir,
        }),
      ).rejects.toThrow(/VSUB_OPENROUTER_API_KEY/);
    });

    it("respects sttModel override for chosen provider", async () => {
      process.env["VSUB_OPENROUTER_API_KEY"] = "vsub-openrouter-key";
      const result = await processMediaPipeline({
        mediaFile,
        cacheDir,
        sttModel: "custom-openrouter-model",
      });

      expect(result.sttModel).toBe("custom-openrouter-model");
      const callOptions = vi.mocked(transcribeAudioSegments).mock.calls[0]?.[4];
      expect(callOptions?.model).toBe("custom-openrouter-model");
    });

    it("throws before checking writable targets when sttProvider is invalid", async () => {
      const ensureTargetsSpy = vi.spyOn(safetyModule, "ensureWritableTargets");
      await expect(
        processMediaPipeline({
          mediaFile,
          cacheDir,
          sttProvider: "foo",
        }),
      ).rejects.toThrow(/Unsupported transcription provider: "foo"/);
      expect(ensureTargetsSpy).not.toHaveBeenCalled();
    });

    it("resolveTranscriptEntries uses OpenRouter when sttProvider is openrouter and caches provider", async () => {
      process.env["VSUB_OPENROUTER_API_KEY"] = "vsub-openrouter-key";
      const result = await resolveTranscriptEntries({
        filePath: mediaFile,
        cacheDir,
        sttProvider: "openrouter",
      });

      expect(result.fromCache).toBe(false);
      const cached = loadMediaCache(mediaFile, cacheDir)?.transcription;
      expect(cached?.provider).toBe("openrouter");
    });
  });

  describe("LLM provider selection, caching, and key reuse in pipeline", () => {
    let mediaFile: string;
    let cacheDir: string;

    function mockSpinner() {
      const spinnerInfoSpy = vi.fn();
      const spinnerStartSpy = vi.fn();
      const spinnerUpdateSpy = vi.fn();
      const spinnerSucceedSpy = vi.fn().mockReturnThis();
      vi.spyOn(ui, "createSpinner").mockReturnValue({
        start: spinnerStartSpy.mockReturnThis(),
        succeed: spinnerSucceedSpy,
        fail: vi.fn().mockReturnThis(),
        warn: vi.fn().mockReturnThis(),
        info: spinnerInfoSpy,
        updateText: spinnerUpdateSpy.mockReturnThis(),
        stop: vi.fn().mockReturnThis(),
      });
      return { spinnerInfoSpy, spinnerStartSpy, spinnerUpdateSpy, spinnerSucceedSpy };
    }

    beforeEach(() => {
      mediaFile = path.join(tempDir, "test_llm_video.mp4");
      fs.writeFileSync(mediaFile, "dummy video content for llm test");
      cacheDir = path.join(tempDir, "cache");
      vi.clearAllMocks();
    });

    it.each([
      {
        lang: "en",
        targetLang: "en",
        noTranslate: false,
        expected: "🌐 [3/4] Skipped translation",
      },
      { lang: "en", targetLang: "ja", noTranslate: true, expected: "🌐 [3/4] [--no-translate] JA" },
      {
        lang: "ja",
        targetLang: "ja",
        noTranslate: true,
        expected: "🌐 [3/4] [--no-translate] 翻訳をスキップ: JA",
      },
    ] as const)(
      "emits one translation step marker when skipping $targetLang ($noTranslate, $lang)",
      async ({ lang, targetLang, noTranslate, expected }) => {
        const { spinnerInfoSpy } = mockSpinner();
        await processMediaPipeline({ mediaFile, cacheDir, targetLang, noTranslate, lang });
        const message = spinnerInfoSpy.mock.calls.find(([text]) =>
          String(text).includes("[3/4]"),
        )?.[0] as string;
        expect(message).toContain(expected);
        expect(message).not.toContain("ℹ️");
        expect(message.match(/\[3\/4\]/g)).toHaveLength(1);
      },
    );

    it("existing user with Groq and Gemini keys uses Gemini for translation, checks keys correctly, matches UI wording, and hits legacy cache", async () => {
      delete process.env["VSUB_OPENROUTER_API_KEY"];
      delete process.env["OPENROUTER_API_KEY"];
      delete process.env["VSUB_LLM_PROVIDER"];
      delete process.env["VSUB_STT_PROVIDER"];
      process.env["VSUB_GROQ_API_KEY"] = "test-groq-key";
      process.env["VSUB_GEMINI_API_KEY"] = "test-gemini-key";

      const ensureApiKeysSpy = vi.spyOn(configModule, "ensureApiKeys");
      const createTextModelSpy = vi.spyOn(selectModule, "createTextModel");
      const { spinnerStartSpy, spinnerSucceedSpy } = mockSpinner();

      const result = await processMediaPipeline({
        mediaFile,
        cacheDir,
        targetLang: "ja",
      });

      expect(result.llmProvider).toBe("gemini");
      expect(result.llmModel).toBe(DEFAULT_GEMINI_MODEL);
      expect(spinnerSucceedSpy).toHaveBeenCalledWith(
        "🌐 [3/4] Gemini translation complete (JA) - 1 lines",
      );

      // Verify ensureApiKeys calls:
      // Call 0: STT (groq) -> requireGroq: true, requireOpenRouter: false, requireGemini: false
      // Call 1: LLM (gemini) -> requireGroq: false, requireGemini: true, requireOpenRouter: false
      expect(ensureApiKeysSpy).toHaveBeenCalledTimes(2);
      expect(ensureApiKeysSpy.mock.calls[1]?.[1]).toEqual(
        expect.objectContaining({
          requireGemini: true,
          requireOpenRouter: false,
          requireGroq: false,
        }),
      );

      // Verify createTextModel was called for Gemini
      expect(createTextModelSpy).toHaveBeenCalledTimes(1);
      expect(createTextModelSpy.mock.calls[0]?.[1]).toEqual(
        expect.objectContaining({
          provider: "gemini",
          model: DEFAULT_GEMINI_MODEL,
        }),
      );

      // Verify spinner wording contains Gemini (gemini-3.8-flash)
      expect(spinnerStartSpy).toHaveBeenCalledWith(
        expect.stringContaining("Gemini (gemini-3.8-flash)"),
      );

      // Verify summary table wording contains Gemini (gemini-3.8-flash)
      const summaryBox = ui.formatSummaryBox(result, "en");
      expect(summaryBox).toContain("Gemini");
      expect(summaryBox).toContain(DEFAULT_GEMINI_MODEL);

      // Verify legacy cache hit without provider
      createTextModelSpy.mockClear();
      ensureApiKeysSpy.mockClear();
      spinnerSucceedSpy.mockClear();

      fs.rmSync(cacheDir, { recursive: true, force: true });
      const cachedEntries = [
        { id: 1, startTime: "00:00:00,000", endTime: "00:00:02,000", text: "Hello mock groq" },
      ];
      saveTranscriptionCache(
        mediaFile,
        {
          detectedLanguage: "en",
          entries: cachedEntries,
          createdAt: Date.now(),
          model: DEFAULT_GROQ_MODEL,
        },
        cacheDir,
      );
      saveTranslationCache(
        mediaFile,
        "ja",
        createCachedTranslation(
          "ja",
          {
            sourceEntries: cachedEntries,
            model: DEFAULT_GEMINI_MODEL,
            contextWindowSize: DEFAULT_CONTEXT_WINDOW_SIZE,
          },
          [{ id: 1, startTime: "00:00:00,000", endTime: "00:00:02,000", text: "こんにちは" }],
        ),
        cacheDir,
      );

      const cachedResult = await processMediaPipeline({
        mediaFile,
        cacheDir,
        targetLang: "ja",
        overwrite: true,
      });

      expect(cachedResult.cacheStatus?.cachedLanguages).toContain("ja");
      expect(createTextModelSpy).not.toHaveBeenCalled();
      expect(spinnerSucceedSpy).toHaveBeenCalledWith(
        "🌐 [3/4] Gemini translation complete (JA) - 1 lines [⚡ Cached]",
      );

      spinnerSucceedSpy.mockClear();
      await processMediaPipeline({ mediaFile, cacheDir, targetLang: "ja,fr", overwrite: true });
      expect(spinnerSucceedSpy).toHaveBeenCalledWith(
        "🌐 [3/4] Gemini translation complete (JA, FR) - 1 lines",
      );
    });

    it("uses OpenRouter for translation, chapters, and summary when only OpenRouter key is set, and records provider in cache", async () => {
      delete process.env["VSUB_GROQ_API_KEY"];
      delete process.env["VSUB_GEMINI_API_KEY"];
      delete process.env["VSUB_LLM_PROVIDER"];
      delete process.env["VSUB_STT_PROVIDER"];
      process.env["VSUB_OPENROUTER_API_KEY"] = "test-openrouter-key";

      const createTextModelSpy = vi.spyOn(selectModule, "createTextModel");

      // 1. Translation in processMediaPipeline
      const mediaResult = await processMediaPipeline({
        mediaFile,
        cacheDir,
        targetLang: "ja",
      });

      expect(mediaResult.llmProvider).toBe("openrouter");
      expect(mediaResult.llmModel).toBe(DEFAULT_OPENROUTER_LLM_MODEL);
      expect(createTextModelSpy).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          provider: "openrouter",
          model: DEFAULT_OPENROUTER_LLM_MODEL,
        }),
        expect.anything(),
      );

      const cachedTranslation = loadMediaCache(mediaFile, cacheDir)?.translations?.["ja"];
      expect(cachedTranslation?.provider).toBe("openrouter");
      expect(cachedTranslation?.model).toBe(DEFAULT_OPENROUTER_LLM_MODEL);

      // 2. Chapters in processChaptersPipeline
      createTextModelSpy.mockClear();
      await processChaptersPipeline({
        inputFile: mediaFile,
        cacheDir,
        targetLang: "ja",
        stdout: true,
      });

      expect(createTextModelSpy).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          provider: "openrouter",
          model: DEFAULT_OPENROUTER_LLM_MODEL,
        }),
        expect.anything(),
      );
      const cachedChapters = loadMediaCache(mediaFile, cacheDir)?.chapters?.["ja"];
      expect(cachedChapters?.provider).toBe("openrouter");
      expect(cachedChapters?.model).toBe(DEFAULT_OPENROUTER_LLM_MODEL);

      // 3. Summary in processSummaryPipeline
      createTextModelSpy.mockClear();
      await processSummaryPipeline({
        inputFile: mediaFile,
        cacheDir,
        targetLang: "ja",
        stdout: true,
      });

      expect(createTextModelSpy).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          provider: "openrouter",
          model: DEFAULT_OPENROUTER_LLM_MODEL,
        }),
        expect.anything(),
      );
      const cachedSummary = loadMediaCache(mediaFile, cacheDir)?.summaries?.["ja"];
      expect(cachedSummary?.provider).toBe("openrouter");
      expect(cachedSummary?.model).toBe(DEFAULT_OPENROUTER_LLM_MODEL);
    });

    it("reuses API key resolved in step 1 for step 3 ensureApiKeys", async () => {
      delete process.env["VSUB_GROQ_API_KEY"];
      delete process.env["VSUB_GEMINI_API_KEY"];
      delete process.env["VSUB_OPENROUTER_API_KEY"];
      delete process.env["OPENROUTER_API_KEY"];

      const ensureApiKeysSpy = vi.spyOn(configModule, "ensureApiKeys");
      // Step 1 mock: user entered openrouter key interactively
      ensureApiKeysSpy.mockImplementationOnce(async (cfg) => ({
        ...cfg,
        openrouterApiKey: "user-entered-openrouter-key",
      }));
      // Step 3 mock: should receive the config with openrouterApiKey already set
      ensureApiKeysSpy.mockImplementationOnce(async (cfg) => ({
        ...cfg,
      }));

      await processMediaPipeline({
        mediaFile,
        cacheDir,
        sttProvider: "openrouter",
        llmProvider: "openrouter",
        targetLang: "ja",
      });

      expect(ensureApiKeysSpy).toHaveBeenCalledTimes(2);
      // Verify step 1 call
      expect(ensureApiKeysSpy.mock.calls[0]?.[1]).toEqual(
        expect.objectContaining({
          requireOpenRouter: true,
          requireGroq: false,
          requireGemini: false,
        }),
      );
      // Verify step 3 received the config returned by step 1
      const step3Config = ensureApiKeysSpy.mock.calls[1]?.[0];
      expect(step3Config?.openrouterApiKey).toBe("user-entered-openrouter-key");
      expect(ensureApiKeysSpy.mock.calls[1]?.[1]).toEqual(
        expect.objectContaining({
          requireOpenRouter: true,
          requireGemini: false,
        }),
      );
    });

    it.each([
      {
        task: "chapters",
        run: (opts: { llmProvider: "openrouter" | "gemini" }) =>
          processChaptersPipeline({
            inputFile: mediaFile,
            cacheDir,
            targetLang: "ja",
            sttProvider: "groq",
            llmProvider: opts.llmProvider,
            llmModel: DEFAULT_GEMINI_MODEL,
            stdout: true,
          }),
        setupLegacyCache: () => {
          saveChaptersCache(
            mediaFile,
            "ja",
            createCachedChapters(
              "ja",
              {
                sourceEntries: [
                  {
                    id: 1,
                    startTime: "00:00:00,000",
                    endTime: "00:00:02,000",
                    text: "Hello mock groq",
                  },
                ],
                model: DEFAULT_GEMINI_MODEL,
              },
              [{ timestamp: "00:00", seconds: 0, title: "Intro" }],
            ),
            cacheDir,
          );
        },
      },
      {
        task: "summary",
        run: (opts: { llmProvider: "openrouter" | "gemini" }) =>
          processSummaryPipeline({
            inputFile: mediaFile,
            cacheDir,
            targetLang: "ja",
            sttProvider: "groq",
            llmProvider: opts.llmProvider,
            llmModel: DEFAULT_GEMINI_MODEL,
            stdout: true,
          }),
        setupLegacyCache: () => {
          saveSummaryCache(
            mediaFile,
            "ja",
            createCachedSummary(
              "ja",
              {
                sourceEntries: [
                  {
                    id: 1,
                    startTime: "00:00:00,000",
                    endTime: "00:00:02,000",
                    text: "Hello mock groq",
                  },
                ],
                model: DEFAULT_GEMINI_MODEL,
              },
              {
                title: "Cached Title",
                summary: "Cached Summary",
                keyPoints: ["Point"],
                topics: [],
              },
            ),
            cacheDir,
          );
        },
      },
    ])(
      "does not reuse legacy gemini cache when provider is openrouter for $task, but reuses it for gemini",
      async ({ run, setupLegacyCache }) => {
        process.env["VSUB_GROQ_API_KEY"] = "test-groq-key";
        process.env["VSUB_GEMINI_API_KEY"] = "test-gemini-key";
        process.env["VSUB_OPENROUTER_API_KEY"] = "test-openrouter-key";
        const createTextModelSpy = vi.spyOn(selectModule, "createTextModel");

        saveTranscriptionCache(
          mediaFile,
          {
            detectedLanguage: "en",
            entries: [
              {
                id: 1,
                startTime: "00:00:00,000",
                endTime: "00:00:02,000",
                text: "Hello mock groq",
              },
            ],
            createdAt: Date.now(),
            model: DEFAULT_GROQ_MODEL,
            provider: "groq",
          },
          cacheDir,
        );

        // 1. With OpenRouter: legacy gemini cache should NOT be valid, so createTextModel is called
        setupLegacyCache();
        createTextModelSpy.mockClear();

        await run({ llmProvider: "openrouter" });
        expect(createTextModelSpy).toHaveBeenCalledTimes(1);

        // 2. With Gemini: legacy gemini cache SHOULD be valid, so createTextModel is NOT called
        setupLegacyCache();
        createTextModelSpy.mockClear();

        await run({ llmProvider: "gemini" });
        expect(createTextModelSpy).not.toHaveBeenCalled();
      },
    );

    it.each([
      {
        task: "chapters",
        provider: "gemini",
        expected: { requireGemini: true, requireOpenRouter: false, requireGroq: false },
        run: (inputFile: string) =>
          processChaptersPipeline({
            inputFile,
            cacheDir,
            llmProvider: "gemini",
            stdout: true,
          }),
      },
      {
        task: "chapters",
        provider: "openrouter",
        expected: { requireGemini: false, requireOpenRouter: true, requireGroq: false },
        run: (inputFile: string) =>
          processChaptersPipeline({
            inputFile,
            cacheDir,
            llmProvider: "openrouter",
            stdout: true,
          }),
      },
      {
        task: "summary",
        provider: "gemini",
        expected: { requireGemini: true, requireOpenRouter: false, requireGroq: false },
        run: (inputFile: string) =>
          processSummaryPipeline({
            inputFile,
            cacheDir,
            llmProvider: "gemini",
            stdout: true,
          }),
      },
      {
        task: "summary",
        provider: "openrouter",
        expected: { requireGemini: false, requireOpenRouter: true, requireGroq: false },
        run: (inputFile: string) =>
          processSummaryPipeline({
            inputFile,
            cacheDir,
            llmProvider: "openrouter",
            stdout: true,
          }),
      },
    ])("requires correct API keys for $task with $provider", async ({ run, expected }) => {
      const srtFile = path.join(tempDir, "input_for_keys.srt");
      fs.writeFileSync(srtFile, "1\n00:00:00,000 --> 00:00:01,000\nHello\n");
      process.env["VSUB_GEMINI_API_KEY"] = "test-gemini-key";
      process.env["VSUB_OPENROUTER_API_KEY"] = "test-openrouter-key";
      const ensureApiKeysSpy = vi.spyOn(configModule, "ensureApiKeys");

      await run(srtFile);

      expect(ensureApiKeysSpy).toHaveBeenCalledTimes(1);
      expect(ensureApiKeysSpy).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining(expected),
      );
    });
  });

  describe("processMediaPipeline --refine", () => {
    let mediaFile: string;
    let cacheDir: string;

    const rawEntries: SrtEntry[] = [
      { id: 1, startTime: "00:00:00,000", endTime: "00:00:02,000", text: "Hello wrld" },
      { id: 2, startTime: "00:00:02,000", endTime: "00:00:04,000", text: "Second line" },
    ];
    const refinedEntries: SrtEntry[] = [
      { id: 1, startTime: "00:00:00,000", endTime: "00:00:02,000", text: "Hello world" },
      { id: 2, startTime: "00:00:02,000", endTime: "00:00:04,000", text: "Second line" },
    ];

    function seedTranscriptionCache(entries: SrtEntry[] = rawEntries, wordChunks?: WordChunk[]) {
      saveTranscriptionCache(
        mediaFile,
        {
          detectedLanguage: "en",
          entries,
          ...(wordChunks ? { wordChunks } : {}),
          createdAt: Date.now(),
          model: DEFAULT_GROQ_MODEL,
        },
        cacheDir,
      );
    }

    function mockSpinner() {
      const warnSpy = vi.fn();
      const succeedSpy = vi.fn();
      vi.spyOn(ui, "createSpinner").mockReturnValue({
        start: vi.fn().mockReturnThis(),
        succeed: succeedSpy.mockReturnThis(),
        fail: vi.fn().mockReturnThis(),
        warn: warnSpy.mockReturnThis(),
        info: vi.fn().mockReturnThis(),
        updateText: vi.fn().mockReturnThis(),
        stop: vi.fn().mockReturnThis(),
      });
      return { warnSpy, succeedSpy };
    }

    function readRawCacheJson(): Record<string, unknown> {
      const files = fs.readdirSync(cacheDir).filter((f) => f.endsWith(".json"));
      const firstFile = files[0];
      if (!firstFile) {
        throw new Error("Expected cache JSON file to exist");
      }
      return JSON.parse(fs.readFileSync(path.join(cacheDir, firstFile), "utf-8")) as Record<
        string,
        unknown
      >;
    }

    beforeEach(() => {
      vi.clearAllMocks();
      mediaFile = path.join(tempDir, "refine_video.mp4");
      fs.writeFileSync(mediaFile, "dummy video content for refine");
      cacheDir = path.join(tempDir, "cache-refine");
      vi.spyOn(console, "log").mockImplementation(() => {});
      vi.spyOn(process.stdout, "write").mockReturnValue(true);
    });

    it.each([
      { saved: true, env: undefined, cli: undefined, enabled: true },
      { saved: false, env: "true", cli: undefined, enabled: true },
      { saved: true, env: "true", cli: false, enabled: false },
    ])(
      "resolves scene notes after refinement ($saved, $env, $cli)",
      async ({ saved, env, cli, enabled }) => {
        saveGlobalConfig({ autoContext: saved });
        if (env !== undefined) process.env["VSUB_AUTO_CONTEXT"] = env;
        seedTranscriptionCache();
        vi.mocked(refineSrtEntries).mockResolvedValueOnce({
          entries: refinedEntries,
          fallbackChunks: 0,
          totalChunks: 1,
        });
        await processMediaPipeline({
          mediaFile,
          cacheDir,
          targetLang: "ja",
          stdout: true,
          refine: true,
          autoContext: cli,
        });
        expect(generateSceneNotes).toHaveBeenCalledTimes(enabled ? 1 : 0);
        expect(vi.mocked(refineSrtEntries).mock.calls[0]?.[4]?.contextNotes).toBeUndefined();
        if (enabled)
          expect(vi.mocked(generateSceneNotes).mock.calls[0]?.[0]).toEqual(refinedEntries);
        expect(vi.mocked(translateSrtEntries).mock.calls[0]?.[5]?.contextNotes).toBe(
          enabled ? "Scene notes" : undefined,
        );
      },
    );

    it.each([
      { saved: true, env: undefined, refine: undefined, expected: 1 },
      { saved: false, env: "1", refine: undefined, expected: 1 },
      { saved: true, env: undefined, refine: false, expected: 0 },
      { saved: true, env: "1", refine: false, expected: 0 },
      { saved: true, env: "false", refine: true, expected: 1 },
    ])(
      "resolves refinement from saved $saved, env $env, CLI $refine",
      async ({ saved, env, refine, expected }) => {
        saveGlobalConfig({ refine: saved });
        if (env !== undefined) process.env["VSUB_REFINE"] = env;
        seedTranscriptionCache();
        await processMediaPipeline({
          mediaFile,
          cacheDir,
          noTranslate: true,
          stdout: true,
          refine,
        });
        expect(refineSrtEntries).toHaveBeenCalledTimes(expected);
      },
    );

    it("keeps default behavior unchanged when --refine is omitted", async () => {
      seedTranscriptionCache();
      saveTranslationCache(
        mediaFile,
        "ja",
        createCachedTranslation(
          "ja",
          {
            sourceEntries: rawEntries,
            model: DEFAULT_GEMINI_MODEL,
            contextWindowSize: DEFAULT_CONTEXT_WINDOW_SIZE,
          },
          [
            { id: 1, startTime: "00:00:00,000", endTime: "00:00:02,000", text: "既存訳1" },
            { id: 2, startTime: "00:00:02,000", endTime: "00:00:04,000", text: "既存訳2" },
          ],
        ),
        cacheDir,
      );

      const ensureApiKeysSpy = vi.spyOn(configModule, "ensureApiKeys");
      const createTextModelSpy = vi.spyOn(selectModule, "createTextModel");

      const cachedResult = await processMediaPipeline({
        mediaFile,
        cacheDir,
        targetLang: "ja",
        stdout: true,
      });

      expect(refineSrtEntries).not.toHaveBeenCalled();
      expect(translateSrtEntries).not.toHaveBeenCalled();
      expect(ensureApiKeysSpy).not.toHaveBeenCalled();
      expect(createTextModelSpy).not.toHaveBeenCalled();
      expect(cachedResult.refinement).toBeUndefined();
      expect(cachedResult.stdoutContent).toContain("既存訳1");
      expect(Object.hasOwn(readRawCacheJson(), "refinement")).toBe(false);

      // Without cached translation and with --no-translate, LLM ensureApiKeys is not called
      await processMediaPipeline({
        mediaFile,
        cacheDir,
        noTranslate: true,
        stdout: true,
      });
      expect(ensureApiKeysSpy).not.toHaveBeenCalled();
      expect(refineSrtEntries).not.toHaveBeenCalled();

      // Without cached translation for "fr", unrefined rawEntries are passed to translateSrtEntries
      const translatedResult = await processMediaPipeline({
        mediaFile,
        cacheDir,
        targetLang: "fr",
        stdout: true,
      });
      expect(refineSrtEntries).not.toHaveBeenCalled();
      expect(vi.mocked(translateSrtEntries).mock.calls[0]?.[0]).toEqual(rawEntries);
      expect(translatedResult.refinement).toBeUndefined();
      expect(Object.hasOwn(readRawCacheJson(), "refinement")).toBe(false);
    });

    it("supports OpenRouter --llm-provider and --llm-model with --refine and invalidates on model/provider change", async () => {
      process.env["VSUB_OPENROUTER_API_KEY"] = "test-openrouter-key";
      seedTranscriptionCache();
      vi.mocked(refineSrtEntries)
        .mockResolvedValueOnce({
          entries: refinedEntries,
          fallbackChunks: 0,
          totalChunks: 1,
        })
        .mockResolvedValueOnce({
          entries: refinedEntries,
          fallbackChunks: 0,
          totalChunks: 1,
        });

      const ensureApiKeysSpy = vi.spyOn(configModule, "ensureApiKeys");
      const createTextModelSpy = vi.spyOn(selectModule, "createTextModel");

      await processMediaPipeline({
        mediaFile,
        cacheDir,
        noTranslate: true,
        refine: true,
        sttProvider: "groq",
        llmProvider: "openrouter",
        llmModel: "openai/gpt-4o-mini",
        stdout: true,
      });

      expect(ensureApiKeysSpy).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          requireGemini: false,
          requireOpenRouter: true,
          requireGroq: false,
        }),
      );
      expect(createTextModelSpy).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ provider: "openrouter", model: "openai/gpt-4o-mini" }),
        expect.anything(),
      );
      expect(refineSrtEntries).toHaveBeenCalledTimes(1);

      // Switching model misses cache and runs refine again
      await processMediaPipeline({
        mediaFile,
        cacheDir,
        noTranslate: true,
        refine: true,
        sttProvider: "groq",
        llmProvider: "openrouter",
        llmModel: "google/gemini-3.8-flash",
        stdout: true,
      });
      expect(refineSrtEntries).toHaveBeenCalledTimes(2);
    });

    it("refines entries before --save-original, translation, and --bilingual and checks LLM key only once", async () => {
      seedTranscriptionCache();
      vi.mocked(refineSrtEntries).mockResolvedValueOnce({
        entries: refinedEntries,
        fallbackChunks: 0,
        totalChunks: 1,
      });
      vi.mocked(translateSrtEntries).mockResolvedValueOnce([
        { id: 1, startTime: "00:00:00,000", endTime: "00:00:02,000", text: "こんにちは世界" },
        { id: 2, startTime: "00:00:02,000", endTime: "00:00:04,000", text: "2行目" },
      ]);

      const ensureApiKeysSpy = vi.spyOn(configModule, "ensureApiKeys");
      const createTextModelSpy = vi.spyOn(selectModule, "createTextModel");

      const result = await processMediaPipeline({
        mediaFile,
        cacheDir,
        targetLang: "ja",
        refine: true,
        saveOriginal: true,
        bilingual: true,
        overwrite: true,
      });

      expect(ensureApiKeysSpy).toHaveBeenCalledTimes(1);
      expect(createTextModelSpy).toHaveBeenCalledTimes(1);
      expect(refineSrtEntries).toHaveBeenCalledTimes(1);
      expect(vi.mocked(translateSrtEntries).mock.calls[0]?.[0]).toEqual(refinedEntries);
      expect(result.refinement).toEqual({
        changedLines: 1,
        totalLines: 2,
        cached: false,
        fallbackChunks: 0,
      });

      const originalPath = path.join(tempDir, "refine_video.en.srt");
      expect(fs.readFileSync(originalPath, "utf-8")).toContain("Hello world");
      expect(fs.readFileSync(originalPath, "utf-8")).not.toContain("Hello wrld");

      const bilingualPath = path.join(tempDir, "refine_video.ja.bilingual.srt");
      const bilingualContent = fs.readFileSync(bilingualPath, "utf-8");
      expect(bilingualContent).toContain("Hello world");
      expect(bilingualContent).toContain("こんにちは世界");
      expect(bilingualContent).not.toContain("Hello wrld");
    });

    it("outputs refined text and checks LLM key lazily under --no-translate --refine", async () => {
      seedTranscriptionCache();
      vi.mocked(refineSrtEntries).mockResolvedValueOnce({
        entries: refinedEntries,
        fallbackChunks: 0,
        totalChunks: 1,
      });

      const ensureApiKeysSpy = vi.spyOn(configModule, "ensureApiKeys");
      const createTextModelSpy = vi.spyOn(selectModule, "createTextModel");

      const first = await processMediaPipeline({
        mediaFile,
        cacheDir,
        noTranslate: true,
        refine: true,
        stdout: true,
      });

      expect(ensureApiKeysSpy).toHaveBeenCalledTimes(1);
      expect(ensureApiKeysSpy).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          requireGemini: true,
          requireOpenRouter: false,
          requireGroq: false,
        }),
      );
      expect(createTextModelSpy).toHaveBeenCalledTimes(1);
      expect(first.stdoutContent).toContain("Hello world");
      expect(first.refinement).toEqual({
        changedLines: 1,
        totalLines: 2,
        cached: false,
        fallbackChunks: 0,
      });

      // Second run hits refinement cache and skips ensureApiKeys / createTextModel
      ensureApiKeysSpy.mockClear();
      createTextModelSpy.mockClear();

      const second = await processMediaPipeline({
        mediaFile,
        cacheDir,
        noTranslate: true,
        refine: true,
        stdout: true,
      });

      expect(ensureApiKeysSpy).not.toHaveBeenCalled();
      expect(createTextModelSpy).not.toHaveBeenCalled();
      expect(refineSrtEntries).toHaveBeenCalledTimes(1);
      expect(second.stdoutContent).toContain("Hello world");
      expect(second.refinement).toEqual({
        changedLines: 1,
        totalLines: 2,
        cached: true,
        fallbackChunks: 0,
      });

      // Invalidates refinement cache on prompt change while keeping transcription cache hit
      await processMediaPipeline({
        mediaFile,
        cacheDir,
        noTranslate: true,
        refine: true,
        prompt: "Keep casual tone",
        stdout: true,
      });
      expect(transcribeAudioSegments).not.toHaveBeenCalled();
      expect(refineSrtEntries).toHaveBeenCalledTimes(2);
    });

    it("emits a single warning and skips saving refinement cache when fallbackChunks > 0", async () => {
      seedTranscriptionCache();
      const { warnSpy } = mockSpinner();
      vi.mocked(refineSrtEntries).mockResolvedValueOnce({
        entries: rawEntries,
        fallbackChunks: 1,
        totalChunks: 2,
      });

      const result = await processMediaPipeline({
        mediaFile,
        cacheDir,
        noTranslate: true,
        refine: true,
        stdout: true,
      });

      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(result.refinement?.fallbackChunks).toBe(1);
      expect(Object.hasOwn(readRawCacheJson(), "refinement")).toBe(false);
    });

    it("passes entries rebuilt from wordChunks to refineSrtEntries before translation", async () => {
      const wordChunks: WordChunk[] = [
        {
          offsetSeconds: 0,
          words: [
            { start: 0, end: 0.5, text: "Hello" },
            { start: 0.5, end: 1.0, text: "wrld" },
          ],
        },
      ];
      seedTranscriptionCache(
        [{ id: 1, startTime: "00:00:00,000", endTime: "00:00:01,000", text: "stale entry" }],
        wordChunks,
      );
      const assembled = buildEntriesFromWords(wordChunks);
      const refinedFromWords = assembled.map((e) => ({ ...e, text: "Hello world" }));

      vi.mocked(refineSrtEntries).mockResolvedValueOnce({
        entries: refinedFromWords,
        fallbackChunks: 0,
        totalChunks: 1,
      });

      await processMediaPipeline({
        mediaFile,
        cacheDir,
        targetLang: "ja",
        refine: true,
        stdout: true,
      });

      expect(vi.mocked(refineSrtEntries).mock.calls[0]?.[0]).toEqual(assembled);
      expect(vi.mocked(translateSrtEntries).mock.calls[0]?.[0]).toEqual(refinedFromWords);
    });
  });
});
