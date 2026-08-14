# PRD: vsub-cli (Video Subtitle CLI)

## 1. 概要
`vsub-cli` は、動画ファイル（.mp4, .mkv 等）から音声の抽出・音声認識（文字起こし）・多言語翻訳を一貫して行い、字幕ファイル（`.[target_lang].srt`）を自動生成する Node.js / TypeScript 製の CLI ツールです。

* **文字起こし**: Groq API（`whisper-large-v3-turbo`）を利用し、元動画の言語を自動検出しながらタイムコード付きテキストを高速生成。
* **音声最適化**: `ffmpeg` を用いて 16kHz モノラル / 低ビットレート音声へ圧縮し、Groq の 25MB アップロード制限をクリア（必要に応じて自動分割処理）。
* **高品質翻訳**: Google Gemini API（`@google/genai`）を利用。SRT 構造を一度 JSON 化してテキスト部分のみをチャンク分割翻訳することで、タイムコードの破綻を 100% 防ぎ自然な会話体に翻訳。
* **多言語対応**: デフォルトの日本語（`ja`）に加え、オプション指定により任意の言語への字幕生成が可能。
* **設定・環境管理**: グローバル設定ファイル（`config.json`）や対話型セットアップにより、APIキーおよび FFmpeg パスを永続的かつ容易に管理可能。

---

## 2. 技術スタック・開発環境

* **Language/Runtime**: Node.js (v26+), TypeScript (v7+)
* **Package Manager**: `pnpm` (サプライチェーン保護規定 `minimumReleaseAge: 4320` 準拠)
* **Linter / Formatter**: `Biome` (`biome.json`)
* **Libraries**:
  * `@google/genai` (Google Gen AI SDK)
  * `groq-sdk` (Groq Official SDK)
  * `commander` (CLI オプション・サブコマンド解析)
  * `dotenv` (環境変数管理)
  * `execa` (外部プロセス実行)
* **External Tools**:
  * `ffmpeg` (システム PATH、環境変数 `VSUB_FFMPEG_PATH` / `FFMPEG_PATH`、または設定ファイル指定パス)
* **External APIs**:
  * Groq API (Speech-to-Text)
  * Google Gemini API (Translation)

---

## 3. 入出力仕様・CLI インターフェース

### 基本コマンド構造
```bash
# 動画処理コマンド
vsub <video-file> [options]

# グローバル設定管理サブコマンド
vsub config <subcommand>
```

### 1) 動画処理コマンドとオプション
```bash
vsub <video-file> [options]
```
* `-t, --target-lang <lang>`: 翻訳先の言語コード（デフォルト: `ja`）。
* `-o, --output <path>`: 出力する字幕ファイルのパスを指定（未指定時は `[入力動画のディレクトリ]/[動画名].[target_lang].srt`）。
* `--ffmpeg-path <path>`: `ffmpeg` 実行ファイルのパスを指定。
* `--keep-audio`: 処理途中で抽出した一時音声ファイルを削除せずに保持するデバッグ用オプション。
* `--no-translate`: Gemini 翻訳処理をスキップし、文字起こし結果（原語）の字幕ファイルを出力する。
* `--save-original`: 翻訳処理を行う場合でも、文字起こし直後の原語字幕ファイル（`.[detected_lang].srt` または `.orig.srt`）を並行して保存する。
* `--force-translate`: 検出された音声言語と翻訳先言語（`--target-lang`）が同じ場合でも、強制的に Gemini 翻訳を実行する。
* `--verbose`: 詳細なログ（APIレスポンスや進行状況）を標準出力に表示。

### 2) 設定管理サブコマンド (`vsub config`)
* `vsub config path`: グローバル設定ファイル（`config.json`）の保存パスを表示。
* `vsub config show`: 現在設定されている API キー（マスク表示）および FFmpeg パスを表示。
* `vsub config set [--groq-key <key>] [--gemini-key <key>] [--ffmpeg-path <path>]`: API キーや FFmpeg パスをグローバル設定に保存。
* `vsub config init`: 対話型（プロンプト）で API キーを入力・永続保存。

### 出力例
`sample.mp4` に対しデフォルト実行した場合：
* 生成物: `sample.ja.srt`
* ※中間生成された一時音声データは完了時に自動クリーンアップ。

`sample.mp4 --save-original -t ja` 実行（元音声が英語 `en` の場合）：
* 生成物: `sample.ja.srt` （日本語翻訳字幕）
* 生成物: `sample.en.srt` （英語原語字幕）

---

## 4. 処理フローの詳細

