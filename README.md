# vsub-cli (Video Subtitle CLI)

[English](README.md) | [日本語](README.ja.md)

A CLI tool that automatically extracts audio from video files, transcribes speech at high speed using the **Groq API (`whisper-large-v3-turbo`)**, and translates text into multilingual subtitles (`.srt`) using the **Google Gemini API (`@google/genai`)**.

---

## Features

* ⚡ **Ultra-Fast Transcription**: Uses `whisper-large-v3-turbo` running on Groq LPUs for rapid speech recognition.
* 🔊 **Automated Audio Optimization**: Uses `ffmpeg` to extract lightweight 16kHz mono audio (32–48kbps), automatically staying within Groq's 25MB file size limit (supports automatic splitting for ultra-long videos).
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
# Generate Japanese subtitles ([video_name].ja.srt) by default
pnpm dev path/to/video.mp4

# Or execute after building
pnpm build
node ./dist/index.js path/to/video.mp4
```

### Command Line Help

```text
Usage: vsub [options] [command] <video-file>

Arguments:
  video-file                Target video file path (.mp4, .mkv, .mov, etc.)

Options:
  -t, --target-lang <lang>  Target language code (e.g., ja, en, es) (default: "ja")
  -f, --format <formats>    Output formats: comma-separated list of srt, vtt, txt, json (default: "srt")
  -o, --output <path>       Output path for the generated subtitle file
  --ffmpeg-path <path>      Path to ffmpeg executable (searches VSUB_FFMPEG_PATH or PATH if omitted)
  --keep-audio              Keep intermediate extracted audio files without deleting (default: false)
  --no-translate            Skip translation and output raw transcribed subtitles
  --save-original           Save original transcription subtitle file alongside the result (default: false)
  --force-translate         Force Gemini translation even if detected language matches target language (default: false)
  --verbose                 Output detailed log messages (API requests, etc.) (default: false)
  -h, --help                Display help for command

Commands:
  config path               Display global configuration file path
  config show               Display current settings (API Keys are masked)
  config set                Save API Keys or FFmpeg path to global config
  config init               Initialize API Keys interactively
```

### Examples

```bash
# Check or initialize configuration
pnpm dev config show
pnpm dev config init

# Generate English subtitles (.en.srt)
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
pnpm dev sample.mp4 --ffmpeg-path "C:\tools\ffmpeg\bin\ffmpeg.exe"
```

---

## License

[The Unlicense](LICENSE)