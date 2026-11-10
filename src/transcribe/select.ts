import { type AppConfig, DEFAULT_GROQ_MODEL } from "../config.js";
import { getI18n, type SupportedLanguage } from "../i18n/index.js";
import { createGroqTranscriber } from "./groq.js";
import { createOpenRouterTranscriber, DEFAULT_OPENROUTER_STT_MODEL } from "./openrouter.js";
import { STT_PROVIDER_LABELS, STT_PROVIDERS, type SttProvider } from "./providers.js";
import type { Transcriber } from "./transcriber.js";

export { STT_PROVIDER_LABELS, STT_PROVIDERS, type SttProvider };

export interface SttSettings {
  provider: SttProvider;
  /** "option": --stt-provider, "setting": VSUB_STT_PROVIDER or config file, "auto": chosen from the keys. */
  source: "option" | "setting" | "auto";
  /** Model sent to the provider. */
  model: string;
}

export function parseSttProvider(
  raw: string,
  lang?: SupportedLanguage | string | undefined,
): SttProvider {
  const normalized = raw.trim().toLowerCase();
  if ((STT_PROVIDERS as readonly string[]).includes(normalized)) {
    return normalized as SttProvider;
  }
  const i18n = getI18n(lang);
  throw new Error(i18n.pipeline.invalidSttProvider(raw.trim()));
}

export function resolveSttSettings(
  config: AppConfig,
  overrides: {
    sttProvider?: string | undefined;
    sttModel?: string | undefined;
    groqModel?: string | undefined;
  },
  lang?: SupportedLanguage | string | undefined,
): { config: AppConfig; stt: SttSettings } {
  let provider: SttProvider;
  let source: "option" | "setting" | "auto";

  const rawOptionProvider = overrides.sttProvider?.trim();
  const rawSettingProvider = config.sttProvider?.trim();

  if (rawOptionProvider) {
    provider = parseSttProvider(rawOptionProvider, lang);
    source = "option";
  } else if (rawSettingProvider) {
    provider = parseSttProvider(rawSettingProvider, lang);
    source = "setting";
  } else {
    source = "auto";
    if (config.openrouterApiKey?.trim()) {
      provider = "openrouter";
    } else if (config.groqApiKey?.trim()) {
      provider = "groq";
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
  if (provider === "groq") {
    model =
      overrides.sttModel?.trim() ||
      overrides.groqModel?.trim() ||
      config.groqModel?.trim() ||
      DEFAULT_GROQ_MODEL;
  } else {
    model =
      overrides.sttModel?.trim() ||
      config.openrouterSttModel?.trim() ||
      DEFAULT_OPENROUTER_STT_MODEL;
  }

  return {
    config: nextConfig,
    stt: {
      provider,
      source,
      model,
    },
  };
}

/**
 * Picks the transcriber implementation to use.
 */
export function createTranscriber(
  config: Pick<AppConfig, "groqApiKey"> & { openrouterApiKey?: string | undefined },
  provider: SttProvider = "groq",
): Transcriber {
  if (provider === "openrouter") {
    if (!config.openrouterApiKey) {
      throw new Error("OpenRouter API key is required for OpenRouter transcription.");
    }
    return createOpenRouterTranscriber(config.openrouterApiKey);
  }

  return createGroqTranscriber(config.groqApiKey);
}
