import fs from "node:fs";
import Groq from "groq-sdk";
import type { SrtEntry } from "./srt.js";

/**
 * Formats seconds (e.g. 62.5) into SRT timestamp format ("00:01:02,500")
 */
export function formatSrtTime(totalSeconds: number): string {
  const totalMs = Math.round(totalSeconds * 1000);
  const hours = Math.floor(totalMs / 3_600_000);
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
  const seconds = Math.floor((totalMs % 60_000) / 1_000);
  const milliseconds = totalMs % 1_000;

  const hh = String(hours).padStart(2, "0");
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  const ms = String(milliseconds).padStart(3, "0");

  return `${hh}:${mm}:${ss},${ms}`;
}

export interface GroqSegment {
  id?: number;
  start: number;
  end: number;
  text: string;
}

export interface GroqVerboseJsonResponse {
  language?: string;
  segments?: GroqSegment[];
}

export interface TranscriptionResult {
  entries: SrtEntry[];
  detectedLanguage?: string | undefined;
}

const LANGUAGE_NAME_TO_CODE: Record<string, string> = {
  japanese: "ja",
  english: "en",
  spanish: "es",
  french: "fr",
  german: "de",
  italian: "it",
  chinese: "zh",
  korean: "ko",
  russian: "ru",
  portuguese: "pt",
  dutch: "nl",
  turkish: "tr",
  polish: "pl",
  arabic: "ar",
  hindi: "hi",
  vietnamese: "vi",
  indonesian: "id",
  thai: "th",
};

export function normalizeLanguageCode(lang?: string): string | undefined {
  if (!lang) return undefined;
  const cleaned = lang.trim().toLowerCase();
  if (LANGUAGE_NAME_TO_CODE[cleaned]) {
    return LANGUAGE_NAME_TO_CODE[cleaned];
  }
  if (cleaned.length === 2) {
    return cleaned;
  }
  const mainPart = cleaned.split("-")[0];
  if (mainPart && mainPart.length === 2) {
    return mainPart;
  }
  return cleaned;
}

export interface TranscribeAudioOptions {
  prompt?: string | undefined;
  model?: string | undefined;
}

/**
 * Calls Groq Audio Transcription API (whisper-large-v3-turbo) for a given audio file path.
 * Returns array of SrtEntry objects and detected language code.
 */
export async function transcribeAudioWithGroq(
  audioPath: string,
  apiKey: string,
  timeOffsetSeconds = 0,
  verbose = false,
  options?: TranscribeAudioOptions,
): Promise<TranscriptionResult> {
  const groq = new Groq({ apiKey });
  const model =
    options?.model ||
    process.env["VSUB_GROQ_MODEL"] ||
    process.env["GROQ_MODEL"] ||
    "whisper-large-v3-turbo";

  if (verbose) {
    const promptInfo = options?.prompt ? ` (prompt: "${options.prompt.slice(0, 30)}...")` : "";
    console.log(
      `[Groq API] Requesting Whisper transcription [model: ${model}]: ${audioPath}${promptInfo}`,
    );
  }

  const response = await groq.audio.transcriptions.create({
    file: fs.createReadStream(audioPath),
    model,
    response_format: "verbose_json",
    ...(options?.prompt ? { prompt: options.prompt } : {}),
  });

  const rawResponse = response as unknown as GroqVerboseJsonResponse;
  const segments = rawResponse.segments || [];
  const detectedLanguage = normalizeLanguageCode(rawResponse.language);
  const entries: SrtEntry[] = [];

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (!seg) continue;
    const startTime = formatSrtTime(seg.start + timeOffsetSeconds);
    const endTime = formatSrtTime(seg.end + timeOffsetSeconds);
    const text = seg.text.trim();

    if (text) {
      entries.push({
        id: i + 1,
        startTime,
        endTime,
        text,
      });
    }
  }

  return { entries, detectedLanguage };
}

export interface TranscribeAudioSegmentsOptions {
  prompt?: string | undefined;
  model?: string | undefined;
  durations?: number[] | undefined;
}

/**
 * Transcribes multiple audio segment files using Groq API and combines SrtEntry array.
 */
export async function transcribeAudioSegments(
  audioPaths: string[],
  apiKey: string,
  verbose = false,
  onProgress?: (current: number, total: number) => void,
  options?: TranscribeAudioSegmentsOptions,
): Promise<TranscriptionResult> {
  const allEntries: SrtEntry[] = [];
  let timeOffsetSeconds = 0;
  let detectedLanguage: string | undefined;

  for (let i = 0; i < audioPaths.length; i++) {
    const audioPath = audioPaths[i];
    if (!audioPath) continue;

    if (onProgress) {
      onProgress(i + 1, audioPaths.length);
    }

    if (verbose && audioPaths.length > 1) {
      console.log(`[Groq API] Transcribing segment (${i + 1}/${audioPaths.length})...`);
    }

    const { entries, detectedLanguage: segmentLang } = await transcribeAudioWithGroq(
      audioPath,
      apiKey,
      timeOffsetSeconds,
      verbose,
      options,
    );

    if (!detectedLanguage && segmentLang) {
      detectedLanguage = segmentLang;
    }

    // Re-index entry IDs sequentially
    for (const entry of entries) {
      allEntries.push({
        ...entry,
        id: allEntries.length + 1,
      });
    }

    // Use accurately measured duration if available, otherwise default to 1200 seconds (20 min)
    const segmentDuration = options?.durations?.[i] ?? 1200;
    timeOffsetSeconds += segmentDuration;
  }

  return { entries: allEntries, detectedLanguage };
}
