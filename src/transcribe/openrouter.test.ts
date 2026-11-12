import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createOpenRouterTranscriber,
  DEFAULT_OPENROUTER_STT_MODEL,
  OPENROUTER_LIMITS,
  OPENROUTER_STT_PROFILE,
} from "./openrouter.js";
import { createTranscriber } from "./select.js";
import { transcribeAudioSegments } from "./transcriber.js";
import { buildEntriesFromWords } from "./words.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("openrouter.ts", () => {
  it.each([false, true])("requests and reads speakers only when enabled (%s)", async (diarize) => {
    const raw = [
      { speaker_label: " custom ", speaker: 3 },
      { speaker: 0 },
      { speaker: " label " },
      {},
      { speaker: 1.5 },
      { speaker_label: " ", speaker: 2 },
    ];
    const fetch = vi.fn().mockImplementation(async () =>
      jsonResponse(200, {
        words: raw.map((speaker, i) => ({ word: "Hello", start: i, end: i + 0.5, ...speaker })),
      }),
    );
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const transcriber = createOpenRouterTranscriber("test-key", { fetch });
    const result = await transcribeAudioSegments(
      [audioPathA, audioPathB],
      transcriber,
      true,
      undefined,
      { diarize },
    );
    for (const [, init] of fetch.mock.calls)
      expect((init.body as FormData).get("diarize")).toBe(diarize ? "true" : null);
    expect(result.wordChunks?.[0]?.words.map((word) => word.speaker)).toEqual(
      diarize
        ? ["custom", "speaker_0", "label", undefined, undefined, "speaker_2"]
        : raw.map(() => undefined),
    );
    expect(
      error.mock.calls.filter(([line]) =>
        String(line).includes("Requesting speaker labels (diarize)."),
      ),
    ).toHaveLength(diarize ? 1 : 0);
  });
  let tempDir: string;
  let audioPathA: string;
  let audioPathB: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vsub-openrouter-test-"));
    audioPathA = path.join(tempDir, "chunk_001.m4a");
    audioPathB = path.join(tempDir, "chunk_002.m4a");
    fs.writeFileSync(audioPathA, "dummy-a");
    fs.writeFileSync(audioPathB, "dummy-b");
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe("profile and limits constants", () => {
    it("should have expected OPENROUTER_LIMITS", () => {
      expect(OPENROUTER_LIMITS).toEqual({
        maxFileBytes: 24_000_000,
        segmentSeconds: 300,
        maxChunkSeconds: 300,
      });
    });

    it("should have expected OPENROUTER_STT_PROFILE", () => {
      expect(DEFAULT_OPENROUTER_STT_MODEL).toBe("elevenlabs/scribe-v2");
      expect(OPENROUTER_STT_PROFILE).toEqual({
        logLabel: "OpenRouter API",
        baseUrl: "https://openrouter.ai/api/v1",
        defaultModel: "elevenlabs/scribe-v2",
        limits: OPENROUTER_LIMITS,
        promptField: "none",
        maxConcurrentRequests: 1,
        requestTimeoutMs: 120_000,
      });
    });
  });

  describe("createOpenRouterTranscriber", () => {
    it("should create transcriber with OpenRouter profile and target correct endpoint", async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce(
        jsonResponse(200, {
          segments: [],
          language: "jpn",
        }),
      );

      const transcriber = createOpenRouterTranscriber("test-openrouter-key", {
        fetch: mockFetch,
      });

      expect(transcriber.logLabel).toBe("OpenRouter API");
      expect(transcriber.limits).toEqual(OPENROUTER_LIMITS);

      await transcriber.transcribe(audioPathA);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://openrouter.ai/api/v1/audio/transcriptions");
      const headers = new Headers(init.headers);
      expect(headers.get("Authorization")).toBe("Bearer test-openrouter-key");
    });
  });

  describe("createTranscriber selector", () => {
    it("should default to Groq transcriber when provider is omitted", () => {
      const transcriber = createTranscriber({ groqApiKey: "gsk_test" });
      expect(transcriber.logLabel).toBe("Groq API");
    });

    it("should return Groq transcriber when provider is 'groq'", () => {
      const transcriber = createTranscriber({ groqApiKey: "gsk_test" }, "groq");
      expect(transcriber.logLabel).toBe("Groq API");
    });

    it("should return OpenRouter transcriber when provider is 'openrouter' and key is present", () => {
      const transcriber = createTranscriber(
        { groqApiKey: "gsk_test", openrouterApiKey: "sk-or-test" },
        "openrouter",
      );
      expect(transcriber.logLabel).toBe("OpenRouter API");
      expect(transcriber.limits).toEqual(OPENROUTER_LIMITS);
    });

    it("should throw error when provider is 'openrouter' but key is missing", () => {
      expect(() => createTranscriber({ groqApiKey: "gsk_test" }, "openrouter")).toThrow(
        "OpenRouter API key is required for OpenRouter transcription.",
      );

      expect(() =>
        createTranscriber({ groqApiKey: "gsk_test", openrouterApiKey: "" }, "openrouter"),
      ).toThrow("OpenRouter API key is required for OpenRouter transcription.");
    });
  });

  describe("end-to-end segment transcription wiring", () => {
    it("should normalize 'jpn' to 'ja', apply chunk offsets, and build entries from words", async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse(200, {
            language: "jpn",
            words: [
              { word: "こんにちは", start: 1.0, end: 2.0 },
              { word: "世界", start: 2.5, end: 3.5 },
            ],
          }),
        )
        .mockResolvedValueOnce(
          jsonResponse(200, {
            language: "jpn",
            words: [{ word: "テスト", start: 0.5, end: 1.5 }],
          }),
        );

      const transcriber = createOpenRouterTranscriber("test-openrouter-key", {
        fetch: mockFetch,
      });

      const result = await transcribeAudioSegments(
        [audioPathA, audioPathB],
        transcriber,
        false,
        undefined,
        {
          durations: [300, 120],
        },
      );

      expect(result.detectedLanguage).toBe("ja");
      expect(result.wordChunks).toEqual([
        {
          offsetSeconds: 0,
          words: [
            { text: "こんにちは", start: 1.0, end: 2.0 },
            { text: "世界", start: 2.5, end: 3.5 },
          ],
        },
        {
          offsetSeconds: 300,
          words: [{ text: "テスト", start: 0.5, end: 1.5 }],
        },
      ]);
      expect(result.entries).toEqual(buildEntriesFromWords(result.wordChunks ?? []));
    });
  });
});
