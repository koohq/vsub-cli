import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeLicensesDataModule } from "./generate-licenses.js";

const __filename = fileURLToPath(import.meta.url);
const ROOT_DIR = path.resolve(path.dirname(__filename), "..");

/**
 * Prepares for `tsc`: wipes dist/ so no stale output remains, then regenerates
 * src/licenses.data.ts from the installed dependencies.
 */
export function prepareBuild(rootDir = ROOT_DIR): void {
  fs.rmSync(path.join(rootDir, "dist"), { recursive: true, force: true });
  writeLicensesDataModule(rootDir);
  console.log("Prepared build: cleaned dist/ and regenerated src/licenses.data.ts");
}

// Run when invoked directly
const entryPath = process.argv[1];
if (entryPath !== undefined && path.resolve(entryPath) === path.resolve(__filename)) {
  prepareBuild();
}
