import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Default fallback version if package.json cannot be read at runtime
export const DEFAULT_APP_VERSION = "1.3.0";

declare global {
  // esbuild or test runners can inject __VSUB_VERSION__
  // eslint-disable-next-line no-var
  var __VSUB_VERSION__: string | undefined;
}

let cachedVersion: string | undefined;

/**
 * Returns the current application version.
 * 1. Checks globalThis.__VSUB_VERSION__ (injected during bundle build)
 * 2. Checks process.env["VSUB_VERSION"]
 * 3. Tries to read package.json relative to import.meta.url
 * 4. Falls back to DEFAULT_APP_VERSION
 */
export function getCurrentVersion(): string {
  if (cachedVersion) {
    return cachedVersion;
  }

  if (typeof globalThis !== "undefined" && globalThis.__VSUB_VERSION__) {
    cachedVersion = globalThis.__VSUB_VERSION__;
    return cachedVersion;
  }

  if (process.env["VSUB_VERSION"]?.trim()) {
    cachedVersion = process.env["VSUB_VERSION"].trim();
    return cachedVersion;
  }

  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const pkgPath = path.resolve(__dirname, "..", "package.json");
    if (fs.existsSync(pkgPath)) {
      const content = fs.readFileSync(pkgPath, "utf-8");
      const parsed = JSON.parse(content) as { version?: string };
      if (parsed.version) {
        cachedVersion = parsed.version;
        return cachedVersion;
      }
    }
  } catch {
    // Ignore error in environments where filesystem traversal is restricted
  }

  cachedVersion = DEFAULT_APP_VERSION;
  return cachedVersion;
}

/**
 * Clears cached version (primarily used in tests).
 */
export function resetCachedVersion(): void {
  cachedVersion = undefined;
}
