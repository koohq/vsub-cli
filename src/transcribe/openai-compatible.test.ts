import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import {
  createOpenAICompatibleTranscriber,
  type OpenAICompatibleSttProfile,
} from "./openai-compatible.js";

function jsonResponse(status: number, body: unknown, headers?: Record<string, string>): Response {
  const content = typeof body === "string" ? body : JSON.stringify(body);
  return new Response(content, {
    status,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  });
}

function getFetchCallDetails(mockFetch: Mock<typeof fetch>, callIndex = 0) {
  const call = mockFetch.mock.calls[callIndex];
  expect(call).toBeDefined();
  const [url, init] = call as [string, RequestInit];
  const formData = init.body as FormData;
  const headers = new Headers(init.headers);
  return { url, init, formData, headers, signal: init.signal };
}

describe("openai-compatible.ts", () => {
  const TEST_PROFILE: OpenAICompatibleSttProfile = {
    logLabel: "Test STT",
    baseUrl: "https://stt.example.test/v1",
    defaultModel: "test-model-default",
    limits: {
      maxFileBytes: 25 * 1024 * 1024,
      segmentSeconds: 300,
    },
    promptField: "prompt",
    maxConcurrentRequests: 1,
    requestTimeoutMs: 5000,
  };

  let tempDir: string;
  let testAudioPath: string;
  let mockFetch: Mock<typeof fetch>;
  let mockSleep: Mock<(ms: number) => Promise<void>>;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vsub-openai-test-"));
    testAudioPath = path.join(tempDir, "audio.m4a");
    fs.writeFileSync(testAudioPath, "dummy-audio-content");
    mockFetch = vi.fn<typeof fetch>();
    mockSleep = vi.fn<(ms: number) => Promise<void>>().mockResolvedValue(undefined);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe("request structure", () => {
    it("should build correct multipart request with default model", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse(200, {
          text: "hello",
          segments: [{ start: 0, end: 1, text: "hello" }],
        }),
      );

      const transcriber = createOpenAICompatibleTranscriber(TEST_PROFILE, "test-api-key", {
        fetch: mockFetch,
        sleep: mockSleep,
      });

      await transcriber.transcribe(testAudioPath);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const { url, headers, formData, signal } = getFetchCallDetails(mockFetch);

      expect(url).toBe("https://stt.example.test/v1/audio/transcriptions");
      expect(headers.get("Authorization")).toBe("Bearer test-api-key");
      expect(headers.get("Content-Type")).toBeNull(); // browser/fetch sets multipart boundary

      expect(formData.get("model")).toBe("test-model-default");
      expect(formData.get("response_format")).toBe("verbose_json");
      expect(formData.getAll("timestamp_granularities[]")).toEqual(["segment", "word"]);
      expect(formData.has("language")).toBe(false);

      const file = formData.get("file") as Blob & { name?: string };
      expect(file).toBeInstanceOf(Blob);
      expect(file.name).toBe("audio.m4a");
      expect(file.type).toBe("audio/mp4");

      expect(signal).toBeInstanceOf(AbortSignal);
    });

    it("should respect options.model override", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(200, { segments: [] }));
      const transcriber = createOpenAICompatibleTranscriber(TEST_PROFILE, "test-api-key", {
        fetch: mockFetch,
        sleep: mockSleep,
      });

      await transcriber.transcribe(testAudioPath, { model: "custom-model-override" });

      const { formData } = getFetchCallDetails(mockFetch);
      expect(formData.get("model")).toBe("custom-model-override");
    });

    it.each([
      { filename: "test.m4a", expectedType: "audio/mp4" },
      { filename: "test.mp4", expectedType: "audio/mp4" },
      { filename: "test.mp3", expectedType: "audio/mpeg" },
      { filename: "test.wav", expectedType: "audio/wav" },
      { filename: "test.bin", expectedType: "application/octet-stream" },
    ])(
      "should determine MIME type $expectedType for $filename",
      async ({ filename, expectedType }) => {
        const filePath = path.join(tempDir, filename);
        fs.writeFileSync(filePath, "dummy");

        mockFetch.mockResolvedValueOnce(jsonResponse(200, { segments: [] }));
        const transcriber = createOpenAICompatibleTranscriber(TEST_PROFILE, "test-api-key", {
          fetch: mockFetch,
          sleep: mockSleep,
        });

        await transcriber.transcribe(filePath);

        const { formData } = getFetchCallDetails(mockFetch);
        const file = formData.get("file") as Blob;
        expect(file.type).toBe(expectedType);
      },
    );

    it("should log request before sending when verbose is true", async () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      mockFetch.mockResolvedValueOnce(jsonResponse(200, { segments: [] }));
      const transcriber = createOpenAICompatibleTranscriber(TEST_PROFILE, "test-api-key", {
        fetch: mockFetch,
        sleep: mockSleep,
      });

      await transcriber.transcribe(testAudioPath, { verbose: true });

      expect(logSpy).toHaveBeenCalledWith(
        `[Test STT] Requesting transcription [model: test-model-default]: ${testAudioPath}`,
      );
    });
  });

  describe("prompt handling", () => {
    it("should send prompt when promptField is 'prompt' and options.prompt is provided", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(200, { segments: [] }));
      const transcriber = createOpenAICompatibleTranscriber(
        { ...TEST_PROFILE, promptField: "prompt" },
        "test-api-key",
        { fetch: mockFetch, sleep: mockSleep },
      );

      await transcriber.transcribe(testAudioPath, { prompt: "Custom glossary prompt" });

      const { formData } = getFetchCallDetails(mockFetch);
      expect(formData.get("prompt")).toBe("Custom glossary prompt");
    });

    it("should not send prompt when promptField is 'prompt' but options.prompt is missing", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(200, { segments: [] }));
      const transcriber = createOpenAICompatibleTranscriber(
        { ...TEST_PROFILE, promptField: "prompt" },
        "test-api-key",
        { fetch: mockFetch, sleep: mockSleep },
      );

      await transcriber.transcribe(testAudioPath);

      const { formData } = getFetchCallDetails(mockFetch);
      expect(formData.has("prompt")).toBe(false);
    });

    it("should not send prompt and warn only once in verbose mode when promptField is 'none'", async () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      mockFetch.mockImplementation(() => Promise.resolve(jsonResponse(200, { segments: [] })));

      const transcriber = createOpenAICompatibleTranscriber(
        { ...TEST_PROFILE, promptField: "none" },
        "test-api-key",
        { fetch: mockFetch, sleep: mockSleep },
      );

      await transcriber.transcribe(testAudioPath, { prompt: "Ignored prompt", verbose: true });
      await transcriber.transcribe(testAudioPath, {
        prompt: "Ignored prompt again",
        verbose: true,
      });

      const firstCall = getFetchCallDetails(mockFetch, 0);
      const secondCall = getFetchCallDetails(mockFetch, 1);
      expect(firstCall.formData.has("prompt")).toBe(false);
      expect(secondCall.formData.has("prompt")).toBe(false);

      const warningMessage =
        "[Test STT] Recognition hints (whisper prompt) are not sent: this API has no prompt field.";
      const warningCalls = logSpy.mock.calls.filter((c) => c[0] === warningMessage);
      expect(warningCalls).toHaveLength(1);
    });
  });

  describe("response parsing", () => {
    it("should parse words, segments, and preserve language as returned", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse(200, {
          language: "jpn",
          words: [
            { word: "Hello", start: 0.1, end: 0.5, confidence: 0.99 },
            { word: "world", start: 0.6, end: 1.0, type: "word" },
            { word: "[music]", start: 1.1, end: 5.0, type: "audio_event" }, // ignored
            { word: 123, start: 0, end: 1 }, // malformed, ignored
            { word: "no end", start: 0 }, // malformed, ignored
          ],
          segments: [
            { id: 1, start: 0, end: 1.0, text: "Hello world" },
            { id: 2, start: "bad", end: 2, text: "bad segment" }, // malformed, ignored
          ],
        }),
      );

      const transcriber = createOpenAICompatibleTranscriber(TEST_PROFILE, "test-api-key", {
        fetch: mockFetch,
        sleep: mockSleep,
      });

      const result = await transcriber.transcribe(testAudioPath);

      expect(result.language).toBe("jpn");
      expect(result.words).toEqual([
        { text: "Hello", start: 0.1, end: 0.5 },
        { text: "world", start: 0.6, end: 1.0 },
      ]);
      expect(result.segments).toEqual([{ start: 0, end: 1.0, text: "Hello world" }]);
    });

    it("should return empty words array when all words are audio_event", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse(200, {
          words: [
            { word: "[outro music]", start: 0, end: 10, type: "audio_event" },
            { word: "[silence]", start: 10, end: 20, type: "audio_event" },
          ],
        }),
      );

      const transcriber = createOpenAICompatibleTranscriber(TEST_PROFILE, "test-api-key", {
        fetch: mockFetch,
        sleep: mockSleep,
      });

      const result = await transcriber.transcribe(testAudioPath);

      expect(result.words).toEqual([]);
      expect("words" in result).toBe(true);
    });

    it("should omit words property when response has no words or words is empty", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse(200, {
          words: [],
          segments: [{ start: 0, end: 1, text: "Hello" }],
        }),
      );

      const transcriber = createOpenAICompatibleTranscriber(TEST_PROFILE, "test-api-key", {
        fetch: mockFetch,
        sleep: mockSleep,
      });

      const result = await transcriber.transcribe(testAudioPath);

      expect("words" in result).toBe(false);
      expect(result.segments).toEqual([{ start: 0, end: 1, text: "Hello" }]);
    });

    it("should throw unexpected response error when body is not valid JSON or object", async () => {
      mockFetch.mockResolvedValueOnce(new Response("Internal error HTML", { status: 200 }));
      const transcriber = createOpenAICompatibleTranscriber(TEST_PROFILE, "test-api-key", {
        fetch: mockFetch,
        sleep: mockSleep,
      });

      await expect(transcriber.transcribe(testAudioPath)).rejects.toThrow(
        "Test STT returned an unexpected response (status 200)",
      );
    });
  });

  describe("errors and retries", () => {
    it.each([
      { status: 400, message: "Invalid model specified" },
      { status: 401, message: "Unauthorized API key" },
      { status: 402, message: "Insufficient credits" },
      { status: 413, message: "Payload too large" },
    ])(
      "should throw immediately on non-retryable status $status without retry",
      async ({ status, message }) => {
        mockFetch.mockResolvedValueOnce(jsonResponse(status, { error: { message } }));

        const transcriber = createOpenAICompatibleTranscriber(TEST_PROFILE, "test-secret-key-123", {
          fetch: mockFetch,
          sleep: mockSleep,
        });

        await expect(transcriber.transcribe(testAudioPath)).rejects.toThrow(
          `Test STT error ${status}: ${message}`,
        );

        // Verify no retry attempted
        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(mockSleep).not.toHaveBeenCalled();

        // Ensure API key is never exposed in error message
        try {
          mockFetch.mockResolvedValueOnce(jsonResponse(status, { error: { message } }));
          await transcriber.transcribe(testAudioPath);
        } catch (err: unknown) {
          expect((err as Error).message).not.toContain("test-secret-key-123");
        }
      },
    );

    it.each([429, 502, 503])(
      "should retry on retryable status %i and succeed on subsequent attempt",
      async (status) => {
        mockFetch
          .mockResolvedValueOnce(jsonResponse(status, { error: { message: "Temporary failure" } }))
          .mockResolvedValueOnce(jsonResponse(200, { segments: [] }));

        const transcriber = createOpenAICompatibleTranscriber(TEST_PROFILE, "test-api-key", {
          fetch: mockFetch,
          sleep: mockSleep,
        });

        await transcriber.transcribe(testAudioPath);

        expect(mockFetch).toHaveBeenCalledTimes(2);
        expect(mockSleep).toHaveBeenCalledTimes(1);
        expect(mockSleep).toHaveBeenCalledWith(2000);
      },
    );

    it("should retry up to 2 times and fail if all 3 attempts fail", async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse(503, { error: { message: "Service Unavailable 1" } }))
        .mockResolvedValueOnce(jsonResponse(503, { error: { message: "Service Unavailable 2" } }))
        .mockResolvedValueOnce(jsonResponse(503, { error: { message: "Service Unavailable 3" } }));

      const transcriber = createOpenAICompatibleTranscriber(TEST_PROFILE, "test-api-key", {
        fetch: mockFetch,
        sleep: mockSleep,
      });

      await expect(transcriber.transcribe(testAudioPath)).rejects.toThrow(
        "Test STT error 503: Service Unavailable 3",
      );

      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(mockSleep).toHaveBeenCalledTimes(2);
      expect(mockSleep).toHaveBeenNthCalledWith(1, 2000);
      expect(mockSleep).toHaveBeenNthCalledWith(2, 4000);
    });

    it("should retry when fetch throws network error", async () => {
      mockFetch
        .mockRejectedValueOnce(new Error("Network connection lost"))
        .mockResolvedValueOnce(jsonResponse(200, { segments: [] }));

      const transcriber = createOpenAICompatibleTranscriber(TEST_PROFILE, "test-api-key", {
        fetch: mockFetch,
        sleep: mockSleep,
      });

      await transcriber.transcribe(testAudioPath);

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockSleep).toHaveBeenCalledTimes(1);
      expect(mockSleep).toHaveBeenCalledWith(2000);
    });

    it("should respect Retry-After header with seconds within 30s cap", async () => {
      mockFetch
        .mockResolvedValueOnce(
          jsonResponse(429, { error: { message: "Rate limit" } }, { "Retry-After": "5" }),
        )
        .mockResolvedValueOnce(jsonResponse(200, { segments: [] }));

      const transcriber = createOpenAICompatibleTranscriber(TEST_PROFILE, "test-api-key", {
        fetch: mockFetch,
        sleep: mockSleep,
      });

      await transcriber.transcribe(testAudioPath);

      expect(mockSleep).toHaveBeenCalledWith(5000);
    });

    it("should cap Retry-After at 30 seconds when header exceeds 30s", async () => {
      mockFetch
        .mockResolvedValueOnce(
          jsonResponse(429, { error: { message: "Rate limit" } }, { "Retry-After": "120" }),
        )
        .mockResolvedValueOnce(jsonResponse(200, { segments: [] }));

      const transcriber = createOpenAICompatibleTranscriber(TEST_PROFILE, "test-api-key", {
        fetch: mockFetch,
        sleep: mockSleep,
      });

      await transcriber.transcribe(testAudioPath);

      expect(mockSleep).toHaveBeenCalledWith(30000);
    });

    it("should log retry attempt when verbose is true", async () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      mockFetch
        .mockResolvedValueOnce(jsonResponse(429, { error: { message: "Too Many Requests" } }))
        .mockResolvedValueOnce(jsonResponse(200, { segments: [] }));

      const transcriber = createOpenAICompatibleTranscriber(TEST_PROFILE, "test-api-key", {
        fetch: mockFetch,
        sleep: mockSleep,
      });

      await transcriber.transcribe(testAudioPath, { verbose: true });

      expect(logSpy).toHaveBeenCalledWith("[Test STT] Retrying (1/2) after 429...");
    });
  });
});
