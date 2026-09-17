import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  compareSemVer,
  determineNodeUpdate,
  type NodeRelease,
  parseSemVer,
  updateVersionFiles,
} from "./check-node-update.js";

describe("check-node-update", () => {
  describe("parseSemVer & compareSemVer", () => {
    it("parses valid version strings with or without v prefix", () => {
      expect(parseSemVer("v26.9.0")).toEqual({
        major: 26,
        minor: 9,
        patch: 0,
        raw: "26.9.0",
      });
      expect(parseSemVer("26.8.2")).toEqual({
        major: 26,
        minor: 8,
        patch: 2,
        raw: "26.8.2",
      });
    });

    it("throws on invalid version strings", () => {
      expect(() => parseSemVer("invalid")).toThrow();
      expect(() => parseSemVer("26.8")).toThrow();
    });

    it("compares semver correctly", () => {
      const v26_8_1 = parseSemVer("26.8.1");
      const v26_8_2 = parseSemVer("26.8.2");
      const v26_9_0 = parseSemVer("26.9.0");
      const v27_0_0 = parseSemVer("27.0.0");

      expect(compareSemVer(v26_8_2, v26_8_1)).toBeGreaterThan(0);
      expect(compareSemVer(v26_8_1, v26_8_2)).toBeLessThan(0);
      expect(compareSemVer(v26_8_2, v26_8_2)).toBe(0);
      expect(compareSemVer(v26_9_0, v26_8_2)).toBeGreaterThan(0);
      expect(compareSemVer(v27_0_0, v26_9_0)).toBeGreaterThan(0);
    });
  });

  describe("determineNodeUpdate", () => {
    const mockReleases: NodeRelease[] = [
      { version: "v26.9.0", date: "2026-09-16" },
      { version: "v26.8.2", date: "2026-09-09" },
      { version: "v26.8.1", date: "2026-08-26" },
      { version: "v26.8.0", date: "2026-08-26" },
    ];

    it("returns needsUpdate=false when already on latest version", () => {
      const res = determineNodeUpdate("26.9.0", mockReleases, {
        now: new Date("2026-09-17T00:00:00Z"),
      });
      expect(res.needsUpdate).toBe(false);
      expect(res.reason).toContain("Already on or ahead");
    });

    it("holds minor .0 release when within 7-day cooldown", () => {
      // 26.9.0 released 2026-09-16, checked 2026-09-17 (1 day elapsed)
      const res = determineNodeUpdate("26.8.2", mockReleases, {
        now: new Date("2026-09-17T00:00:00Z"),
      });
      expect(res.needsUpdate).toBe(false);
      expect(res.targetVersion).toBe("26.9.0");
      expect(res.reason).toContain("within cooldown");
      expect(res.reason).toContain("requires 7 days");
    });

    it("approves minor .0 release when 7-day cooldown passes", () => {
      // 26.9.0 released 2026-09-16, checked 2026-09-24 (8 days elapsed)
      const res = determineNodeUpdate("26.8.2", mockReleases, {
        now: new Date("2026-09-24T00:00:00Z"),
      });
      expect(res.needsUpdate).toBe(true);
      expect(res.targetVersion).toBe("26.9.0");
      expect(res.reason).toContain("passed 7-day cooldown");
    });

    it("bypasses cooldown when force=true", () => {
      const res = determineNodeUpdate("26.8.2", mockReleases, {
        now: new Date("2026-09-17T00:00:00Z"),
        force: true,
      });
      expect(res.needsUpdate).toBe(true);
      expect(res.targetVersion).toBe("26.9.0");
      expect(res.reason).toContain("forced by options");
    });

    it("handles patch updates with 3-day cooldown", () => {
      const patchReleases: NodeRelease[] = [
        { version: "v26.8.2", date: "2026-09-09" },
        { version: "v26.8.1", date: "2026-08-26" },
      ];

      // Checked 1 day after release -> hold
      const holdRes = determineNodeUpdate("26.8.1", patchReleases, {
        now: new Date("2026-09-10T00:00:00Z"),
      });
      expect(holdRes.needsUpdate).toBe(false);
      expect(holdRes.reason).toContain("requires 3 days");

      // Checked 4 days after release -> approve
      const passRes = determineNodeUpdate("26.8.1", patchReleases, {
        now: new Date("2026-09-13T00:00:00Z"),
      });
      expect(passRes.needsUpdate).toBe(true);
      expect(passRes.targetVersion).toBe("26.8.2");
      expect(passRes.reason).toContain("passed 3-day cooldown");
    });

    it("prioritizes .1 patch over .0 minor and applies patch cooldown", () => {
      const releasesWithPatch: NodeRelease[] = [
        { version: "v26.9.1", date: "2026-09-18" },
        { version: "v26.9.0", date: "2026-09-16" },
        { version: "v26.8.2", date: "2026-09-09" },
      ];

      // Checked 2026-09-22: 26.9.1 released 4 days ago -> meets 3-day patch cooldown
      const res = determineNodeUpdate("26.8.2", releasesWithPatch, {
        now: new Date("2026-09-22T00:00:00Z"),
      });
      expect(res.needsUpdate).toBe(true);
      expect(res.targetVersion).toBe("26.9.1");
      expect(res.reason).toContain("Patch release passed 3-day cooldown");
    });
  });

  describe("updateVersionFiles", () => {
    it("correctly writes new version to .node-version and mise.toml", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "node-update-test-"));
      try {
        const nodeVersionFile = path.join(tmpDir, ".node-version");
        const miseTomlFile = path.join(tmpDir, "mise.toml");

        fs.writeFileSync(nodeVersionFile, "26.8.2\n", "utf-8");
        fs.writeFileSync(miseTomlFile, '[tools]\nnode = "26.8.2"\npnpm = "latest"\n', "utf-8");

        updateVersionFiles(tmpDir, "26.9.0");

        expect(fs.readFileSync(nodeVersionFile, "utf-8").trim()).toBe("26.9.0");
        expect(fs.readFileSync(miseTomlFile, "utf-8")).toBe(
          '[tools]\nnode = "26.9.0"\npnpm = "latest"\n',
        );
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });
});
