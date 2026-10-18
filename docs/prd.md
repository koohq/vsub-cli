# PRD: vsub-cli (Video & Audio Subtitle CLI)

## 1. 概要
`vsub-cli` は、動画ファイル（`.mp4`, `.mkv`, `.mov` 等）および音声ファイル（`.mp3`, `.wav`, `.m4a`, `.aac`, `.flac`, `.ogg`, `.opus` 等）から音声の抽出・最適化、音声認識（文字起こし）、多言語翻訳、チャプター・要約生成、および動画への字幕合成を一貫して行う Node.js / TypeScript 製の CLI ツールです。

* **高速文字起こし**: Groq API（`whisper-large-v3-turbo`）を利用し、元音声の言語を自動検出しながらタイムコード付きテキストを高速生成。
* **音声最適化**: `ffmpeg` を用いて 16kHz モノラル / 低ビットレート音声へ圧縮し、Groq の 25MB アップロード制限をクリア（24.5MB 超過時は自動分割処理）。長尺音声分割時も実測再生時間に基づくミリ秒精度のタイムコード補正を実施。
* **長文スマート自動分割 (Subtitle Reflow)**: 長大な文字起こしセグメントを句読点・節の自然な言語境界で自動分割し、ミリ秒単位の比例配分により読みやすい字幕長（`--max-length`, `--max-duration`）へ自動調整。
* **高品質・文脈引き継ぎ並列翻訳**: Google Gemini API（`@google/genai`, デフォルト: `gemini-3.8-flash`）を利用。Structured Outputs（`responseSchema`）とスライディングウィンドウ文脈参照（`--context-window`）により、タイムコード破綻・行数不一致を 100% 防止しつつチャンク境界の口調・文脈を維持。非同期ワーカプール（デフォルト 3 並列）と指数バックオフ再試行を搭載。
* **マルチフォーマット & 標準出力ストリーミング**: 字幕（`.srt`, `.vtt`）、プレーンテキスト（`.txt`）、構造化データ（`.json`）の一括ファイル保存に加え、`--stdout`（または `-o -`）による標準出力への直接ストリーミング（UNIX パイプ・AI エージェント連携）に対応。
* **AI チャプター & 要約生成**: `vsub chapters`（YouTube タイムスタンプ・JSON・WebVTT）および `vsub summarize`（Markdown・TXT・JSON）により、既存の文字起こしキャッシュを活用して動画の目次と構造化要約を即時生成。
* **二言語併記 / バイリンガル字幕**: `--bilingual` / `-b` により、原語と翻訳文を同一字幕ブロック内に上下併記（`.srt`, `.vtt`, `.txt`, `.json` および `--burn` / `--embed` 対応）。`--bilingual-order` で並び順を指定可能。
* **動画への字幕合成（ハードサブ & ソフトサブ）**:
  - **ハードサブ焼き込み (`--burn` / `vsub burn`)**: `libx264` と `subtitles` フィルタにより映像自体に字幕を焼き込み。配置位置（`--burn-position`）および文字サイズ（`--burn-font-size`）の調整に対応。
  - **ソフトサブ高速埋め込み (`--embed` / `vsub embed`)**: 映像・音声を再エンコードしないストリームコピーにより、ON/OFF・言語切り替え可能な複数言語字幕トラックを数秒でコンテナへ格納。
