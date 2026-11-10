import { getI18n, type SupportedLanguage } from "../i18n/index.js";
import type { TextModel } from "./model.js";
import {
  createOpenAICompatibleTextModel,
  type OpenAICompatibleTextProfile,
} from "./openai-compatible.js";

export const DEFAULT_OPENROUTER_LLM_MODEL = "google/gemini-3.8-flash";

export const OPENROUTER_TEXT_PROFILE: OpenAICompatibleTextProfile = {
  logLabel: "OpenRouter API",
  baseUrl: "https://openrouter.ai/api/v1",
  defaultModel: DEFAULT_OPENROUTER_LLM_MODEL,
  limits: {
    defaultConcurrency: 3,
  },
  maxTokens: 16384,
  reasoning: { effort: "low" },
  requestTimeoutMs: 120_000,
  messages: {
    modelNotFound: (model: string, isDefault: boolean, lang?: SupportedLanguage | undefined) => {
      const i18n = getI18n(lang);
      return isDefault
        ? i18n.openrouter.modelRetiredDefault(model)
        : i18n.openrouter.modelNotFoundCustom(model);
    },
    insufficientCredits: (lang?: SupportedLanguage | undefined) => {
      const i18n = getI18n(lang);
      return i18n.openrouter.insufficientCredits;
    },
  },
};

export function createOpenRouterTextModel(
  apiKey: string,
  model: string,
  deps?: { fetch?: typeof fetch | undefined; lang?: SupportedLanguage | undefined },
): TextModel {
  return createOpenAICompatibleTextModel(OPENROUTER_TEXT_PROFILE, apiKey, model, deps);
}
