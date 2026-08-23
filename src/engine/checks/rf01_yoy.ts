import type { Check, CheckContext, Finding } from "../types.ts";
import { matchLines } from "../normalize.ts";
import { lineActualCents } from "../lines.ts";
import { deltaStr, mulRate, pctStr, toCents, toDollars, usd } from "../money.ts";
import { mkFinding, skip } from "../finding.ts";

export const RF01: Check = {
  id: "RF-01",
  title: "Year-over-year variance",
  run(ctx: CheckContext) {
    if (ctx.years.length < 2) return skip(RF01.id, RF01.title, "needs two or more years");
    const out: Finding[] = [];
    const thr = ctx.config.yoy_pct_threshold / 100;
    const materiality = toCents(ctx.config.materiality_usd);

    for (let i = 1; i < ctx.years.length; i++) {
      const prev = ctx.years[i - 1]!;
      const curr = ctx.years[i]!;
      const share = ctx.share(curr.year);
      const { pairs } = matchLines(prev.lines, curr.lines);
      for (const { prev: p, curr: c } of pairs) {
        if (p.capital && c.capital) continue; // amortization moves by schedule, not by spend — RF-09's job
        const a = lineActualCents(p);
        const b = lineActualCents(c);
        if (a <= 0) continue;
        const delta = b - a;
        const frac = delta / a;
        if (Math.abs(frac) < thr) continue;
        const exposure = share ? mulRate(Math.abs(delta), share.frac) : null;
        if (exposure !== null && exposure < materiality) continue;

        const grossNote = c.gross_up || p.gross_up ? " (compared on pre-gross-up actuals)" : "";
        const working = [
          { label: `${prev.year} amount`, value: usd(a) },
          { label: `${curr.year} amount`, value: usd(b) },
          { label: "Change", value: `${usd(delta)} (${deltaStr(frac)})` },
          { label: "Flag threshold", value: `±${ctx.config.yoy_pct_threshold}%` },
        ];
        if (share) {
          working.push({ label: "Tenant share", value: `${pctStr(share.frac, 4)} (${share.source})` });
          working.push({ label: "Tenant-level change", value: usd(mulRate(delta, share.frac)) });
        }
        const direction = delta > 0 ? "rose" : "fell";
        out.push(
          mkFinding({
            check_id: RF01.id,
            title: `${c.label} ${direction} ${deltaStr(Math.abs(frac), 1).replace("+", "")} year over year`,
            severity: "review",
            year: [prev.year, curr.year],
            category: c.label,
            tenant_exposure_usd: exposure !== null ? toDollars(exposure) : undefined,
            narrative:
              `${c.label} ${direction} from ${usd(a)} in ${prev.year} to ${usd(b)} in ${curr.year}, a ${deltaStr(frac)} change${grossNote}. ` +
              `A swing of this size is a question, not an accusation: Tenant requests the vendor invoices and contracts behind the ${curr.year} figure` +
              (exposure !== null ? `; at Tenant's share the change is worth ${usd(exposure)}.` : "."),
            working,
            refs: ["Red-flag mindset: large swings; errors cluster around transitions"],
          }),
        );
      }
    }
    return out;
  },
};
