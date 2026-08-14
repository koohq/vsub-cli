#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { ensureApiKeys, getConfig, getGlobalConfigPath, saveGlobalConfig } from "./config.js";
import { checkFfmpeg, extractAudio } from "./ffmpeg.js";
import { translateSrtEntries } from "./gemini.js";
import { transcribeAudioSegments } from "./groq.js";
import { stringifySrt } from "./srt.js";

const program = new Command();

program
  .name("vsub")
  .description(
    "動画ファイルから音声を抽出し、Groqで文字起こし・Geminiで多言語字幕(SRT)を自動生成するCLIツール",
  );

// サブコマンド: config
const configCmd = program.command("config").description("グローバル設定の確認・変更を行います");

configCmd
  .command("path")
  .description("設定ファイルの保存場所を表示します")
  .action(() => {
    console.log(`設定ファイルのパス: ${getGlobalConfigPath()}`);
  });

configCmd
  .command("show")
  .description("現在の設定内容を表示します")
  .action(() => {
    const configPath = getGlobalConfigPath();
    const resolvedConfig = getConfig();

    console.log(`\n📁 設定ファイル: ${configPath}`);
    console.log("----------------------------------------");
    console.log(
      `Groq API Key   : ${resolvedConfig.groqApiKey ? `${resolvedConfig.groqApiKey.slice(0, 4)}...${resolvedConfig.groqApiKey.slice(-4)}` : "(未設定)"}`,
    );
    console.log(
      `Gemini API Key : ${resolvedConfig.geminiApiKey ? `${resolvedConfig.geminiApiKey.slice(0, 4)}...${resolvedConfig.geminiApiKey.slice(-4)}` : "(未設定)"}`,
    );
    console.log(`FFmpeg Path    : ${resolvedConfig.ffmpegPath}`);
    console.log("----------------------------------------\n");
  });

configCmd
  .command("set")
  .description("グローバル設定にAPI KeyやFFmpegパスを保存します")
  .option("--groq-key <key>", "Groq API Key")
  .option("--gemini-key <key>", "Gemini API Key")
  .option("--ffmpeg-path <path>", "FFmpeg 実行ファイルパス")
  .action((options: { groqKey?: string; geminiKey?: string; ffmpegPath?: string }) => {
    if (!options.groqKey && !options.geminiKey && !options.ffmpegPath) {
      console.log("⚠️ 保存する設定を指定してください。 (例: vsub config set --groq-key YOUR_KEY)");
      return;
    }

    saveGlobalConfig({
      ...(options.groqKey ? { groqApiKey: options.groqKey.trim() } : {}),
      ...(options.geminiKey ? { geminiApiKey: options.geminiKey.trim() } : {}),
      ...(options.ffmpegPath ? { ffmpegPath: options.ffmpegPath.trim() } : {}),
    });

    console.log(`✅ 設定を更新・保存しました: ${getGlobalConfigPath()}`);
  });

configCmd
  .command("init")
  .description("対話形式で API Key を初期設定します")
  .action(async () => {
    const config = getConfig();
    await ensureApiKeys({
      ...config,
      groqApiKey: "",
      geminiApiKey: "",
    });
  });

// メインアクション (動画ファイルの変換)
program
  .argument("[video-file]", "処理対象の動画ファイルパス (.mp4, .mkv, .mov 等)")
  .option("-t, --target-lang <lang>", "翻訳先の言語コード (例: ja, en, es)", "ja")
  .option("-o, --output <path>", "出力する字幕ファイルのパス")
  .option(
    "--ffmpeg-path <path>",
    "ffmpeg 実行ファイルのパス (未指定時は FFMPEG_PATH または PATH を探索)",
  )
  .option("--keep-audio", "中間生成した音声ファイルを削除せずに保持するデバッグオプション", false)
  .option("--verbose", "詳細なログを出力する", false)
  .action(
    async (
      videoFile: string | undefined,
      options: {
        targetLang: string;
        output?: string;
        ffmpegPath?: string;
        keepAudio?: boolean;
        verbose?: boolean;
      },
    ) => {
      if (!videoFile) {
        program.help();
        return;
      }

      try {
        const resolvedVideoPath = path.resolve(process.cwd(), videoFile);
        const rawConfig = getConfig(options.ffmpegPath);
        const verbose = Boolean(options.verbose);

        // API Key の確保（必要に応じて対話型プロンプトを起動）
        const config = await ensureApiKeys(rawConfig);
        await checkFfmpeg(config.ffmpegPath);

        console.log(`\n🎬 [vsub-cli] 処理を開始します: ${path.basename(resolvedVideoPath)}`);

        // 1. Audio extraction
        console.log("🔊 [1/4] 音声を抽出中 (16kHz モノラル / 低ビットレート)...");
        const { audioPaths, cleanup } = await extractAudio(
          resolvedVideoPath,
          config.ffmpegPath,
          verbose,
        );

        try {
          // 2. Transcription with Groq
          console.log("🎙️ [2/4] Groq API (Whisper) で文字起こし中...");
          const srtEntries = await transcribeAudioSegments(audioPaths, config.groqApiKey, verbose);

          if (srtEntries.length === 0) {
            console.warn("⚠️ 文字起こし結果から有効な字幕エントリが検出されませんでした。");
          }

          // 3. Translation with Gemini
          console.log(
            `🌐 [3/4] Gemini API で ${options.targetLang} へ字幕を翻訳中 (${srtEntries.length}件)...`,
          );
          const translatedEntries = await translateSrtEntries(
            srtEntries,
            options.targetLang,
            config.geminiApiKey,
            verbose,
          );

          // 4. Save output SRT
          const finalSrtContent = stringifySrt(translatedEntries);
          const videoDir = path.dirname(resolvedVideoPath);
          const videoExt = path.extname(resolvedVideoPath);
          const videoBaseName = path.basename(resolvedVideoPath, videoExt);

          const outputPath = options.output
            ? path.resolve(process.cwd(), options.output)
            : path.join(videoDir, `${videoBaseName}.${options.targetLang}.srt`);

          fs.writeFileSync(outputPath, finalSrtContent, "utf-8");
          console.log(`✨ [4/4] 字幕ファイルの保存完了: ${outputPath}\n`);
        } finally {
          if (!options.keepAudio) {
            await cleanup();
          } else {
            console.log(
              `ℹ️ [--keep-audio] 中間音声ファイルを保持しました: ${audioPaths.join(", ")}`,
            );
          }
        }
      } catch (error) {
        console.error(
          `\n❌ エラーが発生しました: ${error instanceof Error ? error.message : String(error)}\n`,
        );
        process.exit(1);
      }
    },
  );

program.parse(process.argv);
