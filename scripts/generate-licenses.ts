import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface PackageLicenseInfo {
  name: string;
  version: string;
  license: string;
  repository?: string;
  author?: string;
  licenseText?: string;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

/**
 * Common license filenames to search for in package directories.
 */
const LICENSE_FILENAMES = [
  "LICENSE",
  "LICENSE.md",
  "LICENSE.txt",
  "LICENCE",
  "LICENCE.md",
  "LICENCE.txt",
  "COPYING",
  "COPYING.md",
  "COPYING.txt",
];

/**
 * Resolves the location of a package in node_modules, supporting scoped packages.
 */
export function findPackageDir(rootDir: string, pkgName: string): string | null {
  const candidates = [
    path.join(rootDir, "node_modules", pkgName),
    path.join(rootDir, "..", "..", "node_modules", pkgName),
  ];

  for (const dir of candidates) {
    if (fs.existsSync(dir) && fs.existsSync(path.join(dir, "package.json"))) {
      return dir;
    }
  }

  // Search inside .pnpm virtual store if not found directly
  const pnpmDir = path.join(rootDir, "node_modules", ".pnpm");
  if (fs.existsSync(pnpmDir)) {
    const entries = fs.readdirSync(pnpmDir);
    const normalizedPkg = pkgName.replace("/", "+");
    for (const entry of entries) {
      if (entry.includes(normalizedPkg)) {
        const potentialDir = path.join(pnpmDir, entry, "node_modules", pkgName);
        if (fs.existsSync(potentialDir)) {
          return potentialDir;
        }
      }
    }
  }

  return null;
}

/**
 * Extracts license text from a package directory.
 */
export function extractLicenseText(pkgDir: string): string | undefined {
  for (const filename of LICENSE_FILENAMES) {
    const fullPath = path.join(pkgDir, filename);
    if (fs.existsSync(fullPath)) {
      return fs.readFileSync(fullPath, "utf-8").trim();
    }
  }
  return undefined;
}

/**
 * Gathers license information for all production dependencies in package.json.
 */
export function collectDependencyLicenses(rootDir = ROOT_DIR): PackageLicenseInfo[] {
  const pkgJsonPath = path.join(rootDir, "package.json");
  if (!fs.existsSync(pkgJsonPath)) {
    throw new Error(`package.json not found at ${pkgJsonPath}`);
  }

  const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));
  const dependencies: Record<string, string> = pkgJson.dependencies || {};
  const results: PackageLicenseInfo[] = [];

  for (const pkgName of Object.keys(dependencies)) {
    const pkgDir = findPackageDir(rootDir, pkgName);
    if (!pkgDir) {
      results.push({
        name: pkgName,
        version: dependencies[pkgName] || "unknown",
        license: "UNKNOWN",
        licenseText: "License file not found in node_modules.",
      });
      continue;
    }

    try {
      const depPkgJson = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf-8"));
      const license =
        depPkgJson.license ||
        (Array.isArray(depPkgJson.licenses)
          ? depPkgJson.licenses.map((l: { type?: string }) => l.type).join(", ")
          : "UNKNOWN");

      const repo =
        typeof depPkgJson.repository === "string"
          ? depPkgJson.repository
          : depPkgJson.repository?.url;

      const author =
        typeof depPkgJson.author === "string" ? depPkgJson.author : depPkgJson.author?.name;

      const licenseText = extractLicenseText(pkgDir);

      results.push({
        name: depPkgJson.name || pkgName,
        version: depPkgJson.version || dependencies[pkgName] || "unknown",
        license: typeof license === "string" ? license : "UNKNOWN",
        repository: repo,
        author: author,
        licenseText: licenseText || `License type: ${license} (no separate LICENSE file found)`,
      });
    } catch {
      results.push({
        name: pkgName,
        version: dependencies[pkgName] || "unknown",
        license: "UNKNOWN",
      });
    }
  }

  return results.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Formats license entries into a human-readable text document.
 */
export function formatLicensesText(licenses: PackageLicenseInfo[]): string {
  const lines: string[] = [];
  lines.push("================================================================================");
  lines.push("                          THIRD-PARTY SOFTWARE NOTICES                          ");
  lines.push("================================================================================");
  lines.push("");
  lines.push("This binary distribution bundles the following open-source software libraries.");
  lines.push("Each library is governed by its respective license terms below.");
  lines.push("");

  for (const item of licenses) {
    lines.push("--------------------------------------------------------------------------------");
    lines.push(`Package:    ${item.name}@${item.version}`);
    lines.push(`License:    ${item.license}`);
    if (item.repository) {
      lines.push(`Repository: ${item.repository}`);
    }
    if (item.author) {
      lines.push(`Author:     ${item.author}`);
    }
    lines.push("--------------------------------------------------------------------------------");
    lines.push("");
    lines.push(item.licenseText || "No license text provided.");
    lines.push("");
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Writes THIRD_PARTY_LICENSES.txt to dist/ and generates src/licenses.data.ts.
 */
export function generateLicenseFiles(rootDir = ROOT_DIR): void {
  const licenses = collectDependencyLicenses(rootDir);
  const formattedText = formatLicensesText(licenses);

  // 1. Write dist/THIRD_PARTY_LICENSES.txt
  const distDir = path.join(rootDir, "dist");
  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
  }
  const txtPath = path.join(distDir, "THIRD_PARTY_LICENSES.txt");
  fs.writeFileSync(txtPath, formattedText, "utf-8");

  // 2. Write src/licenses.data.ts
  const dataTsPath = path.join(rootDir, "src", "licenses.data.ts");
  const dataContent = `// Auto-generated by scripts/generate-licenses.ts. Do not edit manually.
export interface EmbeddedLicense {
  name: string;
  version: string;
  license: string;
  repository?: string;
  licenseText: string;
}

export const EMBEDDED_LICENSES: EmbeddedLicense[] = ${JSON.stringify(
    licenses.map((l) => ({
      name: l.name,
      version: l.version,
      license: l.license,
      repository: l.repository,
      licenseText: l.licenseText || "",
    })),
    null,
    2,
  )};

export const THIRD_PARTY_LICENSES_TEXT = ${JSON.stringify(formattedText)};
`;
  fs.writeFileSync(dataTsPath, dataContent, "utf-8");
  console.log(`✔ Generated ${txtPath} and ${dataTsPath}`);
}

// Run CLI when invoked directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  generateLicenseFiles();
}