* **ディレクトリ / バッチ一括処理**: `vsub batch <targets...>` により、フォルダ配下や glob パターンに合致する複数メディアファイルを逐次自動キュー処理し、総合サマリーレポートを出力。
* **複数言語一括翻訳**: カンマ区切り（`-t ja,en,zh`）で複数言語を同時指定可能。文字起こしは 1 回のみ実行し、各言語の字幕を一括生成。
* **用語集 & プロンプト制御**: `--glossary`（JSON またはインライン対訳）および `--prompt`（口調・スタイル指示）、`--whisper-prompt`（固有名詞ヒント）をサポート。
* **中間キャッシュ & 再開機構**: 文字起こし・翻訳・チャプター・要約結果を自動キャッシュ。再実行時や別言語追加時の API コストと待ち時間をゼロ化（`vsub cache`）。
* **SRT 直接翻訳サブコマンド**: 音声処理・文字起こしをスキップし、既存の `.srt` 字幕ファイルから別言語・別フォーマットへ直接翻訳可能（`vsub translate`）。
* **対話型セットアップ & 自己更新バイナリ配布**: 導通確認付きの初期設定ウィザード（`vsub init`）、グローバル設定管理（`vsub config`）、Node.js SEA による単体実行バイナリ配布、および SHA-256 検証付きの自己更新機構（`vsub update`）を提供。

---

## 2. 技術スタック・開発環境

* **Language / Runtime**: Node.js (v26+), TypeScript (v7+)
* **Binary Distribution**: Node.js Single Executable Applications (SEA) + `esbuild`
* **Package Manager**: `pnpm` (サプライチェーン保護規定 `minimumReleaseAge: 4320` 準拠)
* **Linter / Formatter**: `Biome` (`biome.json`)
* **Test Runner**: `Vitest` (`vitest.config.ts`, `@vitest/coverage-v8`)
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
  * Groq API (Speech-to-Text: デフォルト `whisper-large-v3-turbo`)
  * Google Gemini API (Translation / Chapters / Summary: デフォルト `gemini-3.8-flash`)

---

## 3. 入出力仕様・CLI インターフェース

### 基本コマンド構造
```bash
# メディア（動画・音声）処理コマンド
vsub <media-file> [options]

# 複数ファイル・ディレクトリ一括処理サブコマンド
vsub batch <targets...> [options]

# 字幕ファイル直接翻訳サブコマンド
vsub translate <subtitle-file> [options]

# 動画への字幕焼き込み / ソフトサブ埋め込みサブコマンド
vsub burn <video-file> <subtitle-file> [options]
vsub embed <video-file> <subtitle-files...> [options]

# AI チャプター / 要約生成サブコマンド
vsub chapters <file> [options]
vsub summarize <file> [options]

# 初期セットアップ・自己更新・キャッシュ・設定・ライセンス管理
vsub init
vsub update [options]
vsub cache <path|stats|clean>
vsub config <path|show|set|init>
vsub licenses [--full]
```

