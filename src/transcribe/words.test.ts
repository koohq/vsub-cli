import { describe, expect, it } from "vitest";
import { formatSrtTime, type SrtEntry } from "../srt.js";
import type { TimedText } from "./transcriber.js";
import { buildEntriesFromWords, type WordChunk, type WordSegmentationOptions } from "./words.js";

const KANA = "あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほ";

/** Builds one word: `[start-end] text` in seconds. */
function w(start: number, end: number, text: string): TimedText {
  return { start, end, text };
}

/** Builds `count` one-character words, `step` seconds each, starting at `startSec`. */
function kanaWords(count: number, startSec: number, step = 0.1): TimedText[] {
  return Array.from({ length: count }, (_, i) =>
    w(startSec + i * step, startSec + (i + 1) * step, KANA[i % KANA.length] ?? ""),
  );
}

/** Builds `count` words `w<from>`..., `step` seconds each, with no gaps. */
function latinWords(from: number, count: number, startSec: number, step = 0.5): TimedText[] {
  return Array.from({ length: count }, (_, i) =>
    w(startSec + i * step, startSec + (i + 1) * step, `w${from + i}`),
  );
}

function chunk(words: TimedText[], offsetSeconds = 0): WordChunk {
  return { offsetSeconds, words };
}

/** Expected entry: `[start-end] text` in seconds. */
type Expected = [start: number, end: number, text: string];

function entries(expected: Expected[]): SrtEntry[] {
  return expected.map(([start, end, text], i) => ({
    id: i + 1,
    startTime: formatSrtTime(start),
    endTime: formatSrtTime(end),
    text,
  }));
}

/** Builds from a single chunk at offset 0. */
function build(words: TimedText[], options?: WordSegmentationOptions): SrtEntry[] {
  return buildEntriesFromWords([chunk(words)], options);
}

