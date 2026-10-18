# vsub-cli (Video & Audio Subtitle CLI)

[English](README.md) | [日本語](README.ja.md)

A fast, resilient CLI tool that extracts and optimizes audio from video or audio files, performs ultra-fast speech recognition with the **Groq API (`whisper-large-v3-turbo`)**, and generates multilingual subtitles, transcripts, chapters, and summaries using the **Google Gemini API (`@google/genai`)**.

---

## Key Features

* ⚡ **Ultra-Fast Transcription**: Powered by `whisper-large-v3-turbo` running on Groq LPUs for near-instant speech recognition.
* 🎵 **Video & Audio File Support**: Directly accepts video files (`.mp4`, `.mkv`, `.mov`, etc.) and audio files (`.mp3`, `.wav`, `.m4a`, `.aac`, `.flac`, `.ogg`, `.opus`, etc.).
* 🔊 **Automated Audio Optimization**: Compresses media to 16kHz mono (32–48kbps) via `ffmpeg` to stay under Groq's 25MB limit. Automatically splits ultra-long media and calculates timecodes with millisecond precision based on measured segment durations.
* 🎯 **Timecode-Preserving & Context-Aware Translation**: Translates subtitle text in structured chunks via Google Gemini (`gemini-3.8-flash`) using Structured Outputs (`responseSchema`) and a sliding context window (`--context-window`), eliminating timecode corruption or line drift while maintaining natural tone across chunk boundaries.
* ✂️ **Smart Subtitle Reflow**: Automatically splits overly long Whisper segments at natural punctuation or clause boundaries with millisecond-proportional timecode allocation (`--max-length`, `--max-duration`, `--no-reflow`).
* 🚀 **Concurrent Translation Control**: Translates subtitle chunks concurrently using an asynchronous worker pool (`--concurrency`, default: 3) with jittered exponential backoff for 429/rate-limit recovery.
* 💾 **Smart Intermediate Caching**: Automatically caches transcriptions, translations, chapters, and summaries by media content hash (size + mtime). Re-run or add new target languages immediately without repeating API calls (`vsub cache`).
* 📖 **Glossary & Custom Prompting**: Pass custom translation instructions (`--prompt`), domain glossaries (`--glossary` via JSON or inline `Key=Val`), and Whisper recognition hints (`--whisper-prompt`).
* 🌍 **Simultaneous Multi-Language & Bilingual Output**: Generate subtitles for multiple target languages in one pass (e.g., `-t ja,en,zh`) or pair original and translated text into dual-language subtitles (`-b, --bilingual`).
* 📄 **Multi-Format & Stdout Streaming**: Export to `.srt` (SubRip), `.vtt` (WebVTT), `.txt` (plain text), and `.json` (structured data), or stream directly to `stdout` (`--stdout` / `-o -`) for UNIX pipes (`jq`, `pbcopy`) and AI agent workflows.
* 📑 **AI Chapters & Video Summaries**: Generate YouTube-ready timestamps (`vsub chapters`) and structured Markdown summaries (`vsub summarize`) from media or `.srt` files, reusing cached transcriptions for instant results.
* 🎬 **Hardsub Burn-in & Lossless Softsub Embedding**: Bake subtitles directly into video with customizable position and font size (`--burn`, `--burn-position`, `--burn-font-size`), or mux multi-language toggleable subtitle tracks in seconds without re-encoding (`--embed`, `vsub embed`).
* 📁 **Directory & Batch Bulk Processing**: Process entire directories, glob patterns, or multiple video/audio files with automated sequential queueing, error resilience, and consolidated summary reports (`vsub batch`).
* 🛡️ **File Overwrite Protection & Safety Backups**: Prevents accidental file loss with pre-execution conflict checks, interactive prompts (`y/N`), `-w, --overwrite` force option, and `--backup` (`.bak` / `.bak.N`) archiving.
* 🔄 **Direct Subtitle Translation**: Translate existing `.srt` subtitle files directly into other languages and formats without needing media files or the Groq API (`vsub translate`).
* 🛠️ **Interactive Setup & Self-Updating Binaries**: Guided setup wizard (`vsub init`), persistent configuration (`vsub config`), and SHA-256 verified standalone binary self-updates (`vsub update`).

---

## Installation

`vsub-cli` is available both as **standalone single executables (no Node.js required)** and as an npm package.

