# vsub-cli (Video & Audio Subtitle CLI)

[![npm version](https://img.shields.io/npm/v/vsub-cli)](https://www.npmjs.com/package/vsub-cli)
[![CI](https://img.shields.io/github/actions/workflow/status/koohq/vsub-cli/ci.yml?branch=main&label=CI)](https://github.com/koohq/vsub-cli/actions/workflows/ci.yml?query=branch%3Amain)
[![License](https://img.shields.io/github/license/koohq/vsub-cli)](https://github.com/koohq/vsub-cli/blob/main/LICENSE)

[English](README.md) | [日本語](README.ja.md)

動画ファイルおよび音声ファイルから音声を最適化抽出し、**OpenRouter（ElevenLabs Scribe v2、既定）** または **Groq (`whisper-large-v3-turbo`)** で音声文字起こしを行った後、**Google Gemini 直接（`gemini-3.8-flash`）または OpenRouter 経由（`google/gemini-3.8-flash`）** を用いて多言語字幕・テキスト・チャプター・要約を自動生成する CLI ツールです。

---

## 主な特徴

* ⚡ **高精度・高速な文字起こし**: 既定で OpenRouter 経由の ElevenLabs Scribe v2（`elevenlabs/scribe-v2`）を使用し、高精度な音声認識を実現。Groq 上の超高速な `whisper-large-v3-turbo` も選択可能。
* 🎵 **動画・音声ファイル両対応**: 動画ファイル（`.mp4`, `.mkv`, `.mov` 等）だけでなく、音声ファイル（`.mp3`, `.wav`, `.m4a`, `.aac`, `.flac`, `.ogg`, `.opus` 等）も直接入力可能。
* 🔊 **音質・ファイルサイズ自動最適化**: `ffmpeg` を用いて 16kHz モノラル / 低ビットレート（48kbps）に圧縮・最適化し、提供元ごとの上限に合わせて分割（OpenRouter は 5 分ずつ、Groq は 25MB 超で分割）。実測再生時間に基づくミリ秒精度のタイムコード補正で字幕ズレを防止。
* 🎯 **タイムコード破綻防止 & 文脈引き継ぎ翻訳**: 字幕テキストのみを Google Gemini 直接（`gemini-3.8-flash`）または OpenRouter 経由（`google/gemini-3.8-flash`）の Structured Outputs（JSON schema: Gemini は `responseSchema`、OpenRouter は `response_format`）とスライディングウィンドウ参照（`--context-window`）でチャンク翻訳。タイムコード崩れや行数不一致を 100% 防ぎつつ、チャンク境界でも自然な口調・文脈を維持。
* ✂️ **長文セグメントのスマート自動分割 (Subtitle Reflow)**: Scribe v2 では単語レベルのタイムスタンプから字幕の区切りを生成。長大化したセグメントを、句読点や節の自然な切れ目で読みやすい長さに自動分割し、表示時間をミリ秒単位で比例配分（`--max-length`, `--max-duration`, `--no-reflow`）。
* 🚀 **Gemini API 並列リクエスト制御**: 非同期ワーカプール（`--concurrency`、デフォルト 3 並列）による高速並行翻訳と、429 レートリミット時のジッター付き指数バックオフ再試行を搭載。
* 💾 **スマート中間キャッシュ & 再開機構**: メディアファイルのパス・サイズ・更新日時から作る SHA-256 ハッシュをキーに（ファイルの中身は読まない）、文字起こし・翻訳・チャプター・要約結果を自動キャッシュ。文字起こしキャッシュは、提供元・モデル・認識のヒントが同じときだけ再利用。再実行時や別言語追加時に、済んだ API 呼び出しを繰り返さない（`vsub cache`）。
* 📖 **用語集 (Glossary) & プロンプト制御**: 専門用語の誤訳を防ぐ `--glossary`（JSON またはインライン対訳）、翻訳スタイルを指定する `--prompt`、Whisper の認識精度を高める `--whisper-prompt` をサポート。
* 🌍 **複数言語一括翻訳 & バイリンガル併記**: `-t ja,en,zh` による 1 回の文字起こしからの多言語一括出力や、原語と訳語を上下 2 段に併記するバイリンガル字幕生成（`-b, --bilingual`）に対応。
* 📄 **マルチフォーマット出力 & 標準出力ストリーミング**: `.srt` (SubRip), `.vtt` (WebVTT), `.txt` (プレーンテキスト), `.json` (構造化データ) への保存に加え、一時ファイルなしで `stdout` へ直接出力する `--stdout`（または `-o -`）により `jq` や `pbcopy`、AI エージェントとのパイプ連携を実現。
* 📑 **AI チャプター生成 & 要約サブコマンド**: 動画・音声・既存 `.srt` から YouTube 概要欄用チャプター（`vsub chapters`）や構造化 Markdown 要約（`vsub summarize`）を生成。文字起こしキャッシュを再利用して数秒で出力。
* 🎬 **動画への字幕焼き込み (Hardsub) & ソフトサブ高速埋め込み (Softsub)**: 配置位置や文字サイズを調整できる字幕焼き込み（`--burn`, `--burn-position`, `--burn-font-size`）と、無劣化・数秒で複数言語の ON/OFF 可能な字幕トラックを格納するソフトサブ埋め込み（`--embed`, `vsub embed`）の両方に対応。
* 📁 **ディレクトリ / バッチ一括処理モード**: フォルダ配下の全動画・音声、複数ファイル、glob パターンを一括で自動処理。逐次キュー実行、エラー耐性、総合サマリーレポートを完備（`vsub batch`）。
* 🛡️ **ファイル上書き防止 & バックアップセーフティ**: 処理開始前の事前衝突検知、対話環境での上書き確認（`y/N`）、強制上書きフラグ（`-w, --overwrite`）、自動連番退避（`--backup` による `.bak` / `.bak.N` 保存）で意図しないデータ消失を防止。
* 🔄 **既存字幕の直接翻訳サブコマンド**: 動画ファイルや文字起こし API を介さず、既存の `.srt` ファイルから直接別言語・別フォーマットへ翻訳（`vsub translate`）。
* 🛠️ **対話型セットアップ & 自己更新バイナリ**: 導通確認付きの初期設定ウィザード（`vsub init`）、グローバル設定管理（`vsub config`）、および SHA-256 検証付きの単体バイナリ自己更新（`vsub update`）を内蔵。

---

## インストール方法

`vsub-cli` は、**Node.js 不要の単体実行バイナリ**、および **npm パッケージ** の 2 通りの方法で利用できます。

### 方法 1: スタンドアロン単体バイナリ（推奨・Node.js 不要）
[GitHub Releases](https://github.com/koohq/vsub-cli/releases) から、お使いの OS / CPU アーキテクチャに合わせた圧縮アーカイブをダウンロードするだけで、Node.js や pnpm をインストールすることなくそのまま実行できます：

* **Windows x64**: `vsub-windows-x64.zip`
* **Windows ARM64**: `vsub-windows-arm64.zip`
* **Linux x64**: `vsub-linux-x64.tar.gz`
* **Linux ARM64**: `vsub-linux-arm64.tar.gz`
* **macOS Apple Silicon (ARM64)**: `vsub-macos-arm64.tar.gz`

各アーカイブには実行バイナリ本体（`vsub` または `vsub.exe`）およびライセンス通知が同梱されており、ダウンロード容量も約 25〜35 MB に圧縮されています。

> [!NOTE]
> * Intel Mac (x64) 環境では、Node.js アップストリーム（SEA）の制限により、**方法 2（npm / pnpm）** をご利用ください。
> * 音声の抽出・圧縮や動画への字幕合成（`--burn`, `--embed`）を行うため、実行環境に `ffmpeg` / `ffprobe` が必要です（未導入の場合は `vsub init` 実行時にインストール手順が案内されます）。

```bash
# アーカイブを展開（Linux / macOS）
tar -xzf vsub-macos-arm64.tar.gz

# 実行権限を付与（Linux / macOS）
chmod +x vsub

# 初期セットアップウィザードを起動
./vsub init
```

Windows の場合は、ダウンロードした `vsub-windows-x64.zip` を展開し、`vsub.exe init` を実行してください（`PATH` の通ったフォルダに `vsub.exe` を配置すると、どのディレクトリからでも `vsub` コマンドとして呼び出せます）。

### 方法 2: npm / pnpm によるグローバルインストール（Node.js 環境向け）
パッケージは [npm](https://www.npmjs.com/package/vsub-cli) で公開しています。

```bash
# npm でインストール
npm install -g vsub-cli

# または pnpm でインストール
pnpm add -g vsub-cli
```

---

## 前提条件・外部依存

1. **ffmpeg / ffprobe**: システムにインストール済みであること（または `--ffmpeg-path` / `VSUB_FFMPEG_PATH` で実行ファイルパスを指定）
2. **API キー**:
   * **OpenRouter の API キー 1 本**（`VSUB_OPENROUTER_API_KEY`、[OpenRouter](https://openrouter.ai/keys) で取得）で、音声文字起こしから翻訳・チャプター・要約まで全部動きます。
   * **Gemini の API キー**（`VSUB_GEMINI_API_KEY`、[Google AI Studio](https://aistudio.google.com/) で取得）があれば、翻訳・チャプター・要約に Gemini を直接使用します。
   * 超高速な Whisper 文字起こしを行いたい場合は、[Groq Console](https://console.groq.com/) で取得した `VSUB_GROQ_API_KEY` も利用可能です。
3. **Node.js**: v26+ または v24+ *(npm パッケージ利用時またはソースからビルドする場合のみ必要)*

---

## セットアップ & API キーの設定

API キーは **3 つの方法** から設定できます：

### 方法 1: 対話型セットアップウィザード（推奨・一番簡単）
`vsub init` コマンドを実行すると対話型ウィザードが起動し、文字起こしの提供元（OpenRouter または Groq）および文章の生成の提供元（Gemini または OpenRouter）の選択と API キー・FFmpeg の疎通確認を行った上でグローバル設定に保存します：
```bash
# 対話型セットアップウィザードを起動
vsub init

# OpenRouter のキー 1 本で全部動かす場合:
vsub config set --openrouter-key "your_openrouter_key"

# OpenRouter と Gemini の両方のキーを設定する場合:
vsub config set --openrouter-key "your_openrouter_key" --gemini-key "your_gemini_key"

# Groq を使用する場合:
vsub config set --stt-provider groq --groq-key "your_groq_key" --gemini-key "your_gemini_key"
```

### 方法 2: 環境変数 (`VSUB_` プレフィックス)
システム環境変数またはシェルの設定ファイルで指定します（他ツールとの競合を防ぐため `VSUB_` プレフィックスを推奨します）：
```bash
# OpenRouter のキー 1 本（これだけで全部動きます）:
export VSUB_OPENROUTER_API_KEY="your_openrouter_api_key_here"

# 省略可能: Gemini のキーがあれば、翻訳・チャプター・要約に Gemini を直接使います:
# export VSUB_GEMINI_API_KEY="your_gemini_api_key_here"

# 省略可能: Gemini のキーがあっても OpenRouter を使う場合:
# export VSUB_LLM_PROVIDER="openrouter"

# Groq を使用する場合:
# export VSUB_STT_PROVIDER="groq"
# export VSUB_GROQ_API_KEY="your_groq_api_key_here"
```
*(プレフィックスなしの `GROQ_API_KEY`、`GEMINI_API_KEY` もフォールバックとしてサポートしています。汎用の `OPENROUTER_API_KEY` は、OpenRouter を明示したときだけ読み込みます。[文字起こしの提供元の選び方](#文字起こしの提供元の選び方)および[文章の生成の提供元の選び方](#文章の生成の提供元の選び方)を参照してください)*

### 方法 3: `.env` ファイル
実行時のカレントディレクトリに `.env` ファイルを配置して設定します：
```env
# OpenRouter のキー 1 本（これだけで全部動きます）:
VSUB_OPENROUTER_API_KEY=your_openrouter_api_key_here

# 省略可能: Gemini のキーがあれば、翻訳・チャプター・要約に Gemini を直接使います:
# GEMINI_API_KEY=your_gemini_api_key_here

# 省略可能: Gemini のキーがあっても OpenRouter を使う場合:
# VSUB_LLM_PROVIDER=openrouter

# Groq を使用する場合:
# VSUB_STT_PROVIDER=groq
# GROQ_API_KEY=your_groq_api_key_here
```

---

## 文字起こしの提供元の選び方

vsub は、以下の優先順位で文字起こしの提供元を決定します：
1. コマンドラインオプション `--stt-provider <openrouter|groq>`
2. 環境変数 `VSUB_STT_PROVIDER` または設定ファイルの `sttProvider`
3. 設定されている API キーによる自動選択:
   - `VSUB_OPENROUTER_API_KEY`（または保存された OpenRouter キー）がある場合 → **OpenRouter**
   - 上記がなく、Groq のキーがある場合 → **Groq**
   - どちらもない場合 → **OpenRouter**

> [!NOTE]
> 汎用の環境変数 `OPENROUTER_API_KEY` は、オプションや設定で OpenRouter を明示した場合にのみ読み込まれます。これは、他のツール用に設定したキーによって予期せず課金先が変わってしまうのを防ぐためです。

### 今 Groq を使っている人へ
現在 Groq をご利用中の方は、アップデート後もそのまま Groq で動作し、既存の文字起こしキャッシュもそのまま引き継がれます。自動選択で Groq になった際は OpenRouter をお勧めする案内が 1 行表示されますが、`VSUB_STT_PROVIDER=groq`（または `vsub config set --stt-provider groq`）で提供元を明示すると表示されなくなります。

### モデルと認識のヒント
* **モデルの指定**:
  - `--stt-model <model>` で、選択した提供元の文字起こしモデルを一時的に指定できます。
  - `VSUB_OPENROUTER_STT_MODEL`（設定ファイル: `openrouterSttModel`）で OpenRouter のデフォルトモデルを指定できます（デフォルト: `elevenlabs/scribe-v2`）。
  - `VSUB_GROQ_MODEL`（設定ファイル: `groqModel`）で Groq のデフォルトモデルを指定できます（デフォルト: `whisper-large-v3-turbo`）。
  - **動作を確認している OpenRouter のモデルは `elevenlabs/scribe-v2` のみです**。他のモデルも `--stt-model` で指定可能ですが、未検証のため正しく動作しない場合があります。
* **認識のヒント**:
  - 認識ヒント（`--whisper-prompt` や用語集 `--glossary` から自動生成されるヒント）は Groq Whisper にのみ送信され、OpenRouter には送信されません。

---

## 文章の生成の提供元の選び方

vsub は、以下の優先順位で文章の生成の提供元（翻訳・チャプター・要約）を決定します：
1. コマンドラインオプション `--llm-provider <gemini|openrouter>`
2. 環境変数 `VSUB_LLM_PROVIDER` または設定ファイルの `llmProvider`
3. 設定されている API キーによる自動選択:
   - Gemini のキー（`VSUB_GEMINI_API_KEY`、`GEMINI_API_KEY`、または保存されたキー）がある場合 → **Gemini**
   - 無い場合 → **OpenRouter**

> [!NOTE]
> 汎用の環境変数 `OPENROUTER_API_KEY` は、オプションや設定で OpenRouter を明示した場合にのみ読み込まれます（理由は文字起こしと同じです。[文字起こしの提供元の選び方](#文字起こしの提供元の選び方)を参照してください）。

### 今 Gemini を使っている人へ
現在 Gemini をご利用中の方は、アップデート後も設定を変えずにそのまま Gemini 直接で動作し、既存の翻訳・チャプター・要約のキャッシュもそのまま引き継がれます。

### モデル・残高と費用
* **モデルの指定**:
  - `--llm-model <model>` で、選択した提供元の文章生成モデルを一時的に指定できます。
  - `--gemini-model <model>` / `VSUB_GEMINI_MODEL`（設定ファイル: `geminiModel`）で Gemini のモデルを指定できます（提供元が Gemini のときのみ有効）。
  - `VSUB_OPENROUTER_LLM_MODEL`（設定ファイル: `openrouterLlmModel`、既定: `google/gemini-3.8-flash`）で OpenRouter の文章生成モデルを指定できます。
  - **動作を確認している OpenRouter のモデルは `google/gemini-3.8-flash` のみです**。他のモデルも `--llm-model` で指定可能ですが、未検証であり JSON schema（構造化出力）に対応していないと動作しません。
* **OpenRouter の費用と並行数**:
  - 1 回のリクエストで、最大出力トークン数（`max_tokens: 16384`）に応じた額が一時的に確保されます。残高が足りないと 402 (Insufficient Credits) で停止し、案内が表示されます。`--concurrency`（既定: 3）を下げると、同時に確保される額を抑えられます。
* **キャッシュの再利用**:
  - 提供元やモデルを変更すると、翻訳・チャプター・要約は新しく生成されます（キャッシュは提供元・モデル・プロンプトが一致したときのみ再利用されます）。

---

## 使い方

### 基本実行

```bash
# デフォルトで日本語字幕 ([メディア名].ja.srt) を生成（動画・音声両対応）
vsub path/to/video.mp4
vsub path/to/podcast.mp3

# リポジトリのソースコードから直接開発実行する場合:
pnpm dev path/to/video.mp4
```

### コマンドヘルプ

```text
Usage: vsub [options] [command] [media-file]

Arguments:
  media-file                    処理対象の動画または音声ファイルパス (.mp4, .mp3, .wav, .m4a, .mov 等)

Options:
  -l, --lang <lang>             CLI表示言語: en (英語・既定), ja (日本語)
  -t, --target-lang <langs>     翻訳先の言語コード (カンマ区切りで複数指定可: ja,en,zh) (デフォルト: 設定の値、なければ ja)
  -f, --format <formats>        出力フォーマット: srt, vtt, txt, json をカンマ区切りで指定 (デフォルト: "srt")
  -o, --output <path>           字幕ファイルの出力パスまたはベース名 ('-' 指定で標準出力)。--embed / --burn で動画のパス (例: out.mkv) を指定したときは、字幕を out.<言語>.<形式> に保存
  --stdout                      ファイル保存を行わず、結果を直接標準出力 (stdout) へ出力 (デフォルト: false)
  -w, --overwrite               確認プロンプトを表示せず既存ファイルを直接上書き (デフォルト: false)
  --backup                      既存ファイルが存在する場合に .bak として退避保存 (デフォルト: false)
  -b, --bilingual               原語と翻訳文を上下2段で併記したバイリンガル字幕を生成 (デフォルト: false)
  --bilingual-order <order>     バイリンガル字幕の並び順: original-first (既定) または target-first
  --ffmpeg-path <path>          ffmpeg 実行ファイルのパス (未指定時は VSUB_FFMPEG_PATH または PATH を探索)
  --stt-provider <provider>     文字起こしの提供元: openrouter または groq (デフォルト: VSUB_STT_PROVIDER、設定の値、または API キーから自動選択)
  --stt-model <model>           選択した提供元の文字起こしモデル (デフォルト: OpenRouter は elevenlabs/scribe-v2、Groq は whisper-large-v3-turbo)
  --groq-model <model>          文字起こしに使用する Groq Whisper モデル (提供元が groq の場合のみ使用)
  --whisper-prompt <text>       Groq Whisper 音声認識のヒントプロンプト (Groq のみ有効。OpenRouter には送信されません)
  --prompt <instruction>        翻訳時のカスタム指示プロンプト (口調・スタイル・簡潔さ等)
  --glossary <path-or-terms>    用語集 JSON ファイルパスまたはインライン対訳 (Key=Val,Key=Val)
  --concurrency <number>        同時並行リクエスト数 (デフォルト: 3)
  --gemini-model <model>        Gemini 翻訳モデルの指定 (Gemini 提供元のみ有効)
  --llm-provider <provider>     文章の生成の提供元 (翻訳・チャプター・要約): gemini または openrouter (デフォルト: VSUB_LLM_PROVIDER、設定の値、または API キーから自動選択)
  --llm-model <model>           選択した提供元の文章生成モデル (デフォルト: Gemini は gemini-3.8-flash、OpenRouter は google/gemini-3.8-flash)
  --no-cache                    中間キャッシュを使用・保存せずに実行 (デフォルト: false)
  --fresh                       既存キャッシュを無視して新規実行し、結果をキャッシュへ上書き (デフォルト: false)
  --cache-dir <path>            カスタムキャッシュ保存ディレクトリの指定
  --context-window <lines>      チャンク間で文脈・口調を引き継ぐ直前参照行数 (0 で無効化) (デフォルト: 5)
  --max-length <chars>          長文セグメント自動分割の目安最大文字数 (デフォルト: 日本語/CJK 32文字, 英語/欧文 75文字)
  --max-duration <seconds>      字幕1件あたりの目安最大表示秒数 (デフォルト: 7)
  --no-reflow                   長文セグメントのスマート自動分割を無効化 (デフォルト: false)
  --burn                        生成された字幕を動画自体に焼き込んで出力 (hardsub) (デフォルト: false)
  --burn-position <pos>         焼き込み字幕の配置位置: bottom (既定: 下部), top (上部), center (中央)
  --burn-font-size <size>       焼き込み字幕のフォントサイズ: small, medium, large, または数値 (デフォルト: auto)
  --embed                       生成された字幕を動画コンテナへ字幕トラックとして埋め込み (softsub) (デフォルト: false)
  --keep-audio                  中間抽出した一時音声ファイルを削除せずに保持 (デフォルト: false)
  --no-translate                翻訳をスキップし、文字起こし結果（原語字幕）のみを出力 (デフォルト: false)
  --save-original               翻訳後字幕に加え、翻訳前の原語文字起こし字幕ファイルも並行保存 (デフォルト: false)
  --refine                      翻訳前に文字起こしの誤認識を文章の生成モデルで修正する（既定は無効。--glossary と --prompt を参照。時刻と行数は変えない） (デフォルト: false)
  --force-translate             検出言語と出力言語が同一の場合でも強制的に翻訳を実行 (デフォルト: false)
  --no-update-check             新バージョンの自動更新チェックを無効化 (デフォルト: false)
  --verbose                     詳細なログ（APIリクエスト等）を出力 (デフォルト: false)
  -h, --help                    ヘルプを表示

Commands:
  batch <targets...>            複数メディアファイルの一括処理 (フォルダ、複数ファイル、glob パターン)
  translate <subtitle-file>     既存の字幕ファイル (.srt) を Gemini または OpenRouter で直接別言語に翻訳
  burn <video-file> <sub-file>  既存の字幕ファイル (.srt) を FFmpeg で動画に直接焼き込み (hardsub)
  embed <video> <sub-files...>  既存の動画と字幕 (.srt) を FFmpeg ストリームコピーで字幕トラックとして高速埋め込み (softsub)
  chapters <file>               動画・音声・字幕 (.srt) から Gemini または OpenRouter でチャプター（目次）を生成
  summarize <file>              動画・音声・字幕 (.srt) から Gemini または OpenRouter で構造化要約・ハイライトを生成
  init                          文字起こしおよび文章生成の提供元の選択と API キー・FFmpeg・基本設定の対話型ウィザード
  update [options]              スタンドアロンバイナリを最新リリース版へ自己更新 (エイリアス: upgrade)
  cache (path|stats|clean)      中間キャッシュの確認・統計表示・一括削除
  config (path|show|set|init)   グローバル設定の確認・変更・初期化
  licenses [options]            同梱サードパーティライセンス一覧・条文を表示
```

---

## 応用機能・ユースケース別コマンド例

### 1. 二言語併記 / バイリンガル字幕モード (`--bilingual` / `-b`)
語学学習や国際配信向けに、原語と訳語を 1 つの字幕ブロック内に上下 2 段で併記します：
```bash
# バイリンガル字幕 (.ja.bilingual.srt) と二言語焼き込み動画をワンストップ生成
vsub video.mp4 -t ja --bilingual --burn

# 訳語を上段、原語を下段に並び替え
vsub video.mp4 -t ja -b --bilingual-order target-first
```

### 2. 複数言語・マルチフォーマットの一括出力
文字起こしは 1 回のみ実行し、多言語字幕とテキスト議事録を一括生成します：
```bash
# 日本語・英語・中国語の字幕 (.srt, .vtt) とテキスト (.txt, .json) を一括出力
vsub video.mp4 -t ja,en,zh -f srt,vtt,txt,json
```

### 3. ディレクトリ / バッチ一括処理モード (`vsub batch`)
フォルダ内の全動画や glob パターンに一致する複数メディアを一括処理します：
```bash
# フォルダ内の全動画・音声ファイルを再帰的に一括文字起こし・翻訳
vsub batch ./videos/ -t ja

# 複数ファイルやワイルドカード（glob）での一括処理
vsub batch ./episodes/*.mp4 -t ja,en -f srt,vtt

# 出力先フォルダを指定して生成ファイルを集約
vsub batch ./podcasts/ -t ja -o ./subtitles/

# サブディレクトリ走査の無効化、またはエラー発生時の即時中断 (--fail-fast)
vsub batch ./videos/ --no-recursive --fail-fast
```

### 4. 既存字幕ファイルの直接翻訳 (`vsub translate`)
動画ファイルや文字起こし API を介さず、既存の `.srt` ファイルから直接翻訳・フォーマット変換を行います：
```bash
vsub translate sample.ja.srt -t en -f srt,vtt
```

### 5. 動画への字幕焼き込み (`--burn` & `vsub burn`)
FFmpeg を利用して、映像に字幕が焼き込まれた `.mp4` 動画を出力します：
```bash
# 文字起こし・翻訳と同時に字幕焼き込み動画を出力
vsub video.mp4 -t ja --burn

# 字幕の配置位置 (bottom, top, center) や文字サイズ (small, medium, large, または数値) を調整
vsub video.mp4 -t ja --burn --burn-position top --burn-font-size large

# 既存の字幕ファイルを元動画にカスタム配置・サイズで直接焼き込み
vsub burn video.mp4 video.ja.srt --burn-position top --burn-font-size 28 -o video.subbed.mp4
```

### 6. 動画へのソフトサブ（字幕トラック）高速埋め込み (`--embed` & `vsub embed`)
映像・音声を再エンコードせず、FFmpeg の無劣化ストリームコピーにより、動画プレイヤーで ON/OFF や言語切り替えが可能な字幕トラックを高速格納します（長尺動画でも数秒で完了）：
```bash
# 複数言語の字幕トラックを1つの動画ファイルにまとめて格納
vsub video.mp4 -t ja,en,zh --embed
# => 出力: video.embedded.mp4 (日本語・英語・中国語の切り替え可能トラック入り)

# 既存の動画と複数の SRT 字幕ファイルを直接合成
vsub embed video.mp4 video.ja.srt video.en.srt -o video.subbed.mp4
```

### 7. 長文スマート自動分割 (Reflow) & チャンク間文脈引き継ぎ
1 画面あたりの字幕文字数・表示秒数の自動調整や、チャンク翻訳時の文脈参照行数を制御できます：
```bash
# 字幕1件あたりの目安最大文字数と最大表示秒数をカスタマイズ
vsub video.mp4 -t ja --max-length 28 --max-duration 5

# 自動分割を行わず、Whisper の生セグメント区切りをそのまま維持
vsub video.mp4 -t ja --no-reflow

# 50行ごとの翻訳チャンク間で引き継ぐ直前参照行数を変更 (デフォルト: 5、0 で無効化)
vsub video.mp4 -t ja --context-window 8
```

### 8. 用語集 (Glossary) & カスタムプロンプトの活用

#### インライン用語集の指定
```bash
vsub video.mp4 -t ja --glossary "Generative AI=生成AI,vsub=ブイサブ"
```

#### JSON 用語集ファイルの指定 (多言語・フラット両対応)
```bash
vsub video.mp4 -t ja,zh --glossary ./glossary.json
```

**`glossary.json` のフォーマット例:**
```json
{
  "ja": {
    "Large Language Model": "大規模言語モデル",
    "Agentic AI": "エージェンティックAI"
  },
  "zh": {
    "Large Language Model": "大语言模型",
    "Agentic AI": "智能体AI"
  }
}
```

> [!TIP]
> `--whisper-prompt` を明示しない場合でも、`--glossary` に登録された原語（`Large Language Model, Agentic AI`）が自動的に Whisper の認識ヒントとして渡されるため、音声認識時の聞き取り精度も同時に向上します。

#### 翻訳口調・スタイルのプロンプト指定
```bash
vsub video.mp4 -t ja --prompt "ITエンジニア向けの丁寧なです・ます調で翻訳してください。各行は簡潔にまとめてください。"
```

### 9. AI チャプター生成 & 要約サブコマンド (`vsub chapters` & `vsub summarize`)
任意の動画・音声・既存 `.srt` ファイルから、YouTube 概要欄用チャプターや構造化された Markdown 要約を自動生成します。すでに `vsub` で文字起こし済みのメディアであれば、文字起こしキャッシュを再利用して数秒で完了します：
```bash
# YouTube 概要欄にそのまま貼れるチャプター一覧を生成 ([名前].chapters.txt に保存)
vsub chapters video.mp4 -t ja
vsub chapters subtitle.srt -f json  # 構造化 JSON 配列として出力

# 全体要約・主要ポイント・トピック別ハイライトを生成 ([名前].summary.md に保存)
vsub summarize video.mp4 -t ja
vsub summarize interview.srt -f txt # 装飾なしプレーンテキストで出力
```

### 10. 標準出力ストリーミング & UNIX パイプ連携 (`--stdout` / `-o -`)
ファイルを作成せず、生成データを直接 `stdout` へストリーミングします（進行スピナーは自動的に `stderr` へ分離されるため、パイプ先へ純粋なデータのみを渡せます）：
```bash
# JSON 形式の字幕データを直接 jq でフィルタリング
vsub video.mp4 -t en -f json --stdout | jq '.[0]'

# 生成した YouTube チャプターをクリップボードへ直接コピー
vsub chapters video.mp4 --stdout | pbcopy

# 会議動画の要約をリダイレクトでファイル保存
vsub summarize meeting.mp4 --stdout > summary.md
```

### 11. キャッシュ管理 & スタンドアロンバイナリ自己更新
```bash
# キャッシュ使用状況の確認・全消去
vsub cache stats
vsub cache clean

# 新バージョンの確認・最新の GitHub Release への自己更新 (OS/Arch自動判別・SHA-256検証付き)
vsub update --check
vsub update
```

### 12. 文字起こしの修正（`--refine`）
字幕を組み立てたあと、`--save-original` や翻訳の前に、文字起こしの誤認識を文章の生成モデルで修正します（メインコマンドと `vsub batch` で利用可能、初期は無効）：
```bash
# 用語集と組み合わせて文字起こしを直してから日本語へ翻訳
vsub video.mp4 -t ja --glossary ./glossary.json --refine

# 翻訳はせず、修正済みの原語字幕だけを出力
vsub video.mp4 --no-translate --refine
```
* **直す内容**: 同音異義語・誤変換（誤った漢字など）、聞き間違えられた固有名詞や専門用語、語の区切りの崩れなど、明らかな音声認識の誤りを直します。
* **使う提供元とモデル**: `--llm-provider` / `--llm-model` / `--gemini-model` で選ばれた文章の生成の提供元とモデルを使います。
* **用語集と指示**: `--glossary` があると最も効きます（無い場合の改善幅は小さくなります）。`--prompt` も背景情報のメモとして渡されます。言語ごとの用語集ファイルでは、最初の翻訳先の表を使って用語の綴りと参考訳を渡します。
* **時刻と行数**: 時刻・番号・行数は変わりません。いずれかの 50 行チャンクでモデルの返答行数が一致しなかった場合は、そのチャンクは元の文字をそのまま使い、警告を表示します。
* **直せないこと**: **文字起こしで落ちた発話は戻りません。また、字幕の時刻は直りません。**
* **出力と翻訳元への反映**: `--save-original` の出力、`--bilingual` の原文、`--no-translate` の出力、および翻訳に渡る原文には、すべて修正後の字幕が使われます。
* **費用とキャッシュ**: 費用は字幕全体を 1 回 LLM に通す分（翻訳 1 言語より少し少ない程度）です。初めて `--refine` を付けたときは原文が変わるため翻訳し直しになります。修正前の文字起こしのキャッシュは別に残るため、あとで `--refine` を外しても文字起こしはやり直しません（翻訳は、元の原文でもう一度行います）。

---

## グローバル設定コマンド (`vsub config`)

```bash
# 現在の設定内容（API Key はマスク表示）を確認
vsub config show

# デフォルトのCLI表示言語・翻訳プロンプト・用語集・並行数・分割文字数・焼き込みスタイルを永続保存
vsub config set --lang ja --prompt "丁寧な敬体で翻訳" --glossary "./glossary.json" --concurrency 4
vsub config set --max-length 32 --burn-position bottom --burn-font-size medium
vsub config set --stt-provider openrouter --openrouter-key "your_openrouter_key"
vsub config set --llm-provider openrouter

# 新バージョンの自動更新チェックを無効化
vsub config set --disable-update-check true

# 設定ファイルの物理パスを表示
vsub config path
```

---

## ライセンス

本ツールのソースコードは [MIT License](LICENSE) に基づき公開されています。

### サードパーティライセンス表記
スタンドアロンバイナリ（単体実行版）には、以下のオープンソースライブラリ（MIT, Apache-2.0, BSD-2-Clause, ISC）が同梱されています：
* `@google/genai` (Apache-2.0)
* `commander` (MIT)
* `dotenv` (BSD-2-Clause)
* `execa` (MIT)
* `groq-sdk` (Apache-2.0)
* `ora` (MIT)
* `picocolors` (ISC)

CLI からいつでも同梱ライセンス一覧や全文条文を確認できます：
```bash
# サードパーティライセンス一覧を表示
vsub licenses

# 全文条文を出力
vsub licenses --full
```
また、GitHub Releases の各配布アーカイブには `THIRD_PARTY_LICENSES.txt` が同梱されています。
