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
