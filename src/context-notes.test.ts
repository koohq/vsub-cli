import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeContextHash, resolveContextNotes } from "./context-notes.js";

describe("context notes", () => {
  let tempDir: string;
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vsub-context-test-"));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it.each([undefined, "", " \n "])("ignores empty input %j", (input) => {
    expect(resolveContextNotes(input)).toBeUndefined();
  });

  it("trims inline notes and treats missing paths and directories as text", () => {
    for (const input of ["Alex manages the shop.", "./missing-notes.txt", tempDir]) {
      expect(resolveContextNotes(` ${input} `)).toEqual({ text: input, source: "inline" });
    }
  });

  it.each(["\uFEFF  Alex manages the shop.\n", "", "\uFEFF \n"])(
    "reads UTF-8 notes, removing BOM and whitespace (%j)",
    (contents) => {
      const file = path.join(tempDir, "cast.txt");
      fs.writeFileSync(file, contents, "utf-8");
      const result = resolveContextNotes(` ${path.relative(process.cwd(), file)} `);
      expect(result).toEqual(
        contents.trim()
          ? {
              text: "Alex manages the shop.",
              source: "file",
              fileName: "cast.txt",
            }
          : undefined,
      );
    },
  );

  it.each([
    ["en", 'Failed to read the context file "cast.txt": denied'],
    ["ja", "背景メモのファイル「cast.txt」を読めませんでした: denied"],
  ])("localizes read failures (%s)", (lang, message) => {
    const file = path.join(tempDir, "cast.txt");
    fs.writeFileSync(file, "notes");
    vi.spyOn(fs, "readFileSync").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(() => resolveContextNotes(file, lang)).toThrow(message);
  });

  it("hashes the resolved content identically for inline and file notes", () => {
    const file = path.join(tempDir, "cast.txt");
    fs.writeFileSync(file, "\uFEFF notes \n");
    const text = resolveContextNotes(file)?.text ?? "";
    expect(computeContextHash(text)).toBe(computeContextHash("notes"));
    expect(computeContextHash(text)).toBe(
      crypto.createHash("sha256").update("notes").digest("hex"),
    );
    expect(computeContextHash(text)).not.toBe(computeContextHash("other notes"));
  });
});
