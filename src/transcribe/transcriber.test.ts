import { afterEach, describe, expect, it, vi } from "vitest";
import { formatSrtTime } from "../srt.js";
import {
  type ChunkTranscription,
  normalizeLanguageCode,
  type Transcriber,
  transcribeAudioSegments,
} from "./transcriber.js";
import { buildEntriesFromWords } from "./words.js";

/** Builds a fake Transcriber that returns the given chunk results in order. */
function createFakeTranscriber(
  chunks: ChunkTranscription[],
  overrides: { segmentSeconds?: number; logLabel?: string } = {},
): Transcriber & { transcribe: ReturnType<typeof vi.fn> } {
  const queue = [...chunks];
  return {
    logLabel: overrides.logLabel ?? "Fake API",
    limits: { maxFileBytes: 1024, segmentSeconds: overrides.segmentSeconds ?? 300 },
    transcribe: vi.fn(async () => queue.shift() ?? {}),
  };
}

describe("transcriber.ts", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("formatSrtTime", () => {
    it("should format 0 seconds", () => {
      expect(formatSrtTime(0)).toBe("00:00:00,000");
    });

    it("should format seconds with fractional milliseconds", () => {
      expect(formatSrtTime(1.5)).toBe("00:00:01,500");
      expect(formatSrtTime(9.025)).toBe("00:00:09,025");
    });

    it("should format minutes and seconds", () => {
      expect(formatSrtTime(65.123)).toBe("00:01:05,123");
      expect(formatSrtTime(599.999)).toBe("00:09:59,999");
    });

    it("should format hours, minutes, and seconds", () => {
      expect(formatSrtTime(3665.04)).toBe("01:01:05,040");
      expect(formatSrtTime(7325.8)).toBe("02:02:05,800");
    });

    it("should pad single digits with leading zeroes", () => {
      expect(formatSrtTime(1.005)).toBe("00:00:01,005");
    });
  });

  describe("normalizeLanguageCode", () => {
    it("should return undefined for falsy or empty values", () => {
      expect(normalizeLanguageCode(undefined)).toBeUndefined();
      expect(normalizeLanguageCode("")).toBeUndefined();
    });

    it("should map language names to 2-letter codes", () => {
      expect(normalizeLanguageCode("japanese")).toBe("ja");
      expect(normalizeLanguageCode("Japanese")).toBe("ja");
      expect(normalizeLanguageCode("ENGLISH")).toBe("en");
      expect(normalizeLanguageCode("french")).toBe("fr");
      expect(normalizeLanguageCode("german")).toBe("de");
      expect(normalizeLanguageCode("chinese")).toBe("zh");
    });

    it("should preserve valid 2-letter codes", () => {
      expect(normalizeLanguageCode("ja")).toBe("ja");
      expect(normalizeLanguageCode("en")).toBe("en");
      expect(normalizeLanguageCode("es")).toBe("es");
    });

    it("should extract 2-letter code from BCP-47 language tags", () => {
      expect(normalizeLanguageCode("en-US")).toBe("en");
      expect(normalizeLanguageCode("ja-JP")).toBe("ja");
      expect(normalizeLanguageCode("zh-CN")).toBe("zh");
    });
  });

  describe("transcribeAudioSegments", () => {
    it("should convert chunk segments to SrtEntry array", async () => {
      const transcriber = createFakeTranscriber([
        {
          language: "english",
          segments: [
            { start: 1.0, end: 3.5, text: "Hello there" },
            { start: 4.0, end: 6.2, text: "General Kenobi" },
          ],
        },
      ]);

      const result = await transcribeAudioSegments(["dummy.m4a"], transcriber);

      expect(result.detectedLanguage).toBe("en");
      expect(result.entries).toEqual([
        { id: 1, startTime: "00:00:01,000", endTime: "00:00:03,500", text: "Hello there" },
        { id: 2, startTime: "00:00:04,000", endTime: "00:00:06,200", text: "General Kenobi" },
      ]);
    });

    it("should use transcriber.limits.segmentSeconds when durations are not provided", async () => {
      const transcriber = createFakeTranscriber([
        { segments: [{ start: 10, end: 15, text: "A" }] },
        { segments: [{ start: 5, end: 10, text: "B" }] },
      ]);

      const result = await transcribeAudioSegments(["a.m4a", "b.m4a"], transcriber);

      expect(result.entries[1]).toEqual({
        id: 2,
        startTime: "00:05:05,000",
        endTime: "00:05:10,000",
        text: "B",
      });
    });

    it("should prefer measured durations over segmentSeconds", async () => {
      const transcriber = createFakeTranscriber([
        { segments: [{ start: 0, end: 1, text: "A" }] },
        { segments: [{ start: 0, end: 1, text: "B" }] },
      ]);

      const result = await transcribeAudioSegments(
        ["a.m4a", "b.m4a"],
        transcriber,
        false,
        undefined,
        {
          durations: [100.5],
        },
      );

      expect(result.entries[1]?.startTime).toBe("00:01:40,500");
    });

    it("should trim text, skip empty segments, and renumber IDs across chunks", async () => {
      const transcriber = createFakeTranscriber([
        {
          segments: [
            { start: 0, end: 1, text: "  first  " },
            { start: 1, end: 2, text: "   " },
            { start: 2, end: 3, text: "second" },
          ],
        },
        { segments: [{ start: 0, end: 1, text: "\nthird\n" }] },
      ]);

      const result = await transcribeAudioSegments(["a.m4a", "b.m4a"], transcriber);

      expect(result.entries.map((e) => [e.id, e.text])).toEqual([
        [1, "first"],
        [2, "second"],
        [3, "third"],
      ]);
    });

    it("should adopt the first normalized language found", async () => {
      const transcriber = createFakeTranscriber([
        { segments: [] },
        { language: "japanese", segments: [] },
        { language: "english", segments: [] },
      ]);

      const result = await transcribeAudioSegments(["a.m4a", "b.m4a", "c.m4a"], transcriber);

      expect(result.detectedLanguage).toBe("ja");
    });

    it("should treat a response without segments as zero segments", async () => {
      const transcriber = createFakeTranscriber([{ language: "en" }]);

      const result = await transcribeAudioSegments(["a.m4a"], transcriber);

      expect(result.entries).toEqual([]);
    });

    describe("word timings", () => {
      const wordsA = [
        { start: 0, end: 0.5, text: "あ" },
        { start: 0.5, end: 1, text: "い" },
      ];
      const wordsB = [{ start: 0, end: 0.5, text: "う" }];

      it("should build entries from words, ignore segments, and offset chunks by durations", async () => {
        const transcriber = createFakeTranscriber([
          { words: wordsA, segments: [{ start: 0, end: 1, text: "ignored" }] },
          { words: wordsB },
        ]);

        const result = await transcribeAudioSegments(
          ["a.m4a", "b.m4a"],
          transcriber,
          false,
          undefined,
          {
            durations: [100.5],
          },
        );

        expect(result.wordChunks).toEqual([
          { offsetSeconds: 0, words: wordsA },
          { offsetSeconds: 100.5, words: wordsB },
        ]);
        expect(result.entries).toEqual(buildEntriesFromWords(result.wordChunks ?? []));
        expect(result.entries.map((e) => e.text)).toEqual(["あい", "う"]);
      });

      it("should use limits.segmentSeconds as the offset when durations are missing", async () => {
        const transcriber = createFakeTranscriber([{ words: wordsA }, { words: wordsB }]);

        const result = await transcribeAudioSegments(["a.m4a", "b.m4a"], transcriber);

        expect(result.wordChunks?.map((c) => c.offsetSeconds)).toEqual([0, 300]);
      });

      it("should align mixed chunks to the word form and ignore segments of chunks without words", async () => {
        const transcriber = createFakeTranscriber([
          { segments: [{ start: 0, end: 1, text: "ignored" }] },
          { words: wordsB },
          { words: [], segments: [{ start: 0, end: 1, text: "ignored too" }] },
        ]);

        const result = await transcribeAudioSegments(["a.m4a", "b.m4a", "c.m4a"], transcriber);

        expect(result.wordChunks).toEqual([
          { offsetSeconds: 300, words: wordsB },
          { offsetSeconds: 600, words: [] },
        ]);
        expect(result.entries.map((e) => e.text)).toEqual(["う"]);
      });

      it("should not add the wordChunks key when no chunk has words", async () => {
        const transcriber = createFakeTranscriber([
          { segments: [{ start: 0, end: 1, text: "A" }] },
        ]);

        const result = await transcribeAudioSegments(["a.m4a"], transcriber);

        expect("wordChunks" in result).toBe(false);
      });
    });

    it("should forward prompt, model and verbose to transcribe()", async () => {
      vi.spyOn(console, "log").mockImplementation(() => {});
      const transcriber = createFakeTranscriber([{ segments: [] }, { segments: [] }]);

      await transcribeAudioSegments(["a.m4a", "b.m4a"], transcriber, true, undefined, {
        prompt: "GlossaryTerms",
        model: "custom-model",
      });

      expect(transcriber.transcribe).toHaveBeenCalledTimes(2);
      for (const call of transcriber.transcribe.mock.calls) {
        expect(call[1]).toEqual({ prompt: "GlossaryTerms", model: "custom-model", verbose: true });
      }
    });

    it("should call onProgress for each segment", async () => {
      const transcriber = createFakeTranscriber([{ segments: [] }, { segments: [] }]);
      const onProgress = vi.fn();

      await transcribeAudioSegments(["a.m4a", "b.m4a"], transcriber, false, onProgress);

      expect(onProgress).toHaveBeenCalledTimes(2);
      expect(onProgress).toHaveBeenNthCalledWith(1, 1, 2);
      expect(onProgress).toHaveBeenNthCalledWith(2, 2, 2);
    });

    it("should log the segment progress with logLabel only when verbose and multiple chunks", async () => {
      const log = vi.spyOn(console, "log").mockImplementation(() => {});

      await transcribeAudioSegments(
        ["a.m4a", "b.m4a"],
        createFakeTranscriber([{}, {}], { logLabel: "Fake API" }),
        true,
      );
      expect(log).toHaveBeenCalledWith("[Fake API] Transcribing segment (1/2)...");

      log.mockClear();
      await transcribeAudioSegments(["a.m4a"], createFakeTranscriber([{}]), true);
      expect(log).not.toHaveBeenCalled();

      await transcribeAudioSegments(["a.m4a", "b.m4a"], createFakeTranscriber([{}, {}]), false);
      expect(log).not.toHaveBeenCalled();
    });
  });
});
