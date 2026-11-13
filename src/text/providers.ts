export type LlmProvider = "gemini" | "openrouter" | "openai-compatible";
export type LlmReasoningEffort = "minimal" | "low" | "medium" | "high";
export const LLM_REASONING_EFFORTS = ["minimal", "low", "medium", "high"] as const;

export const LLM_PROVIDERS = ["gemini", "openrouter", "openai-compatible"] as const;

export const LLM_PROVIDER_LABELS: Record<LlmProvider, string> = {
  gemini: "Gemini",
  openrouter: "OpenRouter",
  "openai-compatible": "OpenAI-compatible",
};
