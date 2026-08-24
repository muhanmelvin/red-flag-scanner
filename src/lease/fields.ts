/**
 * The lease abstract, field by field: how each value reads in the clause text,
 * and the widget that edits it.
 *
 * One registry serves both jobs on purpose. The document builder asks a field
 * how it reads; the designer asks the same field how it is edited and writes
 * the answer straight back to the abstract. Text and parameters cannot drift
 * apart, because the text *is* the parameter.
 *
 * Pure and DOM-free — the widget is described here, built in `src/ui/`.
 */

import type { LeaseLite } from "../engine/types.ts";
import { toCents, usd } from "../engine/money.ts";

// ---------------------------------------------------------------------------
// Numbers as a lease reads them
// ---------------------------------------------------------------------------

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

/** Whole numbers below one hundred, as a lease spells them. Others stay in digits. */
export function words(n: number): string | null {
  if (!Number.isInteger(n) || n < 0 || n > 99) return null;
  if (n < 20) return ONES[n]!;
  const t = TENS[Math.floor(n / 10)]!;
  const o = n % 10;
  return o === 0 ? t : `${t}-${ONES[o]!}`;
}

/** `5` → "five percent (5%)"; `4.5` → "4.5%". */
export function pctProse(n: number): string {
  const w = words(n);
  const digits = `${Number(n.toFixed(4))}%`;
  return w ? `${w} percent (${digits})` : digits;
}

/** `100000` → "$100,000.00". */
export function moneyProse(n: number): string {
  return usd(toCents(n));
}

function sf(n: number): string {
  return `${n.toLocaleString("en-US")} rentable square feet`;
}

// ---------------------------------------------------------------------------
// Vocabulary — matches the upload form's lease abstract, in lease register
// ---------------------------------------------------------------------------

export const APPLIES_TO_PROSE = {
  controllable: "Controllable Operating Expenses",
  all_cam: "all Common Area Maintenance costs",
  total_opex: "all Operating Expenses",
} as const;

export const METHOD_PROSE = {
  non_cumulative: "on a non-cumulative basis, each Lease Year standing on its own with no carry-forward of any unused increase",
  cumulative: "on a cumulative basis, measured in a straight line from the Base Year",
  compounded: "on a compounded basis, each Lease Year's ceiling compounding upon the last",
} as const;

export const BASIS_PROSE = {
  amount_paid: "the amount actually payable by Tenant for the preceding Lease Year, being the lesser of the actual expense and the capped amount",
  actual_expenses: "the actual expenses incurred by Landlord in the preceding Lease Year",
  prior_cap: "the maximum amount chargeable for the preceding Lease Year, whether or not that amount was incurred",
} as const;

export const FEE_TREATMENT_PROSE = {
  inside_cap: "included within",
  outside_cap: "excluded from",
} as const;

export const FEE_BASE_PROSE = {
  cam_only: "Common Area Maintenance costs only",
  cam_plus_insurance: "Common Area Maintenance costs and insurance premiums",
  all_opex: "all Operating Expenses, including Taxes and insurance premiums",
  receipts: "gross receipts from the Property",
} as const;

export const DENOMINATOR_PROSE = {
  GLA: "the Gross Leasable Area of the Property",
  GLOA: "the Gross Leasable Occupied Area of the Property",
  unknown: "the denominator stated by Landlord on each reconciliation",
} as const;

// ---------------------------------------------------------------------------
// Field registry
// ---------------------------------------------------------------------------

/** The clauses that can be struck from, or added to, the model lease. */
export type ClauseId = "cap" | "fee" | "gross_up" | "capital" | "stated_share";

export type FeeProp = "kind" | "rate_pct" | "base";

export type StaticFieldId =
  | "share.stated_pct"
  | "share.numerator_sf"
  | "share.denominator_basis"
  | "cap.applies_to"
  | "cap.pct"
  | "cap.method"
  | "cap.basis"
  | "cap.base_year"
  | "cap.base_year_amount"
  | "cap.fee_treatment"
  | "capital_threshold"
  | "capital_life_years"
  | "gross_up.to_pct";

export type FieldId = StaticFieldId | `fee.${number}.${FeeProp}`;

export type FieldValue = string | number | undefined;

export type Widget =
  | { kind: "number"; step: number; min?: number; max?: number; unit?: string }
  | { kind: "select"; options: Array<[string, string]> };

