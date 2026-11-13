import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_GEMINI_MODEL } from "../config.js";
import {
  buildThinkingConfig,
  createGeminiTextModel,
  formatModelNotFoundError,
  isModelNotFoundError,
  resolveGeminiModel,
} from "./gemini.js";
import type { JsonRequest } from "./model.js";

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
      MINIMAL: "MINIMAL",
      LOW: "LOW",
      MEDIUM: "MEDIUM",
      HIGH: "HIGH",
    },
  };
});

describe("src/text/gemini.ts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("resolveGeminiModel", () => {
    it("should prioritize override over config and default", () => {
      expect(
        resolveGeminiModel(" custom-override ", {
          geminiModel: "config-model",
        }),
      ).toBe("custom-override");
    });

    it("should use config model if override is omitted or empty", () => {
      expect(resolveGeminiModel(undefined, { geminiModel: " config-model " })).toBe("config-model");
      expect(resolveGeminiModel("", { geminiModel: "config-model" })).toBe("config-model");
    });

    it("should use DEFAULT_GEMINI_MODEL if neither is provided", () => {
      expect(resolveGeminiModel(undefined, {})).toBe(DEFAULT_GEMINI_MODEL);
      expect(resolveGeminiModel(undefined, undefined)).toBe(DEFAULT_GEMINI_MODEL);
    });
  });

  describe("createGeminiTextModel", () => {
    const dummyKey = "test-api-key";
    const dummyModel = "gemini-3.8-flash";

    it("should expose correct properties and limits", () => {
      const model = createGeminiTextModel(dummyKey, dummyModel);
      expect(model.logLabel).toBe("Gemini API");
      expect(model.model).toBe(dummyModel);
      expect(model.limits).toEqual({ defaultConcurrency: 3 });
    });

    it("should convert translation JsonRequest to Gemini generateContent request matching legacy format", async () => {
      mockGenerateContent.mockResolvedValue({ text: '["translated"]' });
      const model = createGeminiTextModel(dummyKey, dummyModel);

      const request: JsonRequest = {
        prompt: "Translate this",
        schemaName: "translation",
        schema: {
          type: "array",
          items: { type: "string" },
          description:
            "Array of translated subtitle texts matching 1-to-1 with the input array (2 items).",
        },
      };

      const result = await model.generateJson(request);
      expect(result).toBe('["translated"]');
      expect(mockGenerateContent).toHaveBeenCalledWith({
        model: dummyModel,
        contents: "Translate this",
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "ARRAY",
            items: { type: "STRING" },
            description:
              "Array of translated subtitle texts matching 1-to-1 with the input array (2 items).",
          },
          thinkingConfig: {
            thinkingLevel: "LOW",
          },
        },
      });
    });

    it("should convert chapters JsonRequest matching legacy format", async () => {
      mockGenerateContent.mockResolvedValue({ text: "[]" });
      const model = createGeminiTextModel(dummyKey, dummyModel);

      const request: JsonRequest = {
        prompt: "Generate chapters",
        schemaName: "chapters",
        schema: {
          type: "array",
          items: {
            type: "object",
            properties: {
              timestamp: {
                type: "string",
                description: "Timestamp in MM:SS or HH:MM:SS format",
              },
              seconds: {
                type: "integer",
                description: "Total seconds from start",
              },
              title: {
                type: "string",
                description: "Concise chapter title in target language",
              },
            },
            required: ["timestamp", "title"],
          },
          description: "Chronological list of video chapters",
        },
      };

      await model.generateJson(request);
      expect(mockGenerateContent).toHaveBeenCalledWith({
        model: dummyModel,
        contents: "Generate chapters",
        config: {
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
        },
      });
    });

    it("should convert summary JsonRequest matching legacy format", async () => {
      mockGenerateContent.mockResolvedValue({ text: "{}" });
      const model = createGeminiTextModel(dummyKey, dummyModel);

      const request: JsonRequest = {
        prompt: "Generate summary",
        schemaName: "summary",
        schema: {
          type: "object",
          properties: {
            title: {
              type: "string",
              description: "Content title in target language",
            },
            summary: {
              type: "string",
              description: "Executive summary paragraph in target language",
            },
            keyPoints: {
              type: "array",
              items: { type: "string" },
              description: "List of key takeaways in target language",
            },
            topics: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  timestamp: {
                    type: "string",
                    description: "Timestamp in MM:SS or HH:MM:SS",
                  },
                  title: {
                    type: "string",
                    description: "Topic title in target language",
                  },
                  description: {
                    type: "string",
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
      };

      await model.generateJson(request);
      expect(mockGenerateContent).toHaveBeenCalledWith({
        model: dummyModel,
        contents: "Generate summary",
        config: {
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
        },
      });
    });

    describe("classifyError", () => {
      const model = createGeminiTextModel(dummyKey, dummyModel);

      it.each([
        {
          desc: "status 404",
          error: Object.assign(new Error("not found"), { status: 404 }),
          expected: "model-not-found",
        },
        {
          desc: "message contains NOT_FOUND",
          error: new Error("Model NOT_FOUND: discontinued"),
          expected: "model-not-found",
        },
        {
          desc: "status 429",
          error: Object.assign(new Error("rate limit"), { status: 429 }),
          expected: "rate-limit",
        },
        {
          desc: "message contains RESOURCE_EXHAUSTED",
          error: new Error("429 RESOURCE_EXHAUSTED: quota exceeded"),
          expected: "rate-limit",
        },
        {
          desc: "message contains quota",
          error: new Error("User quota reached"),
          expected: "rate-limit",
        },
        {
          desc: "generic error",
          error: new Error("Connection reset by peer"),
          expected: "retry",
        },
      ])("should classify $desc as $expected", ({ error, expected }) => {
        expect(model.classifyError(error)).toBe(expected);
      });
    });

    it("formatModelNotFound should call formatModelNotFoundError", () => {
      const model = createGeminiTextModel(dummyKey, "custom-model");
      expect(model.formatModelNotFound("en")).toContain(
        "Specified Gemini model 'custom-model' was not found",
      );
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

  describe("buildThinkingConfig", () => {
    it.each(["minimal", "low", "medium", "high"] as const)(
      "uses %s for supported models only",
      async (effort) => {
        expect(buildThinkingConfig("models/gemini-3-test", effort)).toEqual({
          thinkingConfig: { thinkingLevel: effort.toUpperCase() },
        });
        for (const name of ["gemini-2.5-flash", "unknown"])
          expect(buildThinkingConfig(name, effort)).toEqual({});
        mockGenerateContent.mockResolvedValue({ text: "{}" });
        await createGeminiTextModel("test-key-1234", "gemini-3-test", effort).generateJson({
          prompt: "Test",
          schemaName: "test",
          schema: { type: "object" },
        });
        expect(mockGenerateContent).toHaveBeenCalledWith(
          expect.objectContaining({
            config: expect.objectContaining({
              thinkingConfig: { thinkingLevel: effort.toUpperCase() },
            }),
          }),
        );
      },
    );
    it.each([
      {
        model: "gemini-3.8-flash",
        expected: { thinkingConfig: { thinkingLevel: "LOW" } },
      },
      {
        model: "models/gemini-3.8-flash",
        expected: { thinkingConfig: { thinkingLevel: "LOW" } },
      },
      {
        model: "gemini-3-pro-preview",
        expected: { thinkingConfig: { thinkingLevel: "LOW" } },
      },
      {
        model: "gemini-3.5-flash-lite",
        expected: { thinkingConfig: { thinkingLevel: "LOW" } },
      },
      {
        model: "gemini-4-argon",
        expected: { thinkingConfig: { thinkingLevel: "LOW" } },
      },
      {
        model: "gemini-2.5-flash",
        expected: {},
      },
      {
        model: "gemini-2.0-flash",
        expected: {},
      },
      {
        model: "gemini-1.5-pro",
        expected: {},
      },
      {
        model: "gemini-flash-latest",
        expected: {},
      },
      {
        model: "gemma-3-27b-it",
        expected: {},
      },
      {
        model: "tunedModels/my-model",
        expected: {},
      },
    ])("should return $expected for model '$model'", ({ model, expected }) => {
      expect(buildThinkingConfig(model)).toEqual(expected);
    });
  });
});
