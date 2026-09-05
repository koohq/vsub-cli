import fs from "node:fs";
import readline from "node:readline/promises";
import pc from "picocolors";
import { type SupportedLanguage, getI18n } from "./i18n/index.js";

export interface EnsureWritableOptions {
  overwrite?: boolean | undefined;
  backup?: boolean | undefined;
  isInteractive?: boolean | undefined;
  promptFn?: ((question: string) => Promise<string>) | undefined;
  lang?: SupportedLanguage | undefined;
}

export interface BackupResult {
  original: string;
  backup: string;
}

export interface EnsureWritableResult {
  proceed: boolean;
  backedUp: BackupResult[];
  existingFiles: string[];
}

/**
 * Checks which of the given file paths currently exist on disk.
 */
export function checkExistingFiles(filePaths: string[]): string[] {
  const uniquePaths = Array.from(new Set(filePaths.filter(Boolean)));
  return uniquePaths.filter((filePath) => fs.existsSync(filePath));
}

/**
 * Generates an available backup path (e.g. file.bak, file.bak.1, file.bak.2).
 */
export function resolveBackupPath(filePath: string): string {
  const baseBackup = `${filePath}.bak`;
  if (!fs.existsSync(baseBackup)) {
    return baseBackup;
  }

  let index = 1;
  while (fs.existsSync(`${baseBackup}.${index}`)) {
    index++;
  }
  return `${baseBackup}.${index}`;
}

/**
 * Creates a backup copy of the target file if it exists.
 * Returns the destination backup path, or null if the file did not exist.
 */
export function createBackup(filePath: string): string | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const backupPath = resolveBackupPath(filePath);
  fs.copyFileSync(filePath, backupPath);
  return backupPath;
}

/**
 * Prompts user interactively to confirm overwriting existing files.
 */
export async function promptOverwriteConfirmation(
  existingFiles: string[],
  options?: {
    promptFn?: ((question: string) => Promise<string>) | undefined;
    lang?: SupportedLanguage | string | undefined;
  },
): Promise<boolean> {
  const i18n = getI18n(options?.lang);
  const m = i18n.safety;

  console.log(`\n⚠️  ${pc.yellow(m.existingFilesWarning)}`);
  for (const f of existingFiles) {
    console.log(`   - ${pc.cyan(f)}`);
  }

  if (options?.promptFn) {
    const answer = await options.promptFn(m.promptOverwrite);
    const normalized = answer.trim().toLowerCase();
    return normalized === "y" || normalized === "yes";
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const answer = await rl.question(pc.bold(m.promptOverwrite));
    const normalized = answer.trim().toLowerCase();
    return normalized === "y" || normalized === "yes";
  } finally {
    rl.close();
  }
}

/**
 * Validates target output files before performing heavy operations (API calls, FFmpeg).
 * - If no files exist -> proceed
 * - If backup option is true -> creates .bak files and proceeds
 * - If overwrite option is true -> proceeds directly
 * - If interactive -> asks user via prompt
 * - If non-interactive -> throws an error with instructions
 */
export async function ensureWritableTargets(
  filePaths: string[],
  options: EnsureWritableOptions = {},
): Promise<EnsureWritableResult> {
  const existingFiles = checkExistingFiles(filePaths);
  if (existingFiles.length === 0) {
    return {
      proceed: true,
      backedUp: [],
      existingFiles: [],
    };
  }

  // Backup mode
  if (options.backup) {
    const backedUp: BackupResult[] = [];
    for (const filePath of existingFiles) {
      const backupPath = createBackup(filePath);
      if (backupPath) {
        backedUp.push({ original: filePath, backup: backupPath });
      }
    }
    return {
      proceed: true,
      backedUp,
      existingFiles,
    };
  }

  // Overwrite mode
  if (options.overwrite) {
    return {
      proceed: true,
      backedUp: [],
      existingFiles,
    };
  }

  // Interactive mode
  const isInteractive =
    options.isInteractive ?? Boolean(process.stdin.isTTY && process.stdout.isTTY);

  if (isInteractive) {
    const confirmed = await promptOverwriteConfirmation(existingFiles, {
      promptFn: options.promptFn,
      lang: options.lang,
    });
    return {
      proceed: confirmed,
      backedUp: [],
      existingFiles,
    };
  }

  // Non-interactive without --overwrite or --backup
  const i18n = getI18n(options.lang);
  const fileList = existingFiles.map((f) => `  - ${f}`).join("\n");
  throw new Error(`${i18n.safety.nonInteractiveError}\n${fileList}`);
}
