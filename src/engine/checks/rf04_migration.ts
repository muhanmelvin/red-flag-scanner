import type { Check, CheckContext, Finding, ReconLine, Severity } from "../types.ts";
import { matchLines, normalizeLabel } from "../normalize.ts";
import { lineAmountCents } from "../lines.ts";
import { buildCapSchedule, type CapYear } from "../cap.ts";
import { mulRate, pctStr, toDollars, usd } from "../money.ts";
import { findingId, mkFinding, skip } from "../finding.ts";
import { bucketLabel, probableRenames } from "./migration_shared.ts";

interface Move {
  prev: ReconLine;
  curr: ReconLine;
  how: "bucket" | "section" | "renamed";
  outOfPool: boolean; // controllable → non-controllable under a controllable cap
}

export const RF04: Check = {
  id: "RF-04",
  title: "Controllable → non-controllable migration",
  run(ctx: CheckContext) {
    if (ctx.years.length < 2) return skip(RF04.id, RF04.title, "needs two or more years");
    const out: Finding[] = [];
    const cap = ctx.pkg.lease_lite.cap;
    const capOnControllables = !!cap && cap.applies_to === "controllable";
    const capBuild = capOnControllables ? buildCapSchedule(ctx) : null;

    for (let i = 1; i < ctx.years.length; i++) {
      const prev = ctx.years[i - 1]!;
      const curr = ctx.years[i]!;
      const share = ctx.share(curr.year);
      const m = matchLines(prev.lines, curr.lines);
      const moves: Move[] = [];

      for (const { prev: p, curr: c } of m.pairs) {
        const pb = p.bucket && p.bucket !== "unknown" ? p.bucket : null;
        const cb = c.bucket && c.bucket !== "unknown" ? c.bucket : null;
        if (pb && cb && pb !== cb) {
          moves.push({ prev: p, curr: c, how: "bucket", outOfPool: capOnControllables && pb === "controllable" && cb === "non_controllable" });
        } else if (normalizeLabel(p.section) !== normalizeLabel(c.section) && (!pb || !cb || pb === cb)) {
          moves.push({ prev: p, curr: c, how: "section", outOfPool: false });
        }
      }
      for (const r of probableRenames(m)) {
        const pb = r.vanished.bucket && r.vanished.bucket !== "unknown" ? r.vanished.bucket : null;
        const cb = r.appeared.bucket && r.appeared.bucket !== "unknown" ? r.appeared.bucket : null;
        if (pb && cb && pb !== cb) {
          moves.push({ prev: r.vanished, curr: r.appeared, how: "renamed", outOfPool: capOnControllables && pb === "controllable" && cb === "non_controllable" });
        }
      }
      if (moves.length === 0) continue;

      // Joint cap consequence for everything that left the pool this year.
      const outMoves = moves.filter((mv) => mv.outOfPool);
      let capYear: CapYear | undefined;
      let excessTotal = 0;
      let movedTotal = 0;
      let capNote = "";
      if (outMoves.length > 0 && capBuild) {
        if (capBuild.ok) {
          capYear = capBuild.schedule.years.find((y) => y.year === curr.year);
          if (capYear && capYear.allowed !== null) {
            movedTotal = outMoves.reduce((s, mv) => s + lineAmountCents(mv.curr), 0);
            excessTotal = Math.min(movedTotal, Math.max(0, capYear.pool_actual + movedTotal - capYear.allowed));
          } else {
            capNote = "the cap schedule has no ceiling for this year (base year), so the consequence cannot be priced";
          }
        } else {
          capNote = `cap schedule could not be rebuilt (${capBuild.reason})`;
        }
      }

      for (const mv of moves) {
        const amt = lineAmountCents(mv.curr);
        const prevAmt = lineAmountCents(mv.prev);
        let severity: Severity = "review";
        let impact: number | undefined;
        const related: string[] = [];
        if (mv.how === "renamed") {
          related.push(findingId("RF-03", [prev.year, curr.year], mv.prev.label));
          related.push(findingId("RF-02", [prev.year, curr.year], mv.curr.label));
        }
        const working: Array<{ label: string; value: string }> = [
          {
            label: "Bridge",
            value: `${mv.prev.label} · ${prev.year}: ${mv.prev.section} / ${bucketLabel(mv.prev.bucket)} → ${curr.year}: ${mv.curr.section} / ${bucketLabel(mv.curr.bucket)}${mv.how === "renamed" ? ` (re-labelled "${mv.curr.label}")` : ""}`,
          },
          { label: `${prev.year} amount`, value: usd(prevAmt) },
          { label: `${curr.year} amount`, value: usd(amt) },
        ];

        let consequence = "";
        if (mv.outOfPool && capYear && capYear.allowed !== null) {
          const myExcess = movedTotal > 0 ? Math.round((excessTotal * amt) / movedTotal) : 0;
          working.push(
            { label: `${curr.year} capped pool as presented`, value: usd(capYear.pool_actual) },
            { label: `${curr.year} cap (lease)`, value: usd(capYear.allowed) },
            { label: "Pool with this line restored", value: usd(capYear.pool_actual + movedTotal) },
            { label: "Amount escaping the cap", value: usd(myExcess) },
          );
          if (myExcess > 0) {
            severity = "high";
            if (share) {
              impact = mulRate(myExcess, share.frac);
              working.push({ label: "Tenant share", value: `${pctStr(share.frac, 4)} (${share.source})` }, { label: "Tenant impact", value: usd(impact) });
            }
            consequence = ` With the line restored to the capped pool, the pool would stand at ${usd(capYear.pool_actual + movedTotal)} against a ${curr.year} ceiling of ${usd(capYear.allowed)}; ${usd(myExcess)} of this cost escapes the cap only because it was re-classified` + (impact !== undefined ? ` — ${usd(impact)} at Tenant's share.` : ".");
          } else {
            consequence = ` The capped pool had room this year (${usd(capYear.pool_actual + movedTotal)} restored against a ceiling of ${usd(capYear.allowed)}), so the move costs nothing yet; it is flagged because re-classification compounds — next year's ceiling grows from a smaller base.`;
          }
        } else if (mv.outOfPool && capNote) {
          consequence = ` The move takes the line out of the capped pool; ${capNote}.`;
          working.push({ label: "Cap consequence", value: capNote });
        } else if (mv.how === "section") {
          consequence = " The amount moved between statement sections without a change in classification; Tenant requests the reason, because section placement decides which lease limits apply.";
        }

        out.push(
          mkFinding({
            check_id: RF04.id,
            title: mv.outOfPool
              ? `${mv.curr.label} moved out of the capped pool in ${curr.year}`
              : `${mv.curr.label} re-classified in ${curr.year}`,
            severity,
            year: [prev.year, curr.year],
            category: mv.curr.label,
            tenant_impact_usd: impact !== undefined ? toDollars(impact) : undefined,
            narrative:
              `${mv.prev.label} was ${bucketLabel(mv.prev.bucket)} in ${prev.year} and is presented as ${bucketLabel(mv.curr.bucket)}${mv.how === "renamed" ? ` under the label "${mv.curr.label}"` : ""} in ${curr.year}; nothing in the lease abstract supports the change. ` +
              `A category's classification is fixed by the lease, not by the statement; Tenant requests the lease provision supporting the ${curr.year} treatment.` +
              consequence,
            working,
            refs: ["Finding the False Charges ch.3: controllable → non-controllable migration", "Cap traps: moving controllable to non-controllable"],
            related,
          }),
        );
      }
    }
    return out;
  },
};
