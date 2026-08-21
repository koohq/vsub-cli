# vsub-cli (Video & Audio Subtitle CLI)

[English](README.md) | [日本語](README.ja.md)

動画ファイルおよび音声ファイルから音声を最適化抽出し、**Groq API (`whisper-large-v3-turbo`)** で高速文字起こしを行った後、**Google Gemini API (`@google/genai`)** を用いて多言語字幕・テキスト（`.srt`, `.vtt`, `.txt`, `.json`）を自動生成する CLI ツールです。

---

## 主な特徴

* ⚡ **超高速文字起こし**: Groq LPU 上で動作する `whisper-large-v3-turbo` を採用し、音声認識を高速処理。
* 🎵 **動画・音声両対応**: 動画ファイル（`.mp4`, `.mkv`, `.mov` 等）だけでなく、音声ファイル（`.mp3`, `.wav`, `.m4a`, `.aac`, `.flac`, `.ogg`, `.opus` 等）も直接入力可能。
* 🔊 **音質・ファイルサイズ自動最適化**: `ffmpeg` を用いて 16kHz モノラル / 低ビットレート（32〜48kbps）に圧縮・最適化し、Groq の 25MB 上限を自動クリア。超長尺メディアの自動分割時も、実測再生時間に基づくミリ秒精度のタイムコード補正で字幕ズレを防止。
* 🎯 **タイムコード破綻防止翻訳**: SRT 構造を JSON 化し、字幕テキストのみを Gemini（`gemini-3.7-flash`）でチャンク分割翻訳。タイムコードの行崩れやズレを 100% 防止。
* 🚀 **Gemini API 並列リクエスト制御**: 非同期ワーカプール（`--concurrency`、デフォルト 3 並列）による高速並行翻訳と、429 レートリミット時の自動指数バックオフ再試行を搭載。
* 💾 **中間キャッシュ & 再開機構**: ファイルサイズと更新日時の SHA-256 ハッシュに基づき文字起こし・翻訳結果を自動保存。再実行時や別言語追加時の API コストと待ち時間をゼロ化（`vsub cache`）。
* 📖 **用語集 (Glossary) & プロンプト制御**: 専門用語の誤訳を防ぐ `--glossary`（JSON またはインライン対訳）、翻訳口調を指定する `--prompt`、Whisper の認識精度を高める `--whisper-prompt` をサポート。
* 🌍 **複数言語一括同時翻訳**: `-t ja,en,zh` のように指定することで、1 回の文字起こしから各言語の字幕ファイルを一括生成。
* 📄 **マルチフォーマット一括出力**: `.srt` (SubRip), `.vtt` (WebVTT), `.txt` (全文テキスト), `.json` (構造化データ) の同時出力に対応。
* 📁 **ディレクトリ / バッチ一括処理モード**: フォルダ配下の全動画・音声、複数ファイル、glob パターンを一括で自動文字起こし・翻訳。逐次キュー処理、エラー耐性、総合サマリーレポートを完備（`vsub batch`）。
* 🎬 **動画への字幕焼き込み (Hardsub / Burn-in)**: FFmpeg の `subtitles` フィルタを用いて、SNS 投稿やプレビュー用に字幕が動画自体に合成された mp4 をワンストップ出力（`--burn` フラグまたは `vsub burn` サブコマンド）。
* 🛡️ **ファイル上書き防止 & バックアップセーフティ**: 処理開始前の事前衝突検知、対話環境での上書き確認（`y/N`）、強制上書きフラグ（`-w, --overwrite`）、自動連番退避（`--backup` による `.bak` / `.bak.N` 保存）で意図しないデータ消失を完全防止。
* 🔄 **既存字幕の直接翻訳サブコマンド**: 動画ファイルや Groq API を介さず、既存の `.srt` ファイルから直接翻訳・フォーマット変換を実行（`vsub translate`）。
* 🛠️ **対話型初期セットアップ & グローバル設定**: 初回実行時の自動対話プロンプトおよび設定ファイル永続管理（`vsub config`）。

---

## 前提条件・外部依存

