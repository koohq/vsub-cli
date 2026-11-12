import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import dotenv from "dotenv";
import {
  getI18n,
  type I18nMessages,
  resolveLanguage,
  type SupportedLanguage,
} from "./i18n/index.js";

/** Trims a configured API URL and removes trailing slashes without rewriting its path. */
export function normalizeBaseUrl(value?: string): string | undefined {
  return value?.trim().replace(/\/+$/, "") || undefined;
}

export function isHttpBaseUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** Shared validation for explicitly selected, user-configured OpenAI-compatible APIs. */
export function assertOpenAICompatibleSettingsReady(
  settings: { provider: string; model: string; baseUrl?: string | undefined },
  side: "stt" | "llm",
  lang?: SupportedLanguage | string,
): void {
  if (settings.provider !== "openai-compatible") return;
  const m = getI18n(lang).openaiCompatible;
  const issues: string[] = [];
  const baseUrl = settings.baseUrl?.trim();
  if (!baseUrl) issues.push(m.baseUrlRequired(side));
  else if (!isHttpBaseUrl(baseUrl)) issues.push(m.baseUrlInvalid(side, baseUrl));
  if (!settings.model.trim()) issues.push(m.modelRequired(side));
  if (issues.length) throw new Error(`${m.notConfigured(side)}\n- ${issues.join("\n- ")}`);
}

export function parsePositiveInteger(value: unknown): number | undefined {
  const number = Number(value);
  return !Number.isNaN(number) && number > 0 ? Math.floor(number) : undefined;
}

/**
 * Parses a boolean setting value: "true"/"1" -> true, "false"/"0" -> false
 * (trimmed, case-insensitive). Returns undefined for any other value.
 */
export function parseBooleanSetting(value: unknown): boolean | undefined {
  if (typeof value !== "string") return undefined;
  switch (value.trim().toLowerCase()) {
    case "true":
    case "1":
      return true;
    case "false":
    case "0":
      return false;
    default:
      return undefined;
  }
}

/** Resolves whether to refine the transcript: --refine/--no-refine, then VSUB_REFINE/config, then off. */
export function resolveRefine(
  cliRefine: boolean | undefined,
  configRefine: boolean | undefined,
): boolean {
  return cliRefine ?? configRefine ?? false;
}

export function resolveReflowLimits(
  options: { maxLength?: unknown; maxDuration?: unknown },
  configMaxLength: number | undefined,
): { maxLength: number | undefined; maxDuration: number | undefined } {
  return {
    maxLength: parsePositiveInteger(options.maxLength) ?? configMaxLength,
    maxDuration: parsePositiveInteger(options.maxDuration),
  };
}

// Load only startDir's .env; do not inspect parents to avoid unrelated project keys.
export function loadEnv(startDir: string = process.cwd()): void {
  const envPath = path.join(startDir, ".env");
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath, quiet: true });
  }
}
loadEnv();

export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";
export const DEFAULT_GROQ_MODEL = "whisper-large-v3-turbo";

