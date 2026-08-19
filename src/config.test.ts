import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getConfig, getGlobalConfigPath, validateApiKeys } from "./config.js";

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
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    // Clear relevant env vars
    delete process.env["VSUB_GROQ_API_KEY"];
    delete process.env["GROQ_API_KEY"];
    delete process.env["VSUB_GEMINI_API_KEY"];
    delete process.env["GEMINI_API_KEY"];
    delete process.env["VSUB_FFMPEG_PATH"];
    delete process.env["FFMPEG_PATH"];
    delete process.env["VSUB_WHISPER_PROMPT"];
    delete process.env["WHISPER_PROMPT"];
    delete process.env["VSUB_PROMPT"];
    delete process.env["VSUB_GEMINI_PROMPT"];
    delete process.env["GEMINI_PROMPT"];
    delete process.env["VSUB_GLOSSARY"];
    delete process.env["GLOSSARY"];
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

    it("should fallback to default values when nothing is configured", () => {
      const config = getConfig();
      expect(config.groqApiKey).toBe("");
      expect(config.geminiApiKey).toBe("");
      expect(config.ffmpegPath).toBe("ffmpeg");
      expect(config.whisperPrompt).toBeUndefined();
      expect(config.prompt).toBeUndefined();
      expect(config.glossary).toBeUndefined();
    });
  });

  describe("validateApiKeys", () => {
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
  });
});
