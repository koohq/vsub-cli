import { GoogleGenAI } from "@google/genai";
import { type FlatGlossary, formatGlossaryPrompt } from "./glossary.js";
import type { SrtEntry } from "./srt.js";

const DEFAULT_CHUNK_SIZE = 50;
const MAX_RETRIES = 4;

export interface TranslateOptions {
  prompt?: string | undefined;
  glossary?: FlatGlossary | undefined;
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
): Promise<string[]> {
  const prompt = buildTranslationPrompt(texts, targetLang, options);

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (verbose && attempt > 1) {
        console.log(`[Gemini API] Retry attempt ${attempt}/${MAX_RETRIES}...`);
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
      // Exponential backoff: 1.5s, 3s, 6s...
      const delayMs = Math.min(8000, 1500 * 2 ** (attempt - 1));
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw new Error(
    `Gemini API translation failed after ${MAX_RETRIES} attempts: ${lastError?.message}`,
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
  onProgress?: (currentChunk: number, totalChunks: number) => void,
  options?: TranslateOptions,
): Promise<SrtEntry[]> {
  if (entries.length === 0) return [];

  const ai = new GoogleGenAI({ apiKey });
  const modelName =
    process.env["VSUB_GEMINI_MODEL"] || process.env["GEMINI_MODEL"] || "gemini-3.6-flash";

  const totalChunks = Math.ceil(entries.length / DEFAULT_CHUNK_SIZE);
  const translatedEntries: SrtEntry[] = [];

  for (let i = 0; i < entries.length; i += DEFAULT_CHUNK_SIZE) {
    const chunkIndex = Math.floor(i / DEFAULT_CHUNK_SIZE) + 1;
    const chunk = entries.slice(i, i + DEFAULT_CHUNK_SIZE);
    const originalTexts = chunk.map((e) => e.text);

    if (onProgress) {
      onProgress(chunkIndex, totalChunks);
    }

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
    );

    for (let j = 0; j < chunk.length; j++) {
      const item = chunk[j];
      if (!item) continue;
      translatedEntries.push({
        id: item.id,
        startTime: item.startTime,
        endTime: item.endTime,
        text: translatedTexts[j] ?? item.text,
      });
    }
  }

  return translatedEntries;
}
