import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getConfig,
  getGlobalConfigPath,
  parsePositiveInteger,
  resolveReflowLimits,
  validateApiKeys,
} from "./config.js";

// Mock fs for config file operations
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: vi.fn(),
      readFileSync: vi.fn(),
      writeFileSync: vi.fn(),
      mkdirSync: vi.fn(),
    },
  };
});

describe("config.ts", () => {
  describe("positive integer helpers", () => {
    it.each([
      { value: "12.7", expected: 12 },
      { value: "0.5", expected: 0 },
      { value: " 5 ", expected: 5 },
      { value: "1e2", expected: 100 },
      { value: "", expected: undefined },
      { value: "0", expected: undefined },
      { value: "abc", expected: undefined },
      { value: "-1", expected: undefined },
      { value: undefined, expected: undefined },
      { value: 12.7, expected: 12 },
      { value: 0.5, expected: 0 },
      { value: 0, expected: undefined },
      { value: -1, expected: undefined },
      { value: Number.NaN, expected: undefined },
      { value: Number.POSITIVE_INFINITY, expected: Number.POSITIVE_INFINITY },
    ])("parses $value as $expected", ({ value, expected }) => {
      expect(parsePositiveInteger(value)).toBe(expected);
      expect(resolveReflowLimits({ maxLength: value, maxDuration: value }, 42)).toEqual({
        maxLength: expected ?? 42,
        maxDuration: expected,
      });
    });

    it("keeps omitted limits undefined when no maximum length is configured", () => {
      expect(resolveReflowLimits({}, undefined)).toEqual({
        maxLength: undefined,
        maxDuration: undefined,
      });
    });

    it("resolves length and duration independently", () => {
      expect(resolveReflowLimits({ maxLength: "abc", maxDuration: "12.7" }, 42)).toEqual({
        maxLength: 42,
        maxDuration: 12,
      });
      expect(resolveReflowLimits({ maxLength: "12.7", maxDuration: "abc" }, 42)).toEqual({
        maxLength: 12,
        maxDuration: undefined,
      });
    });
  });

  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.existsSync).mockReturnValue(false);
    process.env = { ...originalEnv };
    // Clear relevant env vars
    delete process.env["VSUB_GROQ_API_KEY"];
    delete process.env["GROQ_API_KEY"];
    delete process.env["VSUB_GEMINI_API_KEY"];
    delete process.env["GEMINI_API_KEY"];
    delete process.env["VSUB_OPENROUTER_API_KEY"];
    delete process.env["OPENROUTER_API_KEY"];
    delete process.env["VSUB_STT_PROVIDER"];
    delete process.env["VSUB_OPENROUTER_STT_MODEL"];
    delete process.env["VSUB_FFMPEG_PATH"];
    delete process.env["FFMPEG_PATH"];
    delete process.env["VSUB_WHISPER_PROMPT"];
    delete process.env["WHISPER_PROMPT"];
    delete process.env["VSUB_PROMPT"];
    delete process.env["VSUB_GEMINI_PROMPT"];
    delete process.env["GEMINI_PROMPT"];
    delete process.env["VSUB_GLOSSARY"];
    delete process.env["GLOSSARY"];
    delete process.env["VSUB_CONCURRENCY"];
    delete process.env["VSUB_BURN_POSITION"];
    delete process.env["VSUB_BURN_FONT_SIZE"];
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("getGlobalConfigPath", () => {
    it("should return AppData path on Windows when APPDATA is set", () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", { value: "win32" });
      process.env["APPDATA"] = "C:\\Users\\test\\AppData\\Roaming";

      const configPath = getGlobalConfigPath();
      expect(configPath).toBe(
        path.join("C:\\Users\\test\\AppData\\Roaming", "vsub", "config.json"),
      );

      Object.defineProperty(process, "platform", { value: originalPlatform });
    });

    it("should return XDG_CONFIG_HOME path on posix systems when set", () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", { value: "linux" });
      process.env["XDG_CONFIG_HOME"] = "/home/test/.custom_config";

      const configPath = getGlobalConfigPath();
      expect(configPath).toBe(path.join("/home/test/.custom_config", "vsub", "config.json"));

      Object.defineProperty(process, "platform", { value: originalPlatform });
    });

    it("should fallback to homedir/.config on posix systems", () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", { value: "darwin" });
      delete process.env["XDG_CONFIG_HOME"];

      const configPath = getGlobalConfigPath();
      expect(configPath).toBe(path.join(os.homedir(), ".config", "vsub", "config.json"));

      Object.defineProperty(process, "platform", { value: originalPlatform });
    });
  });

  describe("getConfig precedence", () => {
    it("should prioritize CLI options over environment variables", () => {
      process.env["VSUB_FFMPEG_PATH"] = "/env/vsub/ffmpeg";
      process.env["FFMPEG_PATH"] = "/env/ffmpeg";

      const config = getConfig("/cli/path/ffmpeg");
      expect(config.ffmpegPath).toBe("/cli/path/ffmpeg");
    });

    it("should prioritize VSUB_ prefixed environment variables over standard ones", () => {
      process.env["VSUB_GROQ_API_KEY"] = "vsub-groq-key";
      process.env["GROQ_API_KEY"] = "standard-groq-key";

      process.env["VSUB_GEMINI_API_KEY"] = "vsub-gemini-key";
      process.env["GEMINI_API_KEY"] = "standard-gemini-key";

      process.env["VSUB_FFMPEG_PATH"] = "/vsub/ffmpeg";
      process.env["FFMPEG_PATH"] = "/standard/ffmpeg";

      const config = getConfig();
      expect(config.groqApiKey).toBe("vsub-groq-key");
      expect(config.geminiApiKey).toBe("vsub-gemini-key");
      expect(config.ffmpegPath).toBe("/vsub/ffmpeg");
    });

    it("should fallback to standard environment variables when VSUB_ prefix is absent", () => {
      process.env["GROQ_API_KEY"] = "standard-groq-key";
      process.env["GEMINI_API_KEY"] = "standard-gemini-key";
      process.env["FFMPEG_PATH"] = "/standard/ffmpeg";

      const config = getConfig();
      expect(config.groqApiKey).toBe("standard-groq-key");
      expect(config.geminiApiKey).toBe("standard-gemini-key");
      expect(config.ffmpegPath).toBe("/standard/ffmpeg");
    });

    it("should resolve whisperPrompt, prompt, and glossary from environment variables", () => {
      process.env["VSUB_WHISPER_PROMPT"] = "WhisperPromptHint";
      process.env["VSUB_PROMPT"] = "TranslationInstruction";
      process.env["VSUB_GLOSSARY"] = "A=B,C=D";

      const config = getConfig();
      expect(config.whisperPrompt).toBe("WhisperPromptHint");
      expect(config.prompt).toBe("TranslationInstruction");
      expect(config.glossary).toBe("A=B,C=D");
    });

    it("should resolve concurrency from VSUB_CONCURRENCY environment variable", () => {
      process.env["VSUB_CONCURRENCY"] = "5";

      const config = getConfig();
      expect(config.concurrency).toBe(5);
    });

    it("should ignore invalid concurrency values", () => {
      process.env["VSUB_CONCURRENCY"] = "invalid";

      const config = getConfig();
      expect(config.concurrency).toBeUndefined();
    });

    it("should resolve geminiModel and groqModel from environment variables", () => {
      process.env["VSUB_GEMINI_MODEL"] = "gemini-2.5-flash";
      process.env["VSUB_GROQ_MODEL"] = "whisper-large-v3";

      const config = getConfig();
      expect(config.geminiModel).toBe("gemini-2.5-flash");
      expect(config.groqModel).toBe("whisper-large-v3");
    });

    it("should fallback to standard model environment variables", () => {
      process.env["GEMINI_MODEL"] = "gemini-custom";
      process.env["GROQ_MODEL"] = "groq-custom";

      const config = getConfig();
      expect(config.geminiModel).toBe("gemini-custom");
      expect(config.groqModel).toBe("groq-custom");
    });

    it("should read new STT and OpenRouter settings, prioritizing environment variables over config file", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({
          openrouterApiKey: "file-openrouter-key",
          sttProvider: "file-stt-provider",
          openrouterSttModel: "file-openrouter-model",
        }),
      );

      // Environment variables set
      process.env["VSUB_OPENROUTER_API_KEY"] = "env-openrouter-key";
      process.env["VSUB_STT_PROVIDER"] = "openrouter";
      process.env["VSUB_OPENROUTER_STT_MODEL"] = "env-openrouter-model";
      process.env["OPENROUTER_API_KEY"] = "generic-openrouter-key";

      let config = getConfig();
      expect(config.openrouterApiKey).toBe("env-openrouter-key");
      expect(config.openrouterApiKeyFallback).toBe("generic-openrouter-key");
      expect(config.sttProvider).toBe("openrouter");
      expect(config.openrouterSttModel).toBe("env-openrouter-model");

      // Without environment variables, falls back to config file (except openrouterApiKeyFallback)
      delete process.env["VSUB_OPENROUTER_API_KEY"];
      delete process.env["VSUB_STT_PROVIDER"];
      delete process.env["VSUB_OPENROUTER_STT_MODEL"];
      delete process.env["OPENROUTER_API_KEY"];

      config = getConfig();
      expect(config.openrouterApiKey).toBe("file-openrouter-key");
      expect(config.openrouterApiKeyFallback).toBeUndefined();
      expect(config.sttProvider).toBe("file-stt-provider");
      expect(config.openrouterSttModel).toBe("file-openrouter-model");
    });

    it("should place generic OPENROUTER_API_KEY only into openrouterApiKeyFallback, not into openrouterApiKey", () => {
      process.env["OPENROUTER_API_KEY"] = "generic-only-key";
      const config = getConfig();
      expect(config.openrouterApiKeyFallback).toBe("generic-only-key");
      expect(config.openrouterApiKey).toBeUndefined();
    });

    it("should not throw on invalid/corrupted VSUB_STT_PROVIDER value in getConfig", () => {
      process.env["VSUB_STT_PROVIDER"] = "corrupted-provider-value";
      expect(() => getConfig()).not.toThrow();
      const config = getConfig();
      expect(config.sttProvider).toBe("corrupted-provider-value");
    });

    it("should read new LLM settings (llmProvider, openrouterLlmModel), prioritizing environment variables over config file", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({
          llmProvider: "file-llm-provider",
          openrouterLlmModel: "file-openrouter-llm-model",
        }),
      );

      process.env["VSUB_LLM_PROVIDER"] = "openrouter";
      process.env["VSUB_OPENROUTER_LLM_MODEL"] = "env-openrouter-llm-model";

      let config = getConfig();
      expect(config.llmProvider).toBe("openrouter");
      expect(config.openrouterLlmModel).toBe("env-openrouter-llm-model");

      delete process.env["VSUB_LLM_PROVIDER"];
      delete process.env["VSUB_OPENROUTER_LLM_MODEL"];

      config = getConfig();
      expect(config.llmProvider).toBe("file-llm-provider");
      expect(config.openrouterLlmModel).toBe("file-openrouter-llm-model");
    });

    it("should not throw on invalid/corrupted VSUB_LLM_PROVIDER value in getConfig", () => {
      process.env["VSUB_LLM_PROVIDER"] = "corrupted-llm-provider";
      expect(() => getConfig()).not.toThrow();
      const config = getConfig();
      expect(config.llmProvider).toBe("corrupted-llm-provider");
    });

    it("should fallback to default values when nothing is configured", () => {
      const config = getConfig();
      expect(config.groqApiKey).toBe("");
      expect(config.geminiApiKey).toBe("");
      expect(config.ffmpegPath).toBe("ffmpeg");
      expect(config.whisperPrompt).toBeUndefined();
      expect(config.prompt).toBeUndefined();
      expect(config.glossary).toBeUndefined();
      expect(config.concurrency).toBeUndefined();
      expect(config.geminiModel).toBe("gemini-3.8-flash");
      expect(config.groqModel).toBe("whisper-large-v3-turbo");
    });
  });

  describe("validateApiKeys", () => {
    it.each([undefined, "en", "ja"] as const)("pins missing key guidance for %s", (lang) => {
      const hints =
        lang === "ja"
          ? [
              "VSUB_OPENROUTER_API_KEY（取得先: https://openrouter.ai/keys。汎用の OPENROUTER_API_KEY は、--stt-provider openrouter・--llm-provider openrouter・VSUB_STT_PROVIDER=openrouter・VSUB_LLM_PROVIDER=openrouter のときだけ読みます。翻訳には Gemini のキー VSUB_GEMINI_API_KEY / GEMINI_API_KEY も使えます）",
              "VSUB_GROQ_API_KEY / GROQ_API_KEY（取得先: https://console.groq.com/）",
              "VSUB_GEMINI_API_KEY / GEMINI_API_KEY（取得先: https://aistudio.google.com/）",
            ]
          : [
              "VSUB_OPENROUTER_API_KEY (Get at: https://openrouter.ai/keys; the generic OPENROUTER_API_KEY is read only with --stt-provider openrouter, --llm-provider openrouter, VSUB_STT_PROVIDER=openrouter, or VSUB_LLM_PROVIDER=openrouter; Gemini keys VSUB_GEMINI_API_KEY / GEMINI_API_KEY can also be used for translation)",
              "VSUB_GROQ_API_KEY / GROQ_API_KEY (Get at: https://console.groq.com/)",
              "VSUB_GEMINI_API_KEY / GEMINI_API_KEY (Get at: https://aistudio.google.com/)",
            ];
      const header =
        lang === "ja"
          ? "必要な API キーが設定されていません:"
          : "Required API key(s) are not configured:";
      const footer =
        lang === "ja"
          ? "対話形式の入力、.env ファイル、環境変数のいずれかで設定してください。"
          : "Please set them via interactive prompt, .env file, or environment variables.";
      expect(() =>
        validateApiKeys(
          { ffmpegPath: "ffmpeg", groqApiKey: "", geminiApiKey: "" },
          { requireOpenRouter: true, lang },
        ),
      ).toThrow(new Error(`${header}\n- ${hints.join("\n- ")}\n${footer}`));
    });

    it("should not throw error when all required keys are present", () => {
      expect(() => {
        validateApiKeys({
          groqApiKey: "g-key",
          geminiApiKey: "gem-key",
          ffmpegPath: "ffmpeg",
        });
      }).not.toThrow();
    });

    it("should throw error if Groq API key is missing", () => {
      expect(() => {
        validateApiKeys({
          groqApiKey: "",
          geminiApiKey: "gem-key",
          ffmpegPath: "ffmpeg",
        });
      }).toThrow(/VSUB_GROQ_API_KEY \/ GROQ_API_KEY/);
    });

    it("should throw error if Gemini API key is missing when requireGemini is true", () => {
      expect(() => {
        validateApiKeys(
          {
            groqApiKey: "g-key",
            geminiApiKey: "",
            ffmpegPath: "ffmpeg",
          },
          { requireGemini: true },
        );
      }).toThrow(/VSUB_GEMINI_API_KEY \/ GEMINI_API_KEY/);
    });

    it("should not throw error if Gemini API key is missing when requireGemini is false", () => {
      expect(() => {
        validateApiKeys(
          {
            groqApiKey: "g-key",
            geminiApiKey: "",
            ffmpegPath: "ffmpeg",
          },
          { requireGemini: false },
        );
      }).not.toThrow();
    });

    it("should not throw error if Groq API key is missing when requireGroq is false", () => {
      expect(() => {
        validateApiKeys(
          {
            groqApiKey: "",
            geminiApiKey: "gem-key",
            ffmpegPath: "ffmpeg",
          },
          { requireGroq: false, requireGemini: true },
        );
      }).not.toThrow();
    });

    it("should throw error if Gemini API key is missing when requireGroq is false and requireGemini is true", () => {
      expect(() => {
        validateApiKeys(
          {
            groqApiKey: "",
            geminiApiKey: "",
            ffmpegPath: "ffmpeg",
          },
          { requireGroq: false, requireGemini: true },
        );
      }).toThrow(/VSUB_GEMINI_API_KEY \/ GEMINI_API_KEY/);
    });

    it("should throw error containing VSUB_OPENROUTER_API_KEY if OpenRouter key is missing when requireOpenRouter is true", () => {
      expect(() => {
        validateApiKeys(
          {
            groqApiKey: "g-key",
            geminiApiKey: "gem-key",
            ffmpegPath: "ffmpeg",
            openrouterApiKey: "",
          },
          { requireOpenRouter: true },
        );
      }).toThrow(/VSUB_OPENROUTER_API_KEY/);
    });

    it("should include guidance for --llm-provider, VSUB_LLM_PROVIDER, and Gemini keys in OpenRouter missing error", () => {
      expect(() => {
        validateApiKeys(
          {
            groqApiKey: "g-key",
            geminiApiKey: "gem-key",
            ffmpegPath: "ffmpeg",
            openrouterApiKey: "",
          },
          { requireOpenRouter: true },
        );
      }).toThrow(/--llm-provider openrouter.*VSUB_LLM_PROVIDER=openrouter.*Gemini keys/s);
    });

    it("should not throw error if OpenRouter key is present when requireOpenRouter is true", () => {
      expect(() => {
        validateApiKeys(
          {
            groqApiKey: "g-key",
            geminiApiKey: "gem-key",
            ffmpegPath: "ffmpeg",
            openrouterApiKey: "openrouter-test-key",
          },
          { requireOpenRouter: true },
        );
      }).not.toThrow();
    });

    it("should not validate OpenRouter key by default when requireOpenRouter is omitted", () => {
      expect(() => {
        validateApiKeys({
          groqApiKey: "g-key",
          geminiApiKey: "gem-key",
          ffmpegPath: "ffmpeg",
          openrouterApiKey: "",
        });
      }).not.toThrow();
    });
  });

  describe("getConfig with lang", () => {
    it("should default lang to en when not specified", () => {
      const config = getConfig();
      expect(config.lang).toBe("en");
    });

    it("should prioritize CLI lang argument", () => {
      process.env["VSUB_LANG"] = "en";
      const config = getConfig(undefined, "ja");
      expect(config.lang).toBe("ja");
    });

    it("should use VSUB_LANG environment variable when CLI lang is not specified", () => {
      process.env["VSUB_LANG"] = "ja";
      const config = getConfig();
      expect(config.lang).toBe("ja");
    });
  });

  describe("disableUpdateCheck", () => {
    it("should respect VSUB_DISABLE_UPDATE_CHECK=1", () => {
      process.env["VSUB_DISABLE_UPDATE_CHECK"] = "1";
      const config = getConfig();
      expect(config.disableUpdateCheck).toBe(true);
    });

    it("should respect VSUB_NO_UPDATE_CHECK=true", () => {
      process.env["VSUB_NO_UPDATE_CHECK"] = "true";
      const config = getConfig();
      expect(config.disableUpdateCheck).toBe(true);
    });

    it("should be undefined when not set in env or config", () => {
      const config = getConfig();
      expect(config.disableUpdateCheck).toBeUndefined();
    });
  });

  describe("maxLength", () => {
    it.each(["0", "abc", "-1", ""])(
      "falls back to file maxLength for invalid environment value %s",
      (value) => {
        process.env["VSUB_MAX_LENGTH"] = value;
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ maxLength: 37.9 }));
        expect(getConfig().maxLength).toBe(37);
      },
    );

    it("should parse VSUB_MAX_LENGTH environment variable", () => {
      process.env["VSUB_MAX_LENGTH"] = "50";
      const config = getConfig();
      expect(config.maxLength).toBe(50);
    });

    it("should ignore invalid VSUB_MAX_LENGTH values", () => {
      process.env["VSUB_MAX_LENGTH"] = "not-a-number";
      const config = getConfig();
      expect(config.maxLength).toBeUndefined();
    });

    it("should be undefined when not configured", () => {
      const config = getConfig();
      expect(config.maxLength).toBeUndefined();
    });
  });

  describe("burnPosition and burnFontSize", () => {
    it("should parse VSUB_BURN_POSITION and VSUB_BURN_FONT_SIZE from environment variables", () => {
      process.env["VSUB_BURN_POSITION"] = "top";
      process.env["VSUB_BURN_FONT_SIZE"] = "large";
      const config = getConfig();
      expect(config.burnPosition).toBe("top");
      expect(config.burnFontSize).toBe("large");
    });

    it("should be undefined when not set in env or config", () => {
      const config = getConfig();
      expect(config.burnPosition).toBeUndefined();
      expect(config.burnFontSize).toBeUndefined();
    });
  });
});
