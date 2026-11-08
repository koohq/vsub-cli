import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isSea } from "node:sea";
import { execa } from "execa";
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

export interface ReleaseAsset {
  name: string;
  browser_download_url: string;
  size?: number | undefined;
}

export interface FullReleaseInfo {
  version: string;
  releaseUrl: string;
  publishedAt?: string | undefined;
  body?: string | undefined;
  assets: ReleaseAsset[];
}

export interface PerformSelfUpdateOptions {
  force?: boolean | undefined;
  targetBinaryPath?: string | undefined;
  fetcher?: ((url: string, init?: RequestInit) => Promise<Response>) | undefined;
  platform?: string | undefined;
  arch?: string | undefined;
  currentVersion?: string | undefined;
  lang?: SupportedLanguage | string | undefined;
  isBinary?: boolean | undefined;
  cachePath?: string | undefined;
}

export interface SelfUpdateResult {
  success: boolean;
  previousVersion: string;
  newVersion: string;
  binaryPath: string;
  releaseUrl: string;
  alreadyLatest?: boolean | undefined;
}

/**
 * Checks whether the current process is running as a compiled standalone SEA binary.
 */
export function isStandaloneBinary(): boolean {
  return isSea();
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
 * Resolves standard target archive name based on platform and architecture.
 */
export function getTargetArchiveName(
  platform: NodeJS.Platform | string = process.platform,
  arch: string = process.arch,
): string {
  const osName = platform === "win32" ? "windows" : platform === "darwin" ? "macos" : platform;
  const ext = platform === "win32" ? ".zip" : ".tar.gz";
  return `vsub-${osName}-${arch}${ext}`;
}

/**
 * Computes SHA-256 hash of a file.
 */
export function computeSha256(filePath: string): string {
  const buffer = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

/**
 * Parses SHA256SUMS.txt file content into a Map of filename -> lowercase sha256 hash.
 */
export function parseChecksumFile(content: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length >= 2 && parts[0] && parts[1]) {
      map.set(parts[1].trim(), parts[0].trim().toLowerCase());
    }
  }
  return map;
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
 * Queries GitHub Releases API for the latest release summary.
 */
export async function fetchLatestRelease(
  fetcher: (url: string, init?: RequestInit) => Promise<Response> = fetch,
  currentVersion = getCurrentVersion(),
): Promise<{ version: string; releaseUrl: string } | null> {
  const details = await fetchReleaseDetails(fetcher, currentVersion);
  if (!details) return null;
  return {
    version: details.version,
    releaseUrl: details.releaseUrl,
  };
}

/**
 * Queries GitHub Releases API for full release details including assets.
 */
export async function fetchReleaseDetails(
  fetcher: (url: string, init?: RequestInit) => Promise<Response> = fetch,
  currentVersion = getCurrentVersion(),
): Promise<FullReleaseInfo | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

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

    const data = (await res.json()) as {
      tag_name?: string;
      html_url?: string;
      published_at?: string;
      body?: string;
      assets?: Array<{
        name: string;
        browser_download_url: string;
        size?: number;
      }>;
    };

    if (!data.tag_name) {
      return null;
    }

    const version = data.tag_name.replace(/^[vV]/, "").trim();
    const releaseUrl = data.html_url || GITHUB_RELEASES_PAGE;

    return {
      version,
      releaseUrl,
      publishedAt: data.published_at,
      body: data.body,
      assets: (data.assets || []).map((a) => ({
        name: a.name,
        browser_download_url: a.browser_download_url,
        size: a.size,
      })),
    };
  } catch {
    // Catch timeout, network failure, or API rate limit silently
    return null;
  }
}

/**
 * Downloads a file from URL to destPath.
 */
export async function downloadFile(
  url: string,
  destPath: string,
  fetcher: (url: string, init?: RequestInit) => Promise<Response> = fetch,
): Promise<void> {
  const res = await fetcher(url);
  if (!res.ok) {
    throw new Error(`Failed to download ${url}: HTTP ${res.status} ${res.statusText}`);
  }
  const arrayBuffer = await res.arrayBuffer();
  fs.writeFileSync(destPath, Buffer.from(arrayBuffer));
}

