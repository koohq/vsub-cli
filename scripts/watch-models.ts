import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GoogleGenAI } from "@google/genai";
import { execa } from "execa";
import Groq from "groq-sdk";
import { DEFAULT_GEMINI_MODEL, DEFAULT_GROQ_MODEL } from "../src/config.js";
import { DEFAULT_OPENROUTER_LLM_MODEL } from "../src/text/openrouter.js";
import { DEFAULT_OPENROUTER_STT_MODEL } from "../src/transcribe/openrouter.js";

type Provider = "Gemini" | "Groq" | "OpenRouter (text)" | "OpenRouter (transcription)";

export interface ModelMetadata {
  id: string;
  provider: Provider;
  displayName?: string | undefined;
  description?: string | undefined;
  inputTokenLimit?: number | undefined;
  outputTokenLimit?: number | undefined;
  contextWindow?: number | undefined;
  documentationUrl?: string | undefined;
  createdDate?: string | undefined;
  expirationDate?: string | undefined;
}

export type ModelFetchResult =
  | { status: "ok"; allModels: ModelMetadata[]; candidateModels: ModelMetadata[] }
  | { status: "unavailable"; reason: string };

export interface WatchResult {
  provider: Provider;
  status: ModelFetchResult["status"];
  reason?: string | undefined;
  detectedModels: ModelMetadata[];
  newModels: ModelMetadata[];
  skippedIssues: string[];
  createdIssues: string[];
  defaultNotifications: string[];
}

export interface IssueContent {
  title: string;
  body: string;
}

export type CommandRunner = (file: string, args: readonly string[]) => Promise<{ stdout: string }>;

// Preserve historical baselines, including models no longer selected by the filter.
export const KNOWN_GEMINI_MODELS = new Set([
  DEFAULT_GEMINI_MODEL,
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-3.1-flash-lite-preview",
  "gemini-3-flash-preview",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-flash-latest",
  "gemini-flash-lite-latest",
  "gemini-omni-flash-preview",
  "gemini-omni-1.1-flash",
  "gemini-3.1-flash-live-preview",
  "gemini-2.5-pro",
  "gemini-pro-latest",
  "gemini-3.1-pro-preview",
  "gemini-4-argon",
  "gemini-4-carbon",
  "gemini-4-hydrogen", // Already reviewed; the user decided not to open an issue.
]);

export const KNOWN_GROQ_MODELS = new Set([DEFAULT_GROQ_MODEL, "whisper-large-v3"]);

export const KNOWN_OPENROUTER_TEXT_MODELS = new Set([
  "google/gemini-4-hydrogen", // Already reviewed, like the direct Gemini model.
  "google/gemini-4-carbon",
  "google/gemini-4-argon",
  DEFAULT_OPENROUTER_LLM_MODEL,
  "google/gemini-3.7-flash",
  "google/gemini-3.6-flash",
  "google/gemini-3.5-flash-lite",
  "google/gemini-3.5-flash",
  "google/gemini-3.1-flash-lite",
  "google/gemini-3.1-flash-lite-preview",
  "google/gemini-3.1-pro-preview",
  "google/gemini-3-flash-preview",
  "google/gemini-2.5-flash-lite",
  "google/gemini-2.5-flash",
  "google/gemini-2.5-pro",
  "google/gemini-2.5-pro-preview",
]);

export const KNOWN_OPENROUTER_STT_MODELS = new Set([
  "x-ai/grok-stt-2.0",
  "moondream/parakeet-ultra",
  "nvidia/nemotron-3.5-transcribe",
  "mistralai/voxtral-small-transcribe-3-0",
  "mistralai/voxtral-mini-transcribe-3-0",
  "assemblyai/universal-3-6-pro",
  DEFAULT_OPENROUTER_STT_MODEL,
  "elevenlabs/scribe-v2-medical",
  "google/gemini-3.5-transcribe",
  "fish-audio/transcribe-1-pro",
  "assemblyai/universal-3-5-pro",
  "meta/muse-voice-transcribe-1.0",
  "microsoft/mai-transcribe-2",
  "nvidia/nemotron-3.5-asr-streaming-multilingual-0.6b",
  "mistralai/voxtral-small-24b-2507-stt",
  "mistralai/voxtral-mini-3b-2507",
  "qwen/qwen3-asr-1.7b",
  "qwen/qwen3-asr-0.6b",
  "openai/gpt-transcribe",
  "fish-audio/transcribe-1",
  "x-ai/grok-stt-1.0",
  "deepgram/nova-3",
  "microsoft/mai-transcribe-1.5",
  "nvidia/parakeet-tdt-0.6b-v3",
  "mistralai/voxtral-mini-transcribe",
  "google/chirp-3",
  "openai/gpt-4o-mini-transcribe",
  "openai/whisper-large-v3",
  "openai/whisper-large-v3-turbo",
  "openai/whisper-1",
  "openai/gpt-4o-transcribe",
]);

