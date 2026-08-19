# PRD: vsub-cli (Video & Audio Subtitle CLI)

## 1. 概要
`vsub-cli` は、動画ファイル（`.mp4`, `.mkv`, `.mov` 等）および音声ファイル（`.mp3`, `.wav`, `.m4a`, `.aac`, `.flac`, `.ogg`, `.opus` 等）から音声の抽出・最適化、音声認識（文字起こし）、多言語翻訳を一貫して行い、字幕・テキストファイル（`.srt`, `.vtt`, `.txt`, `.json`）を自動生成する Node.js / TypeScript 製の CLI ツールです。

* **高速文字起こし**: Groq API（`whisper-large-v3-turbo`）を利用し、元音声の言語を自動検出しながらタイムコード付きテキストを超高速生成。
* **音声最適化**: `ffmpeg` を用いて 16kHz モノラル / 低ビットレート音声へ圧縮し、Groq の 25MB アップロード制限をクリア（24.5MB 超過時は自動分割処理）。長尺音声分割時も実測再生時間に基づくミリ秒精度のタイムコード補正を実施。
* **高品質・並列翻訳**: Google Gemini API（`@google/genai`, デフォルト: `gemini-3.7-flash`）を利用。SRT 構造を JSON 化してテキスト部分のみをチャンク分割翻訳することでタイムコード破綻を 100% 防止。非同期ワーカプールによる並列リクエスト制御（デフォルト 3 並列）と指数バックオフ再試行を搭載。
* **マルチフォーマット出力**: 字幕フォーマット（`.srt`, `.vtt`）に加え、プレーンテキスト（`.txt`）や構造化データ（`.json`）の一括出力に対応。
* **複数言語一括翻訳**: カンマ区切り（`-t ja,en,zh`）で複数言語を同時指定可能。文字起こしは 1 回のみ実行し、各言語の字幕を一括生成。
* **用語集 & プロンプト制御**: `--glossary`（JSON またはインライン対訳）および `--prompt`（口調・スタイル指示）、`--whisper-prompt`（固有名詞ヒント）をサポート。
* **中間キャッシュ & 再開機構**: 文字起こしおよび各言語の翻訳結果を自動キャッシュ。再実行時や別言語追加時の API コストと待ち時間をゼロ化。
* **SRT 直接翻訳サブコマンド**: 音声処理・文字起こしをスキップし、既存の字幕ファイルから別言語・別フォーマットへ直接翻訳可能（`vsub translate`）。
* **設定・環境管理**: グローバル設定ファイル（`config.json`）や対話型セットアップにより、API キー・FFmpeg パス・デフォルトプロンプト・並行度を永続的かつ容易に管理可能。

---

## 2. 技術スタック・開発環境

* **Language/Runtime**: Node.js (v26+), TypeScript (v7+)
* **Package Manager**: `pnpm` (サプライチェーン保護規定 `minimumReleaseAge: 4320` 準拠)
* **Linter / Formatter**: `Biome` (`biome.json`)
* **Test Runner**: `Vitest` (`vitest.config.ts`)
* **Libraries**:
  * `@google/genai` (Google Gen AI SDK)
  * `groq-sdk` (Groq Official SDK)
  * `commander` (CLI オプション・サブコマンド解析)
  * `dotenv` (環境変数管理)
  * `execa` (外部プロセス実行)
  * `ora` (ターミナルスピナー表示)
  * `picocolors` (ターミナルカラーリング)
* **External Tools**:
  * `ffmpeg` / `ffprobe` (システム PATH、環境変数 `VSUB_FFMPEG_PATH` / `FFMPEG_PATH`、または設定ファイル指定パス)
* **External APIs**:
  * Groq API (Speech-to-Text: `whisper-large-v3-turbo`)
  * Google Gemini API (Translation: `gemini-3.7-flash`)

---

## 3. 入出力仕様・CLI インターフェース

### 基本コマンド構造
```bash
# メディア（動画・音声）処理コマンド
vsub <media-file> [options]

# 字幕ファイル直接翻訳サブコマンド
vsub translate <subtitle-file> [options]

# 中間キャッシュ管理サブコマンド
vsub cache <subcommand>

# グローバル設定管理サブコマンド
vsub config <subcommand>
```

