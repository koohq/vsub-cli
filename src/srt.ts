export interface SrtEntry {
  id: number;
  startTime: string;
  endTime: string;
  text: string;
}

export const DEFAULT_MAX_LENGTH_CJK = 32;
export const DEFAULT_MAX_LENGTH_LATIN = 75;
export const DEFAULT_MAX_DURATION_SECONDS = 7;

const CJK_REGEX =
  /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff66-\uff9f\uac00-\ud7af]/;

/**
 * Checks if a string contains CJK (Japanese, Chinese, Korean) characters.
 */
export function isCjkText(text: string): boolean {
  return CJK_REGEX.test(text);
}

/**
 * Parses an SRT timestamp ("00:01:02,500" or "00:01:02.500") into total milliseconds.
 */
export function parseSrtTime(timeStr: string): number {
  const match = timeStr.trim().match(/^(\d{2}):(\d{2}):(\d{2})[,.](\d{3})$/);
  if (!match) return 0;
  const hours = Number.parseInt(match[1] ?? "0", 10);
  const minutes = Number.parseInt(match[2] ?? "0", 10);
  const seconds = Number.parseInt(match[3] ?? "0", 10);
  const ms = Number.parseInt(match[4] ?? "0", 10);
  return hours * 3_600_000 + minutes * 60_000 + seconds * 1000 + ms;
}

/**
 * Formats milliseconds (e.g. 62500) into SRT timestamp format ("00:01:02,500").
 */
export function formatSrtTimeMs(totalMs: number): string {
  const clampedMs = Math.max(0, Math.round(totalMs));
  const hours = Math.floor(clampedMs / 3_600_000);
  const minutes = Math.floor((clampedMs % 3_600_000) / 60_000);
  const seconds = Math.floor((clampedMs % 60_000) / 1_000);
  const milliseconds = clampedMs % 1_000;

  const hh = String(hours).padStart(2, "0");
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  const ms = String(milliseconds).padStart(3, "0");

  return `${hh}:${mm}:${ss},${ms}`;
}

/**
 * Formats seconds (e.g. 62.5) into SRT timestamp format ("00:01:02,500").
 */
export function formatSrtTime(totalSeconds: number): string {
  return formatSrtTimeMs(totalSeconds * 1000);
}

/**
 * Parses an SRT formatted string into structured SrtEntry objects.
 */
export function parseSrt(srtText: string): SrtEntry[] {
  const entries: SrtEntry[] = [];
  const normalized = srtText.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const blocks = normalized.trim().split(/\n\n+/);

  for (const block of blocks) {
    const lines = block.trim().split("\n");
    if (lines.length < 2) continue;

    const line0 = lines[0];
    if (!line0) continue;

    // Check if first line is ID (number)
    const idMatch = line0.trim().match(/^(\d+)$/);
    if (!idMatch) continue;

    const rawId = idMatch[1];
    if (!rawId) continue;

    const id = Number.parseInt(rawId, 10);
    const timeLineIndex = 1;
    const timeLine = lines[timeLineIndex];
    if (!timeLine) continue;

    const timeMatch = timeLine.match(
      /^(\d{2}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,.]\d{3})/,
    );

    if (!timeMatch) continue;

    const rawStart = timeMatch[1];
    const rawEnd = timeMatch[2];
    if (!rawStart || !rawEnd) continue;

    const startTime = rawStart.replace(".", ",");
    const endTime = rawEnd.replace(".", ",");
    const text = lines
      .slice(timeLineIndex + 1)
      .join("\n")
      .trim();

    entries.push({ id, startTime, endTime, text });
  }

  return entries;
}

/**
 * Converts structured SrtEntry objects back into an SRT formatted string.
 */
export function stringifySrt(entries: SrtEntry[]): string {
  return `${entries
    .map((entry, index) => {
      const id = entry.id || index + 1;
      return `${id}\n${entry.startTime} --> ${entry.endTime}\n${entry.text}`;
    })
    .join("\n\n")}\n`;
}

export type BilingualOrder = "original-first" | "target-first";

export interface MergeBilingualOptions {
  order?: BilingualOrder;
  separator?: string;
}

/**
 * Merges original and translated SrtEntry arrays into a single bilingual SrtEntry array.
 * Default order: original-first (original on top, translation below).
 */
export function mergeBilingualEntries(
  originalEntries: SrtEntry[],
  translatedEntries: SrtEntry[],
  options?: MergeBilingualOptions,
): SrtEntry[] {
  const order = options?.order ?? "original-first";
  const separator = options?.separator ?? "\n";

  const transMap = new Map<number, SrtEntry>();
  for (const trans of translatedEntries) {
    transMap.set(trans.id, trans);
  }

  return originalEntries.map((orig, index) => {
    const trans = transMap.get(orig.id) ?? translatedEntries[index];
    const origText = orig.text.trim();
    const transText = trans?.text.trim() ?? "";

    let text: string;
    if (!transText) {
      text = origText;
    } else if (!origText) {
      text = transText;
    } else if (origText === transText) {
      text = origText;
    } else if (order === "target-first") {
      text = `${transText}${separator}${origText}`;
    } else {
      text = `${origText}${separator}${transText}`;
    }

    return {
      id: orig.id || index + 1,
      startTime: orig.startTime,
      endTime: orig.endTime,
      text,
    };
  });
}

