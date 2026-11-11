import {
  type ChapterItem,
  type SummaryResult,
  secondsToTimestamp,
  timestampToSeconds,
} from "../formatter.js";
import { type FlatGlossary, formatGlossaryPrompt } from "../glossary.js";
import type { SupportedLanguage } from "../i18n/index.js";
import type { SrtEntry } from "../srt.js";
import { generateJsonWithRetry, type JsonSchema, type TextModel } from "./model.js";

export const DEFAULT_CHUNK_SIZE = 50;
export const DEFAULT_CONTEXT_WINDOW_SIZE = 5;

interface TextItem {
  id: number;
  text: string;
}

type TextMatch =
  | { kind: "matched"; texts: string[] }
  | { kind: "format" }
  | {
      kind: "mismatch";
      missing: number[];
      unexpected: number[];
      duplicated: number[];
      invalid: number;
    };

function buildTextItemsSchema(textDescription: string, description: string): JsonSchema {
  return {
    type: "array",
    items: {
      type: "object",
      properties: {
        id: { type: "integer", description: "The id of the input item, copied unchanged" },
        text: { type: "string", description: textDescription },
      },
      required: ["id", "text"],
    },
    description,
  };
}

function matchTextItems(parsed: unknown, ids: number[]): TextMatch {
  if (!Array.isArray(parsed)) return { kind: "format" };
  const expected = new Set(ids);
  const texts = new Map<number, string>();
  const duplicated = new Set<number>();
  let invalid = 0;

  for (const item of parsed) {
    if (typeof item !== "object" || item === null) {
      invalid++;
      continue;
    }
    const id = typeof item.id === "string" && /^\d+$/.test(item.id) ? Number(item.id) : item.id;
    if (
      typeof id !== "number" ||
      !Number.isInteger(id) ||
      id < 0 ||
      typeof item.text !== "string"
    ) {
      invalid++;
      continue;
    }
    if (texts.has(id)) duplicated.add(id);
    texts.set(id, item.text);
  }

  const missing = ids.filter((id) => !texts.has(id));
  const unexpected = [...texts.keys()].filter((id) => !expected.has(id));
  if (missing.length || unexpected.length || duplicated.size || invalid) {
    return { kind: "mismatch", missing, unexpected, duplicated: [...duplicated], invalid };
  }
  return { kind: "matched", texts: ids.map((id) => texts.get(id) ?? "") };
}

function formatTextMatchError(
  logLabel: string,
  result: Exclude<TextMatch, { kind: "matched" }>,
): string {
  if (result.kind === "format") return `${logLabel} returned invalid format (expected array)`;
  const details: string[] = [];
  for (const key of ["missing", "unexpected", "duplicated"] as const) {
    const ids = result[key].toSorted((a, b) => a - b);
    if (ids.length) {
      const rest = ids.length > 5 ? `, …(+${ids.length - 5})` : "";
      details.push(`${key}: ${ids.slice(0, 5).join(", ")}${rest}`);
    }
  }
  if (result.invalid) details.push(`invalid items: ${result.invalid}`);
  return `${logLabel} returned items that do not match the input ids (${details.join("; ")})`;
}

export interface TranslateOptions {
  prompt?: string | undefined;
  glossary?: FlatGlossary | undefined;
  concurrency?: number | undefined;
  lang?: SupportedLanguage | undefined;
  contextWindowSize?: number | undefined;
  completedChunks?: Record<string, string[]> | undefined;
  onChunkComplete?: ((chunkIndex: number, texts: string[]) => void) | undefined;
}

export interface RefineOptions {
  /** Detected source language (e.g. "ja"); omitted from the prompt when unknown. */
  language?: string | undefined;
  /** User notes passed with --prompt (written for translation; used as background only). */
  notes?: string | undefined;
  glossary?: FlatGlossary | undefined;
  concurrency?: number | undefined;
  lang?: SupportedLanguage | undefined;
}

