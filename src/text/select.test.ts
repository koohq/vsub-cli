import { stripVTControlCharacters } from "node:util";
import { describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../config.js";
import { resolveSttSettings } from "../transcribe/select.js";
import {
  assertLlmSettingsReady,
  createTextModel,
  formatTextModelVerboseLine,
  parseLlmProvider,
  parseLlmReasoningEffort,
  resolveLlmSettings,
} from "./select.js";

const { generateContent } = vi.hoisted(() => ({ generateContent: vi.fn() }));
vi.mock("@google/genai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@google/genai")>()),
  GoogleGenAI: class {
    models = { generateContent };
  },
}));

describe("select.ts", () => {
  it.each(["minimal", "low", "medium", "high"] as const)(
    "normalizes reasoning effort %s",
    (effort) => {
      expect(parseLlmReasoningEffort(` ${effort.toUpperCase()} `)).toBe(effort);
    },
  );
  it.each(["max", "none", "xhigh", "bogus"])(
    "rejects reasoning effort %s in both languages",
    (value) => {
      expect(() => parseLlmReasoningEffort(` ${value} `, "en")).toThrow(
        `Unsupported reasoning effort: "${value}". Supported: minimal, low, medium, high`,
      );
      expect(() => parseLlmReasoningEffort(` ${value} `, "ja")).toThrow(
        `サポートされていない推論の量です: "${value}". 利用可能な値: minimal, low, medium, high`,
      );
    },
  );
  const baseConfig: AppConfig = {
    groqApiKey: "",
    geminiApiKey: "",
    ffmpegPath: "ffmpeg",
  };
  const request = { prompt: "Test", schemaName: "test", schema: { type: "object" as const } };
  describe("text generation verbose line", () => {
    it.each([
      [" Medium ", "high", "medium", "option"],
      [" low ", "high", "low", "option"],
      [" ", " High ", "high", "setting"],
      [undefined, "medium", "medium", "setting"],
      [undefined, undefined, "low", "default"],
      [undefined, " ", "low", "default"],
      [undefined, "invalid", "low", "default"],
    ])("resolves effort metadata for %j / %j", (option, setting, effort, source) => {
      const result = resolveLlmSettings(
        { ...baseConfig, llmReasoningEffort: setting },
        { llmReasoningEffort: option },
      );
      expect(result).toHaveProperty("reasoning", { effort, source });
      expect(result.llm).not.toHaveProperty("reasoning");
    });

    const cases = [
      {
        provider: "openrouter",
        model: "google/gemini-3.8-flash",
        effort: "medium",
        source: "option",
        detail: "reasoning.effort=medium (from --llm-reasoning-effort)",
      },
      {
        provider: "openrouter",
        model: "my-model",
        effort: "low",
        source: "default",
        detail: "reasoning.effort=low (default)",
      },
      {
        provider: "openrouter",
        model: "my-model",
        effort: "high",
        source: "setting",
        detail: "reasoning.effort=high (from VSUB_LLM_REASONING_EFFORT or config)",
      },
      ...(["minimal", "low", "medium", "high"] as const).map((effort) => ({
        provider: "gemini" as const,
        model: "models/gemini-3.8-flash",
        effort,
        source: "setting" as const,
        detail: `thinkingLevel=${effort.toUpperCase()} (from VSUB_LLM_REASONING_EFFORT or config)`,
      })),
      {
        provider: "gemini",
        model: "gemini-4-test",
        effort: "low",
        source: "default",
        detail: "thinkingLevel=LOW (default)",
      },
      ...(["gemini-2.5-flash", "models/gemini-2.5-flash", "my-model"] as const).flatMap((model) => [
        {
          provider: "gemini" as const,
          model,
          effort: "medium" as const,
          source: "option" as const,
          detail:
            'thinkingLevel not sent (not Gemini 3 or newer; reasoning effort "medium" from --llm-reasoning-effort ignored)',
        },
        {
          provider: "gemini" as const,
          model,
          effort: "low" as const,
          source: "setting" as const,
          detail:
            'thinkingLevel not sent (not Gemini 3 or newer; reasoning effort "low" from VSUB_LLM_REASONING_EFFORT or config ignored)',
        },
        {
          provider: "gemini" as const,
          model,
          effort: "low" as const,
          source: "default" as const,
          detail: "thinkingLevel not sent (not Gemini 3 or newer)",
        },
      ]),
      ...([undefined, " ", " High "] as const).flatMap((dedicated) =>
        (["default", "option", "setting"] as const).map((source) => ({
          provider: "openai-compatible" as const,
          model: "my-model",
          effort: "medium" as const,
          source,
          dedicated,
          detail:
            (dedicated?.trim()
              ? "reasoning_effort=High (from VSUB_OPENAI_COMPATIBLE_LLM_REASONING_EFFORT or config)"
              : "reasoning_effort not sent") +
            (source === "default"
              ? ""
              : `; reasoning effort "medium" from ${source === "option" ? "--llm-reasoning-effort" : "VSUB_LLM_REASONING_EFFORT or config"} not used by openai-compatible`),
        })),
      ),
    ] as const;
    it.each(cases)("formats $provider / $model / $effort / $source", (testCase) => {
      const { provider, model, effort, source, detail } = testCase;
      const logLabel =
        provider === "gemini"
          ? "Gemini API"
          : provider === "openrouter"
            ? "OpenRouter API"
            : "OpenAI-compatible API";
      const line = formatTextModelVerboseLine(
        { logLabel, model },
        provider,
        { effort, source },
        "dedicated" in testCase ? testCase.dedicated : undefined,
      );
      expect(stripVTControlCharacters(line)).toBe(
        `[${logLabel}] Text generation: model ${model}, ${detail}`,
      );
      expect(line).toBe(stripVTControlCharacters(line));
    });
  });
  function createFetch() {
    return vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async () => Response.json({ choices: [{ message: { content: "{}" } }] }));
  }

  it.each(["gemini", "openrouter", "openai-compatible"] as const)(
    "resolves and validates common effort for %s",
    (provider) => {
      const config = { ...baseConfig, llmProvider: provider, llmReasoningEffort: " High " };
      const resolve = (value?: string) =>
        resolveLlmSettings(config, { llmReasoningEffort: value, validateReasoningEffort: true })
          .llm;
      expect(resolve().reasoningEffort).toBe(provider === "openai-compatible" ? undefined : "high");
      expect(resolve(" Medium ").reasoningEffort).toBe(
        provider === "openai-compatible" ? undefined : "medium",
      );
      expect(resolve("low")).not.toHaveProperty("reasoningEffort");
      expect(resolve(" ").reasoningEffort).toBe(
        provider === "openai-compatible" ? undefined : "high",
      );
      expect(resolveLlmSettings(baseConfig, {}).llm).not.toHaveProperty("reasoningEffort");
      expect(() => resolve(" Bogus ")).toThrow('"Bogus"');
      expect(() =>
        resolveLlmSettings({ ...config, llmReasoningEffort: "Bogus" }, {}),
      ).not.toThrow();
    },
  );

  it.each(["minimal", "medium", "high"] as const)(
    "sends resolved effort %s only to supported providers",
    async (effort) => {
      for (const provider of ["openrouter", "gemini", "openai-compatible"] as const) {
        generateContent.mockClear().mockResolvedValue({ text: "{}" });
        const fetch = createFetch();
        const config = {
          ...baseConfig,
          geminiApiKey: "test-key-1234",
          openrouterApiKey: "test-key-1234",
          llmReasoningEffort: effort,
          openaiCompatibleLlmBaseUrl: "https://example.invalid/v1",
          openaiCompatibleLlmModel: "test-model",
        };
        const { llm } = resolveLlmSettings(config, {
          llmProvider: provider,
          llmModel: "gemini-3-test",
          validateReasoningEffort: true,
        });
        await createTextModel(config, llm, { fetch }).generateJson(request);
        if (provider === "gemini")
          expect(generateContent).toHaveBeenCalledWith(
            expect.objectContaining({
              config: expect.objectContaining({
                thinkingConfig: { thinkingLevel: effort.toUpperCase() },
              }),
            }),
          );
        else {
          const body = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body));
          if (provider === "openrouter") expect(body.reasoning).toEqual({ effort });
          else expect(body).not.toHaveProperty("reasoning");
          expect(body).not.toHaveProperty("reasoning_effort");
        }
      }
    },
  );

  it.each([" High ", " ", undefined])(
    "passes configured generic reasoning effort %j",
    async (effort) => {
      const fetch = createFetch();
      const config = {
        ...baseConfig,
        llmReasoningEffort: "medium",
        openaiCompatibleLlmReasoningEffort: effort,
      };
      await createTextModel(
        config,
        {
          provider: "openai-compatible",
          source: "option",
          model: "test-model",
          baseUrl: "http://localhost:11434/v1",
        },
        { fetch },
      ).generateJson(request);
      const body = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body));
      if (effort?.trim()) expect(body.reasoning_effort).toBe(effort.trim());
      else expect(body).not.toHaveProperty("reasoning_effort");
      expect(body).not.toHaveProperty("reasoning");
      expect(body).not.toHaveProperty("max_tokens");
    },
  );

  it("ignores generic effort in OpenRouter request bodies", async () => {
    const fetch = createFetch();
    for (const effort of [undefined, "High"]) {
      await createTextModel(
        {
          ...baseConfig,
          openrouterApiKey: "test-key-1234",
          openaiCompatibleLlmReasoningEffort: effort,
        },
        { provider: "openrouter", source: "option", model: "test-model" },
        { fetch },
      ).generateJson(request);
    }
    const bodies = fetch.mock.calls.map((call) => JSON.parse(String(call[1]?.body)));
    expect(bodies[0]).toEqual(bodies[1]);
    expect(bodies[1]).toMatchObject({ reasoning: { effort: "low" }, max_tokens: 16384 });
    expect(bodies[1]).not.toHaveProperty("reasoning_effort");
  });

  it("ignores generic effort in Gemini requests", async () => {
    generateContent.mockClear().mockResolvedValue({ text: "{}" });
    for (const effort of [undefined, "High"]) {
      await createTextModel(
        {
          ...baseConfig,
          geminiApiKey: "test-key-1234",
          openaiCompatibleLlmReasoningEffort: effort,
        },
        { provider: "gemini", source: "option", model: "gemini-3-test" },
      ).generateJson(request);
    }
    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(generateContent.mock.calls[0]).toEqual(generateContent.mock.calls[1]);
    expect(generateContent.mock.calls[1]?.[0]).toEqual({
      model: "gemini-3-test",
      contents: "Test",
      config: {
        responseMimeType: "application/json",
        responseSchema: { type: "OBJECT" },
        thinkingConfig: { thinkingLevel: "LOW" },
      },
    });
  });

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

