import { stripVTControlCharacters } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SrtEntry } from "../srt.js";
import { createGeminiTextModel } from "./gemini.js";
import type { TextModel } from "./model.js";
import {
  asyncPool,
  buildRefinePrompt,
  buildSceneNotesPrompt,
  buildTranslationPrompt,
  DEFAULT_CONTEXT_WINDOW_SIZE,
  generateChapters,
  generateSceneNotes,
  generateSummary,
  refineSrtEntries,
  SCENE_NOTES_MAX_INPUT_CHARS,
  SCENE_NOTES_PROMPT_ID,
  translateSrtEntries,
} from "./tasks.js";

const mockGenerateContent = vi.fn();

function textItems(texts: string[], startId = 1) {
  return texts.map((text, index) => ({ id: startId + index, text }));
}

function readInput(prompt: string): Array<{ id: number; text: string }> {
  return JSON.parse(prompt.split("Input Array:\n")[1] ?? "[]");
}

function makeEntries(count: number): SrtEntry[] {
  return Array.from({ length: count }, (_, idx) => ({
    id: idx + 1,
    startTime: `00:00:${String(idx).padStart(2, "0")},000`,
    endTime: `00:00:${String(idx).padStart(2, "0")},900`,
    text: `Original line ${idx + 1}`,
  }));
}
vi.mock("@google/genai", () => {
  return {
    GoogleGenAI: class MockGoogleGenAI {
      models = {
        generateContent: mockGenerateContent,
      };
    },
    Type: {
      ARRAY: "ARRAY",
      STRING: "STRING",
      NUMBER: "NUMBER",
      INTEGER: "INTEGER",
      BOOLEAN: "BOOLEAN",
      OBJECT: "OBJECT",
    },
    ThinkingLevel: {
      LOW: "LOW",
    },
  };
});

