import { describe, expect, it } from "vitest";
import { en } from "./en.js";
import { ja } from "./ja.js";

describe("i18n messages backwards compatibility with Gemini", () => {
  const table = [
    // English messages
    {
      name: "en.pipeline.step3TranslatingMulti",
      actual: en.pipeline.step3TranslatingMulti("Gemini", "gemini-3.8-flash", 1, 2, "JA", 1, 3),
      expected:
        "🌐 [3/4] Translating via Gemini (gemini-3.8-flash) (1/2 languages: JA [1/3 chunks])...",
    },
    {
      name: "en.pipeline.step3TranslatingSingle",
      actual: en.pipeline.step3TranslatingSingle("Gemini", "gemini-3.8-flash", "JA", 1, 3),
      expected: "🌐 [3/4] Translating into JA via Gemini (gemini-3.8-flash) [1/3 chunks]...",
    },
    {
      name: "en.pipeline.step3AllDone",
      actual: en.pipeline.step3AllDone("Gemini", "JA", 10),
      expected: "🌐 [3/4] Gemini translation complete (JA) - 10 lines",
    },
    {
      name: "en.translate.step2TranslatingMulti",
      actual: en.translate.step2TranslatingMulti("Gemini", "gemini-3.8-flash", 1, 2, "JA", 1, 3),
      expected:
        "🌐 [2/3] Translating via Gemini (gemini-3.8-flash) (1/2 languages: JA [1/3 chunks])...",
    },
    {
      name: "en.translate.step2TranslatingSingle",
      actual: en.translate.step2TranslatingSingle("Gemini", "gemini-3.8-flash", "JA", 1, 3),
      expected: "🌐 [2/3] Translating into JA via Gemini (gemini-3.8-flash) [1/3 chunks]...",
    },
    {
      name: "en.translate.step2Done",
      actual: en.translate.step2Done("Gemini", "JA", 10),
      expected: "🌐 [2/3] Gemini translation complete (JA) - 10 lines",
    },
    {
      name: "en.chapters.step2Generating",
      actual: en.chapters.step2Generating("Gemini", "gemini-3.8-flash", "JA"),
      expected: "Generating chapters with Gemini (gemini-3.8-flash) [JA]...",
    },
    {
      name: "en.summarize.step2Generating",
      actual: en.summarize.step2Generating("Gemini", "gemini-3.8-flash", "JA"),
      expected: "Generating summary with Gemini (gemini-3.8-flash) [JA]...",
    },

    // Japanese messages
    {
      name: "ja.pipeline.step3TranslatingMulti",
      actual: ja.pipeline.step3TranslatingMulti("Gemini", "gemini-3.8-flash", 1, 2, "JA", 1, 3),
      expected: "🌐 [3/4] Gemini (gemini-3.8-flash) で翻訳中 (1/2 言語: JA [1/3 チャンク])...",
    },
    {
      name: "ja.pipeline.step3TranslatingSingle",
      actual: ja.pipeline.step3TranslatingSingle("Gemini", "gemini-3.8-flash", "JA", 1, 3),
      expected: "🌐 [3/4] Gemini (gemini-3.8-flash) で JA に翻訳中 [1/3 チャンク]...",
    },
    {
      name: "ja.pipeline.step3AllDone",
      actual: ja.pipeline.step3AllDone("Gemini", "JA", 10),
      expected: "🌐 [3/4] Gemini 翻訳完了 (JA) - 10 行",
    },
    {
      name: "ja.translate.step2TranslatingMulti",
      actual: ja.translate.step2TranslatingMulti("Gemini", "gemini-3.8-flash", 1, 2, "JA", 1, 3),
      expected: "🌐 [2/3] Gemini (gemini-3.8-flash) で翻訳中 (1/2 言語: JA [1/3 チャンク])...",
    },
    {
      name: "ja.translate.step2TranslatingSingle",
      actual: ja.translate.step2TranslatingSingle("Gemini", "gemini-3.8-flash", "JA", 1, 3),
      expected: "🌐 [2/3] Gemini (gemini-3.8-flash) で JA に翻訳中 [1/3 チャンク]...",
    },
    {
      name: "ja.translate.step2Done",
      actual: ja.translate.step2Done("Gemini", "JA", 10),
      expected: "🌐 [2/3] Gemini 翻訳完了 (JA) - 10 行",
    },
    {
      name: "ja.chapters.step2Generating",
      actual: ja.chapters.step2Generating("Gemini", "gemini-3.8-flash", "JA"),
      expected: "Gemini (gemini-3.8-flash) でチャプターを生成中 [JA]...",
    },
    {
      name: "ja.summarize.step2Generating",
      actual: ja.summarize.step2Generating("Gemini", "gemini-3.8-flash", "JA"),
      expected: "Gemini (gemini-3.8-flash) で要約を生成中 [JA]...",
    },
  ];

  it.each(table)("matches main verbatim for $name", ({ actual, expected }) => {
    expect(actual).toBe(expected);
  });
});
