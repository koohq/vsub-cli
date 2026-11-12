import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getI18n, type SupportedLanguage } from "./i18n/index.js";

export interface ContextNotes {
  text: string;
  source: "file" | "inline";
  fileName?: string | undefined;
}

/** Resolves media background notes from an existing file or inline text. */
export function resolveContextNotes(
  input: string | undefined,
  lang?: SupportedLanguage | string,
): ContextNotes | undefined {
  const trimmed = input?.trim();
  if (!trimmed) return undefined;
  const resolvedPath = path.resolve(process.cwd(), trimmed);
  const fileName = path.basename(resolvedPath);
  try {
    if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isFile()) {
      const text = fs
        .readFileSync(resolvedPath, "utf-8")
        .replace(/^\uFEFF/, "")
        .trim();
      return text ? { text, source: "file", fileName } : undefined;
    }
  } catch (error) {
    throw new Error(
      getI18n(lang).common.contextReadFailed(
        fileName,
        error instanceof Error ? error.message : String(error),
      ),
    );
  }
  return { text: trimmed, source: "inline" };
}

/** Hashes note content independently of how it was supplied. */
export function computeContextHash(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}
