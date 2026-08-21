import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findMediaFiles, runBatchPipeline } from "./batch.js";
import * as configModule from "./config.js";
import * as ffmpegModule from "./ffmpeg.js";
import * as pipelineModule from "./pipeline.js";

describe("batch.ts", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vsub-batch-test-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
    vi.restoreAllMocks();
  });

  describe("findMediaFiles", () => {
    it("should return empty array for non-existent targets", () => {
      const nonExistent = path.join(tempDir, "non_existent.mp4");
      const files = findMediaFiles([nonExistent]);
      expect(files).toEqual([]);
    });

    it("should find direct video and audio files", () => {
      const videoFile = path.join(tempDir, "video1.mp4");
      const audioFile = path.join(tempDir, "audio1.mp3");
      const textFile = path.join(tempDir, "notes.txt");
      const subtitleFile = path.join(tempDir, "sub.srt");

      fs.writeFileSync(videoFile, "dummy video");
      fs.writeFileSync(audioFile, "dummy audio");
      fs.writeFileSync(textFile, "dummy text");
      fs.writeFileSync(subtitleFile, "dummy srt");

      const files = findMediaFiles([videoFile, audioFile, textFile, subtitleFile]);
      expect(files).toEqual([path.resolve(audioFile), path.resolve(videoFile)]);
    });

    it("should scan directory and discover media files recursively by default", () => {
      const subDir = path.join(tempDir, "subdir");
      const ignoredDir = path.join(tempDir, "node_modules");
      fs.mkdirSync(subDir, { recursive: true });
      fs.mkdirSync(ignoredDir, { recursive: true });

      const file1 = path.join(tempDir, "video_root.mp4");
      const file2 = path.join(subDir, "audio_sub.m4a");
      const ignoredFile = path.join(ignoredDir, "ignored.mp4");
      const hiddenFile = path.join(tempDir, ".hidden.mp4");

      fs.writeFileSync(file1, "video");
      fs.writeFileSync(file2, "audio");
      fs.writeFileSync(ignoredFile, "ignored");
      fs.writeFileSync(hiddenFile, "hidden");

      const files = findMediaFiles([tempDir]);
      expect(files).toEqual([path.resolve(file2), path.resolve(file1)]);
    });

    it("should respect recursive: false option", () => {
      const subDir = path.join(tempDir, "subdir");
      fs.mkdirSync(subDir, { recursive: true });

      const rootFile = path.join(tempDir, "video_root.mp4");
      const subFile = path.join(subDir, "audio_sub.mp3");

      fs.writeFileSync(rootFile, "root");
      fs.writeFileSync(subFile, "sub");

      const files = findMediaFiles([tempDir], { recursive: false });
      expect(files).toEqual([path.resolve(rootFile)]);
    });

    it("should match glob pattern in a directory", () => {
      const ep1 = path.join(tempDir, "episode_01.mp4");
      const ep2 = path.join(tempDir, "episode_02.mp4");
      const trailer = path.join(tempDir, "trailer.mp4");

      fs.writeFileSync(ep1, "ep1");
      fs.writeFileSync(ep2, "ep2");
      fs.writeFileSync(trailer, "trailer");

      const globPattern = path.join(tempDir, "episode_*.mp4");
      const files = findMediaFiles([globPattern]);
      expect(files).toEqual([path.resolve(ep1), path.resolve(ep2)]);
    });

    it("should deduplicate and sort files naturally", () => {
      const file1 = path.join(tempDir, "item_2.mp4");
      const file2 = path.join(tempDir, "item_10.mp4");
      const file3 = path.join(tempDir, "item_1.mp4");

      fs.writeFileSync(file1, "1");
      fs.writeFileSync(file2, "2");
      fs.writeFileSync(file3, "3");

      // Pass same files and directory multiple times
      const files = findMediaFiles([file2, tempDir, file1, file3]);
      expect(files).toEqual([path.resolve(file3), path.resolve(file1), path.resolve(file2)]);
    });
  });

  describe("runBatchPipeline", () => {
    it("should return empty summary when no media files match", async () => {
      const summary = await runBatchPipeline({
        targets: [path.join(tempDir, "empty_dir")],
      });

      expect(summary.totalFiles).toBe(0);
      expect(summary.succeededCount).toBe(0);
      expect(summary.failedCount).toBe(0);
      expect(summary.items).toEqual([]);
    });

    it("should process multiple media files sequentially and collect results", async () => {
      const file1 = path.join(tempDir, "ep1.mp4");
      const file2 = path.join(tempDir, "ep2.mp4");
      fs.writeFileSync(file1, "video1");
      fs.writeFileSync(file2, "video2");

      vi.spyOn(configModule, "getConfig").mockReturnValue({
        groqApiKey: "gsk-mock",
        geminiApiKey: "gem-mock",
        ffmpegPath: "ffmpeg",
      });
      vi.spyOn(configModule, "ensureApiKeys").mockResolvedValue({
        groqApiKey: "gsk-mock",
        geminiApiKey: "gem-mock",
        ffmpegPath: "ffmpeg",
      });
      vi.spyOn(ffmpegModule, "checkFfmpeg").mockResolvedValue();

      const pipelineSpy = vi
        .spyOn(pipelineModule, "processMediaPipeline")
        .mockImplementation(async (opts) => {
          return {
            mediaFile: path.basename(opts.mediaFile),
            mediaType: "video",
            durationMs: 1500,
            targetLanguages: ["ja"],
            entriesCount: 10,
            outputFiles: [path.join(tempDir, `${path.basename(opts.mediaFile)}.ja.srt`)],
          };
        });

      const summary = await runBatchPipeline({
        targets: [tempDir],
        targetLang: "ja",
      });

      expect(summary.totalFiles).toBe(2);
      expect(summary.succeededCount).toBe(2);
      expect(summary.failedCount).toBe(0);
      expect(summary.items).toHaveLength(2);
      expect(summary.items[0]?.status).toBe("success");
      expect(summary.items[0]?.file).toBe("ep1.mp4");
      expect(summary.items[1]?.status).toBe("success");
      expect(summary.items[1]?.file).toBe("ep2.mp4");
      expect(pipelineSpy).toHaveBeenCalledTimes(2);
    });

    it("should continue on error and record failure details", async () => {
      const file1 = path.join(tempDir, "ep1.mp4");
      const file2 = path.join(tempDir, "ep2.mp4");
      fs.writeFileSync(file1, "video1");
      fs.writeFileSync(file2, "video2");

      vi.spyOn(configModule, "getConfig").mockReturnValue({
        groqApiKey: "gsk-mock",
        geminiApiKey: "gem-mock",
        ffmpegPath: "ffmpeg",
      });
      vi.spyOn(configModule, "ensureApiKeys").mockResolvedValue({
        groqApiKey: "gsk-mock",
        geminiApiKey: "gem-mock",
        ffmpegPath: "ffmpeg",
      });
      vi.spyOn(ffmpegModule, "checkFfmpeg").mockResolvedValue();

      vi.spyOn(pipelineModule, "processMediaPipeline").mockImplementation(async (opts) => {
        if (opts.mediaFile.includes("ep1")) {
          throw new Error("FFmpeg decode failure on ep1");
        }
        return {
          mediaFile: path.basename(opts.mediaFile),
          mediaType: "video",
          durationMs: 1200,
          targetLanguages: ["ja"],
          entriesCount: 5,
          outputFiles: [path.join(tempDir, "ep2.mp4.ja.srt")],
        };
      });

      const summary = await runBatchPipeline({
        targets: [tempDir],
        targetLang: "ja",
      });

      expect(summary.totalFiles).toBe(2);
      expect(summary.succeededCount).toBe(1);
      expect(summary.failedCount).toBe(1);
      expect(summary.items[0]?.status).toBe("failed");
      expect(summary.items[0]?.error).toContain("FFmpeg decode failure on ep1");
      expect(summary.items[1]?.status).toBe("success");
    });

    it("should respect failFast: true and skip subsequent files on error", async () => {
      const file1 = path.join(tempDir, "ep1.mp4");
      const file2 = path.join(tempDir, "ep2.mp4");
      const file3 = path.join(tempDir, "ep3.mp4");
      fs.writeFileSync(file1, "video1");
      fs.writeFileSync(file2, "video2");
      fs.writeFileSync(file3, "video3");

      vi.spyOn(configModule, "getConfig").mockReturnValue({
        groqApiKey: "gsk-mock",
        geminiApiKey: "gem-mock",
        ffmpegPath: "ffmpeg",
      });
      vi.spyOn(configModule, "ensureApiKeys").mockResolvedValue({
        groqApiKey: "gsk-mock",
        geminiApiKey: "gem-mock",
        ffmpegPath: "ffmpeg",
      });
      vi.spyOn(ffmpegModule, "checkFfmpeg").mockResolvedValue();

      const pipelineSpy = vi
        .spyOn(pipelineModule, "processMediaPipeline")
        .mockImplementation(async (opts) => {
          if (opts.mediaFile.includes("ep1")) {
            throw new Error("Early failure");
          }
          return {
            mediaFile: path.basename(opts.mediaFile),
            mediaType: "video",
            durationMs: 1000,
            targetLanguages: ["ja"],
            entriesCount: 5,
            outputFiles: [],
          };
        });

      const summary = await runBatchPipeline({
        targets: [tempDir],
        failFast: true,
      });

      expect(summary.totalFiles).toBe(3);
      expect(summary.succeededCount).toBe(0);
      expect(summary.failedCount).toBe(1);
      expect(summary.skippedCount).toBe(2);
      expect(summary.items[0]?.status).toBe("failed");
      expect(summary.items[1]?.status).toBe("skipped");
      expect(summary.items[2]?.status).toBe("skipped");
      expect(pipelineSpy).toHaveBeenCalledTimes(1);
    });
  });
});
