import { describe, expect, it, vi } from "vitest";
import {
  createGenericOpenAICompatibleTextModel,
  createGenericTextProfile,
} from "./openai-compatible-provider.js";
import { createTextModel } from "./select.js";

describe("generic OpenAI-compatible text generation", () => {
  const baseUrl = "http://localhost:11434/v1";
  const request = { prompt: "Test", schemaName: "test", schema: { type: "object" as const } };
  it.each(["low", "High", "custom-value", "", undefined])(
    "passes optional reasoning effort %s without token or nested reasoning fields",
    async (reasoningEffort) => {
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValue(Response.json({ choices: [{ message: { content: "{}" } }] }));
      const profile = createGenericTextProfile(baseUrl, reasoningEffort);
      if (reasoningEffort) expect(profile.reasoningEffort).toBe(reasoningEffort);
      else expect(profile).not.toHaveProperty("reasoningEffort");
      await createGenericOpenAICompatibleTextModel(baseUrl, "", "test-llm", {
        fetch,
        reasoningEffort,
      }).generateJson(request);
      const body = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body));
      if (reasoningEffort) expect(body.reasoning_effort).toBe(reasoningEffort);
      else expect(body).not.toHaveProperty("reasoning_effort");
      expect(body).not.toHaveProperty("reasoning");
      expect(body).not.toHaveProperty("max_tokens");
    },
  );
  it("uses conservative fixed limits without token or reasoning options", () => {
    expect(createGenericTextProfile(baseUrl)).toMatchObject({
      baseUrl,
      logLabel: "OpenAI-compatible API",
      limits: { defaultConcurrency: 1 },
      requestTimeoutMs: 300_000,
    });
    const settings = {
      provider: "openai-compatible",
      source: "option",
      model: "test-llm",
      baseUrl,
    } as const;
    expect(createTextModel({}, settings).limits.defaultConcurrency).toBe(1);
    expect(createTextModel({}, settings).logLabel).toBe("OpenAI-compatible API");
    expect(() => createTextModel({}, { ...settings, model: "" })).toThrow("--llm-model");
  });
  it.each(["", "test-key-1234"])("sends a strict schema with optional key %s", async (key) => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(Response.json({ choices: [{ message: { content: "{}" } }] }));
    await createGenericOpenAICompatibleTextModel(baseUrl, key, "test-llm", { fetch }).generateJson(
      request,
    );
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe(`${baseUrl}/chat/completions`);
    expect(new Headers(init?.headers).get("Authorization")).toBe(key ? `Bearer ${key}` : null);
    const body = JSON.parse(String(init?.body));
    expect(body).not.toHaveProperty("max_tokens");
    expect(body).not.toHaveProperty("reasoning");
    expect(body).not.toHaveProperty("reasoning_effort");
    expect(body.response_format).toEqual({
      type: "json_schema",
      json_schema: { name: "test", strict: true, schema: request.schema },
    });
  });
  it.each([402, 200])(
    "formats a 402 error at HTTP status %s without a credit suggestion",
    async (status) => {
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValue(
          Response.json({ error: { code: "402", message: "Payment required" } }, { status }),
        );
      const model = createGenericOpenAICompatibleTextModel(baseUrl, "", "test-llm", { fetch });
      const error = await model.generateJson(request).catch((err: unknown) => err);
      expect(error).toMatchObject({
        message: "OpenAI-compatible API error 402: Payment required",
        status: 402,
      });
      expect(model.classifyError(error)).toBe("fatal");
      expect(fetch).toHaveBeenCalledOnce();
    },
  );
  it.each(["en", "ja"] as const)("formats a model-not-found hint with its server (%s)", (lang) => {
    const message = createGenericOpenAICompatibleTextModel(
      baseUrl,
      "",
      "test-llm",
    ).formatModelNotFound(lang);
    expect(message).toContain(baseUrl);
    expect(message).toContain("'test-llm'");
    expect(message).toContain("--llm-model");
    expect(message).toContain("VSUB_OPENAI_COMPATIBLE_LLM_MODEL");
    expect(message).toContain(lang === "en" ? "was not found" : "が見つかりませんでした");
  });
});
