import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGroqTranscriber, GROQ_LIMITS } from "./groq.js";
import { createTranscriber } from "./select.js";
import { transcribeAudioSegments } from "./transcriber.js";

// Mock groq-sdk
const mockCreateTranscription = vi.fn();
vi.mock("groq-sdk", () => {
  return {
    default: class MockGroq {
      audio = {
        transcriptions: {
          create: mockCreateTranscription,
        },
      };
    },
  };
});

// Mock fs.createReadStream
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    default: {
      ...actual,
      createReadStream: vi.fn().mockReturnValue({}),
    },
  };
});

describe("transcribe/groq.ts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Keep the default-model expectations independent of the developer's real environment.
    vi.stubEnv("VSUB_GROQ_MODEL", "");
    vi.stubEnv("GROQ_MODEL", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("createGroqTranscriber", () => {
    it("should convert Groq transcription segments to SrtEntry array", async () => {
      mockCreateTranscription.mockResolvedValueOnce({
        language: "english",
        segments: [
          { id: 0, start: 1.0, end: 3.5, text: "Hello there" },
          { id: 1, start: 4.0, end: 6.2, text: "General Kenobi" },
        ],
      });

      const result = await transcribeAudioSegments(
        ["dummy.m4a"],
        createGroqTranscriber("fake-api-key"),
      );

      expect(result.detectedLanguage).toBe("en");
      expect(result.entries).toEqual([
        {
          id: 1,
          startTime: "00:00:01,000",
          endTime: "00:00:03,500",
          text: "Hello there",
        },
        {
          id: 2,
          startTime: "00:00:04,000",
          endTime: "00:00:06,200",
          text: "General Kenobi",
        },
      ]);
    });

    it("should pass prompt parameter to Groq API client if provided", async () => {
      mockCreateTranscription.mockResolvedValueOnce({
        language: "japanese",
        segments: [{ id: 0, start: 0, end: 1, text: "テスト" }],
      });

      await createGroqTranscriber("fake-api-key").transcribe("dummy.m4a", {
        prompt: "Antigravity, vsub",
      });

      expect(mockCreateTranscription).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: "Antigravity, vsub",
        }),
      );
    });

    it("should pass custom model to Groq API client if provided", async () => {
      mockCreateTranscription.mockResolvedValueOnce({
        language: "japanese",
        segments: [{ id: 0, start: 0, end: 1, text: "テスト" }],
      });

      await createGroqTranscriber("fake-api-key").transcribe("dummy.m4a", {
        model: "whisper-large-v3",
      });

      expect(mockCreateTranscription).toHaveBeenCalledWith(
        expect.objectContaining({
          model: "whisper-large-v3",
        }),
      );
    });

    it("should send exactly file, model and response_format when no prompt is given", async () => {
      mockCreateTranscription.mockResolvedValueOnce({ segments: [] });

      await createGroqTranscriber("fake-api-key").transcribe("dummy.m4a");

      const request = mockCreateTranscription.mock.calls[0]?.[0];
      expect(Object.keys(request).sort()).toEqual(["file", "model", "response_format"]);
      expect(request).toEqual({
        file: expect.anything(),
        model: "whisper-large-v3-turbo",
        response_format: "verbose_json",
      });
    });

    it("should add only prompt to the request when a prompt is given", async () => {
      mockCreateTranscription.mockResolvedValueOnce({ segments: [] });

      await createGroqTranscriber("fake-api-key").transcribe("dummy.m4a", { prompt: "Terms" });

      const request = mockCreateTranscription.mock.calls[0]?.[0];
      expect(Object.keys(request).sort()).toEqual(["file", "model", "prompt", "response_format"]);
      expect(request.prompt).toBe("Terms");
      expect(request.response_format).toBe("verbose_json");
    });

    it.each([
      {
        name: "option model wins",
        option: "opt-model",
        vsub: "vsub-model",
        groq: "groq-model",
        expected: "opt-model",
      },
      {
        name: "VSUB_GROQ_MODEL next",
        option: undefined,
        vsub: "vsub-model",
        groq: "groq-model",
        expected: "vsub-model",
      },
      {
        name: "GROQ_MODEL next",
        option: undefined,
        vsub: "",
        groq: "groq-model",
        expected: "groq-model",
      },
      {
        name: "default model last",
        option: undefined,
        vsub: "",
        groq: "",
        expected: "whisper-large-v3-turbo",
      },
    ])("should resolve the model: $name", async ({ option, vsub, groq, expected }) => {
      vi.stubEnv("VSUB_GROQ_MODEL", vsub);
      vi.stubEnv("GROQ_MODEL", groq);
      mockCreateTranscription.mockResolvedValueOnce({ segments: [] });

      await createGroqTranscriber("fake-api-key").transcribe("dummy.m4a", { model: option });

      expect(mockCreateTranscription.mock.calls[0]?.[0].model).toBe(expected);
    });

    it("should return response segments as-is and the raw language", async () => {
      mockCreateTranscription.mockResolvedValueOnce({
        language: "japanese",
        segments: [{ id: 0, start: 2.5, end: 4, text: " テスト " }],
      });

      const result = await createGroqTranscriber("fake-api-key").transcribe("dummy.m4a");

      expect(result).toEqual({
        segments: [{ id: 0, start: 2.5, end: 4, text: " テスト " }],
        language: "japanese",
      });
    });
  });

  describe("limits and selection", () => {
    it("should keep the Groq split limits at 24.5MB and 1200s", () => {
      expect(GROQ_LIMITS).toEqual({ maxFileBytes: 24.5 * 1024 * 1024, segmentSeconds: 1200 });
    });

    it("createTranscriber should return the Groq transcriber", () => {
      const transcriber = createTranscriber({ groqApiKey: "fake-api-key" });

      expect(transcriber.limits).toBe(GROQ_LIMITS);
      expect(transcriber.logLabel).toBe("Groq API");
    });
  });

  describe("transcribeAudioSegments with the Groq transcriber", () => {
    it("should forward prompt option to the Groq request for each segment", async () => {
      mockCreateTranscription.mockResolvedValue({
        language: "japanese",
        segments: [{ id: 0, start: 0, end: 1, text: "セグメント" }],
      });

      await transcribeAudioSegments(
        ["seg1.m4a", "seg2.m4a"],
        createGroqTranscriber("fake-api-key"),
        false,
        undefined,
        { prompt: "GlossaryTerms" },
      );

      expect(mockCreateTranscription).toHaveBeenCalledTimes(2);
      expect(mockCreateTranscription).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: "GlossaryTerms",
        }),
      );
    });

    it("should process multiple audio segments and accumulate accurately measured durations", async () => {
      // Segment 1 (duration: 1200.450s)
      mockCreateTranscription.mockResolvedValueOnce({
        language: "japanese",
        segments: [{ id: 0, start: 10.0, end: 15.0, text: "セグメント1" }],
      });

      // Segment 2 (duration: 1199.800s, offset: 1200.450s)
      mockCreateTranscription.mockResolvedValueOnce({
        language: "japanese",
        segments: [{ id: 0, start: 5.0, end: 10.0, text: "セグメント2" }],
      });

      // Segment 3 (offset: 1200.450 + 1199.800 = 2400.250s)
      mockCreateTranscription.mockResolvedValueOnce({
        language: "japanese",
        segments: [{ id: 0, start: 1.0, end: 3.5, text: "セグメント3" }],
      });

      const result = await transcribeAudioSegments(
        ["seg1.m4a", "seg2.m4a", "seg3.m4a"],
        createGroqTranscriber("fake-api-key"),
        false,
        undefined,
        {
          durations: [1200.45, 1199.8, 1200.0],
        },
      );

      expect(result.detectedLanguage).toBe("ja");
      expect(result.entries).toEqual([
        {
          id: 1,
          startTime: "00:00:10,000",
          endTime: "00:00:15,000",
          text: "セグメント1",
        },
        {
          id: 2,
          startTime: "00:20:05,450", // 1200.450 + 5.0
          endTime: "00:20:10,450", // 1200.450 + 10.0
          text: "セグメント2",
        },
        {
          id: 3,
          startTime: "00:40:01,250", // 2400.250 + 1.0
          endTime: "00:40:03,750", // 2400.250 + 3.5
          text: "セグメント3",
        },
      ]);
    });

    it("should fallback to 1200s time offsets when durations option is not provided", async () => {
      // Segment 1 (offset 0s)
      mockCreateTranscription.mockResolvedValueOnce({
        language: "japanese",
        segments: [{ id: 0, start: 10.0, end: 15.0, text: "セグメント1" }],
      });

      // Segment 2 (offset 1200s = 00:20:00)
      mockCreateTranscription.mockResolvedValueOnce({
        language: "japanese",
        segments: [{ id: 0, start: 5.0, end: 10.0, text: "セグメント2" }],
      });

      const result = await transcribeAudioSegments(
        ["seg1.m4a", "seg2.m4a"],
        createGroqTranscriber("fake-api-key"),
      );

      expect(result.detectedLanguage).toBe("ja");
      expect(result.entries).toEqual([
        {
          id: 1,
          startTime: "00:00:10,000",
          endTime: "00:00:15,000",
          text: "セグメント1",
        },
        {
          id: 2,
          startTime: "00:20:05,000",
          endTime: "00:20:10,000",
          text: "セグメント2",
        },
      ]);
    });

    it("should call onProgress callback for each segment", async () => {
      mockCreateTranscription
        .mockResolvedValueOnce({
          language: "ja",
          segments: [{ id: 0, start: 1.0, end: 2.0, text: "Seg1" }],
        })
        .mockResolvedValueOnce({
          language: "ja",
          segments: [{ id: 0, start: 1.0, end: 2.0, text: "Seg2" }],
        });

      const onProgress = vi.fn();
      await transcribeAudioSegments(
        ["seg1.m4a", "seg2.m4a"],
        createGroqTranscriber("fake-api-key"),
        false,
        onProgress,
      );

      expect(onProgress).toHaveBeenCalledTimes(2);
      expect(onProgress).toHaveBeenNthCalledWith(1, 1, 2);
      expect(onProgress).toHaveBeenNthCalledWith(2, 2, 2);
    });
  });
});
