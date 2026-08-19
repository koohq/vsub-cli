import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  computeGlossaryHash,
  extractWhisperPromptHints,
  formatGlossaryPrompt,
  parseGlossary,
  parseInlineGlossary,
  parseJsonGlossary,
} from "./glossary.js";

describe("glossary.ts", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vsub-glossary-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("parseInlineGlossary", () => {
    it("should return empty object for empty or whitespace string", () => {
      expect(parseInlineGlossary("")).toEqual({});
      expect(parseInlineGlossary("   ")).toEqual({});
    });

    it("should parse comma-separated key=value pairs", () => {
      const input =
        "Antigravity=アンチグラビティ, vsub=ブイサブ, Agentic AI = エージェンティックAI";
      expect(parseInlineGlossary(input)).toEqual({
        Antigravity: "アンチグラビティ",
        vsub: "ブイサブ",
        "Agentic AI": "エージェンティックAI",
      });
    });

    it("should parse colon-separated key: value pairs with newlines", () => {
      const input = "Antigravity: アンチグラビティ\nvsub: ブイサブ";
      expect(parseInlineGlossary(input)).toEqual({
        Antigravity: "アンチグラビティ",
        vsub: "ブイサブ",
      });
    });

    it("should ignore malformed tokens without separators", () => {
      const input = "Antigravity=アンチグラビティ, invalidEntry, vsub=ブイサブ";
      expect(parseInlineGlossary(input)).toEqual({
        Antigravity: "アンチグラビティ",
        vsub: "ブイサブ",
      });
    });
  });

  describe("parseJsonGlossary", () => {
    it("should parse flat dictionary schema", () => {
      const json = {
        Antigravity: "アンチグラビティ",
        vsub: "ブイサブ",
      };
      expect(parseJsonGlossary(json)).toEqual({
        Antigravity: "アンチグラビティ",
        vsub: "ブイサブ",
      });
    });

    it("should parse language-keyed schema for matching target language", () => {
      const json = {
        ja: {
          Antigravity: "アンチグラビティ",
          AI: "人工知能",
        },
        zh: {
          Antigravity: "反重力",
          AI: "人工智能",
        },
      };
      expect(parseJsonGlossary(json, "ja")).toEqual({
        Antigravity: "アンチグラビティ",
        AI: "人工知能",
      });
      expect(parseJsonGlossary(json, "ja-JP")).toEqual({
        Antigravity: "アンチグラビティ",
        AI: "人工知能",
      });
      expect(parseJsonGlossary(json, "zh")).toEqual({
        Antigravity: "反重力",
        AI: "人工智能",
      });
      expect(parseJsonGlossary(json, "fr")).toEqual({});
    });

    it("should parse term-keyed multi-language schema", () => {
      const json = {
        Antigravity: {
          ja: "アンチグラビティ",
          zh: "反重力",
        },
        Whisper: {
          ja: "ウィスパー",
          zh: "耳语",
        },
      };
      expect(parseJsonGlossary(json, "ja")).toEqual({
        Antigravity: "アンチグラビティ",
        Whisper: "ウィスパー",
      });
      expect(parseJsonGlossary(json, "zh")).toEqual({
        Antigravity: "反重力",
        Whisper: "耳语",
      });
    });
  });

  describe("parseGlossary", () => {
    it("should parse from a JSON file path", () => {
      const jsonFile = path.join(tempDir, "glossary.json");
      fs.writeFileSync(
        jsonFile,
        JSON.stringify({
          TermA: "訳語A",
          TermB: "訳語B",
        }),
        "utf-8",
      );

      expect(parseGlossary(jsonFile)).toEqual({
        TermA: "訳語A",
        TermB: "訳語B",
      });
    });

    it("should fallback to inline parsing if file does not exist", () => {
      const input = "TermA=訳語A, TermB=訳語B";
      expect(parseGlossary(input)).toEqual({
        TermA: "訳語A",
        TermB: "訳語B",
      });
    });

    it("should throw a clear error on invalid JSON file", () => {
      const brokenJson = path.join(tempDir, "broken.json");
      fs.writeFileSync(brokenJson, "{ invalid json", "utf-8");

      expect(() => parseGlossary(brokenJson)).toThrow(/Failed to parse glossary file/);
    });
  });

  describe("formatGlossaryPrompt", () => {
    it("should format glossary into bullet rules", () => {
      const glossary = {
        Antigravity: "アンチグラビティ",
        vsub: "ブイサブ",
      };
      const formatted = formatGlossaryPrompt(glossary);
      expect(formatted).toContain('- "Antigravity" -> "アンチグラビティ"');
      expect(formatted).toContain('- "vsub" -> "ブイサブ"');
    });

    it("should return empty string for empty glossary", () => {
      expect(formatGlossaryPrompt({})).toBe("");
    });
  });

  describe("extractWhisperPromptHints", () => {
    it("should extract comma-separated keys from glossary object", () => {
      const glossary = {
        Antigravity: "アンチグラビティ",
        vsub: "ブイサブ",
        Agentic: "エージェンティック",
      };
      expect(extractWhisperPromptHints(glossary)).toBe("Antigravity, vsub, Agentic");
    });

    it("should extract from inline string", () => {
      expect(extractWhisperPromptHints("Antigravity=アンチグラビティ, vsub=ブイサブ")).toBe(
        "Antigravity, vsub",
      );
    });
  });

  describe("computeGlossaryHash", () => {
    it("should return empty string for empty glossary", () => {
      expect(computeGlossaryHash({})).toBe("");
    });

    it("should generate deterministic hash independent of key insertion order", () => {
      const g1 = { A: "1", B: "2" };
      const g2 = { B: "2", A: "1" };
      expect(computeGlossaryHash(g1)).toBe(computeGlossaryHash(g2));
      expect(computeGlossaryHash(g1).length).toBeGreaterThan(0);
    });
  });
});
