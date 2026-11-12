import type { en } from "./en.js";

export const ja: typeof en = {
  common: {
    success: "成功",
    failed: "失敗",
    skipped: "スキップ",
    error: "エラー",
    warning: "警告",
    glossaryParseFailed: (file: string, reason: string) =>
      `用語集ファイル（${file}）を読み込めませんでした: ${reason}`,
    lines: (count: number) => `${count} 行`,
    files: (count: number) => `${count} ファイル`,
    segments: (count: number) => `${count} セグメント`,
    terms: (count: number) => `${count} 語`,
  },
  summary: {
    title: "  vsub-cli 処理サマリー  ",
    targetAudio: "対象音声",
    targetSubtitle: "対象字幕",
    targetVideo: "対象動画",
    targetFile: "対象ファイル",
    audioActionOptimize: "音声最適化",
    audioActionExtract: "音声抽出",
    duration: "所要時間",
    transcription: "文字起こし",
    cacheHitBadge: " [キャッシュ利用 ⚡]",
    cachedBadge: "キャッシュ利用 ⚡",
    whisperPrompt: "認識ヒント",
    detectedLanguage: "検出言語",
    outputLanguages: "出力言語",
    skippedBadge: " (スキップ)",
    cachedLangBadge: " (キャッシュ)",
    translationModel: "翻訳モデル",
    subtitleMode: "字幕モード",
    bilingual: "バイリンガル併記",
    bilingualTargetFirst: " (訳語 ➔ 原語)",
    bilingualOriginalFirst: " (原語 ➔ 訳語)",
    glossary: "用語集",
    glossaryApplied: (count: number) => `${count} 語適用`,
    prompt: "翻訳指示",
    subtitleLines: "字幕行数",
    linesValue: (count: number) => `${count} 行`,
    backupsHeader: "バックアップ:",
    outputFilesHeader: "出力ファイル:",
    segmentsValue: (count: number, sizeStr: string) => `${count} セグメント${sizeStr}`,
  },
  batchSummary: {
    title: "  vsub-cli バッチ処理総合サマリー  ",
    targetFiles: "対象ファイル",
    targetFilesValue: (count: number) => `${count} ファイル`,
    results: "処理結果",
    successCount: (count: number) => `成功: ${count}`,
    failedCount: (count: number) => `失敗: ${count}`,
    skippedCount: (count: number) => `スキップ: ${count}`,
    totalDuration: "合計所要時間",
    fileDetailsHeader: "ファイル別詳細:",
    lineCountBadge: (count: number) => ` [${count}行]`,
    errorPrefix: "└─ エラー:",
    skippedBadge: "(スキップ)",
  },
  pipeline: {
    translationSaved: (lang: string, saved: number, total: number) =>
      `ℹ️ ${lang} の翻訳は ${total} チャンクのうち ${saved} を保存しました。同じコマンドをもう一度実行すると、続きから翻訳します。`,
    translationResuming: (lang: string, saved: number, total: number) =>
      `  ↻ ${lang}: 途中から再開します（${total} チャンクのうち ${saved} は保存済み）`,
    startProcessing: (name: string) => `vsub-cli - 処理開始: ${name}`,
    mediaNotFound: (path: string) => `メディアファイルが見つかりません: ${path}`,
    conflictAbort:
      "既存ファイルの競合により処理が中断されました。(--overwrite または --backup を指定してください)",
    backupCreated: (original: string, backup: string) =>
      `バックアップを作成しました: ${original} -> ${backup}`,
    cannotBurnAudio:
      "音声ファイルには字幕を焼き込めません。--burn オプションは動画ファイル（.mp4, .mkv, .mov 等）でのみ使用できます。",
    invalidBilingualOrder: (input: string) =>
      `サポートされていないバイリンガル順序です: "${input}". 利用可能な順序: "original-first", "target-first"`,
    unsupportedFormat: (token: string, supported: string) =>
      `サポートされていない出力フォーマットです: "${token}". 利用可能なフォーマット: ${supported}`,
    invalidTargetLang: (token: string) =>
      `無効なターゲット言語コードです: "${token}". 有効な形式の例: "ja", "en", "zh", "zh-CN", "pt-BR"`,
    invalidSttProvider: (provider: string) =>
      `サポートされていない文字起こし提供元です: "${provider}". 利用可能な提供元: openrouter, groq, openai-compatible`,
    invalidLlmProvider: (provider: string) =>
      `サポートされていない文章生成提供元です: "${provider}". 利用可能な提供元: gemini, openrouter, openai-compatible`,
    sttGroqAutoHint:
      "💡 VSUB_OPENROUTER_API_KEY が無いため、Groq で文字起こしします。既定は OpenRouter（elevenlabs/scribe-v2）になりました。Groq を使い続けるなら、VSUB_STT_PROVIDER=groq を設定すると、この表示は消えます。",
    step1SkipCache:
      "🔊 [1/4] 文字起こしキャッシュが存在するため音声抽出をスキップ [⚡ キャッシュ利用]",
    step2UseCached: (lang: string, count: number) =>
      `🎙️ [2/4] キャッシュされた文字起こし結果を利用${lang} - ${count} 行の字幕 [⚡ キャッシュ利用]`,
    step1Optimizing: "🔊 [1/4] 音声を最適化中 (16kHz mono / low bitrate)...",
    step1Extracting: "🔊 [1/4] 音声を抽出中 (16kHz mono / low bitrate)...",
    step1AudioOptimized: (count: number, size: string) =>
      `🔊 [1/4] 音声最適化完了 (${count} セグメント / ${size})`,
    step1AudioExtracted: (count: number, size: string) =>
      `🔊 [1/4] 音声抽出完了 (${count} セグメント / ${size})`,
    step2Transcribing: (provider: string, model: string, current?: number, total?: number) =>
      current && total && total > 1
        ? `🎙️ [2/4] ${provider} (${model}) で文字起こし中 [${current}/${total}]...`
        : `🎙️ [2/4] ${provider} (${model}) で文字起こし中...`,
    step2NoEntries: "⚠️ [2/4] 文字起こし結果から有効な字幕エントリが検出されませんでした",
    step2Done: (lang: string, count: number) =>
      `🎙️ [2/4] 文字起こし完了${lang} - ${count} 行の字幕を生成`,
    step2Refining: (provider: string, model: string, current: number, total: number) =>
      `✍️ [2/4] ${provider} (${model}) で文字起こしを修正中 [${current}/${total} チャンク]...`,
    step2Refined: (changed: number, total: number, cached = false) =>
      `✍️ [2/4] 文字起こしの修正完了 - ${changed}/${total} 行を変更${cached ? " [⚡ キャッシュ利用]" : ""}`,
    step2RefineFallbackWarn: (fallbackChunks: number, totalChunks: number) =>
      `⚠️ [2/4] ${fallbackChunks}/${totalChunks} チャンクはモデルの答えが元の行と対応しなかったため、元の文字をそのまま使いました`,
    step3Cached: (lang: string, count: number) => `  ✔ ${lang} 翻訳 (キャッシュ利用: ${count} 行)`,
    step3TranslatingMulti: (
      provider: string,
      model: string,
      currentLangIdx: number,
      totalLangs: number,
      lang: string,
      currentChunk: number,
      totalChunks: number,
    ) =>
      `🌐 [3/4] ${provider} (${model}) で翻訳中 (${currentLangIdx}/${totalLangs} 言語: ${lang} [${currentChunk}/${totalChunks} チャンク])...`,
    step3TranslatingSingle: (
      provider: string,
      model: string,
      lang: string,
      currentChunk: number,
      totalChunks: number,
    ) =>
      `🌐 [3/4] ${provider} (${model}) で ${lang} に翻訳中 [${currentChunk}/${totalChunks} チャンク]...`,
    step3LangDone: (lang: string, count: number) => `  ✔ ${lang} 翻訳完了 (${count} 行)`,
    step3AllDone: (provider: string, langs: string, count: number, cached = false) =>
      `🌐 [3/4] ${provider} 翻訳完了 (${langs}) - ${count} 行${cached ? " [⚡ キャッシュ利用]" : ""}`,
    step3SkippedSameLang: (detected: string, target: string) =>
      `🌐 [3/4] 検出言語と出力言語が同一のため翻訳をスキップ (${detected} -> ${target})`,
    step4Saving: "💾 [4/4] 字幕ファイルを保存中...",
    step4Saved: (formats: string) => `💾 [4/4] 字幕ファイルを保存完了 (${formats})`,
    burnStarting: "🎬 FFmpeg で字幕を動画に焼き込み中 (libx264)...",
    burnDone: "🎬 字幕の動画焼き込みが完了しました",
    embedStarting: "🎬 FFmpeg で字幕トラックを動画に埋め込み中 (ソフトサブ)...",
    embedDone: "🎬 動画への字幕トラック埋め込みが完了しました",
    cannotEmbedAudio: "音声ファイルに字幕トラックを埋め込むことはできません",
    embedUnsupportedContainer: (file: string, ext: string, supported: string) =>
      `「${file}」には字幕トラックを埋め込めません。${ext} のコンテナはソフトサブに対応していません（対応: ${supported}）。--embed を付けずに字幕を作ってから、「vsub embed <動画> <字幕ファイル> -o <名前>.mkv」を実行してください。`,
    outputPathConflict: (file: string) =>
      `「${file}」には書き出せません。入力のメディアファイルか、ほかの出力と同じパスです。-o で別のパスを指定してください。`,
    stdoutSingleFormatOnly:
      "--stdout 指定時は複数の出力フォーマットを指定できません。単一のフォーマットを指定してください (例: -f srt)。",
    stdoutSingleLangOnly:
      "--stdout 指定時は複数の言語を指定できません。単一の言語を指定してください。",
    stdoutCannotBurn: "--stdout と --burn (字幕焼き込み) を同時に指定することはできません。",
    stdoutCannotEmbed:
      "--stdout と --embed (ソフトサブ埋め込み) を同時に指定することはできません。",
    savedOriginal: (files: string) => `📄 原文字幕を保存: ${files}`,
    skippedOriginal: (files: string) => `📄 原語字幕の保存をスキップ: ${files}`,
    keptAudio: (files: string) => `[--keep-audio] 中間音声ファイルを保持: ${files}`,
    errorOccurred: (err: string) => `処理中にエラーが発生しました: ${err}`,
  },

  translate: {
    started: (name: string) => `vsub-cli translate - 字幕翻訳開始: ${name}`,
    step1Parsing: "📖 [1/3] 字幕ファイルを読み込み・パース中...",
    step1Parsed: (count: number) =>
      `📖 [1/3] 字幕ファイル読み込み完了 - ${count} 行のエントリを検出`,
    step1NoEntries: (name: string) =>
      `字幕ファイルからエントリを読み取れませんでした（SRT 形式であることを確認してください）: ${name}`,
    step2TranslatingMulti: (
      provider: string,
      model: string,
      currentLangIdx: number,
      totalLangs: number,
      lang: string,
      currentChunk: number,
      totalChunks: number,
    ) =>
      `🌐 [2/3] ${provider} (${model}) で翻訳中 (${currentLangIdx}/${totalLangs} 言語: ${lang} [${currentChunk}/${totalChunks} チャンク])...`,
    step2TranslatingSingle: (
      provider: string,
      model: string,
      lang: string,
      currentChunk: number,
      totalChunks: number,
    ) =>
      `🌐 [2/3] ${provider} (${model}) で ${lang} に翻訳中 [${currentChunk}/${totalChunks} チャンク]...`,
    step2Done: (provider: string, langs: string, count: number, cached = false) =>
      `🌐 [2/3] ${provider} 翻訳完了 (${langs}) - ${count} 行${cached ? " [⚡ キャッシュ利用]" : ""}`,
    step3Saving: "💾 [3/3] 字幕ファイルを保存中...",
    step3Saved: (formats: string) => `💾 [3/3] 字幕ファイルを保存完了 (${formats})`,
    stdoutSingleFormatOnly:
      "--stdout 指定時は複数の出力フォーマットを指定できません。単一のフォーマットを指定してください (例: -f srt)。",
    stdoutSingleLangOnly:
      "--stdout 指定時は複数の言語を指定できません。単一の言語を指定してください。",
    subtitleNotFound: (path: string) => `字幕ファイルが見つかりません: ${path}`,
  },
  chapters: {
    unsupportedFormat: (input: string, supported: string) =>
      `サポートされていないチャプターの形式です: "${input}". 利用可能な形式: ${supported}`,
    started: (file: string) => `vsub-cli chapters - チャプター生成開始: ${file}`,
    singleTargetLang: (used: string, requested: string) =>
      `章立ては 1 つの言語でだけ作ります。"${requested}" の先頭の "${used}" を使います。`,
    step1Resolve: "文字起こしデータを取得中...",
    step1Parsed: (count: number) => `字幕データ ${count} 行を解析完了`,
    step2Generating: (provider: string, model: string, lang: string) =>
      `${provider} (${model}) でチャプターを生成中 [${lang}]...`,
    step2Done: (count: number) => `チャプター ${count} 件を生成完了`,
    step2Cached: (count: number) =>
      `キャッシュ済みチャプター ${count} 件を適用 [⚡ キャッシュ利用]`,
    tooFewChapters: (count: number) =>
      `チャプターが ${count} 件しかありません。YouTube で章として表示されるのは、10 秒以上の章が 3 件以上あるときだけです。`,
    step3Saving: "チャプターファイルを保存中...",
    step3Saved: (path: string) => `チャプターファイルを保存完了: ${path}`,
    noEntries: "チャプター生成対象の字幕データが見つかりませんでした。",
  },
  summarize: {
    unsupportedFormat: (input: string, supported: string) =>
      `サポートされていない要約の形式です: "${input}". 利用可能な形式: ${supported}`,
    started: (file: string) => `vsub-cli summarize - 要約生成開始: ${file}`,
    singleTargetLang: (used: string, requested: string) =>
      `要約は 1 つの言語でだけ作ります。"${requested}" の先頭の "${used}" を使います。`,
    step1Resolve: "文字起こしデータを取得中...",
    step1Parsed: (count: number) => `字幕データ ${count} 行を解析完了`,
    step2Generating: (provider: string, model: string, lang: string) =>
      `${provider} (${model}) で要約を生成中 [${lang}]...`,
    step2Done: "要約の生成が完了しました",
    step2Cached: "キャッシュ済み要約を適用 [⚡ キャッシュ利用]",
    step3Saving: "要約ファイルを保存中...",
    step3Saved: (path: string) => `要約ファイルを保存完了: ${path}`,
    noEntries: "要約生成対象の字幕データが見つかりませんでした。",
  },
  burn: {
    started: (video: string, sub: string) => `vsub-cli burn - 字幕焼き込み開始: ${video} + ${sub}`,
    videoNotFound: (path: string) => `動画ファイルが見つかりません: ${path}`,
    notVideoFile: (name: string) => `動画ファイル以外の形式には字幕を焼き込めません: ${name}`,
    subtitleNotFound: (path: string) => `字幕ファイルが見つかりません: ${path}`,
    invalidPosition: (pos: string) =>
      `無効な字幕焼き込み位置です: "${pos}"。有効な位置: bottom (デフォルト: 下部), top (上部), center (中央)`,
    invalidFontSize: (size: string) =>
      `無効な字幕フォントサイズです: "${size}"。small, medium, large, または正の数値を指定してください。`,
  },
  embed: {
    started: (video: string, count: number) =>
      `vsub-cli embed - 字幕トラック埋め込み開始: ${video} (${count} トラック)`,
    videoNotFound: (path: string) => `動画ファイルが見つかりません: ${path}`,
    notVideoFile: (name: string) =>
      `動画ファイル以外の形式には字幕トラックを埋め込めません: ${name}`,
    subtitleNotFound: (path: string) => `字幕ファイルが見つかりません: ${path}`,
    noSubtitles: "動画に埋め込む字幕ファイルを1つ以上指定してください。",
    unsupportedContainer: (file: string, ext: string, supported: string) =>
      `「${file}」には字幕トラックを埋め込めません。${ext || "（拡張子なし）"} のコンテナはソフトサブに対応していません（対応: ${supported}）。対応するコンテナの出力先を指定してください（例: -o <名前>.mkv）。`,
    stepEmbedding: "FFmpeg ストリームコピーで字幕トラックを埋め込み中...",
    stepSaved: (path: string) => `字幕トラック埋め込み動画を保存完了: ${path}`,
  },

  batch: {
    noMediaFiles: (targets: string) =>
      `\n⚠️  対象となる動画・音声メディアファイルが見つかりませんでした。\n   指定パス: ${targets}\n`,
    started: (count: number) => `vsub-cli batch - バッチ処理開始 (${count} ファイル)`,
    processingItem: (file: string, dir: string) => `📁 処理中: ${file} (${dir})`,
    completedItem: (file: string) => `✔ 完了 (${file})`,
    failedItem: (err: string) => `✖ 失敗: ${err}`,
    failFastAbort: "⚠️  [--fail-fast] エラーが発生したため残りのバッチ処理を中断します。\n",
    fatalError: (err: string) => `バッチ処理中に致命的なエラーが発生しました: ${err}`,
  },
  safety: {
    existingFilesWarning: "以下の出力ファイルが既に存在します:",
    promptOverwrite: "上書きして処理を続行しますか？ (y/N): ",
    aborted: "⚠️  処理を中止しました。(--overwrite または --backup を指定して再実行できます)",
    nonInteractiveError:
      "出力ファイルが既に存在します。上書きを許可する場合は --overwrite、バックアップを残す場合は --backup を指定してください。",
  },
  init: {
    notInteractive:
      "vsub init は対話形式のため、端末から実行してください（標準入力が端末ではありません）。ウィザードを使わずに設定するには、vsub config set（例: vsub config set --openrouter-key <キー>）か、VSUB_OPENROUTER_API_KEY などの環境変数を使ってください。",
    bannerTitle: "🎬 vsub-cli 初期セットアップ & 導通確認ウィザード",
    configLocation: (path: string) => `設定ファイルの保存先: ${path}`,
    description1: "このウィザードでは API キー・FFmpeg の導通確認と初期設定を行います。",
    description2: "各項目で Enter キーを押すと、角括弧内の値または現在の設定を維持します。",
    openaiCompatibleSttNotice:
      "  OpenAI 互換の文字起こしは、vsub config set（--openai-compatible-stt-base-url・--openai-compatible-stt-key・--openai-compatible-stt-model）か、環境変数 VSUB_OPENAI_COMPATIBLE_STT_* の URL・キー・モデルを使います。",
    openaiCompatibleLlmNotice:
      "  OpenAI 互換の文章の生成は、vsub config set（--openai-compatible-llm-base-url・--openai-compatible-llm-key・--openai-compatible-llm-model）か、環境変数 VSUB_OPENAI_COMPATIBLE_LLM_* の URL・キー・モデルを使います。",
    step1Title: "▶ [1/4] 文字起こしの提供元と API キー",
    step1Url: (url: string) => `  API キー取得先: ${url}`,
    currentSetting: (val: string) => `  現在の設定: ${val}`,
    promptSttProvider: (current: string) => `  文字起こしの提供元 (openrouter/groq) [${current}]: `,
    promptGroqCurrent: "  Groq API Key を入力 (Enter で現在の設定を維持): ",
    promptGroqNew: "  Groq API Key を入力 (Enter でスキップ): ",
    skippedGroq: "  ⚠️  Groq API キーをスキップしました (後から設定可能です)。\n",
    testingGroq: "  ⏳ Groq API 接続テスト中...",
    groqSuccess: (count?: number) =>
      `  ✔ Groq API 接続成功${count === undefined ? "" : ` (${count} 個のモデルを確認可能)`}`,
    groqFailed: (err: string) => `  ✖ Groq API 接続失敗: ${err}`,
    promptOpenRouterCurrent: "  OpenRouter API Key を入力 (Enter で現在の設定を維持): ",
    promptOpenRouterNew: "  OpenRouter API Key を入力 (Enter でスキップ): ",
    skippedOpenRouter: "  ⚠️  OpenRouter API キーをスキップしました (後から設定可能です)。\n",
    testingOpenRouter: "  ⏳ OpenRouter API 接続テスト中...",
    openrouterSuccess: "  ✔ OpenRouter API 接続成功",
    openrouterFailed: (err: string) => `  ✖ OpenRouter API 接続失敗: ${err}`,
    openrouterEnvNotice:
      "  環境変数 OPENROUTER_API_KEY が設定されています。Enter を押すとこのキーを使用します（設定ファイルには保存されません）。",
    retryPrompt: "  再入力しますか？ [Y/n/s (s=このまま保存)]: ",
    savedUnverified: "  ⚠️  未検証のままキーを設定対象に含めました。\n",
    usingEnvKeyUnverified:
      "  ⚠️  未検証のまま、環境変数のキーを使います (設定ファイルには保存しません)。\n",
    step2Title: "▶ [2/4] 文章の生成の提供元と API キー (翻訳・チャプター・要約用)",
    promptLlmProvider: (current: string) =>
      `  文章の生成の提供元 (gemini/openrouter) [${current}]: `,
    usingOpenRouterFromStep1: "  手順 1 の OpenRouter の API キーを使います。",
    step2Url: (url: string) => `  API キー取得先: ${url}`,
    promptGeminiCurrent: "  Gemini API Key を入力 (Enter で現在の設定を維持): ",
    promptGeminiNew: "  Gemini API Key を入力 (Enter でスキップ): ",
    skippedGemini: "  ⚠️  Gemini API キーをスキップしました (後から設定可能です)。\n",
    testingGemini: "  ⏳ Gemini API 接続テスト中...",
    geminiSuccess: (model: string) => `  ✔ Gemini API 接続成功 (モデル: ${model})`,
    geminiFailed: (err: string) => `  ✖ Gemini API 接続失敗: ${err}`,
    step3Title: "▶ [3/4] FFmpeg の確認 (音声抽出・動画焼き込み用)",
    testingFfmpeg: (path: string) => `  ⏳ FFmpeg を確認中 (${path})...`,
    ffmpegInstallHeader: "  ※ FFmpeg のインストール方法:",
    ffmpegInstallWindows: (a: string, b: string) => `     Windows : ${a} または ${b}`,
    ffmpegSuccess: (version: string) => `  ✔ FFmpeg を検出しました: ${version}`,
    ffmpegFailed: (err: string) => `  ✖ FFmpeg が見つからないかエラーが発生しました: ${err}`,
    promptFfmpegPath: "  FFmpeg の実行パスを入力 (Enter でスキップ/現在の設定を維持): ",
    step4Title: "▶ [4/4] デフォルト設定の確認",
    promptDisplayLang: (current: string) => `  CLI 表示言語 [${current}] (en/ja): `,
    promptTargetLang: (current: string) => `  デフォルト出力言語 [${current}]: `,
    promptGeminiModel: (current: string) => `  Gemini のモデル [${current}]: `,
    promptGroqModel: (current: string) => `  Groq の文字起こしモデル [${current}]: `,
    promptOpenRouterModel: (current: string) => `  OpenRouter の文字起こしモデル [${current}]: `,
    promptOpenRouterLlmModel: (current: string) => `  OpenRouter の文章の生成モデル [${current}]: `,
    configSaved: (path: string) =>
      `\n🎉 初期セットアップが正常に完了しました！\n設定保存先: ${path}\n`,
    configNotSaved: "このウィザードで入力した内容は保存されていません。",
    noApiKeyProvided: "APIキーが指定されていません",
    quickStartTitle: "🚀 使い方の例:",
    quickStartTranscribe: "文字起こしして字幕を作る",
    quickStartMultiLanguage: "複数の言語の字幕を出す",
    quickStartBilingual: "2 言語を併記した字幕",
    quickStartBurn: "字幕を動画に焼き込む (ハードサブ)",
    quickStartBatch: "フォルダ内をまとめて処理",
    quickStartHelp: "すべてのオプションを表示",
  },
  config: {
    pathLine: (path: string) => `設定ファイルのパス: ${path}`,
    showHeader: (path: string) => `📁 設定ファイル: ${path}`,
    showLabels: {
      lang: "表示言語",
      targetLang: "翻訳先",
      groqApiKey: "Groq の API キー",
      geminiApiKey: "Gemini の API キー",
      openrouterApiKey: "OpenRouter の API キー",
      transcription: "文字起こし",
      textGeneration: "文章の生成",
      refine: "文字起こしの修正",
      ffmpegPath: "FFmpeg のパス",
      whisperPrompt: "認識ヒント",
      prompt: "翻訳指示",
      glossary: "用語集",
      geminiModel: "Gemini のモデル",
      groqModel: "Groq のモデル",
      openrouterSttModel: "OpenRouter の文字起こしモデル",
      openrouterLlmModel: "OpenRouter の文章生成モデル",
      openaiCompatibleSttBaseUrl: "OpenAI 互換の文字起こし URL",
      openaiCompatibleSttApiKey: "OpenAI 互換の文字起こし API キー",
      openaiCompatibleSttModel: "OpenAI 互換の文字起こしモデル",
      openaiCompatibleLlmBaseUrl: "OpenAI 互換の文章生成 URL",
      openaiCompatibleLlmApiKey: "OpenAI 互換の文章生成 API キー",
      openaiCompatibleLlmModel: "OpenAI 互換の文章生成モデル",
      openaiCompatibleLlmReasoningEffort: "OpenAI 互換の文章生成の推論の量",
      concurrency: "並行数",
      maxLength: "字幕の最大文字数",
      burnPosition: "焼き込みの位置",
      burnFontSize: "焼き込みの文字サイズ",
      updateCheck: "更新の確認",
    },
    notConfigured: "(未設定)",
    enabled: "有効",
    disabled: "無効",
    chars: (n: number) => `${n} 文字`,
    invalidProvider: (provider: string) => `不明な提供元 "${provider}"`,
    setNothing:
      "⚠️ 保存する設定を指定してください。(例: vsub config set --gemini-model gemini-3.8-flash)",
    invalidDisplayLang: (value: string) =>
      `表示言語が正しくありません: "${value}"。対応している言語: "en", "ja"`,
    invalidOpenAICompatibleUrl: (flag: string, value: string, example: string) =>
      `${flag} の URL が正しくありません: "${value}"。${example} のような http:// か https:// の URL を指定してください。`,
    invalidRefine: (value: string) =>
      `--refine の値が正しくありません: "${value}"。true か false を指定してください。`,
    setSaved: (path: string) => `✅ 設定を保存しました: ${path}`,
    missingKeysHeader: "\n🔑 API キーがありません。対話形式で設定を始めます。",
    requiredKeysMissing: (items: string[]) =>
      `必要な API キーが設定されていません:\n- ${items.join("\n- ")}\n対話形式の入力、.env ファイル、環境変数のいずれかで設定してください。`,
    openRouterKeyHint:
      "VSUB_OPENROUTER_API_KEY（取得先: https://openrouter.ai/keys。汎用の OPENROUTER_API_KEY は、--stt-provider openrouter・--llm-provider openrouter・VSUB_STT_PROVIDER=openrouter・VSUB_LLM_PROVIDER=openrouter のときだけ読みます。翻訳には Gemini のキー VSUB_GEMINI_API_KEY / GEMINI_API_KEY も使えます）",
    groqKeyHint: "VSUB_GROQ_API_KEY / GROQ_API_KEY（取得先: https://console.groq.com/）",
    geminiKeyHint: "VSUB_GEMINI_API_KEY / GEMINI_API_KEY（取得先: https://aistudio.google.com/）",
    missingKeysNote: "入力したキーは、次回から使えるよう次の場所に保存します:",
    promptOpenRouterKey: "1. OpenRouter の API キーを入力 (https://openrouter.ai/keys): ",
    promptGroqKey: "1. Groq の API キーを入力 (https://console.groq.com/): ",
    promptGeminiKey: "2. Gemini の API キーを入力 (https://aistudio.google.com/): ",
    missingKeysSaved: "✅ 設定を保存しました。\n",
    unreadableConfig: (path: string, reason: string) =>
      `既存の設定ファイルを読み込めませんでした: ${path}（${reason}）。何も保存していません。ファイルを直すか削除してから、もう一度実行してください。`,
    dirPermissionWarning: (dir: string, reason: string) =>
      `⚠️ 設定フォルダの権限を 700 に絞れませんでした: ${dir}（${reason}）。設定ファイル自体は、権限 600 で書き込みます。`,
  },
  cache: {
    pathLine: (dir: string) => `キャッシュのフォルダ: ${dir}`,
    statsHeader: (dir: string) => `📁 キャッシュのフォルダ: ${dir}`,
    statsLabels: { count: "ファイル数", totalSize: "合計サイズ" },
    files: (n: number) => `${n} 件`,
    cleaned: (n: number, size: string, dir: string) =>
      `✅ キャッシュのファイルを ${n} 件消しました (${size} を解放): ${dir}`,
  },
  gemini: {
    modelRetiredDefault: (model: string) =>
      `デフォルトの Gemini モデル '${model}' が見つからないか、Google により提供終了（退役）した可能性があります。\n` +
      `  • vsub-cli を最新版に更新してください: npm install -g vsub-cli\n` +
      `  • または代替モデルを --gemini-model で指定してください (モデル一覧: https://ai.google.dev/gemini-api/docs/models)`,
    modelNotFoundCustom: (model: string) =>
      `指定された Gemini モデル '${model}' が見つかりませんでした。モデル名または API の利用権限を確認してください。\n` +
      `  • 利用可能なモデル一覧: https://ai.google.dev/gemini-api/docs/models`,
  },
  openaiCompatible: {
    notConfigured: (side: "stt" | "llm") =>
      `OpenAI 互換の${side === "stt" ? "文字起こし" : "文章の生成"}が設定されていません:`,
    baseUrlRequired: (side: "stt" | "llm") =>
      `URL: VSUB_OPENAI_COMPATIBLE_${side === "stt" ? "STT" : "LLM"}_BASE_URL を設定するか、vsub config set --openai-compatible-${side}-base-url <url> を実行してください（例: http://localhost:${side === "stt" ? "8000" : "11434"}/v1）`,
    baseUrlInvalid: (side: "stt" | "llm", value: string) =>
      `URL "${value}" は http:// か https:// の正しい URL ではありません: VSUB_OPENAI_COMPATIBLE_${side === "stt" ? "STT" : "LLM"}_BASE_URL を設定するか、vsub config set --openai-compatible-${side}-base-url <url> を実行してください（例: http://localhost:${side === "stt" ? "8000" : "11434"}/v1）`,
    modelRequired: (side: "stt" | "llm") =>
      `モデル: --${side}-model を付けるか、VSUB_OPENAI_COMPATIBLE_${side === "stt" ? "STT" : "LLM"}_MODEL を設定するか、vsub config set --openai-compatible-${side}-model <model> を実行してください`,
    modelNotFound: (model: string, baseUrl: string) =>
      `OpenAI 互換の API（${baseUrl}）に、モデル '${model}' が見つかりませんでした。\n  • モデル名を確かめてください: --llm-model、VSUB_OPENAI_COMPATIBLE_LLM_MODEL、vsub config set --openai-compatible-llm-model <model>`,
  },
  openrouter: {
    modelRetiredDefault: (model: string) =>
      `既定の OpenRouter モデル '${model}' が見つかりませんでした。\n` +
      `  • vsub-cli を更新するか、https://openrouter.ai/models でモデルを確認してください\n` +
      `  • または --llm-model で別のモデルを指定してください`,
    modelNotFoundCustom: (model: string) =>
      `指定された OpenRouter モデル '${model}' が見つかりませんでした。モデル名または API 権限を確認してください。\n` +
      `  • 利用可能なモデル一覧: https://openrouter.ai/models\n` +
      `  • または --llm-model で別のモデルを指定してください`,
    insufficientCredits:
      "OpenRouter から 402 Insufficient Credits (残高不足) が返されました。\n" +
      "  • クレジット残高を確認してください: https://openrouter.ai/credits\n" +
      "  • 見込み額が残高を超えている場合は --concurrency で並行数を下げてください",
  },
  licenses: {
    bannerTitle: "                  vsub-cli サードパーティライセンス一覧                  ",
    intro1: "本ツール（単体実行バイナリおよび npm パッケージ）は以下の OSS ライブラリを含みます。",
    intro2: "各ライブラリの権利表示およびライセンス条文は以下の通りです。",
    repository: "リポジトリ:",
    footerHint:
      "※ 全文テキストは `vsub licenses --full` または配布同梱の `THIRD_PARTY_LICENSES.txt` で確認できます。",
  },
  update: {
    checkAvailable: (latest: string, current: string) =>
      `v${latest} が利用できます (現在: v${current})`,
    available: (current: string, latest: string) =>
      `新しいバージョンが利用可能です: v${current} ➔ v${latest}`,
    commandHint: (cmd: string) => `更新コマンド: ${cmd}`,
    releaseNotes: (url: string) => `リリースノート: ${url}`,
    checking: "最新バージョンを確認中...",
    alreadyLatest: (version: string) => `vsub-cli は既に最新バージョンです (v${version})。`,
    foundNewVersion: (latest: string) =>
      `最新バージョン v${latest} が見つかりました。自己更新を開始します...`,
    npmEnvNotice: "vsub-cli は npm / Node.js 環境で実行されています。",
    npmEnvUpdateHint: (cmd: string) =>
      `最新版に更新するには、以下のコマンドを実行してください:\n   ${cmd}`,
    downloading: (asset: string) => `${asset} をダウンロード中...`,
    verifyingChecksum: "SHA-256 チェックサムを検証中...",
    checksumMismatch: (expected: string, actual: string) =>
      `チェックサムの不一致を検出しました。期待値: ${expected}, 実際値: ${actual}`,
    checksumMissing: (url: string) =>
      `リリースに SHA256SUMS.txt が無いため、ダウンロードしたファイルを検証できません。更新を中止しました（今のバイナリはそのままです）。手動で更新する場合は、次を参照してください: ${url}`,
    checksumEntryMissing: (asset: string, url: string) =>
      `SHA256SUMS.txt に ${asset} のチェックサムが無いため、ダウンロードしたファイルを検証できません。更新を中止しました（今のバイナリはそのままです）。手動で更新する場合は、次を参照してください: ${url}`,
    extracting: "アーカイブを展開中...",
    replacing: (path: string) => `${path} を新バージョンに置換中...`,
    permissionDenied: (path: string) =>
      `${path} の更新権限がありません。管理者権限（例: sudo vsub update）で再実行してください。`,
    successTitle: "vsub-cli の更新が完了しました！",
    previousVersion: "更新前バージョン",
    updatedVersion: "更新後バージョン",
    binaryLocation: "実行ファイルパス",
  },
};
