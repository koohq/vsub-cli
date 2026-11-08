import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { generateLicenseFiles, writeLicensesDataModule } from "./generate-licenses.js";
import { prepareBuild } from "./prepare-build.js";

let rootDir: string;

function writeFile(relPath: string, content: string): void {
  const filePath = path.join(rootDir, relPath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf-8");
}

function setupProject(): void {
  rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "vsub-prepare-build-"));
  writeFile(
    "package.json",
    JSON.stringify({ name: "dummy", dependencies: { "dummy-dep": "^1.0.0" } }),
  );
  writeFile(
    "node_modules/dummy-dep/package.json",
    JSON.stringify({
      name: "dummy-dep",
      version: "1.2.3",
      license: "MIT",
      repository: "https://example.com/dummy-dep.git",
    }),
  );
  writeFile("node_modules/dummy-dep/LICENSE", "Dummy license text");
  fs.mkdirSync(path.join(rootDir, "src"), { recursive: true });
}

function readData(): string {
  return fs.readFileSync(path.join(rootDir, "src", "licenses.data.ts"), "utf-8");
}

function runQuietly(fn: () => void): void {
  const spy = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    fn();
  } finally {
    spy.mockRestore();
  }
}

afterEach(() => {
  fs.rmSync(rootDir, { recursive: true, force: true });
});

describe("prepareBuild", () => {
  it("removes the whole dist directory", () => {
    setupProject();
    writeFile("dist/stale.test.js", "x");
    writeFile("dist/sub/old.js", "x");
    runQuietly(() => prepareBuild(rootDir));
    expect(fs.existsSync(path.join(rootDir, "dist"))).toBe(false);
  });

  it("does not write THIRD_PARTY_LICENSES.txt", () => {
    setupProject();
    runQuietly(() => prepareBuild(rootDir));
    expect(fs.existsSync(path.join(rootDir, "dist", "THIRD_PARTY_LICENSES.txt"))).toBe(false);
  });

  it("regenerates src/licenses.data.ts deterministically", () => {
    setupProject();
    runQuietly(() => prepareBuild(rootDir));
    const first = readData();
    expect(first).toContain("dummy-dep");
    expect(first).toContain("1.2.3");
    runQuietly(() => prepareBuild(rootDir));
    expect(readData()).toBe(first);
  });

  it("does not embed local paths or the user name", () => {
    setupProject();
    runQuietly(() => prepareBuild(rootDir));
    const data = readData();
    expect(data).not.toContain(rootDir.replaceAll("\\", "/"));
    expect(data).not.toContain(rootDir.replaceAll("/", "\\"));
    const username = os.userInfo().username;
    if (username.length > 3) {
      expect(data).not.toContain(username);
    }
  });

  it("matches the data written by generateLicenseFiles", () => {
    setupProject();
    runQuietly(() => generateLicenseFiles(rootDir));
    const fromGenerate = readData();
    expect(fs.existsSync(path.join(rootDir, "dist", "THIRD_PARTY_LICENSES.txt"))).toBe(true);
    fs.rmSync(path.join(rootDir, "src", "licenses.data.ts"));
    writeLicensesDataModule(rootDir);
    expect(readData()).toBe(fromGenerate);
  });
});
