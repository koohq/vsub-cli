import { describe, expect, it } from "vitest";
import { parseTargetLanguages } from "./languages.js";

describe("languages.ts", () => {
  describe("parseTargetLanguages", () => {
    it("should return default ['ja'] when input is undefined or empty", () => {
      expect(parseTargetLanguages()).toEqual(["ja"]);
      expect(parseTargetLanguages("")).toEqual(["ja"]);
      expect(parseTargetLanguages("   ")).toEqual(["ja"]);
    });

    it("should parse single language code and normalize to lowercase", () => {
      expect(parseTargetLanguages("en")).toEqual(["en"]);
      expect(parseTargetLanguages("JA")).toEqual(["ja"]);
      expect(parseTargetLanguages("  es  ")).toEqual(["es"]);
    });

    it("should parse comma-separated multiple language codes", () => {
      expect(parseTargetLanguages("ja,en,zh")).toEqual(["ja", "en", "zh"]);
      expect(parseTargetLanguages("ja, en, es, fr")).toEqual(["ja", "en", "es", "fr"]);
    });

    it("should handle regional BCP-47 language tags", () => {
      expect(parseTargetLanguages("zh-CN, zh-TW, pt-BR, es-419")).toEqual([
        "zh-cn",
        "zh-tw",
        "pt-br",
        "es-419",
      ]);
    });

    it("should deduplicate repetitive language codes while maintaining order", () => {
      expect(parseTargetLanguages("ja,en,JA,En,zh,ja")).toEqual(["ja", "en", "zh"]);
    });

    it("should throw an error on invalid language codes", () => {
      expect(() => parseTargetLanguages("ja,invalid_lang!")).toThrow(
        /無効なターゲット言語コードです/,
      );
      expect(() => parseTargetLanguages("ja,12345")).toThrow(/無効なターゲット言語コードです/);
      expect(() => parseTargetLanguages("ja/en")).toThrow(/無効なターゲット言語コードです/);
    });
  });
});
