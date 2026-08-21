# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

## 1.0.0 (Initial Release)

🎉 **First official release of vsub-cli!**

A fast and powerful CLI tool to extract audio, transcribe speech with Groq Whisper, and translate subtitles using Google Gemini API.

### Key Features

* **Audio Extraction & Optimization**: Extract and normalize audio streams from video (`.mp4`, `.mkv`, `.webm`, `.mov`, etc.) and audio files (`.mp3`, `.wav`, `.m4a`, `.flac`, etc.) using FFmpeg.
* **Fast Speech-to-Text**: High-speed transcription powered by Groq Whisper API, supporting automatic audio splitting with millisecond-accurate timestamp sync for long media.
* **AI-Powered Subtitle Translation**: High-accuracy contextual subtitle translation using Google Gemini API (`gemini-3.7-flash` default) with multi-worker concurrent chunk processing.
* **Multi-Language Batch Translation**: Translate subtitles into multiple target languages simultaneously with a single command (e.g. `-t ja,en,zh`).
* **Multi-Format Output**: Output subtitles in `.srt`, `.vtt` (WebVTT), `.txt` (plain transcript), and `.json` (structured entries).
* **Glossary & Custom Prompts**: Enforce consistent terminology and style through inline glossaries, JSON glossary files, Whisper hints, and custom Gemini translation prompts.
* **Direct SRT Translation**: Dedicated `vsub translate` subcommand to translate existing SRT files directly without re-processing media.
* **Video Hardsub / Burn-in**: Dedicated `vsub burn` subcommand and `--burn` flag to render subtitles directly into MP4 videos via FFmpeg.
* **Intelligent Caching**: Automatic caching and resume capability (`vsub cache`) to eliminate redundant Whisper and Gemini API calls.
* **Safety & Overwrite Protection**: Pre-execution collision check, interactive confirmation, and automatic `.bak` backups (`--backup`, `-w`).
* **Persistent Configuration**: Global CLI settings (`vsub config set/show/get/delete`) for API keys, models, and default concurrency.
* **Rich CLI UX**: Real-time spinner indicators, detailed error handling, and end-of-run execution summary tables.