it.each([
  ["gemini", "Gemini で文章を生成するには、Gemini の API キーが必要です。"],
  ["openrouter", "OpenRouter で文章を生成するには、OpenRouter の API キーが必要です。"],
] as const)("localizes missing %s text keys", (provider, message) => {
  expect(() =>
    createTextModel({}, { provider, source: "auto", model: "test-model" }, { lang: "ja" }),
  ).toThrow(message);
});

describe("openai-compatible settings", () => {
  const config: AppConfig = {
    groqApiKey: "",
    geminiApiKey: "",
    ffmpegPath: "ffmpeg",
    openaiCompatibleLlmBaseUrl: "http://localhost:8000/v1",
    openaiCompatibleLlmModel: "configured-model",
    openaiCompatibleLlmApiKey: "test-key-1234",
  };
  it.each(["option", "setting"])("selects explicitly via %s", (source) => {
    const { llm } = resolveLlmSettings(
      { ...config, ...(source === "setting" ? { llmProvider: " OpenAI-Compatible " } : {}) },
      {
        ...(source === "option" ? { llmProvider: " OpenAI-Compatible " } : {}),
        geminiModel: "ignored",
      },
    );
    expect(llm).toEqual({
      provider: "openai-compatible",
      source,
      model: "configured-model",
      baseUrl: "http://localhost:8000/v1",
    });
    expect(
      resolveLlmSettings(config, { llmProvider: "openai-compatible", llmModel: " override " }).llm
        .model,
    ).toBe("override");
    expect(
      resolveLlmSettings(
        { ...config, openaiCompatibleLlmModel: undefined },
        { llmProvider: "openai-compatible", geminiModel: "ignored" },
      ).llm.model,
    ).toBe("");
  });
  it("does not auto-select even when all generic settings exist", () => {
    expect(resolveLlmSettings(config, {}).llm).toMatchObject({
      provider: "openrouter",
      source: "auto",
    });
    expect(resolveLlmSettings(config, {}).llm.baseUrl).toBeUndefined();
  });
  it.each(["en", "ja"] as const)("lists all supported providers (%s)", (lang) => {
    expect(() => resolveLlmSettings(config, { llmProvider: "invalid" }, lang)).toThrow(
      "gemini, openrouter, openai-compatible",
    );
  });
  it.each(["en", "ja"] as const)("validates only missing or invalid settings (%s)", (lang) => {
    const valid = {
      provider: "openai-compatible",
      source: "option",
      model: "test-model",
      baseUrl: "http://localhost:8000/v1",
    } as const;
    expect(() => assertLlmSettingsReady(valid, lang)).not.toThrow();
    expect(() =>
      assertLlmSettingsReady(
        { ...valid, provider: "openrouter", model: "", baseUrl: undefined },
        lang,
      ),
    ).not.toThrow();
    for (const baseUrl of [undefined, "ftp://example.invalid", "not a url"]) {
      expect(() => assertLlmSettingsReady({ ...valid, baseUrl }, lang)).toThrow(
        "VSUB_OPENAI_COMPATIBLE_LLM_BASE_URL",
      );
      try {
        assertLlmSettingsReady({ ...valid, baseUrl }, lang);
      } catch (error) {
        expect(String(error)).not.toContain("--llm-model");
      }
    }
    expect(() => assertLlmSettingsReady({ ...valid, model: "" }, lang)).toThrow("--llm-model");
    try {
      assertLlmSettingsReady({ ...valid, model: "", baseUrl: undefined }, lang);
    } catch (error) {
      expect(String(error)).toContain("VSUB_OPENAI_COMPATIBLE_LLM_BASE_URL");
      expect(String(error)).toContain("--llm-model");
    }
  });
});
