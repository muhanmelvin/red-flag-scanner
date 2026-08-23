import type { Check, CheckContext, Finding } from "../types.ts";
import { buildCapSchedule, type CapSchedule, type CapYear } from "../cap.ts";
import { mulRate, pct, pctStr, toDollars, usd } from "../money.ts";
import { mkFinding, skip } from "../finding.ts";

const METHOD_TEXT = {
  non_cumulative: "year-over-prior-year",
  cumulative: "cumulative (simple) over the base",
  compounded: "compounded over the base",
} as const;

const BASIS_TEXT = {
  amount_paid: "the amount actually payable the prior year (lesser of actual and cap)",
  actual_expenses: "the prior year's actual expenses",
  prior_cap: "the prior year's cap amount",
} as const;

function scheduleRows(s: CapSchedule): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = [];
  if (s.base_amount !== null) rows.push({ label: `${s.base_year} base (resolved)`, value: usd(s.base_amount) });
  for (const y of s.years) {
    rows.push({
      label: `${y.year}`,
      value:
        `actual ${usd(y.pool_actual)} · cap ${y.allowed === null ? "— (base year)" : usd(y.allowed)} · required ${usd(y.paid_correct)} · billed ${usd(y.billed)}` +
        (y.allowed !== null && y.billed > y.paid_correct ? ` · excess ${usd(y.billed - y.paid_correct)}` : ""),
    });
  }
  return rows;
}

/** How the landlord appears to have derived its own stated cap, if it stated one. */
function landlordBasis(s: CapSchedule, i: number): string | null {
  const y = s.years[i]!;
  if (y.ll_allowed === undefined || i === 0 && s.base_amount === null) return null;
  const prev = i > 0 ? s.years[i - 1]! : null;
  const near = (a: number, b: number) => Math.abs(a - b) <= 100; // within $1
  const grow = (v: number) => v + pct(v, s.pct);
  if (prev) {
    if (near(y.ll_allowed, grow(prev.billed)) && !near(y.ll_allowed, y.allowed ?? -1)) return `the prior year's billed figure (${usd(prev.billed)}) grown ${s.pct}% — the cap grown on the cap`;
    if (near(y.ll_allowed, grow(prev.pool_actual)) && !near(y.ll_allowed, y.allowed ?? -1)) return `the prior year's actual (${usd(prev.pool_actual)}) grown ${s.pct}%`;
    if (prev.allowed !== null && near(y.ll_allowed, grow(prev.allowed)) && !near(y.ll_allowed, y.allowed ?? -1)) return `the prior year's cap (${usd(prev.allowed)}) grown ${s.pct}%`;
  }
  if (y.allowed !== null && near(y.ll_allowed, y.allowed)) return null;
  return `a figure the engine cannot reproduce from the lease terms`;
}