describe("buildEntriesFromWords", () => {
  describe("rule examples", () => {
    it.each<{ name: string; chunks: WordChunk[]; expected: Expected[] }>([
      {
        name: "1: cuts at a gap of 1.0s or more; extends by 1.0s; no extension for the last",
        chunks: [
          chunk([
            w(0, 0.3, "今日"),
            w(0.3, 0.5, "は"),
            w(0.5, 0.9, "晴れ"),
            w(2.1, 2.4, "明日"),
            w(2.4, 2.7, "も"),
          ]),
        ],
        expected: [
          [0, 1.9, "今日は晴れ"],
          [2.1, 2.7, "明日も"],
        ],
      },
      {
        name: "2: does not cut at a 0.6s gap",
        chunks: [chunk([w(0, 0.4, "ええと"), w(1.0, 1.3, "それで"), w(1.3, 1.6, "いい")])],
        expected: [[0, 1.6, "ええとそれでいい"]],
      },
      {
        name: "3: cuts at a sentence end even with a short gap; zero-length punctuation; min display 0.5s for the last",
        chunks: [
          chunk([w(0.2, 0.5, "はい"), w(0.5, 0.5, "。"), w(0.8, 1.1, "了解"), w(1.1, 1.1, "。")]),
        ],
        expected: [
          [0.2, 0.8, "はい。"],
          [0.8, 1.3, "了解。"],
        ],
      },
      {
        name: "4: punctuation keeps the end; opening bracket goes to the next word; min display 0.5s",
        chunks: [
          chunk([
            w(0, 0.45, "行く"),
            w(0.5, 0.58, "。"),
            w(3.0, 3.1, "「"),
            w(3.1, 3.4, "待って"),
            w(3.45, 3.5, "」"),
          ]),
        ],
        expected: [
          [0, 0.5, "行く。"],
          [3.1, 3.6, "「待って」"],
        ],
      },
      {
        name: "5: extension by room (>=2.0s none, 1.5s -> 1.0s, 0.4s -> filled)",
        chunks: [
          chunk([w(0, 1.0, "Yes."), w(3.5, 4.0, "No."), w(5.5, 6.0, "Wait."), w(6.4, 7.0, "Go.")]),
        ],
        expected: [
          [0, 1.0, "Yes."],
          [3.5, 5.0, "No."],
          [5.5, 6.4, "Wait."],
          [6.4, 7.0, "Go."],
        ],
      },
      {
        name: "6: splits an over-long group after a comma-like mark",
        chunks: [chunk([...kanaWords(15, 0), w(1.5, 1.5, "、"), ...kanaWords(21, 1.5)])],
        expected: [
          [0, 1.5, `${KANA.repeat(2).slice(0, 15)}、`],
          [1.5, 3.6, KANA.repeat(2).slice(0, 21)],
        ],
      },
      {
        name: "7: splits an over-long group at the widest gap in the middle half (Latin)",
        chunks: [chunk([...latinWords(1, 10, 0), ...latinWords(11, 6, 5.3)])],
        expected: [
          [0, 5.3, Array.from({ length: 10 }, (_, i) => `w${i + 1}`).join(" ")],
          [5.3, 8.3, Array.from({ length: 6 }, (_, i) => `w${i + 11}`).join(" ")],
        ],
      },
      {
        name: "8: clamps a word longer than 1.5s; min display 0.5s for the last",
        chunks: [chunk([w(1.0, 4.0, "ああ"), w(6.0, 6.3, "うん")])],
        expected: [
          [1.0, 2.5, "ああ"],
          [6.0, 6.5, "うん"],
        ],
      },
      {
        name: "9: builds per chunk; extension crosses chunks; chunk boundary always cuts; min display 0.5s for the last",
        chunks: [chunk([w(299.0, 299.5, "そう")]), chunk([w(0.3, 0.6, "だね")], 300)],
        expected: [
          [299.0, 300.3, "そう"],
          [300.3, 300.8, "だね"],
        ],
      },
      {
        name: "10: joins without a space next to CJK, with a space between Latin words",
        chunks: [
          chunk([
            w(0, 0.3, "Hello"),
            w(0.3, 0.5, "世界"),
            w(0.5, 0.7, "API"),
            w(0.7, 0.9, "key"),
            w(0.9, 0.9, "!"),
          ]),
        ],
        expected: [[0, 0.9, "Hello世界API key!"]],
      },
    ])("$name", ({ chunks, expected }) => {
      expect(buildEntriesFromWords(chunks)).toEqual(entries(expected));
    });
  });

  describe("boundaries and edges", () => {
    it.each([
      { name: "exactly 2.0s", gapStart: 2.5, expectedEnd: 0.5 },
      { name: "1.999s", gapStart: 2.499, expectedEnd: 1.5 },
    ])("extension room of $name", ({ gapStart, expectedEnd }) => {
      const result = build([w(0, 0.5, "あ"), w(gapStart, gapStart + 0.5, "い")]);
      expect(result[0]?.endTime).toBe(formatSrtTime(expectedEnd));
    });

    it("does not extend across overlapping chunks and keeps start order", () => {
      const result = buildEntriesFromWords([
        chunk([w(299.5, 300.5, "あ")]),
        chunk([w(0.2, 0.5, "い")], 300),
      ]);
      expect(result.map((e) => e.endTime)).toEqual(["00:05:00,500", "00:05:00,700"]);
      expect(result.map((e) => e.startTime)).toEqual(["00:04:59,500", "00:05:00,200"]);
    });

    it("cuts at a gap of exactly 1.0s but not at 0.999s", () => {
      expect(build([w(0, 0.5, "あ"), w(1.5, 2.0, "い")])).toHaveLength(2);
      expect(build([w(0, 0.5, "あ"), w(1.499, 2.0, "い")])).toHaveLength(1);
    });

    it.each([
      { duration: 1.499, expectedEnd: "00:00:01,499" },
      { duration: 1.5, expectedEnd: "00:00:01,500" },
      { duration: 1.501, expectedEnd: "00:00:01,500" },
    ])("word duration $duration", ({ duration, expectedEnd }) => {
      expect(build([w(0, duration, "あ")])[0]?.endTime).toBe(expectedEnd);
    });

    it("is not confused by floating point error in the gap (2.3 - 0.3)", () => {
      const result = build([w(0, 0.3, "あ"), w(2.3, 2.5, "い")]);
      expect(result[0]?.endTime).toBe(formatSrtTime(0.5));
    });

    it("rounds seconds to whole milliseconds before comparing (1.005 * 1000 is 1004.999...)", () => {
      expect(build([w(0, 0.005, "あ"), w(1.005, 1.5, "い")])).toHaveLength(2);
    });

    it("never splits a single word, even when over the limits", () => {
      expect(build([w(0, 1, "あ".repeat(40))])).toHaveLength(1);
      expect(build([w(0, 1.5, "あ")], { maxDuration: 1 })).toHaveLength(1);
    });

    it("splits even when no boundary is in the middle half", () => {
      const result = build([w(0, 0.1, "あ"), w(0.1, 0.5, "い".repeat(40))]);
      expect(result.map((e) => e.text)).toEqual(["あ", "い".repeat(40)]);
    });

    it("drops empty words and sets end to start when end < start", () => {
      const result = build([w(0, 0.5, "  "), w(0.5, 0.6, ""), w(1, 0.5, " あ ")]);
      expect(result).toEqual(entries([[1, 1.5, "あ"]]));
    });

    it("returns nothing for punctuation-only, empty words and empty chunks", () => {
      expect(build([w(0, 0.1, "。"), w(0.1, 0.2, "「")])).toEqual([]);
      expect(build([])).toEqual([]);
      expect(buildEntriesFromWords([])).toEqual([]);
    });

    it("attaches leading punctuation to the next word", () => {
      expect(build([w(0, 0, "。"), w(0.1, 0.2, "あ")])[0]?.text).toBe("。あ");
    });

    it("numbers ids from 1 across chunks", () => {
      const result = buildEntriesFromWords([
        chunk([w(0, 0.5, "あ"), w(3, 3.5, "い")]),
        chunk([w(0, 0.5, "う")], 10),
      ]);
      expect(result.map((e) => e.id)).toEqual([1, 2, 3]);
    });
  });

  describe("options", () => {
    it("uses maxLength and maxDuration when given", () => {
      expect(build(kanaWords(12, 0))).toHaveLength(1);
      expect(build(kanaWords(12, 0), { maxLength: 10 })).toHaveLength(2);
      expect(build(kanaWords(8, 0, 0.5))).toHaveLength(1);
      expect(build(kanaWords(8, 0, 0.5), { maxDuration: 3 })).toHaveLength(2);
    });

    it("treats non-positive limits as defaults", () => {
      expect(build(kanaWords(12, 0), { maxLength: 0, maxDuration: 0 })).toHaveLength(1);
      expect(build(kanaWords(40, 0), { maxLength: 0 })).toHaveLength(2);
    });

    it("noLimits skips the limits but still cuts and extends", () => {
      const words = [...kanaWords(15, 0), w(1.5, 1.5, "、"), ...kanaWords(21, 1.5)];
      expect(build(words, { noLimits: true })).toHaveLength(1);

      const cut = build([...words, ...kanaWords(2, 5.0)], { noLimits: true });
      expect(cut).toHaveLength(2);
      expect(cut[0]?.endTime).toBe(formatSrtTime(4.6));
    });
  });

  describe("minimum display duration (step 8)", () => {
    it("extends a zero-length single-word subtitle followed by a >=2s gap to 0.5s", () => {
      const result = build([w(1.0, 1.0, "あい"), w(1.0, 1.0, "。"), w(4.0, 4.8, "うえ")]);
      expect(result).toEqual(
        entries([
          [1.0, 1.5, "あい。"],
          [4.0, 4.8, "うえ"],
        ]),
      );
    });

    it("extends the last subtitle to 0.5s when its duration is zero", () => {
      const result = build([w(0, 0, "あ")]);
      expect(result).toEqual(entries([[0, 0.5, "あ"]]));
    });

    it("does not exceed the start of the next subtitle", () => {
      const result = build([w(0, 0.1, "あ。"), w(0.3, 1.0, "い")]);
      expect(result).toEqual(
        entries([
          [0, 0.3, "あ。"],
          [0.3, 1.0, "い"],
        ]),
      );
    });

    it("applies step 7 (extension) before step 8 (min display)", () => {
      const result = build([w(0, 0.1, "あ"), w(2.3, 2.9, "い")]);
      expect(result).toEqual(
        entries([
          [0, 0.5, "あ"],
          [2.3, 2.9, "い"],
        ]),
      );
    });

    it("does not shorten overlapping subtitles", () => {
      const result = buildEntriesFromWords([
        chunk([w(299.8, 300.0, "あ")]),
        chunk([w(0, 0.6, "い")], 299.9),
      ]);
      expect(result.map((e) => e.startTime)).toEqual(["00:04:59,800", "00:04:59,900"]);
      expect(result.map((e) => e.endTime)).toEqual(["00:05:00,000", "00:05:00,500"]);
    });

    it.each([
      { name: "exactly 0.5s", duration: 0.5, expectedEnd: 0.5 },
      { name: "0.499s", duration: 0.499, expectedEnd: 0.5 },
    ])("boundary of $name duration", ({ duration, expectedEnd }) => {
      const result = build([w(0, duration, "あ"), w(3.0, 3.6, "い")]);
      expect(result[0]?.endTime).toBe(formatSrtTime(expectedEnd));
    });

    it("applies minimum display duration even with noLimits: true", () => {
      const result = build([w(1.0, 1.0, "あい"), w(1.0, 1.0, "。"), w(4.0, 4.8, "うえ")], {
        noLimits: true,
      });
      expect(result[0]?.startTime).toBe(formatSrtTime(1.0));
      expect(result[0]?.endTime).toBe(formatSrtTime(1.5));
    });
  });
});