### 1) メディア処理コマンドと主要オプション (`vsub <media-file>`)
* `<media-file>`: 処理対象の動画または音声ファイルパス（`.mp4`, `.mkv`, `.mov`, `.mp3`, `.wav`, `.m4a`, `.aac`, `.flac`, `.ogg`, `.opus` 等）。
* `-l, --lang <lang>`: CLI 表示言語（`en` または `ja`。デフォルト: `en`）。
* `-t, --target-lang <langs>`: 翻訳先の言語コード。カンマ区切りで複数指定可能（例: `ja`, `en`, `ja,en,zh`。デフォルト: `ja`）。
* `-f, --format <formats>`: 出力フォーマット（`srt`, `vtt`, `txt`, `json` をカンマ区切りで複数指定可能。デフォルト: `srt`）。
* `-o, --output <path>`: 出力ファイルパス指定（`-` 指定時は標準出力へストリーミング）。
* `--stdout`: ファイル保存を行わず、結果を直接 `process.stdout` へ出力（単一言語・単一フォーマット時）。
* `-w, --overwrite`: 確認プロンプトなしで既存ファイルを上書き。
* `--backup`: 既存ファイルを `.bak`（または `.bak.N`）として退避保存。
* `-b, --bilingual`: 原語と翻訳文を上下併記したバイリンガル字幕を生成。
* `--bilingual-order <order>`: バイリンガル字幕の並び順（`original-first` または `target-first`。デフォルト: `original-first`）。
* `--ffmpeg-path <path>`: `ffmpeg` 実行ファイルのパスを指定。
* `--whisper-prompt <text>`: Groq Whisper 音声認識のヒントプロンプト（専門用語・固有名詞等）。
* `--prompt <instruction>`: Gemini 翻訳時のカスタム指示プロンプト（口調、スタイル、簡潔さ等）。
* `--glossary <path-or-terms>`: 用語集 JSON ファイルパスまたはインライン対訳（`Key=Val,Key=Val`）。
* `--concurrency <number>`: Gemini API への同時並行リクエスト数（デフォルト: `3`）。
* `--context-window <lines>`: チャンク間で文脈を引き継ぐ直前参照行数（デフォルト: `5`、`0` で無効化）。
* `--max-length <chars>`: 長文セグメント自動分割の目安最大文字数（デフォルト: CJK `32`、欧文 `75`）。
* `--max-duration <seconds>`: 字幕 1 件あたりの目安最大表示秒数（デフォルト: `7`）。
* `--no-reflow`: 長文セグメントのスマート自動分割を無効化。
* `--gemini-model <model>`: Gemini モデルの指定（デフォルト: `gemini-3.8-flash`）。
* `--groq-model <model>`: Groq Whisper モデルの指定（デフォルト: `whisper-large-v3-turbo`）。
* `--no-cache` / `--fresh` / `--cache-dir <path>`: 中間キャッシュの無効化・強制再生成・保存先指定。
* `--burn`: 生成された字幕を動画自体に焼き込んで出力（hardsub）。
* `--burn-position <pos>`: 焼き込み字幕の位置（`bottom` [既定], `top`, `center`）。
* `--burn-font-size <size>`: 焼き込み字幕のフォントサイズ（`small`, `medium`, `large`, または正の数値）。
* `--embed`: 生成された字幕を動画コンテナへソフトサブトラックとして高速埋め込み（softsub）。
* `--keep-audio`: 抽出した一時音声ファイルを削除せずに保持。
* `--no-translate`: Gemini 翻訳をスキップし、文字起こし原語字幕のみを出力。
* `--save-original`: 翻訳後字幕に加え、文字起こし原語字幕ファイルも並行保存。
* `--force-translate`: 検出言語と翻訳先言語が同一の場合でも強制的に Gemini 翻訳を実行。
* `--no-update-check`: 新バージョンの自動更新チェックを無効化。
* `--verbose`: 詳細なログを出力。

### 2) ディレクトリ / バッチ一括処理サブコマンド (`vsub batch`)
* `<targets...>`: 動画・音声ファイル、ディレクトリパス、または glob パターン（複数指定可能）。
* `-r, --recursive` / `--no-recursive`: サブディレクトリの再帰走査制御（デフォルト: `true`）。
* `-o, --output-dir <dir>`: 生成ファイルの出力先ディレクトリを一括指定。
* `--fail-fast`: エラー発生時に後続ジョブを即時中断（デフォルト: `false`）。
* メインコマンドの全メディア処理オプション（`-t`, `-f`, `-w`, `--backup`, `-b`, `--prompt`, `--glossary`, `--context-window`, `--max-length`, `--max-duration`, `--no-reflow`, `--burn`, `--burn-position`, `--burn-font-size`, `--embed` 等）を共通サポート。

### 3) 字幕直接翻訳サブコマンド (`vsub translate`)
* `<subtitle-file>`: 翻訳対象の既存 `.srt` 字幕ファイルパス。
* 音声抽出および Groq 文字起こしをスキップし、リフロー（`--max-length` 等）・Gemini 並列翻訳・マルチフォーマット保存または `--stdout` ストリーミングを実行。

### 4) 動画字幕合成サブコマンド (`vsub burn` / `vsub embed`)
* `vsub burn <video-file> <subtitle-file>`: 既存の動画に `.srt` 字幕をハードサブ焼き込み（`--burn-position`, `--burn-font-size` 対応）。
* `vsub embed <video-file> <subtitle-files...>`: 既存の動画に 1 つ以上の `.srt` 字幕を無劣化ストリームコピーでソフトサブトラックとして格納（ファイル名から ISO 639-2 言語コード・トラック名を自動付与）。

