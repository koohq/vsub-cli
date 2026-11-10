import { formatSrtTime, type SrtEntry } from "../srt.js";
import { buildEntriesFromWords, type WordChunk } from "./words.js";

/** A span of recognized text. Times are seconds relative to the start of the audio chunk. */
export interface TimedText {
  start: number;
  end: number;
  text: string;
}

/** What one provider call returns for one audio chunk. */
export interface ChunkTranscription {
  segments?: TimedText[] | undefined;
  /**
   * Word-level timestamps. When present (even empty), subtitles are built from the words and
   * `segments` is ignored.
   */
  words?: TimedText[] | undefined;
  /** Raw language as the provider reports it (normalized by the caller). */
  language?: string | undefined;
}

export interface TranscribeChunkOptions {
  prompt?: string | undefined;
  model?: string | undefined;
  verbose?: boolean | undefined;
}

/** Provider-specific request limits that decide how audio is split. */
export interface TranscriberLimits {
  /** Upload size above which the extracted audio is split. */
  maxFileBytes: number;
  /** Length of each split chunk, also the fallback offset when a chunk's duration is unknown. */
  segmentSeconds: number;
  /** When set, audio longer than this many seconds is split even if it is under maxFileBytes. */
  maxChunkSeconds?: number | undefined;
}

export interface Transcriber {
  /** Prefix used in verbose logs, e.g. "Groq API". */
  readonly logLabel: string;
  readonly limits: TranscriberLimits;
  transcribe(audioPath: string, options?: TranscribeChunkOptions): Promise<ChunkTranscription>;
}

export interface TranscriptionResult {
  entries: SrtEntry[];
  detectedLanguage?: string | undefined;
  /** Raw word timings per chunk. Present only when the provider returned words. */
  wordChunks?: WordChunk[] | undefined;
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

const ISO_639_3_TO_CODE: Record<string, string> = {
  jpn: "ja",
  eng: "en",
  spa: "es",
  fra: "fr",
  fre: "fr",
  deu: "de",
  ger: "de",
  ita: "it",
  zho: "zh",
  chi: "zh",
  cmn: "zh",
  kor: "ko",
  rus: "ru",
  por: "pt",
  nld: "nl",
  dut: "nl",
  tur: "tr",
  pol: "pl",
  ara: "ar",
  hin: "hi",
  vie: "vi",
  ind: "id",
  tha: "th",
};

export function normalizeLanguageCode(lang?: string): string | undefined {
  if (!lang) return undefined;
  const cleaned = lang.trim().toLowerCase();
  if (LANGUAGE_NAME_TO_CODE[cleaned]) {
    return LANGUAGE_NAME_TO_CODE[cleaned];
  }
  if (ISO_639_3_TO_CODE[cleaned]) {
    return ISO_639_3_TO_CODE[cleaned];
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

export interface TranscribeAudioSegmentsOptions {
  prompt?: string | undefined;
  model?: string | undefined;
  durations?: number[] | undefined;
}

/**
 * Transcribes multiple audio segment files with the given transcriber and combines SrtEntry array.
 */
export async function transcribeAudioSegments(
  audioPaths: string[],
  transcriber: Transcriber,
  verbose = false,
  onProgress?: (current: number, total: number) => void,
  options?: TranscribeAudioSegmentsOptions,
): Promise<TranscriptionResult> {
  const allEntries: SrtEntry[] = [];
  const wordChunks: WordChunk[] = [];
  let timeOffsetSeconds = 0;
  let detectedLanguage: string | undefined;

  for (let i = 0; i < audioPaths.length; i++) {
    const audioPath = audioPaths[i];
    if (!audioPath) continue;

    if (onProgress) {
      onProgress(i + 1, audioPaths.length);
    }

    if (verbose && audioPaths.length > 1) {
      console.log(
        `[${transcriber.logLabel}] Transcribing segment (${i + 1}/${audioPaths.length})...`,
      );
    }

    const chunk = await transcriber.transcribe(audioPath, {
      prompt: options?.prompt,
      model: options?.model,
      verbose,
    });

    const segmentLang = normalizeLanguageCode(chunk.language);
    if (!detectedLanguage && segmentLang) {
      detectedLanguage = segmentLang;
    }

    // Use accurately measured duration if available, otherwise the provider's chunk length
    const segmentDuration = options?.durations?.[i] ?? transcriber.limits.segmentSeconds;

    if (Array.isArray(chunk.words)) {
      wordChunks.push({ offsetSeconds: timeOffsetSeconds, words: chunk.words });
    } else {
      for (const seg of chunk.segments ?? []) {
        const text = seg.text.trim();
        if (!text) continue;
        allEntries.push({
          id: allEntries.length + 1,
          startTime: formatSrtTime(seg.start + timeOffsetSeconds),
          endTime: formatSrtTime(seg.end + timeOffsetSeconds),
          text,
        });
      }
    }

    timeOffsetSeconds += segmentDuration;
  }

  if (wordChunks.length > 0) {
    return { entries: buildEntriesFromWords(wordChunks), detectedLanguage, wordChunks };
  }

  return { entries: allEntries, detectedLanguage };
}
