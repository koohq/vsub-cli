import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  saveChaptersCache,
  saveSummaryCache,
  saveTranscriptionCache,
  saveTranslationCache,
} from "./cache.js";
import {
  parseBilingualOrder,
  processChaptersPipeline,
  processMediaPipeline,
  processSummaryPipeline,
  resolveOutputFilePaths,
  resolveTranscriptEntries,
} from "./pipeline.js";

vi.mock("./gemini.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./gemini.js")>();
  return {
    ...actual,
    generateChapters: vi.fn().mockResolvedValue([
      { timestamp: "00:00", seconds: 0, title: "Introduction" },
      { timestamp: "01:23", seconds: 83, title: "Getting Started" },
    ]),
    generateSummary: vi.fn().mockResolvedValue({
      title: "Sample Title",
      summary: "Sample Summary Paragraph",
      keyPoints: ["Point 1", "Point 2"],
      topics: [{ timestamp: "00:00", title: "Intro", description: "Details" }],
    }),
  };
});

vi.mock("./ffmpeg.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./ffmpeg.js")>();
  return {
    ...actual,
    burnSubtitlesToVideo: vi.fn().mockImplementation(async (_video, _sub, output) => {
      fs.writeFileSync(output, "dummy burnt video");
      return output;
    }),
    embedSubtitlesToVideo: vi.fn().mockImplementation(async (_video, _subs, output) => {
      fs.writeFileSync(output, "dummy embedded video");
      return output;
    }),
  };
});

