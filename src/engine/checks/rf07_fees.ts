import type { Check, CheckContext, Finding, LeaseLite, ReconLine, ReconYear } from "../types.ts";
import { FEE_BASE_LABEL, feeBaseLines, feeLines, sumAmount } from "../lines.ts";
import { normalizeLabel } from "../normalize.ts";
import { mulRate, pctStr, toDollars, usd } from "../money.ts";
import { findingId, mkFinding, skip } from "../finding.ts";

type FeeSpec = LeaseLite["fees"][number];

function feeKindOf(line: ReconLine): "management" | "administrative" | "other" {
  const l = normalizeLabel(line.label);
  if (/\bmanagement\b|\bmgmt\b/.test(l)) return "management";
  if (/\badministrative\b|\badmin\b|\bsupervisory\b|\boverhead\b/.test(l)) return "administrative";
  return "other";
}

/** Try every base the engine knows and report which one reproduces the billed fee (within $1). */
function diagnoseBase(year: ReconYear, line: ReconLine, spec: FeeSpec): string | null {
  const billed = sumAmount([line]);
  const bases: FeeSpec["base"][] = ["cam_only", "cam_plus_insurance", "all_opex"];
  for (const b of bases) {
    const lines = feeBaseLines(year.lines, b);
    if (!lines) continue;
    const base = sumAmount(lines);
    const exp = mulRate(base, spec.rate_pct / 100);
    if (Math.abs(exp - billed) <= 100) return `${spec.rate_pct}% of ${FEE_BASE_LABEL[b]} (${usd(base)})`;
    // fee-on-fee: rate × (base + all fee lines)
    const withFees = base + sumAmount(feeLines(year));
    const expFoF = mulRate(withFees, spec.rate_pct / 100);
    if (Math.abs(expFoF - billed) <= 100) return `${spec.rate_pct}% of ${FEE_BASE_LABEL[b]} plus the fee lines themselves (${usd(withFees)}) — a fee on the fee`;
  }
  return null;
}