### 5) AI チャプター & 要約生成サブコマンド (`vsub chapters` / `vsub summarize`)
* `vsub chapters <file>`: 動画・音声・`.srt` から目次チャプターを生成（`-f txt|json|vtt`、`--stdout` 対応）。
* `vsub summarize <file>`: 動画・音声・`.srt` から全体要約・主要ポイント・タイムコード付きハイライトを生成（`-f md|txt|json`、`--stdout` 対応）。

### 6) 初期設定・自己更新・キャッシュ・設定・ライセンス管理
* `vsub init` (または `vsub config init`): API キー疎通確認・FFmpeg 検出・基本設定を行う対話型ウィザード。
* `vsub update [--check] [--force]`: スタンドアロン SEA バイナリの SHA-256 検証付き自己更新（エイリアス: `upgrade`）。
* `vsub cache <path|stats|clean>`: キャッシュディレクトリのパス表示・統計確認・一括削除。
* `vsub config <path|show|set|init>`: グローバル設定（`config.json`）の表示・永続保存。
* `vsub licenses [--full]`: 同梱 OSS ライブラリのライセンス一覧・全文表示。

---

## 4. 処理フローの詳細

```text
[入力メディア (.mp4 / .mp3 等)]
       │
       ▼
1. 環境・入力・出力先衝突検証 (ensureWritableTargets) & 設定ロード
       │
       ▼
2. キャッシュ確認（文字起こしキャッシュがあれば 3〜4 を完全スキップ）
       │
       ▼
3. 音声抽出 & 最適化 (FFmpeg: 16kHz モノラル / 分割時は実再生時間を計測)
       │
       ▼
4. Groq Whisper 文字起こし (用語集ヒント適用 / 言語自動検出) ──> 生文字起こしキャッシュ保存
       │
       ▼
5. スマート字幕リフロー (reflowSrtEntries: 句読点・節境界での長文分割 & ミリ秒比例配分)
       │
       ▼
6. 多言語並行翻訳ループ (各 targetLang ごと)
       │
       ├─ キャッシュ確認（エントリ数・プロンプト・用語集・モデル一致ならスキップ）
       ├─ 言語一致スキップ判定 (検出言語 == targetLang かつ !forceTranslate)
       ├─ チャンク分割 & 直前チャンク末尾の文脈抽出 (precedingContext)
       └─ Gemini API 並列翻訳 (asyncPool: 3並列 / Structured Outputs / 指数バックオフ)
       │
       ▼
7. マルチフォーマット出力 (.srt, .vtt, .txt, .json) または --stdout ストリーミング
       │
       ├─ [--burn 指定時]  FFmpeg (libx264 + force_style) でハードサブ動画を生成
       └─ [--embed 指定時] FFmpeg (stream copy + ISO 639-2 metadata) でソフトサブ動画を生成
       │
       ▼
8. 処理結果サマリー表示 & 一時ファイル削除 & 新バージョン通知チェック (24h キャッシュ)
```

---

## 5. 設定の優先順位と構成

