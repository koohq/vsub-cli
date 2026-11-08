import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getCacheDir } from "../cache.js";
import { DEFAULT_GEMINI_MODEL, getConfig, getGlobalConfigPath } from "../config.js";
import { ENV_VARS_TO_CLEAR, isolateConfigAndEnv } from "./isolate-config-env.js";

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
