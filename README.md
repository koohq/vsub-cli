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
* 🔄 **Direct Subtitle Translation**: Translate existing `.srt` subtitle files directly into other languages and formats without needing media files or Groq API (`vsub translate`).
* 🛠️ **Interactive Setup & Persistent Config**: Interactive key prompts and global configuration management (`vsub config`).

---

## Prerequisites & Dependencies

1. **Node.js**: v26+ (or v24+)
2. **ffmpeg / ffprobe**: Must be installed on your system (or specify executable path)
3. **API Keys**:
   * `VSUB_GROQ_API_KEY` obtained from [Groq Console](https://console.groq.com/)
   * `VSUB_GEMINI_API_KEY` obtained from [Google AI Studio](https://aistudio.google.com/)
4. **pnpm**: Package manager *(Required for development & building from source)*

---

## Setup & API Key Configuration

You can configure API keys using **3 different methods**:

### Method 1: Interactive Setup (Recommended & Easiest)
If API keys are not set, running any command will automatically launch an interactive terminal prompt.
Keys are saved in a **global configuration file** (`~/.config/vsub/config.json` or `%APPDATA%\vsub\config.json`), so you only need to configure them once across your entire system.

To manually register or update keys interactively:
```bash
# Interactive setup
pnpm dev config init

# Or set directly via CLI arguments
pnpm dev config set --groq-key "your_groq_key" --gemini-key "your_gemini_key"
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
  --ffmpeg-path <path>          Path to ffmpeg executable (searches VSUB_FFMPEG_PATH or PATH if omitted)
  --whisper-prompt <text>       Prompt hint for Groq Whisper speech recognition (terminology, names, etc.)
  --prompt <instruction>        Additional instruction prompt for Gemini translation (tone, style, brevity)
  --glossary <path-or-terms>    Glossary file path (JSON) or inline terms (Key=Val,Key=Val)
  --concurrency <number>        Number of concurrent translation requests to Gemini API (default: 3)
  --no-cache                    Do not use or save intermediate cache (default: false)
  --fresh                       Ignore existing cache and generate fresh output, overwriting cache (default: false)
  --cache-dir <path>            Custom cache directory path
  --keep-audio                  Keep intermediate extracted audio files without deleting (default: false)
  --no-translate                Skip translation and output raw transcribed subtitles
  --save-original               Save original transcription subtitle file alongside the result (default: false)
  --force-translate             Force Gemini translation even if detected language matches target language (default: false)
  --verbose                     Output detailed log messages (API requests, etc.) (default: false)
  -h, --help                    Display help for command

Commands:
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

### 1. Multi-Language & Multi-Format Output
Extract audio once, transcribe once, and generate all subtitles and transcripts simultaneously:
```bash
# Output Japanese, English, and Chinese subtitles in SRT and WebVTT formats
pnpm dev video.mp4 -t ja,en,zh -f srt,vtt,txt,json
```

### 2. Direct Subtitle Translation (`vsub translate`)
Translate an existing `.srt` file without needing video files or Groq API:
```bash
pnpm dev translate sample.ja.srt -t en -f srt,vtt
```

### 3. Using Glossary & Custom Prompts

#### Inline Glossary Mapping
```bash
pnpm dev video.mp4 -t ja --glossary "Antigravity=アンチグラビティ,vsub=ブイサブ"
```

#### JSON Glossary File (Multilingual / Flat)
```bash
pnpm dev video.mp4 -t ja,zh --glossary ./glossary.json
```

**`glossary.json` format example:**
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
> If `--whisper-prompt` is omitted, source terms from `--glossary` (`Antigravity, Agentic AI`) are automatically passed to Whisper as recognition hints to improve speech recognition accuracy as well!

#### Custom Translation Tone & Instructions
```bash
pnpm dev video.mp4 -t ja --prompt "Translate in a polite and professional tone suited for software engineers. Keep subtitles concise."
```

### 4. Cache Management & Performance Tuning
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

[The Unlicense](LICENSE)