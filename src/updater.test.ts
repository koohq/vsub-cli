import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:sea", () => ({ isSea: vi.fn(() => false) }));

import { isSea } from "node:sea";

const mockExeca = vi.fn();
vi.mock("execa", () => ({
  execa: (...args: unknown[]) => mockExeca(...args),
}));

import {
  checkUpdate,
  cleanOldBinaries,
  cleanOldBinariesOnStartup,
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
  quotePowerShellLiteral,
  replaceBinarySafely,
  saveUpdateCache,
  UPDATE_CHECK_INTERVAL_MS,
} from "./updater.js";

const originalExecPath = process.execPath;

function setProcessExecPath(value: string): void {
  Object.defineProperty(process, "execPath", { value, configurable: true });
}

describe("updater.ts", () => {
  let tempDir: string;
  let testCachePath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vsub-updater-test-"));
    testCachePath = path.join(tempDir, "update-cache.json");
    vi.mocked(isSea).mockReturnValue(false);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
    setProcessExecPath(originalExecPath);
  });

  describe("isStandaloneBinary", () => {
    it.each([
      { sea: true, execPath: "C:\\tools\\subtitler.exe", expected: true },
      { sea: true, execPath: "/usr/local/bin/vsub", expected: true },
      { sea: false, execPath: "/opt/vsub-node", expected: false },
      { sea: false, execPath: "C:\\Program Files\\nodejs\\node.exe", expected: false },
    ])(
      "should return $expected when isSea() is $sea and execPath is $execPath",
      ({ sea, execPath, expected }) => {
        vi.mocked(isSea).mockReturnValue(sea);
        setProcessExecPath(execPath);
        expect(isStandaloneBinary()).toBe(expected);
      },
    );
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
      expect(compareVersions("1.4.0-beta.1", "1.4.0-alpha.1")).toBe(1);
      expect(compareVersions("1.4.0-beta.1", "1.4.0-beta.1")).toBe(0);
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

    it("should return null when release data has no tag_name", async () => {
      const mockFetcher = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ html_url: "https://github.com/koohq/vsub-cli/releases" }),
      } as unknown as Response);

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

  describe("quotePowerShellLiteral", () => {
    it.each([
      { input: "C:\\a\\b.zip", expected: "'C:\\a\\b.zip'" },
      { input: "C:\\it's\\b.zip", expected: "'C:\\it''s\\b.zip'" },
      { input: "C:\\it's and that's\\b.zip", expected: "'C:\\it''s and that''s\\b.zip'" },
      { input: "C:\\path\\[x]\\b.zip", expected: "'C:\\path\\[x]\\b.zip'" },
    ])("should quote $input as $expected", ({ input, expected }) => {
      expect(quotePowerShellLiteral(input)).toBe(expected);
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

    function setupTarFallback(options?: { onTar?: () => void; onPowerShell?: () => void }) {
      let tarCalled = false;
      let powershellCalled = false;
      mockExeca.mockImplementation(async (cmd: unknown) => {
        if (cmd === "tar") {
          tarCalled = true;
          options?.onTar?.();
          throw new Error("tar failed");
        }
        if (cmd === "powershell") {
          powershellCalled = true;
          options?.onPowerShell?.();
          return {};
        }
        return {};
      });
      return {
        getTarCalled: () => tarCalled,
        getPowershellCalled: () => powershellCalled,
      };
    }

    it("should pass -LiteralPath and escaped paths to PowerShell Expand-Archive when tar fails", async () => {
      const specialDir = path.join(tempDir, "it's [x]");
      fs.mkdirSync(specialDir, { recursive: true });
      const archivePath = path.join(specialDir, "vsub.zip");
      const extractDir = path.join(specialDir, "dest");
      fs.writeFileSync(archivePath, "fake zip");

      const tracker = setupTarFallback({
        onPowerShell: () => {
          fs.mkdirSync(extractDir, { recursive: true });
          fs.writeFileSync(path.join(extractDir, "vsub.exe"), "dummy binary");
        },
      });

      const result = await extractArchive(archivePath, extractDir, "win32");
      expect(tracker.getTarCalled()).toBe(true);
      expect(fs.existsSync(result)).toBe(true);

      const quotedArchive = `'${archivePath.replace(/'/g, "''")}'`;
      const quotedDest = `'${extractDir.replace(/'/g, "''")}'`;
      expect(mockExeca).toHaveBeenCalledWith("powershell", [
        "-NoProfile",
        "-Command",
        `$ErrorActionPreference = 'Stop'; Expand-Archive -LiteralPath ${quotedArchive} -DestinationPath ${quotedDest} -Force`,
      ]);
    });

    it("should remove destDir and intermediate files before PowerShell Expand-Archive fallback", async () => {
      const specialDir = path.join(tempDir, "it's [x] fallback");
      fs.mkdirSync(specialDir, { recursive: true });
      const archivePath = path.join(specialDir, "vsub.zip");
      const extractDir = path.join(specialDir, "dest");
      fs.writeFileSync(archivePath, "fake zip");

      let destDirExistedWhenPowerShellCalled: boolean | undefined;

      setupTarFallback({
        onTar: () => {
          fs.mkdirSync(extractDir, { recursive: true });
          fs.writeFileSync(path.join(extractDir, "vsub.exe"), "partial");
          fs.writeFileSync(path.join(extractDir, "leftover.txt"), "junk");
        },
        onPowerShell: () => {
          destDirExistedWhenPowerShellCalled = fs.existsSync(extractDir);
          fs.mkdirSync(extractDir, { recursive: true });
          fs.writeFileSync(path.join(extractDir, "vsub.exe"), "new binary from powershell");
        },
      });

      const result = await extractArchive(archivePath, extractDir, "win32");

      expect(destDirExistedWhenPowerShellCalled).toBe(false);
      expect(fs.readFileSync(result, "utf-8")).toBe("new binary from powershell");
      expect(fs.existsSync(path.join(extractDir, "leftover.txt"))).toBe(false);
    });
  });

  describe("cleanOldBinaries", () => {
    const tableCases = [
      { file: "mytool.exe", win32: true, linux: true },
      { file: "mytool.exe.old", win32: false, linux: false },
      { file: "mytool.exe.old.1730000000000", win32: false, linux: false },
      { file: "mytool.exe.older", win32: true, linux: true },
      { file: "mytool.exe.old.bak", win32: true, linux: true },
      { file: "vsub.exe.old", win32: true, linux: true },
      { file: "vsub-notes.old.txt", win32: true, linux: true },
    ] as const;

    it.each([{ platform: "win32" as const }, { platform: "linux" as const }])(
      "should clean only target .old binaries on $platform",
      ({ platform }) => {
        const binDir = path.join(tempDir, `bin-${platform}`);
        fs.mkdirSync(binDir, { recursive: true });
        const binaryPath = path.join(binDir, "mytool.exe");

        for (const item of tableCases) {
          fs.writeFileSync(path.join(binDir, item.file), "dummy");
        }

        cleanOldBinaries(binaryPath, platform);

        for (const item of tableCases) {
          const shouldRemain = item[platform];
          expect(fs.existsSync(path.join(binDir, item.file))).toBe(shouldRemain);
        }
      },
    );

    it.each([
      { platform: "win32" as const, shouldRemain: false },
      { platform: "linux" as const, shouldRemain: true },
    ])(
      "should handle case sensitivity for MyTool.EXE.old on $platform",
      ({ platform, shouldRemain }) => {
        const binCaseDir = path.join(tempDir, `bin-case-${platform}`);
        fs.mkdirSync(binCaseDir, { recursive: true });
        const binaryPath = path.join(binCaseDir, "mytool.exe");
        fs.writeFileSync(binaryPath, "dummy binary");
        const caseOldFile = path.join(binCaseDir, "MyTool.EXE.old");
        fs.writeFileSync(caseOldFile, "dummy old");

        cleanOldBinaries(binaryPath, platform);

        expect(fs.existsSync(caseOldFile)).toBe(shouldRemain);
      },
    );

    it("should handle binary path with regex special characters", () => {
      const binDir = path.join(tempDir, "bin-special");
      fs.mkdirSync(binDir, { recursive: true });
      const binaryPath = path.join(binDir, "my+tool (1).exe");
      fs.writeFileSync(binaryPath, "binary");
      const targetOld = path.join(binDir, "my+tool (1).exe.old");
      const unrelatedOld = path.join(binDir, "myytool (1).exe.old");
      fs.writeFileSync(targetOld, "target old");
      fs.writeFileSync(unrelatedOld, "unrelated old");

      cleanOldBinaries(binaryPath, "win32");

      expect(fs.existsSync(targetOld)).toBe(false);
      expect(fs.existsSync(unrelatedOld)).toBe(true);
    });

    it("should not throw if binary directory does not exist", () => {
      expect(() => {
        cleanOldBinaries(path.join(tempDir, "non_existent_dir", "mytool.exe"));
      }).not.toThrow();
    });
  });

  describe("cleanOldBinariesOnStartup", () => {
    it.each([
      { isSeaValue: true, shouldRemain: false },
      { isSeaValue: false, shouldRemain: true },
    ])(
      "when isSea is $isSeaValue, should clean old binaries: $shouldRemain",
      ({ isSeaValue, shouldRemain }) => {
        vi.mocked(isSea).mockReturnValue(isSeaValue);

        const binDir = path.join(tempDir, `bin-startup-${isSeaValue}`);
        fs.mkdirSync(binDir, { recursive: true });
        const dummyExecPath = path.join(binDir, "mytool.exe");
        const dummyOldPath = path.join(binDir, "mytool.exe.old");

        fs.writeFileSync(dummyExecPath, "binary");
        fs.writeFileSync(dummyOldPath, "old binary");

        setProcessExecPath(dummyExecPath);

        cleanOldBinariesOnStartup();

        expect(fs.existsSync(dummyOldPath)).toBe(shouldRemain);
      },
    );
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

    it("should clean old binary backups matching target name but keep unrelated .old files", () => {
      const targetBinary = path.join(tempDir, "mytool.exe");
      const newBinary = path.join(tempDir, "new_mytool.exe");
      const leftoverBackup = path.join(tempDir, "mytool.exe.old.12345");
      const unrelatedOld = path.join(tempDir, "vsub-notes.old.txt");

      fs.writeFileSync(targetBinary, "current binary");
      fs.writeFileSync(newBinary, "new binary");
      fs.writeFileSync(leftoverBackup, "prior backup");
      fs.writeFileSync(unrelatedOld, "notes");

      replaceBinarySafely({
        newBinaryPath: newBinary,
        targetBinaryPath: targetBinary,
        platform: "win32",
      });

      expect(fs.existsSync(leftoverBackup)).toBe(false);
      expect(fs.existsSync(unrelatedOld)).toBe(true);
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

    describe("Unix cross-device and failure handling", () => {
      let binDir: string;
      let extractedDir: string;
      let targetBinary: string;
      let newBinary: string;

      beforeEach(() => {
        binDir = path.join(tempDir, "bin");
        extractedDir = path.join(tempDir, "extracted");
        fs.mkdirSync(binDir, { recursive: true });
        fs.mkdirSync(extractedDir, { recursive: true });
        targetBinary = path.join(binDir, "vsub");
        newBinary = path.join(extractedDir, "vsub");
        fs.writeFileSync(targetBinary, "original unix binary");
        fs.writeFileSync(newBinary, "new unix binary");
      });

      it("should replace binary across filesystems handling EXDEV", () => {
        const realRenameSync = fs.renameSync;
        const renameSpy = vi.spyOn(fs, "renameSync").mockImplementation((oldPath, newPath) => {
          const oldDir = path.dirname(String(oldPath));
          const newDir = path.dirname(String(newPath));
          if (oldDir !== newDir) {
            const err = new Error(
              "EXDEV: cross-device link not permitted",
            ) as NodeJS.ErrnoException;
            err.code = "EXDEV";
            throw err;
          }
          return realRenameSync(oldPath, newPath);
        });

        replaceBinarySafely({
          newBinaryPath: newBinary,
          targetBinaryPath: targetBinary,
          platform: "linux",
        });

        expect(fs.readFileSync(targetBinary, "utf-8")).toBe("new unix binary");
        expect(fs.readdirSync(binDir)).toEqual(["vsub"]);
        if (process.platform !== "win32") {
          expect(fs.statSync(targetBinary).mode & 0o777).toBe(0o755);
        }
        renameSpy.mockRestore();
      });

      it("should clean up staged temporary binary and leave original untouched on failure", () => {
        const renameSpy = vi.spyOn(fs, "renameSync").mockImplementation(() => {
          const err = new Error("EPERM: operation not permitted") as NodeJS.ErrnoException;
          err.code = "EPERM";
          throw err;
        });

        expect(() =>
          replaceBinarySafely({
            newBinaryPath: newBinary,
            targetBinaryPath: targetBinary,
            platform: "linux",
          }),
        ).toThrow(/sudo/);

        expect(fs.readFileSync(targetBinary, "utf-8")).toBe("original unix binary");
        expect(fs.readdirSync(binDir)).toEqual(["vsub"]);
        renameSpy.mockRestore();
      });
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
          isBinary: false,
          cachePath: testCachePath,
        }),
      ).rejects.toThrow(/npm i -g vsub-cli/);
    });

    it("should report alreadyLatest when current version is up to date", async () => {
      const mockFetcher = createReleaseFetcher({
        tag: "v1.3.0",
        assets: [],
      });

      const result = await performSelfUpdate({
        currentVersion: "1.3.0",
        targetBinaryPath: path.join(tempDir, "vsub.exe"),
        fetcher: mockFetcher,
        isBinary: true,
        cachePath: testCachePath,
      });

      expect(result.alreadyLatest).toBe(true);
      expect(result.newVersion).toBe("1.3.0");
    });

    it("should complete full update pipeline when newer version is found", async () => {
      const targetBinary = path.join(tempDir, "vsub.exe");
      fs.writeFileSync(targetBinary, "old binary v1.3.0");

      const archiveName = "vsub-windows-x64.zip";
      const dummyArchiveContent = Buffer.from("dummy zip archive bytes");
      const mockFetcher = createReleaseFetcher({
        tag: "v1.4.0",
        archiveName,
        archiveContent: dummyArchiveContent,
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
        isBinary: true,
        cachePath: testCachePath,
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
      const mockFetcher = createReleaseFetcher({
        tag: "v1.4.0",
        archiveName,
        archiveContent: dummyArchiveContent,
        sums: dummySums,
      });

      await expect(
        performSelfUpdate({
          currentVersion: "1.3.0",
          targetBinaryPath: targetBinary,
          platform: "win32",
          arch: "x64",
          fetcher: mockFetcher,
          isBinary: true,
          cachePath: testCachePath,
        }),
      ).rejects.toThrow(/Checksum mismatch/);

      // Target binary should be untouched
      expect(fs.readFileSync(targetBinary, "utf-8")).toBe("old binary v1.3.0");
    });

    it.each([
      { lang: "en", pattern: /does not include SHA256SUMS\.txt/ },
      { lang: "ja", pattern: /SHA256SUMS\.txt が無い/ },
    ])(
      "should abort before downloading archive if SHA256SUMS.txt is missing (lang: $lang)",
      async ({ lang, pattern }) => {
        const targetBinary = path.join(tempDir, "vsub.exe");
        fs.writeFileSync(targetBinary, "original binary");

        const archiveName = "vsub-windows-x64.zip";
        const mockFetcher = createReleaseFetcher({
          tag: "v1.4.0",
          archiveName,
          sums: null,
        });

        mockExeca.mockClear();

        await expect(
          performSelfUpdate({
            currentVersion: "1.3.0",
            targetBinaryPath: targetBinary,
            platform: "win32",
            arch: "x64",
            fetcher: mockFetcher,
            isBinary: true,
            cachePath: testCachePath,
            lang,
          }),
        ).rejects.toThrow(pattern);

        const calledUrls = mockFetcher.mock.calls.map((c) => c[0] as string);
        expect(calledUrls.some((u: string) => u.endsWith(archiveName))).toBe(false);
        expect(mockExeca).not.toHaveBeenCalled();
        expect(fs.readFileSync(targetBinary, "utf-8")).toBe("original binary");
      },
    );

    it("should abort before extracting if SHA256SUMS.txt has no entry for target archive", async () => {
      const targetBinary = path.join(tempDir, "vsub.exe");
      fs.writeFileSync(targetBinary, "original binary");

      const archiveName = "vsub-windows-x64.zip";
      const dummySums =
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef  vsub-linux-x64.tar.gz\n";
      const mockFetcher = createReleaseFetcher({
        tag: "v1.4.0",
        archiveName,
        sums: dummySums,
      });

      mockExeca.mockClear();

      await expect(
        performSelfUpdate({
          currentVersion: "1.3.0",
          targetBinaryPath: targetBinary,
          platform: "win32",
          arch: "x64",
          fetcher: mockFetcher,
          isBinary: true,
          cachePath: testCachePath,
        }),
      ).rejects.toThrow(/has no checksum for vsub-windows-x64\.zip/);

      expect(mockExeca).not.toHaveBeenCalled();
      expect(fs.readFileSync(targetBinary, "utf-8")).toBe("original binary");
    });

    it("should update renamed SEA binary without isBinary and save update cache to custom cachePath", async () => {
      vi.mocked(isSea).mockReturnValue(true);
      const customBinary = path.join(tempDir, "my-subtitler.exe");
      fs.writeFileSync(customBinary, "old binary v1.3.0");

      const archiveName = "vsub-windows-x64.zip";
      const mockFetcher = createReleaseFetcher({
        tag: "v1.4.0",
        archiveName,
      });

      mockExeca.mockImplementation(async (_cmd: unknown, args: unknown[]) => {
        const destDir = (args as string[])[3] || "";
        fs.writeFileSync(path.join(destDir, "vsub.exe"), "brand new binary v1.4.0");
        return {};
      });

      const result = await performSelfUpdate({
        currentVersion: "1.3.0",
        targetBinaryPath: customBinary,
        platform: "win32",
        arch: "x64",
        fetcher: mockFetcher,
        cachePath: testCachePath,
      });

      expect(result.success).toBe(true);
      expect(fs.readFileSync(customBinary, "utf-8")).toBe("brand new binary v1.4.0");
      expect(loadUpdateCache(testCachePath)?.latestVersion).toBe("1.4.0");
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

function createReleaseFetcher(
  options: {
    tag?: string | undefined;
    releaseUrl?: string | undefined;
    assets?: Array<{ name: string; browser_download_url: string }> | undefined;
    archiveName?: string | undefined;
    archiveContent?: Buffer | string | undefined;
    sums?: string | null | undefined;
  } = {},
) {
  const tag = options.tag ?? "v1.4.0";
  const releaseUrl = options.releaseUrl ?? `https://github.com/koohq/vsub-cli/releases/tag/${tag}`;
  const archiveName = options.archiveName ?? "vsub-windows-x64.zip";
  const archiveContent = Buffer.isBuffer(options.archiveContent)
    ? options.archiveContent
    : Buffer.from(options.archiveContent ?? "dummy zip archive bytes");

  const defaultSums =
    options.sums === undefined
      ? `${computeSha256FromBuffer(archiveContent)}  ${archiveName}\n`
      : options.sums;

  const assets: Array<{ name: string; browser_download_url: string }> = options.assets ?? [
    {
      name: archiveName,
      browser_download_url: `https://github.com/download/${archiveName}`,
    },
    ...(defaultSums !== null
      ? [
          {
            name: "SHA256SUMS.txt",
            browser_download_url: "https://github.com/download/SHA256SUMS.txt",
          },
        ]
      : []),
  ];

  return vi.fn().mockImplementation(async (url: string) => {
    if (url.endsWith("/releases/latest")) {
      return {
        ok: true,
        json: async () => ({
          tag_name: tag,
          html_url: releaseUrl,
          assets,
        }),
      } as unknown as Response;
    }
    if (url.endsWith("SHA256SUMS.txt")) {
      if (defaultSums === null) {
        return { ok: false, status: 404, statusText: "Not Found" } as unknown as Response;
      }
      return {
        ok: true,
        arrayBuffer: async () => Buffer.from(defaultSums),
      } as unknown as Response;
    }
    if (url.endsWith(archiveName)) {
      return {
        ok: true,
        arrayBuffer: async () => archiveContent,
      } as unknown as Response;
    }
    return { ok: false, status: 404, statusText: "Not Found" } as unknown as Response;
  });
}
