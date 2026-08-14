import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execa } from "execa";

export interface ExtractedAudioResult {
  audioPaths: string[];
  cleanup: () => Promise<void>;
}

/**
 * Checks if the ffmpeg binary is available and executable.
 */
export async function checkFfmpeg(ffmpegPath: string): Promise<void> {
  try {
    await execa(ffmpegPath, ["-version"]);
  } catch (_error) {
    throw new Error(
      `ffmpeg executable not found (specified path: "${ffmpegPath}").\nPlease install ffmpeg and add it to your PATH, or set VSUB_FFMPEG_PATH in environment / CLI option --ffmpeg-path.`,
    );
  }
}

/**
 * Extracts optimized 16kHz mono audio from a video file.
 * Handles audio splitting if the file size exceeds 24.5MB.
 */
export async function extractAudio(
  videoPath: string,
  ffmpegPath: string,
  verbose = false,
): Promise<ExtractedAudioResult> {
  if (!fs.existsSync(videoPath)) {
    throw new Error(`Specified video file not found: ${videoPath}`);
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vsub-"));
  const tempAudioFile = path.join(tempDir, "extracted.m4a");

  // Extract lightweight 16kHz mono audio at 48kbps
  const ffmpegArgs = [
    "-i",
    videoPath,
    "-vn",
    "-ar",
    "16000",
    "-ac",
    "1",
    "-b:a",
    "48k",
    "-y",
    tempAudioFile,
  ];

  if (verbose) {
    console.log(`[ffmpeg] Executing command: ${ffmpegPath} ${ffmpegArgs.join(" ")}`);
  }

  await execa(ffmpegPath, ffmpegArgs);

  if (!fs.existsSync(tempAudioFile)) {
    throw new Error("Failed to extract audio. Temporary file was not created.");
  }

  const stats = fs.statSync(tempAudioFile);
  const maxSizeBytes = 24.5 * 1024 * 1024; // 24.5MB threshold for Groq

  const createdTempFiles: string[] = [tempAudioFile];

  let finalAudioPaths: string[] = [];

  if (stats.size <= maxSizeBytes) {
    finalAudioPaths = [tempAudioFile];
  } else {
    if (verbose) {
      console.log(
        `[ffmpeg] Extracted audio exceeds 25MB threshold. Starting audio split process (${(stats.size / 1024 / 1024).toFixed(1)}MB)`,
      );
    }

    // Split audio into 20-minute segments (1200 seconds)
    const segmentPattern = path.join(tempDir, "segment_%03d.m4a");
    const splitArgs = [
      "-i",
      tempAudioFile,
      "-f",
      "segment",
      "-segment_time",
      "1200",
      "-c",
      "copy",
      "-y",
      segmentPattern,
    ];

    await execa(ffmpegPath, splitArgs);

    const segments = fs
      .readdirSync(tempDir)
      .filter((f) => f.startsWith("segment_") && f.endsWith(".m4a"))
      .sort()
      .map((f) => path.join(tempDir, f));

    if (segments.length > 0) {
      finalAudioPaths = segments;
      createdTempFiles.push(...segments);
    } else {
      finalAudioPaths = [tempAudioFile];
    }
  }

  const cleanup = async () => {
    try {
      for (const file of createdTempFiles) {
        if (fs.existsSync(file)) {
          fs.unlinkSync(file);
        }
      }
      if (fs.existsSync(tempDir)) {
        fs.rmdirSync(tempDir);
      }
    } catch (_err) {
      // Ignore cleanup errors
    }
  };

  return {
    audioPaths: finalAudioPaths,
    cleanup,
  };
}
