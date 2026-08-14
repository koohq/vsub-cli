import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkFfmpeg, extractAudio } from "./ffmpeg.js";

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

  describe("extractAudio", () => {
    it("should throw error if input video file does not exist", async () => {
      await expect(extractAudio("/path/to/nonexistent/video.mp4", "ffmpeg")).rejects.toThrow(
        /Specified video file not found/,
      );
    });
  });
});
