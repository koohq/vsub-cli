import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import { execa } from "execa";
import Groq from "groq-sdk";
import { DEFAULT_GEMINI_MODEL, DEFAULT_GROQ_MODEL } from "../src/config.js";

// Load .env for local/test execution
dotenv.config();

export interface ModelMetadata {
  id: string;
  provider: "Gemini" | "Groq";
  displayName?: string;
  description?: string;
  inputTokenLimit?: number;
  outputTokenLimit?: number;
  contextWindow?: number;
  benchmarkUrl?: string;
}

export interface WatchResult {
  provider: "Gemini" | "Groq";
  detectedModels: ModelMetadata[];
  newModels: ModelMetadata[];
  skippedIssues: string[];
  createdIssues: string[];
}

export type CommandRunner = (file: string, args: readonly string[]) => Promise<{ stdout: string }>;

/**
 * Known/baseline models currently returned by Gemini / Groq APIs
 */
export const KNOWN_GEMINI_MODELS = new Set([
  DEFAULT_GEMINI_MODEL, // gemini-3.7-flash
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
]);

export const KNOWN_GROQ_MODELS = new Set([
  DEFAULT_GROQ_MODEL, // whisper-large-v3-turbo
  "whisper-large-v3",
]);

/**
 * Clean model ID (e.g. "models/gemini-3.7-flash" -> "gemini-3.7-flash")
 */
