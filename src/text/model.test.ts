import { stripVTControlCharacters } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupportedLanguage } from "../i18n/index.js";
import {
  generateJsonWithRetry,
  type JsonRequest,
  type TextModel,
  type TextModelErrorKind,
} from "./model.js";

function createMockTextModel(overrides?: Partial<TextModel>): TextModel {
  return {
    logLabel: "MockLLM",
    model: "mock-model",
    limits: { defaultConcurrency: 3 },
    generateJson: vi.fn(),
    classifyError: (err: unknown): TextModelErrorKind => {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("not-found")) return "model-not-found";
      if (msg.includes("rate-limit") || msg.includes("429")) return "rate-limit";
      if (msg.includes("fatal")) return "fatal";
      return "retry";
    },
    formatModelNotFound: (_lang?: SupportedLanguage) =>
      "Model mock-model was not found. Please check model name.",
    ...overrides,
  };
}

const dummyRequest: JsonRequest = {
  prompt: "test prompt",
  schema: { type: "array", items: { type: "string" } },
  schemaName: "testSchema",
};

describe("generateJsonWithRetry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should succeed on first attempt and strip markdown json fencing", async () => {
    const model = createMockTextModel({
      generateJson: vi.fn().mockResolvedValue('```json\n["hello", "world"]\n```'),
    });

    const result = await generateJsonWithRetry(model, dummyRequest, (val) => val as string[], {
      task: "test task",
    });

    expect(result).toEqual(["hello", "world"]);
    expect(model.generateJson).toHaveBeenCalledTimes(1);
    expect(model.generateJson).toHaveBeenCalledWith(dummyRequest);
  });

  it("should retry and succeed on second attempt when parse throws or invalid JSON", async () => {
    vi.useFakeTimers();
    const model = createMockTextModel({
      generateJson: vi
        .fn()
        .mockResolvedValueOnce("not valid json")
        .mockResolvedValueOnce('["valid"]'),
    });

    const promise = generateJsonWithRetry(
      model,
      dummyRequest,
      (val) => {
        if (!Array.isArray(val)) throw new Error("not array");
        return val as string[];
      },
      { task: "test task" },
    );

    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toEqual(["valid"]);
    expect(model.generateJson).toHaveBeenCalledTimes(2);
  });

  it("should throw after 4 failed attempts with where clause", async () => {
    vi.useFakeTimers();
    const model = createMockTextModel({
      generateJson: vi.fn().mockRejectedValue(new Error("Network connection lost")),
    });

    const promise = generateJsonWithRetry(model, dummyRequest, (val) => val, {
      task: "translation",
      where: "chunk 2/5",
    });
    const assertion = expect(promise).rejects.toThrow(
      "MockLLM translation failed after 4 attempts on chunk 2/5: Network connection lost",
    );

    await vi.runAllTimersAsync();
    await assertion;
    expect(model.generateJson).toHaveBeenCalledTimes(4);
  });

  it("should throw after 4 failed attempts without where clause", async () => {
    vi.useFakeTimers();
    const model = createMockTextModel({
      generateJson: vi.fn().mockRejectedValue(new Error("Server error 500")),
    });

    const promise = generateJsonWithRetry(model, dummyRequest, (val) => val, {
      task: "chapters generation",
    });
    const assertion = expect(promise).rejects.toThrow(
      "MockLLM chapters generation failed after 4 attempts: Server error 500",
    );

    await vi.runAllTimersAsync();
    await assertion;
    expect(model.generateJson).toHaveBeenCalledTimes(4);
  });

  it("should fail immediately on model-not-found error without retrying", async () => {
    const model = createMockTextModel({
      generateJson: vi.fn().mockRejectedValue(new Error("model not-found error")),
      formatModelNotFound: () => "Custom formatted not found message",
    });

    await expect(
      generateJsonWithRetry(model, dummyRequest, (val) => val, { task: "translation" }),
    ).rejects.toThrow("Custom formatted not found message");

    expect(model.generateJson).toHaveBeenCalledTimes(1);
  });

  it("should fail immediately on fatal error without retrying", async () => {
    const fatalError = new Error("fatal auth failure");
    const model = createMockTextModel({
      generateJson: vi.fn().mockRejectedValue(fatalError),
    });

    await expect(
      generateJsonWithRetry(model, dummyRequest, (val) => val, { task: "translation" }),
    ).rejects.toThrow("fatal auth failure");

    expect(model.generateJson).toHaveBeenCalledTimes(1);
  });

  it("should use 1.5s base backoff for standard retry and 3s for rate-limit", async () => {
    vi.useFakeTimers();
    // 1. Standard retry (1.5s base, attempt 1 -> base 1500ms + jitter 0..1000ms)
    const retryModel = createMockTextModel({
      generateJson: vi
        .fn()
        .mockRejectedValueOnce(new Error("temporary error"))
        .mockResolvedValueOnce('["ok"]'),
    });

    const retryPromise = generateJsonWithRetry(retryModel, dummyRequest, (v) => v, {
      task: "test",
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(retryModel.generateJson).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1499);
    expect(retryModel.generateJson).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1001); // 1500 + 1000 jitter = 2500 max
    expect(retryModel.generateJson).toHaveBeenCalledTimes(2);
    await retryPromise;

    // 2. Rate limit retry (3s base, attempt 1 -> base 3000ms + jitter 0..1000ms)
    const rateLimitModel = createMockTextModel({
      generateJson: vi
        .fn()
        .mockRejectedValueOnce(new Error("429 rate-limit"))
        .mockResolvedValueOnce('["ok"]'),
    });

    const rateLimitPromise = generateJsonWithRetry(rateLimitModel, dummyRequest, (v) => v, {
      task: "test",
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(rateLimitModel.generateJson).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2999);
    expect(rateLimitModel.generateJson).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1001); // 3000 + 1000 jitter = 4000 max
    expect(rateLimitModel.generateJson).toHaveBeenCalledTimes(2);
    await rateLimitPromise;
  });

  it("should output verbose logs with where clause and without where clause", async () => {
    vi.useFakeTimers();
    const stdout = vi.spyOn(console, "log").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // With where clause
    const modelWithWhere = createMockTextModel({
      generateJson: vi
        .fn()
        .mockRejectedValueOnce(new Error("fail 1"))
        .mockResolvedValueOnce('["ok"]'),
    });

    const p1 = generateJsonWithRetry(modelWithWhere, dummyRequest, (v) => v, {
      task: "translation",
      where: "chunk 1/3",
      verbose: true,
    });
    await vi.runAllTimersAsync();
    await p1;

    expect(
      logSpy.mock.calls.map(([line]) => stripVTControlCharacters(String(line))),
    ).toContainEqual(
      expect.stringMatching(
        /^\[MockLLM\] Error on chunk 1\/3 \(attempt 1\/4, retrying in \d+ms\): fail 1$/,
      ),
    );
    expect(logSpy.mock.calls.map(([line]) => stripVTControlCharacters(String(line)))).toContain(
      "[MockLLM] Retry attempt 2/4 for chunk 1/3...",
    );

    logSpy.mockClear();

    // Without where clause
    const modelWithoutWhere = createMockTextModel({
      generateJson: vi
        .fn()
        .mockRejectedValueOnce(new Error("fail 2"))
        .mockResolvedValueOnce('["ok"]'),
    });

    const p2 = generateJsonWithRetry(modelWithoutWhere, dummyRequest, (v) => v, {
      task: "chapters generation",
      verbose: true,
    });
    await vi.runAllTimersAsync();
    await p2;

    expect(
      logSpy.mock.calls.map(([line]) => stripVTControlCharacters(String(line))),
    ).toContainEqual(
      expect.stringMatching(
        /^\[MockLLM\] Error during chapters generation \(attempt 1\/4, retrying in \d+ms\): fail 2$/,
      ),
    );
    expect(logSpy.mock.calls.map(([line]) => stripVTControlCharacters(String(line)))).toContain(
      "[MockLLM] Retry attempt 2/4 for chapters generation...",
    );

    expect(stdout).not.toHaveBeenCalled();
    stdout.mockRestore();
    logSpy.mockRestore();
  });
});
