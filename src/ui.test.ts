import { describe, expect, it } from "vitest";
import { createSpinner, formatDuration, formatFileSize, formatSummaryBox } from "./ui.js";

describe("ui module", () => {
  describe("formatDuration", () => {
    it("should format milliseconds", () => {
      expect(formatDuration(450)).toBe("450ms");
      expect(formatDuration(0)).toBe("0ms");
    });

    it("should format seconds", () => {
      expect(formatDuration(1500)).toBe("1.5s");
      expect(formatDuration(59900)).toBe("59.9s");
    });

    it("should format minutes and seconds", () => {
      expect(formatDuration(65000)).toBe("1m 5s");
      expect(formatDuration(130000)).toBe("2m 10s");
    });

    it("should format hours, minutes, and seconds", () => {
      expect(formatDuration(3665000)).toBe("1h 1m 5s");
    });
  });

  describe("formatFileSize", () => {
    it("should format bytes", () => {
      expect(formatFileSize(500)).toBe("500 B");
    });

    it("should format kilobytes", () => {
      expect(formatFileSize(2048)).toBe("2.0 KB");
      expect(formatFileSize(15360)).toBe("15.0 KB");
    });

    it("should format megabytes", () => {
      expect(formatFileSize(5 * 1024 * 1024)).toBe("5.0 MB");
      expect(formatFileSize(2.5 * 1024 * 1024)).toBe("2.5 MB");
    });
  });

  describe("formatSummaryBox", () => {
    it("should include video title, duration, languages and output files", () => {
      const summary = formatSummaryBox({
        videoFile: "test-video.mp4",
        durationMs: 12500,
        audioSegmentsCount: 1,
        audioTotalBytes: 3.5 * 1024 * 1024,
        detectedLanguage: "ja",
        targetLanguage: "en",
        entriesCount: 50,
        outputFiles: ["/path/to/test-video.en.srt"],
        skippedTranslation: false,
      });

      expect(summary).toContain("vsub-cli 処理サマリー");
      expect(summary).toContain("test-video.mp4");
      expect(summary).toContain("12.5s");
      expect(summary).toContain("JA");
      expect(summary).toContain("EN");
      expect(summary).toContain("50 行");
      expect(summary).toContain("/path/to/test-video.en.srt");
    });

    it("should format summary box correctly for audio input", () => {
      const summary = formatSummaryBox({
        mediaFile: "podcast.mp3",
        mediaType: "audio",
        durationMs: 8200,
        audioSegmentsCount: 1,
        audioTotalBytes: 1.2 * 1024 * 1024,
        detectedLanguage: "en",
        targetLanguage: "ja",
        entriesCount: 30,
        outputFiles: ["/path/to/podcast.ja.srt"],
      });

      expect(summary).toContain("対象音声");
      expect(summary).toContain("podcast.mp3");
      expect(summary).toContain("音声最適化");
      expect(summary).toContain("8.2s");
      expect(summary).toContain("EN");
      expect(summary).toContain("JA");
      expect(summary).toContain("30 行");
      expect(summary).toContain("/path/to/podcast.ja.srt");
    });

    it("should indicate when translation was skipped", () => {
      const summary = formatSummaryBox({
        videoFile: "speech.mp4",
        durationMs: 4000,
        detectedLanguage: "ja",
        targetLanguage: "ja",
        entriesCount: 20,
        outputFiles: ["/path/to/speech.ja.srt"],
        skippedTranslation: true,
      });

      expect(summary).toContain("スキップ");
    });
  });

  describe("createSpinner", () => {
    it("should create silent spinner without errors", () => {
      const spinner = createSpinner("Testing...", { isSilent: true });
      expect(() => {
        spinner.start("Starting...");
        spinner.updateText("Updating...");
        spinner.warn("Warning...");
        spinner.info("Info...");
        spinner.succeed("Done");
        spinner.fail("Failed");
        spinner.stop();
      }).not.toThrow();
    });
  });
});