export function normalizeModelId(rawId: string): string {
  return rawId.replace(/^models\//, "");
}

/**
 * Filter relevant candidate models for Gemini (focusing on flash/generative translation models)
 */
export function isRelevantGeminiModel(modelId: string): boolean {
  const normalized = normalizeModelId(modelId).toLowerCase();
  // Target gemini generative models (especially flash variants suitable for fast subtitle translation)
  if (!normalized.startsWith("gemini-") || !normalized.includes("flash")) {
    return false;
  }
  // Exclude image/video generation or TTS / native-audio specialized models
  const isSpecializedOutput =
    normalized.includes("image") ||
    normalized.includes("tts") ||
    normalized.includes("native-audio") ||
    normalized.includes("omni");
  return !isSpecializedOutput;
}

/**
 * Filter relevant candidate models for Groq (focusing on Whisper speech recognition models)
 */
export function isRelevantGroqModel(modelId: string): boolean {
  const lower = modelId.toLowerCase();
  return lower.includes("whisper");
}

/**
 * Generate Artificial Analysis / official documentation link for a model
 */
export function getModelReferenceUrl(provider: "Gemini" | "Groq", modelId: string): string {
  if (provider === "Gemini") {
    return `https://artificialanalysis.ai/models/${normalizeModelId(modelId)}`;
  }
  return "https://console.groq.com/docs/models";
}

/**
 * Fetch candidate models from Google Gemini API
 */
export async function fetchGeminiCandidateModels(apiKey?: string): Promise<ModelMetadata[]> {
  const key = apiKey || process.env["GEMINI_API_KEY"] || process.env["VSUB_GEMINI_API_KEY"];
  if (!key) {
    console.log("::warning::GEMINI_API_KEY is not configured. Skipping Gemini model check.");
    return [];
  }

  try {
    const ai = new GoogleGenAI({ apiKey: key });
    const modelsResponse = await ai.models.list();
    const candidateModels: ModelMetadata[] = [];

    // modelsResponse is an async iterable or array of models
    for await (const model of modelsResponse) {
      const rawName = model.name ?? "";
      const modelId = normalizeModelId(rawName);

      if (isRelevantGeminiModel(modelId)) {
        candidateModels.push({
          id: modelId,
          provider: "Gemini",
          displayName: model.displayName ?? undefined,
          description: model.description ?? undefined,
          inputTokenLimit: model.inputTokenLimit ?? undefined,
          outputTokenLimit: model.outputTokenLimit ?? undefined,
          benchmarkUrl: getModelReferenceUrl("Gemini", modelId),
        });
      }
    }

    return candidateModels;
  } catch (error) {
    console.error("Failed to fetch Gemini models:", error);
    return [];
  }
}

/**
 * Fetch candidate models from Groq API
 */
export async function fetchGroqCandidateModels(apiKey?: string): Promise<ModelMetadata[]> {
  const key = apiKey || process.env["GROQ_API_KEY"] || process.env["VSUB_GROQ_API_KEY"];
  if (!key) {
    console.log("::warning::GROQ_API_KEY is not configured. Skipping Groq model check.");
    return [];
  }

  try {
    const groq = new Groq({ apiKey: key });
    const modelsPage = await groq.models.list();
    const candidateModels: ModelMetadata[] = [];

    for (const model of modelsPage.data) {
      if (isRelevantGroqModel(model.id)) {
        candidateModels.push({
          id: model.id,
          provider: "Groq",
          contextWindow: model.context_window ?? undefined,
          benchmarkUrl: getModelReferenceUrl("Groq", model.id),
        });
      }
    }

    return candidateModels;
  } catch (error) {
    console.error("Failed to fetch Groq models:", error);
    return [];
  }
}

/**
 * Check whether an Issue for this model already exists (Open or Closed)
 */
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

/**
 * Build Issue Title and Markdown Body
 */
export function buildIssueContent(model: ModelMetadata): {
  title: string;
  body: string;
} {
  const title = `🤖 [Model Watch] New ${model.provider} model detected: ${model.id}`;

  const rows = [
    "| Property | Value |",
    "| :--- | :--- |",
    `| **Provider** | ${model.provider} |`,
    `| **Model ID** | \`${model.id}\` |`,
  ];

  if (model.displayName) {
    rows.push(`| **Display Name** | ${model.displayName} |`);
  }
  if (model.inputTokenLimit) {
    rows.push(`| **Input Token Limit** | ${model.inputTokenLimit.toLocaleString()} |`);
  }
  if (model.outputTokenLimit) {
    rows.push(`| **Output Token Limit** | ${model.outputTokenLimit.toLocaleString()} |`);
  }
  if (model.contextWindow) {
    rows.push(`| **Context Window** | ${model.contextWindow.toLocaleString()} tokens |`);
  }

  const optFlag = model.provider === "Gemini" ? "--gemini-model" : "--groq-model";
  const defaultConst = model.provider === "Gemini" ? "DEFAULT_GEMINI_MODEL" : "DEFAULT_GROQ_MODEL";

  const body = `## 🤖 New AI Model Detected: \`${model.id}\`

A new candidate model for **${model.provider}** has been discovered by the automated model-watch workflow.

### 📋 Model Metadata

${rows.join("\n")}

${model.description ? `\n> ${model.description}\n` : ""}

---

### 🔍 Benchmark & Comparison

- [Artificial Analysis Benchmark](${model.benchmarkUrl ?? "https://artificialanalysis.ai/"})
- ${model.provider === "Gemini" ? "[Google AI Studio Models](https://aistudio.google.com/)" : "[Groq Supported Models](https://console.groq.com/docs/models)"}

---

### 🛠️ Action Items for vsub-cli

1. **Verify with CLI**:
   \`\`\`bash
   # Test subtitle generation with the new model
   vsub input.mp4 ${optFlag} ${model.id}
   \`\`\`
2. **Evaluate Default Upgrade**:
   - Compare speed, quality, and rate limits against current default (\`${defaultConst}\`).
   - If superior, update \`${defaultConst}\` in \`src/config.ts\`.

_Automatically generated by \`.github/workflows/model-watch.yml\`._
`;

  return { title, body };
}

/**
 * Create an Issue via GitHub CLI
 */
export async function createModelIssue(
  model: ModelMetadata,
  runner: CommandRunner = execa as unknown as CommandRunner,
): Promise<boolean> {
  const { title, body } = buildIssueContent(model);
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
    console.error(`Failed to create issue for model ${model.id}:`, error);
    return false;
  }
}

/**
 * Main watch runner function
 */