export interface FieldDescriptor {
  id: FieldId;
  label: string;
  widget: Widget;
  get(l: LeaseLite): FieldValue;
  set(l: LeaseLite, v: FieldValue): void;
  /** How the value reads inside the clause. */
  prose(l: LeaseLite): string;
}

function opts<T extends Record<string, string>>(map: T, labels: Record<keyof T, string>): Array<[string, string]> {
  return Object.keys(map).map((k) => [k, labels[k as keyof T]]);
}

const FEE_PROPS: Record<FeeProp, (i: number) => FieldDescriptor> = {
  kind: (i) => ({
    id: `fee.${i}.kind`,
    label: "Fee kind",
    widget: { kind: "select", options: [["management", "Management"], ["administrative", "Administrative"]] },
    get: (l) => l.fees[i]?.kind,
    set: (l, v) => {
      if (l.fees[i]) l.fees[i]!.kind = v === "administrative" ? "administrative" : "management";
    },
    prose: (l) => (l.fees[i]?.kind === "administrative" ? "administrative fee" : "management fee"),
  }),
  rate_pct: (i) => ({
    id: `fee.${i}.rate_pct`,
    label: "Fee rate %",
    widget: { kind: "number", step: 0.25, min: 0, max: 100, unit: "%" },
    get: (l) => l.fees[i]?.rate_pct,
    set: (l, v) => {
      if (l.fees[i]) l.fees[i]!.rate_pct = typeof v === "number" ? v : 0;
    },
    prose: (l) => pctProse(l.fees[i]?.rate_pct ?? 0),
  }),
  base: (i) => ({
    id: `fee.${i}.base`,
    label: "Permitted base",
    widget: {
      kind: "select",
      options: opts(FEE_BASE_PROSE, {
        cam_only: "CAM only",
        cam_plus_insurance: "CAM + insurance",
        all_opex: "All operating expenses",
        receipts: "Gross receipts",
      }),
    },
    get: (l) => l.fees[i]?.base,
    set: (l, v) => {
      if (l.fees[i] && typeof v === "string" && v in FEE_BASE_PROSE) l.fees[i]!.base = v as keyof typeof FEE_BASE_PROSE;
    },
    prose: (l) => FEE_BASE_PROSE[l.fees[i]?.base ?? "cam_only"],
  }),
};

