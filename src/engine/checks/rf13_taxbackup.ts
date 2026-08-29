/**
 * RF-13 — the tax line against the collector's own account.
 *
 * Every other check in this engine reads the reconciliation statement. This one
 * cannot, because the fact it tests for is not on the statement: a refund the
 * county granted and the landlord kept leaves the tax line looking exactly like
 * an honest one — the sum of the bills as issued, which is true as far as it
 * goes. The only document that mentions the refund is the taxpayer account
 * statement behind the bill.
 *
 * So RF-13 reads `year.tax_backup` (schema 1.1): the levy as issued, gross, and
 * the credits the collector granted in the year. Netted the way an operating-
 * expense clause requires — taxes net of refunds, abatements and credits — that
 * is what the tax line should have been. Anything the statement bills above it
 * is an overcharge, and a documented credit is what makes it a `high` one.
 *
 * A package with no `tax_backup` gets a skip, not a pass. That distinction is
 * the whole point: an XLSX upload and a statement-only JSON both land there, and
 * the not-run footer says so rather than implying the taxes were tested.
 */

import type { Check, CheckContext, Finding, ReconYear } from "../types.ts";
import { lineKind } from "../lines.ts";
import { mulRate, pctStr, toCents, toDollars, usd } from "../money.ts";
import { mkFinding, skip } from "../finding.ts";

interface Netting {
  levy: number; // cents, as issued
  credits: number; // cents granted against it
  net: number; // cents the tax line should not exceed
  creditCount: number;
  parcelCount: number;
  /** The single credit, when there is exactly one — it is worth naming in the narrative. */
  only?: NonNullable<NonNullable<ReconYear["tax_backup"]>["parcels"][number]["credits"]>[number];
}

/** The collector's account for one year, in cents. */
export function netBackup(backup: NonNullable<ReconYear["tax_backup"]>): Netting {
  let levy = 0;
  let credits = 0;
  let creditCount = 0;
  let only: Netting["only"];
  for (const p of backup.parcels) {
    levy += toCents(p.billed);
    for (const c of p.credits ?? []) {
      credits += toCents(c.amount);
      creditCount += 1;
      only = c;
    }
  }
  return { levy, credits, net: levy - credits, creditCount, parcelCount: backup.parcels.length, ...(creditCount === 1 ? { only } : {}) };
}

export const RF13: Check = {
  id: "RF-13",
  title: "Tax backup vs. statement",
  run(ctx: CheckContext) {
    const out: Finding[] = [];
    if (!ctx.years.some((y) => y.tax_backup)) {
      return skip(
        RF13.id,
        RF13.title,
        "no tax backup in the package — a reconciliation statement does not carry the fact that a refund exists, so this check needs the collector's account the ReconPackage JSON can hold",
      );
    }

    for (const y of ctx.years) {
      const backup = y.tax_backup;
      if (!backup) continue;
      const taxLines = y.lines.filter((l) => lineKind(l) === "tax");
      if (taxLines.length === 0) continue; // nothing billed for taxes this year to test

      const n = netBackup(backup);
      const stmt = taxLines.reduce((s, l) => s + toCents(l.amount), 0);
      const over = stmt - n.net;
      if (over <= 0) continue; // the statement is at or below what the backup supports

      const largest = taxLines.reduce((a, b) => (toCents(b.amount) > toCents(a.amount) ? b : a));
      const share = ctx.share(y.year);
      const impact = share ? mulRate(over, share.frac) : undefined;
      const documented = n.creditCount > 0;

      const creditLabel = documented
        ? n.only
          ? `Credits granted (${n.only.reference ?? "credit"}${n.only.appeal_year ? `, ${n.only.appeal_year} assessment` : ""}${n.only.granted ? `, granted ${n.only.granted}` : ""})`
          : `Credits granted (${n.creditCount})`
        : "Credits granted";

      const working: Array<{ label: string; value: string }> = [
        { label: `${y.year} levy as issued (${n.parcelCount} parcel${n.parcelCount === 1 ? "" : "s"})`, value: usd(n.levy) },
        { label: creditLabel, value: documented ? "-" + usd(n.credits) : "none shown" },
        { label: "Tax backup, netted", value: usd(n.net) },
        { label: `${y.year} statement, tax lines`, value: usd(stmt) + (taxLines.length > 1 ? ` (${taxLines.length} lines)` : "") },
        { label: "Billed above the backup", value: usd(over) },
      ];
      if (impact !== undefined) {
        working.push({ label: "Tenant share", value: `${pctStr(share!.frac, 4)} (${share!.source})` }, { label: "Tenant impact", value: usd(impact) });
      }

      const narrative = documented
        ? `The taxpayer account shows ${usd(n.credits)} credited to the property in ${y.year}${n.only?.appeal_year ? ` on appeal of the ${n.only.appeal_year} assessment` : ""}${n.only?.reference ? ` (${n.only.reference})` : ""}, against a levy of ${usd(n.levy)}. Netted as the lease requires, the ${y.year} taxes are ${usd(n.net)}; the statement bills ${usd(stmt)} — the levy as issued, with the refund never passed through — ${usd(over)} too much` +
          (impact !== undefined ? ` (${usd(impact)} at Tenant's share).` : ".") +
          ` Tenant requests the collector's account statement for the year and a credit for its share of the refund.`
        : `The ${y.year} statement bills ${usd(stmt)} of real estate taxes; the tax backup supports ${usd(n.net)} — ${usd(over)} more than the parcels' own bills` +
          (impact !== undefined ? ` (${usd(impact)} at Tenant's share).` : ".") +
          ` Tenant requests the tax bills and the taxpayer account statement reconciling the difference.`;

      out.push(
        mkFinding({
          check_id: RF13.id,
          title: documented
            ? `Tax refund credited to the property but not to the tenant (${y.year})`
            : `${y.year} tax line exceeds the tax backup`,
          severity: documented ? "high" : "review",
          year: y.year,
          category: largest.label,
          tenant_impact_usd: impact !== undefined ? toDollars(impact) : undefined,
          narrative,
          working,
          refs: [
            "Finding the False Charges: taxes are net of refunds, abatements and credits",
            "Audit Core: tax backup — read the collector's account, not the tax line",
          ],
        }),
      );
    }

    return out;
  },
};
