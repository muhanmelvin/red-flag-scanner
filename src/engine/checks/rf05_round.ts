import type { Check, CheckContext, Finding, Severity } from "../types.ts";
import { matchLines } from "../normalize.ts";
import { lineActualCents, lineAmountCents } from "../lines.ts";
import { deltaStr, mulRate, toCents, toDollars, usd } from "../money.ts";
import { findingId, mkFinding } from "../finding.ts";

export function isRoundAmount(cents: number, minCents: number): boolean {
  if (cents < minCents) return false;
  if (cents % 100_000 === 0) return true; // $1,000 multiples
  if (cents >= 2_000_000 && cents % 50_000 === 0) return true; // $500 multiples above $20k
  return false;
}

export const RF05: Check = {
  id: "RF-05",
  title: "Round-number test",
  run(ctx: CheckContext) {
    const out: Finding[] = [];
    const min = toCents(ctx.config.round_number_min_usd);
    const thr = ctx.config.yoy_pct_threshold / 100;

    for (let i = 0; i < ctx.years.length; i++) {
      const y = ctx.years[i]!;
      const prev = i > 0 ? ctx.years[i - 1]! : null;
      const m = prev ? matchLines(prev.lines, y.lines) : null;
      const share = ctx.share(y.year);

      for (const line of y.lines) {
        const amt = lineAmountCents(line);
        if (!isRoundAmount(amt, min)) continue;
        let severity: Severity = "info";
        const related: string[] = [];
        const notes: string[] = [];
        if (m) {
          if (m.appeared.includes(line)) {
            severity = "review";
            related.push(findingId("RF-02", [prev!.year, y.year], line.label));
            notes.push(`it is also new this year`);
          } else {
            const pair = m.pairs.find((p) => p.curr === line);
            if (pair) {
              const a = lineActualCents(pair.prev);
              const b = lineActualCents(pair.curr);
              if (a > 0 && Math.abs((b - a) / a) >= thr) {
                severity = "review";
                related.push(findingId("RF-01", [prev!.year, y.year], line.label));
                notes.push(`it also moved ${deltaStr((b - a) / a)} from ${prev!.year}`);
              }
            }
          }
        }
        const exposure = share ? mulRate(amt, share.frac) : null;
        out.push(
          mkFinding({
            check_id: RF05.id,
            title: `${line.label} is a round ${usd(amt)}`,
            severity,
            year: y.year,
            category: line.label,
            tenant_exposure_usd: exposure !== null ? toDollars(exposure) : undefined,
            narrative:
              `${line.label} is billed at exactly ${usd(amt)} in ${y.year}. Aggregates of real invoices are rarely round; a round figure usually means an estimate, an allocation or a budget number was billed instead of actual cost` +
              (notes.length ? `, and ${notes.join(" and ")}` : "") +
              `. Tenant requests the general-ledger detail and invoices that make up the amount.`,
            working: [
              { label: `${y.year} amount`, value: usd(amt) },
              { label: "Test", value: amt % 100_000 === 0 ? "multiple of $1,000" : "multiple of $500 above $20,000" },
              { label: "Minimum tested", value: usd(min) },
              ...(exposure !== null ? [{ label: "Tenant-level amount", value: usd(exposure) }] : []),
            ],
            refs: ["Red flags: round numbers"],
            related,
          }),
        );
      }
    }
    return out;
  },
};
