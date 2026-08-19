# vsub-cli (Video Subtitle CLI)

[English](README.md) | [日本語](README.ja.md)

動画ファイルおよび音声ファイルから音声を最適化抽出し、**Groq API (`whisper-large-v3-turbo`)** で高速文字起こしを行った後、**Google Gemini API (`@google/genai`)** を用いて多言語字幕（`.srt`, `.vtt`, `.txt`, `.json`）を自動生成する CLI ツールです。

---

## 特徴

* ⚡ **超高速文字起こし**: Groq LPU 上で動作する `whisper-large-v3-turbo` を採用し、音声認識を高速処理。
* 🎵 **動画・音声両対応**: 動画ファイル（`.mp4`, `.mkv`, `.mov` 等）だけでなく、音声ファイル（`.mp3`, `.wav`, `.m4a`, `.aac`, `.flac`, `.ogg`, `.opus` 等）も直接入力可能。
* 🔊 **音質・ファイルサイズ自動最適化**: `ffmpeg` を用いて 16kHz モノラル / 低ビットレート（32〜48kbps）に圧縮・最適化し、Groq の 25MB 上限を自動クリア（超長尺メディアの自動分割にも対応）。
* 🎯 **タイムコード破綻防止翻訳**: SRT 構造を JSON 化し、字幕テキストのみをチャンク分割翻訳。タイムコードの行崩れやずれを 100% 防止。
* 🌍 **多言語対応**: デフォルトの日本語（`ja`）をはじめ、英語（`en`）、スペイン語（`es`）など任意の言語コードを指定可能。
* 🛠️ **柔軟な ffmpeg パス対応**: システム `PATH` に加え、環境変数 `FFMPEG_PATH` や `--ffmpeg-path` オプションで個別にファイルパスを指定可能。

---

## 前提条件・外部依存

1. **Node.js**: v24 / v26 以上
2. **ffmpeg**: ローカル環境にインストール済みであること（または実行ファイルパスを指定）
3. **API キー**:
   * [Groq Console](https://console.groq.com/) にて取得できる `GROQ_API_KEY`
   * [Google AI Studio](https://aistudio.google.com/) にて取得できる `GEMINI_API_KEY`
4. **pnpm**: パッケージマネージャー *(開発・ソースからのビルド時に必要)*

---

## セットアップ & API キーの設定

API キーの設定方法は **3つの方法** から選べます：

### 方法 1: 対話型セットアップ (推奨・一番簡単)
キーが未設定の状態でコマンドを実行すると、自動的にターミナル上で対話入力プロンプトが起動します。
入力されたキーは**ホームディレクトリのグローバル設定ファイル**（例: `~/.config/vsub/config.json` または `%APPDATA%\vsub\config.json`）に保存されるため、どのディレクトリから実行しても2回目以降は設定不要で利用できます。

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
  media-file                処理対象の動画または音声ファイルパス (.mp4, .mp3, .wav, .m4a, .mov 等)

Options:
  -t, --target-lang <lang>  翻訳先の言語コード (例: ja, en, es) (デフォルト: "ja")
  -f, --format <formats>    出力フォーマット: srt, vtt, txt, json をカンマ区切りで指定 (デフォルト: "srt")
  -o, --output <path>       出力する字幕ファイルの個別パス指定
  --ffmpeg-path <path>      ffmpeg 実行ファイルのパス (未指定時は VSUB_FFMPEG_PATH または PATH を探索)
  --no-cache                中間キャッシュを使用・保存せずに実行 (デフォルト: false)
  --fresh                   既存キャッシュを無視して新規実行し、結果をキャッシュへ上書き (デフォルト: false)
  --cache-dir <path>        カスタムキャッシュ保存ディレクトリの指定
  --keep-audio              中間生成した音声ファイルを削除せずに保持する (デフォルト: false)
  --no-translate            Gemini翻訳をスキップし、Groqの文字起こし結果（原語字幕）のみを出力する
  --save-original           翻訳後字幕に加え、翻訳前の原語文字起こし字幕ファイルも同時に保存する (デフォルト: false)
  --force-translate         検出言語と出力言語が同一の場合でも強制的にGemini翻訳を実行する (デフォルト: false)
  --verbose                 詳細なログ（APIリクエスト等）を出力する (デフォルト: false)
  -h, --help                ヘルプを表示

Commands:
  translate <subtitle-file> 既存の字幕ファイル (.srt) を Gemini API で直接別言語に翻訳
  cache path                キャッシュディレクトリのパスを表示
  cache stats               キャッシュファイル数と使用容量を表示
  cache clean               全中間キャッシュファイルを削除
  config path               設定ファイルの保存場所を表示
  config show               現在の設定内容を表示 (API Key はマスク表示)
  config set                グローバル設定に API Key や FFmpeg パスを保存
  config init               対話形式で API Key を初期設定
```

### 使用例

```bash
# 設定の確認・初期化
pnpm dev config show
pnpm dev config init

# 既存 SRT ファイルを直接英語に翻訳 (Groq API 不要・Gemini のみで動作)
pnpm dev translate sample.ja.srt -t en

# 既存 SRT ファイルを多言語・マルチフォーマットに一括変換 (.vtt, .txt, .json)
pnpm dev translate sample.srt -t en -f srt,vtt,txt,json

# 音声ファイル（.mp3, .wav, .m4a 等）を直接文字起こし・翻訳
pnpm dev podcast.mp3 -t ja

# 英語字幕 (.en.srt) を生成
pnpm dev sample.mp4 -t en

# 複数フォーマットを同時に一括出力 (.srt, .vtt, .txt, .json)
pnpm dev sample.mp4 -f srt,vtt,txt,json

# 翻訳を行わず文字起こし（原語字幕）のみ出力 (Gemini API Key 未設定でも利用可能)
pnpm dev sample.mp4 --no-translate

# 翻訳後字幕と同時に、翻訳前の原語字幕も保存
pnpm dev sample.mp4 -t ja --save-original

# 音声言語と出力言語が同じ場合でも、あえて Gemini 翻訳を実行
pnpm dev sample.mp4 -t ja --force-translate

# 出力先パスを指定
pnpm dev sample.mp4 -o ./subtitles/my_subtitle.srt

# ffmpeg のパスを直接指定して実行
pnpm dev sample.mp4 --ffmpeg-path "/usr/bin/ffmpeg"
```

---

## ライセンス

[The Unlicense](LICENSE)
