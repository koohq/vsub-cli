/**
 * Language parsing and validation utilities for multi-language translation.
 */

// Regex for standard BCP-47 / ISO-639 language codes (e.g. "ja", "en", "zh-CN", "zh-TW", "pt-BR", "es-419")
const LANGUAGE_CODE_REGEX = /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,4})?$/;

/**
 * Parses and validates a comma-separated target language string.
 *
 * Examples:
 * - undefined or "" -> ["ja"]
 * - "ja" -> ["ja"]
 * - "ja,en,zh" -> ["ja", "en", "zh"]
 * - " JA , en, ZH-TW, ja " -> ["ja", "en", "zh-tw"]
 *
 * @param input Comma-separated language code string
 * @returns Deduplicated array of lowercase language codes
 * @throws Error if any language code is invalid
 */
export function parseTargetLanguages(input?: string): string[] {
  if (!input?.trim()) {
    return ["ja"];
  }

  const rawTokens = input
    .split(",")
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);

  if (rawTokens.length === 0) {
    return ["ja"];
  }

  const targetLangs: string[] = [];
  const seen = new Set<string>();

  for (const token of rawTokens) {
    if (!LANGUAGE_CODE_REGEX.test(token)) {
      throw new Error(
        `無効なターゲット言語コードです: "${token}". 有効な形式の例: "ja", "en", "zh", "zh-CN", "pt-BR"`,
      );
    }
    if (!seen.has(token)) {
      seen.add(token);
      targetLangs.push(token);
    }
  }

  return targetLangs.length > 0 ? targetLangs : ["ja"];
}

// Common ISO 639-1 to ISO 639-2 (3-letter) mapping for FFmpeg subtitle tracks
const ISO_639_1_TO_639_2: Record<string, string> = {
  ja: "jpn",
  en: "eng",
  zh: "chi",
  "zh-cn": "chi",
  "zh-tw": "chi",
  ko: "kor",
  fr: "fra",
  de: "deu",
  es: "spa",
  it: "ita",
  ru: "rus",
  pt: "por",
  "pt-br": "por",
  nl: "nld",
  pl: "pol",
  sv: "swe",
  tr: "tur",
  ar: "ara",
  hi: "hin",
  vi: "vie",
  th: "tha",
  id: "ind",
  uk: "ukr",
  cs: "ces",
  da: "dan",
  fi: "fin",
  el: "ell",
  he: "heb",
  no: "nor",
  hu: "hun",
  ro: "ron",
  sk: "slk",
};

// Display names for subtitle track titles
const LANGUAGE_DISPLAY_NAMES: Record<string, string> = {
  ja: "Japanese",
  en: "English",
  zh: "Chinese",
  "zh-cn": "Chinese (Simplified)",
  "zh-tw": "Chinese (Traditional)",
  ko: "Korean",
  fr: "French",
  de: "German",
  es: "Spanish",
  it: "Italian",
  ru: "Russian",
  pt: "Portuguese",
  "pt-br": "Portuguese (Brazil)",
  nl: "Dutch",
  pl: "Polish",
  sv: "Swedish",
  tr: "Turkish",
  ar: "Arabic",
  hi: "Hindi",
  vi: "Vietnamese",
  th: "Thai",
  id: "Indonesian",
  uk: "Ukrainian",
  cs: "Czech",
  da: "Danish",
  fi: "Finnish",
  el: "Greek",
  he: "Hebrew",
  no: "Norwegian",
  hu: "Hungarian",
  ro: "Romanian",
  sk: "Slovak",
};

/**
 * Normalizes a language code (e.g. "ja", "en", "zh-CN") to an ISO 639-2 (3-letter) code for FFmpeg metadata.
 * If already a 3-letter code or unknown, returns safe fallback.
 */
export function toIso6392(langCode: string): string {
  const normalized = langCode.trim().toLowerCase();
  if (ISO_639_1_TO_639_2[normalized]) {
    return ISO_639_1_TO_639_2[normalized];
  }
  // If format is like "zh-cn" and base language exists in mapping
  const baseLang = normalized.split("-")[0] ?? "";
  if (ISO_639_1_TO_639_2[baseLang]) {
    return ISO_639_1_TO_639_2[baseLang];
  }
  // If already 3 letters
  if (/^[a-z]{3}$/.test(normalized)) {
    return normalized;
  }
  return normalized;
}

/**
 * Gets a human-friendly display name for a language code (e.g. "ja" -> "Japanese", "en" -> "English").
 */
export function getLanguageDisplayName(langCode: string): string {
  const normalized = langCode.trim().toLowerCase();
  if (LANGUAGE_DISPLAY_NAMES[normalized]) {
    return LANGUAGE_DISPLAY_NAMES[normalized];
  }
  const baseLang = normalized.split("-")[0] ?? "";
  if (LANGUAGE_DISPLAY_NAMES[baseLang]) {
    return LANGUAGE_DISPLAY_NAMES[baseLang];
  }
  return langCode.toUpperCase();
}
