import fs from "node:fs";
import path from "node:path";
import type {
  ChunkTranscription,
  TimedText,
  Transcriber,
  TranscriberLimits,
} from "./transcriber.js";

const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504, 524, 529]);
const DEFAULT_RETRY_DELAYS_MS = [2000, 4000] as const;
const MAX_RETRY_AFTER_SECONDS = 30;
const MAX_RETRY_COUNT = 2; // total attempts = 3

/** Everything that differs between OpenAI-compatible speech-to-text providers. */
export interface OpenAICompatibleSttProfile {
  /** Prefix used in verbose logs and error messages, e.g. "OpenRouter API". */
  logLabel: string;
  /** API base URL without a trailing slash, e.g. "https://openrouter.ai/api/v1". */
  baseUrl: string;
  /** Model used when the caller passes none. */
  defaultModel?: string | undefined;
  limits: TranscriberLimits;
  /**
   * How the recognition hint (whisperPrompt) is sent.
   * "prompt": as the multipart `prompt` field. "none": the API has no such field; the hint is not sent.
   */
  promptField: "prompt" | "none";
  /** Chunks sent at the same time. transcribeAudioSegments sends one at a time, so only 1 is supported. */
  maxConcurrentRequests: 1;
  /** Client-side timeout of one request, in milliseconds. */
  requestTimeoutMs: number;
}

export interface OpenAICompatibleDeps {
  /** Defaults to globalThis.fetch. Tests pass a fake. */
  fetch?: typeof fetch | undefined;
  /** Defaults to a setTimeout-based sleep. Tests pass a fake so retries do not wait. */
  sleep?: ((ms: number) => Promise<void>) | undefined;
}

function getAudioMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".m4a":
    case ".mp4":
      return "audio/mp4";
    case ".mp3":
      return "audio/mpeg";
    case ".wav":
      return "audio/wav";
    default:
      return "application/octet-stream";
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface RawTimedItem {
  start?: unknown;
  end?: unknown;
  text?: unknown;
  word?: unknown;
  type?: unknown;
}

interface RawResponsePayload {
  text?: unknown;
  language?: unknown;
  segments?: unknown;
  words?: unknown;
  error?: {
    message?: unknown;
  };
}