const profiles = {
  Gemini: {
    titleProvider: "Gemini",
    defaultId: DEFAULT_GEMINI_MODEL,
    defaultConstant: "DEFAULT_GEMINI_MODEL",
    defaultFile: "src/config.ts",
    cliFlags: "--llm-provider gemini --llm-model",
    listUrl: "https://generativelanguage.googleapis.com/v1beta/models",
    documentationUrl: "https://ai.google.dev/gemini-api/docs/models",
    documentationTitle: "Google Gemini Models Documentation",
  },
  Groq: {
    titleProvider: "Groq",
    defaultId: DEFAULT_GROQ_MODEL,
    defaultConstant: "DEFAULT_GROQ_MODEL",
    defaultFile: "src/config.ts",
    cliFlags: "--stt-provider groq --stt-model",
    listUrl: "https://api.groq.com/openai/v1/models",
    documentationUrl: "https://console.groq.com/docs/models",
    documentationTitle: "Groq Supported Models Documentation",
  },
  "OpenRouter (text)": {
    titleProvider: "OpenRouter text",
    defaultId: DEFAULT_OPENROUTER_LLM_MODEL,
    defaultConstant: "DEFAULT_OPENROUTER_LLM_MODEL",
    defaultFile: "src/text/openrouter.ts",
    cliFlags: "--llm-provider openrouter --llm-model",
    listUrl: "https://openrouter.ai/api/v1/models",
    documentationUrl: "https://openrouter.ai/",
    documentationTitle: "OpenRouter Model Documentation",
  },
  "OpenRouter (transcription)": {
    titleProvider: "OpenRouter transcription",
    defaultId: DEFAULT_OPENROUTER_STT_MODEL,
    defaultConstant: "DEFAULT_OPENROUTER_STT_MODEL",
    defaultFile: "src/transcribe/openrouter.ts",
    cliFlags: "--stt-provider openrouter --stt-model",
    listUrl: "https://openrouter.ai/api/v1/models?output_modalities=transcription",
    documentationUrl: "https://openrouter.ai/",
    documentationTitle: "OpenRouter Model Documentation",
  },
} satisfies Record<Provider, object>;

