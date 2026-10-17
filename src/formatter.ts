import { type SrtEntry, stringifySrt } from "./srt.js";

export type OutputFormat = "srt" | "vtt" | "txt" | "json";

export const SUPPORTED_FORMATS: readonly OutputFormat[] = ["srt", "vtt", "txt", "json"] as const;

export interface ChapterItem {
  timestamp: string;
  seconds: number;
  title: string;
}

export type ChaptersFormat = "txt" | "json" | "vtt";
export const SUPPORTED_CHAPTERS_FORMATS: readonly ChaptersFormat[] = [
  "txt",
  "json",
  "vtt",
] as const;

export interface SummaryTopic {
  timestamp: string;
  title: string;
  description: string;
}

export interface SummaryResult {
  title: string;
  summary: string;
  keyPoints: string[];
  topics: SummaryTopic[];
}

export type SummaryFormat = "md" | "txt" | "json";
export const SUPPORTED_SUMMARY_FORMATS: readonly SummaryFormat[] = ["md", "txt", "json"] as const;

/**
 * Converts a total number of seconds into standard timestamp format (MM:SS or HH:MM:SS).
 */
export function secondsToTimestamp(totalSeconds: number): string {
  const rounded = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const seconds = rounded % 60;

  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");

  if (hours > 0) {
    const hh = String(hours).padStart(2, "0");
    return `${hh}:${mm}:${ss}`;
  }
  return `${mm}:${ss}`;
}

/**
 * Converts timestamp string (MM:SS, HH:MM:SS, or H:MM:SS) into total seconds.
 */
export function timestampToSeconds(timestamp: string): number {
  const parts = timestamp
    .trim()
    .split(":")
    .map((p) => Number.parseFloat(p));
  if (parts.some((n) => Number.isNaN(n))) {
    return 0;
  }

  if (parts.length === 3) {
    const [h = 0, m = 0, s = 0] = parts;
    return Math.floor(h * 3600 + m * 60 + s);
  }
  if (parts.length === 2) {
    const [m = 0, s = 0] = parts;
    return Math.floor(m * 60 + s);
  }
  if (parts.length === 1) {
    return Math.floor(parts[0] ?? 0);
  }
  return 0;
}

/**
 * Converts seconds into WebVTT timestamp format (HH:MM:SS.000).
 */
export function secondsToVttTimestamp(totalSeconds: number): string {
  const safeSeconds = Math.max(0, totalSeconds);
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = Math.floor(safeSeconds % 60);
  const milliseconds = Math.floor((safeSeconds % 1) * 1000);

  const hh = String(hours).padStart(2, "0");
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  const ms = String(milliseconds).padStart(3, "0");

  return `${hh}:${mm}:${ss}.${ms}`;
}

/**
 * Validates and parses chapter format.
 */
export function parseChaptersFormat(input?: string): ChaptersFormat {
  if (!input?.trim()) {
    return "txt";
  }
  const normalized = input.trim().toLowerCase();
  if (SUPPORTED_CHAPTERS_FORMATS.includes(normalized as ChaptersFormat)) {
    return normalized as ChaptersFormat;
  }
  throw new Error(
    `Unsupported chapters format: "${input}". Supported formats: ${SUPPORTED_CHAPTERS_FORMATS.join(", ")}`,
  );
}

/**
 * Validates and parses summary format.
 */
export function parseSummaryFormat(input?: string): SummaryFormat {
  if (!input?.trim()) {
    return "md";
  }
  const normalized = input.trim().toLowerCase();
  if (SUPPORTED_SUMMARY_FORMATS.includes(normalized as SummaryFormat)) {
    return normalized as SummaryFormat;
  }
  throw new Error(
    `Unsupported summary format: "${input}". Supported formats: ${SUPPORTED_SUMMARY_FORMATS.join(", ")}`,
  );
}

/**
 * Formats chapters into requested output format (txt, json, vtt).
 */
