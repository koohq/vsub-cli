import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCachedTranslation, saveTranscriptionCache, saveTranslationCache } from "./cache.js";
import { DEFAULT_GEMINI_MODEL } from "./config.js";
import { checkFfmpeg, extractAudio } from "./ffmpeg.js";
import { DEFAULT_CONTEXT_WINDOW_SIZE, translateSrtEntries } from "./gemini.js";
import { processMediaPipeline } from "./pipeline.js";
import { ensureWritableTargets } from "./safety.js";
import { isolateConfigAndEnv } from "./test-support/isolate-config-env.js";
import { transcribeAudioSegments } from "./transcribe/transcriber.js";

const mustNotBeCalled = vi.hoisted(
  () => (name: string) => new Error(`${name} must not be called: cache should be hit`),
);

const actualSafety = await vi.importActual<typeof import("./safety.js")>("./safety.js");

vi.mock("./gemini.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./gemini.js")>();
  return {
    ...actual,
    translateSrtEntries: vi.fn().mockRejectedValue(mustNotBeCalled("translateSrtEntries")),
    generateChapters: vi.fn(),
    generateSummary: vi.fn(),
  };
});

vi.mock("./transcribe/transcriber.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./transcribe/transcriber.js")>();
  return {
    ...actual,
    transcribeAudioSegments: vi.fn().mockRejectedValue(mustNotBeCalled("transcribeAudioSegments")),
  };
});

vi.mock("./ffmpeg.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./ffmpeg.js")>();
  return {
    ...actual,
    checkFfmpeg: vi.fn().mockRejectedValue(mustNotBeCalled("checkFfmpeg")),
    extractAudio: vi.fn().mockRejectedValue(mustNotBeCalled("extractAudio")),
    burnSubtitlesToVideo: vi.fn(),
    embedSubtitlesToVideo: vi.fn(),
  };
});

vi.mock("./safety.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./safety.js")>();
  return {
    ...actual,
    ensureWritableTargets: vi.fn().mockImplementation(actual.ensureWritableTargets),
  };
});

