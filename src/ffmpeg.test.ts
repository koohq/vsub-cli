import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkFfmpeg,
  extractAudio,
  isAudioFile,
  isSupportedMediaFile,
  isVideoFile,
  prepareAudio,
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
