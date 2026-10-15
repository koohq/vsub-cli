import fs from "node:fs";
import path from "node:path";
import pc from "picocolors";
import { getGlobalConfigDir } from "./config.js";
import { getI18n, type SupportedLanguage } from "./i18n/index.js";
import { getCurrentVersion } from "./version.js";

export const GITHUB_RELEASES_API = "https://api.github.com/repos/koohq/vsub-cli/releases/latest";
export const GITHUB_RELEASES_PAGE = "https://github.com/koohq/vsub-cli/releases";

// Minimum 24 hours between update checks to protect unauthenticated GitHub API rate limits (60 req/h)
export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface UpdateCacheData {
  lastChecked: number;
  latestVersion: string;
  releaseUrl?: string | undefined;
}

export interface UpdateCheckResult {
  updateAvailable: boolean;
  currentVersion: string;
  latestVersion: string;
  updateCommand: string;
  releaseUrl?: string | undefined;
}

export interface CheckUpdateOptions {
  currentVersion?: string | undefined;
  force?: boolean | undefined;
  disableUpdateCheck?: boolean | undefined;
  cachePath?: string | undefined;
  fetcher?: ((url: string, init?: RequestInit) => Promise<Response>) | undefined;
  now?: number | undefined;
  isBinary?: boolean | undefined;
}

/**
 * Checks whether the current process is running as a compiled standalone SEA binary.
 */
export function isStandaloneBinary(customExecPath?: string): boolean {
  const execPath = customExecPath || process.execPath;
  const basename = path.basename(execPath).toLowerCase();

  // If invoked via node runtime or common dev runners, it's not a standalone binary
  if (
    basename === "node" ||
    basename === "node.exe" ||
    basename.startsWith("node") ||
    basename.startsWith("tsx") ||
    basename.startsWith("vitest")
  ) {
    return false;
  }

  // Standalone binaries are typically named "vsub", "vsub.exe", or target-specific "vsub-windows-x64.exe"
  return basename === "vsub" || basename === "vsub.exe" || basename.startsWith("vsub-");
}

/**
 * Returns the recommended update command depending on execution environment.
 */
export function getUpdateCommand(isBinary = isStandaloneBinary()): string {
  if (isBinary) {
    return "vsub update";
  }
  return "npm i -g vsub-cli";
}

/**
 * Compares two semantic version strings (e.g. "1.3.0" vs "1.4.0", "v1.4.0" vs "1.3.2").
 * Returns:
 *  -1 if a < b (a is older than b)
 *   1 if a > b (a is newer than b)
 *   0 if a === b
 */
export function compareVersions(a: string, b: string): number {
  const cleanA = a.replace(/^[vV]/, "").trim();
  const cleanB = b.replace(/^[vV]/, "").trim();

  const [coreA, preA] = cleanA.split("-");
  const [coreB, preB] = cleanB.split("-");

  const partsA = (coreA ?? "").split(".").map((num) => Number.parseInt(num, 10) || 0);
  const partsB = (coreB ?? "").split(".").map((num) => Number.parseInt(num, 10) || 0);

  const maxLen = Math.max(partsA.length, partsB.length, 3);
  for (let i = 0; i < maxLen; i++) {
    const valA = partsA[i] ?? 0;
    const valB = partsB[i] ?? 0;
    if (valA < valB) return -1;
    if (valA > valB) return 1;
  }

  // Release version takes precedence over prerelease (e.g. 1.4.0 > 1.4.0-rc.1)
  if (!preA && preB) return 1;
  if (preA && !preB) return -1;
  if (preA && preB) {
    if (preA < preB) return -1;
    if (preA > preB) return 1;
  }

  return 0;
}

/**
 * Checks whether latest is strictly newer than current.
 */
export function isNewerVersion(current: string, latest: string): boolean {
  return compareVersions(current, latest) < 0;
}

/**
 * Resolves the cache file path for update checks.
 */
export function getUpdateCachePath(): string {
  return path.join(getGlobalConfigDir(), "update-cache.json");
}

/**
 * Loads cached update check state.
 */