export function createOpenAICompatibleTranscriber(
  profile: OpenAICompatibleSttProfile,
  apiKey: string,
  deps?: OpenAICompatibleDeps,
): Transcriber {
  let hasWarnedPrompt = false;

  return {
    logLabel: profile.logLabel,
    limits: profile.limits,
    async transcribe(audioPath, options) {
      const model = options?.model || profile.defaultModel || "";

      if (profile.promptField === "none" && options?.prompt) {
        if (options.verbose && !hasWarnedPrompt) {
          hasWarnedPrompt = true;
          console.error(
            `[${profile.logLabel}] Recognition hints (whisper prompt) are not sent: this API has no prompt field.`,
          );
        }
      }

      if (options?.verbose) {
        console.error(
          `[${profile.logLabel}] Requesting transcription [model: ${model}]: ${audioPath}`,
        );
      }

      const fetchFn = deps?.fetch ?? globalThis.fetch;
      const sleepFn = deps?.sleep ?? defaultSleep;
      const url = `${profile.baseUrl}/audio/transcriptions`;

      for (let attempt = 0; attempt <= MAX_RETRY_COUNT; attempt++) {
        const mimeType = getAudioMimeType(audioPath);
        const blob = await fs.openAsBlob(audioPath, { type: mimeType });

        const formData = new FormData();
        formData.append("file", blob, path.basename(audioPath));
        formData.append("model", model);
        formData.append("response_format", "verbose_json");
        formData.append("timestamp_granularities[]", "segment");
        formData.append("timestamp_granularities[]", "word");
        if (profile.promptField === "prompt" && options?.prompt) {
          formData.append("prompt", options.prompt);
        }

        const signal = AbortSignal.timeout(profile.requestTimeoutMs);

        let response: Response;
        try {
          response = await fetchFn(url, {
            method: "POST",
            headers: {
              ...(apiKey.trim() ? { Authorization: `Bearer ${apiKey}` } : {}),
            },
            body: formData,
            signal,
          });
        } catch (fetchErr) {
          if (attempt < MAX_RETRY_COUNT) {
            const delay = DEFAULT_RETRY_DELAYS_MS[attempt] ?? 2000;
            if (options?.verbose) {
              const errDesc = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
              console.error(
                `[${profile.logLabel}] Retrying (${attempt + 1}/${MAX_RETRY_COUNT}) after ${errDesc}...`,
              );
            }
            await sleepFn(delay);
            continue;
          }
          throw fetchErr;
        }

        if (response.ok) {
          let rawData: unknown;
          try {
            rawData = await response.json();
          } catch {
            throw new Error(
              `${profile.logLabel} returned an unexpected response (status ${response.status})`,
            );
          }

          if (typeof rawData !== "object" || rawData === null) {
            throw new Error(
              `${profile.logLabel} returned an unexpected response (status ${response.status})`,
            );
          }

          const data = rawData as RawResponsePayload;
          const language = typeof data.language === "string" ? data.language : undefined;

          const segments: TimedText[] = [];
          if (Array.isArray(data.segments)) {
            for (const s of data.segments as RawTimedItem[]) {
              if (
                typeof s === "object" &&
                s !== null &&
                typeof s.start === "number" &&
                Number.isFinite(s.start) &&
                typeof s.end === "number" &&
                Number.isFinite(s.end) &&
                typeof s.text === "string"
              ) {
                segments.push({
                  start: s.start,
                  end: s.end,
                  text: s.text,
                });
              }
            }
          }

          let words: TimedText[] | undefined;
          if (Array.isArray(data.words) && data.words.length > 0) {
            const parsedWords: TimedText[] = [];
            for (const w of data.words as RawTimedItem[]) {
              if (typeof w === "object" && w !== null) {
                if (w.type === "audio_event") {
                  continue;
                }
                if (
                  typeof w.start === "number" &&
                  Number.isFinite(w.start) &&
                  typeof w.end === "number" &&
                  Number.isFinite(w.end) &&
                  typeof w.word === "string"
                ) {
                  parsedWords.push({
                    start: w.start,
                    end: w.end,
                    text: w.word,
                  });
                }
              }
            }
            words = parsedWords;
          }

          const result: ChunkTranscription = {
            segments,
            language,
            ...(words !== undefined ? { words } : {}),
          };
          if (
            segments.length === 0 &&
            words === undefined &&
            typeof data.text === "string" &&
            data.text.trim().length > 0
          ) {
            throw new Error(
              `${profile.logLabel} returned a transcript without timestamps for model "${model}". Subtitles need segment or word timestamps (response_format=verbose_json). Choose a model that returns them${profile.defaultModel ? `, such as ${profile.defaultModel}` : ""}.`,
            );
          }
          return result;
        }

        let errorMessage = "";
        try {
          const errData = (await response.json()) as RawResponsePayload;
          if (typeof errData?.error?.message === "string") {
            errorMessage = errData.error.message;
          }
        } catch {
          // ignore parsing error
        }

        const formattedMessage = errorMessage
          ? `${profile.logLabel} error ${response.status}: ${errorMessage}`
          : `${profile.logLabel} error ${response.status}`;
        const err = new Error(formattedMessage);

        if (RETRYABLE_STATUS_CODES.has(response.status) && attempt < MAX_RETRY_COUNT) {
          let delay: number = DEFAULT_RETRY_DELAYS_MS[attempt] ?? 2000;
          const retryAfter = response.headers.get("Retry-After");
          if (retryAfter && /^\d+$/.test(retryAfter.trim())) {
            const sec = parseInt(retryAfter.trim(), 10);
            delay = Math.min(sec, MAX_RETRY_AFTER_SECONDS) * 1000;
          }
          if (options?.verbose) {
            console.error(
              `[${profile.logLabel}] Retrying (${attempt + 1}/${MAX_RETRY_COUNT}) after ${response.status}...`,
            );
          }
          await sleepFn(delay);
          continue;
        }

        throw err;
      }

      throw new Error(`${profile.logLabel} failed after ${MAX_RETRY_COUNT + 1} attempts`);
    },
  };
}
