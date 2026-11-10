export type SttProvider = "openrouter" | "groq";

export const STT_PROVIDERS = ["openrouter", "groq"] as const;

export const STT_PROVIDER_LABELS: Record<SttProvider, string> = {
  openrouter: "OpenRouter",
  groq: "Groq",
};
