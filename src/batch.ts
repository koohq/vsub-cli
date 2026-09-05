import fs from "node:fs";
import path from "node:path";
import pc from "picocolors";
import { ensureApiKeys, getConfig } from "./config.js";
import { checkFfmpeg, isAudioFile, isVideoFile } from "./ffmpeg.js";
import { getI18n } from "./i18n/index.js";
import { type ProcessMediaOptions, processMediaPipeline } from "./pipeline.js";
import { type BatchSummaryData, type BatchSummaryItem, formatBatchSummaryBox } from "./ui.js";

const IGNORED_DIR_NAMES = new Set([
  "node_modules",
  ".git",
  ".cache",
  ".worktrees",
  ".system_generated",
  "dist",
  "coverage",
]);

/**
 * Recursively scans a directory for supported video and audio files.
 */
function scanDirectory(dirPath: string, recursive = true): string[] {
  const results: string[] = [];
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) {
        continue;
      }
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        if (recursive && !IGNORED_DIR_NAMES.has(entry.name)) {
          results.push(...scanDirectory(fullPath, recursive));
        }
      } else if (entry.isFile()) {
        if (isAudioFile(fullPath) || isVideoFile(fullPath)) {
          results.push(fullPath);
        }
      }
    }
  } catch (_err) {
    // Ignore inaccessible directories
  }
  return results;
}

/**
 * Searches and collects all valid media files matching the given input targets.
 * Supports file paths, directories, and glob patterns.
 */
export function findMediaFiles(
  targets: string[],
  options?: { recursive?: boolean | undefined },
): string[] {
  const recursive = options?.recursive !== false;
  const discoveredPaths = new Set<string>();

  for (const target of targets) {
    const resolved = path.resolve(process.cwd(), target);

    if (fs.existsSync(resolved)) {
      const stat = fs.statSync(resolved);
      if (stat.isDirectory()) {
        const found = scanDirectory(resolved, recursive);
        for (const f of found) {
          discoveredPaths.add(path.resolve(f));
        }
      } else if (stat.isFile()) {
        if (isAudioFile(resolved) || isVideoFile(resolved)) {
          discoveredPaths.add(resolved);
        }
      }
    } else {
      // Check for simple glob pattern in directory (e.g. *.mp4 or ./dir/*.mp3)
      const parsed = path.parse(resolved);
      if (
        parsed.dir &&
        fs.existsSync(parsed.dir) &&
        (parsed.base.includes("*") || parsed.base.includes("?"))
      ) {
        const pattern = new RegExp(
          `^${parsed.base
            .replace(/[.+^${}()|[\]\\]/g, "\\$&")
            .replace(/\*/g, ".*")
            .replace(/\?/g, ".")}$`,
          "i",
        );
        try {
          const files = fs.readdirSync(parsed.dir);
          for (const file of files) {
            if (pattern.test(file)) {
              const fullPath = path.join(parsed.dir, file);
              if (
                (isAudioFile(fullPath) || isVideoFile(fullPath)) &&
                fs.statSync(fullPath).isFile()
              ) {
                discoveredPaths.add(path.resolve(fullPath));
              }
            }
          }
        } catch {
          // ignore
        }
      }
    }
  }

  return Array.from(discoveredPaths).sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true }),
  );
}

export interface BatchPipelineOptions extends Omit<ProcessMediaOptions, "mediaFile"> {
  targets: string[];
  recursive?: boolean | undefined;
  failFast?: boolean | undefined;
}

/**
 * Runs the batch transcription and translation pipeline over multiple media files.
 */
export async function runBatchPipeline(options: BatchPipelineOptions): Promise<BatchSummaryData> {
  const startTime = Date.now();
  const i18n = getI18n(options.lang);
  const mediaFiles = findMediaFiles(options.targets, { recursive: options.recursive });

  if (mediaFiles.length === 0) {
    console.log(i18n.batch.noMediaFiles(options.targets.join(", ")));
    return {
      totalFiles: 0,
      succeededCount: 0,
      failedCount: 0,
      totalDurationMs: 0,
      items: [],
      lang: options.lang,
    };
  }

  // Pre-validate API keys and FFmpeg once before starting batch operations
  const rawConfig = getConfig(options.ffmpegPath, options.lang);
  const requiresGroq = !options.noTranslate;
  const requiresGemini = !options.noTranslate;

  const config = await ensureApiKeys(rawConfig, {
    requireGroq: requiresGroq,
    requireGemini: requiresGemini,
    lang: options.lang,
  });
  await checkFfmpeg(config.ffmpegPath);

  console.log(`\n🎬 ${pc.bold(i18n.batch.started(mediaFiles.length))}\n`);

  const items: BatchSummaryItem[] = [];
  let succeededCount = 0;
  let failedCount = 0;
  let skippedCount = 0;

  for (let i = 0; i < mediaFiles.length; i++) {
    const file = mediaFiles[i];
    if (!file) continue;
    const fileIndexStr = `[${i + 1}/${mediaFiles.length}]`;
    const itemStartTime = Date.now();

    console.log(
      `${pc.cyan(fileIndexStr)} ${i18n.batch.processingItem(
        pc.bold(path.basename(file)),
        pc.dim(`(${path.dirname(file)})`),
      )}`,
    );

    try {
      const result = await processMediaPipeline({
        ...options,
        mediaFile: file,
        silentSummary: true,
        logPrefix: fileIndexStr,
      });

      const itemDuration = Date.now() - itemStartTime;
      succeededCount++;
      items.push({
        file: path.basename(file),
        status: "success",
        durationMs: itemDuration,
        entriesCount: result.entriesCount,
        outputFiles: result.outputFiles.map((p) => path.basename(p)),
      });
      console.log(`${pc.green(fileIndexStr)} ${i18n.batch.completedItem(path.basename(file))}\n`);
    } catch (error) {
      const itemDuration = Date.now() - itemStartTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      failedCount++;
      items.push({
        file: path.basename(file),
        status: "failed",
        durationMs: itemDuration,
        error: errorMessage,
      });
      console.error(`${pc.red(fileIndexStr)} ${i18n.batch.failedItem(errorMessage)}\n`);

      if (options.failFast) {
        console.warn(i18n.batch.failFastAbort);
        const remaining = mediaFiles.slice(i + 1);
        for (const rem of remaining) {
          skippedCount++;
          items.push({
            file: path.basename(rem),
            status: "skipped",
          });
        }
        break;
      }
    }
  }

  const totalDurationMs = Date.now() - startTime;
  const summary: BatchSummaryData = {
    totalFiles: mediaFiles.length,
    succeededCount,
    failedCount,
    skippedCount: skippedCount > 0 ? skippedCount : undefined,
    totalDurationMs,
    items,
    lang: options.lang,
  };

  console.log(`${formatBatchSummaryBox(summary)}\n`);
  return summary;
}
