import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import dotenv from "dotenv";

// Load environment variables from .env file if present
dotenv.config();

export interface AppConfig {
  groqApiKey: string;
  geminiApiKey: string;
  ffmpegPath: string;
}

export function getGlobalConfigPath(): string {
  const isWindows = process.platform === "win32";
  if (isWindows && process.env["APPDATA"]) {
    return path.join(process.env["APPDATA"], "vsub", "config.json");
  }
  const configHome = process.env["XDG_CONFIG_HOME"] || path.join(os.homedir(), ".config");
  return path.join(configHome, "vsub", "config.json");
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

export function saveGlobalConfig(config: Partial<AppConfig>): void {
  const configPath = getGlobalConfigPath();
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const existing = loadGlobalConfig();
  const updated = { ...existing, ...config };
  fs.writeFileSync(configPath, JSON.stringify(updated, null, 2), "utf-8");
}

export function getConfig(cliFfmpegPath?: string): AppConfig {
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

  return {
    groqApiKey,
    geminiApiKey,
    ffmpegPath,
  };
}

export async function ensureApiKeys(
  config: AppConfig,
  options: { requireGemini?: boolean } = {},
): Promise<AppConfig> {
  const requireGemini = options.requireGemini ?? true;
  let groqApiKey = config.groqApiKey;
  let geminiApiKey = config.geminiApiKey;

  const isInteractive = Boolean(process.stdin.isTTY && process.stdout.isTTY);

  const missingGroq = !groqApiKey;
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
      if (!groqApiKey) {
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
        saveGlobalConfig({
          ...(groqApiKey ? { groqApiKey } : {}),
          ...(geminiApiKey ? { geminiApiKey } : {}),
        });
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

  validateApiKeys(updatedConfig, { requireGemini });
  return updatedConfig;
}

export function validateApiKeys(
  config: AppConfig,
  options: { requireGemini?: boolean } = {},
): void {
  const requireGemini = options.requireGemini ?? true;
  const missingKeys: string[] = [];

  if (!config.groqApiKey) {
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
