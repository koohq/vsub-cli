import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execa } from "execa";

export interface ExtractedAudioResult {
  audioPaths: string[];
  durations?: number[] | undefined;
  cleanup: () => Promise<void>;
}

/**
 * Resolves the path to the ffprobe executable corresponding to the given ffmpeg path.
 */
export function resolveFfprobePath(ffmpegPath: string): string {
  const parsed = path.parse(ffmpegPath);
  const ext = parsed.ext;
  const probeName = ext ? `ffprobe${ext}` : "ffprobe";
  if (!parsed.dir) {
    return probeName;
  }
  return ffmpegPath.slice(0, ffmpegPath.length - parsed.base.length) + probeName;
}

/**
 * Accurately measures the duration of a media file in seconds (with millisecond precision).
 * Uses ffprobe if available, falling back to parsing ffmpeg stderr.
 */
export async function getMediaDurationInSeconds(
  filePath: string,
  ffmpegPath = "ffmpeg",
): Promise<number> {
  // 1. Try ffprobe first for high-precision float duration
  const ffprobePath = resolveFfprobePath(ffmpegPath);
  try {
    const { stdout } = await execa(ffprobePath, [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      filePath,
    ]);
    const duration = parseFloat(stdout.trim());
    if (!Number.isNaN(duration) && Number.isFinite(duration) && duration > 0) {
      return duration;
    }
  } catch (_ffprobeErr) {
    // Fallback to ffmpeg if ffprobe is unavailable or failed
  }

  // 2. Fallback: Parse "Duration: HH:MM:SS.xx" from ffmpeg stderr
  try {
    const result = await execa(ffmpegPath, ["-i", filePath, "-f", "null", "-"]).catch(
      (err: { stdout?: string; stderr?: string }) => err,
    );
    const output = `${result.stdout || ""} ${result.stderr || ""}`;
    const match = output.match(/Duration:\s*(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/);
    if (match?.[1] && match[2] && match[3]) {
      const hours = parseInt(match[1], 10);
      const minutes = parseInt(match[2], 10);
      const seconds = parseFloat(match[3]);
      const totalSeconds = hours * 3600 + minutes * 60 + seconds;
      if (!Number.isNaN(totalSeconds) && Number.isFinite(totalSeconds) && totalSeconds > 0) {
        return totalSeconds;
      }
    }
  } catch (_ffmpegErr) {
    // Ignore error
  }

  return 0;
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

export const SUPPORTED_AUDIO_EXTENSIONS = new Set([
  ".mp3",
  ".wav",
  ".m4a",
  ".aac",
  ".flac",
  ".ogg",
  ".opus",
  ".wma",
  ".aiff",
  ".aif",
  ".alac",
  ".m4b",
  ".oga",
]);

export const SUPPORTED_VIDEO_EXTENSIONS = new Set([
  ".mp4",
  ".mkv",
  ".mov",
  ".avi",
  ".webm",
  ".flv",
  ".wmv",
  ".m4v",
  ".ts",
  ".mts",
  ".3gp",
  ".ogv",
]);

/**
 * Checks if the file extension corresponds to a supported audio format.
 */
export function isAudioFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return SUPPORTED_AUDIO_EXTENSIONS.has(ext);
}

/**
 * Checks if the file extension corresponds to a supported video format.
 */
export function isVideoFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return SUPPORTED_VIDEO_EXTENSIONS.has(ext);
}

/**
 * Checks if the file extension corresponds to a supported video or audio format.
 */
export function isSupportedMediaFile(filePath: string): boolean {
  return isAudioFile(filePath) || isVideoFile(filePath);
}

/**
 * Extracts and optimizes lightweight 16kHz mono audio from a video or audio file.
 * Handles audio splitting if the file size exceeds 24.5MB.
 */
export async function extractAudio(
  mediaPath: string,
  ffmpegPath: string,
  verbose = false,
): Promise<ExtractedAudioResult> {
  if (!fs.existsSync(mediaPath)) {
    throw new Error(`Specified media file not found: ${mediaPath}`);
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vsub-"));
  const tempAudioFile = path.join(tempDir, "extracted.m4a");

  // Extract lightweight 16kHz mono audio at 48kbps
  const ffmpegArgs = [
    "-i",
    mediaPath,
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
  let finalDurations: number[] | undefined;

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

      // Accurately measure each segment's playback duration
      const segmentDurations: number[] = [];
      for (const segmentPath of segments) {
        try {
          const dur = await getMediaDurationInSeconds(segmentPath, ffmpegPath);
          segmentDurations.push(dur > 0 ? dur : 1200);
        } catch {
          segmentDurations.push(1200);
        }
      }
      finalDurations = segmentDurations;
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
    durations: finalDurations,
    cleanup,
  };
}

export const prepareAudio = extractAudio;

/**
 * Escapes a file path for safe usage inside FFmpeg filtergraph expressions (e.g. subtitles='...').
 */
export function escapeFfmpegFilterPath(filePath: string): string {
  // Normalize backslashes to forward slashes
  const normalized = filePath.replace(/\\/g, "/");
  // Escape single quotes and colons
  const escaped = normalized.replace(/'/g, "\\'").replace(/:/g, "\\:");
  return `'${escaped}'`;
}

export interface BurnSubtitlesOptions {
  ffmpegPath?: string;
  verbose?: boolean;
}

/**
 * Burns subtitles directly into a video file using FFmpeg's subtitles filter.
 */
export async function burnSubtitlesToVideo(
  videoPath: string,
  subtitlePath: string,
  outputPath: string,
  options?: BurnSubtitlesOptions,
): Promise<string> {
  const ffmpegPath = options?.ffmpegPath ?? "ffmpeg";
  const verbose = Boolean(options?.verbose);

  const resolvedVideo = path.resolve(videoPath);
  const resolvedSubtitle = path.resolve(subtitlePath);
  const resolvedOutput = path.resolve(outputPath);

  if (!fs.existsSync(resolvedVideo)) {
    throw new Error(`Specified video file not found: ${videoPath}`);
  }
  if (!isVideoFile(resolvedVideo)) {
    throw new Error(
      `Cannot burn subtitles into a non-video file: ${path.basename(videoPath)} (supported video formats: ${Array.from(SUPPORTED_VIDEO_EXTENSIONS).join(", ")})`,
    );
  }
  if (!fs.existsSync(resolvedSubtitle)) {
    throw new Error(`Specified subtitle file not found: ${subtitlePath}`);
  }

  const outDir = path.dirname(resolvedOutput);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const escapedSubPath = escapeFfmpegFilterPath(resolvedSubtitle);
  const ffmpegArgs = [
    "-i",
    resolvedVideo,
    "-vf",
    `subtitles=${escapedSubPath}`,
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-crf",
    "23",
    "-preset",
    "medium",
    "-c:a",
    "copy",
    "-y",
    resolvedOutput,
  ];

  if (verbose) {
    console.log(`[ffmpeg] Burning subtitles: ${ffmpegPath} ${ffmpegArgs.join(" ")}`);
  }

  try {
    await execa(ffmpegPath, ffmpegArgs);
  } catch (error) {
    const errMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to burn subtitles into video with FFmpeg: ${errMessage}`);
  }

  if (!fs.existsSync(resolvedOutput)) {
    throw new Error(`Failed to burn subtitles: Output file was not created at ${resolvedOutput}`);
  }

  return resolvedOutput;
}
