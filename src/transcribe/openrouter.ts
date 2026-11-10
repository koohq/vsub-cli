import {
  createOpenAICompatibleTranscriber,
  type OpenAICompatibleDeps,
  type OpenAICompatibleSttProfile,
} from "./openai-compatible.js";
import type { Transcriber, TranscriberLimits } from "./transcriber.js";

export const DEFAULT_OPENROUTER_STT_MODEL = "elevenlabs/scribe-v2";

export const OPENROUTER_LIMITS: TranscriberLimits = {
  maxFileBytes: 24 * 1000 * 1000, // multipart upload limit is 25 MB
  segmentSeconds: 300,
  maxChunkSeconds: 300, // one request times out after 60 s on the provider side
};

export const OPENROUTER_STT_PROFILE: OpenAICompatibleSttProfile = {
  logLabel: "OpenRouter API",
  baseUrl: "https://openrouter.ai/api/v1",
  defaultModel: DEFAULT_OPENROUTER_STT_MODEL,
  limits: OPENROUTER_LIMITS,
  promptField: "none",
  maxConcurrentRequests: 1,
  requestTimeoutMs: 120_000,
};

export function createOpenRouterTranscriber(
  apiKey: string,
  deps?: OpenAICompatibleDeps,
): Transcriber {
  return createOpenAICompatibleTranscriber(OPENROUTER_STT_PROFILE, apiKey, deps);
}
