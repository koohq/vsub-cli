import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runBatchPipeline } from "./batch.js";
import { createProgram } from "./cli.js";
import { processChaptersPipeline, processMediaPipeline } from "./pipeline.js";

vi.mock("./config.js", () => {
  return {
    DEFAULT_GEMINI_MODEL: "gemini-3.8-flash",
    DEFAULT_GROQ_MODEL: "whisper-large-v3-turbo",
    getConfig: vi.fn().mockReturnValue({
      groqApiKey: "test-groq-key",
      geminiApiKey: "test-gemini-key",
      ffmpegPath: "ffmpeg",
      lang: "en",
      disableUpdateCheck: true,
    }),
    ensureApiKeys: vi.fn().mockResolvedValue({
      groqApiKey: "test-groq-key",
      geminiApiKey: "test-gemini-key",
    }),
    getGlobalConfigDir: vi.fn().mockReturnValue("/mock/config/dir"),
    getGlobalConfigPath: vi.fn().mockReturnValue("/mock/config/dir/config.json"),
    loadGlobalConfig: vi.fn().mockReturnValue({}),
    saveGlobalConfig: vi.fn(),
    validateApiKeys: vi.fn().mockReturnValue({ valid: true, missing: [] }),
  };
});

vi.mock("./updater.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./updater.js")>();
  return {
    ...actual,
    notifyUpdateIfAvailable: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("./pipeline.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./pipeline.js")>();
  return {
    ...actual,
    processMediaPipeline: vi.fn().mockResolvedValue({ stdoutContent: undefined }),
    processChaptersPipeline: vi.fn().mockResolvedValue(undefined),
    processSummaryPipeline: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("./batch.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./batch.js")>();
  return {
    ...actual,
    runBatchPipeline: vi.fn().mockResolvedValue({ failedCount: 0 }),
  };
});

describe("CLI integration harness", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
  });

  afterEach(() => {
    exitSpy.mockRestore();
  });

  async function runCli(...args: string[]): Promise<void> {
    const program = createProgram();
    await program.parseAsync(["node", "vsub", ...args]);
  }

  it("passes mediaFile, targetLang, and format to processMediaPipeline", async () => {
    await runCli("video.mp4", "-t", "en", "-f", "srt,vtt");

    expect(processMediaPipeline).toHaveBeenCalledTimes(1);
    expect(processMediaPipeline).toHaveBeenCalledWith(
      expect.objectContaining({
        mediaFile: "video.mp4",
        targetLang: "en",
        format: "srt,vtt",
      }),
    );
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("passes targets and targetLang to runBatchPipeline", async () => {
    await runCli("batch", "./videos", "-t", "en");

    expect(runBatchPipeline).toHaveBeenCalledTimes(1);
    expect(runBatchPipeline).toHaveBeenCalledWith(
      expect.objectContaining({
        targets: ["./videos"],
        targetLang: "en",
      }),
    );
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("passes inputFile and targetLang to processChaptersPipeline", async () => {
    await runCli("chapters", "a.srt", "-t", "en", "-f", "txt");

    expect(processChaptersPipeline).toHaveBeenCalledTimes(1);
    expect(processChaptersPipeline).toHaveBeenCalledWith(
      expect.objectContaining({
        inputFile: "a.srt",
        targetLang: "en",
      }),
    );
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it.todo(
    "vsub chapters a.srt without -f should use the chapters default format txt (currently the root default 'srt' overrides it via optsWithGlobals)",
  );
});
