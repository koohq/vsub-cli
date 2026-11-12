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
import { normalizeTargetLangSetting } from "./languages.js";
import { DEFAULT_OPENROUTER_LLM_MODEL } from "./text/openrouter.js";
import { type LlmProvider, parseLlmProvider, resolveLlmSettings } from "./text/select.js";
import { DEFAULT_OPENROUTER_STT_MODEL } from "./transcribe/openrouter.js";
import { parseSttProvider, resolveSttSettings, type SttProvider } from "./transcribe/select.js";
import { displayWidth } from "./ui.js";

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

/**
 * Verifies connectivity to OpenRouter API using the provided API key.
 */
export async function verifyOpenRouterApiKey(
  apiKey: string,
  options?: {
    lang?: SupportedLanguage | string | undefined;
    fetchFn?: typeof fetch | undefined;
  },
): Promise<{ success: boolean; error?: string }> {
  const i18n = getI18n(options?.lang);
  const trimmed = apiKey?.trim();
  if (!trimmed) {
    return { success: false, error: i18n.init.noApiKeyProvided };
  }
  const fetchImpl = options?.fetchFn ?? fetch;
  try {
    const res = await fetchImpl("https://openrouter.ai/api/v1/key", {
      headers: {
        Authorization: `Bearer ${trimmed}`,
      },
    });
    if (res.ok) {
      return { success: true };
    }
    let errorMsg: string | undefined;
    try {
      const data = (await res.json()) as { error?: { message?: string } } | null;
      if (data?.error?.message) {
        errorMsg = data.error.message;
      }
    } catch {
      // not JSON or body parse failed
    }
    return {
      success: false,
      error: errorMsg || `HTTP ${res.status}`,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, error: msg };
  }
}

export interface InitWizardOptions {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  ask?: (questionText: string) => Promise<string>;
  openrouterVerifier?: (key: string) => Promise<{ success: boolean; error?: string }>;
  groqVerifier?: (
    key: string,
  ) => Promise<{ success: boolean; modelCount?: number | undefined; error?: string }>;
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

  const initialLang = options.lang ?? currentConfig.lang ?? "en";
  let effectiveLang = initialLang;
  let i18n = getI18n(effectiveLang);
  const m = () => i18n.init;

  if (!options.ask && (input as NodeJS.ReadableStream & { isTTY?: boolean }).isTTY !== true) {
    throw new Error(m().notInteractive);
  }

  const groqVerifier =
    options.groqVerifier || ((k: string) => verifyGroqApiKey(k, { lang: effectiveLang }));
  const openrouterVerifier =
    options.openrouterVerifier ||
    ((k: string) => verifyOpenRouterApiKey(k, { lang: effectiveLang }));
  const geminiVerifier =
    options.geminiVerifier ||
    ((k: string, mod?: string) => verifyGeminiApiKey(k, mod, { lang: effectiveLang }));
  const ffmpegVerifier = options.ffmpegVerifier || verifyFfmpeg;

  const out = (text = "") => output.write(`${text}\n`);

  out("");
  const BANNER_WIDTH = 64;
  out(pc.bold(pc.cyan(`╔${"═".repeat(BANNER_WIDTH)}╗`)));
  const banner = m().bannerTitle;
  const bannerPad = Math.max(0, Math.floor((BANNER_WIDTH - displayWidth(banner)) / 2));
  const bannerRightPad = Math.max(0, BANNER_WIDTH - displayWidth(banner) - bannerPad);
  out(pc.bold(pc.cyan(`║${" ".repeat(bannerPad)}${banner}${" ".repeat(bannerRightPad)}║`)));
  out(pc.bold(pc.cyan(`╚${"═".repeat(BANNER_WIDTH)}╝`)));
  out("");
  out(`${m().configLocation(pc.yellow(configPath))}`);
  out(m().description1);
  out(m().description2);
  out("");

  const rl = options.ask ? null : readline.createInterface({ input, output });
  const ask = options.ask || ((q: string) => rl?.question(q) ?? Promise.resolve(""));

  const updatedConfig: Partial<AppConfig> = {};

  interface KeyPromptConfig {
    url: string;
    currentKey?: string | undefined;
    fallbackKey?: string | undefined;
    fallbackNotice?: string | undefined;
    promptCurrent: string;
    promptNew: string;
    skippedMessage: string;
    testingMessage: string;
    verify: (
      key: string,
    ) => Promise<{ success: boolean; error?: string; modelCount?: number | undefined }>;
    formatSuccess: (result: { modelCount?: number | undefined }) => string;
    formatFailed: (error: string) => string;
    onSave: (key: string) => void;
  }

