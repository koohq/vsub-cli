import { beforeEach, describe, expect, it, vi } from "vitest";
import { translateSrtEntries } from "./gemini.js";
import type { SrtEntry } from "./srt.js";

// Mock @google/genai
const mockGenerateContent = vi.fn();
vi.mock("@google/genai", () => {
  return {
    GoogleGenAI: class MockGoogleGenAI {
      models = {
        generateContent: mockGenerateContent,
      };
    },
  };
});

describe("gemini.ts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("translateSrtEntries", () => {
    it("should return an empty array if entries are empty without calling API", async () => {
      const result = await translateSrtEntries([], "ja", "fake-key");
      expect(result).toEqual([]);
      expect(mockGenerateContent).not.toHaveBeenCalled();
    });

    it("should translate entries within a single chunk and preserve timestamps", async () => {
      const entries: SrtEntry[] = [
        {
          id: 1,
          startTime: "00:00:01,000",
          endTime: "00:00:04,000",
          text: "Hello",
        },
        {
          id: 2,
          startTime: "00:00:05,000",
          endTime: "00:00:08,000",
          text: "How are you?",
        },
      ];

      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify(["こんにちは", "元気ですか？"]),
      });

      const result = await translateSrtEntries(entries, "ja", "fake-key");

      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
      expect(result).toEqual([
        {
          id: 1,
          startTime: "00:00:01,000",
          endTime: "00:00:04,000",
          text: "こんにちは",
        },
        {
          id: 2,
          startTime: "00:00:05,000",
          endTime: "00:00:08,000",
          text: "元気ですか？",
        },
      ]);
    });

    it("should handle JSON wrapped with markdown codeblocks", async () => {
      const entries: SrtEntry[] = [
        {
          id: 1,
          startTime: "00:00:01,000",
          endTime: "00:00:02,000",
          text: "Test",
        },
      ];

      mockGenerateContent.mockResolvedValueOnce({
        text: '```json\n["テスト"]\n```',
      });

      const result = await translateSrtEntries(entries, "ja", "fake-key");
      expect(result[0]?.text).toBe("テスト");
    });

    it("should split entries exceeding DEFAULT_CHUNK_SIZE (50) into multiple chunks", async () => {
      const entries: SrtEntry[] = [];
      for (let i = 1; i <= 60; i++) {
        entries.push({
          id: i,
          startTime: "00:00:00,000",
          endTime: "00:00:01,000",
          text: `English ${i}`,
        });
      }

      // Chunk 1 (50 items)
      const chunk1Translations = Array.from({ length: 50 }, (_, i) => `日本語 ${i + 1}`);
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify(chunk1Translations),
      });

      // Chunk 2 (10 items)
      const chunk2Translations = Array.from({ length: 10 }, (_, i) => `日本語 ${i + 51}`);
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify(chunk2Translations),
      });

      const result = await translateSrtEntries(entries, "ja", "fake-key");

      expect(mockGenerateContent).toHaveBeenCalledTimes(2);
      expect(result).toHaveLength(60);
      expect(result[0]?.text).toBe("日本語 1");
      expect(result[49]?.text).toBe("日本語 50");
      expect(result[50]?.text).toBe("日本語 51");
      expect(result[59]?.text).toBe("日本語 60");
    });

    it("should retry on error and throw after exhausting max attempts", async () => {
      const entries: SrtEntry[] = [
        {
          id: 1,
          startTime: "00:00:01,000",
          endTime: "00:00:02,000",
          text: "Fail test",
        },
      ];

      mockGenerateContent.mockRejectedValue(new Error("Network Timeout"));

      await expect(translateSrtEntries(entries, "ja", "fake-key")).rejects.toThrow(
        /Gemini API translation failed after 4 attempts/,
      );

      expect(mockGenerateContent).toHaveBeenCalledTimes(4);
    }, 15000);

    it("should call onProgress callback for each translated chunk", async () => {
      const entries: SrtEntry[] = [];
      for (let i = 1; i <= 60; i++) {
        entries.push({
          id: i,
          startTime: "00:00:00,000",
          endTime: "00:00:01,000",
          text: `Entry ${i}`,
        });
      }

      mockGenerateContent
        .mockResolvedValueOnce({
          text: JSON.stringify(Array.from({ length: 50 }, (_, i) => `Translated ${i + 1}`)),
        })
        .mockResolvedValueOnce({
          text: JSON.stringify(Array.from({ length: 10 }, (_, i) => `Translated ${i + 51}`)),
        });

      const onProgress = vi.fn();
      await translateSrtEntries(entries, "ja", "fake-key", false, onProgress);

      expect(onProgress).toHaveBeenCalledTimes(2);
      expect(onProgress).toHaveBeenNthCalledWith(1, 1, 2);
      expect(onProgress).toHaveBeenNthCalledWith(2, 2, 2);
    });

    it("should inject custom prompt instructions and glossary rules into Gemini prompt", async () => {
      const entries: SrtEntry[] = [
        {
          id: 1,
          startTime: "00:00:01,000",
          endTime: "00:00:02,000",
          text: "We use Antigravity for agentic AI.",
        },
      ];

      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify([
          "私たちはエージェンティックAIのためにアンチグラビティを使用します。",
        ]),
      });

      await translateSrtEntries(entries, "ja", "fake-key", false, undefined, {
        prompt: "Use polite and professional Japanese (です・ます調).",
        glossary: {
          Antigravity: "アンチグラビティ",
          "agentic AI": "エージェンティックAI",
        },
      });

      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
      const callArgs = mockGenerateContent.mock.calls[0]?.[0];
      expect(callArgs.contents).toContain("ADDITIONAL TRANSLATION INSTRUCTIONS:");
      expect(callArgs.contents).toContain("Use polite and professional Japanese (です・ます調).");
      expect(callArgs.contents).toContain(
        "GLOSSARY / TERMINOLOGY RULES (MUST USE THESE EXACT TRANSLATIONS):",
      );
      expect(callArgs.contents).toContain('- "Antigravity" -> "アンチグラビティ"');
      expect(callArgs.contents).toContain('- "agentic AI" -> "エージェンティックAI"');
    });
  });
});