export interface AppConfig {
  groqApiKey: string;
  geminiApiKey: string;
  ffmpegPath: string;
  whisperPrompt?: string | undefined;
  prompt?: string | undefined;
  glossary?: string | undefined;
  concurrency?: number | undefined;
  geminiModel?: string | undefined;
  groqModel?: string | undefined;
  targetLang?: string | undefined;
  lang?: SupportedLanguage | undefined;
  disableUpdateCheck?: boolean | undefined;
  maxLength?: number | undefined;
  /** Transcript refinement: VSUB_REFINE, then the config file. */
  refine?: boolean | undefined;
  burnPosition?: string | undefined;
  burnFontSize?: string | number | undefined;
  /** vsub-specific OpenRouter key: VSUB_OPENROUTER_API_KEY, then the config file. */
  openrouterApiKey?: string | undefined;
  /** Generic OPENROUTER_API_KEY. Used only when OpenRouter is chosen explicitly (see resolveSttSettings). */
  openrouterApiKeyFallback?: string | undefined;
  /** Raw transcription provider setting: VSUB_STT_PROVIDER, then the config file. Not validated here. */
  sttProvider?: string | undefined;
  /** OpenRouter transcription model: VSUB_OPENROUTER_STT_MODEL, then the config file. */
  openrouterSttModel?: string | undefined;
  /** Raw text generation provider setting: VSUB_LLM_PROVIDER, then the config file. Not validated here. */
  llmProvider?: string | undefined;
  /** OpenRouter text generation model: VSUB_OPENROUTER_LLM_MODEL, then the config file. */
  openrouterLlmModel?: string | undefined;
  /** VSUB_OPENAI_COMPATIBLE_STT_BASE_URL, then the config file; never falls back to another API. */
  openaiCompatibleSttBaseUrl?: string | undefined;
  /** VSUB_OPENAI_COMPATIBLE_STT_API_KEY, then the config file; never falls back to another API. */
  openaiCompatibleSttApiKey?: string | undefined;
  /** VSUB_OPENAI_COMPATIBLE_STT_MODEL, then the config file; never falls back to another API. */
  openaiCompatibleSttModel?: string | undefined;
  /** VSUB_OPENAI_COMPATIBLE_LLM_BASE_URL, then the config file; never falls back to another API. */
  openaiCompatibleLlmBaseUrl?: string | undefined;
  /** VSUB_OPENAI_COMPATIBLE_LLM_API_KEY, then the config file; never falls back to another API. */
  openaiCompatibleLlmApiKey?: string | undefined;
  /** VSUB_OPENAI_COMPATIBLE_LLM_MODEL, then the config file; never falls back to another API. */
  openaiCompatibleLlmModel?: string | undefined;
}

export function getGlobalConfigDir(): string {
  const isWindows = process.platform === "win32";
  if (isWindows && process.env["APPDATA"]) {
    return path.join(process.env["APPDATA"], "vsub");
  }
  const configHome = process.env["XDG_CONFIG_HOME"] || path.join(os.homedir(), ".config");
  return path.join(configHome, "vsub");
}

export function getGlobalConfigPath(): string {
  return path.join(getGlobalConfigDir(), "config.json");
}

export function loadGlobalConfig(): Partial<AppConfig> {
  const configPath = getGlobalConfigPath();
  if (fs.existsSync(configPath)) {
    try {
      const data = fs.readFileSync(configPath, "utf-8");
      return JSON.parse(data);
    } catch {
      return {};
    }
  }
  return {};
}

function describeError(error: unknown): string {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code ?? (error instanceof Error ? error.message : String(error));
}

/**
 * Creates the vsub config directory and, on Unix, restricts it to 0700.
 * A failed chmod only produces a warning: the config file itself is always written with mode 600.
 */
function ensureConfigDir(dir: string, i18n: I18nMessages): void {
  fs.mkdirSync(dir, { recursive: true });
  if (process.platform === "win32") return;
  try {
    fs.chmodSync(dir, 0o700);
  } catch (error) {
    console.warn(i18n.config.dirPermissionWarning(dir, describeError(error)));
  }
}

/**
 * Reads the existing config for a save. Unlike loadGlobalConfig(), a config file that exists but
 * cannot be read or parsed as a JSON object is an error, so that a save never discards settings.
 */
function readConfigForSave(configPath: string, i18n: I18nMessages): Partial<AppConfig> {
  if (!fs.existsSync(configPath)) return {};
  let reason: string;
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Partial<AppConfig>;
    }
    reason = "not a JSON object";
  } catch (error) {
    reason = describeError(error);
  }
  throw new Error(i18n.config.unreadableConfig(configPath, reason));
}

