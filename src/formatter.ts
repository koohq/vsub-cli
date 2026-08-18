import { type SrtEntry, stringifySrt } from "./srt.js";

export type OutputFormat = "srt" | "vtt" | "txt" | "json";

export const SUPPORTED_FORMATS: readonly OutputFormat[] = ["srt", "vtt", "txt", "json"] as const;

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
