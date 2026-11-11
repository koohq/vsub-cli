import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { stripVTControlCharacters } from "node:util";
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
import { getI18n } from "./i18n/index.js";
import { runInitWizard } from "./init.js";
import {
  processChaptersPipeline,
  processMediaPipeline,
  processSummaryPipeline,
} from "./pipeline.js";
import { parseSrt, reflowSrtEntries, stringifySrt } from "./srt.js";
import { isolateConfigAndEnv } from "./test-support/isolate-config-env.js";
import { DEFAULT_CONTEXT_WINDOW_SIZE, translateSrtEntries } from "./text/tasks.js";
import { getTranslationResumeHint, TranslationStoppedError } from "./translation.js";
import * as ui from "./ui.js";
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

vi.mock("./config.js", async (importOriginal) => {
  return {
    ...(await importOriginal<typeof import("./config.js")>()),
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
    performSelfUpdate: vi.fn(),
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

  describe("chapters, summarize and reflow limit options", () => {
    afterEach(() => {
      vi.mocked(getConfig).mockReturnValue(mockConfig);
    });

    describe.each([
      { command: "chapters", format: "txt", getMock: () => processChaptersPipeline },
      { command: "summarize", format: "md", getMock: () => processSummaryPipeline },
    ])("$command arguments", ({ command, format, getMock }) => {
      it.each([undefined, "Term A=用語A"])("forwards glossary %s", async (glossary) => {
        await runCli(command, "sample.srt", ...(glossary ? ["--glossary", glossary] : []));
        expect(getMock()).toHaveBeenCalledWith(expect.objectContaining({ glossary }));
      });

      it("documents glossary immediately after prompt", () => {
        const subcommand = createProgram().commands.find((item) => item.name() === command);
        const help = stripVTControlCharacters(subcommand?.helpInformation() ?? "");
        const destination = command === "chapters" ? "chapter titles" : "the summary";
        expect(help).toContain("--glossary <path-or-terms>");
        expect(help.replace(/\s+/g, " ")).toContain(
          `Glossary file path (JSON) or inline terms (key=val,key=val) for names and terms in ${destination} and Groq recognition hints (default: VSUB_GLOSSARY or config)`,
        );
        const optionNames = subcommand?.options.map((option) => option.long) ?? [];
        expect(optionNames[optionNames.indexOf("--prompt") + 1]).toBe("--glossary");
      });
      it.each([false, true])("pins all pipeline fields (explicit: %s)", async (explicit) => {
        await runCli(
          command,
          "sample.srt",
          ...(explicit
            ? [
                "-t",
                "en",
                "-f",
                "json",
                "-o",
                "result.json",
                "--stdout",
                "--prompt",
                "test prompt",
                "--gemini-model",
                "test-gemini",
                "--llm-provider",
                "openrouter",
                "--llm-model",
                "test-llm",
                "--stt-provider",
                "groq",
                "--stt-model",
                "test-stt",
                "--groq-model",
                "test-groq",
                "--whisper-prompt",
                "test hint",
                "-w",
                "--backup",
                "--no-cache",
                "--fresh",
                "--cache-dir",
                "test-cache",
                "--verbose",
                "--lang",
                "ja",
                "--no-update-check",
              ]
            : []),
        );
        expect(getMock()).toHaveBeenCalledExactlyOnceWith({
          inputFile: "sample.srt",
          targetLang: explicit ? "en" : undefined,
          format: explicit ? "json" : format,
          output: explicit ? "result.json" : undefined,
          stdout: explicit,
          prompt: explicit ? "test prompt" : undefined,
          glossary: undefined,
          geminiModel: explicit ? "test-gemini" : undefined,
          llmProvider: explicit ? "openrouter" : undefined,
          llmModel: explicit ? "test-llm" : undefined,
          sttProvider: explicit ? "groq" : undefined,
          sttModel: explicit ? "test-stt" : undefined,
          groqModel: explicit ? "test-groq" : undefined,
          whisperPrompt: explicit ? "test hint" : undefined,
          overwrite: explicit,
          backup: explicit,
          noCache: explicit,
          fresh: explicit,
          cacheDir: explicit ? "test-cache" : undefined,
          verbose: explicit,
          lang: explicit ? "ja" : "en",
        });
        expect(exitSpy).not.toHaveBeenCalled();
      });
    });

    it.each(["12.7", "0", "abc"])("pins config set --max-length %s", async (value) => {
      await runCli("config", "set", "--max-length", value);
      if (value === "12.7") {
        expect(saveGlobalConfig).toHaveBeenCalledExactlyOnceWith(
          { maxLength: 12 },
          expect.anything(),
        );
      } else {
        expect(saveGlobalConfig).not.toHaveBeenCalled();
      }
    });

    it.each(["12.7", "0", "abc", "-1"])("pins translate reflow limits %s", async (value) => {
      vi.mocked(getConfig).mockReturnValue({ ...mockConfig, maxLength: 42 });
      await runCli(
        "translate",
        dummySrtPath,
        "--max-length",
        value,
        "--max-duration",
        value,
        "--no-cache",
      );
      expect(reflowSrtEntries).toHaveBeenCalledWith(expect.anything(), {
        maxLength: value === "12.7" ? 12 : 42,
        maxDuration: value === "12.7" ? 12 : undefined,
      });
      expect(exitSpy).not.toHaveBeenCalled();
    });
  });

  describe("localized command output", () => {
    let errorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
      errorSpy.mockRestore();
      vi.mocked(getConfig).mockReturnValue(mockConfig);
    });

    function output(): string {
      return stripVTControlCharacters(
        logSpy.mock.calls.map(([text]: unknown[]) => String(text)).join("\n"),
      );
    }

    describe.each(["en", "ja"] as const)("%s failure notices", (lang) => {
      it.each([false, true])(
        "keeps the translate failure before the hint and stack (verbose: %s)",
        async (verbose) => {
          const spinner = ui.createSpinner("", { isSilent: true });
          const fail = vi.spyOn(spinner, "fail");
          const createSpinner = vi.spyOn(ui, "createSpinner").mockReturnValue(spinner);
          const error = new TranslationStoppedError(new Error("Unavailable"), "ja", 1, 3);
          vi.mocked(translateSrtEntries).mockRejectedValueOnce(error);
          try {
            await runCli(
              "translate",
              dummySrtPath,
              "--no-cache",
              "-l",
              lang,
              ...(verbose ? ["--verbose"] : []),
            );
            const text = getI18n(lang).pipeline.errorOccurred(error.message);
            const lines = errorSpy.mock.calls.map(([line]: unknown[]) =>
              stripVTControlCharacters(String(line)),
            );
            if (verbose) {
              expect(lines).toEqual([
                `✖ ${text}`,
                getTranslationResumeHint(error, lang),
                error.stack,
              ]);
              expect(fail).not.toHaveBeenCalled();
            } else {
              expect(fail).toHaveBeenCalledExactlyOnceWith(text);
              expect(lines).toEqual([getTranslationResumeHint(error, lang)]);
            }
            expect(exitSpy).toHaveBeenCalledExactlyOnceWith(1);
          } finally {
            createSpinner.mockRestore();
          }
        },
      );

      it.each(["burn", "embed", "update"] as const)(
        "prints the %s failure when verbose",
        async (command) => {
          if (command === "update") {
            const { isStandaloneBinary, performSelfUpdate } = await import("./updater.js");
            vi.mocked(isStandaloneBinary).mockReturnValueOnce(true);
            vi.mocked(performSelfUpdate).mockRejectedValueOnce(new Error("Unavailable"));
          }
          // Missing input deterministically exercises the burn/embed catch before ffmpeg runs.
          const missing = path.join(tmpDir, "missing.mp4");
          await runCli(
            command,
            ...(command === "update" ? [] : [missing, dummySrtPath]),
            "--verbose",
            "-l",
            lang,
          );
          const lines = errorSpy.mock.calls.map(([line]: unknown[]) =>
            stripVTControlCharacters(String(line)),
          );
          expect(lines[0]).toBe(
            command === "update"
              ? "✖ Unavailable"
              : `✖ ${getI18n(lang).pipeline.errorOccurred(getI18n(lang)[command].videoNotFound(missing))}`,
          );
          expect(exitSpy).toHaveBeenCalledExactlyOnceWith(1);
        },
      );
    });

    it.each([true, false])(
      "prints the media checkpoint hint immediately after the failure (stopped: %s)",
      async (stopped) => {
        const error = stopped
          ? new TranslationStoppedError(new Error("Unavailable"), "ja", 1, 3)
          : new Error("Unavailable");
        vi.mocked(processMediaPipeline).mockRejectedValueOnce(error);
        await runCli(dummyVideoPath);
        const lines: string[] = errorSpy.mock.calls.flat().map(String).join("\n").split("\n");
        const index = lines.findIndex((line) =>
          line.includes("An error occurred during processing: Unavailable"),
        );
        expect(index).toBeGreaterThanOrEqual(0);
        if (stopped) expect(lines[index + 1]).toBe(getTranslationResumeHint(error, "en"));
        else expect(lines.join("\n")).not.toContain("Run the same command");
        expect(exitSpy).toHaveBeenCalledWith(1);
      },
    );

    function expectAlignedRows(): void {
      const rows = output()
        .split("\n")
        .filter((line) => line.includes(" : "));
      expect(rows.length).toBeGreaterThan(1);
      expect(new Set(rows.map((line) => ui.displayWidth(line.split(" : ")[0] ?? ""))).size).toBe(1);
    }

    it.each([
      { args: ["-l", "ja", "config", "show"], explicit: true },
      { args: ["config", "show", "-l", "ja"], explicit: true },
      { args: ["config", "show", "--lang", "ja"], explicit: true },
      { args: ["config", "show"], explicit: false },
    ])("localizes config show with $args", async ({ args, explicit }) => {
      vi.mocked(getConfig).mockReturnValue({
        ...mockConfig,
        lang: explicit ? "en" : "ja",
        groqApiKey: "",
        geminiApiKey: "",
        openrouterApiKey: "",
      });
      await runCli(...args);
      for (const text of ["📁 設定ファイル:", "表示言語", "(未設定)", "有効"]) {
        expect(output()).toContain(text);
      }
      expect(output()).not.toMatch(/Display Language|Not configured/);
      expectAlignedRows();
    });

    describe.each(["en", "ja"] as const)("config show widths in %s", (lang) => {
      it.each([false, true])("uses only displayed labels (long model: %s)", async (longModel) => {
        vi.mocked(getConfig).mockReturnValue({
          ...mockConfig,
          groqApiKey: "",
          geminiApiKey: "",
          openrouterApiKey: "",
          ...(longModel ? { openrouterSttModel: "test-stt-model" } : {}),
        });
        await runCli("config", "show", "-l", lang);
        const rows = output()
          .split("\n")
          .filter((line) => line.includes(" : "));
        const labels = rows.map((line) => line.split(" : ")[0] ?? "");
        const expected = Math.max(...labels.map((label) => ui.displayWidth(label.trimEnd()))) + 1;
        expect(labels.length).toBeGreaterThan(1);
        for (const label of labels) expect(ui.displayWidth(label) + 1).toBe(expected);
        const modelLabel = getI18n(lang).config.showLabels.openrouterSttModel;
        expect(output().includes(modelLabel)).toBe(longModel);
      });
    });

    it.each([
      { args: ["config", "path"], text: "設定ファイルのパス:" },
      { args: ["cache", "path"], text: "キャッシュのフォルダ:" },
      { args: ["cache", "stats"], text: "ファイル数 : 0 件" },
      { args: ["cache", "clean"], text: "キャッシュのファイルを 0 件消しました" },
    ])("localizes $args", async ({ args, text }) => {
      await runCli("-l", "ja", ...args, ...(args[0] === "cache" ? ["--cache-dir", tmpDir] : []));
      expect(output()).toContain(text);
      if (args[1] === "stats") expectAlignedRows();
    });

    it("localizes config path with a trailing language option", async () => {
      await runCli("config", "path", "-l", "ja");
      expect(stripVTControlCharacters(output())).toContain("設定ファイルのパス:");
    });

    it("accepts hidden global options on every leaf command", () => {
      function checkLeaves(command: ReturnType<typeof createProgram>): void {
        if (command.commands.length > 0) {
          for (const child of command.commands) checkLeaves(child);
          return;
        }
        expect(
          command.options.map((option) => option.long),
          command.name(),
        ).toContain("--lang");
        expect(
          command.options.map((option) => option.long),
          command.name(),
        ).toContain("--no-update-check");
      }
      checkLeaves(createProgram());
    });

    it("keeps the language option hidden in config show help", () => {
      const config = createProgram().commands.find((command) => command.name() === "config");
      const show = config?.commands.find((command) => command.name() === "show");
      expect(show).toBeDefined();
      const help = stripVTControlCharacters(show?.helpInformation() ?? "");
      expect(help).not.toContain("--lang");
      expect(help).not.toContain("-l,");
    });

    it.each(["en", "ja"] as const)("aligns cache stats in %s", async (lang) => {
      await runCli("-l", lang, "cache", "stats", "--cache-dir", tmpDir);
      expectAlignedRows();
      expect(output()).toContain(
        lang === "ja" ? "📁 キャッシュのフォルダ:" : "📁 Cache Directory:",
      );
    });

    it("uses the saved language for config set guidance and invalid language errors", async () => {
      vi.mocked(getConfig).mockReturnValue({ ...mockConfig, lang: "ja" });
      await runCli("config", "set");
      expect(output()).toContain("保存する設定を指定してください");
      await runCli("config", "set", "--lang", "xx");
      expect(errorSpy.mock.calls.flat().join("\n")).toContain("表示言語が正しくありません");
      expect(saveGlobalConfig).not.toHaveBeenCalled();
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it("uses the newly selected language for the save confirmation", async () => {
      await runCli("config", "set", "--lang", "ja", "--max-length", "40");
      expect(output()).toContain("✅ 設定を保存しました:");
      expect(saveGlobalConfig).toHaveBeenCalledWith(
        expect.objectContaining({ lang: "ja", maxLength: 40 }),
        expect.anything(),
      );
    });

    it.each([
      { command: "chapters", text: "サポートされていないチャプターの形式です" },
      { command: "summarize", text: "サポートされていない要約の形式です" },
    ])("localizes invalid $command formats", async ({ command, text }) => {
      await runCli("-l", "ja", command, dummySrtPath, "-f", "xxx");
      expect(errorSpy.mock.calls.flat().join("\n")).toContain(text);
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

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

  describe("verbose stdout reflow", () => {
    it.each(["translate", "main"])("writes only the subtitle result for %s", async (command) => {
      const content =
        "1\n00:00:00,000 --> 00:00:10,000\nThis is a deliberately long dummy subtitle line with several words.\n";
      fs.writeFileSync(dummySrtPath, content);
      const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
      const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        if (command === "translate") {
          await runCli(
            "translate",
            dummySrtPath,
            "--stdout",
            "--verbose",
            "--no-cache",
            "--max-length",
            "12",
          );
        } else {
          const actual = await vi.importActual<typeof import("./pipeline.js")>("./pipeline.js");
          vi.mocked(processMediaPipeline).mockImplementationOnce(actual.processMediaPipeline);
          vi.mocked(loadMediaCache).mockReturnValueOnce({
            version: 2,
            mediaPath: dummyVideoPath,
            mediaSize: 0,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            transcription: {
              entries: parseSrt(content),
              detectedLanguage: "en",
              createdAt: Date.now(),
            },
          });
          await runCli(
            dummyVideoPath,
            "--stdout",
            "--verbose",
            "--no-translate",
            "--max-length",
            "12",
            "--stt-provider",
            "groq",
          );
        }
        const entries = reflowSrtEntries(parseSrt(content), { maxLength: 12 });
        expect(entries.length).toBeGreaterThan(1);
        expect(stdout).toHaveBeenCalledExactlyOnceWith(stringifySrt(entries));
        expect(logSpy).not.toHaveBeenCalled();
        expect(stderr.mock.calls.map(([line]) => stripVTControlCharacters(String(line)))).toContain(
          `[Reflow] Adjusted subtitle segments: 1 -> ${entries.length} entries`,
        );
        expect(exitSpy).not.toHaveBeenCalled();
      } finally {
        stdout.mockRestore();
        stderr.mockRestore();
      }
    });
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
    {
      flag: "--refine",
      prop: "refine" as const,
      command: "main",
      args: ["video.mp4"],
      getMock: () => processMediaPipeline,
    },
    {
      flag: "--refine",
      prop: "refine" as const,
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

  describe.each([
    { command: "main", args: ["video.mp4"], getMock: () => processMediaPipeline },
    { command: "batch", args: ["batch", "videos"], getMock: () => runBatchPipeline },
  ])("$command refinement flags", ({ args, getMock }) => {
    it.each([
      { flags: [], expected: undefined },
      { flags: ["--refine"], expected: true },
      { flags: ["--no-refine"], expected: false },
      { flags: ["--refine", "--no-refine"], expected: false },
      { flags: ["--no-refine", "--refine"], expected: true },
    ])("passes $flags as $expected", async ({ flags, expected }) => {
      await runCli(...args, ...flags);
      const mock = vi.mocked(getMock());
      expect(mock).toHaveBeenCalledTimes(1);
      expect(mock.mock.calls[0]?.[0].refine).toBe(expected);
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
      const spinnerSucceedSpy = vi.fn();

      function mockCacheWithTranslation(cached: ReturnType<typeof createCachedTranslation>): void {
        vi.mocked(loadMediaCache).mockReturnValue({
          version: 2,
          mediaPath: path.resolve(dummySrtPath),
          mediaSize: 100,
          translations: {
            [cached.targetLang.toLowerCase()]: cached,
          },
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      }

      beforeEach(() => {
        sourceEntries = parseSrt(fs.readFileSync(dummySrtPath, "utf-8"));
        vi.spyOn(ui, "createSpinner").mockReturnValue({
          start: vi.fn().mockReturnThis(),
          succeed: spinnerSucceedSpy.mockReturnThis(),
          fail: vi.fn().mockReturnThis(),
          warn: vi.fn().mockReturnThis(),
          info: vi.fn().mockReturnThis(),
          updateText: vi.fn().mockReturnThis(),
          stop: vi.fn().mockReturnThis(),
        });
      });

      afterEach(() => {
        vi.mocked(loadMediaCache).mockReturnValue(null);
        vi.mocked(ui.createSpinner).mockRestore();
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
        expect(spinnerSucceedSpy).toHaveBeenCalledWith(
          "🌐 [2/3] Gemini translation complete (JA) - 2 lines [⚡ Cached]",
        );
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
        expect(spinnerSucceedSpy).toHaveBeenCalledWith(
          "🌐 [2/3] Gemini translation complete (JA) - 2 lines",
        );

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
    it.each([false, true])("shows the language option in init help (config alias: %s)", (alias) => {
      const program = createProgram();
      const parent = alias
        ? program.commands.find((command) => command.name() === "config")
        : program;
      const init = parent?.commands.find((command) => command.name() === "init");
      expect(init).toBeDefined();
      const help = stripVTControlCharacters(init?.helpInformation() ?? "");
      expect(help).toContain("-l, --lang <lang>");
      expect(help).toContain("UI display language (en, ja)");
      expect(help).not.toContain("--no-update-check");
    });

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

      it.each([false, true])(
        "aligns every config row with optional settings present: %s",
        async (withOptional) => {
          vi.mocked(getConfig).mockReturnValue({
            ...mockConfig,
            ...(withOptional
              ? {
                  whisperPrompt: "test hint",
                  prompt: "test prompt",
                  glossary: "test=example",
                  geminiModel: "test-gemini",
                  groqModel: "test-groq",
                  openrouterSttModel: "test/stt",
                  openrouterLlmModel: "test/llm",
                  concurrency: 3,
                  maxLength: 42,
                  burnPosition: "top",
                  burnFontSize: 24,
                }
              : {}),
          });
          await runCli("config", "show");
          const rows: string[] = logSpy.mock.calls
            .map(([text]: unknown[]) => stripVTControlCharacters(String(text)))
            .filter((line: string) => line.includes(":") && !line.includes("Config File:"));
          expect(rows.length).toBe(withOptional ? 21 : 10);
          expect(rows.map((line) => ui.displayWidth(line.slice(0, line.indexOf(":"))))).toEqual(
            rows.map(
              () => (withOptional ? "OpenRouter STT Model" : "OpenRouter API Key").length + 1,
            ),
          );
        },
      );

      it.each([
        { lang: "en", withModel: true },
        { lang: "en", withModel: false },
        { lang: "ja", withModel: true },
        { lang: "ja", withModel: false },
      ] as const)(
        "displays concurrency in order ($lang, model: $withModel)",
        async ({ lang, withModel }) => {
          vi.mocked(getConfig).mockReturnValue({
            ...mockConfig,
            lang,
            concurrency: 3,
            groqModel: "test-groq",
            ...(withModel ? { openrouterLlmModel: "test/llm" } : {}),
            maxLength: 42,
          });
          await runCli("config", "show");
          const lines = stripVTControlCharacters(logSpy.mock.calls.flat().join("\n")).split("\n");
          const labels = getI18n(lang).config.showLabels;
          const index = lines.findIndex((line) =>
            line.startsWith(lang === "en" ? "Concurrency " : "並行数 "),
          );
          expect(index).toBeGreaterThanOrEqual(0);
          expect(lines[index]?.split(" : ")[1]).toBe("3");
          expect(lines[index - 1]).toContain(
            withModel ? labels.openrouterLlmModel : labels.groqModel,
          );
          for (const label of [labels.maxLength, labels.updateCheck]) {
            expect(lines.findIndex((line) => line.startsWith(label))).toBeGreaterThan(index);
          }
        },
      );

      it.each(["en", "ja"] as const)("omits unset concurrency in %s", async (lang) => {
        vi.mocked(getConfig).mockReturnValue({ ...mockConfig, lang, concurrency: undefined });
        await runCli("config", "show");
        const printed = stripVTControlCharacters(logSpy.mock.calls.flat().join("\n"));
        expect(printed).not.toMatch(/Concurrency|並行数/);
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
        expect(logged).toContain("Transcription        : OpenRouter (elevenlabs/scribe-v2) [auto]");
        expect(logged).toContain("OpenRouter API Key   : sk-o...1234");
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

  describe("config saved settings", () => {
    const originalEnv = process.env;
    let configPath: string;
    let errorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(async () => {
      process.env = { ...originalEnv };
      isolateConfigAndEnv(tmpDir);
      const actual = await vi.importActual<typeof import("./config.js")>("./config.js");
      configPath = actual.getGlobalConfigPath();
      vi.mocked(getConfig).mockImplementation(actual.getConfig);
      vi.mocked(saveGlobalConfig).mockImplementation(actual.saveGlobalConfig);
      errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
      process.env = originalEnv;
      vi.mocked(getConfig).mockReset().mockReturnValue(mockConfig);
      vi.mocked(saveGlobalConfig).mockReset();
      errorSpy.mockRestore();
    });

    function placeConfig(config: object): void {
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(configPath, JSON.stringify(config), "utf8");
    }

    it.each([
      { input: "TRUE", expected: true },
      { input: " 1 ", expected: true },
      { input: "0", expected: false },
      { input: "false", expected: false },
    ])("saves refinement $input as a boolean", async ({ input, expected }) => {
      placeConfig({ prompt: "test prompt" });
      await runCli("config", "set", "--refine", input);
      expect(JSON.parse(fs.readFileSync(configPath, "utf8"))).toEqual({
        prompt: "test prompt",
        refine: expected,
      });
      const output = stripVTControlCharacters(logSpy.mock.calls.flat().join("\n"));
      expect(output).toContain(getI18n("en").config.setSaved(""));
      expect(output).not.toContain(getI18n("en").config.setNothing);
      expect(exitSpy).not.toHaveBeenCalled();
    });

    describe.each(["en", "ja"] as const)("%s refinement", (lang) => {
      it.each(["yes", ""])("rejects refinement %j without saving other options", async (input) => {
        placeConfig({ refine: true, prompt: "test prompt" });
        const before = fs.readFileSync(configPath, "utf8");
        await runCli("config", "set", "--refine", input, "--prompt", "new prompt", "-l", lang);
        expect(exitSpy).toHaveBeenCalledWith(1);
        const message =
          lang === "en"
            ? `Invalid value for --refine: "${input}". Use true or false.`
            : `--refine の値が正しくありません: "${input}"。true か false を指定してください。`;
        expect(stripVTControlCharacters(errorSpy.mock.calls.flat().join("\n"))).toBe(
          `\n✖ ${message}\n`,
        );
        expect(saveGlobalConfig).not.toHaveBeenCalled();
        expect(fs.readFileSync(configPath, "utf8")).toBe(before);
      });

      it.each([
        { saved: undefined, env: undefined, enabled: false },
        { saved: true, env: undefined, enabled: true },
        { saved: true, env: "false", enabled: false },
      ])(
        "shows refinement after text generation ($saved, $env)",
        async ({ saved, env, enabled }) => {
          placeConfig({ lang, refine: saved });
          if (env !== undefined) process.env["VSUB_REFINE"] = env;
          await runCli("config", "show");
          const rows = stripVTControlCharacters(logSpy.mock.calls.flat().join("\n"))
            .split("\n")
            .filter((line) => line.includes(" : "));
          const generationLabel = lang === "en" ? "Text Generation" : "文章の生成";
          const index = rows.findIndex((line) => line.split(" : ")[0]?.trim() === generationLabel);
          expect(index).toBeGreaterThanOrEqual(0);
          const refineRow = rows[index + 1]?.split(" : ");
          expect(refineRow?.[0]?.trim()).toBe(
            lang === "en" ? "Refine Transcript" : "文字起こしの修正",
          );
          const m = getI18n(lang).config;
          expect(refineRow?.[1]).toBe(enabled ? m.enabled : m.disabled);
          expect(new Set(rows.map((row) => ui.displayWidth(row.split(" : ")[0] ?? ""))).size).toBe(
            1,
          );
        },
      );
    });

    it("saves normalized target languages alone without showing empty-setting guidance", async () => {
      placeConfig({ prompt: "test prompt" });
      await runCli("config", "set", "--target-lang", "EN, ja ,en");
      expect(JSON.parse(fs.readFileSync(configPath, "utf8"))).toEqual({
        prompt: "test prompt",
        targetLang: "en,ja",
      });
      const output = logSpy.mock.calls.flat().join("\n");
      expect(output).toContain(getI18n("en").config.setSaved(""));
      expect(output).not.toContain(getI18n("en").config.setNothing);
      expect(exitSpy).not.toHaveBeenCalled();
    });

    describe.each(["en", "ja"] as const)("%s validation", (lang) => {
      it.each(["japanese", "ja;en", "", "  ", " , "])(
        "rejects %j without saving any options",
        async (input) => {
          placeConfig({ targetLang: "fr", prompt: "test prompt" });
          const before = fs.readFileSync(configPath, "utf8");
          await runCli(
            "config",
            "set",
            "-l",
            lang,
            "--target-lang",
            input,
            "--prompt",
            "new prompt",
          );
          expect(exitSpy).toHaveBeenCalledWith(1);
          expect(errorSpy.mock.calls.flat().join("\n")).toContain(
            getI18n(lang).pipeline.invalidTargetLang(input),
          );
          expect(saveGlobalConfig).not.toHaveBeenCalled();
          expect(fs.readFileSync(configPath, "utf8")).toBe(before);
        },
      );
    });

    describe.each(["en", "ja"] as const)("%s display", (lang) => {
      it.each([
        { saved: undefined, env: undefined, expected: "ja" },
        { saved: "EN, ja ,en", env: undefined, expected: "EN, ja ,en" },
        { saved: "fr", env: "ZH-TW, en", expected: "ZH-TW, en" },
      ])(
        "shows $expected below display language with aligned colons",
        async ({ saved, env, expected }) => {
          placeConfig({ lang, targetLang: saved });
          if (env !== undefined) process.env["VSUB_TARGET_LANG"] = env;
          await runCli("config", "show");
          const labels = getI18n(lang).config.showLabels;
          const rows = logSpy.mock.calls
            .map(([text]: unknown[]) => String(text))
            .filter((line: string) => line.includes(" : "));
          expect(rows[0]?.split(" : ")[0]?.trim()).toBe(labels.lang);
          expect(rows[1]?.split(" : ")[0]?.trim()).toBe(
            lang === "en" ? "Target Language" : "翻訳先",
          );
          expect(rows[1]?.split(" : ")[1]).toBe(expected);
          expect(
            new Set(rows.map((row: string) => ui.displayWidth(row.split(" : ")[0] ?? ""))).size,
          ).toBe(1);
        },
      );
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
          expect(logged).toContain(
            "Text Generation      : OpenRouter (custom/llm-model) [setting]",
          );
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
          "Correct speech recognition errors in the transcript with the text generation model before translation (default: VSUB_REFINE, config, or off; uses --glossary and --prompt; timing and line count are kept)",
          "--no-refine Do not refine the transcript, even if VSUB_REFINE or the config turns it on",
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
          "Correct speech recognition errors in the transcript with the text generation model before translation (default: VSUB_REFINE, config, or off; uses --glossary and --prompt; timing and line count are kept)",
          "--no-refine Do not refine the transcript, even if VSUB_REFINE or the config turns it on",
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
          "Target language for chapter titles; only the first is used if several are given (default: config or ja)",
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
          "Target language for summary; only the first is used if several are given (default: config or ja)",
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
          "transcript refinement",
          "--refine <boolean> Refine the transcript with the text generation model by default in the main command and batch (true/false)",
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
