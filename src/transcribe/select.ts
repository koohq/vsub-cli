import type { AppConfig } from "../config.js";
import { createGroqTranscriber } from "./groq.js";
import { createOpenRouterTranscriber } from "./openrouter.js";
import type { Transcriber } from "./transcriber.js";

export type SttProvider = "groq" | "openrouter";

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
