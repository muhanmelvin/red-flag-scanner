import type { Check, CheckContext, Finding, ReconYear } from "../types.ts";
import { isCapPoolLine, sumAmount } from "../lines.ts";
import { mulRate, pctStr, toCents, toDollars, usd } from "../money.ts";
import { mkFinding, skip } from "../finding.ts";

/** What the tenant was billed in total for the year's pool, honoring a landlord cap computation if shown. */
export function billedPoolCents(y: ReconYear, ctx: CheckContext): number {
  const lease = ctx.pkg.lease_lite;
  if (!y.cap_summary || !lease.cap) return sumAmount(y.lines);
  const nonPool = y.lines.filter((l) => !isCapPoolLine(l, lease));
  return sumAmount(nonPool) + toCents(y.cap_summary.pool_billed);
}

export const RF08: Check = {
  id: "RF-08",
  title: "Pro-rata share tests",
  run(ctx: CheckContext) {
    const out: Finding[] = [];
    const lease = ctx.pkg.lease_lite.share;
    let ranSomething = false;

    for (let i = 0; i < ctx.years.length; i++) {
      const y = ctx.years[i]!;
      const billedPct = y.tenant_summary?.pro_rata_share_pct;
      const den = y.denominator_sf;
      const pool = billedPoolCents(y, ctx);

      // (a) billed share above the lease's stated share
      if (lease.stated_pct !== undefined && billedPct !== undefined) {
        ranSomething = true;
        if (billedPct > lease.stated_pct + 1e-9) {
          const excessFrac = (billedPct - lease.stated_pct) / 100;
          const impact = mulRate(pool, excessFrac);
          out.push(
            mkFinding({
              check_id: RF08.id,
              title: `Billed share ${billedPct.toFixed(4)}% exceeds the lease's ${lease.stated_pct}% in ${y.year}`,
              severity: "high",
              year: y.year,
              category: "Pro-rata share",
              tag: "a",
              tenant_impact_usd: toDollars(impact),
              narrative:
                `The lease fixes Tenant's proportionate share at ${lease.stated_pct}%; the ${y.year} statement applies ${billedPct.toFixed(4)}%` +
                (den ? ` (${lease.numerator_sf.toLocaleString("en-US")} sf ÷ ${den.toLocaleString("en-US")} sf)` : "") +
                `. Applied to the ${usd(pool)} billed pool, the difference is ${usd(impact)}. A share the lease states is not the landlord's to recompute; Tenant requests re-billing at ${lease.stated_pct}%.`,
              working: [
                { label: "Lease stated share", value: `${lease.stated_pct}%` },
                { label: `${y.year} billed share`, value: `${billedPct.toFixed(4)}%` + (den ? ` = ${lease.numerator_sf.toLocaleString("en-US")} / ${den.toLocaleString("en-US")}` : "") },
                { label: "Difference", value: pctStr(excessFrac, 4) },
                { label: `${y.year} billed pool`, value: usd(pool) },
                { label: "Tenant impact", value: `${usd(pool)} × ${pctStr(excessFrac, 4)} = ${usd(impact)}` },
              ],
              refs: ["Foundations F·5: pro-rata share", "Finding the False Charges: allocation overcharges"],
            }),
          );
        }
      }

      // (b) recompute numerator / denominator and compare with the billed share
      if (den && billedPct !== undefined) {
        ranSomething = true;
        const recomputed = (lease.numerator_sf / den) * 100;
        const drift = billedPct - recomputed;
        if (Math.abs(drift) > 0.05) {
          const impact = mulRate(pool, drift / 100);
          out.push(
            mkFinding({
              check_id: RF08.id,
              title: `Billed share does not reproduce from the statement's own square footage (${y.year})`,
              severity: drift > 0 ? "high" : "review",
              year: y.year,
              category: "Pro-rata share",
              tag: "b",
              tenant_impact_usd: drift > 0 ? toDollars(impact) : undefined,
              narrative:
                `${lease.numerator_sf.toLocaleString("en-US")} sf ÷ ${den.toLocaleString("en-US")} sf = ${recomputed.toFixed(4)}%, but the ${y.year} statement bills ${billedPct.toFixed(4)}% — a ${Math.abs(drift).toFixed(4)} point ${drift > 0 ? "overstatement" : "understatement"}` +
                (drift > 0 ? ` worth ${usd(impact)} on the ${usd(pool)} pool.` : ".") +
                ` Tenant requests the square-footage certification behind both figures.`,
              working: [
                { label: "Premises sf", value: lease.numerator_sf.toLocaleString("en-US") },
                { label: `${y.year} denominator sf`, value: den.toLocaleString("en-US") },
                { label: "Recomputed share", value: `${recomputed.toFixed(4)}%` },
                { label: "Billed share", value: `${billedPct.toFixed(4)}%` },
                { label: "Drift", value: `${drift >= 0 ? "+" : ""}${drift.toFixed(4)} pts (tolerance 0.05)` },
              ],
              refs: ["Foundations F·5: pro-rata share"],
            }),
          );
        }
      }

      // (c) denominator shrinkage year over year
      if (i > 0) {
        const prev = ctx.years[i - 1]!;
        if (prev.denominator_sf && den && den < prev.denominator_sf) {
          ranSomething = true;
          const shrink = (prev.denominator_sf - den) / prev.denominator_sf;
          const lift = prev.denominator_sf / den - 1;
          const occ = y.occupancy_pct;
          out.push(
            mkFinding({
              check_id: RF08.id,
              title: `Share denominator shrank ${(shrink * 100).toFixed(1)}% in ${y.year}`,
              severity: "review",
              year: [prev.year, y.year],
              category: "Pro-rata share",
              tag: "c",
              narrative:
                `The denominator of Tenant's share fell from ${prev.denominator_sf.toLocaleString("en-US")} sf in ${prev.year} to ${den.toLocaleString("en-US")} sf in ${y.year}` +
                (occ !== undefined ? ` (occupancy ${occ}%)` : "") +
                `. The lease's denominator is ${lease.denominator_basis === "GLA" ? "gross leasable area, which does not change with vacancy" : lease.denominator_basis === "GLOA" ? "leased-and-occupied area" : "unstated"}; a denominator that tracks occupancy lifts Tenant's share of every line at once — here by ${(lift * 100).toFixed(1)}% — and shifts the landlord's vacancy cost onto the tenants who stayed. Tenant requests the area schedule behind both years.`,
              working: [
                { label: `${prev.year} denominator`, value: `${prev.denominator_sf.toLocaleString("en-US")} sf` },
                { label: `${y.year} denominator`, value: `${den.toLocaleString("en-US")} sf` },
                { label: "Shrinkage", value: `${(shrink * 100).toFixed(2)}%` },
                { label: "Lift applied to every line", value: `×${(prev.denominator_sf / den).toFixed(4)} (+${(lift * 100).toFixed(2)}%)` },
                { label: "Lease denominator basis", value: lease.denominator_basis },
              ],
              refs: ["Finding the False Charges: allocation overcharges — the iceberg below the waterline"],
            }),
          );
        }
      }

      // (d) tie-out: billed pool × share vs tenant total
      const total = y.tenant_summary?.tenant_total;
      const share = ctx.share(y.year);
      if (total !== undefined && share) {
        ranSomething = true;
        const expected = mulRate(pool, share.frac);
        const diff = toCents(total) - expected;
        if (Math.abs(diff) > 100) {
          out.push(
            mkFinding({
              check_id: RF08.id,
              title: `Tenant total does not tie to pool × share in ${y.year}`,
              severity: "high",
              year: y.year,
              category: "Tenant total",
              tag: "d",
              tenant_impact_usd: diff > 0 ? toDollars(diff) : undefined,
              narrative:
                `The ${y.year} pool of ${usd(pool)} at Tenant's ${pctStr(share.frac, 4)} share is ${usd(expected)}; the statement charges ${usd(toCents(total))}, ${usd(Math.abs(diff))} ${diff > 0 ? "more" : "less"}. Totals that do not reproduce from their own parts are the easiest finding to defend; Tenant requests the line-by-line tenant allocation.`,
              working: [
                { label: `${y.year} billed pool`, value: usd(pool) },
                { label: "Share applied", value: `${pctStr(share.frac, 4)} (${share.source})` },
                { label: "Pool × share", value: usd(expected) },
                { label: "Tenant total on statement", value: usd(toCents(total)) },
                { label: "Difference", value: usd(diff) },
              ],
              refs: ["Desktop audit workflow: verify, don't assume"],
            }),
          );
        }
      }
    }

    if (!ranSomething) return skip(RF08.id, RF08.title, "no billed share, denominator or tenant total on the statements to test");
    return out;
  },
};
