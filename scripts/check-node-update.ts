import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface SemVer {
  major: number;
  minor: number;
  patch: number;
  raw: string;
}

export interface NodeRelease {
  version: string;
  date: string;
  lts?: boolean | string;
  security?: boolean;
}

export interface DetermineUpdateOptions {
  now?: Date;
  force?: boolean;
  patchCooldownDays?: number;
  minorCooldownDays?: number;
}

export interface NodeUpdateResult {
  needsUpdate: boolean;
  currentVersion: string;
  targetVersion?: string;
  releaseDate?: string;
  daysAgo?: number;
  reason: string;
}

/**
 * Parses a version string like "v26.9.0" or "26.8.2" into SemVer object.
 */
export function parseSemVer(versionStr: string): SemVer {
  const clean = versionStr.trim().replace(/^v/, "");
  const parts = clean.split(".").map((p) => Number.parseInt(p, 10));
  const major = parts[0];
  const minor = parts[1];
  const patch = parts[2];
  if (
    parts.length < 3 ||
    major === undefined ||
    minor === undefined ||
    patch === undefined ||
    Number.isNaN(major) ||
    Number.isNaN(minor) ||
    Number.isNaN(patch)
  ) {
    throw new Error(`Invalid SemVer string: ${versionStr}`);
  }
  return {
    major,
    minor,
    patch,
    raw: clean,
  };
}

/**
 * Compares two SemVer objects.
 * Returns > 0 if a > b, < 0 if a < b, and 0 if equal.
 */
export function compareSemVer(a: SemVer, b: SemVer): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

/**
 * Evaluates available releases against current version and cooldown criteria.
 */
export function determineNodeUpdate(
  currentVersionStr: string,
  releases: NodeRelease[],
  options: DetermineUpdateOptions = {},
): NodeUpdateResult {
  const current = parseSemVer(currentVersionStr);
  const now = options.now ?? new Date();
  const patchCooldownDays = options.patchCooldownDays ?? 3;
  const minorCooldownDays = options.minorCooldownDays ?? 7;

  // Filter releases for the same major version
  const majorReleases = releases
    .filter((r) => r.version.startsWith(`v${current.major}.`))
    .map((r) => ({
      release: r,
      semver: parseSemVer(r.version),
    }))
    .sort((a, b) => compareSemVer(b.semver, a.semver));

  const latest = majorReleases[0];
  if (!latest) {
    return {
      needsUpdate: false,
      currentVersion: current.raw,
      reason: `No releases found for major version ${current.major}`,
    };
  }

  if (compareSemVer(latest.semver, current) <= 0) {
    return {
      needsUpdate: false,
      currentVersion: current.raw,
      reason: `Already on or ahead of latest major ${current.major} release (${latest.semver.raw})`,
    };
  }

  // Iterate from newest to older candidate to find the best eligible version
  for (const candidate of majorReleases) {
    if (compareSemVer(candidate.semver, current) <= 0) {
      break;
    }

    const releaseDate = new Date(`${candidate.release.date}T00:00:00Z`);
    const diffMs = now.getTime() - releaseDate.getTime();
    const daysAgo = Math.max(0, diffMs / (1000 * 60 * 60 * 24));

    if (options.force) {
      return {
        needsUpdate: true,
        currentVersion: current.raw,
        targetVersion: candidate.semver.raw,
        releaseDate: candidate.release.date,
        daysAgo: Math.floor(daysAgo),
        reason: `Update forced by options (${candidate.semver.raw})`,
      };
    }

    const isMinorFirstRelease = candidate.semver.patch === 0;

    if (isMinorFirstRelease) {
      // Check if a subsequent patch (.1+) has already been released for this minor
      const hasFollowupPatch = majorReleases.some(
        (r) =>
          r.semver.minor === candidate.semver.minor &&
          r.semver.patch > 0 &&
          compareSemVer(r.semver, candidate.semver) > 0,
      );

      // If a .1+ patch exists, we prefer the patch (which will be evaluated on its own iteration)
      if (hasFollowupPatch) {
        continue;
      }

      // Initial .0 release requires minorCooldownDays (default 7 days)
      if (daysAgo >= minorCooldownDays) {
        return {
          needsUpdate: true,
          currentVersion: current.raw,
          targetVersion: candidate.semver.raw,
          releaseDate: candidate.release.date,
          daysAgo: Math.floor(daysAgo),
          reason: `Minor release .0 passed ${minorCooldownDays}-day cooldown (${daysAgo.toFixed(1)} days elapsed)`,
        };
      }
    } else {
      // Patch release requires patchCooldownDays (default 3 days)
      if (daysAgo >= patchCooldownDays) {
        return {
          needsUpdate: true,
          currentVersion: current.raw,
          targetVersion: candidate.semver.raw,
          releaseDate: candidate.release.date,
          daysAgo: Math.floor(daysAgo),
          reason: `Patch release passed ${patchCooldownDays}-day cooldown (${daysAgo.toFixed(1)} days elapsed)`,
        };
      }
    }
  }

  // If we reach here, newer versions exist but are still in cooldown
  const candidate = latest;
  const releaseDate = new Date(`${candidate.release.date}T00:00:00Z`);
  const daysAgo = Math.max(0, (now.getTime() - releaseDate.getTime()) / (1000 * 60 * 60 * 24));
  const requiredDays = candidate.semver.patch === 0 ? minorCooldownDays : patchCooldownDays;

  return {
    needsUpdate: false,
    currentVersion: current.raw,
    targetVersion: candidate.semver.raw,
    releaseDate: candidate.release.date,
    daysAgo: Math.floor(daysAgo),
    reason: `Candidate ${candidate.semver.raw} (released ${candidate.release.date}, ${daysAgo.toFixed(1)} days ago) is within cooldown (requires ${requiredDays} days)`,
  };
}