export function loadUpdateCache(customPath?: string): UpdateCacheData | null {
  const filePath = customPath || getUpdateCachePath();
  if (fs.existsSync(filePath)) {
    try {
      const data = fs.readFileSync(filePath, "utf-8");
      return JSON.parse(data) as UpdateCacheData;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Saves update check state to disk.
 */
export function saveUpdateCache(data: UpdateCacheData, customPath?: string): void {
  const filePath = customPath || getUpdateCachePath();
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  } catch {
    // Non-critical: ignore write failures
  }
}

/**
 * Queries GitHub Releases API for the latest release.
 */
export async function fetchLatestRelease(
  fetcher: (url: string, init?: RequestInit) => Promise<Response> = fetch,
  currentVersion = getCurrentVersion(),
): Promise<{ version: string; releaseUrl: string } | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3500);

    const res = await fetcher(GITHUB_RELEASES_API, {
      method: "GET",
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": `vsub-cli/${currentVersion}`,
      },
      signal: controller.signal,
    }).finally(() => clearTimeout(timeoutId));

    if (!res.ok) {
      return null;
    }

    const data = (await res.json()) as { tag_name?: string; html_url?: string };
    if (!data.tag_name) {
      return null;
    }

    const version = data.tag_name.replace(/^[vV]/, "").trim();
    const releaseUrl = data.html_url || GITHUB_RELEASES_PAGE;

    return {
      version,
      releaseUrl,
    };
  } catch {
    // Catch timeout, network failure, or API rate limit silently
    return null;
  }
}

/**
 * Performs update check with 24-hour rate limit caching.
 */
export async function checkUpdate(
  options: CheckUpdateOptions = {},
): Promise<UpdateCheckResult | null> {
  if (options.disableUpdateCheck) {
    return null;
  }

  const currentVersion = options.currentVersion || getCurrentVersion();
  const cachePath = options.cachePath || getUpdateCachePath();
  const now = options.now || Date.now();
  const isBinary = options.isBinary ?? isStandaloneBinary();
  const updateCommand = getUpdateCommand(isBinary);

  const cached = loadUpdateCache(cachePath);

  // If cache exists and is within 24h, use cached result without network request
  if (!options.force && cached && now - cached.lastChecked < UPDATE_CHECK_INTERVAL_MS) {
    if (isNewerVersion(currentVersion, cached.latestVersion)) {
      return {
        updateAvailable: true,
        currentVersion,
        latestVersion: cached.latestVersion,
        updateCommand,
        releaseUrl: cached.releaseUrl,
      };
    }
    return null;
  }

  // Fetch latest release from GitHub
  const latestRelease = await fetchLatestRelease(options.fetcher, currentVersion);

  if (latestRelease) {
    saveUpdateCache(
      {
        lastChecked: now,
        latestVersion: latestRelease.version,
        releaseUrl: latestRelease.releaseUrl,
      },
      cachePath,
    );

    if (isNewerVersion(currentVersion, latestRelease.version)) {
      return {
        updateAvailable: true,
        currentVersion,
        latestVersion: latestRelease.version,
        updateCommand,
        releaseUrl: latestRelease.releaseUrl,
      };
    }
    return null;
  }

  // If fetch failed (rate limit, offline), record check timestamp to avoid hammering on next command
  if (!cached || now - cached.lastChecked >= UPDATE_CHECK_INTERVAL_MS) {
    saveUpdateCache(
      {
        lastChecked: now,
        latestVersion: cached?.latestVersion || currentVersion,
        releaseUrl: cached?.releaseUrl,
      },
      cachePath,
    );
  }

  return null;
}

/**
 * Formats a clean notification box when a new version is available.
 */
export function formatUpdateNotification(
  result: UpdateCheckResult,
  lang?: SupportedLanguage | string,
): string {
  const i18n = getI18n(lang);
  const m = i18n.update;
  const width = 64;
  const hr = "─".repeat(width);
  const lines: string[] = [];

  const titleText = `💡 ${m.available(result.currentVersion, result.latestVersion)}`;
  const cmdText = `   ${m.commandHint(result.updateCommand)}`;
  const url = result.releaseUrl || GITHUB_RELEASES_PAGE;
  const urlText = `   ${m.releaseNotes(url)}`;

  lines.push(pc.yellow(`┌${hr}┐`));
  lines.push(`  ${pc.bold(pc.yellow(titleText))}`);
  lines.push(`  ${pc.cyan(cmdText)}`);
  lines.push(`  ${pc.dim(urlText)}`);
  lines.push(pc.yellow(`└${hr}┘`));

  return lines.join("\n");
}

/**
 * Non-blocking helper to notify user if an update is available.
 * Silently catches all errors so it never affects main program execution.
 */
export async function notifyUpdateIfAvailable(
  options: {
    lang?: SupportedLanguage | string | undefined;
    disableUpdateCheck?: boolean | undefined;
  } = {},
): Promise<void> {
  try {
    if (options.disableUpdateCheck) {
      return;
    }

    const result = await checkUpdate({
      disableUpdateCheck: options.disableUpdateCheck,
    });

    if (result?.updateAvailable) {
      console.log(`\n${formatUpdateNotification(result, options.lang)}\n`);
    }
  } catch {
    // Non-blocking: swallow any unexpected error
  }
}
