# vsub-cli (Video & Audio Subtitle CLI)

[![npm version](https://img.shields.io/npm/v/vsub-cli)](https://www.npmjs.com/package/vsub-cli)
[![CI](https://img.shields.io/github/actions/workflow/status/koohq/vsub-cli/ci.yml?branch=main&label=CI)](https://github.com/koohq/vsub-cli/actions/workflows/ci.yml?query=branch%3Amain)
[![License](https://img.shields.io/github/license/koohq/vsub-cli)](https://github.com/koohq/vsub-cli/blob/main/LICENSE)

[English](README.md) | [日本語](README.ja.md)

A fast, resilient CLI tool that extracts and optimizes audio from video or audio files, transcribes speech via **OpenRouter (ElevenLabs Scribe v2, default)** or **Groq (`whisper-large-v3-turbo`)**, and generates multilingual subtitles, transcripts, chapters, and summaries via **Google Gemini directly (`gemini-3.8-flash`) or through OpenRouter (`google/gemini-3.8-flash`)**.

---

## Key Features

* ⚡ **Accurate & Fast Transcription**: Transcribe speech by default with ElevenLabs Scribe v2 (`elevenlabs/scribe-v2`) via OpenRouter, or choose ultra-fast Groq Whisper (`whisper-large-v3-turbo`).
* 🎵 **Video & Audio File Support**: Directly accepts video files (`.mp4`, `.mkv`, `.mov`, etc.) and audio files (`.mp3`, `.wav`, `.m4a`, `.aac`, `.flac`, `.ogg`, `.opus`, etc.).
* 🔊 **Automated Audio Optimization**: Compresses media to 16kHz mono (48kbps) via `ffmpeg` to fit provider limits (OpenRouter splits every 5 minutes; Groq splits when exceeding 25MB). Splits at silences just before the target positions, or at the target positions when no silence is found. Automatically splits ultra-long media and calculates timecodes with millisecond precision based on measured segment durations.
* 🎯 **Timecode-Preserving & Context-Aware Translation**: Translates subtitle text in structured chunks via Google Gemini (`gemini-3.8-flash`) directly or through OpenRouter (`google/gemini-3.8-flash`) using Structured Outputs (JSON schema: `responseSchema` for Gemini, `response_format` for OpenRouter) and a sliding context window (`--context-window`), eliminating timecode corruption or line drift while maintaining natural tone across chunk boundaries.
* ✂️ **Smart Subtitle Reflow**: For Scribe v2, subtitle boundaries are built from word-level timestamps. Overly long segments are automatically split at natural punctuation or clause boundaries with millisecond-proportional timecode allocation (`--max-length`, `--max-duration`, `--no-reflow`).
* 🚀 **Concurrent Translation Control**: Translates subtitle chunks concurrently using an asynchronous worker pool (`--concurrency`, default: 3) with jittered exponential backoff for 429/rate-limit recovery.
* 💾 **Smart Intermediate Caching**: Automatically caches transcriptions, translations, chapters, and summaries, keyed by a SHA-256 hash of the media file's size and content sampled from the beginning, middle, and end. Cached results remain reusable after moving or renaming the file. Transcription cache is reused only when provider, model, and recognition hints match. Re-run or add new target languages immediately without repeating API calls (`vsub cache`). If translation fails partway through, completed chunks are kept in the cache; run the same command again to resume (`--no-cache` does not save progress, and `--fresh` translates from the beginning).
* 📖 **Glossary & Custom Prompting**: Pass custom translation instructions (`--prompt`), domain glossaries (`--glossary` via JSON or inline `Key=Val`), and Whisper recognition hints (`--whisper-prompt`).
* 🌍 **Simultaneous Multi-Language & Bilingual Output**: Generate subtitles for multiple target languages in one pass (e.g., `-t ja,en,zh`) or pair original and translated text into dual-language subtitles (`-b, --bilingual`).
* 📄 **Multi-Format & Stdout Streaming**: Export to `.srt` (SubRip), `.vtt` (WebVTT), `.txt` (plain text), and `.json` (structured data), or stream directly to `stdout` (`--stdout` / `-o -`) for UNIX pipes (`jq`, `pbcopy`) and AI agent workflows.
* 📑 **AI Chapters & Video Summaries**: Generate YouTube-ready timestamps (`vsub chapters`) and structured Markdown summaries (`vsub summarize`) from media or `.srt` files, reusing cached transcriptions for instant results.
* 🎬 **Hardsub Burn-in & Lossless Softsub Embedding**: Bake subtitles directly into video with customizable position and font size (`--burn`, `--burn-position`, `--burn-font-size`), or mux multi-language toggleable subtitle tracks in seconds without re-encoding (`--embed`, `vsub embed`).
* 📁 **Directory & Batch Bulk Processing**: Process entire directories, glob patterns, or multiple video/audio files with automated sequential queueing, error resilience, and consolidated summary reports (`vsub batch`).
* 🛡️ **File Overwrite Protection & Safety Backups**: Prevents accidental file loss with pre-execution conflict checks, interactive prompts (`y/N`), `-w, --overwrite` force option, and `--backup` (`.bak` / `.bak.N`) archiving.
* 🔄 **Direct Subtitle Translation**: Translate existing `.srt` subtitle files directly into other languages and formats without needing media files or transcription APIs (`vsub translate`).
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
The package is published on [npm](https://www.npmjs.com/package/vsub-cli).

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
   * With just a single **OpenRouter API key** (`VSUB_OPENROUTER_API_KEY` from [OpenRouter](https://openrouter.ai/keys)), everything works out of the box—from speech recognition to translation, chapters, and summaries.
   * If a **Gemini API key** (`VSUB_GEMINI_API_KEY` from [Google AI Studio](https://aistudio.google.com/)) is configured, translation, chapters, and summaries use Gemini directly.
   * For ultra-fast Whisper speech recognition, you can also use `VSUB_GROQ_API_KEY` from [Groq Console](https://console.groq.com/).
3. **Node.js**: v26+ or v24+ *(Required only when installing via npm/pnpm or building from source)*

---

## Setup & API Key Configuration

You can configure API keys using **3 methods**:

### Method 1: Interactive Setup Wizard (Recommended & Easiest)
Run `vsub init` to launch the interactive setup wizard, which lets you choose your transcription provider (OpenRouter or Groq) and text generation provider (Gemini or OpenRouter), and verifies API keys and FFmpeg connectivity before saving your configuration:
```bash
# Run interactive setup wizard
vsub init

# Single OpenRouter key works for everything:
vsub config set --openrouter-key "your_openrouter_key"

# Or set both OpenRouter and Gemini keys:
vsub config set --openrouter-key "your_openrouter_key" --gemini-key "your_gemini_key"

# Using Groq instead:
vsub config set --stt-provider groq --groq-key "your_groq_key" --gemini-key "your_gemini_key"

# Optional: write scene notes for translation by default (main command, batch, and translate):
vsub config set --auto-context true
```

### Method 2: Environment Variables (`VSUB_` Prefix)
Set keys in your shell or system environment variables (the `VSUB_` prefix prevents collisions with other tools):
```bash
# Single OpenRouter key (everything works out of the box):
export VSUB_OPENROUTER_API_KEY="your_openrouter_api_key_here"

# Optional: with a Gemini key, translation, chapters and summaries use Gemini directly:
# export VSUB_GEMINI_API_KEY="your_gemini_api_key_here"

# Optional: keep using OpenRouter even when a Gemini key is set:
# export VSUB_LLM_PROVIDER="openrouter"

# Optional: text generation reasoning effort (minimal/low/medium/high, default: low):
# export VSUB_LLM_REASONING_EFFORT="medium"

# Optional: write scene notes for translation by default (true/false, default: off):
# export VSUB_AUTO_CONTEXT="true"

# Or for Groq:
# export VSUB_STT_PROVIDER="groq"
# export VSUB_GROQ_API_KEY="your_groq_api_key_here"
```
*(Standard `GROQ_API_KEY` and `GEMINI_API_KEY` are also supported as fallbacks. The generic `OPENROUTER_API_KEY` is read only when OpenRouter is selected explicitly; see [Choosing a Transcription Provider](#choosing-a-transcription-provider) and [Choosing a Text Generation Provider](#choosing-a-text-generation-provider).)*

### Method 3: `.env` File
Create a `.env` file in the current working directory:
```env
# Single OpenRouter key (everything works out of the box):
VSUB_OPENROUTER_API_KEY=your_openrouter_api_key_here

# Optional: with a Gemini key, translation, chapters and summaries use Gemini directly:
# GEMINI_API_KEY=your_gemini_api_key_here

# Optional: keep using OpenRouter even when a Gemini key is set:
# VSUB_LLM_PROVIDER=openrouter

# Or for Groq:
# VSUB_STT_PROVIDER=groq
# GROQ_API_KEY=your_groq_api_key_here
```

---

## Choosing a Transcription Provider

vsub selects the transcription provider in the following order of precedence:
1. `--stt-provider <openrouter|groq|openai-compatible>` CLI option
2. `VSUB_STT_PROVIDER` environment variable or `sttProvider` in the configuration file
3. Automatic selection based on configured keys:
   - If `VSUB_OPENROUTER_API_KEY` (or a saved OpenRouter key) exists → **OpenRouter**
   - Otherwise, if a Groq key exists → **Groq**
   - If neither exists → **OpenRouter**

> [!NOTE]
> The generic `OPENROUTER_API_KEY` environment variable is only read when OpenRouter is explicitly selected (via option or setting). This prevents keys intended for other developer tools from unexpectedly changing billing and usage.

### For Existing Groq Users
Existing Groq users can update `vsub-cli` and continue using Groq seamlessly; your existing transcription cache remains valid. When Groq is selected automatically, a one-line recommendation for OpenRouter is shown. To silence this recommendation, explicitly set Groq as your provider with `VSUB_STT_PROVIDER=groq` or `vsub config set --stt-provider groq`.

### Models & Recognition Hints
* **Models**:
  - `--stt-model <model>` overrides the transcription model for the chosen provider.
  - `VSUB_OPENROUTER_STT_MODEL` (config: `openrouterSttModel`) sets the default OpenRouter model (default: `elevenlabs/scribe-v2`).
  - `VSUB_GROQ_MODEL` (config: `groqModel`) sets the default Groq model (default: `whisper-large-v3-turbo`).
  - **The only tested OpenRouter model is `elevenlabs/scribe-v2`**. While other models can be specified with `--stt-model`, they are untested and may not work.
  - The model must return timestamped segments or words (`verbose_json`). Models that return plain text only cannot produce subtitles, and vsub stops with an error.
* **Recognition Hints**:
  - Recognition prompt hints (`--whisper-prompt` and terms extracted from `--glossary`) are sent only to Groq Whisper and the openai-compatible provider. They are not sent to OpenRouter.

---

### OpenAI-compatible transcription (untested)

**Untested and not guaranteed to work:** this provider is for OpenAI-compatible APIs, such as local servers or a direct OpenAI connection. The author has not verified these endpoints. It is never selected automatically from API keys; select it explicitly with `--stt-provider openai-compatible`, `VSUB_STT_PROVIDER=openai-compatible`, or `vsub config set --stt-provider openai-compatible`.

Set a base URL and model; neither has a default. Environment variables take priority over saved settings and can also be written in `.env`:

```dotenv
VSUB_OPENAI_COMPATIBLE_STT_BASE_URL=http://localhost:8000/v1
VSUB_OPENAI_COMPATIBLE_STT_MODEL=whisper-1
VSUB_OPENAI_COMPATIBLE_STT_API_KEY=test-key-1234
```

```bash
vsub config set --stt-provider openai-compatible --openai-compatible-stt-base-url http://localhost:8000/v1 --openai-compatible-stt-model whisper-1
vsub config set --openai-compatible-stt-key test-key-1234
```

The key is optional; without one, no `Authorization` header is sent. Keys are sent to the configured URL, so use `https://` outside local servers. Only the dedicated `VSUB_OPENAI_COMPATIBLE_STT_*` settings are read; `OPENAI_API_KEY` and `OPENAI_BASE_URL` are ignored. STT and LLM settings are independent. Override the model for one run with `--stt-model`.

The API must return `verbose_json` with segment or word timestamps. Requests run one at a time with a 300-second timeout and a 24 MB file limit; audio is split into chunks of up to 300 seconds. Recognition hints are sent in `prompt`.

## Choosing a Text Generation Provider

vsub selects the text generation provider (for translation, chapters, and summaries) in the following order of precedence:
1. `--llm-provider <gemini|openrouter|openai-compatible>` CLI option
2. `VSUB_LLM_PROVIDER` environment variable or `llmProvider` in the configuration file
3. Automatic selection based on configured keys:
   - If a Gemini key (`VSUB_GEMINI_API_KEY`, `GEMINI_API_KEY`, or saved key) exists → **Gemini**
   - Otherwise → **OpenRouter**

> [!NOTE]
> The generic `OPENROUTER_API_KEY` environment variable is only read when OpenRouter is explicitly selected (via option or setting), for the same reason as transcription (see [Choosing a Transcription Provider](#choosing-a-transcription-provider)).

### For Existing Gemini Users
Existing Gemini users can update `vsub-cli` and continue using Gemini directly without changing any settings; your existing translation, chapter, and summary caches remain fully valid.

### Models, Credits & Costs
* **Models**:
  - `--llm-model <model>` overrides the model for the chosen text generation provider.
  - `--gemini-model <model>` / `VSUB_GEMINI_MODEL` (config: `geminiModel`) sets the Gemini model (used only when the provider is Gemini).
  - `VSUB_OPENROUTER_LLM_MODEL` (config: `openrouterLlmModel`, default: `google/gemini-3.8-flash`) sets the default OpenRouter model.
  - `--llm-reasoning-effort <level>` / `VSUB_LLM_REASONING_EFFORT` (config: `llmReasoningEffort`) selects `minimal`, `low`, `medium`, or `high` (default: `low`). Priority is flag → environment → config → `low`; values ignore case and surrounding whitespace. This applies to OpenRouter and Gemini directly (Gemini 3 or newer) for translation, refinement, chapters, summaries, and automatic scene notes. Higher levels can be slower and more expensive (reasoning tokens are billed as output tokens), and do not guarantee better translations. Changing the level rebuilds text generation caches; `low` preserves existing caches. For openai-compatible, use the dedicated `VSUB_OPENAI_COMPATIBLE_LLM_REASONING_EFFORT` instead.
  - **The only tested OpenRouter model is `google/gemini-3.8-flash`**. While other models can be specified with `--llm-model`, they are untested and may fail if they do not support JSON schema structured outputs.
* **OpenRouter Credits & Concurrency**:
  - For each request, OpenRouter temporarily holds an amount corresponding to the maximum output tokens (`max_tokens: 16384`). If your account credit balance is insufficient, requests halt with a 402 Insufficient Credits error and instructions. Lowering `--concurrency` (default: 3) reduces the amount held simultaneously.
* **Cache Invalidation**:
  - Changing the provider or model creates fresh translations, chapters, and summaries; intermediate caches are reused only when the provider, model, and prompt match.

---

### OpenAI-compatible text generation (untested)

**Untested and not guaranteed to work:** this provider is for OpenAI-compatible APIs, such as local servers or a direct OpenAI connection. The author has not verified these endpoints. It is never selected automatically from API keys; select it explicitly with `--llm-provider openai-compatible`, `VSUB_LLM_PROVIDER=openai-compatible`, or `vsub config set --llm-provider openai-compatible`.

Set a base URL and model; neither has a default. Environment variables take priority over saved settings and can also be written in `.env`:

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

The key is optional; without one, no `Authorization` header is sent. Keys are sent to the configured URL, so use `https://` outside local servers. Only the dedicated `VSUB_OPENAI_COMPATIBLE_LLM_*` settings are read; `OPENAI_API_KEY` and `OPENAI_BASE_URL` are ignored. STT and LLM settings are independent. Override the model for one run with `--llm-model`.

The model must support strict JSON schema output through `response_format`. By default, requests omit both `max_tokens` and reasoning effort. Reasoning models can be slower and more expensive with the server's default reasoning effort; set `VSUB_OPENAI_COMPATIBLE_LLM_REASONING_EFFORT` (or `config set --openai-compatible-llm-reasoning-effort`) to send `reasoning_effort` and reduce it. Values such as `low` are passed through as-is, so use a value supported by your server and model; some servers reject unsupported values or fields. This setting has no effect on other providers (`gemini` or `openrouter`). Requests still omit `max_tokens` and nested `reasoning`, default to concurrency 1, and time out after 300 seconds. Existing `--concurrency`, `VSUB_CONCURRENCY` and saved concurrency settings still override this default.

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
Usage: vsub [options] [command] [media-file]

Arguments:
  media-file                    Target video or audio file path (.mp4, .mp3, .wav, .m4a, .mov, etc.)

Options:
  -l, --lang <lang>             UI display language: en (default), ja
  -t, --target-lang <langs>     Target language code(s), comma-separated (e.g., ja,en,es) (default: config or ja)
  -f, --format <formats>        Output formats: comma-separated list of srt, vtt, txt, json (default: "srt")
  -o, --output <path>           Output path or base name for the generated subtitle file(s) (or '-' for stdout); with --embed or --burn and a video path (e.g. out.mkv), subtitles are saved as out.<lang>.<format>
  --stdout                      Output subtitles directly to stdout instead of saving to file (default: false)
  -w, --overwrite               Overwrite existing output files without confirmation prompt (default: false)
  --backup                      Create backup (.bak) of existing output files before overwriting (default: false)
  -b, --bilingual               Generate bilingual subtitles combining original and translated text (default: false)
  --bilingual-order <order>     Order of bilingual subtitles: original-first (default) or target-first (default: "original-first")
  --ffmpeg-path <path>          Path to ffmpeg executable (searches VSUB_FFMPEG_PATH or PATH if omitted)
  --stt-provider <provider>     Transcription provider: openrouter, groq, or openai-compatible (default: VSUB_STT_PROVIDER, config, or chosen from your API keys)
  --stt-model <model>           Transcription model for the chosen provider (default: elevenlabs/scribe-v2 on OpenRouter, whisper-large-v3-turbo on Groq, the configured model on openai-compatible)
  --groq-model <model>          Groq Whisper model to use for transcription (used only when the provider is groq)
  --whisper-prompt <text>       Prompt hint for Groq Whisper speech recognition (Groq and openai-compatible; not sent to OpenRouter)
  --prompt <instruction>        Additional instruction prompt for translation
  --context <text-or-path>      Background notes about the speakers, their relationships, and the setting, as text or a text file path (passed to translation and --refine as context, not as instructions)
  --auto-context                Have the text generation model write short scene notes (speakers, relationships, politeness) from the whole transcript and pass them to translation, once per target language (default: VSUB_AUTO_CONTEXT, config, or off; ignored when --context is given)
  --no-auto-context             Do not write scene notes, even if VSUB_AUTO_CONTEXT or the config turns them on
  --glossary <path-or-terms>    Glossary file path (JSON) or inline terms (Key=Val,Key=Val)
  --concurrency <number>        Number of concurrent translation requests (default: 3)
  --gemini-model <model>        Gemini model to use for translation (Gemini provider only)
  --llm-provider <provider>     Text generation provider for translation, chapters and summaries: gemini, openrouter, or openai-compatible (default: VSUB_LLM_PROVIDER, config, or chosen from your API keys)
  --llm-model <model>           Model for the chosen text generation provider (default: gemini-3.8-flash on Gemini, google/gemini-3.8-flash on OpenRouter, the configured model on openai-compatible)
  --llm-reasoning-effort <level> Reasoning effort for OpenRouter and Gemini 3+: minimal, low, medium, high (default: VSUB_LLM_REASONING_EFFORT, config, or low)
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
  --refine                      Correct speech recognition errors in the transcript with the text generation model before translation (default: VSUB_REFINE, config, or off; uses --glossary, --prompt, and --context; timing and line count are kept)
  --no-refine                   Do not refine the transcript, even if VSUB_REFINE or the config turns it on
  --diarize                     Ask OpenRouter's elevenlabs/scribe models for speaker labels and pass them to translation; subtitles are also cut where the speaker changes (default: VSUB_DIARIZE, config, or off)
  --no-diarize                  Do not ask for speaker labels, even if VSUB_DIARIZE or the config turns them on
  --force-translate             Force translation even if detected language matches target language (default: false)
  --no-update-check             Disable checking for new version updates (default: false)
  --verbose                     Output detailed log messages (API requests, etc.) (default: false)
  -h, --help                    Display help for command

Commands:
  batch <targets...>            Process multiple media files in bulk (directories, multiple files, or glob patterns)
  translate <subtitle-file>     Directly translate an existing subtitle file (.srt) into target language(s) via Gemini or OpenRouter
  burn <video-file> <sub-file>  Burn an existing subtitle file (.srt) directly into a video file via FFmpeg (hardsub)
  embed <video> <sub-files...>  Embed one or more subtitle files (.srt) as soft subtitle tracks into a video via FFmpeg stream copy
  chapters <file>               Generate video chapters (table of contents) from media or subtitle files via Gemini or OpenRouter
  summarize <file>              Generate structured summary and key topic highlights from media or subtitle files via Gemini or OpenRouter
  init                          Interactive setup wizard to choose the transcription and text generation providers and verify API keys, FFmpeg, and preferences
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

`vsub batch` accepts `--auto-context` and `--no-auto-context` with the same behavior as the main command.

### 4. Direct Subtitle Translation (`vsub translate`)
Translate an existing `.srt` file without needing media files or transcription APIs:
```bash
vsub translate sample.ja.srt -t en -f srt,vtt
```

`vsub translate` also accepts `--context <text-or-path>` (background notes about the speakers and the setting; see [Background Notes about Speakers and the Setting](#background-notes-about-speakers-and-the-setting)).
It also accepts `--auto-context` and `--no-auto-context` to enable or disable automatic scene notes.

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

# Disable automatic segment splitting to keep the segment boundaries from transcription
vsub video.mp4 -t ja --no-reflow

# Adjust preceding context lines carried across 50-line translation chunks (default: 5, 0 to disable)
vsub video.mp4 -t ja --context-window 8
```

### 8. Using Glossaries & Custom Prompts
Glossaries can also be used with `vsub chapters` and `vsub summarize`.

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
> When transcribing with Groq Whisper (or the openai-compatible provider), source terms from `--glossary` (`Large Language Model, Agentic AI`) are automatically passed to Whisper as recognition hints even when `--whisper-prompt` is omitted, improving speech recognition accuracy as well (they are not sent to OpenRouter).

#### Custom Translation Tone & Instructions
```bash
vsub video.mp4 -t ja --prompt "Translate in a polite and professional tone suited for software engineers. Keep subtitles concise."
```

#### Background Notes about Speakers and the Setting
```bash
vsub talk.mp4 -t ja --context ./cast.txt
```

Example `cast.txt`:
```text
Alex is the shop manager; Sam is a new part-time employee.
Sam speaks politely to Alex. Alex calls Sam by their first name.
```

Use `--prompt` for translation instructions and `--context` for background about the speakers, their relationships, and the setting; these notes are passed as context only, not as instructions. Keep the notes short; an existing file is read as UTF-8, otherwise the value is used as inline text. This is separate from `--context-window`, which controls how many preceding subtitle lines are supplied to each translation chunk.

#### Automatic Scene Notes (`--auto-context`)

This is opt-in for the main command, `batch`, and `translate`: use `--auto-context`, `VSUB_AUTO_CONTEXT=true`, or `vsub config set --auto-context true`. `--no-auto-context` overrides the environment and config for one run. Priority is CLI → environment → config → off.

The translation model writes short background notes about speakers, relationships, and politeness from the whole transcript (up to the first 60,000 characters, keeping whole lines). It writes three sets of notes at the same time, each also listing how politely each speaker talks to each other person, and uses the set that agrees with the majority for each pair, so a single set that gets the direction wrong is outvoted. This adds three small text generation requests per target language (usually a small fraction of the translation cost); the chosen notes are cached and passed to each translation chunk. When `--context` is given, your notes take priority and automatic notes are skipped. Notes can be wrong and can make the translation consistently use the wrong tone. Inspect them with `--verbose`; correct them and pass them through `--context` if needed. They are not used by `--refine`, `chapters`, or `summarize`.

```bash
vsub talk.mp4 -t ja --auto-context --verbose
```

#### Speaker Labels (`--diarize`)

Speaker detection is opt-in: use `--diarize` (main command and `vsub batch`), `VSUB_DIARIZE=true`, or `vsub config set --diarize true`; `--no-diarize` turns it off for one run. Priority is `--diarize` / `--no-diarize` → environment → config → off. Only OpenRouter's `elevenlabs/scribe` models receive the request; other OpenRouter models show a warning when transcribing, while Groq and `openai-compatible` continue without speaker labels.

Subtitles also split where the speaker changes, and the labels are passed to translation to show who is speaking. Labels alone do not say how the speakers relate to each other, so for politeness and forms of address, background notes (`--context` or `--auto-context`) matter more. Labels are never written to SRT, VTT, TXT, or JSON subtitle files. `--refine` preserves labels for translation without including them in its prompt. Automatic detection can be wrong.

Audio longer than five minutes is sent in five-minute parts. With multiple parts, labels include the part number, such as `2/speaker_0`; `1/speaker_0` and `2/speaker_0` may be different people. With one part, labels remain `speaker_0`. Combine labels with background notes when you know who is speaking:

```bash
vsub talk.mp4 -t ja --diarize --context "speaker_0 is Alex, the store manager. speaker_1 is Sam, a new part-timer who speaks politely to Alex."
```

Changing `--diarize` invalidates the transcription cache. `chapters` and `summarize` accept the same flags to share the main command's transcription cache; their prompts do not use speaker labels.

### 9. AI Chapters & Video Summary (`vsub chapters` & `vsub summarize`)
Generate YouTube chapters or structured Markdown summaries from any video, audio, or existing `.srt` file. Chapters and summaries are written in one language: if several target languages are given (for example, with `vsub config set --target-lang ja,en`), only the first one is used. When the media has already been processed by `vsub`, it automatically reuses the transcription cache and finishes in seconds:
```bash
# Generate YouTube-compatible chapters (00:00 Title format, saved to [name].chapters.txt)
vsub chapters video.mp4 -t ja
vsub chapters video.mp4 -t ja --glossary ./glossary.json
vsub chapters subtitle.srt -f json  # Output as structured JSON array

# Generate structured executive summary (Markdown by default, saved to [name].summary.md)
vsub summarize video.mp4 -t ja
vsub summarize interview.srt -f txt # Output plain text summary
```

`--glossary` (or, when omitted, `VSUB_GLOSSARY` or the glossary saved with `vsub config set --glossary`) also controls names and terms in chapter titles and summaries, using the output language's glossary entries. On Groq it also supplies recognition hints, so use the same `--glossary` as the main command to reuse its transcription cache.

### 10. Standard Output Streaming & UNIX Pipe Integration (`--stdout` / `-o -`)
Stream subtitles, transcripts, chapters, or summaries directly to `stdout` without writing files to disk (progress spinners and `--verbose` logs are routed to `stderr` so piped data stays clean):
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

### 12. Transcript refinement (`--refine`)
Run an LLM proofreading pass on the assembled transcript before `--save-original` and translation (`vsub` main command and `vsub batch`; off by default):
```bash
# Refine recognized terms with a glossary before translating to Japanese
vsub video.mp4 -t ja --glossary ./glossary.json --refine

# Refine only and output the corrected source transcript (no translation)
vsub video.mp4 --no-translate --refine
```
* **What it fixes**: Corrects clear ASR recognition errors such as homophones / wrong kanji, misheard proper nouns and technical terms, and split or merged words.
* **Provider & model**: Uses your configured text generation provider and model (`--llm-provider`, `--llm-model`, `--gemini-model`).
* **Enable by default**: Use `vsub config set --refine true` or `VSUB_REFINE=true`; use `--no-refine` to turn it off for one run. Priority is `--refine`/`--no-refine` → `VSUB_REFINE` → the config file. This applies only to the main command and `vsub batch`.
* **Glossary & notes**: Works best when paired with `--glossary` (improvements are much smaller without one). Your `--prompt` notes and `--context` background notes are also passed as background context, and when using a language-keyed glossary file, the table for the first target language is used to supply the correct spellings of terms.
* **Timing & structure guarantees**: Subtitle timestamps, entry IDs, and line counts are never changed. If the model's answer does not match the input lines for any 50-line chunk, vsub keeps the original text for that chunk and prints a warning.
* **Limitations**: **Speech completely dropped during transcription will not be recovered, and subtitle timing will not be adjusted.**
* **Downstream outputs**: The refined transcript becomes the source text used for `--save-original`, `--bilingual`, `--no-translate`, and translation.
* **Cost & caching**: Expect one extra pass of the full transcript through the text generation model (slightly less than translating one target language). Enabling `--refine` for the first time also changes the source subtitles, so existing translations are re-run against the refined text. The unrefined transcript stays cached separately, so turning `--refine` off later does not re-transcribe (translations are run again from the unrefined text).

---

## Global Configuration Commands (`vsub config`)

```bash
# Show current configuration (API keys are masked)
vsub config show

# Save persistent defaults (display language, target language, prompts, glossary, concurrency, reflow length, transcript refinement, burn style)
vsub config set --lang ja --prompt "Translate politely" --glossary "./glossary.json" --concurrency 4
vsub config set --target-lang ja,en
vsub config set --refine true
vsub config set --diarize true
vsub config set --max-length 32 --burn-position bottom --burn-font-size medium
vsub config set --stt-provider openrouter --openrouter-key "your_openrouter_key"
vsub config set --llm-provider openrouter
vsub config set --llm-reasoning-effort medium
vsub config set --stt-provider openai-compatible --openai-compatible-stt-base-url http://localhost:8000/v1 --openai-compatible-stt-model whisper-1

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
