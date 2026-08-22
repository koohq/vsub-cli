import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { computeFileSha256, getDefaultBinaryName, parseBuildArgs } from "./build-binary.js";

describe("build-binary", () => {
  describe("getDefaultBinaryName", () => {
    it("should resolve Windows x64 binary name", () => {
      expect(getDefaultBinaryName("win32", "x64")).toBe("vsub-windows-x64.exe");
    });

    it("should resolve Windows arm64 binary name", () => {
      expect(getDefaultBinaryName("win32", "arm64")).toBe("vsub-windows-arm64.exe");
    });

    it("should resolve Linux x64 binary name", () => {
      expect(getDefaultBinaryName("linux", "x64")).toBe("vsub-linux-x64");
    });

    it("should resolve Linux arm64 binary name", () => {
      expect(getDefaultBinaryName("linux", "arm64")).toBe("vsub-linux-arm64");
    });

    it("should resolve macOS arm64 binary name", () => {
      expect(getDefaultBinaryName("darwin", "arm64")).toBe("vsub-macos-arm64");
    });

    it("should resolve macOS x64 binary name", () => {
      expect(getDefaultBinaryName("darwin", "x64")).toBe("vsub-macos-x64");
    });
  });

  describe("parseBuildArgs", () => {
    it("should parse bundle-only flag", () => {
      const opts = parseBuildArgs(["--bundle-only"]);
      expect(opts.bundleOnly).toBe(true);
    });

    it("should parse name, output-dir, checksum, and skip-test flags", () => {
      const opts = parseBuildArgs([
        "--name",
        "custom-vsub.exe",
        "--output-dir",
        "./out",
        "--checksum",
        "--skip-test",
      ]);
      expect(opts.name).toBe("custom-vsub.exe");
      expect(opts.outputDir).toBe("./out");
      expect(opts.checksum).toBe(true);
      expect(opts.skipTest).toBe(true);
    });

    it("should handle empty args", () => {
      const opts = parseBuildArgs([]);
      expect(opts.bundleOnly).toBeUndefined();
      expect(opts.name).toBeUndefined();
    });
  });

  describe("computeFileSha256", () => {
    it("should compute accurate sha256 of a file", () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vsub-sha-test-"));
      const filePath = path.join(tempDir, "test.txt");
      fs.writeFileSync(filePath, "hello world", "utf-8");

      const hash = computeFileSha256(filePath);
      // SHA-256 of "hello world" is b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9
      expect(hash).toBe("b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9");

      fs.rmSync(tempDir, { recursive: true, force: true });
    });
  });
});