/**
 * Updates .node-version and mise.toml with the new target version.
 */
export function updateVersionFiles(rootDir: string, newVersion: string): void {
  const nodeVersionPath = path.join(rootDir, ".node-version");
  const miseTomlPath = path.join(rootDir, "mise.toml");

  // 1. Update .node-version
  fs.writeFileSync(nodeVersionPath, `${newVersion}\n`, "utf-8");
  console.log(`Updated ${nodeVersionPath} -> ${newVersion}`);

  // 2. Update mise.toml
  if (fs.existsSync(miseTomlPath)) {
    let miseContent = fs.readFileSync(miseTomlPath, "utf-8");
    miseContent = miseContent.replace(/(node\s*=\s*)"[^"]+"/, `$1"${newVersion}"`);
    fs.writeFileSync(miseTomlPath, miseContent, "utf-8");
    console.log(`Updated ${miseTomlPath} -> node = "${newVersion}"`);
  }
}

/**
 * Main execution function when run as CLI.
 */
export async function main(args: string[] = process.argv.slice(2)): Promise<void> {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const rootDir = path.resolve(__dirname, "..");

  const isDryRun = args.includes("--dry-run");
  const isForce = args.includes("--force");

  const nodeVersionFile = path.join(rootDir, ".node-version");
  if (!fs.existsSync(nodeVersionFile)) {
    throw new Error(`.node-version not found at ${nodeVersionFile}`);
  }
  const currentVersion = fs.readFileSync(nodeVersionFile, "utf-8").trim();

  console.log(`Checking Node.js updates for current version: ${currentVersion}...`);
  console.log(`Options: dry-run=${isDryRun}, force=${isForce}`);

  const res = await fetch("https://nodejs.org/dist/index.json");
  if (!res.ok) {
    throw new Error(`Failed to fetch nodejs releases: ${res.status} ${res.statusText}`);
  }
  const releases = (await res.json()) as NodeRelease[];

  const result = determineNodeUpdate(currentVersion, releases, { force: isForce });

  console.log(`Result: needsUpdate=${result.needsUpdate}`);
  console.log(`Reason: ${result.reason}`);

  if (result.needsUpdate && result.targetVersion) {
    console.log(
      `\n🎉 Target Version Found: ${result.targetVersion} (Released: ${result.releaseDate})`,
    );

    if (!isDryRun) {
      updateVersionFiles(rootDir, result.targetVersion);
    } else {
      console.log(`[DRY-RUN] Skipped writing files.`);
    }

    // Set GitHub Actions outputs if running in CI
    const githubOutput = process.env.GITHUB_OUTPUT;
    if (githubOutput) {
      const outputs = [
        `needs_update=true`,
        `new_version=${result.targetVersion}`,
        `old_version=${result.currentVersion}`,
        `release_date=${result.releaseDate}`,
        `days_ago=${result.daysAgo}`,
      ].join("\n");
      fs.appendFileSync(githubOutput, `${outputs}\n`, "utf-8");
      console.log("GitHub Actions step outputs configured.");
    }
  } else {
    const githubOutput = process.env.GITHUB_OUTPUT;
    if (githubOutput) {
      fs.appendFileSync(githubOutput, "needs_update=false\n", "utf-8");
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`Error checking Node.js updates:`, err);
    process.exit(1);
  });
}
