import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runBatchPipeline } from "./batch.js";
import {
  computeEntriesHash,
  createCachedTranslation,
  getCacheStats,
  loadMediaCache,
  saveTranslationCache,
} from "./cache.js";
import { createProgram } from "./cli.js";
import { DEFAULT_GEMINI_MODEL, getConfig, saveGlobalConfig } from "./config.js";
import { embedSubtitlesToVideo } from "./ffmpeg.js";
import { runInitWizard } from "./init.js";
import {
  processChaptersPipeline,
  processMediaPipeline,
  processSummaryPipeline,
} from "./pipeline.js";
import { parseSrt, reflowSrtEntries } from "./srt.js";
import { DEFAULT_CONTEXT_WINDOW_SIZE, translateSrtEntries } from "./text/tasks.js";
import { notifyUpdateIfAvailable } from "./updater.js";

const { mockConfig } = vi.hoisted(() => ({
  mockConfig: {
    groqApiKey: "test-groq-key",
    geminiApiKey: "test-gemini-key",
    openrouterApiKey: "test-openrouter-key",
    ffmpegPath: "ffmpeg",
    lang: "en" as const,
    disableUpdateCheck: false,
    concurrency: undefined as number | undefined,
  },
}));

vi.mock("./config.js", () => {
  return {
    DEFAULT_GEMINI_MODEL: "gemini-3.8-flash",
    DEFAULT_GROQ_MODEL: "whisper-large-v3-turbo",
    getConfig: vi.fn().mockReturnValue(mockConfig),
    ensureApiKeys: vi.fn().mockImplementation(async (cfg?: object) => ({
      ...mockConfig,
      ...cfg,
    })),
    getGlobalConfigDir: vi.fn().mockReturnValue("/mock/config/dir"),
    getGlobalConfigPath: vi.fn().mockReturnValue("/mock/config/dir/config.json"),
    loadGlobalConfig: vi.fn().mockReturnValue({}),
    saveGlobalConfig: vi.fn(),
    validateApiKeys: vi.fn().mockReturnValue({ valid: true, missing: [] }),
  };
});

vi.mock("./text/tasks.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./text/tasks.js")>();
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
    getCacheStats: vi.fn().mockImplementation((cacheDir?: string) => ({
      cacheDir,
      count: 0,
      totalBytes: 0,
    })),
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
    isStandaloneBinary: vi.fn().mockReturnValue(false),
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

vi.mock("./init.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./init.js")>();
  return {
    ...actual,
    runInitWizard: vi.fn().mockResolvedValue(undefined),
  };
});

