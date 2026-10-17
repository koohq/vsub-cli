import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveTranscriptionCache, saveTranslationCache } from "./cache.js";
import { parseBilingualOrder, processMediaPipeline, resolveOutputFilePaths } from "./pipeline.js";

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
});
