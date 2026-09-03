import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as configModule from "./config.js";
import {
  maskApiKey,
  runInitWizard,
  verifyFfmpeg,
  verifyGeminiApiKey,
  verifyGroqApiKey,
} from "./init.js";

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
    it("should return error when key is empty", async () => {
      const result = await verifyGroqApiKey("");
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
    it("should return error when key is empty", async () => {
      const result = await verifyGeminiApiKey("");
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

    beforeEach(() => {
      saveSpy = vi.spyOn(configModule, "saveGlobalConfig").mockImplementation(() => {});
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("should complete wizard with provided inputs and save config", async () => {
      const output = new PassThrough();
      let outputData = "";
      output.on("data", (chunk) => {
        outputData += chunk.toString();
      });

      const ask = vi
        .fn()
        .mockResolvedValueOnce("gsk_new_groq_key")
        .mockResolvedValueOnce("AIza_new_gemini_key")
        .mockResolvedValueOnce("ja,en")
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
          targetLang: "ja,en",
          geminiModel: "gemini-3.8-flash",
          groqModel: "whisper-large-v3-turbo",
        }),
      );

      expect(outputData).toContain("初期セットアップが正常に完了しました");
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
      );
    });

    it("should handle missing ffmpeg and allow custom path input", async () => {
      const output = new PassThrough();

      const ask = vi
        .fn()
        .mockResolvedValueOnce("groq-key")
        .mockResolvedValueOnce("gemini-key")
        .mockResolvedValueOnce("custom/bin/ffmpeg") // Custom ffmpeg path
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
      );
    });
  });
});
