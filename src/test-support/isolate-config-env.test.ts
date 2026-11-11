import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getCacheDir } from "../cache.js";
import { DEFAULT_GEMINI_MODEL, getConfig, getGlobalConfigPath } from "../config.js";
import { ENV_VARS_TO_CLEAR, isolateConfigAndEnv } from "./isolate-config-env.js";

const SRC_DIR = path.resolve(import.meta.dirname, "..");

/** Variables read by src that are deliberately not in ENV_VARS_TO_CLEAR, with the reason. */
const ENV_VARS_NOT_CLEARED: Record<string, string> = {
  VSUB_GROQ_API_KEY: "tests set a dummy value themselves",
  VSUB_GEMINI_API_KEY: "tests set a dummy value themselves",
  VSUB_CACHE_DIR: "isolateConfigAndEnv() points it at a temp dir",
  APPDATA: "isolateConfigAndEnv() points it at a temp dir",
  XDG_CONFIG_HOME: "isolateConfigAndEnv() points it at a temp dir",
  LOCALAPPDATA: "only read when VSUB_CACHE_DIR is unset, which isolation prevents",
  XDG_CACHE_HOME: "only read when VSUB_CACHE_DIR is unset, which isolation prevents",
  VSUB_VERSION: "not a config value; version.test.ts handles it itself",
};

function collectEnvVarsReadBySrc(): string[] {
  const names = new Set<string>();
  const sep = path.sep;
  for (const rel of fs.readdirSync(SRC_DIR, { recursive: true, encoding: "utf8" })) {
    if (!rel.endsWith(".ts") || rel.endsWith(".test.ts")) continue;
    if (rel.startsWith(`test-support${sep}`)) continue;
    const source = fs.readFileSync(path.join(SRC_DIR, rel), "utf8");
    for (const match of source.matchAll(/process\.env\["([A-Z0-9_]+)"\]/g)) {
      names.add(match[1] as string);
    }
  }
  return [...names].sort();
}

describe("ENV_VARS_TO_CLEAR coverage", () => {
  const readBySrc = collectEnvVarsReadBySrc();
  const exceptions = Object.keys(ENV_VARS_NOT_CLEARED);

  it("finds environment variables read by src", () => {
    expect(readBySrc.length).toBeGreaterThan(0);
  });

  it("covers every variable read by src with the list or the exception table", () => {
    const missing = readBySrc.filter(
      (name) => !ENV_VARS_TO_CLEAR.includes(name) && !exceptions.includes(name),
    );
    expect(missing).toEqual([]);
  });

  it("lists only variables that src actually reads", () => {
    const unused = [...ENV_VARS_TO_CLEAR, ...exceptions].filter(
      (name) => !readBySrc.includes(name),
    );
    expect(unused).toEqual([]);
  });

  it("has no variable in both the list and the exception table", () => {
    const overlap = ENV_VARS_TO_CLEAR.filter((name) => exceptions.includes(name));
    expect(overlap).toEqual([]);
  });
});

describe("isolateConfigAndEnv", () => {
  const originalEnv = process.env;
  let tempDir: string;
  let configHome: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vsub-isolate-env-"));
    process.env = { ...originalEnv };
    for (const envVar of ENV_VARS_TO_CLEAR) {
      process.env[envVar] = `dummy-${envVar}`;
    }
    process.env["VSUB_GEMINI_API_KEY"] = "dummy-gemini-key";
    ({ configHome } = isolateConfigAndEnv(tempDir));
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("clears every config-related variable but keeps VSUB_GEMINI_API_KEY", () => {
    for (const envVar of ENV_VARS_TO_CLEAR) {
      expect(process.env[envVar]).toBeUndefined();
    }
    expect(process.env["VSUB_GEMINI_API_KEY"]).toBe("dummy-gemini-key");
  });

  it("points the global config path under configHome", () => {
    expect(getGlobalConfigPath().startsWith(configHome)).toBe(true);
  });

  it("points the cache dir to <configHome>/cache unless a dir is given", () => {
    const otherDir = path.join(tempDir, "other-cache");
    expect(getCacheDir()).toBe(path.join(configHome, "cache"));
    expect(getCacheDir(otherDir)).toBe(path.resolve(otherDir));
  });

  it("yields default config values", () => {
    const config = getConfig();
    expect(config.geminiModel).toBe(DEFAULT_GEMINI_MODEL);
    expect(config.whisperPrompt).toBeUndefined();
    expect(config.glossary).toBeUndefined();
    expect(config.targetLang).toBeUndefined();
  });
});
