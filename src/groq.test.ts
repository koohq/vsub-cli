import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  formatSrtTime,
  normalizeLanguageCode,
  transcribeAudioSegments,
  transcribeAudioWithGroq,
} from "./groq.js";

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

describe("groq.ts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("formatSrtTime", () => {
    it("should format 0 seconds", () => {
      expect(formatSrtTime(0)).toBe("00:00:00,000");
    });

    it("should format seconds with fractional milliseconds", () => {
      expect(formatSrtTime(1.5)).toBe("00:00:01,500");
      expect(formatSrtTime(9.025)).toBe("00:00:09,025");
    });

    it("should format minutes and seconds", () => {
      expect(formatSrtTime(65.123)).toBe("00:01:05,123");
      expect(formatSrtTime(599.999)).toBe("00:09:59,999");
    });

    it("should format hours, minutes, and seconds", () => {
      expect(formatSrtTime(3665.04)).toBe("01:01:05,040");
      expect(formatSrtTime(7325.8)).toBe("02:02:05,800");
    });

    it("should pad single digits with leading zeroes", () => {
      expect(formatSrtTime(1.005)).toBe("00:00:01,005");
    });
  });

  describe("normalizeLanguageCode", () => {
    it("should return undefined for falsy or empty values", () => {
      expect(normalizeLanguageCode(undefined)).toBeUndefined();
      expect(normalizeLanguageCode("")).toBeUndefined();
    });

    it("should map language names to 2-letter codes", () => {
      expect(normalizeLanguageCode("japanese")).toBe("ja");
      expect(normalizeLanguageCode("Japanese")).toBe("ja");
      expect(normalizeLanguageCode("ENGLISH")).toBe("en");
      expect(normalizeLanguageCode("french")).toBe("fr");
      expect(normalizeLanguageCode("german")).toBe("de");
      expect(normalizeLanguageCode("chinese")).toBe("zh");
    });

    it("should preserve valid 2-letter codes", () => {
      expect(normalizeLanguageCode("ja")).toBe("ja");
      expect(normalizeLanguageCode("en")).toBe("en");
      expect(normalizeLanguageCode("es")).toBe("es");
    });

    it("should extract 2-letter code from BCP-47 language tags", () => {
      expect(normalizeLanguageCode("en-US")).toBe("en");
      expect(normalizeLanguageCode("ja-JP")).toBe("ja");
      expect(normalizeLanguageCode("zh-CN")).toBe("zh");
    });
  });

  describe("transcribeAudioWithGroq", () => {
    it("should convert Groq transcription segments to SrtEntry array", async () => {
      mockCreateTranscription.mockResolvedValueOnce({
        language: "english",
        segments: [
          { id: 0, start: 1.0, end: 3.5, text: "Hello there" },
          { id: 1, start: 4.0, end: 6.2, text: "General Kenobi" },
        ],
      });

      const result = await transcribeAudioWithGroq("dummy.m4a", "fake-api-key", 0);

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
  });

  describe("transcribeAudioSegments", () => {
    it("should process multiple audio segments and accumulate 1200s time offsets", async () => {
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

      const result = await transcribeAudioSegments(["seg1.m4a", "seg2.m4a"], "fake-api-key");

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
      await transcribeAudioSegments(["seg1.m4a", "seg2.m4a"], "fake-api-key", false, onProgress);

      expect(onProgress).toHaveBeenCalledTimes(2);
      expect(onProgress).toHaveBeenNthCalledWith(1, 1, 2);
      expect(onProgress).toHaveBeenNthCalledWith(2, 2, 2);
    });
  });
});
