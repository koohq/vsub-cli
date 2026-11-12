# vsub-cli (Video & Audio Subtitle CLI)

[![npm version](https://img.shields.io/npm/v/vsub-cli)](https://www.npmjs.com/package/vsub-cli)
[![CI](https://img.shields.io/github/actions/workflow/status/koohq/vsub-cli/ci.yml?branch=main&label=CI)](https://github.com/koohq/vsub-cli/actions/workflows/ci.yml?query=branch%3Amain)
[![License](https://img.shields.io/github/license/koohq/vsub-cli)](https://github.com/koohq/vsub-cli/blob/main/LICENSE)

[English](README.md) | [日本語](README.ja.md)

動画や音声のファイルから字幕を作る、高速で止まりにくい CLI ツールです。音声を取り出して軽くしたうえで、**OpenRouter（ElevenLabs Scribe v2、既定）** または **Groq（`whisper-large-v3-turbo`）** で文字起こしを行い、**Google Gemini の直接利用（`gemini-3.8-flash`）または OpenRouter 経由（`google/gemini-3.8-flash`）** で、多言語の字幕・テキスト・チャプター・要約を作ります。

---

## 主な特徴

* ⚡ **正確で速い文字起こし**: 既定では OpenRouter 経由の ElevenLabs Scribe v2（`elevenlabs/scribe-v2`）で文字起こしします。非常に高速な Groq の Whisper（`whisper-large-v3-turbo`）も選べます。
* 🎵 **動画と音声の両方に対応**: 動画ファイル（`.mp4`、`.mkv`、`.mov` など）も音声ファイル（`.mp3`、`.wav`、`.m4a`、`.aac`、`.flac`、`.ogg`、`.opus` など）も、そのまま渡せます。
* 🔊 **音声の自動最適化**: `ffmpeg` で 16kHz・モノラル・48kbps に圧縮し、提供元ごとの上限に収まるようにします（OpenRouter は 5 分ごと、Groq は 25MB を超えたときに分割）。分割は目安の位置の手前の無音で行い、無音が無ければ目安の位置で分割します。長いメディアは自動で分割し、分割した各部分の実際の長さをもとに、ミリ秒単位でタイムコードを計算します。
* 🎯 **タイムコードを崩さず、文脈をつないで翻訳**: 字幕の文章だけを、Google Gemini の直接利用（`gemini-3.8-flash`）または OpenRouter 経由（`google/gemini-3.8-flash`）で、まとまりごとに翻訳します。Structured Outputs（JSON スキーマ。Gemini は `responseSchema`、OpenRouter は `response_format`）と、直前の行を参照するスライディングウィンドウ（`--context-window`）を使うため、タイムコードの崩れや行のずれが起きず、まとまりの境目でも口調が自然につながります。
* ✂️ **長い字幕の自動分割（リフロー）**: Scribe v2 では、単語ごとのタイムスタンプから字幕の区切りを作ります。長すぎる字幕は、句読点や節の切れ目など自然な位置で分け、表示時間もミリ秒単位で長さに応じて割り振ります（`--max-length`、`--max-duration`、`--no-reflow`）。
* 🚀 **翻訳の並列実行**: 非同期のワーカープールで、字幕のまとまりを並列に翻訳します（`--concurrency`、既定は 3）。429 などのレート制限に当たったときは、ゆらぎ（ジッター）付きの指数バックオフで再試行します。
* 💾 **途中結果のキャッシュ**: 文字起こし・翻訳・チャプター・要約の結果を自動で保存します。キーは、メディアファイルのサイズと、先頭・中央・末尾から読み取った中身から作る SHA-256 ハッシュです。ファイルを移動したり名前を変えたりしても、キャッシュを使い回せます。文字起こしのキャッシュは、提供元・モデル・認識のヒントが同じときだけ使い回します。再実行や翻訳先の言語の追加では、済んだ API 呼び出しを繰り返さずにすぐ結果が出ます（`vsub cache`）。翻訳が途中で失敗したときは、済んだチャンクをキャッシュに残し、同じコマンドをもう一度実行すると続きから訳します（`--no-cache` では残さず、`--fresh` では最初から訳します）。
* 📖 **用語集と指示の追加**: 翻訳への追加の指示（`--prompt`）、分野ごとの用語集（`--glossary`。JSON ファイルまたは `Key=Val` の直接指定）、Whisper 向けの認識のヒント（`--whisper-prompt`）を渡せます。
* 🌍 **複数言語の同時出力と二言語字幕**: 1 回の実行で複数の言語の字幕を作れます（例: `-t ja,en,zh`）。原文と訳文を組にした二言語字幕も作れます（`-b, --bilingual`）。
* 📄 **複数の形式と標準出力**: `.srt`（SubRip）、`.vtt`（WebVTT）、`.txt`（プレーンテキスト）、`.json`（構造化データ）で保存できます。`stdout` に直接流すこともでき（`--stdout` / `-o -`）、UNIX のパイプ（`jq`、`pbcopy`）や AI エージェントとの連携に使えます。
* 📑 **AI によるチャプターと要約**: メディアや `.srt` ファイルから、YouTube にそのまま使えるタイムスタンプ（`vsub chapters`）や、構造化した Markdown の要約（`vsub summarize`）を作ります。文字起こしのキャッシュがあれば、それを使ってすぐに結果が出ます。
* 🎬 **字幕の焼き込みと、劣化のない字幕トラックの埋め込み**: 位置と文字の大きさを指定して、字幕を映像に焼き込めます（`--burn`、`--burn-position`、`--burn-font-size`）。再エンコードせずに、表示を切り替えられる複数言語の字幕トラックを数秒で埋め込むこともできます（`--embed`、`vsub embed`）。
* 📁 **フォルダやまとめての一括処理**: フォルダ全体、glob パターン、複数の動画・音声ファイルを、1 件ずつ順に処理します。途中の 1 件が失敗しても残りを続け、最後に結果をまとめて表示します（`vsub batch`）。
* 🛡️ **上書きの防止とバックアップ**: 処理を始める前に出力先の衝突を確かめ、対話環境では上書きしてよいか尋ねます（`y/N`）。確認せずに上書きする `-w, --overwrite` と、上書き前に `.bak` / `.bak.N` として残す `--backup` もあります。
* 🔄 **既存の字幕の翻訳**: メディアファイルや文字起こし API を使わずに、既存の `.srt` ファイルを別の言語や形式に翻訳します（`vsub translate`）。
* 🛠️ **対話式のセットアップと自己更新**: 案内に沿って設定できるウィザード（`vsub init`）、設定の保存（`vsub config`）、SHA-256 で検証する単体実行ファイルの自己更新（`vsub update`）を備えています。

---

## インストール

`vsub-cli` は、**Node.js がいらない単体の実行ファイル**としても、npm パッケージとしても使えます。

### 方法 1: 単体の実行ファイル（推奨、Node.js 不要）
[GitHub Releases](https://github.com/koohq/vsub-cli/releases) から、お使いの OS と CPU に合ったアーカイブをダウンロードしてください。

* **Windows x64**: `vsub-windows-x64.zip`
* **Windows ARM64**: `vsub-windows-arm64.zip`
* **Linux x64**: `vsub-linux-x64.tar.gz`
* **Linux ARM64**: `vsub-linux-arm64.tar.gz`
* **macOS ARM64（Apple Silicon）**: `vsub-macos-arm64.tar.gz`

各アーカイブには、実行ファイル（`vsub` または `vsub.exe`）と、本体およびサードパーティのライセンス表記が入っています。サイズは 25〜35 MB 程度です。

> [!NOTE]
> * Intel Mac（x64）では、Node.js の SEA（単体実行ファイル化の機能）の制約のため、**方法 2（npm / pnpm）** をお使いください。
> * 音声の取り出し、字幕の焼き込み（`--burn`）、字幕トラックの埋め込み（`--embed`）には、`ffmpeg` / `ffprobe` が必要です（見つからない場合は、`vsub init` がインストール方法を表示します）。

```bash
# アーカイブを展開する（Linux / macOS）
tar -xzf vsub-macos-arm64.tar.gz

# 実行権限を付ける（Linux / macOS）
chmod +x vsub

# 対話式のセットアップを始める
./vsub init
```

Windows では、`vsub-windows-x64.zip` を展開して `vsub.exe init` を実行してください（`PATH` の通ったフォルダに `vsub.exe` を置くと、どこからでも `vsub` で呼び出せます）。

### 方法 2: npm / pnpm でグローバルにインストール（Node.js 環境向け）
パッケージは [npm](https://www.npmjs.com/package/vsub-cli) で公開しています。

```bash
# npm でインストール
npm install -g vsub-cli

# または pnpm でインストール
pnpm add -g vsub-cli
```

---

## 必要なもの

1. **ffmpeg / ffprobe**: システムにインストールされていること（または `--ffmpeg-path` / `VSUB_FFMPEG_PATH` で場所を指定）
2. **API キー**:
   * **OpenRouter の API キー 1 つ**（`VSUB_OPENROUTER_API_KEY`。[OpenRouter](https://openrouter.ai/keys) で取得）だけで、文字起こしから翻訳・チャプター・要約まで、すべて使えます。
   * **Gemini の API キー**（`VSUB_GEMINI_API_KEY`。[Google AI Studio](https://aistudio.google.com/) で取得）を設定すると、翻訳・チャプター・要約には Gemini を直接使います。
   * 非常に高速な Whisper で文字起こしをしたい場合は、[Groq Console](https://console.groq.com/) で取得した `VSUB_GROQ_API_KEY` も使えます。
3. **Node.js**: v26 以降、または v24 以降（npm / pnpm でインストールする場合と、ソースからビルドする場合だけ必要）

---

## セットアップと API キーの設定

API キーは、次の **3 つの方法** のどれかで設定します。

### 方法 1: 対話式のセットアップ（推奨、いちばん簡単）
`vsub init` を実行すると、対話式のウィザードが始まります。文字起こしの提供元（OpenRouter または Groq）と文章の生成の提供元（Gemini または OpenRouter）を選び、API キーと FFmpeg が使えるかを確かめてから、設定を保存します。
```bash
# 対話式のセットアップを始める
vsub init

# OpenRouter のキー 1 つですべて使う場合:
vsub config set --openrouter-key "your_openrouter_key"

# OpenRouter と Gemini の両方のキーを設定する場合:
vsub config set --openrouter-key "your_openrouter_key" --gemini-key "your_gemini_key"

# Groq を使う場合:
vsub config set --stt-provider groq --groq-key "your_groq_key" --gemini-key "your_gemini_key"
```

### 方法 2: 環境変数（`VSUB_` で始まる名前）
シェルやシステムの環境変数に設定します（名前が `VSUB_` で始まるので、他のツールの設定とぶつかりません）。
```bash
# OpenRouter のキー 1 つ（これだけですべて使えます）:
export VSUB_OPENROUTER_API_KEY="your_openrouter_api_key_here"

# 任意: Gemini のキーがあれば、翻訳・チャプター・要約に Gemini を直接使います:
# export VSUB_GEMINI_API_KEY="your_gemini_api_key_here"

# 任意: Gemini のキーがあっても OpenRouter を使い続ける場合:
# export VSUB_LLM_PROVIDER="openrouter"

# Groq を使う場合:
# export VSUB_STT_PROVIDER="groq"
# export VSUB_GROQ_API_KEY="your_groq_api_key_here"
```
*（一般的な名前の `GROQ_API_KEY` と `GEMINI_API_KEY` も、代わりとして読み込みます。汎用の `OPENROUTER_API_KEY` は、OpenRouter を明示したときだけ読み込みます。[文字起こしの提供元の選び方](#文字起こしの提供元の選び方)と[文章の生成の提供元の選び方](#文章の生成の提供元の選び方)を参照してください。）*

### 方法 3: `.env` ファイル
実行するときのカレントディレクトリに `.env` ファイルを置きます。
```env
# OpenRouter のキー 1 つ（これだけですべて使えます）:
VSUB_OPENROUTER_API_KEY=your_openrouter_api_key_here

# 任意: Gemini のキーがあれば、翻訳・チャプター・要約に Gemini を直接使います:
# GEMINI_API_KEY=your_gemini_api_key_here

# 任意: Gemini のキーがあっても OpenRouter を使い続ける場合:
# VSUB_LLM_PROVIDER=openrouter

# Groq を使う場合:
# VSUB_STT_PROVIDER=groq
# GROQ_API_KEY=your_groq_api_key_here
```

---

## 文字起こしの提供元の選び方

vsub は、次の順で文字起こしの提供元を決めます。
1. コマンドラインオプション `--stt-provider <openrouter|groq|openai-compatible>`
2. 環境変数 `VSUB_STT_PROVIDER`、または設定ファイルの `sttProvider`
3. 設定されているキーからの自動選択:
   - `VSUB_OPENROUTER_API_KEY`（または保存済みの OpenRouter のキー）がある → **OpenRouter**
   - それがなく、Groq のキーがある → **Groq**
   - どちらもない → **OpenRouter**

> [!NOTE]
> 汎用の環境変数 `OPENROUTER_API_KEY` は、オプションや設定で OpenRouter を明示したときだけ読み込みます。他の開発ツール用に設定したキーで、知らないうちに課金や利用量が変わるのを防ぐためです。

### Groq をお使いの方へ
`vsub-cli` を更新しても、そのまま Groq を使い続けられます。これまでの文字起こしのキャッシュも有効です。自動選択で Groq になったときは、OpenRouter を勧める案内が 1 行表示されます。この案内を消すには、`VSUB_STT_PROVIDER=groq` または `vsub config set --stt-provider groq` で Groq を明示してください。

### モデルと認識のヒント
* **モデル**:
  - `--stt-model <model>` で、選んだ提供元の文字起こしモデルを指定できます。
  - `VSUB_OPENROUTER_STT_MODEL`（設定ファイルでは `openrouterSttModel`）で、OpenRouter の既定のモデルを変えられます（既定は `elevenlabs/scribe-v2`）。
  - `VSUB_GROQ_MODEL`（設定ファイルでは `groqModel`）で、Groq の既定のモデルを変えられます（既定は `whisper-large-v3-turbo`）。
  - **OpenRouter で動作を確かめたモデルは `elevenlabs/scribe-v2` だけです**。ほかのモデルも `--stt-model` で指定できますが、確かめていないため、動かないことがあります。
  - モデルは、区切りごと（または単語ごと）の開始・終了時刻を含む結果（`verbose_json`）を返せる必要があります。時刻を返さないモデルでは字幕を作れないため、エラーで止まります。
* **認識のヒント**:
  - 認識のヒント（`--whisper-prompt` と、`--glossary` から取り出した用語）は、Groq の Whisper と openai-compatible の提供元にだけ送ります。OpenRouter には送りません。

---

### OpenAI 互換の文字起こし（動作保証外）

**作者が確認していないため、動作保証外です。** ローカルのサーバーや OpenAI への直接接続など、OpenAI 互換の API 向けです。API キーから自動では選ばれません。`--stt-provider openai-compatible`、`VSUB_STT_PROVIDER=openai-compatible`、または `vsub config set --stt-provider openai-compatible` で明示的に選んでください。

URL とモデルが必要で、既定値はありません。環境変数は保存した設定より優先され、`.env` にも書けます。

```dotenv
VSUB_OPENAI_COMPATIBLE_STT_BASE_URL=http://localhost:8000/v1
VSUB_OPENAI_COMPATIBLE_STT_MODEL=whisper-1
VSUB_OPENAI_COMPATIBLE_STT_API_KEY=test-key-1234
```

```bash
vsub config set --stt-provider openai-compatible --openai-compatible-stt-base-url http://localhost:8000/v1 --openai-compatible-stt-model whisper-1
vsub config set --openai-compatible-stt-key test-key-1234
```

キーは任意で、無ければ `Authorization` ヘッダーを送りません。キーは設定した URL に送られるため、ローカル以外では `https://` を使ってください。専用の `VSUB_OPENAI_COMPATIBLE_STT_*` だけを読み、`OPENAI_API_KEY`・`OPENAI_BASE_URL` は読みません。文字起こしと文章の生成の設定は独立しています。1 回だけモデルを変えるには `--stt-model` を使います。

`verbose_json` と segment または word の時刻を返す API が必要です。リクエストは 1 つずつ送り、タイムアウトは 300 秒、ファイルの上限は 24 MB、音声の分割は最大 300 秒です。認識のヒントは `prompt` で送ります。

## 文章の生成の提供元の選び方

vsub は、次の順で文章の生成（翻訳・チャプター・要約）の提供元を決めます。
1. コマンドラインオプション `--llm-provider <gemini|openrouter|openai-compatible>`
2. 環境変数 `VSUB_LLM_PROVIDER`、または設定ファイルの `llmProvider`
3. 設定されているキーからの自動選択:
   - Gemini のキー（`VSUB_GEMINI_API_KEY`、`GEMINI_API_KEY`、または保存済みのキー）がある → **Gemini**
   - それ以外 → **OpenRouter**

> [!NOTE]
> 汎用の環境変数 `OPENROUTER_API_KEY` は、オプションや設定で OpenRouter を明示したときだけ読み込みます。理由は文字起こしと同じです（[文字起こしの提供元の選び方](#文字起こしの提供元の選び方)を参照）。

### Gemini をお使いの方へ
`vsub-cli` を更新しても、設定を変えずにそのまま Gemini を直接使い続けられます。これまでの翻訳・チャプター・要約のキャッシュも、すべて有効です。

### モデル・残高・費用
* **モデル**:
  - `--llm-model <model>` で、選んだ提供元の文章の生成モデルを指定できます。
  - `--gemini-model <model>` / `VSUB_GEMINI_MODEL`（設定ファイルでは `geminiModel`）で、Gemini のモデルを指定できます（提供元が Gemini のときだけ使います）。
  - `VSUB_OPENROUTER_LLM_MODEL`（設定ファイルでは `openrouterLlmModel`、既定は `google/gemini-3.8-flash`）で、OpenRouter の既定のモデルを変えられます。
  - **OpenRouter で動作を確かめたモデルは `google/gemini-3.8-flash` だけです**。ほかのモデルも `--llm-model` で指定できますが、確かめていません。JSON スキーマによる構造化出力に対応していないモデルでは失敗することがあります。
* **OpenRouter の残高と並列数**:
  - OpenRouter は、リクエストごとに最大出力トークン数（`max_tokens: 16384`）に見合う額を一時的に確保します。残高が足りないと、402（Insufficient Credits）のエラーで止まり、対処方法を表示します。`--concurrency`（既定は 3）を下げると、同時に確保される額を減らせます。
* **キャッシュ**:
  - 提供元やモデルを変えると、翻訳・チャプター・要約は新しく作り直します。途中結果のキャッシュは、提供元・モデル・プロンプトがすべて同じときだけ使い回します。

---

### OpenAI 互換の文章の生成（動作保証外）

**作者が確認していないため、動作保証外です。** ローカルのサーバーや OpenAI への直接接続など、OpenAI 互換の API 向けです。API キーから自動では選ばれません。`--llm-provider openai-compatible`、`VSUB_LLM_PROVIDER=openai-compatible`、または `vsub config set --llm-provider openai-compatible` で明示的に選んでください。

URL とモデルが必要で、既定値はありません。環境変数は保存した設定より優先され、`.env` にも書けます。

```dotenv
VSUB_OPENAI_COMPATIBLE_LLM_BASE_URL=http://localhost:11434/v1
VSUB_OPENAI_COMPATIBLE_LLM_MODEL=my-model
VSUB_OPENAI_COMPATIBLE_LLM_REASONING_EFFORT=low
VSUB_OPENAI_COMPATIBLE_LLM_API_KEY=test-key-1234
```

```bash
vsub config set --llm-provider openai-compatible --openai-compatible-llm-base-url http://localhost:11434/v1 --openai-compatible-llm-model my-model
vsub config set --openai-compatible-llm-key test-key-1234
vsub config set --openai-compatible-llm-reasoning-effort low
```

キーは任意で、無ければ `Authorization` ヘッダーを送りません。キーは設定した URL に送られるため、ローカル以外では `https://` を使ってください。専用の `VSUB_OPENAI_COMPATIBLE_LLM_*` だけを読み、`OPENAI_API_KEY`・`OPENAI_BASE_URL` は読みません。文字起こしと文章の生成の設定は独立しています。1 回だけモデルを変えるには `--llm-model` を使います。

`response_format` による strict な JSON schema の出力に対応するモデルが必要です。既定では `max_tokens` も推論の量も送りません。推論するモデルは、サーバーの既定の推論の量で動くと遅く高くなることがあるため、`VSUB_OPENAI_COMPATIBLE_LLM_REASONING_EFFORT`（または `config set --openai-compatible-llm-reasoning-effort`）を設定すると、`reasoning_effort` として送って抑えられます。`low` などの値はそのまま送るので、サーバーとモデルが受け付ける値を使ってください。受け付けない値や欄だとエラーになるサーバーもあります。ほかの提供元（`gemini`・`openrouter`）には効きません。`max_tokens` と入れ子の `reasoning` は引き続き送らず、並行数の既定は 1、タイムアウトは 300 秒です。並行数は既存の `--concurrency`・`VSUB_CONCURRENCY`・設定ファイルで上書きできます。

## 使い方

### 基本

```bash
# 動画や音声から日本語の字幕（[メディア名].ja.srt）を作る
vsub path/to/video.mp4
vsub path/to/podcast.mp3

# リポジトリを clone してソースから直接動かす場合:
pnpm dev path/to/video.mp4
```

### ヘルプ

実際の `vsub --help` は英語で表示されます。下は、説明の部分を日本語に訳したものです。

```text
Usage: vsub [options] [command] [media-file]

Arguments:
  media-file                    処理する動画または音声のファイル (.mp4, .mp3, .wav, .m4a, .mov など)

Options:
  -l, --lang <lang>             画面の表示言語: en (既定), ja
  -t, --target-lang <langs>     翻訳先の言語コード。カンマ区切りで複数指定できる (例: ja,en,es) (既定: 設定の値、なければ ja)
  -f, --format <formats>        出力形式: srt, vtt, txt, json をカンマ区切りで指定 (既定: "srt")
  -o, --output <path>           字幕ファイルの出力先またはベース名 ('-' で標準出力)。--embed / --burn で動画のパス (例: out.mkv) を指定したときは、字幕を out.<言語>.<形式> に保存する
  --stdout                      ファイルに保存せず、字幕を標準出力に出す (既定: false)
  -w, --overwrite               確認せずに既存のファイルを上書きする (既定: false)
  --backup                      上書きする前に、既存のファイルを .bak として残す (既定: false)
  -b, --bilingual               原文と訳文を組にした二言語字幕を作る (既定: false)
  --bilingual-order <order>     二言語字幕の並び順: original-first または target-first (既定: "original-first")
  --ffmpeg-path <path>          ffmpeg の実行ファイルのパス (省略時は VSUB_FFMPEG_PATH、次に PATH から探す)
  --stt-provider <provider>     文字起こしの提供元: openrouter、groq、openai-compatible (既定: VSUB_STT_PROVIDER、設定の値、または API キーから自動選択)
  --stt-model <model>           選んだ提供元の文字起こしモデル (既定: OpenRouter は elevenlabs/scribe-v2、Groq は whisper-large-v3-turbo、openai-compatible は設定したモデル)
  --groq-model <model>          文字起こしに使う Groq の Whisper モデル (提供元が groq のときだけ使う)
  --whisper-prompt <text>       Groq の Whisper に渡す認識のヒント (Groq と openai-compatible のみ。OpenRouter には送らない)
  --prompt <instruction>        翻訳への追加の指示
  --context <text-or-path>      話者・関係・場面の背景メモを文字列またはテキストファイルのパスで指定 (翻訳と --refine に、指示ではなく背景として渡す)
  --glossary <path-or-terms>    用語集の JSON ファイルのパス、または直接指定の用語 (Key=Val,Key=Val)
  --concurrency <number>        翻訳のリクエストを同時にいくつ送るか (既定: 3)
  --gemini-model <model>        翻訳に使う Gemini のモデル (提供元が Gemini のときだけ)
  --llm-provider <provider>     翻訳・チャプター・要約に使う文章の生成の提供元: gemini、openrouter、openai-compatible (既定: VSUB_LLM_PROVIDER、設定の値、または API キーから自動選択)
  --llm-model <model>           選んだ提供元の文章の生成モデル (既定: Gemini は gemini-3.8-flash、OpenRouter は google/gemini-3.8-flash、openai-compatible は設定したモデル)
  --no-cache                    途中結果のキャッシュを読まず、保存もしない (既定: false)
  --fresh                       既存のキャッシュを使わずに作り直し、キャッシュを上書きする (既定: false)
  --cache-dir <path>            キャッシュを置くディレクトリ
  --context-window <lines>      翻訳のまとまりをまたいで参照する直前の行数 (0 で無効) (既定: 5)
  --max-length <chars>          字幕 1 件の最大文字数。超えると自動で分割する (既定: CJK は 32、欧文は 75)
  --max-duration <seconds>      字幕 1 件の最大表示秒数 (既定: 7)
  --no-reflow                   長い字幕の自動分割をしない (既定: false)
  --burn                        作った字幕を動画に焼き込んで出力する (ハードサブ) (既定: false)
  --burn-position <pos>         --burn の字幕の位置: bottom (既定)、top、center
  --burn-font-size <size>       --burn の文字の大きさ: small、medium、large、または数値 (既定: auto)
  --embed                       作った字幕を、字幕トラックとして動画に埋め込む (ソフトサブ) (既定: false)
  --keep-audio                  途中で取り出した音声ファイルを消さずに残す (既定: false)
  --no-translate                翻訳せず、文字起こしした字幕をそのまま出力する (既定: false)
  --save-original               翻訳した字幕と一緒に、文字起こしした原文の字幕も保存する (既定: false)
  --refine                      翻訳の前に、文章の生成モデルで文字起こしの認識の誤りを直す (既定: VSUB_REFINE、設定ファイル、または無効。--glossary、--prompt、--context を使う。時刻と行数は変えない)
  --no-refine                   VSUB_REFINE や設定ファイルで有効になっていても、文字起こしを修正しない
  --diarize                     OpenRouter の elevenlabs/scribe のモデルに話者の判別を頼み、翻訳に渡す。話者が変わる所でも字幕を切る (既定: VSUB_DIARIZE、設定ファイル、または無効)
  --no-diarize                  VSUB_DIARIZE や設定ファイルで有効になっていても、話者の判別を頼まない
  --force-translate             検出した言語が翻訳先と同じでも翻訳する (既定: false)
  --no-update-check             新しいバージョンの確認をしない (既定: false)
  --verbose                     詳しいログ (API リクエストなど) を出す (既定: false)
  -h, --help                    ヘルプを表示する

Commands:
  batch <targets...>            複数のメディアファイルをまとめて処理する (フォルダ、複数のファイル、glob パターン)
  translate <subtitle-file>     既存の字幕ファイル (.srt) を Gemini または OpenRouter で直接翻訳する
  burn <video-file> <sub-file>  既存の字幕ファイル (.srt) を FFmpeg で動画に焼き込む (ハードサブ)
  embed <video> <sub-files...>  1 つ以上の字幕ファイル (.srt) を、FFmpeg のストリームコピーで字幕トラックとして動画に埋め込む
  chapters <file>               メディアまたは字幕ファイルから、Gemini または OpenRouter で動画のチャプター (目次) を作る
  summarize <file>              メディアまたは字幕ファイルから、Gemini または OpenRouter で構造化した要約と主な話題を作る
  init                          文字起こしと文章の生成の提供元を選び、API キー・FFmpeg・各種設定を確かめる対話式のウィザード
  update [options]              単体の実行ファイルを最新のリリースに更新する (別名: upgrade)
  cache (path|stats|clean)      文字起こしと翻訳の途中結果のキャッシュを管理する
  config (path|show|set|init)   全体の設定を管理する
  licenses [options]            サードパーティのオープンソースのライセンスと表記を表示する
```

---

## 応用機能と使用例

### 1. 二言語字幕（`--bilingual` / `-b`）
文字起こしした原文と訳文を組にした、二言語の字幕を作ります。
```bash
# 二言語字幕 (.ja.bilingual.srt) と、それを焼き込んだ動画を作る
vsub video.mp4 -t ja --bilingual --burn

# 訳文を上、原文を下に並べる
vsub video.mp4 -t ja -b --bilingual-order target-first
```

### 2. 複数の言語と形式をまとめて出力
音声の取り出しと文字起こしは 1 回だけ行い、すべての字幕とテキストを一度に作ります。
```bash
# 日本語・英語・中国語の字幕を、SRT・WebVTT・TXT・JSON で出力する
vsub video.mp4 -t ja,en,zh -f srt,vtt,txt,json
```

### 3. フォルダやまとめての一括処理（`vsub batch`）
フォルダ内や glob パターンに合う複数のメディアファイルを、1 回の実行で処理します。
```bash
# フォルダ内のメディアファイルを、サブフォルダも含めてすべて処理する
vsub batch ./videos/ -t ja

# 複数のファイルや glob パターンを指定して処理する
vsub batch ./episodes/*.mp4 -t ja,en -f srt,vtt

# 作ったファイルを、すべて専用の出力フォルダに保存する
vsub batch ./podcasts/ -t ja -o ./subtitles/

# サブフォルダを探さない、または最初のエラーですぐ止める
vsub batch ./videos/ --no-recursive --fail-fast
```

### 4. 既存の字幕の翻訳（`vsub translate`）
メディアファイルや文字起こし API を使わずに、既存の `.srt` ファイルを翻訳します。
```bash
vsub translate sample.ja.srt -t en -f srt,vtt
```

`vsub translate` でも `--context <text-or-path>` で話者や場面の背景メモを渡せます（[話者や場面の背景メモを渡す](#話者や場面の背景メモを渡す)）。

### 5. 動画への字幕の焼き込み（`--burn` と `vsub burn`）
FFmpeg で、字幕を焼き込んだ `.mp4` 動画を作ります。
```bash
# 文字起こし・翻訳・焼き込みを 1 つのコマンドで行う
vsub video.mp4 -t ja --burn

# 字幕の位置 (bottom、top、center) と文字の大きさ (small、medium、large、または数値) を指定する
vsub video.mp4 -t ja --burn --burn-position top --burn-font-size large

# 既存の字幕ファイルを、位置と大きさを指定して動画に焼き込む
vsub burn video.mp4 video.ja.srt --burn-position top --burn-font-size 28 -o video.subbed.mp4
```

### 6. 字幕トラックの高速な埋め込み（`--embed` と `vsub embed`）
映像も音声も再エンコードせずに、表示を切り替えられる字幕トラックとして動画に埋め込みます（FFmpeg のストリームコピーを使うので、劣化がなく数秒で終わります）。
```bash
# 複数の言語の字幕トラックを、1 つの MP4 動画に埋め込む
vsub video.mp4 -t ja,en,zh --embed
# => 出力: video.embedded.mp4 (日本語・英語・中国語のトラックを切り替えられる)

# 既存の 1 つ以上の SRT ファイルを、動画に直接埋め込む
vsub embed video.mp4 video.ja.srt video.en.srt -o video.subbed.mp4
```

### 7. 長い字幕の自動分割と、翻訳での文脈の引き継ぎ
長い発話をどう分けるか、翻訳のまとまりの間でどれだけ文脈を引き継ぐかを調整できます。
```bash
# 字幕 1 件あたりの最大文字数と最大表示秒数を変える
vsub video.mp4 -t ja --max-length 28 --max-duration 5

# 自動分割をせず、文字起こしで得た区切りのまま残す
vsub video.mp4 -t ja --no-reflow

# 50 行ずつの翻訳のまとまりで、引き継ぐ直前の行数を変える (既定: 5、0 で無効)
vsub video.mp4 -t ja --context-window 8
```

### 8. 用語集と指示の追加
用語集は `vsub chapters` と `vsub summarize` でも使えます。

#### 用語集を直接指定する
```bash
vsub video.mp4 -t ja --glossary "Generative AI=生成AI,vsub=ブイサブ"
```

#### 用語集の JSON ファイルを使う（言語ごと、または言語なしの形）
```bash
vsub video.mp4 -t ja,zh --glossary ./glossary.json
```

**`glossary.json` の例:**
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
> Groq の Whisper（または openai-compatible の提供元）で文字起こしする場合は、`--whisper-prompt` を省略しても、`--glossary` の原語（`Large Language Model, Agentic AI`）が認識のヒントとして自動で渡され、音声認識の精度も上がります（OpenRouter には送りません）。

#### 翻訳の口調や指示を変える
```bash
vsub video.mp4 -t ja --prompt "ITエンジニア向けに、丁寧なです・ます調で翻訳してください。各行は簡潔にまとめてください。"
```

#### 話者や場面の背景メモを渡す
```bash
vsub talk.mp4 -t ja --context ./cast.txt
```

`cast.txt` の例:
```text
Alex は店長、Sam は新人のアルバイト。
Sam は Alex に敬語で話す。Alex は Sam を呼び捨てにする。
```

`--prompt` には訳し方の指示を、`--context` には話者・関係・場面の背景を書きます（指示としては扱いません）。背景メモは短く書くと効果的で、存在するファイルなら UTF-8 の中身を、そうでなければ指定した文字列を使います。直前の字幕を何行渡すかを決める `--context-window` とは別の指定です。

#### 話者の判別（`--diarize`）

話者の判別は、`--diarize`（メインと `vsub batch`）、`VSUB_DIARIZE=true`、または `vsub config set --diarize true` で有効にします。1 回だけ外すときは `--no-diarize` を使います。優先順位は `--diarize` / `--no-diarize` → 環境変数 → 設定ファイル → 無効です。OpenRouter の `elevenlabs/scribe` のモデルだけに頼みます。OpenRouter のほかのモデルでは文字起こし時に警告を出して頼まず、Groq と `openai-compatible` は話者なしで処理します。

話者が変わる所でも字幕を切り、翻訳で口調・一人称・呼び方をそろえるためにラベルを使います。SRT・VTT・TXT・JSON の字幕ファイルには話者を出しません。`--refine` の依頼文にも入れず、修正後もラベルを保って翻訳に渡します。自動の判別なので、間違えることがあります。

5 分を超える音声は 5 分ずつに分けて送ります。区切りが複数なら `2/speaker_0` のように番号が付き、`1/speaker_0` と `2/speaker_0` は別の人かもしれません。区切りが 1 つなら `speaker_0` のままです。話者が分かっている場合は背景メモを組み合わせられます。

```bash
vsub talk.mp4 -t ja --diarize --context "speaker_0 は店長のアレックス。speaker_1 は新人アルバイトのサムで、アレックスには敬語で話す。"
```

有効・無効を切り替えると文字起こしのキャッシュを作り直します。`chapters` と `summarize` にも同じフラグを付けると、メインと同じ文字起こしのキャッシュを使えます。その依頼文には話者を使いません。

### 9. AI によるチャプターと要約（`vsub chapters` と `vsub summarize`）

動画・音声・既存の `.srt` ファイルから、YouTube 用のチャプターや、構造化した Markdown の要約を作ります。チャプターと要約は 1 つの言語で作ります。翻訳先が複数あるとき（たとえば `vsub config set --target-lang ja,en`）は、先頭の言語だけを使います。すでに `vsub` で処理したメディアなら、文字起こしのキャッシュを使うので数秒で終わります。
```bash
# YouTube にそのまま使えるチャプターを作る (00:00 タイトルの形式。[名前].chapters.txt に保存)
vsub chapters video.mp4 -t ja
vsub chapters video.mp4 -t ja --glossary ./glossary.json
vsub chapters subtitle.srt -f json  # 構造化した JSON 配列で出力する

# 構造化した要約を作る (既定は Markdown。[名前].summary.md に保存)
vsub summarize video.mp4 -t ja
vsub summarize interview.srt -f txt # プレーンテキストで出力する
```

`--glossary`（省略時は `VSUB_GLOSSARY` または `vsub config set --glossary` で保存した用語集）を出力の言語で読み、章の題と要約の名前・用語の書き方にも使います。Groq では認識のヒントにもなるので、メインのコマンドと同じ `--glossary` を付ければ文字起こしのキャッシュを使い回せます。

### 10. 標準出力と UNIX パイプでの連携（`--stdout` / `-o -`）
字幕・テキスト・チャプター・要約を、ファイルに書かずに `stdout` へ直接出力します（進み具合の表示と、`--verbose` のログは `stderr` に出るので、パイプに流れるデータは汚れません）。
```bash
# JSON の字幕データを jq に直接渡す
vsub video.mp4 -t en -f json --stdout | jq '.[0]'

# 作った YouTube 用のチャプターを、クリップボードに直接コピーする
vsub chapters video.mp4 --stdout | pbcopy

# 会議の要約をファイルにリダイレクトする
vsub summarize meeting.mp4 --stdout > summary.md
```

### 11. キャッシュの管理と自己更新
```bash
# キャッシュの使用量を見る、またはキャッシュを消す
vsub cache stats
vsub cache clean

# 更新があるか確かめる、または単体の実行ファイルを GitHub Releases の最新版に更新する
vsub update --check
vsub update
```

### 12. 文字起こしの修正（`--refine`）
組み立てた文字起こしを、`--save-original` や翻訳の前に、文章の生成モデルで校正します（`vsub` 本体と `vsub batch` で使えます。既定は無効）。
```bash
# 用語集を使って認識した用語を直してから、日本語に翻訳する
vsub video.mp4 -t ja --glossary ./glossary.json --refine

# 修正だけを行い、直した原文の字幕を出力する (翻訳はしない)
vsub video.mp4 --no-translate --refine
```
* **直すもの**: 同音異義語や漢字の誤変換、聞き違えた固有名詞や専門用語、語の区切りの誤りなど、明らかな音声認識の誤りを直します。
* **提供元とモデル**: 設定している文章の生成の提供元とモデル（`--llm-provider`、`--llm-model`、`--gemini-model`）を使います。
* **いつも有効にする**: `vsub config set --refine true` または `VSUB_REFINE=true` で既定を有効にできます。1 回だけ切るには `--no-refine` を付けます。優先順位は `--refine`/`--no-refine` → `VSUB_REFINE` → 設定ファイルです。効くのはメインのコマンドと `vsub batch` だけです。
* **用語集と指示**: `--glossary` と組み合わせるのがいちばん効果的です（用語集がないと、改善はかなり小さくなります）。`--prompt` の指示と `--context` の背景メモも背景の情報として渡します。言語ごとに分けた用語集ファイルでは、最初の翻訳先の言語の表を使って、用語の正しい書き方を伝えます。
* **時刻と構成は変えない**: 字幕のタイムスタンプ、番号、行数は変わりません。50 行ずつのまとまりのどこかで、モデルの答えが元の行と対応しなかったときは、そのまとまりは元の文章のまま残し、警告を表示します。
* **できないこと**: **文字起こしで抜け落ちた発話は戻りません。字幕の時刻も直りません。**
* **後の出力への反映**: `--save-original`、`--bilingual`、`--no-translate` の原文と、翻訳に渡す原文には、すべて修正後の文章を使います。
* **費用とキャッシュ**: 文字起こし全体を、文章の生成モデルにもう 1 回通す分の費用がかかります（1 言語の翻訳より少し少ない程度）。初めて `--refine` を付けたときは原文が変わるので、既存の翻訳も直した原文から作り直します。修正前の文字起こしは別にキャッシュに残るので、あとで `--refine` を外しても文字起こしはやり直しません（翻訳は、修正前の原文からもう一度行います）。

---

## 全体の設定（`vsub config`）

```bash
# 今の設定を表示する (API キーは伏せて表示)
vsub config show

# 既定の値を保存する (表示言語、翻訳先、指示、用語集、並列数、分割の文字数、文字起こしの修正、焼き込みの見た目)
vsub config set --lang ja --prompt "丁寧な敬体で翻訳" --glossary "./glossary.json" --concurrency 4
vsub config set --target-lang ja,en
vsub config set --refine true
vsub config set --diarize true
vsub config set --max-length 32 --burn-position bottom --burn-font-size medium
vsub config set --stt-provider openrouter --openrouter-key "your_openrouter_key"
vsub config set --llm-provider openrouter
vsub config set --stt-provider openai-compatible --openai-compatible-stt-base-url http://localhost:8000/v1 --openai-compatible-stt-model whisper-1

# 新しいバージョンの自動確認を止める
vsub config set --disable-update-check true

# 設定ファイルの場所を表示する
vsub config path
```

---

## ライセンス

`vsub-cli` のソースコードは [MIT License](LICENSE) で公開しています。

### サードパーティのライセンス
単体の実行ファイルには、次のオープンソースのライブラリ（MIT、Apache-2.0、BSD-2-Clause、ISC）が含まれています。
* `@google/genai` (Apache-2.0)
* `commander` (MIT)
* `dotenv` (BSD-2-Clause)
* `execa` (MIT)
* `groq-sdk` (Apache-2.0)
* `ora` (MIT)
* `picocolors` (ISC)

サードパーティのライセンスと全文は、CLI からいつでも確認できます。
```bash
# 含まれているサードパーティのライセンスの一覧を表示する
vsub licenses

# ライセンスの全文を表示する
vsub licenses --full
```
GitHub Releases の各アーカイブにも、まとめた `THIRD_PARTY_LICENSES.txt` が入っています。
