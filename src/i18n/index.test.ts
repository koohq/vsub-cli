import { describe, expect, it } from "vitest";
import { en } from "./en.js";
import {
  DEFAULT_LANGUAGE,
  SUPPORTED_LANGUAGES,
  getI18n,
  normalizeLanguage,
  resolveLanguage,
} from "./index.js";
import { ja } from "./ja.js";

describe("i18n module", () => {
  describe("normalizeLanguage", () => {
    it("should return undefined for undefined or empty string", () => {
      expect(normalizeLanguage(undefined)).toBeUndefined();
      expect(normalizeLanguage("")).toBeUndefined();
      expect(normalizeLanguage("   ")).toBeUndefined();
    });

    it("should normalize English variations", () => {
      expect(normalizeLanguage("en")).toBe("en");
      expect(normalizeLanguage("EN")).toBe("en");
      expect(normalizeLanguage("en-US")).toBe("en");
      expect(normalizeLanguage("en_GB")).toBe("en");
    });

    it("should normalize Japanese variations", () => {
      expect(normalizeLanguage("ja")).toBe("ja");
      expect(normalizeLanguage("JA")).toBe("ja");
      expect(normalizeLanguage("ja-JP")).toBe("ja");
      expect(normalizeLanguage("ja_JP")).toBe("ja");
    });

    it("should return undefined for unsupported languages", () => {
      expect(normalizeLanguage("fr")).toBeUndefined();
      expect(normalizeLanguage("zh")).toBeUndefined();
      expect(normalizeLanguage("es")).toBeUndefined();
    });
  });

  describe("resolveLanguage", () => {
    it("should prioritize CLI language above all", () => {
      expect(resolveLanguage("ja", "en", "en")).toBe("ja");
      expect(resolveLanguage("en", "ja", "ja")).toBe("en");
    });

    it("should fall back to env language when CLI is not specified", () => {
      expect(resolveLanguage(undefined, "ja", "en")).toBe("ja");
      expect(resolveLanguage("", "en", "ja")).toBe("en");
    });

    it("should fall back to config language when CLI and env are not specified", () => {
      expect(resolveLanguage(undefined, undefined, "ja")).toBe("ja");
      expect(resolveLanguage(undefined, "", "en")).toBe("en");
    });

    it("should fall back to DEFAULT_LANGUAGE (en) when nothing matches", () => {
      expect(resolveLanguage(undefined, undefined, undefined)).toBe(DEFAULT_LANGUAGE);
      expect(resolveLanguage("invalid", "invalid", "invalid")).toBe("en");
    });
  });

  describe("getI18n", () => {
    it("should return English messages by default", () => {
      const messages = getI18n();
      expect(messages.summary.title).toBe(en.summary.title);
      expect(messages.summary.title).toContain("Processing Summary");
    });

    it("should return Japanese messages when requested", () => {
      const messages = getI18n("ja");
      expect(messages.summary.title).toBe(ja.summary.title);
      expect(messages.summary.title).toContain("処理サマリー");
    });

    it("should fall back to English for unknown language code", () => {
      const messages = getI18n("fr");
      expect(messages.summary.title).toBe(en.summary.title);
    });
  });

  describe("dictionary integrity", () => {
    it("should define en and ja in supported languages", () => {
      expect(SUPPORTED_LANGUAGES).toEqual(["en", "ja"]);
    });

    it("should have matching keys between en and ja", () => {
      const enKeys = Object.keys(en).sort();
      const jaKeys = Object.keys(ja).sort();
      expect(jaKeys).toEqual(enKeys);

      for (const section of enKeys) {
        const enSection = en[section as keyof typeof en];
        const jaSection = ja[section as keyof typeof ja];
        expect(Object.keys(jaSection).sort()).toEqual(Object.keys(enSection).sort());
      }
    });
  });
});
