import type { en } from "./en.js";

export const ja: typeof en = {
  common: {
    success: "成功",
    failed: "失敗",
    skipped: "スキップ",
    error: "エラー",
    warning: "警告",
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
    step2Transcribing: (model: string, current?: number, total?: number) =>
      current && total && total > 1
        ? `🎙️ [2/4] Groq (${model}) で文字起こし中 [${current}/${total}]...`
        : `🎙️ [2/4] Groq (${model}) で文字起こし中...`,
    step2NoEntries: "⚠️ [2/4] 文字起こし結果から有効な字幕エントリが検出されませんでした",
    step2Done: (lang: string, count: number) =>
      `🎙️ [2/4] 文字起こし完了${lang} - ${count} 行の字幕を生成`,
    step3Cached: (lang: string, count: number) => `  ✔ ${lang} 翻訳 (キャッシュ利用: ${count} 行)`,
    step3TranslatingMulti: (
      model: string,
      currentLangIdx: number,
      totalLangs: number,
      lang: string,
      currentChunk: number,
      totalChunks: number,
    ) =>
      `🌐 [3/4] Gemini (${model}) で翻訳中 (${currentLangIdx}/${totalLangs} 言語: ${lang} [${currentChunk}/${totalChunks} チャンク])...`,
    step3TranslatingSingle: (
      model: string,
      lang: string,
      currentChunk: number,
      totalChunks: number,
    ) =>
      `🌐 [3/4] Gemini (${model}) で ${lang} に翻訳中 [${currentChunk}/${totalChunks} チャンク]...`,
    step3LangDone: (lang: string, count: number) => `  ✔ ${lang} 翻訳完了 (${count} 行)`,
    step3AllDone: (langs: string, count: number) =>
      `🌐 [3/4] Gemini 翻訳完了 (${langs}) - ${count} 行`,
    step3SkippedSameLang: (detected: string, target: string) =>
      `🌐 [3/4] 検出言語と出力言語が同一のため翻訳をスキップ (${detected} -> ${target})`,
    step4Saving: "💾 [4/4] 字幕ファイルを保存中...",
    step4Saved: (formats: string) => `💾 [4/4] 字幕ファイルを保存完了 (${formats})`,
    burnStarting: "🎬 FFmpeg で字幕を動画に焼き込み中 (libx264)...",
    burnDone: "🎬 字幕の動画焼き込みが完了しました",
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
      model: string,
      currentLangIdx: number,
      totalLangs: number,
      lang: string,
      currentChunk: number,
      totalChunks: number,
    ) =>
      `🌐 [2/3] Gemini (${model}) で翻訳中 (${currentLangIdx}/${totalLangs} 言語: ${lang} [${currentChunk}/${totalChunks} チャンク])...`,
    step2TranslatingSingle: (
      model: string,
      lang: string,
      currentChunk: number,
      totalChunks: number,
    ) =>
      `🌐 [2/3] Gemini (${model}) で ${lang} に翻訳中 [${currentChunk}/${totalChunks} チャンク]...`,
    step2Done: (langs: string, count: number) =>
      `🌐 [2/3] Gemini 翻訳完了 (${langs}) - ${count} 行`,
    step3Saving: "💾 [3/3] 字幕ファイルを保存中...",
    step3Saved: (formats: string) => `💾 [3/3] 字幕ファイルを保存完了 (${formats})`,
    subtitleNotFound: (path: string) => `字幕ファイルが見つかりません: ${path}`,
  },
  burn: {
    started: (video: string, sub: string) => `vsub-cli burn - 字幕焼き込み開始: ${video} + ${sub}`,
    videoNotFound: (path: string) => `動画ファイルが見つかりません: ${path}`,
    notVideoFile: (name: string) => `動画ファイル以外の形式には字幕を焼き込めません: ${name}`,
    subtitleNotFound: (path: string) => `字幕ファイルが見つかりません: ${path}`,
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
    bannerTitle: "🎬 vsub-cli 初期セットアップ & 導通確認ウィザード",
    configLocation: (path: string) => `設定ファイルの保存先: ${path}`,
    description1: "このウィザードでは API キー・FFmpeg の導通確認と初期設定を行います。",
    description2: "各項目で Enter キーを押すと、角括弧内の値または現在の設定を維持します。",
    step1Title: "▶ [1/4] Groq API キーの設定 (音声文字起こし用)",
    step1Url: (url: string) => `  API キー取得先: ${url}`,
    currentSetting: (val: string) => `  現在の設定: ${val}`,
    promptGroqCurrent: "  Groq API Key を入力 (Enter で現在の設定を維持): ",
    promptGroqNew: "  Groq API Key を入力 (Enter でスキップ): ",
    skippedGroq: "  ⚠️  Groq API キーをスキップしました (後から設定可能です)。\n",
    testingGroq: "  ⏳ Groq API 接続テスト中...",
    groqSuccess: (count: string | number) =>
      `  ✔ Groq API 接続成功 (${count} 個のモデルを確認可能)`,
    groqFailed: (err: string) => `  ✖ Groq API 接続失敗: ${err}`,
    retryPrompt: "  再入力しますか？ [Y/n/s (s=このまま保存)]: ",
    savedUnverified: "  ⚠️  未検証のままキーを設定対象に含めました。\n",
    step2Title: "▶ [2/4] Google Gemini API キーの設定 (字幕翻訳用)",
    step2Url: (url: string) => `  API キー取得先: ${url}`,
    promptGeminiCurrent: "  Gemini API Key を入力 (Enter で現在の設定を維持): ",
    promptGeminiNew: "  Gemini API Key を入力 (Enter でスキップ): ",
    skippedGemini: "  ⚠️  Gemini API キーをスキップしました (後から設定可能です)。\n",
    testingGemini: "  ⏳ Gemini API 接続テスト中...",
    geminiSuccess: (model: string) => `  ✔ Gemini API 接続成功 (モデル: ${model})`,
    geminiFailed: (err: string) => `  ✖ Gemini API 接続失敗: ${err}`,
    step3Title: "▶ [3/4] FFmpeg の確認 (音声抽出・動画焼き込み用)",
    testingFfmpeg: "  ⏳ FFmpeg 実行可能状態を確認中...",
    ffmpegSuccess: (version: string) => `  ✔ FFmpeg を検出しました: ${version}`,
    ffmpegFailed: (err: string) => `  ✖ FFmpeg が見つからないかエラーが発生しました: ${err}`,
    promptFfmpegPath: "  FFmpeg の実行パスを入力 (Enter でスキップ/現在の設定を維持): ",
    step4Title: "▶ [4/4] デフォルト設定の確認",
    promptDisplayLang: "  CLI 表示言語 [en] (en/ja, Enter で現在の設定を維持): ",
    promptTargetLang: "  デフォルト出力言語 [ja]: ",
    configSaved: (path: string) =>
      `\n🎉 初期セットアップが正常に完了しました！\n設定保存先: ${path}\n`,
    noApiKeyProvided: "APIキーが指定されていません",
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
  licenses: {
    bannerTitle: "                  vsub-cli サードパーティライセンス一覧                  ",
    intro1: "本ツール（単体実行バイナリおよび npm パッケージ）は以下の OSS ライブラリを含みます。",
    intro2: "各ライブラリの権利表示およびライセンス条文は以下の通りです。",
    repository: "リポジトリ:",
  },
};
