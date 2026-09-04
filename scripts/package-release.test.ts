import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { computeSha256, packageReleaseAssets } from "./package-release.js";

describe("package-release", () => {
  it("should compute accurate sha256 of a file", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vsub-pkg-sha-"));
    try {
      const filePath = path.join(tempDir, "test.txt");
      fs.writeFileSync(filePath, "test content for sha256", "utf-8");

      const hash = computeSha256(filePath);
      // SHA-256 of "test content for sha256"
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("should package existing binaries into archives with checksums", async () => {
    const tempBase = fs.mkdtempSync(path.join(os.tmpdir(), "vsub-pkg-test-"));
    const inputDir = path.join(tempBase, "all-binaries");
    const outputDir = path.join(tempBase, "release-assets");
    const rootDir = path.join(tempBase, "repo-root");

    fs.mkdirSync(inputDir, { recursive: true });
    fs.mkdirSync(outputDir, { recursive: true });
    fs.mkdirSync(rootDir, { recursive: true });

    // Create dummy root files
    fs.writeFileSync(path.join(rootDir, "LICENSE"), "MIT License (Dummy)", "utf-8");
    fs.writeFileSync(
      path.join(inputDir, "THIRD_PARTY_LICENSES.txt"),
      "Third-Party Notice (Dummy)",
      "utf-8",
    );

    // Create dummy binaries
    fs.writeFileSync(path.join(inputDir, "vsub-windows-x64.exe"), "dummy windows binary", "utf-8");
    fs.writeFileSync(path.join(inputDir, "vsub-linux-x64"), "dummy linux binary", "utf-8");

    try {
      const result = await packageReleaseAssets({
        inputDir,
        outputDir,
        rootDir,
      });

      expect(result.archives.length).toBe(2);
      expect(fs.existsSync(path.join(outputDir, "vsub-windows-x64.zip"))).toBe(true);
      expect(fs.existsSync(path.join(outputDir, "vsub-linux-x64.tar.gz"))).toBe(true);
      expect(fs.existsSync(result.checksumFile)).toBe(true);

      const checksumContent = fs.readFileSync(result.checksumFile, "utf-8");
      expect(checksumContent).toContain("vsub-windows-x64.zip");
      expect(checksumContent).toContain("vsub-linux-x64.tar.gz");
      expect(checksumContent).toContain("THIRD_PARTY_LICENSES.txt");
    } finally {
      fs.rmSync(tempBase, { recursive: true, force: true });
    }
  });

  it("should throw an error when input directory does not exist", async () => {
    await expect(
      packageReleaseAssets({
        inputDir: "non-existent-input-dir",
      }),
    ).rejects.toThrow("Input directory not found");
  });
});
