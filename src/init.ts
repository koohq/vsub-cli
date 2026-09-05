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
import { getI18n, normalizeLanguage, type SupportedLanguage } from "./i18n/index.js";

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
  options?: { lang?: SupportedLanguage | string | undefined },
): Promise<{ success: boolean; modelCount?: number; error?: string }> {
  const i18n = getI18n(options?.lang);
  if (!apiKey?.trim()) {
    return { success: false, error: i18n.init.noApiKeyProvided };
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
  options?: { lang?: SupportedLanguage | string | undefined },
): Promise<{ success: boolean; error?: string }> {
  const i18n = getI18n(options?.lang);
  if (!apiKey?.trim()) {
    return { success: false, error: i18n.init.noApiKeyProvided };
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
  lang?: SupportedLanguage | undefined;
}

/**
 * Runs the interactive vsub setup and verification wizard.
 */
export async function runInitWizard(options: InitWizardOptions = {}): Promise<void> {
  const input = options.input || process.stdin;
  const output = options.output || process.stdout;
  const currentConfig = getConfig();
  const configPath = getGlobalConfigPath();

  let effectiveLang = options.lang ?? currentConfig.lang ?? "en";
  let i18n = getI18n(effectiveLang);
  const m = () => i18n.init;

  const groqVerifier =
    options.groqVerifier || ((k: string) => verifyGroqApiKey(k, { lang: effectiveLang }));
  const geminiVerifier =
    options.geminiVerifier ||
    ((k: string, mod?: string) => verifyGeminiApiKey(k, mod, { lang: effectiveLang }));
  const ffmpegVerifier = options.ffmpegVerifier || verifyFfmpeg;

  const out = (text = "") => output.write(`${text}\n`);

  out("");
  out(pc.bold(pc.cyan("╔════════════════════════════════════════════════════════════════╗")));
  const banner = m().bannerTitle;
  const bannerPad = Math.max(0, Math.floor((62 - banner.length) / 2));
  const bannerRightPad = Math.max(0, 62 - banner.length - bannerPad);
  out(pc.bold(pc.cyan(`║${" ".repeat(bannerPad)}${banner}${" ".repeat(bannerRightPad)}║`)));
  out(pc.bold(pc.cyan("╚════════════════════════════════════════════════════════════════╝")));
  out("");
  out(`${m().configLocation(pc.yellow(configPath))}`);
  out(m().description1);
  out(m().description2);
  out("");

  const rl = options.ask ? null : readline.createInterface({ input, output });
  const ask = options.ask || ((q: string) => rl?.question(q) ?? Promise.resolve(""));

  const updatedConfig: Partial<AppConfig> = {};

  try {
    // ---------------------------------------------------------
    // Step 1: Groq API Key
    // ---------------------------------------------------------
    out(pc.bold(pc.green(m().step1Title)));
    out(m().step1Url(pc.cyan("https://console.groq.com/keys")));

    let groqKey = currentConfig.groqApiKey;
    if (groqKey) {
      out(m().currentSetting(pc.yellow(maskApiKey(groqKey))));
    }

    while (true) {
      const promptText = groqKey ? m().promptGroqCurrent : m().promptGroqNew;
      const answer = (await ask(promptText)).trim();
      const candidateKey = answer || groqKey;

      if (!candidateKey) {
        out(pc.yellow(m().skippedGroq));
        break;
      }

      output.write(m().testingGroq);
      const result = await groqVerifier(candidateKey);
      if (result.success) {
        output.write(`\r${" ".repeat(40)}\r`);
        out(pc.green(m().groqSuccess(result.modelCount ?? "multiple")));
        updatedConfig.groqApiKey = candidateKey;
        groqKey = candidateKey;
        out("");
        break;
      } else {
        output.write(`\r${" ".repeat(40)}\r`);
        out(pc.red(m().groqFailed(result.error ?? "")));
        const retry = (await ask(m().retryPrompt)).trim().toLowerCase();
        if (retry === "s") {
          updatedConfig.groqApiKey = candidateKey;
          out(pc.yellow(m().savedUnverified));
          break;
        }
        if (retry === "n") {
          out(pc.yellow(m().skippedGroq));
          break;
        }
      }
    }

    // ---------------------------------------------------------
    // Step 2: Gemini API Key
    // ---------------------------------------------------------
    out(pc.bold(pc.green(m().step2Title)));
    out(m().step2Url(pc.cyan("https://aistudio.google.com/apikey")));

    let geminiKey = currentConfig.geminiApiKey;
    if (geminiKey) {
      out(m().currentSetting(pc.yellow(maskApiKey(geminiKey))));
    }

    while (true) {
      const promptText = geminiKey ? m().promptGeminiCurrent : m().promptGeminiNew;
      const answer = (await ask(promptText)).trim();
      const candidateKey = answer || geminiKey;

      if (!candidateKey) {
        out(pc.yellow(m().skippedGemini));
        break;
      }

      output.write(m().testingGemini);
      const result = await geminiVerifier(candidateKey, currentConfig.geminiModel);
      if (result.success) {
        output.write(`\r${" ".repeat(40)}\r`);
        out(pc.green(m().geminiSuccess(currentConfig.geminiModel || DEFAULT_GEMINI_MODEL)));
        updatedConfig.geminiApiKey = candidateKey;
        geminiKey = candidateKey;
        out("");
        break;
      } else {
        output.write(`\r${" ".repeat(40)}\r`);
        out(pc.red(m().geminiFailed(result.error ?? "")));
        const retry = (await ask(m().retryPrompt)).trim().toLowerCase();
        if (retry === "s") {
          updatedConfig.geminiApiKey = candidateKey;
          out(pc.yellow(m().savedUnverified));
          break;
        }
        if (retry === "n") {
          out(pc.yellow(m().skippedGemini));
          break;
        }
      }
    }

    // ---------------------------------------------------------
    // Step 3: FFmpeg / FFprobe Environment Check
    // ---------------------------------------------------------
    out(pc.bold(pc.green(m().step3Title)));
    const ffmpegPath = currentConfig.ffmpegPath || "ffmpeg";
    output.write(`  ⏳ Checking FFmpeg (${ffmpegPath})...`);
    const ffmpegResult = await ffmpegVerifier(ffmpegPath);

    if (ffmpegResult.success) {
      output.write(`\r${" ".repeat(40)}\r`);
      out(pc.green(m().ffmpegSuccess(ffmpegResult.version || "ffmpeg")));
      updatedConfig.ffmpegPath = ffmpegPath;
      out("");
    } else {
      output.write(`\r${" ".repeat(40)}\r`);
      out(pc.red(m().ffmpegFailed(`"${ffmpegPath}"`)));
      out("  ※ FFmpeg installation commands:");
      out(
        `     Windows : ${pc.cyan("winget install Gyan.FFmpeg")} or ${pc.cyan("choco install ffmpeg")}`,
      );
      out(`     macOS   : ${pc.cyan("brew install ffmpeg")}`);
      out(`     Linux   : ${pc.cyan("sudo apt install ffmpeg")}`);

      const customPath = (await ask(m().promptFfmpegPath)).trim();
      if (customPath) {
        const recheck = await ffmpegVerifier(customPath);
        if (recheck.success) {
          out(pc.green(m().ffmpegSuccess(recheck.version || customPath)));
          updatedConfig.ffmpegPath = customPath;
        } else {
          out(pc.yellow(m().ffmpegFailed(recheck.error ?? customPath)));
          updatedConfig.ffmpegPath = customPath;
        }
      }
      out("");
    }

    // ---------------------------------------------------------
    // Step 4: Default Preferences (Language & Models)
    // ---------------------------------------------------------
    out(pc.bold(pc.green(m().step4Title)));

    const currentDisplayLang = currentConfig.lang || "en";
    const displayLangAnswer = (
      await ask(`  CLI Display Language [${currentDisplayLang}] (en/ja): `)
    )
      .trim()
      .toLowerCase();
    const resolvedDisplayLang = normalizeLanguage(displayLangAnswer) || currentDisplayLang;
    updatedConfig.lang = resolvedDisplayLang;
    effectiveLang = resolvedDisplayLang;
    i18n = getI18n(resolvedDisplayLang);

    const currentTargetLang = currentConfig.targetLang || "ja";
    const langAnswer = (await ask(`  ${m().promptTargetLang}[${currentTargetLang}]: `)).trim();
    updatedConfig.targetLang = langAnswer || currentTargetLang;

    const currentGeminiModel = currentConfig.geminiModel || DEFAULT_GEMINI_MODEL;
    const geminiModelAnswer = (
      await ask(`  Default Gemini Model [${currentGeminiModel}]: `)
    ).trim();
    updatedConfig.geminiModel = geminiModelAnswer || currentGeminiModel;

    const currentGroqModel = currentConfig.groqModel || DEFAULT_GROQ_MODEL;
    const groqModelAnswer = (
      await ask(`  Default Groq Whisper Model [${currentGroqModel}]: `)
    ).trim();
    updatedConfig.groqModel = groqModelAnswer || currentGroqModel;

    out("");

    // ---------------------------------------------------------
    // Save Configuration
    // ---------------------------------------------------------
    saveGlobalConfig(updatedConfig);

    out(pc.bold(pc.green(m().configSaved(configPath))));
    out(pc.bold("🚀 Quick Start:"));
    out(`   ${pc.cyan("vsub video.mp4")}                 # Transcribe & generate subtitles`);
    out(`   ${pc.cyan("vsub video.mp4 -t en,ja")}          # Multi-language subtitle output`);
    out(`   ${pc.cyan("vsub video.mp4 --bilingual")}       # Bilingual subtitles`);
    out(`   ${pc.cyan("vsub video.mp4 --burn")}            # Burn subtitles into video (hardsub)`);
    out(`   ${pc.cyan("vsub batch ./videos")}              # Batch process directory`);
    out(`   ${pc.cyan("vsub --help")}                      # Display all options`);
    out("");
  } finally {
    if (rl) {
      rl.close();
    }
  }
}
