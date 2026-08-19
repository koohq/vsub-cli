import ora, { type Ora } from "ora";
import pc from "picocolors";

/**
 * Formats duration in milliseconds into a human-readable string.
 * Examples: "350ms", "4.2s", "1m 15s", "1h 2m 30s"
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${Math.max(0, Math.round(ms))}ms`;
  }
  const totalSeconds = ms / 1000;
  if (totalSeconds < 60) {
    return `${totalSeconds.toFixed(1)}s`;
  }

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  return `${minutes}m ${seconds}s`;
}

/**
 * Formats byte size into human-readable string.
 * Examples: "512 B", "3.4 MB", "12.8 KB"
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ["KB", "MB", "GB", "TB"];
  let unitIndex = -1;
  let val = bytes;
  do {
    val /= 1024;
    unitIndex++;
  } while (val >= 1024 && unitIndex < units.length - 1);

  return `${val.toFixed(1)} ${units[unitIndex]}`;
}

export interface SummaryData {
  mediaFile?: string | undefined;
  videoFile?: string | undefined;
  mediaType?: "video" | "audio" | "subtitle" | undefined;
  durationMs: number;
  audioSegmentsCount?: number | undefined;
  audioTotalBytes?: number | undefined;
  detectedLanguage?: string | undefined;
  targetLanguage?: string | undefined;
  targetLanguages?: string[] | undefined;
  entriesCount: number;
  outputFiles: string[];
  skippedTranslation?: boolean | undefined;
  skippedLanguages?: string[] | undefined;
}

/**
 * Formats a clean summary box with processing results.
 */
export function formatSummaryBox(data: SummaryData): string {
  const lines: string[] = [];
  const width = 56;
  const hr = "─".repeat(width);

  lines.push(pc.cyan(`┌${hr}┐`));
  const title = "  vsub-cli 処理サマリー  ";
  const titlePadding = Math.max(0, Math.floor((width - title.length) / 2));
  const titleRightPadding = Math.max(0, width - title.length - titlePadding);
  lines.push(
    pc.cyan("│") +
      " ".repeat(titlePadding) +
      pc.bold(pc.white(title)) +
      " ".repeat(titleRightPadding) +
      pc.cyan("│"),
  );
  lines.push(pc.cyan(`├${hr}┤`));

  const addRow = (label: string, value: string) => {
    const paddedLabel = label.padEnd(12, " ");
    lines.push(`  ${pc.gray(paddedLabel)}: ${value}`);
  };

  const fileName = data.mediaFile ?? data.videoFile ?? "";
  const isAudio = data.mediaType === "audio";
  const isSubtitle = data.mediaType === "subtitle";
  const mediaLabel = isAudio
    ? "対象音声"
    : isSubtitle
      ? "対象字幕"
      : data.mediaType === "video"
        ? "対象動画"
        : "対象ファイル";
  const audioActionLabel = isAudio ? "音声最適化" : "音声抽出";

  addRow(mediaLabel, pc.bold(fileName));
  addRow("所要時間", pc.green(formatDuration(data.durationMs)));

  if (data.audioSegmentsCount !== undefined && data.audioSegmentsCount > 0) {
    const sizeStr = data.audioTotalBytes ? ` (${formatFileSize(data.audioTotalBytes)})` : "";
    addRow(audioActionLabel, `${data.audioSegmentsCount} セグメント${sizeStr}`);
  }

  if (data.detectedLanguage) {
    addRow("検出言語", pc.yellow(data.detectedLanguage.toUpperCase()));
  }

  const rawLangs =
    data.targetLanguages && data.targetLanguages.length > 0
      ? data.targetLanguages
      : data.targetLanguage
        ? [data.targetLanguage]
        : [];

  if (rawLangs.length > 0) {
    const langDisplays = rawLangs.map((lang) => {
      const isSkipped =
        data.skippedTranslation ||
        Boolean(data.skippedLanguages?.some((s) => s.toLowerCase() === lang.toLowerCase()));
      const transStatus = isSkipped ? " (スキップ)" : "";
      return `${pc.cyan(lang.toUpperCase())}${pc.dim(transStatus)}`;
    });
    addRow("出力言語", langDisplays.join(", "));
  }

  addRow("字幕行数", pc.magenta(`${data.entriesCount} 行`));

  if (data.outputFiles.length > 0) {
    lines.push("");
    lines.push(`  ${pc.bold("出力ファイル:")}`);
    for (const file of data.outputFiles) {
      lines.push(`    ${pc.green("✔")} ${pc.white(file)}`);
    }
  }

  lines.push(pc.cyan(`└${hr}┘`));
  return lines.join("\n");
}

export interface ProgressSpinner {
  start(text?: string): ProgressSpinner;
  succeed(text?: string): ProgressSpinner;
  fail(text?: string): ProgressSpinner;
  warn(text?: string): ProgressSpinner;
  info(text?: string): ProgressSpinner;
  updateText(text: string): ProgressSpinner;
  stop(): ProgressSpinner;
}

/**
 * Creates a configured spinner instance.
 * Automatically handles silent / non-TTY modes.
 */
export function createSpinner(
  initialText: string,
  options?: { isSilent?: boolean },
): ProgressSpinner {
  if (options?.isSilent) {
    const silentSpinner: ProgressSpinner = {
      start: () => silentSpinner,
      succeed: () => silentSpinner,
      fail: () => silentSpinner,
      warn: () => silentSpinner,
      info: () => silentSpinner,
      updateText: () => silentSpinner,
      stop: () => silentSpinner,
    };
    return silentSpinner;
  }

  const spinner: Ora = ora({
    text: initialText,
    color: "cyan",
  });

  const wrapper: ProgressSpinner = {
    start(text?: string) {
      if (text) spinner.text = text;
      spinner.start();
      return wrapper;
    },
    succeed(text?: string) {
      spinner.succeed(text);
      return wrapper;
    },
    fail(text?: string) {
      spinner.fail(text);
      return wrapper;
    },
    warn(text?: string) {
      spinner.warn(text);
      return wrapper;
    },
    info(text?: string) {
      spinner.info(text);
      return wrapper;
    },
    updateText(text: string) {
      spinner.text = text;
      return wrapper;
    },
    stop() {
      spinner.stop();
      return wrapper;
    },
  };

  return wrapper;
}
