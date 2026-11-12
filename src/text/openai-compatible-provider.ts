import { normalizeBaseUrl } from "../config.js";
import { getI18n, type SupportedLanguage } from "../i18n/index.js";
import type { TextModel } from "./model.js";
import {
  createOpenAICompatibleTextModel,
  type OpenAICompatibleTextProfile,
} from "./openai-compatible.js";

export function createGenericTextProfile(
  baseUrl: string,
  reasoningEffort?: string | undefined,
): OpenAICompatibleTextProfile {
  const normalizedUrl = normalizeBaseUrl(baseUrl) ?? "";
  return {
    logLabel: "OpenAI-compatible API",
    baseUrl: normalizedUrl,
    limits: { defaultConcurrency: 1 },
    requestTimeoutMs: 300_000,
    ...(reasoningEffort ? { reasoningEffort } : {}),
    messages: {
      modelNotFound: (model, _isDefault, lang) =>
        getI18n(lang).openaiCompatible.modelNotFound(model, normalizedUrl),
    },
  };
}

export function createGenericOpenAICompatibleTextModel(
  baseUrl: string,
  apiKey: string,
  model: string,
  deps?: {
    fetch?: typeof fetch | undefined;
    lang?: SupportedLanguage | undefined;
    reasoningEffort?: string | undefined;
  },
): TextModel {
  return createOpenAICompatibleTextModel(
    createGenericTextProfile(baseUrl, deps?.reasoningEffort),
    apiKey,
    model,
    deps,
  );
}
