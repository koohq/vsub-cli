import fs from "node:fs";
import path from "node:path";
import { Command, Option } from "commander";
import pc from "picocolors";
import { type BatchPipelineOptions, runBatchPipeline } from "./batch.js";
import { clearCache, getCacheDir, getCacheStats } from "./cache.js";
import {
  type AppConfig,
  getConfig,
  getGlobalConfigPath,
  isHttpBaseUrl,
  normalizeBaseUrl,
  parseBooleanSetting,
  parsePositiveInteger,
  saveGlobalConfig,
} from "./config.js";
import {
  burnSubtitlesToVideo,
  checkFfmpeg,
  embedSubtitlesToVideo,
  isVideoFile,
  listSoftSubtitleContainers,
  parseBurnFontSize,
  parseBurnPosition,
  type SubtitleTrackInput,
  supportsSoftSubtitles,
} from "./ffmpeg.js";
import { parseChaptersFormat, parseSummaryFormat } from "./formatter.js";
import { getI18n, normalizeLanguage } from "./i18n/index.js";
import { runInitWizard } from "./init.js";
import {
  getLanguageDisplayName,
  normalizeTargetLangSetting,
  parseTargetLanguages,
} from "./languages.js";
import { printLicenses } from "./licenses.js";
import {
  findOutputPathConflict,
  type ProcessChaptersOptions,
  type ProcessMediaOptions,
  processChaptersPipeline,
  processMediaPipeline,
  processSummaryPipeline,
} from "./pipeline.js";
import { ensureWritableTargets } from "./safety.js";
import { parseSrt } from "./srt.js";
import {
  LLM_PROVIDER_LABELS,
  type LlmProvider,
  parseLlmProvider,
  resolveLlmSettings,
} from "./text/select.js";
import {
  parseSttProvider,
  resolveSttSettings,
  STT_PROVIDER_LABELS,
  type SttProvider,
} from "./transcribe/select.js";
import { runTranslateCommand, type TranslateCommandOptions } from "./translate.js";
import { getTranslationResumeHint } from "./translation.js";
import {
  createSpinner,
  displayWidth,
  formatFileSize,
  formatSummaryBox,
  padEndToWidth,
  showSpinnerNotice,
} from "./ui.js";
import {
  checkUpdate,
  formatSelfUpdateSummary,
  formatUpdateNotification,
  isStandaloneBinary,
  notifyUpdateIfAvailable,
  performSelfUpdate,
} from "./updater.js";
import { getCurrentVersion } from "./version.js";

/**
 * Infers language code and display title from a subtitle file path (e.g. "movie.ja.srt" -> "ja").
 */
function inferLanguageFromSubtitlePath(filePath: string): { language?: string; title?: string } {
  const base = path.basename(filePath);
  const match = base.match(/[._-]([a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,4})?)\.[a-zA-Z0-9]+$/i);
  if (match?.[1]) {
    const rawLang = match[1].toLowerCase();
    try {
      const parsed = parseTargetLanguages(rawLang);
      if (parsed[0]) {
        return {
          language: parsed[0],
          title: getLanguageDisplayName(parsed[0]),
        };
      }
    } catch {
      // not a recognized language code, fallback below
    }
  }
  const cleanName = path.basename(filePath, path.extname(filePath));
  return { title: cleanName };
}

interface NormalizedNegativeFlags {
  noTranslate: boolean;
  noCache: boolean;
  noReflow: boolean;
  noUpdateCheck: boolean;
}

interface InheritedGlobalOptions {
  lang?: string;
  updateCheck?: boolean;
}

/**
 * Traverses parent commands to resolve global options (lang and updateCheck).
 */
function resolveInheritedGlobals(cmd: Command): InheritedGlobalOptions {
  const local = cmd.opts<Record<string, unknown>>();
  let inheritedLang = typeof local["lang"] === "string" ? local["lang"] : undefined;
  let disableUpdateCheck = local["updateCheck"] === false;

  let current = cmd.parent;
  while (current) {
    const parentOpts = current.opts<Record<string, unknown>>();
    if (inheritedLang === undefined && typeof parentOpts["lang"] === "string") {
      inheritedLang = parentOpts["lang"];
    }
    if (parentOpts["updateCheck"] === false) {
      disableUpdateCheck = true;
    }
    current = current.parent;
  }

  return {
    ...(inheritedLang !== undefined ? { lang: inheritedLang } : {}),
    ...(disableUpdateCheck ? { updateCheck: false } : {}),
  };
}

/**
 * Reads options for an action handler, inheriting only global options (lang, updateCheck)
 * from parent commands, and normalizes negative flag names.
 */
function readActionOptions<T>(cmd: Command): T & NormalizedNegativeFlags {
  const raw = cmd.opts<Record<string, unknown>>();
  const globals = resolveInheritedGlobals(cmd);
  const merged: Record<string, unknown> = {
    ...raw,
    ...globals,
  };
  return {
    ...(merged as unknown as T),
    noTranslate: merged["translate"] === false,
    noCache: merged["cache"] === false,
    noReflow: merged["reflow"] === false,
    noUpdateCheck: merged["updateCheck"] === false,
  };
}

/** Creates the shared UI display language option. */
function createLangOption(): Option {
  return new Option("-l, --lang <lang>", "UI display language (en, ja)");
}

/** Hides the UI display language option from command help. */
function createHiddenLangOption(): Option {
  return createLangOption().hideHelp();
}

/**
 * Attaches the interactive setup wizard subcommand ("init") to a parent command.
 */
function addInitCommand(parent: Command, description: string): void {
  parent
    .command("init")
    .description(description)
    .addOption(createLangOption())
    .action(async (_options: unknown, cmd: Command) => {
      const actionOptions = readActionOptions<{ lang?: string }>(cmd);
      try {
        await runInitWizard({ lang: normalizeLanguage(actionOptions.lang) });
      } catch (err) {
        console.error(pc.red(`\n✖ ${err instanceof Error ? err.message : String(err)}\n`));
        process.exit(1);
      }
    });
}

/**
 * Recursively traverses subcommands and attaches hidden global options (-l/--lang, --no-update-check)
 * to leaf commands that define their own options.
 */
function acceptGlobalOptions(rootCmd: Command): void {
  for (const cmd of rootCmd.commands) {
    acceptGlobalOptions(cmd);
  }

  if (rootCmd.commands.length === 0) {
    const hasLangOption = rootCmd.options.some(
      (opt) => opt.long === "--lang" || opt.short === "-l",
    );
    if (!hasLangOption) {
      rootCmd.addOption(createHiddenLangOption());
    }

    const hasNoUpdateCheck = rootCmd.options.some((opt) => opt.long === "--no-update-check");
    if (!hasNoUpdateCheck) {
      rootCmd.addOption(
        new Option("--no-update-check", "Disable checking for new version updates").hideHelp(),
      );
    }
  }
}

function addLlmProviderOptions(command: Command): Command {
  return command
    .option(
      "--llm-provider <provider>",
      "Text generation provider for translation, chapters and summaries: gemini, openrouter, or openai-compatible (default: VSUB_LLM_PROVIDER, config, or chosen from your API keys)",
    )
    .option(
      "--llm-model <model>",
      "Model for the chosen text generation provider (default: gemini-3.8-flash on Gemini, google/gemini-3.8-flash on OpenRouter, the configured model on openai-compatible)",
    );
}

function addReflowOptions(command: Command): Command {
  return command
    .option("--max-length <chars>", "Max characters per subtitle entry before automatic splitting")
    .option(
      "--max-duration <seconds>",
      "Max display duration in seconds per subtitle entry (default: 7)",
    )
    .option("--no-reflow", "Disable automatic splitting and reflowing of long subtitle segments");
}

interface TextTaskOptionTexts {
  targetLang: string;
  format: string;
  defaultFormat: string;
  stdout: string;
  prompt: string;
  glossary: string;
  geminiModel: string;
  fresh: string;
}

