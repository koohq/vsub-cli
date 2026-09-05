export const en = {
  common: {
    success: "Success",
    failed: "Failed",
    skipped: "Skipped",
    error: "Error",
    warning: "Warning",
    lines: (count: number) => `${count} lines`,
    files: (count: number) => `${count} files`,
    segments: (count: number) => `${count} segments`,
    terms: (count: number) => `${count} terms`,
  },
  summary: {
    title: "  vsub-cli Processing Summary  ",
    targetAudio: "Target Audio",
    targetSubtitle: "Target Subtitle",
    targetVideo: "Target Video",
    targetFile: "Target File",
    audioActionOptimize: "Audio Optimize",
    audioActionExtract: "Audio Extract",
    duration: "Duration",
    transcription: "Transcription",
    cacheHitBadge: " [Cached ⚡]",
    cachedBadge: "Cached ⚡",
    whisperPrompt: "Whisper Hint",
    detectedLanguage: "Detected Lang",
    outputLanguages: "Output Lang",
    skippedBadge: " (skipped)",
    cachedLangBadge: " (cached)",
    translationModel: "Trans Model",
    subtitleMode: "Subtitle Mode",
    bilingual: "Bilingual",
    bilingualTargetFirst: " (Target ➔ Original)",
    bilingualOriginalFirst: " (Original ➔ Target)",
    glossary: "Glossary",
    glossaryApplied: (count: number) => `${count} terms applied`,
    prompt: "Trans Prompt",
    subtitleLines: "Subtitle Lines",
    linesValue: (count: number) => `${count} lines`,
    backupsHeader: "Backups:",
    outputFilesHeader: "Output Files:",
    segmentsValue: (count: number, sizeStr: string) => `${count} segments${sizeStr}`,
  },
  batchSummary: {
    title: "  vsub-cli Batch Processing Summary  ",
    targetFiles: "Target Files",
    targetFilesValue: (count: number) => `${count} files`,
    results: "Results",
    successCount: (count: number) => `Success: ${count}`,
    failedCount: (count: number) => `Failed: ${count}`,
    skippedCount: (count: number) => `Skipped: ${count}`,
    totalDuration: "Total Time",
    fileDetailsHeader: "Details by File:",
    lineCountBadge: (count: number) => ` [${count} lines]`,
    errorPrefix: "└─ Error:",
    skippedBadge: "(skipped)",
  },
  pipeline: {
    startProcessing: (name: string) => `vsub-cli - Processing started: ${name}`,
    mediaNotFound: (path: string) => `Media file not found: ${path}`,
    conflictAbort:
      "Processing aborted due to existing file conflict. (Use --overwrite or --backup)",
    backupCreated: (original: string, backup: string) => `Created backup: ${original} -> ${backup}`,
    cannotBurnAudio:
      "Cannot burn subtitles into audio files. The --burn option is only available for video files (.mp4, .mkv, .mov, etc.).",
    invalidBilingualOrder: (input: string) =>
      `Unsupported bilingual order: "${input}". Available orders: "original-first", "target-first"`,
    step1SkipCache:
      "🔊 [1/4] Audio extraction skipped because transcription cache exists [⚡ Cached]",
    step2UseCached: (lang: string, count: number) =>
      `🎙️ [2/4] Using cached transcription${lang} - ${count} lines [⚡ Cached]`,
    step1Optimizing: "🔊 [1/4] Optimizing audio (16kHz mono / low bitrate)...",
    step1Extracting: "🔊 [1/4] Extracting audio (16kHz mono / low bitrate)...",
    step1AudioOptimized: (count: number, size: string) =>
      `🔊 [1/4] Audio optimization complete (${count} segments / ${size})`,
    step1AudioExtracted: (count: number, size: string) =>
      `🔊 [1/4] Audio extraction complete (${count} segments / ${size})`,
    step2Transcribing: (model: string, current?: number, total?: number) =>
      current && total && total > 1
        ? `🎙️ [2/4] Transcribing via Groq (${model}) [${current}/${total}]...`
        : `🎙️ [2/4] Transcribing via Groq (${model})...`,
    step2NoEntries: "⚠️ [2/4] No valid subtitle entries detected from transcription result",
    step2Done: (lang: string, count: number) =>
      `🎙️ [2/4] Transcription complete${lang} - generated ${count} subtitle lines`,
    step3Cached: (lang: string, count: number) =>
      `  ✔ ${lang} translation (cached: ${count} lines)`,
    step3TranslatingMulti: (
      model: string,
      currentLangIdx: number,
      totalLangs: number,
      lang: string,
      currentChunk: number,
      totalChunks: number,
    ) =>
      `🌐 [3/4] Translating via Gemini (${model}) (${currentLangIdx}/${totalLangs} languages: ${lang} [${currentChunk}/${totalChunks} chunks])...`,
    step3TranslatingSingle: (
      model: string,
      lang: string,
      currentChunk: number,
      totalChunks: number,
    ) =>
      `🌐 [3/4] Translating into ${lang} via Gemini (${model}) [${currentChunk}/${totalChunks} chunks]...`,
    step3LangDone: (lang: string, count: number) =>
      `  ✔ ${lang} translation complete (${count} lines)`,
    step3AllDone: (langs: string, count: number) =>
      `🌐 [3/4] Gemini translation complete (${langs}) - ${count} lines`,
    step3SkippedSameLang: (detected: string, target: string) =>
      `🌐 [3/4] Skipped translation because detected language matches target language (${detected} -> ${target})`,
    step4Saving: "💾 [4/4] Saving subtitle files...",
    step4Saved: (formats: string) => `💾 [4/4] Subtitle files saved successfully (${formats})`,
    burnStarting: "🎬 Burning subtitles into video with FFmpeg (libx264)...",
    burnDone: "🎬 Subtitle burn-in complete",
    errorOccurred: (err: string) => `An error occurred during processing: ${err}`,
  },
  translate: {
    started: (name: string) => `vsub-cli translate - Subtitle translation started: ${name}`,
    step1Parsing: "📖 [1/3] Reading and parsing subtitle file...",
    step1Parsed: (count: number) => `📖 [1/3] Subtitle file parsed - detected ${count} entries`,
    step1NoEntries: (name: string) =>
      `Failed to read entries from subtitle file (ensure it is in SRT format): ${name}`,
    step2TranslatingMulti: (
      model: string,
      currentLangIdx: number,
      totalLangs: number,
      lang: string,
      currentChunk: number,
      totalChunks: number,
    ) =>
      `🌐 [2/3] Translating via Gemini (${model}) (${currentLangIdx}/${totalLangs} languages: ${lang} [${currentChunk}/${totalChunks} chunks])...`,
    step2TranslatingSingle: (
      model: string,
      lang: string,
      currentChunk: number,
      totalChunks: number,
    ) =>
      `🌐 [2/3] Translating into ${lang} via Gemini (${model}) [${currentChunk}/${totalChunks} chunks]...`,
    step2Done: (langs: string, count: number) =>
      `🌐 [2/3] Gemini translation complete (${langs}) - ${count} lines`,
    step3Saving: "💾 [3/3] Saving subtitle files...",
    step3Saved: (formats: string) => `💾 [3/3] Subtitle files saved successfully (${formats})`,
    subtitleNotFound: (path: string) => `Subtitle file not found: ${path}`,
  },
  burn: {
    started: (video: string, sub: string) =>
      `vsub-cli burn - Subtitle burn-in started: ${video} + ${sub}`,
    videoNotFound: (path: string) => `Video file not found: ${path}`,
    notVideoFile: (name: string) => `Cannot burn subtitles into non-video format: ${name}`,
    subtitleNotFound: (path: string) => `Subtitle file not found: ${path}`,
  },
  batch: {
    noMediaFiles: (targets: string) =>
      `\n⚠️  No supported video or audio media files found.\n   Specified path(s): ${targets}\n`,
    started: (count: number) => `vsub-cli batch - Batch processing started (${count} files)`,
    processingItem: (file: string, dir: string) => `📁 Processing: ${file} (${dir})`,
    completedItem: (file: string) => `✔ Completed (${file})`,
    failedItem: (err: string) => `✖ Failed: ${err}`,
    failFastAbort: "⚠️  [--fail-fast] Aborting remaining batch jobs due to error.\n",
    fatalError: (err: string) => `Fatal error occurred during batch processing: ${err}`,
  },
  safety: {
    existingFilesWarning: "The following output file(s) already exist:",
    promptOverwrite: "Overwrite and continue? (y/N): ",
    aborted: "⚠️  Processing aborted. (You can re-run with --overwrite or --backup)",
    nonInteractiveError:
      "Existing target file(s) detected. Please specify --overwrite or --backup to proceed in non-interactive environment.",
  },
  init: {
    bannerTitle: "🎬 vsub-cli Initial Setup & Verification Wizard",
    configLocation: (path: string) => `Config file location: ${path}`,
    description1:
      "This wizard verifies API keys and FFmpeg connectivity, then configures preferences.",
    description2: "Press Enter to keep current or bracketed values.",
    step1Title: "▶ [1/4] Groq API Key Setup (for Speech Recognition)",
    step1Url: (url: string) => `  Get API key at: ${url}`,
    currentSetting: (val: string) => `  Current: ${val}`,
    promptGroqCurrent: "  Enter Groq API Key (Enter to keep current): ",
    promptGroqNew: "  Enter Groq API Key (Enter to skip): ",
    skippedGroq: "  ⚠️  Groq API key skipped (can be configured later).\n",
    testingGroq: "  ⏳ Testing Groq API connection...",
    groqSuccess: (count: string | number) =>
      `  ✔ Groq API connection successful (${count} models available)`,
    groqFailed: (err: string) => `  ✖ Groq API connection failed: ${err}`,
    retryPrompt: "  Retry? [Y/n/s (s=save anyway)]: ",
    savedUnverified: "  ⚠️  Saved key without verification.\n",
    step2Title: "▶ [2/4] Google Gemini API Key Setup (for Translation)",
    step2Url: (url: string) => `  Get API key at: ${url}`,
    promptGeminiCurrent: "  Enter Gemini API Key (Enter to keep current): ",
    promptGeminiNew: "  Enter Gemini API Key (Enter to skip): ",
    skippedGemini: "  ⚠️  Gemini API key skipped (can be configured later).\n",
    testingGemini: "  ⏳ Testing Gemini API connection...",
    geminiSuccess: (model: string) => `  ✔ Gemini API connection successful (model: ${model})`,
    geminiFailed: (err: string) => `  ✖ Gemini API connection failed: ${err}`,
    step3Title: "▶ [3/4] FFmpeg Verification (for Audio Extraction & Burn-in)",
    testingFfmpeg: "  ⏳ Checking FFmpeg executable...",
    ffmpegSuccess: (version: string) => `  ✔ FFmpeg detected: ${version}`,
    ffmpegFailed: (err: string) => `  ✖ FFmpeg not found or failed: ${err}`,
    promptFfmpegPath: "  Enter FFmpeg path (or Enter to keep/skip): ",
    step4Title: "▶ [4/4] Default Preferences",
    promptDisplayLang: "  CLI Display Language [en] (en/ja, Enter to keep current): ",
    promptTargetLang: "  Default Target Subtitle Language [ja]: ",
    configSaved: (path: string) =>
      `\n🎉 Setup completed successfully!\nSettings saved to: ${path}\n`,
    noApiKeyProvided: "API key not provided",
  },
  gemini: {
    modelRetiredDefault: (model: string) =>
      `Default Gemini model '${model}' not found or may be retired by Google.\n` +
      `  • Please update vsub-cli: npm install -g vsub-cli\n` +
      `  • Or specify an alternative model with --gemini-model (Models list: https://ai.google.dev/gemini-api/docs/models)`,
    modelNotFoundCustom: (model: string) =>
      `Specified Gemini model '${model}' was not found. Please check model name or API permissions.\n` +
      `  • Available models: https://ai.google.dev/gemini-api/docs/models`,
  },
  licenses: {
    bannerTitle: "                  vsub-cli Third-Party Software Licenses                  ",
    intro1:
      "This tool (standalone executables and npm package) bundles the following OSS libraries.",
    intro2: "Copyright notices and license terms for each library are listed below.",
    repository: "Repository:",
  },
};