  async function promptAndVerifyKey(cfg: KeyPromptConfig): Promise<void> {
    out(m().step1Url(pc.cyan(cfg.url)));

    if (cfg.currentKey) {
      out(m().currentSetting(pc.yellow(maskApiKey(cfg.currentKey))));
    } else if (cfg.fallbackKey && cfg.fallbackNotice) {
      out(cfg.fallbackNotice);
    }

    let activeKey = cfg.currentKey;

    while (true) {
      const promptText = activeKey || cfg.fallbackKey ? cfg.promptCurrent : cfg.promptNew;
      const answer = (await ask(promptText)).trim();

      let candidateKey: string | undefined;
      let isFromFallback = false;

      if (answer) {
        candidateKey = answer;
      } else if (activeKey) {
        candidateKey = activeKey;
      } else if (cfg.fallbackKey) {
        candidateKey = cfg.fallbackKey;
        isFromFallback = true;
      }

      if (!candidateKey) {
        out(pc.yellow(cfg.skippedMessage));
        break;
      }

      output.write(cfg.testingMessage);
      const result = await cfg.verify(candidateKey);
      if (result.success) {
        output.write(`\r${" ".repeat(40)}\r`);
        out(pc.green(cfg.formatSuccess(result)));
        if (!isFromFallback) {
          cfg.onSave(candidateKey);
          activeKey = candidateKey;
        }
        out("");
        break;
      } else {
        output.write(`\r${" ".repeat(40)}\r`);
        out(pc.red(cfg.formatFailed(result.error ?? "")));
        const retry = (await ask(m().retryPrompt)).trim().toLowerCase();
        if (retry === "s") {
          if (!isFromFallback) {
            cfg.onSave(candidateKey);
          }
          out(pc.yellow(isFromFallback ? m().usingEnvKeyUnverified : m().savedUnverified));
          break;
        }
        if (retry === "n") {
          out(pc.yellow(cfg.skippedMessage));
          break;
        }
      }
    }
  }