export const FIELDS: Record<StaticFieldId, FieldDescriptor> = {
  "share.stated_pct": {
    id: "share.stated_pct",
    label: "Stated share %",
    widget: { kind: "number", step: 0.0001, min: 0, max: 100, unit: "%" },
    get: (l) => l.share.stated_pct,
    set: (l, v) => {
      if (typeof v === "number") l.share.stated_pct = v;
      else delete l.share.stated_pct;
    },
    prose: (l) => (l.share.stated_pct === undefined ? "—" : pctProse(l.share.stated_pct)),
  },
  "share.numerator_sf": {
    id: "share.numerator_sf",
    label: "Premises sf",
    widget: { kind: "number", step: 100, min: 0 },
    get: (l) => l.share.numerator_sf,
    set: (l, v) => {
      if (typeof v === "number") l.share.numerator_sf = v;
    },
    prose: (l) => sf(l.share.numerator_sf),
  },
  "share.denominator_basis": {
    id: "share.denominator_basis",
    label: "Denominator",
    widget: {
      kind: "select",
      options: opts(DENOMINATOR_PROSE, { GLA: "Gross Leasable Area", GLOA: "Gross Leasable Occupied Area", unknown: "As stated by Landlord" }),
    },
    get: (l) => l.share.denominator_basis,
    set: (l, v) => {
      if (typeof v === "string" && v in DENOMINATOR_PROSE) l.share.denominator_basis = v as keyof typeof DENOMINATOR_PROSE;
    },
    prose: (l) => DENOMINATOR_PROSE[l.share.denominator_basis],
  },
  "cap.applies_to": {
    id: "cap.applies_to",
    label: "Cap applies to",
    widget: {
      kind: "select",
      options: opts(APPLIES_TO_PROSE, { controllable: "Controllable expenses", all_cam: "All CAM", total_opex: "All operating expenses" }),
    },
    get: (l) => l.cap?.applies_to,
    set: (l, v) => {
      if (l.cap && typeof v === "string" && v in APPLIES_TO_PROSE) l.cap.applies_to = v as keyof typeof APPLIES_TO_PROSE;
    },
    prose: (l) => APPLIES_TO_PROSE[l.cap?.applies_to ?? "controllable"],
  },
  "cap.pct": {
    id: "cap.pct",
    label: "Cap %",
    widget: { kind: "number", step: 0.5, min: 0, max: 100, unit: "%" },
    get: (l) => l.cap?.pct,
    set: (l, v) => {
      if (l.cap && typeof v === "number") l.cap.pct = v;
    },
    prose: (l) => pctProse(l.cap?.pct ?? 0),
  },
  "cap.method": {
    id: "cap.method",
    label: "Method",
    widget: {
      kind: "select",
      options: opts(METHOD_PROSE, { non_cumulative: "Non-cumulative", cumulative: "Cumulative", compounded: "Compounded" }),
    },
    get: (l) => l.cap?.method,
    set: (l, v) => {
      if (l.cap && typeof v === "string" && v in METHOD_PROSE) l.cap.method = v as keyof typeof METHOD_PROSE;
    },
    prose: (l) => METHOD_PROSE[l.cap?.method ?? "non_cumulative"],
  },
  "cap.basis": {
    id: "cap.basis",
    label: "Basis of the increase",
    widget: {
      kind: "select",
      options: opts(BASIS_PROSE, { amount_paid: "Amount paid (lesser of)", actual_expenses: "Prior year actual expenses", prior_cap: "Prior year cap (cap on cap)" }),
    },
    get: (l) => l.cap?.basis,
    set: (l, v) => {
      if (l.cap && typeof v === "string" && v in BASIS_PROSE) l.cap.basis = v as keyof typeof BASIS_PROSE;
    },
    prose: (l) => BASIS_PROSE[l.cap?.basis ?? "amount_paid"],
  },
  "cap.base_year": {
    id: "cap.base_year",
    label: "Base Year",
    widget: { kind: "number", step: 1, min: 1980, max: 2100 },
    get: (l) => l.cap?.base_year,
    set: (l, v) => {
      if (!l.cap) return;
      if (typeof v === "number") l.cap.base_year = v;
      else delete l.cap.base_year;
    },
    prose: (l) => (l.cap?.base_year === undefined ? "the Lease Year preceding the first reconciled year" : String(l.cap.base_year)),
  },
  "cap.base_year_amount": {
    id: "cap.base_year_amount",
    label: "Base Year amount",
    widget: { kind: "number", step: 0.01, min: 0, unit: "$" },
    get: (l) => l.cap?.base_year_amount,
    set: (l, v) => {
      if (!l.cap) return;
      if (typeof v === "number") l.cap.base_year_amount = v;
      else delete l.cap.base_year_amount;
    },
    prose: (l) => (l.cap?.base_year_amount === undefined ? "the amount reconciled for that Lease Year" : moneyProse(l.cap.base_year_amount)),
  },
  "cap.fee_treatment": {
    id: "cap.fee_treatment",
    label: "Fees vs the cap",
    widget: { kind: "select", options: opts(FEE_TREATMENT_PROSE, { inside_cap: "Inside the cap", outside_cap: "Outside the cap" }) },
    get: (l) => l.cap?.fee_treatment,
    set: (l, v) => {
      if (l.cap && typeof v === "string" && v in FEE_TREATMENT_PROSE) l.cap.fee_treatment = v as keyof typeof FEE_TREATMENT_PROSE;
    },
    prose: (l) => FEE_TREATMENT_PROSE[l.cap?.fee_treatment ?? "outside_cap"],
  },
  capital_threshold: {
    id: "capital_threshold",
    label: "Capital threshold",
    widget: { kind: "number", step: 100, min: 0, unit: "$" },
    get: (l) => l.capital_threshold,
    set: (l, v) => {
      if (typeof v === "number") l.capital_threshold = v;
      else delete l.capital_threshold;
    },
    prose: (l) => (l.capital_threshold === undefined ? "any amount" : moneyProse(l.capital_threshold)),
  },
  capital_life_years: {
    id: "capital_life_years",
    label: "Amortization period (years)",
    widget: { kind: "number", step: 1, min: 1, max: 60 },
    get: (l) => l.capital_life_years,
    set: (l, v) => {
      if (typeof v === "number") l.capital_life_years = v;
      else delete l.capital_life_years;
    },
    prose: (l) => (l.capital_life_years === undefined ? "the useful life of the item as determined under sound accounting principles" : `${words(l.capital_life_years) ?? String(l.capital_life_years)} (${l.capital_life_years}) years`),
  },
  "gross_up.to_pct": {
    id: "gross_up.to_pct",
    label: "Gross up to %",
    widget: { kind: "number", step: 1, min: 0, max: 100, unit: "%" },
    get: (l) => l.gross_up?.to_pct,
    set: (l, v) => {
      if (!l.gross_up) return;
      if (typeof v === "number") l.gross_up.to_pct = v;
      else delete l.gross_up.to_pct;
    },
    prose: (l) => (l.gross_up?.to_pct === undefined ? "full occupancy" : pctProse(l.gross_up.to_pct)),
  },
};

