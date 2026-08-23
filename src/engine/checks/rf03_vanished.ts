import type { Check, CheckContext, Finding } from "../types.ts";
import { matchLines } from "../normalize.ts";
import { lineAmountCents } from "../lines.ts";
import { mulRate, pctStr, toDollars, usd } from "../money.ts";
import { findingId, mkFinding, skip } from "../finding.ts";
import { bucketLabel, probableRenames } from "./migration_shared.ts";

export const RF03: Check = {
  id: "RF-03",
  title: "Category vanished",
  run(ctx: CheckContext) {
    if (ctx.years.length < 2) return skip(RF03.id, RF03.title, "needs two or more years");
    const out: Finding[] = [];

    for (let i = 1; i < ctx.years.length; i++) {
      const prev = ctx.years[i - 1]!;
      const curr = ctx.years[i]!;
      const share = ctx.share(prev.year);
      const m = matchLines(prev.lines, curr.lines);
      const renames = probableRenames(m);

      for (const line of m.vanished) {
        const amt = lineAmountCents(line);
        const rename = renames.find((r) => r.vanished === line);
        const related: string[] = [];
        const working = [
          { label: `${prev.year} amount`, value: usd(amt) },
          { label: `${curr.year} statement`, value: "no matching line" },
          { label: "Section / bucket", value: `${line.section} · ${bucketLabel(line.bucket)}` },
        ];
        if (rename) {
          related.push(findingId("RF-02", [prev.year, curr.year], rename.appeared.label));
          related.push(findingId("RF-04", [prev.year, curr.year], rename.appeared.label));
          working.push({
            label: "Similar-size line that appeared",
            value: `${rename.appeared.label} (${usd(lineAmountCents(rename.appeared))}, ${rename.appeared.section} · ${bucketLabel(rename.appeared.bucket)})`,
          });
        }
        const exposure = share ? mulRate(amt, share.frac) : null;
        if (share) working.push({ label: "Tenant share", value: `${pctStr(share.frac, 4)} (${share.source})` }, { label: "Tenant-level amount", value: usd(exposure!) });

        out.push(
          mkFinding({
            check_id: RF03.id,
            title: `${line.label} disappeared in ${curr.year}`,
            severity: "review",
            year: [prev.year, curr.year],
            category: line.label,
            tenant_exposure_usd: exposure !== null ? toDollars(exposure) : undefined,
            narrative:
              `${line.label} (${usd(amt)} in ${prev.year}) does not appear on the ${curr.year} statement. ` +
              (rename
                ? `A line of similar size, ${rename.appeared.label} (${usd(lineAmountCents(rename.appeared))}), appeared the same year in the ${bucketLabel(rename.appeared.bucket)} section; categories that vanish and reappear elsewhere are how costs move between pools. `
                : "") +
              `Tenant requests confirmation of whether the service ended, was re-labelled, or was reallocated to another line.`,
            working,
            refs: ["Red flags: categories that vanish and reappear elsewhere"],
            related,
          }),
        );
      }
    }
    return out;
  },
};
