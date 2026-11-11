import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type AppConfig, ensureApiKeys, loadGlobalConfig } from "./config.js";
import { isolateConfigAndEnv } from "./test-support/isolate-config-env.js";

function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    groqApiKey: "",
    geminiApiKey: "",
    ffmpegPath: "ffmpeg",
    ...overrides,
  };
}

describe("ensureApiKeys interactive mode", () => {
  let tempDir: string;
  let originalEnv: NodeJS.ProcessEnv;
  let originalStdinTty: boolean | undefined;
  let originalStdoutTty: boolean | undefined;
  let questionMock: ReturnType<typeof vi.fn>;
  let closeMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vsub-config-interactive-"));
    originalEnv = { ...process.env };
    isolateConfigAndEnv(tempDir);

    originalStdinTty = process.stdin.isTTY;
    originalStdoutTty = process.stdout.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });

    questionMock = vi.fn();
    closeMock = vi.fn();

    vi.spyOn(readline, "createInterface").mockReturnValue({
      question: questionMock,
      close: closeMock,
    } as unknown as readline.Interface);
  });

  afterEach(() => {
    process.env = originalEnv;
    Object.defineProperty(process.stdin, "isTTY", { value: originalStdinTty, configurable: true });
    Object.defineProperty(process.stdout, "isTTY", {
      value: originalStdoutTty,
      configurable: true,
    });
    vi.restoreAllMocks();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("does not save pre-existing openrouterApiKey to config.json when only Gemini key is prompted", async () => {
    questionMock.mockImplementation(async (query: string) => {
      if (query.includes("Gemini")) {
        return "gemini-prompted-key";
      }
      return "";
    });

    const result = await ensureApiKeys(makeConfig({ openrouterApiKey: "generic-openrouter-key" }), {
      requireGroq: false,
      requireGemini: true,
      requireOpenRouter: false,
    });

    expect(result.geminiApiKey).toBe("gemini-prompted-key");
    expect(result.openrouterApiKey).toBe("generic-openrouter-key");

    const savedConfig = loadGlobalConfig();
    expect(savedConfig.geminiApiKey).toBe("gemini-prompted-key");
    expect(savedConfig.openrouterApiKey).toBeUndefined();
  });

  it("saves openrouterApiKey to config.json when prompted during interactive setup", async () => {
    questionMock.mockImplementation(async (query: string) => {
      if (query.includes("OpenRouter")) {
        return "openrouter-prompted-key";
      }
      return "";
    });

    const result = await ensureApiKeys(makeConfig(), {
      requireGroq: false,
      requireGemini: false,
      requireOpenRouter: true,
    });

    expect(result.openrouterApiKey).toBe("openrouter-prompted-key");

    const savedConfig = loadGlobalConfig();
    expect(savedConfig.openrouterApiKey).toBe("openrouter-prompted-key");
  });

  it.each([false, true])(
    "localizes interactive API key prompts with OpenRouter: %s",
    async (openrouter) => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      questionMock.mockResolvedValue("test-api-key");
      await ensureApiKeys(makeConfig(), {
        lang: "ja",
        requireGroq: !openrouter,
        requireOpenRouter: openrouter,
        requireGemini: true,
      });
      const logged = logSpy.mock.calls.flat().join("\n");
      expect(logged).toContain("API キーがありません。対話形式で設定を始めます。");
      expect(logged).toContain("入力したキーは、次回から使えるよう次の場所に保存します:");
      expect(logged).toContain("✅ 設定を保存しました。");
      expect(questionMock).toHaveBeenCalledWith(
        expect.stringContaining(`${openrouter ? "OpenRouter" : "Groq"} の API キーを入力`),
      );
      expect(questionMock).toHaveBeenCalledWith(
        expect.stringContaining("Gemini の API キーを入力"),
      );
    },
  );
});