export interface RefineResult {
  entries: SrtEntry[];
  /** Chunks whose answer did not match the input ids; their original text was kept. */
  fallbackChunks: number;
  totalChunks: number;
}

export interface ChapterOptions {
  prompt?: string | undefined;
  targetLang?: string | undefined;
  lang?: SupportedLanguage | undefined;
  verbose?: boolean | undefined;
}

export interface SummaryOptions {
  prompt?: string | undefined;
  targetLang?: string | undefined;
  lang?: SupportedLanguage | undefined;
  verbose?: boolean | undefined;
}

/**
 * Executes tasks concurrently with a maximum concurrency limit,
 * preserving the exact input order in the returned results.
 */
export async function asyncPool<T, R>(
  concurrency: number,
  items: T[],
  taskFn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  const limit = Math.max(1, Math.min(concurrency, items.length));
  let currentIndex = 0;
  let failed = false;
  let firstError: unknown;

  async function worker(): Promise<void> {
    while (!failed && currentIndex < items.length) {
      const idx = currentIndex++;
      const item = items[idx];
      if (item === undefined) break;
      try {
        results[idx] = await taskFn(item, idx);
      } catch (error) {
        if (!failed) {
          failed = true;
          firstError = error;
        }
      }
    }
  }

  const workers = Array.from({ length: limit }, () => worker());
  await Promise.all(workers);
  if (failed) throw firstError;
  return results;
}

/**
 * Builds the translation prompt with optional custom instructions, glossary rules,
 * and preceding context for continuity across chunks.
 */
export function buildTranslationPrompt(
  texts: TextItem[],
  targetLang: string,
  options?: TranslateOptions,
  contextTexts?: string[],
): string {
  const customPrompt = options?.prompt?.trim();
  const glossaryRules = options?.glossary ? formatGlossaryPrompt(options.glossary) : "";
  const hasContext = Boolean(contextTexts && contextTexts.length > 0);

  let prompt = `You are a professional translator for video subtitles.
Translate the following array of subtitle texts into target language code "${targetLang}".

STRICT RULES:
1. Return ONLY a valid JSON array of objects. Each object has "id" (copied unchanged from the input item) and "text" (the translation of that item's text).
2. Return exactly one object for each of the ${texts.length} input items, using the same "id" values. Do NOT merge, split, skip, or add items.
3. Translate into natural, clear conversational style suited for video subtitles.
4. Do NOT include markdown code blocks (such as \`\`\`json), explanations, or any extra text outside the JSON array.`;

  if (hasContext) {
    prompt += `\n5. Translate ONLY the items in "Input Array". Do NOT translate, output, or include items from "Preceding Context".`;
  }

  if (customPrompt) {
    prompt += `\n\nADDITIONAL TRANSLATION INSTRUCTIONS:\n${customPrompt}`;
  }

  if (glossaryRules) {
    prompt += `\n\nGLOSSARY / TERMINOLOGY RULES (MUST USE THESE EXACT TRANSLATIONS):\n${glossaryRules}`;
  }

  if (hasContext && contextTexts) {
    prompt += `\n\nPRECEDING CONTEXT (FOR REFERENCE ONLY - DO NOT TRANSLATE):\nThe following lines immediately precede the input subtitles in the media. Use them solely to understand conversational flow, tone, and pronoun context:\n${JSON.stringify(contextTexts, null, 2)}`;
  }

  prompt += `\n\nInput Array:\n${JSON.stringify(texts, null, 2)}`;
  return prompt;
}

function splitIntoChunks<T>(items: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
}

function getPrecedingContextTexts(
  entries: SrtEntry[],
  chunkIdx: number,
  chunkSize: number,
  contextWindowSize: number,
): string[] | undefined {
  const startIdx = chunkIdx * chunkSize;
  if (contextWindowSize <= 0 || startIdx <= 0) {
    return undefined;
  }
  return entries.slice(Math.max(0, startIdx - contextWindowSize), startIdx).map((e) => e.text);
}

