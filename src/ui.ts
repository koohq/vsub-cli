import ora, { type Ora } from "ora";
import pc from "picocolors";
import { getI18n, type SupportedLanguage } from "./i18n/index.js";
import { LLM_PROVIDER_LABELS, type LlmProvider } from "./text/providers.js";
import { STT_PROVIDER_LABELS, type SttProvider } from "./transcribe/providers.js";

const WIDE_RANGES = [
  [0x1100, 0x115f],
  [0x2e80, 0x303e],
  [0x3041, 0x33ff],
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xa000, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe30, 0xfe4f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x1f300, 0x1f64f],
  [0x1f680, 0x1f6ff],
  [0x1f900, 0x1f9ff],
  [0x20000, 0x3fffd],
] as const;
const ZERO_WIDTH_RANGES = [
  [0x200b, 0x200d],
  [0xfe00, 0xfe0f],
  [0x0300, 0x036f],
] as const;

/** Approximates terminal display width by Unicode code point. */
export function displayWidth(text: string): number {
  let width = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (ZERO_WIDTH_RANGES.some(([start, end]) => code >= start && code <= end)) continue;
    width += WIDE_RANGES.some(([start, end]) => code >= start && code <= end) ? 2 : 1;
  }
  return width;
}

/** Pads text to an approximate terminal display width. */
export function padEndToWidth(text: string, width: number): string {
  return text + " ".repeat(Math.max(0, width - displayWidth(text)));
}

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
  whisperPrompt?: string | undefined;
  prompt?: string | undefined;
  glossaryTermsCount?: number | undefined;
  bilingual?: boolean | { order?: string | undefined } | undefined;
  backedUpFiles?: string[] | undefined;
  sttProvider?: SttProvider | undefined;
  sttModel?: string | undefined;
  llmProvider?: LlmProvider | undefined;
  llmModel?: string | undefined;
  cacheStatus?:
    | {
        transcriptionHit?: boolean | undefined;
        cachedLanguages?: string[] | undefined;
      }
    | undefined;
  lang?: SupportedLanguage | undefined;
}

/**
 * Formats a clean summary box with processing results.
 */