export const RF06: Check = {
  id: "RF-06",
  title: "Cap compliance / cap-on-cap",
  run(ctx: CheckContext) {
    const cap = ctx.pkg.lease_lite.cap;
    if (!cap) return skip(RF06.id, RF06.title, "no cap in lease_lite — the lease does not cap these expenses");
    const build = buildCapSchedule(ctx);
    if (!build.ok) return skip(RF06.id, RF06.title, build.reason);
    const s = build.schedule;
    const out: Finding[] = [];
    const schedRows = scheduleRows(s);
    const perYearIds: string[] = [];

    s.years.forEach((y: CapYear, i) => {
      if (y.allowed === null) return;
      const excess = y.billed - y.paid_correct;
      if (excess <= 0) return;
      const share = ctx.share(y.year);
      const impact = share ? mulRate(excess, share.frac) : undefined;
      const billedAtCeiling = y.pool_actual < y.allowed && y.billed >= y.allowed - 100;
      const llBasis = landlordBasis(s, i);

      const working: Array<{ label: string; value: string }> = [
        { label: "Cap terms", value: `${cap.pct}% ${METHOD_TEXT[cap.method]}, measured against ${BASIS_TEXT[cap.basis]}; fee ${cap.fee_treatment === "inside_cap" ? "inside" : "outside"} the pool` },
      ];
      if (y.base_ref) working.push({ label: `${y.year} ceiling derivation`, value: `${usd(y.base_ref.amount)} (${y.base_ref.year} ${y.base_ref.kind.replace(/_/g, " ")}) × ${(1 + cap.pct / 100).toFixed(4)} = ${usd(y.allowed)}` });
      working.push(
        { label: `${y.year} capped pool, actual (as presented)`, value: usd(y.pool_actual) },
        { label: `${y.year} ceiling (lease)`, value: usd(y.allowed) },
        { label: "Required to pay (lesser of)", value: usd(y.paid_correct) },
        { label: "Billed", value: usd(y.billed) },
        { label: "Excess", value: usd(excess) },
      );
      if (y.ll_allowed !== undefined) working.push({ label: "Landlord's stated cap", value: usd(y.ll_allowed) + (llBasis ? ` — appears to be ${llBasis}` : "") });
      if (share && impact !== undefined) working.push({ label: "Tenant share", value: `${pctStr(share.frac, 4)} (${share.source})` }, { label: "Tenant impact", value: usd(impact) });
      working.push({ label: "Full schedule", value: "actual · cap · required · billed per year follows" }, ...schedRows);

      const title = billedAtCeiling
        ? `Controllable costs billed at the cap, not at actual, in ${y.year}`
        : `Controllable costs billed above the lease cap in ${y.year}`;
      const narrative = billedAtCeiling
        ? `The ${y.year} statement bills ${usd(y.billed)} for the capped pool although the controllable costs it lists total ${usd(y.pool_actual)}. A cap is a ceiling, not a floor: under the lease Tenant owes the lesser of actual cost and the ${usd(y.allowed)} ceiling, so ${usd(excess)} was billed without an expense behind it` + (impact !== undefined ? ` — ${usd(impact)} at Tenant's share.` : ".") + (llBasis ? ` The landlord's stated cap appears to be ${llBasis}.` : "")
        : `The ${y.year} capped pool was billed at ${usd(y.billed)} against a lease ceiling of ${usd(y.allowed)} (${usd(y.base_ref?.amount ?? 0)} from ${y.base_ref?.year} grown ${cap.pct}%); ${usd(excess)} exceeds what the lease permits` + (impact !== undefined ? ` — ${usd(impact)} at Tenant's share.` : ".") + (llBasis ? ` The landlord's stated cap appears to be ${llBasis}.` : "");

      const f = mkFinding({
        check_id: RF06.id,
        title,
        severity: "high",
        year: y.year,
        category: ctx.years.find((yy) => yy.year === y.year)?.cap_summary?.pool_label ?? "Capped pool",
        tenant_impact_usd: impact !== undefined ? toDollars(impact) : undefined,
        narrative,
        working,
        refs: ["Burke, Cap Traps: cap-on-cap; the lesser-of rule", "Foundations: caps 101"],
      });
      perYearIds.push(f.id);
      out.push(f);
    });

    // Pattern: billed grows by exactly pct for 2+ consecutive years while actuals sit below what was billed.
    const runs: number[][] = [];
    let run: number[] = [];
    for (let i = 1; i < s.years.length; i++) {
      const a = s.years[i - 1]!.billed;
      const b = s.years[i]!.billed;
      const target = 1 + s.pct / 100;
      const growth = a > 0 ? b / a : 0;
      if (Math.abs(growth - target) <= 0.001) run.push(i);
      else { if (run.length) runs.push(run); run = []; }
    }
    if (run.length) runs.push(run);
    for (const r of runs) {
      if (r.length < 2) continue;
      const idx = r;
      const belowSomewhere = idx.some((i) => s.years[i]!.pool_actual < s.years[i]!.billed);
      if (!belowSomewhere) continue;
      const first = s.years[idx[0]! - 1]!.year;
      const last = s.years[idx[idx.length - 1]!]!.year;
      const gap = idx.reduce((acc, i) => acc + Math.max(0, s.years[i]!.billed - s.years[i]!.paid_correct), 0);
      const share = ctx.share(last);
      const gapTenant = share ? mulRate(gap, share.frac) : null;
      out.push(
        mkFinding({
          check_id: RF06.id,
          title: `Controllable billing grows exactly ${s.pct}% a year, ${first}→${last}`,
          severity: "review",
          year: [first, last],
          category: "Capped pool",
          tag: "pattern",
          narrative:
            `The capped pool was billed at ${[s.years[idx[0]! - 1]!.billed, ...idx.map((i) => s.years[i]!.billed)].map((v) => usd(v)).join(" → ")} — each figure exactly ${s.pct}.00% above the one before — while the controllable costs actually listed fell below the billed figure in at least one of those years. ` +
            `Two readings exist. Under the lease as abstracted, the ceiling is measured against ${BASIS_TEXT[cap.basis]}, so it resets to actual whenever actual is lower; under a prior-cap reading the ceiling compounds regardless of spend. The statement follows the second. ` +
            (gap > 0 ? `The gap between the two over ${first}→${last} is ${usd(gap)} at the property level` + (gapTenant !== null ? ` (${usd(gapTenant)} at Tenant's share).` : ".") : ""),
          working: [
            { label: "Growth test", value: `billed[y] / billed[y−1] within ±0.1% of ${(1 + s.pct / 100).toFixed(4)}` },
            ...idx.map((i) => ({ label: `${s.years[i - 1]!.year}→${s.years[i]!.year}`, value: `${usd(s.years[i - 1]!.billed)} → ${usd(s.years[i]!.billed)} (×${(s.years[i]!.billed / s.years[i - 1]!.billed).toFixed(4)})` })),
            { label: "Gap (pool)", value: usd(gap) },
            ...(gapTenant !== null ? [{ label: "Gap (tenant)", value: usd(gapTenant) }] : []),
            ...schedRows,
          ],
          refs: ["Burke, Cap Traps: cap-on-cap", "NRTA caps workshop: basis of the increase"],
          related: perYearIds,
        }),
      );
    }
    return out;
  },
};
