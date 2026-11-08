import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("execa", async (importOriginal) => {
  const mod = await importOriginal<typeof import("execa")>();
  return {
    ...mod,
    execa: vi.fn(async (...args: Parameters<typeof mod.execa>) => {
      if (args[0] === "tar") {
        throw new Error("Simulated tar failure");
      }
      return mod.execa(...args);
    }),
  };
});

import { resolveTarCommand } from "../scripts/package-release.js";
import { extractArchive } from "./updater.js";

describe.skipIf(process.platform !== "win32")(
  "extractArchive with real PowerShell Expand-Archive",
  () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vsub-ps-test-"));
    });

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
      vi.restoreAllMocks();
    });

    it("should successfully extract archive using PowerShell Expand-Archive in path with quotes and brackets", async () => {
      const { execa: realExeca } = await vi.importActual<typeof import("execa")>("execa");

      // 1. Create dummy binary in a clean folder
      const cleanDir = path.join(tempDir, "clean");
      fs.mkdirSync(cleanDir, { recursive: true });
      const dummyExePath = path.join(cleanDir, "vsub.exe");
      fs.writeFileSync(dummyExePath, "dummy vsub executable content");

      // 2. Create zip archive using real execa tar (-a -cf)
      const cleanZipPath = path.join(cleanDir, "archive.zip");
      await realExeca(resolveTarCommand(), ["-a", "-cf", cleanZipPath, "-C", cleanDir, "vsub.exe"]);
      expect(fs.existsSync(cleanZipPath)).toBe(true);

      // 3. Move zip archive to a folder with single quotes, brackets, and spaces
      const specialDir = path.join(tempDir, "it's [1] dir");
      fs.mkdirSync(specialDir, { recursive: true });
      const specialZipPath = path.join(specialDir, "target.zip");
      fs.copyFileSync(cleanZipPath, specialZipPath);

      // 4. Extract archive using Expand-Archive fallback
      const destDir = path.join(specialDir, "extracted");
      const extractedBinary = await extractArchive(specialZipPath, destDir, "win32");

      expect(fs.existsSync(extractedBinary)).toBe(true);
      expect(fs.readFileSync(extractedBinary, "utf-8")).toBe("dummy vsub executable content");
    }, 30000);
  },
);