export function formatSummaryBox(data: SummaryData, lang?: SupportedLanguage | string): string {
  const i18n = getI18n(lang ?? data.lang);
  const m = i18n.summary;
  const lines: string[] = [];
  const width = 58;
  const hr = "─".repeat(width);

  lines.push(pc.cyan(`┌${hr}┐`));
  const title = m.title;
  const titlePadding = Math.max(0, Math.floor((width - displayWidth(title)) / 2));
  const titleRightPadding = Math.max(0, width - displayWidth(title) - titlePadding);
  lines.push(
    pc.cyan("│") +
      " ".repeat(titlePadding) +
      pc.bold(pc.white(title)) +
      " ".repeat(titleRightPadding) +
      pc.cyan("│"),
  );
  lines.push(pc.cyan(`├${hr}┤`));

  const addRow = (label: string, value: string) => {
    const paddedLabel = padEndToWidth(label, 15);
    lines.push(`  ${pc.gray(paddedLabel)}: ${value}`);
  };

  const fileName = data.mediaFile ?? data.videoFile ?? "";
  const isAudio = data.mediaType === "audio";
  const isSubtitle = data.mediaType === "subtitle";
  const mediaLabel = isAudio
    ? m.targetAudio
    : isSubtitle
      ? m.targetSubtitle
      : data.mediaType === "video"
        ? m.targetVideo
        : m.targetFile;
  const audioActionLabel = isAudio ? m.audioActionOptimize : m.audioActionExtract;

  addRow(mediaLabel, pc.bold(fileName));
  addRow(m.duration, pc.green(formatDuration(data.durationMs)));

  if (data.sttModel && !isSubtitle) {
    const providerLabel = STT_PROVIDER_LABELS[data.sttProvider ?? "groq"];
    const cacheNote = data.cacheStatus?.transcriptionHit ? pc.green(m.cacheHitBadge) : "";
    addRow(m.transcription, `${providerLabel} (${pc.cyan(data.sttModel)})${cacheNote}`);
  } else if (data.cacheStatus?.transcriptionHit) {
    addRow(m.transcription, `${pc.green(m.cachedBadge)}`);
  }

  if (data.audioSegmentsCount !== undefined && data.audioSegmentsCount > 0) {
    const sizeStr = data.audioTotalBytes ? ` (${formatFileSize(data.audioTotalBytes)})` : "";
    addRow(audioActionLabel, m.segmentsValue(data.audioSegmentsCount, sizeStr));
  }

  if (data.whisperPrompt) {
    const truncatedPrompt =
      data.whisperPrompt.length > 25 ? `${data.whisperPrompt.slice(0, 25)}...` : data.whisperPrompt;
    addRow(m.whisperPrompt, pc.dim(`"${truncatedPrompt}"`));
  }

  if (data.detectedLanguage) {
    addRow(m.detectedLanguage, pc.yellow(data.detectedLanguage.toUpperCase()));
  }

  const rawLangs =
    data.targetLanguages && data.targetLanguages.length > 0
      ? data.targetLanguages
      : data.targetLanguage
        ? [data.targetLanguage]
        : [];

  if (rawLangs.length > 0) {
    const langDisplays = rawLangs.map((l) => {
      const isSkipped =
        data.skippedTranslation ||
        Boolean(data.skippedLanguages?.some((s) => s.toLowerCase() === l.toLowerCase()));
      const isCached = Boolean(
        data.cacheStatus?.cachedLanguages?.some((c) => c.toLowerCase() === l.toLowerCase()),
      );
      const transStatus = isSkipped ? m.skippedBadge : isCached ? m.cachedLangBadge : "";
      return `${pc.cyan(l.toUpperCase())}${pc.dim(transStatus)}`;
    });
    addRow(m.outputLanguages, langDisplays.join(", "));
  }

  if (data.llmModel && data.llmProvider && !data.skippedTranslation) {
    const label = LLM_PROVIDER_LABELS[data.llmProvider];
    addRow(m.translationModel, `${label} (${pc.cyan(data.llmModel)})`);
  }

  if (data.bilingual) {
    const orderStr =
      typeof data.bilingual === "object" && data.bilingual.order === "target-first"
        ? m.bilingualTargetFirst
        : m.bilingualOriginalFirst;
    addRow(m.subtitleMode, `${pc.yellow(m.bilingual)}${pc.dim(orderStr)}`);
  }

  if (data.glossaryTermsCount !== undefined && data.glossaryTermsCount > 0) {
    addRow(m.glossary, pc.cyan(m.glossaryApplied(data.glossaryTermsCount)));
  }

  if (data.prompt) {
    const truncatedPrompt =
      data.prompt.length > 25 ? `${data.prompt.slice(0, 25)}...` : data.prompt;
    addRow(m.prompt, pc.dim(`"${truncatedPrompt}"`));
  }

  addRow(m.subtitleLines, pc.magenta(m.linesValue(data.entriesCount)));

  if (data.backedUpFiles && data.backedUpFiles.length > 0) {
    lines.push("");
    lines.push(`  ${pc.bold(m.backupsHeader)}`);
    for (const file of data.backedUpFiles) {
      lines.push(`    ${pc.yellow("📦")} ${pc.dim(file)}`);
    }
  }

  if (data.outputFiles.length > 0) {
    lines.push("");
    lines.push(`  ${pc.bold(m.outputFilesHeader)}`);
    for (const file of data.outputFiles) {
      lines.push(`    ${pc.green("✔")} ${pc.white(file)}`);
    }
  }

  lines.push(pc.cyan(`└${hr}┘`));
  return lines.join("\n");
}

export interface BatchSummaryItem {
  file: string;
  status: "success" | "failed" | "skipped";
  durationMs?: number | undefined;
  entriesCount?: number | undefined;
  outputFiles?: string[] | undefined;
  error?: string | undefined;
}

