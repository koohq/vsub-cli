import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  buildIssueContent,
  type CommandRunner,
  doesIssueExist,
  getModelReferenceUrl,
  isRelevantGeminiModel,
  isRelevantGroqModel,
  type ModelMetadata,
  normalizeModelId,
  runModelWatcher,
} from "./watch-models.js";

describe("watch-models.ts", () => {
  describe("normalizeModelId", () => {
    it("should strip 'models/' prefix if present", () => {
      expect(normalizeModelId("models/gemini-2.5-flash")).toBe("gemini-2.5-flash");
      expect(normalizeModelId("models/gemini-3.7-flash")).toBe("gemini-3.7-flash");
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

  describe("getModelReferenceUrl", () => {
    it("should return Artificial Analysis URL for Gemini", () => {
      expect(getModelReferenceUrl("Gemini", "models/gemini-2.5-flash")).toBe(
        "https://artificialanalysis.ai/models/gemini-2.5-flash",
      );
    });

    it("should return Groq docs URL for Groq", () => {
      expect(getModelReferenceUrl("Groq", "whisper-large-v3")).toBe(
        "https://console.groq.com/docs/models",
      );
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
        benchmarkUrl: "https://artificialanalysis.ai/models/gemini-4.0-flash",
      };

      const { title, body } = buildIssueContent(metadata);

      expect(title).toBe("🤖 [Model Watch] New Gemini model detected: gemini-4.0-flash");
      expect(body).toContain("## 🤖 New AI Model Detected: `gemini-4.0-flash`");
      expect(body).toContain("| **Provider** | Gemini |");
      expect(body).toContain("| **Display Name** | Gemini 4.0 Flash |");
      expect(body).toContain("| **Input Token Limit** | 1,048,576 |");
      expect(body).toContain("| **Output Token Limit** | 8,192 |");
      expect(body).toContain("Next-gen multimodal workhorse model");
      expect(body).toContain("https://artificialanalysis.ai/models/gemini-4.0-flash");
      expect(body).toContain("vsub input.mp4 --gemini-model gemini-4.0-flash");
    });

    it("should generate proper title and body for Groq model", () => {
      const metadata: ModelMetadata = {
        id: "whisper-large-v4",
        provider: "Groq",
        contextWindow: 448,
        benchmarkUrl: "https://console.groq.com/docs/models",
      };

      const { title, body } = buildIssueContent(metadata);

      expect(title).toBe("🤖 [Model Watch] New Groq model detected: whisper-large-v4");
      expect(body).toContain("## 🤖 New AI Model Detected: `whisper-large-v4`");
      expect(body).toContain("| **Provider** | Groq |");
      expect(body).toContain("| **Context Window** | 448 tokens |");
      expect(body).toContain("vsub input.mp4 --groq-model whisper-large-v4");
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

  describe("runModelWatcher", () => {
    it("should identify new models and respect deduplication and dry-run", async () => {
      const mockGeminiFetcher = vi.fn().mockResolvedValue([
        { id: "gemini-2.0-flash", provider: "Gemini" },
        { id: "gemini-3.0-flash", provider: "Gemini" },
        { id: "gemini-4.0-flash", provider: "Gemini" },
      ] satisfies ModelMetadata[]);

      const mockGroqFetcher = vi.fn().mockResolvedValue([
        { id: "whisper-large-v3", provider: "Groq" },
        { id: "whisper-large-v4", provider: "Groq" },
      ] satisfies ModelMetadata[]);

      const mockChecker = vi.fn().mockImplementation(async (title: string) => {
        return title.includes("gemini-3.0-flash"); // Simulate existing issue
      });
      const mockCreator = vi.fn().mockResolvedValue(true);

      const knownGemini = new Set(["gemini-2.0-flash"]);
      const knownGroq = new Set(["whisper-large-v3"]);

      const results = await runModelWatcher({
        dryRun: true,
        fetchGemini: mockGeminiFetcher,
        fetchGroq: mockGroqFetcher,
        knownGemini,
        knownGroq,
        issueChecker: mockChecker,
        issueCreator: mockCreator,
      });

      expect(Array.isArray(results)).toBe(true);
      expect(results).toHaveLength(2);

      const geminiResult = results.find((r) => r.provider === "Gemini");
      expect(geminiResult?.detectedModels).toHaveLength(3);
      expect(geminiResult?.newModels).toHaveLength(2); // 3.0 and 4.0
      expect(geminiResult?.skippedIssues).toEqual(["gemini-3.0-flash"]);
      expect(geminiResult?.createdIssues).toEqual(["gemini-4.0-flash"]);

      const groqResult = results.find((r) => r.provider === "Groq");
      expect(groqResult?.detectedModels).toHaveLength(2);
      expect(groqResult?.newModels).toHaveLength(1); // v4
      expect(groqResult?.createdIssues).toEqual(["whisper-large-v4"]);
    });

    it("should not write to GITHUB_STEP_SUMMARY by default during tests", async () => {
      const appendSpy = vi.spyOn(fs, "appendFileSync").mockImplementation(() => {});
      const originalSummary = process.env["GITHUB_STEP_SUMMARY"];
      process.env["GITHUB_STEP_SUMMARY"] = "/mock/path/summary.md";

      try {
        await runModelWatcher({
          fetchGemini: vi.fn().mockResolvedValue([]),
          fetchGroq: vi.fn().mockResolvedValue([]),
        });

        expect(appendSpy).not.toHaveBeenCalled();
      } finally {
        if (originalSummary !== undefined) {
          process.env["GITHUB_STEP_SUMMARY"] = originalSummary;
        } else {
          delete process.env["GITHUB_STEP_SUMMARY"];
        }
        appendSpy.mockRestore();
      }
    });

    it("should write to GITHUB_STEP_SUMMARY when writeSummary is explicitly true", async () => {
      const appendSpy = vi.spyOn(fs, "appendFileSync").mockImplementation(() => {});
      const originalSummary = process.env["GITHUB_STEP_SUMMARY"];
      process.env["GITHUB_STEP_SUMMARY"] = "/mock/path/summary.md";

      try {
        await runModelWatcher({
          writeSummary: true,
          fetchGemini: vi.fn().mockResolvedValue([]),
          fetchGroq: vi.fn().mockResolvedValue([]),
        });

        expect(appendSpy).toHaveBeenCalledWith(
          "/mock/path/summary.md",
          expect.stringContaining("AI Model Watch Summary"),
          "utf-8",
        );
      } finally {
        if (originalSummary !== undefined) {
          process.env["GITHUB_STEP_SUMMARY"] = originalSummary;
        } else {
          delete process.env["GITHUB_STEP_SUMMARY"];
        }
        appendSpy.mockRestore();
      }
    });
  });
});