describe("pipeline.ts --save-original overwrite confirmation", () => {
  let tempDir: string;
  const originalEnv = process.env;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vsub-pipeline-save-orig-"));
    process.env = {
      ...originalEnv,
      VSUB_GEMINI_API_KEY: "test-gemini-key",
      VSUB_GROQ_API_KEY: "test-groq-key",
    };
    isolateConfigAndEnv(tempDir);
    vi.mocked(ensureWritableTargets).mockImplementation(actualSafety.ensureWritableTargets);
  });

  afterEach(() => {
    process.env = originalEnv;
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
    vi.restoreAllMocks();
    // A cache miss would fall through to real ffmpeg / Groq / Gemini calls.
    expect(translateSrtEntries).not.toHaveBeenCalled();
    expect(transcribeAudioSegments).not.toHaveBeenCalled();
    expect(checkFfmpeg).not.toHaveBeenCalled();
    expect(extractAudio).not.toHaveBeenCalled();
  });

  function setupFixture(
    baseName: string,
    options: {
      existingOriginalContent?: string | undefined;
      targetLang?: string | undefined;
    } = {},
  ) {
    const mediaFile = path.join(tempDir, `${baseName}.mp4`);
    fs.writeFileSync(mediaFile, "dummy media");
    const cacheDir = path.join(tempDir, `cache-${baseName}`);
    const targetLang = options.targetLang ?? "ja";

    const originalSrtPath = path.join(tempDir, `${baseName}.en.srt`);
    const translatedSrtPath = path.join(tempDir, `${baseName}.${targetLang}.srt`);

    if (options.existingOriginalContent !== undefined) {
      fs.writeFileSync(originalSrtPath, options.existingOriginalContent, "utf-8");
    }

    const rawEntries = [
      {
        id: 1,
        startTime: "00:00:01,000",
        endTime: "00:00:03,000",
        text: "Hello world raw",
      },
    ];

    saveTranscriptionCache(
      mediaFile,
      {
        detectedLanguage: "en",
        entries: rawEntries,
        createdAt: Date.now(),
      },
      cacheDir,
    );

    saveTranslationCache(
      mediaFile,
      targetLang,
      createCachedTranslation(
        targetLang,
        {
          sourceEntries: rawEntries,
          model: DEFAULT_GEMINI_MODEL,
          contextWindowSize: DEFAULT_CONTEXT_WINDOW_SIZE,
        },
        [
          {
            id: 1,
            startTime: "00:00:01,000",
            endTime: "00:00:03,000",
            text: "こんにちは世界 翻訳",
          },
        ],
      ),
      cacheDir,
    );

    return {
      mediaFile,
      cacheDir,
      originalSrtPath,
      translatedSrtPath,
      targetLang,
    };
  }

  function declineOriginalTargets() {
    vi.mocked(ensureWritableTargets).mockImplementation(async (filePaths, opts) => {
      if (filePaths.some((p) => p.endsWith(".en.srt"))) {
        return {
          proceed: false,
          backedUp: [],
          existingFiles: filePaths,
        };
      }
      return actualSafety.ensureWritableTargets(filePaths, opts);
    });
  }

  it.each(["ja", "en"] as const)(
    "should not overwrite original subtitles and should pass UI language to confirmation when declined (lang: %s)",
    async (lang) => {
      declineOriginalTargets();
      const initialContent = `PRE-EXISTING ORIGINAL CONTENT ${lang.toUpperCase()}`;
      const { mediaFile, cacheDir, originalSrtPath, translatedSrtPath, targetLang } = setupFixture(
        `sample_${lang}`,
        { existingOriginalContent: initialContent },
      );

      const result = await processMediaPipeline({
        mediaFile,
        targetLang,
        format: "srt",
        saveOriginal: true,
        cacheDir,
        lang,
      });

      // 1. Existing original subtitle content must remain untouched
      expect(fs.readFileSync(originalSrtPath, "utf-8")).toBe(initialContent);

      // 2. Translated subtitle file must be created
      expect(fs.existsSync(translatedSrtPath)).toBe(true);
      expect(fs.readFileSync(translatedSrtPath, "utf-8")).toContain("こんにちは世界 翻訳");

      // 3. Output files must NOT contain the skipped original file
      expect(result.outputFiles).not.toContain(originalSrtPath);
      expect(result.outputFiles).toContain(translatedSrtPath);

      // 4. ensureWritableTargets must be called with UI language
      expect(ensureWritableTargets).toHaveBeenCalledWith(
        [originalSrtPath],
        expect.objectContaining({ lang }),
      );
    },
  );

  it("should overwrite original subtitles when overwrite: true is specified", async () => {
    const { mediaFile, cacheDir, originalSrtPath, translatedSrtPath, targetLang } = setupFixture(
      "sample_overwrite",
      { existingOriginalContent: "PRE-EXISTING ORIGINAL CONTENT" },
    );

    const result = await processMediaPipeline({
      mediaFile,
      targetLang,
      format: "srt",
      saveOriginal: true,
      overwrite: true,
      cacheDir,
      lang: "ja",
    });

    const currentOriginalContent = fs.readFileSync(originalSrtPath, "utf-8");
    expect(currentOriginalContent).toContain("Hello world raw");

    expect(result.outputFiles).toContain(originalSrtPath);
    expect(result.outputFiles).toContain(translatedSrtPath);
  });

  it("should create backup and proceed when backup: true is specified", async () => {
    const initialContent = "PRE-EXISTING CONTENT FOR BACKUP";
    const { mediaFile, cacheDir, originalSrtPath, targetLang } = setupFixture("sample_bak", {
      existingOriginalContent: initialContent,
    });

    const result = await processMediaPipeline({
      mediaFile,
      targetLang,
      format: "srt",
      saveOriginal: true,
      backup: true,
      cacheDir,
      lang: "ja",
    });

    // Backup file should be created with previous content
    const backupPath = `${originalSrtPath}.bak`;
    expect(fs.existsSync(backupPath)).toBe(true);
    expect(fs.readFileSync(backupPath, "utf-8")).toBe(initialContent);

    // Original path should have been overwritten with new raw transcription
    expect(fs.readFileSync(originalSrtPath, "utf-8")).toContain("Hello world raw");
    expect(result.outputFiles).toContain(originalSrtPath);
  });

  it("should throw in non-interactive mode when neither overwrite nor backup is given and file exists", async () => {
    const { mediaFile, cacheDir, targetLang } = setupFixture("sample_nonint", {
      existingOriginalContent: "PRE-EXISTING CONTENT",
    });

    await expect(
      processMediaPipeline({
        mediaFile,
        targetLang,
        format: "srt",
        saveOriginal: true,
        cacheDir,
        lang: "ja",
      }),
    ).rejects.toThrow(/出力ファイルが既に存在します/);
  });
});
