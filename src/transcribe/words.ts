import {
  DEFAULT_MAX_DURATION_SECONDS,
  DEFAULT_MAX_LENGTH_CJK,
  DEFAULT_MAX_LENGTH_LATIN,
  formatSrtTimeMs,
  isCjkText,
  type SrtEntry,
} from "../srt.js";
import type { TimedText } from "./transcriber.js";

/** Raw word timings of one transcribed audio chunk, as returned by the provider. */
export interface WordChunk {
  /** Seconds from the start of the media to the start of this chunk. */
  offsetSeconds: number;
  /** Word timings relative to the start of the chunk. */
  words: TimedText[];
}

export interface WordSegmentationOptions {
  /** Same meaning as ReflowOptions.maxLength (default: CJK 32 / Latin 75). */
  maxLength?: number | undefined;
  /** Same meaning as ReflowOptions.maxDuration in seconds (default: 7). */
  maxDuration?: number | undefined;
  /** Skip the length/duration limits (step 3). Used for --no-reflow. */
  noLimits?: boolean | undefined;
}

/** Gap between two words (ms) at or above which a new subtitle starts. */
const CUT_GAP_MS = 1000;
/** Longest duration (ms) a single word may have; longer words are clamped. */
const MAX_WORD_MS = 1500;
/** Longest extension (ms) of a subtitle's end into the free time before the next one. */
const MAX_EXTENSION_MS = 1000;
/** Free time (ms) from which a subtitle's end is not extended any more. */
const NO_EXTENSION_ROOM_MS = 2000;
/** Minimum display duration (ms) for a subtitle. */
const MIN_DISPLAY_MS = 500;
/** Range of the left side's character share in which a split position is preferred. */
const SPLIT_FRACTION_MIN = 0.25;
const SPLIT_FRACTION_MAX = 0.75;
/** Gap rounding unit (ms) when comparing split positions. */
const SPLIT_GAP_UNIT_MS = 10;