function addTextTaskOptions(command: Command, texts: TextTaskOptionTexts): Command {
  command
    .option("-t, --target-lang <lang>", texts.targetLang)
    .option("-f, --format <format>", texts.format, texts.defaultFormat)
    .option("-o, --output <path>", "Output file path or '-' for stdout")
    .option("--stdout", texts.stdout, false)
    .option("--prompt <instruction>", texts.prompt)
    .option("--glossary <path-or-terms>", texts.glossary)
    .option("--gemini-model <model>", texts.geminiModel);

  return addLlmProviderOptions(command)
    .option(
      "--diarize",
      "Ask OpenRouter's elevenlabs/scribe models for speaker labels, so the transcript cache matches the main command (labels are not used for chapters or summaries)",
    )
    .option(
      "--no-diarize",
      "Do not ask for speaker labels, even if VSUB_DIARIZE or the config turns them on",
    )
    .option(
      "--stt-provider <provider>",
      "Transcription provider: openrouter, groq, or openai-compatible (default: VSUB_STT_PROVIDER, config, or chosen from your API keys)",
    )
    .option(
      "--stt-model <model>",
      "Transcription model for the chosen provider (default: elevenlabs/scribe-v2 on OpenRouter, whisper-large-v3-turbo on Groq, the configured model on openai-compatible)",
    )
    .option(
      "--groq-model <model>",
      "Groq Whisper model to use if media transcription is needed (used only when the provider is groq)",
    )
    .option(
      "--whisper-prompt <text>",
      "Groq Whisper recognition prompt hint (Groq and openai-compatible; not sent to OpenRouter)",
    )
    .option("-w, --overwrite", "Overwrite existing output file without confirmation prompt", false)
    .option("--backup", "Create backup (.bak) of existing output file before overwriting", false)
    .option("--no-cache", "Do not use or save intermediate cache")
    .option("--fresh", texts.fresh, false)
    .option("--cache-dir <dir>", "Custom cache directory path")
    .option("--verbose", "Output detailed log messages", false);
}

interface TextTaskActionOptions {
  diarize?: boolean | undefined;
  targetLang?: string;
  format?: string;
  output?: string;
  stdout?: boolean;
  prompt?: string;
  glossary?: string | undefined;
  geminiModel?: string;
  llmProvider?: string;
  llmModel?: string;
  sttProvider?: string;
  sttModel?: string;
  groqModel?: string;
  whisperPrompt?: string;
  overwrite?: boolean;
  backup?: boolean;
  noCache?: boolean;
  fresh?: boolean;
  cacheDir?: string;
  verbose?: boolean;
  lang?: string;
  noUpdateCheck?: boolean;
}

