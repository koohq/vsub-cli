import { describe, expect, it, vi } from "vitest";
import {
  createOpenRouterTextModel,
  DEFAULT_OPENROUTER_LLM_MODEL,
  OPENROUTER_TEXT_PROFILE,
} from "./openrouter.js";

describe("openrouter.ts", () => {
  describe("OPENROUTER_TEXT_PROFILE", () => {
    it("should define the required limits and timeouts", () => {
      expect(OPENROUTER_TEXT_PROFILE.limits.defaultConcurrency).toBe(3);
      expect(OPENROUTER_TEXT_PROFILE.maxTokens).toBe(16384);
      expect(OPENROUTER_TEXT_PROFILE.requestTimeoutMs).toBe(120_000);
      expect(OPENROUTER_TEXT_PROFILE.defaultModel).toBe(DEFAULT_OPENROUTER_LLM_MODEL);
      expect(OPENROUTER_TEXT_PROFILE.reasoning).toEqual({ effort: "low" });
    });
  });

  describe("createOpenRouterTextModel", () => {
    it.each([undefined, "minimal", "medium", "high"] as const)(
      "sends reasoning effort %s",
      async (effort) => {
        const fetch = vi
          .fn<typeof globalThis.fetch>()
          .mockResolvedValue(Response.json({ choices: [{ message: { content: "{}" } }] }));
        await createOpenRouterTextModel(
          "test-key-1234",
          "test-model",
          { fetch },
          effort,
        ).generateJson({ prompt: "Test", schemaName: "test", schema: { type: "object" } });
        expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body)).reasoning).toEqual({
          effort: effort ?? "low",
        });
        expect(OPENROUTER_TEXT_PROFILE.reasoning).toEqual({ effort: "low" });
      },
    );
    it("should instantiate model with OpenRouter profile", () => {
      const model = createOpenRouterTextModel("test-key", DEFAULT_OPENROUTER_LLM_MODEL);
      expect(model.logLabel).toBe("OpenRouter API");
      expect(model.model).toBe(DEFAULT_OPENROUTER_LLM_MODEL);
      expect(model.limits.defaultConcurrency).toBe(3);
    });
  });
});