const PUNCTUATION_ONLY_REGEX = /^[\p{P}\p{S}\s]+$/u;
const OPENING_BRACKET_ONLY_REGEX = /^[「『（(［[｛{〈《【“‘"']+$/u;
const SENTENCE_END_REGEX = /[。．！？.!?…][」』）)"'”’]*$/u;
const CLAUSE_END_REGEX = /[、，,；;：:・][」』）)"'”’]*$/u;
const CJK_FULLWIDTH_REGEX =
  /[\u3000-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef\uac00-\ud7af]/;

/** A cleaned-up word with integer millisecond times (relative to its chunk). */
interface Word {
  speaker: string | undefined;
  text: string;
  startMs: number;
  endMs: number;
}

/** A run of words that becomes one subtitle. */
type Group = Word[];

function toMs(seconds: number): number {
  return Math.round(seconds * 1000);
}

/** Step 1: trims, clamps and attaches punctuation-only words to their neighbours. */
function prepareWords(rawWords: TimedText[]): Word[] {
  const words: Word[] = [];
  let pendingPrefix = "";

  for (const raw of rawWords) {
    const text = raw.text.trim();
    if (!text) continue;

    if (PUNCTUATION_ONLY_REGEX.test(text)) {
      const last = words[words.length - 1];
      if (last && pendingPrefix === "" && !OPENING_BRACKET_ONLY_REGEX.test(text)) {
        last.text += text;
      } else {
        pendingPrefix += text;
      }
      continue;
    }

    const startMs = toMs(raw.start);
    const endMs = Math.min(Math.max(toMs(raw.end), startMs), startMs + MAX_WORD_MS);
    words.push({ text: pendingPrefix + text, startMs, endMs, speaker: raw.speaker });
    pendingPrefix = "";
  }

  return words;
}

/** Step 4: whether a space goes between two adjacent pieces of text. */
function needsSpace(left: string, right: string): boolean {
  const leftLast = left.slice(-1);
  const rightFirst = right.slice(0, 1);
  return !(CJK_FULLWIDTH_REGEX.test(leftLast) || CJK_FULLWIDTH_REGEX.test(rightFirst));
}

function joinTexts(texts: string[]): string {
  let result = "";
  for (const text of texts) {
    result += (result && needsSpace(result, text) ? " " : "") + text;
  }
  return result;
}

function gapBetween(previous: Word, next: Word): number {
  return next.startMs - previous.endMs;
}

/** Step 2: cuts the words at long gaps and sentence ends. */
function cutIntoGroups(words: Word[]): Group[] {
  const groups: Group[] = [];
  let current: Group = [];
  for (const word of words) {
    const previous = current[current.length - 1];
    if (
      previous &&
      (gapBetween(previous, word) >= CUT_GAP_MS ||
        SENTENCE_END_REGEX.test(previous.text) ||
        (previous.speaker && word.speaker && previous.speaker !== word.speaker))
    ) {
      groups.push(current);
      current = [];
    }
    current.push(word);
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

interface Limits {
  maxLength: number | undefined;
  maxDurationMs: number;
}

function exceedsLimits(group: Group, limits: Limits): boolean {
  const text = joinTexts(group.map((w) => w.text));
  const maxLength =
    limits.maxLength ?? (isCjkText(text) ? DEFAULT_MAX_LENGTH_CJK : DEFAULT_MAX_LENGTH_LATIN);
  const first = group[0];
  const last = group[group.length - 1];
  if (!first || !last) return false;
  return text.length > maxLength || last.endMs - first.startMs > limits.maxDurationMs;
}

/** Scores the split before `group[j]`; larger tuples are better (compared in order). */
function splitScore(group: Group, j: number, leftLength: number, totalLength: number): number[] {
  const previous = group[j - 1] as Word;
  const next = group[j] as Word;
  const fraction = leftLength / totalLength;
  const inMiddle = fraction >= SPLIT_FRACTION_MIN && fraction <= SPLIT_FRACTION_MAX ? 1 : 0;
  let punctuation = 0;
  if (SENTENCE_END_REGEX.test(previous.text)) punctuation = 2;
  else if (CLAUSE_END_REGEX.test(previous.text)) punctuation = 1;
  return [
    inMiddle,
    punctuation,
    Math.round(gapBetween(previous, next) / SPLIT_GAP_UNIT_MS),
    -Math.abs(fraction - 0.5),
  ];
}

function isBetter(candidate: number[], best: number[]): boolean {
  for (let i = 0; i < candidate.length; i++) {
    const a = candidate[i] as number;
    const b = best[i] as number;
    if (a !== b) return a > b;
  }
  return false;
}

/** Step 3: splits a group in two until each part satisfies the limits. */
function splitToLimits(group: Group, limits: Limits): Group[] {
  if (group.length <= 1 || !exceedsLimits(group, limits)) return [group];

  const totalLength = joinTexts(group.map((w) => w.text)).length;
  let best: { j: number; score: number[] } | undefined;
  let leftText = (group[0] as Word).text;
  for (let j = 1; j < group.length; j++) {
    const score = splitScore(group, j, leftText.length, totalLength);
    if (!best || isBetter(score, best.score)) best = { j, score };
    const nextText = (group[j] as Word).text;
    leftText += (needsSpace(leftText, nextText) ? " " : "") + nextText;
  }

  const splitAt = (best as { j: number }).j;
  return [
    ...splitToLimits(group.slice(0, splitAt), limits),
    ...splitToLimits(group.slice(splitAt), limits),
  ];
}

interface TimedGroup {
  speaker?: string | undefined;
  startMs: number;
  endMs: number;
  text: string;
}

/** Step 7: extends each end into the free time before the next subtitle. */
function extendEnds(groups: TimedGroup[]): TimedGroup[] {
  return groups.map((group, i) => {
    const next = groups[i + 1];
    if (!next) return group;
    const room = next.startMs - group.endMs;
    if (room <= 0 || room >= NO_EXTENSION_ROOM_MS) return group;
    return { ...group, endMs: group.endMs + Math.min(MAX_EXTENSION_MS, room) };
  });
}

/** Step 8: ensures each subtitle is displayed for at least MIN_DISPLAY_MS. */
function ensureMinDisplay(groups: TimedGroup[]): TimedGroup[] {
  return groups.map((group, i) => {
    if (group.endMs - group.startMs >= MIN_DISPLAY_MS) return group;
    const next = groups[i + 1];
    const targetEnd = group.startMs + MIN_DISPLAY_MS;
    const endMs = next ? Math.max(group.endMs, Math.min(targetEnd, next.startMs)) : targetEnd;
    return { ...group, endMs };
  });
}

/** Builds subtitle entries from word timings (steps 1-8 of the rule). */
export function buildEntriesFromWords(
  chunks: WordChunk[],
  options?: WordSegmentationOptions,
): SrtEntry[] {
  const limits: Limits = {
    maxLength:
      options?.maxLength !== undefined && options.maxLength > 0 ? options.maxLength : undefined,
    maxDurationMs: toMs(
      options?.maxDuration !== undefined && options.maxDuration > 0
        ? options.maxDuration
        : DEFAULT_MAX_DURATION_SECONDS,
    ),
  };

  const timedGroups: TimedGroup[] = [];
  for (const [chunkIndex, chunk] of chunks.entries()) {
    const offsetMs = toMs(chunk.offsetSeconds);
    for (const cut of cutIntoGroups(prepareWords(chunk.words))) {
      const groups = options?.noLimits ? [cut] : splitToLimits(cut, limits);
      for (const group of groups) {
        const first = group[0] as Word;
        const last = group[group.length - 1] as Word;
        const speaker = group.find((word) => word.speaker)?.speaker;
        timedGroups.push({
          ...(speaker
            ? { speaker: chunks.length > 1 ? `${chunkIndex + 1}/${speaker}` : speaker }
            : {}),
          startMs: first.startMs + offsetMs,
          endMs: last.endMs + offsetMs,
          text: joinTexts(group.map((w) => w.text)),
        });
      }
    }
  }

  const sorted = [...timedGroups].sort((a, b) => a.startMs - b.startMs);
  return ensureMinDisplay(extendEnds(sorted)).map((group, i) => ({
    id: i + 1,
    startTime: formatSrtTimeMs(group.startMs),
    endTime: formatSrtTimeMs(group.endMs),
    text: group.text,
    ...(group.speaker ? { speaker: group.speaker } : {}),
  }));
}
