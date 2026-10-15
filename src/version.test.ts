import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_APP_VERSION, getCurrentVersion, resetCachedVersion } from "./version.js";

describe("version.ts", () => {
  const originalEnv = { ...process.env };
  const originalGlobal = globalThis.__VSUB_VERSION__;

  beforeEach(() => {
    resetCachedVersion();
    process.env = { ...originalEnv };
    delete process.env["VSUB_VERSION"];
    globalThis.__VSUB_VERSION__ = undefined;
  });

  afterEach(() => {
    resetCachedVersion();
    process.env = originalEnv;
    globalThis.__VSUB_VERSION__ = originalGlobal;
  });

  it("should return version from globalThis.__VSUB_VERSION__ if present", () => {
    globalThis.__VSUB_VERSION__ = "2.0.0-sea";
    expect(getCurrentVersion()).toBe("2.0.0-sea");
  });

  it("should return version from process.env.VSUB_VERSION if global is not set", () => {
    process.env["VSUB_VERSION"] = "3.1.4";
    expect(getCurrentVersion()).toBe("3.1.4");
  });

  it("should read version from package.json or fallback to DEFAULT_APP_VERSION", () => {
    const version = getCurrentVersion();
    expect(version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("should fallback to DEFAULT_APP_VERSION if package.json read throws", () => {
    const spy = vi.spyOn(fs, "existsSync").mockImplementation(() => {
      throw new Error("FS restricted");
    });

    try {
      expect(getCurrentVersion()).toBe(DEFAULT_APP_VERSION);
    } finally {
      spy.mockRestore();
    }
  });
});
