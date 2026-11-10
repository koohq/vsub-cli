import { describe, expect, it } from "vitest";
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
    it("should instantiate model with OpenRouter profile", () => {
      const model = createOpenRouterTextModel("test-key", DEFAULT_OPENROUTER_LLM_MODEL);
      expect(model.logLabel).toBe("OpenRouter API");
      expect(model.model).toBe(DEFAULT_OPENROUTER_LLM_MODEL);
      expect(model.limits.defaultConcurrency).toBe(3);
    });
  });
});
