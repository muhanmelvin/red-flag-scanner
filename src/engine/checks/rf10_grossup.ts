import type { Check, CheckContext, Finding } from "../types.ts";
import { isFixedCost, lineAmountCents } from "../lines.ts";
import { matchLines } from "../normalize.ts";
import { mulRate, pctStr, toCents, toDollars, usd } from "../money.ts";
import { mkFinding, skip } from "../finding.ts";

export const RF10: Check = {
  id: "RF-10",
  title: "Gross-up sanity",
  run(ctx: CheckContext) {
    const out: Finding[] = [];
    const lease = ctx.pkg.lease_lite.gross_up;
    const candidates = ctx.years.filter((y) => y.gross_up_applied || y.lines.some((l) => l.gross_up));
    if (candidates.length === 0) return skip(RF10.id, RF10.title, "no year applies a gross-up");

    for (let i = 0; i < ctx.years.length; i++) {
      const y = ctx.years[i]!;
      if (!candidates.includes(y)) continue;
      const share = ctx.share(y.year);
      const occ = y.occupancy_pct;
      const toPct = lease?.to_pct;
      const maxFactor = occ && toPct && occ < toPct ? toPct / occ : occ && toPct ? 1 : null;

      for (const line of y.lines) {
        const billed = lineAmountCents(line);
        if (line.gross_up) {
          const actual = toCents(line.gross_up.actual);
          const adj = billed - actual;
          if (adj <= 0) continue;
          const factorShown = line.gross_up.factor ?? (actual > 0 ? billed / actual : undefined);
          const base = [
            { label: `${y.year} actual (pre-gross-up)`, value: usd(actual) },
            { label: `${y.year} billed (grossed up)`, value: usd(billed) },
            { label: "Gross-up adjustment", value: usd(adj) + (factorShown ? ` (×${factorShown.toFixed(4)})` : "") },
            { label: "Occupancy / gross-up target", value: `${occ !== undefined ? occ + "%" : "not stated"} / ${toPct !== undefined ? toPct + "%" : "not stated"}` },
          ];
          if (lease && lease.allowed === false) {
            const impact = share ? mulRate(adj, share.frac) : undefined;
            out.push(mkFinding({
              check_id: RF10.id, title: `${line.label} grossed up; the lease allows no gross-up (${y.year})`, severity: "high", year: y.year, category: line.label,
              tenant_impact_usd: impact !== undefined ? toDollars(impact) : undefined,
              narrative: `The ${y.year} statement grosses ${line.label} up from ${usd(actual)} to ${usd(billed)}. The lease contains no gross-up provision, so the ${usd(adj)} adjustment has no contractual basis` + (impact !== undefined ? ` (${usd(impact)} at Tenant's share).` : "."),
              working: [...base, ...(impact !== undefined ? [{ label: "Tenant impact", value: usd(impact) }] : [])],
              refs: ["Finding the False Charges ch.8: gross-ups and base years"],
            }));
            continue;
          }
          if (isFixedCost(line)) {
            const impact = share ? mulRate(adj, share.frac) : undefined;
            out.push(mkFinding({
              check_id: RF10.id, title: `${line.label} — a fixed cost — was grossed up in ${y.year}`, severity: "high", year: y.year, category: line.label,
              tenant_impact_usd: impact !== undefined ? toDollars(impact) : undefined,
              narrative: `${line.label} is grossed up from ${usd(actual)} to ${usd(billed)} in ${y.year}${occ !== undefined ? ` (occupancy ${occ}%)` : ""}. A gross-up exists to restate costs that vary with occupancy as if the building were full; ${line.label.toLowerCase()} does not vary with occupancy, so grossing it up charges tenants for cost the landlord never incurred — ${usd(adj)} at the property level` + (impact !== undefined ? `, ${usd(impact)} at Tenant's share.` : "."),
              working: [...base, { label: "Category", value: "fixed cost — not eligible for gross-up" }, ...(impact !== undefined ? [{ label: "Tenant share", value: `${pctStr(share!.frac, 4)} (${share!.source})` }, { label: "Tenant impact", value: usd(impact) }] : [])],
              refs: ["Finding the False Charges ch.8: gross-ups — variable costs only", "Audit Core: gross-ups"],
            }));
            continue;
          }
          if (maxFactor !== null) {
            const allowedMax = Math.round(actual * maxFactor);
            const over = billed - allowedMax;
            if (over > 100) {
              const impact = share ? mulRate(over, share.frac) : undefined;
              out.push(mkFinding({
                check_id: RF10.id, title: `${line.label} grossed up beyond the lease's ${toPct}% target (${y.year})`, severity: "high", year: y.year, category: line.label,
                tenant_impact_usd: impact !== undefined ? toDollars(impact) : undefined,
                narrative: `At ${occ}% occupancy the lease permits grossing variable costs up to ${toPct}% — a factor of ${maxFactor.toFixed(4)}, or ${usd(allowedMax)} for ${line.label}. The statement bills ${usd(billed)}, ${usd(over)} beyond the permitted gross-up` + (impact !== undefined ? ` (${usd(impact)} at Tenant's share).` : "."),
                working: [...base, { label: "Maximum permitted", value: `${usd(actual)} × ${maxFactor.toFixed(4)} = ${usd(allowedMax)}` }, { label: "Excess", value: usd(over) }, ...(impact !== undefined ? [{ label: "Tenant impact", value: usd(impact) }] : [])],
                refs: ["Finding the False Charges ch.8: gross-ups and base years"],
              }));
            }
          }
          continue;
        }
      }

      // Heuristic for statements that hide the adjustment: a fixed line grew by ≈ the gross-up factor while occupancy fell.
      if (i > 0 && maxFactor !== null && maxFactor > 1) {
        const prev = ctx.years[i - 1]!;
        if (prev.occupancy_pct !== undefined && occ !== undefined && occ < prev.occupancy_pct) {
          const m = matchLines(prev.lines, y.lines);
          for (const { prev: p, curr: c } of m.pairs) {
            if (c.gross_up || !isFixedCost(c)) continue;
            const a = lineAmountCents(p);
            const b = lineAmountCents(c);
            if (a <= 0) continue;
            const growth = b / a;
            if (Math.abs(growth - maxFactor) <= 0.02) {
              const implied = b - Math.round(b / maxFactor);
              const exposure = share ? mulRate(implied, share.frac) : null;
              out.push(mkFinding({
                check_id: RF10.id, title: `${c.label} grew by the gross-up factor while occupancy fell (${y.year})`, severity: "review", year: [prev.year, y.year], category: c.label,
                tenant_exposure_usd: exposure !== null ? toDollars(exposure) : undefined,
                narrative: `${c.label}, a fixed cost, rose ×${growth.toFixed(4)} from ${prev.year} to ${y.year} while occupancy fell from ${prev.occupancy_pct}% to ${occ}% — almost exactly the ${maxFactor.toFixed(4)} gross-up factor the lease would permit on variable costs. Fixed costs are not eligible for gross-up; Tenant requests the gross-up worksheet for ${y.year}.`,
                working: [{ label: `${prev.year}`, value: usd(a) }, { label: `${y.year}`, value: usd(b) }, { label: "Growth", value: `×${growth.toFixed(4)}` }, { label: "Gross-up factor", value: `${toPct}% ÷ ${occ}% = ×${maxFactor.toFixed(4)}` }, { label: "Implied adjustment", value: usd(implied) }],
                refs: ["Finding the False Charges ch.8: gross-ups — variable costs only"],
              }));
            }
          }
        }
      }
    }
    return out;
  },
};