### 1) メディア処理コマンドとオプション
```bash
vsub <media-file> [options]
```
* `<media-file>`: 処理対象の動画または音声ファイルパス（`.mp4`, `.mp3`, `.wav`, `.m4a`, `.mov`, `.aac`, `.flac`, `.ogg` 等）。
* `-t, --target-lang <langs>`: 翻訳先の言語コード。カンマ区切りで複数指定可能（例: `ja`, `en`, `ja,en,zh`。デフォルト: `ja`）。
* `-f, --format <formats>`: 出力フォーマット（`srt`, `vtt`, `txt`, `json` をカンマ区切りで複数指定可能。デフォルト: `srt`）。
* `-o, --output <path>`: 出力する字幕ファイルの個別パス指定（単一言語・単一フォーマット時）。
* `--ffmpeg-path <path>`: `ffmpeg` 実行ファイルのパスを指定。
* `--whisper-prompt <text>`: Groq Whisper 音声認識のヒントプロンプト（専門用語・固有名詞等）。
* `--prompt <instruction>`: Gemini 翻訳時のカスタム指示プロンプト（口調、スタイル、文字数制限等）。
* `--glossary <path-or-terms>`: 用語集 JSON ファイルパスまたはインライン対訳（`Key=Val,Key=Val`）。
* `--concurrency <number>`: Gemini API への同時並行リクエスト数（デフォルト: `3`）。
* `--no-cache`: 中間キャッシュを使用・保存せずに実行。
* `--fresh`: 既存キャッシュを無視して新規実行し、結果をキャッシュへ上書き。
* `--cache-dir <path>`: カスタムキャッシュ保存ディレクトリの指定。
* `--keep-audio`: 処理途中で抽出した一時音声ファイルを削除せずに保持するデバッグ用オプション。
* `--no-translate`: Gemini 翻訳処理をスキップし、文字起こし結果（原語）の字幕ファイルを出力する。
* `--save-original`: 翻訳処理を行う場合でも、文字起こし直後の原語字幕ファイルを並行して保存する。
* `--force-translate`: 検出された音声言語と翻訳先言語が同一の場合でも強制的に Gemini 翻訳を実行する。
* `--verbose`: 詳細なログ（API リクエスト詳細や中間データ）を表示。

### 2) 字幕直接翻訳サブコマンド (`vsub translate`)
```bash
vsub translate <subtitle-file> [options]
```
* `<subtitle-file>`: 翻訳対象の既存 SRT 字幕ファイルパス。
* オプション: `-t, --target-lang`, `-f, --format`, `-o, --output`, `--prompt`, `--glossary`, `--concurrency`, `--no-cache`, `--fresh`, `--cache-dir`, `--verbose` をサポート。
* 音声抽出および Groq 文字起こしをスキップし、Gemini API による高速翻訳・フォーマット変換のみを実行。

### 3) キャッシュ管理サブコマンド (`vsub cache`)
* `vsub cache path`: キャッシュディレクトリの保存パスを表示。
* `vsub cache stats`: キャッシュファイル数および使用容量を表示。
* `vsub cache clean`: 全中間キャッシュファイルを削除。

### 4) 設定管理サブコマンド (`vsub config`)
* `vsub config path`: グローバル設定ファイル（`config.json`）の保存パスを表示。
* `vsub config show`: 現在設定されている API キー（マスク表示）、FFmpeg パス、デフォルトプロンプト、並行度等を表示。
* `vsub config set [--groq-key <key>] [--gemini-key <key>] [--ffmpeg-path <path>] [--whisper-prompt <text>] [--prompt <text>] [--glossary <path-or-terms>] [--concurrency <num>]`: 各種設定をグローバルに永続保存。
* `vsub config init`: 対話型（プロンプト）で API キーを入力・初期設定。

---

## 4. 処理フローの詳細

