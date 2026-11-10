import {
  type ChapterItem,
  type SummaryResult,
  secondsToTimestamp,
  timestampToSeconds,
} from "../formatter.js";
import { type FlatGlossary, formatGlossaryPrompt } from "../glossary.js";
import type { SupportedLanguage } from "../i18n/index.js";
import type { SrtEntry } from "../srt.js";
import { generateJsonWithRetry, type TextModel } from "./model.js";

const DEFAULT_CHUNK_SIZE = 50;
export const DEFAULT_CONTEXT_WINDOW_SIZE = 5;

export interface TranslateOptions {
  prompt?: string | undefined;
  glossary?: FlatGlossary | undefined;
  concurrency?: number | undefined;
  lang?: SupportedLanguage | undefined;
  contextWindowSize?: number | undefined;
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

  async function worker(): Promise<void> {
    while (currentIndex < items.length) {
      const idx = currentIndex++;
      const item = items[idx];
      if (item === undefined) break;
      results[idx] = await taskFn(item, idx);
    }
  }

  const workers = Array.from({ length: limit }, () => worker());
  await Promise.all(workers);
  return results;
}

/**
 * Builds the translation prompt with optional custom instructions, glossary rules,
 * and preceding context for continuity across chunks.
 */
export function buildTranslationPrompt(
  texts: string[],
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
1. Return ONLY a valid JSON array of strings corresponding 1-to-1 with the input array.
2. The output array MUST contain exactly ${texts.length} items in the same order as input.
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

  const totalChunks = Math.ceil(entries.length / DEFAULT_CHUNK_SIZE);
  const chunks: SrtEntry[][] = [];
  for (let i = 0; i < entries.length; i += DEFAULT_CHUNK_SIZE) {
    chunks.push(entries.slice(i, i + DEFAULT_CHUNK_SIZE));
  }

  const concurrency =
    options?.concurrency && options.concurrency > 0
      ? Math.floor(options.concurrency)
      : model.limits.defaultConcurrency;

  const contextWindowSize =
    options?.contextWindowSize !== undefined
      ? Math.max(0, Math.floor(options.contextWindowSize))
      : DEFAULT_CONTEXT_WINDOW_SIZE;

  let completedChunks = 0;

  const chunkResults = await asyncPool(concurrency, chunks, async (chunk, chunkIdx) => {
    const chunkIndex = chunkIdx + 1;
    const originalTexts = chunk.map((e) => e.text);
    const startIdx = chunkIdx * DEFAULT_CHUNK_SIZE;
    const contextTexts =
      contextWindowSize > 0 && startIdx > 0
        ? entries.slice(Math.max(0, startIdx - contextWindowSize), startIdx).map((e) => e.text)
        : undefined;

    if (verbose) {
      const ctxInfo =
        contextTexts && contextTexts.length > 0 ? ` [context: ${contextTexts.length} lines]` : "";
      console.log(
        `[${model.logLabel}] Translating chunk (${chunkIndex}/${totalChunks}) [${chunk.length} items] [model: ${model.model}]${ctxInfo}...`,
      );
    }

    const prompt = buildTranslationPrompt(originalTexts, targetLang, options, contextTexts);

    const translatedTexts = await generateJsonWithRetry<string[]>(
      model,
      {
        prompt,
        schemaName: "translation",
        schema: {
          type: "array",
          items: {
            type: "string",
          },
          description: `Array of translated subtitle texts matching 1-to-1 with the input array (${originalTexts.length} items).`,
        },
      },
      (parsed) => {
        if (Array.isArray(parsed) && parsed.length === originalTexts.length) {
          return parsed.map((item) => String(item));
        }
        const translatedLength = (parsed as { length?: number } | null)?.length ?? 0;
        throw new Error(
          `${model.logLabel} returned invalid format or incomplete count (${translatedLength}/${originalTexts.length})`,
        );
      },
      {
        task: "translation",
        where: `chunk ${chunkIndex}/${totalChunks}`,
        verbose,
        lang: options?.lang,
      },
    );

    completedChunks++;
    if (onProgress) {
      onProgress(completedChunks, totalChunks);
    }

    return chunk.map((item, j) => ({
      id: item.id,
      startTime: item.startTime,
      endTime: item.endTime,
      text: translatedTexts[j] ?? item.text,
    }));
  });

  return chunkResults.flat();
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

      const firstChapter = chapters[0];
      if (firstChapter && firstChapter.seconds > 0) {
        if (firstChapter.seconds <= 30) {
          firstChapter.seconds = 0;
          firstChapter.timestamp = "00:00";
        } else {
          chapters.unshift({
            timestamp: "00:00",
            seconds: 0,
            title: targetLang.toLowerCase().startsWith("ja")
              ? "イントロダクション"
              : "Introduction",
          });
        }
      }

      chapters.sort((a, b) => a.seconds - b.seconds);
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
