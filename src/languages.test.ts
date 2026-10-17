import { describe, expect, it } from "vitest";
import { getLanguageDisplayName, parseTargetLanguages, toIso6392 } from "./languages.js";

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

  describe("toIso6392", () => {
    it("should map standard 2-letter codes to ISO 639-2 (3-letter) codes", () => {
      expect(toIso6392("ja")).toBe("jpn");
      expect(toIso6392("en")).toBe("eng");
      expect(toIso6392("zh")).toBe("chi");
      expect(toIso6392("ko")).toBe("kor");
      expect(toIso6392("fr")).toBe("fra");
      expect(toIso6392("de")).toBe("deu");
      expect(toIso6392("es")).toBe("spa");
      expect(toIso6392("it")).toBe("ita");
      expect(toIso6392("ru")).toBe("rus");
      expect(toIso6392("pt")).toBe("por");
    });

    it("should handle regional variants by mapping to base 639-2 code", () => {
      expect(toIso6392("zh-CN")).toBe("chi");
      expect(toIso6392("zh-tw")).toBe("chi");
      expect(toIso6392("pt-BR")).toBe("por");
      expect(toIso6392("es-419")).toBe("spa");
    });

    it("should return already 3-letter codes as lowercase", () => {
      expect(toIso6392("JPN")).toBe("jpn");
      expect(toIso6392("eng")).toBe("eng");
      expect(toIso6392("xyz")).toBe("xyz");
    });
  });

  describe("getLanguageDisplayName", () => {
    it("should return display names for known language codes", () => {
      expect(getLanguageDisplayName("ja")).toBe("Japanese");
      expect(getLanguageDisplayName("en")).toBe("English");
      expect(getLanguageDisplayName("zh-CN")).toBe("Chinese (Simplified)");
      expect(getLanguageDisplayName("zh-TW")).toBe("Chinese (Traditional)");
      expect(getLanguageDisplayName("ko")).toBe("Korean");
      expect(getLanguageDisplayName("fr")).toBe("French");
    });

    it("should fallback to base language display name or uppercase code", () => {
      expect(getLanguageDisplayName("fr-CA")).toBe("French");
      expect(getLanguageDisplayName("xyz")).toBe("XYZ");
    });
  });
});
