import { describe, expect, it, vi } from "vitest";
import type { JsonRequest, TextModelErrorKind } from "./model.js";
import {
  createOpenAICompatibleTextModel,
  type OpenAICompatibleTextProfile,
} from "./openai-compatible.js";
import { createGenericTextProfile } from "./openai-compatible-provider.js";

describe("createOpenAICompatibleTextModel", () => {
  const dummyProfile: OpenAICompatibleTextProfile = {
    logLabel: "OpenRouter API",
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "google/gemini-3.8-flash",
    limits: {
      defaultConcurrency: 3,
    },
    maxTokens: 16384,
    reasoning: { effort: "low" },
    requestTimeoutMs: 120_000,
    messages: {
      modelNotFound: (model, isDefault) =>
        isDefault ? `Default model '${model}' not found` : `Custom model '${model}' not found`,
      insufficientCredits: () => "402 Insufficient credits error message",
    },
  };

  const sampleRequest: JsonRequest = {
    prompt: "Translate this text",
    schema: {
      type: "object",
      properties: {
        translatedText: { type: "string" },
      },
      required: ["translatedText"],
    },
    schemaName: "translation",
  };

  it("sends top-level reasoning effort from a generic profile", async () => {
    const fakeFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ choices: [{ message: { content: "{}" } }] }));
    await createOpenAICompatibleTextModel(
      { ...createGenericTextProfile("http://localhost:11434/v1"), reasoningEffort: "High" },
      "",
      "test-model",
      { fetch: fakeFetch },
    ).generateJson(sampleRequest);
    const body = JSON.parse(String(fakeFetch.mock.calls[0]?.[1]?.body));
    expect(body.reasoning_effort).toBe("High");
    expect(body).not.toHaveProperty("reasoning");
    expect(body).not.toHaveProperty("max_tokens");
  });

  it("should send correct URL, method, headers, signal, and full JSON body", async () => {
    let capturedUrl: string | undefined;
    let capturedInit: RequestInit | undefined;

    const fakeFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedInit = init;
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: { content: JSON.stringify({ translatedText: "Hello" }) },
              finish_reason: "stop",
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    const model = createOpenAICompatibleTextModel(
      dummyProfile,
      "test-api-key",
      "google/gemini-3.8-flash",
      { fetch: fakeFetch as unknown as typeof fetch },
    );

    const rawResponse = await model.generateJson(sampleRequest);

    expect(capturedUrl).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(capturedInit?.method).toBe("POST");
    expect(capturedInit?.headers).toEqual({
      Authorization: "Bearer test-api-key",
      "Content-Type": "application/json",
    });
    expect(capturedInit?.signal).toBeDefined();

    const parsedBody = JSON.parse(String(capturedInit?.body));
    expect(parsedBody).toEqual({
      model: "google/gemini-3.8-flash",
      messages: [{ role: "user", content: "Translate this text" }],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "translation",
          strict: true,
          schema: {
            type: "object",
            properties: {
              translatedText: { type: "string" },
            },
            required: ["translatedText"],
          },
        },
      },
      reasoning: { effort: "low" },
      max_tokens: 16384,
    });

    expect(rawResponse).toBe(JSON.stringify({ translatedText: "Hello" }));
  });

  it("should omit reasoning field if undefined in profile", async () => {
    let capturedInit: RequestInit | undefined;
    const profileWithoutReasoning: OpenAICompatibleTextProfile = {
      ...dummyProfile,
      reasoning: undefined,
    };

    const fakeFetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      capturedInit = init;
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "{}" } }],
        }),
        { status: 200 },
      );
    });

    const model = createOpenAICompatibleTextModel(
      profileWithoutReasoning,
      "test-api-key",
      "custom/model",
      { fetch: fakeFetch as unknown as typeof fetch },
    );

    await model.generateJson(sampleRequest);
    const parsedBody = JSON.parse(String(capturedInit?.body));
    expect(parsedBody).not.toHaveProperty("reasoning");
  });

  describe("classifyError", () => {
    const table: Array<{
      desc: string;
      error: unknown;
      expected: TextModelErrorKind;
    }> = [
      {
        desc: "status 404",
        error: Object.assign(new Error("Not found"), { status: 404 }),
        expected: "model-not-found",
      },
      {
        desc: "not a valid model message",
        error: new Error("Model is not a valid model on this endpoint"),
        expected: "model-not-found",
      },
      {
        desc: "No endpoints found message",
        error: new Error("No endpoints found for requested model"),
        expected: "model-not-found",
      },
      {
        desc: "model.*not found message",
        error: new Error("model google/foo not found"),
        expected: "model-not-found",
      },
      {
        desc: "status 429",
        error: Object.assign(new Error("Rate limit exceeded"), { status: 429 }),
        expected: "rate-limit",
      },
      {
        desc: "status 408",
        error: Object.assign(new Error("Request timeout"), { status: 408 }),
        expected: "retry",
      },
      {
        desc: "status 500",
        error: Object.assign(new Error("Internal Server Error"), { status: 500 }),
        expected: "retry",
      },
      {
        desc: "status 502",
        error: Object.assign(new Error("Bad Gateway"), { status: 502 }),
        expected: "retry",
      },
      {
        desc: "status 503",
        error: Object.assign(new Error("Service Unavailable"), { status: 503 }),
        expected: "retry",
      },
      {
        desc: "status 504",
        error: Object.assign(new Error("Gateway Timeout"), { status: 504 }),
        expected: "retry",
      },
      {
        desc: "status 524",
        error: Object.assign(new Error("A timeout occurred"), { status: 524 }),
        expected: "retry",
      },
      {
        desc: "status 529",
        error: Object.assign(new Error("Site is overloaded"), { status: 529 }),
        expected: "retry",
      },
      {
        desc: "network error (fetch threw TypeError)",
        error: new TypeError("fetch failed"),
        expected: "retry",
      },
      {
        desc: "timeout error",
        error: new Error("The operation was aborted due to timeout"),
        expected: "retry",
      },
      {
        desc: "finish_reason length",
        error: new Error("OpenRouter API response truncated: finish_reason is length"),
        expected: "retry",
      },
      {
        desc: "empty content",
        error: new Error("OpenRouter API returned empty or non-string content"),
        expected: "retry",
      },
      {
        desc: "status 402",
        error: Object.assign(new Error("Insufficient Credits"), { status: 402 }),
        expected: "fatal",
      },
      {
        desc: "status 400",
        error: Object.assign(new Error("Bad Request"), { status: 400 }),
        expected: "fatal",
      },
      {
        desc: "status 401",
        error: Object.assign(new Error("Unauthorized"), { status: 401 }),
        expected: "fatal",
      },
      {
        desc: "status 403",
        error: Object.assign(new Error("Forbidden"), { status: 403 }),
        expected: "fatal",
      },
      {
        desc: "status 413",
        error: Object.assign(new Error("Payload Too Large"), { status: 413 }),
        expected: "fatal",
      },
      {
        desc: "status 501 (other 5xx not in retryable list)",
        error: Object.assign(new Error("Not Implemented"), { status: 501 }),
        expected: "fatal",
      },
    ];

    it.each(table)("should classify $desc as $expected", ({ error, expected }) => {
      const model = createOpenAICompatibleTextModel(dummyProfile, "key", "model");
      expect(model.classifyError(error)).toBe(expected);
    });
  });

  it("should throw error with code and message if 200 response contains error object", async () => {
    const fakeFetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          error: {
            message: "User account suspended",
            code: 403,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    const model = createOpenAICompatibleTextModel(dummyProfile, "key", "model", {
      fetch: fakeFetch as unknown as typeof fetch,
    });

    await expect(model.generateJson(sampleRequest)).rejects.toThrow(
      "OpenRouter API error 403: User account suspended",
    );
  });

  it("should throw insufficientCredits message when 402 is returned", async () => {
    const fakeFetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          error: {
            message: "Key has insufficient balance",
            code: 402,
          },
        }),
        { status: 402, headers: { "Content-Type": "application/json" } },
      );
    });

    const model = createOpenAICompatibleTextModel(dummyProfile, "key", "model", {
      fetch: fakeFetch as unknown as typeof fetch,
    });

    await expect(model.generateJson(sampleRequest)).rejects.toThrow(
      "402 Insufficient credits error message",
    );
  });

  it("should throw error on finish_reason = length", async () => {
    const fakeFetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: "length",
              message: { content: "partial" },
            },
          ],
        }),
        { status: 200 },
      );
    });

    const model = createOpenAICompatibleTextModel(dummyProfile, "key", "model", {
      fetch: fakeFetch as unknown as typeof fetch,
    });

    await expect(model.generateJson(sampleRequest)).rejects.toThrow(/finish_reason is length/);
  });

  it("should throw error on empty or non-string content", async () => {
    const fakeFetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: "stop",
              message: { content: "" },
            },
          ],
        }),
        { status: 200 },
      );
    });

    const model = createOpenAICompatibleTextModel(dummyProfile, "key", "model", {
      fetch: fakeFetch as unknown as typeof fetch,
    });

    await expect(model.generateJson(sampleRequest)).rejects.toThrow(/empty or non-string content/);
  });

  it("should format model not found using profile messages", () => {
    const defaultModel = createOpenAICompatibleTextModel(
      dummyProfile,
      "key",
      "google/gemini-3.8-flash",
    );
    expect(defaultModel.formatModelNotFound()).toBe(
      "Default model 'google/gemini-3.8-flash' not found",
    );

    const customModel = createOpenAICompatibleTextModel(dummyProfile, "key", "custom/model");
    expect(customModel.formatModelNotFound()).toBe("Custom model 'custom/model' not found");
  });
});
