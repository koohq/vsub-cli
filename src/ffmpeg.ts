import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execa } from "execa";
import { getI18n } from "./i18n/index.js";
import { getLanguageDisplayName, toIso6392 } from "./languages.js";

export interface ExtractedAudioResult {
  audioPaths: string[];
  durations?: number[] | undefined;
  cleanup: () => Promise<void>;
}

/**
 * Resolves the path to the ffprobe executable corresponding to the given ffmpeg path.
 */
export function resolveFfprobePath(ffmpegPath: string): string {
  if (/(^|[/\\])ffmpeg(\.[a-z0-9]+)?$/i.test(ffmpegPath)) {
    return ffmpegPath.replace(
      /(^|[/\\])ffmpeg(\.[a-z0-9]+)?$/i,
      (_match, prefix: string, ext: string | undefined) => `${prefix}ffprobe${ext ?? ""}`,
    );
  }
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

export type BurnPosition = "bottom" | "top" | "center";

export const BURN_POSITIONS: readonly BurnPosition[] = ["bottom", "top", "center"] as const;

export const FONT_SIZE_PRESETS: Record<string, number> = {
  small: 16,
  medium: 22,
  large: 30,
};

export const ALIGNMENT_MAP: Record<BurnPosition, number> = {
  bottom: 2,
  top: 8,
  center: 5,
};

/**
 * Validates and normalizes burn subtitle position ("bottom", "top", "center").
 */
export function parseBurnPosition(
  input?: string | undefined,
  lang?: string | undefined,
): BurnPosition | undefined {
  if (!input) return undefined;
  const normalized = input.trim().toLowerCase();
  if (normalized === "bottom" || normalized === "top" || normalized === "center") {
    return normalized;
  }
  const i18n = getI18n(lang);
  throw new Error(i18n.burn.invalidPosition(input));
}

/**
 * Validates and normalizes burn subtitle font size (small, medium, large, or positive number).
 */
export function parseBurnFontSize(
  input?: string | number | undefined,
  lang?: string | undefined,
): number | undefined {
  if (input === undefined || input === null || input === "") return undefined;
  if (typeof input === "number") {
    if (Number.isFinite(input) && input > 0) {
      return Math.round(input);
    }
    const i18n = getI18n(lang);
    throw new Error(i18n.burn.invalidFontSize(String(input)));
  }

  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return undefined;

  if (trimmed in FONT_SIZE_PRESETS) {
    return FONT_SIZE_PRESETS[trimmed];
  }

  const num = Number(trimmed);
  if (Number.isFinite(num) && num > 0) {
    return Math.round(num);
  }

  const i18n = getI18n(lang);
  throw new Error(i18n.burn.invalidFontSize(input));
}

export interface SubtitleFilterOptions {
  position?: BurnPosition | string | undefined;
  fontSize?: number | string | undefined;
  lang?: string | undefined;
}

/**
 * Builds the FFmpeg subtitles filter string, applying force_style if styling options are specified.
 */
export function buildSubtitlesFilter(
  subtitlePath: string,
  options?: SubtitleFilterOptions,
): string {
  const escapedSubPath = escapeFfmpegFilterPath(subtitlePath);
  const position = parseBurnPosition(options?.position, options?.lang);
  const fontSize = parseBurnFontSize(options?.fontSize, options?.lang);

  const forceStyles: string[] = [];
  if (position) {
    forceStyles.push(`Alignment=${ALIGNMENT_MAP[position]}`);
  }
  if (fontSize !== undefined) {
    forceStyles.push(`FontSize=${fontSize}`);
  }

  if (forceStyles.length > 0) {
    return `subtitles=${escapedSubPath}:force_style='${forceStyles.join(",")}'`;
  }
  return `subtitles=${escapedSubPath}`;
}

export interface BurnSubtitlesOptions {
  ffmpegPath?: string | undefined;
  verbose?: boolean | undefined;
  position?: BurnPosition | string | undefined;
  fontSize?: number | string | undefined;
  lang?: string | undefined;
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

  const filterString = buildSubtitlesFilter(resolvedSubtitle, {
    position: options?.position,
    fontSize: options?.fontSize,
    lang: options?.lang,
  });

  const ffmpegArgs = [
    "-i",
    resolvedVideo,
    "-vf",
    filterString,
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

export interface SubtitleTrackInput {
  path: string;
  language?: string | undefined;
  title?: string | undefined;
}

export interface EmbedSubtitlesOptions {
  ffmpegPath?: string | undefined;
  verbose?: boolean | undefined;
}

/**
 * Supported container extensions and their corresponding subtitle codecs for soft subtitle embedding.
 */
export const CONTAINER_SUBTITLE_CODECS: Record<string, string> = {
  ".mp4": "mov_text",
  ".m4v": "mov_text",
  ".mov": "mov_text",
  ".mkv": "srt",
  ".webm": "webvtt",
};

/**
 * Resolves the appropriate subtitle codec for a given video file extension.
 * Throws an error if the container is not supported for soft subtitle embedding.
 */
export function resolveSubtitleCodec(extOrPath: string): string {
  const ext = (path.extname(extOrPath) || extOrPath).toLowerCase();
  const codec = CONTAINER_SUBTITLE_CODECS[ext];
  if (!codec) {
    const supported = Object.keys(CONTAINER_SUBTITLE_CODECS).join(", ");
    throw new Error(
      `Unsupported video container for soft subtitles: ${ext || "(none)"}. Supported containers: ${supported}`,
    );
  }
  return codec;
}

/**
 * Embeds one or more subtitle tracks into a video container using fast FFmpeg stream copy (-c:v copy -c:a copy).
 * Creates soft subtitles that can be toggled on/off and switched by language in video players.
 */
export async function embedSubtitlesToVideo(
  videoPath: string,
  subtitles: SubtitleTrackInput[],
  outputPath: string,
  options?: EmbedSubtitlesOptions,
): Promise<string> {
  const ffmpegPath = options?.ffmpegPath ?? "ffmpeg";
  const verbose = Boolean(options?.verbose);

  const resolvedVideo = path.resolve(videoPath);
  const resolvedOutput = path.resolve(outputPath);

  if (!fs.existsSync(resolvedVideo)) {
    throw new Error(`Specified video file not found: ${videoPath}`);
  }
  if (!isVideoFile(resolvedVideo)) {
    throw new Error(
      `Cannot embed subtitles into a non-video file: ${path.basename(videoPath)} (supported video formats: ${Array.from(SUPPORTED_VIDEO_EXTENSIONS).join(", ")})`,
    );
  }
  if (!subtitles || subtitles.length === 0) {
    throw new Error("At least one subtitle track is required to embed into video");
  }

  // Validate that all subtitle files exist
  for (const sub of subtitles) {
    const resolvedSub = path.resolve(sub.path);
    if (!fs.existsSync(resolvedSub)) {
      throw new Error(`Specified subtitle file not found: ${sub.path}`);
    }
  }

  const outDir = path.dirname(resolvedOutput);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const outExt = path.extname(resolvedOutput);
  const subtitleCodec = resolveSubtitleCodec(outExt);

  const ffmpegArgs: string[] = ["-i", resolvedVideo];

  // Add each subtitle file as an input
  for (const sub of subtitles) {
    ffmpegArgs.push("-i", path.resolve(sub.path));
  }

  // Map video and optional audio streams from primary input
  ffmpegArgs.push("-map", "0:v", "-map", "0:a?");

  // Map each subtitle stream (input 1, 2, ...)
  for (let i = 0; i < subtitles.length; i++) {
    ffmpegArgs.push("-map", `${i + 1}:s`);
  }

  // Stream copy video and audio without re-encoding, and set subtitle codec
  ffmpegArgs.push("-c:v", "copy", "-c:a", "copy", "-c:s", subtitleCodec);

  // Set language and title metadata for each subtitle stream
  for (let i = 0; i < subtitles.length; i++) {
    const sub = subtitles[i];
    if (!sub) {
      continue;
    }
    if (sub.language) {
      const iso6392 = toIso6392(sub.language);
      ffmpegArgs.push(`-metadata:s:s:${i}`, `language=${iso6392}`);
    }
    const title = sub.title || (sub.language ? getLanguageDisplayName(sub.language) : undefined);
    if (title) {
      ffmpegArgs.push(`-metadata:s:s:${i}`, `title=${title}`);
    }
  }

  ffmpegArgs.push("-y", resolvedOutput);

  if (verbose) {
    console.log(`[ffmpeg] Embedding soft subtitles: ${ffmpegPath} ${ffmpegArgs.join(" ")}`);
  }

  try {
    await execa(ffmpegPath, ffmpegArgs);
  } catch (error) {
    const errMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to embed subtitles into video with FFmpeg: ${errMessage}`);
  }

  if (!fs.existsSync(resolvedOutput)) {
    throw new Error(`Failed to embed subtitles: Output file was not created at ${resolvedOutput}`);
  }

  return resolvedOutput;
}
