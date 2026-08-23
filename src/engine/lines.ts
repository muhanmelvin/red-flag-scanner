/**
 * Line classification helpers shared by the checks. All keyword tests run on
 * the normalized label/section so the same rule survives punctuation and case.
 */

import type { LeaseLite, ReconLine, ReconYear } from "./types.ts";
import { normalizeLabel } from "./normalize.ts";
import { toCents } from "./money.ts";

export type LineKind = "fee" | "tax" | "insurance" | "capital" | "cam";

const FEE_RE = /\b(management|administrative|admin|supervisory|overhead|asset management|property management) fees?\b/;
const FEE_SECTION_RE = /^(fees?|management|administrative)( fees?)?$/;
const TAX_RE = /\btax(es)?\b|\bassessments?\b/;
const INS_RE = /\binsurance\b|\bpremiums?\b/;

/** What kind of line this is for fee-base and cap-pool purposes. */
export function lineKind(line: ReconLine): LineKind {
  const label = normalizeLabel(line.label);
  const section = normalizeLabel(line.section);
  if (line.is_fee || FEE_RE.test(label) || FEE_SECTION_RE.test(section)) return "fee";
  if (line.capital) return "capital";
  if (TAX_RE.test(section) || TAX_RE.test(label)) return "tax";
  if (INS_RE.test(section) || INS_RE.test(label)) return "insurance";
  return "cam";
}

/** Fixed-cost categories that must never be grossed up for occupancy. */
export function isFixedCost(line: ReconLine): boolean {
  const k = lineKind(line);
  if (k === "tax" || k === "insurance" || k === "capital") return true;
  const label = normalizeLabel(line.label);
  return /\bamortization\b|\bdepreciation\b|\bground rent\b/.test(label);
}

/** Capital-sounding labels (used by RF-09's lump test). */
export const CAPITAL_KEYWORDS =
  /\broof(ing)?\b|\bparking\b|\bhvac\b|\breplace(ment)?\b|\bresurfac(e|ing)\b|\brenovat(ion|e)\b|\bre pav(e|ing)\b|\brepav(e|ing)\b|\bseal ?coat(ing)?\b|\bchiller\b|\belevator moderni[sz]ation\b|\bcapital\b/;

export function looksCapital(line: ReconLine): boolean {
  return CAPITAL_KEYWORDS.test(normalizeLabel(line.label));
}

/** Is this line inside the lease's capped pool, given how the landlord presented it? */
export function isCapPoolLine(line: ReconLine, lease: LeaseLite): boolean {
  const cap = lease.cap;
  if (!cap) return false;
  const kind = lineKind(line);
  if (kind === "fee") return cap.fee_treatment === "inside_cap";
  switch (cap.applies_to) {
    case "controllable":
      return line.bucket === "controllable";
    case "all_cam":
      return kind === "cam" || kind === "capital";
    case "total_opex":
      return true;
  }
}

/** The pool amount the engine treats as "actual" for a line (pre-gross-up if shown). */
export function lineActualCents(line: ReconLine): number {
  return toCents(line.gross_up ? line.gross_up.actual : line.amount);
}

export function lineAmountCents(line: ReconLine): number {
  return toCents(line.amount);
}

/** Sum of `amount` (as billed) for a set of lines, in cents. */
export function sumAmount(lines: ReconLine[]): number {
  let s = 0;
  for (const l of lines) s += toCents(l.amount);
  return s;
}

/** Lines that form the permitted base for a fee of the given kind. `null` = not computable from a statement. */
export function feeBaseLines(lines: ReconLine[], base: LeaseLite["fees"][number]["base"]): ReconLine[] | null {
  const nonFee = lines.filter((l) => lineKind(l) !== "fee");
  switch (base) {
    case "cam_only":
      return nonFee.filter((l) => {
        const k = lineKind(l);
        return k !== "tax" && k !== "insurance";
      });
    case "cam_plus_insurance":
      return nonFee.filter((l) => lineKind(l) !== "tax");
    case "all_opex":
      return nonFee;
    case "receipts":
      return null;
  }
}

export const FEE_BASE_LABEL: Record<LeaseLite["fees"][number]["base"], string> = {
  cam_only: "CAM only (excluding taxes and insurance)",
  cam_plus_insurance: "CAM plus insurance (excluding taxes)",
  all_opex: "all operating expenses (CAM, insurance and taxes)",
  receipts: "gross receipts / rents",
};

export function feeLines(year: ReconYear): ReconLine[] {
  return year.lines.filter((l) => lineKind(l) === "fee");
}

export function yearByNumber(years: ReconYear[], y: number): ReconYear | undefined {
  return years.find((x) => x.year === y);
}
