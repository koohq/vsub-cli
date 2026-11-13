import { describe, expect, it } from "vitest";
import { selectSceneNotes } from "./scene-notes-vote.js";
import type { PolitenessItem, PolitenessLevel, SceneNotesCandidate } from "./tasks.js";

function pair(level: PolitenessLevel, from = "Alex", to = "Sam"): PolitenessItem {
  return { from, to, level };
}

function candidate(...politeness: PolitenessItem[]): SceneNotesCandidate {
  return { notes: "Background notes", politeness };
}

describe("selectSceneNotes", () => {
  it.each([
    {
      name: "outvotes the first candidate",
      candidates: [candidate(pair("plain")), candidate(pair("polite")), candidate(pair("polite"))],
      index: 1,
      agreed: 1,
      majorityPairs: 1,
    },
    {
      name: "breaks ties by request order",
      candidates: [candidate(pair("polite")), candidate(pair("plain")), candidate(pair("polite"))],
      index: 0,
      agreed: 1,
      majorityPairs: 1,
    },
    {
      name: "uses the first success without a majority",
      candidates: [undefined, candidate(pair("plain")), candidate(pair("polite"))],
      index: 1,
      agreed: 0,
      majorityPairs: 0,
    },
    {
      name: "counts two successes only",
      candidates: [undefined, candidate(pair("mixed")), candidate(pair("mixed"))],
      index: 1,
      agreed: 1,
      majorityPairs: 1,
    },
    {
      name: "counts one success only",
      candidates: [undefined, undefined, candidate(pair("plain"))],
      index: 2,
      agreed: 1,
      majorityPairs: 1,
    },
    {
      name: "counts empty politeness as a success without votes",
      candidates: [candidate(), candidate(pair("polite")), candidate()],
      index: 0,
      agreed: 0,
      majorityPairs: 0,
    },
    {
      name: "normalizes names and removes one title",
      candidates: [
        candidate(pair("plain")),
        candidate(pair("polite", " ＡＬＥＸ ", "Mr. S-a m")),
        candidate(pair("polite", "alex", "SAM")),
      ],
      index: 1,
      agreed: 1,
      majorityPairs: 1,
    },
    {
      name: "ignores conflicting duplicates even after another duplicate",
      candidates: [
        candidate(pair("plain"), pair("polite"), pair("plain")),
        candidate(pair("plain")),
        candidate(pair("plain")),
      ],
      index: 1,
      agreed: 1,
      majorityPairs: 1,
    },
    {
      name: "counts matching duplicates once",
      candidates: [candidate(pair("polite"), pair("polite")), candidate(), candidate()],
      index: 0,
      agreed: 0,
      majorityPairs: 0,
    },
    {
      name: "ignores normalized empty names",
      candidates: [candidate(pair("polite", "!!!")), candidate(pair("polite", "!!!")), candidate()],
      index: 0,
      agreed: 0,
      majorityPairs: 0,
    },
    {
      name: "keeps directions separate",
      candidates: [
        candidate(pair("plain")),
        candidate(pair("polite", "Sam", "Alex")),
        candidate(pair("polite", "Sam", "Alex")),
      ],
      index: 1,
      agreed: 1,
      majorityPairs: 1,
    },
    {
      name: "scores all majority pairs",
      candidates: [
        candidate(pair("polite")),
        candidate(pair("polite"), pair("mixed", "Sam", "Alex")),
        candidate(pair("plain"), pair("mixed", "Sam", "Alex")),
      ],
      index: 1,
      agreed: 2,
      majorityPairs: 2,
    },
  ])("$name", ({ candidates, index, agreed, majorityPairs }) => {
    expect(selectSceneNotes(candidates)).toEqual({
      index,
      candidate: candidates[index],
      agreed,
      majorityPairs,
    });
  });

  it.each([
    { candidates: [] },
    { candidates: [undefined] },
    { candidates: [undefined, undefined, undefined] },
  ])("returns undefined for no successes (%j)", ({ candidates }) => {
    expect(selectSceneNotes(candidates)).toBeUndefined();
  });

  it.each(["mr", "mrs", "ms", "miss", "mx", "dr", "prof", "sir", "madam"])(
    "normalizes title %s only before a dot or whitespace",
    (title) => {
      for (const separator of [".", " "]) {
        const candidates = [
          candidate(pair("plain")),
          candidate(pair("polite", `${title}${separator}Alex`)),
          candidate(pair("polite")),
        ];
        expect(selectSceneNotes(candidates)?.index).toBe(1);
      }
      expect(
        selectSceneNotes([
          candidate(pair("plain")),
          candidate(pair("polite", `${title}Alex`)),
          candidate(pair("polite")),
        ])?.majorityPairs,
      ).toBe(0);
    },
  );
});
