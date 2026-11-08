import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as configModule from "./config.js";
import { type AppConfig, getGlobalConfigPath } from "./config.js";
import type { SupportedLanguage } from "./i18n/index.js";
import {
  maskApiKey,
  runInitWizard,
  verifyFfmpeg,
  verifyGeminiApiKey,
  verifyGroqApiKey,
} from "./init.js";
import { isolateConfigAndEnv } from "./test-support/isolate-config-env.js";

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

  describe("runInitWizard", () => {
    let saveSpy: ReturnType<typeof vi.spyOn>;
    let tempDir: string;
    const originalEnv = process.env;

    beforeEach(() => {
      saveSpy = vi.spyOn(configModule, "saveGlobalConfig").mockImplementation(() => {});
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vsub-init-test-"));
      process.env = { ...originalEnv };
      isolateConfigAndEnv(tempDir);
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

    interface RunWizardOptions {
      lang?: SupportedLanguage | undefined;
      displayLangAnswer?: string;
      targetLangAnswer?: string;
    }

    async function runWizard(options: RunWizardOptions = {}) {
      const output = new PassThrough();
      let outputData = "";
      output.on("data", (chunk) => {
        outputData += chunk.toString();
      });

      const prompts: string[] = [];
      const answers = [
        "groq-key",
        "gemini-key",
        options.displayLangAnswer ?? "",
        options.targetLangAnswer ?? "",
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
        groqVerifier: async () => ({ success: true, modelCount: 5 }),
        geminiVerifier: async () => ({ success: true }),
        ffmpegVerifier: async () => ({
          success: true,
          version: "ffmpeg version 7.0",
        }),
      });

      const savedConfig: Partial<AppConfig> =
        (saveSpy.mock.calls[0]?.[0] as Partial<AppConfig> | undefined) ?? {};
      return { output: outputData, prompts, savedConfig };
    }

    it("should complete wizard with provided inputs and save config in Japanese when lang is ja", async () => {
      const output = new PassThrough();
      let outputData = "";
      output.on("data", (chunk) => {
        outputData += chunk.toString();
      });

      const ask = vi
        .fn()
        .mockResolvedValueOnce("gsk_new_groq_key")
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
          groqApiKey: "gsk_new_groq_key",
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
        .mockResolvedValueOnce("gsk_new_groq_key")
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
          groqApiKey: "gsk_new_groq_key",
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
        .mockResolvedValueOnce("bad-key") // Initial bad key
        .mockResolvedValueOnce("y") // Retry choice -> yes
        .mockResolvedValueOnce("good-key") // Good key
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
        .mockResolvedValueOnce("groq-key")
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
          .mockResolvedValueOnce("groq-key")
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

        const displayPrompt = prompts[2] ?? "";
        expect(displayPrompt).toContain(expectedPromptName);
        expect(displayPrompt.match(/\[[^\]]*\]/g)).toEqual([expectedBracket]);
        expect(savedConfig.lang).toBe(expectedSavedLang);

        const targetPrompt = prompts[3] ?? "";
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

        const targetPrompt = prompts[3] ?? "";
        expect(targetPrompt).toContain(expectedPromptName);
        expect(targetPrompt.match(/\[[^\]]*\]/g)).toEqual([expectedBracket]);
        expect(savedConfig.targetLang).toBe(expectedSavedTargetLang);
      },
    );
  });
});
