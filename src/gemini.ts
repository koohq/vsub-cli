import { GoogleGenAI, Type } from "@google/genai";
import { DEFAULT_GEMINI_MODEL } from "./config.js";
import {
  type ChapterItem,
  type SummaryResult,
  secondsToTimestamp,
  timestampToSeconds,
} from "./formatter.js";
import { type FlatGlossary, formatGlossaryPrompt } from "./glossary.js";
import { getI18n, type SupportedLanguage } from "./i18n/index.js";
import type { SrtEntry } from "./srt.js";

const DEFAULT_CHUNK_SIZE = 50;
const DEFAULT_CONCURRENCY = 3;
const MAX_RETRIES = 4;
export const DEFAULT_CONTEXT_WINDOW_SIZE = 5;

export interface TranslateOptions {
  prompt?: string | undefined;
  glossary?: FlatGlossary | undefined;
  concurrency?: number | undefined;
  model?: string | undefined;
  lang?: SupportedLanguage | undefined;
  contextWindowSize?: number | undefined;
}

export interface ChapterOptions {
  prompt?: string | undefined;
  model?: string | undefined;
  targetLang?: string | undefined;
  lang?: SupportedLanguage | undefined;
  verbose?: boolean | undefined;
}

export interface SummaryOptions {
  prompt?: string | undefined;
  model?: string | undefined;
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
 * Determines whether an error indicates that the requested Gemini model is not found,
 * unsupported, or has been retired/discontinued.
 */
export function isModelNotFoundError(err: unknown): boolean {
  if (!err) return false;
  const status =
    (err as { status?: number; statusCode?: number })?.status ??
    (err as { statusCode?: number })?.statusCode;
  if (status === 404) return true;

  const message = err instanceof Error ? err.message : String(err);
  return (
    /\b404\b/i.test(message) ||
    /NOT_FOUND/i.test(message) ||
    /model.*(?:not found|does not exist|is not supported)/i.test(message) ||
    /is not found for API version/i.test(message)
  );
}

/**
 * Formats a clear, actionable error message when a Gemini model is not found or retired.
 */
export function formatModelNotFoundError(
  modelName: string,
  lang?: SupportedLanguage | string,
): string {
  const i18n = getI18n(lang);
  const isDefault = modelName === DEFAULT_GEMINI_MODEL;
  if (isDefault) {
    return i18n.gemini.modelRetiredDefault(modelName);
  }
  return i18n.gemini.modelNotFoundCustom(modelName);
}

/**
 * Translates an array of text strings using Google Gemini API.
 */
async function translateChunkWithRetry(
  ai: GoogleGenAI,
  texts: string[],
  targetLang: string,
  modelName: string,
  verbose = false,
  options?: TranslateOptions,
  chunkIndex = 1,
  totalChunks = 1,
  contextTexts?: string[],
): Promise<string[]> {
  const prompt = buildTranslationPrompt(texts, targetLang, options, contextTexts);

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (verbose && attempt > 1) {
        console.log(
          `[Gemini API] Retry attempt ${attempt}/${MAX_RETRIES} for chunk ${chunkIndex}/${totalChunks}...`,
        );
      }

      const response = await ai.models.generateContent({
        model: modelName,
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.STRING,
            },
            description: `Array of translated subtitle texts matching 1-to-1 with the input array (${texts.length} items).`,
          },
        },
      });

      const rawText = response.text?.trim() || "";
      // Clean up markdown wrapping if present despite rules
      const cleanedJson = rawText
        .replace(/^```json\s*/i, "")
        .replace(/```$/, "")
        .trim();

      const translatedArray = JSON.parse(cleanedJson);

      if (Array.isArray(translatedArray) && translatedArray.length === texts.length) {
        return translatedArray.map((item) => String(item));
      }

      throw new Error(
        `Gemini API returned invalid format or incomplete count (${translatedArray?.length ?? 0}/${texts.length})`,
      );
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (isModelNotFoundError(lastError)) {
        throw new Error(formatModelNotFoundError(modelName, options?.lang));
      }
      if (attempt === MAX_RETRIES) break;

      const isRateLimit =
        (err as { status?: number })?.status === 429 ||
        /429|RESOURCE_EXHAUSTED|rate limit|quota/i.test(lastError.message);

      // Exponential backoff: base 1.5s (or 3s on rate limit) + random jitter (0-1000ms)
      const baseDelay = isRateLimit ? 3000 : 1500;
      const jitter = Math.floor(Math.random() * 1000);
      const delayMs = Math.min(20000, baseDelay * 2 ** (attempt - 1) + jitter);

      if (verbose) {
        console.log(
          `[Gemini API] Error on chunk ${chunkIndex}/${totalChunks} (attempt ${attempt}/${MAX_RETRIES}, retrying in ${delayMs}ms): ${lastError.message}`,
        );
      }

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw new Error(
    `Gemini API translation failed after ${MAX_RETRIES} attempts on chunk ${chunkIndex}/${totalChunks}: ${lastError?.message}`,
  );
}