function logChunkVerbose(
  model: TextModel,
  action: string,
  chunkIndex: number,
  totalChunks: number,
  itemCount: number,
  contextTexts: string[] | undefined,
): void {
  const ctxInfo =
    contextTexts && contextTexts.length > 0 ? ` [context: ${contextTexts.length} lines]` : "";
  console.log(
    `[${model.logLabel}] ${action} (${chunkIndex}/${totalChunks}) [${itemCount} items] [model: ${model.model}]${ctxInfo}...`,
  );
}

async function runChunkedTextTransform(
  entries: SrtEntry[],
  model: TextModel,
  options: {
    concurrency?: number | undefined;
    contextWindowSize: number;
    verbose: boolean;
    verboseAction: string;
    onProgress?: ((completedChunks: number, totalChunks: number) => void) | undefined;
    completedChunks?: Record<string, string[]> | undefined;
    onChunkComplete?: ((chunkIndex: number, texts: string[]) => void) | undefined;
    transformChunk: (params: {
      chunkIndex: number;
      totalChunks: number;
      items: TextItem[];
      contextTexts: string[] | undefined;
    }) => Promise<string[]>;
  },
): Promise<{ entries: SrtEntry[]; totalChunks: number }> {
  const chunks = splitIntoChunks(entries, DEFAULT_CHUNK_SIZE);
  const totalChunks = chunks.length;
  const concurrency =
    options.concurrency && options.concurrency > 0
      ? Math.floor(options.concurrency)
      : model.limits.defaultConcurrency;
  const textsByChunk = chunks.map((_, index) => options.completedChunks?.[String(index)]);
  let completedChunks = textsByChunk.filter((texts) => texts !== undefined).length;
  const pendingChunks = chunks
    .map((chunk, chunkIdx) => ({ chunk, chunkIdx }))
    .filter(({ chunkIdx }) => textsByChunk[chunkIdx] === undefined);

  await asyncPool(concurrency, pendingChunks, async ({ chunk, chunkIdx }) => {
    const chunkIndex = chunkIdx + 1;
    const items = chunk.map((entry, index) => ({
      id: chunkIdx * DEFAULT_CHUNK_SIZE + index + 1,
      text: entry.text,
    }));
    const contextTexts = getPrecedingContextTexts(
      entries,
      chunkIdx,
      DEFAULT_CHUNK_SIZE,
      options.contextWindowSize,
    );

    if (options.verbose) {
      logChunkVerbose(
        model,
        options.verboseAction,
        chunkIndex,
        totalChunks,
        chunk.length,
        contextTexts,
      );
    }

    const nextTexts = await options.transformChunk({
      chunkIndex,
      totalChunks,
      items,
      contextTexts,
    });

    textsByChunk[chunkIdx] = nextTexts;
    options.onChunkComplete?.(chunkIdx, nextTexts);
    completedChunks++;
    options.onProgress?.(completedChunks, totalChunks);
  });

  const chunkResults = chunks.map((chunk, chunkIdx) =>
    chunk.map((item, j) => ({
      id: item.id,
      startTime: item.startTime,
      endTime: item.endTime,
      text: textsByChunk[chunkIdx]?.[j] ?? item.text,
    })),
  );

  return { entries: chunkResults.flat(), totalChunks };
}

/**
 * Translates SRT entries in chunks to target language using a TextModel.
 */