1. **Node.js**: v26+ (または v24+)
2. **ffmpeg / ffprobe**: ローカル環境にインストール済みであること（または実行ファイルパスを指定）
3. **API キー**:
   * [Groq Console](https://console.groq.com/) にて取得できる `VSUB_GROQ_API_KEY`
   * [Google AI Studio](https://aistudio.google.com/) にて取得できる `VSUB_GEMINI_API_KEY`
4. **pnpm**: パッケージマネージャー *(開発・ソースからのビルド時に必要)*

---

## セットアップ & API キーの設定

API キーの設定方法は **3つの方法** から選べます：

### 方法 1: 対話型セットアップ (推奨・一番簡単)
キーが未設定の状態でコマンドを実行すると、自動的にターミナル上で対話入力プロンプトが起動します。
入力されたキーは**グローバル設定ファイル**（例: `~/.config/vsub/config.json` または `%APPDATA%\vsub\config.json`）に保存されるため、どのディレクトリから実行しても2回目以降は設定不要で利用できます。

直接キーを登録・更新したい場合は以下を実行してください：
```bash
# 対話型で登録・更新
pnpm dev config init

# またはコマンドラインから直接設定
pnpm dev config set --groq-key "your_groq_key" --gemini-key "your_gemini_key"
```

### 方法 2: 環境変数 (`VSUB_` プレフィックス)
システム環境変数またはシェルで設定します（競合防止のため `VSUB_` プレフィックスが付いています）：
```bash
export VSUB_GROQ_API_KEY="your_groq_api_key_here"
export VSUB_GEMINI_API_KEY="your_gemini_api_key_here"
```
*(従来名 `GROQ_API_KEY` / `GEMINI_API_KEY` もフォールバックとして対応しています)*

### 方法 3: `.env` ファイル
リポジトリ直下（または実行時のカレントディレクトリ）に `.env` ファイルを配置して設定します：
```env
VSUB_GROQ_API_KEY=your_groq_api_key_here
VSUB_GEMINI_API_KEY=your_gemini_api_key_here
```

---

## 使い方

### 基本実行

```bash
# デフォルトで日本語字幕 ([メディア名].ja.srt) を生成（動画・音声両対応）
pnpm dev path/to/video.mp4
pnpm dev path/to/podcast.mp3

# またはビルド後に実行
pnpm build
node ./dist/index.js path/to/video.mp4
```

### コマンドヘルプ

```text
Usage: vsub [options] [command] <media-file>

Arguments:
  media-file                    処理対象の動画または音声ファイルパス (.mp4, .mp3, .wav, .m4a, .mov 等)

Options:
  -t, --target-lang <langs>     翻訳先の言語コード (カンマ区切りで複数指定可: ja,en,zh) (デフォルト: "ja")
  -f, --format <formats>        出力フォーマット: srt, vtt, txt, json をカンマ区切りで指定 (デフォルト: "srt")
  -o, --output <path>           出力する字幕ファイルの個別パス指定
  -w, --overwrite               確認プロンプトを表示せず既存ファイルを直接上書き (デフォルト: false)
  --backup                      既存ファイルが存在する場合に .bak として退避保存 (デフォルト: false)
  -b, --bilingual               原語と翻訳文を上下2行で併記したバイリンガル字幕を生成 (デフォルト: false)
  --bilingual-order <order>     バイリンガル字幕の並び順: original-first (デフォルト) または target-first (デフォルト: "original-first")
  --ffmpeg-path <path>          ffmpeg 実行ファイルのパス (未指定時は VSUB_FFMPEG_PATH または PATH を探索)
  --whisper-prompt <text>       Groq Whisper 音声認識のヒントプロンプト (専門用語・固有名詞等)
  --prompt <instruction>        Gemini 翻訳時のカスタム指示プロンプト (口調・文字数制限等)
  --glossary <path-or-terms>    用語集 JSON ファイルパスまたはインライン対訳 (Key=Val,Key=Val)
  --concurrency <number>        Gemini API への同時並行リクエスト数 (デフォルト: 3)
  --gemini-model <model>        Gemini 翻訳モデルの指定 (デフォルト: gemini-3.7-flash)
  --groq-model <model>          Groq Whisper 文字起こしモデルの指定 (デフォルト: whisper-large-v3-turbo)
  --no-cache                    中間キャッシュを使用・保存せずに実行 (デフォルト: false)
  --fresh                       既存キャッシュを無視して新規実行し、結果をキャッシュへ上書き (デフォルト: false)
  --cache-dir <path>            カスタムキャッシュ保存ディレクトリの指定
  --burn                        生成された字幕を動画自体に焼き込んで出力 (hardsub) (デフォルト: false)
  --keep-audio                  中間生成した音声ファイルを削除せずに保持する (デフォルト: false)
  --no-translate                Gemini翻訳をスキップし、Groqの文字起こし結果（原語字幕）のみを出力する
  --save-original               翻訳後字幕に加え、翻訳前の原語文字起こし字幕ファイルも同時に保存する (デフォルト: false)
  --force-translate             検出言語と出力言語が同一の場合でも強制的にGemini翻訳を実行する (デフォルト: false)
  --verbose                     詳細なログ（APIリクエスト等）を出力する (デフォルト: false)
  -h, --help                    ヘルプを表示

Commands:
  burn <video-file> <sub-file>  既存の字幕ファイル (.srt) を FFmpeg で動画に直接焼き込み (hardsub)
  translate <subtitle-file>     既存の字幕ファイル (.srt) を Gemini API で直接別言語に翻訳
  cache path                    キャッシュディレクトリのパスを表示
  cache stats                   キャッシュファイル数と使用容量を表示
  cache clean                   全中間キャッシュファイルを削除
  config path                   設定ファイルの保存場所を表示
  config show                   現在の設定内容を表示 (API Key はマスク表示)
  config set                    グローバル設定に API Key や FFmpeg パス、デフォルトプロンプト、並行数を保存
  config init                   対話形式で API Key を初期設定
```

---

## 応用機能・ユースケース別コマンド例

### 1. 二言語併記 / バイリンガル字幕モード (`--bilingual` / `-b`)
語学学習や国際会議向けに、原語（英語等）と訳語（日本語等）を 1 つの字幕ブロック内にまとめて出力します：
```bash
# バイリンガル字幕 (.ja.bilingual.srt) と二言語焼き込み動画をワンストップ生成
pnpm dev video.mp4 -t ja --bilingual --burn

# 訳語を上段、原語を下段に並び替え
pnpm dev video.mp4 -t ja -b --bilingual-order target-first
```

### 2. 複数言語・マルチフォーマットの一括出力
文字起こしは 1 回のみ実行し、多言語字幕とテキスト議事録を一括生成します：
```bash
# 日本語・英語・中国語の字幕 (.srt, .vtt) とテキスト (.txt, .json) を一括出力
pnpm dev video.mp4 -t ja,en,zh -f srt,vtt,txt,json
```

### 3. ディレクトリ / バッチ一括処理モード (`vsub batch`)
フォルダ内の全動画や glob パターンに一致する複数メディアを一括で処理します：
```bash
# フォルダ内の全動画・音声ファイルを再帰的に一括文字起こし・翻訳
pnpm dev batch ./videos/ -t ja

# 複数ファイルやワイルドカード（glob）での一括処理
pnpm dev batch ./episodes/*.mp4 -t ja,en -f srt,vtt

# 出力先フォルダを指定して一括出力
pnpm dev batch ./podcasts/ -t ja -o ./subtitles/

# サブディレクトリ探索なし、またはエラー発生時に即時中断
pnpm dev batch ./videos/ --no-recursive --fail-fast
```

### 4. 既存字幕ファイルの直接翻訳 (`vsub translate`)
動画ファイルや Groq API なしで、既存の `.srt` ファイルから直接翻訳・フォーマット変換：
```bash
pnpm dev translate sample.ja.srt -t en -f srt,vtt
```

### 4. 動画への字幕焼き込み (`--burn` & `vsub burn`)
FFmpeg を利用して、字幕が合成された mp4 動画をワンストップで出力します：
```bash
# 文字起こし・翻訳と同時に字幕焼き込み動画を出力
pnpm dev video.mp4 -t ja --burn

# または既存の字幕ファイルを元動画に直接焼き込み
pnpm dev burn video.mp4 video.ja.srt -o video.subbed.mp4
```

### 5. 用語集 (Glossary) & カスタムプロンプトの活用

#### インライン用語集の指定
```bash
pnpm dev video.mp4 -t ja --glossary "Antigravity=アンチグラビティ,vsub=ブイサブ"
```

#### JSON 用語集ファイルの指定 (多言語・フラット両対応)
```bash
pnpm dev video.mp4 -t ja,zh --glossary ./glossary.json
```

**`glossary.json` のフォーマット例:**
```json
{
  "ja": {
    "Antigravity": "アンチグラビティ",
    "Agentic AI": "エージェンティックAI"
  },
  "zh": {
    "Antigravity": "反重力",
    "Agentic AI": "智能体AI"
  }
}
```

> [!TIP]
> `--whisper-prompt` を明示しない場合でも、`--glossary` で指定された元単語（`Antigravity, Agentic AI`）が自動的に Whisper の認識ヒントとして渡され、音声認識の聞き取り精度も同時に向上します。

#### 翻訳口調・スタイルのプロンプト指定
```bash
pnpm dev video.mp4 -t ja --prompt "ITエンジニア向けの丁寧なです・ます調で翻訳してください。各行は30文字以内で簡潔にまとめてください。"
```

### 5. キャッシュ管理 & パフォーマンス最適化
```bash
# キャッシュ使用状況の確認
pnpm dev cache stats

# キャッシュを無視して最新のモデル・設定で再翻訳
pnpm dev video.mp4 -t ja --fresh

# キャッシュの全消去
pnpm dev cache clean

# 高速ネットワーク環境や上位APIプランでの並行リクエスト数引き上げ
pnpm dev video.mp4 -t ja --concurrency 5
```

---

## 設定管理コマンド (`vsub config`)

```bash
# 現在の設定内容（API Key はマスク表示）を確認
pnpm dev config show

# デフォルトの翻訳プロンプト・用語集・並行数をグローバルに保存
pnpm dev config set --prompt "丁寧な敬体で翻訳" --glossary "./glossary.json" --concurrency 4

# 設定ファイルの物理パスを表示
pnpm dev config path
```

---

## ライセンス

[The Unlicense](LICENSE)