/**
 * Translates SRT entries in chunks to target language using Google Gemini API.
 */
export async function translateSrtEntries(
  entries: SrtEntry[],
  targetLang: string,
  apiKey: string,
  verbose = false,
  onProgress?: (completedChunks: number, totalChunks: number) => void,
  options?: TranslateOptions,
): Promise<SrtEntry[]> {
  if (entries.length === 0) return [];

  const ai = new GoogleGenAI({ apiKey });
  const modelName =
    options?.model ||
    process.env["VSUB_GEMINI_MODEL"] ||
    process.env["GEMINI_MODEL"] ||
    DEFAULT_GEMINI_MODEL;

  const totalChunks = Math.ceil(entries.length / DEFAULT_CHUNK_SIZE);
  const chunks: SrtEntry[][] = [];
  for (let i = 0; i < entries.length; i += DEFAULT_CHUNK_SIZE) {
    chunks.push(entries.slice(i, i + DEFAULT_CHUNK_SIZE));
  }

  const concurrency =
    options?.concurrency && options.concurrency > 0
      ? Math.floor(options.concurrency)
      : DEFAULT_CONCURRENCY;

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
        `[Gemini API] Translating chunk (${chunkIndex}/${totalChunks}) [${chunk.length} items] [model: ${modelName}]${ctxInfo}...`,
      );
    }

    const translatedTexts = await translateChunkWithRetry(
      ai,
      originalTexts,
      targetLang,
      modelName,
      verbose,
      options,
      chunkIndex,
      totalChunks,
      contextTexts,
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
 * Generates video chapters from transcript entries using Google Gemini API.
 */
export async function generateChapters(
  entries: SrtEntry[],
  apiKey: string,
  options?: ChapterOptions,
): Promise<ChapterItem[]> {
  if (entries.length === 0) return [];

  const ai = new GoogleGenAI({ apiKey });
  const modelName =
    options?.model ||
    process.env["VSUB_GEMINI_MODEL"] ||
    process.env["GEMINI_MODEL"] ||
    DEFAULT_GEMINI_MODEL;

  const targetLang = options?.targetLang?.trim() || "ja";
  const verbose = Boolean(options?.verbose);

  // Format transcript with compact timestamps
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

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (verbose && attempt > 1) {
        console.log(
          `[Gemini API] Retry attempt ${attempt}/${MAX_RETRIES} for chapters generation...`,
        );
      }

      const response = await ai.models.generateContent({
        model: modelName,
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                timestamp: {
                  type: Type.STRING,
                  description: "Timestamp in MM:SS or HH:MM:SS format",
                },
                seconds: {
                  type: Type.INTEGER,
                  description: "Total seconds from start",
                },
                title: {
                  type: Type.STRING,
                  description: "Concise chapter title in target language",
                },
              },
              required: ["timestamp", "title"],
            },
            description: "Chronological list of video chapters",
          },
        },
      });

      const rawText = response.text?.trim() || "";
      const cleanedJson = rawText
        .replace(/^```json\s*/i, "")
        .replace(/```$/, "")
        .trim();

      const parsed = JSON.parse(cleanedJson);
      if (!Array.isArray(parsed) || parsed.length === 0) {
        throw new Error("Gemini API returned empty or invalid chapters format");
      }

      const chapters: ChapterItem[] = parsed.map(
        (item: { timestamp?: string; seconds?: number; title?: string }) => {
          const rawTs = String(item.timestamp || "00:00");
          const seconds =
            typeof item.seconds === "number" && !Number.isNaN(item.seconds)
              ? Math.max(0, Math.floor(item.seconds))
              : timestampToSeconds(rawTs);
          const timestamp = secondsToTimestamp(seconds);
          const title = String(item.title || "").trim();
          return { timestamp, seconds, title };
        },
      );

      // Ensure first chapter starts at 00:00
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
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (isModelNotFoundError(lastError)) {
        throw new Error(formatModelNotFoundError(modelName, options?.lang));
      }
      if (attempt === MAX_RETRIES) break;

      const isRateLimit =
        (err as { status?: number })?.status === 429 ||
        /429|RESOURCE_EXHAUSTED|rate limit|quota/i.test(lastError.message);

      const baseDelay = isRateLimit ? 3000 : 1500;
      const jitter = Math.floor(Math.random() * 1000);
      const delayMs = Math.min(20000, baseDelay * 2 ** (attempt - 1) + jitter);

      if (verbose) {
        console.log(
          `[Gemini API] Error during chapters generation (attempt ${attempt}/${MAX_RETRIES}, retrying in ${delayMs}ms): ${lastError.message}`,
        );
      }

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw new Error(
    `Gemini API chapters generation failed after ${MAX_RETRIES} attempts: ${lastError?.message}`,
  );
}

