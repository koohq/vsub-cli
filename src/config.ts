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

// Load environment variables from .env file if present in startDir or parent directories
export function loadEnv(startDir: string = process.cwd()): void {
  let currentDir = startDir;
  while (true) {
    const envPath = path.join(currentDir, ".env");
    if (fs.existsSync(envPath)) {
      dotenv.config({ path: envPath, quiet: true });
      return;
    }
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) break;
    currentDir = parentDir;
  }
  dotenv.config({ quiet: true });
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
  burnPosition?: string | undefined;
  burnFontSize?: string | number | undefined;
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
  let maxLength: number | undefined;
  if (envMaxLength && !Number.isNaN(Number(envMaxLength)) && Number(envMaxLength) > 0) {
    maxLength = Math.floor(Number(envMaxLength));
  } else if (
    globalConfig.maxLength !== undefined &&
    !Number.isNaN(Number(globalConfig.maxLength)) &&
    Number(globalConfig.maxLength) > 0
  ) {
    maxLength = Math.floor(Number(globalConfig.maxLength));
  }

  const burnPosition =
    process.env["VSUB_BURN_POSITION"]?.trim() || globalConfig.burnPosition?.trim() || undefined;

  const envBurnFontSize = process.env["VSUB_BURN_FONT_SIZE"]?.trim();
  const burnFontSize = envBurnFontSize || globalConfig.burnFontSize || undefined;

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
    burnPosition,
    burnFontSize,
  };
}

export async function ensureApiKeys(
  config: AppConfig,
  options: {
    requireGroq?: boolean;
    requireGemini?: boolean;
    lang?: SupportedLanguage | undefined;
  } = {},
): Promise<AppConfig> {
  const requireGroq = options.requireGroq ?? true;
  const requireGemini = options.requireGemini ?? true;
  let groqApiKey = config.groqApiKey;
  let geminiApiKey = config.geminiApiKey;

  const isInteractive = Boolean(process.stdin.isTTY && process.stdout.isTTY);

  const missingGroq = requireGroq && !groqApiKey;
  const missingGemini = requireGemini && !geminiApiKey;

  if ((missingGroq || missingGemini) && isInteractive) {
    console.log("\n🔑 API keys missing. Starting interactive setup.");
    console.log("Note: Entered keys will be saved globally for future use at:");
    console.log(`   ${getGlobalConfigPath()}\n`);

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    try {
      if (requireGroq && !groqApiKey) {
        groqApiKey = (
          await rl.question("1. Enter Groq API Key (https://console.groq.com/): ")
        ).trim();
      }

      if (requireGemini && !geminiApiKey) {
        geminiApiKey = (
          await rl.question("2. Enter Gemini API Key (https://aistudio.google.com/): ")
        ).trim();
      }

      if (groqApiKey || geminiApiKey) {
        saveGlobalConfig(
          {
            ...(groqApiKey ? { groqApiKey } : {}),
            ...(geminiApiKey ? { geminiApiKey } : {}),
          },
          { lang: options.lang },
        );
        console.log("✅ Configuration saved successfully.\n");
      }
    } finally {
      rl.close();
    }
  }

  const updatedConfig = {
    ...config,
    groqApiKey,
    geminiApiKey,
  };

  validateApiKeys(updatedConfig, { requireGroq, requireGemini });
  return updatedConfig;
}

export function validateApiKeys(
  config: AppConfig,
  options: { requireGroq?: boolean; requireGemini?: boolean } = {},
): void {
  const requireGroq = options.requireGroq ?? true;
  const requireGemini = options.requireGemini ?? true;
  const missingKeys: string[] = [];

  if (requireGroq && !config.groqApiKey) {
    missingKeys.push("VSUB_GROQ_API_KEY / GROQ_API_KEY (Get at: https://console.groq.com/)");
  }
  if (requireGemini && !config.geminiApiKey) {
    missingKeys.push("VSUB_GEMINI_API_KEY / GEMINI_API_KEY (Get at: https://aistudio.google.com/)");
  }

  if (missingKeys.length > 0) {
    throw new Error(
      `Required API key(s) are not configured:\n- ${missingKeys.join("\n- ")}\nPlease set them via interactive prompt, .env file, or environment variables (VSUB_GROQ_API_KEY / VSUB_GEMINI_API_KEY).`,
    );
  }
}
