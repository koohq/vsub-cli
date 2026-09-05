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
  whisperPrompt?: string | undefined;
  prompt?: string | undefined;
  glossaryTermsCount?: number | undefined;
  bilingual?: boolean | { order?: string | undefined } | undefined;
  backedUpFiles?: string[] | undefined;
  groqModel?: string | undefined;
  geminiModel?: string | undefined;
  cacheStatus?:
    | {
        transcriptionHit?: boolean | undefined;
        cachedLanguages?: string[] | undefined;
      }
    | undefined;
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

  if (data.groqModel && !isSubtitle) {
    const cacheNote = data.cacheStatus?.transcriptionHit
      ? ` ${pc.green("[キャッシュ利用 ⚡]")}`
      : "";
    addRow("文字起こし", `Groq (${pc.cyan(data.groqModel)})${cacheNote}`);
  } else if (data.cacheStatus?.transcriptionHit) {
    addRow("文字起こし", `${pc.green("キャッシュ利用")} ⚡`);
  }

  if (data.audioSegmentsCount !== undefined && data.audioSegmentsCount > 0) {
    const sizeStr = data.audioTotalBytes ? ` (${formatFileSize(data.audioTotalBytes)})` : "";
    addRow(audioActionLabel, `${data.audioSegmentsCount} セグメント${sizeStr}`);
  }

  if (data.whisperPrompt) {
    const truncatedPrompt =
      data.whisperPrompt.length > 25 ? `${data.whisperPrompt.slice(0, 25)}...` : data.whisperPrompt;
    addRow("認識ヒント", pc.dim(`"${truncatedPrompt}"`));
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
      const isCached = Boolean(
        data.cacheStatus?.cachedLanguages?.some((c) => c.toLowerCase() === lang.toLowerCase()),
      );
      const transStatus = isSkipped ? " (スキップ)" : isCached ? " (キャッシュ)" : "";
      return `${pc.cyan(lang.toUpperCase())}${pc.dim(transStatus)}`;
    });
    addRow("出力言語", langDisplays.join(", "));
  }

  if (data.geminiModel && !data.skippedTranslation) {
    addRow("翻訳モデル", `Gemini (${pc.cyan(data.geminiModel)})`);
  }

  if (data.bilingual) {
    const orderStr =
      typeof data.bilingual === "object" && data.bilingual.order === "target-first"
        ? " (訳語 ➔ 原語)"
        : " (原語 ➔ 訳語)";
    addRow("字幕モード", `${pc.yellow("バイリンガル併記")}${pc.dim(orderStr)}`);
  }

  if (data.glossaryTermsCount !== undefined && data.glossaryTermsCount > 0) {
    addRow("用語集", pc.cyan(`${data.glossaryTermsCount} 語適用`));
  }

  if (data.prompt) {
    const truncatedPrompt =
      data.prompt.length > 25 ? `${data.prompt.slice(0, 25)}...` : data.prompt;
    addRow("翻訳指示", pc.dim(`"${truncatedPrompt}"`));
  }

  addRow("字幕行数", pc.magenta(`${data.entriesCount} 行`));

  if (data.backedUpFiles && data.backedUpFiles.length > 0) {
    lines.push("");
    lines.push(`  ${pc.bold("バックアップ:")}`);
    for (const file of data.backedUpFiles) {
      lines.push(`    ${pc.yellow("📦")} ${pc.dim(file)}`);
    }
  }

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
}

/**
 * Formats a clean summary box with batch processing results across multiple files.
 */
export function formatBatchSummaryBox(data: BatchSummaryData): string {
  const lines: string[] = [];
  const width = 64;
  const hr = "─".repeat(width);

  lines.push(pc.cyan(`┌${hr}┐`));
  const title = "  vsub-cli バッチ処理総合サマリー  ";
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

  addRow("対象ファイル", pc.bold(`${data.totalFiles} ファイル`));
  const successColor = data.succeededCount > 0 ? pc.green : pc.gray;
  const failColor = data.failedCount > 0 ? pc.red : pc.gray;
  addRow(
    "処理結果",
    `${successColor(`成功: ${data.succeededCount}`)} / ${failColor(`失敗: ${data.failedCount}`)}${
      data.skippedCount ? ` / ${pc.yellow(`スキップ: ${data.skippedCount}`)}` : ""
    }`,
  );
  addRow("合計所要時間", pc.green(formatDuration(data.totalDurationMs)));

  if (data.items.length > 0) {
    lines.push("");
    lines.push(`  ${pc.bold("ファイル別詳細:")}`);
    for (const item of data.items) {
      const fileName = item.file;
      const durationStr =
        item.durationMs !== undefined ? ` (${formatDuration(item.durationMs)})` : "";
      if (item.status === "success") {
        const entriesStr = item.entriesCount !== undefined ? ` [${item.entriesCount}行]` : "";
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
          lines.push(`       ${pc.red("└─ エラー:")} ${pc.gray(item.error)}`);
        }
      } else {
        lines.push(`    ${pc.yellow("↷")} ${pc.dim(fileName)} (スキップ)`);
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