describe("CLI integration harness", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let tmpDir: string;
  let dummySrtPath: string;
  let dummyVideoPath: string;

  beforeEach(() => {
    vi.clearAllMocks();
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

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
    mockConfig.concurrency = undefined;
    exitSpy.mockRestore();
    logSpy.mockRestore();
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

  describe.each([
    {
      subcommand: "chapters",
      args: ["chapters", "a.srt"],
      getMock: () => processChaptersPipeline,
      expected: { format: "txt", targetLang: undefined },
    },
    {
      subcommand: "summarize",
      args: ["summarize", "a.srt"],
      getMock: () => processSummaryPipeline,
      expected: { format: "md", targetLang: undefined },
    },
  ])("$subcommand default options", ({ args, getMock, expected }) => {
    it("uses subcommand defaults instead of root defaults", async () => {
      await runCli(...args);
      expect(getMock()).toHaveBeenCalledTimes(1);
      expect(getMock()).toHaveBeenCalledWith(expect.objectContaining(expected));
      expect(exitSpy).not.toHaveBeenCalled();
    });
  });

  describe.each([
    {
      command: "main",
      args: ["video.mp4"],
      getMock: () => processMediaPipeline,
    },
    {
      command: "batch",
      args: ["batch", "./videos"],
      getMock: () => runBatchPipeline,
    },
  ])("$command default targetLang", ({ args, getMock }) => {
    it("passes undefined targetLang when -t is omitted", async () => {
      await runCli(...args);
      expect(getMock()).toHaveBeenCalledTimes(1);
      expect(vi.mocked(getMock()).mock.calls[0]?.[0]?.targetLang).toBeUndefined();
      expect(exitSpy).not.toHaveBeenCalled();
    });
  });

  describe("translate default target language", () => {
    afterEach(() => {
      vi.mocked(getConfig).mockReturnValue(mockConfig);
    });

    it.each([
      { configTargetLang: "es", args: ["translate", "sample.srt"], expected: "es" },
      { configTargetLang: "es", args: ["translate", "sample.srt", "-t", "fr"], expected: "fr" },
      { configTargetLang: undefined, args: ["translate", "sample.srt"], expected: "ja" },
    ])(
      "passes $expected to translateSrtEntries (config: $configTargetLang, args: $args)",
      async ({ configTargetLang, args, expected }) => {
        if (configTargetLang) {
          vi.mocked(getConfig).mockReturnValue({
            ...mockConfig,
            targetLang: configTargetLang,
          });
        } else {
          vi.mocked(getConfig).mockReturnValue(mockConfig);
        }

        const resolvedArgs = args.map((arg) => (arg === "sample.srt" ? dummySrtPath : arg));
        await runCli(...resolvedArgs);

        expect(vi.mocked(translateSrtEntries).mock.calls[0]?.[1]).toBe(expected);
        expect(exitSpy).not.toHaveBeenCalled();
      },
    );
  });

  const subcommandOptionCases = [
    {
      name: "batch dir -o out passes outputDir",
      getArgs: () => ["batch", "videos", "-o", "out"],
      assert: () => {
        expect(runBatchPipeline).toHaveBeenCalledWith(
          expect.objectContaining({ outputDir: "out" }),
        );
      },
    },
    {
      name: "config set passes options without being swallowed by root",
      getArgs: () => [
        "config",
        "set",
        "--lang",
        "ja",
        "--prompt",
        "p",
        "--gemini-model",
        "m",
        "--concurrency",
        "4",
      ],
      assert: () => {
        expect(saveGlobalConfig).toHaveBeenCalledWith(
          expect.objectContaining({
            lang: "ja",
            prompt: "p",
            geminiModel: "m",
            concurrency: 4,
          }),
          expect.anything(),
        );
      },
    },
    {
      name: "cache stats --cache-dir passes directory",
      getArgs: () => ["cache", "stats", "--cache-dir", tmpDir],
      assert: () => {
        expect(getCacheStats).toHaveBeenCalledWith(tmpDir);
      },
    },
    {
      name: "update -f does not fail with missing argument",
      getArgs: () => ["update", "-f"],
      assert: () => {
        // Just verify it doesn't fail
      },
    },
    {
      name: "translate <srt> -t en passes target language",
      getArgs: () => ["translate", dummySrtPath, "-t", "en"],
      assert: () => {
        expect(vi.mocked(translateSrtEntries).mock.calls[0]?.[1]).toBe("en");
      },
    },
  ];

  describe.each(subcommandOptionCases)("$name", ({ getArgs, assert }) => {
    it("executes without error and passes options to target handler", async () => {
      await runCli(...getArgs());
      assert();
      expect(exitSpy).not.toHaveBeenCalled();
    });
  });

  describe("save failure handling", () => {
    let errorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
      errorSpy.mockRestore();
    });

    function errorOutput(): string {
      return errorSpy.mock.calls.map((call: unknown[]) => String(call[0])).join("\n");
    }

    it("config set exits with code 1 and no success message when saving fails", async () => {
      vi.mocked(saveGlobalConfig).mockImplementationOnce(() => {
        throw new Error("dummy unreadable config");
      });
      await runCli("config", "set", "--gemini-model", "m");

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(errorOutput()).toContain("dummy unreadable config");
      const logged = logSpy.mock.calls.map((call: unknown[]) => String(call[0])).join("\n");
      expect(logged).not.toContain("Configuration updated and saved");
    });

    it.each([
      { name: "init", args: ["init"] },
      { name: "config init", args: ["config", "init"] },
    ])("$name exits with code 1 when the wizard fails", async ({ args }) => {
      vi.mocked(runInitWizard).mockRejectedValueOnce(new Error("dummy wizard failure"));
      await expect(runCli(...args)).resolves.toBeUndefined();

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(errorOutput()).toContain("dummy wizard failure");
    });
  });

  describe("global option placement", () => {
    it.each([
      {
        position: "after subcommand",
        args: ["chapters", "a.srt", "-f", "txt", "--lang", "ja"],
      },
      {
        position: "before subcommand",
        args: ["--lang", "ja", "chapters", "a.srt", "-f", "txt"],
      },
    ])("--lang ja specified $position", async ({ args }) => {
      await runCli(...args);
      expect(processChaptersPipeline).toHaveBeenCalledWith(expect.objectContaining({ lang: "ja" }));
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it("--no-update-check specified before subcommand", async () => {
      await runCli("--no-update-check", "chapters", "a.srt", "-f", "txt");
      expect(notifyUpdateIfAvailable).toHaveBeenCalledWith(
        expect.objectContaining({ disableUpdateCheck: true }),
      );
      expect(exitSpy).not.toHaveBeenCalled();
    });
  });

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

    it("passes concurrency from config to translateSrtEntries when --concurrency is omitted", async () => {
      mockConfig.concurrency = 4;
      await runCli("translate", dummySrtPath, "-t", "ja");
      expect(translateSrtEntries).toHaveBeenCalled();
      const callOptions = vi.mocked(translateSrtEntries).mock.calls[0]?.[5];
      expect(callOptions?.concurrency).toBe(4);
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it("requires OpenRouter key when --llm-provider openrouter is specified in translate command", async () => {
      const { ensureApiKeys } = await import("./config.js");
      vi.mocked(ensureApiKeys).mockClear();

      await runCli("translate", dummySrtPath, "-t", "ja", "--llm-provider", "openrouter");

      expect(ensureApiKeys).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          requireGemini: false,
          requireOpenRouter: true,
          requireGroq: false,
        }),
      );
    });

    describe("translate translation cache", () => {
      let sourceEntries: ReturnType<typeof parseSrt>;

      function mockCacheWithTranslation(cached: ReturnType<typeof createCachedTranslation>): void {
        vi.mocked(loadMediaCache).mockReturnValue({
          version: 1,
          mediaPath: path.resolve(dummySrtPath),
          mediaSize: 100,
          mediaMtimeMs: 1000,
          translations: {
            [cached.targetLang.toLowerCase()]: cached,
          },
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      }

      beforeEach(() => {
        sourceEntries = parseSrt(fs.readFileSync(dummySrtPath, "utf-8"));
      });

      afterEach(() => {
        vi.mocked(loadMediaCache).mockReturnValue(null);
      });

      it("does not call translateSrtEntries when matching cache exists", async () => {
        const cached = createCachedTranslation(
          "ja",
          {
            sourceEntries,
            model: DEFAULT_GEMINI_MODEL,
            contextWindowSize: DEFAULT_CONTEXT_WINDOW_SIZE,
          },
          sourceEntries.map((e) => ({ ...e, text: `訳: ${e.text}` })),
        );
        mockCacheWithTranslation(cached);

        await runCli("translate", dummySrtPath, "-t", "ja");

        expect(translateSrtEntries).not.toHaveBeenCalled();
        expect(exitSpy).not.toHaveBeenCalled();
      });

      it("calls translateSrtEntries when prompt was specified in cache but omitted in CLI run", async () => {
        const cached = createCachedTranslation(
          "ja",
          {
            sourceEntries,
            prompt: "Polite prompt",
            contextWindowSize: DEFAULT_CONTEXT_WINDOW_SIZE,
          },
          sourceEntries.map((e) => ({ ...e, text: `訳: ${e.text}` })),
        );
        mockCacheWithTranslation(cached);

        await runCli("translate", dummySrtPath, "-t", "ja");

        expect(translateSrtEntries).toHaveBeenCalledTimes(1);
        expect(exitSpy).not.toHaveBeenCalled();
      });

      it("calls translateSrtEntries when contextWindow was specified in cache but omitted in CLI run", async () => {
        const cached = createCachedTranslation(
          "ja",
          { sourceEntries, contextWindowSize: 2 },
          sourceEntries.map((e) => ({ ...e, text: `訳: ${e.text}` })),
        );
        mockCacheWithTranslation(cached);

        await runCli("translate", dummySrtPath, "-t", "ja");

        expect(translateSrtEntries).toHaveBeenCalledTimes(1);
        expect(exitSpy).not.toHaveBeenCalled();
      });

      it("saves translation cache with sourceHash matching computeEntriesHash of translated entries", async () => {
        await runCli("translate", dummySrtPath, "-t", "ja");

        expect(translateSrtEntries).toHaveBeenCalledTimes(1);
        const passedEntries = vi.mocked(translateSrtEntries).mock.calls[0]?.[0] as ReturnType<
          typeof parseSrt
        >;
        expect(saveTranslationCache).toHaveBeenCalledTimes(1);

        const savedData = vi.mocked(saveTranslationCache).mock.calls[0]?.[2];
        expect(savedData).toBeDefined();
        expect(savedData?.sourceHash).toBe(computeEntriesHash(passedEntries));
        expect(exitSpy).not.toHaveBeenCalled();
      });
    });

    describe("translate --cache-dir", () => {
      let defaultCacheDir: string;
      let customCacheDir: string;
      let originalCacheDirEnv: string | undefined;

      function hasCacheFiles(dir: string): boolean {
        return fs.existsSync(dir) && fs.readdirSync(dir).some((f) => f.endsWith(".json"));
      }

      async function runTranslate(withCacheDir: boolean): Promise<void> {
        const args = ["translate", dummySrtPath, "-t", "ja", "-w"];
        if (withCacheDir) {
          args.push("--cache-dir", customCacheDir);
        }
        await runCli(...args);
      }

      beforeEach(async () => {
        defaultCacheDir = path.join(tmpDir, "default-cache");
        customCacheDir = path.join(tmpDir, "custom-cache");
        originalCacheDirEnv = process.env["VSUB_CACHE_DIR"];
        process.env["VSUB_CACHE_DIR"] = defaultCacheDir;

        const actual = await vi.importActual<typeof import("./cache.js")>("./cache.js");
        vi.mocked(loadMediaCache).mockImplementation(actual.loadMediaCache);
        vi.mocked(saveTranslationCache).mockImplementation(actual.saveTranslationCache);
      });

      afterEach(() => {
        if (originalCacheDirEnv === undefined) {
          delete process.env["VSUB_CACHE_DIR"];
        } else {
          process.env["VSUB_CACHE_DIR"] = originalCacheDirEnv;
        }
        vi.mocked(loadMediaCache).mockReset().mockReturnValue(null);
        vi.mocked(saveTranslationCache).mockReset();
      });

      it("writes to and reads from the custom directory, and ignores it when omitted", async () => {
        await runTranslate(true);
        expect(exitSpy).not.toHaveBeenCalled();
        expect(translateSrtEntries).toHaveBeenCalledTimes(1);
        expect(hasCacheFiles(customCacheDir)).toBe(true);
        expect(hasCacheFiles(defaultCacheDir)).toBe(false);

        vi.mocked(translateSrtEntries).mockClear();
        await runTranslate(true);
        expect(exitSpy).not.toHaveBeenCalled();
        expect(translateSrtEntries).not.toHaveBeenCalled();

        await runTranslate(false);
        expect(translateSrtEntries).toHaveBeenCalledTimes(1);
        expect(hasCacheFiles(defaultCacheDir)).toBe(true);
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

  describe("init --lang", () => {
    const initLangCases: Array<{
      name: string;
      args: string[];
      expectedLang: string | undefined;
    }> = [
      { name: "vsub --lang en init", args: ["--lang", "en", "init"], expectedLang: "en" },
      {
        name: "vsub --lang en config init",
        args: ["--lang", "en", "config", "init"],
        expectedLang: "en",
      },
      { name: "vsub init --lang en", args: ["init", "--lang", "en"], expectedLang: "en" },
      {
        name: "vsub config init --lang en",
        args: ["config", "init", "--lang", "en"],
        expectedLang: "en",
      },
      { name: "vsub init --lang ja-JP", args: ["init", "--lang", "ja-JP"], expectedLang: "ja" },
      { name: "vsub init --lang xx", args: ["init", "--lang", "xx"], expectedLang: undefined },
      { name: "vsub init (no --lang)", args: ["init"], expectedLang: undefined },
      { name: "vsub config init (no --lang)", args: ["config", "init"], expectedLang: undefined },
    ];

    it.each(initLangCases)(
      "$name passes lang: $expectedLang to runInitWizard",
      async ({ args, expectedLang }) => {
        await runCli(...args);
        expect(runInitWizard).toHaveBeenCalledTimes(1);
        const passedLang = vi.mocked(runInitWizard).mock.calls[0]?.[0]?.lang;
        if (expectedLang === undefined) {
          expect(passedLang).toBeUndefined();
        } else {
          expect(passedLang).toBe(expectedLang);
        }
        expect(exitSpy).not.toHaveBeenCalled();
      },
    );
  });

  describe("embed unsupported container pre-check", () => {
    let stderrOutput = "";
    let stderrSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      stderrOutput = "";
      stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(((
        chunk: string | Uint8Array,
      ) => {
        stderrOutput += chunk.toString();
        return true;
      }) as never);
    });

    afterEach(() => {
      stderrSpy.mockRestore();
    });

    it.each([
      { video: "video.avi", out: undefined, expectedFile: "video.embedded.avi" },
      { video: "video.mp4", out: "out.flv", expectedFile: "out.flv" },
      { video: "video.mp4", out: "out", expectedFile: "out" },
    ])(
      "exits with code 1 and does not embed or back up for $video (out: $out)",
      async ({ video, out, expectedFile }) => {
        const videoPath = path.join(tmpDir, video);
        fs.writeFileSync(videoPath, "");
        const targetPath = path.join(tmpDir, expectedFile);
        fs.writeFileSync(targetPath, "pre-existing");

        const args = ["embed", videoPath, dummySrtPath, "--backup"];
        if (out) {
          args.push("-o", path.join(tmpDir, out));
        }

        await runCli(...args);

        expect(exitSpy).toHaveBeenCalledWith(1);
        expect(embedSubtitlesToVideo).not.toHaveBeenCalled();
        expect(fs.readdirSync(tmpDir).some((f) => f.endsWith(".bak"))).toBe(false);
        expect(stderrOutput).toContain(`Cannot embed subtitle tracks into "${expectedFile}"`);
      },
    );

    it.each([
      {
        name: "English with extension",
        args: ["embed", "video.avi", "dummy.srt"],
        expected:
          'Cannot embed subtitle tracks into "video.embedded.avi": the .avi container does not support soft subtitles (supported: .mp4, .m4v, .mov, .mkv, .webm). Specify an output file with a supported container, for example "-o <name>.mkv".',
      },
      {
        name: "Japanese with extension",
        args: ["--lang", "ja", "embed", "video.avi", "dummy.srt"],
        expected:
          "「video.embedded.avi」には字幕トラックを埋め込めません。.avi のコンテナはソフトサブに対応していません（対応: .mp4, .m4v, .mov, .mkv, .webm）。対応するコンテナの出力先を指定してください（例: -o <名前>.mkv）。",
      },
      {
        name: "English without extension",
        args: ["embed", "video.mp4", "dummy.srt", "-o", "out"],
        expected:
          'Cannot embed subtitle tracks into "out": the (no extension) container does not support soft subtitles (supported: .mp4, .m4v, .mov, .mkv, .webm). Specify an output file with a supported container, for example "-o <name>.mkv".',
      },
      {
        name: "Japanese without extension",
        args: ["--lang", "ja", "embed", "video.mp4", "dummy.srt", "-o", "out"],
        expected:
          "「out」には字幕トラックを埋め込めません。（拡張子なし） のコンテナはソフトサブに対応していません（対応: .mp4, .m4v, .mov, .mkv, .webm）。対応するコンテナの出力先を指定してください（例: -o <名前>.mkv）。",
      },
    ])("formats error message correctly for $name", async ({ args, expected }) => {
      const resolvedArgs = args.map((arg) => {
        if (arg === "video.avi" || arg === "video.mp4") {
          const p = path.join(tmpDir, arg);
          if (!fs.existsSync(p)) fs.writeFileSync(p, "");
          return p;
        }
        if (arg === "dummy.srt") {
          return dummySrtPath;
        }
        if (arg === "out") {
          return path.join(tmpDir, "out");
        }
        return arg;
      });

      await runCli(...resolvedArgs);

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(embedSubtitlesToVideo).not.toHaveBeenCalled();
      expect(stderrOutput).toContain(expected);
    });

    it("rejects when -o points to input video file and does not create backup", async () => {
      await runCli("embed", dummyVideoPath, dummySrtPath, "-o", dummyVideoPath, "--backup");

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(embedSubtitlesToVideo).not.toHaveBeenCalled();
      expect(fs.readdirSync(tmpDir).some((f) => f.endsWith(".bak"))).toBe(false);
      expect(stderrOutput).toContain(`Cannot write "${path.basename(dummyVideoPath)}"`);
    });

    it("proceeds to embed when container is supported (-o out.mkv)", async () => {
      const outMkv = path.join(tmpDir, "out.mkv");
      await runCli("embed", dummyVideoPath, dummySrtPath, "-o", outMkv);

      expect(embedSubtitlesToVideo).toHaveBeenCalledWith(
        dummyVideoPath,
        expect.anything(),
        outMkv,
        expect.anything(),
      );
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it("displays updated description for root -o option", () => {
      const program = createProgram();
      const outputOption = program.options.find(
        (opt) => opt.attributeName() === "output" || opt.long === "--output",
      );
      expect(outputOption).toBeDefined();
      expect(outputOption?.description).toBe(
        "Output path or base name for the generated subtitle file(s); with --embed or --burn and a video path (e.g. out.mkv), subtitles are saved as out.<lang>.<format>",
      );
    });

    it.each([
      {
        cmd: "root",
        args: ["video.mp4", "--stt-provider", "openrouter", "--stt-model", "m1"],
        getMock: () => processMediaPipeline,
        expected: { sttProvider: "openrouter", sttModel: "m1" },
      },
      {
        cmd: "batch",
        args: ["batch", "./videos", "--stt-provider", "openrouter", "--stt-model", "m1"],
        getMock: () => runBatchPipeline,
        expected: { sttProvider: "openrouter", sttModel: "m1" },
      },
      {
        cmd: "chapters",
        args: ["chapters", "dummy.mp4", "--stt-provider", "openrouter", "--stt-model", "m1"],
        getMock: () => processChaptersPipeline,
        expected: { sttProvider: "openrouter", sttModel: "m1" },
      },
      {
        cmd: "summarize",
        args: ["summarize", "dummy.mp4", "--stt-provider", "openrouter", "--stt-model", "m1"],
        getMock: () => processSummaryPipeline,
        expected: { sttProvider: "openrouter", sttModel: "m1" },
      },
    ])(
      "passes --stt-provider and --stt-model to $cmd pipeline",
      async ({ args, getMock, expected }) => {
        const resolvedArgs = args.map((a) => (a === "dummy.mp4" ? dummyVideoPath : a));
        await runCli(...resolvedArgs);
        expect(getMock()).toHaveBeenCalledWith(expect.objectContaining(expected));
      },
    );

    it.each([
      {
        cmd: "root",
        args: [
          "video.mp4",
          "--llm-provider",
          "openrouter",
          "--llm-model",
          "google/gemini-3.8-flash",
        ],
        getMock: () => processMediaPipeline,
        expected: { llmProvider: "openrouter", llmModel: "google/gemini-3.8-flash" },
      },
      {
        cmd: "batch",
        args: [
          "batch",
          "./videos",
          "--llm-provider",
          "openrouter",
          "--llm-model",
          "google/gemini-3.8-flash",
        ],
        getMock: () => runBatchPipeline,
        expected: { llmProvider: "openrouter", llmModel: "google/gemini-3.8-flash" },
      },
      {
        cmd: "chapters",
        args: [
          "chapters",
          "dummy.mp4",
          "--llm-provider",
          "openrouter",
          "--llm-model",
          "google/gemini-3.8-flash",
        ],
        getMock: () => processChaptersPipeline,
        expected: { llmProvider: "openrouter", llmModel: "google/gemini-3.8-flash" },
      },
      {
        cmd: "summarize",
        args: [
          "summarize",
          "dummy.mp4",
          "--llm-provider",
          "openrouter",
          "--llm-model",
          "google/gemini-3.8-flash",
        ],
        getMock: () => processSummaryPipeline,
        expected: { llmProvider: "openrouter", llmModel: "google/gemini-3.8-flash" },
      },
    ])(
      "passes --llm-provider and --llm-model to $cmd pipeline",
      async ({ args, getMock, expected }) => {
        const resolvedArgs = args.map((a) => (a === "dummy.mp4" ? dummyVideoPath : a));
        await runCli(...resolvedArgs);
        expect(getMock()).toHaveBeenCalledWith(expect.objectContaining(expected));
      },
    );

    it("passes --llm-provider and --llm-model to translate command", async () => {
      await runCli(
        "translate",
        dummySrtPath,
        "-t",
        "ja",
        "--llm-provider",
        "openrouter",
        "--llm-model",
        "google/gemini-3.8-flash",
      );
      expect(translateSrtEntries).toHaveBeenCalled();
      const model = vi.mocked(translateSrtEntries).mock.calls[0]?.[2];
      expect(model?.logLabel).toBe("OpenRouter API");
      expect(model?.model).toBe("google/gemini-3.8-flash");
    });
  });

  describe("config set and show STT provider options", () => {
    it("saves openrouterApiKey, sttProvider, and openrouterSttModel when provided", async () => {
      await runCli(
        "config",
        "set",
        "--openrouter-key",
        "sk-or-v1-dummykey12345678",
        "--stt-provider",
        "OpenRouter",
        "--openrouter-stt-model",
        "custom/scribe-model",
      );

      expect(saveGlobalConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          openrouterApiKey: "sk-or-v1-dummykey12345678",
          sttProvider: "openrouter",
          openrouterSttModel: "custom/scribe-model",
        }),
        expect.anything(),
      );
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it("exits with code 1 and does not save config when stt-provider is invalid", async () => {
      let stderrOutput = "";
      const errorSpy = vi.spyOn(console, "error").mockImplementation((msg: unknown) => {
        stderrOutput += String(msg);
      });

      await runCli("config", "set", "--stt-provider", "foo");

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(saveGlobalConfig).not.toHaveBeenCalled();
      expect(stderrOutput).toContain("foo");
      errorSpy.mockRestore();
    });

    describe("config show", () => {
      afterEach(() => {
        vi.mocked(getConfig).mockReturnValue(mockConfig);
      });

      it("displays Groq auto transcription when only Groq API key is configured", async () => {
        vi.mocked(getConfig).mockReturnValue({
          ...mockConfig,
          groqApiKey: "gsk_testgroqkey12345678",
          openrouterApiKey: undefined,
        });

        await runCli("config", "show");

        const logged = logSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
        expect(logged).toContain("Transcription      : Groq (whisper-large-v3-turbo) [auto]");
        expect(logged).toContain("OpenRouter API Key : (Not configured)");
        expect(logged).not.toContain("gsk_testgroqkey12345678");
      });

      it("displays OpenRouter auto transcription and masked key when OpenRouter API key is configured", async () => {
        vi.mocked(getConfig).mockReturnValue({
          ...mockConfig,
          groqApiKey: "",
          openrouterApiKey: "sk-or-v1-openroutersecret1234",
          openrouterSttModel: "elevenlabs/scribe-v2",
        });

        await runCli("config", "show");

        const logged = logSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
        expect(logged).toContain("Transcription      : OpenRouter (elevenlabs/scribe-v2) [auto]");
        expect(logged).toContain("OpenRouter API Key : sk-o...1234");
        expect(logged).toContain("OpenRouter STT Model : elevenlabs/scribe-v2");
        expect(logged).not.toContain("sk-or-v1-openroutersecret1234");
      });

      it("displays invalid provider message without throwing when sttProvider is invalid", async () => {
        vi.mocked(getConfig).mockReturnValue({
          ...mockConfig,
          sttProvider: "bar",
        });

        await runCli("config", "show");

        const logged = logSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
        expect(logged).toContain('Transcription      : invalid provider "bar"');
        expect(exitSpy).not.toHaveBeenCalled();
      });
    });
  });

  describe("config set and show LLM provider options", () => {
    it.each([
      {
        name: "--llm-provider only",
        args: ["--llm-provider", "OpenRouter"],
        expectedSaved: { llmProvider: "openrouter" },
        unexpectedKeys: ["openrouterLlmModel"],
      },
      {
        name: "--openrouter-llm-model only",
        args: ["--openrouter-llm-model", "custom/llm-model"],
        expectedSaved: { openrouterLlmModel: "custom/llm-model" },
        unexpectedKeys: ["llmProvider"],
      },
      {
        name: "both --llm-provider and --openrouter-llm-model",
        args: ["--llm-provider", "OpenRouter", "--openrouter-llm-model", "custom/llm-model"],
        expectedSaved: {
          llmProvider: "openrouter",
          openrouterLlmModel: "custom/llm-model",
        },
        unexpectedKeys: [],
      },
    ])("saves settings when $name is provided", async ({ args, expectedSaved, unexpectedKeys }) => {
      await runCli("config", "set", ...args);

      expect(saveGlobalConfig).toHaveBeenCalledWith(
        expect.objectContaining(expectedSaved),
        expect.anything(),
      );
      const saved = vi.mocked(saveGlobalConfig).mock.calls[0]?.[0] as Record<string, unknown>;
      for (const key of unexpectedKeys) {
        expect(saved[key]).toBeUndefined();
      }
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it("exits with code 1 and does not save config when llm-provider is invalid", async () => {
      let stderrOutput = "";
      const errorSpy = vi.spyOn(console, "error").mockImplementation((msg: unknown) => {
        stderrOutput += String(msg);
      });

      await runCli("config", "set", "--llm-provider", "foo");

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(saveGlobalConfig).not.toHaveBeenCalled();
      expect(stderrOutput).toContain("foo");
      errorSpy.mockRestore();
    });

    describe("config show", () => {
      afterEach(() => {
        vi.mocked(getConfig).mockReturnValue(mockConfig);
      });

      it("displays Gemini auto text generation when Gemini API key is configured", async () => {
        vi.mocked(getConfig).mockReturnValue({
          ...mockConfig,
          geminiApiKey: "test-gemini-key",
          llmProvider: undefined,
        });

        await runCli("config", "show");

        const logged = logSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
        expect(logged).toContain("Text Generation    : Gemini (gemini-3.8-flash) [auto]");
      });

      it("displays OpenRouter auto text generation when Gemini API key is missing", async () => {
        vi.mocked(getConfig).mockReturnValue({
          ...mockConfig,
          geminiApiKey: "",
          llmProvider: undefined,
        });

        await runCli("config", "show");

        const logged = logSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
        expect(logged).toContain(
          "Text Generation    : OpenRouter (google/gemini-3.8-flash) [auto]",
        );
      });

      it("displays OpenRouter setting and OpenRouter LLM Model when configured", async () => {
        const originalEnv = process.env;
        process.env = {
          ...originalEnv,
          VSUB_LLM_PROVIDER: "openrouter",
          VSUB_OPENROUTER_LLM_MODEL: "custom/llm-model",
        };
        try {
          vi.mocked(getConfig).mockReturnValue({
            ...mockConfig,
            llmProvider: "openrouter",
            openrouterLlmModel: "custom/llm-model",
          });

          await runCli("config", "show");

          const logged = logSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
          expect(logged).toContain("Text Generation    : OpenRouter (custom/llm-model) [setting]");
          expect(logged).toContain("OpenRouter LLM Model : custom/llm-model");
        } finally {
          process.env = originalEnv;
        }
      });

      it("displays invalid provider message without throwing when llmProvider is invalid", async () => {
        vi.mocked(getConfig).mockReturnValue({
          ...mockConfig,
          llmProvider: "bar" as unknown as "gemini",
        });

        await runCli("config", "show");

        const logged = logSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
        expect(logged).toContain('Text Generation    : invalid provider "bar"');
        expect(exitSpy).not.toHaveBeenCalled();
      });
    });
  });

  describe("command help descriptions", () => {
    const prohibitedPhrases = [
      "via Gemini API",
      "for Gemini translation",
      "to Gemini API",
      "Force Gemini translation",
    ];

    it.each([
      {
        name: "main program",
        getHelp: () => createProgram().helpInformation(),
        expectedPhrases: [
          "CLI tool to extract audio from video/audio files, transcribe speech via OpenRouter (ElevenLabs Scribe v2, default) or Groq Whisper, and generate multilingual subtitles (.srt, .vtt, .txt, .json) via Gemini directly or through OpenRouter.",
          "Additional instruction prompt for translation",
          "Number of concurrent translation requests",
          "Gemini model to use for translation (Gemini provider only)",
          "Force translation even if detected language matches target language",
        ],
      },
      {
        name: "batch subcommand",
        getHelp: () => {
          const prog = createProgram();
          return prog.commands.find((c) => c.name() === "batch")?.helpInformation() ?? "";
        },
        expectedPhrases: [
          "Additional instruction prompt for translation",
          "Number of concurrent translation requests",
          "Gemini model to use for translation (Gemini provider only)",
          "Force translation even if detected language matches target language",
        ],
      },
      {
        name: "chapters subcommand",
        getHelp: () => {
          const prog = createProgram();
          return prog.commands.find((c) => c.name() === "chapters")?.helpInformation() ?? "";
        },
        expectedPhrases: [
          "Generate video chapters (table of contents) from media or subtitle files via Gemini or OpenRouter",
          "Additional instruction prompt for chapter generation",
          "Gemini model to use for chapters generation (Gemini provider only)",
        ],
      },
      {
        name: "summarize subcommand",
        getHelp: () => {
          const prog = createProgram();
          return prog.commands.find((c) => c.name() === "summarize")?.helpInformation() ?? "";
        },
        expectedPhrases: [
          "Generate structured summary and key topic highlights from media or subtitle files via Gemini or OpenRouter",
          "Additional instruction prompt for summary generation",
          "Gemini model to use for summary generation (Gemini provider only)",
        ],
      },
      {
        name: "translate subcommand",
        getHelp: () => {
          const prog = createProgram();
          return prog.commands.find((c) => c.name() === "translate")?.helpInformation() ?? "";
        },
        expectedPhrases: [
          "Directly translate an existing subtitle file (.srt) into target language(s) via Gemini or OpenRouter",
          "Additional instruction prompt for translation",
          "Number of concurrent translation requests",
          "Gemini model to use for translation (Gemini provider only)",
        ],
      },
      {
        name: "config set subcommand",
        getHelp: () => {
          const prog = createProgram();
          const configCmd = prog.commands.find((c) => c.name() === "config");
          return configCmd?.commands.find((c) => c.name() === "set")?.helpInformation() ?? "";
        },
        expectedPhrases: [
          "Default translation instruction prompt",
          "Default concurrent translation requests (e.g. 3)",
          "OpenRouter API Key (for transcription and text generation)",
          "Default text generation provider: gemini or openrouter",
          "Default OpenRouter text generation model (e.g. google/gemini-3.8-flash)",
        ],
      },
      {
        name: "init subcommand",
        getHelp: () => {
          const prog = createProgram();
          return prog.commands.find((c) => c.name() === "init")?.helpInformation() ?? "";
        },
        expectedPhrases: [
          "Interactive setup wizard to choose the transcription and text generation providers and verify API keys, FFmpeg, and preferences",
        ],
      },
    ])("verifies help text for $name", ({ getHelp, expectedPhrases }) => {
      const help = getHelp();
      const normalizedHelp = help.replace(/\s+/g, " ");
      for (const phrase of expectedPhrases) {
        expect(normalizedHelp).toContain(phrase.replace(/\s+/g, " "));
      }
      for (const prohibited of prohibitedPhrases) {
        expect(help).not.toContain(prohibited);
      }
    });
  });
});
