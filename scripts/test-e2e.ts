import fs from "node:fs";
import path from "node:path";
import { execa } from "execa";
import pc from "picocolors";
import { getConfig } from "../src/config.js";
import { extractAudio } from "../src/ffmpeg.js";
import { generateFixtures } from "./setup-fixtures.js";

const FIXTURES_DIR = path.resolve(process.cwd(), "fixtures");
const OUTPUT_DIR = path.join(FIXTURES_DIR, "output");
const OUTPUT_BASE = path.join(OUTPUT_DIR, "e2e_sample");

async function runE2ETest(): Promise<void> {
  console.log(pc.bold(pc.cyan("\n🧪 Starting vsub-cli Local E2E Smoke Test\n")));
  const startTime = Date.now();

  // 1. Prepare Fixtures
  console.log("📦 [1/4] Preparing test media fixtures...");
  const { videoPath, audioPath } = await generateFixtures(true);

  // 2. Build project to test production bundle
  console.log("\n🔨 [2/4] Compiling TypeScript build (tsc)...");
  await execa("pnpm", ["build"]);
  console.log(pc.green("   ✓ dist/index.js built successfully."));

  // 3. Offline Pipeline Verification (FFmpeg media extraction & optimization)
  console.log("\n🔊 [3/4] Verifying local FFmpeg audio extraction & optimization pipeline...");
  const config = getConfig();
  const extractVideoResult = await extractAudio(videoPath, config.ffmpegPath);
  if (
    extractVideoResult.audioPaths.length === 0 ||
    !fs.existsSync(extractVideoResult.audioPaths[0] ?? "")
  ) {
    throw new Error("Local video audio extraction failed to produce audio file.");
  }
  const videoAudioSize = fs.statSync(extractVideoResult.audioPaths[0] ?? "").size;
  await extractVideoResult.cleanup();

  const extractAudioResult = await extractAudio(audioPath, config.ffmpegPath);
  if (
    extractAudioResult.audioPaths.length === 0 ||
    !fs.existsSync(extractAudioResult.audioPaths[0] ?? "")
  ) {
    throw new Error("Local audio optimization failed to produce audio file.");
  }
  const audioAudioSize = fs.statSync(extractAudioResult.audioPaths[0] ?? "").size;
  await extractAudioResult.cleanup();

  console.log(
    pc.green(
      `   ✓ Local FFmpeg media pipeline passed (Video: ${(videoAudioSize / 1024).toFixed(1)} KB, Audio: ${(audioAudioSize / 1024).toFixed(1)} KB temp audio).`,
    ),
  );

  // 4. Check API Keys for Live Cloud Pipeline
  console.log("\n🌐 [4/4] Checking Cloud API Pipeline (Groq Whisper & Gemini)...");
  const hasGroq = Boolean(config.groqApiKey);
  const hasGemini = Boolean(config.geminiApiKey);

  if (!hasGroq || !hasGemini) {
    console.log(pc.yellow("\n⚠️ Live Cloud API keys are not configured in environment or .env:"));
    if (!hasGroq) console.log(pc.yellow("   - Groq API Key: (Missing)"));
    if (!hasGemini) console.log(pc.yellow("   - Gemini API Key: (Missing)"));

    console.log(pc.cyan("\n💡 Next Step for Live API Testing:"));
    console.log(
      pc.dim(
        "   1. Create a '.env' file in the project root (see .env.example) with:\n" +
          "      GROQ_API_KEY=your_key\n" +
          "      GEMINI_API_KEY=your_key",
      ),
    );
    console.log(
      pc.dim(
        "   2. Or set via CLI:\n" +
          "      pnpm dev config set --groq-key <key> --gemini-key <key>\n",
      ),
    );
    console.log(
      pc.bold(
        pc.green(
          `✅ Local media generation & FFmpeg verification PASSED in ${(
            (Date.now() - startTime) / 1000
          ).toFixed(2)}s (Cloud API test skipped due to missing keys).\n`,
        ),
      ),
    );
    return;
  }

  // Clean and prepare output dir
  if (fs.existsSync(OUTPUT_DIR)) {
    fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log("   🚀 Executing CLI end-to-end pipeline on sample video...");
  console.log(
    pc.dim(
      `      node dist/index.js ${videoPath} -t en -f srt,vtt,txt,json -o ${OUTPUT_BASE} --save-original`,
    ),
  );

  const cliStart = Date.now();
  await execa(
    "node",
    [
      "dist/index.js",
      videoPath,
      "-t",
      "en",
      "-f",
      "srt,vtt,txt,json",
      "-o",
      OUTPUT_BASE,
      "--save-original",
    ],
    {
      env: process.env,
      stdio: "inherit",
    },
  );

  const cliElapsedSec = ((Date.now() - cliStart) / 1000).toFixed(2);
  console.log(pc.green(`   ✓ CLI execution finished in ${cliElapsedSec}s`));

  // Assert and Validate Output Files
  console.log("\n🔍 Validating generated output formats...");

  const expectedFiles = [
    {
      file: `${OUTPUT_BASE}.srt`,
      name: "Translated SRT",
      validate: (content: string) => {
        if (!content.includes("-->")) {
          throw new Error("Missing timecode separator '-->'");
        }
        if (!/\d{2}:\d{2}:\d{2},\d{3}/.test(content)) {
          throw new Error("Invalid SRT timestamp format (expected comma for ms)");
        }
      },
    },
    {
      file: `${OUTPUT_BASE}.vtt`,
      name: "Translated WebVTT",
      validate: (content: string) => {
        if (!content.startsWith("WEBVTT")) {
          throw new Error("Missing WEBVTT header");
        }
        if (!/\d{2}:\d{2}:\d{2}\.\d{3}/.test(content)) {
          throw new Error("Invalid WebVTT timestamp format (expected period for ms)");
        }
      },
    },
    {
      file: `${OUTPUT_BASE}.txt`,
      name: "Translated Plain Text",
      validate: (content: string) => {
        if (content.includes("-->")) {
          throw new Error("Plain text should not contain timecodes");
        }
        if (content.trim().length === 0) {
          throw new Error("Plain text file is empty");
        }
      },
    },
    {
      file: `${OUTPUT_BASE}.json`,
      name: "Structured JSON",
      validate: (content: string) => {
        const parsed = JSON.parse(content);
        if (!Array.isArray(parsed) || parsed.length === 0) {
          throw new Error("JSON must be a non-empty array of subtitle entries");
        }
        const first = parsed[0];
        if (typeof first.startTime !== "string" || typeof first.text !== "string") {
          throw new Error("JSON entry format invalid (missing startTime or text)");
        }
      },
    },
    {
      file: path.join(FIXTURES_DIR, "sample.ja.srt"),
      name: "Original Raw Subtitle (--save-original)",
      validate: (content: string) => {
        if (!content.includes("-->")) {
          throw new Error("Missing timecode in original saved SRT");
        }
      },
    },
  ];

  let allPassed = true;

  for (const item of expectedFiles) {
    if (!fs.existsSync(item.file)) {
      console.error(
        pc.red(`   ✗ [FAIL] Missing expected output file: ${path.basename(item.file)}`),
      );
      allPassed = false;
      continue;
    }

    const content = fs.readFileSync(item.file, "utf-8");
    try {
      item.validate(content);
      const sizeKb = (fs.statSync(item.file).size / 1024).toFixed(2);
      console.log(
        pc.green(`   ✓ [PASS] ${item.name} (${path.basename(item.file)}) [${sizeKb} KB]`),
      );
    } catch (err: unknown) {
      console.error(pc.red(`   ✗ [FAIL] ${item.name} validation error: ${(err as Error).message}`));
      allPassed = false;
    }
  }

  // 5. Test `vsub translate` subcommand on generated subtitle
  console.log("\n🔄 Testing 'vsub translate' direct subtitle translation subcommand...");
  const translateOutputBase = path.join(OUTPUT_DIR, "translate_e2e_sample");
  console.log(
    pc.dim(
      `      node dist/index.js translate ${OUTPUT_BASE}.srt -t ja -f srt,vtt -o ${translateOutputBase}`,
    ),
  );

  const translateStart = Date.now();
  await execa(
    "node",
    [
      "dist/index.js",
      "translate",
      `${OUTPUT_BASE}.srt`,
      "-t",
      "ja",
      "-f",
      "srt,vtt",
      "-o",
      translateOutputBase,
    ],
    {
      env: process.env,
      stdio: "inherit",
    },
  );

  const translateElapsed = ((Date.now() - translateStart) / 1000).toFixed(2);
  console.log(pc.green(`   ✓ 'vsub translate' completed in ${translateElapsed}s`));

  const translateSrtPath = `${translateOutputBase}.srt`;
  const translateVttPath = `${translateOutputBase}.vtt`;

  if (!fs.existsSync(translateSrtPath) || !fs.existsSync(translateVttPath)) {
    throw new Error("'vsub translate' failed to generate expected output files.");
  }
  console.log(
    pc.green(
      `   ✓ [PASS] Translated SRT (${path.basename(translateSrtPath)}) & VTT (${path.basename(translateVttPath)}) generated successfully.`,
    ),
  );

  const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(2);

  if (!allPassed) {
    console.error(pc.red(`\n❌ E2E Smoke Test failed. See errors above.\n`));
    process.exit(1);
  }

  // Display sample output
  const sampleSrt = fs.readFileSync(`${OUTPUT_BASE}.srt`, "utf-8").trim();
  console.log(pc.bold(pc.cyan("\n📄 Sample Translated SRT Output:")));
  console.log(pc.dim("----------------------------------------"));
  console.log(sampleSrt);
  console.log(pc.dim("----------------------------------------"));

  console.log(
    pc.bold(pc.green(`\n🎉 E2E Smoke Test PASSED! All outputs verified in ${totalElapsed}s.\n`)),
  );
}

runE2ETest().catch((err) => {
  console.error(pc.red("\n❌ Fatal error during E2E test execution:"), err);
  process.exit(1);
});
