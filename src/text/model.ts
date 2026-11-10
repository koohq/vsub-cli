import type { SupportedLanguage } from "../i18n/index.js";

const MAX_RETRIES = 4;

/** Subset of JSON Schema used for structured output. Type names are lowercase. */
export interface JsonSchema {
  type: "array" | "object" | "string" | "integer";
  description?: string | undefined;
  items?: JsonSchema | undefined;
  properties?: Record<string, JsonSchema> | undefined;
  required?: string[] | undefined;
}

export interface JsonRequest {
  prompt: string;
  schema: JsonSchema;
  /** Short name of the output, e.g. "translation". Providers that need a schema name use it (T-030b). */
  schemaName: string;
}

export interface TextModelLimits {
  /** Requests sent at the same time when the caller does not choose (--concurrency). */
  defaultConcurrency: number;
}

export type TextModelErrorKind = "model-not-found" | "rate-limit" | "retry" | "fatal";

export interface TextModel {
  /** Prefix for verbose logs and error messages, e.g. "Gemini API". */
  logLabel: string;
  /** Model name sent to the provider. */
  model: string;
  limits: TextModelLimits;
  /** Sends one request without retrying and returns the raw text of the answer. */
  generateJson(request: JsonRequest): Promise<string>;
  /** Tells generateJsonWithRetry how to treat an error thrown by generateJson. */
  classifyError(error: unknown): TextModelErrorKind;
  /** Actionable message used when the model does not exist. */
  formatModelNotFound(lang?: SupportedLanguage | undefined): string;
}

export async function generateJsonWithRetry<T>(
  model: TextModel,
  request: JsonRequest,
  parse: (value: unknown) => T,
  options: {
    /** "translation", "chapters generation", "summary generation" */
    task: string;
    /** "chunk 2/5" for translation; omitted otherwise. */
    where?: string | undefined;
    verbose?: boolean | undefined;
    lang?: SupportedLanguage | undefined;
  },
): Promise<T> {
  let lastError: Error | null = null;
  const whereOrTask = options.where ?? options.task;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    if (options.verbose && attempt > 1) {
      console.log(
        `[${model.logLabel}] Retry attempt ${attempt}/${MAX_RETRIES} for ${whereOrTask}...`,
      );
    }

    let isRateLimit = false;
    let rawText: string | undefined;

    try {
      rawText = await model.generateJson(request);
    } catch (genErr) {
      const kind = model.classifyError(genErr);
      if (kind === "model-not-found") {
        throw new Error(model.formatModelNotFound(options.lang));
      }
      if (kind === "fatal") {
        throw genErr instanceof Error ? genErr : new Error(String(genErr));
      }
      isRateLimit = kind === "rate-limit";
      lastError = genErr instanceof Error ? genErr : new Error(String(genErr));
    }

    if (rawText !== undefined) {
      try {
        const cleanedJson = rawText
          .trim()
          .replace(/^```json\s*/i, "")
          .replace(/```$/, "")
          .trim();

        const parsed = JSON.parse(cleanedJson);
        return parse(parsed);
      } catch (parseErr) {
        lastError = parseErr instanceof Error ? parseErr : new Error(String(parseErr));
        isRateLimit = false;
      }
    }

    if (attempt === MAX_RETRIES) break;

    const baseDelay = isRateLimit ? 3000 : 1500;
    const jitter = Math.floor(Math.random() * 1000);
    const delayMs = Math.min(20000, baseDelay * 2 ** (attempt - 1) + jitter);

    if (options.verbose) {
      if (options.where) {
        console.log(
          `[${model.logLabel}] Error on ${options.where} (attempt ${attempt}/${MAX_RETRIES}, retrying in ${delayMs}ms): ${lastError?.message}`,
        );
      } else {
        console.log(
          `[${model.logLabel}] Error during ${options.task} (attempt ${attempt}/${MAX_RETRIES}, retrying in ${delayMs}ms): ${lastError?.message}`,
        );
      }
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  const whereMsg = options.where ? ` on ${options.where}` : "";
  throw new Error(
    `${model.logLabel} ${options.task} failed after ${MAX_RETRIES} attempts${whereMsg}: ${lastError?.message}`,
  );
}