function createTextTaskAction<Format>(
  parseFormat: (input: string | undefined, lang: string) => Format,
  run: (options: Omit<ProcessChaptersOptions, "format"> & { format: Format }) => Promise<unknown>,
) {
  return async (file: string, _actionOpts: Record<string, unknown>, cmd: Command) => {
    const options = readActionOptions<TextTaskActionOptions>(cmd);

    const rawConfig = getConfig(undefined, options.lang);
    const lang = options.lang ?? rawConfig.lang ?? "en";
    const isStdout = Boolean(options.stdout || options.output === "-");

    try {
      const format = parseFormat(options.format, lang);
      await run({
        inputFile: file,
        diarize: options.diarize,
        targetLang: options.targetLang,
        format,
        output: options.output,
        stdout: options.stdout,
        prompt: options.prompt,
        glossary: options.glossary,
        geminiModel: options.geminiModel,
        llmProvider: options.llmProvider,
        llmModel: options.llmModel,
        sttProvider: options.sttProvider,
        sttModel: options.sttModel,
        groqModel: options.groqModel,
        whisperPrompt: options.whisperPrompt,
        overwrite: options.overwrite,
        backup: options.backup,
        noCache: options.noCache,
        fresh: options.fresh,
        cacheDir: options.cacheDir,
        verbose: options.verbose,
        lang: normalizeLanguage(lang),
      });

      if (!isStdout) {
        await notifyUpdateIfAvailable({
          lang: normalizeLanguage(lang),
          disableUpdateCheck: Boolean(options.noUpdateCheck || rawConfig.disableUpdateCheck),
        });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(pc.red(`\n✖ ${message}`));
      process.exit(1);
    }
  };
}

function addMediaOptions(command: Command): Command {
  command
    .option(
      "--diarize",
      "Ask OpenRouter's elevenlabs/scribe models for speaker labels and pass them to translation; subtitles are also cut where the speaker changes (default: VSUB_DIARIZE, config, or off)",
    )
    .option(
      "--no-diarize",
      "Do not ask for speaker labels, even if VSUB_DIARIZE or the config turns them on",
    )
    .option("-w, --overwrite", "Overwrite existing output files without confirmation prompt", false)
    .option("--backup", "Create backup (.bak) of existing output files before overwriting", false)
    .option(
      "-b, --bilingual",
      "Generate bilingual subtitles combining original and translated text",
      false,
    )
    .option(
      "--bilingual-order <order>",
      "Order of bilingual subtitles: original-first (default) or target-first",
      "original-first",
    )
    .option(
      "--ffmpeg-path <path>",
      "Path to ffmpeg executable (searches VSUB_FFMPEG_PATH or PATH if omitted)",
    )
    .option(
      "--stt-provider <provider>",
      "Transcription provider: openrouter, groq, or openai-compatible (default: VSUB_STT_PROVIDER, config, or chosen from your API keys)",
    )
    .option(
      "--stt-model <model>",
      "Transcription model for the chosen provider (default: elevenlabs/scribe-v2 on OpenRouter, whisper-large-v3-turbo on Groq, the configured model on openai-compatible)",
    )
    .option(
      "--groq-model <model>",
      "Groq Whisper model to use for transcription (used only when the provider is groq)",
    )
    .option(
      "--whisper-prompt <text>",
      "Prompt hint for Groq Whisper speech recognition (Groq and openai-compatible; not sent to OpenRouter)",
    );

  addTranslationOptions(command)
    .option("--no-cache", "Do not use or save intermediate transcription/translation cache")
    .option(
      "--fresh",
      "Ignore existing cache and generate fresh transcription/translations, overwriting cache",
      false,
    )
    .option("--cache-dir <path>", "Custom cache directory");

  addContextWindowOption(command)
    .option("--burn", "Burn generated subtitles directly into output video (hardsub)", false)
    .option(
      "--burn-position <position>",
      "Subtitle position for --burn: bottom (default), top, center",
    )
    .option(
      "--burn-font-size <size>",
      "Subtitle font size for --burn: small, medium, large, or number",
    )
    .option(
      "--embed",
      "Embed generated subtitles directly as soft subtitle tracks into output video",
      false,
    )
    .option("--keep-audio", "Keep intermediate extracted audio files without deleting", false)
    .option("--no-translate", "Skip translation and output raw transcribed subtitles")
    .option(
      "--save-original",
      "Save original transcription subtitle file alongside the result",
      false,
    )
    .option(
      "--refine",
      "Correct speech recognition errors in the transcript with the text generation model before translation (default: VSUB_REFINE, config, or off; uses --glossary, --prompt, and --context; timing and line count are kept)",
    )
    .option(
      "--no-refine",
      "Do not refine the transcript, even if VSUB_REFINE or the config turns it on",
    )
    .option(
      "--force-translate",
      "Force translation even if detected language matches target language",
      false,
    );

  return addReflowOptions(command);
}

function addTranslationOptions(command: Command): Command {
  return addLlmProviderOptions(
    command
      .option("--prompt <instruction>", "Additional instruction prompt for translation")
      .option(
        "--context <text-or-path>",
        "Background notes about the speakers, their relationships, and the setting, as text or a text file path (passed to translation and --refine as context, not as instructions)",
      )
      .option(
        "--auto-context",
        "Have the text generation model write short scene notes (speakers, relationships, politeness) from the whole transcript and pass them to translation, once per target language (default: VSUB_AUTO_CONTEXT, config, or off; ignored when --context is given)",
      )
      .option(
        "--no-auto-context",
        "Do not write scene notes, even if VSUB_AUTO_CONTEXT or the config turns them on",
      )
      .option(
        "--glossary <path-or-terms>",
        "Glossary file path (JSON) or inline terms (key=val,key=val)",
      )
      .option("--concurrency <number>", "Number of concurrent translation requests")
      .option(
        "--gemini-model <model>",
        "Gemini model to use for translation (Gemini provider only)",
      ),
  );
}

function addContextWindowOption(command: Command): Command {
  return command.option(
    "--context-window <lines>",
    "Number of preceding context lines to carry across translation chunks (0 to disable)",
    "5",
  );
}

export function createProgram(): Command {
  const program = new Command();

  program
    .name("vsub")
    .version(getCurrentVersion())
    .description(
      "CLI tool to extract audio from video/audio files, transcribe speech via OpenRouter (ElevenLabs Scribe v2, default) or Groq Whisper, and generate multilingual subtitles (.srt, .vtt, .txt, .json) via Gemini directly or through OpenRouter.",
    )
    .enablePositionalOptions()
    .option("-l, --lang <lang>", "UI display language (en, ja)")
    .option("--no-update-check", "Disable checking for new version updates");

  // Subcommand: update / upgrade
  program
    .command("update")
    .alias("upgrade")
    .description("Update vsub-cli standalone binary to the latest release")
    .option("-f, --force", "Force re-install even if already on the latest version", false)
    .option("--check", "Check for updates without downloading or installing", false)
    .option("--verbose", "Output detailed logs", false)
    .action(
      async (options: { force?: boolean; check?: boolean; verbose?: boolean }, cmd: Command) => {
        const actionOptions = readActionOptions<{ lang?: string }>(cmd);
        const rawConfig = getConfig(undefined, actionOptions.lang);
        const lang = actionOptions.lang ?? rawConfig.lang ?? "en";
        const i18n = getI18n(lang);
        const m = i18n.update;

        // Check if running in npm/Node.js environment
        if (!isStandaloneBinary()) {
          console.log(`\n${pc.yellow(`💡 ${m.npmEnvNotice}`)}`);
          console.log(pc.cyan(`   ${m.npmEnvUpdateHint("npm i -g vsub-cli@latest")}\n`));
          return;
        }

        if (options.check) {
          const spinner = createSpinner(m.checking, { isSilent: options.verbose });
          spinner.start();
          const checkResult = await checkUpdate({ force: true });
          if (checkResult?.updateAvailable) {
            spinner.info(m.checkAvailable(checkResult.latestVersion, checkResult.currentVersion));
            console.log(`\n${formatUpdateNotification(checkResult, lang)}\n`);
          } else {
            showSpinnerNotice(
              spinner,
              Boolean(options.verbose),
              "succeed",
              m.alreadyLatest(getCurrentVersion()),
            );
          }
          return;
        }

        const spinner = createSpinner(m.checking, { isSilent: options.verbose });
        spinner.start();

        try {
          const result = await performSelfUpdate({
            force: options.force,
            lang,
          });

          if (result.alreadyLatest) {
            showSpinnerNotice(
              spinner,
              Boolean(options.verbose),
              "succeed",
              m.alreadyLatest(result.previousVersion),
            );
            return;
          }

          showSpinnerNotice(spinner, Boolean(options.verbose), "succeed", m.successTitle);
          console.log(`\n${formatSelfUpdateSummary(result, lang)}\n`);
        } catch (err: unknown) {
          showSpinnerNotice(
            spinner,
            Boolean(options.verbose),
            "fail",
            err instanceof Error ? err.message : String(err),
          );
          process.exit(1);
        }
      },
    );

  // Subcommand: licenses
  program
    .command("licenses")
    .description("Display third-party open source licenses and legal notices")
    .option("--full", "Display full license text for all bundled dependencies")
    .action((options: { full?: boolean }, cmd: Command) => {
      const actionOptions = readActionOptions<{ lang?: string }>(cmd);
      const rawConfig = getConfig(undefined, actionOptions.lang);
      const lang = actionOptions.lang ?? rawConfig.lang ?? "en";
      printLicenses({ full: options.full, lang });
    });

  // Subcommand: config
  const configCmd = program.command("config").description("Manage global configuration settings");

  configCmd
    .command("path")
    .description("Display global configuration file path")
    .action((_options: unknown, cmd: Command) => {
      const { lang } = readActionOptions<{ lang?: string }>(cmd);
      const m = getI18n(lang ?? getConfig(undefined, lang).lang ?? "en").config;
      console.log(m.pathLine(getGlobalConfigPath()));
    });

  configCmd
    .command("show")
    .description("Display current settings")
    .action((_options: unknown, cmd: Command) => {
      const { lang } = readActionOptions<{ lang?: string }>(cmd);
      const configPath = getGlobalConfigPath();
      const resolvedConfig = getConfig(undefined, lang);
      const m = getI18n(lang ?? resolvedConfig.lang ?? "en").config;
      const labels = m.showLabels;
      const describeProvider = (label: string, model: string, source: string) =>
        `${label} ${model ? `(${model})` : m.notConfigured} [${source}]`;

      console.log(`\n${m.showHeader(configPath)}`);
      console.log("----------------------------------------");
      let transcriptionText: string;
      try {
        const { stt } = resolveSttSettings(resolvedConfig, {});
        const label = STT_PROVIDER_LABELS[stt.provider];
        transcriptionText = describeProvider(label, stt.model, stt.source);
      } catch {
        transcriptionText = m.invalidProvider(`${resolvedConfig.sttProvider}`);
      }
      let textGenText: string;
      try {
        const { llm } = resolveLlmSettings(resolvedConfig, {});
        const label = LLM_PROVIDER_LABELS[llm.provider];
        textGenText = describeProvider(label, llm.model, llm.source);
      } catch {
        textGenText = m.invalidProvider(`${resolvedConfig.llmProvider}`);
      }
      const rows: [string, string | undefined][] = [
        [labels.lang, resolvedConfig.lang || "en"],
        [labels.targetLang, resolvedConfig.targetLang || "ja"],
        [
          labels.groqApiKey,
          resolvedConfig.groqApiKey
            ? `${resolvedConfig.groqApiKey.slice(0, 4)}...${resolvedConfig.groqApiKey.slice(-4)}`
            : m.notConfigured,
        ],
        [
          labels.geminiApiKey,
          resolvedConfig.geminiApiKey
            ? `${resolvedConfig.geminiApiKey.slice(0, 4)}...${resolvedConfig.geminiApiKey.slice(-4)}`
            : m.notConfigured,
        ],
        [
          labels.openrouterApiKey,
          resolvedConfig.openrouterApiKey
            ? `${resolvedConfig.openrouterApiKey.slice(0, 4)}...${resolvedConfig.openrouterApiKey.slice(-4)}`
            : m.notConfigured,
        ],
        [labels.transcription, transcriptionText],
        [labels.textGeneration, textGenText],
        [labels.refine, resolvedConfig.refine === true ? m.enabled : m.disabled],
        [labels.diarize, resolvedConfig.diarize === true ? m.enabled : m.disabled],
        [labels.autoContext, resolvedConfig.autoContext === true ? m.enabled : m.disabled],
        [labels.ffmpegPath, `${resolvedConfig.ffmpegPath}`],
        [
          labels.whisperPrompt,
          resolvedConfig.whisperPrompt ? `"${resolvedConfig.whisperPrompt}"` : undefined,
        ],
        [labels.prompt, resolvedConfig.prompt ? `"${resolvedConfig.prompt}"` : undefined],
        [labels.glossary, resolvedConfig.glossary ? `"${resolvedConfig.glossary}"` : undefined],
        [labels.geminiModel, resolvedConfig.geminiModel || undefined],
        [labels.groqModel, resolvedConfig.groqModel || undefined],
        [labels.openrouterSttModel, resolvedConfig.openrouterSttModel || undefined],
        [labels.openrouterLlmModel, resolvedConfig.openrouterLlmModel || undefined],
        [labels.openaiCompatibleSttBaseUrl, resolvedConfig.openaiCompatibleSttBaseUrl || undefined],
        [
          labels.openaiCompatibleSttApiKey,
          resolvedConfig.openaiCompatibleSttApiKey
            ? `${resolvedConfig.openaiCompatibleSttApiKey.slice(0, 4)}...${resolvedConfig.openaiCompatibleSttApiKey.slice(-4)}`
            : undefined,
        ],
        [labels.openaiCompatibleSttModel, resolvedConfig.openaiCompatibleSttModel || undefined],
        [labels.openaiCompatibleLlmBaseUrl, resolvedConfig.openaiCompatibleLlmBaseUrl || undefined],
        [
          labels.openaiCompatibleLlmApiKey,
          resolvedConfig.openaiCompatibleLlmApiKey
            ? `${resolvedConfig.openaiCompatibleLlmApiKey.slice(0, 4)}...${resolvedConfig.openaiCompatibleLlmApiKey.slice(-4)}`
            : undefined,
        ],
        [labels.openaiCompatibleLlmModel, resolvedConfig.openaiCompatibleLlmModel || undefined],
        [
          labels.openaiCompatibleLlmReasoningEffort,
          resolvedConfig.openaiCompatibleLlmReasoningEffort || undefined,
        ],
        [
          labels.concurrency,
          resolvedConfig.concurrency !== undefined ? `${resolvedConfig.concurrency}` : undefined,
        ],
        [
          labels.maxLength,
          resolvedConfig.maxLength ? m.chars(resolvedConfig.maxLength) : undefined,
        ],
        [labels.burnPosition, resolvedConfig.burnPosition || undefined],
        [
          labels.burnFontSize,
          resolvedConfig.burnFontSize ? `${resolvedConfig.burnFontSize}` : undefined,
        ],
        [labels.updateCheck, resolvedConfig.disableUpdateCheck ? m.disabled : m.enabled],
      ];
      const visibleRows = rows.filter(([, value]) => value !== undefined);
      const LABEL_WIDTH = Math.max(...visibleRows.map(([label]) => displayWidth(label)));
      for (const [label, value] of visibleRows) {
        console.log(`${padEndToWidth(label, LABEL_WIDTH)} : ${value}`);
      }
      console.log("----------------------------------------\n");
    });

  configCmd
    .command("set")
    .description(
      "Save API Keys, models, OpenAI-compatible endpoints, prompts, glossary, concurrency, language, target language, transcript refinement, speaker labels, scene notes, or FFmpeg path to global config",
    )
    .option("-l, --lang <lang>", "UI display language (en, ja)")
    .option(
      "--target-lang <langs>",
      "Default target language code(s), comma-separated (e.g., ja, en, zh-TW)",
    )
    .option("--groq-key <key>", "Groq API Key")
    .option("--gemini-key <key>", "Gemini API Key")
    .option("--openrouter-key <key>", "OpenRouter API Key (for transcription and text generation)")
    .option(
      "--stt-provider <provider>",
      "Default transcription provider: openrouter, groq, or openai-compatible",
    )
    .option(
      "--openrouter-stt-model <model>",
      "Default OpenRouter transcription model (e.g. elevenlabs/scribe-v2)",
    )
    .option(
      "--llm-provider <provider>",
      "Default text generation provider: gemini, openrouter, or openai-compatible",
    )
    .option(
      "--openrouter-llm-model <model>",
      "Default OpenRouter text generation model (e.g. google/gemini-3.8-flash)",
    )
    .option(
      "--openai-compatible-stt-base-url <url>",
      "Base URL of an OpenAI-compatible transcription API (e.g. http://localhost:8000/v1; untested)",
    )
    .option(
      "--openai-compatible-stt-key <key>",
      "API key for the OpenAI-compatible transcription API (optional)",
    )
    .option(
      "--openai-compatible-stt-model <model>",
      "Model for the OpenAI-compatible transcription API (e.g. whisper-1)",
    )
    .option(
      "--openai-compatible-llm-base-url <url>",
      "Base URL of an OpenAI-compatible text generation API (e.g. http://localhost:11434/v1; untested)",
    )
    .option(
      "--openai-compatible-llm-key <key>",
      "API key for the OpenAI-compatible text generation API (optional)",
    )
    .option(
      "--openai-compatible-llm-model <model>",
      "Model for the OpenAI-compatible text generation API (must support JSON schema output)",
    )
    .option(
      "--openai-compatible-llm-reasoning-effort <effort>",
      "Reasoning effort sent as reasoning_effort to the OpenAI-compatible text generation API (e.g. low; passed through as-is, not sent unless set)",
    )
    .option("--ffmpeg-path <path>", "Path to ffmpeg executable")
    .option("--gemini-model <model>", "Default Gemini translation model (e.g. gemini-3.8-flash)")
    .option(
      "--groq-model <model>",
      "Default Groq Whisper transcription model (e.g. whisper-large-v3-turbo)",
    )
    .option("--whisper-prompt <text>", "Default Whisper recognition prompt hint")
    .option("--prompt <instruction>", "Default translation instruction prompt")
    .option("--glossary <path-or-terms>", "Default glossary file path (JSON) or inline terms")
    .option("--concurrency <number>", "Default concurrent translation requests (e.g. 3)")
    .option("--disable-update-check <boolean>", "Disable periodic update checks (true/false)")
    .option(
      "--refine <boolean>",
      "Refine the transcript with the text generation model by default in the main command and batch (true/false)",
    )
    .option(
      "--diarize <boolean>",
      "Ask OpenRouter's elevenlabs/scribe models for speaker labels by default in the main command, batch, chapters, and summarize (true/false)",
    )
    .option("--max-length <chars>", "Default max characters per subtitle entry (e.g. 60)")
    .option(
      "--auto-context <boolean>",
      "Write scene notes for translation by default in the main command, batch, and translate (true/false)",
    )
    .option("--burn-position <position>", "Default subtitle burn position (bottom, top, center)")
    .option(
      "--burn-font-size <size>",
      "Default subtitle burn font size (small, medium, large, or number)",
    )
    .action(
      (options: {
        lang?: string;
        targetLang?: string;
        groqKey?: string;
        geminiKey?: string;
        openrouterKey?: string;
        sttProvider?: string;
        openrouterSttModel?: string;
        llmProvider?: string;
        openrouterLlmModel?: string;
        openaiCompatibleSttBaseUrl?: string;
        openaiCompatibleSttKey?: string;
        openaiCompatibleSttModel?: string;
        openaiCompatibleLlmBaseUrl?: string;
        openaiCompatibleLlmKey?: string;
        openaiCompatibleLlmModel?: string;
        openaiCompatibleLlmReasoningEffort?: string;
        ffmpegPath?: string;
        geminiModel?: string;
        groqModel?: string;
        whisperPrompt?: string;
        prompt?: string;
        glossary?: string;
        concurrency?: string;
        disableUpdateCheck?: string;
        refine?: string;
        diarize?: string;
        autoContext?: string;
        maxLength?: string;
        burnPosition?: string;
        burnFontSize?: string;
      }) => {
        let concurrencyNum: number | undefined;
        if (options.concurrency) {
          const n = Number(options.concurrency);
          if (!Number.isNaN(n) && n > 0) {
            concurrencyNum = Math.floor(n);
          }
        }

        let disableUpdateCheckVal: boolean | undefined;
        if (options.disableUpdateCheck !== undefined) {
          const val = String(options.disableUpdateCheck).toLowerCase();
          disableUpdateCheckVal = val === "true" || val === "1";
        }

        const maxLengthNum = parsePositiveInteger(options.maxLength);

        const normalizedLang = options.lang ? normalizeLanguage(options.lang) : undefined;
        const m = getI18n(normalizedLang ?? getConfig().lang).config;
        if (options.lang && !normalizedLang) {
          console.error(pc.red(`\n✖ ${m.invalidDisplayLang(options.lang)}\n`));
          return process.exit(1);
        }

        const refineVal = parseBooleanSetting(options.refine);
        const diarizeVal = parseBooleanSetting(options.diarize);
        const autoContextVal = parseBooleanSetting(options.autoContext);
        if (options.autoContext !== undefined && autoContextVal === undefined) {
          console.error(pc.red(`\n✖ ${m.invalidAutoContext(options.autoContext)}\n`));
          return process.exit(1);
        }
        if (options.diarize !== undefined && diarizeVal === undefined) {
          console.error(pc.red(`\n✖ ${m.invalidDiarize(options.diarize)}\n`));
          return process.exit(1);
        }
        if (options.refine !== undefined && refineVal === undefined) {
          console.error(pc.red(`\n✖ ${m.invalidRefine(options.refine)}\n`));
          return process.exit(1);
        }

        let targetLangVal: string | undefined;
        if (options.targetLang !== undefined) {
          try {
            targetLangVal = normalizeTargetLangSetting(options.targetLang, normalizedLang);
          } catch (err) {
            console.error(pc.red(`\n✖ ${err instanceof Error ? err.message : String(err)}\n`));
            return process.exit(1);
          }
        }

        let sttProviderVal: SttProvider | undefined;
        if (options.sttProvider) {
          try {
            sttProviderVal = parseSttProvider(options.sttProvider, normalizedLang);
          } catch (err) {
            console.error(pc.red(`\n✖ ${err instanceof Error ? err.message : String(err)}\n`));
            return process.exit(1);
          }
        }

        let llmProviderVal: LlmProvider | undefined;
        if (options.llmProvider) {
          try {
            llmProviderVal = parseLlmProvider(options.llmProvider, normalizedLang);
          } catch (err) {
            console.error(pc.red(`\n✖ ${err instanceof Error ? err.message : String(err)}\n`));
            return process.exit(1);
          }
        }

        const compatibleConfig: Partial<AppConfig> = {};
        const compatibleSides = ["stt", "llm"] as const;
        for (const side of compatibleSides) {
          const baseUrlKey =
            side === "stt" ? "openaiCompatibleSttBaseUrl" : "openaiCompatibleLlmBaseUrl";
          const keyOption = side === "stt" ? "openaiCompatibleSttKey" : "openaiCompatibleLlmKey";
          const apiKey = side === "stt" ? "openaiCompatibleSttApiKey" : "openaiCompatibleLlmApiKey";
          const modelKey = side === "stt" ? "openaiCompatibleSttModel" : "openaiCompatibleLlmModel";
          const rawUrl = options[baseUrlKey];
          if (rawUrl !== undefined) {
            if (!isHttpBaseUrl(rawUrl)) {
              const example =
                side === "stt" ? "http://localhost:8000/v1" : "http://localhost:11434/v1";
              console.error(
                pc.red(
                  `\n✖ ${m.invalidOpenAICompatibleUrl(`--openai-compatible-${side}-base-url`, rawUrl.trim(), example)}\n`,
                ),
              );
              return process.exit(1);
            }
            compatibleConfig[baseUrlKey] = normalizeBaseUrl(rawUrl);
          }
          const key = options[keyOption]?.trim();
          const model = options[modelKey]?.trim();
          if (key) compatibleConfig[apiKey] = key;
          if (model) compatibleConfig[modelKey] = model;
        }
        const reasoningEffort = options.openaiCompatibleLlmReasoningEffort?.trim();
        if (reasoningEffort) compatibleConfig.openaiCompatibleLlmReasoningEffort = reasoningEffort;

        let burnPositionVal: string | undefined;
        if (options.burnPosition) {
          try {
            burnPositionVal = parseBurnPosition(options.burnPosition, normalizedLang);
          } catch (err) {
            console.error(pc.red(`\n✖ ${err instanceof Error ? err.message : String(err)}\n`));
            process.exit(1);
          }
        }

        let burnFontSizeVal: number | undefined;
        if (options.burnFontSize) {
          try {
            burnFontSizeVal = parseBurnFontSize(options.burnFontSize, normalizedLang);
          } catch (err) {
            console.error(pc.red(`\n✖ ${err instanceof Error ? err.message : String(err)}\n`));
            process.exit(1);
          }
        }

        if (
          !options.lang &&
          targetLangVal === undefined &&
          !options.groqKey &&
          !options.geminiKey &&
          !options.openrouterKey &&
          !options.sttProvider &&
          !options.llmProvider &&
          !options.openrouterSttModel &&
          !options.openrouterLlmModel &&
          Object.keys(compatibleConfig).length === 0 &&
          !options.ffmpegPath &&
          !options.geminiModel &&
          !options.groqModel &&
          !options.whisperPrompt &&
          !options.prompt &&
          !options.glossary &&
          concurrencyNum === undefined &&
          disableUpdateCheckVal === undefined &&
          refineVal === undefined &&
          diarizeVal === undefined &&
          autoContextVal === undefined &&
          maxLengthNum === undefined &&
          burnPositionVal === undefined &&
          burnFontSizeVal === undefined
        ) {
          console.log(m.setNothing);
          return;
        }

        try {
          saveGlobalConfig(
            {
              ...compatibleConfig,
              ...(normalizedLang ? { lang: normalizedLang } : {}),
              ...(refineVal !== undefined ? { refine: refineVal } : {}),
              ...(diarizeVal !== undefined ? { diarize: diarizeVal } : {}),
              ...(autoContextVal !== undefined ? { autoContext: autoContextVal } : {}),
              ...(targetLangVal !== undefined ? { targetLang: targetLangVal } : {}),
              ...(options.groqKey ? { groqApiKey: options.groqKey.trim() } : {}),
              ...(options.geminiKey ? { geminiApiKey: options.geminiKey.trim() } : {}),
              ...(options.openrouterKey ? { openrouterApiKey: options.openrouterKey.trim() } : {}),
              ...(sttProviderVal ? { sttProvider: sttProviderVal } : {}),
              ...(options.openrouterSttModel
                ? { openrouterSttModel: options.openrouterSttModel.trim() }
                : {}),
              ...(llmProviderVal ? { llmProvider: llmProviderVal } : {}),
              ...(options.openrouterLlmModel
                ? { openrouterLlmModel: options.openrouterLlmModel.trim() }
                : {}),
              ...(options.ffmpegPath ? { ffmpegPath: options.ffmpegPath.trim() } : {}),
              ...(options.geminiModel ? { geminiModel: options.geminiModel.trim() } : {}),
              ...(options.groqModel ? { groqModel: options.groqModel.trim() } : {}),
              ...(options.whisperPrompt ? { whisperPrompt: options.whisperPrompt.trim() } : {}),
              ...(options.prompt ? { prompt: options.prompt.trim() } : {}),
              ...(options.glossary ? { glossary: options.glossary.trim() } : {}),
              ...(concurrencyNum !== undefined ? { concurrency: concurrencyNum } : {}),
              ...(disableUpdateCheckVal !== undefined
                ? { disableUpdateCheck: disableUpdateCheckVal }
                : {}),
              ...(maxLengthNum !== undefined ? { maxLength: maxLengthNum } : {}),
              ...(burnPositionVal ? { burnPosition: burnPositionVal } : {}),
              ...(burnFontSizeVal !== undefined ? { burnFontSize: burnFontSizeVal } : {}),
            },
            { lang: normalizedLang ?? getConfig().lang },
          );
        } catch (err) {
          console.error(pc.red(`\n✖ ${err instanceof Error ? err.message : String(err)}\n`));
          return process.exit(1);
        }

        console.log(m.setSaved(getGlobalConfigPath()));
      },
    );

  addInitCommand(
    configCmd,
    "Interactive setup wizard to configure API keys and preferences (alias to vsub init)",
  );

  // Subcommand: init (Top-level wizard)
  addInitCommand(
    program,
    "Interactive setup wizard to choose the transcription and text generation providers and verify API keys, FFmpeg, and preferences",
  );

  // Subcommand: cache
  const cacheCmd = program
    .command("cache")
    .description("Manage intermediate transcription and translation cache");

  cacheCmd
    .command("path")
    .description("Display cache directory path")
    .option("--cache-dir <path>", "Custom cache directory")
    .action((options: { cacheDir?: string }, cmd: Command) => {
      const { lang } = readActionOptions<{ lang?: string }>(cmd);
      const m = getI18n(lang ?? getConfig(undefined, lang).lang ?? "en").cache;
      console.log(m.pathLine(getCacheDir(options.cacheDir)));
    });

  cacheCmd
    .command("stats")
    .description("Display cache usage and entry counts")
    .option("--cache-dir <path>", "Custom cache directory")
    .action((options: { cacheDir?: string }, cmd: Command) => {
      const { lang } = readActionOptions<{ lang?: string }>(cmd);
      const m = getI18n(lang ?? getConfig(undefined, lang).lang ?? "en").cache;
      const stats = getCacheStats(options.cacheDir);
      console.log(`\n${m.statsHeader(stats.cacheDir)}`);
      console.log("----------------------------------------");
      const rows: [string, string][] = [
        [m.statsLabels.count, m.files(stats.count)],
        [m.statsLabels.totalSize, formatFileSize(stats.totalBytes)],
      ];
      const LABEL_WIDTH = Math.max(...rows.map(([label]) => displayWidth(label)));
      for (const [label, value] of rows) {
        console.log(`${padEndToWidth(label, LABEL_WIDTH)} : ${value}`);
      }
      console.log("----------------------------------------\n");
    });

  cacheCmd
    .command("clean")
    .description("Delete all intermediate cache files")
    .option("--cache-dir <path>", "Custom cache directory")
    .action((options: { cacheDir?: string }, cmd: Command) => {
      const { lang } = readActionOptions<{ lang?: string }>(cmd);
      const m = getI18n(lang ?? getConfig(undefined, lang).lang ?? "en").cache;
      const result = clearCache(options.cacheDir);
      console.log(
        m.cleaned(result.deletedCount, formatFileSize(result.freedBytes), result.cacheDir),
      );
    });

  // Subcommand: chapters
  const chaptersCmd = program
    .command("chapters")
    .description(
      "Generate video chapters (table of contents) from media or subtitle files via Gemini or OpenRouter",
    )
    .argument("<file>", "Media file (.mp4, .mp3, etc.) or subtitle file (.srt)");

  addTextTaskOptions(chaptersCmd, {
    targetLang:
      "Target language for chapter titles; only the first is used if several are given (default: config or ja)",
    format: "Output format: txt (YouTube format), json, vtt (default: txt)",
    defaultFormat: "txt",
    stdout: "Output chapters directly to stdout",
    prompt: "Additional instruction prompt for chapter generation",
    glossary:
      "Glossary file path (JSON) or inline terms (key=val,key=val) for names and terms in chapter titles and Groq recognition hints (default: VSUB_GLOSSARY or config)",
    geminiModel: "Gemini model to use for chapters generation (Gemini provider only)",
    fresh: "Ignore existing cache and generate fresh chapters, overwriting cache",
  }).action(createTextTaskAction(parseChaptersFormat, processChaptersPipeline));

  // Subcommand: summarize
  const summarizeCmd = program
    .command("summarize")
    .description(
      "Generate structured summary and key topic highlights from media or subtitle files via Gemini or OpenRouter",
    )
    .argument("<file>", "Media file (.mp4, .mp3, etc.) or subtitle file (.srt)");

  addTextTaskOptions(summarizeCmd, {
    targetLang:
      "Target language for summary; only the first is used if several are given (default: config or ja)",
    format: "Output format: md (Markdown), txt, json (default: md)",
    defaultFormat: "md",
    stdout: "Output summary directly to stdout",
    prompt: "Additional instruction prompt for summary generation",
    glossary:
      "Glossary file path (JSON) or inline terms (key=val,key=val) for names and terms in the summary and Groq recognition hints (default: VSUB_GLOSSARY or config)",
    geminiModel: "Gemini model to use for summary generation (Gemini provider only)",
    fresh: "Ignore existing cache and generate fresh summary, overwriting cache",
  }).action(createTextTaskAction(parseSummaryFormat, processSummaryPipeline));

  // Subcommand: translate
  const translateCmd = program
    .command("translate")
    .description(
      "Directly translate an existing subtitle file (.srt) into target language(s) via Gemini or OpenRouter",
    )
    .argument("<subtitle-file>", "Input subtitle file path (.srt)")
    .option(
      "-t, --target-lang <langs>",
      "Target language code(s), comma-separated (e.g., ja, en, es, zh-TW) (default: config or ja)",
    )
    .option(
      "-f, --format <formats>",
      "Output formats: comma-separated list of srt, vtt, txt, json",
      "srt",
    )
    .option("-o, --output <path>", "Output path or base name for the generated subtitle file")
    .option("-w, --overwrite", "Overwrite existing output files without confirmation prompt", false)
    .option("--backup", "Create backup (.bak) of existing output files before overwriting", false)
    .option(
      "-b, --bilingual",
      "Generate bilingual subtitles combining original and translated text",
      false,
    )
    .option(
      "--bilingual-order <order>",
      "Order of bilingual subtitles: original-first (default) or target-first",
      "original-first",
    );

  addTranslationOptions(translateCmd)
    .option("--no-cache", "Do not use or save intermediate translation cache")
    .option(
      "--fresh",
      "Ignore existing cache and generate fresh translations, overwriting cache",
      false,
    )
    .option("--cache-dir <path>", "Custom cache directory");

  addContextWindowOption(translateCmd).option("--gemini-key <key>", "Gemini API Key override");

  addReflowOptions(translateCmd)
    .option(
      "--stdout",
      "Output translated subtitles directly to stdout instead of saving to file",
      false,
    )
    .option("--verbose", "Output detailed log messages", false)
    .action(async (subtitleFile: string, _actionOptions: Record<string, unknown>, cmd: Command) => {
      const options = readActionOptions<TranslateCommandOptions>(cmd);
      await runTranslateCommand(subtitleFile, options);
    });

  // Subcommand: burn
  program
    .command("burn")
    .description(
      "Burn an existing subtitle file (.srt) directly into a video file via FFmpeg (hardsub)",
    )
    .argument("<video-file>", "Input video file path (.mp4, .mkv, .mov, etc.)")
    .argument("<subtitle-file>", "Input subtitle file path (.srt)")
    .option("-o, --output <path>", "Output video file path (default: <video>.subbed.mp4)")
    .option("-w, --overwrite", "Overwrite existing output files without confirmation prompt", false)
    .option("--backup", "Create backup (.bak) of existing output files before overwriting", false)
    .option(
      "--ffmpeg-path <path>",
      "Path to ffmpeg executable (searches VSUB_FFMPEG_PATH or PATH if omitted)",
    )
    .option("--burn-position <position>", "Subtitle position: bottom (default), top, center")
    .option("--burn-font-size <size>", "Subtitle font size: small, medium, large, or number")
    .option("--verbose", "Output detailed log messages", false)
    .action(
      async (
        videoFile: string,
        subtitleFile: string,
        _actionOptions: Record<string, unknown>,
        cmd: Command,
      ) => {
        const options = readActionOptions<{
          output?: string;
          overwrite?: boolean;
          backup?: boolean;
          ffmpegPath?: string;
          burnPosition?: string;
          burnFontSize?: string;
          verbose?: boolean;
          lang?: string;
          noUpdateCheck?: boolean;
        }>(cmd);
        const startTime = Date.now();
        const verbose = Boolean(options.verbose);
        const rawConfig = getConfig(options.ffmpegPath, options.lang);
        const lang = options.lang ?? rawConfig.lang ?? "en";
        const i18n = getI18n(lang);
        const bm = i18n.burn;

        const spinner = createSpinner("", { isSilent: verbose });

        try {
          const resolvedVideoPath = path.resolve(process.cwd(), videoFile);
          const resolvedSubtitlePath = path.resolve(process.cwd(), subtitleFile);

          if (!fs.existsSync(resolvedVideoPath)) {
            throw new Error(bm.videoNotFound(resolvedVideoPath));
          }
          if (!isVideoFile(resolvedVideoPath)) {
            throw new Error(bm.notVideoFile(path.basename(resolvedVideoPath)));
          }
          if (!fs.existsSync(resolvedSubtitlePath)) {
            throw new Error(bm.subtitleNotFound(resolvedSubtitlePath));
          }

          await checkFfmpeg(rawConfig.ffmpegPath, lang);

          let resolvedOutputPath: string;
          if (options.output) {
            resolvedOutputPath = path.resolve(process.cwd(), options.output);
          } else {
            const videoDir = path.dirname(resolvedVideoPath);
            const videoExt = path.extname(resolvedVideoPath);
            const videoBase = path.basename(resolvedVideoPath, videoExt);
            resolvedOutputPath = path.join(videoDir, `${videoBase}.subbed.mp4`);
          }

          // Pre-check output video file safety
          const safetyCheck = await ensureWritableTargets([resolvedOutputPath], {
            overwrite: options.overwrite,
            backup: options.backup,
            lang: normalizeLanguage(lang),
          });

          if (!safetyCheck.proceed) {
            console.log(i18n.safety.aborted);
            return;
          }

          if (safetyCheck.backedUp.length > 0) {
            for (const { original, backup } of safetyCheck.backedUp) {
              console.log(
                `📦 ${i18n.pipeline.backupCreated(pc.cyan(path.basename(original)), pc.yellow(path.basename(backup)))}`,
              );
            }
          }

          console.log(
            `\n🎬 ${pc.bold(bm.started(pc.cyan(path.basename(resolvedVideoPath)), pc.cyan(path.basename(resolvedSubtitlePath))))}`,
          );

          spinner.start(i18n.pipeline.burnStarting);
          await burnSubtitlesToVideo(resolvedVideoPath, resolvedSubtitlePath, resolvedOutputPath, {
            ffmpegPath: rawConfig.ffmpegPath,
            verbose,
            position: options.burnPosition ?? rawConfig.burnPosition,
            fontSize: options.burnFontSize ?? rawConfig.burnFontSize,
            lang,
          });
          spinner.succeed(i18n.pipeline.burnDone);

          const durationMs = Date.now() - startTime;
          let outStats: fs.Stats | undefined;
          try {
            outStats = fs.statSync(resolvedOutputPath);
          } catch {
            // ignore
          }

          let entriesCount = 0;
          try {
            const subContent = fs.readFileSync(resolvedSubtitlePath, "utf-8");
            const parsed = parseSrt(subContent);
            entriesCount = parsed.length;
          } catch {
            // ignore
          }

          console.log(
            "\n" +
              formatSummaryBox(
                {
                  mediaFile: path.basename(resolvedVideoPath),
                  mediaType: "video",
                  durationMs,
                  entriesCount,
                  backedUpFiles:
                    safetyCheck.backedUp.length > 0
                      ? safetyCheck.backedUp.map((b) => b.backup)
                      : undefined,
                  outputFiles: [
                    outStats
                      ? `${resolvedOutputPath} (${formatFileSize(outStats.size)})`
                      : resolvedOutputPath,
                  ],
                  lang: normalizeLanguage(lang),
                },
                lang,
              ) +
              "\n",
          );

          await notifyUpdateIfAvailable({
            lang: normalizeLanguage(lang),
            disableUpdateCheck: Boolean(options.noUpdateCheck || rawConfig.disableUpdateCheck),
          });
        } catch (error) {
          showSpinnerNotice(
            spinner,
            verbose,
            "fail",
            i18n.pipeline.errorOccurred(error instanceof Error ? error.message : String(error)),
          );
          if (verbose && error instanceof Error && error.stack) {
            console.error(error.stack);
          }
          process.exit(1);
        }
      },
    );

  // Subcommand: embed
  program
    .command("embed")
    .description(
      "Embed one or more subtitle files (.srt) as soft subtitle tracks into a video via FFmpeg stream copy",
    )
    .argument("<video-file>", "Input video file path (.mp4, .mkv, .mov, etc.)")
    .argument("<subtitle-files...>", "One or more subtitle files to embed as tracks (.srt)")
    .option("-o, --output <path>", "Output video file path (default: <video>.embedded.<ext>)")
    .option("-w, --overwrite", "Overwrite existing output files without confirmation prompt", false)
    .option("--backup", "Create backup (.bak) of existing output files before overwriting", false)
    .option(
      "--ffmpeg-path <path>",
      "Path to ffmpeg executable (searches VSUB_FFMPEG_PATH or PATH if omitted)",
    )
    .option("--verbose", "Output detailed log messages", false)
    .action(
      async (
        videoFile: string,
        subtitleFiles: string[],
        _actionOptions: Record<string, unknown>,
        cmd: Command,
      ) => {
        const options = readActionOptions<{
          output?: string;
          overwrite?: boolean;
          backup?: boolean;
          ffmpegPath?: string;
          verbose?: boolean;
          lang?: string;
          noUpdateCheck?: boolean;
        }>(cmd);
        const startTime = Date.now();
        const verbose = Boolean(options.verbose);
        const rawConfig = getConfig(options.ffmpegPath, options.lang);
        const lang = options.lang ?? rawConfig.lang ?? "en";
        const i18n = getI18n(lang);
        const em = i18n.embed;

        const spinner = createSpinner("", { isSilent: verbose });

        try {
          const resolvedVideoPath = path.resolve(process.cwd(), videoFile);
          if (!fs.existsSync(resolvedVideoPath)) {
            throw new Error(em.videoNotFound(resolvedVideoPath));
          }
          if (!isVideoFile(resolvedVideoPath)) {
            throw new Error(em.notVideoFile(path.basename(resolvedVideoPath)));
          }
          if (!subtitleFiles || subtitleFiles.length === 0) {
            throw new Error(em.noSubtitles);
          }

          const resolvedSubtitlePaths: string[] = [];
          for (const sub of subtitleFiles) {
            const resolvedSub = path.resolve(process.cwd(), sub);
            if (!fs.existsSync(resolvedSub)) {
              throw new Error(em.subtitleNotFound(resolvedSub));
            }
            resolvedSubtitlePaths.push(resolvedSub);
          }

          await checkFfmpeg(rawConfig.ffmpegPath, lang);

          let resolvedOutputPath: string;
          if (options.output) {
            resolvedOutputPath = path.resolve(process.cwd(), options.output);
          } else {
            const videoDir = path.dirname(resolvedVideoPath);
            const videoExt = path.extname(resolvedVideoPath);
            const videoBase = path.basename(resolvedVideoPath, videoExt);
            resolvedOutputPath = path.join(videoDir, `${videoBase}.embedded${videoExt}`);
          }

          if (!supportsSoftSubtitles(resolvedOutputPath)) {
            throw new Error(
              em.unsupportedContainer(
                path.basename(resolvedOutputPath),
                path.extname(resolvedOutputPath).toLowerCase(),
                listSoftSubtitleContainers(),
              ),
            );
          }

          if (findOutputPathConflict(resolvedVideoPath, [resolvedOutputPath])) {
            throw new Error(i18n.pipeline.outputPathConflict(path.basename(resolvedOutputPath)));
          }

          // Pre-check output video file safety
          const safetyCheck = await ensureWritableTargets([resolvedOutputPath], {
            overwrite: options.overwrite,
            backup: options.backup,
            lang: normalizeLanguage(lang),
          });

          if (!safetyCheck.proceed) {
            console.log(i18n.safety.aborted);
            return;
          }

          if (safetyCheck.backedUp.length > 0) {
            for (const { original, backup } of safetyCheck.backedUp) {
              console.log(
                `📦 ${i18n.pipeline.backupCreated(pc.cyan(path.basename(original)), pc.yellow(path.basename(backup)))}`,
              );
            }
          }

          console.log(
            `\n🎬 ${pc.bold(em.started(pc.cyan(path.basename(resolvedVideoPath)), resolvedSubtitlePaths.length))}`,
          );

          const tracks: SubtitleTrackInput[] = resolvedSubtitlePaths.map((subPath) => {
            const { language, title } = inferLanguageFromSubtitlePath(subPath);
            return {
              path: subPath,
              language,
              title,
            };
          });

          spinner.start(em.stepEmbedding);
          await embedSubtitlesToVideo(resolvedVideoPath, tracks, resolvedOutputPath, {
            ffmpegPath: rawConfig.ffmpegPath,
            verbose,
            lang,
          });
          spinner.succeed(em.stepSaved(path.basename(resolvedOutputPath)));

          const durationMs = Date.now() - startTime;
          let outStats: fs.Stats | undefined;
          try {
            outStats = fs.statSync(resolvedOutputPath);
          } catch {
            // ignore
          }

          let totalEntriesCount = 0;
          for (const subPath of resolvedSubtitlePaths) {
            try {
              const subContent = fs.readFileSync(subPath, "utf-8");
              totalEntriesCount += parseSrt(subContent).length;
            } catch {
              // ignore
            }
          }

          console.log(
            "\n" +
              formatSummaryBox(
                {
                  mediaFile: path.basename(resolvedVideoPath),
                  mediaType: "video",
                  durationMs,
                  entriesCount: totalEntriesCount,
                  backedUpFiles:
                    safetyCheck.backedUp.length > 0
                      ? safetyCheck.backedUp.map((b) => b.backup)
                      : undefined,
                  outputFiles: [
                    outStats
                      ? `${resolvedOutputPath} (${formatFileSize(outStats.size)})`
                      : resolvedOutputPath,
                  ],
                  lang: normalizeLanguage(lang),
                },
                lang,
              ) +
              "\n",
          );

          await notifyUpdateIfAvailable({
            lang: normalizeLanguage(lang),
            disableUpdateCheck: Boolean(options.noUpdateCheck || rawConfig.disableUpdateCheck),
          });
        } catch (error) {
          showSpinnerNotice(
            spinner,
            verbose,
            "fail",
            i18n.pipeline.errorOccurred(error instanceof Error ? error.message : String(error)),
          );
          if (verbose && error instanceof Error && error.stack) {
            console.error(error.stack);
          }
          process.exit(1);
        }
      },
    );

  // Subcommand: batch
  const batchCmd = program
    .command("batch")
    .description(
      "Process multiple media files in bulk (directories, multiple files, or glob patterns)",
    )
    .argument("<targets...>", "Target files, directories, or glob patterns")
    .option("-r, --recursive", "Recursively search directories for media files", true)
    .option("--no-recursive", "Do not recursively search subdirectories")
    .option("-o, --output-dir <dir>", "Directory to output generated subtitle and video files")
    .option("--fail-fast", "Abort remaining batch jobs immediately on first error", false)
    .option(
      "-t, --target-lang <langs>",
      "Target language code(s), comma-separated (e.g., ja, en, es, zh-TW) (default: config or ja)",
    )
    .option(
      "-f, --format <formats>",
      "Output formats: comma-separated list of srt, vtt, txt, json",
      "srt",
    );

  addMediaOptions(batchCmd)
    .option("--verbose", "Output detailed log messages", false)
    .action(async (targets: string[], _actionOptions: Record<string, unknown>, cmd: Command) => {
      const options = readActionOptions<
        BatchPipelineOptions & {
          format: string;
          lang?: string;
          noUpdateCheck?: boolean;
        }
      >(cmd);
      const rawConfig = getConfig(options.ffmpegPath, options.lang);
      const lang = options.lang ?? rawConfig.lang ?? "en";
      const i18n = getI18n(lang);

      try {
        const summary = await runBatchPipeline({
          ...options,
          lang: normalizeLanguage(lang),
          targets,
        });
        if (summary.failedCount > 0) {
          process.exit(1);
        }

        await notifyUpdateIfAvailable({
          lang: normalizeLanguage(lang),
          disableUpdateCheck: Boolean(options.noUpdateCheck || rawConfig.disableUpdateCheck),
        });
      } catch (error) {
        console.error(
          pc.red(
            `\n✖ ${i18n.batch.fatalError(error instanceof Error ? error.message : String(error))}`,
          ),
        );
        process.exit(1);
      }
    });

  // Main action (Media processing)
  program
    .argument(
      "[media-file]",
      "Target video or audio file path (.mp4, .mp3, .wav, .m4a, .mov, etc.)",
    )
    .option(
      "-t, --target-lang <langs>",
      "Target language code(s), comma-separated (e.g., ja, en, es, zh-TW) (default: config or ja)",
    )
    .option(
      "-f, --format <formats>",
      "Output formats: comma-separated list of srt, vtt, txt, json",
      "srt",
    )
    .option(
      "-o, --output <path>",
      "Output path or base name for the generated subtitle file(s); with --embed or --burn and a video path (e.g. out.mkv), subtitles are saved as out.<lang>.<format>",
    );

  addMediaOptions(program)
    .option("--stdout", "Output subtitles directly to stdout instead of saving to file", false)
    .option("--verbose", "Output detailed log messages", false)
    .action(
      async (
        mediaFile: string | undefined,
        _actionOptions: Record<string, unknown>,
        cmd: Command,
      ) => {
        const options = readActionOptions<
          ProcessMediaOptions & { lang?: string; noUpdateCheck?: boolean }
        >(cmd);
        const rawConfig = getConfig(options.ffmpegPath, options.lang);
        const lang = options.lang ?? rawConfig.lang ?? "en";
        const i18n = getI18n(lang);

        if (!mediaFile) {
          program.help();
          return;
        }

        const isStdout = Boolean(options.stdout || options.output === "-");

        try {
          const result = await processMediaPipeline({
            ...options,
            stdout: isStdout,
            lang: normalizeLanguage(lang),
            mediaFile,
          });

          if (result.stdoutContent !== undefined) {
            process.stdout.write(
              result.stdoutContent.endsWith("\n")
                ? result.stdoutContent
                : `${result.stdoutContent}\n`,
            );
          }

          if (!isStdout) {
            await notifyUpdateIfAvailable({
              lang: normalizeLanguage(lang),
              disableUpdateCheck: Boolean(options.noUpdateCheck || rawConfig.disableUpdateCheck),
            });
          }
        } catch (error) {
          console.error(
            pc.red(
              `\n✖ ${i18n.pipeline.errorOccurred(error instanceof Error ? error.message : String(error))}`,
            ),
          );
          const hint = getTranslationResumeHint(error, normalizeLanguage(lang));
          if (hint) console.error(hint);
          if (options.verbose && error instanceof Error && error.stack) {
            console.error(error.stack);
          }
          process.exit(1);
        }
      },
    );

  acceptGlobalOptions(program);

  return program;
}