```
[入力メディア (.mp4 / .mp3 等)]
       │
       ▼
1. 環境・入力・APIキー検証 & 設定ロード
       │
       ▼
2. キャッシュ確認（文字起こしキャッシュがあれば 3 を完全スキップ）
       │
       ▼
3. 音声抽出 & 最適化 (FFmpeg: 16kHz モノラル / 分割時は実再生時間を計測)
       │
       ▼
4. Groq Whisper 文字起こし (用語集ヒント適用 / 言語自動検出) ──> 文字起こしキャッシュ保存
       │
       ▼
5. 多言語並行翻訳ループ (各 targetLang ごと)
       │
       ├─ キャッシュ確認（翻訳済みならスキップ）
       ├─ 言語一致スキップ判定 (検出言語 == targetLang かつ !forceTranslate)
       ├─ SRT パース & チャンク分割
       └─ Gemini API 並列翻訳 (asyncPool: 3並列 / 用語集・指示プロンプト注入 / 指数バックオフ)
       │
       ▼
6. マルチフォーマット変換 & ファイル保存 (.srt, .vtt, .txt, .json)
       │
       ▼
7. 処理結果サマリー表示 (所要時間・行数・出力ファイル一覧) & 一時ファイル削除
```

1. **環境・入力・APIキー検証**
   - コマンドライン引数で渡されたメディアファイルの存在・拡張子確認。
   - CLI 引数 > 環境変数 (`VSUB_` プレフィックス優先) > グローバル設定ファイル (`config.json`) の優先順位で設定をロード。
   - API キーが未設定の場合、対話型ターミナルであれば自動的にキー入力を要求し `config.json` に永続保存（`--no-translate` 時は Gemini キー不要）。
2. **中間キャッシュ確認 (文字起こし)**
   - 入力メディアのファイルサイズ・最終更新日時のハッシュに基づき、既存の文字起こしキャッシュを探索。
   - キャッシュが存在する場合は、FFmpeg 音声抽出および Groq API 呼び出しを完全スキップ。
3. **音声抽出 & 最適化**
   - 入力種別を判定（動画の場合は音声抽出、音声ファイルの場合は最適化変換）。
   - `ffmpeg` を実行し、16kHz モノラル / 低ビットレート（32〜48kbps）の軽量な音声（`.m4a`）を生成。
   - 24.5MB を超える超長尺メディアの場合は自動分割し、各セグメントの実測再生時間（`durations`）を `ffprobe` / `ffmpeg` で取得。
4. **Groq API による文字起こし**
   - 抽出した音声データを Groq API (`whisper-large-v3-turbo`) へ送信。
   - 用語集キーや `--whisper-prompt` をヒントテキストとして送信し、固有名詞の認識率を向上。
   - 分割音声の場合は実測セグメント長に基づく高精度タイムコード累積補正を実施。
   - 完了後、文字起こし結果を中間キャッシュへ保存。
5. **多言語翻訳 & Gemini API 並列リクエスト**
   - 原文字幕の並行保存（`--save-original`）が指定されている場合は原語字幕を保存。
   - 指定された各ターゲット言語（`-t ja,en,zh`）ごとに処理：
     - キャッシュが存在する場合は即座にキャッシュからロード。
     - 「検出言語 == ターゲット言語」かつ `--force-translate` なしの場合は翻訳をスキップし文字起こし原文を採用。
     - 翻訳実行時:
       - SRT を JSON 配列（`[{ id, startTime, endTime, text }]`）にパース。
       - 50〜100 件単位のチャンクに分割。
       - `asyncPool`（デフォルト 3 並行）を用いて Gemini API（`gemini-3.7-flash`）へ並列送信。
       - `--glossary`（対訳ルール）および `--prompt`（口調・スタイル指示）をシステム/指示プロンプトへ注入。
       - 429 / レートリミット時はランダムジッター付き指数バックオフで最大 3 回再試行。
       - 完了した言語ごとに翻訳キャッシュを保存（中断時のリカバリ対応）。
6. **マルチフォーマット変換 & 保存**
   - 指定されたフォーマット（`srt`, `vtt`, `txt`, `json`）に変換して出力。
   - 既存の言語サフィックス（`.en.srt` 等）を考慮したスマートな命名規則を適用。
