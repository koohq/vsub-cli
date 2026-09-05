import { en } from "./en.js";
import { ja } from "./ja.js";

export type SupportedLanguage = "en" | "ja";

export const DEFAULT_LANGUAGE: SupportedLanguage = "en";
export const SUPPORTED_LANGUAGES: readonly SupportedLanguage[] = ["en", "ja"] as const;

export type I18nMessages = typeof en;

const DICTIONARIES: Record<SupportedLanguage, I18nMessages> = {
  en,
  ja,
};

/**
 * Normalizes input string to supported language code ("en" or "ja").
 * Returns undefined if input is empty or invalid.
 */
export function normalizeLanguage(input?: string): SupportedLanguage | undefined {
  if (!input) return undefined;
  const normalized = input.trim().toLowerCase();
  if (normalized === "ja" || normalized.startsWith("ja_") || normalized.startsWith("ja-")) {
    return "ja";
  }
  if (normalized === "en" || normalized.startsWith("en_") || normalized.startsWith("en-")) {
    return "en";
  }
  return undefined;
}

/**
 * Resolves UI display language based on CLI option, environment variable,
 * global config, and system default (falling back to "en").
 */
export function resolveLanguage(
  cliLang?: string,
  envLang?: string,
  configLang?: string,
): SupportedLanguage {
  const fromCli = normalizeLanguage(cliLang);
  if (fromCli) return fromCli;

  const fromEnv = normalizeLanguage(envLang ?? process.env["VSUB_LANG"]);
  if (fromEnv) return fromEnv;

  const fromConfig = normalizeLanguage(configLang);
  if (fromConfig) return fromConfig;

  return DEFAULT_LANGUAGE;
}

/**
 * Returns the messages dictionary for the given language (defaults to "en").
 */
export function getI18n(lang?: SupportedLanguage | string): I18nMessages {
  const resolved = normalizeLanguage(lang) ?? DEFAULT_LANGUAGE;
  return DICTIONARIES[resolved] ?? DICTIONARIES.en;
}
