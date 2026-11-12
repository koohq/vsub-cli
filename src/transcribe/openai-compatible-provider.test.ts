import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createGenericOpenAICompatibleTranscriber,
  createGenericSttProfile,
} from "./openai-compatible-provider.js";
import { createTranscriber } from "./select.js";

describe("generic OpenAI-compatible transcription", () => {
  const baseUrl = "http://localhost:8000/v1";
  let dir: string;
  let audio: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "vsub-generic-stt-"));
    audio = path.join(dir, "audio.wav");
    fs.writeFileSync(audio, "test audio");
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("uses fixed limits and timeout without a default model", () => {
    expect(createGenericSttProfile(baseUrl)).toEqual({
      baseUrl,
      logLabel: "OpenAI-compatible API",
      limits: { maxFileBytes: 24_000_000, segmentSeconds: 300, maxChunkSeconds: 300 },
      promptField: "prompt",
      maxConcurrentRequests: 1,
      requestTimeoutMs: 300_000,
    });
    const settings = {
      provider: "openai-compatible",
      source: "option",
      model: "test-stt",
      baseUrl,
    } as const;
    const config = { groqApiKey: "", openaiCompatibleSttApiKey: "" };
    expect(createTranscriber(config, settings).limits).toEqual(
      createGenericSttProfile(baseUrl).limits,
    );
    expect(createTranscriber(config, settings).logLabel).toBe("OpenAI-compatible API");
    expect(() => createTranscriber(config, { ...settings, baseUrl: undefined })).toThrow(
      "VSUB_OPENAI_COMPATIBLE_STT_BASE_URL",
    );
  });
  it.each(["", "test-key-1234"])("sends timestamps and hints with optional key %s", async (key) => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(Response.json({ words: [{ start: 0, end: 1, word: "Hello" }] }));
    await createGenericOpenAICompatibleTranscriber(baseUrl, key, { fetch }).transcribe(audio, {
      model: "test-stt",
      prompt: "Term A",
    });
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe(`${baseUrl}/audio/transcriptions`);
    expect(new Headers(init?.headers).get("Authorization")).toBe(key ? `Bearer ${key}` : null);
    const form = init?.body as FormData;
    expect(form.get("prompt")).toBe("Term A");
    expect(form.get("model")).toBe("test-stt");
    expect(form.get("response_format")).toBe("verbose_json");
    expect(form.getAll("timestamp_granularities[]")).toEqual(["segment", "word"]);
  });
  it("does not suggest an unspecified default for a response without timestamps", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(Response.json({ text: "Hello" }));
    const operation = createGenericOpenAICompatibleTranscriber(baseUrl, "", { fetch }).transcribe(
      audio,
      { model: "test-stt" },
    );
    await expect(operation).rejects.toThrow("Choose a model that returns them.");
    await expect(operation).rejects.not.toThrow("such as");
  });
});
