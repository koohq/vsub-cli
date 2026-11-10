import { type AppConfig, DEFAULT_GEMINI_MODEL } from "../config.js";
import { getI18n, type SupportedLanguage } from "../i18n/index.js";
import { createGeminiTextModel } from "./gemini.js";
import type { TextModel } from "./model.js";
import { createOpenRouterTextModel, DEFAULT_OPENROUTER_LLM_MODEL } from "./openrouter.js";
import { LLM_PROVIDER_LABELS, LLM_PROVIDERS, type LlmProvider } from "./providers.js";

export { LLM_PROVIDER_LABELS, LLM_PROVIDERS, type LlmProvider };

export interface LlmSettings {
  provider: LlmProvider;
  /** "option": --llm-provider, "setting": VSUB_LLM_PROVIDER or config file, "auto": chosen from the keys. */
  source: "option" | "setting" | "auto";
  /** Model sent to the provider. */
  model: string;
}

export function parseLlmProvider(
  raw: string,
  lang?: SupportedLanguage | string | undefined,
): LlmProvider {
  const normalized = raw.trim().toLowerCase();
  if ((LLM_PROVIDERS as readonly string[]).includes(normalized)) {
    return normalized as LlmProvider;
  }
  const i18n = getI18n(lang);
  throw new Error(i18n.pipeline.invalidLlmProvider(raw.trim()));
}

export function resolveLlmSettings(
  config: AppConfig,
  overrides: {
    llmProvider?: string | undefined;
    llmModel?: string | undefined;
    geminiModel?: string | undefined;
  },
  lang?: SupportedLanguage | string | undefined,
): { config: AppConfig; llm: LlmSettings } {
  let provider: LlmProvider;
  let source: "option" | "setting" | "auto";

  const rawOptionProvider = overrides.llmProvider?.trim();
  const rawSettingProvider = config.llmProvider?.trim();

  if (rawOptionProvider) {
    provider = parseLlmProvider(rawOptionProvider, lang);
    source = "option";
  } else if (rawSettingProvider) {
    provider = parseLlmProvider(rawSettingProvider, lang);
    source = "setting";
  } else {
    source = "auto";
    if (config.geminiApiKey?.trim()) {
      provider = "gemini";
    } else {
      provider = "openrouter";
    }
  }

  let nextConfig = config;
  if (provider === "openrouter" && source !== "auto" && !config.openrouterApiKey?.trim()) {
    nextConfig = {
      ...config,
      openrouterApiKey: config.openrouterApiKeyFallback,
    };
  }

  let model: string;
  if (provider === "gemini") {
    model =
      overrides.llmModel?.trim() ||
      overrides.geminiModel?.trim() ||
      config.geminiModel?.trim() ||
      DEFAULT_GEMINI_MODEL;
  } else {
    model =
      overrides.llmModel?.trim() ||
      config.openrouterLlmModel?.trim() ||
      DEFAULT_OPENROUTER_LLM_MODEL;
  }

  return {
    config: nextConfig,
    llm: {
      provider,
      source,
      model,
    },
  };
}

export function createTextModel(
  config: { geminiApiKey?: string | undefined; openrouterApiKey?: string | undefined },
  llm: LlmSettings,
  deps?: { fetch?: typeof fetch | undefined; lang?: SupportedLanguage | undefined },
): TextModel {
  if (llm.provider === "gemini") {
    if (!config.geminiApiKey) {
      throw new Error("Gemini API key is required for Gemini text generation.");
    }
    return createGeminiTextModel(config.geminiApiKey, llm.model);
  }

  if (!config.openrouterApiKey) {
    throw new Error("OpenRouter API key is required for OpenRouter text generation.");
  }
  return createOpenRouterTextModel(config.openrouterApiKey, llm.model, deps);
}
