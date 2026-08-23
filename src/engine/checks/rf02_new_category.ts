import type { Check, CheckContext, Finding, Severity } from "../types.ts";
import { matchLines } from "../normalize.ts";
import { lineAmountCents, lineKind } from "../lines.ts";
import { mulRate, pctStr, toDollars, usd } from "../money.ts";
import { findingId, mkFinding, skip } from "../finding.ts";
import { probableRenames } from "./migration_shared.ts";

export const RF02: Check = {
  id: "RF-02",
  title: "New category appeared",
  run(ctx: CheckContext) {
    if (ctx.years.length < 2) return skip(RF02.id, RF02.title, "needs two or more years");
    const out: Finding[] = [];
    const cap = ctx.pkg.lease_lite.cap;

    for (let i = 1; i < ctx.years.length; i++) {
      const prev = ctx.years[i - 1]!;
      const curr = ctx.years[i]!;
      const share = ctx.share(curr.year);
      const m = matchLines(prev.lines, curr.lines);
      const renames = probableRenames(m);

      for (const line of m.appeared) {
        const amt = lineAmountCents(line);
        const kind = lineKind(line);
        const outsideCappedPool = !!cap && cap.applies_to === "controllable" && line.bucket === "non_controllable";
        let severity: Severity = "review";
        const reasons: string[] = [];
        if (kind === "fee") {
          severity = "high";
          reasons.push("A new fee line is a change in the landlord's charging basis; it needs a lease citation, and if a management or administrative fee already exists it collides with the one-service-one-fee principle (see RF-07).");
        }
        if (outsideCappedPool) {
          severity = "high";
          reasons.push("It was placed in the non-controllable section, outside the capped pool, where it is billed dollar for dollar — Tenant requests the lease authority for both the charge and its classification.");
        }
        const rename = renames.find((r) => r.appeared === line);
        const related: string[] = [];
        if (rename) {
          related.push(findingId("RF-03", [prev.year, curr.year], rename.vanished.label));
          related.push(findingId("RF-04", [prev.year, curr.year], line.label));
        }
        const exposure = share ? mulRate(amt, share.frac) : null;
        const working = [
          { label: `${curr.year} amount`, value: usd(amt) },
          { label: `${prev.year} statement`, value: "no matching line" },
          { label: "Section / bucket", value: `${line.section}${line.bucket ? " · " + line.bucket.replace("_", "-") : ""}` },
        ];
        if (rename) working.push({ label: "Similar-size line that vanished", value: `${rename.vanished.label} (${usd(lineAmountCents(rename.vanished))} in ${prev.year})` });
        if (share) working.push({ label: "Tenant share", value: `${pctStr(share.frac, 4)} (${share.source})` }, { label: "Tenant-level amount", value: usd(exposure!) });

        out.push(
          mkFinding({
            check_id: RF02.id,
            title: `New line in ${curr.year}: ${line.label}`,
            severity,
            year: [prev.year, curr.year],
            category: line.label,
            tenant_exposure_usd: exposure !== null ? toDollars(exposure) : undefined,
            narrative:
              `${line.label} appears for the first time on the ${curr.year} statement at ${usd(amt)}; there is no corresponding line in ${prev.year}. ` +
              (rename
                ? `A line of similar size, ${rename.vanished.label}, disappeared the same year — the two should be read together. `
                : "") +
              (reasons.length ? reasons.join(" ") : "Tenant requests the lease provision that makes this cost recoverable and the invoices behind it."),
            working,
            refs: ["Red flags: new line items", ...(outsideCappedPool ? ["Cap traps: moving controllable to non-controllable"] : [])],
            related,
          }),
        );
      }
    }
    return out;
  },
};
