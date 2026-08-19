import { GoogleGenAI } from "@google/genai";
import { type FlatGlossary, formatGlossaryPrompt } from "./glossary.js";
import type { SrtEntry } from "./srt.js";

const DEFAULT_CHUNK_SIZE = 50;
const DEFAULT_CONCURRENCY = 3;
const MAX_RETRIES = 4;

export interface TranslateOptions {
  prompt?: string | undefined;
  glossary?: FlatGlossary | undefined;
  concurrency?: number | undefined;
  model?: string | undefined;
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
 * Builds the translation prompt with optional custom instructions and glossary rules.
 */
export function buildTranslationPrompt(
  texts: string[],
  targetLang: string,
  options?: TranslateOptions,
): string {
  const customPrompt = options?.prompt?.trim();
  const glossaryRules = options?.glossary ? formatGlossaryPrompt(options.glossary) : "";

  let prompt = `You are a professional translator for video subtitles.
Translate the following array of subtitle texts into target language code "${targetLang}".

STRICT RULES:
1. Return ONLY a valid JSON array of strings corresponding 1-to-1 with the input array.
2. The output array MUST contain exactly ${texts.length} items in the same order as input.
3. Translate into natural, clear conversational style suited for video subtitles.
4. Do NOT include markdown code blocks (such as \`\`\`json), explanations, or any extra text outside the JSON array.`;

  if (customPrompt) {
    prompt += `\n\nADDITIONAL TRANSLATION INSTRUCTIONS:\n${customPrompt}`;
  }

  if (glossaryRules) {
    prompt += `\n\nGLOSSARY / TERMINOLOGY RULES (MUST USE THESE EXACT TRANSLATIONS):\n${glossaryRules}`;
  }

  prompt += `\n\nInput Array:\n${JSON.stringify(texts, null, 2)}`;
  return prompt;
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
): Promise<string[]> {
  const prompt = buildTranslationPrompt(texts, targetLang, options);

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
        `Gemini API returned mismatched array length (expected: ${texts.length}, received: ${Array.isArray(translatedArray) ? translatedArray.length : 0})`,
      );
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
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
    "gemini-3.7-flash";

  const totalChunks = Math.ceil(entries.length / DEFAULT_CHUNK_SIZE);
  const chunks: SrtEntry[][] = [];
  for (let i = 0; i < entries.length; i += DEFAULT_CHUNK_SIZE) {
    chunks.push(entries.slice(i, i + DEFAULT_CHUNK_SIZE));
  }

  const concurrency =
    options?.concurrency && options.concurrency > 0
      ? Math.floor(options.concurrency)
      : DEFAULT_CONCURRENCY;

  let completedChunks = 0;

  const chunkResults = await asyncPool(
    concurrency,
    chunks,
    async (chunk, chunkIdx) => {
      const chunkIndex = chunkIdx + 1;
      const originalTexts = chunk.map((e) => e.text);

      if (verbose) {
        console.log(
          `[Gemini API] Translating chunk (${chunkIndex}/${totalChunks}) [${chunk.length} items]...`,
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
    },
  );

  return chunkResults.flat();
}