export interface BatchSummaryData {
  totalFiles: number;
  succeededCount: number;
  failedCount: number;
  skippedCount?: number | undefined;
  totalDurationMs: number;
  items: BatchSummaryItem[];
  lang?: SupportedLanguage | undefined;
}

/**
 * Formats a clean summary box with batch processing results across multiple files.
 */
export function formatBatchSummaryBox(
  data: BatchSummaryData,
  lang?: SupportedLanguage | string,
): string {
  const i18n = getI18n(lang ?? data.lang);
  const m = i18n.batchSummary;
  const lines: string[] = [];
  const width = 64;
  const hr = "─".repeat(width);

  lines.push(pc.cyan(`┌${hr}┐`));
  const title = m.title;
  const titlePadding = Math.max(0, Math.floor((width - displayWidth(title)) / 2));
  const titleRightPadding = Math.max(0, width - displayWidth(title) - titlePadding);
  lines.push(
    pc.cyan("│") +
      " ".repeat(titlePadding) +
      pc.bold(pc.white(title)) +
      " ".repeat(titleRightPadding) +
      pc.cyan("│"),
  );
  lines.push(pc.cyan(`├${hr}┤`));

  const addRow = (label: string, value: string) => {
    const paddedLabel = padEndToWidth(label, 15);
    lines.push(`  ${pc.gray(paddedLabel)}: ${value}`);
  };

  addRow(m.targetFiles, pc.bold(m.targetFilesValue(data.totalFiles)));
  const successColor = data.succeededCount > 0 ? pc.green : pc.gray;
  const failColor = data.failedCount > 0 ? pc.red : pc.gray;
  addRow(
    m.results,
    `${successColor(m.successCount(data.succeededCount))} / ${failColor(m.failedCount(data.failedCount))}${
      data.skippedCount ? ` / ${pc.yellow(m.skippedCount(data.skippedCount))}` : ""
    }`,
  );
  addRow(m.totalDuration, pc.green(formatDuration(data.totalDurationMs)));

  if (data.items.length > 0) {
    lines.push("");
    lines.push(`  ${pc.bold(m.fileDetailsHeader)}`);
    for (const item of data.items) {
      const fileName = item.file;
      const durationStr =
        item.durationMs !== undefined ? ` (${formatDuration(item.durationMs)})` : "";
      if (item.status === "success") {
        const entriesStr =
          item.entriesCount !== undefined ? m.lineCountBadge(item.entriesCount) : "";
        lines.push(
          `    ${pc.green("✔")} ${pc.white(pc.bold(fileName))}${pc.dim(durationStr)}${pc.magenta(entriesStr)}`,
        );
        if (item.outputFiles && item.outputFiles.length > 0) {
          for (const out of item.outputFiles) {
            lines.push(`       ${pc.gray("└─")} ${pc.dim(out)}`);
          }
        }
      } else if (item.status === "failed") {
        lines.push(`    ${pc.red("✖")} ${pc.red(pc.bold(fileName))}${pc.dim(durationStr)}`);
        if (item.error) {
          lines.push(`       ${pc.red(m.errorPrefix)} ${pc.gray(item.error)}`);
        }
      } else {
        lines.push(`    ${pc.yellow("↷")} ${pc.dim(fileName)} ${m.skippedBadge}`);
      }
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

export interface CreateSpinnerOptions {
  isSilent?: boolean | undefined;
  stream?: NodeJS.WritableStream | undefined;
}

/** Shows a one-off notice that must stay visible when --verbose silences the spinner. */
export function showSpinnerNotice(
  spinner: ProgressSpinner,
  verbose: boolean,
  kind: "info" | "warn",
  text: string,
): void {
  if (verbose) console.error(text);
  else spinner[kind](text);
}

/**
 * Creates a configured spinner instance.
 * Automatically handles silent / non-TTY modes.
 */
export function createSpinner(
  initialText: string,
  options?: CreateSpinnerOptions,
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
    ...(options?.stream ? { stream: options.stream } : {}),
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