export async function translateSrtEntries(
  entries: SrtEntry[],
  targetLang: string,
  model: TextModel,
  verbose = false,
  onProgress?: (completedChunks: number, totalChunks: number) => void,
  options?: TranslateOptions,
): Promise<SrtEntry[]> {
  if (entries.length === 0) return [];

  const contextWindowSize =
    options?.contextWindowSize !== undefined
      ? Math.max(0, Math.floor(options.contextWindowSize))
      : DEFAULT_CONTEXT_WINDOW_SIZE;

  const { entries: translated } = await runChunkedTextTransform(entries, model, {
    concurrency: options?.concurrency,
    contextWindowSize,
    verbose,
    verboseAction: "Translating chunk",
    onProgress,
    completedChunks: options?.completedChunks,
    onChunkComplete: options?.onChunkComplete,
    transformChunk: async ({ chunkIndex, totalChunks, items, contextTexts }) => {
      const prompt = buildTranslationPrompt(items, targetLang, options, contextTexts);

      return generateJsonWithRetry<string[]>(
        model,
        {
          prompt,
          schemaName: "translation",
          schema: buildTextItemsSchema(
            "The translation of the input item's text",
            `Array of translated subtitle texts matched by id to the input items (${items.length} items).`,
          ),
        },
        (parsed) => {
          const result = matchTextItems(
            parsed,
            items.map((item) => item.id),
          );
          if (result.kind === "matched") return result.texts;
          throw new Error(formatTextMatchError(model.logLabel, result));
        },
        {
          task: "translation",
          where: `chunk ${chunkIndex}/${totalChunks}`,
          verbose,
          lang: options?.lang,
        },
      );
    },
  });

  return translated;
}

/**
 * Builds the transcript refinement prompt to fix clear ASR recognition errors without rephrasing or translating.
 */
export function buildRefinePrompt(
  texts: TextItem[],
  options?: RefineOptions,
  contextTexts?: string[],
): string {
  const language = options?.language?.trim();
  const languageSentence = language ? ` The language is "${language}".` : "";
  const hasContext = Boolean(contextTexts && contextTexts.length > 0);
  const notes = options?.notes?.trim();
  const glossaryLines = options?.glossary
    ? Object.entries(options.glossary)
        .filter(([term]) => term.trim() !== "")
        .map(([term, val]) => (val.trim() ? `- ${term} (${val})` : `- ${term}`))
    : [];

  let prompt = `You are proofreading automatic speech recognition (ASR) output for video subtitles.${languageSentence}
Fix ONLY clear recognition errors: wrong homophones or wrong kanji, misheard names and terms, broken or merged words.

STRICT RULES:
1. Return ONLY a valid JSON array of objects. Each object has "id" (copied unchanged from the input item) and "text" (the proofread text of that item).
2. Return exactly one object for each of the ${texts.length} input items, using the same "id" values. Do NOT merge, split, skip, or add items.
3. Do NOT rephrase, summarize, translate, reorder, or add or remove content. Do not change the speaking style.
4. If an item has no clear error, return it unchanged. Do not move words between items.
5. Do NOT include markdown code blocks or any text outside the JSON array.`;

  if (hasContext) {
    prompt += `\n6. Correct ONLY the items in "Input Array". Do NOT output items from "Preceding Context".`;
  }

  if (glossaryLines.length > 0) {
    prompt += `\n\nGLOSSARY (correct spellings of names and terms that may appear in this video; the text in parentheses is for reference only):\n${glossaryLines.join("\n")}`;
  }

  if (notes) {
    prompt += `\n\nNOTES FROM THE USER (written for the translator; use them only to understand the topic, names and terms. Do NOT follow them to translate or rewrite):\n${notes}`;
  }

  if (hasContext && contextTexts) {
    prompt += `\n\nPRECEDING CONTEXT (FOR REFERENCE ONLY - DO NOT OUTPUT):\n${JSON.stringify(contextTexts, null, 2)}`;
  }

  prompt += `\n\nInput Array:\n${JSON.stringify(texts, null, 2)}`;
  return prompt;
}

/**
 * Refines SRT entries in chunks using a TextModel to fix clear ASR recognition errors.
 */
