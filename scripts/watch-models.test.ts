import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_GEMINI_MODEL, DEFAULT_GROQ_MODEL } from "../src/config.js";
import { DEFAULT_OPENROUTER_LLM_MODEL } from "../src/text/openrouter.js";
import { DEFAULT_OPENROUTER_STT_MODEL } from "../src/transcribe/openrouter.js";
import * as watcher from "./watch-models.js";
import {
  buildIssueContent,
  type CommandRunner,
  doesIssueExist,
  getModelDocumentationUrl,
  isRelevantGeminiModel,
  isRelevantGroqModel,
  type ModelMetadata,
  normalizeModelId,
  runModelWatcher,
} from "./watch-models.js";

const sdk = vi.hoisted(() => ({ geminiList: vi.fn(), groqList: vi.fn() }));
vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { list: sdk.geminiList };
  },
}));
vi.mock("groq-sdk", () => ({
  default: class {
    models = { list: sdk.groqList };
  },
}));
vi.mock("execa", () => ({
  execa: vi.fn(() => {
    throw new Error("Unexpected external command");
  }),
}));

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Unexpected network request");
    }),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("watch-models.ts", () => {
  it("loads local env silently when importing the module", async () => {
    const tempDir = fs.mkdtempSync(path.join(process.cwd(), "watch-models-env-test-"));
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempDir);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("DUMMY_KEY", undefined);
    for (const name of [
      "DOTENV_PATH",
      "DOTENV_CONFIG_PATH",
      "DOTENV_QUIET",
      "DOTENV_CONFIG_QUIET",
      "DOTENV_DEBUG",
      "DOTENV_CONFIG_DEBUG",
    ]) {
      vi.stubEnv(name, undefined);
    }

    try {
      fs.writeFileSync(path.join(tempDir, ".env"), "DUMMY_KEY=dummy\n");
      vi.resetModules();
      await import("./watch-models.js");

      expect(process.env["DUMMY_KEY"]).toBe("dummy");
      expect(logSpy).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      cwdSpy.mockRestore();
      logSpy.mockRestore();
      errorSpy.mockRestore();
      vi.unstubAllEnvs();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("normalizeModelId", () => {
    it("should strip 'models/' prefix if present", () => {
      expect(normalizeModelId("models/gemini-2.5-flash")).toBe("gemini-2.5-flash");
      expect(normalizeModelId("models/gemini-3.7-flash")).toBe("gemini-3.7-flash");
      expect(normalizeModelId("models/gemini-3.8-flash")).toBe("gemini-3.8-flash");
    });

    it("should keep raw id if prefix is absent", () => {
      expect(normalizeModelId("whisper-large-v3")).toBe("whisper-large-v3");
      expect(normalizeModelId("gemini-1.5-flash")).toBe("gemini-1.5-flash");
    });
  });

  describe("isRelevantGeminiModel", () => {
    it("should match gemini flash models", () => {
      expect(isRelevantGeminiModel("models/gemini-2.5-flash")).toBe(true);
      expect(isRelevantGeminiModel("gemini-3.7-flash")).toBe(true);
      expect(isRelevantGeminiModel("gemini-3.8-flash")).toBe(true);
      expect(isRelevantGeminiModel("gemini-2.0-flash-lite")).toBe(true);
    });

    it("should reject non-flash, non-gemini, or non-text specialized models", () => {
      expect(isRelevantGeminiModel("text-embedding-004")).toBe(false);
      expect(isRelevantGeminiModel("aqa")).toBe(false);
      expect(isRelevantGeminiModel("imagen-3.0-generate-002")).toBe(false);
      expect(isRelevantGeminiModel("gemini-2.5-flash-image")).toBe(false);
      expect(isRelevantGeminiModel("gemini-2.5-flash-preview-tts")).toBe(false);
      expect(isRelevantGeminiModel("gemini-2.5-flash-native-audio-latest")).toBe(false);
      expect(isRelevantGeminiModel("gemini-omni-1.1-flash")).toBe(false);
      expect(isRelevantGeminiModel("gemini-omni-flash-preview")).toBe(false);
    });
  });

  describe("isRelevantGroqModel", () => {
    it("should match whisper models", () => {
      expect(isRelevantGroqModel("whisper-large-v3")).toBe(true);
      expect(isRelevantGroqModel("whisper-large-v3-turbo")).toBe(true);
      expect(isRelevantGroqModel("distil-whisper-large-v3-en")).toBe(true);
    });

    it("should reject non-whisper LLMs", () => {
      expect(isRelevantGroqModel("llama-3.3-70b-versatile")).toBe(false);
      expect(isRelevantGroqModel("mixtral-8x7b-32768")).toBe(false);
      expect(isRelevantGroqModel("gemma2-9b-it")).toBe(false);
    });
  });

  describe("getModelDocumentationUrl", () => {
    it("should return official Google AI docs URL for Gemini", () => {
      expect(getModelDocumentationUrl("Gemini")).toBe(
        "https://ai.google.dev/gemini-api/docs/models",
      );
    });

    it("should return Groq docs URL for Groq", () => {
      expect(getModelDocumentationUrl("Groq")).toBe("https://console.groq.com/docs/models");
    });
  });

  describe("buildIssueContent", () => {
    it("should generate proper title and body for Gemini model", () => {
      const metadata: ModelMetadata = {
        id: "gemini-4.0-flash",
        provider: "Gemini",
        displayName: "Gemini 4.0 Flash",
        inputTokenLimit: 1048576,
        outputTokenLimit: 8192,
        description: "Next-gen multimodal workhorse model",
        documentationUrl: "https://ai.google.dev/gemini-api/docs/models",
      };

      const { title, body } = buildIssueContent(metadata);

      expect(title).toBe("🤖 [Model Watch] New Gemini model detected: gemini-4.0-flash");
      expect(body).toContain("## 🤖 New AI Model Detected: `gemini-4.0-flash`");
      expect(body).toContain("| **Provider** | Gemini |");
      expect(body).toContain("| **Display Name** | Gemini 4.0 Flash |");
      expect(body).toContain("| **Input Token Limit** | 1,048,576 |");
      expect(body).toContain("| **Output Token Limit** | 8,192 |");
      expect(body).toContain("Next-gen multimodal workhorse model");
      expect(body).toContain("https://ai.google.dev/gemini-api/docs/models");
      expect(body).toContain("Google Gemini Models Documentation");
      expect(body).toContain("vsub input.mp4 --llm-provider gemini --llm-model gemini-4.0-flash");
    });

    it("should generate proper title and body for Groq model", () => {
      const metadata: ModelMetadata = {
        id: "whisper-large-v4",
        provider: "Groq",
        contextWindow: 448,
        documentationUrl: "https://console.groq.com/docs/models",
      };

      const { title, body } = buildIssueContent(metadata);

      expect(title).toBe("🤖 [Model Watch] New Groq model detected: whisper-large-v4");
      expect(body).toContain("## 🤖 New AI Model Detected: `whisper-large-v4`");
      expect(body).toContain("| **Provider** | Groq |");
      expect(body).toContain("| **Context Window** | 448 tokens |");
      expect(body).toContain("https://console.groq.com/docs/models");
      expect(body).toContain("Groq Supported Models Documentation");
      expect(body).toContain("vsub input.mp4 --stt-provider groq --stt-model whisper-large-v4");
    });
  });

  describe("doesIssueExist", () => {
    it("should return true if issue with title exists in gh output", async () => {
      const mockRunner: CommandRunner = vi.fn().mockResolvedValue({
        stdout: JSON.stringify([
          { title: "Some other issue" },
          {
            title: "🤖 [Model Watch] New Gemini model detected: gemini-3.0-flash",
          },
        ]),
      });

      const exists = await doesIssueExist(
        "🤖 [Model Watch] New Gemini model detected: gemini-3.0-flash",
        mockRunner,
      );

      expect(exists).toBe(true);
      expect(mockRunner).toHaveBeenCalledWith(
        "gh",
        expect.arrayContaining(["issue", "list", "--state", "all"]),
      );
    });

    it("should return false if issue does not exist", async () => {
      const mockRunner: CommandRunner = vi.fn().mockResolvedValue({
        stdout: JSON.stringify([{ title: "Some other issue" }]),
      });

      const exists = await doesIssueExist(
        "🤖 [Model Watch] New Gemini model detected: gemini-4.0-flash",
        mockRunner,
      );

      expect(exists).toBe(false);
    });

    it("should return false on gh error", async () => {
      const mockRunner: CommandRunner = vi.fn().mockRejectedValue(new Error("gh command failed"));

      const exists = await doesIssueExist("test-title", mockRunner);
      expect(exists).toBe(false);
    });
  });
});

// Independent snapshots from the ticket, rather than deriving expectations from the baselines.
const geminiSnapshot = [
  "gemini-2.5-flash",
  "gemini-2.5-pro",
  "gemini-flash-latest",
  "gemini-flash-lite-latest",
  "gemini-pro-latest",
  "gemini-2.5-flash-lite",
  "gemini-3-flash-preview",
  "gemini-3.1-pro-preview",
  "gemini-3.1-flash-lite-preview",
  "gemini-3.1-flash-lite",
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.6-flash",
  "gemini-3.7-flash",
  "gemini-3.8-flash",
  "gemini-4-argon",
  "gemini-4-carbon",
  "gemini-4-hydrogen",
];
const textSnapshot = [
  "google/gemini-4-hydrogen",
  "google/gemini-4-carbon",
  "google/gemini-4-argon",
  "google/gemini-3.8-flash",
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
];
const sttSnapshot = [
  "x-ai/grok-stt-2.0",
  "moondream/parakeet-ultra",
  "nvidia/nemotron-3.5-transcribe",
  "mistralai/voxtral-small-transcribe-3-0",
  "mistralai/voxtral-mini-transcribe-3-0",
  "assemblyai/universal-3-6-pro",
  "elevenlabs/scribe-v2",
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
];
const profiles = [
  {
    provider: "Gemini",
    defaultId: DEFAULT_GEMINI_MODEL,
    constant: "DEFAULT_GEMINI_MODEL",
    file: "src/config.ts",
    flags: "--llm-provider gemini --llm-model",
    titleProvider: "Gemini",
    url: "https://generativelanguage.googleapis.com/v1beta/models",
  },
  {
    provider: "Groq",
    defaultId: DEFAULT_GROQ_MODEL,
    constant: "DEFAULT_GROQ_MODEL",
    file: "src/config.ts",
    flags: "--stt-provider groq --stt-model",
    titleProvider: "Groq",
    url: "https://api.groq.com/openai/v1/models",
  },
  {
    provider: "OpenRouter (text)",
    defaultId: DEFAULT_OPENROUTER_LLM_MODEL,
    constant: "DEFAULT_OPENROUTER_LLM_MODEL",
    file: "src/text/openrouter.ts",
    flags: "--llm-provider openrouter --llm-model",
    titleProvider: "OpenRouter text",
    url: "https://openrouter.ai/api/v1/models",
  },
  {
    provider: "OpenRouter (transcription)",
    defaultId: DEFAULT_OPENROUTER_STT_MODEL,
    constant: "DEFAULT_OPENROUTER_STT_MODEL",
    file: "src/transcribe/openrouter.ts",
    flags: "--stt-provider openrouter --stt-model",
    titleProvider: "OpenRouter transcription",
    url: "https://openrouter.ai/api/v1/models?output_modalities=transcription",
  },
] as const;
type Provider = ModelMetadata["provider"];

function success(
  provider: Provider,
  ids: readonly string[],
  candidates = ids,
): watcher.ModelFetchResult {
  return {
    status: "ok",
    allModels: ids.map((id) => ({ id, provider })),
    candidateModels: candidates.map((id) => ({ id, provider })),
  };
}

function setupWatcher() {
  const fetchers = profiles.map((p) =>
    vi.fn().mockResolvedValue(success(p.provider, [p.defaultId])),
  );
  const issueChecker = vi.fn().mockResolvedValue(false);
  const issueCreator = vi.fn().mockResolvedValue(true);
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const append = vi.spyOn(fs, "appendFileSync").mockImplementation(() => {});
  const options = {
    dryRun: false,
    fetchGemini: fetchers[0],
    fetchGroq: fetchers[1],
    fetchOpenRouterText: fetchers[2],
    fetchOpenRouterStt: fetchers[3],
    issueChecker,
    issueCreator,
  };
  return { fetchers, issueChecker, issueCreator, log, append, options };
}

describe("expanded Gemini eligibility", () => {
  it.each(geminiSnapshot)("accepts %s, including prefixed and uppercase names", (id) => {
    expect(isRelevantGeminiModel(id)).toBe(true);
    expect(isRelevantGeminiModel(`models/${id.toUpperCase()}`, ["generateContent"])).toBe(true);
  });
  it.each([
    "gemini-2.5-flash-preview-tts",
    "gemini-3.8-flash-tts",
    "gemini-2.5-flash-image",
    "gemini-3.1-flash-lite-image",
    "gemini-3-pro-image",
    "gemini-omni-1.2-flash",
    "gemini-3.5-transcribe",
    "gemini-3.5-transcribe-live",
    "gemini-3.8-live",
    "gemini-3.8-live-extended-thinking",
    "gemini-3.1-flash-live-preview",
    "gemini-3.1-pro-preview-customtools",
    "gemini-robotics-er-2-preview",
    "gemini-2.5-computer-use-preview-10-2025",
    "gemini-2.5-flash-native-audio-latest",
    "gemini-embedding-2",
    "gemini-3.5-live-translate-preview",
    "gemini-nano-banana-2.1",
    "gemini-decision-1",
    "gemma-4-31b-it",
    "gemini-3.8-flash:batch",
    "lyria-1",
    "antigravity-1",
    "deep-research-1",
    "gemini-9-image-latest",
  ])("rejects %s", (id) => {
    expect(isRelevantGeminiModel(id)).toBe(false);
  });
  it("requires generateContent only when supported actions are supplied", () => {
    expect(isRelevantGeminiModel("gemini-9-test", ["embedContent"])).toBe(false);
    expect(isRelevantGeminiModel("gemini-9-test", [])).toBe(false);
    expect(isRelevantGeminiModel("gemini-9-test")).toBe(true);
    expect(isRelevantGeminiModel("gemini-9-imagery")).toBe(true);
  });
});

describe("catalog fetching without real services", () => {
  function mockResponse(data: unknown, status = 200) {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(data), { status }));
    vi.stubGlobal("fetch", fetch);
    return fetch;
  }

  it("filters OpenRouter text, retaining the full catalog for default checks", async () => {
    const ids = [
      "google/gemini-4-hydrogen",
      "google/gemini-3.8-flash:batch",
      "google/gemini-3-pro-image",
      "google/gemini-omni-1.2-flash",
      "other/gemini-9-test",
      "google/gemini-9-audio",
    ];
    const fetch = mockResponse({
      data: ids.map((id) => ({
        id,
        name: "Test model",
        context_length: 1024,
        created: 1_800_000_000,
        description: "Test description",
        expiration_date: "2026-12-22",
        architecture: { output_modalities: [id.endsWith("audio") ? "audio" : "text"] },
      })),
    });
    const result = await watcher.fetchOpenRouterTextCandidateModels();
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("Expected catalog");
    expect(result.allModels.map((m) => m.id)).toEqual(ids);
    expect(result.candidateModels).toEqual([
      expect.objectContaining({
        id: ids[0],
        provider: "OpenRouter (text)",
        displayName: "Test model",
        contextWindow: 1024,
        description: "Test description",
        expirationDate: "2026-12-22",
        createdDate: new Date(1_800_000_000_000).toISOString().slice(0, 10),
      }),
    ]);
    expect(fetch).toHaveBeenCalledWith(profiles[2].url, { signal: expect.any(AbortSignal) });
  });

  it("uses the transcription URL, excludes variants, and omits zero context", async () => {
    const fetch = mockResponse({
      data: [
        { id: DEFAULT_OPENROUTER_STT_MODEL, context_length: 0 },
        { id: "test/transcribe:free" },
        { id: "test/transcribe" },
      ],
    });
    const result = await watcher.fetchOpenRouterSttCandidateModels();
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("Expected catalog");
    expect(result.candidateModels.map((m) => m.id)).toEqual([
      DEFAULT_OPENROUTER_STT_MODEL,
      "test/transcribe",
    ]);
    expect(result.candidateModels[0]?.contextWindow).toBeUndefined();
    expect(fetch).toHaveBeenCalledWith(profiles[3].url, { signal: expect.any(AbortSignal) });
  });

  it.each([
    [500, { data: [{ id: "test/model" }] }],
    [200, {}],
    [200, { data: "wrong" }],
    [200, { data: [] }],
    [200, { data: [{ name: "missing id" }] }],
    [200, { data: [null] }],
  ])("marks HTTP/shape/empty failures unavailable (%s, %j)", async (status, data) => {
    mockResponse(data, status);
    expect((await watcher.fetchOpenRouterTextCandidateModels()).status).toBe("unavailable");
    expect((await watcher.fetchOpenRouterSttCandidateModels()).status).toBe("unavailable");
  });

  it("drops malformed informational fields instead of rejecting the catalog", async () => {
    mockResponse({
      data: [
        {
          id: "test/transcribe",
          name: 42,
          description: null,
          context_length: "1024",
          created: "yesterday",
          expiration_date: 123,
          architecture: "wrong",
        },
      ],
    });
    const result = await watcher.fetchOpenRouterSttCandidateModels();
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("Expected catalog");
    expect(result.candidateModels).toEqual([
      expect.objectContaining({
        id: "test/transcribe",
        displayName: undefined,
        description: undefined,
        contextWindow: undefined,
        createdDate: undefined,
        expirationDate: undefined,
      }),
    ]);
  });

  it("handles rejection and invalid JSON without treating them as empty catalogs", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("test failure")));
    expect((await watcher.fetchOpenRouterTextCandidateModels()).status).toBe("unavailable");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{")));
    expect((await watcher.fetchOpenRouterSttCandidateModels()).status).toBe("unavailable");
  });

  it("keeps all Gemini models and honors SDK supportedActions", async () => {
    sdk.geminiList.mockResolvedValue([
      { name: `models/${DEFAULT_GEMINI_MODEL}`, supportedActions: ["embedContent"] },
      { name: "models/gemini-4-hydrogen", supportedActions: ["generateContent"] },
      { name: "models/gemini-9-test" },
    ]);
    const result = await watcher.fetchGeminiCandidateModels("test-key-1234");
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("Expected catalog");
    expect(result.allModels.map((m) => m.id)).toContain(DEFAULT_GEMINI_MODEL);
    expect(result.candidateModels.map((m) => m.id)).toEqual(["gemini-4-hydrogen", "gemini-9-test"]);
  });

  it("keeps non-Whisper Groq models in the full catalog", async () => {
    sdk.groqList.mockResolvedValue({ data: [{ id: DEFAULT_GROQ_MODEL }, { id: "test-llm" }] });
    const result = await watcher.fetchGroqCandidateModels("test-key-1234");
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("Expected catalog");
    expect(result.allModels).toHaveLength(2);
    expect(result.candidateModels.map((m) => m.id)).toEqual([DEFAULT_GROQ_MODEL]);
  });

  it("distinguishes missing keys, SDK failures, empty and malformed catalogs", async () => {
    for (const name of [
      "GEMINI_API_KEY",
      "VSUB_GEMINI_API_KEY",
      "GROQ_API_KEY",
      "VSUB_GROQ_API_KEY",
    ]) {
      vi.stubEnv(name, undefined);
    }
    expect((await watcher.fetchGeminiCandidateModels()).status).toBe("unavailable");
    expect((await watcher.fetchGroqCandidateModels()).status).toBe("unavailable");
    for (const value of [[], [{ name: undefined }]]) {
      sdk.geminiList.mockResolvedValue(value);
      expect((await watcher.fetchGeminiCandidateModels("test-key-1234")).status).toBe(
        "unavailable",
      );
    }
    for (const value of [{ data: [] }, { data: [{}] }, {}]) {
      sdk.groqList.mockResolvedValue(value);
      expect((await watcher.fetchGroqCandidateModels("test-key-1234")).status).toBe("unavailable");
    }
    sdk.geminiList.mockRejectedValue(new Error("test failure"));
    sdk.groqList.mockRejectedValue(new Error("test failure"));
    expect((await watcher.fetchGeminiCandidateModels("test-key-1234")).status).toBe("unavailable");
    expect((await watcher.fetchGroqCandidateModels("test-key-1234")).status).toBe("unavailable");
  });
});

