import { describe, expect, it } from "vitest";
import type { AppConfig } from "../config.js";
import { DEFAULT_GROQ_MODEL } from "../config.js";
import { DEFAULT_OPENROUTER_STT_MODEL } from "./openrouter.js";
import { resolveSttSettings } from "./select.js";

function createDummyConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    groqApiKey: "",
    geminiApiKey: "dummy-gemini-key",
    ffmpegPath: "ffmpeg",
    ...overrides,
  };
}

describe("resolveSttSettings", () => {
  describe("provider selection", () => {
    it.each([
      {
        name: "explicit override wins over config setting",
        config: { sttProvider: "groq", openrouterApiKey: "dummy-openrouter-key" },
        overrides: { sttProvider: "openrouter" },
        expectedProvider: "openrouter",
        expectedSource: "option",
      },
      {
        name: "config setting wins over auto detection",
        config: { sttProvider: "groq", openrouterApiKey: "dummy-openrouter-key" },
        overrides: {},
        expectedProvider: "groq",
        expectedSource: "setting",
      },
      {
        name: "case-insensitive and trimmed provider override",
        config: {},
        overrides: { sttProvider: "  OpenRouter  " },
        expectedProvider: "openrouter",
        expectedSource: "option",
      },
      {
        name: "auto selects openrouter when VSUB_OPENROUTER_API_KEY is present",
        config: { openrouterApiKey: "vsub-openrouter-key" },
        overrides: {},
        expectedProvider: "openrouter",
        expectedSource: "auto",
      },
      {
        name: "auto selects groq when only groq key is present",
        config: { groqApiKey: "groq-key" },
        overrides: {},
        expectedProvider: "groq",
        expectedSource: "auto",
      },
      {
        name: "auto selects openrouter when both keys are present",
        config: { openrouterApiKey: "vsub-openrouter-key", groqApiKey: "groq-key" },
        overrides: {},
        expectedProvider: "openrouter",
        expectedSource: "auto",
      },
      {
        name: "auto selects openrouter when neither key is present",
        config: {},
        overrides: {},
        expectedProvider: "openrouter",
        expectedSource: "auto",
      },
      {
        name: "auto keeps groq when groq key and generic fallback key are present",
        config: { groqApiKey: "groq-key", openrouterApiKeyFallback: "generic-key" },
        overrides: {},
        expectedProvider: "groq",
        expectedSource: "auto",
      },
      {
        name: "auto selects openrouter when only generic fallback key is present, but does not use fallback key",
        config: { openrouterApiKeyFallback: "generic-key" },
        overrides: {},
        expectedProvider: "openrouter",
        expectedSource: "auto",
      },
    ])("$name", ({ config, overrides, expectedProvider, expectedSource }) => {
      const baseConfig = createDummyConfig(config);
      const result = resolveSttSettings(baseConfig, overrides);
      expect(result.stt.provider).toBe(expectedProvider);
      expect(result.stt.source).toBe(expectedSource);
    });

    it("throws an error for unsupported provider in English", () => {
      const config = createDummyConfig();
      expect(() => resolveSttSettings(config, { sttProvider: "foo" }, "en")).toThrow(
        'Unsupported transcription provider: "foo". Supported: openrouter, groq',
      );
    });

    it("throws an error for unsupported provider in Japanese", () => {
      const config = createDummyConfig();
      expect(() => resolveSttSettings(config, { sttProvider: "foo" }, "ja")).toThrow(
        'サポートされていない文字起こし提供元です: "foo". 利用可能な提供元: openrouter, groq',
      );
    });
  });

  describe("API key resolution", () => {
    it("assigns openrouterApiKeyFallback when explicitly chosen via option and openrouterApiKey is empty", () => {
      const config = createDummyConfig({ openrouterApiKeyFallback: "generic-key" });
      const result = resolveSttSettings(config, { sttProvider: "openrouter" });
      expect(result.config.openrouterApiKey).toBe("generic-key");
    });

    it("assigns openrouterApiKeyFallback when explicitly chosen via config setting and openrouterApiKey is empty", () => {
      const config = createDummyConfig({
        sttProvider: "openrouter",
        openrouterApiKeyFallback: "generic-key",
      });
      const result = resolveSttSettings(config, {});
      expect(result.config.openrouterApiKey).toBe("generic-key");
    });

    it("prefers openrouterApiKey over fallback even when openrouter is explicitly chosen", () => {
      const config = createDummyConfig({
        openrouterApiKey: "vsub-key",
        openrouterApiKeyFallback: "generic-key",
      });
      const result = resolveSttSettings(config, { sttProvider: "openrouter" });
      expect(result.config.openrouterApiKey).toBe("vsub-key");
    });

    it("does not populate fallback key when auto-selected", () => {
      const config = createDummyConfig({ openrouterApiKeyFallback: "generic-key" });
      const result = resolveSttSettings(config, {});
      expect(result.stt.provider).toBe("openrouter");
      expect(result.stt.source).toBe("auto");
      expect(result.config.openrouterApiKey).toBeUndefined();
    });

    it("does not mutate the input config object", () => {
      const config = createDummyConfig({ openrouterApiKeyFallback: "generic-key" });
      const original = { ...config };
      const result = resolveSttSettings(config, { sttProvider: "openrouter" });
      expect(config).toEqual(original);
      expect(result.config).not.toBe(config);
    });
  });

  describe("model resolution", () => {
    it.each([
      {
        provider: "groq" as const,
        overrides: { sttModel: "custom-stt-model", groqModel: "custom-groq-model" },
        config: { groqModel: "config-groq-model" },
        expectedModel: "custom-stt-model",
      },
      {
        provider: "groq" as const,
        overrides: { groqModel: "custom-groq-model" },
        config: { groqModel: "config-groq-model" },
        expectedModel: "custom-groq-model",
      },
      {
        provider: "groq" as const,
        overrides: {},
        config: { groqModel: "config-groq-model" },
        expectedModel: "config-groq-model",
      },
      {
        provider: "groq" as const,
        overrides: {},
        config: {},
        expectedModel: DEFAULT_GROQ_MODEL,
      },
      {
        provider: "openrouter" as const,
        overrides: { sttModel: "custom-openrouter-model" },
        config: { openrouterSttModel: "config-openrouter-model" },
        expectedModel: "custom-openrouter-model",
      },
      {
        provider: "openrouter" as const,
        overrides: {},
        config: { openrouterSttModel: "config-openrouter-model" },
        expectedModel: "config-openrouter-model",
      },
      {
        provider: "openrouter" as const,
        overrides: {},
        config: {},
        expectedModel: DEFAULT_OPENROUTER_STT_MODEL,
      },
      {
        provider: "openrouter" as const,
        overrides: { groqModel: "custom-groq-model" },
        config: { groqModel: "config-groq-model" },
        expectedModel: DEFAULT_OPENROUTER_STT_MODEL,
      },
      {
        provider: "groq" as const,
        overrides: {},
        config: { openrouterSttModel: "config-openrouter-model" },
        expectedModel: DEFAULT_GROQ_MODEL,
      },
    ])("resolves model for $provider", ({ provider, overrides, config, expectedModel }) => {
      const baseConfig = createDummyConfig(config);
      const result = resolveSttSettings(baseConfig, { ...overrides, sttProvider: provider });
      expect(result.stt.model).toBe(expectedModel);
    });
  });
});
