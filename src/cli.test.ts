import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runBatchPipeline } from "./batch.js";
import { loadMediaCache, saveTranslationCache } from "./cache.js";
import { createProgram } from "./cli.js";
import {
  processChaptersPipeline,
  processMediaPipeline,
  processSummaryPipeline,
} from "./pipeline.js";
import { reflowSrtEntries } from "./srt.js";
import { notifyUpdateIfAvailable } from "./updater.js";

vi.mock("./config.js", () => {
  return {
    DEFAULT_GEMINI_MODEL: "gemini-3.8-flash",
    DEFAULT_GROQ_MODEL: "whisper-large-v3-turbo",
    getConfig: vi.fn().mockReturnValue({
      groqApiKey: "test-groq-key",
      geminiApiKey: "test-gemini-key",
      ffmpegPath: "ffmpeg",
      lang: "en",
      disableUpdateCheck: false,
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

vi.mock("./gemini.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./gemini.js")>();
  return {
    ...actual,
    translateSrtEntries: vi.fn().mockImplementation(async (entries: unknown[]) => entries),
  };
});

vi.mock("./cache.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./cache.js")>();
  return {
    ...actual,
    loadMediaCache: vi.fn().mockReturnValue(null),
    saveTranslationCache: vi.fn(),
  };
});

vi.mock("./srt.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./srt.js")>();
  return {
    ...actual,
    reflowSrtEntries: vi.fn(actual.reflowSrtEntries),
  };
});

vi.mock("./ffmpeg.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./ffmpeg.js")>();
  return {
    ...actual,
    checkFfmpeg: vi.fn().mockResolvedValue(undefined),
    burnSubtitlesToVideo: vi.fn().mockResolvedValue("output.mp4"),
    embedSubtitlesToVideo: vi.fn().mockResolvedValue("output.mp4"),
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
  let tmpDir: string;
  let dummySrtPath: string;
  let dummyVideoPath: string;

  beforeEach(() => {
    vi.clearAllMocks();
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vsub-cli-test-"));
    dummySrtPath = path.join(tmpDir, "sample.srt");
    dummyVideoPath = path.join(tmpDir, "video.mp4");
    fs.writeFileSync(
      dummySrtPath,
      "1\n00:00:01,000 --> 00:00:03,000\nFirst subtitle\n\n2\n00:00:04,000 --> 00:00:06,000\nSecond subtitle\n",
      "utf-8",
    );
    fs.writeFileSync(dummyVideoPath, "");
  });

  afterEach(() => {
    exitSpy.mockRestore();
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
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

  const pipelineCases = [
    {
      flag: "--no-cache",
      prop: "noCache" as const,
      command: "main",
      args: ["video.mp4"],
      getMock: () => processMediaPipeline,
    },
    {
      flag: "--no-cache",
      prop: "noCache" as const,
      command: "batch",
      args: ["batch", "videos"],
      getMock: () => runBatchPipeline,
    },
    {
      flag: "--no-cache",
      prop: "noCache" as const,
      command: "chapters",
      args: ["chapters", "a.srt", "-f", "txt"],
      getMock: () => processChaptersPipeline,
    },
    {
      flag: "--no-cache",
      prop: "noCache" as const,
      command: "summarize",
      args: ["summarize", "a.srt", "-f", "md"],
      getMock: () => processSummaryPipeline,
    },
    {
      flag: "--no-translate",
      prop: "noTranslate" as const,
      command: "main",
      args: ["video.mp4"],
      getMock: () => processMediaPipeline,
    },
    {
      flag: "--no-translate",
      prop: "noTranslate" as const,
      command: "batch",
      args: ["batch", "videos"],
      getMock: () => runBatchPipeline,
    },
    {
      flag: "--no-reflow",
      prop: "noReflow" as const,
      command: "main",
      args: ["video.mp4"],
      getMock: () => processMediaPipeline,
    },
    {
      flag: "--no-reflow",
      prop: "noReflow" as const,
      command: "batch",
      args: ["batch", "videos"],
      getMock: () => runBatchPipeline,
    },
  ];

  describe.each(pipelineCases)("$command $flag", ({ flag, prop, args, getMock }) => {
    it("passes truthy option when flag is specified", async () => {
      await runCli(...args, flag);
      const mock = vi.mocked(getMock());
      expect(mock).toHaveBeenCalledTimes(1);
      expect(mock).toHaveBeenCalledWith(expect.objectContaining({ [prop]: true }));
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it("does not set truthy option when flag is omitted", async () => {
      await runCli(...args);
      const mock = vi.mocked(getMock());
      expect(mock).toHaveBeenCalledTimes(1);
      const optionsWithout = (mock.mock.calls[0]?.[0] ?? {}) as Record<string, unknown>;
      expect(optionsWithout[prop]).toBeFalsy();
      expect(exitSpy).not.toHaveBeenCalled();
    });
  });

  describe("translate flags", () => {
    describe.each([
      {
        flag: "--no-cache",
        assertWithFlag: () => {
          expect(loadMediaCache).not.toHaveBeenCalled();
          expect(saveTranslationCache).not.toHaveBeenCalled();
        },
        assertWithoutFlag: () => {
          expect(loadMediaCache).toHaveBeenCalledTimes(1);
          expect(saveTranslationCache).toHaveBeenCalledTimes(1);
        },
      },
      {
        flag: "--no-reflow",
        assertWithFlag: () => {
          expect(reflowSrtEntries).not.toHaveBeenCalled();
        },
        assertWithoutFlag: () => {
          expect(reflowSrtEntries).toHaveBeenCalled();
        },
      },
    ])("translate $flag", ({ flag, assertWithFlag, assertWithoutFlag }) => {
      it(`respects ${flag} when flag is specified`, async () => {
        await runCli("translate", dummySrtPath, flag);
        assertWithFlag();
        expect(exitSpy).not.toHaveBeenCalled();
      });

      it(`applies default behavior when ${flag} is omitted`, async () => {
        await runCli("translate", dummySrtPath);
        assertWithoutFlag();
        expect(exitSpy).not.toHaveBeenCalled();
      });
    });
  });

  const updateCheckCases = [
    { command: "main", getArgs: () => ["video.mp4"] },
    { command: "batch", getArgs: () => ["batch", "videos"] },
    { command: "translate", getArgs: () => ["translate", dummySrtPath] },
    { command: "chapters", getArgs: () => ["chapters", "a.srt", "-f", "txt"] },
    { command: "summarize", getArgs: () => ["summarize", "a.srt", "-f", "md"] },
    { command: "burn", getArgs: () => ["burn", dummyVideoPath, dummySrtPath] },
    { command: "embed", getArgs: () => ["embed", dummyVideoPath, dummySrtPath] },
  ];

  describe.each(updateCheckCases)("$command --no-update-check", ({ getArgs }) => {
    it("passes disableUpdateCheck: true when --no-update-check is specified", async () => {
      await runCli(...getArgs(), "--no-update-check");
      expect(notifyUpdateIfAvailable).toHaveBeenCalledTimes(1);
      expect(notifyUpdateIfAvailable).toHaveBeenCalledWith(
        expect.objectContaining({ disableUpdateCheck: true }),
      );
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it("passes disableUpdateCheck: false when --no-update-check is omitted", async () => {
      await runCli(...getArgs());
      expect(notifyUpdateIfAvailable).toHaveBeenCalledTimes(1);
      expect(notifyUpdateIfAvailable).toHaveBeenCalledWith(
        expect.objectContaining({ disableUpdateCheck: false }),
      );
      expect(exitSpy).not.toHaveBeenCalled();
    });
  });
});
