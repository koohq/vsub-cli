import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type FlatGlossary = Record<string, string>;

/**
 * Normalizes language codes for glossary key lookup (e.g. "ja-JP" -> "ja", "JA" -> "ja").
 */
function normalizeLangKey(lang: string): string {
  return lang.trim().toLowerCase().split("-")[0] ?? lang.trim().toLowerCase();
}

/**
 * Parses inline glossary strings such as:
 * - "Antigravity=アンチグラビティ, vsub=ブイサブ"
 * - "Antigravity: アンチグラビティ\nvsub: ブイサブ"
 */
export function parseInlineGlossary(inlineText: string): FlatGlossary {
  const result: FlatGlossary = {};
  if (!inlineText || typeof inlineText !== "string") {
    return result;
  }

  // Split by comma, semicolon, or newlines
  const entries = inlineText.split(/[\n,;]+/);
  for (const entry of entries) {
    const trimmed = entry.trim();
    if (!trimmed) continue;

    // Support key=value or key: value
    const match = trimmed.match(/^([^=:]+)[=:](.+)$/);
    if (match?.[1] && match[2]) {
      const key = match[1].trim();
      const val = match[2].trim();
      if (key && val) {
        result[key] = val;
      }
    }
  }

  return result;
}

/**
 * Parses JSON glossary content supporting multiple schemas:
 * 1. Flat dictionary: { "Antigravity": "アンチグラビティ" }
 * 2. Language-keyed: { "ja": { "Antigravity": "アンチグラビティ" }, "zh": { ... } }
 * 3. Term-keyed multi-language: { "Antigravity": { "ja": "アンチグラビティ", "zh": "反重力" } }
 */
export function parseJsonGlossary(rawJson: unknown, targetLang?: string): FlatGlossary {
  if (!rawJson || typeof rawJson !== "object" || Array.isArray(rawJson)) {
    return {};
  }

  const obj = rawJson as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length === 0) return {};

  const target = targetLang ? normalizeLangKey(targetLang) : undefined;

  // Check Schema 2: Language-keyed (e.g. obj["ja"] is an object)
  if (target && obj[target] && typeof obj[target] === "object" && !Array.isArray(obj[target])) {
    const subObj = obj[target] as Record<string, unknown>;
    const res: FlatGlossary = {};
    for (const [k, v] of Object.entries(subObj)) {
      if (typeof v === "string" && v.trim()) {
        res[k.trim()] = v.trim();
      }
    }
    return res;
  }

  // Check if any key is a language code (e.g., "ja", "en", "zh", "es", "fr", "de", "ko")
  const commonLangCodes = new Set([
    "ja",
    "en",
    "zh",
    "es",
    "fr",
    "de",
    "ko",
    "ru",
    "pt",
    "it",
    "nl",
    "tr",
    "pl",
    "ar",
    "hi",
    "vi",
    "id",
    "th",
  ]);
  const isLanguageKeyed = keys.some((k) => commonLangCodes.has(normalizeLangKey(k)));

  if (isLanguageKeyed) {
    if (target && obj[target] && typeof obj[target] === "object") {
      const sub = obj[target] as Record<string, unknown>;
      const res: FlatGlossary = {};
      for (const [k, v] of Object.entries(sub)) {
        if (typeof v === "string" && v.trim()) {
          res[k.trim()] = v.trim();
        }
      }
      return res;
    }
    // If targetLang is not matched in a language-keyed object, check "default"
    if (obj["default"] && typeof obj["default"] === "object") {
      const sub = obj["default"] as Record<string, unknown>;
      const res: FlatGlossary = {};
      for (const [k, v] of Object.entries(sub)) {
        if (typeof v === "string" && v.trim()) {
          res[k.trim()] = v.trim();
        }
      }
      return res;
    }
    return {};
  }

  // Check Schema 3: Term-keyed multi-language (e.g. { "Term": { "ja": "...", "zh": "..." } })
  const firstVal = obj[keys[0] ?? ""];
  if (firstVal && typeof firstVal === "object" && !Array.isArray(firstVal)) {
    const res: FlatGlossary = {};
    for (const [term, transObj] of Object.entries(obj)) {
      if (transObj && typeof transObj === "object" && !Array.isArray(transObj)) {
        const transRecord = transObj as Record<string, unknown>;
        if (target && typeof transRecord[target] === "string") {
          res[term.trim()] = (transRecord[target] as string).trim();
        } else if (target && typeof transRecord[targetLang ?? ""] === "string") {
          res[term.trim()] = (transRecord[targetLang ?? ""] as string).trim();
        } else if (typeof transRecord["default"] === "string") {
          res[term.trim()] = (transRecord["default"] as string).trim();
        }
      }
    }
    return res;
  }

  // Schema 1: Flat dictionary (e.g. { "Antigravity": "アンチグラビティ" })
  const res: FlatGlossary = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "string" && v.trim()) {
      res[k.trim()] = v.trim();
    }
  }
  return res;
}

/**
 * Parses glossary from a file path (JSON) or an inline string, resolving for targetLang if specified.
 */
export function parseGlossary(input: string, targetLang?: string): FlatGlossary {
  const trimmed = input.trim();
  if (!trimmed) return {};

  const resolvedPath = path.resolve(process.cwd(), trimmed);
  if (fs.existsSync(resolvedPath)) {
    try {
      const content = fs.readFileSync(resolvedPath, "utf-8");
      const json = JSON.parse(content);
      return parseJsonGlossary(json, targetLang);
    } catch (err) {
      throw new Error(
        `Failed to parse glossary file (${path.basename(resolvedPath)}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // If input starts with '{' or '[', attempt to parse as inline JSON
  if (trimmed.startsWith("{")) {
    try {
      const json = JSON.parse(trimmed);
      return parseJsonGlossary(json, targetLang);
    } catch {
      // Fallback to inline key-value parser below
    }
  }

  // Fallback: parse as inline key=val,key=val
  return parseInlineGlossary(trimmed);
}

/**
 * Formats a flat glossary into prompt rules for Gemini.
 */
export function formatGlossaryPrompt(glossary: FlatGlossary): string {
  const entries = Object.entries(glossary);
  if (entries.length === 0) return "";

  const lines = entries.map(([src, tgt]) => `- "${src}" -> "${tgt}"`);
  return lines.join("\n");
}

/**
 * Extracts comma-separated source terms from a glossary or raw input for Whisper prompt hint.
 */
export function extractWhisperPromptHints(glossary: FlatGlossary | string): string {
  if (typeof glossary === "string") {
    const parsed = parseGlossary(glossary);
    return Object.keys(parsed).join(", ");
  }
  return Object.keys(glossary).join(", ");
}

/**
 * Computes a deterministic SHA-256 hash for glossary rules to store in cache metadata.
 */
export function computeGlossaryHash(glossary: FlatGlossary): string {
  const entries = Object.entries(glossary).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) return "";

  const str = entries.map(([k, v]) => `${k}=${v}`).join("|");
  return crypto.createHash("sha256").update(str).digest("hex").slice(0, 16);
}
