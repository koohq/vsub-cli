import { describe, expect, it } from "vitest";
import {
  type ChapterItem,
  formatChapters,
  formatEntries,
  formatSummary,
  MIN_CHAPTER_SECONDS,
  MIN_YOUTUBE_CHAPTERS,
  normalizeChapters,
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
  describe("normalizeChapters", () => {
    function chapters(items: [number, string][]): ChapterItem[] {
      return items.map(([seconds, title]) => ({
        timestamp: secondsToTimestamp(seconds),
        seconds,
        title,
      }));
    }

    it("exports the YouTube chapter limits", () => {
      expect(MIN_CHAPTER_SECONDS).toBe(10);
      expect(MIN_YOUTUBE_CHAPTERS).toBe(3);
    });

    it.each<{
      name: string;
      input: [number, string][];
      expected: [number, string][];
      targetLang?: string;
      endSeconds?: number;
    }>([
      {
        name: "sorts before adjusting the first chapter",
        input: [
          [60, "B"],
          [20, "A"],
        ],
        expected: [
          [0, "A"],
          [60, "B"],
        ],
      },
      {
        name: "keeps the first duplicate in stable input order",
        input: [
          [60, "B"],
          [0, "A"],
          [60, "B2"],
        ],
        expected: [
          [0, "A"],
          [60, "B"],
        ],
      },
      {
        name: "shifts a chapter starting at exactly 30 seconds",
        input: [
          [30, "A"],
          [120, "B"],
        ],
        expected: [
          [0, "A"],
          [120, "B"],
        ],
      },
      {
        name: "adds a Japanese introduction after 30 seconds",
        targetLang: "ja-JP",
        input: [[31, "A"]],
        expected: [
          [0, "イントロダクション"],
          [31, "A"],
        ],
      },
      {
        name: "adds an English introduction after 30 seconds",
        input: [[31, "A"]],
        expected: [
          [0, "Introduction"],
          [31, "A"],
        ],
      },
      {
        name: "keeps exactly ten seconds and merges nine seconds",
        input: [
          [0, "A"],
          [20, "B"],
          [30, "C"],
          [39, "D"],
        ],
        expected: [
          [0, "A"],
          [20, "B"],
          [39, "D"],
        ],
      },
      {
        name: "keeps a final chapter of exactly ten seconds",
        endSeconds: 30,
        input: [
          [0, "A"],
          [20, "B"],
        ],
        expected: [
          [0, "A"],
          [20, "B"],
        ],
      },
      {
        name: "drops a final chapter shorter than ten seconds",
        endSeconds: 29.999,
        input: [
          [0, "A"],
          [20, "B"],
        ],
        expected: [[0, "A"]],
      },
      {
        name: "drops multiple chapters at and beyond the end",
        endSeconds: 40,
        input: [
          [0, "A"],
          [20, "B"],
          [40, "C"],
          [60, "D"],
          [80, "E"],
        ],
        expected: [
          [0, "A"],
          [20, "B"],
        ],
      },
      {
        name: "keeps the final chapter when the end is unknown",
        input: [
          [0, "A"],
          [20, "B"],
        ],
        expected: [
          [0, "A"],
          [20, "B"],
        ],
      },
      {
        name: "retains the first title while absorbing short opening chapters",
        input: [
          [0, "A"],
          [5, "B"],
          [9, "C"],
          [60, "D"],
        ],
        expected: [
          [0, "A"],
          [60, "D"],
        ],
      },
      {
        name: "merges consecutive short chapters from left to right",
        input: [
          [0, "A"],
          [20, "B"],
          [25, "C"],
          [28, "D"],
          [60, "E"],
        ],
        expected: [
          [0, "A"],
          [28, "D"],
          [60, "E"],
        ],
      },
      {
        name: "filters empty titles before sorting and deduplication",
        input: [
          [0, ""],
          [20, " \t "],
          [40, ""],
          [40, " A "],
          [80, "B"],
        ],
        expected: [
          [0, "Introduction"],
          [40, " A "],
          [80, "B"],
        ],
      },
      {
        name: "matches ticket example one",
        endSeconds: 119.84,
        input: [
          [0, "A"],
          [31, "B"],
          [62, "C"],
          [88, "D"],
          [117, "E"],
        ],
        expected: [
          [0, "A"],
          [31, "B"],
          [62, "C"],
          [88, "D"],
        ],
      },
      {
        name: "matches ticket example two",
        endSeconds: 185,
        input: [
          [0, "A"],
          [130, "D"],
          [40, "B"],
          [40, "B2"],
          [46, "C"],
          [210, "E"],
        ],
        expected: [
          [0, "A"],
          [46, "C"],
          [130, "D"],
        ],
      },
      {
        name: "matches ticket example three",
        endSeconds: 58,
        input: [
          [0, "A"],
          [20, "B"],
          [52, "C"],
        ],
        expected: [
          [0, "A"],
          [20, "B"],
        ],
      },
      {
        name: "retains a single chapter in a short source",
        endSeconds: 5,
        input: [[0, "A"]],
        expected: [[0, "A"]],
      },
      { name: "returns an empty array for empty input", input: [], expected: [] },
      {
        name: "returns an empty array when all titles are blank",
        input: [
          [0, ""],
          [20, "  "],
        ],
        expected: [],
      },
    ])(
      "$name without mutating input and is idempotent",
      ({ input, expected, targetLang = "en", endSeconds }) => {
        const source = chapters(input);
        const original = structuredClone(source);
        for (const item of source) Object.freeze(item);
        Object.freeze(source);
        const options = { targetLang, endSeconds };
        const result = normalizeChapters(source, options);
        expect(result).toEqual(chapters(expected));
        expect(normalizeChapters(result, options)).toEqual(result);
        expect(source).toEqual(original);
        expect(result).not.toBe(source);
      },
    );

    it("rebuilds timestamps from seconds", () => {
      expect(
        normalizeChapters([{ timestamp: "wrong", seconds: 0, title: "A" }], { targetLang: "en" }),
      ).toEqual(chapters([[0, "A"]]));
    });
  });

  it.each([
    {
      parse: parseChaptersFormat,
      kind: "chapters",
      japanese: "チャプター",
      supported: "txt, json, vtt",
    },
    { parse: parseSummaryFormat, kind: "summary", japanese: "要約", supported: "md, txt, json" },
  ])(
    "localizes unsupported $kind formats and preserves default English",
    ({ parse, kind, japanese, supported }) => {
      expect(() => parse("xxx", "ja")).toThrow(
        `サポートされていない${japanese}の形式です: "xxx". 利用可能な形式: ${supported}`,
      );
      expect(() => parse("xxx")).toThrow(
        `Unsupported ${kind} format: "xxx". Supported formats: ${supported}`,
      );
    },
  );

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

    it("should throw an error for unsupported formats in English by default and Japanese when specified", () => {
      expect(() => parseOutputFormats("srt,invalid,txt")).toThrow(
        /Unsupported output format: "invalid"/,
      );
      expect(() => parseOutputFormats("srt,invalid,txt", "ja")).toThrow(
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