export const RF07: Check = {
  id: "RF-07",
  title: "Fee tests (one service, one fee)",
  run(ctx: CheckContext) {
    const out: Finding[] = [];
    const lease = ctx.pkg.lease_lite;
    const cap = lease.cap;
    let anyFeeLine = false;

    for (const y of ctx.years) {
      const fees = feeLines(y);
      if (fees.length === 0) continue;
      anyFeeLine = true;
      const share = ctx.share(y.year);

      // (a) base test — one per fee line that maps to a lease fee term.
      for (const line of fees) {
        const kind = feeKindOf(line);
        const spec = lease.fees.find((f) => f.kind === kind) ?? (lease.fees.length === 1 ? lease.fees[0] : undefined);
        if (!spec) {
          out.push(
            mkFinding({
              check_id: RF07.id,
              title: `${line.label}: no lease fee term to test against`,
              severity: "review",
              year: y.year,
              category: line.label,
              tag: "a",
              narrative: `The ${y.year} statement bills ${line.label} at ${usd(sumAmount([line]))}, but the lease abstract records no ${kind === "other" ? "" : kind + " "}fee provision. Tenant requests the lease section authorizing the fee, its rate and its base.`,
              working: [{ label: `${y.year} billed`, value: usd(sumAmount([line])) }, { label: "Lease fee terms abstracted", value: lease.fees.length ? lease.fees.map((f) => `${f.kind} ${f.rate_pct}% on ${FEE_BASE_LABEL[f.base]}`).join("; ") : "none" }],
              refs: ["Audit Tips on Management Fees: authority, rate, base"],
            }),
          );
          continue;
        }
        const baseLines = feeBaseLines(y.lines, spec.base);
        if (!baseLines) {
          // receipts base: not computable from a statement
          continue;
        }
        const base = sumAmount(baseLines);
        const expected = mulRate(base, spec.rate_pct / 100);
        const billed = sumAmount([line]);
        const diff = billed - expected;
        if (diff <= 100) continue;
        const impact = share ? mulRate(diff, share.frac) : undefined;
        const diag = diagnoseBase(y, line, spec);
        const working: Array<{ label: string; value: string }> = [
          { label: "Lease fee term", value: `${spec.kind} fee, ${spec.rate_pct}% of ${FEE_BASE_LABEL[spec.base]}` },
          { label: `${y.year} permitted base`, value: `${usd(base)} (${baseLines.length} lines)` },
          { label: "Fee at lease rate", value: `${usd(base)} × ${spec.rate_pct}% = ${usd(expected)}` },
          { label: "Fee billed", value: usd(billed) },
          { label: "Excess", value: usd(diff) },
        ];
        if (diag) working.push({ label: "Billed fee reproduces as", value: diag });
        if (share && impact !== undefined) working.push({ label: "Tenant share", value: `${pctStr(share.frac, 4)} (${share.source})` }, { label: "Tenant impact", value: usd(impact) });
        out.push(
          mkFinding({
            check_id: RF07.id,
            title: `${line.label} exceeds the lease rate in ${y.year}`,
            severity: "high",
            year: y.year,
            category: line.label,
            tag: "a",
            tenant_impact_usd: impact !== undefined ? toDollars(impact) : undefined,
            narrative:
              `The lease permits a ${spec.rate_pct}% ${spec.kind} fee on ${FEE_BASE_LABEL[spec.base]}; on the ${y.year} statement that base totals ${usd(base)} and the fee should be ${usd(expected)}. The statement bills ${usd(billed)}, ${usd(diff)} more than the lease allows` +
              (impact !== undefined ? ` (${usd(impact)} at Tenant's share).` : ".") +
              (diag ? ` The billed figure reproduces as ${diag}.` : "") +
              ` Tenant requests the fee be recomputed on the permitted base.`,
            working,
            refs: ["Audit Tips on Management Fees: one service, one fee; fee on the permitted base only", "Finding the False Charges ch.8: fees on fees"],
          }),
        );
      }

      // (b) duplication test — management + administrative (and/or on-site payroll) together.
      const hasMgmt = fees.some((l) => feeKindOf(l) === "management");
      const hasAdmin = fees.some((l) => feeKindOf(l) === "administrative");
      const payroll = y.lines.filter((l) => /\b(on site|onsite|site) (payroll|staff|personnel|salar)|\bproperty manager\b|\bmanagement payroll\b/.test(normalizeLabel(l.label)));
      if ((hasMgmt && hasAdmin) || (payroll.length > 0 && (hasMgmt || hasAdmin))) {
        const labels = [...fees.map((l) => l.label), ...payroll.map((l) => l.label)];
        const total = sumAmount([...fees, ...payroll]);
        const exposure = share ? mulRate(total, share.frac) : null;
        out.push(
          mkFinding({
            check_id: RF07.id,
            title: `Stacked fees in ${y.year}: ${labels.join(" + ")}`,
            severity: "review",
            year: y.year,
            category: labels.join(" + "),
            tag: "b",
            tenant_exposure_usd: exposure !== null ? toDollars(exposure) : undefined,
            narrative:
              `The ${y.year} statement carries ${labels.join(", ")} side by side (${usd(total)} together). Management, administration and on-site supervision are one service; the lease provides for ${lease.fees.length === 0 ? "no fee" : lease.fees.length === 1 ? "a single fee" : `${lease.fees.length} fees`}` +
              `. Tenant requests substantiation that each line compensates a distinct service and the lease section authorizing each.`,
            working: [
              ...[...fees, ...payroll].map((l) => ({ label: l.label, value: usd(sumAmount([l])) })),
              { label: "Lease fee terms abstracted", value: lease.fees.length ? lease.fees.map((f) => `${f.kind} ${f.rate_pct}% on ${FEE_BASE_LABEL[f.base]}`).join("; ") : "none" },
            ],
            refs: ["Audit Tips on Management Fees: one service, one fee"],
          }),
        );
      }

      // (c) cap placement — lease says fee inside the cap, statement keeps it outside the capped pool.
      if (cap && cap.fee_treatment === "inside_cap" && cap.applies_to === "controllable") {
        for (const line of fees) {
          if (line.bucket === "controllable") continue;
          const llPool = y.cap_summary;
          const outside = llPool ? Math.abs(sumAmount(y.lines.filter((l) => l.bucket === "controllable")) - Math.round(llPool.pool_actual * 100)) <= 100 : true;
          if (!outside) continue;
          out.push(
            mkFinding({
              check_id: RF07.id,
              title: `${line.label} billed outside the capped pool in ${y.year}`,
              severity: "high",
              year: y.year,
              category: line.label,
              tag: "c",
              narrative:
                `The lease places the ${feeKindOf(line) === "other" ? "" : feeKindOf(line) + " "}fee inside the capped pool; the ${y.year} statement presents ${line.label} (${usd(sumAmount([line]))}) outside it, in the ${line.bucket ? line.bucket.replace("_", "-") : "unclassified"} section, so it is billed dollar for dollar instead of counting against the ceiling. The dollar consequence is priced in the cap compliance finding (RF-06).`,
              working: [
                { label: `${y.year} fee billed`, value: usd(sumAmount([line])) },
                { label: "Statement placement", value: `${line.section} · ${line.bucket ?? "unclassified"}` },
                { label: "Lease placement", value: "inside the capped pool" },
              ],
              refs: ["Cap traps: fee treatment inside/outside the cap"],
              related: [findingId("RF-06", y.year, y.cap_summary?.pool_label ?? "Capped pool")],
            }),
          );
        }
      }
    }

    if (!anyFeeLine) {
      if (lease.fees.length === 0) return skip(RF07.id, RF07.title, "no fee lines on the statements and no fee terms in lease_lite");
      return skip(RF07.id, RF07.title, "no fee lines on the statements");
    }
    if (lease.fees.length > 0 && lease.fees.every((f) => f.base === "receipts") && out.length === 0) {
      return skip(RF07.id, RF07.title, "fee base is gross receipts / rents, which a reconciliation statement does not show");
    }
    return out;
  },
};
