import { describe, expect, it } from "vitest";
import { en } from "./en.js";
import { ja } from "./ja.js";

describe("translation checkpoint messages", () => {
  it.each([
    {
      messages: en,
      hint: "ℹ️ Saved 14/30 chunks of the JA translation. Run the same command again to continue from there.",
      resume: "  ↻ JA: resuming from the cache (14 of 30 chunks already saved)",
    },
    {
      messages: ja,
      hint: "ℹ️ JA の翻訳は 30 チャンクのうち 14 を保存しました。同じコマンドをもう一度実行すると、続きから翻訳します。",
      resume: "  ↻ JA: 途中から再開します（30 チャンクのうち 14 は保存済み）",
    },
  ])("matches the specified hint and resume wording", ({ messages, hint, resume }) => {
    expect(messages.pipeline.translationSaved("JA", 14, 30)).toBe(hint);
    expect(messages.pipeline.translationResuming("JA", 14, 30)).toBe(resume);
  });
});

describe("refinement fallback warnings", () => {
  it.each([
    {
      messages: en,
      expected:
        "⚠️ [2/4] Refinement kept the original text for 1/3 chunks (the model's answer did not match the input lines)",
    },
    {
      messages: ja,
      expected:
        "⚠️ [2/4] 1/3 チャンクはモデルの答えが元の行と対応しなかったため、元の文字をそのまま使いました",
    },
  ])("describes unmatched input lines", ({ messages, expected }) => {
    expect(messages.pipeline.step2RefineFallbackWarn(1, 3)).toBe(expected);
  });
});

describe("chapter count warnings", () => {
  it.each([
    {
      messages: en,
      expected:
        "Only 2 chapters remain. YouTube shows chapters only when there are at least 3, each 10 seconds or longer.",
    },
    {
      messages: ja,
      expected:
        "チャプターが 2 件しかありません。YouTube で章として表示されるのは、10 秒以上の章が 3 件以上あるときだけです。",
    },
  ])("localizes the count without the warning symbol", ({ messages, expected }) => {
    expect(messages.chapters.tooFewChapters(2)).toBe(expected);
    expect(messages.chapters.tooFewChapters(1)).toContain("1");
  });
});

describe("i18n messages backwards compatibility with Gemini", () => {
  const table = [
    ...[
      { lang: "en", messages: en, suffix: "lines [⚡ Cached]" },
      { lang: "ja", messages: ja, suffix: "行 [⚡ キャッシュ利用]" },
    ].flatMap(({ lang, messages, suffix }) => [
      {
        name: `${lang}.pipeline.step3AllDone cached`,
        actual: messages.pipeline.step3AllDone("Gemini", "JA", 10, true),
        expected: `${messages.pipeline.step3AllDone("Gemini", "JA", 10)} [⚡ ${lang === "en" ? "Cached" : "キャッシュ利用"}]`,
      },
      {
        name: `${lang}.translate.step2Done cached`,
        actual: messages.translate.step2Done("Gemini", "JA", 10, true),
        expected: `🌐 [2/3] Gemini ${lang === "en" ? "translation complete" : "翻訳完了"} (JA) - 10 ${suffix}`,
      },
      {
        name: `${lang}.pipeline.keptAudio`,
        actual: messages.pipeline.keptAudio("sample.m4a"),
        expected: `[--keep-audio] ${lang === "en" ? "Kept intermediate audio file(s)" : "中間音声ファイルを保持"}: sample.m4a`,
      },
    ]),
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
