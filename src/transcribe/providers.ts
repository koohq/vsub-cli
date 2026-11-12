export type SttProvider = "openrouter" | "groq" | "openai-compatible";

export const STT_PROVIDERS = ["openrouter", "groq", "openai-compatible"] as const;

export const STT_PROVIDER_LABELS: Record<SttProvider, string> = {
  openrouter: "OpenRouter",
  groq: "Groq",
  "openai-compatible": "OpenAI-compatible",
};
