import { normalizeBaseUrl } from "../config.js";
import {
  createOpenAICompatibleTranscriber,
  type OpenAICompatibleDeps,
  type OpenAICompatibleSttProfile,
} from "./openai-compatible.js";
import type { Transcriber } from "./transcriber.js";

export function createGenericSttProfile(baseUrl: string): OpenAICompatibleSttProfile {
  return {
    logLabel: "OpenAI-compatible API",
    baseUrl: normalizeBaseUrl(baseUrl) ?? "",
    limits: { maxFileBytes: 24 * 1000 * 1000, segmentSeconds: 300, maxChunkSeconds: 300 },
    promptField: "prompt",
    maxConcurrentRequests: 1,
    requestTimeoutMs: 300_000,
  };
}

export function createGenericOpenAICompatibleTranscriber(
  baseUrl: string,
  apiKey: string,
  deps?: OpenAICompatibleDeps,
): Transcriber {
  return createOpenAICompatibleTranscriber(createGenericSttProfile(baseUrl), apiKey, deps);
}
