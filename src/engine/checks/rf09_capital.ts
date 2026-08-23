import type { Check, CheckContext, Finding, ReconLine } from "../types.ts";
import { looksCapital, lineAmountCents } from "../lines.ts";
import { mulRate, pctStr, toCents, toDollars, usd } from "../money.ts";
import { mkFinding, skip } from "../finding.ts";

/** Months of `year` during which an asset placed in service on `inService` with `life` months is still amortizing. */
export function monthsInService(inService: string, lifeMonths: number, year: number): { months: number; start: number; end: number } {
  const m = /^(\d{4})-(\d{2})/.exec(inService);
  if (!m) return { months: 0, start: 0, end: 0 };
  const startIdx = Number(m[1]) * 12 + (Number(m[2]) - 1); // absolute month index of first month in service
  const endIdx = startIdx + lifeMonths - 1; // last month in service
  const y0 = year * 12;
  const y1 = year * 12 + 11;
  const lo = Math.max(startIdx, y0);
  const hi = Math.min(endIdx, y1);
  return { months: Math.max(0, hi - lo + 1), start: startIdx, end: endIdx };
}

/** Expected annual amortization in cents: straight-line principal plus simple interest on the declining balance. */
export function expectedAmortization(cap: NonNullable<ReconLine["capital"]>, year: number): { principal: number; interest: number; months: number } {
  const total = toCents(cap.total_cost);
  const { months, start } = monthsInService(cap.in_service, cap.useful_life_months, year);
  if (months === 0) return { principal: 0, interest: 0, months: 0 };
  const monthly = total / cap.useful_life_months; // float; rounded at the end
  const principal = Math.round(monthly * months);
  let interest = 0;
  if (cap.interest_rate_pct) {
    const r = cap.interest_rate_pct / 100 / 12;
    const firstMonthOfYear = Math.max(start, year * 12);
    for (let k = 0; k < months; k++) {
      const idx = firstMonthOfYear + k; // absolute month
      const elapsed = idx - start; // months already amortized before this one
      const balance = total - monthly * elapsed;
      interest += balance * r;
    }
    interest = Math.round(interest);
  }
  return { principal, interest, months };
}

