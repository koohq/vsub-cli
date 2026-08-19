import fs from "node:fs";
import path from "node:path";
import { execa } from "execa";
import { getConfig } from "../src/config.js";
import { checkFfmpeg } from "../src/ffmpeg.js";

const FIXTURES_DIR = path.resolve(process.cwd(), "fixtures");
const SAMPLE_MP4 = path.join(FIXTURES_DIR, "sample.mp4");
const SAMPLE_MP3 = path.join(FIXTURES_DIR, "sample.mp3");
const SPEECH_WAV = path.join(FIXTURES_DIR, "speech.wav");

const SPEECH_TEXT = "こんにちは。これは動画字幕生成ツールの自動テストです。";

export async function generateFixtures(force = false): Promise<{
  videoPath: string;
  audioPath: string;
}> {
  if (!fs.existsSync(FIXTURES_DIR)) {
    fs.mkdirSync(FIXTURES_DIR, { recursive: true });
  }

  if (
    !force &&
    fs.existsSync(SAMPLE_MP4) &&
    fs.existsSync(SAMPLE_MP3) &&
    fs.statSync(SAMPLE_MP4).size > 0 &&
    fs.statSync(SAMPLE_MP3).size > 0
  ) {
    return { videoPath: SAMPLE_MP4, audioPath: SAMPLE_MP3 };
  }

  const { ffmpegPath } = getConfig();
  await checkFfmpeg(ffmpegPath);

  console.log("🎙️ Generating speech audio via OS Text-to-Speech...");

  let ttsSuccess = false;

  // 1. Generate speech.wav using OS-native TTS
  if (process.platform === "win32") {
    try {
      const normalizedWavPath = SPEECH_WAV.replace(/\\/g, "/");
      const psCommand = `
        Add-Type -AssemblyName System.Speech;
        $s = New-Object System.Speech.Synthesis.SpeechSynthesizer;
        $s.SetOutputToWaveFile('${normalizedWavPath}');
        $s.Speak('${SPEECH_TEXT}');
        $s.Dispose();
      `;
      await execa("powershell", ["-NoProfile", "-NonInteractive", "-Command", psCommand]);
      if (fs.existsSync(SPEECH_WAV) && fs.statSync(SPEECH_WAV).size > 0) {
        ttsSuccess = true;
      }
    } catch (err) {
      console.warn("⚠️ Windows TTS generation warning:", err);
    }
  } else if (process.platform === "darwin") {
    try {
      const tempAiff = path.join(FIXTURES_DIR, "temp_speech.aiff");
      await execa("say", [SPEECH_TEXT, "-o", tempAiff]);
      await execa(ffmpegPath, ["-y", "-i", tempAiff, SPEECH_WAV]);
      if (fs.existsSync(tempAiff)) {
        fs.unlinkSync(tempAiff);
      }
      if (fs.existsSync(SPEECH_WAV) && fs.statSync(SPEECH_WAV).size > 0) {
        ttsSuccess = true;
      }
    } catch (err) {
      console.warn("⚠️ macOS say TTS generation warning:", err);
    }
  }

  // Fallback if OS TTS is not available (e.g. Linux CI without speech synth)
  if (!ttsSuccess) {
    console.log("ℹ️ Using synthetic audio tone fallback (OS TTS unavailable)...");
    await execa(ffmpegPath, [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=4",
      "-ar",
      "16000",
      "-ac",
      "1",
      SPEECH_WAV,
    ]);
  }

  console.log("🎬 Generating test video (sample.mp4) and audio (sample.mp3)...");

  // 2. Combine with lavfi testsrc video pattern (4 seconds, 360p)
  await execa(ffmpegPath, [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc=duration=4:size=640x360:rate=30",
    "-i",
    SPEECH_WAV,
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-shortest",
    SAMPLE_MP4,
  ]);

  // 3. Generate MP3 version
  await execa(ffmpegPath, ["-y", "-i", SPEECH_WAV, "-c:a", "libmp3lame", "-q:a", "2", SAMPLE_MP3]);

  // Clean up intermediate WAV if created
  if (fs.existsSync(SPEECH_WAV)) {
    fs.unlinkSync(SPEECH_WAV);
  }

  console.log("✅ Fixtures generated successfully:");
  console.log(
    `   - Video: fixtures/sample.mp4 (${(fs.statSync(SAMPLE_MP4).size / 1024).toFixed(1)} KB)`,
  );
  console.log(
    `   - Audio: fixtures/sample.mp3 (${(fs.statSync(SAMPLE_MP3).size / 1024).toFixed(1)} KB)`,
  );

  return { videoPath: SAMPLE_MP4, audioPath: SAMPLE_MP3 };
}

// Allow direct execution
if (process.argv[1]?.includes("setup-fixtures")) {
  const force = process.argv.includes("--force") || process.argv.includes("-f");
  generateFixtures(force).catch((err) => {
    console.error("❌ Failed to setup fixtures:", err);
    process.exit(1);
  });
}