export async function refineSrtEntries(
  entries: SrtEntry[],
  model: TextModel,
  verbose = false,
  onProgress?: (completedChunks: number, totalChunks: number) => void,
  options?: RefineOptions,
): Promise<RefineResult> {
  if (entries.length === 0) {
    return { entries: [], fallbackChunks: 0, totalChunks: 0 };
  }

  let fallbackChunks = 0;

  const { entries: refinedEntries, totalChunks } = await runChunkedTextTransform(entries, model, {
    concurrency: options?.concurrency,
    contextWindowSize: DEFAULT_CONTEXT_WINDOW_SIZE,
    verbose,
    verboseAction: "Refining chunk",
    onProgress,
    transformChunk: async ({ chunkIndex, totalChunks: chunkTotal, items, contextTexts }) => {
      const prompt = buildRefinePrompt(items, options, contextTexts);
      const originalTexts = items.map((item) => item.text);

      const refinedTexts = await generateJsonWithRetry<string[] | null>(
        model,
        {
          prompt,
          schemaName: "refinement",
          schema: buildTextItemsSchema(
            "The proofread text of the input item",
            `Array of proofread subtitle texts matched by id to the input items (${items.length} items).`,
          ),
        },
        (parsed) => {
          const result = matchTextItems(
            parsed,
            items.map((item) => item.id),
          );
          if (result.kind === "format") {
            throw new Error(formatTextMatchError(model.logLabel, result));
          }
          if (result.kind === "mismatch") return null;
          return result.texts.map((next, idx) => {
            const orig = originalTexts[idx] ?? "";
            return orig.trim() !== "" && next.trim() === "" ? orig : next;
          });
        },
        {
          task: "transcript refinement",
          where: `chunk ${chunkIndex}/${chunkTotal}`,
          verbose,
          lang: options?.lang,
        },
      );

      if (refinedTexts === null) {
        fallbackChunks++;
        return originalTexts;
      }

      return refinedTexts;
    },
  });

  return { entries: refinedEntries, fallbackChunks, totalChunks };
}

/**
 * Generates video chapters from transcript entries using a TextModel.
 */
export async function generateChapters(
  entries: SrtEntry[],
  model: TextModel,
  options?: ChapterOptions,
): Promise<ChapterItem[]> {
  if (entries.length === 0) return [];

  const targetLang = options?.targetLang?.trim() || "ja";
  const verbose = Boolean(options?.verbose);

  const transcript = entries.map((e) => `[${e.startTime.split(",")[0]}] ${e.text}`).join("\n");

  let prompt = `You are an expert video content editor and chapter generator.
Analyze the following timestamped transcript and identify topic boundaries to create video chapters (table of contents).

Target language for chapter titles: "${targetLang}"

STRICT RULES:
1. Return ONLY a valid JSON array of objects with "timestamp", "seconds", and "title".
2. The first chapter MUST start at "00:00" (seconds: 0) and describe the introduction or opening topic.
3. All timestamps MUST be in chronological order (ascending).
4. Timestamp format should be MM:SS (or HH:MM:SS if over 1 hour).
5. Titles should be concise (2-6 words), descriptive, and written in "${targetLang}".
6. Generate meaningful chapters corresponding to major topic shifts (typically 3 to 15 chapters depending on content length).
7. Do NOT include markdown code blocks, explanations, or any extra text outside the JSON array.`;

  if (options?.prompt?.trim()) {
    prompt += `\n\nADDITIONAL CHAPTER INSTRUCTIONS:\n${options.prompt.trim()}`;
  }

  prompt += `\n\nTimestamped Transcript:\n${transcript}`;

  return generateJsonWithRetry<ChapterItem[]>(
    model,
    {
      prompt,
      schemaName: "chapters",
      schema: {
        type: "array",
        items: {
          type: "object",
          properties: {
            timestamp: {
              type: "string",
              description: "Timestamp in MM:SS or HH:MM:SS format",
            },
            seconds: {
              type: "integer",
              description: "Total seconds from start",
            },
            title: {
              type: "string",
              description: "Concise chapter title in target language",
            },
          },
          required: ["timestamp", "title"],
        },
        description: "Chronological list of video chapters",
      },
    },
    (val) => {
      if (!Array.isArray(val) || val.length === 0) {
        throw new Error(`${model.logLabel} returned empty or invalid chapters format`);
      }

      const chapters: ChapterItem[] = (
        val as { timestamp?: string; seconds?: number; title?: string }[]
      ).map((item) => {
        const rawTs = String(item.timestamp || "00:00");
        const seconds =
          typeof item.seconds === "number" && !Number.isNaN(item.seconds)
            ? Math.max(0, Math.floor(item.seconds))
            : timestampToSeconds(rawTs);
        const timestamp = secondsToTimestamp(seconds);
        const title = String(item.title || "").trim();
        return { timestamp, seconds, title };
      });

      return chapters;
    },
    {
      task: "chapters generation",
      verbose,
      lang: options?.lang,
    },
  );
}