describe("four-provider watcher", () => {
  it("starts with zero new models and default notifications for the ticket snapshots", async () => {
    const ctx = setupWatcher();
    const snapshots = [
      geminiSnapshot,
      [DEFAULT_GROQ_MODEL, "whisper-large-v3"],
      textSnapshot,
      sttSnapshot,
    ];
    profiles.forEach((p, i) => {
      ctx.fetchers[i]?.mockResolvedValue(success(p.provider, snapshots[i] ?? []));
    });
    const results = await runModelWatcher(ctx.options);
    expect(results.map((r) => r.detectedModels.length)).toEqual([18, 2, 16, 31]);
    for (const result of results) {
      expect(result.newModels).toEqual([]);
      expect(result.defaultNotifications).toEqual([]);
    }
    expect(ctx.issueChecker).not.toHaveBeenCalled();
    expect(ctx.issueCreator).not.toHaveBeenCalled();
  });

  it.each(profiles)("detects absence using the full $provider catalog", async (p) => {
    const ctx = setupWatcher();
    const index = profiles.indexOf(p);
    ctx.fetchers[index]?.mockResolvedValue(success(p.provider, ["test-other"], []));
    const results = await runModelWatcher(ctx.options);
    const expectedProvider = p.provider.startsWith("OpenRouter") ? "OpenRouter" : p.provider;
    const title = `⚠️ [Model Watch] Default ${expectedProvider} model no longer listed: ${p.defaultId}`;
    expect(ctx.issueChecker).toHaveBeenCalledExactlyOnceWith(title);
    expect(ctx.issueCreator).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ title }));
    const issue = ctx.issueCreator.mock.calls[0]?.[0];
    expect(issue.body).toContain(p.url);
    expect(issue.body).toContain(p.constant);
    expect(issue.body).toContain(p.file);
    expect(issue.body).toContain("replacement");
    expect(results[index]?.defaultNotifications).toEqual([title]);

    ctx.fetchers[index]?.mockResolvedValue(success(p.provider, [p.defaultId], []));
    ctx.issueChecker.mockClear();
    ctx.issueCreator.mockClear();
    await runModelWatcher(ctx.options);
    expect(ctx.issueChecker).not.toHaveBeenCalled();
    expect(ctx.issueCreator).not.toHaveBeenCalled();
  });

  it.each(profiles.slice(2))(
    "reports $provider retirement with a date-independent title",
    async (p) => {
      const ctx = setupWatcher();
      const index = profiles.indexOf(p);
      const title = `⚠️ [Model Watch] Default OpenRouter model scheduled for retirement: ${p.defaultId}`;
      for (const date of ["2026-12-22", "2027-01-01"]) {
        ctx.fetchers[index]?.mockResolvedValue({
          status: "ok",
          allModels: [{ id: p.defaultId, provider: p.provider, expirationDate: date }],
          candidateModels: [],
        });
        ctx.issueCreator.mockClear();
        await runModelWatcher(ctx.options);
        expect(ctx.issueCreator).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({ title }),
        );
        expect(ctx.issueCreator.mock.calls[0]?.[0].body).toContain(date);
      }
    },
  );

  it.each(profiles)("deduplicates and dry-runs default notifications for $provider", async (p) => {
    const ctx = setupWatcher();
    const index = profiles.indexOf(p);
    const missing = success(p.provider, ["test-other"], []);
    const retirement: watcher.ModelFetchResult = {
      status: "ok",
      allModels: [{ id: p.defaultId, provider: p.provider, expirationDate: "2026-12-22" }],
      candidateModels: [],
    };
    for (const fetched of p.provider.startsWith("OpenRouter") ? [missing, retirement] : [missing]) {
      ctx.fetchers[index]?.mockResolvedValue(fetched);
      for (const duplicate of [false, true]) {
        ctx.issueChecker.mockResolvedValue(duplicate);
        for (const dryRun of [false, true]) {
          ctx.issueChecker.mockClear();
          ctx.issueCreator.mockClear();
          const results = await runModelWatcher({ ...ctx.options, dryRun });
          expect(ctx.issueChecker).toHaveBeenCalledTimes(1);
          expect(ctx.issueCreator).toHaveBeenCalledTimes(duplicate || dryRun ? 0 : 1);
          expect(results[index]?.defaultNotifications).toHaveLength(duplicate ? 0 : 1);
        }
      }
    }
  });

  it.each(profiles)(
    "skips unavailable $provider checks with a warning and no dry-run notice",
    async (p) => {
      const ctx = setupWatcher();
      const index = profiles.indexOf(p);
      for (const result of [
        { status: "unavailable", reason: "test failure" },
        { status: "ok", allModels: [], candidateModels: [] },
      ]) {
        ctx.fetchers[index]?.mockResolvedValue(result);
        const results = await runModelWatcher({ ...ctx.options, dryRun: true });
        expect(results[index]?.status).toBe("unavailable");
      }
      expect(ctx.issueChecker).not.toHaveBeenCalled();
      expect(ctx.issueCreator).not.toHaveBeenCalled();
      expect(
        ctx.log.mock.calls
          .flat()
          .some(
            (line) => String(line).startsWith("::warning::") && String(line).includes(p.provider),
          ),
      ).toBe(true);
      expect(ctx.log.mock.calls.flat().join("\n")).not.toContain("[DRY RUN]");
    },
  );

  it.each([false, true])(
    "deduplicates new/default issues and respects dry-run=%s",
    async (dryRun) => {
      const ctx = setupWatcher();
      ctx.fetchers[0]?.mockResolvedValue(success("Gemini", ["gemini-9-test", "gemini-9-existing"]));
      ctx.issueChecker.mockImplementation(
        async (title: string) => title.includes("existing") || title.includes("no longer listed"),
      );
      const results = await runModelWatcher({ ...ctx.options, dryRun });
      expect(results[0]?.skippedIssues).toEqual(["gemini-9-existing"]);
      expect(results[0]?.createdIssues).toEqual(["gemini-9-test"]);
      expect(results[0]?.defaultNotifications).toEqual([]);
      expect(ctx.issueCreator).toHaveBeenCalledTimes(dryRun ? 0 : 1);
      expect(ctx.issueChecker).toHaveBeenCalledTimes(3);
    },
  );

  it("counts a default notification in dry-run without creating it", async () => {
    const ctx = setupWatcher();
    ctx.fetchers[0]?.mockResolvedValue(success("Gemini", ["test-other"], []));
    const results = await runModelWatcher({ ...ctx.options, dryRun: true });
    expect(results[0]?.defaultNotifications).toHaveLength(1);
    expect(ctx.issueCreator).not.toHaveBeenCalled();
    expect(ctx.log.mock.calls.flat().join("\n")).toContain("[DRY RUN] Would create issue");
  });

  it("does not count failed issue creations", async () => {
    const ctx = setupWatcher();
    ctx.fetchers[0]?.mockResolvedValue(success("Gemini", ["gemini-9-test"]));
    ctx.issueCreator.mockResolvedValue(false);
    const results = await runModelWatcher(ctx.options);
    expect(ctx.issueCreator).toHaveBeenCalledTimes(2);
    expect(results[0]?.createdIssues).toEqual([]);
    expect(results[0]?.defaultNotifications).toEqual([]);
  });

  it.each([false, true])(
    "writes four summary rows only when enabled (%s)",
    async (writeSummary) => {
      const ctx = setupWatcher();
      vi.stubEnv("GITHUB_STEP_SUMMARY", "test-summary.md");
      ctx.fetchers[1]?.mockResolvedValue({ status: "unavailable", reason: "test failure" });
      ctx.fetchers[0]?.mockResolvedValue(success("Gemini", ["test-other"], []));
      await runModelWatcher({ ...ctx.options, writeSummary, dryRun: true });
      expect(ctx.append).toHaveBeenCalledTimes(writeSummary ? 1 : 0);
      if (writeSummary) {
        const md = String(ctx.append.mock.calls[0]?.[1]);
        expect(md).toContain("AI Model Watch Summary");
        expect(md).toContain("Default Notifications");
        profiles.forEach((p) => {
          expect(md).toContain(`| **${p.provider}** |`);
        });
        expect(md).toContain("| **Groq** | unavailable");
        expect(md).toContain("| **Gemini** | ok | 0 | 0 | 0 | 0 | 1 |");
      }
    },
  );
});

