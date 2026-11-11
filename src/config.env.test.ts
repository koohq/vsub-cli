import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadEnv } from "./config.js";

const DOTENV_ENV_VARS = [
  "DOTENV_QUIET",
  "DOTENV_CONFIG_QUIET",
  "DOTENV_DEBUG",
  "DOTENV_CONFIG_DEBUG",
  "DOTENV_PATH",
  "DOTENV_CONFIG_PATH",
] as const;

const DUMMY_ENV_KEY = "VSUB_T021_DUMMY";
const DUMMY_ENV_VALUE = "dummy_value";

describe("loadEnv quiet behaviour", () => {
  let tmpDir: string;
  let savedEnv: Record<string, string | undefined>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vsub-config-env-"));
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    savedEnv = {};
    for (const key of DOTENV_ENV_VARS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    savedEnv[DUMMY_ENV_KEY] = process.env[DUMMY_ENV_KEY];
    delete process.env[DUMMY_ENV_KEY];
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();

    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it("does not load .env from parent directories", () => {
    const parentDir = path.join(tmpDir, "parent");
    const childDir = path.join(parentDir, "child");
    fs.mkdirSync(childDir, { recursive: true });
    fs.writeFileSync(path.join(parentDir, ".env"), `${DUMMY_ENV_KEY}=${DUMMY_ENV_VALUE}\n`);

    loadEnv(childDir);

    expect(process.env[DUMMY_ENV_KEY]).toBeUndefined();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("loads only the start directory .env without logging to console.error", () => {
    fs.writeFileSync(path.join(tmpDir, ".env"), `${DUMMY_ENV_KEY}=${DUMMY_ENV_VALUE}\n`);
    loadEnv(tmpDir);
    expect(process.env[DUMMY_ENV_KEY]).toBe(DUMMY_ENV_VALUE);
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("does not log to console.error when no .env is found anywhere", () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(false);

    loadEnv(tmpDir);

    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });
});