export interface ReflowOptions {
  maxLength?: number | undefined;
  maxDuration?: number | undefined; // in seconds
  noReflow?: boolean | undefined;
}

/**
 * Splits a clause into words or character chunks when words exceed maxLength.
 */
function splitClauseIntoWords(clause: string, maxLength: number, isCjk: boolean): string[] {
  const trimmed = clause.trim();
  if (trimmed.length <= maxLength) return [trimmed];

  if (isCjk) {
    const chunks: string[] = [];
    let remaining = trimmed;
    while (remaining.length > maxLength) {
      chunks.push(remaining.slice(0, maxLength));
      remaining = remaining.slice(maxLength);
    }
    if (remaining) {
      chunks.push(remaining);
    }
    return chunks;
  }

  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length <= 1) {
    // Unbroken token exceeding maxLength
    const chunks: string[] = [];
    let remaining = trimmed;
    while (remaining.length > maxLength) {
      chunks.push(remaining.slice(0, maxLength));
      remaining = remaining.slice(maxLength);
    }
    if (remaining) {
      chunks.push(remaining);
    }
    return chunks;
  }

  const packedWords: string[] = [];
  let current = "";

  for (const word of words) {
    if (word.length > maxLength) {
      if (current) {
        packedWords.push(current);
        current = "";
      }
      let remaining = word;
      while (remaining.length > maxLength) {
        packedWords.push(remaining.slice(0, maxLength));
        remaining = remaining.slice(maxLength);
      }
      if (remaining) {
        current = remaining;
      }
      continue;
    }

    if (!current) {
      current = word;
    } else {
      const candidate = `${current} ${word}`;
      if (candidate.length <= maxLength) {
        current = candidate;
      } else {
        packedWords.push(current);
        current = word;
      }
    }
  }

  if (current) {
    packedWords.push(current);
  }

  return packedWords;
}

/**
 * Splits a sentence into clauses (Level 2 boundaries) and packs them.
 */
function splitSentenceIntoClauses(sentence: string, maxLength: number, isCjk: boolean): string[] {
  const trimmed = sentence.trim();
  if (trimmed.length <= maxLength) return [trimmed];

  const clauseRegex = isCjk ? /(?<=[、・；：])/ : /(?<=[,;:])\s+|(?<=\s[-—]{1,2}\s)/;

  const rawClauses = trimmed
    .split(clauseRegex)
    .map((c) => c.trim())
    .filter(Boolean);
  if (rawClauses.length <= 1) {
    return splitClauseIntoWords(trimmed, maxLength, isCjk);
  }

  const packedClauses: string[] = [];
  let current = "";

  for (const clause of rawClauses) {
    if (clause.length > maxLength) {
      if (current) {
        packedClauses.push(current);
        current = "";
      }
      packedClauses.push(...splitClauseIntoWords(clause, maxLength, isCjk));
      continue;
    }

    if (!current) {
      current = clause;
    } else {
      const separator = isCjk || current.endsWith("-") || current.endsWith("—") ? "" : " ";
      const candidate = `${current}${separator}${clause}`;
      if (candidate.length <= maxLength) {
        current = candidate;
      } else {
        packedClauses.push(current);
        current = clause;
      }
    }
  }

  if (current) {
    packedClauses.push(current);
  }

  return packedClauses;
}

/**
 * Splits input text into sentences (Level 1 boundaries) and packs them.
 */
