import { GoogleGenAI, type ThinkingConfig, ThinkingLevel, Type } from "@google/genai";
import { DEFAULT_GEMINI_MODEL } from "../config.js";
import { getI18n, type SupportedLanguage } from "../i18n/index.js";
import type { JsonRequest, JsonSchema, TextModel, TextModelErrorKind } from "./model.js";

/**
 * Builds the thinking config for models known to be Gemini 3 or newer.
 * Gemini 3 models support thinkingLevel: LOW to reduce latency and token usage
 * without degrading translation/chapter/summary quality. Non-matching or older
 * models (such as Gemini 2.x) are left unchanged without thinkingConfig.
 */
export function buildThinkingConfig(modelName: string): { thinkingConfig?: ThinkingConfig } {
  const normalized = modelName.replace(/^models\//, "");
  const match = normalized.match(/^gemini-(\d+)(?:[.-]|$)/);
  if (match && match[1] !== undefined && Number.parseInt(match[1], 10) >= 3) {
    return {
      thinkingConfig: {
        thinkingLevel: ThinkingLevel.LOW,
      },
    };
  }
  return {};
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
 * Resolves the Gemini model name by checking CLI override, saved config, and falling back to default.
 */
export function resolveGeminiModel(
  override?: string | undefined,
  config?: { geminiModel?: string | undefined } | undefined,
): string {
  return override?.trim() || config?.geminiModel?.trim() || DEFAULT_GEMINI_MODEL;
}

function toGeminiSchema(schema: JsonSchema): Record<string, unknown> {
  const typeMap: Record<JsonSchema["type"], Type> = {
    array: Type.ARRAY,
    object: Type.OBJECT,
    string: Type.STRING,
    integer: Type.INTEGER,
  };

  const result: Record<string, unknown> = {
    type: typeMap[schema.type],
  };

  if (schema.description !== undefined) {
    result["description"] = schema.description;
  }
  if (schema.items !== undefined) {
    result["items"] = toGeminiSchema(schema.items);
  }
  if (schema.properties !== undefined) {
    const props: Record<string, unknown> = {};
    for (const [key, propSchema] of Object.entries(schema.properties)) {
      props[key] = toGeminiSchema(propSchema);
    }
    result["properties"] = props;
  }
  if (schema.required !== undefined) {
    result["required"] = schema.required;
  }

  return result;
}

/**
 * Creates a TextModel instance powered by the Google Gemini API.
 */
export function createGeminiTextModel(apiKey: string, model: string): TextModel {
  const ai = new GoogleGenAI({ apiKey });

  return {
    logLabel: "Gemini API",
    model,
    limits: {
      defaultConcurrency: 3,
    },
    async generateJson(request: JsonRequest): Promise<string> {
      const response = await ai.models.generateContent({
        model,
        contents: request.prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: toGeminiSchema(request.schema),
          ...buildThinkingConfig(model),
        },
      });
      return response.text ?? "";
    },
    classifyError(error: unknown): TextModelErrorKind {
      if (isModelNotFoundError(error)) {
        return "model-not-found";
      }
      const status =
        (error as { status?: number; statusCode?: number })?.status ??
        (error as { statusCode?: number })?.statusCode;
      const message = error instanceof Error ? error.message : String(error);
      if (status === 429 || /429|RESOURCE_EXHAUSTED|rate limit|quota/i.test(message)) {
        return "rate-limit";
      }
      return "retry";
    },
    formatModelNotFound(lang?: SupportedLanguage | undefined): string {
      return formatModelNotFoundError(model, lang);
    },
  };
}