export function saveGlobalConfig(
  config: Partial<AppConfig>,
  options: { lang?: SupportedLanguage | undefined } = {},
): void {
  const i18n = getI18n(options.lang);
  const configPath = getGlobalConfigPath();
  ensureConfigDir(path.dirname(configPath), i18n);

  const existing = readConfigForSave(configPath, i18n);
  const updated = { ...existing, ...config };

  // Write to a temp file next to the real target (following a symlink) and rename it into place,
  // so the file is created with mode 600 and never visible with looser permissions.
  const targetPath = fs.existsSync(configPath) ? fs.realpathSync(configPath) : configPath;
  const tmpPath = path.join(path.dirname(targetPath), `.config.json.${randomUUID()}.tmp`);
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(updated, null, 2), {
      encoding: "utf-8",
      mode: 0o600,
      flag: "wx",
    });
    fs.renameSync(tmpPath, targetPath);
  } catch (error) {
    try {
      fs.rmSync(tmpPath, { force: true });
    } catch {
      // Ignore cleanup failures; the original error is more useful.
    }
    throw error;
  }
}

export function getConfig(cliFfmpegPath?: string, cliLang?: string): AppConfig {
  const globalConfig = loadGlobalConfig();

  const groqApiKey =
    process.env["VSUB_GROQ_API_KEY"]?.trim() ||
    process.env["GROQ_API_KEY"]?.trim() ||
    globalConfig.groqApiKey?.trim() ||
    "";

  const geminiApiKey =
    process.env["VSUB_GEMINI_API_KEY"]?.trim() ||
    process.env["GEMINI_API_KEY"]?.trim() ||
    globalConfig.geminiApiKey?.trim() ||
    "";

  const ffmpegPath =
    cliFfmpegPath?.trim() ||
    process.env["VSUB_FFMPEG_PATH"]?.trim() ||
    process.env["FFMPEG_PATH"]?.trim() ||
    globalConfig.ffmpegPath?.trim() ||
    "ffmpeg";

  const whisperPrompt =
    process.env["VSUB_WHISPER_PROMPT"]?.trim() ||
    process.env["WHISPER_PROMPT"]?.trim() ||
    globalConfig.whisperPrompt?.trim() ||
    undefined;

  const prompt =
    process.env["VSUB_PROMPT"]?.trim() ||
    process.env["VSUB_GEMINI_PROMPT"]?.trim() ||
    process.env["GEMINI_PROMPT"]?.trim() ||
    globalConfig.prompt?.trim() ||
    undefined;

  const glossary =
    process.env["VSUB_GLOSSARY"]?.trim() ||
    process.env["GLOSSARY"]?.trim() ||
    globalConfig.glossary?.trim() ||
    undefined;

  const envConcurrency = process.env["VSUB_CONCURRENCY"]?.trim();
  let concurrency: number | undefined;
  if (envConcurrency && !Number.isNaN(Number(envConcurrency)) && Number(envConcurrency) > 0) {
    concurrency = Math.floor(Number(envConcurrency));
  } else if (
    globalConfig.concurrency !== undefined &&
    !Number.isNaN(Number(globalConfig.concurrency)) &&
    Number(globalConfig.concurrency) > 0
  ) {
    concurrency = Math.floor(Number(globalConfig.concurrency));
  }

  const geminiModel =
    process.env["VSUB_GEMINI_MODEL"]?.trim() ||
    process.env["GEMINI_MODEL"]?.trim() ||
    globalConfig.geminiModel?.trim() ||
    DEFAULT_GEMINI_MODEL;

  const groqModel =
    process.env["VSUB_GROQ_MODEL"]?.trim() ||
    process.env["GROQ_MODEL"]?.trim() ||
    globalConfig.groqModel?.trim() ||
    DEFAULT_GROQ_MODEL;

  const targetLang =
    process.env["VSUB_TARGET_LANG"]?.trim() ||
    process.env["TARGET_LANG"]?.trim() ||
    globalConfig.targetLang?.trim() ||
    undefined;

  const lang = resolveLanguage(cliLang, process.env["VSUB_LANG"], globalConfig.lang);

  const envDisableUpdate =
    process.env["VSUB_NO_UPDATE_CHECK"]?.trim() || process.env["VSUB_DISABLE_UPDATE_CHECK"]?.trim();
  let disableUpdateCheck: boolean | undefined;
  if (envDisableUpdate !== undefined) {
    disableUpdateCheck = envDisableUpdate === "1" || envDisableUpdate.toLowerCase() === "true";
  } else if (globalConfig.disableUpdateCheck !== undefined) {
    disableUpdateCheck = Boolean(globalConfig.disableUpdateCheck);
  }

  const envMaxLength = process.env["VSUB_MAX_LENGTH"]?.trim();
  const refine =
    parseBooleanSetting(process.env["VSUB_REFINE"]) ??
    (typeof globalConfig.refine === "boolean" ? globalConfig.refine : undefined);
  const maxLength =
    parsePositiveInteger(envMaxLength) ?? parsePositiveInteger(globalConfig.maxLength);

  const burnPosition =
    process.env["VSUB_BURN_POSITION"]?.trim() || globalConfig.burnPosition?.trim() || undefined;

  const envBurnFontSize = process.env["VSUB_BURN_FONT_SIZE"]?.trim();
  const burnFontSize = envBurnFontSize || globalConfig.burnFontSize || undefined;

  const openrouterApiKey =
    process.env["VSUB_OPENROUTER_API_KEY"]?.trim() ||
    globalConfig.openrouterApiKey?.trim() ||
    undefined;

  const openaiCompatibleSttBaseUrl = normalizeBaseUrl(
    process.env["VSUB_OPENAI_COMPATIBLE_STT_BASE_URL"]?.trim() ||
      globalConfig.openaiCompatibleSttBaseUrl,
  );
  const openaiCompatibleSttApiKey =
    process.env["VSUB_OPENAI_COMPATIBLE_STT_API_KEY"]?.trim() ||
    globalConfig.openaiCompatibleSttApiKey?.trim() ||
    undefined;
  const openaiCompatibleSttModel =
    process.env["VSUB_OPENAI_COMPATIBLE_STT_MODEL"]?.trim() ||
    globalConfig.openaiCompatibleSttModel?.trim() ||
    undefined;
  const openaiCompatibleLlmBaseUrl = normalizeBaseUrl(
    process.env["VSUB_OPENAI_COMPATIBLE_LLM_BASE_URL"]?.trim() ||
      globalConfig.openaiCompatibleLlmBaseUrl,
  );
  const openaiCompatibleLlmApiKey =
    process.env["VSUB_OPENAI_COMPATIBLE_LLM_API_KEY"]?.trim() ||
    globalConfig.openaiCompatibleLlmApiKey?.trim() ||
    undefined;
  const openaiCompatibleLlmModel =
    process.env["VSUB_OPENAI_COMPATIBLE_LLM_MODEL"]?.trim() ||
    globalConfig.openaiCompatibleLlmModel?.trim() ||
    undefined;

  const openrouterApiKeyFallback = process.env["OPENROUTER_API_KEY"]?.trim() || undefined;

  const sttProvider =
    process.env["VSUB_STT_PROVIDER"]?.trim() || globalConfig.sttProvider?.trim() || undefined;

  const openrouterSttModel =
    process.env["VSUB_OPENROUTER_STT_MODEL"]?.trim() ||
    globalConfig.openrouterSttModel?.trim() ||
    undefined;

  const llmProvider =
    process.env["VSUB_LLM_PROVIDER"]?.trim() || globalConfig.llmProvider?.trim() || undefined;

  const openrouterLlmModel =
    process.env["VSUB_OPENROUTER_LLM_MODEL"]?.trim() ||
    globalConfig.openrouterLlmModel?.trim() ||
    undefined;

  return {
    groqApiKey,
    geminiApiKey,
    ffmpegPath,
    whisperPrompt,
    prompt,
    glossary,
    concurrency,
    geminiModel,
    groqModel,
    targetLang,
    lang,
    disableUpdateCheck,
    maxLength,
    refine,
    burnPosition,
    burnFontSize,
    openrouterApiKey,
    openrouterApiKeyFallback,
    openaiCompatibleSttBaseUrl,
    openaiCompatibleSttApiKey,
    openaiCompatibleSttModel,
    openaiCompatibleLlmBaseUrl,
    openaiCompatibleLlmApiKey,
    openaiCompatibleLlmModel,
    sttProvider,
    openrouterSttModel,
    llmProvider,
    openrouterLlmModel,
  };
}

