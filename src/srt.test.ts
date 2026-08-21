import { describe, expect, it } from "vitest";
import { mergeBilingualEntries, parseSrt, stringifySrt } from "./srt.js";

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
});