export function normalizeModelId(rawId: string): string {
  return rawId.replace(/^models\//, "");
}

export function isRelevantGeminiModel(modelId: string, supportedActions?: string[]): boolean {
  const normalized = normalizeModelId(modelId).toLowerCase();
  if (
    normalized.includes(":") ||
    !(/^gemini-\d/.test(normalized) || /^gemini-[a-z]+(?:-[a-z]+)*-latest$/.test(normalized))
  ) {
    return false;
  }
  const excludedWords = new Set([
    "image",
    "tts",
    "omni",
    "live",
    "embedding",
    "transcribe",
    "customtools",
    "robotics",
  ]);
  return (
    !normalized.split("-").some((word) => excludedWords.has(word)) &&
    !normalized.includes("native-audio") &&
    !normalized.includes("computer-use") &&
    (supportedActions === undefined || supportedActions.includes("generateContent"))
  );
}

export function isRelevantGroqModel(modelId: string): boolean {
  return modelId.toLowerCase().includes("whisper");
}

export function getModelDocumentationUrl(provider: Provider, modelId?: string): string {
  const url = profiles[provider].documentationUrl;
  return provider.startsWith("OpenRouter") ? url + (modelId ?? "") : url;
}

function unavailable(reason: string): ModelFetchResult {
  return { status: "unavailable", reason };
}

function catalog(allModels: ModelMetadata[], candidateModels: ModelMetadata[]): ModelFetchResult {
  return allModels.length === 0
    ? unavailable("The model catalog was empty.")
    : { status: "ok", allModels, candidateModels };
}

export async function fetchGeminiCandidateModels(apiKey?: string): Promise<ModelFetchResult> {
  const key = apiKey || process.env["GEMINI_API_KEY"] || process.env["VSUB_GEMINI_API_KEY"];
  if (!key) return unavailable("GEMINI_API_KEY is not configured.");
  try {
    const ai = new GoogleGenAI({ apiKey: key });
    const response = await ai.models.list();
    const allModels: ModelMetadata[] = [];
    const candidateModels: ModelMetadata[] = [];
    for await (const model of response) {
      if (typeof model?.name !== "string" || model.name.trim() === "") {
        return unavailable("Invalid Gemini model catalog.");
      }
      const metadata: ModelMetadata = {
        id: normalizeModelId(model.name),
        provider: "Gemini",
        displayName: model.displayName,
        description: model.description,
        inputTokenLimit: model.inputTokenLimit,
        outputTokenLimit: model.outputTokenLimit,
        documentationUrl: getModelDocumentationUrl("Gemini"),
      };
      allModels.push(metadata);
      if (isRelevantGeminiModel(metadata.id, model.supportedActions))
        candidateModels.push(metadata);
    }
    return catalog(allModels, candidateModels);
  } catch {
    return unavailable("Failed to fetch Gemini model catalog.");
  }
}

export async function fetchGroqCandidateModels(apiKey?: string): Promise<ModelFetchResult> {
  const key = apiKey || process.env["GROQ_API_KEY"] || process.env["VSUB_GROQ_API_KEY"];
  if (!key) return unavailable("GROQ_API_KEY is not configured.");
  try {
    const groq = new Groq({ apiKey: key });
    const response = await groq.models.list();
    if (!Array.isArray(response?.data)) return unavailable("Invalid Groq model catalog.");
    const allModels: ModelMetadata[] = [];
    for (const model of response.data) {
      if (typeof model?.id !== "string" || model.id.trim() === "") {
        return unavailable("Invalid Groq model catalog.");
      }
      allModels.push({
        id: model.id,
        provider: "Groq",
        contextWindow: (model as { context_window?: number | null }).context_window ?? undefined,
        documentationUrl: getModelDocumentationUrl("Groq"),
      });
    }
    return catalog(
      allModels,
      allModels.filter((model) => isRelevantGroqModel(model.id)),
    );
  } catch {
    return unavailable("Failed to fetch Groq model catalog.");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

interface OpenRouterModel {
  id: string;
  name?: string | undefined;
  description?: string | undefined;
  context_length?: number | undefined;
  created?: number | undefined;
  expiration_date?: string | undefined;
  output_modalities: string[];
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

// Only a missing id makes the whole catalog unusable (it could hide a listed default).
// Other fields are informational, so malformed values are dropped instead.
function parseOpenRouterModel(value: unknown): OpenRouterModel | undefined {
  if (!isRecord(value)) return undefined;
  const id = optionalString(value["id"]);
  if (id === undefined) return undefined;
  const architecture = value["architecture"];
  const outputs = isRecord(architecture) ? architecture["output_modalities"] : undefined;
  return {
    id,
    name: optionalString(value["name"]),
    description: optionalString(value["description"]),
    context_length: optionalNumber(value["context_length"]),
    created: optionalNumber(value["created"]),
    expiration_date: optionalString(value["expiration_date"]),
    output_modalities: Array.isArray(outputs)
      ? outputs.filter((item): item is string => typeof item === "string")
      : [],
  };
}

async function fetchOpenRouterCandidateModels(
  provider: "OpenRouter (text)" | "OpenRouter (transcription)",
): Promise<ModelFetchResult> {
  try {
    // Public catalog: no API key, cookies, or identifying headers.
    const response = await fetch(profiles[provider].listUrl, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) return unavailable(`HTTP ${response.status} fetching model catalog.`);
    const json: unknown = await response.json();
    const entries = isRecord(json) && Array.isArray(json["data"]) ? json["data"] : undefined;
    const models = entries?.map(parseOpenRouterModel);
    if (models === undefined || models.some((model) => model === undefined)) {
      return unavailable("Invalid OpenRouter model catalog.");
    }
    const allModels: ModelMetadata[] = [];
    const candidateModels: ModelMetadata[] = [];
    for (const model of models as OpenRouterModel[]) {
      const createdAt = model.created === undefined ? undefined : new Date(model.created * 1000);
      const created = createdAt && !Number.isNaN(createdAt.getTime()) ? createdAt : undefined;
      const metadata: ModelMetadata = {
        id: model.id,
        provider,
        displayName: model.name,
        description: model.description,
        contextWindow:
          model.context_length && model.context_length > 0 ? model.context_length : undefined,
        createdDate: created?.toISOString().slice(0, 10),
        expirationDate: model.expiration_date,
        documentationUrl: getModelDocumentationUrl(provider, model.id),
      };
      allModels.push(metadata);
      const relevant =
        provider === "OpenRouter (text)"
          ? model.id.startsWith("google/") &&
            isRelevantGeminiModel(model.id.slice("google/".length)) &&
            model.output_modalities.includes("text")
          : !model.id.includes(":");
      if (relevant) candidateModels.push(metadata);
    }
    return catalog(allModels, candidateModels);
  } catch {
    return unavailable("Failed to fetch OpenRouter model catalog.");
  }
}

export function fetchOpenRouterTextCandidateModels(): Promise<ModelFetchResult> {
  return fetchOpenRouterCandidateModels("OpenRouter (text)");
}

export function fetchOpenRouterSttCandidateModels(): Promise<ModelFetchResult> {
  return fetchOpenRouterCandidateModels("OpenRouter (transcription)");
}

/** Check issues in all states; preserve the existing behavior on gh failure. */
export async function doesIssueExist(
  title: string,
  runner: CommandRunner = execa as unknown as CommandRunner,
): Promise<boolean> {
  try {
    const { stdout } = await runner("gh", [
      "issue",
      "list",
      "--state",
      "all",
      "--search",
      `"${title}" in:title`,
      "--json",
      "title",
    ]);
    const issues = JSON.parse(stdout || "[]") as Array<{ title: string }>;
    return issues.some((issue) => issue.title.trim() === title.trim());
  } catch (error) {
    console.warn("Could not query existing issues with gh CLI:", error);
    return false;
  }
}

export function buildIssueContent(model: ModelMetadata): IssueContent {
  const profile = profiles[model.provider];
  const title = `🤖 [Model Watch] New ${profile.titleProvider} model detected: ${model.id}`;
  const rows = [
    "| Property | Value |",
    "| :--- | :--- |",
    `| **Provider** | ${model.provider} |`,
    `| **Model ID** | \`${model.id}\` |`,
  ];
  if (model.displayName) rows.push(`| **Display Name** | ${model.displayName} |`);
  if (model.inputTokenLimit)
    rows.push(`| **Input Token Limit** | ${model.inputTokenLimit.toLocaleString()} |`);
  if (model.outputTokenLimit)
    rows.push(`| **Output Token Limit** | ${model.outputTokenLimit.toLocaleString()} |`);
  if (model.contextWindow && model.contextWindow > 0)
    rows.push(`| **Context Window** | ${model.contextWindow.toLocaleString()} tokens |`);
  if (model.createdDate) rows.push(`| **Created** | ${model.createdDate} |`);
  if (model.expirationDate) rows.push(`| **Expiration Date** | ${model.expirationDate} |`);
  const docUrl = model.documentationUrl ?? getModelDocumentationUrl(model.provider, model.id);
  const body = `## 🤖 New AI Model Detected: \`${model.id}\`

A new candidate model for **${model.provider}** has been discovered by the automated model-watch workflow.

### 📋 Model Metadata

${rows.join("\n")}

${model.description ? `> ${model.description}\n` : ""}
---

### 📚 Official Documentation

- [${profile.documentationTitle}](${docUrl})

---

### 🛠️ Action Items for vsub-cli

1. **Verify with CLI**:
   \`\`\`bash
   vsub input.mp4 ${profile.cliFlags} ${model.id}
   \`\`\`
2. **Evaluate Default Upgrade**:
   - Compare speed, quality, and rate limits against current default (\`${profile.defaultConstant}\`).
   - If superior, update \`${profile.defaultConstant}\` in \`${profile.defaultFile}\`.

_Automatically generated by \`.github/workflows/model-watch.yml\`._
`;
  return { title, body };
}

function buildDefaultIssue(provider: Provider, models: ModelMetadata[]): IssueContent | undefined {
  const profile = profiles[provider];
  const model = models.find(
    (entry) =>
      (provider === "Gemini" ? normalizeModelId(entry.id) : entry.id) === profile.defaultId,
  );
  const isOpenRouter = provider.startsWith("OpenRouter");
  if (model && (!isOpenRouter || !model.expirationDate)) return undefined;
  const state = model ? "scheduled for retirement" : "no longer listed";
  const titleProvider = isOpenRouter ? "OpenRouter" : provider;
  return {
    title: `⚠️ [Model Watch] Default ${titleProvider} model ${state}: ${profile.defaultId}`,
    body: `## Default model ${state}

The default **${provider}** model \`${profile.defaultId}\` is ${state}.

- Catalog checked: ${profile.listUrl}
- Default: \`${profile.defaultConstant}\` in \`${profile.defaultFile}\`.
${model?.expirationDate ? `- Scheduled retirement date: ${model.expirationDate}\n` : ""}
### Next steps

Choose and verify a replacement model, then update \`${profile.defaultConstant}\` in \`${profile.defaultFile}\`.

_Automatically generated by \`.github/workflows/model-watch.yml\`._
`,
  };
}

export async function createIssue(
  { title, body }: IssueContent,
  runner: CommandRunner = execa as unknown as CommandRunner,
): Promise<boolean> {
  try {
    await runner("gh", [
      "issue",
      "create",
      "--title",
      title,
      "--body",
      body,
      "--label",
      "enhancement",
    ]);
    return true;
  } catch (error) {
    console.error(`Failed to create issue ${title}:`, error);
    return false;
  }
}

export async function createModelIssue(
  model: ModelMetadata,
  runner: CommandRunner = execa as unknown as CommandRunner,
): Promise<boolean> {
  return createIssue(buildIssueContent(model), runner);
}

interface WatchOptions {
  dryRun?: boolean | undefined;
  geminiApiKey?: string | undefined;
  groqApiKey?: string | undefined;
  knownGemini?: Set<string> | undefined;
  knownGroq?: Set<string> | undefined;
  knownOpenRouterText?: Set<string> | undefined;
  knownOpenRouterStt?: Set<string> | undefined;
  fetchGemini?: ((key?: string) => Promise<ModelFetchResult>) | undefined;
  fetchGroq?: ((key?: string) => Promise<ModelFetchResult>) | undefined;
  fetchOpenRouterText?: (() => Promise<ModelFetchResult>) | undefined;
  fetchOpenRouterStt?: (() => Promise<ModelFetchResult>) | undefined;
  issueChecker?: ((title: string) => Promise<boolean>) | undefined;
  issueCreator?: ((issue: IssueContent) => Promise<boolean>) | undefined;
  writeSummary?: boolean | undefined;
}

export async function runModelWatcher(options: WatchOptions = {}): Promise<WatchResult[]> {
  const dryRun = options.dryRun ?? process.argv.includes("--dry-run");
  const checkIssue = options.issueChecker ?? doesIssueExist;
  const create = options.issueCreator ?? createIssue;
  const sources: {
    provider: Provider;
    known: Set<string>;
    fetch: () => Promise<ModelFetchResult>;
  }[] = [
    {
      provider: "Gemini",
      known: options.knownGemini ?? KNOWN_GEMINI_MODELS,
      fetch: () => (options.fetchGemini ?? fetchGeminiCandidateModels)(options.geminiApiKey),
    },
    {
      provider: "Groq",
      known: options.knownGroq ?? KNOWN_GROQ_MODELS,
      fetch: () => (options.fetchGroq ?? fetchGroqCandidateModels)(options.groqApiKey),
    },
    {
      provider: "OpenRouter (text)",
      known: options.knownOpenRouterText ?? KNOWN_OPENROUTER_TEXT_MODELS,
      fetch: options.fetchOpenRouterText ?? fetchOpenRouterTextCandidateModels,
    },
    {
      provider: "OpenRouter (transcription)",
      known: options.knownOpenRouterStt ?? KNOWN_OPENROUTER_STT_MODELS,
      fetch: options.fetchOpenRouterStt ?? fetchOpenRouterSttCandidateModels,
    },
  ];
  const results: WatchResult[] = [];
  for (const source of sources) {
    console.log(`\n🔍 Checking ${source.provider} candidate models...`);
    let fetched = await source.fetch();
    if (fetched.status === "ok" && fetched.allModels.length === 0) {
      fetched = unavailable("The model catalog was empty.");
    }
    const result: WatchResult = {
      provider: source.provider,
      status: fetched.status,
      detectedModels: [],
      newModels: [],
      skippedIssues: [],
      createdIssues: [],
      defaultNotifications: [],
    };
    results.push(result);
    if (fetched.status === "unavailable") {
      result.reason = fetched.reason;
      console.log(
        `::warning::${source.provider}: ${fetched.reason} Skipping model and default checks.`,
      );
      continue;
    }
    result.detectedModels = fetched.candidateModels;
    result.newModels = fetched.candidateModels.filter((model) => !source.known.has(model.id));
    console.log(
      `Found ${result.detectedModels.length} relevant ${source.provider} model(s). New unknown: ${result.newModels.length}`,
    );
    const notifications = result.newModels.map((model) => ({
      issue: buildIssueContent(model),
      id: model.id,
      isDefault: false,
    }));
    const defaultIssue = buildDefaultIssue(source.provider, fetched.allModels);
    if (defaultIssue)
      notifications.push({ issue: defaultIssue, id: defaultIssue.title, isDefault: true });
    for (const { issue, id, isDefault } of notifications) {
      if (await checkIssue(issue.title)) {
        console.log(`ℹ️ Issue already exists for ${id}. Skipping.`);
        if (!isDefault) result.skippedIssues.push(id);
      } else {
        let success = true;
        if (dryRun) {
          console.log(`[DRY RUN] Would create issue for: ${id} (${issue.title})`);
        } else {
          console.log(`🚀 Creating issue for: ${id}...`);
          success = await create(issue);
        }
        if (success) {
          if (isDefault) result.defaultNotifications.push(issue.title);
          else result.createdIssues.push(id);
        }
      }
    }
  }

  const summaryPath = options.writeSummary ? process.env["GITHUB_STEP_SUMMARY"] : undefined;
  if (summaryPath) {
    let md = "## 🤖 AI Model Watch Summary\n\n";
    md +=
      "| Provider | Status | Candidate Models | New Detected | Issues Created | Issues Skipped (Deduplicated) | Default Notifications |\n";
    md += "| :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n";
    for (const result of results) {
      if (result.status === "unavailable") {
        md += `| **${result.provider}** | unavailable | skipped | skipped | skipped | skipped | skipped |\n`;
      } else {
        md += `| **${result.provider}** | ok | ${result.detectedModels.length} | ${result.newModels.length} | ${result.createdIssues.length} | ${result.skippedIssues.length} | ${result.defaultNotifications.length} |\n`;
      }
    }
    fs.appendFileSync(summaryPath, md, "utf-8");
  }
  return results;
}

const entryPath = process.argv[1];
const isDirectRun =
  entryPath !== undefined &&
  entryPath !== "" &&
  path.resolve(entryPath) === path.resolve(fileURLToPath(import.meta.url));

if (isDirectRun) {
  runModelWatcher({ writeSummary: true })
    .then(() => {
      console.log("\n✅ Model watch check completed successfully.");
    })
    .catch((err) => {
      console.error("\n❌ Error running model watcher:", err);
      process.exit(1);
    });
}
