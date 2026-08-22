import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import { execa } from "execa";
import pc from "picocolors";
import { generateLicenseFiles } from "./generate-licenses.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

export interface BuildBinaryOptions {
  bundleOnly?: boolean;
  name?: string;
  outputDir?: string;
  checksum?: boolean;
  skipTest?: boolean;
  rootDir?: string;
}

/**
 * Resolves standard target binary name based on platform and architecture.
 */
export function getDefaultBinaryName(platform = process.platform, arch = process.arch): string {
  const osName = platform === "win32" ? "windows" : platform === "darwin" ? "macos" : platform;
  const ext = platform === "win32" ? ".exe" : "";
  return `vsub-${osName}-${arch}${ext}`;
}

/**
 * Computes SHA-256 hash of a file.
 */
export function computeFileSha256(filePath: string): string {
  const fileBuffer = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(fileBuffer).digest("hex");
}

/**
 * Parses CLI arguments into BuildBinaryOptions.
 */
export function parseBuildArgs(args: string[]): BuildBinaryOptions {
  const options: BuildBinaryOptions = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--bundle-only") {
      options.bundleOnly = true;
    } else if (arg === "--name" && i + 1 < args.length) {
      options.name = args[++i];
    } else if (arg === "--output-dir" && i + 1 < args.length) {
      options.outputDir = args[++i];
    } else if (arg === "--checksum") {
      options.checksum = true;
    } else if (arg === "--skip-test") {
      options.skipTest = true;
    }
  }
  return options;
}

/**
 * Bundles TypeScript sources into a single CommonJS bundle for Node SEA.
 */
export async function bundleApplication(rootDir = ROOT_DIR): Promise<string> {
  const distDir = path.join(rootDir, "dist");
  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
  }

  // Ensure license data and THIRD_PARTY_LICENSES.txt are up to date
  generateLicenseFiles(rootDir);

  const entryPoint = path.join(rootDir, "src", "index.ts");
  const bundleOut = path.join(distDir, "bundle.cjs");

  console.log(pc.cyan(`📦 Bundling with esbuild: ${entryPoint} -> ${bundleOut}`));

  await esbuild.build({
    entryPoints: [entryPoint],
    bundle: true,
    platform: "node",
    target: "node26",
    format: "cjs",
    outfile: bundleOut,
    minify: true,
    sourcemap: false,
    banner: {
      js: "/* vsub-cli standalone bundle */",
    },
    define: {
      "process.env.NODE_ENV": '"production"',
    },
  });

  const stats = fs.statSync(bundleOut);
  const sizeMb = (stats.size / (1024 * 1024)).toFixed(2);
  console.log(pc.green(`✔ Bundled successfully (${sizeMb} MB)`));

  return bundleOut;
}

/**
 * Generates sea-config.json and builds single executable using node --build-sea.
 */
export async function buildStandaloneBinary(
  options: BuildBinaryOptions = {},
): Promise<{ binaryPath: string; checksumPath?: string }> {
  const rootDir = options.rootDir || ROOT_DIR;
  const distDir = path.join(rootDir, "dist");
  const outputDir = options.outputDir ? path.resolve(rootDir, options.outputDir) : distDir;

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // 1. Bundle
  const bundlePath = await bundleApplication(rootDir);
  if (options.bundleOnly) {
    return { binaryPath: bundlePath };
  }

  // 2. Prepare sea-config.json
  const rawBinaryName = process.platform === "win32" ? "vsub.exe" : "vsub";
  const intermediateBinaryPath = path.join(distDir, rawBinaryName);

  const seaConfigPath = path.join(distDir, "sea-config.json");
  const seaConfigContent = {
    main: path.relative(distDir, bundlePath).replace(/\\/g, "/"),
    output: rawBinaryName,
    disableExperimentalSEAWarning: true,
  };

  fs.writeFileSync(seaConfigPath, JSON.stringify(seaConfigContent, null, 2), "utf-8");

  // 3. Run node --build-sea
  console.log(pc.cyan(`⚡ Running node --build-sea ${seaConfigPath}...`));
  await execa("node", ["--build-sea", seaConfigPath], {
    cwd: distDir,
    stdio: "inherit",
  });

  if (!fs.existsSync(intermediateBinaryPath)) {
    throw new Error(`Binary generation failed: ${intermediateBinaryPath} does not exist.`);
  }

  // 4. Copy to target binary name
  const finalBinaryName = options.name || getDefaultBinaryName(process.platform, process.arch);
  const finalBinaryPath = path.join(outputDir, finalBinaryName);

  if (path.resolve(intermediateBinaryPath) !== path.resolve(finalBinaryPath)) {
    if (fs.existsSync(finalBinaryPath)) {
      fs.unlinkSync(finalBinaryPath);
    }
    fs.copyFileSync(intermediateBinaryPath, finalBinaryPath);
    // Ensure execute permissions on Unix
    if (process.platform !== "win32") {
      fs.chmodSync(finalBinaryPath, 0o755);
    }
    try {
      fs.unlinkSync(intermediateBinaryPath);
    } catch {
      // Ignore cleanup error
    }
  }

  // 5. macOS codesign (must be applied to final binary path after copying/permissions)
  if (process.platform === "darwin") {
    console.log(pc.cyan(`🔏 Applying macOS ad-hoc code signature to ${finalBinaryPath}...`));
    try {
      await execa("codesign", ["--sign", "-", "--force", finalBinaryPath], {
        stdio: "inherit",
      });
      console.log(pc.green("✔ Code signature applied"));
    } catch (err) {
      console.warn(pc.yellow(`⚠️ codesign failed (non-fatal in some environments): ${err}`));
    }
  }

  const binaryStats = fs.statSync(finalBinaryPath);
  const binarySizeMb = (binaryStats.size / (1024 * 1024)).toFixed(2);
  console.log(pc.bold(pc.green(`🎉 Binary generated: ${finalBinaryPath} (${binarySizeMb} MB)`)));

  // 6. Compute checksum if requested
  let checksumPath: string | undefined;
  if (options.checksum) {
    const hash = computeFileSha256(finalBinaryPath);
    checksumPath = `${finalBinaryPath}.sha256`;
    fs.writeFileSync(checksumPath, `${hash}  ${path.basename(finalBinaryPath)}\n`, "utf-8");
    console.log(pc.cyan(`🔑 SHA-256: ${hash}`));
  }

  // 7. Verify binary by running --version and licenses
  if (!options.skipTest) {
    console.log(pc.cyan("🧪 Verifying standalone binary execution..."));
    try {
      const verResult = await execa(finalBinaryPath, ["--version"]);
      console.log(`   --version: ${pc.green(verResult.stdout.trim())}`);

      const licResult = await execa(finalBinaryPath, ["licenses"]);
      if (licResult.stdout.includes("サードパーティライセンス")) {
        console.log(pc.green("   ✔ vsub licenses command verified"));
      }

      const helpResult = await execa(finalBinaryPath, ["--help"]);
      if (helpResult.stdout.includes("vsub")) {
        console.log(pc.green("   ✔ vsub --help command verified"));
      }
    } catch (testErr) {
      console.error(pc.red(`✖ Binary self-test failed: ${testErr}`));
      throw testErr;
    }
  }

  return { binaryPath: finalBinaryPath, checksumPath };
}

// Run CLI when invoked directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const parsedArgs = parseBuildArgs(process.argv.slice(2));
  buildStandaloneBinary(parsedArgs).catch((err) => {
    console.error(pc.red(`Error building binary: ${err.message}`));
    process.exit(1);
  });
}
