import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { tarHandler, failingTar } = vi.hoisted(() => {
  type TarHandler = (cmd: string, args: readonly string[]) => Promise<unknown> | unknown;
  const failingTar: TarHandler = () => {
    throw new Error("Simulated tar failure");
  };
  return { tarHandler: { current: failingTar }, failingTar };
});

vi.mock("execa", async (importOriginal) => {
  const mod = await importOriginal<typeof import("execa")>();
  return {
    ...mod,
    execa: vi.fn(async (...args: Parameters<typeof mod.execa>) => {
      if (args[0] === "tar") {
        return tarHandler.current(args[0], (args[1] ?? []) as readonly string[]);
      }
      return mod.execa(...args);
    }),
  };
});

import { resolveTarCommand } from "../scripts/package-release.js";
import { REAL_PROCESS_TEST_TIMEOUT_MS } from "./test-support/real-process-timeout.js";
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
      tarHandler.current = failingTar;
    });

    async function createSpecialZipFixture() {
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

      return { specialDir, specialZipPath };
    }

    it(
      "should successfully extract archive using PowerShell Expand-Archive in path with quotes and brackets",
      async () => {
        const { specialDir, specialZipPath } = await createSpecialZipFixture();

        // Extract archive using Expand-Archive fallback
        const destDir = path.join(specialDir, "extracted");
        const extractedBinary = await extractArchive(specialZipPath, destDir, "win32");

        expect(fs.existsSync(extractedBinary)).toBe(true);
        expect(fs.readFileSync(extractedBinary, "utf-8")).toBe("dummy vsub executable content");
      },
      REAL_PROCESS_TEST_TIMEOUT_MS,
    );

    it(
      "should successfully extract archive using PowerShell Expand-Archive when tar fails after writing partial files",
      async () => {
        tarHandler.current = (_cmd, args) => {
          const cIndex = args.indexOf("-C");
          const targetDir = cIndex !== -1 ? args[cIndex + 1] : undefined;
          if (targetDir !== undefined) {
            fs.mkdirSync(targetDir, { recursive: true });
            fs.writeFileSync(path.join(targetDir, "vsub.exe"), "partial binary from tar");
            fs.writeFileSync(path.join(targetDir, "leftover.txt"), "leftover junk from tar");
          }
          throw new Error("Simulated tar failure mid-extraction");
        };

        const { specialDir, specialZipPath } = await createSpecialZipFixture();

        const destDir = path.join(specialDir, "extracted");
        const extractedBinary = await extractArchive(specialZipPath, destDir, "win32");

        expect(fs.existsSync(extractedBinary)).toBe(true);
        expect(fs.readFileSync(extractedBinary, "utf-8")).toBe("dummy vsub executable content");
        expect(fs.readdirSync(destDir)).toEqual(["vsub.exe"]);
      },
      REAL_PROCESS_TEST_TIMEOUT_MS,
    );
  },
);
