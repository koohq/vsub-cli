import type { AppConfig } from "../config.js";
import { createGroqTranscriber } from "./groq.js";
import type { Transcriber } from "./transcriber.js";

/**
 * Picks the transcriber implementation to use. Currently always Groq.
 */
export function createTranscriber(config: Pick<AppConfig, "groqApiKey">): Transcriber {
  return createGroqTranscriber(config.groqApiKey);
}
