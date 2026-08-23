import type { Check, CheckContext, Finding } from "../types.ts";
import { isCapPoolLine, lineKind, sumAmount } from "../lines.ts";
import { mulRate, pctStr, toCents, toDollars, usd } from "../money.ts";
import { mkFinding, skip } from "../finding.ts";

export const RF11: Check = {
  id: "RF-11",
  title: "Arithmetic tie-out",
  run(ctx: CheckContext) {
    const out: Finding[] = [];
    let ran = false;
    const lease = ctx.pkg.lease_lite;

    for (const y of ctx.years) {
      const ts = y.tenant_summary;
      const share = ctx.share(y.year);

      // Landlord's stated capped-pool actual vs the lines it lists.
      if (y.cap_summary && lease.cap) {
        ran = true;
        const stated = toCents(y.cap_summary.pool_actual);
        const poolLines = y.lines.filter((l) => isCapPoolLine(l, lease));
        const withFee = sumAmount(poolLines);
        const withoutFee = sumAmount(poolLines.filter((l) => lineKind(l) !== "fee"));
        const ok = Math.abs(stated - withFee) <= 100 || Math.abs(stated - withoutFee) <= 100;
        if (!ok) {
          const diff = stated - withFee;
          out.push(
            mkFinding({
              check_id: RF11.id,
              title: `Stated capped-pool actual does not reproduce from its lines (${y.year})`,
              severity: "high",
              year: y.year,
              category: y.cap_summary.pool_label ?? "Capped pool",
              tag: "pool",
              tenant_impact_usd: share && diff > 0 ? toDollars(mulRate(diff, share.frac)) : undefined,
              narrative: `The ${y.year} statement states controllable costs of ${usd(stated)}; the controllable lines it lists total ${usd(withFee)}${withFee !== withoutFee ? ` (${usd(withoutFee)} without the fee)` : ""}. A subtotal that does not add is the easiest finding to defend; Tenant requests the landlord's workpaper.`,
              working: [
                { label: "Stated pool actual", value: usd(stated) },
                { label: "Sum of capped lines", value: usd(withFee) },
                ...(withFee !== withoutFee ? [{ label: "Sum without fee", value: usd(withoutFee) }] : []),
                { label: "Difference", value: usd(diff) },
              ],
              refs: ["Desktop audit workflow: verify, don't assume"],
            }),
          );
        }
      }

      if (!ts) continue;

      // Per-line tenant amounts vs pool × billed share, and their sum vs the tenant total.
      const linesWithTenant = y.lines.filter((l) => l.tenant_amount !== undefined);
      if (linesWithTenant.length > 0 && share) {
        ran = true;
        const bad: Array<{ label: string; value: string }> = [];
        let badTotal = 0;
        for (const l of linesWithTenant) {
          const exp = mulRate(toCents(l.amount), share.frac);
          const got = toCents(l.tenant_amount!);
          if (Math.abs(got - exp) > 100) {
            bad.push({ label: l.label, value: `${usd(toCents(l.amount))} × ${pctStr(share.frac, 4)} = ${usd(exp)}, billed ${usd(got)} (${usd(got - exp)})` });
            badTotal += got - exp;
          }
        }
        if (bad.length) {
          out.push(
            mkFinding({
              check_id: RF11.id,
              title: `${bad.length} line${bad.length > 1 ? "s" : ""} do not reproduce from pool × share (${y.year})`,
              severity: "high",
              year: y.year,
              category: "Tenant allocation",
              tag: "lines",
              tenant_impact_usd: badTotal > 0 ? toDollars(badTotal) : undefined,
              narrative: `On the ${y.year} statement, ${bad.length} tenant-level amount${bad.length > 1 ? "s" : ""} cannot be reproduced as pool amount × Tenant's ${pctStr(share.frac, 4)} share; the net difference is ${usd(badTotal)}. Tenant requests the allocation workpaper.`,
              working: bad,
              refs: ["Desktop audit workflow: verify, don't assume"],
            }),
          );
        }
        if (ts.tenant_total !== undefined) {
          const sum = linesWithTenant.reduce((s, l) => s + toCents(l.tenant_amount!), 0);
          const diff = toCents(ts.tenant_total) - sum;
          if (linesWithTenant.length === y.lines.length && Math.abs(diff) > 100) {
            out.push(
              mkFinding({
                check_id: RF11.id,
                title: `Tenant total does not equal the sum of tenant lines (${y.year})`,
                severity: "high",
                year: y.year,
                category: "Tenant total",
                tag: "sum",
                tenant_impact_usd: diff > 0 ? toDollars(diff) : undefined,
                narrative: `The ${y.year} tenant-level lines sum to ${usd(sum)}; the statement's tenant total is ${usd(toCents(ts.tenant_total))}, ${usd(Math.abs(diff))} ${diff > 0 ? "more" : "less"}.`,
                working: [{ label: "Sum of tenant lines", value: usd(sum) }, { label: "Stated tenant total", value: usd(toCents(ts.tenant_total)) }, { label: "Difference", value: usd(diff) }],
                refs: ["Desktop audit workflow: verify, don't assume"],
              }),
            );
          }
        }
      }

      // balance_due = tenant_total − estimates_paid
      if (ts.tenant_total !== undefined && ts.estimates_paid !== undefined && ts.balance_due !== undefined) {
        ran = true;
        const expected = toCents(ts.tenant_total) - toCents(ts.estimates_paid);
        const stated = toCents(ts.balance_due);
        const diff = stated - expected;
        if (Math.abs(diff) > 100) {
          out.push(
            mkFinding({
              check_id: RF11.id,
              title: `Balance due is mis-added by ${usd(Math.abs(diff))} (${y.year})`,
              severity: "high",
              year: y.year,
              category: "Balance due",
              tag: "balance",
              tenant_impact_usd: diff > 0 ? toDollars(diff) : undefined,
              narrative: `The ${y.year} statement shows a tenant total of ${usd(toCents(ts.tenant_total))} and estimates paid of ${usd(toCents(ts.estimates_paid))}, which leaves ${usd(expected)}; the balance due shown is ${usd(stated)}, ${usd(Math.abs(diff))} ${diff > 0 ? "too high" : "too low"}. Arithmetic errors are the easiest finding to defend and the first to fix.`,
              working: [
                { label: "Tenant total", value: usd(toCents(ts.tenant_total)) },
                { label: "Estimates paid", value: usd(toCents(ts.estimates_paid)) },
                { label: "Recomputed balance", value: `${usd(toCents(ts.tenant_total))} − ${usd(toCents(ts.estimates_paid))} = ${usd(expected)}` },
                { label: "Balance due shown", value: usd(stated) },
                { label: "Difference", value: usd(diff) },
              ],
              refs: ["Desktop audit workflow: verify, don't assume"],
            }),
          );
        }
      }
    }
    if (!ran) return skip(RF11.id, RF11.title, "statements carry no subtotals, tenant amounts or balance to recompute");
    return out;
  },
};