/**
 * Generates structured content summary from transcript entries using a TextModel.
 */
export async function generateSummary(
  entries: SrtEntry[],
  model: TextModel,
  options?: SummaryOptions,
): Promise<SummaryResult> {
  if (entries.length === 0) {
    return {
      title: "No Content",
      summary: "No transcript entries provided to summarize.",
      keyPoints: [],
      topics: [],
    };
  }

  const targetLang = options?.targetLang?.trim() || "ja";
  const verbose = Boolean(options?.verbose);

  const transcript = entries.map((e) => `[${e.startTime.split(",")[0]}] ${e.text}`).join("\n");

  let prompt = `You are an expert content summarizer and meeting recorder.
Analyze the following timestamped transcript and produce a comprehensive, structured summary.

Target language for summary: "${targetLang}"

STRICT RULES:
1. Return ONLY a valid JSON object matching the requested schema.
2. "title": A concise, engaging title for the content in "${targetLang}".
3. "summary": A clear executive summary (2 to 4 sentences) in "${targetLang}".
4. "keyPoints": An array of key takeaways or important bullet points (3 to 7 items) in "${targetLang}".
5. "topics": An array of important discussion topics/highlights in chronological order with "timestamp", "title", and "description" in "${targetLang}".
6. Do NOT include markdown code blocks, explanations, or any extra text outside the JSON object.`;

  if (options?.prompt?.trim()) {
    prompt += `\n\nADDITIONAL SUMMARY INSTRUCTIONS:\n${options.prompt.trim()}`;
  }

  prompt += `\n\nTimestamped Transcript:\n${transcript}`;

  return generateJsonWithRetry<SummaryResult>(
    model,
    {
      prompt,
      schemaName: "summary",
      schema: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "Content title in target language",
          },
          summary: {
            type: "string",
            description: "Executive summary paragraph in target language",
          },
          keyPoints: {
            type: "array",
            items: { type: "string" },
            description: "List of key takeaways in target language",
          },
          topics: {
            type: "array",
            items: {
              type: "object",
              properties: {
                timestamp: {
                  type: "string",
                  description: "Timestamp in MM:SS or HH:MM:SS",
                },
                title: {
                  type: "string",
                  description: "Topic title in target language",
                },
                description: {
                  type: "string",
                  description: "Brief description of topic",
                },
              },
              required: ["timestamp", "title", "description"],
            },
            description: "Key topics with timestamps",
          },
        },
        required: ["title", "summary", "keyPoints", "topics"],
      },
    },
    (parsedVal) => {
      const parsed = parsedVal as {
        title?: string;
        summary?: string;
        keyPoints?: unknown[];
        topics?: { timestamp?: string; title?: string; description?: string }[];
      };
      const result: SummaryResult = {
        title: String(parsed.title || "Untitled").trim(),
        summary: String(parsed.summary || "").trim(),
        keyPoints: Array.isArray(parsed.keyPoints)
          ? parsed.keyPoints.map((k: unknown) => String(k).trim()).filter(Boolean)
          : [],
        topics: Array.isArray(parsed.topics)
          ? parsed.topics.map((t) => ({
              timestamp: secondsToTimestamp(timestampToSeconds(String(t.timestamp || "00:00"))),
              title: String(t.title || "").trim(),
              description: String(t.description || "").trim(),
            }))
          : [],
      };
      return result;
    },
    {
      task: "summary generation",
      verbose,
      lang: options?.lang,
    },
  );
}