describe("provider-specific issue content", () => {
  it.each(profiles)("uses the $provider title, CLI flags and default source", (p) => {
    const id =
      p.provider === "Groq"
        ? "whisper-9-test"
        : p.provider.startsWith("OpenRouter")
          ? "google/gemini-9-test"
          : "gemini-9-test";
    const issue = buildIssueContent({ id, provider: p.provider });
    expect(issue.title).toBe(`🤖 [Model Watch] New ${p.titleProvider} model detected: ${id}`);
    expect(issue.body).toContain(`vsub input.mp4 ${p.flags} ${id}`);
    expect(issue.body).toContain(p.constant);
    expect(issue.body).toContain(p.file);
    if (p.provider.startsWith("OpenRouter"))
      expect(issue.body).toContain(`https://openrouter.ai/${id}`);
  });

  it("renders only known OpenRouter metadata and includes dates and description", () => {
    const issue = buildIssueContent({
      id: "test/model",
      provider: "OpenRouter (text)",
      displayName: "Test model",
      contextWindow: 1024,
      createdDate: "2026-11-14",
      expirationDate: "2026-12-22",
      description: "Test description",
    });
    expect(issue.body).toContain("| **Display Name** | Test model |");
    expect(issue.body).toContain("| **Context Window** | 1,024 tokens |");
    expect(issue.body).toContain("2026-11-14");
    expect(issue.body).toContain("2026-12-22");
    expect(issue.body).toContain("> Test description");
    const minimal = buildIssueContent({ id: "test/model", provider: "OpenRouter (transcription)" });
    expect(minimal.body).not.toContain("Context Window");
    expect(minimal.body).not.toContain("Display Name");
    expect(minimal.body).not.toContain("Created");
  });

  it("creates generic notifications with the enhancement label using the injected runner", async () => {
    const runner: CommandRunner = vi.fn().mockResolvedValue({ stdout: "" });
    const issue = { title: "test title", body: "test body" };
    expect(await watcher.createIssue(issue, runner)).toBe(true);
    expect(runner).toHaveBeenCalledWith("gh", [
      "issue",
      "create",
      "--title",
      issue.title,
      "--body",
      issue.body,
      "--label",
      "enhancement",
    ]);
  });
});