7. **サマリー表示 & クリーンアップ**
   - 処理所要時間、対象メディア、検出言語、翻訳言語、生成行数、出力ファイル一覧を整形表示。
   - `--keep-audio` 未指定時は中間音声ファイルを自動削除。

---

## 5. 設定の優先順位と構成

### 1) 設定読み込みの優先順位（高い順）
1. CLI コマンドライン引数（`--concurrency`, `--prompt`, `--glossary`, `--ffmpeg-path` 等）
2. プレフィックス付き環境変数 (`VSUB_GROQ_API_KEY`, `VSUB_GEMINI_API_KEY`, `VSUB_FFMPEG_PATH`, `VSUB_CONCURRENCY`, `VSUB_PROMPT`, `VSUB_GLOSSARY`)
3. 標準環境変数 (`GROQ_API_KEY`, `GEMINI_API_KEY`, `FFMPEG_PATH`)
4. グローバル設定ファイル (`config.json`)

### 2) グローバル設定ファイルの保存場所
* **Windows**: `%APPDATA%\vsub\config.json`
* **macOS / Linux**: `~/.config/vsub/config.json` (または `$XDG_CONFIG_HOME/vsub/config.json`)

### 3) キャッシュディレクトリの保存場所
* **Windows**: `%LOCALAPPDATA%\vsub\Cache`
* **macOS**: `~/Library/Caches/vsub`
* **Linux**: `~/.cache/vsub` (または `$XDG_CACHE_HOME/vsub`)

---

## 6. ディレクトリ構造・ファイル構成

```text
vsub-cli/
├── package.json
├── tsconfig.json
├── biome.json
├── vitest.config.ts
├── .env.example
├── README.md
├── README.ja.md
├── docs/
│   ├── prd.md          # 本仕様書
│   └── backlog.md      # 改善バックログ・ロードマップ
└── src/
    ├── index.ts        # CLI エントリーポイント (Commander 定義・メインフロー制御・サブコマンド)
    ├── config.ts       # 設定の読み込み・永続化・対話型キー登録・優先順位制御
    ├── ffmpeg.ts       # FFmpeg/FFprobe 存在確認・音声抽出/最適化・長尺分割・時間計測
    ├── srt.ts          # SRT パース / 再構築ユーティリティ
    ├── formatter.ts    # マルチフォーマット変換 (SRT, WebVTT, Plain Text, JSON)
    ├── groq.ts         # Groq API (Whisper) 文字起こし呼び出し・プロンプトヒント適用
    ├── gemini.ts       # Gemini API 翻訳処理 (チャンク並列分割・指数バックオフ・プロンプト注入)
    ├── glossary.ts     # 用語集・プロンプト解析・対訳ルール生成・ハッシュ計算
    ├── languages.ts    # 言語コード解析・多言語パースユーティリティ
    ├── cache.ts        # 中間キャッシュ管理 (SHA-256キー生成・保存・再開・クリーンアップ)
    └── ui.ts           # 進行状況スピナー (ora) & 処理結果サマリー表示 (picocolors)
```

---

## 7. 非機能要件・エラーハンドリング

* **レートリミット対策 & 堅牢性**:
  - Gemini API への並列リクエスト（`asyncPool`）と 429 エラー検知時の自動指数バックオフ再試行。
* **対話的 UX & 開発者体験**:
  - 初回実行時やキー未設定時に自動プロンプトで入力を促し、次回以降の手間を省略。
  - 各ステップでのリアルタイムスピナー表示（`ora`）と完了後のサマリーレポート。
* **キャッシュによるコスト・時間最適化**:
  - 中間データ（Groq 文字起こし結果、Gemini 言語別翻訳結果）を自動キャッシュし、API 利用コストを最小化。
* **フォールバック & 安全性**:
  - `ffprobe` 不在時は `ffmpeg` stderr から動画長さを取得する自動フォールバック。
  - ゼロ依存の非同期プール実装により外部依存パッケージのリスクを低減。