export const RF09: Check = {
  id: "RF-09",
  title: "Capital & amortization",
  run(ctx: CheckContext) {
    const out: Finding[] = [];
    const lease = ctx.pkg.lease_lite;
    const threshold = lease.capital_threshold !== undefined ? toCents(lease.capital_threshold) : lease.capital_life_years ? 0 : null;
    let ran = false;

    for (const y of ctx.years) {
      const share = ctx.share(y.year);
      for (const line of y.lines) {
        const billed = lineAmountCents(line);
        if (line.capital) {
          ran = true;
          const cap = line.capital;
          const exp = expectedAmortization(cap, y.year);
          const expected = exp.principal + exp.interest;
          const total = toCents(cap.total_cost);
          const working: Array<{ label: string; value: string }> = [
            { label: "Capital cost", value: usd(total) },
            { label: "Useful life", value: `${cap.useful_life_months} months from ${cap.in_service}` },
            { label: `Months in service in ${y.year}`, value: String(exp.months) },
            { label: "Straight-line principal", value: `${usd(total)} ÷ ${cap.useful_life_months} × ${exp.months} = ${usd(exp.principal)}` },
          ];
          if (cap.interest_rate_pct) working.push({ label: `Interest at ${cap.interest_rate_pct}% on declining balance`, value: usd(exp.interest) });
          working.push({ label: "Expected this year", value: usd(expected) }, { label: "Billed", value: usd(billed) });

          if (exp.months === 0 && billed > 0) {
            const impact = share ? mulRate(billed, share.frac) : undefined;
            out.push(
              mkFinding({
                check_id: RF09.id,
                title: `${line.label} still billed after its amortization ended (${y.year})`,
                severity: "high",
                year: y.year,
                category: line.label,
                tenant_impact_usd: impact !== undefined ? toDollars(impact) : undefined,
                narrative: `${line.label} was placed in service ${cap.in_service} with a ${cap.useful_life_months}-month life, so its amortization ended before ${y.year}; the ${y.year} statement still bills ${usd(billed)}` + (impact !== undefined ? ` (${usd(impact)} at Tenant's share).` : ".") + ` Tenant requests the amortization schedule and removal of the charge.`,
                working: [...working, ...(impact !== undefined ? [{ label: "Tenant impact", value: usd(impact) }] : [])],
                refs: ["Finding the False Charges ch.4: amortization games", "Amortization backup = cost ÷ months × months in service"],
              }),
            );
            continue;
          }
          const over = billed - expected;
          if (over > 100) {
            const impact = share ? mulRate(over, share.frac) : undefined;
            out.push(
              mkFinding({
                check_id: RF09.id,
                title: `${line.label} amortization over-billed in ${y.year}`,
                severity: "high",
                year: y.year,
                category: line.label,
                tenant_impact_usd: impact !== undefined ? toDollars(impact) : undefined,
                narrative: `Recomputed from the statement's own capital figures (${usd(total)} over ${cap.useful_life_months} months${cap.interest_rate_pct ? `, ${cap.interest_rate_pct}% interest` : ""}), the ${y.year} installment is ${usd(expected)} for ${exp.months} months in service; the statement bills ${usd(billed)}, ${usd(over)} too much` + (impact !== undefined ? ` (${usd(impact)} at Tenant's share).` : ".") + ` Tenant requests the amortization schedule.`,
                working: [...working, { label: "Excess", value: usd(over) }, ...(impact !== undefined ? [{ label: "Tenant share", value: `${pctStr(share!.frac, 4)} (${share!.source})` }, { label: "Tenant impact", value: usd(impact) }] : [])],
                refs: ["Finding the False Charges ch.4: amortization games", "Amortization backup = cost ÷ months × months in service"],
              }),
            );
          }
          // Life shorter than the lease states → installments too large.
          if (lease.capital_life_years && cap.useful_life_months < lease.capital_life_years * 12) {
            const leaseMonths = lease.capital_life_years * 12;
            const { months } = monthsInService(cap.in_service, leaseMonths, y.year);
            const leaseInstallment = Math.round((total / leaseMonths) * months) + exp.interest;
            const diff = billed - leaseInstallment;
            if (diff > 100) {
              const impact = share ? mulRate(diff, share.frac) : undefined;
              out.push(
                mkFinding({
                  check_id: RF09.id,
                  title: `${line.label} amortized faster than the lease allows (${y.year})`,
                  severity: "high",
                  year: y.year,
                  category: line.label,
                  tag: "life",
                  tenant_impact_usd: impact !== undefined ? toDollars(impact) : undefined,
                  narrative: `The statement amortizes ${line.label} over ${cap.useful_life_months} months; the lease prescribes ${lease.capital_life_years} years (${leaseMonths} months). At the lease life the ${y.year} installment is ${usd(leaseInstallment)}, not ${usd(billed)} — ${usd(diff)} too much` + (impact !== undefined ? ` (${usd(impact)} at Tenant's share).` : "."),
                  working: [{ label: "Statement life", value: `${cap.useful_life_months} months` }, { label: "Lease life", value: `${leaseMonths} months` }, { label: "Installment at lease life", value: usd(leaseInstallment) }, { label: "Billed", value: usd(billed) }, { label: "Excess", value: usd(diff) }],
                  refs: ["Finding the False Charges ch.4: amortization games"],
                }),
              );
            }
          }
          continue;
        }

        // Lump test: capital-sounding label, no amortization block, above the lease threshold.
        if (threshold !== null && looksCapital(line) && billed > threshold) {
          ran = true;
          let impact: number | undefined;
          let estimate = "";
          const working: Array<{ label: string; value: string }> = [
            { label: `${y.year} amount (billed as a lump)`, value: usd(billed) },
            { label: "Lease capital threshold", value: lease.capital_threshold !== undefined ? usd(threshold) : "none stated — lease requires amortization of capital items" },
          ];
          if (lease.capital_life_years) {
            const first = Math.round(billed / lease.capital_life_years);
            const excess = billed - first;
            impact = share ? mulRate(excess, share.frac) : undefined;
            working.push(
              { label: `Installment if amortized over ${lease.capital_life_years} years`, value: `${usd(billed)} ÷ ${lease.capital_life_years} = ${usd(first)}` },
              { label: "Excess if capital", value: usd(excess) },
            );
            if (impact !== undefined) working.push({ label: "Tenant share", value: `${pctStr(share!.frac, 4)} (${share!.source})` }, { label: "Tenant impact (if capital)", value: usd(impact) });
            estimate = ` If it is capital, only the first installment — ${usd(first)} at the lease's ${lease.capital_life_years}-year life — belongs in ${y.year}, and ${usd(excess)} was billed early` + (impact !== undefined ? ` (${usd(impact)} at Tenant's share).` : ".");
          }
          out.push(
            mkFinding({
              check_id: RF09.id,
              title: `${line.label}: ${usd(billed)} lump — should this have been amortized?`,
              severity: "review",
              year: y.year,
              category: line.label,
              tag: "lump",
              tenant_impact_usd: impact !== undefined ? toDollars(impact) : undefined,
              narrative: `${line.label} is billed as a single ${usd(billed)} expense in ${y.year}. The label describes work that is ordinarily a capital improvement, and the lease requires capital items to be amortized rather than expensed.${estimate} Tenant requests the invoices and the landlord's capitalization analysis for the item.`,
              working,
              refs: ["Finding the False Charges ch.4: capital expensed as repairs", "AI for Auditors Appendix B answer key: lump resurfacing → one installment"],
            }),
          );
        }
      }
    }
    if (!ran && threshold === null) return skip(RF09.id, RF09.title, "no amortized capital lines, and lease_lite states no capital threshold or life to test lumps against");
    return out;
  },
};
