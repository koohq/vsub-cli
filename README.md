# vsub-cli (Video Subtitle CLI)

[English](README.md) | [日本語](README.ja.md)

A CLI tool that automatically extracts and optimizes audio from video or audio files, transcribes speech at high speed using the **Groq API (`whisper-large-v3-turbo`)**, and translates text into multilingual subtitles (`.srt`, `.vtt`, `.txt`, `.json`) using the **Google Gemini API (`@google/genai`)**.

---

## Features

* ⚡ **Ultra-Fast Transcription**: Uses `whisper-large-v3-turbo` running on Groq LPUs for rapid speech recognition.
* 🎵 **Video & Audio Support**: Processes video files (`.mp4`, `.mkv`, `.mov`, etc.) as well as audio files (`.mp3`, `.wav`, `.m4a`, `.aac`, `.flac`, `.ogg`, `.opus`, etc.).
* 🔊 **Automated Audio Optimization**: Uses `ffmpeg` to extract and compress lightweight 16kHz mono audio (32–48kbps), automatically staying within Groq's 25MB file size limit (supports automatic splitting for ultra-long media).
* 🎯 **Timecode Preservation**: Converts SRT structures into structured JSON to translate only text chunks, ensuring 100% accurate timecodes without line breaks or drift.
* 🌍 **Multilingual Support**: Supports default Japanese (`ja`), English (`en`), Spanish (`es`), and any target language code.
* 🛠️ **Flexible FFmpeg Path**: Configurable via system `PATH`, environment variable `VSUB_FFMPEG_PATH` (or `FFMPEG_PATH`), or the `--ffmpeg-path` CLI option.

---

## Prerequisites & Dependencies

1. **Node.js**: v24 / v26 or higher
2. **ffmpeg**: Must be installed on your system (or specify executable path)
3. **API Keys**:
   * `VSUB_GROQ_API_KEY` obtained from [Groq Console](https://console.groq.com/)
   * `VSUB_GEMINI_API_KEY` obtained from [Google AI Studio](https://aistudio.google.com/)
4. **pnpm**: Package manager *(Required for development & building from source)*

---

## Setup & API Key Configuration

You can configure API keys using **3 different methods**:

### Method 1: Interactive Setup (Recommended & Easiest)
If API keys are not set, running any command will automatically launch an interactive terminal prompt.
Keys are saved in a **global configuration file** (e.g., `~/.config/vsub/config.json` or `%APPDATA%\vsub\config.json`), so you only need to set them once across your system.

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

### Basic Command

```bash
# Generate Japanese subtitles ([media_name].ja.srt) by default from video or audio
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
  media-file                Target video or audio file path (.mp4, .mp3, .wav, .m4a, .mov, etc.)

Options:
  -t, --target-lang <langs> Target language code(s), comma-separated (e.g., ja,en,es) (default: "ja")
  -f, --format <formats>    Output formats: comma-separated list of srt, vtt, txt, json (default: "srt")
  -o, --output <path>       Output path for the generated subtitle file
  --ffmpeg-path <path>      Path to ffmpeg executable (searches VSUB_FFMPEG_PATH or PATH if omitted)
  --whisper-prompt <text>   Prompt hint for Groq Whisper speech recognition (terminology, names, etc.)
  --prompt <instruction>    Additional instruction prompt for Gemini translation (tone, style, brevity)
  --glossary <path-or-terms> Glossary file path (JSON) or inline terms (Key=Val,Key=Val)
  --concurrency <number>    Number of concurrent translation requests to Gemini API (default: 3)
  --no-cache                Do not use or save intermediate cache (default: false)
  --fresh                   Ignore existing cache and generate fresh output, overwriting cache (default: false)
  --cache-dir <path>        Custom cache directory path
  --keep-audio              Keep intermediate extracted audio files without deleting (default: false)
  --no-translate            Skip translation and output raw transcribed subtitles
  --save-original           Save original transcription subtitle file alongside the result (default: false)
  --force-translate         Force Gemini translation even if detected language matches target language (default: false)
  --verbose                 Output detailed log messages (API requests, etc.) (default: false)
  -h, --help                Display help for command

Commands:
  translate <subtitle-file> Directly translate an existing subtitle file (.srt) into target language(s) via Gemini API
  cache path                Display cache directory path
  cache stats               Display cache usage and entry counts
  cache clean               Delete all intermediate cache files
  config path               Display global configuration file path
  config show               Display current settings (API Keys are masked)
  config set                Save API Keys, FFmpeg path, prompts, concurrency to global config
  config init               Initialize API Keys interactively
```

### Using Glossary & Custom Prompts

#### 1. Inline Glossary Mapping
Specify direct term-translation pairs on the CLI without creating a file:
```bash
pnpm dev video.mp4 -t ja --glossary "Antigravity=アンチグラビティ,vsub=ブイサブ"
```

#### 2. JSON Glossary File (Single & Multilingual)
Provide structured JSON glossary files for domain terminology:
```bash
pnpm dev video.mp4 -t ja,zh --glossary ./glossary.json
```

**Example `glossary.json` format:**
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
*(Also supports flat schema `{"Antigravity": "アンチグラビティ"}` or term-based schema `{"Antigravity": {"ja": "...", "zh": "..."}}`)*

> [!TIP]
> If `--whisper-prompt` is omitted, source terms from `--glossary` (`Antigravity, Agentic AI`) are automatically passed to Whisper as recognition hints to boost both transcription and translation precision!

#### 3. Custom Translation Tone & Style Prompts
```bash
pnpm dev video.mp4 -t ja --prompt "Translate in a polite and professional tone suited for software engineers. Keep subtitles concise."
```

### Examples

```bash
# Check or initialize configuration
pnpm dev config show
pnpm dev config init

# Save global default prompt or glossary
pnpm dev config set --prompt "Translate politely" --glossary "./glossary.json"

# Directly translate existing SRT file to English with glossary
pnpm dev translate sample.ja.srt -t en --glossary "Antigravity=アンチグラビティ"

# Translate existing SRT into multiple formats (.srt, .vtt, .txt, .json)
pnpm dev translate sample.srt -t en -f srt,vtt,txt,json

# Transcribe & translate audio files directly (.mp3, .wav, .m4a, etc.)
pnpm dev podcast.mp3 -t ja

# Generate English subtitles (.en.srt) from video
pnpm dev sample.mp4 -t en

# Output multiple formats simultaneously (.srt, .vtt, .txt, .json)
pnpm dev sample.mp4 -f srt,vtt,txt,json

# Transcription only without translation (does not require Gemini API Key)
pnpm dev sample.mp4 --no-translate

# Save both translated subtitles and original transcription subtitles
pnpm dev sample.mp4 -t ja --save-original

# Force Gemini translation even if speech language matches target language
pnpm dev sample.mp4 -t ja --force-translate

# Specify custom output path
pnpm dev sample.mp4 -o ./subtitles/my_subtitle.srt

# Specify custom ffmpeg executable path
pnpm dev sample.mp4 --ffmpeg-path "/usr/bin/ffmpeg"
```

---

## License

[The Unlicense](LICENSE)