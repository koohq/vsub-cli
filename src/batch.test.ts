import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { stripVTControlCharacters } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type BatchPipelineOptions, findMediaFiles, runBatchPipeline } from "./batch.js";
import {
  createCachedTranscription,
  saveTranscriptionCache,
  type TranscriptionCacheContext,
} from "./cache.js";
import * as configModule from "./config.js";
import * as ffmpegModule from "./ffmpeg.js";
import * as pipelineModule from "./pipeline.js";
import * as tasksModule from "./text/tasks.js";
import { resolveSttSettings } from "./transcribe/select.js";
import * as transcriberModule from "./transcribe/transcriber.js";
import { getTranslationResumeHint, TranslationStoppedError } from "./translation.js";

describe("batch.ts", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vsub-batch-test-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
    vi.restoreAllMocks();
  });

  describe("findMediaFiles", () => {
    it("should return empty array for non-existent targets", () => {
      const nonExistent = path.join(tempDir, "non_existent.mp4");
      const files = findMediaFiles([nonExistent]);
      expect(files).toEqual([]);
    });

    it("should find direct video and audio files", () => {
      const videoFile = path.join(tempDir, "video1.mp4");
      const audioFile = path.join(tempDir, "audio1.mp3");
      const textFile = path.join(tempDir, "notes.txt");
      const subtitleFile = path.join(tempDir, "sub.srt");

      fs.writeFileSync(videoFile, "dummy video");
      fs.writeFileSync(audioFile, "dummy audio");
      fs.writeFileSync(textFile, "dummy text");
      fs.writeFileSync(subtitleFile, "dummy srt");

      const files = findMediaFiles([videoFile, audioFile, textFile, subtitleFile]);
      expect(files).toEqual([path.resolve(audioFile), path.resolve(videoFile)]);
    });

    it("should scan directory and discover media files recursively by default", () => {
      const subDir = path.join(tempDir, "subdir");
      const ignoredDir = path.join(tempDir, "node_modules");
      fs.mkdirSync(subDir, { recursive: true });
      fs.mkdirSync(ignoredDir, { recursive: true });

      const file1 = path.join(tempDir, "video_root.mp4");
      const file2 = path.join(subDir, "audio_sub.m4a");
      const ignoredFile = path.join(ignoredDir, "ignored.mp4");
      const hiddenFile = path.join(tempDir, ".hidden.mp4");

      fs.writeFileSync(file1, "video");
      fs.writeFileSync(file2, "audio");
      fs.writeFileSync(ignoredFile, "ignored");
      fs.writeFileSync(hiddenFile, "hidden");

      const files = findMediaFiles([tempDir]);
      expect(files).toEqual([path.resolve(file2), path.resolve(file1)]);
    });

    it("should respect recursive: false option", () => {
      const subDir = path.join(tempDir, "subdir");
      fs.mkdirSync(subDir, { recursive: true });

      const rootFile = path.join(tempDir, "video_root.mp4");
      const subFile = path.join(subDir, "audio_sub.mp3");

      fs.writeFileSync(rootFile, "root");
      fs.writeFileSync(subFile, "sub");

      const files = findMediaFiles([tempDir], { recursive: false });
      expect(files).toEqual([path.resolve(rootFile)]);
    });

    it("should match glob pattern in a directory", () => {
      const ep1 = path.join(tempDir, "episode_01.mp4");
      const ep2 = path.join(tempDir, "episode_02.mp4");
      const trailer = path.join(tempDir, "trailer.mp4");

      fs.writeFileSync(ep1, "ep1");
      fs.writeFileSync(ep2, "ep2");
      fs.writeFileSync(trailer, "trailer");

      const globPattern = path.join(tempDir, "episode_*.mp4");
      const files = findMediaFiles([globPattern]);
      expect(files).toEqual([path.resolve(ep1), path.resolve(ep2)]);
    });

    it("should deduplicate and sort files naturally", () => {
      const file1 = path.join(tempDir, "item_2.mp4");
      const file2 = path.join(tempDir, "item_10.mp4");
      const file3 = path.join(tempDir, "item_1.mp4");

      fs.writeFileSync(file1, "1");
      fs.writeFileSync(file2, "2");
      fs.writeFileSync(file3, "3");

      // Pass same files and directory multiple times
      const files = findMediaFiles([file2, tempDir, file1, file3]);
      expect(files).toEqual([path.resolve(file3), path.resolve(file1), path.resolve(file2)]);
    });
  });

  describe("runBatchPipeline", () => {
    describe("OpenAI-compatible preflight", () => {
      function setup() {
        const file = path.join(tempDir, "sample.mp4");
        fs.writeFileSync(file, "test media");
        const config = {
          groqApiKey: "",
          geminiApiKey: "",
          ffmpegPath: "ffmpeg",
          sttProvider: "openai-compatible",
          llmProvider: "openai-compatible",
          openaiCompatibleSttModel: "test-stt",
          openaiCompatibleLlmModel: "test-llm",
          openaiCompatibleSttBaseUrl: "http://localhost:8000/v1",
          openaiCompatibleLlmBaseUrl: "http://localhost:11434/v1",
        };
        vi.spyOn(configModule, "getConfig").mockReturnValue(config);
        const ensure = vi
          .spyOn(configModule, "ensureApiKeys")
          .mockImplementation(async (cfg) => cfg);
        vi.spyOn(ffmpegModule, "checkFfmpeg").mockResolvedValue();
        const process = vi.spyOn(pipelineModule, "processMediaPipeline").mockResolvedValue({
          mediaFile: file,
          mediaType: "video",
          durationMs: 0,
          targetLanguages: [],
          entriesCount: 0,
          outputFiles: [],
          sttProvider: "openai-compatible",
          sttModel: "test-stt",
          llmProvider: "openai-compatible",
          llmModel: "test-llm",
        });
        return { file, config, ensure, process };
      }
      it.each(["stt", "llm"] as const)("rejects missing %s URL before any file", async (side) => {
        const { file, config, process } = setup();
        if (side === "stt") config.openaiCompatibleSttBaseUrl = "";
        else config.openaiCompatibleLlmBaseUrl = "";
        await expect(runBatchPipeline({ targets: [file], noCache: true })).rejects.toThrow(
          `VSUB_OPENAI_COMPATIBLE_${side.toUpperCase()}_BASE_URL`,
        );
        expect(process).not.toHaveBeenCalled();
      });
      it("skips unused LLM validation and never requests keys", async () => {
        const { file, config, ensure, process } = setup();
        config.openaiCompatibleLlmBaseUrl = "";
        await runBatchPipeline({ targets: [file], noTranslate: true, noCache: true });
        expect(process).toHaveBeenCalledOnce();
        expect(ensure).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({
            requireGroq: false,
            requireGemini: false,
            requireOpenRouter: false,
          }),
        );
      });
    });

    it("should return empty summary when no media files match", async () => {
      const summary = await runBatchPipeline({
        targets: [path.join(tempDir, "empty_dir")],
      });

      expect(summary.totalFiles).toBe(0);
      expect(summary.succeededCount).toBe(0);
      expect(summary.failedCount).toBe(0);
      expect(summary.items).toEqual([]);
    });

    it("should process multiple media files sequentially and collect results", async () => {
      const file1 = path.join(tempDir, "ep1.mp4");
      const file2 = path.join(tempDir, "ep2.mp4");
      fs.writeFileSync(file1, "video1");
      fs.writeFileSync(file2, "video2");

      vi.spyOn(configModule, "getConfig").mockReturnValue({
        groqApiKey: "gsk-mock",
        geminiApiKey: "gem-mock",
        ffmpegPath: "ffmpeg",
      });
      vi.spyOn(configModule, "ensureApiKeys").mockResolvedValue({
        groqApiKey: "gsk-mock",
        geminiApiKey: "gem-mock",
        ffmpegPath: "ffmpeg",
      });
      vi.spyOn(ffmpegModule, "checkFfmpeg").mockResolvedValue();

      const pipelineSpy = vi
        .spyOn(pipelineModule, "processMediaPipeline")
        .mockImplementation(async (opts) => {
          return {
            mediaFile: path.basename(opts.mediaFile),
            mediaType: "video",
            durationMs: 1500,
            targetLanguages: ["ja"],
            entriesCount: 10,
            outputFiles: [path.join(tempDir, `${path.basename(opts.mediaFile)}.ja.srt`)],
            sttProvider: "groq",
            sttModel: "whisper-large-v3",
            llmProvider: "gemini",
            llmModel: "gemini-3.8-flash",
          };
        });

      const summary = await runBatchPipeline({
        targets: [tempDir],
        targetLang: "ja",
      });

      expect(summary.totalFiles).toBe(2);
      expect(summary.succeededCount).toBe(2);
      expect(summary.failedCount).toBe(0);
      expect(summary.items).toHaveLength(2);
      expect(summary.items[0]?.status).toBe("success");
      expect(summary.items[0]?.file).toBe("ep1.mp4");
      expect(summary.items[1]?.status).toBe("success");
      expect(summary.items[1]?.file).toBe("ep2.mp4");
      expect(pipelineSpy).toHaveBeenCalledTimes(2);
    });

    it("should continue on error and record failure details", async () => {
      const file1 = path.join(tempDir, "ep1.mp4");
      const file2 = path.join(tempDir, "ep2.mp4");
      fs.writeFileSync(file1, "video1");
      fs.writeFileSync(file2, "video2");

      vi.spyOn(configModule, "getConfig").mockReturnValue({
        groqApiKey: "gsk-mock",
        geminiApiKey: "gem-mock",
        ffmpegPath: "ffmpeg",
      });
      vi.spyOn(configModule, "ensureApiKeys").mockResolvedValue({
        groqApiKey: "gsk-mock",
        geminiApiKey: "gem-mock",
        ffmpegPath: "ffmpeg",
      });
      vi.spyOn(ffmpegModule, "checkFfmpeg").mockResolvedValue();

      vi.spyOn(pipelineModule, "processMediaPipeline").mockImplementation(async (opts) => {
        if (opts.mediaFile.includes("ep1")) {
          throw new Error("FFmpeg decode failure on ep1");
        }
        return {
          mediaFile: path.basename(opts.mediaFile),
          mediaType: "video",
          durationMs: 1200,
          targetLanguages: ["ja"],
          entriesCount: 5,
          outputFiles: [path.join(tempDir, "ep2.mp4.ja.srt")],
          sttProvider: "groq",
          sttModel: "whisper-large-v3",
          llmProvider: "gemini",
          llmModel: "gemini-3.8-flash",
        };
      });

      const summary = await runBatchPipeline({
        targets: [tempDir],
        targetLang: "ja",
      });

      expect(summary.totalFiles).toBe(2);
      expect(summary.succeededCount).toBe(1);
      expect(summary.failedCount).toBe(1);
      expect(summary.items[0]?.status).toBe("failed");
      expect(summary.items[0]?.error).toContain("FFmpeg decode failure on ep1");
      expect(summary.items[1]?.status).toBe("success");
    });

    it("should respect failFast: true and skip subsequent files on error", async () => {
      const file1 = path.join(tempDir, "ep1.mp4");
      const file2 = path.join(tempDir, "ep2.mp4");
      const file3 = path.join(tempDir, "ep3.mp4");
      fs.writeFileSync(file1, "video1");
      fs.writeFileSync(file2, "video2");
      fs.writeFileSync(file3, "video3");

      vi.spyOn(configModule, "getConfig").mockReturnValue({
        groqApiKey: "gsk-mock",
        geminiApiKey: "gem-mock",
        ffmpegPath: "ffmpeg",
      });
      vi.spyOn(configModule, "ensureApiKeys").mockResolvedValue({
        groqApiKey: "gsk-mock",
        geminiApiKey: "gem-mock",
        ffmpegPath: "ffmpeg",
      });
      vi.spyOn(ffmpegModule, "checkFfmpeg").mockResolvedValue();

      const pipelineSpy = vi
        .spyOn(pipelineModule, "processMediaPipeline")
        .mockImplementation(async (opts) => {
          if (opts.mediaFile.includes("ep1")) {
            throw new Error("Early failure");
          }
          return {
            mediaFile: path.basename(opts.mediaFile),
            mediaType: "video",
            durationMs: 1000,
            targetLanguages: ["ja"],
            entriesCount: 5,
            outputFiles: [],
            sttProvider: "groq",
            sttModel: "whisper-large-v3",
            llmProvider: "gemini",
            llmModel: "gemini-3.8-flash",
          };
        });

      const summary = await runBatchPipeline({
        targets: [tempDir],
        failFast: true,
      });

      expect(summary.totalFiles).toBe(3);
      expect(summary.succeededCount).toBe(0);
      expect(summary.failedCount).toBe(1);
      expect(summary.skippedCount).toBe(2);
      expect(summary.items[0]?.status).toBe("failed");
      expect(summary.items[1]?.status).toBe("skipped");
      expect(summary.items[2]?.status).toBe("skipped");
      expect(pipelineSpy).toHaveBeenCalledTimes(1);
    });

    it("should propagate embed option to processMediaPipeline", async () => {
      const file1 = path.join(tempDir, "ep1.mp4");
      fs.writeFileSync(file1, "video1");

      vi.spyOn(configModule, "getConfig").mockReturnValue({
        groqApiKey: "gsk-mock",
        geminiApiKey: "gem-mock",
        ffmpegPath: "ffmpeg",
      });
      vi.spyOn(configModule, "ensureApiKeys").mockResolvedValue({
        groqApiKey: "gsk-mock",
        geminiApiKey: "gem-mock",
        ffmpegPath: "ffmpeg",
      });
      vi.spyOn(ffmpegModule, "checkFfmpeg").mockResolvedValue();

      let passedOptions: pipelineModule.ProcessMediaOptions | undefined;
      vi.spyOn(pipelineModule, "processMediaPipeline").mockImplementation(async (opts) => {
        passedOptions = opts;
        return {
          mediaFile: path.basename(opts.mediaFile),
          mediaType: "video",
          durationMs: 500,
          targetLanguages: ["ja"],
          entriesCount: 3,
          outputFiles: [path.join(tempDir, "ep1.embedded.mp4")],
          sttProvider: "groq",
          sttModel: "whisper-large-v3",
          llmProvider: "gemini",
          llmModel: "gemini-3.8-flash",
        };
      });

      const summary = await runBatchPipeline({
        targets: [file1],
        targetLang: "ja",
        embed: true,
      });

      expect(summary.totalFiles).toBe(1);
      expect(summary.succeededCount).toBe(1);
      expect(passedOptions?.embed).toBe(true);
    });

    describe("API key pre-check", () => {
      let dummyFile: string;
      let ensureApiKeysSpy: ReturnType<typeof vi.spyOn>;
      let checkFfmpegSpy: ReturnType<typeof vi.spyOn>;
      let processMediaPipelineSpy: ReturnType<typeof vi.spyOn>;

      beforeEach(() => {
        dummyFile = path.join(tempDir, "sample.mp4");
        fs.writeFileSync(dummyFile, "dummy");

        vi.spyOn(configModule, "getConfig").mockReturnValue({
          groqApiKey: "gsk-mock",
          geminiApiKey: "gem-mock",
          ffmpegPath: "ffmpeg",
        });

        ensureApiKeysSpy = vi
          .spyOn(configModule, "ensureApiKeys")
          .mockImplementation(async (config, opts) => {
            configModule.validateApiKeys(config, opts);
            return config;
          });

        checkFfmpegSpy = vi.spyOn(ffmpegModule, "checkFfmpeg").mockResolvedValue();

        processMediaPipelineSpy = vi
          .spyOn(pipelineModule, "processMediaPipeline")
          .mockResolvedValue({
            mediaFile: path.basename(dummyFile),
            mediaType: "video",
            durationMs: 100,
            targetLanguages: ["ja"],
            entriesCount: 1,
            outputFiles: [],
            sttProvider: "groq",
            sttModel: "whisper-large-v3",
            llmProvider: "gemini",
            llmModel: "gemini-3.8-flash",
          });
      });

      it.each(["option", "config"])("passes Japanese from %s to FFmpeg", async (source) => {
        vi.mocked(configModule.getConfig).mockReturnValue({
          ...configModule.getConfig(),
          lang: source === "config" ? "ja" : "en",
        });
        await runBatchPipeline({
          targets: [dummyFile],
          noTranslate: true,
          noCache: true,
          ...(source === "option" ? { lang: "ja" as const } : {}),
        });
        expect(checkFfmpegSpy).toHaveBeenCalledWith("ffmpeg", "ja");
      });

      function cacheTranscription(
        file = dummyFile,
        options: Partial<BatchPipelineOptions> = {},
        overrides: Partial<TranscriptionCacheContext> = {},
      ): void {
        const config = configModule.getConfig();
        const { stt } = resolveSttSettings(config, options);
        const context = pipelineModule.resolveTranscriptionContext(config, stt, options);
        saveTranscriptionCache(
          file,
          createCachedTranscription(
            { ...context, ...overrides },
            [{ id: 1, startTime: "00:00:00,000", endTime: "00:00:01,000", text: "Test line" }],
            "en",
          ),
          path.join(tempDir, "cache"),
        );
      }

      describe.each(["groq", "openrouter"] as const)("cached %s transcription", (sttProvider) => {
        let options: BatchPipelineOptions;

        beforeEach(() => {
          options = {
            targets: [dummyFile],
            cacheDir: path.join(tempDir, "cache"),
            sttProvider,
            whisperPrompt: "Test recognition hint",
            noTranslate: true,
          };
        });

        it("starts without API keys when all transcriptions are cached", async () => {
          vi.mocked(configModule.getConfig).mockReturnValue({
            ffmpegPath: "ffmpeg",
            groqApiKey: "",
            geminiApiKey: "",
          });
          const second = path.join(tempDir, "second.mp4");
          fs.writeFileSync(second, "dummy second");
          options.targets.push(second);
          for (const file of options.targets) cacheTranscription(file, options);
          const result = await runBatchPipeline(options);
          expect(ensureApiKeysSpy).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
              requireGroq: false,
              requireGemini: false,
              requireOpenRouter: false,
            }),
          );
          expect(processMediaPipelineSpy).toHaveBeenCalledTimes(2);
          expect(checkFfmpegSpy).toHaveBeenCalledTimes(1);
          expect(result.succeededCount).toBe(2);
        });

        it.each(["partial", "fresh", "noCache", "provider", "model", "hint"] as const)(
          "requires the transcription key for %s cache misses",
          async (mode) => {
            if (mode === "hint" && sttProvider === "openrouter") {
              options.sttProvider = "groq";
            }
            cacheTranscription(dummyFile, options, {
              ...(mode === "provider"
                ? { provider: sttProvider === "groq" ? "openrouter" : "groq" }
                : {}),
              ...(mode === "model" ? { model: "other-model" } : {}),
              ...(mode === "hint" ? { prompt: "Other hint" } : {}),
            });
            if (mode === "partial") {
              const second = path.join(tempDir, "uncached.mp4");
              fs.writeFileSync(second, "dummy uncached");
              options.targets.push(second);
            }
            if (mode === "fresh") options.fresh = true;
            if (mode === "noCache") options.noCache = true;
            vi.mocked(configModule.getConfig).mockReturnValue({
              ffmpegPath: "ffmpeg",
              groqApiKey: "",
              geminiApiKey: "",
            });
            await expect(runBatchPipeline(options)).rejects.toThrow(
              options.sttProvider === "groq" ? "VSUB_GROQ_API_KEY" : "VSUB_OPENROUTER_API_KEY",
            );
            expect(ensureApiKeysSpy).toHaveBeenCalledWith(
              expect.anything(),
              expect.objectContaining({
                requireGroq: options.sttProvider === "groq",
                requireOpenRouter: options.sttProvider === "openrouter",
                requireGemini: false,
              }),
            );
            expect(processMediaPipelineSpy).not.toHaveBeenCalled();
          },
        );

        it.each([
          { llmProvider: "gemini", refine: false },
          { llmProvider: "gemini", refine: true },
          { llmProvider: "openrouter", refine: false },
          { llmProvider: "openrouter", refine: true },
        ] as const)(
          "requires only text generation keys ($llmProvider, refine: $refine)",
          async ({ llmProvider, refine }) => {
            vi.mocked(configModule.getConfig).mockReturnValue({
              ffmpegPath: "ffmpeg",
              groqApiKey: "",
              geminiApiKey: "test-gemini-key",
              openrouterApiKey: "test-openrouter-key",
            });
            cacheTranscription(dummyFile, options);
            await runBatchPipeline({ ...options, llmProvider, noTranslate: refine, refine });
            expect(ensureApiKeysSpy).toHaveBeenCalledWith(
              expect.anything(),
              expect.objectContaining({
                requireGroq: false,
                requireGemini: llmProvider === "gemini",
                requireOpenRouter: llmProvider === "openrouter",
              }),
            );
            expect(processMediaPipelineSpy).toHaveBeenCalledTimes(1);
          },
        );
      });

      it.each([false, true])(
        "shows the automatic Groq hint only on a cache miss (cached: %s)",
        async (cached) => {
          const log = vi.spyOn(console, "log").mockImplementation(() => {});
          const options = {
            targets: [dummyFile],
            cacheDir: path.join(tempDir, "cache"),
            noTranslate: true,
          };
          if (cached) cacheTranscription(dummyFile, options);
          await runBatchPipeline(options);
          const output = stripVTControlCharacters(log.mock.calls.flat().join("\n"));
          const hint = "Transcribing with Groq because VSUB_OPENROUTER_API_KEY is not set";
          if (cached) expect(output).not.toContain(hint);
          else expect(output).toContain(hint);
        },
      );

      it.each([
        {
          description: "noTranslate: true",
          options: { noTranslate: true },
          expected: { requireGroq: true, requireGemini: false, requireOpenRouter: false },
        },
        {
          description: "configured refinement without a CLI flag",
          mockConfig: {
            groqApiKey: "test-groq-key",
            geminiApiKey: "test-gemini-key",
            ffmpegPath: "ffmpeg",
            refine: true,
          },
          options: { noTranslate: true },
          expected: { requireGroq: true, requireGemini: true, requireOpenRouter: false },
        },
        {
          description: "configured refinement disabled by CLI",
          mockConfig: {
            groqApiKey: "test-groq-key",
            geminiApiKey: "test-gemini-key",
            ffmpegPath: "ffmpeg",
            refine: true,
          },
          options: { noTranslate: true, refine: false },
          expected: { requireGroq: true, requireGemini: false, requireOpenRouter: false },
        },
        {
          description: "without noTranslate",
          options: {},
          expected: { requireGroq: true, requireGemini: true, requireOpenRouter: false },
        },
        {
          description: "with OpenRouter key in config",
          mockConfig: {
            openrouterApiKey: "vsub-openrouter-key",
            groqApiKey: "",
            geminiApiKey: "gem-mock",
            ffmpegPath: "ffmpeg",
          },
          options: {},
          expected: { requireGroq: false, requireGemini: true, requireOpenRouter: true },
        },
        {
          description: "llmProvider: openrouter with groq STT",
          options: { sttProvider: "groq", llmProvider: "openrouter" },
          mockConfig: {
            openrouterApiKey: "vsub-openrouter-key",
            groqApiKey: "gsk-mock",
            geminiApiKey: "",
            ffmpegPath: "ffmpeg",
          },
          expected: { requireGroq: true, requireGemini: false, requireOpenRouter: true },
        },
        {
          description: "llmProvider: openrouter but noTranslate is true",
          options: { llmProvider: "openrouter", noTranslate: true },
          expected: { requireGroq: true, requireGemini: false, requireOpenRouter: false },
        },
        {
          description: "sttProvider: openrouter and llmProvider: openrouter",
          options: { sttProvider: "openrouter", llmProvider: "openrouter" },
          mockConfig: {
            openrouterApiKey: "vsub-openrouter-key",
            groqApiKey: "",
            geminiApiKey: "",
            ffmpegPath: "ffmpeg",
          },
          expected: { requireGroq: false, requireGemini: false, requireOpenRouter: true },
        },
        {
          description: "noTranslate: true with refine: true (gemini)",
          options: { noTranslate: true, refine: true },
          expected: { requireGroq: true, requireGemini: true, requireOpenRouter: false },
        },
        {
          description: "noTranslate: true with refine: true (openrouter)",
          options: {
            sttProvider: "groq",
            llmProvider: "openrouter",
            noTranslate: true,
            refine: true,
          },
          mockConfig: {
            openrouterApiKey: "vsub-openrouter-key",
            groqApiKey: "gsk-mock",
            geminiApiKey: "",
            ffmpegPath: "ffmpeg",
          },
          expected: { requireGroq: true, requireGemini: false, requireOpenRouter: true },
        },
      ])(
        "should call ensureApiKeys with correct requirements ($description)",
        async ({ options, expected, mockConfig }) => {
          if (mockConfig) {
            vi.spyOn(configModule, "getConfig").mockReturnValue(mockConfig);
          }
          await runBatchPipeline({
            targets: [dummyFile],
            ...options,
          });

          expect(ensureApiKeysSpy).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining(expected),
          );
          if ("refine" in options && options.refine) {
            expect(processMediaPipelineSpy).toHaveBeenCalledWith(
              expect.objectContaining({ refine: true }),
            );
          }
        },
      );

      it("should reject with missing Groq key error and abort before processing when sttProvider is groq and noTranslate is true", async () => {
        vi.spyOn(configModule, "getConfig").mockReturnValue({
          groqApiKey: "",
          geminiApiKey: "gem-mock",
          ffmpegPath: "ffmpeg",
        });

        await expect(
          runBatchPipeline({
            targets: [dummyFile],
            sttProvider: "groq",
            noTranslate: true,
          }),
        ).rejects.toThrow("VSUB_GROQ_API_KEY");

        expect(processMediaPipelineSpy).not.toHaveBeenCalled();
        expect(checkFfmpegSpy).not.toHaveBeenCalled();
      });

      it("should reject with missing OpenRouter key error when no keys are configured", async () => {
        vi.spyOn(configModule, "getConfig").mockReturnValue({
          groqApiKey: "",
          geminiApiKey: "gem-mock",
          ffmpegPath: "ffmpeg",
        });

        await expect(
          runBatchPipeline({
            targets: [dummyFile],
            noTranslate: true,
          }),
        ).rejects.toThrow("VSUB_OPENROUTER_API_KEY");

        expect(processMediaPipelineSpy).not.toHaveBeenCalled();
        expect(checkFfmpegSpy).not.toHaveBeenCalled();
      });

      it("prints hint once and passes silentSttHint: true to each media pipeline when auto chooses groq", async () => {
        const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
        vi.spyOn(configModule, "getConfig").mockReturnValue({
          groqApiKey: "gsk-mock",
          geminiApiKey: "gem-mock",
          ffmpegPath: "ffmpeg",
        });

        await runBatchPipeline({
          targets: [dummyFile],
        });

        expect(processMediaPipelineSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            silentSttHint: true,
          }),
        );
        expect(consoleLogSpy).toHaveBeenCalledWith(
          expect.stringContaining(
            "Transcribing with Groq because VSUB_OPENROUTER_API_KEY is not set",
          ),
        );
      });

      it.each([true, false])(
        "prints a checkpoint hint directly after the numbered failure (stopped: %s)",
        async (stopped) => {
          const error = stopped
            ? new TranslationStoppedError(new Error("Unavailable"), "ja", 1, 3)
            : new Error("Unavailable");
          processMediaPipelineSpy.mockRejectedValue(error);
          const output = vi.spyOn(console, "error").mockImplementation(() => {});
          const summary = await runBatchPipeline({ targets: [dummyFile] });
          const lines = stripVTControlCharacters(
            output.mock.calls.flat().map(String).join("\n"),
          ).split("\n");
          const failureIndex = lines.findIndex((line) => line.includes("Failed: Unavailable"));
          expect(failureIndex).toBeGreaterThanOrEqual(0);
          if (stopped)
            expect(lines[failureIndex + 1]).toBe(`[1/1] ${getTranslationResumeHint(error, "en")}`);
          else expect(lines.join("\n")).not.toContain("Run the same command");
          expect(summary.failedCount).toBe(1);
        },
      );
    });

    describe("--embed container pre-check", () => {
      beforeEach(() => {
        fs.writeFileSync(path.join(tempDir, "ep1.mp4"), "dummy video 1");
        fs.writeFileSync(path.join(tempDir, "ep2.avi"), "dummy video 2");
        fs.writeFileSync(path.join(tempDir, "ep3.mp4"), "dummy video 3");

        vi.spyOn(configModule, "getConfig").mockReturnValue({
          groqApiKey: "gsk-mock",
          geminiApiKey: "gem-mock",
          ffmpegPath: "ffmpeg",
        });
        vi.spyOn(configModule, "ensureApiKeys").mockResolvedValue({
          groqApiKey: "gsk-mock",
          geminiApiKey: "gem-mock",
          ffmpegPath: "ffmpeg",
        });
        vi.spyOn(ffmpegModule, "checkFfmpeg").mockResolvedValue(undefined);
        vi.spyOn(ffmpegModule, "extractAudio").mockResolvedValue({
          audioPaths: [],
          cleanup: async () => {},
        });
        vi.spyOn(ffmpegModule, "embedSubtitlesToVideo").mockImplementation(
          async (_video, _sub, out) => out,
        );
        vi.spyOn(transcriberModule, "transcribeAudioSegments").mockResolvedValue({
          entries: [{ id: 1, startTime: "00:00:00,000", endTime: "00:00:02,000", text: "Line" }],
          detectedLanguage: "en",
        });
        vi.spyOn(tasksModule, "translateSrtEntries").mockImplementation(async (entries) => entries);

        vi.spyOn(console, "log").mockImplementation(() => {});
        vi.spyOn(console, "error").mockImplementation(() => {});
        vi.spyOn(console, "warn").mockImplementation(() => {});
      });

      it("should fail only unsupported containers before API calls and process other files", async () => {
        const summary = await runBatchPipeline({
          targets: [tempDir],
          embed: true,
          targetLang: "ja",
          noCache: true,
        });

        const ep1Result = summary.items.find((r) => r.file === "ep1.mp4");
        const ep2Result = summary.items.find((r) => r.file === "ep2.avi");
        const ep3Result = summary.items.find((r) => r.file === "ep3.mp4");

        expect(ep1Result?.status).toBe("success");
        expect(ep2Result?.status).toBe("failed");
        expect(ep2Result?.error).toContain('Cannot embed subtitle tracks into "ep2.embedded.avi"');
        expect(ep3Result?.status).toBe("success");

        expect(transcriberModule.transcribeAudioSegments).toHaveBeenCalledTimes(2);
        expect(tasksModule.translateSrtEntries).toHaveBeenCalledTimes(2);
        expect(ffmpegModule.embedSubtitlesToVideo).toHaveBeenCalledTimes(2);
      });
    });
  });
});