function splitTextIntoSentences(text: string, maxLength: number, isCjk: boolean): string[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const sentenceChunks: string[] = [];

  for (const line of lines) {
    if (line.length <= maxLength) {
      sentenceChunks.push(line);
      continue;
    }

    const sentenceRegex = isCjk ? /(?<=[。！？])/ : /(?<=[.!?])\s+(?=[A-Z0-9"'\p{Lu}])/u;

    const rawSentences = line
      .split(sentenceRegex)
      .map((s) => s.trim())
      .filter(Boolean);
    if (rawSentences.length <= 1) {
      sentenceChunks.push(...splitSentenceIntoClauses(line, maxLength, isCjk));
      continue;
    }

    let current = "";
    for (const sentence of rawSentences) {
      if (sentence.length > maxLength) {
        if (current) {
          sentenceChunks.push(current);
          current = "";
        }
        sentenceChunks.push(...splitSentenceIntoClauses(sentence, maxLength, isCjk));
        continue;
      }

      if (!current) {
        current = sentence;
      } else {
        const separator = isCjk ? "" : " ";
        const candidate = `${current}${separator}${sentence}`;
        if (candidate.length <= maxLength) {
          current = candidate;
        } else {
          sentenceChunks.push(current);
          current = sentence;
        }
      }
    }

    if (current) {
      sentenceChunks.push(current);
    }
  }

  return sentenceChunks;
}

/**
 * Splits text into candidate chunks based on maxLength and duration constraints.
 */
export function splitTextIntoChunks(
  text: string,
  maxLength: number,
  maxDurationMs: number,
  durationMs: number,
  isCjk: boolean,
): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const targetChunksCount = Math.max(
    1,
    Math.ceil(trimmed.length / maxLength),
    durationMs > 0 && maxDurationMs > 0 ? Math.ceil(durationMs / maxDurationMs) : 1,
  );

  if (targetChunksCount === 1 && trimmed.length <= maxLength) {
    return [trimmed];
  }

  // Calculate target length per chunk allowing small padding
  const effectiveMaxLength =
    targetChunksCount > 1
      ? Math.min(
          maxLength,
          Math.max(10, Math.ceil(trimmed.length / targetChunksCount) + Math.ceil(maxLength * 0.15)),
        )
      : maxLength;

  const chunks = splitTextIntoSentences(trimmed, effectiveMaxLength, isCjk);
  return chunks.length > 0 ? chunks : [trimmed];
}

/**
 * Distributes original entry duration proportionally to each split chunk.
 */
function allocateChunkTimestamps(
  entry: SrtEntry,
  chunks: string[],
  startMs: number,
  endMs: number,
  durationMs: number,
): SrtEntry[] {
  const weights = chunks.map((chunk) => {
    const trimmed = chunk.trim();
    let bonus = 0;
    if (/[。！？.!?]$/.test(trimmed)) {
      bonus = 3;
    } else if (/[、・；：,;:]$/.test(trimmed)) {
      bonus = 1;
    }
    return Math.max(1, trimmed.length) + bonus;
  });

  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  const splitEntries: SrtEntry[] = [];
  let currentStartMs = startMs;

  for (let i = 0; i < chunks.length; i++) {
    const isLast = i === chunks.length - 1;
    const chunkText = chunks[i] ?? "";

    let chunkEndMs: number;
    if (isLast) {
      chunkEndMs = endMs;
    } else {
      const chunkDuration = Math.round(durationMs * ((weights[i] ?? 1) / totalWeight));
      const minRemaining = (chunks.length - 1 - i) * 100;
      const maxAllowedEnd = endMs - minRemaining;
      chunkEndMs = Math.min(
        maxAllowedEnd,
        Math.max(currentStartMs + 100, currentStartMs + chunkDuration),
      );
    }

    splitEntries.push({
      id: entry.id,
      startTime: formatSrtTimeMs(currentStartMs),
      endTime: formatSrtTimeMs(chunkEndMs),
      text: chunkText,
    });

    currentStartMs = chunkEndMs;
  }

  return splitEntries;
}

/**
 * Reflows an array of SrtEntry objects, intelligently splitting long segments
 * by natural boundaries (sentences, clauses, words) and distributing timestamps proportionally.
 */
export function reflowSrtEntries(entries: SrtEntry[], options?: ReflowOptions): SrtEntry[] {
  if (options?.noReflow || entries.length === 0) {
    return [...entries];
  }

  const defaultMaxDuration = DEFAULT_MAX_DURATION_SECONDS;
  const maxDurationSec =
    options?.maxDuration !== undefined && options.maxDuration > 0
      ? options.maxDuration
      : defaultMaxDuration;
  const maxDurationMs = maxDurationSec * 1000;

  const result: SrtEntry[] = [];

  for (const entry of entries) {
    const text = entry.text.trim();
    if (!text) {
      result.push(entry);
      continue;
    }

    const isCjk = isCjkText(text);
    const defaultMaxLength = isCjk ? DEFAULT_MAX_LENGTH_CJK : DEFAULT_MAX_LENGTH_LATIN;
    const maxLength =
      options?.maxLength !== undefined && options.maxLength > 0
        ? options.maxLength
        : defaultMaxLength;

    const startMs = parseSrtTime(entry.startTime);
    const endMs = parseSrtTime(entry.endTime);
    const durationMs = Math.max(0, endMs - startMs);

    if (text.length <= maxLength && durationMs <= maxDurationMs) {
      result.push(entry);
      continue;
    }

    // If duration is too short (< 1.2s) and within maxLength, do not split
    if (durationMs < 1200 && text.length <= maxLength) {
      result.push(entry);
      continue;
    }

    const chunks = splitTextIntoChunks(text, maxLength, maxDurationMs, durationMs, isCjk);
    if (chunks.length <= 1) {
      result.push(entry);
      continue;
    }

    const splitEntries = allocateChunkTimestamps(entry, chunks, startMs, endMs, durationMs);
    result.push(...splitEntries);
  }

  return result.map((e, index) => ({
    ...e,
    id: index + 1,
  }));
}
