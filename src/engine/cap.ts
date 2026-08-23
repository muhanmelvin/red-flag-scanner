/**
 * Cap schedule rebuild. Given the lease's cap terms and the statement's
 * capped-pool actuals per year, compute the allowed ceiling, what the tenant
 * should have paid (the lesser-of rule), and what was billed.
 *
 * Used by RF-06 (cap compliance) and RF-04 (migration consequence). Pure;
 * integer cents throughout; rounds the ceiling to the cent each year, which is
 * how landlord statements are issued.
 */

import type { CheckContext, ReconYear } from "./types.ts";
import { isCapPoolLine, sumAmount } from "./lines.ts";
import { pct, toCents } from "./money.ts";

export interface CapYear {
  year: number;
  /** Σ of the lines the lease puts in the capped pool, as the landlord presented them. */
  pool_actual: number;
  /** The landlord's own stated pool actual, if the statement shows a cap computation. */
  ll_pool_actual?: number;
  /** The ceiling the lease allows for this year; null for a base year without a base amount. */
  allowed: number | null;
  /** What the tenant should pay for the pool under the lease: min(actual, allowed). */
  paid_correct: number;
  /** What the landlord billed for the pool: cap_summary.pool_billed, else the pool actual. */
  billed: number;
  /** The landlord's own stated ceiling, if shown. */
  ll_allowed?: number;
  /** Prior-year reference the ceiling was computed from, and what it was. */
  base_ref: { year: number; amount: number; kind: "base_year_amount" | "amount_paid" | "actual_expenses" | "prior_cap" | "first_year_actual" } | null;
}

export interface CapSchedule {
  years: CapYear[];
  base_year: number;
  base_amount: number | null;
  pct: number;
  method: "non_cumulative" | "cumulative" | "compounded";
  basis: "amount_paid" | "actual_expenses" | "prior_cap";
}

export type CapBuild = { ok: true; schedule: CapSchedule } | { ok: false; reason: string };

export function poolActualCents(year: ReconYear, ctx: CheckContext): number {
  return sumAmount(year.lines.filter((l) => isCapPoolLine(l, ctx.pkg.lease_lite)));
}

export function buildCapSchedule(ctx: CheckContext): CapBuild {
  const cap = ctx.pkg.lease_lite.cap;
  if (!cap) return { ok: false, reason: "lease_lite has no cap — the lease does not cap these expenses, or the cap was not abstracted" };
  const years = ctx.years;
  if (years.length === 0) return { ok: false, reason: "package has no years" };
  for (let i = 1; i < years.length; i++) {
    if (years[i]!.year !== years[i - 1]!.year + 1) {
      return { ok: false, reason: `years are not consecutive (${years[i - 1]!.year} → ${years[i]!.year}); a year-over-year cap cannot be chained across a gap` };
    }
  }
  const first = years[0]!.year;
  const base_year = cap.base_year ?? first - 1;
  const base_amount = cap.base_year_amount !== undefined ? toCents(cap.base_year_amount) : null;
  if (base_year >= first && base_amount !== null) {
    return { ok: false, reason: `cap.base_year (${base_year}) is not before the first reconciliation year (${first})` };
  }
  if (base_amount === null && years.length < 2) {
    return { ok: false, reason: "single-year package with no resolved base — nothing to compare the year to" };
  }

  const out: CapYear[] = [];
  const rate = cap.pct;
  // Reference figures carried forward per basis.
  let prevPaid: number | null = base_amount; // amount_paid chain
  let prevActual: number | null = base_amount; // actual_expenses chain
  let prevCap: number | null = base_amount; // prior_cap chain
  let prevYear = base_year;

  for (let i = 0; i < years.length; i++) {
    const y = years[i]!;
    const actual = poolActualCents(y, ctx);
    const billed = y.cap_summary ? toCents(y.cap_summary.pool_billed) : actual;
    let allowed: number | null = null;
    let base_ref: CapYear["base_ref"] = null;

    if (base_amount === null && i === 0) {
      // First year acts as the base; no ceiling to test it against.
      allowed = null;
      base_ref = { year: y.year, amount: actual, kind: "first_year_actual" };
    } else {
      switch (cap.method) {
        case "non_cumulative": {
          let ref: number;
          let kind: NonNullable<CapYear["base_ref"]>["kind"];
          if (cap.basis === "amount_paid") { ref = prevPaid!; kind = "amount_paid"; }
          else if (cap.basis === "actual_expenses") { ref = prevActual!; kind = "actual_expenses"; }
          else { ref = prevCap!; kind = "prior_cap"; }
          if (prevYear === base_year && base_amount !== null) kind = "base_year_amount";
          allowed = ref + pct(ref, rate);
          base_ref = { year: prevYear, amount: ref, kind };
          break;
        }
        case "cumulative": {
          const b = base_amount ?? out[0]!.pool_actual;
          const by = base_amount !== null ? base_year : first;
          const k = y.year - by;
          allowed = b + pct(b, rate * k);
          base_ref = { year: by, amount: b, kind: base_amount !== null ? "base_year_amount" : "first_year_actual" };
          break;
        }
        case "compounded": {
          // Compound from the base with cents rounding each year.
          const b = base_amount ?? out[0]!.pool_actual;
          const by = base_amount !== null ? base_year : first;
          let v = b;
          for (let k = 0; k < y.year - by; k++) v = v + pct(v, rate);
          allowed = v;
          base_ref = { year: by, amount: b, kind: base_amount !== null ? "base_year_amount" : "first_year_actual" };
          break;
        }
      }
    }

    const paid_correct = allowed === null ? actual : Math.min(actual, allowed);
    const cy: CapYear = {
      year: y.year,
      pool_actual: actual,
      allowed,
      paid_correct,
      billed,
      base_ref,
    };
    if (y.cap_summary) {
      cy.ll_pool_actual = toCents(y.cap_summary.pool_actual);
      if (y.cap_summary.pool_allowed !== undefined) cy.ll_allowed = toCents(y.cap_summary.pool_allowed);
    }
    out.push(cy);

    prevPaid = paid_correct;
    prevActual = actual;
    prevCap = allowed ?? actual;
    prevYear = y.year;
  }

  return {
    ok: true,
    schedule: { years: out, base_year, base_amount, pct: rate, method: cap.method, basis: cap.basis },
  };
}
