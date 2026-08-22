# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

## [1.1.2](https://github.com/koohq/vsub-cli/compare/vsub-cli-v1.1.1...vsub-cli-v1.1.2) (2026-08-22)


### Bug Fixes

* **build:** apply macOS ad-hoc code signature to final destination binary after copy and add CI binary verification matrix ([0a73315](https://github.com/koohq/vsub-cli/commit/0a7331586c14721cf2012d1e787cac0b29745699))
* **ci:** restore setup-env step in Typecheck & Build job ([50c0cf3](https://github.com/koohq/vsub-cli/commit/50c0cf3193ae2c5dc1b35aa582a86a45b0f13f33))
* **ci:** scope macOS binary builds to Apple Silicon arm64 ([5258656](https://github.com/koohq/vsub-cli/commit/5258656be0c117771922e44ca70def26ecd6818e))

## [1.1.1](https://github.com/koohq/vsub-cli/compare/vsub-cli-v1.1.0...vsub-cli-v1.1.1) (2026-08-22)


### Bug Fixes

* **ci:** use verified commit SHAs for upload and download artifact actions ([5f689a1](https://github.com/koohq/vsub-cli/commit/5f689a154a168a75f1ae7de163b61143b9956d65))

## [1.1.0](https://github.com/koohq/vsub-cli/compare/vsub-cli-v1.0.0...vsub-cli-v1.1.0) (2026-08-22)


### Features

* add custom Gemini and Groq model options ([fe48f1f](https://github.com/koohq/vsub-cli/commit/fe48f1f947b4d6bc73eaad921e7fbe70b54651ae))
* add directory and batch bulk processing mode (vsub batch) ([174d6f3](https://github.com/koohq/vsub-cli/commit/174d6f394bf38032faf4b99f2c0677d99bbac3f5))
* add file overwrite prevention and backup safety mechanisms ([8ba5d7f](https://github.com/koohq/vsub-cli/commit/8ba5d7f456cb53eb9a97d2332da2981b8c5d1197))
* add Gemini API concurrency control for fast subtitle translation ([25d33b8](https://github.com/koohq/vsub-cli/commit/25d33b8d38eca960c48f2ec8028f46454f6a5b15))
* add GitHub Actions CI matrix and Dependabot auto-merge pipeline ([ce7e7d2](https://github.com/koohq/vsub-cli/commit/ce7e7d20463b042296f2fa19d2a03ee818b46d6c))
* add glossary and custom prompt specification support ([8c3867c](https://github.com/koohq/vsub-cli/commit/8c3867cbd93def7168241ace2c830e22fe494a4d))
* add interactive CLI configuration, translation control options, and Gemini/Groq integration modules ([68b0a80](https://github.com/koohq/vsub-cli/commit/68b0a80af724b52e0cfbde650a458052032f973a))
* add interactive setup and verification wizard (vsub init) ([3c943c0](https://github.com/koohq/vsub-cli/commit/3c943c05435bc32bb8e01e3f998c3bac56ce88e2))
* add local automated E2E smoke test and update Gemini default model ([25b88c4](https://github.com/koohq/vsub-cli/commit/25b88c4fdf5d5d57d1fc0bcb183ef9d4cb140fee))
* add multi-format output support (.vtt, .txt, .json) ([d578a7f](https://github.com/koohq/vsub-cli/commit/d578a7f6783b24354702b76064922b75c41a1d4b))
* add real-time progress spinners and execution summary box ([8272260](https://github.com/koohq/vsub-cli/commit/827226080f95db36dc9bd33e276039ee04d17e1e))
* add standalone binary distribution (Node.js SEA) and third-party license management ([32dc686](https://github.com/koohq/vsub-cli/commit/32dc686503b417ccb18256b1584296580cba4211))
* add test coverage measurement and reporting with vitest --coverage ([f3ca049](https://github.com/koohq/vsub-cli/commit/f3ca0494f34c01212f70d8d506ba3cb3b08f6c8d))
* add video subtitle burn-in support via FFmpeg subtitles filter ([48317a8](https://github.com/koohq/vsub-cli/commit/48317a81e056b3a9f4b3d2035004a28b0f9084bb))
* add vsub translate subcommand for direct subtitle translation ([4c2a1a5](https://github.com/koohq/vsub-cli/commit/4c2a1a595bbf66b8b905994a89f2e6bd7ff2b641))
* **ci:** add automated AI model watcher with deduplicated issue alerts ([ac67302](https://github.com/koohq/vsub-cli/commit/ac6730241fe4385f006b8655681288aebe1b120b))
* **ci:** enable workflow_dispatch trigger for manual execution ([d90e651](https://github.com/koohq/vsub-cli/commit/d90e6510981524feb4ef64fa2e6cd535e9edc2f5))
* implement automated quality gate hook for pre-termination verification ([1204f18](https://github.com/koohq/vsub-cli/commit/1204f185b440f0dd53b0a7dce8369fcac0fc8a74))
* implement CLI entry point and subtitle generation workflow using Commander, Groq, and Gemini ([1c7b09e](https://github.com/koohq/vsub-cli/commit/1c7b09ed9d1479944baa85805c62ca78915d528e))
* implement global configuration management and interactive API key setup ([50e0572](https://github.com/koohq/vsub-cli/commit/50e0572dbf2184e40c42af239d4d5c1f5ac30637))
* implement intermediate caching and resume mechanism for Groq and Gemini ([82f4778](https://github.com/koohq/vsub-cli/commit/82f47789afbc4c23d3725c222aa2836a698596dd))
* implement video-to-srt CLI with Groq transcription and Gemini translation support ([c7772a8](https://github.com/koohq/vsub-cli/commit/c7772a857c85f12055055debeb82ea4891453fdf))
* initialize project with README, PRD, and ignore configuration ([8a35349](https://github.com/koohq/vsub-cli/commit/8a353494c265e2b0baac19be345fb02141601ff1))
* initialize vsub-cli project with Groq transcription and Gemini translation capabilities ([98c9eed](https://github.com/koohq/vsub-cli/commit/98c9eed8ea40fc9b601b7ce9b00a6ad3b5c107e0))
* **release:** setup Release Please and npm publish pipeline ([5f62261](https://github.com/koohq/vsub-cli/commit/5f622611697e98d14cd17e8d469773a654461a18))
* setup token-saving final quality gate with stop hook and testing rules ([034eba6](https://github.com/koohq/vsub-cli/commit/034eba657bb7084f5a91bc594790aeac353697c1))
* **subtitles:** add bilingual dual-language subtitles mode (--bilingual, -b) ([99a971b](https://github.com/koohq/vsub-cli/commit/99a971b6290f3700bbbc4a15c13fb51444d04387))
* support direct audio file inputs (.mp3, .wav, etc.) ([571e303](https://github.com/koohq/vsub-cli/commit/571e3031a488e669974fdd1c62bebdfd0e4e2bac))
* support multi-language simultaneous subtitle translation (-t ja,en,zh) ([53ee2f5](https://github.com/koohq/vsub-cli/commit/53ee2f5014c3182342d7a02992b6af05776d837f))
* **transcription:** improve timecode accuracy for split audio using measured playback duration ([586cdfd](https://github.com/koohq/vsub-cli/commit/586cdfd09c2cc7a021a871e47aba514af3277a59))


### Bug Fixes

* **ci:** install ffmpeg in setup-env composite action for test jobs ([1bf84f6](https://github.com/koohq/vsub-cli/commit/1bf84f643afa36f7bcdc642c4e81266ade50bf93))
* **ci:** pin googleapis/release-please-action to full-length commit SHA ([afbae2f](https://github.com/koohq/vsub-cli/commit/afbae2f424bfff26f36ae57e53627f42b224bc81))
* **ci:** specify packageManager in package.json for pnpm action setup ([6b56482](https://github.com/koohq/vsub-cli/commit/6b56482c98148dda9cf85b6251fd5637b10db89d))
* **ci:** sync known AI models strictly with current live API endpoints ([4b24edd](https://github.com/koohq/vsub-cli/commit/4b24eddc37611d4ea99fa9a3d48fa3b87032e4ff))
* **ci:** update macOS Intel runner to macos-15-intel and upgrade artifact actions to v7.0.0 ([dd69160](https://github.com/koohq/vsub-cli/commit/dd69160e4bffc466d4a6cc677c571276e429bce2))
* **ci:** use googleapis/release-please-action@v4 and align package metadata ([ded5386](https://github.com/koohq/vsub-cli/commit/ded5386bef20f097e7c4783362288ec49454b2bb))
* **init:** resolve biome noNonNullAssertion warning in init wizard ([9439715](https://github.com/koohq/vsub-cli/commit/9439715b655b2f25ede7a2af9804e681b3edd681))
* make resolveFfprobePath platform-agnostic across POSIX and Windows paths ([490ac93](https://github.com/koohq/vsub-cli/commit/490ac93627271863048dd49d07eaa70cb5cc56ab))

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
