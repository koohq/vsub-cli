import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import pc from "picocolors";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

export interface PackageTargetConfig {
  sourceName: string;
  archiveName: string;
  binaryName: string;
  format: "zip" | "tar.gz";
}

export const KNOWN_TARGETS: PackageTargetConfig[] = [
  {
    sourceName: "vsub-windows-x64.exe",
    archiveName: "vsub-windows-x64.zip",
    binaryName: "vsub.exe",
    format: "zip",
  },
  {
    sourceName: "vsub-windows-arm64.exe",
    archiveName: "vsub-windows-arm64.zip",
    binaryName: "vsub.exe",
    format: "zip",
  },
  {
    sourceName: "vsub-linux-x64",
    archiveName: "vsub-linux-x64.tar.gz",
    binaryName: "vsub",
    format: "tar.gz",
  },
  {
    sourceName: "vsub-linux-arm64",
    archiveName: "vsub-linux-arm64.tar.gz",
    binaryName: "vsub",
    format: "tar.gz",
  },
  {
    sourceName: "vsub-macos-arm64",
    archiveName: "vsub-macos-arm64.tar.gz",
    binaryName: "vsub",
    format: "tar.gz",
  },
];

/**
 * Computes SHA-256 hash of a file.
 */
export function computeSha256(filePath: string): string {
  const fileBuffer = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(fileBuffer).digest("hex");
}

/**
 * Creates an archive (.zip or .tar.gz) from a staging directory.
 */
export async function createArchiveFile(
  stagingDir: string,
  outputPath: string,
  format: "zip" | "tar.gz",
): Promise<void> {
  const files = fs.readdirSync(stagingDir);

  if (format === "zip") {
    if (process.platform === "win32") {
      await execa("tar", ["-a", "-cf", outputPath, ...files], {
        cwd: stagingDir,
      });
    } else {
      try {
        await execa("zip", ["-j", outputPath, ...files], {
          cwd: stagingDir,
        });
      } catch {
        await execa("tar", ["-a", "-cf", outputPath, ...files], {
          cwd: stagingDir,
        });
      }
    }
  } else {
    await execa("tar", ["-czf", outputPath, ...files], {
      cwd: stagingDir,
    });
  }
}

export interface PackageReleaseOptions {
  inputDir?: string;
  outputDir?: string;
  rootDir?: string;
}

/**
 * Packages standalone binaries from inputDir into compressed release assets with checksums.
 */
export async function packageReleaseAssets(options: PackageReleaseOptions = {}): Promise<{
  archives: string[];
  checksumFile: string;
}> {
  const rootDir = options.rootDir || ROOT_DIR;
  const inputDir = options.inputDir
    ? path.resolve(rootDir, options.inputDir)
    : path.join(rootDir, "dist", "all-binaries");
  const outputDir = options.outputDir
    ? path.resolve(rootDir, options.outputDir)
    : path.join(rootDir, "dist", "release-assets");

  if (!fs.existsSync(inputDir)) {
    throw new Error(`Input directory not found: ${inputDir}`);
  }

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const licensePath = path.join(rootDir, "LICENSE");
  const thirdPartyLicenseInInput = path.join(inputDir, "THIRD_PARTY_LICENSES.txt");
  const thirdPartyLicenseInDist = path.join(rootDir, "dist", "THIRD_PARTY_LICENSES.txt");
  const thirdPartyLicensePath = fs.existsSync(thirdPartyLicenseInInput)
    ? thirdPartyLicenseInInput
    : fs.existsSync(thirdPartyLicenseInDist)
      ? thirdPartyLicenseInDist
      : undefined;

  console.log(pc.cyan(`📦 Packaging release binaries from ${inputDir} -> ${outputDir}`));

  const generatedArchives: string[] = [];

  for (const target of KNOWN_TARGETS) {
    const sourceBinaryPath = path.join(inputDir, target.sourceName);
    if (!fs.existsSync(sourceBinaryPath)) {
      console.warn(pc.yellow(`⚠️ Binary not found (skipping): ${target.sourceName}`));
      continue;
    }

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vsub-pkg-"));

    try {
      const destBinary = path.join(tempDir, target.binaryName);
      fs.copyFileSync(sourceBinaryPath, destBinary);

      if (process.platform !== "win32" && target.format !== "zip") {
        fs.chmodSync(destBinary, 0o755);
      }

      if (fs.existsSync(licensePath)) {
        fs.copyFileSync(licensePath, path.join(tempDir, "LICENSE"));
      }

      if (thirdPartyLicensePath && fs.existsSync(thirdPartyLicensePath)) {
        fs.copyFileSync(thirdPartyLicensePath, path.join(tempDir, "THIRD_PARTY_LICENSES.txt"));
      }

      const archiveOutputPath = path.join(outputDir, target.archiveName);
      if (fs.existsSync(archiveOutputPath)) {
        fs.unlinkSync(archiveOutputPath);
      }

      console.log(pc.blue(`  • Creating ${target.archiveName} from ${target.sourceName}...`));
      await createArchiveFile(tempDir, archiveOutputPath, target.format);

      const stats = fs.statSync(archiveOutputPath);
      const sizeMb = (stats.size / (1024 * 1024)).toFixed(2);
      console.log(pc.green(`    ✔ ${target.archiveName} (${sizeMb} MB)`));

      generatedArchives.push(archiveOutputPath);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }

  if (generatedArchives.length === 0) {
    throw new Error(`No release binaries were packaged from ${inputDir}.`);
  }

  // Copy THIRD_PARTY_LICENSES.txt to release-assets if available
  if (thirdPartyLicensePath && fs.existsSync(thirdPartyLicensePath)) {
    const destThirdParty = path.join(outputDir, "THIRD_PARTY_LICENSES.txt");
    fs.copyFileSync(thirdPartyLicensePath, destThirdParty);
  }

  // Generate consolidated SHA256SUMS.txt
  const checksumFilePath = path.join(outputDir, "SHA256SUMS.txt");
  const checksumLines: string[] = [];

  const releaseFiles = fs
    .readdirSync(outputDir)
    .filter((file) => file !== "SHA256SUMS.txt")
    .sort();

  for (const file of releaseFiles) {
    const fullPath = path.join(outputDir, file);
    const hash = computeSha256(fullPath);
    checksumLines.push(`${hash}  ${file}`);
  }

  fs.writeFileSync(checksumFilePath, `${checksumLines.join("\n")}\n`, "utf-8");
  console.log(
    pc.bold(pc.green(`✔ Generated ${checksumFilePath} with ${checksumLines.length} entries`)),
  );

  return {
    archives: generatedArchives,
    checksumFile: checksumFilePath,
  };
}

// CLI entry point
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const inputDir = args[0] || "dist/all-binaries";
  const outputDir = args[1] || "dist/release-assets";

  packageReleaseAssets({ inputDir, outputDir })
    .then(({ archives }) => {
      console.log(
        pc.bold(pc.green(`🎉 Successfully packaged ${archives.length} release archives.`)),
      );
    })
    .catch((err) => {
      console.error(pc.red(`✖ Failed to package release assets: ${err.message}`));
      process.exit(1);
    });
}
