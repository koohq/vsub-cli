import type { SupportedLanguage } from "../i18n/index.js";
import type { JsonRequest, TextModel, TextModelErrorKind, TextModelLimits } from "./model.js";

const RETRYABLE_STATUS_CODES = new Set([408, 500, 502, 503, 504, 524, 529]);

export interface OpenAICompatibleTextProfile {
  /** Prefix for verbose logs and error messages, e.g. "OpenRouter API". */
  logLabel: string;
  /** API base URL without a trailing slash, e.g. "https://openrouter.ai/api/v1". */
  baseUrl: string;
  defaultModel?: string | undefined;
  limits: TextModelLimits; // { defaultConcurrency: 3 }
  /** Upper bound of output tokens per request. Also caps the cost the provider reserves. */
  maxTokens?: number | undefined; // 16384
  /** Sent as-is as `reasoning`; omitted when undefined. OpenRouter: { effort: "low" }. */
  reasoning?: { effort: "minimal" | "low" | "medium" | "high" } | undefined;
  /** Sent as-is as top-level `reasoning_effort`; omitted when unset. */
  reasoningEffort?: string | undefined;
  /** Client-side timeout of one request, in milliseconds. */
  requestTimeoutMs: number; // 120_000
  /** Messages for errors the user can act on. */
  messages: {
    modelNotFound: (
      model: string,
      isDefault: boolean,
      lang?: SupportedLanguage | undefined,
    ) => string;
    insufficientCredits?: ((lang?: SupportedLanguage | undefined) => string) | undefined;
  };
}

interface RawResponsePayload {
  error?: {
    message?: unknown;
    code?: unknown;
  };
  choices?: Array<{
    finish_reason?: unknown;
    message?: {
      content?: unknown;
    };
  }>;
}

export function createOpenAICompatibleTextModel(
  profile: OpenAICompatibleTextProfile,
  apiKey: string,
  model: string,
  deps?: { fetch?: typeof fetch | undefined; lang?: SupportedLanguage | undefined },
): TextModel {
  const fetchFn = deps?.fetch ?? globalThis.fetch;

  return {
    logLabel: profile.logLabel,
    model,
    limits: profile.limits,
    async generateJson(request: JsonRequest): Promise<string> {
      const url = `${profile.baseUrl}/chat/completions`;
      const headers: Record<string, string> = {
        ...(apiKey.trim() ? { Authorization: `Bearer ${apiKey}` } : {}),
        "Content-Type": "application/json",
      };

      const body: Record<string, unknown> = {
        model,
        messages: [{ role: "user", content: request.prompt }],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: request.schemaName,
            strict: true,
            schema: request.schema,
          },
        },
        ...(profile.maxTokens !== undefined ? { max_tokens: profile.maxTokens } : {}),
      };

      if (profile.reasoning !== undefined) {
        body["reasoning"] = profile.reasoning;
      }
      if (profile.reasoningEffort) {
        body["reasoning_effort"] = profile.reasoningEffort;
      }

      const signal = AbortSignal.timeout(profile.requestTimeoutMs);

      const response = await fetchFn(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal,
      });

      if (response.status === 402 && profile.messages.insufficientCredits) {
        const err = new Error(profile.messages.insufficientCredits(deps?.lang));
        Object.assign(err, { status: 402 });
        throw err;
      }

      if (!response.ok) {
        let errorMessage = "";
        try {
          const errData = (await response.json()) as RawResponsePayload;
          if (typeof errData?.error?.message === "string") {
            errorMessage = errData.error.message;
          }
        } catch {
          // ignore parsing error
        }

        const formatted = errorMessage
          ? `${profile.logLabel} error ${response.status}: ${errorMessage}`
          : `${profile.logLabel} error ${response.status}`;
        const err = new Error(formatted);
        Object.assign(err, { status: response.status });
        throw err;
      }

      let rawData: unknown;
      try {
        rawData = await response.json();
      } catch {
        const err = new Error(
          `${profile.logLabel} returned an unexpected response (status ${response.status})`,
        );
        Object.assign(err, { status: response.status });
        throw err;
      }

      const data = rawData as RawResponsePayload;

      if (data?.error) {
        let code: number | undefined;
        if (typeof data.error.code === "number") {
          code = data.error.code;
        } else if (typeof data.error.code === "string" && /^\d+$/.test(data.error.code.trim())) {
          code = Number.parseInt(data.error.code.trim(), 10);
        }

        if (code === 402 && profile.messages.insufficientCredits) {
          const err = new Error(profile.messages.insufficientCredits(deps?.lang));
          Object.assign(err, { status: 402 });
          throw err;
        }

        const errMsg = typeof data.error.message === "string" ? data.error.message : "";
        const formatted =
          code !== undefined
            ? errMsg
              ? `${profile.logLabel} error ${code}: ${errMsg}`
              : `${profile.logLabel} error ${code}`
            : errMsg
              ? `${profile.logLabel} error: ${errMsg}`
              : `${profile.logLabel} error`;

        const err = new Error(formatted);
        if (code !== undefined) {
          Object.assign(err, { status: code });
        }
        throw err;
      }

      const choice = data?.choices?.[0];
      if (choice?.finish_reason === "length") {
        throw new Error(`${profile.logLabel} response truncated: finish_reason is length`);
      }

      const content = choice?.message?.content;
      if (typeof content !== "string" || content.trim() === "") {
        throw new Error(`${profile.logLabel} returned empty or non-string content`);
      }

      return content;
    },

    classifyError(error: unknown): TextModelErrorKind {
      const status = (error as { status?: number })?.status;
      const message = error instanceof Error ? error.message : String(error);

      if (
        status === 404 ||
        /not a valid model|No endpoints found|model.*not found/i.test(message)
      ) {
        return "model-not-found";
      }

      if (status === 429) {
        return "rate-limit";
      }

      if (status === 402) {
        return "fatal";
      }

      if (status !== undefined) {
        return RETRYABLE_STATUS_CODES.has(status) ? "retry" : "fatal";
      }

      return "retry";
    },

    formatModelNotFound(lang?: SupportedLanguage | undefined): string {
      const isDefault = model === profile.defaultModel;
      return profile.messages.modelNotFound(model, isDefault, lang ?? deps?.lang);
    },
  };
}
