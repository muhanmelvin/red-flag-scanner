/**
 * Label normalization and cross-year line matching (§3.1 of the build plan).
 * Shared by RF-01/02/03/04/12. One synonym map, tested in isolation.
 */

import type { ReconLine } from "./types.ts";

/** Phrase-level synonyms applied after lowercasing/punctuation stripping. Order matters. */
const SYNONYMS: Array<[RegExp, string]> = [
  [/\br and m\b/g, "repairs and maintenance"],
  [/\brepair\b/g, "repairs"],
  [/\bmaint\b/g, "maintenance"],
  [/\bmgmt\b|\bmgt\b|\bmanagment\b/g, "management"],
  [/\badmin\b/g, "administrative"],
  [/\breal estate tax(es)?\b|\bre tax(es)?\b|\bproperty tax(es)?\b|\bret\b/g, "real estate taxes"],
  [/\bins\b/g, "insurance"],
  [/\belec\b|\belectric\b/g, "electricity"],
  [/\bsnow (and )?ice removal\b|\bsnow plowing\b|\bsnow plow\b|\bsnow\b(?! removal)/g, "snow removal"],
  [/\blandscape\b|\bgroundskeeping\b|\bgrounds keeping\b/g, "landscaping"],
  [/\bparking lot\b|\bparking area\b/g, "parking"],
  [/\bhvac\b/g, "hvac"],
  [/\bamort\b|\bamortisation\b/g, "amortization"],
];

/** Filler words that vary between statements without changing meaning. */
const STOP = new Set([
  "services", "service", "expense", "expenses", "cost", "costs", "charge", "charges",
  "the", "of", "for", "and", "to", "yr", "year", "years",
]);

/**
 * lowercase → "&"→" and " → strip punctuation → drop numeric tokens → collapse
 * whitespace → synonyms → drop filler words. Idempotent.
 */
export function normalizeLabel(s: string): string {
  let t = s.toLowerCase();
  t = t.replace(/&/g, " and ").replace(/[\/\\|+]/g, " ");
  t = t.replace(/[^\p{L}\p{N}\s]/gu, " ");
  t = t.replace(/\s+/g, " ").trim();
  for (const [re, rep] of SYNONYMS) t = t.replace(re, rep);
  const tokens = t
    .split(" ")
    .filter((w) => w.length > 0 && !/^\d+(\.\d+)?%?$/.test(w) && !STOP.has(w));
  return tokens.join(" ");
}

/** Sørensen–Dice coefficient on character bigrams of two (normalized) strings. */
export function dice(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const grams = (s: string) => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      m.set(g, (m.get(g) ?? 0) + 1);
    }
    return m;
  };
  const ga = grams(a);
  const gb = grams(b);
  let inter = 0;
  for (const [g, n] of ga) inter += Math.min(n, gb.get(g) ?? 0);
  return (2 * inter) / (a.length - 1 + (b.length - 1));
}

export const DICE_THRESHOLD = 0.8;

export interface LinePair {
  prev: ReconLine;
  curr: ReconLine;
  how: "exact" | "label" | "similar";
}

export interface LineMatch {
  pairs: LinePair[];
  vanished: ReconLine[]; // in prev, no counterpart in curr
  appeared: ReconLine[]; // in curr, no counterpart in prev
}

/**
 * Pair lines of two consecutive years. Three passes: exact (label+section),
 * label-only, then Dice ≥ 0.8 on normalized labels (greedy, best-first, unique).
 */
export function matchLines(prev: ReconLine[], curr: ReconLine[]): LineMatch {
  const usedP = new Set<number>();
  const usedC = new Set<number>();
  const pairs: LinePair[] = [];

  const keyFull = (l: ReconLine) => normalizeLabel(l.label) + "|" + normalizeLabel(l.section);
  const keyLabel = (l: ReconLine) => normalizeLabel(l.label);

  const pass = (key: (l: ReconLine) => string, how: LinePair["how"]) => {
    const index = new Map<string, number[]>();
    curr.forEach((l, j) => {
      if (usedC.has(j)) return;
      const k = key(l);
      const arr = index.get(k) ?? [];
      arr.push(j);
      index.set(k, arr);
    });
    prev.forEach((l, i) => {
      if (usedP.has(i)) return;
      const cands = index.get(key(l));
      if (!cands) return;
      const j = cands.find((c) => !usedC.has(c));
      if (j === undefined) return;
      usedP.add(i);
      usedC.add(j);
      pairs.push({ prev: l, curr: curr[j]!, how });
    });
  };

  pass(keyFull, "exact");
  pass(keyLabel, "label");

  // Similarity pass: score all remaining cross pairs, take best-first above threshold.
  const cands: Array<{ i: number; j: number; score: number }> = [];
  prev.forEach((p, i) => {
    if (usedP.has(i)) return;
    const np = normalizeLabel(p.label);
    curr.forEach((c, j) => {
      if (usedC.has(j)) return;
      const score = dice(np, normalizeLabel(c.label));
      if (score >= DICE_THRESHOLD) cands.push({ i, j, score });
    });
  });
  cands.sort((a, b) => b.score - a.score || a.i - b.i || a.j - b.j);
  for (const c of cands) {
    if (usedP.has(c.i) || usedC.has(c.j)) continue;
    usedP.add(c.i);
    usedC.add(c.j);
    pairs.push({ prev: prev[c.i]!, curr: curr[c.j]!, how: "similar" });
  }

  return {
    pairs,
    vanished: prev.filter((_, i) => !usedP.has(i)),
    appeared: curr.filter((_, j) => !usedC.has(j)),
  };
}