/** Resolve any field id, including the indexed fee fields. */
export function fieldById(id: FieldId): FieldDescriptor | undefined {
  const stat = (FIELDS as Record<string, FieldDescriptor | undefined>)[id];
  if (stat) return stat;
  const m = /^fee\.(\d+)\.(kind|rate_pct|base)$/.exec(id);
  if (!m) return undefined;
  return FEE_PROPS[m[2] as FeeProp](Number(m[1]));
}

/** The three fields of one fee, in clause order. */
export function feeFields(i: number): FieldDescriptor[] {
  return [FEE_PROPS.rate_pct(i), FEE_PROPS.kind(i), FEE_PROPS.base(i)];
}

// ---------------------------------------------------------------------------
// Striking and adding whole clauses
// ---------------------------------------------------------------------------

/** What the designer knows about the statement when it drafts a fresh clause. */
export interface ClauseHint {
  sharePct?: number;
  baseYear?: number;
  baseAmount?: number;
}

/**
 * Drafting defaults for a clause the lease does not have — the same starting
 * terms the upload form offers, so a lease built here and a lease typed there
 * are the same kind of document.
 */
export const CLAUSE_DEFAULTS: Record<ClauseId, (l: LeaseLite, hint?: ClauseHint) => void> = {
  cap: (l, hint) => {
    l.cap = {
      applies_to: "controllable",
      pct: 5,
      method: "non_cumulative",
      basis: "amount_paid",
      fee_treatment: "outside_cap",
      ...(hint?.baseYear !== undefined ? { base_year: hint.baseYear } : {}),
      ...(hint?.baseAmount !== undefined ? { base_year_amount: hint.baseAmount } : {}),
    };
  },
  fee: (l) => {
    l.fees = [{ kind: "management", rate_pct: 3, base: "cam_only" }];
  },
  gross_up: (l) => {
    l.gross_up = { allowed: true, to_pct: 95 };
  },
  capital: (l) => {
    l.capital_threshold = 5000;
    l.capital_life_years = 10;
  },
  stated_share: (l, hint) => {
    l.share.stated_pct = hint?.sharePct !== undefined ? Number(hint.sharePct.toFixed(4)) : 10;
  },
};

/** Striking a clause. `fees` is emptied, never deleted — the engine requires the array. */
export const CLAUSE_REMOVE: Record<ClauseId, (l: LeaseLite) => void> = {
  cap: (l) => {
    delete l.cap;
  },
  fee: (l) => {
    l.fees = [];
  },
  gross_up: (l) => {
    delete l.gross_up;
  },
  capital: (l) => {
    delete l.capital_threshold;
    delete l.capital_life_years;
  },
  stated_share: (l) => {
    delete l.share.stated_pct;
  },
};

export const CLAUSE_LABEL: Record<ClauseId, string> = {
  cap: "the cap on increases",
  fee: "the management fee",
  gross_up: "the gross-up right",
  capital: "the capital and amortization terms",
  stated_share: "the fixed Proportionate Share",
};

/** A working copy. The authored package's abstract is never handed to an editor. */
export function cloneLease(l: LeaseLite): LeaseLite {
  return structuredClone(l);
}

function stable(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as object).sort()) out[k] = stable((v as Record<string, unknown>)[k]);
    return out;
  }
  return v;
}

/** Value equality, insensitive to the order keys happen to sit in. */
export function leaseEquals(a: LeaseLite, b: LeaseLite): boolean {
  return JSON.stringify(stable(a)) === JSON.stringify(stable(b));
}
