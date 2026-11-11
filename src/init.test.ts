import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { PassThrough } from "node:stream";
import { stripVTControlCharacters } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as configModule from "./config.js";
import { type AppConfig, getGlobalConfigPath } from "./config.js";
import { getI18n, type SupportedLanguage } from "./i18n/index.js";
import {
  maskApiKey,
  runInitWizard,
  verifyFfmpeg,
  verifyGeminiApiKey,
  verifyGroqApiKey,
  verifyOpenRouterApiKey,
} from "./init.js";
import { isolateConfigAndEnv } from "./test-support/isolate-config-env.js";
import { displayWidth } from "./ui.js";

// Mock Groq SDK
vi.mock("groq-sdk", () => {
  return {
    default: class MockGroq {
      apiKey: string;
      constructor({ apiKey }: { apiKey: string }) {
        this.apiKey = apiKey;
      }
      models = {
        list: async () => {
          if (this.apiKey === "invalid-groq-key") {
            throw new Error("Invalid Groq API Key (401 Unauthorized)");
          }
          return {
            data: [{ id: "whisper-large-v3" }, { id: "whisper-large-v3-turbo" }],
          };
        },
      };
    },
  };
});

// Mock @google/genai SDK
vi.mock("@google/genai", () => {
  return {
    GoogleGenAI: class MockGoogleGenAI {
      apiKey: string;
      constructor({ apiKey }: { apiKey: string }) {
        this.apiKey = apiKey;
      }
      models = {
        get: async ({ model }: { model: string }) => {
          if (this.apiKey === "invalid-gemini-key") {
            throw new Error("Invalid Gemini API Key (API_KEY_INVALID)");
          }
          return { name: model };
        },
      };
    },
  };
});

// Mock execa
vi.mock("execa", () => {
  return {
    execa: async (cmd: string, args: string[]) => {
      if (cmd === "invalid-ffmpeg" || cmd === "nonexistent-ffmpeg") {
        throw new Error(`Command not found: ${cmd}`);
      }
      if (args.includes("-version")) {
        return {
          stdout: "ffmpeg version 7.1-full_build Copyright (c) 2000-2024\nconfiguration: ...",
        };
      }
      return { stdout: "" };
    },
  };
});

