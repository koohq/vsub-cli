import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  asyncPool,
  buildTranslationPrompt,
  DEFAULT_CONTEXT_WINDOW_SIZE,
  formatModelNotFoundError,
  isModelNotFoundError,
  translateSrtEntries,
} from "./gemini.js";
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
    Type: {
      ARRAY: "ARRAY",
      STRING: "STRING",
      NUMBER: "NUMBER",
      INTEGER: "INTEGER",
      BOOLEAN: "BOOLEAN",
      OBJECT: "OBJECT",
    },
  };
});

describe("gemini.ts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("asyncPool", () => {
    it("should return empty array for empty items", async () => {
      const result = await asyncPool(3, [], async (x) => x);
      expect(result).toEqual([]);
    });

    it("should process items with concurrency limit and preserve order", async () => {
      const items = [1, 2, 3, 4, 5];
      let activeCount = 0;
      let maxActiveCount = 0;

      const result = await asyncPool(2, items, async (item) => {
        activeCount++;
        maxActiveCount = Math.max(maxActiveCount, activeCount);
        // Simulate variable delays: odd items take longer than even items
        const delay = item % 2 === 1 ? 50 : 10;
        await new Promise((resolve) => setTimeout(resolve, delay));
        activeCount--;
        return item * 10;
      });

      expect(result).toEqual([10, 20, 30, 40, 50]);
      expect(maxActiveCount).toBeLessThanOrEqual(2);
    });

    it("should propagate errors from taskFn", async () => {
      const items = [1, 2, 3];
      await expect(
        asyncPool(2, items, async (item) => {
          if (item === 2) throw new Error("Worker failure");
          return item;
        }),
      ).rejects.toThrow("Worker failure");
    });
  });

  describe("buildTranslationPrompt", () => {
    it("should build standard prompt without preceding context", () => {
      const texts = ["Hello world", "How are you?"];
      const prompt = buildTranslationPrompt(texts, "ja");

      expect(prompt).toContain(
        'Translate the following array of subtitle texts into target language code "ja".',
      );
      expect(prompt).toContain("STRICT RULES:");
      expect(prompt).toContain(
        "1. Return ONLY a valid JSON array of strings corresponding 1-to-1 with the input array.",
      );
      expect(prompt).toContain(
        "2. The output array MUST contain exactly 2 items in the same order as input.",
      );
      expect(prompt).toContain(
        "3. Translate into natural, clear conversational style suited for video subtitles.",
      );
      expect(prompt).toContain("4. Do NOT include markdown code blocks");
      expect(prompt).not.toContain('5. Translate ONLY the items in "Input Array"');
      expect(prompt).not.toContain("PRECEDING CONTEXT");
      expect(prompt).toContain('Input Array:\n[\n  "Hello world",\n  "How are you?"\n]');
    });

    it("should inject preceding context and rule 5 when contextTexts is provided", () => {
      const texts = ["Current line 1", "Current line 2"];
      const contextTexts = ["Preceding dialogue 1", "Preceding dialogue 2"];
      const prompt = buildTranslationPrompt(texts, "ja", undefined, contextTexts);

      expect(prompt).toContain(
        '5. Translate ONLY the items in "Input Array". Do NOT translate, output, or include items from "Preceding Context".',
      );
      expect(prompt).toContain("PRECEDING CONTEXT (FOR REFERENCE ONLY - DO NOT TRANSLATE):");
      expect(prompt).toContain(
        "The following lines immediately precede the input subtitles in the media.",
      );
      expect(prompt).toContain('"Preceding dialogue 1"');
      expect(prompt).toContain('"Preceding dialogue 2"');
      expect(prompt).toContain('Input Array:\n[\n  "Current line 1",\n  "Current line 2"\n]');
    });

    it("should not inject preceding context if contextTexts is empty", () => {
      const texts = ["Line 1"];
      const prompt = buildTranslationPrompt(texts, "es", undefined, []);

      expect(prompt).not.toContain('5. Translate ONLY the items in "Input Array"');
      expect(prompt).not.toContain("PRECEDING CONTEXT");
    });
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

    it("should split entries exceeding DEFAULT_CHUNK_SIZE (50) into multiple chunks and preserve order with concurrency", async () => {
      const entries: SrtEntry[] = [];
      for (let i = 1; i <= 110; i++) {
        entries.push({
          id: i,
          startTime: "00:00:00,000",
          endTime: "00:00:01,000",
          text: `English ${i}`,
        });
      }

      // Chunk 1 (50 items), Chunk 2 (50 items), Chunk 3 (10 items)
      // Make Chunk 1 slower than Chunk 2 to test out-of-order resolution
      mockGenerateContent.mockImplementation(async (req: { contents: string }) => {
        if (req.contents.includes('"English 1"')) {
          await new Promise((resolve) => setTimeout(resolve, 40));
          return { text: JSON.stringify(Array.from({ length: 50 }, (_, i) => `日本語 ${i + 1}`)) };
        }
        if (req.contents.includes('"English 51"')) {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return { text: JSON.stringify(Array.from({ length: 50 }, (_, i) => `日本語 ${i + 51}`)) };
        }
        return { text: JSON.stringify(Array.from({ length: 10 }, (_, i) => `日本語 ${i + 101}`)) };
      });

      const result = await translateSrtEntries(entries, "ja", "fake-key", false, undefined, {
        concurrency: 3,
      });

      expect(mockGenerateContent).toHaveBeenCalledTimes(3);
      expect(result).toHaveLength(110);
      expect(result[0]?.text).toBe("日本語 1");
      expect(result[49]?.text).toBe("日本語 50");
      expect(result[50]?.text).toBe("日本語 51");
      expect(result[99]?.text).toBe("日本語 100");
      expect(result[100]?.text).toBe("日本語 101");
      expect(result[109]?.text).toBe("日本語 110");
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
        /Gemini API translation failed after 4 attempts on chunk 1\/1/,
      );

      expect(mockGenerateContent).toHaveBeenCalledTimes(4);
    }, 15000);

    it("should call onProgress callback for each completed chunk", async () => {
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
      await translateSrtEntries(entries, "ja", "fake-key", false, onProgress, { concurrency: 2 });

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
        model: "gemini-3.7-flash",
      });

      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
      const callArgs = mockGenerateContent.mock.calls[0]?.[0];
      expect(callArgs.model).toBe("gemini-3.7-flash");
      expect(callArgs.contents).toContain("ADDITIONAL TRANSLATION INSTRUCTIONS:");
      expect(callArgs.contents).toContain("Use polite and professional Japanese (です・ます調).");
      expect(callArgs.contents).toContain(
        "GLOSSARY / TERMINOLOGY RULES (MUST USE THESE EXACT TRANSLATIONS):",
      );
      expect(callArgs.contents).toContain('- "Antigravity" -> "アンチグラビティ"');
      expect(callArgs.contents).toContain('- "agentic AI" -> "エージェンティックAI"');
    });

    it("should use custom model when passed in options", async () => {
      const entries: SrtEntry[] = [
        {
          id: 1,
          startTime: "00:00:01,000",
          endTime: "00:00:02,000",
          text: "Hello",
        },
      ];

      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify(["こんにちは"]),
      });

      await translateSrtEntries(entries, "ja", "fake-key", false, undefined, {
        model: "gemini-2.5-pro",
      });

      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
      const callArgs = mockGenerateContent.mock.calls[0]?.[0];
      expect(callArgs.model).toBe("gemini-2.5-pro");
    });

    it("should default to DEFAULT_GEMINI_MODEL (gemini-3.8-flash) when no model is specified", async () => {
      const entries: SrtEntry[] = [
        {
          id: 1,
          startTime: "00:00:01,000",
          endTime: "00:00:02,000",
          text: "Hello",
        },
      ];

      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify(["こんにちは"]),
      });

      await translateSrtEntries(entries, "ja", "fake-key");

      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
      const callArgs = mockGenerateContent.mock.calls[0]?.[0];
      expect(callArgs.model).toBe("gemini-3.8-flash");
    });

    it("should fail fast without retrying when model not found error (404) occurs with default model", async () => {
      const entries: SrtEntry[] = [
        {
          id: 1,
          startTime: "00:00:01,000",
          endTime: "00:00:02,000",
          text: "Hello",
        },
      ];

      const notFoundError = new Error(
        "models/gemini-3.8-flash is not found for API version v1beta",
      );
      (notFoundError as { status?: number }).status = 404;
      mockGenerateContent.mockRejectedValue(notFoundError);

      await expect(translateSrtEntries(entries, "ja", "fake-key")).rejects.toThrow(
        /Default Gemini model 'gemini-3.8-flash' not found or may be retired by Google/,
      );

      // Crucial: Must only call once without retrying 4 times!
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    });

    it("should return Japanese error when lang is ja", async () => {
      const entries: SrtEntry[] = [
        {
          id: 1,
          startTime: "00:00:01,000",
          endTime: "00:00:02,000",
          text: "Hello",
        },
      ];

      const notFoundError = new Error(
        "models/gemini-3.8-flash is not found for API version v1beta",
      );
      (notFoundError as { status?: number }).status = 404;
      mockGenerateContent.mockRejectedValue(notFoundError);

      await expect(
        translateSrtEntries(entries, "ja", "fake-key", false, undefined, { lang: "ja" }),
      ).rejects.toThrow(
        /デフォルトの Gemini モデル 'gemini-3.8-flash' が見つからないか、Google により提供終了（退役）した可能性があります/,
      );
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    });

    it("should fail fast without retrying when custom model is not found", async () => {
      const entries: SrtEntry[] = [
        {
          id: 1,
          startTime: "00:00:01,000",
          endTime: "00:00:02,000",
          text: "Hello",
        },
      ];

      const notFoundError = new Error("Publisher Model gemini-nonexistent was not found");
      mockGenerateContent.mockRejectedValue(notFoundError);

      await expect(
        translateSrtEntries(entries, "ja", "fake-key", false, undefined, {
          model: "gemini-nonexistent",
        }),
      ).rejects.toThrow(/Specified Gemini model 'gemini-nonexistent' was not found/);

      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    });

    it("should send responseSchema with Type.ARRAY of Type.STRING in generateContent config", async () => {
      const entries: SrtEntry[] = [
        {
          id: 1,
          startTime: "00:00:01,000",
          endTime: "00:00:02,000",
          text: "Structured output test",
        },
      ];

      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify(["構造化出力テスト"]),
      });

      await translateSrtEntries(entries, "ja", "fake-key");

      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
      const callArgs = mockGenerateContent.mock.calls[0]?.[0];
      expect(callArgs.config).toEqual({
        responseMimeType: "application/json",
        responseSchema: {
          type: "ARRAY",
          items: {
            type: "STRING",
          },
          description: expect.stringContaining(
            "Array of translated subtitle texts matching 1-to-1",
          ),
        },
      });
    });

    it("should inject preceding context of default 5 lines into subsequent chunks and not chunk 1", async () => {
      const entries: SrtEntry[] = [];
      for (let i = 1; i <= 60; i++) {
        entries.push({
          id: i,
          startTime: "00:00:00,000",
          endTime: "00:00:01,000",
          text: `Sentence ${i}`,
        });
      }

      mockGenerateContent
        .mockResolvedValueOnce({
          text: JSON.stringify(Array.from({ length: 50 }, (_, i) => `文 ${i + 1}`)),
        })
        .mockResolvedValueOnce({
          text: JSON.stringify(Array.from({ length: 10 }, (_, i) => `文 ${i + 51}`)),
        });

      await translateSrtEntries(entries, "ja", "fake-key", false, undefined, { concurrency: 1 });

      expect(mockGenerateContent).toHaveBeenCalledTimes(2);

      // Chunk 1 (first 50 items): must NOT have PRECEDING CONTEXT
      const call1Args = mockGenerateContent.mock.calls[0]?.[0];
      expect(call1Args.contents).not.toContain("PRECEDING CONTEXT");
      expect(call1Args.contents).not.toContain('5. Translate ONLY the items in "Input Array"');

      // Chunk 2 (last 10 items): MUST have PRECEDING CONTEXT with items 46..50
      const call2Args = mockGenerateContent.mock.calls[1]?.[0];
      expect(call2Args.contents).toContain(
        "PRECEDING CONTEXT (FOR REFERENCE ONLY - DO NOT TRANSLATE):",
      );
      expect(call2Args.contents).toContain(
        '5. Translate ONLY the items in "Input Array". Do NOT translate, output, or include items from "Preceding Context".',
      );
      expect(call2Args.contents).toContain('"Sentence 46"');
      expect(call2Args.contents).toContain('"Sentence 47"');
      expect(call2Args.contents).toContain('"Sentence 48"');
      expect(call2Args.contents).toContain('"Sentence 49"');
      expect(call2Args.contents).toContain('"Sentence 50"');
      expect(call2Args.contents).not.toContain('"Sentence 45"');
    });

    it("should respect custom contextWindowSize option", async () => {
      const entries: SrtEntry[] = [];
      for (let i = 1; i <= 60; i++) {
        entries.push({
          id: i,
          startTime: "00:00:00,000",
          endTime: "00:00:01,000",
          text: `Line ${i}`,
        });
      }

      mockGenerateContent
        .mockResolvedValueOnce({
          text: JSON.stringify(Array.from({ length: 50 }, (_, i) => `訳 ${i + 1}`)),
        })
        .mockResolvedValueOnce({
          text: JSON.stringify(Array.from({ length: 10 }, (_, i) => `訳 ${i + 51}`)),
        });

      await translateSrtEntries(entries, "ja", "fake-key", false, undefined, {
        concurrency: 1,
        contextWindowSize: 2,
      });

      const call2Args = mockGenerateContent.mock.calls[1]?.[0];
      expect(call2Args.contents).toContain("PRECEDING CONTEXT");
      expect(call2Args.contents).toContain('"Line 49"');
      expect(call2Args.contents).toContain('"Line 50"');
      expect(call2Args.contents).not.toContain('"Line 48"');
    });

    it("should disable sliding context window when contextWindowSize is 0", async () => {
      const entries: SrtEntry[] = [];
      for (let i = 1; i <= 60; i++) {
        entries.push({
          id: i,
          startTime: "00:00:00,000",
          endTime: "00:00:01,000",
          text: `Line ${i}`,
        });
      }

      mockGenerateContent
        .mockResolvedValueOnce({
          text: JSON.stringify(Array.from({ length: 50 }, (_, i) => `訳 ${i + 1}`)),
        })
        .mockResolvedValueOnce({
          text: JSON.stringify(Array.from({ length: 10 }, (_, i) => `訳 ${i + 51}`)),
        });

      await translateSrtEntries(entries, "ja", "fake-key", false, undefined, {
        concurrency: 1,
        contextWindowSize: 0,
      });

      const call2Args = mockGenerateContent.mock.calls[1]?.[0];
      expect(call2Args.contents).not.toContain("PRECEDING CONTEXT");
      expect(call2Args.contents).not.toContain('5. Translate ONLY the items in "Input Array"');
    });

    it("should export DEFAULT_CONTEXT_WINDOW_SIZE as 5", () => {
      expect(DEFAULT_CONTEXT_WINDOW_SIZE).toBe(5);
    });
  });

  describe("isModelNotFoundError", () => {
    it("should identify 404 status", () => {
      const err = new Error("Resource not found");
      (err as { status?: number }).status = 404;
      expect(isModelNotFoundError(err)).toBe(true);
    });

    it("should identify NOT_FOUND in message", () => {
      expect(isModelNotFoundError(new Error("NOT_FOUND: model does not exist"))).toBe(true);
    });

    it("should identify model not found phrases", () => {
      expect(
        isModelNotFoundError(new Error("models/gemini-old is not found for API version")),
      ).toBe(true);
      expect(isModelNotFoundError(new Error("The model is not supported"))).toBe(true);
    });

    it("should return false for transient or other errors", () => {
      expect(isModelNotFoundError(new Error("Network Timeout"))).toBe(false);
      expect(isModelNotFoundError(new Error("Rate limit exceeded 429"))).toBe(false);
      expect(isModelNotFoundError(null)).toBe(false);
      expect(isModelNotFoundError(undefined)).toBe(false);
    });
  });

  describe("formatModelNotFoundError", () => {
    it("should return actionable update instructions in English by default", () => {
      const message = formatModelNotFoundError("gemini-3.8-flash");
      expect(message).toContain("Default Gemini model 'gemini-3.8-flash'");
      expect(message).toContain("npm install -g vsub-cli");
      expect(message).toContain("--gemini-model");
      expect(message).toContain("https://ai.google.dev/gemini-api/docs/models");
    });

    it("should return actionable update instructions in Japanese when lang is ja", () => {
      const message = formatModelNotFoundError("gemini-3.8-flash", "ja");
      expect(message).toContain("デフォルトの Gemini モデル 'gemini-3.8-flash'");
      expect(message).toContain("npm install -g vsub-cli");
      expect(message).toContain("--gemini-model");
      expect(message).toContain("https://ai.google.dev/gemini-api/docs/models");
    });

    it("should return clear message for custom model in English by default", () => {
      const message = formatModelNotFoundError("custom-test-model");
      expect(message).toContain("Specified Gemini model 'custom-test-model' was not found");
      expect(message).toContain("https://ai.google.dev/gemini-api/docs/models");
      expect(message).not.toContain("npm install -g vsub-cli");
    });

    it("should return clear message for custom model in Japanese when lang is ja", () => {
      const message = formatModelNotFoundError("custom-test-model", "ja");
      expect(message).toContain(
        "指定された Gemini モデル 'custom-test-model' が見つかりませんでした",
      );
      expect(message).toContain("https://ai.google.dev/gemini-api/docs/models");
      expect(message).not.toContain("npm install -g vsub-cli");
    });
  });
});
