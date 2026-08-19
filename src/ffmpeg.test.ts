import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkFfmpeg,
  extractAudio,
  getMediaDurationInSeconds,
  isAudioFile,
  isSupportedMediaFile,
  isVideoFile,
  prepareAudio,
  resolveFfprobePath,
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
    it("should throw error if input media file does not exist", async () => {
      await expect(extractAudio("/path/to/nonexistent/video.mp4", "ffmpeg")).rejects.toThrow(
        /Specified media file not found/,
      );
      await expect(prepareAudio("/path/to/nonexistent/audio.mp3", "ffmpeg")).rejects.toThrow(
        /Specified media file not found/,
      );
    });

    it("prepareAudio should be an alias of extractAudio", () => {
      expect(prepareAudio).toBe(extractAudio);
    });
  });
});
