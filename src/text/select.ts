import {
  type AppConfig,
  assertOpenAICompatibleSettingsReady,
  DEFAULT_GEMINI_MODEL,
  normalizeBaseUrl,
} from "../config.js";
import { getI18n, type SupportedLanguage } from "../i18n/index.js";
import { createGeminiTextModel } from "./gemini.js";
import type { TextModel } from "./model.js";
import { createGenericOpenAICompatibleTextModel } from "./openai-compatible-provider.js";
import { createOpenRouterTextModel, DEFAULT_OPENROUTER_LLM_MODEL } from "./openrouter.js";
import {
  LLM_PROVIDER_LABELS,
  LLM_PROVIDERS,
  LLM_REASONING_EFFORTS,
  type LlmProvider,
  type LlmReasoningEffort,
} from "./providers.js";

export { LLM_PROVIDER_LABELS, LLM_PROVIDERS, type LlmProvider };

export function parseLlmReasoningEffort(
  raw: string,
  lang?: SupportedLanguage | string | undefined,
): LlmReasoningEffort {
  const normalized = raw.trim().toLowerCase();
  if ((LLM_REASONING_EFFORTS as readonly string[]).includes(normalized))
    return normalized as LlmReasoningEffort;
  throw new Error(getI18n(lang).pipeline.invalidLlmReasoningEffort(raw.trim()));
}

export function assertLlmSettingsReady(
  settings: LlmSettings,
  lang?: SupportedLanguage | string,
): void {
  assertOpenAICompatibleSettingsReady(settings, "llm", lang);
}

export interface LlmSettings {
  provider: LlmProvider;
  /** "option": --llm-provider, "setting": VSUB_LLM_PROVIDER or config file, "auto": chosen from the keys. */
  source: "option" | "setting" | "auto";
  /** Model sent to the provider. */
  model: string;
  baseUrl?: string | undefined;
  /** Low is omitted to preserve existing cache contexts. Never used by openai-compatible. */
  reasoningEffort?: Exclude<LlmReasoningEffort, "low"> | undefined;
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
    llmReasoningEffort?: string | undefined;
    /** Execution paths validate; configuration inspection and init remain tolerant. */
    validateReasoningEffort?: boolean | undefined;
    geminiModel?: string | undefined;
  },
  lang?: SupportedLanguage | string | undefined,
): { config: AppConfig; llm: LlmSettings } {
  let provider: LlmProvider;
  let source: "option" | "setting" | "auto";
  const rawEffort = overrides.llmReasoningEffort?.trim() || config.llmReasoningEffort?.trim();
  let effort: LlmReasoningEffort = "low";
  if (rawEffort) {
    try {
      effort = parseLlmReasoningEffort(rawEffort, lang);
    } catch (error) {
      if (overrides.validateReasoningEffort) throw error;
    }
  }

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
  if (provider === "openai-compatible") {
    model = overrides.llmModel?.trim() || config.openaiCompatibleLlmModel?.trim() || "";
  } else if (provider === "gemini") {
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
      ...(provider !== "openai-compatible" && effort !== "low" ? { reasoningEffort: effort } : {}),
      ...(provider === "openai-compatible"
        ? { baseUrl: normalizeBaseUrl(config.openaiCompatibleLlmBaseUrl) }
        : {}),
    },
  };
}

export function createTextModel(
  config: Partial<
    Pick<
      AppConfig,
      | "geminiApiKey"
      | "openrouterApiKey"
      | "openaiCompatibleLlmApiKey"
      | "openaiCompatibleLlmReasoningEffort"
    >
  >,
  llm: LlmSettings,
  deps?: { fetch?: typeof fetch | undefined; lang?: SupportedLanguage | undefined },
): TextModel {
  if (llm.provider === "openai-compatible") {
    assertLlmSettingsReady(llm, deps?.lang);
    return createGenericOpenAICompatibleTextModel(
      llm.baseUrl?.trim() ?? "",
      config.openaiCompatibleLlmApiKey?.trim() || "",
      llm.model,
      { ...deps, reasoningEffort: config.openaiCompatibleLlmReasoningEffort?.trim() || undefined },
    );
  }

  if (llm.provider === "gemini") {
    if (!config.geminiApiKey) {
      throw new Error(getI18n(deps?.lang).pipeline.geminiTextKeyRequired);
    }
    return createGeminiTextModel(config.geminiApiKey, llm.model, llm.reasoningEffort);
  }

  if (!config.openrouterApiKey) {
    throw new Error(getI18n(deps?.lang).pipeline.openrouterTextKeyRequired);
  }
  return createOpenRouterTextModel(config.openrouterApiKey, llm.model, deps, llm.reasoningEffort);
}
