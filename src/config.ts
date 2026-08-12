import dotenv from "dotenv";

// Load environment variables from .env file if present
dotenv.config();

export interface AppConfig {
  groqApiKey: string;
  geminiApiKey: string;
  ffmpegPath: string;
}

export function getConfig(cliFfmpegPath?: string): AppConfig {
  const groqApiKey = process.env["GROQ_API_KEY"]?.trim() || "";
  const geminiApiKey = process.env["GEMINI_API_KEY"]?.trim() || "";
  const ffmpegPath = cliFfmpegPath?.trim() || process.env["FFMPEG_PATH"]?.trim() || "ffmpeg";

  return {
    groqApiKey,
    geminiApiKey,
    ffmpegPath,
  };
}

export function validateApiKeys(config: AppConfig): void {
  const missingKeys: string[] = [];

  if (!config.groqApiKey) {
    missingKeys.push("GROQ_API_KEY (https://console.groq.com/ で取得可能)");
  }
  if (!config.geminiApiKey) {
    missingKeys.push("GEMINI_API_KEY (https://aistudio.google.com/ で取得可能)");
  }

  if (missingKeys.length > 0) {
    throw new Error(
      `必要な API キーが設定されていません:\n- ${missingKeys.join("\n- ")}\n.env ファイルまたは環境変数に設定してください。`,
    );
  }
}