### Method 1: Standalone Single Executables (Recommended, No Node.js Required)
Download the prebuilt compressed archive for your operating system and CPU architecture from [GitHub Releases](https://github.com/koohq/vsub-cli/releases):

* **Windows x64**: `vsub-windows-x64.zip`
* **Windows ARM64**: `vsub-windows-arm64.zip`
* **Linux x64**: `vsub-linux-x64.tar.gz`
* **Linux ARM64**: `vsub-linux-arm64.tar.gz`
* **macOS ARM64 (Apple Silicon)**: `vsub-macos-arm64.tar.gz`

Each archive includes the standalone executable (`vsub` or `vsub.exe`) along with project and third-party license notices, compressed to ~25–35 MB for fast downloading.

> [!NOTE]
> * For Intel Mac (x64) environments, please use **Method 2 (npm / pnpm)** due to an upstream Node.js SEA limitation.
> * `ffmpeg` / `ffprobe` is required on your system for audio extraction, subtitle burn-in (`--burn`), and softsub embedding (`--embed`).

```bash
# Extract archive (Linux / macOS)
tar -xzf vsub-macos-arm64.tar.gz

# Ensure binary is executable (Linux / macOS)
chmod +x vsub

# Run interactive setup wizard
./vsub init
```

On Windows, extract `vsub-windows-x64.zip` and run `vsub.exe init` (place `vsub.exe` in a directory on your `PATH` to invoke `vsub` from anywhere).

### Method 2: Global Install via npm / pnpm (For Node.js environments)
```bash
# Install via npm
npm install -g vsub-cli

# Or via pnpm
pnpm add -g vsub-cli
```

---

## Prerequisites & Dependencies

1. **ffmpeg / ffprobe**: Must be installed on your system (or configured via `--ffmpeg-path` / `VSUB_FFMPEG_PATH`)
2. **API Keys**:
   * `VSUB_GROQ_API_KEY` obtained from [Groq Console](https://console.groq.com/)
   * `VSUB_GEMINI_API_KEY` obtained from [Google AI Studio](https://aistudio.google.com/)
3. **Node.js**: v26+ or v24+ *(Required only when installing via npm/pnpm or building from source)*

---

## Setup & API Key Configuration

You can configure API keys using **3 methods**:

### Method 1: Interactive Setup Wizard (Recommended & Easiest)
Run `vsub init` to launch the interactive setup wizard, which verifies Groq API, Gemini API, and FFmpeg connectivity before saving your configuration:
```bash
# Run interactive setup wizard
vsub init

# Or set keys directly via CLI arguments
vsub config set --groq-key "your_groq_key" --gemini-key "your_gemini_key"
```

### Method 2: Environment Variables (`VSUB_` Prefix)
Set keys in your shell or system environment variables (the `VSUB_` prefix prevents collisions with other tools):
```bash
export VSUB_GROQ_API_KEY="your_groq_api_key_here"
export VSUB_GEMINI_API_KEY="your_gemini_api_key_here"
```
*(Standard `GROQ_API_KEY` and `GEMINI_API_KEY` are also supported as fallbacks)*

### Method 3: `.env` File
Create a `.env` file in the current working directory:
```env
VSUB_GROQ_API_KEY=your_groq_api_key_here
VSUB_GEMINI_API_KEY=your_gemini_api_key_here
```

---

## Usage

### Basic Commands

```bash
# Generate Japanese subtitles ([media_name].ja.srt) from video or audio
vsub path/to/video.mp4
vsub path/to/podcast.mp3

# When running directly from cloned source repository:
pnpm dev path/to/video.mp4
```

### Command Line Help

```text
Usage: vsub [options] [command] <media-file>

Arguments:
  media-file                    Target video or audio file path (.mp4, .mp3, .wav, .m4a, .mov, etc.)

Options:
  -l, --lang <lang>             UI display language: en (default), ja
  -t, --target-lang <langs>     Target language code(s), comma-separated (e.g., ja,en,es) (default: "ja")
  -f, --format <formats>        Output formats: comma-separated list of srt, vtt, txt, json (default: "srt")
  -o, --output <path>           Output path for the generated subtitle file (or '-' for stdout)
  --stdout                      Output subtitles directly to stdout instead of saving to file (default: false)
  -w, --overwrite               Overwrite existing output files without confirmation prompt (default: false)
  --backup                      Create backup (.bak) of existing output files before overwriting (default: false)
  -b, --bilingual               Generate bilingual subtitles combining original and translated text (default: false)
  --bilingual-order <order>     Order of bilingual subtitles: original-first (default) or target-first (default: "original-first")
  --ffmpeg-path <path>          Path to ffmpeg executable (searches VSUB_FFMPEG_PATH or PATH if omitted)
  --whisper-prompt <text>       Prompt hint for Groq Whisper speech recognition (terminology, names, etc.)
  --prompt <instruction>        Additional instruction prompt for Gemini translation (tone, style, brevity)
  --glossary <path-or-terms>    Glossary file path (JSON) or inline terms (Key=Val,Key=Val)
  --concurrency <number>        Number of concurrent translation requests to Gemini API (default: 3)
  --gemini-model <model>        Gemini translation model (default: gemini-3.8-flash)
  --groq-model <model>          Groq Whisper transcription model (default: whisper-large-v3-turbo)
  --no-cache                    Do not use or save intermediate cache (default: false)
  --fresh                       Ignore existing cache and generate fresh output, overwriting cache (default: false)
  --cache-dir <path>            Custom cache directory path
  --context-window <lines>      Number of preceding context lines to carry across translation chunks (0 to disable) (default: 5)
  --max-length <chars>          Max characters per subtitle entry before automatic splitting (default: CJK 32, Latin 75)
  --max-duration <seconds>      Max display duration in seconds per subtitle entry (default: 7)
  --no-reflow                   Disable automatic splitting and reflowing of long subtitle segments (default: false)
  --burn                        Burn generated subtitles directly into output video (hardsub) (default: false)
  --burn-position <pos>         Subtitle position for --burn: bottom (default), top, center
  --burn-font-size <size>       Subtitle font size for --burn: small, medium, large, or number (default: auto)
  --embed                       Embed generated subtitles directly as soft subtitle tracks into output video (default: false)
  --keep-audio                  Keep intermediate extracted audio files without deleting (default: false)
  --no-translate                Skip translation and output raw transcribed subtitles (default: false)
  --save-original               Save original transcription subtitle file alongside the result (default: false)
  --force-translate             Force Gemini translation even if detected language matches target language (default: false)
  --no-update-check             Disable checking for new version updates (default: false)
  --verbose                     Output detailed log messages (API requests, etc.) (default: false)
  -h, --help                    Display help for command

Commands:
  batch <targets...>            Process multiple media files in bulk (directories, multiple files, or glob patterns)
  translate <subtitle-file>     Directly translate an existing subtitle file (.srt) into target language(s) via Gemini API
  burn <video-file> <sub-file>  Burn an existing subtitle file (.srt) directly into a video file via FFmpeg (hardsub)
  embed <video> <sub-files...>  Embed one or more subtitle files (.srt) as soft subtitle tracks into a video via FFmpeg stream copy
  chapters <file>               Generate video chapters (table of contents) from media or subtitle files via Gemini
  summarize <file>              Generate structured summary and key topic highlights from media or subtitle files via Gemini
  init                          Interactive setup wizard to verify and configure API keys, FFmpeg, and preferences
  update [options]              Update vsub-cli standalone binary to the latest release (alias: upgrade)
  cache (path|stats|clean)      Manage intermediate transcription and translation cache
  config (path|show|set|init)   Manage global configuration settings
  licenses [options]            Display third-party open-source software licenses and legal notices
```

---

## Advanced Features & Examples

### 1. Bilingual Subtitles (`--bilingual` / `-b`)
Create dual-language subtitles pairing original transcription and translation:
```bash
# Generate bilingual subtitles (.ja.bilingual.srt) and a hardsubbed video
vsub video.mp4 -t ja --bilingual --burn

# Place translated text on top and original text on the bottom
vsub video.mp4 -t ja -b --bilingual-order target-first
```

### 2. Multi-Language & Multi-Format Output
Extract audio once, transcribe once, and generate all subtitles and transcripts simultaneously:
```bash
# Output Japanese, English, and Chinese subtitles in SRT, WebVTT, TXT, and JSON formats
vsub video.mp4 -t ja,en,zh -f srt,vtt,txt,json
```

### 3. Directory & Batch Bulk Processing (`vsub batch`)
Process multiple media files in a directory or via glob patterns in one run:
```bash
# Process all media files in a directory recursively
vsub batch ./videos/ -t ja

# Process multiple specific files or glob patterns
vsub batch ./episodes/*.mp4 -t ja,en -f srt,vtt

# Save all generated files to a dedicated output folder
vsub batch ./podcasts/ -t ja -o ./subtitles/

# Disable recursive directory search or abort immediately on first error
vsub batch ./videos/ --no-recursive --fail-fast
```

### 4. Direct Subtitle Translation (`vsub translate`)
Translate an existing `.srt` file without needing media files or the Groq API:
```bash
vsub translate sample.ja.srt -t en -f srt,vtt
```

### 5. Video Subtitle Hardsub / Burn-in (`--burn` & `vsub burn`)
Bake subtitles directly into an `.mp4` video with FFmpeg:
```bash
# Transcribe, translate, and bake subtitles into video in a single command
vsub video.mp4 -t ja --burn

# Customize subtitle position (bottom, top, center) and font size (small, medium, large, or number)
vsub video.mp4 -t ja --burn --burn-position top --burn-font-size large

# Burn an existing subtitle file into a video with custom position and size
vsub burn video.mp4 video.ja.srt --burn-position top --burn-font-size 28 -o video.subbed.mp4
```

### 6. Fast Soft Subtitle Embedding (`--embed` & `vsub embed`)
Embed subtitles into video containers as toggleable subtitle tracks without re-encoding video or audio (lossless & completes in seconds via FFmpeg stream copy):
```bash
# Embed multi-language subtitle tracks into a single MP4 video file
vsub video.mp4 -t ja,en,zh --embed
# => Output: video.embedded.mp4 (with selectable Japanese, English, and Chinese tracks)

# Or embed one or more existing SRT subtitle files into a video directly
vsub embed video.mp4 video.ja.srt video.en.srt -o video.subbed.mp4
```

### 7. Smart Subtitle Reflow & Sliding Window Context
Control how long speech segments are split and how context is preserved across translation chunks:
```bash
# Customize maximum characters and duration per subtitle segment
vsub video.mp4 -t ja --max-length 28 --max-duration 5

# Disable automatic segment splitting to preserve raw Whisper segment boundaries
vsub video.mp4 -t ja --no-reflow

# Adjust preceding context lines carried across 50-line translation chunks (default: 5, 0 to disable)
vsub video.mp4 -t ja --context-window 8
```

### 8. Using Glossaries & Custom Prompts

#### Inline Glossary Mapping
```bash
vsub video.mp4 -t ja --glossary "Generative AI=生成AI,vsub=ブイサブ"
```

#### JSON Glossary File (Multilingual / Flat)
```bash
vsub video.mp4 -t ja,zh --glossary ./glossary.json
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
> Even when `--whisper-prompt` is omitted, source terms from `--glossary` (`Large Language Model, Agentic AI`) are automatically passed to Whisper as recognition hints, improving speech recognition accuracy as well.

#### Custom Translation Tone & Instructions
```bash
vsub video.mp4 -t ja --prompt "Translate in a polite and professional tone suited for software engineers. Keep subtitles concise."
```

### 9. AI Chapters & Video Summary (`vsub chapters` & `vsub summarize`)
Generate YouTube chapters or structured Markdown summaries from any video, audio, or existing `.srt` file. When the media has already been processed by `vsub`, it automatically reuses the transcription cache and finishes in seconds:
```bash
# Generate YouTube-compatible chapters (00:00 Title format, saved to [name].chapters.txt)
vsub chapters video.mp4 -t ja
vsub chapters subtitle.srt -f json  # Output as structured JSON array

# Generate structured executive summary (Markdown by default, saved to [name].summary.md)
vsub summarize video.mp4 -t ja
vsub summarize interview.srt -f txt # Output plain text summary
```

### 10. Standard Output Streaming & UNIX Pipe Integration (`--stdout` / `-o -`)
Stream subtitles, transcripts, chapters, or summaries directly to `stdout` without writing files to disk (progress spinners are routed to `stderr` so piped data stays clean):
```bash
# Stream JSON subtitle entries directly to jq
vsub video.mp4 -t en -f json --stdout | jq '.[0]'

# Copy generated YouTube chapters directly to clipboard
vsub chapters video.mp4 --stdout | pbcopy

# Redirect structured meeting summary to a file
vsub summarize meeting.mp4 --stdout > summary.md
```

### 11. Cache Management & Standalone Self-Update
```bash
# View cache usage statistics or clean cached items
vsub cache stats
vsub cache clean

# Check for updates or self-update standalone binary to the latest GitHub Release
vsub update --check
vsub update
```

---

## Global Configuration Commands (`vsub config`)

```bash
# Show current configuration (API keys are masked)
vsub config show

# Save persistent defaults (display language, prompts, glossary, concurrency, reflow length, burn style)
vsub config set --lang ja --prompt "Translate politely" --glossary "./glossary.json" --concurrency 4
vsub config set --max-length 32 --burn-position bottom --burn-font-size medium

# Disable automatic version update checks
vsub config set --disable-update-check true

# View configuration file path
vsub config path
```

---

## License

The source code of `vsub-cli` is released under the [MIT License](LICENSE).

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
A consolidated `THIRD_PARTY_LICENSES.txt` is also included in each GitHub Release archive.