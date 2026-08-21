import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkExistingFiles,
  createBackup,
  ensureWritableTargets,
  promptOverwriteConfirmation,
  resolveBackupPath,
} from "./safety.js";

describe("safety.ts", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vsub-safety-test-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
    vi.restoreAllMocks();
  });

  describe("checkExistingFiles", () => {
    it("should return only existing file paths and deduplicate them", () => {
      const file1 = path.join(tempDir, "file1.srt");
      const file2 = path.join(tempDir, "file2.srt");
      const file3 = path.join(tempDir, "file3.srt");

      fs.writeFileSync(file1, "dummy 1");
      fs.writeFileSync(file3, "dummy 3");

      const result = checkExistingFiles([file1, file2, file3, file1]);
      expect(result).toEqual([file1, file3]);
    });

    it("should return empty array when no files exist", () => {
      const file1 = path.join(tempDir, "nonexistent1.srt");
      const file2 = path.join(tempDir, "nonexistent2.srt");

      const result = checkExistingFiles([file1, file2]);
      expect(result).toEqual([]);
    });
  });

  describe("resolveBackupPath", () => {
    it("should return .bak if it does not exist", () => {
      const target = path.join(tempDir, "test.srt");
      expect(resolveBackupPath(target)).toBe(`${target}.bak`);
    });

    it("should return .bak.1 if .bak already exists", () => {
      const target = path.join(tempDir, "test.srt");
      fs.writeFileSync(`${target}.bak`, "previous backup");

      expect(resolveBackupPath(target)).toBe(`${target}.bak.1`);
    });

    it("should return .bak.2 if .bak and .bak.1 already exist", () => {
      const target = path.join(tempDir, "test.srt");
      fs.writeFileSync(`${target}.bak`, "backup 0");
      fs.writeFileSync(`${target}.bak.1`, "backup 1");

      expect(resolveBackupPath(target)).toBe(`${target}.bak.2`);
    });
  });

  describe("createBackup", () => {
    it("should return null if source file does not exist", () => {
      const target = path.join(tempDir, "nonexistent.srt");
      expect(createBackup(target)).toBeNull();
    });

    it("should copy file to backup path and preserve content", () => {
      const target = path.join(tempDir, "sample.srt");
      fs.writeFileSync(target, "original content");

      const backupPath = createBackup(target);
      expect(backupPath).toBe(`${target}.bak`);
      expect(backupPath && fs.existsSync(backupPath)).toBe(true);
      expect(backupPath && fs.readFileSync(backupPath, "utf-8")).toBe("original content");
      // Original file still exists
      expect(fs.existsSync(target)).toBe(true);
    });

    it("should create numbered backup when .bak exists", () => {
      const target = path.join(tempDir, "sample.srt");
      fs.writeFileSync(target, "original content v2");
      fs.writeFileSync(`${target}.bak`, "backup v1");

      const backupPath = createBackup(target);
      expect(backupPath).toBe(`${target}.bak.1`);
      expect(backupPath && fs.readFileSync(backupPath, "utf-8")).toBe("original content v2");
    });
  });

  describe("promptOverwriteConfirmation", () => {
    it("should return true when user inputs 'y', 'Y', or 'yes'", async () => {
      const resultY = await promptOverwriteConfirmation(["test.srt"], {
        promptFn: async () => "y",
      });
      expect(resultY).toBe(true);

      const resultUpper = await promptOverwriteConfirmation(["test.srt"], {
        promptFn: async () => "YES",
      });
      expect(resultUpper).toBe(true);

      const resultWithSpaces = await promptOverwriteConfirmation(["test.srt"], {
        promptFn: async () => "  y  ",
      });
      expect(resultWithSpaces).toBe(true);
    });

    it("should return false when user inputs 'n', 'no', empty string, or anything else", async () => {
      const resultN = await promptOverwriteConfirmation(["test.srt"], {
        promptFn: async () => "n",
      });
      expect(resultN).toBe(false);

      const resultEmpty = await promptOverwriteConfirmation(["test.srt"], {
        promptFn: async () => "",
      });
      expect(resultEmpty).toBe(false);

      const resultOther = await promptOverwriteConfirmation(["test.srt"], {
        promptFn: async () => "cancel",
      });
      expect(resultOther).toBe(false);
    });
  });

  describe("ensureWritableTargets", () => {
    it("should return proceed: true and empty backedUp if no files exist", async () => {
      const file1 = path.join(tempDir, "out1.srt");
      const file2 = path.join(tempDir, "out2.vtt");

      const res = await ensureWritableTargets([file1, file2]);
      expect(res).toEqual({
        proceed: true,
        backedUp: [],
        existingFiles: [],
      });
    });

    it("should return proceed: true and backedUp list when backup option is true", async () => {
      const file1 = path.join(tempDir, "out1.srt");
      const file2 = path.join(tempDir, "out2.vtt");
      fs.writeFileSync(file1, "existing srt content");

      const res = await ensureWritableTargets([file1, file2], { backup: true });
      expect(res.proceed).toBe(true);
      expect(res.existingFiles).toEqual([file1]);
      expect(res.backedUp).toEqual([{ original: file1, backup: `${file1}.bak` }]);
      expect(fs.existsSync(`${file1}.bak`)).toBe(true);
    });

    it("should return proceed: true and no backups when overwrite option is true", async () => {
      const file1 = path.join(tempDir, "out1.srt");
      fs.writeFileSync(file1, "existing srt content");

      const res = await ensureWritableTargets([file1], { overwrite: true });
      expect(res).toEqual({
        proceed: true,
        backedUp: [],
        existingFiles: [file1],
      });
      expect(fs.existsSync(`${file1}.bak`)).toBe(false);
    });

    it("should prompt user when interactive and proceed when accepted", async () => {
      const file1 = path.join(tempDir, "out1.srt");
      fs.writeFileSync(file1, "existing srt content");

      const res = await ensureWritableTargets([file1], {
        isInteractive: true,
        promptFn: async () => "y",
      });

      expect(res.proceed).toBe(true);
      expect(res.existingFiles).toEqual([file1]);
      expect(res.backedUp).toEqual([]);
    });

    it("should prompt user when interactive and cancel when declined", async () => {
      const file1 = path.join(tempDir, "out1.srt");
      fs.writeFileSync(file1, "existing srt content");

      const res = await ensureWritableTargets([file1], {
        isInteractive: true,
        promptFn: async () => "n",
      });

      expect(res.proceed).toBe(false);
      expect(res.existingFiles).toEqual([file1]);
      expect(res.backedUp).toEqual([]);
    });

    it("should throw an error in non-interactive mode without overwrite/backup", async () => {
      const file1 = path.join(tempDir, "out1.srt");
      fs.writeFileSync(file1, "existing srt content");

      await expect(
        ensureWritableTargets([file1], {
          isInteractive: false,
        }),
      ).rejects.toThrow(/出力先ファイルが既に存在します/);
    });
  });
});
