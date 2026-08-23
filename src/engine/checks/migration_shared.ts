/**
 * Shared between RF-02/03/04: pairing a vanished line with an appeared line
 * of similar size in a different bucket — the "renamed and moved" pattern.
 */

import type { ReconLine } from "../types.ts";
import type { LineMatch } from "../normalize.ts";
import { lineAmountCents } from "../lines.ts";

/** A vanished line and an appeared line within this tolerance of each other are a probable rename. */
export const RENAME_TOLERANCE = 0.15;

export interface Rename {
  vanished: ReconLine;
  appeared: ReconLine;
  ratio: number; // appeared / vanished
}

/** Unique best pairings (closest amount first). Only pairs whose bucket or section differs. */
export function probableRenames(m: LineMatch): Rename[] {
  const cands: Rename[] = [];
  for (const v of m.vanished) {
    const va = lineAmountCents(v);
    if (va <= 0) continue;
    for (const a of m.appeared) {
      const aa = lineAmountCents(a);
      const ratio = aa / va;
      if (Math.abs(ratio - 1) <= RENAME_TOLERANCE) cands.push({ vanished: v, appeared: a, ratio });
    }
  }
  cands.sort((x, y) => Math.abs(x.ratio - 1) - Math.abs(y.ratio - 1));
  const usedV = new Set<ReconLine>();
  const usedA = new Set<ReconLine>();
  const out: Rename[] = [];
  for (const c of cands) {
    if (usedV.has(c.vanished) || usedA.has(c.appeared)) continue;
    usedV.add(c.vanished);
    usedA.add(c.appeared);
    out.push(c);
  }
  return out;
}

export function bucketLabel(b: ReconLine["bucket"]): string {
  if (!b || b === "unknown") return "unclassified";
  return b.replace("_", "-");
}
