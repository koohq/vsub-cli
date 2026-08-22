import readline from "node:readline/promises";
import { GoogleGenAI } from "@google/genai";
import { execa } from "execa";
import Groq from "groq-sdk";
import pc from "picocolors";
import {
  type AppConfig,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_GROQ_MODEL,
  getConfig,
  getGlobalConfigPath,
  saveGlobalConfig,
} from "./config.js";

/**
 * Masks an API key for safe terminal display (e.g. "gsk_...3a4b" or "AIza...9z1x").
 */
export function maskApiKey(key?: string): string {
  if (!key) return "";
  const trimmed = key.trim();
  if (trimmed.length === 0) return "";
  if (trimmed.length <= 8) return "****";
  if (trimmed.startsWith("gsk_")) {
    return `gsk_...${trimmed.slice(-4)}`;
  }
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
}

/**
 * Verifies connectivity to Groq API using the provided API key.
 */
export async function verifyGroqApiKey(
  apiKey: string,
): Promise<{ success: boolean; modelCount?: number; error?: string }> {
  if (!apiKey?.trim()) {
    return { success: false, error: "APIキーが指定されていません" };
  }
  try {
    const groq = new Groq({ apiKey: apiKey.trim() });
    const models = await groq.models.list();
    return { success: true, modelCount: models.data.length };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, error: msg };
  }
}

/**
 * Verifies connectivity to Google Gemini API using the provided API key.
 */
export async function verifyGeminiApiKey(
  apiKey: string,
  model = DEFAULT_GEMINI_MODEL,
): Promise<{ success: boolean; error?: string }> {
  if (!apiKey?.trim()) {
    return { success: false, error: "APIキーが指定されていません" };
  }
  try {
    const ai = new GoogleGenAI({ apiKey: apiKey.trim() });
    await ai.models.get({ model });
    return { success: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, error: msg };
  }
}

/**
 * Verifies availability and executable status of FFmpeg.
 */
export async function verifyFfmpeg(
  ffmpegPath = "ffmpeg",
): Promise<{ success: boolean; version?: string; error?: string }> {
  try {
    const { stdout } = await execa(ffmpegPath, ["-version"]);
    const firstLine = stdout.split("\n")[0]?.trim() || "ffmpeg";
    return { success: true, version: firstLine };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, error: msg };
  }
}

export interface InitWizardOptions {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  ask?: (questionText: string) => Promise<string>;
  groqVerifier?: (
    key: string,
  ) => Promise<{ success: boolean; modelCount?: number; error?: string }>;
  geminiVerifier?: (key: string, model?: string) => Promise<{ success: boolean; error?: string }>;
  ffmpegVerifier?: (
    path?: string,
  ) => Promise<{ success: boolean; version?: string; error?: string }>;
}

/**
 * Runs the interactive vsub setup and verification wizard.
 */
