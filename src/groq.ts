import fs from "node:fs";
import Groq from "groq-sdk";
import type { SrtEntry } from "./srt.js";

/**
 * Formats seconds (e.g. 62.5) into SRT timestamp format ("00:01:02,500")
 */
export function formatSrtTime(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const milliseconds = Math.floor((totalSeconds % 1) * 1000);

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

/**
 * Calls Groq Audio Transcription API (whisper-large-v3-turbo) for a given audio file path.
 * Returns array of SrtEntry objects.
 */
export async function transcribeAudioWithGroq(
  audioPath: string,
  apiKey: string,
  timeOffsetSeconds = 0,
  verbose = false,
): Promise<SrtEntry[]> {
  const groq = new Groq({ apiKey });

  if (verbose) {
    console.log(`[Groq API] Whisper 文字起こし要求を送信中: ${audioPath}`);
  }

  const response = await groq.audio.transcriptions.create({
    file: fs.createReadStream(audioPath),
    model: "whisper-large-v3-turbo",
    response_format: "verbose_json",
  });

  const segments = (response as unknown as { segments?: GroqSegment[] }).segments || [];
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

  return entries;
}

/**
 * Transcribes multiple audio segment files using Groq API and combines SrtEntry array.
 */
export async function transcribeAudioSegments(
  audioPaths: string[],
  apiKey: string,
  verbose = false,
): Promise<SrtEntry[]> {
  const allEntries: SrtEntry[] = [];
  let timeOffsetSeconds = 0;

  for (let i = 0; i < audioPaths.length; i++) {
    const audioPath = audioPaths[i];
    if (!audioPath) continue;

    if (verbose && audioPaths.length > 1) {
      console.log(`[Groq API] セグメント (${i + 1}/${audioPaths.length}) を文字起こし中...`);
    }

    const entries = await transcribeAudioWithGroq(audioPath, apiKey, timeOffsetSeconds, verbose);

    // Re-index entry IDs sequentially
    for (const entry of entries) {
      allEntries.push({
        ...entry,
        id: allEntries.length + 1,
      });
    }

    // Each segment is 20 minutes (1200 seconds) if split
    timeOffsetSeconds += 1200;
  }

  return allEntries;
}