describe("src/text/tasks.ts", () => {
  it("uses scene notes prompt version 2", () => {
    expect(SCENE_NOTES_PROMPT_ID).toBe("scene-notes/2");
  });

  it("builds numbered scene notes without timestamps or speaker labels", () => {
    const entries = makeEntries(1).map((entry) => ({
      ...entry,
      text: "Hello\r\nthere",
      speaker: "speaker_0",
    }));
    const prompt = buildSceneNotesPrompt(entries, "ja");
    expect(prompt).toContain("Write the notes in Japanese, 2 to 4 sentences, under 200 characters");
    expect(prompt).toContain("do not judge politeness from friendliness alone");
    expect(
      prompt,
    ).toContain(`Only state what the transcript supports. Describe age or status only as a relative difference that the transcript clearly shows (for example, "much older" or "younger sister"). Never write a number for anyone's age, not even as an estimate or in parentheses.

Write every sentence as a description of the people, such as "A speaks casually to B". Do not address the translator: no requests, commands, or advice (for example "please", "keep", "make sure", "use"). Do not summarize the plot, do not list words, and do not add a character count.`);
    expect(prompt).not.toContain("do not give exact ages");
    expect(prompt).not.toContain("do not write instructions");
    expect(prompt).toContain("do not add a character count");
    expect(prompt).toContain('Return ONLY a JSON object with one field, "notes"');
    expect(prompt).toContain("TRANSCRIPT:\n1: Hello there");
    expect(prompt).not.toContain("speaker_0");
    expect(prompt).not.toContain("00:00:");
  });

  it("limits scene notes input at whole line boundaries including separators", () => {
    const entries = makeEntries(3);
    const first = entries[0];
    if (!first) throw new Error("Missing first entry");
    first.text = "a".repeat(SCENE_NOTES_MAX_INPUT_CHARS - 3);
    const prompt = buildSceneNotesPrompt(entries, "ko");
    expect(prompt).toContain("TRANSCRIPT (the first 1 of 3 lines):\n1: ");
    expect(prompt).not.toContain("2: Original");
    expect(buildSceneNotesPrompt(entries.slice(0, 1), "ja")).toContain("TRANSCRIPT:\n");
  });

  it.each(["（168字）", "(168 characters)", "（ 168 文字 ）", "(168 chars)", ""])(
    "cleans the scene notes suffix %s",
    async (suffix) => {
      mockGenerateContent.mockResolvedValue({
        text: JSON.stringify({ notes: `  Notes. ${suffix}  ` }),
      });
      expect(await generateSceneNotes(makeEntries(1), "ja", defaultModel)).toBe("Notes.");
    },
  );

  it.each([{}, { notes: 1 }, { notes: "  " }, { notes: "（168字）" }])(
    "rejects invalid scene notes %j after retrying",
    async (value) => {
      vi.useFakeTimers();
      try {
        mockGenerateContent.mockResolvedValue({ text: JSON.stringify(value) });
        const result = expect(
          generateSceneNotes(makeEntries(1), "ja", defaultModel),
        ).rejects.toThrow();
        await vi.runAllTimersAsync();
        await result;
        expect(mockGenerateContent).toHaveBeenCalledTimes(4);
      } finally {
        vi.useRealTimers();
      }
    },
  );
  it("passes speakers only to translation, including preceding context, and preserves them", async () => {
    const entries = makeEntries(51).map((entry, i) =>
      i === 49 ? { ...entry, speaker: "speaker_0" } : entry,
    );
    mockGenerateContent.mockImplementation(async ({ contents }: { contents: string }) => ({
      text: JSON.stringify(readInput(contents).map((item) => ({ id: item.id, text: "Changed" }))),
    }));
    const refined = await refineSrtEntries(entries, defaultModel);
    expect(refined.entries[49]?.speaker).toBe("speaker_0");
    for (const [call] of mockGenerateContent.mock.calls)
      expect(call.contents).not.toContain("speaker_0");
    mockGenerateContent.mockClear();
    const translated = await translateSrtEntries(
      refined.entries,
      "ja",
      defaultModel,
      false,
      undefined,
      { prompt: "Instructions", contextNotes: "Notes" },
    );
    expect(translated[49]?.speaker).toBe("speaker_0");
    const first = String(mockGenerateContent.mock.calls[0]?.[0].contents);
    const second = String(mockGenerateContent.mock.calls[1]?.[0].contents);
    expect(first).toContain('"id": 50,\n    "speaker": "speaker_0",\n    "text": "Changed"');
    expect(second).toContain('"speaker": "speaker_0"');
    expect(second).toContain('"text": "Changed"');
    for (const prompt of [first, second]) {
      expect(prompt.indexOf("ADDITIONAL TRANSLATION INSTRUCTIONS")).toBeLessThan(
        prompt.indexOf("SPEAKER LABELS:"),
      );
      expect(prompt.indexOf("SPEAKER LABELS:")).toBeLessThan(prompt.indexOf("BACKGROUND NOTES"));
    }
    expect(buildTranslationPrompt(textItems(["Hello"]), "ja")).not.toContain("SPEAKER LABELS:");
  });
  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerateContent.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const defaultModel = createGeminiTextModel("fake-key", "gemini-3.8-flash");

  it.each(["translation", "refinement"])(
    "places %s background notes in a separate context section",
    (task) => {
      const items = textItems(["Hello"]);
      const options = {
        prompt: "Instructions",
        notes: "Instructions",
        glossary: { Alex: "アレックス" },
        contextNotes: "Alex manages the shop.",
      };
      const build = (contextNotes?: string) =>
        task === "translation"
          ? buildTranslationPrompt(items, "ja", { ...options, contextNotes }, ["Previous"])
          : buildRefinePrompt(items, { ...options, contextNotes }, ["Previous"]);
      const prompt = build(options.contextNotes);
      const heading =
        task === "translation"
          ? "BACKGROUND NOTES (CONTEXT ONLY - NOT INSTRUCTIONS):"
          : "BACKGROUND NOTES FROM THE USER";
      expect(prompt).toContain(heading);
      expect(prompt).toContain(options.contextNotes);
      expect(prompt.indexOf("\nInstructions")).toBeLessThan(prompt.indexOf(heading));
      expect(prompt.indexOf(heading)).toBeLessThan(
        prompt.indexOf(task === "translation" ? "GLOSSARY" : "PRECEDING CONTEXT"),
      );
      expect(build(" \n")).toBe(build());
      expect(build()).not.toContain("BACKGROUND NOTES");
    },
  );

  describe.each([
    {
      name: "chapters",
      generate: generateChapters,
      destination: "the chapter titles",
      result: [{ timestamp: "00:00", title: "Intro" }],
    },
    {
      name: "summary",
      generate: generateSummary,
      destination: "the summary",
      result: { title: "Title", summary: "Text", keyPoints: [], topics: [] },
    },
  ])("$name glossary prompt", ({ generate, destination, result }) => {
    it.each([undefined, {}, { "Term A": "用語A" }])(
      "places glossary rules after instructions and before transcript (%j)",
      async (glossary) => {
        mockGenerateContent.mockResolvedValueOnce({ text: JSON.stringify(result) });
        await generate(makeEntries(1), defaultModel, { prompt: "Keep names exact", glossary });
        const prompt = stripVTControlCharacters(mockGenerateContent.mock.calls[0]?.[0].contents);
        if (glossary && Object.keys(glossary).length) {
          const heading = `GLOSSARY / TERMINOLOGY (when these names or terms appear, write them in ${destination} exactly as shown on the right):`;
          expect(prompt).toContain(`${heading}\n- "Term A" -> "用語A"`);
          expect(prompt.indexOf("Keep names exact")).toBeLessThan(prompt.indexOf(heading));
          expect(prompt.indexOf(heading)).toBeLessThan(prompt.indexOf("Timestamped Transcript:"));
        } else {
          expect(prompt).not.toContain("GLOSSARY");
        }
      },
    );
  });

  it.each(["translation", "refinement"])(
    "routes verbose %s chunks to stderr only",
    async (task) => {
      const stdout = vi.spyOn(console, "log").mockImplementation(() => {});
      const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const entries = makeEntries(1);
        mockGenerateContent.mockResolvedValueOnce({ text: JSON.stringify(textItems(["Result"])) });
        if (task === "translation") await translateSrtEntries(entries, "ja", defaultModel, true);
        else await refineSrtEntries(entries, defaultModel, true);
        expect(stderr.mock.calls.map(([line]) => stripVTControlCharacters(String(line)))).toEqual([
          `[Gemini API] ${task === "translation" ? "Translating" : "Refining"} chunk (1/1) [1 items] [model: gemini-3.8-flash]...`,
        ]);
        expect(stdout).not.toHaveBeenCalled();
      } finally {
        vi.restoreAllMocks();
      }
    },
  );

  describe("translation checkpoints", () => {
    afterEach(() => vi.useRealTimers());

    it.each(["translation", "refinement"])(
      "does not send the third %s chunk after four failures",
      async (task) => {
        vi.useFakeTimers();
        mockGenerateContent.mockImplementation(async ({ contents }: { contents: string }) => {
          const input = readInput(contents);
          if (input[0]?.id !== 1) throw new Error("Unavailable");
          return { text: JSON.stringify(input) };
        });
        const entries = makeEntries(101);
        const result =
          task === "translation"
            ? translateSrtEntries(entries, "ja", defaultModel, false, undefined, { concurrency: 1 })
            : refineSrtEntries(entries, defaultModel, false, undefined, { concurrency: 1 });
        const assertion = expect(result).rejects.toThrow("failed after 4 attempts on chunk 2/3");
        await vi.runAllTimersAsync();
        await assertion;
        expect(mockGenerateContent).toHaveBeenCalledTimes(5);
      },
    );

    it("reuses checkpoints while keeping request ids, context, and progress", async () => {
      const entries = makeEntries(101);
      mockGenerateContent.mockImplementation(async ({ contents }: { contents: string }) => ({
        text: JSON.stringify(readInput(contents)),
      }));
      await translateSrtEntries(entries, "ja", defaultModel, false, undefined, { concurrency: 1 });
      const originalRequests = mockGenerateContent.mock.calls.map(([request]) => request.contents);
      mockGenerateContent.mockClear();
      const onProgress = vi.fn();
      const onChunkComplete = vi.fn();
      const saved = entries.slice(0, 50).map(() => "Saved translation");
      const result = await translateSrtEntries(entries, "ja", defaultModel, false, onProgress, {
        concurrency: 1,
        completedChunks: { "0": saved },
        onChunkComplete,
      });
      expect(result.slice(0, 50).map((entry) => entry.text)).toEqual(saved);
      expect(result.slice(50)).toEqual(entries.slice(50));
      expect(mockGenerateContent.mock.calls.map(([request]) => request.contents)).toEqual(
        originalRequests.slice(1),
      );
      expect(onChunkComplete.mock.calls).toEqual([
        [1, entries.slice(50, 100).map((entry) => entry.text)],
        [2, [entries[100]?.text]],
      ]);
      expect(onProgress.mock.calls).toEqual([
        [2, 3],
        [3, 3],
      ]);
    });
  });

  describe("subtitle id matching", () => {
    const entries = makeEntries(4).map((entry) => ({ ...entry, id: 9 }));
    const answer = textItems(["One", "Two", "Three", "Four"]);

    afterEach(() => vi.useRealTimers());

    it.each(["translation", "refinement"])(
      "builds %s prompts with ids and plain context",
      (task) => {
        const items = textItems(["First", "Second"], 51);
        const context = ["Previous"];
        const prompt =
          task === "translation"
            ? buildTranslationPrompt(items, "ja", undefined, context)
            : buildRefinePrompt(items, undefined, context);
        const textDescription =
          task === "translation"
            ? "the translation of that item's text"
            : "the proofread text of that item";
        expect(prompt).toContain(
          `1. Return ONLY a valid JSON array of objects. Each object has "id" (copied unchanged from the input item) and "text" (${textDescription}).`,
        );
        expect(prompt).toContain(
          '2. Return exactly one object for each of the 2 input items, using the same "id" values. Do NOT merge, split, skip, or add items.',
        );
        expect(readInput(prompt)).toEqual(items);
        expect(prompt.split("Input Array:\n")[0]).toContain(JSON.stringify(context, null, 2));
        expect(prompt.split("Input Array:\n")[0]).not.toContain('"id":');
      },
    );

    it("uses global positional ids across 120 entries and sends the object schema", async () => {
      const manyEntries = makeEntries(120).map((entry, index) => ({
        ...entry,
        id: 9,
        text: `Line ${index + 1}`,
      }));
      mockGenerateContent.mockImplementation(async ({ contents }: { contents: string }) => ({
        text: JSON.stringify(readInput(contents)),
      }));
      const result = await translateSrtEntries(manyEntries, "ja", defaultModel, false, undefined, {
        concurrency: 1,
      });
      expect(mockGenerateContent).toHaveBeenCalledTimes(3);
      for (const [index, call] of mockGenerateContent.mock.calls.entries()) {
        const request = call[0];
        expect(readInput(request.contents).map((item) => item.id)).toEqual(
          Array.from({ length: index === 2 ? 20 : 50 }, (_, offset) => index * 50 + offset + 1),
        );
        expect(request.config.responseSchema).toMatchObject({
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: { id: { type: "INTEGER" }, text: { type: "STRING" } },
            required: ["id", "text"],
          },
        });
      }
      expect(result).toEqual(manyEntries);
    });

    it.each(["translation", "refinement"])(
      "restores %s order and accepts digit-string ids",
      async (task) => {
        mockGenerateContent.mockResolvedValueOnce({
          text: JSON.stringify([answer[3], { id: "2", text: "Two" }, answer[0], answer[2]]),
        });
        const result =
          task === "translation"
            ? await translateSrtEntries(entries, "ja", defaultModel)
            : (await refineSrtEntries(entries, defaultModel)).entries;
        expect(result).toEqual(
          entries.map((entry, index) => ({ ...entry, text: answer[index]?.text })),
        );
        expect(mockGenerateContent).toHaveBeenCalledTimes(1);
      },
    );

    const badAnswers = [
      { name: "missing", value: answer.slice(0, 3) },
      { name: "unexpected", value: [...answer.slice(0, 3), { id: 51, text: "Extra" }] },
      { name: "duplicated", value: [answer[0], answer[2], answer[3], answer[3]] },
      { name: "absent id", value: [...answer.slice(0, 3), { text: "No id" }] },
      { name: "non-string text", value: [...answer.slice(0, 3), { id: 4, text: null }] },
      { name: "old string array", value: ["One", "Two", "Three", "Four"] },
      ...[1.5, -1, "-1", "1.5", " 4", "4x", null].map((id) => ({
        name: `invalid id ${JSON.stringify(id)}`,
        value: [...answer.slice(0, 3), { id, text: "Bad" }],
      })),
      { name: "non-array", value: { wrong: "shape" } },
    ];

    it.each(badAnswers)(
      "retries translation for $name and accepts the next valid answer",
      async ({ value }) => {
        vi.useFakeTimers();
        mockGenerateContent
          .mockResolvedValueOnce({ text: JSON.stringify(value) })
          .mockResolvedValueOnce({ text: JSON.stringify(answer) });
        const promise = translateSrtEntries(entries, "ja", defaultModel);
        await vi.runAllTimersAsync();
        expect((await promise).map((entry) => entry.text)).toEqual(answer.map((item) => item.text));
        expect(mockGenerateContent).toHaveBeenCalledTimes(2);
      },
    );

    it.each(badAnswers.filter(({ name }) => name !== "non-array"))(
      "keeps only the mismatched refinement chunk for $name without retrying",
      async ({ value }) => {
        const manyEntries = makeEntries(54);
        mockGenerateContent.mockImplementation(async ({ contents }: { contents: string }) => {
          const input = readInput(contents);
          return {
            text: JSON.stringify(
              input[0]?.id === 1
                ? input.map((item) => ({ ...item, text: "Fixed" }))
                : Array.isArray(value)
                  ? value.map((item: unknown) => {
                      if (
                        typeof item !== "object" ||
                        item === null ||
                        !("id" in item) ||
                        typeof item.id !== "number"
                      )
                        return item;
                      return { ...item, id: item.id + 50 };
                    })
                  : value,
            ),
          };
        });
        const result = await refineSrtEntries(manyEntries, defaultModel, false, undefined, {
          concurrency: 1,
        });
        expect(result.fallbackChunks).toBe(1);
        expect(result.totalChunks).toBe(2);
        expect(result.entries.slice(0, 50).every((entry) => entry.text === "Fixed")).toBe(true);
        expect(result.entries.slice(50)).toEqual(manyEntries.slice(50));
        expect(mockGenerateContent).toHaveBeenCalledTimes(2);
      },
    );

    it.each([
      {
        value: [answer[0], answer[2], answer[3], answer[3]],
        count: 4,
        detail: "missing: 2; duplicated: 4",
      },
      {
        value: [
          { id: 51, text: "Extra" },
          { id: 51, text: "Again" },
          { id: 1, text: null },
        ],
        count: 4,
        detail: "missing: 1, 2, 3, 4; unexpected: 51; duplicated: 51; invalid items: 1",
      },
      {
        value: Array.from({ length: 7 }, (_, index) => ({ id: 20 - index, text: "Extra" })).flatMap(
          (item) => [item, item],
        ),
        count: 8,
        detail:
          "missing: 1, 2, 3, 4, 5, …(+3); unexpected: 14, 15, 16, 17, 18, …(+2); duplicated: 14, 15, 16, 17, 18, …(+2)",
      },
      { value: null, count: 4, detail: null },
    ])(
      "fails after four attempts with bounded id diagnostics: $detail",
      async ({ value, count, detail }) => {
        vi.useFakeTimers();
        mockGenerateContent.mockResolvedValue({ text: JSON.stringify(value) });
        const input = makeEntries(count);
        const assertion = expect(translateSrtEntries(input, "ja", defaultModel)).rejects.toThrow(
          `Gemini API translation failed after 4 attempts on chunk 1/1: Gemini API ${detail === null ? "returned invalid format (expected array)" : `returned items that do not match the input ids (${detail})`}`,
        );
        await Promise.all([vi.runAllTimersAsync(), assertion]);
        expect(mockGenerateContent).toHaveBeenCalledTimes(4);
      },
    );
  });

  describe("asyncPool", () => {
    it.each([false, true])(
      "drains started tasks and preserves the first failure (both fail: %s)",
      async (bothFail) => {
        const first = new Error("First failure");
        const pending = Promise.withResolvers<void>();
        const started: number[] = [];
        let finished = false;
        let settled = false;
        const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
        const result = asyncPool(2, [0, 1, 2, 3, 4], async (item) => {
          started.push(item);
          if (item === 1) throw first;
          await pending.promise;
          finished = true;
          if (bothFail) throw new Error("Later failure");
          return item;
        });
        const outcome = result.then(
          () => {
            settled = true;
            return undefined;
          },
          (error: unknown) => {
            settled = true;
            return error;
          },
        );
        await flush();
        // The started task is still running, so the pool must not have settled yet.
        expect(settled).toBe(false);
        pending.resolve();
        await expect(outcome).resolves.toBe(first);
        expect(finished).toBe(true);
        await flush();
        // No new task may start after the first failure.
        expect(started).toEqual([0, 1]);
      },
    );
    it("should return empty array for empty items", async () => {
      const result = await asyncPool(3, [], async (x) => x);
      expect(result).toEqual([]);
    });

    it("should process items with concurrency limit and preserve order", async () => {
      const items = [1, 2, 3, 4, 5];
      let activeCount = 0;
      let maxActiveCount = 0;

      const result = await asyncPool(2, items, async (item) => {
        activeCount++;
        maxActiveCount = Math.max(maxActiveCount, activeCount);
        const delay = item % 2 === 1 ? 50 : 10;
        await new Promise((resolve) => setTimeout(resolve, delay));
        activeCount--;
        return item * 10;
      });

      expect(result).toEqual([10, 20, 30, 40, 50]);
      expect(maxActiveCount).toBeLessThanOrEqual(2);
    });

    it("should propagate errors from taskFn", async () => {
      const items = [1, 2, 3];
      await expect(
        asyncPool(2, items, async (item) => {
          if (item === 2) throw new Error("Worker failure");
          return item;
        }),
      ).rejects.toThrow("Worker failure");
    });
  });

  describe("buildTranslationPrompt", () => {
    it("should build standard prompt without preceding context", () => {
      const texts = textItems(["Hello world", "How are you?"]);
      const prompt = buildTranslationPrompt(texts, "ja");

      expect(prompt).toContain(
        'Translate the following array of subtitle texts into target language code "ja".',
      );
      expect(prompt).toContain("STRICT RULES:");
      expect(prompt).toContain(
        '1. Return ONLY a valid JSON array of objects. Each object has "id" (copied unchanged from the input item) and "text" (the translation of that item\'s text).',
      );
      expect(prompt).toContain(
        '2. Return exactly one object for each of the 2 input items, using the same "id" values. Do NOT merge, split, skip, or add items.',
      );
      expect(prompt).toContain(
        "3. Translate into natural, clear conversational style suited for video subtitles.",
      );
      expect(prompt).toContain("4. Do NOT include markdown code blocks");
      expect(prompt).not.toContain('5. Translate ONLY the items in "Input Array"');
      expect(prompt).not.toContain("PRECEDING CONTEXT");
      expect(readInput(prompt)).toEqual(texts);
    });

    it("should inject preceding context and rule 5 when contextTexts is provided", () => {
      const texts = textItems(["Current line 1", "Current line 2"]);
      const contextTexts = ["Preceding dialogue 1", "Preceding dialogue 2"];
      const prompt = buildTranslationPrompt(texts, "ja", undefined, contextTexts);

      expect(prompt).toContain(
        '5. Translate ONLY the items in "Input Array". Do NOT translate, output, or include items from "Preceding Context".',
      );
      expect(prompt).toContain("PRECEDING CONTEXT (FOR REFERENCE ONLY - DO NOT TRANSLATE):");
      expect(prompt).toContain(
        "The following lines immediately precede the input subtitles in the media.",
      );
      expect(prompt).toContain('"Preceding dialogue 1"');
      expect(prompt).toContain('"Preceding dialogue 2"');
      expect(readInput(prompt)).toEqual(texts);
    });

    it("should not inject preceding context if contextTexts is empty", () => {
      const texts = textItems(["Line 1"]);
      const prompt = buildTranslationPrompt(texts, "es", undefined, []);

      expect(prompt).not.toContain('5. Translate ONLY the items in "Input Array"');
      expect(prompt).not.toContain("PRECEDING CONTEXT");
    });
  });

  describe("translateSrtEntries", () => {
    it("should return an empty array if entries are empty without calling API", async () => {
      const result = await translateSrtEntries([], "ja", defaultModel);
      expect(result).toEqual([]);
      expect(mockGenerateContent).not.toHaveBeenCalled();
    });

    it("should translate entries within a single chunk and preserve timestamps", async () => {
      const entries: SrtEntry[] = [
        {
          id: 1,
          startTime: "00:00:01,000",
          endTime: "00:00:04,000",
          text: "Hello",
        },
        {
          id: 2,
          startTime: "00:00:05,000",
          endTime: "00:00:08,000",
          text: "How are you?",
        },
      ];

      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify(textItems(["こんにちは", "元気ですか？"])),
      });

      const result = await translateSrtEntries(entries, "ja", defaultModel);

      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
      expect(result).toEqual([
        {
          id: 1,
          startTime: "00:00:01,000",
          endTime: "00:00:04,000",
          text: "こんにちは",
        },
        {
          id: 2,
          startTime: "00:00:05,000",
          endTime: "00:00:08,000",
          text: "元気ですか？",
        },
      ]);
    });

    it("should handle JSON wrapped with markdown codeblocks", async () => {
      const entries: SrtEntry[] = [
        {
          id: 1,
          startTime: "00:00:01,000",
          endTime: "00:00:02,000",
          text: "Test",
        },
      ];

      mockGenerateContent.mockResolvedValueOnce({
        text: `\`\`\`json\n${JSON.stringify(textItems(["テスト"]))}\n\`\`\``,
      });

      const result = await translateSrtEntries(entries, "ja", defaultModel);
      expect(result[0]?.text).toBe("テスト");
    });

    it("should send responseSchema with an array of id and text objects in generateContent config", async () => {
      const entries: SrtEntry[] = [
        {
          id: 1,
          startTime: "00:00:01,000",
          endTime: "00:00:02,000",
          text: "Structured output test",
        },
      ];

      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify(textItems(["構造化出力テスト"])),
      });

      await translateSrtEntries(entries, "ja", defaultModel);

      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
      const callArgs = mockGenerateContent.mock.calls[0]?.[0];
      expect(callArgs.config).toEqual({
        responseMimeType: "application/json",
        responseSchema: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              id: { type: "INTEGER", description: "The id of the input item, copied unchanged" },
              text: { type: "STRING", description: "The translation of the input item's text" },
            },
            required: ["id", "text"],
          },
          description:
            "Array of translated subtitle texts matched by id to the input items (1 items).",
        },
        thinkingConfig: {
          thinkingLevel: "LOW",
        },
      });
    });

    it("should split entries exceeding DEFAULT_CHUNK_SIZE (50) into multiple chunks and preserve order with concurrency", async () => {
      const entries: SrtEntry[] = [];
      for (let i = 1; i <= 110; i++) {
        entries.push({
          id: i,
          startTime: "00:00:00,000",
          endTime: "00:00:01,000",
          text: `English ${i}`,
        });
      }

      mockGenerateContent.mockImplementation(async (req: { contents: string }) => {
        if (req.contents.includes('"English 1"')) {
          await new Promise((resolve) => setTimeout(resolve, 40));
          return {
            text: JSON.stringify(
              textItems(
                Array.from({ length: 50 }, (_, i) => `日本語 ${i + 1}`),
                1,
              ),
            ),
          };
        }
        if (req.contents.includes('"English 51"')) {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return {
            text: JSON.stringify(
              textItems(
                Array.from({ length: 50 }, (_, i) => `日本語 ${i + 51}`),
                51,
              ),
            ),
          };
        }
        return {
          text: JSON.stringify(
            textItems(
              Array.from({ length: 10 }, (_, i) => `日本語 ${i + 101}`),
              101,
            ),
          ),
        };
      });

      const result = await translateSrtEntries(entries, "ja", defaultModel, false, undefined, {
        concurrency: 3,
      });

      expect(mockGenerateContent).toHaveBeenCalledTimes(3);
      expect(result).toHaveLength(110);
      expect(result[0]?.text).toBe("日本語 1");
      expect(result[49]?.text).toBe("日本語 50");
      expect(result[50]?.text).toBe("日本語 51");
      expect(result[99]?.text).toBe("日本語 100");
      expect(result[100]?.text).toBe("日本語 101");
      expect(result[109]?.text).toBe("日本語 110");
    });

    it("should use model.limits.defaultConcurrency when options.concurrency is not provided", async () => {
      const entries: SrtEntry[] = [];
      for (let i = 1; i <= 100; i++) {
        entries.push({
          id: i,
          startTime: "00:00:00,000",
          endTime: "00:00:01,000",
          text: `Entry ${i}`,
        });
      }

      let activeWorkers = 0;
      let maxActiveWorkers = 0;

      const fakeModel: TextModel = {
        logLabel: "TestModel",
        model: "fake-test-model",
        limits: { defaultConcurrency: 1 },
        generateJson: async (request) => {
          activeWorkers++;
          maxActiveWorkers = Math.max(maxActiveWorkers, activeWorkers);
          await new Promise((resolve) => setTimeout(resolve, 20));
          activeWorkers--;
          return JSON.stringify(
            readInput(request.prompt).map((item) => ({ ...item, text: "translated" })),
          );
        },
        classifyError: () => "retry",
        formatModelNotFound: () => "not found",
      };

      await translateSrtEntries(entries, "ja", fakeModel);
      expect(maxActiveWorkers).toBe(1);
    });

    it("should call onProgress callback for each completed chunk", async () => {
      const entries: SrtEntry[] = [];
      for (let i = 1; i <= 60; i++) {
        entries.push({
          id: i,
          startTime: "00:00:00,000",
          endTime: "00:00:01,000",
          text: `Entry ${i}`,
        });
      }

      mockGenerateContent
        .mockResolvedValueOnce({
          text: JSON.stringify(
            textItems(
              Array.from({ length: 50 }, (_, i) => `Translated ${i + 1}`),
              1,
            ),
          ),
        })
        .mockResolvedValueOnce({
          text: JSON.stringify(
            textItems(
              Array.from({ length: 10 }, (_, i) => `Translated ${i + 51}`),
              51,
            ),
          ),
        });

      const onProgress = vi.fn();
      await translateSrtEntries(entries, "ja", defaultModel, false, onProgress, { concurrency: 2 });

      expect(onProgress).toHaveBeenCalledTimes(2);
      expect(onProgress).toHaveBeenNthCalledWith(1, 1, 2);
      expect(onProgress).toHaveBeenNthCalledWith(2, 2, 2);
    });

    it("should inject custom prompt instructions and glossary rules into Gemini prompt", async () => {
      const entries: SrtEntry[] = [
        {
          id: 1,
          startTime: "00:00:01,000",
          endTime: "00:00:02,000",
          text: "We use Antigravity for agentic AI.",
        },
      ];

      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify(
          textItems(["私たちはエージェンティックAIのためにアンチグラビティを使用します。"]),
        ),
      });

      const customModel = createGeminiTextModel("fake-key", "gemini-3.7-flash");
      await translateSrtEntries(entries, "ja", customModel, false, undefined, {
        prompt: "Use polite and professional Japanese (です・ます調).",
        glossary: {
          Antigravity: "アンチグラビティ",
          "agentic AI": "エージェンティックAI",
        },
      });

      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
      const callArgs = mockGenerateContent.mock.calls[0]?.[0];
      expect(callArgs.model).toBe("gemini-3.7-flash");
      expect(callArgs.contents).toContain("ADDITIONAL TRANSLATION INSTRUCTIONS:");
      expect(callArgs.contents).toContain("Use polite and professional Japanese (です・ます調).");
      expect(callArgs.contents).toContain(
        "GLOSSARY / TERMINOLOGY RULES (MUST USE THESE EXACT TRANSLATIONS):",
      );
      expect(callArgs.contents).toContain('- "Antigravity" -> "アンチグラビティ"');
      expect(callArgs.contents).toContain('- "agentic AI" -> "エージェンティックAI"');
    });

    it("should fail fast without retrying when model not found error (404) occurs with default model", async () => {
      const entries: SrtEntry[] = [
        {
          id: 1,
          startTime: "00:00:01,000",
          endTime: "00:00:02,000",
          text: "Hello",
        },
      ];

      const notFoundError = new Error(
        "models/gemini-3.8-flash is not found for API version v1beta",
      );
      (notFoundError as { status?: number }).status = 404;
      mockGenerateContent.mockRejectedValue(notFoundError);

      await expect(translateSrtEntries(entries, "ja", defaultModel)).rejects.toThrow(
        /Default Gemini model 'gemini-3.8-flash' not found or may be retired by Google/,
      );

      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    });

    it("should return Japanese error when lang is ja", async () => {
      const entries: SrtEntry[] = [
        {
          id: 1,
          startTime: "00:00:01,000",
          endTime: "00:00:02,000",
          text: "Hello",
        },
      ];

      const notFoundError = new Error(
        "models/gemini-3.8-flash is not found for API version v1beta",
      );
      (notFoundError as { status?: number }).status = 404;
      mockGenerateContent.mockRejectedValue(notFoundError);

      await expect(
        translateSrtEntries(entries, "ja", defaultModel, false, undefined, { lang: "ja" }),
      ).rejects.toThrow(
        /デフォルトの Gemini モデル 'gemini-3.8-flash' が見つからないか、Google により提供終了（退役）した可能性があります/,
      );
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    });

    it("should inject preceding context of default 5 lines into subsequent chunks and not chunk 1", async () => {
      const entries: SrtEntry[] = [];
      for (let i = 1; i <= 60; i++) {
        entries.push({
          id: i,
          startTime: "00:00:00,000",
          endTime: "00:00:01,000",
          text: `Sentence ${i}`,
        });
      }

      mockGenerateContent
        .mockResolvedValueOnce({
          text: JSON.stringify(
            textItems(
              Array.from({ length: 50 }, (_, i) => `文 ${i + 1}`),
              1,
            ),
          ),
        })
        .mockResolvedValueOnce({
          text: JSON.stringify(
            textItems(
              Array.from({ length: 10 }, (_, i) => `文 ${i + 51}`),
              51,
            ),
          ),
        });

      await translateSrtEntries(entries, "ja", defaultModel, false, undefined, { concurrency: 1 });

      expect(mockGenerateContent).toHaveBeenCalledTimes(2);

      // Chunk 1 (first 50 items): must NOT have PRECEDING CONTEXT
      const call1Args = mockGenerateContent.mock.calls[0]?.[0];
      expect(call1Args.contents).not.toContain("PRECEDING CONTEXT");
      expect(call1Args.contents).not.toContain('5. Translate ONLY the items in "Input Array"');

      // Chunk 2 (last 10 items): MUST have PRECEDING CONTEXT with items 46..50
      const call2Args = mockGenerateContent.mock.calls[1]?.[0];
      expect(call2Args.contents).toContain(
        "PRECEDING CONTEXT (FOR REFERENCE ONLY - DO NOT TRANSLATE):",
      );
      expect(call2Args.contents).toContain(
        '5. Translate ONLY the items in "Input Array". Do NOT translate, output, or include items from "Preceding Context".',
      );
      expect(call2Args.contents).toContain('"Sentence 46"');
      expect(call2Args.contents).toContain('"Sentence 47"');
      expect(call2Args.contents).toContain('"Sentence 48"');
      expect(call2Args.contents).toContain('"Sentence 49"');
      expect(call2Args.contents).toContain('"Sentence 50"');
      expect(call2Args.contents).not.toContain('"Sentence 45"');
    });

    it("should respect custom contextWindowSize option", async () => {
      const entries: SrtEntry[] = [];
      for (let i = 1; i <= 60; i++) {
        entries.push({
          id: i,
          startTime: "00:00:00,000",
          endTime: "00:00:01,000",
          text: `Line ${i}`,
        });
      }

      mockGenerateContent
        .mockResolvedValueOnce({
          text: JSON.stringify(
            textItems(
              Array.from({ length: 50 }, (_, i) => `訳 ${i + 1}`),
              1,
            ),
          ),
        })
        .mockResolvedValueOnce({
          text: JSON.stringify(
            textItems(
              Array.from({ length: 10 }, (_, i) => `訳 ${i + 51}`),
              51,
            ),
          ),
        });

      await translateSrtEntries(entries, "ja", defaultModel, false, undefined, {
        concurrency: 1,
        contextWindowSize: 2,
      });

      const call2Args = mockGenerateContent.mock.calls[1]?.[0];
      expect(call2Args.contents).toContain("PRECEDING CONTEXT");
      expect(call2Args.contents).toContain('"Line 49"');
      expect(call2Args.contents).toContain('"Line 50"');
      expect(call2Args.contents).not.toContain('"Line 48"');
    });

    it("should disable sliding context window when contextWindowSize is 0", async () => {
      const entries: SrtEntry[] = [];
      for (let i = 1; i <= 60; i++) {
        entries.push({
          id: i,
          startTime: "00:00:00,000",
          endTime: "00:00:01,000",
          text: `Line ${i}`,
        });
      }

      mockGenerateContent
        .mockResolvedValueOnce({
          text: JSON.stringify(
            textItems(
              Array.from({ length: 50 }, (_, i) => `訳 ${i + 1}`),
              1,
            ),
          ),
        })
        .mockResolvedValueOnce({
          text: JSON.stringify(
            textItems(
              Array.from({ length: 10 }, (_, i) => `訳 ${i + 51}`),
              51,
            ),
          ),
        });

      await translateSrtEntries(entries, "ja", defaultModel, false, undefined, {
        concurrency: 1,
        contextWindowSize: 0,
      });

      const call2Args = mockGenerateContent.mock.calls[1]?.[0];
      expect(call2Args.contents).not.toContain("PRECEDING CONTEXT");
      expect(call2Args.contents).not.toContain('5. Translate ONLY the items in "Input Array"');
    });

    it("should export DEFAULT_CONTEXT_WINDOW_SIZE as 5", () => {
      expect(DEFAULT_CONTEXT_WINDOW_SIZE).toBe(5);
    });
  });

  describe("generateChapters", () => {
    const sampleEntries: SrtEntry[] = [
      { id: 1, startTime: "00:00:00,000", endTime: "00:00:10,000", text: "Welcome everyone" },
      { id: 2, startTime: "00:01:23,000", endTime: "00:01:35,000", text: "Moving to agenda" },
      { id: 3, startTime: "00:05:40,000", endTime: "00:05:55,000", text: "Now for the demo" },
    ];

    it("should return empty array for empty entries", async () => {
      const chapters = await generateChapters([], defaultModel);
      expect(chapters).toEqual([]);
      expect(mockGenerateContent).not.toHaveBeenCalled();
    });

    it("should call Gemini with responseSchema and return formatted chapters", async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify([
          { timestamp: "00:00", seconds: 0, title: "オープニング" },
          { timestamp: "01:23", seconds: 83, title: "本日のアジェンダ" },
          { timestamp: "05:40", seconds: 340, title: "デモ紹介" },
        ]),
      });

      const chapters = await generateChapters(sampleEntries, defaultModel, {
        targetLang: "ja",
        prompt: "Concise chapters",
      });

      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
      const callArg = (
        mockGenerateContent.mock.calls[0] as [{ contents: string; config: unknown }]
      )[0];
      expect(callArg.contents).toContain("Concise chapters");
      expect(callArg.contents).toContain("[00:00:00] Welcome everyone");
      expect(callArg.config).toEqual({
        responseMimeType: "application/json",
        responseSchema: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              timestamp: {
                type: "STRING",
                description: "Timestamp in MM:SS or HH:MM:SS format",
              },
              seconds: {
                type: "INTEGER",
                description: "Total seconds from start",
              },
              title: {
                type: "STRING",
                description: "Concise chapter title in target language",
              },
            },
            required: ["timestamp", "title"],
          },
          description: "Chronological list of video chapters",
        },
        thinkingConfig: {
          thinkingLevel: "LOW",
        },
      });
      expect(chapters).toEqual([
        { timestamp: "00:00", seconds: 0, title: "オープニング" },
        { timestamp: "01:23", seconds: 83, title: "本日のアジェンダ" },
        { timestamp: "05:40", seconds: 340, title: "デモ紹介" },
      ]);
    });

    it("should retry and succeed when first attempt returns array with null item", async () => {
      mockGenerateContent
        .mockResolvedValueOnce({
          text: JSON.stringify([null]),
        })
        .mockResolvedValueOnce({
          text: JSON.stringify([
            { timestamp: "00:00", seconds: 0, title: "Intro" },
            { timestamp: "01:00", seconds: 60, title: "Topic" },
          ]),
        });

      const chapters = await generateChapters(sampleEntries, defaultModel, { targetLang: "en" });
      expect(chapters).toEqual([
        { timestamp: "00:00", seconds: 0, title: "Intro" },
        { timestamp: "01:00", seconds: 60, title: "Topic" },
      ]);
      expect(mockGenerateContent).toHaveBeenCalledTimes(2);
    });

    it("should preserve the LLM chapter order and non-zero starts", async () => {
      const rawChapters = [
        { timestamp: "01:00", seconds: 60, title: "Chapter B" },
        { timestamp: "00:15", seconds: 15, title: "Chapter A" },
      ];
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify(rawChapters),
      });

      const chapters = await generateChapters(sampleEntries, defaultModel, { targetLang: "ja" });
      expect(chapters).toEqual(rawChapters);
    });

    it("should derive missing seconds without shifting or sorting chapters", async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify([
          { timestamp: "00:15", title: "Welcome & Intro" },
          { timestamp: "02:00", title: "Part 2" },
        ]),
      });

      const chapters = await generateChapters(sampleEntries, defaultModel, { targetLang: "en" });
      expect(chapters).toEqual([
        { timestamp: "00:15", seconds: 15, title: "Welcome & Intro" },
        { timestamp: "02:00", seconds: 120, title: "Part 2" },
      ]);
    });
  });

  describe("generateSummary", () => {
    const sampleEntries: SrtEntry[] = [
      { id: 1, startTime: "00:00:00,000", endTime: "00:00:15,000", text: "Hello and welcome" },
      {
        id: 2,
        startTime: "00:02:10,000",
        endTime: "00:02:30,000",
        text: "Discussing quarterly results",
      },
    ];

    it("should return empty summary structure for empty entries", async () => {
      const summary = await generateSummary([], defaultModel);
      expect(summary.title).toBe("No Content");
      expect(summary.keyPoints).toEqual([]);
      expect(mockGenerateContent).not.toHaveBeenCalled();
    });

    it("should call Gemini and return parsed summary result", async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          title: "Quarterly Review",
          summary: "Reviewed revenue and upcoming milestones.",
          keyPoints: ["Revenue up 20%", "Launched vsub-cli"],
          topics: [
            { timestamp: "00:00", title: "Intro", description: "Opening remarks" },
            { timestamp: "02:10", title: "Financials", description: "Detailed charts" },
          ],
        }),
      });

      const summary = await generateSummary(sampleEntries, defaultModel, {
        targetLang: "ja",
        prompt: "Focus on finance",
      });

      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
      const callArg = (
        mockGenerateContent.mock.calls[0] as [{ contents: string; config: unknown }]
      )[0];
      expect(callArg.contents).toContain("Focus on finance");
      expect(callArg.config).toEqual({
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            title: {
              type: "STRING",
              description: "Content title in target language",
            },
            summary: {
              type: "STRING",
              description: "Executive summary paragraph in target language",
            },
            keyPoints: {
              type: "ARRAY",
              items: { type: "STRING" },
              description: "List of key takeaways in target language",
            },
            topics: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  timestamp: {
                    type: "STRING",
                    description: "Timestamp in MM:SS or HH:MM:SS",
                  },
                  title: {
                    type: "STRING",
                    description: "Topic title in target language",
                  },
                  description: {
                    type: "STRING",
                    description: "Brief description of topic",
                  },
                },
                required: ["timestamp", "title", "description"],
              },
              description: "Key topics with timestamps",
            },
          },
          required: ["title", "summary", "keyPoints", "topics"],
        },
        thinkingConfig: {
          thinkingLevel: "LOW",
        },
      });
      expect(summary.title).toBe("Quarterly Review");
      expect(summary.keyPoints).toHaveLength(2);
      expect(summary.topics[1]?.timestamp).toBe("02:10");
    });

    it("should retry and succeed when first attempt returns null", async () => {
      mockGenerateContent
        .mockResolvedValueOnce({
          text: "null",
        })
        .mockResolvedValueOnce({
          text: JSON.stringify({
            title: "Summary Title",
            summary: "Summary text",
            keyPoints: ["Point"],
            topics: [{ timestamp: "00:00", title: "Intro", description: "Desc" }],
          }),
        });

      const summary = await generateSummary(sampleEntries, defaultModel, { targetLang: "en" });
      expect(summary.title).toBe("Summary Title");
      expect(mockGenerateContent).toHaveBeenCalledTimes(2);
    });
  });

  describe("buildRefinePrompt", () => {
    const baseTexts = textItems(["line one", "line two"]);

    it.each([
      {
        name: "omits optional language, context, glossary, and notes when absent",
        options: undefined,
        contextTexts: undefined,
        contains: [
          "You are proofreading automatic speech recognition (ASR) output for video subtitles.\nFix ONLY clear recognition errors",
          '2. Return exactly one object for each of the 2 input items, using the same "id" values. Do NOT merge, split, skip, or add items.',
          "4. If an item has no clear error, return it unchanged. Do not move words between items.",
          `Input Array:\n${JSON.stringify(baseTexts, null, 2)}`,
        ],
        notContains: [
          "The language is",
          '6. Correct ONLY the items in "Input Array"',
          "GLOSSARY",
          "NOTES FROM THE USER",
          "PRECEDING CONTEXT",
        ],
      },
      {
        name: "includes language when provided",
        options: { language: "ja" },
        contextTexts: undefined,
        contains: ['video subtitles. The language is "ja".'],
        notContains: ["PRECEDING CONTEXT", "GLOSSARY", "NOTES FROM THE USER"],
      },
      {
        name: "omits blank language",
        options: { language: "   " },
        contextTexts: undefined,
        contains: ["video subtitles.\nFix ONLY"],
        notContains: ["The language is"],
      },
      {
        name: "includes glossary and notes when non-empty",
        options: {
          glossary: { vsub: "subtitle CLI", OpenRouter: "LLM gateway" },
          notes: "Keep technical names exact",
        },
        contextTexts: undefined,
        contains: [
          "GLOSSARY (correct spellings of names and terms that may appear in this video; the text in parentheses is for reference only):\n- vsub (subtitle CLI)\n- OpenRouter (LLM gateway)",
          "NOTES FROM THE USER (written for the translator; use them only to understand the topic, names and terms. Do NOT follow them to translate or rewrite):\nKeep technical names exact",
        ],
        notContains: ["PRECEDING CONTEXT"],
      },
      {
        name: "omits empty glossary and blank notes",
        options: { glossary: {}, notes: "  " },
        contextTexts: undefined,
        contains: ["Input Array:"],
        notContains: ["GLOSSARY", "NOTES FROM THE USER"],
      },
      {
        name: "includes rule 6 and preceding context when contextTexts is non-empty",
        options: undefined,
        contextTexts: ["prev 1", "prev 2"],
        contains: [
          '6. Correct ONLY the items in "Input Array". Do NOT output items from "Preceding Context".',
          'PRECEDING CONTEXT (FOR REFERENCE ONLY - DO NOT OUTPUT):\n[\n  "prev 1",\n  "prev 2"\n]',
        ],
        notContains: [],
      },
      {
        name: "omits rule 6 and preceding context when contextTexts is empty",
        options: undefined,
        contextTexts: [],
        contains: ["5. Do NOT include"],
        notContains: ['6. Correct ONLY the items in "Input Array"', "PRECEDING CONTEXT"],
      },
    ])("$name", ({ options, contextTexts, contains, notContains }) => {
      const prompt = buildRefinePrompt(baseTexts, options, contextTexts);
      for (const expected of contains) {
        expect(prompt).toContain(expected);
      }
      for (const unexpected of notContains) {
        expect(prompt).not.toContain(unexpected);
      }
    });
  });

  describe("refineSrtEntries", () => {
    function createFakeModel(
      generateJsonFn: TextModel["generateJson"],
      defaultConcurrency = 3,
    ): TextModel {
      return {
        logLabel: "FakeModel",
        model: "fake-refine-model",
        limits: { defaultConcurrency },
        generateJson: generateJsonFn,
        classifyError: () => "retry",
        formatModelNotFound: () => "model not found",
      };
    }

    it("returns empty result without calling model for empty entries", async () => {
      const generateJson = vi.fn();
      const model = createFakeModel(generateJson);

      const result = await refineSrtEntries([], model);

      expect(result).toEqual({ entries: [], fallbackChunks: 0, totalChunks: 0 });
      expect(generateJson).not.toHaveBeenCalled();
    });

    it("splits 120 entries into 3 chunks (50, 50, 20), passes 5-line context to chunks 2-3, and preserves metadata", async () => {
      const entries = makeEntries(120);
      const requests: Array<{
        prompt: string;
        schemaName: string;
        schemaType: string;
        itemCount: number;
      }> = [];
      const onProgress = vi.fn();

      const model = createFakeModel(async (req) => {
        const inputArray = readInput(req.prompt);
        requests.push({
          prompt: req.prompt,
          schemaName: req.schemaName,
          schemaType: req.schema.type,
          itemCount: inputArray.length,
        });
        return JSON.stringify(
          inputArray.map((item) => ({ ...item, text: item.text.replace("Original", "Refined") })),
        );
      });

      const result = await refineSrtEntries(entries, model, false, onProgress, {
        concurrency: 1,
        language: "en",
      });

      expect(result.fallbackChunks).toBe(0);
      expect(result.totalChunks).toBe(3);
      expect(requests.map((r) => r.itemCount)).toEqual([50, 50, 20]);
      expect(requests.every((r) => r.schemaName === "refinement" && r.schemaType === "array")).toBe(
        true,
      );

      expect(requests[0]?.prompt).not.toContain("PRECEDING CONTEXT");
      expect(requests[1]?.prompt).toContain("PRECEDING CONTEXT");
      expect(requests[1]?.prompt).toContain('"Original line 46"');
      expect(requests[1]?.prompt).toContain('"Original line 50"');
      expect(requests[1]?.prompt).not.toContain('"Original line 45"');
      expect(requests[2]?.prompt).toContain("PRECEDING CONTEXT");
      expect(requests[2]?.prompt).toContain('"Original line 96"');
      expect(requests[2]?.prompt).toContain('"Original line 100"');
      expect(requests[2]?.prompt).not.toContain('"Original line 95"');

      expect(result.entries).toHaveLength(120);
      expect(result.entries[0]).toEqual({
        id: 1,
        startTime: "00:00:00,000",
        endTime: "00:00:00,900",
        text: "Refined line 1",
      });
      expect(result.entries[119]).toEqual({
        id: 120,
        startTime: "00:00:119,000",
        endTime: "00:00:119,900",
        text: "Refined line 120",
      });

      expect(onProgress).toHaveBeenCalledTimes(3);
      expect(onProgress).toHaveBeenNthCalledWith(1, 1, 3);
      expect(onProgress).toHaveBeenNthCalledWith(2, 2, 3);
      expect(onProgress).toHaveBeenNthCalledWith(3, 3, 3);
    });

    it("falls back to original text without retrying when a chunk returns mismatched array length", async () => {
      const entries = makeEntries(120);
      let chunk2Calls = 0;

      const generateJson = vi.fn(async (req: { prompt: string }) => {
        if (req.prompt.includes('"Original line 1"')) {
          return JSON.stringify(
            textItems(
              Array.from({ length: 50 }, (_, i) => `Refined ${i + 1}`),
              1,
            ),
          );
        }
        if (req.prompt.includes('"Original line 51"')) {
          chunk2Calls++;
          return JSON.stringify(
            textItems(
              Array.from({ length: 49 }, (_, i) => `Short ${i + 51}`),
              51,
            ),
          );
        }
        return JSON.stringify(
          textItems(
            Array.from({ length: 20 }, (_, i) => `Refined ${i + 101}`),
            101,
          ),
        );
      });

      const model = createFakeModel(generateJson);
      const result = await refineSrtEntries(entries, model, false, undefined, { concurrency: 1 });

      expect(generateJson).toHaveBeenCalledTimes(3);
      expect(chunk2Calls).toBe(1);
      expect(result.fallbackChunks).toBe(1);
      expect(result.totalChunks).toBe(3);
      expect(result.entries[0]?.text).toBe("Refined 1");
      expect(result.entries[50]?.text).toBe("Original line 51");
      expect(result.entries[99]?.text).toBe("Original line 100");
      expect(result.entries[100]?.text).toBe("Refined 101");
      expect(result.entries[119]?.text).toBe("Refined 120");
    });

    it("keeps original text if a non-empty line refines to whitespace only", async () => {
      const entries: SrtEntry[] = [
        { id: 1, startTime: "00:00:00,000", endTime: "00:00:01,000", text: "Keep me" },
        { id: 2, startTime: "00:00:01,000", endTime: "00:00:02,000", text: "Fix typo" },
      ];
      const model = createFakeModel(async () => JSON.stringify(textItems(["   ", "Fixed typo"])));

      const result = await refineSrtEntries(entries, model);

      expect(result.fallbackChunks).toBe(0);
      expect(result.entries.map((e) => e.text)).toEqual(["Keep me", "Fixed typo"]);
    });

    it("retries when response is invalid JSON or non-array JSON", async () => {
      vi.useFakeTimers();
      try {
        const entries = makeEntries(2);
        const generateJson = vi
          .fn()
          .mockResolvedValueOnce("not json at all")
          .mockResolvedValueOnce(JSON.stringify({ wrong: "shape" }))
          .mockResolvedValueOnce(JSON.stringify(textItems(["Fixed 1", "Fixed 2"])));

        const model = createFakeModel(generateJson);
        const promise = refineSrtEntries(entries, model);
        await vi.runAllTimersAsync();
        const result = await promise;

        expect(generateJson).toHaveBeenCalledTimes(3);
        expect(result.fallbackChunks).toBe(0);
        expect(result.entries.map((e) => e.text)).toEqual(["Fixed 1", "Fixed 2"]);
      } finally {
        vi.useRealTimers();
      }
    });

    it("uses model.limits.defaultConcurrency when options.concurrency is omitted", async () => {
      const entries = makeEntries(100);
      let active = 0;
      let maxActive = 0;

      const model = createFakeModel(async (request) => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 20));
        active--;
        return JSON.stringify(
          readInput(request.prompt).map((item) => ({ ...item, text: "refined" })),
        );
      }, 1);

      await refineSrtEntries(entries, model);
      expect(maxActive).toBe(1);
    });
  });
});