/**
 * Quotes a string for safe usage in PowerShell single-quoted string literals.
 * Replaces single quotes with pairs of single quotes (PowerShell escape mechanism) and wraps in single quotes.
 */
export function quotePowerShellLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Extracts archive (.zip or .tar.gz) into destDir and returns path to extracted vsub executable.
 * Note: destDir must be a dedicated folder for this extraction (it will be removed recursively if tar fails before fallback).
 */
export async function extractArchive(
  archivePath: string,
  destDir: string,
  platform: NodeJS.Platform | string = process.platform,
): Promise<string> {
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  try {
    await execa("tar", ["-xf", archivePath, "-C", destDir]);
  } catch (err) {
    if (platform === "win32" && archivePath.endsWith(".zip")) {
      // Remove destDir and any partial files written by tar so PowerShell's
      // Expand-Archive doesn't fail with DirectoryExist when path contains brackets [ ]
      try {
        fs.rmSync(destDir, { recursive: true, force: true });
      } catch {
        // Ignore
      }

      // Suppress progress bar: Windows PowerShell 5.1's Expand-Archive is several times
      // slower while rendering its progress bar, even when output is piped.
      await execa("powershell", [
        "-NoProfile",
        "-Command",
        `$ProgressPreference = 'SilentlyContinue'; $ErrorActionPreference = 'Stop'; Expand-Archive -LiteralPath ${quotePowerShellLiteral(archivePath)} -DestinationPath ${quotePowerShellLiteral(destDir)} -Force`,
      ]);
    } else {
      throw new Error(
        `Failed to extract archive ${archivePath}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  const binaryName = platform === "win32" ? "vsub.exe" : "vsub";
  const binaryPath = path.join(destDir, binaryName);

  if (!fs.existsSync(binaryPath)) {
    throw new Error(`Extracted archive did not contain expected binary: ${binaryName}`);
  }

  return binaryPath;
}

/**
 * Cleans up leftover .old binaries matching the binary name from prior updates.
 */
export function cleanOldBinaries(
  binaryPath: string,
  platform: NodeJS.Platform | string = process.platform,
): void {
  try {
    const binaryDir = path.dirname(binaryPath);
    if (!fs.existsSync(binaryDir)) return;

    const baseName = path.basename(binaryPath);
    const isWin32 = platform === "win32";
    const targetBase = isWin32 ? baseName.toLowerCase() : baseName;
    const targetPrefix = `${targetBase}.old`;

    const files = fs.readdirSync(binaryDir);
    for (const file of files) {
      const currentName = isWin32 ? file.toLowerCase() : file;
      let matches = false;

      if (currentName === targetPrefix) {
        matches = true;
      } else if (currentName.startsWith(`${targetPrefix}.`)) {
        const suffix = currentName.slice(targetPrefix.length + 1);
        if (/^\d+$/.test(suffix)) {
          matches = true;
        }
      }

      if (matches) {
        try {
          fs.unlinkSync(path.join(binaryDir, file));
        } catch {
          // File may still be locked, ignore
        }
      }
    }
  } catch {
    // Non-critical cleanup
  }
}

/**
 * Cleans up leftover .old binaries on startup if running as a standalone SEA binary.
 */
export function cleanOldBinariesOnStartup(): void {
  if (!isStandaloneBinary()) return;
  cleanOldBinaries(process.execPath);
}

/**
 * Safely replaces target binary with new binary, implementing Windows renaming safety and rollback.
 */
export function replaceBinarySafely(options: {
  newBinaryPath: string;
  targetBinaryPath: string;
  platform?: string | undefined;
}): void {
  const platform = options.platform || process.platform;

  // Clean any old leftover backup files
  cleanOldBinaries(options.targetBinaryPath, platform);

  if (platform === "win32") {
    const backupPath = `${options.targetBinaryPath}.old`;

    // 1. Rename existing binary to .old (Windows allows renaming open files)
    if (fs.existsSync(options.targetBinaryPath)) {
      try {
        if (fs.existsSync(backupPath)) {
          try {
            fs.unlinkSync(backupPath);
          } catch {
            const altBackup = `${options.targetBinaryPath}.old.${Date.now()}`;
            fs.renameSync(options.targetBinaryPath, altBackup);
          }
        }
        if (fs.existsSync(options.targetBinaryPath)) {
          fs.renameSync(options.targetBinaryPath, backupPath);
        }
      } catch (err: unknown) {
        const error = err as { code?: string };
        if (error.code === "EACCES" || error.code === "EPERM") {
          throw new Error(
            `Permission denied renaming ${options.targetBinaryPath}. Please re-run with Administrator privileges.`,
          );
        }
        throw err;
      }
    }

    // 2. Copy new binary to target path
    try {
      fs.copyFileSync(options.newBinaryPath, options.targetBinaryPath);
    } catch (copyErr: unknown) {
      // Rollback: restore previous binary from .old
      try {
        if (fs.existsSync(backupPath) && !fs.existsSync(options.targetBinaryPath)) {
          fs.renameSync(backupPath, options.targetBinaryPath);
        }
      } catch {
        // Rollback attempt failed
      }
      const error = copyErr as { code?: string };
      if (error.code === "EACCES" || error.code === "EPERM") {
        throw new Error(
          `Permission denied placing new binary at ${options.targetBinaryPath}. Please re-run with Administrator privileges.`,
        );
      }
      throw copyErr;
    }

    // 3. Attempt immediate deletion of .old (cleanOldBinaries will clean it on next run if still locked)
    try {
      if (fs.existsSync(backupPath)) {
        fs.unlinkSync(backupPath);
      }
    } catch {
      // Ignored: locked until process exits
    }
  } else {
    // Unix (Linux / macOS)
    const stagedBinaryPath = `${options.targetBinaryPath}.new`;
    try {
      // 1. Copy to a staged temporary file in the same directory (same filesystem)
      fs.copyFileSync(options.newBinaryPath, stagedBinaryPath);

      // 2. Ensure executable permissions before atomic replacement
      fs.chmodSync(stagedBinaryPath, 0o755);

      // 3. Atomically replace target binary
      fs.renameSync(stagedBinaryPath, options.targetBinaryPath);
    } catch (err: unknown) {
      // Clean up staged temporary binary if left behind
      try {
        if (fs.existsSync(stagedBinaryPath)) {
          fs.unlinkSync(stagedBinaryPath);
        }
      } catch {
        // Ignore cleanup failure
      }

      const error = err as { code?: string };
      if (error.code === "EACCES" || error.code === "EPERM") {
        throw new Error(
          `Permission denied writing to ${options.targetBinaryPath}. Please re-run with sudo.`,
        );
      }
      throw err;
    }
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
 * Formats a clean completion summary box after self-update.
 */
export function formatSelfUpdateSummary(
  result: SelfUpdateResult,
  lang?: SupportedLanguage | string,
): string {
  const i18n = getI18n(lang);
  const m = i18n.update;
  const width = 64;
  const hr = "─".repeat(width);
  const lines: string[] = [];

  lines.push(pc.green(`┌${hr}┐`));
  const title = `🎉 ${m.successTitle}`;
  const titlePadding = Math.max(0, Math.floor((width - title.length) / 2));
  const titleRightPadding = Math.max(0, width - title.length - titlePadding);
  lines.push(
    pc.green("│") +
      " ".repeat(titlePadding) +
      pc.bold(pc.white(title)) +
      " ".repeat(titleRightPadding) +
      pc.green("│"),
  );
  lines.push(pc.green(`├${hr}┤`));

  const addRow = (label: string, value: string) => {
    const paddedLabel = label.padEnd(16, " ");
    lines.push(`  ${pc.gray(paddedLabel)}: ${value}`);
  };

  addRow(
    m.updatedVersion,
    `${pc.dim(`v${result.previousVersion}`)} ➔ ${pc.bold(pc.green(`v${result.newVersion}`))}`,
  );
  addRow(m.binaryLocation, pc.cyan(result.binaryPath));
  addRow(m.releaseNotes("").replace(/:\s*$/, ""), pc.dim(result.releaseUrl));

  lines.push(pc.green(`└${hr}┘`));
  return lines.join("\n");
}

/**
 * Orchestrates standalone binary self-update:
 * Checks release, downloads OS/Arch asset, verifies checksum, extracts, and safely replaces binary.
 */
export async function performSelfUpdate(
  options: PerformSelfUpdateOptions = {},
): Promise<SelfUpdateResult> {
  const currentVersion = options.currentVersion || getCurrentVersion();
  const targetBinary = options.targetBinaryPath || process.execPath;
  const isBinary = options.isBinary ?? isStandaloneBinary();
  const lang = options.lang;
  const i18n = getI18n(lang);
  const m = i18n.update;

  if (!isBinary) {
    const updateCmd = getUpdateCommand(false);
    throw new Error(`${m.npmEnvNotice}\n${m.npmEnvUpdateHint(updateCmd)}`);
  }

  const release = await fetchReleaseDetails(options.fetcher, currentVersion);
  if (!release) {
    throw new Error("Failed to retrieve latest release information from GitHub.");
  }

  if (!options.force && !isNewerVersion(currentVersion, release.version)) {
    return {
      success: true,
      alreadyLatest: true,
      previousVersion: currentVersion,
      newVersion: currentVersion,
      binaryPath: targetBinary,
      releaseUrl: release.releaseUrl,
    };
  }

  const platform = options.platform || process.platform;
  const arch = options.arch || process.arch;
  const targetArchiveName = getTargetArchiveName(platform, arch);

  const archiveAsset = release.assets.find((a) => a.name === targetArchiveName);
  if (!archiveAsset) {
    throw new Error(
      `No standalone binary release asset found for platform '${platform}' and architecture '${arch}' (${targetArchiveName}).\nPlease visit: ${release.releaseUrl}`,
    );
  }

  const checksumAsset = release.assets.find((a) => a.name === "SHA256SUMS.txt");
  if (!checksumAsset) {
    throw new Error(m.checksumMissing(release.releaseUrl));
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vsub-update-"));

  try {
    const archiveDest = path.join(tempDir, targetArchiveName);
    await downloadFile(archiveAsset.browser_download_url, archiveDest, options.fetcher);

    // Verify SHA-256 Checksum
    const checksumDest = path.join(tempDir, "SHA256SUMS.txt");
    await downloadFile(checksumAsset.browser_download_url, checksumDest, options.fetcher);
    const checksumContent = fs.readFileSync(checksumDest, "utf-8");
    const checksumMap = parseChecksumFile(checksumContent);
    const expectedHash = checksumMap.get(targetArchiveName);

    if (!expectedHash) {
      throw new Error(m.checksumEntryMissing(targetArchiveName, release.releaseUrl));
    }

    const computedHash = computeSha256(archiveDest);
    if (computedHash !== expectedHash) {
      throw new Error(m.checksumMismatch(expectedHash, computedHash));
    }

    // Extract archive
    const extractDir = path.join(tempDir, "extracted");
    const extractedBinary = await extractArchive(archiveDest, extractDir, platform);

    // Replace binary safely
    replaceBinarySafely({
      newBinaryPath: extractedBinary,
      targetBinaryPath: targetBinary,
      platform,
    });

    // Update update-cache.json with the new version so checkUpdate knows we are up to date
    saveUpdateCache(
      {
        lastChecked: Date.now(),
        latestVersion: release.version,
        releaseUrl: release.releaseUrl,
      },
      options.cachePath,
    );

    return {
      success: true,
      previousVersion: currentVersion,
      newVersion: release.version,
      binaryPath: targetBinary,
      releaseUrl: release.releaseUrl,
    };
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore temp dir cleanup failure
    }
  }
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