export function formatChapters(
  chapters: ChapterItem[],
  format: ChaptersFormat,
  mediaDurationSeconds?: number,
): string {
  if (chapters.length === 0) {
    return format === "json" ? "[]\n" : format === "vtt" ? "WEBVTT\n" : "";
  }

  switch (format) {
    case "txt": {
      // YouTube format: "00:00 Title"
      return `${chapters.map((c) => `${c.timestamp} ${c.title}`).join("\n")}\n`;
    }
    case "json": {
      return `${JSON.stringify(chapters, null, 2)}\n`;
    }
    case "vtt": {
      // WebVTT Chapters format
      const blocks: string[] = [];
      for (let i = 0; i < chapters.length; i++) {
        const current = chapters[i];
        if (!current) continue;
        const startSec = current.seconds;
        const nextChapter = chapters[i + 1];
        const endSec =
          nextChapter !== undefined
            ? nextChapter.seconds
            : mediaDurationSeconds !== undefined && mediaDurationSeconds > startSec
              ? mediaDurationSeconds
              : startSec + 60; // fallback 60s for final chapter if duration unknown

        const startVtt = secondsToVttTimestamp(startSec);
        const endVtt = secondsToVttTimestamp(endSec);
        blocks.push(`${startVtt} --> ${endVtt}\n${current.title}`);
      }
      return `WEBVTT\n\n${blocks.join("\n\n")}\n`;
    }
  }
}

/**
 * Formats summary into requested output format (md, txt, json).
 */
export function formatSummary(summary: SummaryResult, format: SummaryFormat): string {
  switch (format) {
    case "md": {
      const lines: string[] = [
        `# ${summary.title}`,
        "",
        "## Summary",
        summary.summary,
        "",
        "## Key Points",
        ...summary.keyPoints.map((point) => `- ${point}`),
        "",
        "## Topics",
        ...summary.topics.map(
          (topic) => `- **[${topic.timestamp}] ${topic.title}**: ${topic.description}`,
        ),
        "",
      ];
      return lines.join("\n");
    }
    case "txt": {
      const divider = "=".repeat(50);
      const lines: string[] = [
        divider,
        summary.title,
        divider,
        "",
        "[Summary]",
        summary.summary,
        "",
        "[Key Points]",
        ...summary.keyPoints.map((point) => `• ${point}`),
        "",
        "[Topics]",
        ...summary.topics.map(
          (topic) => `• [${topic.timestamp}] ${topic.title}: ${topic.description}`,
        ),
        "",
      ];
      return lines.join("\n");
    }
    case "json": {
      return `${JSON.stringify(summary, null, 2)}\n`;
    }
  }
}

/**
 * Validates and parses a comma-separated format string into an array of OutputFormat.
 * Example: "srt,vtt,txt" -> ["srt", "vtt", "txt"]
 */
export function parseOutputFormats(input?: string): OutputFormat[] {
  if (!input?.trim()) {
    return ["srt"];
  }

  const rawTokens = input
    .split(",")
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);

  if (rawTokens.length === 0) {
    return ["srt"];
  }

  const formats: OutputFormat[] = [];
  const seen = new Set<string>();

  for (const token of rawTokens) {
    if (!SUPPORTED_FORMATS.includes(token as OutputFormat)) {
      throw new Error(
        `サポートされていない出力フォーマットです: "${token}". 利用可能なフォーマット: ${SUPPORTED_FORMATS.join(", ")}`,
      );
    }
    if (!seen.has(token)) {
      seen.add(token);
      formats.push(token as OutputFormat);
    }
  }

  return formats.length > 0 ? formats : ["srt"];
}

/**
 * Converts structured SrtEntry objects into a WebVTT formatted string.
 */
export function stringifyVtt(entries: SrtEntry[]): string {
  if (entries.length === 0) {
    return "WEBVTT\n";
  }

  const body = entries
    .map((entry, index) => {
      const id = entry.id || index + 1;
      const startTime = entry.startTime.replace(",", ".");
      const endTime = entry.endTime.replace(",", ".");
      return `${id}\n${startTime} --> ${endTime}\n${entry.text}`;
    })
    .join("\n\n");

  return `WEBVTT\n\n${body}\n`;
}

/**
 * Converts structured SrtEntry objects into plain text transcript without timestamps.
 */
export function stringifyTxt(entries: SrtEntry[]): string {
  if (entries.length === 0) {
    return "";
  }

  return `${entries.map((entry) => entry.text).join("\n")}\n`;
}

/**
 * Converts structured SrtEntry objects into formatted JSON string.
 */
export function stringifyJson(entries: SrtEntry[]): string {
  return `${JSON.stringify(entries, null, 2)}\n`;
}

/**
 * Formats structured SrtEntry objects into the requested output format.
 */
export function formatEntries(entries: SrtEntry[], format: OutputFormat): string {
  switch (format) {
    case "srt":
      return stringifySrt(entries);
    case "vtt":
      return stringifyVtt(entries);
    case "txt":
      return stringifyTxt(entries);
    case "json":
      return stringifyJson(entries);
  }
}
