import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getGlobalConfigDir, getGlobalConfigPath, saveGlobalConfig } from "./config.js";

const ENV_KEYS = ["APPDATA", "XDG_CONFIG_HOME"] as const;
const DUMMY_KEY = "dummy-groq-key";

let tmpRoot: string;
let configHome: string;
let savedEnv: Record<string, string | undefined>;
let originalPlatform: PropertyDescriptor | undefined;

/** Creates the parent config home with the given mode and returns the vsub directory path. */
function prepareConfigHome(mode = 0o755): string {
  fs.mkdirSync(configHome, { recursive: true });
  fs.chmodSync(configHome, mode);
  return getGlobalConfigDir();
}

/** Creates the vsub directory and writes an existing config.json into it. */
function placeConfig(content: string, dirMode = 0o755, fileMode = 0o644): string {
  const dir = prepareConfigHome();
  fs.mkdirSync(dir);
  fs.chmodSync(dir, dirMode);
  const configPath = getGlobalConfigPath();
  fs.writeFileSync(configPath, content, { mode: fileMode });
  fs.chmodSync(configPath, fileMode);
  return configPath;
}

function mode(p: string): number {
  return fs.statSync(p).mode & 0o777;
}

function errorWithCode(code: string): Error {
  return Object.assign(new Error(`dummy ${code}`), { code });
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vsub-config-save-"));
  configHome = path.join(tmpRoot, "config-home");
  savedEnv = {};
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    process.env[key] = configHome;
  }
  originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");
});

afterEach(() => {
  vi.restoreAllMocks();
  if (originalPlatform) Object.defineProperty(process, "platform", originalPlatform);
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe.skipIf(process.platform === "win32")("saveGlobalConfig permissions (Unix)", () => {
  it("creates the vsub directory as 700 and config.json as 600, leaving the parent alone", () => {
    prepareConfigHome(0o755);
    saveGlobalConfig({ geminiModel: "dummy-model" });
    expect(mode(getGlobalConfigDir())).toBe(0o700);
    expect(mode(getGlobalConfigPath())).toBe(0o600);
    expect(mode(configHome)).toBe(0o755);
  });

  it("tightens an existing 755 directory and 644 file while merging values", () => {
    const configPath = placeConfig(JSON.stringify({ groqApiKey: DUMMY_KEY }));
    saveGlobalConfig({ geminiModel: "dummy-model" });
    expect(mode(getGlobalConfigDir())).toBe(0o700);
    expect(mode(configPath)).toBe(0o600);
    expect(JSON.parse(fs.readFileSync(configPath, "utf-8"))).toEqual({
      groqApiKey: DUMMY_KEY,
      geminiModel: "dummy-model",
    });
  });

  it("warns but still saves when chmod of the directory fails", () => {
    prepareConfigHome();
    vi.spyOn(fs, "chmodSync").mockImplementation(() => {
      throw errorWithCode("EPERM");
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    saveGlobalConfig({ geminiModel: "dummy-model" });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const message = String(warnSpy.mock.calls[0]?.[0]);
    expect(message).toContain(getGlobalConfigDir());
    expect(message).toContain("EPERM");
    expect(mode(getGlobalConfigPath())).toBe(0o600);
  });

  it("keeps a symlinked config.json as a link and updates its target with 600", () => {
    const dir = prepareConfigHome();
    fs.mkdirSync(dir);
    const dotfilesDir = path.join(tmpRoot, "dotfiles");
    fs.mkdirSync(dotfilesDir);
    const target = path.join(dotfilesDir, "config.json");
    fs.writeFileSync(target, JSON.stringify({ groqApiKey: DUMMY_KEY }), { mode: 0o644 });
    fs.chmodSync(target, 0o644);
    fs.symlinkSync(target, getGlobalConfigPath());

    saveGlobalConfig({ geminiModel: "dummy-model" });

    expect(fs.lstatSync(getGlobalConfigPath()).isSymbolicLink()).toBe(true);
    expect(JSON.parse(fs.readFileSync(target, "utf-8"))).toEqual({
      groqApiKey: DUMMY_KEY,
      geminiModel: "dummy-model",
    });
    expect(mode(target)).toBe(0o600);
    expect(fs.readdirSync(dotfilesDir)).toEqual(["config.json"]);
  });
});

describe("saveGlobalConfig file handling", () => {
  it("leaves no temporary files after repeated saves", () => {
    saveGlobalConfig({ geminiModel: "dummy-model" });
    saveGlobalConfig({ groqModel: "dummy-groq" });
    expect(fs.readdirSync(getGlobalConfigDir())).toEqual(["config.json"]);
  });

  it.each([
    ["renameSync", "EPERM"],
    ["writeFileSync", "ENOSPC"],
  ] as const)("keeps config.json intact and cleans up when %s fails", (method, code) => {
    const original = JSON.stringify({ groqApiKey: DUMMY_KEY });
    const configPath = placeConfig(original);
    if (method === "renameSync") {
      vi.spyOn(fs, "renameSync").mockImplementation(() => {
        throw errorWithCode(code);
      });
    } else {
      const realWrite = fs.writeFileSync;
      vi.spyOn(fs, "writeFileSync").mockImplementation(((
        file: fs.PathOrFileDescriptor,
        ...rest: unknown[]
      ) => {
        if (file !== configPath) throw errorWithCode(code);
        return (realWrite as (...args: unknown[]) => void)(file, ...rest);
      }) as typeof fs.writeFileSync);
    }

    expect(() => saveGlobalConfig({ geminiModel: "dummy-model" })).toThrow(code);
    vi.restoreAllMocks();
    expect(fs.readFileSync(configPath, "utf-8")).toBe(original);
    expect(fs.readdirSync(getGlobalConfigDir())).toEqual(["config.json"]);
  });

  it("does not call chmodSync on win32", () => {
    Object.defineProperty(process, "platform", { value: "win32" });
    const chmodSpy = vi.spyOn(fs, "chmodSync");
    process.env["APPDATA"] = configHome;
    saveGlobalConfig({ geminiModel: "dummy-model" });
    expect(chmodSpy).not.toHaveBeenCalled();
    expect(fs.existsSync(getGlobalConfigPath())).toBe(true);
  });

  it.each([
    ["trailing comma JSON", `{ "groqApiKey": "${DUMMY_KEY}", }`, undefined, /could not be read/],
    ["null", "null", undefined, /could not be read/],
    ["array", "[]", undefined, /could not be read/],
    ["string", '"text"', undefined, /could not be read/],
    ["Japanese message", "null", "ja", /読み込めませんでした/],
  ] as const)("refuses to overwrite a broken config.json (%s)", (_name, content, lang, pattern) => {
    const configPath = placeConfig(content);
    const before = fs.readFileSync(configPath);
    let thrown: unknown;
    try {
      saveGlobalConfig({ geminiModel: "dummy-model" }, lang ? { lang } : {});
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toMatch(pattern);
    expect((thrown as Error).message).toContain(configPath);
    expect(fs.readFileSync(configPath).equals(before)).toBe(true);
    expect(fs.readdirSync(getGlobalConfigDir())).toEqual(["config.json"]);
  });

  it("still saves when config.json does not exist", () => {
    saveGlobalConfig({ geminiModel: "dummy-model" });
    expect(JSON.parse(fs.readFileSync(getGlobalConfigPath(), "utf-8"))).toEqual({
      geminiModel: "dummy-model",
    });
  });
});
