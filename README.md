# vsub-cli (Video & Audio Subtitle CLI)

[English](README.md) | [日本語](README.ja.md)

A fast, resilient CLI tool that extracts and optimizes audio from video or audio files, performs ultra-fast speech recognition with the **Groq API (`whisper-large-v3-turbo`)**, and generates multilingual subtitles & transcripts (`.srt`, `.vtt`, `.txt`, `.json`) using the **Google Gemini API (`@google/genai`)**.

---

## Key Features

* ⚡ **Ultra-Fast Transcription**: Powered by `whisper-large-v3-turbo` running on Groq LPUs for near-instant speech recognition.
* 🎵 **Video & Audio File Support**: Directly accepts video files (`.mp4`, `.mkv`, `.mov`, etc.) and audio files (`.mp3`, `.wav`, `.m4a`, `.aac`, `.flac`, `.ogg`, `.opus`, etc.).
* 🔊 **Automated Audio Optimization**: Compresses media to 16kHz mono (32–48kbps) via `ffmpeg` to stay under Groq's 25MB limit. Automatically splits ultra-long media and calculates timecodes with millisecond precision based on measured segment durations.
* 🎯 **100% Timecode-Preserving Translation**: Converts subtitle structures to JSON and translates only text chunks via Google Gemini (`gemini-3.7-flash`), eliminating timecode corruption or line-drift.
* 🚀 **Concurrent Translation Control**: Translates subtitle chunks concurrently using an asynchronous worker pool (`--concurrency`, default: 3) with jittered exponential backoff for 429/rate-limit recovery.
* 💾 **Smart Intermediate Caching**: Automatically caches transcription and language-specific translations by media content hash (size + mtime). Resume immediately without repeating API calls (`vsub cache`).
* 📖 **Glossary & Custom Prompting**: Pass custom translation instructions (`--prompt`), domain glossaries (`--glossary` via JSON or inline `Key=Val`), and Whisper recognition hints (`--whisper-prompt`).
* 🌍 **Simultaneous Multi-Language Output**: Generate subtitles for multiple target languages in one pass (e.g., `-t ja,en,zh`) with only a single transcription step.
* 📄 **Multi-Format Export**: Supports `.srt` (SubRip), `.vtt` (WebVTT), `.txt` (plain text transcripts), and `.json` (structured data).
* 📁 **Directory & Batch Bulk Processing**: Process entire directories, glob patterns, or multiple video/audio files with automated sequential queueing, error resilience, and consolidated summary reports (`vsub batch`).
* 🎬 **Video Subtitle Hardsub / Burn-in**: Directly bake subtitles into video files via FFmpeg for SNS posting or preview (`--burn` flag or `vsub burn` subcommand).
* 🛡️ **File Overwrite Protection & Safety Backups**: Prevents accidental file deletion with pre-execution safety checks, interactive prompts (`y/N`), `-w, --overwrite` force option, and `--backup` (`.bak` / `.bak.N`) archiving.
* 🔄 **Direct Subtitle Translation**: Translate existing `.srt` subtitle files directly into other languages and formats without needing media files or Groq API (`vsub translate`).
* 🛠️ **Interactive Setup & Persistent Config**: Interactive key prompts and global configuration management (`vsub config`).

---

## Installation

`vsub-cli` is available as **standalone single executables (no Node.js required)** and as an npm package.