export async function ensureApiKeys(
  config: AppConfig,
  options: {
    requireGroq?: boolean;
    requireGemini?: boolean;
    requireOpenRouter?: boolean;
    lang?: SupportedLanguage | undefined;
  } = {},
): Promise<AppConfig> {
  const requireGroq = options.requireGroq ?? true;
  const requireGemini = options.requireGemini ?? true;
  const requireOpenRouter = options.requireOpenRouter ?? false;
  let groqApiKey = config.groqApiKey;
  let geminiApiKey = config.geminiApiKey;
  let openrouterApiKey = config.openrouterApiKey;

  const isInteractive = Boolean(process.stdin.isTTY && process.stdout.isTTY);

  const missingGroq = requireGroq && !groqApiKey;
  const missingGemini = requireGemini && !geminiApiKey;
  const missingOpenRouter = requireOpenRouter && !openrouterApiKey;

  if ((missingGroq || missingGemini || missingOpenRouter) && isInteractive) {
    const m = getI18n(options.lang).config;
    console.log(m.missingKeysHeader);
    console.log(m.missingKeysNote);
    console.log(`   ${getGlobalConfigPath()}\n`);

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    let promptedOpenRouterKey: string | undefined;

    try {
      if (missingOpenRouter) {
        promptedOpenRouterKey = (await rl.question(m.promptOpenRouterKey)).trim();
        openrouterApiKey = promptedOpenRouterKey;
      } else if (missingGroq) {
        groqApiKey = (await rl.question(m.promptGroqKey)).trim();
      }

      if (missingGemini) {
        geminiApiKey = (await rl.question(m.promptGeminiKey)).trim();
      }

      if (groqApiKey || geminiApiKey || promptedOpenRouterKey) {
        saveGlobalConfig(
          {
            ...(groqApiKey ? { groqApiKey } : {}),
            ...(geminiApiKey ? { geminiApiKey } : {}),
            ...(promptedOpenRouterKey ? { openrouterApiKey: promptedOpenRouterKey } : {}),
          },
          { lang: options.lang },
        );
        console.log(m.missingKeysSaved);
      }
    } finally {
      rl.close();
    }
  }

  const updatedConfig: AppConfig = {
    ...config,
    groqApiKey,
    geminiApiKey,
    openrouterApiKey,
  };

  validateApiKeys(updatedConfig, {
    requireGroq,
    requireGemini,
    requireOpenRouter,
    lang: options.lang,
  });
  return updatedConfig;
}

export function validateApiKeys(
  config: AppConfig,
  options: {
    requireGroq?: boolean;
    requireGemini?: boolean;
    requireOpenRouter?: boolean;
    lang?: SupportedLanguage | undefined;
  } = {},
): void {
  const requireGroq = options.requireGroq ?? true;
  const requireGemini = options.requireGemini ?? true;
  const requireOpenRouter = options.requireOpenRouter ?? false;
  const missingKeys: string[] = [];
  const m = getI18n(options.lang).config;

  if (requireOpenRouter && !config.openrouterApiKey) {
    missingKeys.push(m.openRouterKeyHint);
  }
  if (requireGroq && !config.groqApiKey) {
    missingKeys.push(m.groqKeyHint);
  }
  if (requireGemini && !config.geminiApiKey) {
    missingKeys.push(m.geminiKeyHint);
  }

  if (missingKeys.length > 0) {
    throw new Error(m.requiredKeysMissing(missingKeys));
  }
}
