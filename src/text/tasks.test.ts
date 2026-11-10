import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SrtEntry } from "../srt.js";
import { createGeminiTextModel } from "./gemini.js";
import type { TextModel } from "./model.js";
import {
  asyncPool,
  buildTranslationPrompt,
  DEFAULT_CONTEXT_WINDOW_SIZE,
  generateChapters,
  generateSummary,
  translateSrtEntries,
} from "./tasks.js";

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
    ThinkingLevel: {
      LOW: "LOW",
    },
  };
});

describe("src/text/tasks.ts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const defaultModel = createGeminiTextModel("fake-key", "gemini-3.8-flash");

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
      const result = await translateSrtEntries([], "ja", defaultModel);
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

      const result = await translateSrtEntries(entries, "ja", defaultModel);

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

      const result = await translateSrtEntries(entries, "ja", defaultModel);
      expect(result[0]?.text).toBe("テスト");
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

      await translateSrtEntries(entries, "ja", defaultModel);

      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
      const callArgs = mockGenerateContent.mock.calls[0]?.[0];
      expect(callArgs.config).toEqual({
        responseMimeType: "application/json",
        responseSchema: {
          type: "ARRAY",
          items: {
            type: "STRING",
          },
          description:
            "Array of translated subtitle texts matching 1-to-1 with the input array (1 items).",
        },
        thinkingConfig: {
          thinkingLevel: "LOW",
        },
      });
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

      const result = await translateSrtEntries(entries, "ja", defaultModel, false, undefined, {
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

    it("should use model.limits.defaultConcurrency when options.concurrency is not provided", async () => {
      const entries: SrtEntry[] = [];
      for (let i = 1; i <= 100; i++) {
        entries.push({
          id: i,
          startTime: "00:00:00,000",
          endTime: "00:00:01,000",
          text: `Entry ${i}`,
        });
      }

      let activeWorkers = 0;
      let maxActiveWorkers = 0;

      const fakeModel: TextModel = {
        logLabel: "TestModel",
        model: "fake-test-model",
        limits: { defaultConcurrency: 1 },
        generateJson: async () => {
          activeWorkers++;
          maxActiveWorkers = Math.max(maxActiveWorkers, activeWorkers);
          await new Promise((resolve) => setTimeout(resolve, 20));
          activeWorkers--;
          return JSON.stringify(Array.from({ length: 50 }, () => "translated"));
        },
        classifyError: () => "retry",
        formatModelNotFound: () => "not found",
      };

      await translateSrtEntries(entries, "ja", fakeModel);
      expect(maxActiveWorkers).toBe(1);
    });

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
      await translateSrtEntries(entries, "ja", defaultModel, false, onProgress, { concurrency: 2 });

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

      const customModel = createGeminiTextModel("fake-key", "gemini-3.7-flash");
      await translateSrtEntries(entries, "ja", customModel, false, undefined, {
        prompt: "Use polite and professional Japanese (です・ます調).",
        glossary: {
          Antigravity: "アンチグラビティ",
          "agentic AI": "エージェンティックAI",
        },
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

      await expect(translateSrtEntries(entries, "ja", defaultModel)).rejects.toThrow(
        /Default Gemini model 'gemini-3.8-flash' not found or may be retired by Google/,
      );

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
        translateSrtEntries(entries, "ja", defaultModel, false, undefined, { lang: "ja" }),
      ).rejects.toThrow(
        /デフォルトの Gemini モデル 'gemini-3.8-flash' が見つからないか、Google により提供終了（退役）した可能性があります/,
      );
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
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

      await translateSrtEntries(entries, "ja", defaultModel, false, undefined, { concurrency: 1 });

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

      await translateSrtEntries(entries, "ja", defaultModel, false, undefined, {
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

      await translateSrtEntries(entries, "ja", defaultModel, false, undefined, {
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

  describe("generateChapters", () => {
    const sampleEntries: SrtEntry[] = [
      { id: 1, startTime: "00:00:00,000", endTime: "00:00:10,000", text: "Welcome everyone" },
      { id: 2, startTime: "00:01:23,000", endTime: "00:01:35,000", text: "Moving to agenda" },
      { id: 3, startTime: "00:05:40,000", endTime: "00:05:55,000", text: "Now for the demo" },
    ];

    it("should return empty array for empty entries", async () => {
      const chapters = await generateChapters([], defaultModel);
      expect(chapters).toEqual([]);
      expect(mockGenerateContent).not.toHaveBeenCalled();
    });

    it("should call Gemini with responseSchema and return formatted chapters", async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify([
          { timestamp: "00:00", seconds: 0, title: "オープニング" },
          { timestamp: "01:23", seconds: 83, title: "本日のアジェンダ" },
          { timestamp: "05:40", seconds: 340, title: "デモ紹介" },
        ]),
      });

      const chapters = await generateChapters(sampleEntries, defaultModel, {
        targetLang: "ja",
        prompt: "Concise chapters",
      });

      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
      const callArg = (
        mockGenerateContent.mock.calls[0] as [{ contents: string; config: unknown }]
      )[0];
      expect(callArg.contents).toContain("Concise chapters");
      expect(callArg.contents).toContain("[00:00:00] Welcome everyone");
      expect(callArg.config).toEqual({
        responseMimeType: "application/json",
        responseSchema: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              timestamp: {
                type: "STRING",
                description: "Timestamp in MM:SS or HH:MM:SS format",
              },
              seconds: {
                type: "INTEGER",
                description: "Total seconds from start",
              },
              title: {
                type: "STRING",
                description: "Concise chapter title in target language",
              },
            },
            required: ["timestamp", "title"],
          },
          description: "Chronological list of video chapters",
        },
        thinkingConfig: {
          thinkingLevel: "LOW",
        },
      });
      expect(chapters).toEqual([
        { timestamp: "00:00", seconds: 0, title: "オープニング" },
        { timestamp: "01:23", seconds: 83, title: "本日のアジェンダ" },
        { timestamp: "05:40", seconds: 340, title: "デモ紹介" },
      ]);
    });

    it("should retry and succeed when first attempt returns array with null item", async () => {
      mockGenerateContent
        .mockResolvedValueOnce({
          text: JSON.stringify([null]),
        })
        .mockResolvedValueOnce({
          text: JSON.stringify([
            { timestamp: "00:00", seconds: 0, title: "Intro" },
            { timestamp: "01:00", seconds: 60, title: "Topic" },
          ]),
        });

      const chapters = await generateChapters(sampleEntries, defaultModel, { targetLang: "en" });
      expect(chapters).toEqual([
        { timestamp: "00:00", seconds: 0, title: "Intro" },
        { timestamp: "01:00", seconds: 60, title: "Topic" },
      ]);
      expect(mockGenerateContent).toHaveBeenCalledTimes(2);
    });

    it("should ensure first chapter starts at 00:00 if Gemini returns non-zero start", async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify([
          { timestamp: "01:00", seconds: 60, title: "Main Topic" },
          { timestamp: "05:00", seconds: 300, title: "Summary" },
        ]),
      });

      const chapters = await generateChapters(sampleEntries, defaultModel, { targetLang: "ja" });
      expect(chapters[0]?.timestamp).toBe("00:00");
      expect(chapters[0]?.seconds).toBe(0);
      expect(chapters[0]?.title).toBe("イントロダクション");
      expect(chapters[1]?.timestamp).toBe("01:00");
    });

    it("should adjust first chapter to 00:00 if it starts <= 30 seconds", async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify([
          { timestamp: "00:15", seconds: 15, title: "Welcome & Intro" },
          { timestamp: "02:00", seconds: 120, title: "Part 2" },
        ]),
      });

      const chapters = await generateChapters(sampleEntries, defaultModel, { targetLang: "en" });
      expect(chapters[0]?.timestamp).toBe("00:00");
      expect(chapters[0]?.seconds).toBe(0);
      expect(chapters[0]?.title).toBe("Welcome & Intro");
    });
  });

  describe("generateSummary", () => {
    const sampleEntries: SrtEntry[] = [
      { id: 1, startTime: "00:00:00,000", endTime: "00:00:15,000", text: "Hello and welcome" },
      {
        id: 2,
        startTime: "00:02:10,000",
        endTime: "00:02:30,000",
        text: "Discussing quarterly results",
      },
    ];

    it("should return empty summary structure for empty entries", async () => {
      const summary = await generateSummary([], defaultModel);
      expect(summary.title).toBe("No Content");
      expect(summary.keyPoints).toEqual([]);
      expect(mockGenerateContent).not.toHaveBeenCalled();
    });

    it("should call Gemini and return parsed summary result", async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          title: "Quarterly Review",
          summary: "Reviewed revenue and upcoming milestones.",
          keyPoints: ["Revenue up 20%", "Launched vsub-cli"],
          topics: [
            { timestamp: "00:00", title: "Intro", description: "Opening remarks" },
            { timestamp: "02:10", title: "Financials", description: "Detailed charts" },
          ],
        }),
      });

      const summary = await generateSummary(sampleEntries, defaultModel, {
        targetLang: "ja",
        prompt: "Focus on finance",
      });

      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
      const callArg = (
        mockGenerateContent.mock.calls[0] as [{ contents: string; config: unknown }]
      )[0];
      expect(callArg.contents).toContain("Focus on finance");
      expect(callArg.config).toEqual({
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            title: {
              type: "STRING",
              description: "Content title in target language",
            },
            summary: {
              type: "STRING",
              description: "Executive summary paragraph in target language",
            },
            keyPoints: {
              type: "ARRAY",
              items: { type: "STRING" },
              description: "List of key takeaways in target language",
            },
            topics: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  timestamp: {
                    type: "STRING",
                    description: "Timestamp in MM:SS or HH:MM:SS",
                  },
                  title: {
                    type: "STRING",
                    description: "Topic title in target language",
                  },
                  description: {
                    type: "STRING",
                    description: "Brief description of topic",
                  },
                },
                required: ["timestamp", "title", "description"],
              },
              description: "Key topics with timestamps",
            },
          },
          required: ["title", "summary", "keyPoints", "topics"],
        },
        thinkingConfig: {
          thinkingLevel: "LOW",
        },
      });
      expect(summary.title).toBe("Quarterly Review");
      expect(summary.keyPoints).toHaveLength(2);
      expect(summary.topics[1]?.timestamp).toBe("02:10");
    });

    it("should retry and succeed when first attempt returns null", async () => {
      mockGenerateContent
        .mockResolvedValueOnce({
          text: "null",
        })
        .mockResolvedValueOnce({
          text: JSON.stringify({
            title: "Summary Title",
            summary: "Summary text",
            keyPoints: ["Point"],
            topics: [{ timestamp: "00:00", title: "Intro", description: "Desc" }],
          }),
        });

      const summary = await generateSummary(sampleEntries, defaultModel, { targetLang: "en" });
      expect(summary.title).toBe("Summary Title");
      expect(mockGenerateContent).toHaveBeenCalledTimes(2);
    });
  });
});
