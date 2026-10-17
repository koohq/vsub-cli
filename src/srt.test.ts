import { describe, expect, it } from "vitest";
import {
  formatSrtTime,
  formatSrtTimeMs,
  isCjkText,
  mergeBilingualEntries,
  parseSrt,
  parseSrtTime,
  reflowSrtEntries,
  stringifySrt,
} from "./srt.js";

describe("srt.ts", () => {
  describe("parseSrt", () => {
    it("should parse standard SRT content correctly", () => {
      const srtText = `1
00:00:01,000 --> 00:00:04,000
Hello world

2
00:00:05,500 --> 00:00:08,000
This is a test subtitle.`;

      const entries = parseSrt(srtText);
      expect(entries).toEqual([
        {
          id: 1,
          startTime: "00:00:01,000",
          endTime: "00:00:04,000",
          text: "Hello world",
        },
        {
          id: 2,
          startTime: "00:00:05,500",
          endTime: "00:00:08,000",
          text: "This is a test subtitle.",
        },
      ]);
    });

    it("should handle multi-line subtitle text", () => {
      const srtText = `1
00:00:01,000 --> 00:00:04,000
Line one
Line two
Line three`;

      const entries = parseSrt(srtText);
      expect(entries).toHaveLength(1);
      expect(entries[0]?.text).toBe("Line one\nLine two\nLine three");
    });

    it("should normalize dot separators in timestamps to commas", () => {
      const srtText = `1
00:00:01.250 --> 00:00:04.750
Testing dot millisecond format`;

      const entries = parseSrt(srtText);
      expect(entries).toEqual([
        {
          id: 1,
          startTime: "00:00:01,250",
          endTime: "00:00:04,750",
          text: "Testing dot millisecond format",
        },
      ]);
    });

    it("should handle CRLF (Windows) line endings", () => {
      const srtText =
        "1\r\n00:00:01,000 --> 00:00:03,000\r\nHello\r\n\r\n2\r\n00:00:04,000 --> 00:00:06,000\r\nWorld";

      const entries = parseSrt(srtText);
      expect(entries).toHaveLength(2);
      expect(entries[0]?.text).toBe("Hello");
      expect(entries[1]?.text).toBe("World");
    });

    it("should ignore invalid or malformed blocks", () => {
      const srtText = `Invalid block without timestamp

1
00:00:01,000 --> 00:00:03,000
Valid item

Not a number
00:00:04,000 --> 00:00:06,000
Invalid ID

2
invalid-time-format
Invalid time`;

      const entries = parseSrt(srtText);
      expect(entries).toHaveLength(1);
      expect(entries[0]?.id).toBe(1);
      expect(entries[0]?.text).toBe("Valid item");
    });

    it("should return an empty array for empty or whitespace-only input", () => {
      expect(parseSrt("")).toEqual([]);
      expect(parseSrt("   \n\n\r\n   ")).toEqual([]);
    });
  });

  describe("stringifySrt", () => {
    it("should format SrtEntry array into valid SRT string", () => {
      const entries = [
        {
          id: 1,
          startTime: "00:00:01,000",
          endTime: "00:00:04,000",
          text: "First entry",
        },
        {
          id: 2,
          startTime: "00:00:05,000",
          endTime: "00:00:08,000",
          text: "Second entry",
        },
      ];

      const expected = `1
00:00:01,000 --> 00:00:04,000
First entry

2
00:00:05,000 --> 00:00:08,000
Second entry
`;

      expect(stringifySrt(entries)).toBe(expected);
    });

    it("should assign sequential IDs if id is 0 or undefined", () => {
      const entries = [
        {
          id: 0,
          startTime: "00:00:01,000",
          endTime: "00:00:02,000",
          text: "Zero ID entry",
        },
      ];

      const result = stringifySrt(entries);
      expect(result).toContain("1\n00:00:01,000 --> 00:00:02,000\nZero ID entry");
    });

    it("should maintain roundtrip parity between stringifySrt and parseSrt", () => {
      const originalEntries = [
        {
          id: 1,
          startTime: "00:00:01,000",
          endTime: "00:00:04,000",
          text: "Hello",
        },
        {
          id: 2,
          startTime: "00:00:05,000",
          endTime: "00:00:08,000",
          text: "World\nMultiple lines",
        },
      ];

      const srtString = stringifySrt(originalEntries);
      const parsed = parseSrt(srtString);
      expect(parsed).toEqual(originalEntries);
    });
  });

  describe("mergeBilingualEntries", () => {
    it("should merge original and translated entries with original-first by default", () => {
      const original = [
        { id: 1, startTime: "00:00:01,000", endTime: "00:00:04,000", text: "Hello" },
        { id: 2, startTime: "00:00:05,000", endTime: "00:00:08,000", text: "Goodbye" },
      ];
      const translated = [
        { id: 1, startTime: "00:00:01,000", endTime: "00:00:04,000", text: "こんにちは" },
        { id: 2, startTime: "00:00:05,000", endTime: "00:00:08,000", text: "さようなら" },
      ];

      const merged = mergeBilingualEntries(original, translated);
      expect(merged).toEqual([
        { id: 1, startTime: "00:00:01,000", endTime: "00:00:04,000", text: "Hello\nこんにちは" },
        { id: 2, startTime: "00:00:05,000", endTime: "00:00:08,000", text: "Goodbye\nさようなら" },
      ]);
    });

    it("should respect target-first order when specified", () => {
      const original = [
        { id: 1, startTime: "00:00:01,000", endTime: "00:00:04,000", text: "Hello" },
      ];
      const translated = [
        { id: 1, startTime: "00:00:01,000", endTime: "00:00:04,000", text: "こんにちは" },
      ];

      const merged = mergeBilingualEntries(original, translated, { order: "target-first" });
      expect(merged).toEqual([
        { id: 1, startTime: "00:00:01,000", endTime: "00:00:04,000", text: "こんにちは\nHello" },
      ]);
    });

    it("should support custom separator", () => {
      const original = [
        { id: 1, startTime: "00:00:01,000", endTime: "00:00:04,000", text: "Hello" },
      ];
      const translated = [
        { id: 1, startTime: "00:00:01,000", endTime: "00:00:04,000", text: "こんにちは" },
      ];

      const merged = mergeBilingualEntries(original, translated, { separator: " / " });
      expect(merged[0]?.text).toBe("Hello / こんにちは");
    });

    it("should avoid duplicate lines if original and translated text are identical", () => {
      const original = [
        { id: 1, startTime: "00:00:01,000", endTime: "00:00:04,000", text: "Google" },
      ];
      const translated = [
        { id: 1, startTime: "00:00:01,000", endTime: "00:00:04,000", text: "Google" },
      ];

      const merged = mergeBilingualEntries(original, translated);
      expect(merged[0]?.text).toBe("Google");
    });

    it("should handle missing or empty translated entry gracefully", () => {
      const original = [
        { id: 1, startTime: "00:00:01,000", endTime: "00:00:04,000", text: "Hello" },
        { id: 2, startTime: "00:00:05,000", endTime: "00:00:08,000", text: "World" },
      ];
      const translated = [{ id: 1, startTime: "00:00:01,000", endTime: "00:00:04,000", text: "" }];

      const merged = mergeBilingualEntries(original, translated);
      expect(merged[0]?.text).toBe("Hello");
      expect(merged[1]?.text).toBe("World");
    });

    it("should handle empty originalEntries", () => {
      expect(mergeBilingualEntries([], [])).toEqual([]);
    });
  });

  describe("time formatting and parsing", () => {
    it("should parse standard SRT timestamps into milliseconds", () => {
      expect(parseSrtTime("00:01:02,500")).toBe(62500);
      expect(parseSrtTime("01:00:00.000")).toBe(3600000);
      expect(parseSrtTime("00:00:00,000")).toBe(0);
      expect(parseSrtTime("invalid")).toBe(0);
    });

    it("should format milliseconds into standard SRT format", () => {
      expect(formatSrtTimeMs(62500)).toBe("00:01:02,500");
      expect(formatSrtTimeMs(0)).toBe("00:00:00,000");
      expect(formatSrtTimeMs(3661001)).toBe("01:01:01,001");
    });

    it("should format seconds into standard SRT format", () => {
      expect(formatSrtTime(62.5)).toBe("00:01:02,500");
      expect(formatSrtTime(0)).toBe("00:00:00,000");
    });

    it("should correctly identify CJK text", () => {
      expect(isCjkText("こんにちは世界")).toBe(true);
      expect(isCjkText("これはテストです。")).toBe(true);
      expect(isCjkText("你好世界")).toBe(true);
      expect(isCjkText("안녕하세요")).toBe(true);
      expect(isCjkText("Hello world!")).toBe(false);
      expect(isCjkText("12345 67890 !?")).toBe(false);
    });
  });

  describe("reflowSrtEntries", () => {
    it("should return empty array for empty input", () => {
      expect(reflowSrtEntries([])).toEqual([]);
    });

    it("should respect noReflow: true and return entries unchanged", () => {
      const longText =
        "This is an extremely long subtitle entry that definitely exceeds standard length limits and would normally be split into multiple smaller segments.";
      const entries = [
        {
          id: 1,
          startTime: "00:00:01,000",
          endTime: "00:00:15,000",
          text: longText,
        },
      ];

      const result = reflowSrtEntries(entries, { noReflow: true });
      expect(result).toHaveLength(1);
      expect(result[0]?.text).toBe(longText);
    });

    it("should keep short entries unchanged", () => {
      const entries = [
        {
          id: 1,
          startTime: "00:00:01,000",
          endTime: "00:00:03,000",
          text: "Short subtitle.",
        },
        {
          id: 2,
          startTime: "00:00:04,000",
          endTime: "00:00:06,000",
          text: "Another short one.",
        },
      ];

      const result = reflowSrtEntries(entries);
      expect(result).toEqual(entries);
    });

    it("should split long English entry with sentences and preserve boundary times", () => {
      const entries = [
        {
          id: 1,
          startTime: "00:00:00,000",
          endTime: "00:00:12,000",
          text: "In this tutorial we will learn how to configure containers. Then we will deploy them to Kubernetes clusters for scalable production use.",
        },
      ];

      const result = reflowSrtEntries(entries, { maxLength: 70 });
      expect(result.length).toBeGreaterThanOrEqual(2);

      // Verify timing continuity and bounds
      expect(result[0]?.startTime).toBe("00:00:00,000");
      expect(result[result.length - 1]?.endTime).toBe("00:00:12,000");

      for (let i = 0; i < result.length - 1; i++) {
        expect(result[i]?.endTime).toBe(result[i + 1]?.startTime);
      }

      // Check IDs are sequential 1, 2, ...
      result.forEach((entry, idx) => {
        expect(entry.id).toBe(idx + 1);
      });
    });

    it("should split long English entry at commas without breaking words", () => {
      const text =
        "Today we are discussing Docker architecture, container orchestration systems, continuous integration pipelines, and cloud monitoring tools.";
      const entries = [
        {
          id: 5,
          startTime: "00:01:00,000",
          endTime: "00:01:14,000",
          text,
        },
      ];

      const result = reflowSrtEntries(entries, { maxLength: 60 });
      expect(result.length).toBeGreaterThanOrEqual(2);

      // Check that all words are intact and no weird cutoffs
      const reconstructed = result.map((r) => r.text).join(" ");
      expect(reconstructed).toContain("Docker architecture");
      expect(reconstructed).toContain("container orchestration systems");
      expect(reconstructed).toContain("cloud monitoring tools");

      result.forEach((entry) => {
        expect(entry.text.length).toBeLessThanOrEqual(65);
      });
    });

    it("should split long Japanese text at punctuation marks with CJK default maxLength", () => {
      const text =
        "皆さんこんにちは。今回はDockerとKubernetesを使った最新のクラウドデプロイ手法について、初心者向けにわかりやすく解説していきます。";
      const entries = [
        {
          id: 1,
          startTime: "00:00:00,000",
          endTime: "00:00:10,000",
          text,
        },
      ];

      const result = reflowSrtEntries(entries);
      expect(result.length).toBeGreaterThanOrEqual(2);

      expect(result[0]?.startTime).toBe("00:00:00,000");
      expect(result[result.length - 1]?.endTime).toBe("00:00:10,000");

      // Verify continuity
      for (let i = 0; i < result.length - 1; i++) {
        expect(result[i]?.endTime).toBe(result[i + 1]?.startTime);
      }
    });

    it("should split entries exceeding maxDuration even if text is moderate length", () => {
      const entries = [
        {
          id: 1,
          startTime: "00:00:00,000",
          endTime: "00:00:18,000", // 18 seconds duration
          text: "First topic of discussion. Second important point to consider. Third closing thought.",
        },
      ];

      const result = reflowSrtEntries(entries, { maxDuration: 6 });
      expect(result.length).toBeGreaterThanOrEqual(3);
      expect(result[0]?.startTime).toBe("00:00:00,000");
      expect(result[result.length - 1]?.endTime).toBe("00:00:18,000");
    });

    it("should safely split single unbroken strings exceeding maxLength", () => {
      const longUrl =
        "https://example.com/very/long/unbroken/path/that/exceeds/the/max/character/limit/test";
      const entries = [
        {
          id: 1,
          startTime: "00:00:00,000",
          endTime: "00:00:06,000",
          text: longUrl,
        },
      ];

      const result = reflowSrtEntries(entries, { maxLength: 30 });
      expect(result.length).toBeGreaterThanOrEqual(2);
      expect(result[0]?.text.length).toBeLessThanOrEqual(30);
      expect(result[0]?.startTime).toBe("00:00:00,000");
      expect(result[result.length - 1]?.endTime).toBe("00:00:06,000");
    });

    it("should split multi-line entry if exceeding length", () => {
      const entries = [
        {
          id: 1,
          startTime: "00:00:00,000",
          endTime: "00:00:08,000",
          text: "Line one of subtitle that is fairly long and detailed\nLine two of subtitle that also contains important information",
        },
      ];

      const result = reflowSrtEntries(entries, { maxLength: 50 });
      expect(result.length).toBeGreaterThanOrEqual(2);
      expect(result[0]?.text).toContain("Line one");
      expect(result.some((r) => r.text.includes("Line two"))).toBe(true);
    });
  });
});
