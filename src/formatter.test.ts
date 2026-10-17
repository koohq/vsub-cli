import { describe, expect, it } from "vitest";
import {
  formatChapters,
  formatEntries,
  formatSummary,
  parseChaptersFormat,
  parseOutputFormats,
  parseSummaryFormat,
  secondsToTimestamp,
  secondsToVttTimestamp,
  stringifyJson,
  stringifyTxt,
  stringifyVtt,
  timestampToSeconds,
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

  describe("timestamp utilities", () => {
    it("should format seconds to MM:SS and HH:MM:SS correctly", () => {
      expect(secondsToTimestamp(0)).toBe("00:00");
      expect(secondsToTimestamp(83)).toBe("01:23");
      expect(secondsToTimestamp(3599)).toBe("59:59");
      expect(secondsToTimestamp(3600)).toBe("01:00:00");
      expect(secondsToTimestamp(5025)).toBe("01:23:45");
    });

    it("should parse timestamp strings into seconds", () => {
      expect(timestampToSeconds("00:00")).toBe(0);
      expect(timestampToSeconds("01:23")).toBe(83);
      expect(timestampToSeconds("01:23:45")).toBe(5025);
      expect(timestampToSeconds("1:05:10")).toBe(3910);
      expect(timestampToSeconds("invalid")).toBe(0);
    });

    it("should format seconds to WebVTT timestamp (HH:MM:SS.000)", () => {
      expect(secondsToVttTimestamp(0)).toBe("00:00:00.000");
      expect(secondsToVttTimestamp(83.5)).toBe("00:01:23.500");
      expect(secondsToVttTimestamp(3661)).toBe("01:01:01.000");
    });
  });

  describe("parseChaptersFormat & parseSummaryFormat", () => {
    it("should parse valid chapters format and default to txt", () => {
      expect(parseChaptersFormat()).toBe("txt");
      expect(parseChaptersFormat("")).toBe("txt");
      expect(parseChaptersFormat("json")).toBe("json");
      expect(parseChaptersFormat("VTT")).toBe("vtt");
      expect(() => parseChaptersFormat("invalid")).toThrow(/Unsupported chapters format/);
    });

    it("should parse valid summary format and default to md", () => {
      expect(parseSummaryFormat()).toBe("md");
      expect(parseSummaryFormat("")).toBe("md");
      expect(parseSummaryFormat("txt")).toBe("txt");
      expect(parseSummaryFormat("JSON")).toBe("json");
      expect(() => parseSummaryFormat("invalid")).toThrow(/Unsupported summary format/);
    });
  });

  describe("formatChapters", () => {
    const sampleChapters = [
      { timestamp: "00:00", seconds: 0, title: "Introduction" },
      { timestamp: "01:23", seconds: 83, title: "Getting Started" },
      { timestamp: "05:10", seconds: 310, title: "Deep Dive & Demo" },
    ];

    it("should format to YouTube txt format", () => {
      const txt = formatChapters(sampleChapters, "txt");
      expect(txt).toBe("00:00 Introduction\n01:23 Getting Started\n05:10 Deep Dive & Demo\n");
    });

    it("should format to JSON format", () => {
      const jsonStr = formatChapters(sampleChapters, "json");
      expect(JSON.parse(jsonStr)).toEqual(sampleChapters);
    });

    it("should format to WebVTT chapters track format with proper ranges", () => {
      const vtt = formatChapters(sampleChapters, "vtt", 600);
      expect(vtt).toContain("WEBVTT");
      expect(vtt).toContain("00:00:00.000 --> 00:01:23.000\nIntroduction");
      expect(vtt).toContain("00:01:23.000 --> 00:05:10.000\nGetting Started");
      expect(vtt).toContain("00:05:10.000 --> 00:10:00.000\nDeep Dive & Demo");
    });

    it("should handle empty chapters array", () => {
      expect(formatChapters([], "txt")).toBe("");
      expect(formatChapters([], "json")).toBe("[]\n");
      expect(formatChapters([], "vtt")).toBe("WEBVTT\n");
    });
  });

  describe("formatSummary", () => {
    const sampleSummary = {
      title: "Meeting Overview",
      summary: "This meeting discussed release schedules and key deliverables.",
      keyPoints: ["vsub 1.4 will release next week", "All tests passed"],
      topics: [
        {
          timestamp: "00:15",
          title: "Opening Remarks",
          description: "Greeting and attendance check.",
        },
        {
          timestamp: "02:30",
          title: "Roadmap Discussion",
          description: "Review of milestone progress.",
        },
      ],
    };

    it("should format to Markdown", () => {
      const md = formatSummary(sampleSummary, "md");
      expect(md).toContain("# Meeting Overview");
      expect(md).toContain("## Summary\nThis meeting discussed release schedules");
      expect(md).toContain("- vsub 1.4 will release next week");
      expect(md).toContain("- **[00:15] Opening Remarks**: Greeting and attendance check.");
    });

    it("should format to plain text", () => {
      const txt = formatSummary(sampleSummary, "txt");
      expect(txt).toContain("Meeting Overview");
      expect(txt).toContain("[Summary]\nThis meeting discussed release schedules");
      expect(txt).toContain("• vsub 1.4 will release next week");
      expect(txt).toContain("• [00:15] Opening Remarks: Greeting and attendance check.");
    });

    it("should format to JSON", () => {
      const jsonStr = formatSummary(sampleSummary, "json");
      expect(JSON.parse(jsonStr)).toEqual(sampleSummary);
    });
  });
});
