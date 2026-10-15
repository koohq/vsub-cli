import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockExeca = vi.fn();
vi.mock("execa", () => ({
  execa: (...args: unknown[]) => mockExeca(...args),
}));

import {
  checkUpdate,
  cleanOldBinaries,
  compareVersions,
  computeSha256,
  downloadFile,
  extractArchive,
  fetchLatestRelease,
  fetchReleaseDetails,
  formatSelfUpdateSummary,
  formatUpdateNotification,
  getTargetArchiveName,
  getUpdateCommand,
  isNewerVersion,
  isStandaloneBinary,
  loadUpdateCache,
  notifyUpdateIfAvailable,
  parseChecksumFile,
  performSelfUpdate,
  replaceBinarySafely,
  saveUpdateCache,
  UPDATE_CHECK_INTERVAL_MS,
} from "./updater.js";

describe("updater.ts", () => {
  let tempDir: string;
  let testCachePath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vsub-updater-test-"));
    testCachePath = path.join(tempDir, "update-cache.json");
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe("isStandaloneBinary", () => {
    it("should return false for node and dev runners", () => {
      expect(isStandaloneBinary("C:\\Program Files\\nodejs\\node.exe")).toBe(false);
      expect(isStandaloneBinary("/usr/local/bin/node")).toBe(false);
      expect(isStandaloneBinary("node")).toBe(false);
      expect(isStandaloneBinary("tsx.cmd")).toBe(false);
      expect(isStandaloneBinary("vitest")).toBe(false);
      expect(isStandaloneBinary("")).toBe(false);
    });

    it("should return true for compiled vsub executables", () => {
      expect(isStandaloneBinary("C:\\tools\\vsub.exe")).toBe(true);
      expect(isStandaloneBinary("C:/tools/vsub.exe")).toBe(true);
      expect(isStandaloneBinary("/usr/local/bin/vsub")).toBe(true);
      expect(isStandaloneBinary("vsub")).toBe(true);
      expect(isStandaloneBinary("vsub-windows-x64.exe")).toBe(true);
      expect(isStandaloneBinary("/opt/vsub-linux-x64")).toBe(true);
      expect(isStandaloneBinary("vsub-macos-arm64")).toBe(true);
    });
  });

  describe("getUpdateCommand", () => {
    it("should return 'vsub update' for standalone binary", () => {
      expect(getUpdateCommand(true)).toBe("vsub update");
    });

    it("should return 'npm i -g vsub-cli' for npm / script install", () => {
      expect(getUpdateCommand(false)).toBe("npm i -g vsub-cli");
    });
  });

  describe("getTargetArchiveName", () => {
    it("should resolve correct archive name for each OS and architecture", () => {
      expect(getTargetArchiveName("win32", "x64")).toBe("vsub-windows-x64.zip");
      expect(getTargetArchiveName("win32", "arm64")).toBe("vsub-windows-arm64.zip");
      expect(getTargetArchiveName("linux", "x64")).toBe("vsub-linux-x64.tar.gz");
      expect(getTargetArchiveName("linux", "arm64")).toBe("vsub-linux-arm64.tar.gz");
      expect(getTargetArchiveName("darwin", "arm64")).toBe("vsub-macos-arm64.tar.gz");
      expect(getTargetArchiveName("darwin", "x64")).toBe("vsub-macos-x64.tar.gz");
    });
  });

  describe("computeSha256 & parseChecksumFile", () => {
    it("should accurately compute sha256 hash of a file", () => {
      const testFile = path.join(tempDir, "test.txt");
      fs.writeFileSync(testFile, "hello vsub", "utf-8");
      // sha256 of "hello vsub" is known
      const hash = computeSha256(testFile);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it("should parse SHA256SUMS.txt format correctly", () => {
      const content = `
# Comment line
e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  vsub-windows-x64.zip
01ba4719c80b6fe911b091a7c05124b64eeece964e09c058ef8f9805daca546b  vsub-linux-x64.tar.gz

`;
      const map = parseChecksumFile(content);
      expect(map.size).toBe(2);
      expect(map.get("vsub-windows-x64.zip")).toBe(
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      );
      expect(map.get("vsub-linux-x64.tar.gz")).toBe(
        "01ba4719c80b6fe911b091a7c05124b64eeece964e09c058ef8f9805daca546b",
      );
    });
  });

  describe("compareVersions & isNewerVersion", () => {
    it("should correctly compare semantic versions", () => {
      expect(compareVersions("1.3.0", "1.4.0")).toBe(-1);
      expect(compareVersions("1.4.0", "1.3.0")).toBe(1);
      expect(compareVersions("1.3.0", "1.3.0")).toBe(0);
      expect(compareVersions("v1.3.0", "1.3.0")).toBe(0);
      expect(compareVersions("1.3.0", "v1.4.0")).toBe(-1);
      expect(compareVersions("1.3.1", "1.3.0")).toBe(1);
      expect(compareVersions("1.3", "1.3.0")).toBe(0);
      expect(compareVersions("2.0.0", "1.9.9")).toBe(1);
    });

    it("should handle prerelease tags", () => {
      expect(compareVersions("1.4.0-rc.1", "1.4.0")).toBe(-1);
      expect(compareVersions("1.4.0", "1.4.0-rc.1")).toBe(1);
      expect(compareVersions("1.4.0-alpha.1", "1.4.0-beta.1")).toBe(-1);
    });

    it("should identify newer versions with isNewerVersion", () => {
      expect(isNewerVersion("1.3.0", "1.4.0")).toBe(true);
      expect(isNewerVersion("1.3.0", "1.3.1")).toBe(true);
      expect(isNewerVersion("1.3.0", "2.0.0")).toBe(true);
      expect(isNewerVersion("1.4.0", "1.3.0")).toBe(false);
      expect(isNewerVersion("1.3.0", "1.3.0")).toBe(false);
    });
  });

  describe("loadUpdateCache & saveUpdateCache", () => {
    it("should return null when cache file does not exist", () => {
      expect(loadUpdateCache(testCachePath)).toBeNull();
    });

    it("should return null when cache file is corrupted", () => {
      fs.writeFileSync(testCachePath, "INVALID JSON {", "utf-8");
      expect(loadUpdateCache(testCachePath)).toBeNull();
    });

    it("should save and load cache successfully", () => {
      const data = {
        lastChecked: 1729000000000,
        latestVersion: "1.4.0",
        releaseUrl: "https://github.com/koohq/vsub-cli/releases/tag/v1.4.0",
      };

      saveUpdateCache(data, testCachePath);
      const loaded = loadUpdateCache(testCachePath);

      expect(loaded).toEqual(data);
    });
  });

  describe("fetchLatestRelease & fetchReleaseDetails", () => {
    it("should fetch and parse full release details with assets", async () => {
      const mockFetcher = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          tag_name: "v1.4.0",
          html_url: "https://github.com/koohq/vsub-cli/releases/tag/v1.4.0",
          assets: [
            {
              name: "vsub-windows-x64.zip",
              browser_download_url: "https://github.com/.../vsub-windows-x64.zip",
            },
            {
              name: "SHA256SUMS.txt",
              browser_download_url: "https://github.com/.../SHA256SUMS.txt",
            },
          ],
        }),
      } as unknown as Response);

      const result = await fetchReleaseDetails(mockFetcher, "1.3.0");
      expect(result).toEqual({
        version: "1.4.0",
        releaseUrl: "https://github.com/koohq/vsub-cli/releases/tag/v1.4.0",
        publishedAt: undefined,
        body: undefined,
        assets: [
          {
            name: "vsub-windows-x64.zip",
            browser_download_url: "https://github.com/.../vsub-windows-x64.zip",
            size: undefined,
          },
          {
            name: "SHA256SUMS.txt",
            browser_download_url: "https://github.com/.../SHA256SUMS.txt",
            size: undefined,
          },
        ],
      });

      const summary = await fetchLatestRelease(mockFetcher, "1.3.0");
      expect(summary).toEqual({
        version: "1.4.0",
        releaseUrl: "https://github.com/koohq/vsub-cli/releases/tag/v1.4.0",
      });
    });

    it("should return null when GitHub API responds with non-ok status", async () => {
      const mockFetcher = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
      } as unknown as Response);

      const result = await fetchReleaseDetails(mockFetcher, "1.3.0");
      expect(result).toBeNull();
    });

    it("should return null when network fails or throws", async () => {
      const mockFetcher = vi.fn().mockRejectedValue(new Error("Network offline"));

      const result = await fetchReleaseDetails(mockFetcher, "1.3.0");
      expect(result).toBeNull();
    });
  });

  describe("downloadFile", () => {
    it("should download content and write to file", async () => {
      const dest = path.join(tempDir, "downloaded.txt");
      const mockFetcher = vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: async () => Buffer.from("mock downloaded bytes"),
      } as unknown as Response);

      await downloadFile("https://example.com/file.txt", dest, mockFetcher);
      expect(fs.readFileSync(dest, "utf-8")).toBe("mock downloaded bytes");
    });

    it("should throw error if download fails", async () => {
      const dest = path.join(tempDir, "fail.txt");
      const mockFetcher = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
      } as unknown as Response);

      await expect(
        downloadFile("https://example.com/missing.txt", dest, mockFetcher),
      ).rejects.toThrow(/HTTP 404/);
    });
  });

  describe("extractArchive", () => {
    it("should extract archive using execa tar", async () => {
      const extractDir = path.join(tempDir, "extracted");
      const archivePath = path.join(tempDir, "archive.zip");
      fs.writeFileSync(archivePath, "fake zip");

      mockExeca.mockImplementation(async () => {
        fs.mkdirSync(extractDir, { recursive: true });
        const binaryName = process.platform === "win32" ? "vsub.exe" : "vsub";
        fs.writeFileSync(path.join(extractDir, binaryName), "dummy binary");
        return {};
      });

      const result = await extractArchive(archivePath, extractDir);
      expect(fs.existsSync(result)).toBe(true);
    });

    it("should throw error if extracted archive does not contain expected binary", async () => {
      const extractDir = path.join(tempDir, "extracted-empty");
      const archivePath = path.join(tempDir, "empty.zip");
      fs.writeFileSync(archivePath, "fake zip");

      mockExeca.mockImplementation(async () => {
        fs.mkdirSync(extractDir, { recursive: true });
        return {};
      });

      await expect(extractArchive(archivePath, extractDir)).rejects.toThrow(
        /did not contain expected binary/,
      );
    });
  });

  describe("cleanOldBinaries", () => {
    it("should delete any leftover vsub*.old files in directory", () => {
      const binDir = path.join(tempDir, "bin");
      fs.mkdirSync(binDir, { recursive: true });
      const oldFile1 = path.join(binDir, "vsub.exe.old");
      const oldFile2 = path.join(binDir, "vsub.exe.old.12345");
      const activeFile = path.join(binDir, "vsub.exe");

      fs.writeFileSync(oldFile1, "old 1");
      fs.writeFileSync(oldFile2, "old 2");
      fs.writeFileSync(activeFile, "active");

      cleanOldBinaries(binDir);

      expect(fs.existsSync(oldFile1)).toBe(false);
      expect(fs.existsSync(oldFile2)).toBe(false);
      expect(fs.existsSync(activeFile)).toBe(true);
    });
  });

  describe("replaceBinarySafely", () => {
    it("should replace binary safely on Windows with .old renaming", () => {
      const targetBinary = path.join(tempDir, "vsub.exe");
      const newBinary = path.join(tempDir, "new_vsub.exe");

      fs.writeFileSync(targetBinary, "old version binary");
      fs.writeFileSync(newBinary, "new version binary");

      replaceBinarySafely({
        newBinaryPath: newBinary,
        targetBinaryPath: targetBinary,
        platform: "win32",
      });

      expect(fs.readFileSync(targetBinary, "utf-8")).toBe("new version binary");
    });

    it("should rollback to previous binary on Windows if copy fails", () => {
      const targetBinary = path.join(tempDir, "vsub.exe");
      const newBinary = path.join(tempDir, "non_existent_binary.exe");

      fs.writeFileSync(targetBinary, "original binary");

      expect(() =>
        replaceBinarySafely({
          newBinaryPath: newBinary,
          targetBinaryPath: targetBinary,
          platform: "win32",
        }),
      ).toThrow();

      // Original binary should have been restored by rollback
      expect(fs.existsSync(targetBinary)).toBe(true);
      expect(fs.readFileSync(targetBinary, "utf-8")).toBe("original binary");
    });

    it("should replace binary safely on Unix", () => {
      const targetBinary = path.join(tempDir, "vsub");
      const newBinary = path.join(tempDir, "new_vsub");

      fs.writeFileSync(targetBinary, "old unix binary");
      fs.writeFileSync(newBinary, "new unix binary");

      replaceBinarySafely({
        newBinaryPath: newBinary,
        targetBinaryPath: targetBinary,
        platform: "linux",
      });

      expect(fs.readFileSync(targetBinary, "utf-8")).toBe("new unix binary");
      expect(fs.existsSync(`${targetBinary}.old`)).toBe(false);
    });
  });

  describe("formatSelfUpdateSummary", () => {
    it("should format summary in English and Japanese", () => {
      const result = {
        success: true,
        previousVersion: "1.3.0",
        newVersion: "1.4.0",
        binaryPath: "/usr/local/bin/vsub",
        releaseUrl: "https://github.com/koohq/vsub-cli/releases/tag/v1.4.0",
      };

      const enSummary = formatSelfUpdateSummary(result, "en");
      expect(enSummary).toContain("vsub-cli updated successfully!");
      expect(enSummary).toContain("v1.3.0");
      expect(enSummary).toContain("v1.4.0");

      const jaSummary = formatSelfUpdateSummary(result, "ja");
      expect(jaSummary).toContain("vsub-cli の更新が完了しました！");
      expect(jaSummary).toContain("v1.3.0");
      expect(jaSummary).toContain("v1.4.0");
    });
  });

  describe("performSelfUpdate", () => {
    it("should throw guidance error when executed in npm environment", async () => {
      await expect(
        performSelfUpdate({
          targetBinaryPath: "C:\\Program Files\\nodejs\\node.exe",
        }),
      ).rejects.toThrow(/npm i -g vsub-cli/);
    });

    it("should report alreadyLatest when current version is up to date", async () => {
      const mockFetcher = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          tag_name: "v1.3.0",
          html_url: "https://github.com/koohq/vsub-cli/releases/tag/v1.3.0",
          assets: [],
        }),
      } as unknown as Response);

      const result = await performSelfUpdate({
        currentVersion: "1.3.0",
        targetBinaryPath: path.join(tempDir, "vsub.exe"),
        fetcher: mockFetcher,
      });

      expect(result.alreadyLatest).toBe(true);
      expect(result.newVersion).toBe("1.3.0");
    });

    it("should complete full update pipeline when newer version is found", async () => {
      const targetBinary = path.join(tempDir, "vsub.exe");
      fs.writeFileSync(targetBinary, "old binary v1.3.0");

      const archiveName = "vsub-windows-x64.zip";
      const dummyArchiveContent = Buffer.from("dummy zip archive bytes");
      const dummyChecksum = computeSha256FromBuffer(dummyArchiveContent);
      const dummySums = `${dummyChecksum}  ${archiveName}\n`;

      const mockFetcher = vi.fn().mockImplementation(async (url: string) => {
        if (url.endsWith("/releases/latest")) {
          return {
            ok: true,
            json: async () => ({
              tag_name: "v1.4.0",
              html_url: "https://github.com/koohq/vsub-cli/releases/tag/v1.4.0",
              assets: [
                {
                  name: archiveName,
                  browser_download_url: `https://github.com/download/${archiveName}`,
                },
                {
                  name: "SHA256SUMS.txt",
                  browser_download_url: "https://github.com/download/SHA256SUMS.txt",
                },
              ],
            }),
          };
        }
        if (url.endsWith("SHA256SUMS.txt")) {
          return {
            ok: true,
            arrayBuffer: async () => Buffer.from(dummySums),
          };
        }
        if (url.endsWith(archiveName)) {
          return {
            ok: true,
            arrayBuffer: async () => dummyArchiveContent,
          };
        }
        return { ok: false, status: 404, statusText: "Not Found" };
      });

      // Mock execa tar extraction to write new vsub.exe
      mockExeca.mockImplementation(async (_cmd: unknown, args: unknown[]) => {
        const destDir = (args as string[])[3] || "";
        fs.writeFileSync(path.join(destDir, "vsub.exe"), "brand new binary v1.4.0");
        return {};
      });

      const result = await performSelfUpdate({
        currentVersion: "1.3.0",
        targetBinaryPath: targetBinary,
        platform: "win32",
        arch: "x64",
        fetcher: mockFetcher,
      });

      expect(result.success).toBe(true);
      expect(result.previousVersion).toBe("1.3.0");
      expect(result.newVersion).toBe("1.4.0");
      expect(fs.readFileSync(targetBinary, "utf-8")).toBe("brand new binary v1.4.0");
    });

    it("should abort if SHA-256 checksum mismatch is detected", async () => {
      const targetBinary = path.join(tempDir, "vsub.exe");
      fs.writeFileSync(targetBinary, "old binary v1.3.0");

      const archiveName = "vsub-windows-x64.zip";
      const dummyArchiveContent = Buffer.from("corrupted zip archive");
      const wrongChecksum = "0000000000000000000000000000000000000000000000000000000000000000";
      const dummySums = `${wrongChecksum}  ${archiveName}\n`;

      const mockFetcher = vi.fn().mockImplementation(async (url: string) => {
        if (url.endsWith("/releases/latest")) {
          return {
            ok: true,
            json: async () => ({
              tag_name: "v1.4.0",
              html_url: "https://github.com/koohq/vsub-cli/releases/tag/v1.4.0",
              assets: [
                {
                  name: archiveName,
                  browser_download_url: `https://github.com/download/${archiveName}`,
                },
                {
                  name: "SHA256SUMS.txt",
                  browser_download_url: "https://github.com/download/SHA256SUMS.txt",
                },
              ],
            }),
          };
        }
        if (url.endsWith("SHA256SUMS.txt")) {
          return {
            ok: true,
            arrayBuffer: async () => Buffer.from(dummySums),
          };
        }
        if (url.endsWith(archiveName)) {
          return {
            ok: true,
            arrayBuffer: async () => dummyArchiveContent,
          };
        }
        return { ok: false, status: 404 };
      });

      await expect(
        performSelfUpdate({
          currentVersion: "1.3.0",
          targetBinaryPath: targetBinary,
          platform: "win32",
          arch: "x64",
          fetcher: mockFetcher,
        }),
      ).rejects.toThrow(/Checksum mismatch/);

      // Target binary should be untouched
      expect(fs.readFileSync(targetBinary, "utf-8")).toBe("old binary v1.3.0");
    });
  });

  describe("checkUpdate", () => {
    it("should return null if disableUpdateCheck is true", async () => {
      const mockFetcher = vi.fn();
      const result = await checkUpdate({
        disableUpdateCheck: true,
        fetcher: mockFetcher,
        cachePath: testCachePath,
      });

      expect(result).toBeNull();
      expect(mockFetcher).not.toHaveBeenCalled();
    });

    it("should fetch new version when no cache exists and return update result", async () => {
      const mockFetcher = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          tag_name: "v1.4.0",
          html_url: "https://github.com/koohq/vsub-cli/releases/tag/v1.4.0",
        }),
      } as unknown as Response);

      const result = await checkUpdate({
        currentVersion: "1.3.0",
        cachePath: testCachePath,
        fetcher: mockFetcher,
        isBinary: false,
      });

      expect(result).toEqual({
        updateAvailable: true,
        currentVersion: "1.3.0",
        latestVersion: "1.4.0",
        updateCommand: "npm i -g vsub-cli",
        releaseUrl: "https://github.com/koohq/vsub-cli/releases/tag/v1.4.0",
      });

      // Cache file should have been written
      const cache = loadUpdateCache(testCachePath);
      expect(cache?.latestVersion).toBe("1.4.0");
    });

    it("should return null if latest version is equal to current version", async () => {
      const mockFetcher = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          tag_name: "v1.3.0",
          html_url: "https://github.com/koohq/vsub-cli/releases/tag/v1.3.0",
        }),
      } as unknown as Response);

      const result = await checkUpdate({
        currentVersion: "1.3.0",
        cachePath: testCachePath,
        fetcher: mockFetcher,
      });

      expect(result).toBeNull();
    });

    it("should respect 24h cache and avoid network request", async () => {
      const now = 1729000000000;
      saveUpdateCache(
        {
          lastChecked: now - 1000 * 60 * 60, // 1 hour ago
          latestVersion: "1.5.0",
          releaseUrl: "https://github.com/koohq/vsub-cli/releases/tag/v1.5.0",
        },
        testCachePath,
      );

      const mockFetcher = vi.fn();
      const result = await checkUpdate({
        currentVersion: "1.3.0",
        cachePath: testCachePath,
        fetcher: mockFetcher,
        now,
        isBinary: true,
      });

      expect(mockFetcher).not.toHaveBeenCalled();
      expect(result).toEqual({
        updateAvailable: true,
        currentVersion: "1.3.0",
        latestVersion: "1.5.0",
        updateCommand: "vsub update",
        releaseUrl: "https://github.com/koohq/vsub-cli/releases/tag/v1.5.0",
      });
    });

    it("should re-fetch when cache is older than 24h", async () => {
      const now = 1729000000000;
      saveUpdateCache(
        {
          lastChecked: now - (UPDATE_CHECK_INTERVAL_MS + 1000), // 24h 1s ago
          latestVersion: "1.3.5",
        },
        testCachePath,
      );

      const mockFetcher = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          tag_name: "v1.6.0",
          html_url: "https://github.com/koohq/vsub-cli/releases/tag/v1.6.0",
        }),
      } as unknown as Response);

      const result = await checkUpdate({
        currentVersion: "1.3.0",
        cachePath: testCachePath,
        fetcher: mockFetcher,
        now,
      });

      expect(mockFetcher).toHaveBeenCalledTimes(1);
      expect(result?.latestVersion).toBe("1.6.0");
    });

    it("should force re-fetch when force is true even if cache is fresh", async () => {
      const now = 1729000000000;
      saveUpdateCache(
        {
          lastChecked: now - 1000,
          latestVersion: "1.3.0",
        },
        testCachePath,
      );

      const mockFetcher = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          tag_name: "v1.4.0",
        }),
      } as unknown as Response);

      const result = await checkUpdate({
        currentVersion: "1.3.0",
        cachePath: testCachePath,
        fetcher: mockFetcher,
        force: true,
        now,
      });

      expect(mockFetcher).toHaveBeenCalledTimes(1);
      expect(result?.latestVersion).toBe("1.4.0");
    });

    it("should handle fetch failure gracefully and write cooldown cache", async () => {
      const now = 1729000000000;
      const mockFetcher = vi.fn().mockRejectedValue(new Error("Timeout"));

      const result = await checkUpdate({
        currentVersion: "1.3.0",
        cachePath: testCachePath,
        fetcher: mockFetcher,
        now,
      });

      expect(result).toBeNull();
      const cache = loadUpdateCache(testCachePath);
      expect(cache?.lastChecked).toBe(now);
    });
  });

  describe("formatUpdateNotification", () => {
    const updateResult = {
      updateAvailable: true,
      currentVersion: "1.3.0",
      latestVersion: "1.4.0",
      updateCommand: "npm i -g vsub-cli",
      releaseUrl: "https://github.com/koohq/vsub-cli/releases/tag/v1.4.0",
    };

    it("should format notification in English", () => {
      const formatted = formatUpdateNotification(updateResult, "en");
      expect(formatted).toContain("Update available: v1.3.0 ➔ v1.4.0");
      expect(formatted).toContain("npm i -g vsub-cli");
      expect(formatted).toContain("Release notes:");
    });

    it("should format notification in Japanese", () => {
      const formatted = formatUpdateNotification(updateResult, "ja");
      expect(formatted).toContain("新しいバージョンが利用可能です: v1.3.0 ➔ v1.4.0");
      expect(formatted).toContain("更新コマンド: npm i -g vsub-cli");
      expect(formatted).toContain("リリースノート:");
    });
  });

  describe("notifyUpdateIfAvailable", () => {
    it("should not print if disableUpdateCheck is true", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      await notifyUpdateIfAvailable({ disableUpdateCheck: true });
      expect(consoleSpy).not.toHaveBeenCalled();
    });
  });
});

function computeSha256FromBuffer(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}
