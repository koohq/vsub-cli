import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execa } from "execa";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type BurnPosition, buildSubtitlesFilter, burnSubtitlesToVideo } from "./ffmpeg.js";

async function checkFfmpegSupport(): Promise<boolean> {
  try {
    const filtersResult = await execa("ffmpeg", ["-hide_banner", "-filters"], {
      reject: false,
    });
    const encodersResult = await execa("ffmpeg", ["-hide_banner", "-encoders"], {
      reject: false,
    });
    return (
      filtersResult.exitCode === 0 &&
      filtersResult.stdout.includes("subtitles") &&
      encodersResult.exitCode === 0 &&
      encodersResult.stdout.includes("libx264")
    );
  } catch {
    return false;
  }
}

const hasFfmpeg = await checkFfmpegSupport();

describe.skipIf(!hasFfmpeg)("subtitles filter with real ffmpeg", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vsub-burn-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function writeSrt(dirName: string | undefined, fileName: string): string {
    const targetDir = dirName ? path.join(tempDir, dirName) : tempDir;
    fs.mkdirSync(targetDir, { recursive: true });
    const srtPath = path.join(targetDir, fileName);
    fs.writeFileSync(srtPath, "1\n00:00:00,000 --> 00:00:00,500\nHello\n\n", "utf-8");
    return srtPath;
  }

  describe("buildSubtitlesFilter with real ffmpeg", () => {
    const filterCases: Array<{
      dirName?: string;
      fileName: string;
      description: string;
    }> = [
      {
        fileName: "normal.srt",
        description: "standard filename without special characters",
      },
      {
        fileName: "it's.srt",
        description: "filename containing single quote",
      },
      {
        dirName: "Bob's videos",
        fileName: "sub.srt",
        description: "directory name containing single quote",
      },
      {
        dirName: "dir, [x]; y",
        fileName: "a b,c;[1]=50%.srt",
        description: "directory and filename with special characters",
      },
      {
        dirName: "日本語",
        fileName: "字幕.srt",
        description: "directory and filename with non-ASCII unicode characters",
      },
      ...(process.platform !== "win32"
        ? [
            {
              fileName: "back\\slash.srt",
              description: "filename containing backslash on non-Windows",
            },
            {
              fileName: "co:lon.srt",
              description: "filename containing colon on non-Windows",
            },
          ]
        : []),
    ];

    it.each(filterCases)(
      "should succeed with ffmpeg for $description ($fileName)",
      async ({ dirName, fileName }) => {
        const srtPath = writeSrt(dirName, fileName);
        const filter = buildSubtitlesFilter(srtPath, {
          position: "top",
          fontSize: 20,
        });
        const result = await execa(
          "ffmpeg",
          [
            "-hide_banner",
            "-f",
            "lavfi",
            "-i",
            "color=c=black:s=64x64:d=1",
            "-vf",
            filter,
            "-frames:v",
            "1",
            "-f",
            "null",
            "-",
          ],
          { reject: false },
        );
        expect(result.exitCode).toBe(0);
      },
      30000,
    );
  });

  describe("burnSubtitlesToVideo with real ffmpeg", () => {
    it("should burn subtitles into video with single quotes in folder and file name", async () => {
      const srtPath = writeSrt("Bob's videos", "Let's Talk.ja.srt");
      const dir = path.dirname(srtPath);
      const videoPath = path.join(dir, "Let's Talk.mp4");
      const outPath = path.join(dir, "output.mp4");

      const createVideoResult = await execa(
        "ffmpeg",
        [
          "-y",
          "-hide_banner",
          "-f",
          "lavfi",
          "-i",
          "color=c=black:s=64x64:d=1",
          "-c:v",
          "libx264",
          "-pix_fmt",
          "yuv420p",
          videoPath,
        ],
        { reject: false },
      );
      expect(createVideoResult.exitCode).toBe(0);

      const result = await burnSubtitlesToVideo(videoPath, srtPath, outPath);
      expect(result).toBe(outPath);
      expect(fs.existsSync(outPath)).toBe(true);
    }, 60000);
  });

  describe("subtitle position with real ffmpeg", () => {
    const FRAME_WIDTH = 320;
    const FRAME_HEIGHT = 240;

    async function findBrightCentroid(filter: string): Promise<{ xRatio: number; yRatio: number }> {
      const result = await execa(
        "ffmpeg",
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-f",
          "lavfi",
          "-i",
          `color=c=black:s=${FRAME_WIDTH}x${FRAME_HEIGHT}:d=1`,
          "-vf",
          filter,
          "-frames:v",
          "1",
          "-pix_fmt",
          "gray",
          "-f",
          "rawvideo",
          "-",
        ],
        { encoding: "buffer" },
      );

      const buffer = result.stdout;
      let totalX = 0;
      let totalY = 0;
      let count = 0;

      for (let y = 0; y < FRAME_HEIGHT; y++) {
        for (let x = 0; x < FRAME_WIDTH; x++) {
          const pixel = buffer[y * FRAME_WIDTH + x] ?? 0;
          if (pixel > 128) {
            totalX += x;
            totalY += y;
            count++;
          }
        }
      }

      expect(count, "no subtitle pixels were rendered").toBeGreaterThan(0);

      const centroidX = totalX / count;
      const centroidY = totalY / count;

      return {
        xRatio: centroidX / FRAME_WIDTH,
        yRatio: centroidY / FRAME_HEIGHT,
      };
    }

    const positionCases: Array<{
      position: BurnPosition;
      minYRatio: number;
      maxYRatio: number;
    }> = [
      {
        position: "bottom",
        minYRatio: 2 / 3,
        maxYRatio: 1,
      },
      {
        position: "top",
        minYRatio: 0,
        maxYRatio: 1 / 3,
      },
      {
        position: "center",
        minYRatio: 1 / 3,
        maxYRatio: 2 / 3,
      },
    ];

    it.each(positionCases)(
      "should render subtitles in the correct area for position $position",
      async ({ position, minYRatio, maxYRatio }) => {
        const srtPath = writeSrt(undefined, "position.srt");
        const filter = buildSubtitlesFilter(srtPath, { position, fontSize: 30 });
        const { xRatio, yRatio } = await findBrightCentroid(filter);

        expect(xRatio).toBeGreaterThan(1 / 3);
        expect(xRatio).toBeLessThan(2 / 3);

        expect(yRatio).toBeGreaterThan(minYRatio);
        expect(yRatio).toBeLessThan(maxYRatio);
      },
      30000,
    );
  });
});
