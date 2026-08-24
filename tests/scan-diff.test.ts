/**
 * The designer's promise is that you can see what a lease term is worth. That
 * rests on `finding.id` staying stable when the lease changes underneath it —
 * every part of the id comes from the statement, not the lease — so a finding
 * that survives a redline keeps its identity and only the ones that genuinely
 * appeared or went away show up as new or resolved.
 */

import { describe, expect, it } from "vitest";
import { diffIsEmpty, diffScan } from "../src/ui/scan-diff.ts";
import { CLAUSE_DEFAULTS, CLAUSE_REMOVE, cloneLease } from "../src/lease/fields.ts";
import { scan } from "../src/engine/scan.ts";
import type { LeaseLite, ReconPackage } from "../src/engine/types.ts";
import { packageById } from "../src/data/index.ts";

const MWB = packageById("MW-B")!;

function withLease(pkg: ReconPackage, mutate: (l: LeaseLite) => void): ReconPackage {
  const lease = cloneLease(pkg.lease_lite);
  mutate(lease);
  return { ...pkg, lease_lite: lease };
}

describe("diffScan", () => {
  it("no change, no diff", () => {
    const d = diffScan(scan(MWB), scan(MWB));
    expect(diffIsEmpty(d)).toBe(true);
    expect(d.baselineImpact).toBe(d.currentImpact);
  });

  it("raising the cap from 5% to 12% resolves the cap-on-cap pattern and drops the impact", () => {
    const base = scan(MWB);
    const loose = scan(withLease(MWB, (l) => {
      l.cap!.pct = 12;
    }));
    const d = diffScan(base, loose);

    // "Billed grows exactly 5% a year" is a claim about *this* cap rate.
    expect(base.findings.some((f) => f.id === "RF-06:2023-2025:pattern:capped-pool")).toBe(true);
    expect(d.resolved.map((f) => f.id)).toContain("RF-06:2023-2025:pattern:capped-pool");
    expect(d.currentImpact).toBeLessThan(d.baselineImpact);
  });

  it("the per-year cap breaches survive a looser cap — they are the lesser-of rule, not the rate", () => {
    const loose = scan(withLease(MWB, (l) => {
      l.cap!.pct = 12;
    }));
    // The pool was billed above the actual cost it lists; no cap rate cures that.
    expect(loose.findings.some((f) => f.id === "RF-06:2025:controllable-cam-subject-cap")).toBe(true);
  });

  it("tightening the cap to 2% creates a breach that did not exist at 5%", () => {
    const d = diffScan(scan(MWB), scan(withLease(MWB, (l) => {
      l.cap!.pct = 2;
    })));
    expect(d.added.map((f) => f.id)).toContain("RF-06:2023:controllable-cam-subject-cap");
    expect(d.currentImpact).toBeGreaterThan(d.baselineImpact);
  });

  it("a fee permitted on a wider base resolves the fee findings outright", () => {
    const d = diffScan(scan(MWB), scan(withLease(MWB, (l) => {
      l.fees[0]!.base = "all_opex";
    })));
    expect(d.resolved.filter((f) => f.check_id === "RF-07")).toHaveLength(3);
    expect(d.currentImpact).toBeLessThan(d.baselineImpact);
  });

  it("findings the redline does not touch keep their identity", () => {
    const base = scan(MWB);
    const loose = scan(withLease(MWB, (l) => {
      l.cap!.pct = 12;
    }));
    const shared = base.findings.filter((f) => loose.findings.some((g) => g.id === f.id));
    expect(shared.length).toBeGreaterThan(0);
    // The fee findings have nothing to do with the cap rate: they survive intact.
    expect(shared.some((f) => f.check_id === "RF-07")).toBe(true);
  });

  it("striking the cap clause reports the checks that no longer run", () => {
    const d = diffScan(scan(MWB), scan(withLease(MWB, CLAUSE_REMOVE.cap)));
    expect(d.skipsGained.map((s) => s.check_id)).toContain("RF-06");
    expect(d.skipsGained[0]!.reason.length).toBeGreaterThan(0);
    expect(d.resolved.some((f) => f.check_id === "RF-06")).toBe(true);
    expect(d.checksGained).toEqual([]);
  });

  it("adding a clause makes a check testable again", () => {
    const noCap = withLease(MWB, CLAUSE_REMOVE.cap);
    const readded = withLease(noCap, (l) => CLAUSE_DEFAULTS.cap(l, { baseYear: 2022, baseAmount: 86_517.36 }));
    const d = diffScan(scan(noCap), scan(readded));
    expect(d.checksGained).toContain("RF-06");
    expect(d.added.some((f) => f.check_id === "RF-06")).toBe(true);
  });

  it("changing the fee rate reprices rather than replaces the fee findings", () => {
    const base = scan(MWB);
    const cheaper = scan(withLease(MWB, (l) => {
      l.fees[0]!.rate_pct = 4;
    }));
    const d = diffScan(base, cheaper);
    const repriced = d.changed.filter((c) => c.after.check_id === "RF-07");
    expect(repriced.length).toBe(3);
    for (const c of repriced) {
      expect(c.before.id).toBe(c.after.id);
      expect(c.after.tenant_impact_usd!).toBeLessThan(c.before.tenant_impact_usd!);
    }
    expect(d.resolved.some((f) => f.check_id === "RF-07")).toBe(false);
  });

  it("striking the fee leaves the fee findings standing, unpriced — no lease rate to price them against", () => {
    const d = diffScan(scan(MWB), scan(withLease(MWB, CLAUSE_REMOVE.fee)));
    const fees = d.changed.filter((c) => c.after.check_id === "RF-07");
    expect(fees.length).toBe(3);
    for (const c of fees) {
      expect(c.before.tenant_impact_usd).toBeGreaterThan(0);
      expect(c.after.tenant_impact_usd).toBeUndefined();
    }
    expect(d.currentImpact).toBeLessThan(d.baselineImpact);
  });

  it("pulling the fee inside the cap creates findings that did not exist outside it", () => {
    const d = diffScan(scan(MWB), scan(withLease(MWB, (l) => {
      l.cap!.fee_treatment = "inside_cap";
    })));
    expect(d.added.length).toBeGreaterThan(0);
    expect(d.added.some((f) => f.check_id === "RF-07")).toBe(true);
    expect(diffIsEmpty(d)).toBe(false);
    expect(d.currentImpact).toBeGreaterThan(d.baselineImpact);
  });

  it("a lease built from the drafting defaults is a lease the checks can read", () => {
    const noCap = withLease(MWB, CLAUSE_REMOVE.cap);
    const fresh = withLease(noCap, (l) => CLAUSE_DEFAULTS.cap(l));
    expect(() => scan(fresh)).not.toThrow();
    expect(scan(fresh).checks_run).toContain("RF-06");
  });

  it("reads the impact totals off the two scans it was given", () => {
    const base = scan(MWB);
    const other = scan(withLease(MWB, (l) => {
      l.cap!.pct = 12;
    }));
    const d = diffScan(base, other);
    expect(d.baselineImpact).toBe(base.totals.estimated_impact_usd);
    expect(d.currentImpact).toBe(other.totals.estimated_impact_usd);
  });
});
