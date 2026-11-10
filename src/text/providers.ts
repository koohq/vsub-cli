export type LlmProvider = "gemini" | "openrouter";

export const LLM_PROVIDERS = ["gemini", "openrouter"] as const;

export const LLM_PROVIDER_LABELS: Record<LlmProvider, string> = {
  gemini: "Gemini",
  openrouter: "OpenRouter",
};