/**
 * Generates structured content summary from transcript entries using Google Gemini API.
 */
export async function generateSummary(
  entries: SrtEntry[],
  apiKey: string,
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

  const ai = new GoogleGenAI({ apiKey });
  const modelName =
    options?.model ||
    process.env["VSUB_GEMINI_MODEL"] ||
    process.env["GEMINI_MODEL"] ||
    DEFAULT_GEMINI_MODEL;

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

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (verbose && attempt > 1) {
        console.log(
          `[Gemini API] Retry attempt ${attempt}/${MAX_RETRIES} for summary generation...`,
        );
      }

      const response = await ai.models.generateContent({
        model: modelName,
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              title: {
                type: Type.STRING,
                description: "Content title in target language",
              },
              summary: {
                type: Type.STRING,
                description: "Executive summary paragraph in target language",
              },
              keyPoints: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "List of key takeaways in target language",
              },
              topics: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    timestamp: {
                      type: Type.STRING,
                      description: "Timestamp in MM:SS or HH:MM:SS",
                    },
                    title: {
                      type: Type.STRING,
                      description: "Topic title in target language",
                    },
                    description: {
                      type: Type.STRING,
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
      });

      const rawText = response.text?.trim() || "";
      const cleanedJson = rawText
        .replace(/^```json\s*/i, "")
        .replace(/```$/, "")
        .trim();

      const parsed = JSON.parse(cleanedJson);
      const result: SummaryResult = {
        title: String(parsed.title || "Untitled").trim(),
        summary: String(parsed.summary || "").trim(),
        keyPoints: Array.isArray(parsed.keyPoints)
          ? parsed.keyPoints.map((k: unknown) => String(k).trim()).filter(Boolean)
          : [],
        topics: Array.isArray(parsed.topics)
          ? parsed.topics.map(
              (t: { timestamp?: string; title?: string; description?: string }) => ({
                timestamp: secondsToTimestamp(timestampToSeconds(String(t.timestamp || "00:00"))),
                title: String(t.title || "").trim(),
                description: String(t.description || "").trim(),
              }),
            )
          : [],
      };

      return result;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (isModelNotFoundError(lastError)) {
        throw new Error(formatModelNotFoundError(modelName, options?.lang));
      }
      if (attempt === MAX_RETRIES) break;

      const isRateLimit =
        (err as { status?: number })?.status === 429 ||
        /429|RESOURCE_EXHAUSTED|rate limit|quota/i.test(lastError.message);

      const baseDelay = isRateLimit ? 3000 : 1500;
      const jitter = Math.floor(Math.random() * 1000);
      const delayMs = Math.min(20000, baseDelay * 2 ** (attempt - 1) + jitter);

      if (verbose) {
        console.log(
          `[Gemini API] Error during summary generation (attempt ${attempt}/${MAX_RETRIES}, retrying in ${delayMs}ms): ${lastError.message}`,
        );
      }

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw new Error(
    `Gemini API summary generation failed after ${MAX_RETRIES} attempts: ${lastError?.message}`,
  );
}
