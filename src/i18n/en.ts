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
    translationSaved: (lang: string, saved: number, total: number) =>
      `ℹ️ Saved ${saved}/${total} chunks of the ${lang} translation. Run the same command again to continue from there.`,
    translationResuming: (lang: string, saved: number, total: number) =>
      `  ↻ ${lang}: resuming from the cache (${saved} of ${total} chunks already saved)`,
    startProcessing: (name: string) => `vsub-cli - Processing started: ${name}`,
    mediaNotFound: (path: string) => `Media file not found: ${path}`,
    conflictAbort:
      "Processing aborted due to existing file conflict. (Use --overwrite or --backup)",
    backupCreated: (original: string, backup: string) => `Created backup: ${original} -> ${backup}`,
    cannotBurnAudio:
      "Cannot burn subtitles into audio files. The --burn option is only available for video files (.mp4, .mkv, .mov, etc.).",
    invalidBilingualOrder: (input: string) =>
      `Unsupported bilingual order: "${input}". Available orders: "original-first", "target-first"`,
    unsupportedFormat: (token: string, supported: string) =>
      `Unsupported output format: "${token}". Available formats: ${supported}`,
    invalidTargetLang: (token: string) =>
      `Invalid target language code: "${token}". Valid examples: "ja", "en", "zh", "zh-CN", "pt-BR"`,
    invalidSttProvider: (provider: string) =>
      `Unsupported transcription provider: "${provider}". Supported: openrouter, groq`,
    invalidLlmProvider: (provider: string) =>
      `Unsupported text generation provider: "${provider}". Supported: gemini, openrouter`,
    sttGroqAutoHint:
      "💡 Transcribing with Groq because VSUB_OPENROUTER_API_KEY is not set. The default is now OpenRouter (elevenlabs/scribe-v2). To keep Groq and hide this tip, set VSUB_STT_PROVIDER=groq.",
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
    step2Transcribing: (provider: string, model: string, current?: number, total?: number) =>
      current && total && total > 1
        ? `🎙️ [2/4] Transcribing via ${provider} (${model}) [${current}/${total}]...`
        : `🎙️ [2/4] Transcribing via ${provider} (${model})...`,
    step2NoEntries: "⚠️ [2/4] No valid subtitle entries detected from transcription result",
    step2Done: (lang: string, count: number) =>
      `🎙️ [2/4] Transcription complete${lang} - generated ${count} subtitle lines`,
    step2Refining: (provider: string, model: string, current: number, total: number) =>
      `✍️ [2/4] Refining transcript via ${provider} (${model}) [${current}/${total} chunks]...`,
    step2Refined: (changed: number, total: number, cached = false) =>
      `✍️ [2/4] Transcript refined - ${changed}/${total} lines changed${cached ? " [⚡ Cached]" : ""}`,
    step2RefineFallbackWarn: (fallbackChunks: number, totalChunks: number) =>
      `⚠️ [2/4] Refinement kept the original text for ${fallbackChunks}/${totalChunks} chunks (the model's answer did not match the input lines)`,
    step3Cached: (lang: string, count: number) =>
      `  ✔ ${lang} translation (cached: ${count} lines)`,
    step3TranslatingMulti: (
      provider: string,
      model: string,
      currentLangIdx: number,
      totalLangs: number,
      lang: string,
      currentChunk: number,
      totalChunks: number,
    ) =>
      `🌐 [3/4] Translating via ${provider} (${model}) (${currentLangIdx}/${totalLangs} languages: ${lang} [${currentChunk}/${totalChunks} chunks])...`,
    step3TranslatingSingle: (
      provider: string,
      model: string,
      lang: string,
      currentChunk: number,
      totalChunks: number,
    ) =>
      `🌐 [3/4] Translating into ${lang} via ${provider} (${model}) [${currentChunk}/${totalChunks} chunks]...`,
    step3LangDone: (lang: string, count: number) =>
      `  ✔ ${lang} translation complete (${count} lines)`,
    step3AllDone: (provider: string, langs: string, count: number, cached = false) =>
      `🌐 [3/4] ${provider} translation complete (${langs}) - ${count} lines${cached ? " [⚡ Cached]" : ""}`,
    step3SkippedSameLang: (detected: string, target: string) =>
      `🌐 [3/4] Skipped translation because detected language matches target language (${detected} -> ${target})`,
    step4Saving: "💾 [4/4] Saving subtitle files...",
    step4Saved: (formats: string) => `💾 [4/4] Subtitle files saved successfully (${formats})`,
    burnStarting: "🎬 Burning subtitles into video with FFmpeg (libx264)...",
    burnDone: "🎬 Subtitle burn-in complete",
    embedStarting: "🎬 Embedding soft subtitle tracks into video with FFmpeg...",
    embedDone: "🎬 Subtitle tracks embedded into video successfully",
    cannotEmbedAudio: "Cannot embed subtitles into an audio file",
    embedUnsupportedContainer: (file: string, ext: string, supported: string) =>
      `Cannot embed subtitle tracks into "${file}": the ${ext} container does not support soft subtitles (supported: ${supported}). Generate the subtitles without --embed, then run "vsub embed <video> <subtitle-file> -o <name>.mkv".`,
    outputPathConflict: (file: string) =>
      `Cannot write "${file}": the path is the input media file or is also used by another output. Specify a different path with -o.`,
    stdoutSingleFormatOnly:
      "Cannot specify multiple formats with --stdout. Please specify a single format (e.g. -f srt).",
    stdoutSingleLangOnly:
      "Cannot specify multiple target languages with --stdout. Please specify a single language.",
    stdoutCannotBurn: "Cannot use --burn with --stdout.",
    stdoutCannotEmbed: "Cannot use --embed with --stdout.",
    savedOriginal: (files: string) => `📄 Saved original subtitles: ${files}`,
    skippedOriginal: (files: string) => `📄 Skipped saving original subtitles: ${files}`,
    keptAudio: (files: string) => `[--keep-audio] Kept intermediate audio file(s): ${files}`,
    errorOccurred: (err: string) => `An error occurred during processing: ${err}`,
  },

  translate: {
    started: (name: string) => `vsub-cli translate - Subtitle translation started: ${name}`,
    step1Parsing: "📖 [1/3] Reading and parsing subtitle file...",
    step1Parsed: (count: number) => `📖 [1/3] Subtitle file parsed - detected ${count} entries`,
    step1NoEntries: (name: string) =>
      `Failed to read entries from subtitle file (ensure it is in SRT format): ${name}`,
    step2TranslatingMulti: (
      provider: string,
      model: string,
      currentLangIdx: number,
      totalLangs: number,
      lang: string,
      currentChunk: number,
      totalChunks: number,
    ) =>
      `🌐 [2/3] Translating via ${provider} (${model}) (${currentLangIdx}/${totalLangs} languages: ${lang} [${currentChunk}/${totalChunks} chunks])...`,
    step2TranslatingSingle: (
      provider: string,
      model: string,
      lang: string,
      currentChunk: number,
      totalChunks: number,
    ) =>
      `🌐 [2/3] Translating into ${lang} via ${provider} (${model}) [${currentChunk}/${totalChunks} chunks]...`,
    step2Done: (provider: string, langs: string, count: number, cached = false) =>
      `🌐 [2/3] ${provider} translation complete (${langs}) - ${count} lines${cached ? " [⚡ Cached]" : ""}`,
    step3Saving: "💾 [3/3] Saving subtitle files...",
    step3Saved: (formats: string) => `💾 [3/3] Subtitle files saved successfully (${formats})`,
    stdoutSingleFormatOnly:
      "Cannot specify multiple formats with --stdout. Please specify a single format (e.g. -f srt).",
    stdoutSingleLangOnly:
      "Cannot specify multiple target languages with --stdout. Please specify a single language.",
    subtitleNotFound: (path: string) => `Subtitle file not found: ${path}`,
  },
  chapters: {
    unsupportedFormat: (input: string, supported: string) =>
      `Unsupported chapters format: "${input}". Supported formats: ${supported}`,
    started: (file: string) => `vsub-cli chapters - Generating chapters: ${file}`,
    singleTargetLang: (used: string, requested: string) =>
      `Chapters are generated in one language only. Using "${used}", the first of "${requested}".`,
    step1Resolve: "Resolving transcript entries...",
    step1Parsed: (count: number) => `Parsed ${count} subtitle entries`,
    step2Generating: (provider: string, model: string, lang: string) =>
      `Generating chapters with ${provider} (${model}) [${lang}]...`,
    step2Done: (count: number) => `Generated ${count} chapters`,
    step2Cached: (count: number) => `Loaded ${count} chapters [⚡ Cached]`,
    tooFewChapters: (count: number) =>
      `Only ${count} chapters remain. YouTube shows chapters only when there are at least 3, each 10 seconds or longer.`,
    step3Saving: "Saving chapters file...",
    step3Saved: (path: string) => `Saved chapters to ${path}`,
    noEntries: "No subtitle entries found to generate chapters.",
  },
  summarize: {
    unsupportedFormat: (input: string, supported: string) =>
      `Unsupported summary format: "${input}". Supported formats: ${supported}`,
    started: (file: string) => `vsub-cli summarize - Generating summary: ${file}`,
    singleTargetLang: (used: string, requested: string) =>
      `Summaries are generated in one language only. Using "${used}", the first of "${requested}".`,
    step1Resolve: "Resolving transcript entries...",
    step1Parsed: (count: number) => `Parsed ${count} subtitle entries`,
    step2Generating: (provider: string, model: string, lang: string) =>
      `Generating summary with ${provider} (${model}) [${lang}]...`,
    step2Done: "Generated summary successfully",
    step2Cached: "Loaded summary [⚡ Cached]",
    step3Saving: "Saving summary file...",
    step3Saved: (path: string) => `Saved summary to ${path}`,
    noEntries: "No subtitle entries found to generate summary.",
  },
  burn: {
    started: (video: string, sub: string) =>
      `vsub-cli burn - Subtitle burn-in started: ${video} + ${sub}`,
    videoNotFound: (path: string) => `Video file not found: ${path}`,
    notVideoFile: (name: string) => `Cannot burn subtitles into non-video format: ${name}`,
    subtitleNotFound: (path: string) => `Subtitle file not found: ${path}`,
    invalidPosition: (pos: string) =>
      `Invalid subtitle burn position "${pos}". Valid positions are: bottom (default), top, center.`,
    invalidFontSize: (size: string) =>
      `Invalid subtitle font size "${size}". Must be small, medium, large, or a positive number.`,
  },
  embed: {
    started: (video: string, count: number) =>
      `vsub-cli embed - Soft subtitle embedding started: ${video} (${count} subtitle track(s))`,
    videoNotFound: (path: string) => `Video file not found: ${path}`,
    notVideoFile: (name: string) => `Cannot embed subtitles into non-video format: ${name}`,
    subtitleNotFound: (path: string) => `Subtitle file not found: ${path}`,
    noSubtitles: "At least one subtitle file is required to embed into video.",
    unsupportedContainer: (file: string, ext: string, supported: string) =>
      `Cannot embed subtitle tracks into "${file}": the ${ext || "(no extension)"} container does not support soft subtitles (supported: ${supported}). Specify an output file with a supported container, for example "-o <name>.mkv".`,
    stepEmbedding: "Embedding subtitle track(s) via FFmpeg stream copy...",
    stepSaved: (path: string) => `Embedded video saved successfully: ${path}`,
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
    notInteractive:
      "vsub init is interactive and must be run from a terminal (standard input is not a terminal). To configure without the wizard, use vsub config set (for example, vsub config set --openrouter-key <key>) or environment variables such as VSUB_OPENROUTER_API_KEY.",
    bannerTitle: "🎬 vsub-cli Initial Setup & Verification Wizard",
    configLocation: (path: string) => `Config file location: ${path}`,
    description1:
      "This wizard verifies API keys and FFmpeg connectivity, then configures preferences.",
    description2: "Press Enter to keep current or bracketed values.",
    step1Title: "▶ [1/4] Speech Recognition Provider & API Key",
    step1Url: (url: string) => `  Get API key at: ${url}`,
    currentSetting: (val: string) => `  Current: ${val}`,
    promptSttProvider: (current: string) =>
      `  Transcription provider (openrouter/groq) [${current}]: `,
    promptGroqCurrent: "  Enter Groq API Key (Enter to keep current): ",
    promptGroqNew: "  Enter Groq API Key (Enter to skip): ",
    skippedGroq: "  ⚠️  Groq API key skipped (can be configured later).\n",
    testingGroq: "  ⏳ Testing Groq API connection...",
    groqSuccess: (count?: number) =>
      `  ✔ Groq API connection successful${count === undefined ? "" : ` (${count} models available)`}`,
    groqFailed: (err: string) => `  ✖ Groq API connection failed: ${err}`,
    promptOpenRouterCurrent: "  Enter OpenRouter API Key (Enter to keep current): ",
    promptOpenRouterNew: "  Enter OpenRouter API Key (Enter to skip): ",
    skippedOpenRouter: "  ⚠️  OpenRouter API key skipped (can be configured later).\n",
    testingOpenRouter: "  ⏳ Testing OpenRouter API connection...",
    openrouterSuccess: "  ✔ OpenRouter API connection successful",
    openrouterFailed: (err: string) => `  ✖ OpenRouter API connection failed: ${err}`,
    openrouterEnvNotice:
      "  OPENROUTER_API_KEY is set in the environment; press Enter to use it (it is not saved to the config file).",
    retryPrompt: "  Retry? [Y/n/s (s=save anyway)]: ",
    savedUnverified: "  ⚠️  Saved key without verification.\n",
    usingEnvKeyUnverified:
      "  ⚠️  Using the key from the environment variable without verification (not saved to the config file).\n",
    step2Title:
      "▶ [2/4] Text Generation Provider & API Key (for Translation, Chapters and Summaries)",
    promptLlmProvider: (current: string) =>
      `  Text generation provider (gemini/openrouter) [${current}]: `,
    usingOpenRouterFromStep1: "  Using the OpenRouter API key from step 1.",
    step2Url: (url: string) => `  Get API key at: ${url}`,
    promptGeminiCurrent: "  Enter Gemini API Key (Enter to keep current): ",
    promptGeminiNew: "  Enter Gemini API Key (Enter to skip): ",
    skippedGemini: "  ⚠️  Gemini API key skipped (can be configured later).\n",
    testingGemini: "  ⏳ Testing Gemini API connection...",
    geminiSuccess: (model: string) => `  ✔ Gemini API connection successful (model: ${model})`,
    geminiFailed: (err: string) => `  ✖ Gemini API connection failed: ${err}`,
    step3Title: "▶ [3/4] FFmpeg Verification (for Audio Extraction & Burn-in)",
    testingFfmpeg: (path: string) => `  ⏳ Checking FFmpeg (${path})...`,
    ffmpegInstallHeader: "  ※ FFmpeg installation commands:",
    ffmpegInstallWindows: (a: string, b: string) => `     Windows : ${a} or ${b}`,
    ffmpegSuccess: (version: string) => `  ✔ FFmpeg detected: ${version}`,
    ffmpegFailed: (err: string) => `  ✖ FFmpeg not found or failed: ${err}`,
    promptFfmpegPath: "  Enter FFmpeg path (or Enter to keep/skip): ",
    step4Title: "▶ [4/4] Default Preferences",
    promptDisplayLang: (current: string) => `  CLI Display Language [${current}] (en/ja): `,
    promptTargetLang: (current: string) => `  Default Target Subtitle Language [${current}]: `,
    promptGeminiModel: (current: string) => `  Default Gemini Model [${current}]: `,
    promptGroqModel: (current: string) => `  Default Groq Whisper Model [${current}]: `,
    promptOpenRouterModel: (current: string) =>
      `  Default OpenRouter transcription model [${current}]: `,
    promptOpenRouterLlmModel: (current: string) =>
      `  Default OpenRouter text generation model [${current}]: `,
    configSaved: (path: string) =>
      `\n🎉 Setup completed successfully!\nSettings saved to: ${path}\n`,
    configNotSaved: "The settings you entered in this wizard were not saved.",
    noApiKeyProvided: "API key not provided",
    quickStartTitle: "🚀 Quick Start:",
    quickStartTranscribe: "Transcribe & generate subtitles",
    quickStartMultiLanguage: "Multi-language subtitle output",
    quickStartBilingual: "Bilingual subtitles",
    quickStartBurn: "Burn subtitles into video (hardsub)",
    quickStartBatch: "Batch process directory",
    quickStartHelp: "Display all options",
  },
  config: {
    pathLine: (path: string) => `Configuration file path: ${path}`,
    showHeader: (path: string) => `📁 Config File: ${path}`,
    showLabels: {
      lang: "Display Language",
      targetLang: "Target Language",
      groqApiKey: "Groq API Key",
      geminiApiKey: "Gemini API Key",
      openrouterApiKey: "OpenRouter API Key",
      transcription: "Transcription",
      textGeneration: "Text Generation",
      ffmpegPath: "FFmpeg Path",
      whisperPrompt: "Whisper Prompt",
      prompt: "Translate Prompt",
      glossary: "Glossary",
      geminiModel: "Gemini Model",
      groqModel: "Groq Model",
      openrouterSttModel: "OpenRouter STT Model",
      openrouterLlmModel: "OpenRouter LLM Model",
      concurrency: "Concurrency",
      maxLength: "Max Length",
      burnPosition: "Burn Position",
      burnFontSize: "Burn Font Size",
      updateCheck: "Update Check",
    },
    notConfigured: "(Not configured)",
    enabled: "Enabled",
    disabled: "Disabled",
    chars: (n: number) => `${n} chars`,
    invalidProvider: (provider: string) => `invalid provider "${provider}"`,
    setNothing:
      "⚠️ Please specify settings to save. (Example: vsub config set --gemini-model gemini-3.8-flash)",
    invalidDisplayLang: (value: string) =>
      `Invalid display language: "${value}". Supported languages: "en", "ja"`,
    setSaved: (path: string) => `✅ Configuration updated and saved: ${path}`,
    missingKeysHeader: "\n🔑 API keys missing. Starting interactive setup.",
    requiredKeysMissing: (items: string[]) =>
      `Required API key(s) are not configured:\n- ${items.join("\n- ")}\nPlease set them via interactive prompt, .env file, or environment variables.`,
    openRouterKeyHint:
      "VSUB_OPENROUTER_API_KEY (Get at: https://openrouter.ai/keys; the generic OPENROUTER_API_KEY is read only with --stt-provider openrouter, --llm-provider openrouter, VSUB_STT_PROVIDER=openrouter, or VSUB_LLM_PROVIDER=openrouter; Gemini keys VSUB_GEMINI_API_KEY / GEMINI_API_KEY can also be used for translation)",
    groqKeyHint: "VSUB_GROQ_API_KEY / GROQ_API_KEY (Get at: https://console.groq.com/)",
    geminiKeyHint: "VSUB_GEMINI_API_KEY / GEMINI_API_KEY (Get at: https://aistudio.google.com/)",
    missingKeysNote: "Note: Entered keys will be saved globally for future use at:",
    promptOpenRouterKey: "1. Enter OpenRouter API Key (https://openrouter.ai/keys): ",
    promptGroqKey: "1. Enter Groq API Key (https://console.groq.com/): ",
    promptGeminiKey: "2. Enter Gemini API Key (https://aistudio.google.com/): ",
    missingKeysSaved: "✅ Configuration saved successfully.\n",
    unreadableConfig: (path: string, reason: string) =>
      `The existing config file could not be read: ${path} (${reason}). Nothing was saved. Fix or delete the file, then run the command again.`,
    dirPermissionWarning: (dir: string, reason: string) =>
      `⚠️ Could not restrict the permissions of the config directory to 700: ${dir} (${reason}). The config file itself is still written with mode 600.`,
  },
  cache: {
    pathLine: (dir: string) => `Cache directory: ${dir}`,
    statsHeader: (dir: string) => `📁 Cache Directory: ${dir}`,
    statsLabels: { count: "Cached Files", totalSize: "Total Size" },
    files: (n: number) => `${n} files`,
    cleaned: (n: number, size: string, dir: string) =>
      `✅ Cleared ${n} cache files (${size} freed) from: ${dir}`,
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
  openrouter: {
    modelRetiredDefault: (model: string) =>
      `Default OpenRouter model '${model}' not found.\n` +
      `  • Please update vsub-cli or check available models at https://openrouter.ai/models\n` +
      `  • Or specify an alternative model with --llm-model`,
    modelNotFoundCustom: (model: string) =>
      `Specified OpenRouter model '${model}' was not found. Please check model name or API permissions.\n` +
      `  • Available models: https://openrouter.ai/models\n` +
      `  • Or specify an alternative model with --llm-model`,
    insufficientCredits:
      "OpenRouter returned 402 Insufficient Credits.\n" +
      "  • Check your credit balance: https://openrouter.ai/credits\n" +
      "  • Lower --concurrency if running concurrent requests exceeds reserved credit limits",
  },
  licenses: {
    bannerTitle: "                  vsub-cli Third-Party Software Licenses                  ",
    intro1:
      "This tool (standalone executables and npm package) bundles the following OSS libraries.",
    intro2: "Copyright notices and license terms for each library are listed below.",
    repository: "Repository:",
    footerHint:
      "* Full license text is available via `vsub licenses --full` or in the bundled `THIRD_PARTY_LICENSES.txt`.",
  },
  update: {
    checkAvailable: (latest: string, current: string) =>
      `v${latest} available (current: v${current})`,
    available: (current: string, latest: string) => `Update available: v${current} ➔ v${latest}`,
    commandHint: (cmd: string) => `Run: ${cmd}`,
    releaseNotes: (url: string) => `Release notes: ${url}`,
    checking: "Checking for updates...",
    alreadyLatest: (version: string) => `vsub-cli is already up to date (v${version}).`,
    foundNewVersion: (latest: string) => `Found new version v${latest}. Starting self-update...`,
    npmEnvNotice: "vsub-cli is running in an npm / Node.js environment.",
    npmEnvUpdateHint: (cmd: string) => `To update to the latest version, run:\n   ${cmd}`,
    downloading: (asset: string) => `Downloading ${asset}...`,
    verifyingChecksum: "Verifying SHA-256 checksum...",
    checksumMismatch: (expected: string, actual: string) =>
      `Checksum mismatch! Expected: ${expected}, but got: ${actual}`,
    checksumMissing: (url: string) =>
      `The release does not include SHA256SUMS.txt, so the download cannot be verified. The update was stopped and the current binary was left unchanged. To update manually, see: ${url}`,
    checksumEntryMissing: (asset: string, url: string) =>
      `SHA256SUMS.txt has no checksum for ${asset}, so the download cannot be verified. The update was stopped and the current binary was left unchanged. To update manually, see: ${url}`,
    extracting: "Extracting binary archive...",
    replacing: (path: string) => `Installing binary to ${path}...`,
    permissionDenied: (path: string) =>
      `Permission denied to modify ${path}. Please re-run with administrator privileges (e.g. sudo vsub update).`,
    successTitle: "vsub-cli updated successfully!",
    previousVersion: "Previous Version",
    updatedVersion: "Updated Version",
    binaryLocation: "Binary Path",
  },
};
