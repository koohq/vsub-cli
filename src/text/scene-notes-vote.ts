import type { PolitenessLevel, SceneNotesCandidate } from "./tasks.js";

export interface SceneNotesChoice {
  index: number;
  candidate: SceneNotesCandidate;
  agreed: number;
  majorityPairs: number;
}

function normalizeName(name: string): string {
  return name
    .normalize("NFKC")
    .toLowerCase()
    .trim()
    .replace(/^(?:mr|mrs|ms|miss|mx|dr|prof|sir|madam)(?=\.|\s)/u, "")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

export function selectSceneNotes(
  candidates: Array<SceneNotesCandidate | undefined>,
): SceneNotesChoice | undefined {
  const successes = candidates.flatMap((candidate, index) => {
    if (!candidate) return [];
    const pairs = new Map<string, PolitenessLevel | undefined>();
    for (const item of candidate.politeness) {
      const from = normalizeName(item.from);
      const to = normalizeName(item.to);
      if (!from || !to) continue;
      const key = JSON.stringify([from, to]);
      // A conflict removes this candidate's vote for the pair permanently.
      if (!pairs.has(key)) pairs.set(key, item.level);
      else if (pairs.get(key) !== item.level) pairs.set(key, undefined);
    }
    return [{ candidate, index, pairs }];
  });
  const counts = new Map<string, Map<PolitenessLevel, number>>();
  for (const { pairs } of successes) {
    for (const [key, level] of pairs) {
      if (level === undefined) continue;
      let levels = counts.get(key);
      if (!levels) {
        levels = new Map();
        counts.set(key, levels);
      }
      levels.set(level, (levels.get(level) ?? 0) + 1);
    }
  }
  const majorities = new Map<string, PolitenessLevel>();
  for (const [key, levels] of counts) {
    for (const [level, count] of levels) {
      if (count > successes.length / 2) majorities.set(key, level);
    }
  }
  let choice: SceneNotesChoice | undefined;
  for (const { candidate, index, pairs } of successes) {
    let agreed = 0;
    for (const [key, level] of majorities) {
      if (pairs.get(key) === level) agreed++;
    }
    if (!choice || agreed > choice.agreed) {
      choice = { index, candidate, agreed, majorityPairs: majorities.size };
    }
  }
  return choice;
}
