import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { stripVTControlCharacters } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildSubtitlesFilter,
  burnSubtitlesToVideo,
  checkFfmpeg,
  embedSubtitlesToVideo,
  escapeFfmpegFilterPath,
  extractAudio,
  getMediaDurationInSeconds,
  isAudioFile,
  isSupportedMediaFile,
  isVideoFile,
  parseBurnFontSize,
  parseBurnPosition,
  parseSilenceIntervals,
  planAudioSplitPoints,
  prepareAudio,
  resolveFfprobePath,
  resolveSubtitleCodec,
} from "./ffmpeg.js";

// Mock execa
const mockExeca = vi.fn();
vi.mock("execa", () => {
  return {
    execa: (...args: unknown[]) => mockExeca(...args),
  };
});

describe("ffmpeg.ts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Media format helpers", () => {
    it("isAudioFile should identify supported audio extensions correctly", () => {
      expect(isAudioFile("song.mp3")).toBe(true);
      expect(isAudioFile("AUDIO.WAV")).toBe(true);
      expect(isAudioFile("/path/to/record.m4a")).toBe(true);
      expect(isAudioFile("track.flac")).toBe(true);
      expect(isAudioFile("podcast.ogg")).toBe(true);
      expect(isAudioFile("voice.opus")).toBe(true);
      expect(isAudioFile("audio.aac")).toBe(true);

      expect(isAudioFile("video.mp4")).toBe(false);
      expect(isAudioFile("movie.mkv")).toBe(false);
      expect(isAudioFile("subtitle.srt")).toBe(false);
    });

    it("isVideoFile should identify supported video extensions correctly", () => {
      expect(isVideoFile("movie.mp4")).toBe(true);
      expect(isVideoFile("VIDEO.MKV")).toBe(true);
      expect(isVideoFile("clip.mov")).toBe(true);
      expect(isVideoFile("stream.webm")).toBe(true);

      expect(isVideoFile("song.mp3")).toBe(false);
      expect(isVideoFile("document.pdf")).toBe(false);
    });

    it("isSupportedMediaFile should identify either audio or video extensions", () => {
      expect(isSupportedMediaFile("clip.mp4")).toBe(true);
      expect(isSupportedMediaFile("podcast.mp3")).toBe(true);
      expect(isSupportedMediaFile("notes.txt")).toBe(false);
    });
  });

  describe("resolveFfprobePath", () => {
    it("should resolve probe command for simple command names", () => {
      expect(resolveFfprobePath("ffmpeg")).toBe("ffprobe");
      expect(resolveFfprobePath("ffmpeg.exe")).toBe("ffprobe.exe");
    });

    it("should resolve probe executable path in same directory", () => {
      expect(resolveFfprobePath("/usr/local/bin/ffmpeg")).toBe("/usr/local/bin/ffprobe");
      expect(resolveFfprobePath("C:\\tools\\ffmpeg\\bin\\ffmpeg.exe")).toBe(
        "C:\\tools\\ffmpeg\\bin\\ffprobe.exe",
      );
    });
  });

  describe("getMediaDurationInSeconds", () => {
    it("should retrieve duration from ffprobe successfully", async () => {
      mockExeca.mockResolvedValueOnce({ stdout: "1200.45678\n" });

      const duration = await getMediaDurationInSeconds("segment_001.m4a", "ffmpeg");

      expect(duration).toBe(1200.45678);
      expect(mockExeca).toHaveBeenCalledWith("ffprobe", [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        "segment_001.m4a",
      ]);
    });

    it("should fallback to ffmpeg stderr parsing if ffprobe fails", async () => {
      // ffprobe fails
      mockExeca.mockRejectedValueOnce(new Error("ffprobe not found"));
      // ffmpeg succeeds with Duration info
      mockExeca.mockResolvedValueOnce({
        stdout: "",
        stderr: "Input #0, aac... Duration: 00:20:00.45, start: 0.000000, bitrate: 48 kb/s",
      });

      const duration = await getMediaDurationInSeconds("segment_001.m4a", "ffmpeg");

      expect(duration).toBeCloseTo(1200.45, 2);
    });

    it("should parse hours, minutes, and fractional seconds correctly from ffmpeg stderr", async () => {
      mockExeca.mockRejectedValueOnce(new Error("ffprobe error"));
      mockExeca.mockResolvedValueOnce({
        stdout: "",
        stderr: "Duration: 01:05:30.850, bitrate: 128 kb/s",
      });

      const duration = await getMediaDurationInSeconds("segment.m4a", "ffmpeg");

      expect(duration).toBeCloseTo(3600 + 5 * 60 + 30.85, 3);
    });

    it("should return 0 if both ffprobe and ffmpeg fail", async () => {
      mockExeca.mockRejectedValueOnce(new Error("ffprobe error"));
      mockExeca.mockRejectedValueOnce(new Error("ffmpeg error"));

      const duration = await getMediaDurationInSeconds("invalid.m4a", "ffmpeg");

      expect(duration).toBe(0);
    });
  });

  describe("checkFfmpeg", () => {
    it("should succeed when ffmpeg executes with -version", async () => {
      mockExeca.mockResolvedValueOnce({ stdout: "ffmpeg version 6.0" });
      await expect(checkFfmpeg("ffmpeg")).resolves.toBeUndefined();
      expect(mockExeca).toHaveBeenCalledWith("ffmpeg", ["-version"]);
    });

    it("should throw a user-friendly error when ffmpeg executable is not found", async () => {
      mockExeca.mockRejectedValueOnce(new Error("ENOENT"));
      await expect(checkFfmpeg("/invalid/path/ffmpeg")).rejects.toThrow(
        /ffmpeg executable not found/,
      );
    });
  });

  describe("extractAudio & prepareAudio", () => {
    const TEST_LIMITS = { maxFileBytes: 1000, segmentSeconds: 300 };
    let workDir: string;
    let inputPath: string;
    let cleanups: Array<() => Promise<void>>;

    beforeEach(() => {
      workDir = fs.mkdtempSync(path.join(os.tmpdir(), "vsub-test-"));
      inputPath = path.join(workDir, "input.mp3");
      fs.writeFileSync(inputPath, "dummy");
      cleanups = [];
    });

    afterEach(async () => {
      for (const cleanup of cleanups) await cleanup();
      fs.rmSync(workDir, { recursive: true, force: true });
    });

    /** Fakes extraction, silence detection, splitting and optional duration measurements. */
    function mockFfmpegWithExtractedSize(
      sizeBytes: number,
      segmentCount = 2,
      durationSeconds?: number | undefined,
      options: {
        silenceStderr?: string;
        detectionError?: Error;
        extractionError?: Error;
        splitError?: Error;
        segmentDurationSeconds?: number | null;
        missingExtractedFile?: boolean;
      } = {},
    ) {
      mockExeca.mockImplementation(async (_cmd: string, args: string[]) => {
        const outPath = args[args.length - 1] as string;
        if (args.includes("-segment_time") || args.includes("-segment_times")) {
          for (let i = 0; i < segmentCount; i++) {
            fs.writeFileSync(outPath.replace("%03d", String(i).padStart(3, "0")), "x");
          }
          if (options.splitError) throw options.splitError;
          return { stdout: "", stderr: "" };
        }
        if (args.includes("-vn")) {
          if (options.missingExtractedFile) return { stdout: "", stderr: "" };
          fs.writeFileSync(outPath, Buffer.alloc(sizeBytes));
          if (options.extractionError) throw options.extractionError;
          return { stdout: "", stderr: "" };
        }
        if (args.includes("-af")) {
          if (options.detectionError) throw options.detectionError;
          return { stdout: "", stderr: options.silenceStderr ?? "" };
        }
        if (durationSeconds !== undefined && args.includes("format=duration")) {
          const duration = outPath.includes("segment_")
            ? options.segmentDurationSeconds === undefined
              ? durationSeconds
              : options.segmentDurationSeconds
            : durationSeconds;
          if (duration !== null) return { stdout: `${duration}\n`, stderr: "" };
        }
        throw new Error("probe unavailable");
      });
    }

    function getSplitArgs(): string[] {
      const splitCall = mockExeca.mock.calls.find((c) => (c[1] as string[]).includes("segment"));
      expect(splitCall).toBeDefined();
      return splitCall?.[1] as string[];
    }

    it("should throw error if input media file does not exist", async () => {
      await expect(
        extractAudio("/path/to/nonexistent/video.mp4", "ffmpeg", TEST_LIMITS),
      ).rejects.toThrow(/Specified media file not found/);
      await expect(
        prepareAudio("/path/to/nonexistent/audio.mp3", "ffmpeg", TEST_LIMITS),
      ).rejects.toThrow(/Specified media file not found/);
    });

    it("should not split when extracted audio is at most maxFileBytes", async () => {
      mockFfmpegWithExtractedSize(TEST_LIMITS.maxFileBytes);

      const result = await extractAudio(inputPath, "ffmpeg", TEST_LIMITS);
      cleanups.push(result.cleanup);

      expect(mockExeca).toHaveBeenCalledTimes(1);
      expect(result.audioPaths).toHaveLength(1);
      expect(result.durations).toBeUndefined();
    });

    it("should split with segmentSeconds when audio exceeds maxFileBytes", async () => {
      mockFfmpegWithExtractedSize(TEST_LIMITS.maxFileBytes + 1);

      const result = await extractAudio(inputPath, "ffmpeg", TEST_LIMITS);
      cleanups.push(result.cleanup);

      const splitCall = mockExeca.mock.calls.find((c) =>
        (c[1] as string[]).includes("-segment_time"),
      );
      const splitArgs = splitCall?.[1] as string[];
      expect(splitArgs[splitArgs.indexOf("-segment_time") + 1]).toBe("300");
      expect(result.audioPaths).toHaveLength(2);
      // ffprobe/ffmpeg duration measurement fails, so each falls back to segmentSeconds
      expect(result.durations).toEqual([300, 300]);
    });

    it("should split when duration exceeds maxChunkSeconds even if under maxFileBytes", async () => {
      const stdout = vi.spyOn(console, "log").mockImplementation(() => {});
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      mockFfmpegWithExtractedSize(100, 2, 301);

      const result = await extractAudio(
        inputPath,
        "ffmpeg",
        {
          maxFileBytes: 1000,
          segmentSeconds: 300,
          maxChunkSeconds: 300,
        },
        true,
      );
      cleanups.push(result.cleanup);

      const splitArgs = getSplitArgs();
      expect(splitArgs[splitArgs.indexOf("-segment_times") + 1]).toBe("300.000");
      expect(result.audioPaths).toHaveLength(2);
      expect(log.mock.calls.map(([line]) => stripVTControlCharacters(String(line)))).toContain(
        "[ffmpeg] Extracted audio is longer than 300s. Splitting into segments of up to 300s at silences",
      );
      expect(stdout).not.toHaveBeenCalled();
      stdout.mockRestore();
      log.mockRestore();
    });

    it("should not split when duration is exactly maxChunkSeconds and under maxFileBytes", async () => {
      mockFfmpegWithExtractedSize(100, 2, 300);

      const result = await extractAudio(inputPath, "ffmpeg", {
        maxFileBytes: 1000,
        segmentSeconds: 300,
        maxChunkSeconds: 300,
      });
      cleanups.push(result.cleanup);

      const splitCall = mockExeca.mock.calls.find((c) =>
        (c[1] as string[]).includes("-segment_time"),
      );
      expect(splitCall).toBeUndefined();
      expect(result.audioPaths).toHaveLength(1);
    });

    it("should split when maxChunkSeconds is set but duration cannot be measured", async () => {
      mockFfmpegWithExtractedSize(100, 2); // probe unavailable (duration = 0)

      const result = await extractAudio(inputPath, "ffmpeg", {
        maxFileBytes: 1000,
        segmentSeconds: 300,
        maxChunkSeconds: 300,
      });
      cleanups.push(result.cleanup);

      const splitCall = mockExeca.mock.calls.find((c) =>
        (c[1] as string[]).includes("-segment_time"),
      );
      expect(splitCall).toBeDefined();
      expect(result.audioPaths).toHaveLength(2);
    });

    it("should not measure duration when maxChunkSeconds is not set", async () => {
      mockFfmpegWithExtractedSize(100);

      const result = await extractAudio(inputPath, "ffmpeg", TEST_LIMITS);
      cleanups.push(result.cleanup);

      expect(mockExeca).toHaveBeenCalledTimes(1);
      expect(result.audioPaths).toHaveLength(1);
    });

    it.each([false, true])("should plan silence splits with size limit: %s", async (bySize) => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        mockFfmpegWithExtractedSize(bySize ? 1001 : 100, 3, 720, {
          silenceStderr: "silence_start: 295.85\nsilence_end: 296.35 | silence_duration: 0.5",
          segmentDurationSeconds: null,
        });
        const result = await extractAudio(
          inputPath,
          "custom-ffmpeg",
          bySize ? TEST_LIMITS : { ...TEST_LIMITS, maxChunkSeconds: 300 },
          true,
        );
        cleanups.push(result.cleanup);

        const detectionCalls = mockExeca.mock.calls.filter((c) =>
          (c[1] as string[]).includes("-af"),
        );
        expect(detectionCalls).toHaveLength(1);
        expect(detectionCalls[0]).toEqual([
          "custom-ffmpeg",
          [
            "-hide_banner",
            "-nostats",
            "-i",
            expect.stringContaining("extracted.m4a"),
            "-af",
            "silencedetect=noise=-35dB:d=0.3",
            "-f",
            "null",
            "-",
          ],
        ]);
        const splitArgs = getSplitArgs();
        expect(splitArgs).not.toContain("-segment_time");
        expect(splitArgs[splitArgs.indexOf("-segment_times") + 1]).toBe("296.100,596.100");
        expect(splitArgs.slice(splitArgs.indexOf("-c"), splitArgs.indexOf("-c") + 2)).toEqual([
          "-c",
          "copy",
        ]);
        expect(result.audioPaths).toHaveLength(3);
        expect(result.durations?.[0]).toBeCloseTo(296.1);
        expect(result.durations?.[1]).toBeCloseTo(300);
        expect(result.durations?.[2]).toBeCloseTo(123.9);
        expect(log.mock.calls.map(([line]) => stripVTControlCharacters(String(line)))).toContain(
          "[ffmpeg] Split points: 296.1s, 596.1s (no silence)",
        );
        if (bySize) {
          expect(
            log.mock.calls.some(([line]) =>
              stripVTControlCharacters(String(line)).includes(
                "Splitting into segments of up to 300s at silences",
              ),
            ),
          ).toBe(true);
        }
      } finally {
        log.mockRestore();
      }
    });

    it("should use measured segment durations instead of planned lengths", async () => {
      mockFfmpegWithExtractedSize(1001, 2, 350, { segmentDurationSeconds: 175.064 });
      const result = await extractAudio(inputPath, "ffmpeg", TEST_LIMITS);
      cleanups.push(result.cleanup);
      expect(result.durations).toEqual([175.064, 175.064]);
      expect(getSplitArgs()).toContain("-segment_times");
    });

    it.each(["duration", "detection"])(
      "should explain the fixed split fallback for unavailable %s",
      async (failure) => {
        const log = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
          mockFfmpegWithExtractedSize(1001, 2, failure === "duration" ? undefined : 720, {
            detectionError: new Error("silencedetect failed"),
          });
          const result = await extractAudio(inputPath, "ffmpeg", TEST_LIMITS, true);
          cleanups.push(result.cleanup);
          const splitArgs = getSplitArgs();
          expect(splitArgs).not.toContain("-segment_times");
          expect(splitArgs[splitArgs.indexOf("-segment_time") + 1]).toBe("300");
          expect(
            log.mock.calls.some(([line]) =>
              /\[ffmpeg\].*falling back.*(?:duration|silence)/i.test(
                stripVTControlCharacters(String(line)),
              ),
            ),
          ).toBe(true);
        } finally {
          log.mockRestore();
        }
      },
    );

    it("should stay quiet without verbose output when splitting", async () => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        mockFfmpegWithExtractedSize(1001, 2, 350);
        const result = await extractAudio(inputPath, "ffmpeg", TEST_LIMITS);
        cleanups.push(result.cleanup);
        expect(log).not.toHaveBeenCalled();
      } finally {
        log.mockRestore();
      }
    });

    it.each(["extraction", "split", "missing file"])(
      "should remove temporary files on %s failure",
      async (stage) => {
        const error = new Error(`${stage} failed`);
        mockFfmpegWithExtractedSize(1001, 2, 720, {
          ...(stage === "extraction" ? { extractionError: error } : {}),
          ...(stage === "split" ? { splitError: error } : {}),
          missingExtractedFile: stage === "missing file",
        });
        const extraction = extractAudio(inputPath, "ffmpeg", TEST_LIMITS);
        if (stage === "missing file") {
          await expect(extraction).rejects.toThrow(
            "Failed to extract audio. Temporary file was not created.",
          );
        } else {
          await expect(extraction).rejects.toBe(error);
        }
        const args = mockExeca.mock.calls[0]?.[1] as string[];
        const tempDir = path.dirname(args[args.length - 1] as string);
        try {
          expect(fs.existsSync(tempDir)).toBe(false);
        } finally {
          fs.rmSync(tempDir, { recursive: true, force: true });
        }
      },
    );

    it("should preserve the original error even if removing the temporary directory fails", async () => {
      const error = new Error("extraction failed");
      mockFfmpegWithExtractedSize(1001, 2, undefined, { extractionError: error });
      const remove = vi.spyOn(fs, "rmSync").mockImplementation(() => {
        throw new Error("cleanup failed");
      });
      try {
        await expect(extractAudio(inputPath, "ffmpeg", TEST_LIMITS)).rejects.toBe(error);
        expect(remove).toHaveBeenCalledWith(expect.any(String), { recursive: true, force: true });
      } finally {
        remove.mockRestore();
        const args = mockExeca.mock.calls[0]?.[1] as string[];
        fs.rmSync(path.dirname(args[args.length - 1] as string), { recursive: true, force: true });
      }
    });

    it("prepareAudio should be an alias of extractAudio", () => {
      expect(prepareAudio).toBe(extractAudio);
    });
  });

  describe("parseSilenceIntervals", () => {
    it("should parse pairs, clamp negative starts and close trailing silence at the total duration", () => {
      const stderr = [
        "ffmpeg version test",
        "[silencedetect] silence_end: 0.1 | silence_duration: 0.1",
        "[silencedetect] silence_start: -0.05",
        "[silencedetect] silence_end: 0.5 | silence_duration: 0.55",
        "unrelated progress line",
        "[silencedetect] silence_start: 295.85",
        "[silencedetect] silence_end: 296.35 | silence_duration: 0.5",
        "[silencedetect] silence_start: 719",
      ].join("\r\n");
      expect(parseSilenceIntervals(stderr, 720)).toEqual([
        { start: 0, end: 0.5 },
        { start: 295.85, end: 296.35 },
        { start: 719, end: 720 },
      ]);
      expect(parseSilenceIntervals("no silence\n", 720)).toEqual([]);
    });
  });

  describe("planAudioSplitPoints", () => {
    it("should choose the latest silence midpoint and move the next target from that point", () => {
      expect(
        planAudioSplitPoints(
          720,
          [
            { start: 295.85, end: 296.35 },
            { start: 279, end: 281 },
          ],
          300,
        ),
      ).toEqual([
        { seconds: 296.1, noSilence: false },
        { seconds: 596.1, noSilence: true },
      ]);
    });

    it.each([
      { midpoint: 270, seconds: 300, noSilence: true },
      { midpoint: 269, seconds: 300, noSilence: true },
      { midpoint: 301, seconds: 300, noSilence: true },
      { midpoint: 300, seconds: 300, noSilence: false },
      { midpoint: 270.001, seconds: 270.001, noSilence: false },
    ])(
      "should enforce the search boundaries for midpoint $midpoint",
      ({ midpoint, seconds, noSilence }) => {
        expect(
          planAudioSplitPoints(350, [{ start: midpoint - 0.25, end: midpoint + 0.25 }], 300),
        ).toEqual([{ seconds, noSilence }]);
      },
    );

    it("should reject silence midpoints at or before the current segment start", () => {
      expect(planAudioSplitPoints(12, [{ start: -0.5, end: 0.5 }], 10)).toEqual([
        { seconds: 10, noSilence: true },
      ]);
    });

    it.each([0, 100, 300])("should not split a duration of %s seconds", (duration) => {
      expect(planAudioSplitPoints(duration, [], 300)).toEqual([]);
    });
  });

  describe("escapeFfmpegFilterPath", () => {
    it.each([
      {
        description: "escape colon and wrap in single quotes",
        input: "C:/videos/sub.srt",
        expected: "'C\\:/videos/sub.srt'",
      },
      {
        description: "escape backslashes instead of converting to forward slashes",
        input: "C:\\videos\\sub.srt",
        expected: "'C\\:\\\\videos\\\\sub.srt'",
      },
      {
        description: "escape single quotes inside path",
        input: "/path/to/my video's sub.srt",
        expected: "'/path/to/my video\\'\\''s sub.srt'",
      },
      {
        description: "escape single quotes inside directory name",
        input: "/Bob's videos/sub.srt",
        expected: "'/Bob\\'\\''s videos/sub.srt'",
      },
      {
        description: "preserve commas, semicolons, and brackets inside single quotes",
        input: "/videos/a,b;[1].srt",
        expected: "'/videos/a,b;[1].srt'",
      },
    ])("should $description ($input)", ({ input, expected }) => {
      expect(escapeFfmpegFilterPath(input)).toBe(expected);
    });
  });

  describe("burnSubtitlesToVideo", () => {
    it("should throw error if video file does not exist", async () => {
      await expect(
        burnSubtitlesToVideo("/nonexistent/video.mp4", "/path/to/sub.srt", "/path/to/out.mp4"),
      ).rejects.toThrow(/Specified video file not found/);
    });

    it("should throw error if input is an audio file", async () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(true);
      await expect(
        burnSubtitlesToVideo("/path/to/audio.mp3", "/path/to/sub.srt", "/path/to/out.mp4"),
      ).rejects.toThrow(/Cannot burn subtitles into a non-video file/);
    });

    it("should throw error if subtitle file does not exist", async () => {
      vi.spyOn(fs, "existsSync").mockImplementation((p) => {
        return p.toString().endsWith(".mp4");
      });
      await expect(
        burnSubtitlesToVideo("/path/to/video.mp4", "/nonexistent/sub.srt", "/path/to/out.mp4"),
      ).rejects.toThrow(/Specified subtitle file not found/);
    });

    it("should execute ffmpeg with subtitles filter and correct video/audio codecs", async () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(true);
      vi.spyOn(fs, "mkdirSync").mockReturnValue(undefined as unknown as string);
      mockExeca.mockResolvedValueOnce({ stdout: "" });

      const result = await burnSubtitlesToVideo("video.mp4", "sub.srt", "out.mp4", {
        ffmpegPath: "ffmpeg",
        verbose: false,
      });

      expect(mockExeca).toHaveBeenCalledTimes(1);
      const call = mockExeca.mock.calls[0];
      expect(call).toBeDefined();
      const [cmd, args] = call as [string, string[]];
      expect(cmd).toBe("ffmpeg");
      expect(args).toContain("-i");
      expect(args).toContain("-vf");
      expect(args).toContain("-c:v");
      expect(args).toContain("libx264");
      expect(args).toContain("-c:a");
      expect(args).toContain("copy");
      expect(args).toContain("-y");
      expect(result).toContain("out.mp4");
    });

    it("should pass force_style with Alignment and FontSize when position and fontSize are specified", async () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(true);
      vi.spyOn(fs, "mkdirSync").mockReturnValue(undefined as unknown as string);
      mockExeca.mockResolvedValueOnce({ stdout: "" });

      await burnSubtitlesToVideo("video.mp4", "sub.srt", "out.mp4", {
        ffmpegPath: "ffmpeg",
        position: "top",
        fontSize: "large",
      });

      const call = mockExeca.mock.calls[0];
      expect(call).toBeDefined();
      const [, args] = call as [string, string[]];
      const vfIndex = args.indexOf("-vf");
      expect(vfIndex).toBeGreaterThanOrEqual(0);
      const filterArg = args[vfIndex + 1];
      expect(filterArg).toContain("force_style='Alignment=6,FontSize=30'");
    });

    it("should pass force_style with only FontSize when position is not specified", async () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(true);
      vi.spyOn(fs, "mkdirSync").mockReturnValue(undefined as unknown as string);
      mockExeca.mockResolvedValueOnce({ stdout: "" });

      await burnSubtitlesToVideo("video.mp4", "sub.srt", "out.mp4", {
        fontSize: 24,
      });

      const call = mockExeca.mock.calls[0];
      const [, args] = call as [string, string[]];
      const vfIndex = args.indexOf("-vf");
      const filterArg = args[vfIndex + 1];
      expect(filterArg).toContain("force_style='FontSize=24'");
    });
  });

  describe("parseBurnPosition", () => {
    it("should return undefined for empty or undefined input", () => {
      expect(parseBurnPosition(undefined)).toBeUndefined();
      expect(parseBurnPosition("")).toBeUndefined();
    });

    it("should normalize valid position names", () => {
      expect(parseBurnPosition("bottom")).toBe("bottom");
      expect(parseBurnPosition("TOP")).toBe("top");
      expect(parseBurnPosition("  Center  ")).toBe("center");
    });

    it("should throw error for invalid position with localized error", () => {
      expect(() => parseBurnPosition("left")).toThrow(/Invalid subtitle burn position "left"/);
      expect(() => parseBurnPosition("left", "ja")).toThrow(/無効な字幕焼き込み位置です: "left"/);
    });
  });

  describe("parseBurnFontSize", () => {
    it("should return undefined for empty or undefined input", () => {
      expect(parseBurnFontSize(undefined)).toBeUndefined();
      expect(parseBurnFontSize("")).toBeUndefined();
      expect(parseBurnFontSize(null as unknown as undefined)).toBeUndefined();
    });

    it("should map presets to corresponding font size numbers", () => {
      expect(parseBurnFontSize("small")).toBe(16);
      expect(parseBurnFontSize("MEDIUM")).toBe(22);
      expect(parseBurnFontSize("  large  ")).toBe(30);
    });

    it("should parse valid positive numbers (both string and numeric)", () => {
      expect(parseBurnFontSize("24")).toBe(24);
      expect(parseBurnFontSize(36)).toBe(36);
      expect(parseBurnFontSize("18.4")).toBe(18);
    });

    it("should throw error for invalid font size with localized error", () => {
      expect(() => parseBurnFontSize("extra-large")).toThrow(
        /Invalid subtitle font size "extra-large"/,
      );
      expect(() => parseBurnFontSize(0)).toThrow(/Invalid subtitle font size "0"/);
      expect(() => parseBurnFontSize(-10)).toThrow(/Invalid subtitle font size "-10"/);
      expect(() => parseBurnFontSize("invalid", "ja")).toThrow(
        /無効な字幕フォントサイズです: "invalid"/,
      );
    });
  });

  describe("buildSubtitlesFilter", () => {
    it("should return basic filter string when no styling options are specified", () => {
      const filter = buildSubtitlesFilter("/path/to/sub.srt");
      expect(filter).toBe("subtitles='/path/to/sub.srt'");
    });

    it("should include Alignment when position is top or center", () => {
      expect(buildSubtitlesFilter("/path/to/sub.srt", { position: "top" })).toBe(
        "subtitles='/path/to/sub.srt':force_style='Alignment=6'",
      );
      expect(buildSubtitlesFilter("/path/to/sub.srt", { position: "center" })).toBe(
        "subtitles='/path/to/sub.srt':force_style='Alignment=10'",
      );
      expect(buildSubtitlesFilter("/path/to/sub.srt", { position: "bottom" })).toBe(
        "subtitles='/path/to/sub.srt':force_style='Alignment=2'",
      );
    });

    it("should include FontSize when fontSize is preset or numeric", () => {
      expect(buildSubtitlesFilter("/path/to/sub.srt", { fontSize: "small" })).toBe(
        "subtitles='/path/to/sub.srt':force_style='FontSize=16'",
      );
      expect(buildSubtitlesFilter("/path/to/sub.srt", { fontSize: 28 })).toBe(
        "subtitles='/path/to/sub.srt':force_style='FontSize=28'",
      );
    });

    it("should combine Alignment and FontSize when both are provided", () => {
      expect(buildSubtitlesFilter("/path/to/sub.srt", { position: "top", fontSize: "large" })).toBe(
        "subtitles='/path/to/sub.srt':force_style='Alignment=6,FontSize=30'",
      );
    });

    it("should escape single quotes in path and directory name", () => {
      expect(buildSubtitlesFilter("/Bob's videos/it's.srt", { position: "top" })).toBe(
        "subtitles='/Bob\\'\\''s videos/it\\'\\''s.srt':force_style='Alignment=6'",
      );
    });
  });

  describe("resolveSubtitleCodec", () => {
    it("should return mov_text for MP4 containers (.mp4, .m4v, .mov)", () => {
      expect(resolveSubtitleCodec(".mp4")).toBe("mov_text");
      expect(resolveSubtitleCodec("video.m4v")).toBe("mov_text");
      expect(resolveSubtitleCodec("movie.MOV")).toBe("mov_text");
    });

    it("should return srt for MKV containers (.mkv)", () => {
      expect(resolveSubtitleCodec(".mkv")).toBe("srt");
      expect(resolveSubtitleCodec("/path/to/movie.MKV")).toBe("srt");
    });

    it("should return webvtt for WebM containers (.webm)", () => {
      expect(resolveSubtitleCodec(".webm")).toBe("webvtt");
    });

    it("should throw error for unsupported container formats", () => {
      expect(() => resolveSubtitleCodec(".avi")).toThrow(
        /Unsupported video container for soft subtitles: \.avi/,
      );
      expect(() => resolveSubtitleCodec("audio.mp3")).toThrow(
        /Unsupported video container for soft subtitles: \.mp3/,
      );
    });
  });

  describe("embedSubtitlesToVideo", () => {
    it("should throw error if input video does not exist", async () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(false);
      await expect(
        embedSubtitlesToVideo("nonexistent.mp4", [{ path: "sub.srt" }], "out.mp4"),
      ).rejects.toThrow(/Specified video file not found/);
    });

    it("should throw error if input is an audio file", async () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(true);
      await expect(
        embedSubtitlesToVideo("audio.mp3", [{ path: "sub.srt" }], "out.mp4"),
      ).rejects.toThrow(/Cannot embed subtitles into a non-video file/);
    });

    it("should throw error if no subtitle tracks provided", async () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(true);
      await expect(embedSubtitlesToVideo("video.mp4", [], "out.mp4")).rejects.toThrow(
        /At least one subtitle track is required/,
      );
    });

    it("should throw error if any subtitle file does not exist", async () => {
      vi.spyOn(fs, "existsSync").mockImplementation((p) => {
        const s = p.toString();
        return s.endsWith("video.mp4") || s.endsWith("video.ja.srt");
      });
      await expect(
        embedSubtitlesToVideo(
          "video.mp4",
          [{ path: "video.ja.srt" }, { path: "nonexistent.en.srt" }],
          "out.mp4",
        ),
      ).rejects.toThrow(/Specified subtitle file not found: nonexistent\.en\.srt/);
    });

    it("should build ffmpeg args with stream copy and multi-track metadata", async () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(true);
      vi.spyOn(fs, "mkdirSync").mockReturnValue(undefined as unknown as string);
      mockExeca.mockResolvedValueOnce({ stdout: "" });

      const result = await embedSubtitlesToVideo(
        "video.mp4",
        [
          { path: "sub.ja.srt", language: "ja" },
          { path: "sub.en.srt", language: "en", title: "English Subtitles" },
        ],
        "out.mp4",
        { ffmpegPath: "my-ffmpeg", verbose: true },
      );

      expect(mockExeca).toHaveBeenCalledTimes(1);
      const [cmd, args] = mockExeca.mock.calls[0] as [string, string[]];
      expect(cmd).toBe("my-ffmpeg");

      // Verify input mappings
      expect(args[0]).toBe("-i");
      expect(args[1]).toContain("video.mp4");
      expect(args[2]).toBe("-i");
      expect(args[3]).toContain("sub.ja.srt");
      expect(args[4]).toBe("-i");
      expect(args[5]).toContain("sub.en.srt");

      // Verify stream mapping
      expect(args).toContain("-map");
      expect(args).toContain("0:v");
      expect(args).toContain("0:a?");
      expect(args).toContain("1:s");
      expect(args).toContain("2:s");

      // Verify stream copy and codec
      expect(args).toContain("-c:v");
      expect(args).toContain("copy");
      expect(args).toContain("-c:a");
      expect(args).toContain("copy");
      expect(args).toContain("-c:s");
      expect(args).toContain("mov_text");

      // Verify metadata
      expect(args).toContain("-metadata:s:s:0");
      expect(args).toContain("language=jpn");
      expect(args).toContain("title=Japanese");

      expect(args).toContain("-metadata:s:s:1");
      expect(args).toContain("language=eng");
      expect(args).toContain("title=English Subtitles");

      expect(result).toContain("out.mp4");
    });
  });
});