describe("pipeline.ts", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vsub-pipeline-test-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
    vi.restoreAllMocks();
  });

  describe("parseBilingualOrder", () => {
    it("should return original-first by default or when empty", () => {
      expect(parseBilingualOrder()).toBe("original-first");
      expect(parseBilingualOrder("")).toBe("original-first");
      expect(parseBilingualOrder(undefined)).toBe("original-first");
    });

    it("should parse valid order values case-insensitively", () => {
      expect(parseBilingualOrder("original-first")).toBe("original-first");
      expect(parseBilingualOrder("ORIGINAL-FIRST")).toBe("original-first");
      expect(parseBilingualOrder("target-first")).toBe("target-first");
      expect(parseBilingualOrder("TARGET-FIRST")).toBe("target-first");
    });

    it("should throw for invalid order values", () => {
      expect(() => parseBilingualOrder("invalid")).toThrow(/Unsupported bilingual order/);
      expect(() => parseBilingualOrder("invalid", "ja")).toThrow(
        /サポートされていないバイリンガル順序/,
      );
    });
  });

  describe("resolveOutputFilePaths", () => {
    it("should resolve single language paths alongside media file", () => {
      const paths = resolveOutputFilePaths("/dir", "video", "ja", ["srt", "vtt"]);
      expect(paths).toEqual([
        { format: "srt", filePath: path.join("/dir", "video.ja.srt") },
        { format: "vtt", filePath: path.join("/dir", "video.ja.vtt") },
      ]);
    });

    it("should resolve paths with bilingual tag", () => {
      const paths = resolveOutputFilePaths("/dir", "video", "ja", ["srt"], undefined, true, true);
      expect(paths).toEqual([
        { format: "srt", filePath: path.join("/dir", "video.ja.bilingual.srt") },
      ]);
    });

    it("should resolve paths when outputDir is specified", () => {
      const outDir = path.join(tempDir, "custom_out");
      const paths = resolveOutputFilePaths(
        "/dir",
        "video",
        "ja",
        ["srt", "json"],
        undefined,
        true,
        false,
        outDir,
      );
      expect(paths).toEqual([
        { format: "srt", filePath: path.join(outDir, "video.ja.srt") },
        { format: "json", filePath: path.join(outDir, "video.ja.json") },
      ]);
    });

    it("should resolve paths when explicit output file option is specified", () => {
      const explicitOut = path.join(tempDir, "custom.srt");
      const paths = resolveOutputFilePaths(
        "/dir",
        "video",
        "ja",
        ["srt"],
        explicitOut,
        true,
        false,
      );
      expect(paths).toEqual([{ format: "srt", filePath: explicitOut }]);
    });
  });

  describe("processMediaPipeline error cases", () => {
    it("should throw error if media file does not exist", async () => {
      const nonExistent = path.join(tempDir, "non_existent.mp4");
      await expect(
        processMediaPipeline({
          mediaFile: nonExistent,
        }),
      ).rejects.toThrow(/Media file not found/);
      await expect(
        processMediaPipeline({
          mediaFile: nonExistent,
          lang: "ja",
        }),
      ).rejects.toThrow(/メディアファイルが見つかりません/);
    });

    it("should throw error if --burn is specified on audio file", async () => {
      const audioFile = path.join(tempDir, "test.mp3");
      fs.writeFileSync(audioFile, "dummy");

      await expect(
        processMediaPipeline({
          mediaFile: audioFile,
          burn: true,
        }),
      ).rejects.toThrow(/Cannot burn subtitles into audio files/);
      await expect(
        processMediaPipeline({
          mediaFile: audioFile,
          burn: true,
          lang: "ja",
        }),
      ).rejects.toThrow(/音声ファイルには字幕を焼き込めません/);
    });

    it("should throw error if --embed is specified on audio file", async () => {
      const audioFile = path.join(tempDir, "test_audio.mp3");
      fs.writeFileSync(audioFile, "dummy");

      await expect(
        processMediaPipeline({
          mediaFile: audioFile,
          embed: true,
        }),
      ).rejects.toThrow(/Cannot embed subtitles into an audio file/);
      await expect(
        processMediaPipeline({
          mediaFile: audioFile,
          embed: true,
          lang: "ja",
        }),
      ).rejects.toThrow(/音声ファイルに字幕トラックを埋め込むことはできません/);
    });

    it("should accept maxLength, maxDuration, and noReflow options without type or schema error", async () => {
      const nonExistent = path.join(tempDir, "non_existent.mp4");
      await expect(
        processMediaPipeline({
          mediaFile: nonExistent,
          maxLength: 50,
          maxDuration: 6,
          noReflow: true,
        }),
      ).rejects.toThrow(/Media file not found/);
    });
  });

  describe("processMediaPipeline stdout mode (--stdout / -o -)", () => {
    it("should throw error if multiple formats are specified with --stdout", async () => {
      const mediaFile = path.join(tempDir, "sample.mp4");
      fs.writeFileSync(mediaFile, "dummy");

      await expect(
        processMediaPipeline({
          mediaFile,
          stdout: true,
          format: "srt,vtt",
        }),
      ).rejects.toThrow(/Cannot specify multiple formats with --stdout/);

      await expect(
        processMediaPipeline({
          mediaFile,
          stdout: true,
          format: "srt,vtt",
          lang: "ja",
        }),
      ).rejects.toThrow(/--stdout 指定時は複数の出力フォーマットを指定できません/);
    });

    it("should throw error if multiple target languages are specified with --stdout", async () => {
      const mediaFile = path.join(tempDir, "sample.mp4");
      fs.writeFileSync(mediaFile, "dummy");

      await expect(
        processMediaPipeline({
          mediaFile,
          stdout: true,
          targetLang: "ja,en",
        }),
      ).rejects.toThrow(/Cannot specify multiple target languages with --stdout/);

      await expect(
        processMediaPipeline({
          mediaFile,
          stdout: true,
          targetLang: "ja,en",
          lang: "ja",
        }),
      ).rejects.toThrow(/--stdout 指定時は複数の言語を指定できません/);
    });

    it("should throw error if --burn is specified with --stdout", async () => {
      const mediaFile = path.join(tempDir, "sample.mp4");
      fs.writeFileSync(mediaFile, "dummy");

      await expect(
        processMediaPipeline({
          mediaFile,
          stdout: true,
          burn: true,
        }),
      ).rejects.toThrow(/Cannot use --burn with --stdout/);

      await expect(
        processMediaPipeline({
          mediaFile,
          output: "-",
          burn: true,
          lang: "ja",
        }),
      ).rejects.toThrow(/--stdout と --burn \(字幕焼き込み\) を同時に指定することはできません/);
    });

    it("should throw error if --embed is specified with --stdout", async () => {
      const mediaFile = path.join(tempDir, "sample_embed.mp4");
      fs.writeFileSync(mediaFile, "dummy");

      await expect(
        processMediaPipeline({
          mediaFile,
          stdout: true,
          embed: true,
        }),
      ).rejects.toThrow(/Cannot use --embed with --stdout/);

      await expect(
        processMediaPipeline({
          mediaFile,
          output: "-",
          embed: true,
          lang: "ja",
        }),
      ).rejects.toThrow(
        /--stdout と --embed \(ソフトサブ埋め込み\) を同時に指定することはできません/,
      );
    });

    it("should generate stdoutContent and not write any files to disk", async () => {
      const mediaFile = path.join(tempDir, "sample.mp4");
      fs.writeFileSync(mediaFile, "dummy content");
      const cacheDir = path.join(tempDir, "cache");

      const mockEntries = [
        {
          id: 1,
          startTime: "00:00:01,000",
          endTime: "00:00:03,000",
          text: "Hello world",
        },
      ];

      saveTranscriptionCache(
        mediaFile,
        {
          detectedLanguage: "en",
          entries: mockEntries,
          createdAt: Date.now(),
        },
        cacheDir,
      );

      saveTranslationCache(
        mediaFile,
        "ja",
        {
          targetLang: "ja",
          entries: [
            {
              id: 1,
              startTime: "00:00:01,000",
              endTime: "00:00:03,000",
              text: "こんにちは世界",
            },
          ],
          createdAt: Date.now(),
        },
        cacheDir,
      );

      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      const result = await processMediaPipeline({
        mediaFile,
        targetLang: "ja",
        format: "srt",
        stdout: true,
        cacheDir,
      });

      expect(result.outputFiles).toEqual([]);
      expect(result.stdoutContent).toContain("こんにちは世界");
      expect(result.stdoutContent).toContain("00:00:01,000 --> 00:00:03,000");

      // Verify no subtitle files were created in tempDir
      const filesInTemp = fs.readdirSync(tempDir);
      const srtFiles = filesInTemp.filter((f) => f.endsWith(".srt"));
      expect(srtFiles).toHaveLength(0);

      // Verify start banner and summary box were NOT logged to console.log
      expect(logSpy).not.toHaveBeenCalled();
    });

    it("should support JSON and TXT format in stdoutContent", async () => {
      const mediaFile = path.join(tempDir, "sample2.mp4");
      fs.writeFileSync(mediaFile, "dummy content 2");
      const cacheDir = path.join(tempDir, "cache");

      saveTranscriptionCache(
        mediaFile,
        {
          detectedLanguage: "ja",
          entries: [
            {
              id: 1,
              startTime: "00:00:00,000",
              endTime: "00:00:02,000",
              text: "テスト字幕",
            },
          ],
          createdAt: Date.now(),
        },
        cacheDir,
      );

      // noTranslate mode with json format
      const jsonResult = await processMediaPipeline({
        mediaFile,
        format: "json",
        output: "-",
        noTranslate: true,
        cacheDir,
      });

      expect(jsonResult.outputFiles).toEqual([]);
      expect(jsonResult.stdoutContent).toBeDefined();
      const parsed = JSON.parse(jsonResult.stdoutContent ?? "[]");
      expect(parsed).toEqual([
        {
          id: 1,
          startTime: "00:00:00,000",
          endTime: "00:00:02,000",
          text: "テスト字幕",
        },
      ]);

      // noTranslate mode with txt format
      const txtResult = await processMediaPipeline({
        mediaFile,
        format: "txt",
        stdout: true,
        noTranslate: true,
        cacheDir,
      });

      expect(txtResult.outputFiles).toEqual([]);
      expect(txtResult.stdoutContent?.trim()).toBe("テスト字幕");
    });
  });

  describe("resolveTranscriptEntries", () => {
    it("should parse .srt file directly without cache or API keys", async () => {
      const srtPath = path.join(tempDir, "sample.srt");
      fs.writeFileSync(
        srtPath,
        "1\n00:00:00,000 --> 00:00:02,000\nHello\n\n2\n00:00:02,500 --> 00:00:05,000\nWorld\n",
      );

      const result = await resolveTranscriptEntries({ filePath: srtPath });
      expect(result.isSubtitleFile).toBe(true);
      expect(result.fromCache).toBe(false);
      expect(result.entries).toHaveLength(2);
      expect(result.entries[0]?.text).toBe("Hello");
    });

    it("should load from transcription cache for media file", async () => {
      const mediaPath = path.join(tempDir, "test.mp4");
      fs.writeFileSync(mediaPath, "dummy video data");
      const cacheDir = path.join(tempDir, "cache");

      saveTranscriptionCache(
        mediaPath,
        {
          detectedLanguage: "ja",
          entries: [
            { id: 1, startTime: "00:00:00,000", endTime: "00:00:02,000", text: "キャッシュ字幕" },
          ],
          createdAt: Date.now(),
        },
        cacheDir,
      );

      const result = await resolveTranscriptEntries({ filePath: mediaPath, cacheDir });
      expect(result.isSubtitleFile).toBe(false);
      expect(result.fromCache).toBe(true);
      expect(result.detectedLanguage).toBe("ja");
      expect(result.entries[0]?.text).toBe("キャッシュ字幕");
    });

    it("should throw if file does not exist", async () => {
      await expect(
        resolveTranscriptEntries({ filePath: path.join(tempDir, "not_found.srt") }),
      ).rejects.toThrow(/File not found/);
    });
  });

  describe("processChaptersPipeline", () => {
    it("should generate chapters from .srt and write to output file", async () => {
      const srtPath = path.join(tempDir, "demo.srt");
      fs.writeFileSync(
        srtPath,
        "1\n00:00:00,000 --> 00:00:05,000\nIntro\n\n2\n00:01:23,000 --> 00:01:30,000\nTopic\n",
      );

      const result = await processChaptersPipeline({
        inputFile: srtPath,
        format: "txt",
      });

      expect(result.chapters).toHaveLength(2);
      const outPath = result.outputFile ?? "";
      expect(outPath).toBe(path.join(tempDir, "demo.chapters.txt"));
      expect(fs.existsSync(outPath)).toBe(true);
      const content = fs.readFileSync(outPath, "utf-8");
      expect(content).toContain("00:00 Introduction");
      expect(content).toContain("01:23 Getting Started");
    });

    it("should output to stdout when stdout: true", async () => {
      const srtPath = path.join(tempDir, "stdout_demo.srt");
      fs.writeFileSync(srtPath, "1\n00:00:00,000 --> 00:00:05,000\nIntro\n");

      const stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
      const result = await processChaptersPipeline({
        inputFile: srtPath,
        stdout: true,
        format: "json",
      });

      expect(stdoutSpy).toHaveBeenCalled();
      expect(result.outputFile).toBeUndefined();
      const parsed = JSON.parse(result.formattedOutput);
      expect(parsed).toHaveLength(2);
      stdoutSpy.mockRestore();
    });

    it("should use cached chapters if available", async () => {
      const mediaPath = path.join(tempDir, "cached_video.mp4");
      fs.writeFileSync(mediaPath, "video bytes");
      const cacheDir = path.join(tempDir, "cache");

      saveChaptersCache(
        mediaPath,
        "ja",
        {
          targetLang: "ja",
          chapters: [{ timestamp: "00:00", seconds: 0, title: "Cached Opening" }],
          createdAt: Date.now(),
        },
        cacheDir,
      );

      const result = await processChaptersPipeline({
        inputFile: mediaPath,
        targetLang: "ja",
        cacheDir,
      });

      expect(result.fromCache).toBe(true);
      expect(result.chapters[0]?.title).toBe("Cached Opening");
    });
  });

  describe("processSummaryPipeline", () => {
    it("should generate summary from .srt and write to markdown file", async () => {
      const srtPath = path.join(tempDir, "summary_demo.srt");
      fs.writeFileSync(srtPath, "1\n00:00:00,000 --> 00:00:05,000\nIntro discussion\n");

      const result = await processSummaryPipeline({
        inputFile: srtPath,
        format: "md",
      });

      expect(result.summary.title).toBe("Sample Title");
      const outPath = result.outputFile ?? "";
      expect(outPath).toBe(path.join(tempDir, "summary_demo.summary.md"));
      expect(fs.existsSync(outPath)).toBe(true);
      const content = fs.readFileSync(outPath, "utf-8");
      expect(content).toContain("# Sample Title");
      expect(content).toContain("## Summary");
    });

    it("should output summary to stdout when stdout: true", async () => {
      const srtPath = path.join(tempDir, "summary_stdout.srt");
      fs.writeFileSync(srtPath, "1\n00:00:00,000 --> 00:00:05,000\nIntro\n");

      const stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
      const result = await processSummaryPipeline({
        inputFile: srtPath,
        stdout: true,
        format: "txt",
      });

      expect(stdoutSpy).toHaveBeenCalled();
      expect(result.outputFile).toBeUndefined();
      expect(result.formattedOutput).toContain("Sample Title");
      stdoutSpy.mockRestore();
    });

    it("should use cached summary if available", async () => {
      const mediaPath = path.join(tempDir, "summary_cached_video.mp4");
      fs.writeFileSync(mediaPath, "video bytes 2");
      const cacheDir = path.join(tempDir, "cache");

      saveSummaryCache(
        mediaPath,
        "ja",
        {
          targetLang: "ja",
          summary: {
            title: "Cached Title",
            summary: "Cached summary text",
            keyPoints: ["Cached point"],
            topics: [],
          },
          createdAt: Date.now(),
        },
        cacheDir,
      );

      const result = await processSummaryPipeline({
        inputFile: mediaPath,
        targetLang: "ja",
        cacheDir,
      });

      expect(result.fromCache).toBe(true);
      expect(result.summary.title).toBe("Cached Title");
    });
  });

  describe("processMediaPipeline soft subtitles mode (--embed)", () => {
    it("should embed multi-language subtitle tracks into a single video file", async () => {
      const mediaFile = path.join(tempDir, "sample_multitrack.mp4");
      fs.writeFileSync(mediaFile, "dummy video data");
      const cacheDir = path.join(tempDir, "cache");

      const mockEntries = [
        {
          id: 1,
          startTime: "00:00:01,000",
          endTime: "00:00:03,000",
          text: "Hello",
        },
      ];

      saveTranscriptionCache(
        mediaFile,
        {
          detectedLanguage: "en",
          entries: mockEntries,
          createdAt: Date.now(),
        },
        cacheDir,
      );

      saveTranslationCache(
        mediaFile,
        "ja",
        {
          targetLang: "ja",
          entries: [
            {
              id: 1,
              startTime: "00:00:01,000",
              endTime: "00:00:03,000",
              text: "こんにちは",
            },
          ],
          createdAt: Date.now(),
        },
        cacheDir,
      );

      saveTranslationCache(
        mediaFile,
        "es",
        {
          targetLang: "es",
          entries: [
            {
              id: 1,
              startTime: "00:00:01,000",
              endTime: "00:00:03,000",
              text: "Hola",
            },
          ],
          createdAt: Date.now(),
        },
        cacheDir,
      );

      const result = await processMediaPipeline({
        mediaFile,
        targetLang: "ja,es",
        embed: true,
        cacheDir,
      });

      const embeddedFile = result.outputFiles.find((f) => f.endsWith(".embedded.mp4"));
      expect(embeddedFile).toBeDefined();
      expect(embeddedFile).toBe(path.join(tempDir, "sample_multitrack.embedded.mp4"));
      expect(embeddedFile ? fs.existsSync(embeddedFile) : false).toBe(true);
    });

    it("should respect explicit output path when embedding soft subtitles", async () => {
      const mediaFile = path.join(tempDir, "sample_custom.mp4");
      fs.writeFileSync(mediaFile, "dummy video data");
      const cacheDir = path.join(tempDir, "cache");
      const customOut = path.join(tempDir, "custom_output.mp4");

      saveTranscriptionCache(
        mediaFile,
        {
          detectedLanguage: "ja",
          entries: [
            {
              id: 1,
              startTime: "00:00:00,000",
              endTime: "00:00:02,000",
              text: "テスト",
            },
          ],
          createdAt: Date.now(),
        },
        cacheDir,
      );

      const result = await processMediaPipeline({
        mediaFile,
        targetLang: "ja",
        noTranslate: true,
        embed: true,
        output: customOut,
        cacheDir,
      });

      expect(result.outputFiles).toContain(customOut);
      expect(fs.existsSync(customOut)).toBe(true);
    });
  });

  describe("processMediaPipeline burn subtitles mode (--burn)", () => {
    it("should pass burnPosition and burnFontSize to burnSubtitlesToVideo", async () => {
      const mediaFile = path.join(tempDir, "sample_burn.mp4");
      fs.writeFileSync(mediaFile, "dummy video data");
      const cacheDir = path.join(tempDir, "cache");

      saveTranscriptionCache(
        mediaFile,
        {
          detectedLanguage: "ja",
          entries: [
            {
              id: 1,
              startTime: "00:00:00,000",
              endTime: "00:00:02,000",
              text: "テスト",
            },
          ],
          createdAt: Date.now(),
        },
        cacheDir,
      );

      const result = await processMediaPipeline({
        mediaFile,
        targetLang: "ja",
        noTranslate: true,
        burn: true,
        burnPosition: "top",
        burnFontSize: "large",
        cacheDir,
      });

      const burntFile = result.outputFiles.find((f) => f.endsWith(".subbed.mp4"));
      expect(burntFile).toBeDefined();
      expect(burntFile ? fs.existsSync(burntFile) : false).toBe(true);

      const { burnSubtitlesToVideo } = await import("./ffmpeg.js");
      expect(burnSubtitlesToVideo).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.objectContaining({
          position: "top",
          fontSize: "large",
        }),
      );
    });
  });
});