1. **環境・入力・APIキー検証**
   - コマンドライン引数で渡された動画ファイルの存在確認。
   - CLI 引数 > 環境変数 (`VSUB_` プレフィックス優先) > グローバル設定ファイル (`config.json`) の優先順位で設定をロード。
   - 必要な API キーが未設定の場合、対話型ターミナルであれば自動的にキー入力を要求し `config.json` に永続保存。
   - ※ `--no-translate` 指定時は Gemini API キーが未設定でも文字起こし処理を続行（遅延キー検証）。
   - `ffmpeg` 実行ファイルの存在確認。
2. **音声抽出 & 最適化**
   - `ffmpeg` を実行し、16kHz モノラル / 低ビットレートの軽量な音声（.m4a）を抽出。
   - 音声サイズが Groq の制限（25MB）を超える超長尺ファイルの場合は、`ffmpeg` で自動的に分割して管理。
3. **Groq API による文字起こし**
   - 抽出した音声データを Groq API (`whisper-large-v3-turbo`) へ送信。
   - 言語を自動検出（Auto-detect）し、検出言語コードおよび SRT レスポンスを取得。
4. **スマート翻訳判定 & SRT パース & Gemini API 分割翻訳**
   - 原文字幕の並行保存が指定されている場合（`--save-original`）、このタイミングで原語 SRT をディスクに保存。
   - **スマートスキップ判定**:
     - `--no-translate` が指定されている場合、または「検出言語 == ターゲット言語」かつ `--force-translate` が指定されていない場合、翻訳をスキップ。
   - 翻訳実行時:
     - SRT テキストを JSON 配列（`[{ id, startTime, endTime, text }]`）にパース。
     - 字幕テキスト部分を 50〜100 件単位のチャンクに分割し、Gemini API (`@google/genai`) に送信して自然な会話体に翻訳。
     - 翻訳結果を元のタイムコードと結合し、完成版の SRT 文字列を再構築。
5. **字幕ファイルの保存・クリーンアップ**
   - 完成した SRT テキストを目的のパスへ書き出し。
   - `--keep-audio` オプションが指定されていない場合は一時音声ファイルを削除。

---

## 5. 設定の優先順位と構成

### 1) 設定読み込みの優先順位（高い順）
1. CLI コマンドライン引数（`--ffmpeg-path` 等）
2. プレフィックス付き環境変数 (`VSUB_GROQ_API_KEY`, `VSUB_GEMINI_API_KEY`, `VSUB_FFMPEG_PATH`)
3. 標準環境変数 (`GROQ_API_KEY`, `GEMINI_API_KEY`, `FFMPEG_PATH`)
4. グローバル設定ファイル (`config.json`)

### 2) グローバル設定ファイルの保存場所
* **Windows**: `%APPDATA%\vsub\config.json`
* **macOS / Linux**: `~/.config/vsub/config.json` (または `$XDG_CONFIG_HOME/vsub/config.json`)

---

## 6. ディレクトリ構造・ファイル構成

```text
vsub-cli/
├── package.json
├── tsconfig.json
├── biome.json
├── .env.example
├── README.md
├── docs/
│   └── prd.md
└── src/
    ├── index.ts        # CLI エントリーポイント (Commander 設定・メインフロー制御・サブコマンド定義)
    ├── config.ts       # 設定の読み込み・永続化・対話型キー登録・優先順位制御
    ├── ffmpeg.ts       # ffmpeg 存在確認・音声抽出・最適化ロジック
    ├── srt.ts          # SRT パース / 再構築ユーティリティ
    ├── groq.ts         # Groq API (Whisper) 文字起こし呼び出し
    └── gemini.ts       # Gemini API 翻訳処理 (チャンク分割制御)
```

---

## 7. 非機能要件・エラーハンドリング

* **環境エラー表示**:
  * `ffmpeg` が見つからない場合は丁寧なガイドを表示。
  * API キー未設定かつ非対話環境（CI/CDなど）の場合は明確なエラーメッセージと共に即座に非ゼロ終了。
* **対話的 UX**:
  * 初回実行時やキー未設定時に自動プロンプトで入力を促し、次回以降の手間を省略。
  * `--no-translate` や自動言語一致スキップ時、不要な API キーエラーを出さない親切設計。
* **インタラクティブな進捗表示**:
  * 各ステップ（`[1/4] 音声を抽出中...`, `[2/4] Groqで文字起こし中...`, `[3/4] Geminiで翻訳中...`, `[4/4] 字幕ファイル保存完了...`）での分かりやすい絵文字・ステータス表示。

