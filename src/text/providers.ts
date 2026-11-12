export type LlmProvider = "gemini" | "openrouter" | "openai-compatible";

export const LLM_PROVIDERS = ["gemini", "openrouter", "openai-compatible"] as const;

export const LLM_PROVIDER_LABELS: Record<LlmProvider, string> = {
  gemini: "Gemini",
  openrouter: "OpenRouter",
  "openai-compatible": "OpenAI-compatible",
};