### Method 1: Standalone Single Executables (Recommended, No Node.js Required)
Download the prebuilt binary for your operating system and CPU architecture from [GitHub Releases](https://github.com/koohq/vsub-cli/releases):

* **Windows x64**: `vsub-windows-x64.exe`
* **Windows ARM64**: `vsub-windows-arm64.exe`
* **Linux x64**: `vsub-linux-x64`
* **Linux ARM64**: `vsub-linux-arm64`
* **macOS ARM64 (Apple Silicon)**: `vsub-macos-arm64`

> [!NOTE]
> * For Intel Mac (x64) users, please use **Method 2 (npm / pnpm)** due to an upstream Node.js SEA limitation.
> * `ffmpeg` / `ffprobe` is required on the system for audio extraction and subtitle burn-in.

```bash
# Make binary executable (Linux/macOS)
chmod +x vsub-macos-arm64

# Run interactive setup wizard
./vsub-macos-arm64 init
```

### Method 2: Global Install via npm / pnpm (For Node.js environments)
```bash
# Install via npm
npm install -g vsub-cli

# Or via pnpm
pnpm add -g vsub-cli
```

---

## Prerequisites & Dependencies

1. **ffmpeg / ffprobe**: Must be installed on your system (or specify executable path)
2. **API Keys**:
   * `VSUB_GROQ_API_KEY` obtained from [Groq Console](https://console.groq.com/)
   * `VSUB_GEMINI_API_KEY` obtained from [Google AI Studio](https://aistudio.google.com/)
3. **Node.js**: v26+ or v24+ *(Required only when using npm package or building from source)*

---

## Setup & API Key Configuration

You can configure API keys using **3 different methods**:

### Method 1: Interactive Setup Wizard (Recommended & Easiest)
Run `vsub init` to launch the interactive setup wizard, which verifies Groq API, Gemini API, and FFmpeg connectivity before saving:
```bash
# Run setup wizard
vsub init

# Or set directly via CLI arguments
vsub config set --groq-key "your_groq_key" --gemini-key "your_gemini_key"
```

### Method 2: Environment Variables (`VSUB_` Prefix)
Set keys in your shell or system environment variables (`VSUB_` prefix prevents variable collisions):
```bash
export VSUB_GROQ_API_KEY="your_groq_api_key_here"
export VSUB_GEMINI_API_KEY="your_gemini_api_key_here"
```
*(Standard `GROQ_API_KEY` and `GEMINI_API_KEY` are also supported as fallbacks)*

### Method 3: `.env` File
Create a `.env` file in the project root or current working directory:
```env
VSUB_GROQ_API_KEY=your_groq_api_key_here
VSUB_GEMINI_API_KEY=your_gemini_api_key_here
```

---

## Usage

### Basic Commands

```bash
# Generate Japanese subtitles ([media_name].ja.srt) from video or audio
pnpm dev path/to/video.mp4
pnpm dev path/to/podcast.mp3

# Or execute after building
pnpm build
node ./dist/index.js path/to/video.mp4
```

### Command Line Help

```text
Usage: vsub [options] [command] <media-file>

Arguments:
  media-file                    Target video or audio file path (.mp4, .mp3, .wav, .m4a, .mov, etc.)

Options:
  -t, --target-lang <langs>     Target language code(s), comma-separated (e.g., ja,en,es) (default: "ja")
  -f, --format <formats>        Output formats: comma-separated list of srt, vtt, txt, json (default: "srt")
  -o, --output <path>           Output path for the generated subtitle file
  -w, --overwrite               Overwrite existing output files without confirmation prompt (default: false)
  --backup                      Create backup (.bak) of existing output files before overwriting (default: false)
  -b, --bilingual               Generate bilingual subtitles combining original and translated text (default: false)
  --bilingual-order <order>     Order of bilingual subtitles: original-first (default) or target-first (default: "original-first")
  --ffmpeg-path <path>          Path to ffmpeg executable (searches VSUB_FFMPEG_PATH or PATH if omitted)
  --whisper-prompt <text>       Prompt hint for Groq Whisper speech recognition (terminology, names, etc.)
  --prompt <instruction>        Additional instruction prompt for Gemini translation (tone, style, brevity)
  --glossary <path-or-terms>    Glossary file path (JSON) or inline terms (Key=Val,Key=Val)
  --concurrency <number>        Number of concurrent translation requests to Gemini API (default: 3)
  --gemini-model <model>        Gemini translation model (default: gemini-3.7-flash)
  --groq-model <model>          Groq Whisper transcription model (default: whisper-large-v3-turbo)
  --no-cache                    Do not use or save intermediate cache (default: false)
  --fresh                       Ignore existing cache and generate fresh output, overwriting cache (default: false)
  --cache-dir <path>            Custom cache directory path
  --burn                        Burn generated subtitles directly into output video (hardsub) (default: false)
  --keep-audio                  Keep intermediate extracted audio files without deleting (default: false)
  --no-translate                Skip translation and output raw transcribed subtitles
  --save-original               Save original transcription subtitle file alongside the result (default: false)
  --force-translate             Force Gemini translation even if detected language matches target language (default: false)
  --verbose                     Output detailed log messages (API requests, etc.) (default: false)
  -h, --help                    Display help for command

Commands:
  burn <video-file> <sub-file>  Burn an existing subtitle file (.srt) directly into a video file via FFmpeg
  translate <subtitle-file>     Directly translate an existing subtitle file (.srt) into target language(s) via Gemini API
  cache path                    Display cache directory path
  cache stats                   Display cache usage and entry counts
  cache clean                   Delete all intermediate cache files
  config path                   Display global configuration file path
  config show                   Display current settings (API Keys are masked)
  config set                    Save API Keys, FFmpeg path, prompts, concurrency to global config
  config init                   Initialize API Keys interactively
```

---

## Advanced Features & Examples

### 1. Bilingual Subtitles (`--bilingual` / `-b`)
Create dual-language subtitles pairing original transcription and translation:
```bash
# Generate bilingual subtitle (.ja.bilingual.srt) and hardsubbed video
pnpm dev video.mp4 -t ja --bilingual --burn

# Change line order to target translation first
pnpm dev video.mp4 -t ja -b --bilingual-order target-first
```

### 2. Multi-Language & Multi-Format Output
Extract audio once, transcribe once, and generate all subtitles and transcripts simultaneously:
```bash
# Output Japanese, English, and Chinese subtitles in SRT and WebVTT formats
pnpm dev video.mp4 -t ja,en,zh -f srt,vtt,txt,json
```

### 3. Directory & Batch Bulk Processing (`vsub batch`)
Process multiple media files in a directory or via glob patterns in one go:
```bash
# Process all media files in a directory recursively
pnpm dev batch ./videos/ -t ja

# Process multiple specific files or glob patterns
pnpm dev batch ./episodes/*.mp4 -t ja,en -f srt,vtt

# Output all generated files to a specific output folder
pnpm dev batch ./podcasts/ -t ja -o ./subtitles/

# Non-recursive directory search or fail-fast on error
pnpm dev batch ./videos/ --no-recursive --fail-fast
```

### 4. Direct Subtitle Translation (`vsub translate`)
Translate an existing `.srt` file without needing video files or Groq API:
```bash
pnpm dev translate sample.ja.srt -t en -f srt,vtt
```

### 5. Video Subtitle Hardsub / Burn-in (`--burn` & `vsub burn`)
Bake subtitles directly into a `.mp4` video with FFmpeg:
```bash
# Transcribe, translate, and bake subtitles into video in a single command
pnpm dev video.mp4 -t ja --burn

# Or burn an existing subtitle file into a video directly
pnpm dev burn video.mp4 video.ja.srt -o video.subbed.mp4
```

### 6. Using Glossary & Custom Prompts

#### Inline Glossary Mapping
```bash
pnpm dev video.mp4 -t ja --glossary "Generative AI=生成AI,vsub=ブイサブ"
```

#### JSON Glossary File (Multilingual / Flat)
```bash
pnpm dev video.mp4 -t ja,zh --glossary ./glossary.json
```

**`glossary.json` format example:**
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
> If `--whisper-prompt` is omitted, source terms from `--glossary` (`Large Language Model, Agentic AI`) are automatically passed to Whisper as recognition hints to improve speech recognition accuracy as well!

#### Custom Translation Tone & Instructions
```bash
pnpm dev video.mp4 -t ja --prompt "Translate in a polite and professional tone suited for software engineers. Keep subtitles concise."
```

### 7. Cache Management & Performance Tuning
```bash
# View cache usage statistics
pnpm dev cache stats

# Force fresh translation bypassing cache
pnpm dev video.mp4 -t ja --fresh

# Clean up all cached items
pnpm dev cache clean

# Increase translation concurrency for high-bandwidth API tiers
pnpm dev video.mp4 -t ja --concurrency 5
```

---

## Global Configuration Commands

```bash
# Show current configuration (API keys masked)
pnpm dev config show

# Save persistent default prompts, glossary, or concurrency
pnpm dev config set --prompt "Translate politely" --glossary "./glossary.json" --concurrency 4

# View configuration file path
pnpm dev config path
```

---

## License

The source code of `vsub-cli` is released under [The Unlicense](LICENSE) (Public Domain).

### Third-Party Licenses
The standalone single executables bundle the following open-source libraries (MIT, Apache-2.0, BSD-2-Clause, ISC):
* `@google/genai` (Apache-2.0)
* `commander` (MIT)
* `dotenv` (BSD-2-Clause)
* `execa` (MIT)
* `groq-sdk` (Apache-2.0)
* `ora` (MIT)
* `picocolors` (ISC)

You can inspect the third-party licenses and full texts at any time via the CLI:
```bash
# Display bundled third-party licenses summary
vsub licenses

# Display full license texts
vsub licenses --full
```
A consolidated `THIRD_PARTY_LICENSES.txt` is also included in each GitHub Release.