describe("init.ts", () => {
  describe("maskApiKey", () => {
    it("should return empty string for undefined or empty input", () => {
      expect(maskApiKey(undefined)).toBe("");
      expect(maskApiKey("")).toBe("");
      expect(maskApiKey("   ")).toBe("");
    });

    it("should return **** for keys with length <= 8", () => {
      expect(maskApiKey("1234")).toBe("****");
      expect(maskApiKey("12345678")).toBe("****");
    });

    it("should format gsk_ prefixed keys correctly", () => {
      expect(maskApiKey("gsk_1234567890abcdef")).toBe("gsk_...cdef");
    });

    it("should format standard keys with first 4 and last 4 characters", () => {
      expect(maskApiKey("AIzaSy1234567890abcdef")).toBe("AIza...cdef");
    });
  });

  describe("verifyGroqApiKey", () => {
    it("should return error in English by default when key is empty", async () => {
      const result = await verifyGroqApiKey("");
      expect(result.success).toBe(false);
      expect(result.error).toContain("API key not provided");
    });

    it("should return error in Japanese when lang is ja and key is empty", async () => {
      const result = await verifyGroqApiKey("", { lang: "ja" });
      expect(result.success).toBe(false);
      expect(result.error).toContain("APIキーが指定されていません");
    });

    it("should return success when key is valid", async () => {
      const result = await verifyGroqApiKey("gsk_valid_test_key_12345");
      expect(result.success).toBe(true);
      expect(result.modelCount).toBe(2);
    });

    it("should return failure when API throws error", async () => {
      const result = await verifyGroqApiKey("invalid-groq-key");
      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid Groq API Key");
    });
  });

  describe("verifyGeminiApiKey", () => {
    it("should return error in English by default when key is empty", async () => {
      const result = await verifyGeminiApiKey("");
      expect(result.success).toBe(false);
      expect(result.error).toContain("API key not provided");
    });

    it("should return error in Japanese when lang is ja and key is empty", async () => {
      const result = await verifyGeminiApiKey("", undefined, { lang: "ja" });
      expect(result.success).toBe(false);
      expect(result.error).toContain("APIキーが指定されていません");
    });

    it("should return success when key is valid", async () => {
      const result = await verifyGeminiApiKey("AIzaSyValidKey12345");
      expect(result.success).toBe(true);
    });

    it("should return failure when API throws error", async () => {
      const result = await verifyGeminiApiKey("invalid-gemini-key");
      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid Gemini API Key");
    });
  });

  describe("verifyFfmpeg", () => {
    it("should return success and version string when ffmpeg succeeds", async () => {
      const result = await verifyFfmpeg("ffmpeg");
      expect(result.success).toBe(true);
      expect(result.version).toContain("ffmpeg version 7.1");
    });

    it("should return failure when ffmpeg path is invalid", async () => {
      const result = await verifyFfmpeg("invalid-ffmpeg");
      expect(result.success).toBe(false);
      expect(result.error).toContain("Command not found");
    });
  });

  describe("verifyOpenRouterApiKey", () => {
    it("should return error in English by default when key is empty", async () => {
      const result = await verifyOpenRouterApiKey("");
      expect(result.success).toBe(false);
      expect(result.error).toContain("API key not provided");
    });

    it("should return error in Japanese when lang is ja and key is empty", async () => {
      const result = await verifyOpenRouterApiKey("", { lang: "ja" });
      expect(result.success).toBe(false);
      expect(result.error).toContain("APIキーが指定されていません");
    });

    it("should succeed and call fetch with correct URL and auth header on 200", async () => {
      const dummyKey = "sk-or-v1-valid-test-key-1234";
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: { limit: 100 } }),
      });

      const result = await verifyOpenRouterApiKey(dummyKey, {
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith("https://openrouter.ai/api/v1/key", {
        headers: {
          Authorization: `Bearer ${dummyKey}`,
        },
      });
      expect(result.error).toBeUndefined();
    });

    it("should fail with error.message from response body on 401", async () => {
      const dummyKey = "sk-or-v1-invalid-key-9999";
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({
          error: { message: "Invalid API key provided" },
        }),
      });

      const result = await verifyOpenRouterApiKey(dummyKey, {
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Invalid API key provided");
      expect(result.error).not.toContain(dummyKey);
    });

    it("should fail with HTTP status code when 500 response is not JSON", async () => {
      const dummyKey = "sk-or-v1-server-err-key";
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => {
          throw new Error("Invalid JSON");
        },
      });

      const result = await verifyOpenRouterApiKey(dummyKey, {
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("HTTP 500");
      expect(result.error).not.toContain(dummyKey);
    });

    it("should fail when fetch throws a network exception", async () => {
      const dummyKey = "sk-or-v1-network-error-key";
      const mockFetch = vi.fn().mockRejectedValue(new Error("Network connection lost"));

      const result = await verifyOpenRouterApiKey(dummyKey, {
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Network connection lost");
      expect(result.error).not.toContain(dummyKey);
    });
  });

  describe("runInitWizard", () => {
    let saveSpy: ReturnType<typeof vi.spyOn>;
    let tempDir: string;
    const originalEnv = process.env;

    beforeEach(() => {
      saveSpy = vi.spyOn(configModule, "saveGlobalConfig").mockImplementation(() => {});
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vsub-init-test-"));
      process.env = { ...originalEnv };
      isolateConfigAndEnv(tempDir);
      delete process.env["VSUB_GROQ_API_KEY"];
      delete process.env["VSUB_GEMINI_API_KEY"];
    });

    afterEach(() => {
      process.env = originalEnv;
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
      vi.restoreAllMocks();
    });

    function placeConfig(config: Partial<AppConfig>) {
      const configPath = getGlobalConfigPath();
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");
    }

    function stopAtFirstQuestion() {
      const question = vi.fn().mockRejectedValue(new Error("test input closed"));
      const createInterface = vi.spyOn(readline, "createInterface").mockReturnValue({
        question,
        close: vi.fn(),
      } as unknown as readline.Interface);
      return { question, createInterface };
    }

    it.each([
      { lang: "en", configured: false },
      { lang: "ja", configured: false },
      { lang: "ja", configured: true },
    ] as const)(
      "rejects non-terminal input before output ($lang, configured: $configured)",
      async ({ lang, configured }) => {
        if (configured) placeConfig({ lang });
        const input = new PassThrough();
        const output = new PassThrough();
        const write = vi.spyOn(output, "write");
        const { createInterface } = stopAtFirstQuestion();
        const expected =
          lang === "ja"
            ? "vsub init は対話形式のため、端末から実行してください（標準入力が端末ではありません）。ウィザードを使わずに設定するには、vsub config set（例: vsub config set --openrouter-key <キー>）か、VSUB_OPENROUTER_API_KEY などの環境変数を使ってください。"
            : "vsub init is interactive and must be run from a terminal (standard input is not a terminal). To configure without the wizard, use vsub config set (for example, vsub config set --openrouter-key <key>) or environment variables such as VSUB_OPENROUTER_API_KEY.";
        await expect(
          runInitWizard({ input, output, ...(configured ? {} : { lang }) }),
        ).rejects.toThrow(new Error(expected));
        expect(write).not.toHaveBeenCalled();
        expect(createInterface).not.toHaveBeenCalled();
        expect(saveSpy).not.toHaveBeenCalled();
      },
    );

    it("starts on terminal input even when output is a pipe", async () => {
      const input = Object.assign(new PassThrough(), { isTTY: true });
      const output = new PassThrough();
      let printed = "";
      output.on("data", (chunk) => {
        printed += chunk.toString();
      });
      const { question } = stopAtFirstQuestion();
      await expect(runInitWizard({ input, output, lang: "en" })).rejects.toThrow(
        "test input closed",
      );
      expect(stripVTControlCharacters(printed)).toContain(
        "vsub-cli Initial Setup & Verification Wizard",
      );
      expect(question).toHaveBeenCalledExactlyOnceWith(
        getI18n("en").init.promptSttProvider("openrouter"),
      );
      expect(saveSpy).not.toHaveBeenCalled();
    });

    interface RunWizardOptions {
      lang?: SupportedLanguage | undefined;
      displayLangAnswer?: string;
      targetLangAnswer?: string;
      targetLangAnswers?: string[];
      ffmpegSuccess?: boolean;
      modelCount?: number | undefined;
    }

    async function runWizard(options: RunWizardOptions = {}) {
      const output = new PassThrough();
      let outputData = "";
      output.on("data", (chunk) => {
        outputData += chunk.toString();
      });

      const prompts: string[] = [];
      const answers = [
        "groq",
        "groq-key",
        "gemini",
        "gemini-key",
        ...(options.ffmpegSuccess === false ? [""] : []),
        options.displayLangAnswer ?? "",
        ...(options.targetLangAnswers ?? [options.targetLangAnswer ?? ""]),
        "", // Gemini model
        "", // Groq model
      ];

      const ask = vi.fn().mockImplementation(async (prompt: string) => {
        prompts.push(prompt);
        return answers[prompts.length - 1] ?? "";
      });

      await runInitWizard({
        output,
        ask,
        lang: options.lang,
        groqVerifier: async () => ({ success: true, modelCount: options.modelCount }),
        geminiVerifier: async () => ({ success: true }),
        ffmpegVerifier: async () => ({
          success: options.ffmpegSuccess ?? true,
          version: "ffmpeg version 7.0",
        }),
      });

      const savedConfig: Partial<AppConfig> =
        (saveSpy.mock.calls[0]?.[0] as Partial<AppConfig> | undefined) ?? {};
      return { output: outputData, prompts, savedConfig };
    }

    it("localizes FFmpeg checks, installation instructions, model prompts and quick start", async () => {
      const { output, prompts } = await runWizard({ lang: "ja", ffmpegSuccess: false });
      expect(output).toContain("FFmpeg を確認中 (ffmpeg)...");
      expect(output).toContain("FFmpeg のインストール方法:");
      expect(stripVTControlCharacters(output)).toContain(
        "winget install Gyan.FFmpeg または choco install ffmpeg",
      );
      expect(prompts).toContain("  Gemini のモデル [gemini-3.8-flash]: ");
      expect(prompts).toContain("  Groq の文字起こしモデル [whisper-large-v3-turbo]: ");
      for (const text of [
        "使い方の例:",
        "文字起こしして字幕を作る",
        "複数の言語の字幕を出す",
        "2 言語を併記した字幕",
        "字幕を動画に焼き込む (ハードサブ)",
        "フォルダ内をまとめて処理",
        "すべてのオプションを表示",
      ]) {
        expect(output).toContain(text);
      }
      expect(`${output}\n${prompts.join("\n")}`).not.toMatch(
        /Checking FFmpeg|Quick Start|Default Gemini Model|Default Groq Whisper Model|multiple/,
      );
    });

    it.each(["en", "ja"] as const)(
      "handles missing and numeric Groq model counts in %s",
      async (lang) => {
        const missing = await runWizard({ lang });
        expect(missing.output).toContain(
          lang === "en" ? "  ✔ Groq API connection successful" : "  ✔ Groq API 接続成功",
        );
        expect(missing.output).not.toMatch(
          /multiple|undefined|models available|個のモデルを確認可能/,
        );
        const counted = await runWizard({ lang, modelCount: 5 });
        expect(counted.output).toContain(
          lang === "en" ? "(5 models available)" : "(5 個のモデルを確認可能)",
        );
      },
    );

    it("uses the newly selected language for model prompts and quick start", async () => {
      const { output, prompts } = await runWizard({ lang: "en", displayLangAnswer: "ja" });
      expect(output).toContain("Checking FFmpeg");
      expect(output).toContain("使い方の例:");
      expect(prompts).toContain("  Gemini のモデル [gemini-3.8-flash]: ");
    });

    it.each(["en", "ja"] as const)("aligns all three banner lines in %s", async (lang) => {
      const result = await runWizard({ lang });
      const banner = stripVTControlCharacters(result.output)
        .split("\n")
        .filter((line) => /^[╔║╚]/u.test(line));
      expect(banner).toHaveLength(3);
      expect(banner.map(displayWidth)).toEqual([66, 66, 66]);
    });

    it("should complete wizard with provided inputs and save config in Japanese when lang is ja", async () => {
      const output = new PassThrough();
      let outputData = "";
      output.on("data", (chunk) => {
        outputData += chunk.toString();
      });

      const ask = vi
        .fn()
        .mockResolvedValueOnce("groq")
        .mockResolvedValueOnce("gsk_new_groq_key")
        .mockResolvedValueOnce("gemini")
        .mockResolvedValueOnce("AIza_new_gemini_key")
        .mockResolvedValueOnce("ja") // Display lang
        .mockResolvedValueOnce("ja,en") // Target lang
        .mockResolvedValueOnce("gemini-3.8-flash")
        .mockResolvedValueOnce("whisper-large-v3-turbo");

      await runInitWizard({
        output,
        ask,
        lang: "ja",
        groqVerifier: async () => ({ success: true, modelCount: 5 }),
        geminiVerifier: async () => ({ success: true }),
        ffmpegVerifier: async () => ({
          success: true,
          version: "ffmpeg version 7.0",
        }),
      });

      expect(saveSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          sttProvider: "groq",
          groqApiKey: "gsk_new_groq_key",
          llmProvider: "gemini",
          geminiApiKey: "AIza_new_gemini_key",
          ffmpegPath: "ffmpeg",
          lang: "ja",
          targetLang: "ja,en",
          geminiModel: "gemini-3.8-flash",
          groqModel: "whisper-large-v3-turbo",
        }),
        expect.anything(),
      );

      expect(outputData).toContain("初期セットアップが正常に完了しました");
    });

    it("should complete wizard with English by default", async () => {
      const output = new PassThrough();
      let outputData = "";
      output.on("data", (chunk) => {
        outputData += chunk.toString();
      });

      const ask = vi
        .fn()
        .mockResolvedValueOnce("groq")
        .mockResolvedValueOnce("gsk_new_groq_key")
        .mockResolvedValueOnce("gemini")
        .mockResolvedValueOnce("AIza_new_gemini_key")
        .mockResolvedValueOnce("en") // Display lang
        .mockResolvedValueOnce("en") // Target lang
        .mockResolvedValueOnce("gemini-3.8-flash")
        .mockResolvedValueOnce("whisper-large-v3-turbo");

      await runInitWizard({
        output,
        ask,
        groqVerifier: async () => ({ success: true, modelCount: 5 }),
        geminiVerifier: async () => ({ success: true }),
        ffmpegVerifier: async () => ({
          success: true,
          version: "ffmpeg version 7.0",
        }),
      });

      expect(saveSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          sttProvider: "groq",
          groqApiKey: "gsk_new_groq_key",
          llmProvider: "gemini",
          geminiApiKey: "AIza_new_gemini_key",
          ffmpegPath: "ffmpeg",
          lang: "en",
          targetLang: "en",
          geminiModel: "gemini-3.8-flash",
          groqModel: "whisper-large-v3-turbo",
        }),
        expect.anything(),
      );

      expect(outputData).toContain("Setup completed successfully");
    });

    it("should handle invalid key retry and skip gracefully", async () => {
      const output = new PassThrough();

      let groqCallCount = 0;
      const ask = vi
        .fn()
        .mockResolvedValueOnce("groq")
        .mockResolvedValueOnce("bad-key") // Initial bad key
        .mockResolvedValueOnce("y") // Retry choice -> yes
        .mockResolvedValueOnce("good-key") // Good key
        .mockResolvedValueOnce("gemini")
        .mockResolvedValueOnce("gemini-key") // Gemini key
        .mockResolvedValueOnce("") // Display lang
        .mockResolvedValueOnce("") // Default lang
        .mockResolvedValueOnce("") // Default gemini model
        .mockResolvedValueOnce(""); // Default groq model

      await runInitWizard({
        output,
        ask,
        groqVerifier: async (key) => {
          groqCallCount++;
          if (key === "bad-key") {
            return { success: false, error: "401 Unauthorized" };
          }
          return { success: true, modelCount: 3 };
        },
        geminiVerifier: async () => ({ success: true }),
        ffmpegVerifier: async () => ({
          success: true,
          version: "ffmpeg version 7.0",
        }),
      });

      expect(groqCallCount).toBe(2);
      expect(saveSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          sttProvider: "groq",
          groqApiKey: "good-key",
          geminiApiKey: "gemini-key",
        }),
        expect.anything(),
      );
    });

    it("should handle missing ffmpeg and allow custom path input", async () => {
      const output = new PassThrough();

      const ask = vi
        .fn()
        .mockResolvedValueOnce("groq")
        .mockResolvedValueOnce("groq-key")
        .mockResolvedValueOnce("gemini")
        .mockResolvedValueOnce("gemini-key")
        .mockResolvedValueOnce("custom/bin/ffmpeg") // Custom ffmpeg path
        .mockResolvedValueOnce("") // Display lang
        .mockResolvedValueOnce("")
        .mockResolvedValueOnce("")
        .mockResolvedValueOnce("");

      await runInitWizard({
        output,
        ask,
        groqVerifier: async () => ({ success: true }),
        geminiVerifier: async () => ({ success: true }),
        ffmpegVerifier: async (p) => {
          if (p === "custom/bin/ffmpeg") {
            return { success: true, version: "ffmpeg version 6.1" };
          }
          return { success: false, error: "not found" };
        },
      });

      expect(saveSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          sttProvider: "groq",
          ffmpegPath: "custom/bin/ffmpeg",
        }),
        expect.anything(),
      );
    });

    it.each([
      { lang: "en", notSaved: "The settings you entered in this wizard were not saved." },
      { lang: "ja", notSaved: "このウィザードで入力した内容は保存されていません" },
    ] as const)(
      "should reject without a completion message when saving fails ($lang)",
      async ({ lang, notSaved }) => {
        saveSpy.mockImplementation(() => {
          throw new Error("dummy unreadable config");
        });
        const output = new PassThrough();
        let outputData = "";
        output.on("data", (chunk) => {
          outputData += chunk.toString();
        });
        const ask = vi
          .fn()
          .mockResolvedValueOnce("groq")
          .mockResolvedValueOnce("groq-key")
          .mockResolvedValueOnce("gemini")
          .mockResolvedValueOnce("gemini-key")
          .mockResolvedValueOnce(lang) // Display lang
          .mockResolvedValueOnce("")
          .mockResolvedValueOnce("")
          .mockResolvedValueOnce("");

        const error = await runInitWizard({
          output,
          ask,
          lang,
          groqVerifier: async () => ({ success: true }),
          geminiVerifier: async () => ({ success: true }),
          ffmpegVerifier: async () => ({ success: true, version: "ffmpeg version 7.0" }),
        }).then(
          () => undefined,
          (e: unknown) => e,
        );

        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain("dummy unreadable config");
        expect((error as Error).message).toContain(notSaved);
        expect(outputData).not.toContain("Setup completed successfully");
        expect(outputData).not.toContain("初期セットアップが正常に完了しました");
        expect(outputData).not.toContain("Quick Start");
      },
    );

    it.each([
      {
        lang: "ja" as SupportedLanguage | undefined,
        config: undefined as Partial<AppConfig> | undefined,
        vsubLang: undefined as string | undefined,
        displayLangAnswer: "",
        expectedPromptName: "CLI 表示言語",
        expectedBracket: "[ja]",
        expectedSavedLang: "ja",
        expectedSubsequentLang: "ja",
      },
      {
        lang: "ja" as SupportedLanguage | undefined,
        config: { lang: "en" as SupportedLanguage },
        vsubLang: undefined as string | undefined,
        displayLangAnswer: "",
        expectedPromptName: "CLI 表示言語",
        expectedBracket: "[ja]",
        expectedSavedLang: "ja",
        expectedSubsequentLang: "ja",
      },
      {
        lang: "en" as SupportedLanguage | undefined,
        config: { lang: "ja" as SupportedLanguage },
        vsubLang: undefined as string | undefined,
        displayLangAnswer: "",
        expectedPromptName: "CLI Display Language",
        expectedBracket: "[en]",
        expectedSavedLang: "en",
        expectedSubsequentLang: "en",
      },
      {
        lang: undefined as SupportedLanguage | undefined,
        config: { lang: "ja" as SupportedLanguage },
        vsubLang: undefined as string | undefined,
        displayLangAnswer: "",
        expectedPromptName: "CLI 表示言語",
        expectedBracket: "[ja]",
        expectedSavedLang: "ja",
        expectedSubsequentLang: "ja",
      },
      {
        lang: undefined as SupportedLanguage | undefined,
        config: undefined as Partial<AppConfig> | undefined,
        vsubLang: "ja",
        displayLangAnswer: "",
        expectedPromptName: "CLI 表示言語",
        expectedBracket: "[ja]",
        expectedSavedLang: "ja",
        expectedSubsequentLang: "ja",
      },
      {
        lang: undefined as SupportedLanguage | undefined,
        config: undefined as Partial<AppConfig> | undefined,
        vsubLang: undefined as string | undefined,
        displayLangAnswer: "",
        expectedPromptName: "CLI Display Language",
        expectedBracket: "[en]",
        expectedSavedLang: "en",
        expectedSubsequentLang: "en",
      },
      {
        lang: "ja" as SupportedLanguage | undefined,
        config: undefined as Partial<AppConfig> | undefined,
        vsubLang: undefined as string | undefined,
        displayLangAnswer: "en",
        expectedPromptName: "CLI 表示言語",
        expectedBracket: "[ja]",
        expectedSavedLang: "en",
        expectedSubsequentLang: "en",
      },
    ])(
      "should handle display language default and subsequent language (Table 1: %j)",
      async ({
        lang,
        config,
        vsubLang,
        displayLangAnswer,
        expectedPromptName,
        expectedBracket,
        expectedSavedLang,
        expectedSubsequentLang,
      }) => {
        if (config) {
          placeConfig(config);
        }
        if (vsubLang) {
          process.env["VSUB_LANG"] = vsubLang;
        }

        const { output, prompts, savedConfig } = await runWizard({
          lang,
          displayLangAnswer,
        });

        const displayPrompt = prompts[4] ?? "";
        expect(displayPrompt).toContain(expectedPromptName);
        expect(displayPrompt.match(/\[[^\]]*\]/g)).toEqual([expectedBracket]);
        expect(savedConfig.lang).toBe(expectedSavedLang);

        const targetPrompt = prompts[5] ?? "";
        if (expectedSubsequentLang === "ja") {
          expect(targetPrompt).toContain("デフォルト出力言語");
          expect(output).toContain("初期セットアップが正常に完了しました");
        } else {
          expect(targetPrompt).toContain("Default Target Subtitle Language");
          expect(output).toContain("Setup completed successfully");
        }
      },
    );

    it.each([
      {
        lang: "en" as SupportedLanguage,
        config: undefined as Partial<AppConfig> | undefined,
        expectedPromptName: "Default Target Subtitle Language",
        expectedBracket: "[ja]",
        expectedSavedTargetLang: "ja",
      },
      {
        lang: "ja" as SupportedLanguage,
        config: undefined as Partial<AppConfig> | undefined,
        expectedPromptName: "デフォルト出力言語",
        expectedBracket: "[ja]",
        expectedSavedTargetLang: "ja",
      },
      {
        lang: "en" as SupportedLanguage,
        config: { targetLang: "en,ja" },
        expectedPromptName: "Default Target Subtitle Language",
        expectedBracket: "[en,ja]",
        expectedSavedTargetLang: "en,ja",
      },
      {
        lang: "ja" as SupportedLanguage,
        config: { targetLang: "en,ja" },
        expectedPromptName: "デフォルト出力言語",
        expectedBracket: "[en,ja]",
        expectedSavedTargetLang: "en,ja",
      },
    ])(
      "should format target language prompt with single bracket (Table 2: %j)",
      async ({ lang, config, expectedPromptName, expectedBracket, expectedSavedTargetLang }) => {
        if (config) {
          placeConfig(config);
        }

        const { prompts, savedConfig } = await runWizard({
          lang,
          displayLangAnswer: lang,
          targetLangAnswer: "",
        });

        const targetPrompt = prompts[5] ?? "";
        expect(targetPrompt).toContain(expectedPromptName);
        expect(targetPrompt.match(/\[[^\]]*\]/g)).toEqual([expectedBracket]);
        expect(savedConfig.targetLang).toBe(expectedSavedTargetLang);
      },
    );

    describe("target language validation", () => {
      it.each(["en", "ja"] as const)("retries invalid input in %s", async (lang) => {
        const { output, prompts, savedConfig } = await runWizard({
          lang,
          targetLangAnswers: ["japanese", "EN, ja"],
        });
        const error = getI18n(lang).pipeline.invalidTargetLang("japanese");
        expect(output.split(error)).toHaveLength(2);
        expect(prompts[5]).toBe(getI18n(lang).init.promptTargetLang("ja"));
        expect(prompts[6]).toBe(prompts[5]);
        expect(prompts.filter((prompt) => prompt === prompts[5])).toHaveLength(2);
        expect(savedConfig.targetLang).toBe("en,ja");
      });

      it("retries an invalid saved default when Enter is pressed", async () => {
        placeConfig({ targetLang: "japanese" });
        const { output, prompts, savedConfig } = await runWizard({
          lang: "en",
          targetLangAnswers: ["", "ja"],
        });
        expect(output).toContain(getI18n("en").pipeline.invalidTargetLang("japanese"));
        expect(prompts.filter((prompt) => prompt === prompts[5])).toHaveLength(2);
        expect(savedConfig.targetLang).toBe("ja");
      });

      it("normalizes the saved default when Enter is pressed", async () => {
        placeConfig({ targetLang: "EN, ja ,en" });
        const { savedConfig } = await runWizard();
        expect(savedConfig.targetLang).toBe("en,ja");
      });
    });

    describe("STT provider selection and OpenRouter support in wizard", () => {
      it("defaults to groq when only Groq API key is in config, and saves sttProvider: 'groq' on Enter", async () => {
        placeConfig({ groqApiKey: "gsk_existing_groq_key_1234" });

        const output = new PassThrough();

        const prompts: string[] = [];
        const ask = vi.fn().mockImplementation(async (prompt: string) => {
          prompts.push(prompt);
          return ""; // Enter on all prompts
        });

        await runInitWizard({
          output,
          ask,
          groqVerifier: async () => ({ success: true, modelCount: 3 }),
          geminiVerifier: async () => ({ success: true }),
          ffmpegVerifier: async () => ({ success: true, version: "ffmpeg 7.0" }),
        });

        expect(prompts[0]).toContain("[groq]");
        expect(saveSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            sttProvider: "groq",
          }),
          expect.anything(),
        );
      });

      it("defaults to openrouter when config is empty, verifies OpenRouter and saves openrouterSttModel without prompting for Groq model", async () => {
        const output = new PassThrough();

        const openrouterVerifier = vi.fn().mockResolvedValue({ success: true });
        const groqVerifier = vi.fn().mockResolvedValue({ success: true, modelCount: 5 });

        const prompts: string[] = [];
        const answers = [
          "", // Provider prompt -> enter (defaults to openrouter)
          "sk-or-v1-new-test-key-5678", // OpenRouter key
          "gemini", // LLM provider
          "AIza_gemini_key", // Gemini key
          "en", // Display lang
          "ja", // Target lang
          "gemini-3.8-flash", // Gemini model
          "custom/openrouter-model", // OpenRouter STT model
        ];

        const ask = vi.fn().mockImplementation(async (prompt: string) => {
          prompts.push(prompt);
          return answers[prompts.length - 1] ?? "";
        });

        await runInitWizard({
          output,
          ask,
          openrouterVerifier,
          groqVerifier,
          geminiVerifier: async () => ({ success: true }),
          ffmpegVerifier: async () => ({ success: true, version: "ffmpeg 7.0" }),
        });

        expect(prompts[0]).toContain("[openrouter]");
        expect(openrouterVerifier).toHaveBeenCalledWith("sk-or-v1-new-test-key-5678");
        expect(groqVerifier).not.toHaveBeenCalled();

        expect(saveSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            sttProvider: "openrouter",
            openrouterApiKey: "sk-or-v1-new-test-key-5678",
            openrouterSttModel: "custom/openrouter-model",
          }),
          expect.anything(),
        );
        const saved = saveSpy.mock.calls[0]?.[0] as Partial<AppConfig>;
        expect(saved.groqModel).toBeUndefined();
      });

      it("re-prompts on invalid provider answer (foo) then proceeds with groq", async () => {
        const output = new PassThrough();
        let outputData = "";
        output.on("data", (chunk) => {
          outputData += chunk.toString();
        });

        const prompts: string[] = [];
        const answers = [
          "foo", // Invalid provider
          "groq", // Valid provider
          "gsk_test_key", // Groq key
          "gemini", // LLM provider
          "gemini_key", // Gemini key
          "", // Display lang
          "", // Target lang
          "", // Gemini model
          "", // Groq model
        ];

        const ask = vi.fn().mockImplementation(async (prompt: string) => {
          prompts.push(prompt);
          return answers[prompts.length - 1] ?? "";
        });

        await runInitWizard({
          output,
          ask,
          groqVerifier: async () => ({ success: true, modelCount: 5 }),
          geminiVerifier: async () => ({ success: true }),
          ffmpegVerifier: async () => ({ success: true, version: "ffmpeg 7.0" }),
        });

        expect(prompts[0]).toContain("Transcription provider");
        expect(prompts[1]).toContain("Transcription provider");
        expect(outputData).toContain("foo");
        expect(saveSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            sttProvider: "groq",
          }),
          expect.anything(),
        );
      });

      it("notifies generic OPENROUTER_API_KEY from environment, verifies with it on Enter, and does not save openrouterApiKey to config file", async () => {
        process.env["OPENROUTER_API_KEY"] = "sk-or-v1-env-generic-secret";

        const output = new PassThrough();
        let outputData = "";
        output.on("data", (chunk) => {
          outputData += chunk.toString();
        });

        const openrouterVerifier = vi.fn().mockResolvedValue({ success: true });

        const prompts: string[] = [];
        const answers = [
          "openrouter", // Provider
          "", // OpenRouter key -> press Enter to use env
          "gemini", // LLM provider
          "gemini_key", // Gemini key
          "", // Display lang
          "", // Target lang
          "", // Gemini model
          "", // OpenRouter STT model
        ];

        const ask = vi.fn().mockImplementation(async (prompt: string) => {
          prompts.push(prompt);
          return answers[prompts.length - 1] ?? "";
        });

        await runInitWizard({
          output,
          ask,
          openrouterVerifier,
          geminiVerifier: async () => ({ success: true }),
          ffmpegVerifier: async () => ({ success: true, version: "ffmpeg 7.0" }),
        });

        expect(outputData).toContain("OPENROUTER_API_KEY is set in the environment");
        expect(prompts).toContain("  Enter OpenRouter API Key (Enter to keep current): ");
        expect(openrouterVerifier).toHaveBeenCalledWith("sk-or-v1-env-generic-secret");

        expect(saveSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            sttProvider: "openrouter",
          }),
          expect.anything(),
        );
        const saved = saveSpy.mock.calls[0]?.[0] as Partial<AppConfig>;
        expect(saved.openrouterApiKey).toBeUndefined();
      });

      it.each([
        {
          action: "s",
          expectedSavedKey: "sk-or-v1-unverified-key",
          expectedOutput: "Saved key without verification",
          fromEnvironment: false,
          lang: "en",
        },
        {
          action: "s",
          expectedSavedKey: undefined,
          expectedOutput:
            "Using the key from the environment variable without verification (not saved to the config file).",
          fromEnvironment: true,
          lang: "en",
        },
        {
          action: "s",
          expectedSavedKey: undefined,
          expectedOutput: "未検証のまま、環境変数のキーを使います (設定ファイルには保存しません)。",
          fromEnvironment: true,
          lang: "ja",
        },
        {
          action: "n",
          expectedSavedKey: undefined,
          expectedOutput: "OpenRouter API key skipped",
          fromEnvironment: false,
          lang: "en",
        },
      ] as const)(
        "handles OpenRouter key verification failure with $action action",
        async ({ action, expectedSavedKey, expectedOutput, fromEnvironment, lang }) => {
          if (fromEnvironment) process.env["OPENROUTER_API_KEY"] = "test-env-key";
          const output = new PassThrough();
          let outputData = "";
          output.on("data", (chunk) => {
            outputData += chunk.toString();
          });

          const prompts: string[] = [];
          const answers = [
            "openrouter", // Provider
            fromEnvironment ? "" : "sk-or-v1-unverified-key", // Bad key
            action, // Retry prompt answer
            "gemini", // LLM provider
            "gemini_key", // Gemini key
            "", // Display lang
            "", // Target lang
            "", // Gemini model
            "", // OpenRouter model
          ];

          const ask = vi.fn().mockImplementation(async (prompt: string) => {
            prompts.push(prompt);
            return answers[prompts.length - 1] ?? "";
          });

          await runInitWizard({
            output,
            ask,
            lang,
            openrouterVerifier: async () => ({ success: false, error: "401 Unauthorized" }),
            geminiVerifier: async () => ({ success: true }),
            ffmpegVerifier: async () => ({ success: true, version: "ffmpeg 7.0" }),
          });

          expect(outputData).toContain(expectedOutput);
          if (fromEnvironment) {
            expect(outputData).not.toContain("Saved key without verification");
            expect(outputData).not.toContain("未検証のままキーを設定対象に含めました");
          }
          const saved = saveSpy.mock.calls[0]?.[0] as Partial<AppConfig>;
          expect(saved.openrouterApiKey).toBe(expectedSavedKey);
          expect(saved.sttProvider).toBe("openrouter");
        },
      );
    });

    describe("LLM provider selection and OpenRouter support in wizard", () => {
      it("defaults to gemini when Gemini API key is configured, and saves llmProvider: 'gemini' on Enter", async () => {
        placeConfig({ geminiApiKey: "AIza_dummy_gemini_key" });

        const output = new PassThrough();

        const prompts: string[] = [];
        const ask = vi.fn().mockImplementation(async (prompt: string) => {
          prompts.push(prompt);
          return ""; // Enter on all prompts
        });

        await runInitWizard({
          output,
          ask,
          openrouterVerifier: async () => ({ success: true }),
          geminiVerifier: async () => ({ success: true }),
          ffmpegVerifier: async () => ({ success: true, version: "ffmpeg 7.0" }),
        });

        const llmPrompt = prompts.find((p) => p.includes("Text generation provider"));
        expect(llmPrompt).toBeDefined();
        expect(llmPrompt).toContain("[gemini]");
        expect(saveSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            llmProvider: "gemini",
          }),
          expect.anything(),
        );
      });

      it("defaults to openrouter when config is empty; when openrouter is selected in step 1, reuses key without asking, saves openrouterLlmModel, and does not save geminiApiKey", async () => {
        const output = new PassThrough();
        let outputData = "";
        output.on("data", (chunk) => {
          outputData += chunk.toString();
        });

        const openrouterVerifier = vi.fn().mockResolvedValue({ success: true });
        const geminiVerifier = vi.fn().mockResolvedValue({ success: true });

        const prompts: string[] = [];
        const answers = [
          "openrouter", // [1/4] STT provider
          "sk-or-v1-test-key", // [1/4] OpenRouter key
          "", // [2/4] LLM provider -> Enter (defaults to openrouter)
          // OpenRouter key should NOT be prompted here!
          "", // [4/4] Display lang
          "", // [4/4] Target lang
          "custom/llm-model", // [4/4] OpenRouter LLM model
          "custom/stt-model", // [4/4] OpenRouter STT model
        ];

        const ask = vi.fn().mockImplementation(async (prompt: string) => {
          prompts.push(prompt);
          return answers[prompts.length - 1] ?? "";
        });

        await runInitWizard({
          output,
          ask,
          openrouterVerifier,
          geminiVerifier,
          ffmpegVerifier: async () => ({ success: true, version: "ffmpeg 7.0" }),
        });

        const llmPrompt = prompts.find((p) => p.includes("Text generation provider"));
        expect(llmPrompt).toBeDefined();
        expect(llmPrompt).toContain("[openrouter]");
        expect(outputData).toContain("Using the OpenRouter API key from step 1.");
        expect(openrouterVerifier).toHaveBeenCalledTimes(1);
        expect(openrouterVerifier).toHaveBeenCalledWith("sk-or-v1-test-key");
        expect(geminiVerifier).not.toHaveBeenCalled();

        expect(saveSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            sttProvider: "openrouter",
            openrouterApiKey: "sk-or-v1-test-key",
            llmProvider: "openrouter",
            openrouterLlmModel: "custom/llm-model",
            openrouterSttModel: "custom/stt-model",
          }),
          expect.anything(),
        );
        const saved = saveSpy.mock.calls[0]?.[0] as Partial<AppConfig>;
        expect(saved.geminiApiKey).toBeUndefined();
        expect(saved.geminiModel).toBeUndefined();
      });

      it("prompts and verifies OpenRouter key when groq was chosen in step 1 and openrouter is chosen in step 2", async () => {
        const output = new PassThrough();
        const openrouterVerifier = vi.fn().mockResolvedValue({ success: true });
        const groqVerifier = vi.fn().mockResolvedValue({ success: true, modelCount: 5 });

        const prompts: string[] = [];
        const answers = [
          "groq", // [1/4] STT provider
          "gsk_test_key", // [1/4] Groq key
          "openrouter", // [2/4] LLM provider
          "sk-or-v1-new-key", // [2/4] OpenRouter key
          "", // [4/4] Display lang
          "", // [4/4] Target lang
          "", // [4/4] OpenRouter LLM model
          "", // [4/4] Groq STT model
        ];

        const ask = vi.fn().mockImplementation(async (prompt: string) => {
          prompts.push(prompt);
          return answers[prompts.length - 1] ?? "";
        });

        await runInitWizard({
          output,
          ask,
          openrouterVerifier,
          groqVerifier,
          ffmpegVerifier: async () => ({ success: true, version: "ffmpeg 7.0" }),
        });

        expect(openrouterVerifier).toHaveBeenCalledWith("sk-or-v1-new-key");
        expect(saveSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            sttProvider: "groq",
            groqApiKey: "gsk_test_key",
            llmProvider: "openrouter",
            openrouterApiKey: "sk-or-v1-new-key",
          }),
          expect.anything(),
        );
      });

      it("notifies generic OPENROUTER_API_KEY from environment in step 2 when groq was chosen in step 1, and does not save openrouterApiKey", async () => {
        process.env["OPENROUTER_API_KEY"] = "sk-or-v1-env-generic-secret";

        const output = new PassThrough();
        let outputData = "";
        output.on("data", (chunk) => {
          outputData += chunk.toString();
        });

        const openrouterVerifier = vi.fn().mockResolvedValue({ success: true });

        const prompts: string[] = [];
        const answers = [
          "groq", // [1/4] STT provider
          "gsk_test_key", // [1/4] Groq key
          "openrouter", // [2/4] LLM provider
          "", // [2/4] OpenRouter key -> Enter to use env
          "", // [4/4] Display lang
          "", // [4/4] Target lang
          "", // [4/4] OpenRouter LLM model
          "", // [4/4] Groq STT model
        ];

        const ask = vi.fn().mockImplementation(async (prompt: string) => {
          prompts.push(prompt);
          return answers[prompts.length - 1] ?? "";
        });

        await runInitWizard({
          output,
          ask,
          openrouterVerifier,
          groqVerifier: async () => ({ success: true, modelCount: 5 }),
          ffmpegVerifier: async () => ({ success: true, version: "ffmpeg 7.0" }),
        });

        expect(outputData).toContain("OPENROUTER_API_KEY is set in the environment");
        expect(openrouterVerifier).toHaveBeenCalledWith("sk-or-v1-env-generic-secret");
        expect(saveSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            llmProvider: "openrouter",
          }),
          expect.anything(),
        );
        const saved = saveSpy.mock.calls[0]?.[0] as Partial<AppConfig>;
        expect(saved.openrouterApiKey).toBeUndefined();
      });

      it("re-prompts on invalid LLM provider answer (foo) then proceeds with gemini", async () => {
        const output = new PassThrough();
        let outputData = "";
        output.on("data", (chunk) => {
          outputData += chunk.toString();
        });

        const prompts: string[] = [];
        const answers = [
          "groq", // [1/4] STT provider
          "gsk_test_key", // [1/4] Groq key
          "foo", // [2/4] Invalid LLM provider
          "gemini", // [2/4] Valid LLM provider
          "AIza_key", // [2/4] Gemini key
          "", // [4/4] Display lang
          "", // [4/4] Target lang
          "", // [4/4] Gemini model
          "", // [4/4] Groq STT model
        ];

        const ask = vi.fn().mockImplementation(async (prompt: string) => {
          prompts.push(prompt);
          return answers[prompts.length - 1] ?? "";
        });

        await runInitWizard({
          output,
          ask,
          groqVerifier: async () => ({ success: true, modelCount: 5 }),
          geminiVerifier: async () => ({ success: true }),
          ffmpegVerifier: async () => ({ success: true, version: "ffmpeg 7.0" }),
        });

        const llmPrompts = prompts.filter((p) => p.includes("Text generation provider"));
        expect(llmPrompts.length).toBe(2);
        expect(outputData).toContain("foo");
        expect(saveSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            llmProvider: "gemini",
            geminiApiKey: "AIza_key",
          }),
          expect.anything(),
        );
      });

      it.each([
        {
          name: "with Gemini key",
          config: {
            llmProvider: "invalid_provider" as unknown as "gemini",
            geminiApiKey: "AIza_existing_gemini_key",
          },
          expectedDefault: "[gemini]",
          expectedSaved: "gemini",
        },
        {
          name: "without Gemini key",
          config: {
            llmProvider: "invalid_provider" as unknown as "gemini",
          },
          expectedDefault: "[openrouter]",
          expectedSaved: "openrouter",
        },
      ])(
        "falls back to auto key detection without crashing when config has invalid llmProvider ($name)",
        async ({ config, expectedDefault, expectedSaved }) => {
          placeConfig(config);

          const output = new PassThrough();

          const prompts: string[] = [];
          const ask = vi.fn().mockImplementation(async (prompt: string) => {
            prompts.push(prompt);
            return ""; // Enter on all prompts
          });

          await runInitWizard({
            output,
            ask,
            openrouterVerifier: async () => ({ success: true }),
            geminiVerifier: async () => ({ success: true }),
            ffmpegVerifier: async () => ({ success: true, version: "ffmpeg 7.0" }),
          });

          const llmPrompt = prompts.find((p) => p.includes("Text generation provider"));
          expect(llmPrompt).toBeDefined();
          expect(llmPrompt).toContain(expectedDefault);
          expect(saveSpy).toHaveBeenCalledWith(
            expect.objectContaining({
              llmProvider: expectedSaved,
            }),
            expect.anything(),
          );
        },
      );
    });
  });
});
