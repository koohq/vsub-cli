# PRD: vsub-cli (Video Subtitle CLI)

## 1. 概要
`vsub-cli` は、動画ファイル（.mp4, .mkv 等）から音声の抽出・音声認識（文字起こし）・多言語翻訳を一貫して行い、字幕ファイル（`.[target_lang].srt`）を自動生成する Node.js / TypeScript 製の CLI ツールです。

* **文字起こし**: Groq API（`whisper-large-v3-turbo`）を利用し、元動画の言語を自動検出しながらタイムコード付きテキストを高速生成。
* **音声最適化**: `ffmpeg` を用いて 16kHz モノラル / 低ビットレート音声へ圧縮し、Groq の 25MB アップロード制限をクリア（必要に応じて自動分割処理）。
* **高品質翻訳**: Google Gemini API（`@google/genai`）を利用。SRT 構造を一度 JSON 化してテキスト部分のみをチャンク分割翻訳することで、タイムコードの破綻を 100% 防ぎ自然な会話体に翻訳。
* **多言語対応**: デフォルトの日本語（`ja`）に加え、オプション指定により任意の言語への字幕生成が可能。

---

## 2. 技術スタック・開発環境

* **Language/Runtime**: Node.js (v26+), TypeScript
* **Package Manager**: `pnpm` (推奨規定に準拠)
* **Linter / Formatter**: `Biome` (`biome.json`)
* **Libraries**:
  * `@google/genai` (Google Gen AI SDK)
  * `groq-sdk` (Groq Official SDK)
  * `commander` (CLI オプション解析)
  * `dotenv` (環境変数管理)
  * `execa` (外部プロセス実行)
* **External Tools**:
  * `ffmpeg` (システム PATH または指定パス)
* **External APIs**:
  * Groq API (Speech-to-Text)
  * Google Gemini API (Translation)

---

## 3. 入出力仕様・CLI インターフェース

### 基本コマンド
```bash
vsub <video-file> [options]
```

### CLI オプション
* `-t, --target-lang <lang>`: 翻訳先の言語コード（デフォルト: `ja`）。
* `-o, --output <path>`: 出力する字幕ファイルのパスを指定（未指定時は `[入力動画のディレクトリ]/[動画名].[target_lang].srt`）。
* `--ffmpeg-path <path>`: `ffmpeg` 実行ファイルのパスを指定（未指定時は環境変数 `FFMPEG_PATH` またはシステム `PATH` を検索）。
* `--keep-audio`: 処理途中で抽出した一時音声ファイルを削除せずに保持するデバッグ用オプション。
* `--verbose`: 詳細なログ（APIレスポンスや進行状況）を標準出力に表示。

### 出力例
`sample.mp4` に対しデフォルト実行した場合：
* 生成物: `sample.ja.srt`
* ※中間生成された一時音声データ（`sample.tmp.m4a`）は完了時に自動クリーンアップ。

---

## 4. 処理フローの詳細

1. **環境・入力検証**
   * コマンドライン引数で渡された動画ファイルの存在確認。
   * `ffmpeg` 実行ファイルの存在確認（`--ffmpeg-path` > `FFMPEG_PATH` > システム `PATH` の順で検索）。
   * 必要な API キー（`GROQ_API_KEY`, `GEMINI_API_KEY`）の存在確認。
2. **音声抽出 & 最適化**
   * `ffmpeg` を実行し、16kHz モノラル / 32~48kbps の軽量な音声（.m4a または .mp3）を抽出。
   * コマンド例: `ffmpeg -i input.mp4 -vn -ar 16000 -ac 1 -b:a 48k temp_audio.m4a`
   * 音声サイズが Groq の制限（25MB）を超える超長尺ファイルの場合は、`ffmpeg` で自動的に分割（例: 30分単位）して管理。
3. **Groq API による文字起こし**
   * 抽出した音声データを Groq API (`whisper-large-v3-turbo`) へ送信。
   * 言語は自動検出（Auto-detect）させ、SRT フォーマットテキストを取得。
4. **SRT パース & Gemini API による分割翻訳**
   * 取得した SRT テキストを CLI 内で JSON 配列（`[{ id, startTime, endTime, text }]`）にパース。
   * 字幕テキスト部分のみを 50〜100 件単位のチャンクに分割し、Gemini API (`@google/genai`) に送信。
   * システムプロンプト例:
     * 指定された言語 (`target_lang`) へ自然な会話体で翻訳すること。
     * 入力テキストの配列数・順序を変更せず、対応する翻訳結果の配列を返却すること。
   * 翻訳結果を元のタイムコードと結合し、完成版の SRT 文字列を再構築する。
5. **字幕ファイルの保存・クリーンアップ**
   * 翻訳済み SRT テキストを目的のパス（例: `sample.ja.srt`）へ書き出し。
   * `--keep-audio` オプションが指定されていない場合は一時音声ファイルを削除。

---

## 5. ディレクトリ構造・ファイル構成案

```text
vsub-cli/
├── package.json
├── tsconfig.json
├── biome.json
├── .env.example
├── .gitignore
├── README.md
├── docs/
│   └── prd.md
└── src/
    ├── index.ts        # CLI エントリーポイント (Commander 設定・全体の流れの制御)
    ├── config.ts       # API キーおよび CLI 設定の読み込み
    ├── ffmpeg.ts       # ffmpeg 存在確認・音声抽出・最適化ロジック
    ├── srt.ts          # SRT パース / 再構築ユーティリティ
    ├── groq.ts         # Groq API (Whisper) 文字起こし呼び出し
    └── gemini.ts       # Gemini API 翻訳処理 (チャンク分割制御)
```

---

## 6. 環境変数 (`.env.example`)

```env
# Groq API Key (https://console.groq.com/)
GROQ_API_KEY=your_groq_api_key_here

# Google Gemini API Key (https://aistudio.google.com/)
GEMINI_API_KEY=your_gemini_api_key_here

# (任意) ffmpeg のカスタム実行ファイルパス。未指定時は PATH を検索
# FFMPEG_PATH=C:\tools\ffmpeg\bin\ffmpeg.exe
```

---

## 7. 非機能要件・エラーハンドリング

* **環境エラー表示**:
  * `ffmpeg` が見つからない場合は「`ffmpeg` がインストールされていないか PATH が通っていません。環境変数 `FFMPEG_PATH` または `--ffmpeg-path` オプションでパスを指定してください」と案内を表示。
  * `.env` や環境変数に API キーが設定されていない場合は適切な取得手順と共にエラー終了。
* **API エラー・レートリミット対策**:
  * Groq や Gemini の呼び出し失敗時に分かりやすいエラーメッセージを表示。
  * 翻訳チャンク処理で一時的なネットワークエラーが発生した場合の自動リトライ（最大 3 回）。
* **インタラクティブな進捗表示**:
  * 実行中のステータスを表示（例: `[1/4] 音声を抽出中 (16kHz モノラル)...`, `[2/4] Groqで文字起こし中...`, `[3/4] Geminiで翻訳中 (1/3 チャンク)...`, `[4/4] 字幕ファイル保存完了: sample.ja.srt`）。
