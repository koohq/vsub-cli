import { describe, expect, it } from "vitest";
import {
  formatEntries,
  parseOutputFormats,
  stringifyJson,
  stringifyTxt,
  stringifyVtt,
} from "./formatter.js";
import type { SrtEntry } from "./srt.js";

describe("formatter.ts", () => {
  const sampleEntries: SrtEntry[] = [
    {
      id: 1,
      startTime: "00:00:01,000",
      endTime: "00:00:04,000",
      text: "Hello world",
    },
    {
      id: 2,
      startTime: "00:00:05,500",
      endTime: "00:00:08,250",
      text: "This is a subtitle\nSecond line",
    },
  ];

  describe("parseOutputFormats", () => {
    it("should return ['srt'] by default when input is undefined or empty", () => {
      expect(parseOutputFormats()).toEqual(["srt"]);
      expect(parseOutputFormats("")).toEqual(["srt"]);
      expect(parseOutputFormats("   ")).toEqual(["srt"]);
    });

    it("should parse single valid format", () => {
      expect(parseOutputFormats("vtt")).toEqual(["vtt"]);
      expect(parseOutputFormats("txt")).toEqual(["txt"]);
      expect(parseOutputFormats("json")).toEqual(["json"]);
    });

    it("should parse comma-separated formats with whitespace and mixed casing", () => {
      expect(parseOutputFormats(" SRT , Vtt , txt , JSON ")).toEqual(["srt", "vtt", "txt", "json"]);
    });

    it("should deduplicate repeated format entries", () => {
      expect(parseOutputFormats("srt,vtt,srt,vtt,json")).toEqual(["srt", "vtt", "json"]);
    });

    it("should throw an error for unsupported formats", () => {
      expect(() => parseOutputFormats("srt,invalid,txt")).toThrow(
        /サポートされていない出力フォーマットです: "invalid"/,
      );
    });
  });

  describe("stringifyVtt", () => {
    it("should format entries to WebVTT with header and dot timestamps", () => {
      const vtt = stringifyVtt(sampleEntries);
      expect(vtt).toBe(
        `WEBVTT

1
00:00:01.000 --> 00:00:04.000
Hello world

2
00:00:05.500 --> 00:00:08.250
This is a subtitle
Second line
`,
      );
    });

    it("should handle empty entries array", () => {
      expect(stringifyVtt([])).toBe("WEBVTT\n");
    });

    it("should assign sequential IDs if id is 0 or undefined", () => {
      const entries: SrtEntry[] = [
        {
          id: 0,
          startTime: "00:00:01,000",
          endTime: "00:00:02,000",
          text: "Entry without id",
        },
      ];
      const vtt = stringifyVtt(entries);
      expect(vtt).toContain("1\n00:00:01.000 --> 00:00:02.000\nEntry without id");
    });
  });

  describe("stringifyTxt", () => {
    it("should format entries to plain text transcript without timestamps", () => {
      const txt = stringifyTxt(sampleEntries);
      expect(txt).toBe("Hello world\nThis is a subtitle\nSecond line\n");
    });

    it("should handle empty entries array", () => {
      expect(stringifyTxt([])).toBe("");
    });
  });

  describe("stringifyJson", () => {
    it("should format entries as structured JSON array with 2-space indentation", () => {
      const jsonStr = stringifyJson(sampleEntries);
      const parsed = JSON.parse(jsonStr);
      expect(parsed).toEqual(sampleEntries);
      expect(jsonStr).toContain('  "id": 1');
    });

    it("should handle empty entries array", () => {
      expect(stringifyJson([])).toBe("[]\n");
    });
  });

  describe("formatEntries", () => {
    it("should delegate to stringifySrt for srt format", () => {
      const result = formatEntries(sampleEntries, "srt");
      expect(result).toContain("00:00:01,000 --> 00:00:04,000");
      expect(result).not.toContain("WEBVTT");
    });

    it("should delegate to stringifyVtt for vtt format", () => {
      const result = formatEntries(sampleEntries, "vtt");
      expect(result.startsWith("WEBVTT")).toBe(true);
      expect(result).toContain("00:00:01.000 --> 00:00:04.000");
    });

    it("should delegate to stringifyTxt for txt format", () => {
      const result = formatEntries(sampleEntries, "txt");
      expect(result).toBe("Hello world\nThis is a subtitle\nSecond line\n");
    });

    it("should delegate to stringifyJson for json format", () => {
      const result = formatEntries(sampleEntries, "json");
      expect(JSON.parse(result)).toEqual(sampleEntries);
    });
  });
});