### 1) 設定読み込みの優先順位（高い順）
1. CLI コマンドライン引数
2. `VSUB_` プレフィックス付き環境変数（`VSUB_GROQ_API_KEY`, `VSUB_GEMINI_API_KEY`, `VSUB_FFMPEG_PATH`, `VSUB_LANG`, `VSUB_GEMINI_MODEL`, `VSUB_GROQ_MODEL`, `VSUB_CONCURRENCY`, `VSUB_PROMPT`, `VSUB_GLOSSARY`, `VSUB_WHISPER_PROMPT`, `VSUB_MAX_LENGTH`, `VSUB_BURN_POSITION`, `VSUB_BURN_FONT_SIZE`, `VSUB_NO_UPDATE_CHECK`）
3. 標準環境変数（`GROQ_API_KEY`, `GEMINI_API_KEY`, `FFMPEG_PATH`）
4. グローバル設定ファイル（`config.json`）

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
├── README.md
├── README.ja.md
├── CONTRIBUTING.md
├── docs/
│   ├── prd.md             # 本仕様書
│   └── backlog.md         # 改善バックログ・ロードマップ
├── scripts/
│   ├── build-binary.ts    # Node.js SEA スタンドアロンバイナリビルドスクリプト
│   ├── package-release.ts # リリースアーカイブ (.zip / .tar.gz) & SHA256SUMS 生成
│   ├── generate-licenses.ts # サードパーティライセンス抽出・バンドルスクリプト
│   ├── watch-models.ts    # Groq / Gemini 新着モデル自動検知スクリプト
│   └── test-e2e.ts        # 実ファイル・実 API 一気通貫スモークテスト
└── src/
    ├── index.ts           # CLI エントリーポイント (Commander 定義・サブコマンド配線)
    ├── pipeline.ts        # メディア処理・チャプター生成・要約生成のコアパイプライン
    ├── batch.ts           # ディレクトリ再帰走査・glob 検出・バッチ逐次キュー実行
    ├── config.ts          # 設定の読み込み・永続化・API キー検証・優先順位制御
    ├── init.ts            # 対話型初期セットアップ & 疎通確認ウィザード (vsub init)
    ├── ffmpeg.ts          # FFmpeg/FFprobe 音声抽出・分割・字幕焼き込み・ソフトサブ埋め込み
    ├── srt.ts             # SRT パース・バイリンガル結合・スマート自動分割 (Reflow)
    ├── formatter.ts       # マルチフォーマット変換 (SRT, VTT, TXT, JSON, Chapters, Summary)
    ├── groq.ts            # Groq API (Whisper) 文字起こし・タイムコード累積補正
    ├── gemini.ts          # Gemini API 並列翻訳・チャプター生成・要約生成 (Structured Outputs)
    ├── glossary.ts        # 用語集・プロンプト解析・対訳ルール生成・ハッシュ計算
    ├── languages.ts       # 言語コード正規化・ISO 639-2 マッピング・表示名解決
    ├── cache.ts           # 中間キャッシュ管理 (文字起こし・翻訳・チャプター・要約)
    ├── safety.ts          # ファイル上書き防止・自動連番バックアップ (.bak) 機構
    ├── updater.ts         # 新バージョン通知 (24h キャッシュ) & SEA バイナリ自己更新
    ├── licenses.ts        # サードパーティライセンス表示モジュール
    ├── version.ts         # パッケージバージョン解決ユーティリティ
    ├── ui.ts              # 進行状況スピナー (ora) & サマリーボックス描画
    └── i18n/              # 多言語メッセージ辞書 (en.ts, ja.ts, index.ts)
```

---

## 7. 非機能要件・エラーハンドリング

* **レートリミット対策 & 構造安全性**:
  - Gemini API への並列リクエスト（`asyncPool`）と 429 エラー検知時のジッター付き指数バックオフ再試行。
  - `responseSchema` による JSON 配列・構造化データの文法制約デコーディングと、直前文脈スライディングウィンドウによる翻訳品質保証。
* **ストリーム分離 & Agentic DX**:
  - `--stdout` モード時は進行スピナーを `stderr` に分離し、バナー・サマリー・更新通知を自動抑制することで、パイプライン汚染を完全防止。
* **キャッシュによるコスト・時間最適化**:
  - 生の文字起こしセグメント、各言語の翻訳結果、チャプター、要約をコンテンツハッシュ単位でキャッシュし、設定変更（`--max-length` 等）や再実行時の API コストを最小化。
* **安全性 & フォールバック**:
  - 高コストな API 呼び出しや動画エンコードを開始する前に出力ファイル衝突を事前検査（`ensureWritableTargets`）。
  - `ffprobe` 不在時は `ffmpeg` stderr からメディア長を取得する自動フォールバック。
  - Windows 環境での実行中 `.exe` 自己更新時は `.old` リネーム退避と失敗時自動ロールバックによりバイナリ破損を防止。
