import { describe, expect, it } from "vitest";
import type { AppConfig } from "../config.js";
import { resolveSttSettings } from "../transcribe/select.js";
import { createTextModel, parseLlmProvider, resolveLlmSettings } from "./select.js";

describe("select.ts", () => {
  const baseConfig: AppConfig = {
    groqApiKey: "",
    geminiApiKey: "",
    ffmpegPath: "ffmpeg",
  };

  describe("parseLlmProvider", () => {
    it.each([
      ["gemini", "gemini"],
      ["GEMINI", "gemini"],
      [" Gemini ", "gemini"],
      ["openrouter", "openrouter"],
      ["OpenRouter", "openrouter"],
    ])("should normalize '%s' to '%s'", (input, expected) => {
      expect(parseLlmProvider(input)).toBe(expected);
    });

    it("should throw localized error on unsupported provider (en)", () => {
      expect(() => parseLlmProvider("anthropic", "en")).toThrow(
        'Unsupported text generation provider: "anthropic". Supported: gemini, openrouter',
      );
    });

    it("should throw localized error on unsupported provider (ja)", () => {
      expect(() => parseLlmProvider("anthropic", "ja")).toThrow(
        'サポートされていない文章生成提供元です: "anthropic". 利用可能な提供元: gemini, openrouter',
      );
    });
  });

  describe("resolveLlmSettings provider selection table", () => {
    it.each([
      {
        desc: "Groq and Gemini keys only -> gemini (auto)",
        config: { ...baseConfig, groqApiKey: "groq-key", geminiApiKey: "gem-key" },
        overrides: {},
        expectedProvider: "gemini",
        expectedSource: "auto",
      },
      {
        desc: "Gemini and OpenRouter keys -> gemini (auto)",
        config: {
          ...baseConfig,
          geminiApiKey: "gem-key",
          openrouterApiKey: "or-key",
        },
        overrides: {},
        expectedProvider: "gemini",
        expectedSource: "auto",
      },
      {
        desc: "OpenRouter key only -> openrouter (auto)",
        config: { ...baseConfig, openrouterApiKey: "or-key" },
        overrides: {},
        expectedProvider: "openrouter",
        expectedSource: "auto",
      },
      {
        desc: "No keys at all -> openrouter (auto)",
        config: { ...baseConfig },
        overrides: {},
        expectedProvider: "openrouter",
        expectedSource: "auto",
      },
      {
        desc: "--llm-provider beats setting and auto",
        config: {
          ...baseConfig,
          geminiApiKey: "gem-key",
          llmProvider: "gemini",
        },
        overrides: { llmProvider: "openrouter" },
        expectedProvider: "openrouter",
        expectedSource: "option",
      },
      {
        desc: "Setting (llmProvider) beats auto",
        config: {
          ...baseConfig,
          geminiApiKey: "gem-key",
          llmProvider: "openrouter",
        },
        overrides: {},
        expectedProvider: "openrouter",
        expectedSource: "setting",
      },
    ])("$desc", ({ config, overrides, expectedProvider, expectedSource }) => {
      const result = resolveLlmSettings(config, overrides);
      expect(result.llm.provider).toBe(expectedProvider);
      expect(result.llm.source).toBe(expectedSource);
    });
  });

  describe("generic OPENROUTER_API_KEY fallback behavior", () => {
    it("should not use fallback generic OPENROUTER_API_KEY when provider is auto-selected", () => {
      const config: AppConfig = {
        ...baseConfig,
        openrouterApiKeyFallback: "generic-key",
      };
      const result = resolveLlmSettings(config, {});
      expect(result.llm.provider).toBe("openrouter");
      expect(result.llm.source).toBe("auto");
      expect(result.config.openrouterApiKey).toBeUndefined();
    });

    it("should use fallback generic OPENROUTER_API_KEY when openrouter is explicitly chosen via option", () => {
      const config: AppConfig = {
        ...baseConfig,
        openrouterApiKeyFallback: "generic-key",
      };
      const result = resolveLlmSettings(config, { llmProvider: "openrouter" });
      expect(result.llm.provider).toBe("openrouter");
      expect(result.llm.source).toBe("option");
      expect(result.config.openrouterApiKey).toBe("generic-key");
    });

    it("should use fallback generic OPENROUTER_API_KEY when openrouter is explicitly chosen via setting", () => {
      const config: AppConfig = {
        ...baseConfig,
        llmProvider: "openrouter",
        openrouterApiKeyFallback: "generic-key",
      };
      const result = resolveLlmSettings(config, {});
      expect(result.llm.provider).toBe("openrouter");
      expect(result.llm.source).toBe("setting");
      expect(result.config.openrouterApiKey).toBe("generic-key");
    });

    it("should not overwrite existing openrouterApiKey with fallback", () => {
      const config: AppConfig = {
        ...baseConfig,
        openrouterApiKey: "vsub-specific-key",
        openrouterApiKeyFallback: "generic-key",
      };
      const result = resolveLlmSettings(config, { llmProvider: "openrouter" });
      expect(result.config.openrouterApiKey).toBe("vsub-specific-key");
    });
  });

  describe("chaining resolveSttSettings and resolveLlmSettings", () => {
    it("should resolve LLM to openrouter with the generic key when STT used openrouter with generic key and Gemini key is absent", () => {
      const config: AppConfig = {
        ...baseConfig,
        openrouterApiKeyFallback: "generic-openrouter-key",
      };

      const sttResult = resolveSttSettings(config, { sttProvider: "openrouter" });
      expect(sttResult.stt.provider).toBe("openrouter");
      expect(sttResult.config.openrouterApiKey).toBe("generic-openrouter-key");

      const llmResult = resolveLlmSettings(sttResult.config, {});
      expect(llmResult.llm.provider).toBe("openrouter");
      expect(llmResult.llm.source).toBe("auto");
      expect(llmResult.config.openrouterApiKey).toBe("generic-openrouter-key");
    });
  });

  describe("model resolution priority", () => {
    describe("gemini", () => {
      it("should prioritize --llm-model over --gemini-model, config, and default", () => {
        const config: AppConfig = {
          ...baseConfig,
          geminiApiKey: "gem-key",
          geminiModel: "config-model",
        };
        const result = resolveLlmSettings(config, {
          llmModel: "override-llm-model",
          geminiModel: "override-gemini-model",
        });
        expect(result.llm.model).toBe("override-llm-model");
      });

      it("should prioritize --gemini-model over config and default", () => {
        const config: AppConfig = {
          ...baseConfig,
          geminiApiKey: "gem-key",
          geminiModel: "config-model",
        };
        const result = resolveLlmSettings(config, {
          geminiModel: "override-gemini-model",
        });
        expect(result.llm.model).toBe("override-gemini-model");
      });

      it("should prioritize config over default", () => {
        const config: AppConfig = {
          ...baseConfig,
          geminiApiKey: "gem-key",
          geminiModel: "config-model",
        };
        const result = resolveLlmSettings(config, {});
        expect(result.llm.model).toBe("config-model");
      });

      it("should fallback to DEFAULT_GEMINI_MODEL", () => {
        const config: AppConfig = {
          ...baseConfig,
          geminiApiKey: "gem-key",
        };
        const result = resolveLlmSettings(config, {});
        expect(result.llm.model).toBe("gemini-3.8-flash");
      });
    });

    describe("openrouter", () => {
      it("should prioritize --llm-model over config and default, ignoring --gemini-model", () => {
        const config: AppConfig = {
          ...baseConfig,
          llmProvider: "openrouter",
          openrouterLlmModel: "config-openrouter-model",
        };
        const result = resolveLlmSettings(config, {
          llmModel: "override-llm-model",
          geminiModel: "should-be-ignored",
        });
        expect(result.llm.model).toBe("override-llm-model");
      });

      it("should ignore --gemini-model on OpenRouter", () => {
        const config: AppConfig = {
          ...baseConfig,
          llmProvider: "openrouter",
        };
        const result = resolveLlmSettings(config, {
          geminiModel: "gemini-3.0-pro",
        });
        expect(result.llm.model).toBe("google/gemini-3.8-flash");
      });

      it("should prioritize openrouterLlmModel in config over default", () => {
        const config: AppConfig = {
          ...baseConfig,
          llmProvider: "openrouter",
          openrouterLlmModel: "anthropic/claude-3.5-sonnet",
        };
        const result = resolveLlmSettings(config, {});
        expect(result.llm.model).toBe("anthropic/claude-3.5-sonnet");
      });

      it("should fallback to DEFAULT_OPENROUTER_LLM_MODEL", () => {
        const config: AppConfig = {
          ...baseConfig,
          llmProvider: "openrouter",
        };
        const result = resolveLlmSettings(config, {});
        expect(result.llm.model).toBe("google/gemini-3.8-flash");
      });
    });
  });

  describe("createTextModel", () => {
    it("should return Gemini TextModel implementation when provider is gemini", () => {
      const model = createTextModel(
        { geminiApiKey: "test-gemini-key" },
        { provider: "gemini", source: "auto", model: "gemini-3.8-flash" },
      );
      expect(model.logLabel).toBe("Gemini API");
      expect(model.model).toBe("gemini-3.8-flash");
    });

    it("should throw if geminiApiKey is missing when provider is gemini", () => {
      expect(() =>
        createTextModel(
          { geminiApiKey: "" },
          { provider: "gemini", source: "auto", model: "gemini-3.8-flash" },
        ),
      ).toThrow("Gemini API key is required");
    });

    it("should return OpenRouter TextModel implementation when provider is openrouter", () => {
      const model = createTextModel(
        { openrouterApiKey: "test-or-key" },
        { provider: "openrouter", source: "auto", model: "google/gemini-3.8-flash" },
      );
      expect(model.logLabel).toBe("OpenRouter API");
      expect(model.model).toBe("google/gemini-3.8-flash");
    });

    it("should throw if openrouterApiKey is missing when provider is openrouter", () => {
      expect(() =>
        createTextModel(
          { openrouterApiKey: "" },
          { provider: "openrouter", source: "auto", model: "google/gemini-3.8-flash" },
        ),
      ).toThrow("OpenRouter API key is required");
    });
  });
});
