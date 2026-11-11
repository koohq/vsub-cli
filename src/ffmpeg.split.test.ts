import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execa } from "execa";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { extractAudio } from "./ffmpeg.js";
import { REAL_PROCESS_TEST_TIMEOUT_MS } from "./test-support/real-process-timeout.js";

async function checkFfmpeg(): Promise<boolean> {
  try {
    const result = await execa("ffmpeg", ["-version"], { reject: false });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

const hasFfmpeg = await checkFfmpeg();

describe.skipIf(!hasFfmpeg)("silence splitting with real ffmpeg", () => {
  let tempDir: string;
  let cleanup: (() => Promise<void>) | undefined;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vsub-split-test-"));
    cleanup = undefined;
  });

  afterEach(async () => {
    await cleanup?.();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it(
    "should split a 50 second audio file within its silence at 35 to 36 seconds",
    async () => {
      const inputPath = path.join(tempDir, "input.wav");
      await execa("ffmpeg", [
        "-hide_banner",
        "-y",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:sample_rate=16000:duration=50",
        "-af",
        "volume=0:enable='between(t,35,36)'",
        inputPath,
      ]);
      const result = await extractAudio(inputPath, "ffmpeg", {
        maxFileBytes: 25 * 1024 * 1024,
        segmentSeconds: 40,
        maxChunkSeconds: 40,
      });
      cleanup = result.cleanup;
      expect(result.audioPaths).toHaveLength(2);
      expect(result.durations).toHaveLength(2);
      expect(result.durations?.[0]).toBeGreaterThan(35);
      expect(result.durations?.[0]).toBeLessThan(36);
      expect(result.durations?.reduce((sum, duration) => sum + duration, 0)).toBeCloseTo(50, 0);
    },
    REAL_PROCESS_TEST_TIMEOUT_MS,
  );
});