export async function runInitWizard(options: InitWizardOptions = {}): Promise<void> {
  const input = options.input || process.stdin;
  const output = options.output || process.stdout;
  const groqVerifier = options.groqVerifier || verifyGroqApiKey;
  const geminiVerifier = options.geminiVerifier || verifyGeminiApiKey;
  const ffmpegVerifier = options.ffmpegVerifier || verifyFfmpeg;

  const currentConfig = getConfig();
  const configPath = getGlobalConfigPath();

  const out = (text = "") => output.write(`${text}\n`);

  out("");
  out(pc.bold(pc.cyan("╔════════════════════════════════════════════════════════════════╗")));
  out(pc.bold(pc.cyan("║           🎬 vsub-cli 初期セットアップ & 導通確認ウィザード          ║")));
  out(pc.bold(pc.cyan("╚════════════════════════════════════════════════════════════════╝")));
  out("");
  out(`設定ファイルの保存先: ${pc.yellow(configPath)}`);
  out("このウィザードでは API キー・FFmpeg の導通確認と初期設定を行います。");
  out("各項目で Enter キーを押すと、角括弧内の値または現在の設定を維持します。");
  out("");

  const rl = options.ask ? null : readline.createInterface({ input, output });
  const ask = options.ask || ((q: string) => rl?.question(q) ?? Promise.resolve(""));

  const updatedConfig: Partial<AppConfig> = {};

  try {
    // ---------------------------------------------------------
    // Step 1: Groq API Key
    // ---------------------------------------------------------
    out(pc.bold(pc.green("▶ [1/4] Groq API キーの設定 (音声文字起こし用)")));
    out(`  API キー取得先: ${pc.cyan("https://console.groq.com/keys")}`);

    let groqKey = currentConfig.groqApiKey;
    if (groqKey) {
      out(`  現在の設定: ${pc.yellow(maskApiKey(groqKey))}`);
    }

    while (true) {
      const promptText = groqKey
        ? "  Groq API Key を入力 (Enter で現在の設定を維持): "
        : "  Groq API Key を入力 (Enter でスキップ): ";
      const answer = (await ask(promptText)).trim();
      const candidateKey = answer || groqKey;

      if (!candidateKey) {
        out(pc.yellow("  ⚠️  Groq API キーをスキップしました (後から設定可能です)。\n"));
        break;
      }

      output.write("  ⏳ Groq API 接続テスト中...");
      const result = await groqVerifier(candidateKey);
      if (result.success) {
        output.write(`\r${" ".repeat(40)}\r`);
        out(
          pc.green(`  ✔ Groq API 接続成功 (${result.modelCount ?? "複数"} 個のモデルを確認可能)`),
        );
        updatedConfig.groqApiKey = candidateKey;
        groqKey = candidateKey;
        out("");
        break;
      } else {
        output.write(`\r${" ".repeat(40)}\r`);
        out(pc.red(`  ✖ Groq API 接続失敗: ${result.error}`));
        const retry = (await ask("  再入力しますか？ [Y/n/s (s=このまま保存)]: "))
          .trim()
          .toLowerCase();
        if (retry === "s") {
          updatedConfig.groqApiKey = candidateKey;
          out(pc.yellow("  ⚠️  未検証のままキーを設定対象に含めました。\n"));
          break;
        }
        if (retry === "n") {
          out(pc.yellow("  ⚠️  Groq API キーの設定をスキップしました。\n"));
          break;
        }
      }
    }

    // ---------------------------------------------------------
    // Step 2: Gemini API Key
    // ---------------------------------------------------------
    out(pc.bold(pc.green("▶ [2/4] Google Gemini API キーの設定 (字幕翻訳用)")));
    out(`  API キー取得先: ${pc.cyan("https://aistudio.google.com/apikey")}`);

    let geminiKey = currentConfig.geminiApiKey;
    if (geminiKey) {
      out(`  現在の設定: ${pc.yellow(maskApiKey(geminiKey))}`);
    }

    while (true) {
      const promptText = geminiKey
        ? "  Gemini API Key を入力 (Enter で現在の設定を維持): "
        : "  Gemini API Key を入力 (Enter でスキップ): ";
      const answer = (await ask(promptText)).trim();
      const candidateKey = answer || geminiKey;

      if (!candidateKey) {
        out(pc.yellow("  ⚠️  Gemini API キーをスキップしました (後から設定可能です)。\n"));
        break;
      }

      output.write("  ⏳ Gemini API 接続テスト中...");
      const result = await geminiVerifier(candidateKey, currentConfig.geminiModel);
      if (result.success) {
        output.write(`\r${" ".repeat(40)}\r`);
        out(pc.green("  ✔ Gemini API 接続成功 (モデル疎通確認完了)"));
        updatedConfig.geminiApiKey = candidateKey;
        geminiKey = candidateKey;
        out("");
        break;
      } else {
        output.write(`\r${" ".repeat(40)}\r`);
        out(pc.red(`  ✖ Gemini API 接続失敗: ${result.error}`));
        const retry = (await ask("  再入力しますか？ [Y/n/s (s=このまま保存)]: "))
          .trim()
          .toLowerCase();
        if (retry === "s") {
          updatedConfig.geminiApiKey = candidateKey;
          out(pc.yellow("  ⚠️  未検証のままキーを設定対象に含めました。\n"));
          break;
        }
        if (retry === "n") {
          out(pc.yellow("  ⚠️  Gemini API キーの設定をスキップしました。\n"));
          break;
        }
      }
    }

    // ---------------------------------------------------------
    // Step 3: FFmpeg / FFprobe Environment Check
    // ---------------------------------------------------------
    out(pc.bold(pc.green("▶ [3/4] FFmpeg / FFprobe 動作環境確認 (音声抽出・動画処理用)")));
    const ffmpegPath = currentConfig.ffmpegPath || "ffmpeg";
    output.write(`  ⏳ FFmpeg 検出テスト中 (${ffmpegPath})...`);
    const ffmpegResult = await ffmpegVerifier(ffmpegPath);

    if (ffmpegResult.success) {
      output.write(`\r${" ".repeat(40)}\r`);
      out(pc.green(`  ✔ FFmpeg 検出成功: ${ffmpegResult.version}`));
      updatedConfig.ffmpegPath = ffmpegPath;
      out("");
    } else {
      output.write(`\r${" ".repeat(40)}\r`);
      out(pc.red(`  ✖ FFmpeg が見つかりませんでした (指定パス: "${ffmpegPath}")`));
      out("  ※ FFmpeg のインストールコマンド例:");
      out(
        `     Windows : ${pc.cyan("winget install Gyan.FFmpeg")} または ${pc.cyan("choco install ffmpeg")}`,
      );
      out(`     macOS   : ${pc.cyan("brew install ffmpeg")}`);
      out(`     Linux   : ${pc.cyan("sudo apt install ffmpeg")}`);

      const customPath = (
        await ask("  カスタム FFmpeg 実行パスを入力 (Enter でスキップ): ")
      ).trim();
      if (customPath) {
        const recheck = await ffmpegVerifier(customPath);
        if (recheck.success) {
          out(pc.green(`  ✔ FFmpeg 検出成功: ${recheck.version}`));
          updatedConfig.ffmpegPath = customPath;
        } else {
          out(pc.yellow(`  ⚠️  指定されたパスでも検出できませんでした (${recheck.error})。`));
          updatedConfig.ffmpegPath = customPath;
        }
      }
      out("");
    }

    // ---------------------------------------------------------
    // Step 4: Default Preferences (Target Language & Models)
    // ---------------------------------------------------------
    out(pc.bold(pc.green("▶ [4/4] デフォルト動作設定")));

    const currentLang = currentConfig.targetLang || "ja";
    const langAnswer = (await ask(`  デフォルト翻訳言語 [${currentLang}]: `)).trim();
    updatedConfig.targetLang = langAnswer || currentLang;

    const currentGeminiModel = currentConfig.geminiModel || DEFAULT_GEMINI_MODEL;
    const geminiModelAnswer = (
      await ask(`  デフォルト Gemini モデル [${currentGeminiModel}]: `)
    ).trim();
    updatedConfig.geminiModel = geminiModelAnswer || currentGeminiModel;

    const currentGroqModel = currentConfig.groqModel || DEFAULT_GROQ_MODEL;
    const groqModelAnswer = (
      await ask(`  デフォルト Groq Whisper モデル [${currentGroqModel}]: `)
    ).trim();
    updatedConfig.groqModel = groqModelAnswer || currentGroqModel;

    out("");

    // ---------------------------------------------------------
    // Save Configuration
    // ---------------------------------------------------------
    saveGlobalConfig(updatedConfig);

    out(pc.bold(pc.green("🎉 初期セットアップが正常に完了しました！")));
    out(`設定を保存しました: ${pc.yellow(configPath)}`);
    out("");
    out(pc.bold("🚀 クイックスタート例:"));
    out(`   ${pc.cyan("vsub video.mp4")}                 # 動画の文字起こしと日本語字幕生成`);
    out(`   ${pc.cyan("vsub video.mp4 -t en,ja")}          # 英語・日本語の複数言語一括字幕`);
    out(`   ${pc.cyan("vsub video.mp4 --bilingual")}       # 原語と訳語の2言語併記字幕`);
    out(`   ${pc.cyan("vsub video.mp4 --burn")}            # 字幕を動画に直接焼き込み`);
    out(`   ${pc.cyan("vsub batch ./videos")}              # フォルダ内のメディアを一括自動処理`);
    out(`   ${pc.cyan("vsub --help")}                      # すべてのオプション一覧を表示`);
    out("");
  } finally {
    if (rl) {
      rl.close();
    }
  }
}