  try {
    // ---------------------------------------------------------
    // Step 1: Speech Recognition Provider & API Key
    // ---------------------------------------------------------
    out(pc.bold(pc.green(m().step1Title)));

    let defaultProvider: SttProvider;
    try {
      defaultProvider = resolveSttSettings(currentConfig, {}).stt.provider;
    } catch {
      defaultProvider = "openrouter";
    }

    let chosenProvider: SttProvider;
    while (true) {
      const answer = (await ask(m().promptSttProvider(defaultProvider))).trim();
      const raw = answer || defaultProvider;
      try {
        chosenProvider = parseSttProvider(raw, effectiveLang);
        break;
      } catch (err) {
        out(pc.red(`  ✖ ${err instanceof Error ? err.message : String(err)}`));
      }
    }
    updatedConfig.sttProvider = chosenProvider;

    const getOpenRouterKeyConfig = (): KeyPromptConfig => ({
      url: "https://openrouter.ai/keys",
      currentKey: updatedConfig.openrouterApiKey ?? currentConfig.openrouterApiKey,
      fallbackKey: currentConfig.openrouterApiKeyFallback,
      fallbackNotice: m().openrouterEnvNotice,
      promptCurrent: m().promptOpenRouterCurrent,
      promptNew: m().promptOpenRouterNew,
      skippedMessage: m().skippedOpenRouter,
      testingMessage: m().testingOpenRouter,
      verify: async (k) => openrouterVerifier(k),
      formatSuccess: () => m().openrouterSuccess,
      formatFailed: (err) => m().openrouterFailed(err),
      onSave: (k) => {
        updatedConfig.openrouterApiKey = k;
      },
    });

    if (chosenProvider === "groq") {
      await promptAndVerifyKey({
        url: "https://console.groq.com/keys",
        currentKey: currentConfig.groqApiKey,
        promptCurrent: m().promptGroqCurrent,
        promptNew: m().promptGroqNew,
        skippedMessage: m().skippedGroq,
        testingMessage: m().testingGroq,
        verify: (k) => groqVerifier(k),
        formatSuccess: (res) => m().groqSuccess(res.modelCount),
        formatFailed: (err) => m().groqFailed(err),
        onSave: (k) => {
          updatedConfig.groqApiKey = k;
        },
      });
    } else if (chosenProvider === "openai-compatible") {
      out(m().openaiCompatibleSttNotice);
    } else {
      await promptAndVerifyKey(getOpenRouterKeyConfig());
    }

    // ---------------------------------------------------------
    // Step 2: Text Generation Provider & API Key
    // ---------------------------------------------------------
    out(pc.bold(pc.green(m().step2Title)));

    let defaultLlmProvider: LlmProvider;
    try {
      defaultLlmProvider = resolveLlmSettings(currentConfig, {}).llm.provider;
    } catch {
      const { llmProvider: _ignored, ...fallbackConfig } = currentConfig;
      defaultLlmProvider = resolveLlmSettings(fallbackConfig, {}).llm.provider;
    }

    let chosenLlmProvider: LlmProvider;
    while (true) {
      const answer = (await ask(m().promptLlmProvider(defaultLlmProvider))).trim();
      const raw = answer || defaultLlmProvider;
      try {
        chosenLlmProvider = parseLlmProvider(raw, effectiveLang);
        break;
      } catch (err) {
        out(pc.red(`  ✖ ${err instanceof Error ? err.message : String(err)}`));
      }
    }
    updatedConfig.llmProvider = chosenLlmProvider;

    if (chosenLlmProvider === "gemini") {
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
    } else if (chosenLlmProvider === "openai-compatible") {
      out(m().openaiCompatibleLlmNotice);
    } else {
      if (chosenProvider === "openrouter") {
        out(m().usingOpenRouterFromStep1);
        out("");
      } else {
        await promptAndVerifyKey(getOpenRouterKeyConfig());
      }
    }

    // ---------------------------------------------------------
    // Step 3: FFmpeg / FFprobe Environment Check
    // ---------------------------------------------------------
    out(pc.bold(pc.green(m().step3Title)));
    const ffmpegPath = currentConfig.ffmpegPath || "ffmpeg";
    output.write(m().testingFfmpeg(ffmpegPath));
    const ffmpegResult = await ffmpegVerifier(ffmpegPath);

    if (ffmpegResult.success) {
      output.write(`\r${" ".repeat(40)}\r`);
      out(pc.green(m().ffmpegSuccess(ffmpegResult.version || "ffmpeg")));
      updatedConfig.ffmpegPath = ffmpegPath;
      out("");
    } else {
      output.write(`\r${" ".repeat(40)}\r`);
      out(pc.red(m().ffmpegFailed(`"${ffmpegPath}"`)));
      out(m().ffmpegInstallHeader);
      out(
        m().ffmpegInstallWindows(
          pc.cyan("winget install Gyan.FFmpeg"),
          pc.cyan("choco install ffmpeg"),
        ),
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

    const currentDisplayLang = initialLang;
    const displayLangAnswer = (await ask(m().promptDisplayLang(currentDisplayLang)))
      .trim()
      .toLowerCase();
    const resolvedDisplayLang = normalizeLanguage(displayLangAnswer) || currentDisplayLang;
    updatedConfig.lang = resolvedDisplayLang;
    effectiveLang = resolvedDisplayLang;
    i18n = getI18n(resolvedDisplayLang);

    const currentTargetLang = currentConfig.targetLang || "ja";
    while (true) {
      const langAnswer = (await ask(m().promptTargetLang(currentTargetLang))).trim();
      try {
        updatedConfig.targetLang = normalizeTargetLangSetting(
          langAnswer || currentTargetLang,
          effectiveLang,
        );
        break;
      } catch (err) {
        out(pc.red(`  ✖ ${err instanceof Error ? err.message : String(err)}`));
      }
    }

    if (chosenLlmProvider === "gemini") {
      const currentGeminiModel = currentConfig.geminiModel || DEFAULT_GEMINI_MODEL;
      const geminiModelAnswer = (await ask(m().promptGeminiModel(currentGeminiModel))).trim();
      updatedConfig.geminiModel = geminiModelAnswer || currentGeminiModel;
    } else if (chosenLlmProvider === "openrouter") {
      const currentOpenRouterLlmModel =
        currentConfig.openrouterLlmModel || DEFAULT_OPENROUTER_LLM_MODEL;
      const openrouterLlmModelAnswer = (
        await ask(m().promptOpenRouterLlmModel(currentOpenRouterLlmModel))
      ).trim();
      updatedConfig.openrouterLlmModel = openrouterLlmModelAnswer || currentOpenRouterLlmModel;
    }

    if (chosenProvider === "groq") {
      const currentGroqModel = currentConfig.groqModel || DEFAULT_GROQ_MODEL;
      const groqModelAnswer = (await ask(m().promptGroqModel(currentGroqModel))).trim();
      updatedConfig.groqModel = groqModelAnswer || currentGroqModel;
    } else if (chosenProvider === "openrouter") {
      const currentOpenRouterModel =
        currentConfig.openrouterSttModel || DEFAULT_OPENROUTER_STT_MODEL;
      const openrouterModelAnswer = (
        await ask(m().promptOpenRouterModel(currentOpenRouterModel))
      ).trim();
      updatedConfig.openrouterSttModel = openrouterModelAnswer || currentOpenRouterModel;
    }

    out("");

    // ---------------------------------------------------------
    // Save Configuration
    // ---------------------------------------------------------
    try {
      saveGlobalConfig(updatedConfig, { lang: effectiveLang });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${message}\n${m().configNotSaved}`, { cause: error });
    }

    out(pc.bold(pc.green(m().configSaved(configPath))));
    out(pc.bold(m().quickStartTitle));
    out(`   ${pc.cyan("vsub video.mp4")}                 # ${m().quickStartTranscribe}`);
    out(`   ${pc.cyan("vsub video.mp4 -t en,ja")}          # ${m().quickStartMultiLanguage}`);
    out(`   ${pc.cyan("vsub video.mp4 --bilingual")}       # ${m().quickStartBilingual}`);
    out(`   ${pc.cyan("vsub video.mp4 --burn")}            # ${m().quickStartBurn}`);
    out(`   ${pc.cyan("vsub batch ./videos")}              # ${m().quickStartBatch}`);
    out(`   ${pc.cyan("vsub --help")}                      # ${m().quickStartHelp}`);
    out("");
  } finally {
    if (rl) {
      rl.close();
    }
  }
}
