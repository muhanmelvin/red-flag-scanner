import type { Check, CheckContext, Finding } from "../types.ts";
import { matchLines } from "../normalize.ts";
import { lineActualCents } from "../lines.ts";
import { mulRate, pctStr, toCents, toDollars, usd } from "../money.ts";
import { mkFinding, skip } from "../finding.ts";

export const RF12: Check = {
  id: "RF-12",
  title: "Identical-amount test",
  run(ctx: CheckContext) {
    if (ctx.years.length < 2) return skip(RF12.id, RF12.title, "needs two or more years");
    const out: Finding[] = [];
    const materiality = toCents(ctx.config.materiality_usd);

    for (let i = 1; i < ctx.years.length; i++) {
      const prev = ctx.years[i - 1]!;
      const curr = ctx.years[i]!;
      const share = ctx.share(curr.year);
      const { pairs } = matchLines(prev.lines, curr.lines);
      for (const { prev: p, curr: c } of pairs) {
        if (p.capital || c.capital) continue; // amortization is identical by design
        const a = lineActualCents(p);
        const b = lineActualCents(c);
        if (a !== b || a <= 0) continue;
        const exposure = share ? mulRate(a, share.frac) : null;
        if (exposure !== null && exposure < materiality) continue;
        if (exposure === null && a < materiality) continue;
        out.push(
          mkFinding({
            check_id: RF12.id,
            title: `${c.label} is identical to the cent in ${prev.year} and ${curr.year}`,
            severity: "review",
            year: [prev.year, curr.year],
            category: c.label,
            tenant_exposure_usd: exposure !== null ? toDollars(exposure) : undefined,
            narrative: `${c.label} is ${usd(a)} in both ${prev.year} and ${curr.year}. Real expenses are never the same two years running; an amount repeated to the cent is usually a budget figure, a flat allocation or last year's number carried forward. Tenant requests the ${curr.year} invoices.`,
            working: [
              { label: `${prev.year}`, value: usd(a) },
              { label: `${curr.year}`, value: usd(b) },
              ...(share ? [{ label: "Tenant share", value: `${pctStr(share.frac, 4)} (${share.source})` }, { label: "Tenant-level amount", value: usd(exposure!) }] : []),
            ],
            refs: ["Red flags: the previous-year trap"],
          }),
        );
      }
    }
    return out;
  },
};