export async function runModelWatcher(
  options: {
    dryRun?: boolean;
    geminiApiKey?: string;
    groqApiKey?: string;
    knownGemini?: Set<string>;
    knownGroq?: Set<string>;
    fetchGemini?: (key?: string) => Promise<ModelMetadata[]>;
    fetchGroq?: (key?: string) => Promise<ModelMetadata[]>;
    issueChecker?: (title: string) => Promise<boolean>;
    issueCreator?: (model: ModelMetadata) => Promise<boolean>;
    writeSummary?: boolean;
  } = {},
): Promise<WatchResult[]> {
  const dryRun = options.dryRun ?? process.argv.includes("--dry-run");
  const knownGemini = options.knownGemini ?? KNOWN_GEMINI_MODELS;
  const knownGroq = options.knownGroq ?? KNOWN_GROQ_MODELS;
  const fetchGemini = options.fetchGemini ?? fetchGeminiCandidateModels;
  const fetchGroq = options.fetchGroq ?? fetchGroqCandidateModels;
  const checkIssue = options.issueChecker ?? doesIssueExist;
  const createIssue = options.issueCreator ?? createModelIssue;
  const writeSummary = options.writeSummary ?? false;

  const results: WatchResult[] = [];

  // 1. Process Gemini
  console.log("\n🔍 Checking Google Gemini candidate models...");
  const geminiCandidates = await fetchGemini(options.geminiApiKey);
  const geminiNew = geminiCandidates.filter((m) => !knownGemini.has(m.id));
  const geminiResult: WatchResult = {
    provider: "Gemini",
    detectedModels: geminiCandidates,
    newModels: geminiNew,
    skippedIssues: [],
    createdIssues: [],
  };

  console.log(
    `Found ${geminiCandidates.length} relevant Gemini model(s). New unknown: ${geminiNew.length}`,
  );

  for (const model of geminiNew) {
    const { title } = buildIssueContent(model);
    if (await checkIssue(title)) {
      console.log(`ℹ️ Issue already exists for ${model.id}. Skipping.`);
      geminiResult.skippedIssues.push(model.id);
    } else if (dryRun) {
      console.log(`[DRY RUN] Would create issue for: ${model.id} (${title})`);
      geminiResult.createdIssues.push(model.id);
    } else {
      console.log(`🚀 Creating issue for: ${model.id}...`);
      const success = await createIssue(model);
      if (success) {
        geminiResult.createdIssues.push(model.id);
      }
    }
  }
  results.push(geminiResult);

  // 2. Process Groq
  console.log("\n🔍 Checking Groq Whisper candidate models...");
  const groqCandidates = await fetchGroq(options.groqApiKey);
  const groqNew = groqCandidates.filter((m) => !knownGroq.has(m.id));
  const groqResult: WatchResult = {
    provider: "Groq",
    detectedModels: groqCandidates,
    newModels: groqNew,
    skippedIssues: [],
    createdIssues: [],
  };

  console.log(
    `Found ${groqCandidates.length} relevant Groq model(s). New unknown: ${groqNew.length}`,
  );

  for (const model of groqNew) {
    const { title } = buildIssueContent(model);
    if (await checkIssue(title)) {
      console.log(`ℹ️ Issue already exists for ${model.id}. Skipping.`);
      groqResult.skippedIssues.push(model.id);
    } else if (dryRun) {
      console.log(`[DRY RUN] Would create issue for: ${model.id} (${title})`);
      groqResult.createdIssues.push(model.id);
    } else {
      console.log(`🚀 Creating issue for: ${model.id}...`);
      const success = await createIssue(model);
      if (success) {
        groqResult.createdIssues.push(model.id);
      }
    }
  }
  results.push(groqResult);

  // 3. Write GitHub Step Summary if explicitly enabled (e.g. CLI direct execution in workflow)
  const summaryPath = writeSummary ? process.env["GITHUB_STEP_SUMMARY"] : undefined;
  if (summaryPath) {
    let md = "## 🤖 AI Model Watch Summary\n\n";
    md +=
      "| Provider | Candidate Models | New Detected | Issues Created | Issues Skipped (Deduplicated) |\n";
    md += "| :--- | :--- | :--- | :--- | :--- |\n";
    for (const res of results) {
      md += `| **${res.provider}** | ${res.detectedModels.length} | ${res.newModels.length} | ${res.createdIssues.length} | ${res.skippedIssues.length} |\n`;
    }
    fs.appendFileSync(summaryPath, md, "utf-8");
  }

  return results;
}

// Execute directly when run as script
const isDirectRun =
  Boolean(process.argv[1]) &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

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
