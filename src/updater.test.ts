import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkUpdate,
  compareVersions,
  fetchLatestRelease,
  formatUpdateNotification,
  getUpdateCommand,
  isNewerVersion,
  isStandaloneBinary,
  loadUpdateCache,
  notifyUpdateIfAvailable,
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
    });

    it("should return true for compiled vsub executables", () => {
      expect(isStandaloneBinary("C:\\tools\\vsub.exe")).toBe(true);
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
      // Release is newer than prerelease
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

  describe("fetchLatestRelease", () => {
    it("should fetch and parse latest release tag from GitHub", async () => {
      const mockFetcher = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          tag_name: "v1.4.0",
          html_url: "https://github.com/koohq/vsub-cli/releases/tag/v1.4.0",
        }),
      } as unknown as Response);

      const result = await fetchLatestRelease(mockFetcher, "1.3.0");
      expect(result).toEqual({
        version: "1.4.0",
        releaseUrl: "https://github.com/koohq/vsub-cli/releases/tag/v1.4.0",
      });
      expect(mockFetcher).toHaveBeenCalledWith(
        "https://api.github.com/repos/koohq/vsub-cli/releases/latest",
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            "User-Agent": "vsub-cli/1.3.0",
          }),
        }),
      );
    });

    it("should return null when GitHub API responds with non-ok status", async () => {
      const mockFetcher = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
      } as unknown as Response);

      const result = await fetchLatestRelease(mockFetcher, "1.3.0");
      expect(result).toBeNull();
    });

    it("should return null when network fails or throws", async () => {
      const mockFetcher = vi.fn().mockRejectedValue(new Error("Network offline"));

      const result = await fetchLatestRelease(mockFetcher, "1.3.0");
      expect(result).toBeNull();
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
