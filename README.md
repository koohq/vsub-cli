# vsub-cli (Video Subtitle CLI)

動画ファイルから音声を自動抽出し、**Groq API (`whisper-large-v3-turbo`)** で高速文字起こしを行った後、**Google Gemini API (`@google/genai`)** を用いて多言語字幕（`.srt`）を自動生成する CLI ツールです。

---

## 特徴

* ⚡ **超高速文字起こし**: Groq LPU 上で動作する `whisper-large-v3-turbo` を採用し、音声認識を高速処理。
* 🔊 **音質・ファイルサイズ自動最適化**: `ffmpeg` を用いて 16kHz モノラル / 低ビットレート（32〜48kbps）に圧縮抽出し、Groq の 25MB 上限を自動クリア（超長尺動画の自動分割にも対応）。
* 🎯 **タイムコード破綻防止翻訳**: SRT 構造を JSON 化し、字幕テキストのみをチャンク分割翻訳。タイムコードの行崩れやずれを 100% 防止。
* 🌍 **多言語対応**: デフォルトの日本語（`ja`）をはじめ、英語（`en`）、スペイン語（`es`）など任意の言語コードを指定可能。
* 🛠️ **柔軟な ffmpeg パス対応**: システム `PATH` に加え、環境変数 `FFMPEG_PATH` や `--ffmpeg-path` オプションで個別にファイルパスを指定可能。

---

## 前提条件・外部依存

1. **Node.js**: v24 / v26 以上
2. **pnpm**: パッケージマネージャー
3. **ffmpeg**: ローカル環境にインストール済みであること（または実行ファイルパスを指定）
4. **API キー**:
   * [Groq Console](https://console.groq.com/) にて取得できる `GROQ_API_KEY`
   * [Google AI Studio](https://aistudio.google.com/) にて取得できる `GEMINI_API_KEY`

---

## セットアップ手順

### 1. リポジトリのクローン & 依存関係のインストール

```bash
pnpm install
```

### 2. 環境変数の設定

リポジトリルートに `.env` ファイルを作成し、取得した API キーを設定します：

```env
GROQ_API_KEY=your_groq_api_key_here
GEMINI_API_KEY=your_gemini_api_key_here

# (任意) ffmpeg のパスを指定する場合
# FFMPEG_PATH=C:\tools\ffmpeg\bin\ffmpeg.exe
```

---

## 使い方

### 基本実行

```bash
# デフォルトで日本語字幕 ([動画名].ja.srt) を生成
pnpm dev path/to/video.mp4

# またはビルド後に実行
pnpm build
node ./dist/index.js path/to/video.mp4
```

### コマンドオプション

```text
Usage: vsub [options] <video-file>

Arguments:
  video-file                処理対象の動画ファイルパス (.mp4, .mkv, .mov 等)

Options:
  -t, --target-lang <lang>  翻訳先の言語コード (例: ja, en, es) (デフォルト: "ja")
  -o, --output <path>       出力する字幕ファイルの個別パス指定
  --ffmpeg-path <path>      ffmpeg 実行ファイルのパス (未指定時は FFMPEG_PATH または PATH を検索)
  --keep-audio              中間生成した音声ファイルを削除せずに保持する (デフォルト: false)
  --verbose                 詳細なログ（APIリクエスト等）を出力する (デフォルト: false)
  -h, --help                ヘルプを表示
```

### 使用例

```bash
# 英語字幕 (.en.srt) を生成
pnpm dev sample.mp4 -t en

# 出力先パスを指定
pnpm dev sample.mp4 -o ./subtitles/my_subtitle.srt

# ffmpeg のパスを直接指定して実行
pnpm dev sample.mp4 --ffmpeg-path "C:\tools\ffmpeg\bin\ffmpeg.exe"
```

---

## ライセンス

[The Unlicense](LICENSE)