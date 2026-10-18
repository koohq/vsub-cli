# vsub-cli (Video & Audio Subtitle CLI)

[English](README.md) | [日本語](README.ja.md)

動画ファイルおよび音声ファイルから音声を最適化抽出し、**Groq API (`whisper-large-v3-turbo`)** で高速文字起こしを行った後、**Google Gemini API (`@google/genai`)** を用いて多言語字幕・テキスト・チャプター・要約を自動生成する CLI ツールです。

---

## 主な特徴

* ⚡ **超高速文字起こし**: Groq LPU 上で動作する `whisper-large-v3-turbo` を採用し、音声認識を高速処理。
* 🎵 **動画・音声ファイル両対応**: 動画ファイル（`.mp4`, `.mkv`, `.mov` 等）だけでなく、音声ファイル（`.mp3`, `.wav`, `.m4a`, `.aac`, `.flac`, `.ogg`, `.opus` 等）も直接入力可能。
* 🔊 **音質・ファイルサイズ自動最適化**: `ffmpeg` を用いて 16kHz モノラル / 低ビットレート（32〜48kbps）に圧縮・最適化し、Groq の 25MB 上限を自動クリア。超長尺メディアの自動分割時も、実測再生時間に基づくミリ秒精度のタイムコード補正で字幕ズレを防止。
* 🎯 **タイムコード破綻防止 & 文脈引き継ぎ翻訳**: 字幕テキストのみを Gemini（`gemini-3.8-flash`）の Structured Outputs（`responseSchema`）とスライディングウィンドウ参照（`--context-window`）でチャンク翻訳。タイムコード崩れや行数不一致を 100% 防ぎつつ、チャンク境界でも自然な口調・文脈を維持。
* ✂️ **長文セグメントのスマート自動分割 (Subtitle Reflow)**: 早口トーク等で長大化したセグメントを、句読点や節の自然な切れ目で読みやすい長さに自動分割し、表示時間をミリ秒単位で比例配分（`--max-length`, `--max-duration`, `--no-reflow`）。
* 🚀 **Gemini API 並列リクエスト制御**: 非同期ワーカプール（`--concurrency`、デフォルト 3 並列）による高速並行翻訳と、429 レートリミット時のジッター付き指数バックオフ再試行を搭載。
* 💾 **スマート中間キャッシュ & 再開機構**: ファイルサイズと更新日時の SHA-256 ハッシュに基づき、文字起こし・翻訳・チャプター・要約結果を自動キャッシュ。再実行時や別言語追加時の API コストと待ち時間をゼロ化（`vsub cache`）。
* 📖 **用語集 (Glossary) & プロンプト制御**: 専門用語の誤訳を防ぐ `--glossary`（JSON またはインライン対訳）、翻訳スタイルを指定する `--prompt`、Whisper の認識精度を高める `--whisper-prompt` をサポート。
* 🌍 **複数言語一括翻訳 & バイリンガル併記**: `-t ja,en,zh` による 1 回の文字起こしからの多言語一括出力や、原語と訳語を上下 2 段に併記するバイリンガル字幕生成（`-b, --bilingual`）に対応。
* 📄 **マルチフォーマット出力 & 標準出力ストリーミング**: `.srt` (SubRip), `.vtt` (WebVTT), `.txt` (プレーンテキスト), `.json` (構造化データ) への保存に加え、一時ファイルなしで `stdout` へ直接出力する `--stdout`（または `-o -`）により `jq` や `pbcopy`、AI エージェントとのパイプ連携を実現。
* 📑 **AI チャプター生成 & 要約サブコマンド**: 動画・音声・既存 `.srt` から YouTube 概要欄用チャプター（`vsub chapters`）や構造化 Markdown 要約（`vsub summarize`）を生成。文字起こしキャッシュを再利用して数秒で出力。
* 🎬 **動画への字幕焼き込み (Hardsub) & ソフトサブ高速埋め込み (Softsub)**: 配置位置や文字サイズを調整できる字幕焼き込み（`--burn`, `--burn-position`, `--burn-font-size`）と、無劣化・数秒で複数言語の ON/OFF 可能な字幕トラックを格納するソフトサブ埋め込み（`--embed`, `vsub embed`）の両方に対応。
* 📁 **ディレクトリ / バッチ一括処理モード**: フォルダ配下の全動画・音声、複数ファイル、glob パターンを一括で自動処理。逐次キュー実行、エラー耐性、総合サマリーレポートを完備（`vsub batch`）。
* 🛡️ **ファイル上書き防止 & バックアップセーフティ**: 処理開始前の事前衝突検知、対話環境での上書き確認（`y/N`）、強制上書きフラグ（`-w, --overwrite`）、自動連番退避（`--backup` による `.bak` / `.bak.N` 保存）で意図しないデータ消失を防止。
* 🔄 **既存字幕の直接翻訳サブコマンド**: 動画ファイルや Groq API を介さず、既存の `.srt` ファイルから直接別言語・別フォーマットへ翻訳（`vsub translate`）。
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
   * [Groq Console](https://console.groq.com/) にて取得した `VSUB_GROQ_API_KEY`
   * [Google AI Studio](https://aistudio.google.com/) にて取得した `VSUB_GEMINI_API_KEY`
3. **Node.js**: v26+ または v24+ *(npm パッケージ利用時またはソースからビルドする場合のみ必要)*

---

## セットアップ & API キーの設定

API キーは **3 つの方法** から設定できます：

### 方法 1: 対話型セットアップウィザード（推奨・一番簡単）
`vsub init` コマンドを実行すると対話型ウィザードが起動し、Groq API・Gemini API・FFmpeg の疎通確認を行った上でグローバル設定に保存します：
```bash
# 対話型セットアップウィザードを起動
vsub init

# またはコマンドライン引数から直接保存
vsub config set --groq-key "your_groq_key" --gemini-key "your_gemini_key"
```

### 方法 2: 環境変数 (`VSUB_` プレフィックス)
システム環境変数またはシェルの設定ファイルで指定します（他ツールとの競合を防ぐため `VSUB_` プレフィックスを推奨します）：
```bash
export VSUB_GROQ_API_KEY="your_groq_api_key_here"
export VSUB_GEMINI_API_KEY="your_gemini_api_key_here"
```
*(プレフィックスなしの `GROQ_API_KEY` / `GEMINI_API_KEY` もフォールバックとしてサポートしています)*

### 方法 3: `.env` ファイル
実行時のカレントディレクトリに `.env` ファイルを配置して設定します：
```env
VSUB_GROQ_API_KEY=your_groq_api_key_here
VSUB_GEMINI_API_KEY=your_gemini_api_key_here
```

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
Usage: vsub [options] [command] <media-file>

Arguments:
  media-file                    処理対象の動画または音声ファイルパス (.mp4, .mp3, .wav, .m4a, .mov 等)

Options:
  -l, --lang <lang>             CLI表示言語: en (英語・既定), ja (日本語)
  -t, --target-lang <langs>     翻訳先の言語コード (カンマ区切りで複数指定可: ja,en,zh) (デフォルト: "ja")
  -f, --format <formats>        出力フォーマット: srt, vtt, txt, json をカンマ区切りで指定 (デフォルト: "srt")
  -o, --output <path>           出力する字幕ファイルの個別パス指定 ('-' 指定で標準出力)
  --stdout                      ファイル保存を行わず、結果を直接標準出力 (stdout) へ出力 (デフォルト: false)
  -w, --overwrite               確認プロンプトを表示せず既存ファイルを直接上書き (デフォルト: false)
  --backup                      既存ファイルが存在する場合に .bak として退避保存 (デフォルト: false)
  -b, --bilingual               原語と翻訳文を上下2段で併記したバイリンガル字幕を生成 (デフォルト: false)
  --bilingual-order <order>     バイリンガル字幕の並び順: original-first (既定) または target-first
  --ffmpeg-path <path>          ffmpeg 実行ファイルのパス (未指定時は VSUB_FFMPEG_PATH または PATH を探索)
  --whisper-prompt <text>       Groq Whisper 音声認識のヒントプロンプト (専門用語・固有名詞等)
  --prompt <instruction>        Gemini 翻訳時のカスタム指示プロンプト (口調・スタイル・簡潔さ等)
  --glossary <path-or-terms>    用語集 JSON ファイルパスまたはインライン対訳 (Key=Val,Key=Val)
  --concurrency <number>        Gemini API への同時並行リクエスト数 (デフォルト: 3)
  --gemini-model <model>        Gemini 翻訳モデルの指定 (デフォルト: gemini-3.8-flash)
  --groq-model <model>          Groq Whisper 文字起こしモデルの指定 (デフォルト: whisper-large-v3-turbo)
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
  --no-translate                Gemini 翻訳をスキップし、Groq の文字起こし結果（原語字幕）のみを出力 (デフォルト: false)
  --save-original               翻訳後字幕に加え、翻訳前の原語文字起こし字幕ファイルも並行保存 (デフォルト: false)
  --force-translate             検出言語と出力言語が同一の場合でも強制的に Gemini 翻訳を実行 (デフォルト: false)
  --no-update-check             新バージョンの自動更新チェックを無効化 (デフォルト: false)
  --verbose                     詳細なログ（APIリクエスト等）を出力 (デフォルト: false)
  -h, --help                    ヘルプを表示

Commands:
  batch <targets...>            複数メディアファイルの一括処理 (フォルダ、複数ファイル、glob パターン)
  translate <subtitle-file>     既存の字幕ファイル (.srt) を Gemini API で直接別言語に翻訳
  burn <video-file> <sub-file>  既存の字幕ファイル (.srt) を FFmpeg で動画に直接焼き込み (hardsub)
  embed <video> <sub-files...>  既存の動画と字幕 (.srt) を FFmpeg ストリームコピーで字幕トラックとして高速埋め込み (softsub)
  chapters <file>               動画・音声・字幕 (.srt) から Gemini でチャプター（目次）を生成
  summarize <file>              動画・音声・字幕 (.srt) から Gemini で構造化要約・ハイライトを生成
  init                          API キー・FFmpeg・基本設定を導通確認付きで初期設定する対話ウィザード
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
動画ファイルや Groq API を介さず、既存の `.srt` ファイルから直接翻訳・フォーマット変換を行います：
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

---

## グローバル設定コマンド (`vsub config`)

```bash
# 現在の設定内容（API Key はマスク表示）を確認
vsub config show

# デフォルトのCLI表示言語・翻訳プロンプト・用語集・並行数・分割文字数・焼き込みスタイルを永続保存
vsub config set --lang ja --prompt "丁寧な敬体で翻訳" --glossary "./glossary.json" --concurrency 4
vsub config set --max-length 32 --burn-position bottom --burn-font-size medium

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
