/**
 * scan(pkg, config) — the engine's single entry point. Pure: no I/O, no DOM,
 * no clock. Same input → deep-equal output.
 */

import type { CheckContext, Finding, ReconPackage, ScanConfig, ScanResult, SkipRecord } from "./types.ts";
import { DEFAULT_CONFIG } from "./types.ts";
import { CHECKS } from "./registry.ts";
import { shareFor } from "./share.ts";
import { toCents } from "./money.ts";

const SEVERITY_RANK = { high: 0, review: 1, info: 2 } as const;

export function scan(pkg: ReconPackage, config: Partial<ScanConfig> = {}): ScanResult {
  const cfg: ScanConfig = { ...DEFAULT_CONFIG, ...config };
  validateShape(pkg);
  const years = [...pkg.years].sort((a, b) => a.year - b.year);
  const ctx: CheckContext = {
    pkg,
    config: cfg,
    years,
    share: (year) => shareFor(pkg, year),
  };

  const findings: Finding[] = [];
  const skipped: SkipRecord[] = [];
  const checks_run: string[] = [];

  for (const check of CHECKS) {
    let outcome;
    try {
      outcome = check.run(ctx);
    } catch (err) {
      // A check must never take the scan down. Surface the failure as a skip.
      skipped.push({ check_id: check.id, title: check.title, skipped: true, reason: `check failed: ${(err as Error).message}` });
      continue;
    }
    if (Array.isArray(outcome)) {
      checks_run.push(check.id);
      findings.push(...outcome);
    } else {
      skipped.push(outcome);
    }
  }

  // Materiality: quantified findings below the tenant-level threshold drop to "info".
  const matCents = toCents(cfg.materiality_usd);
  for (const f of findings) {
    if (f.tenant_impact_usd !== undefined && toCents(f.tenant_impact_usd) < matCents && f.severity !== "info") {
      f.severity = "info";
      f.suppressed_by_materiality = true;
    }
  }

  findings.sort((a, b) => {
    const s = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (s !== 0) return s;
    const ia = a.tenant_impact_usd ?? -1;
    const ib = b.tenant_impact_usd ?? -1;
    if (ib !== ia) return ib - ia;
    const ea = a.tenant_exposure_usd ?? -1;
    const eb = b.tenant_exposure_usd ?? -1;
    if (eb !== ea) return eb - ea;
    if (a.check_id !== b.check_id) return a.check_id < b.check_id ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const share_by_year: ScanResult["share_by_year"] = {};
  for (const y of years) {
    const s = shareFor(pkg, y.year);
    if (s) share_by_year[y.year] = { pct: s.frac * 100, source: s.source };
  }

  let impact = 0;
  for (const f of findings) if (f.tenant_impact_usd !== undefined) impact += toCents(f.tenant_impact_usd);

  return {
    package_id: pkg.meta.package_id,
    findings,
    skipped,
    checks_run,
    share_by_year,
    totals: {
      high: findings.filter((f) => f.severity === "high").length,
      review: findings.filter((f) => f.severity === "review").length,
      info: findings.filter((f) => f.severity === "info").length,
      estimated_impact_usd: impact / 100,
    },
    config: cfg,
  };
}

/** Cheap structural guard so a malformed upload fails with a message, not a stack trace. */
function validateShape(pkg: ReconPackage): void {
  if (!pkg || typeof pkg !== "object") throw new Error("package is not an object");
  if (!pkg.meta || typeof pkg.meta.package_id !== "string") throw new Error("meta.package_id missing");
  if (!pkg.lease_lite || !pkg.lease_lite.share || typeof pkg.lease_lite.share.numerator_sf !== "number") throw new Error("lease_lite.share.numerator_sf missing");
  if (!Array.isArray(pkg.lease_lite.fees)) throw new Error("lease_lite.fees must be an array (empty if none)");
  if (!Array.isArray(pkg.years) || pkg.years.length === 0) throw new Error("years must be a non-empty array");
  for (const y of pkg.years) {
    if (typeof y.year !== "number") throw new Error("each year needs a numeric `year`");
    if (!Array.isArray(y.lines)) throw new Error(`year ${y.year}: lines must be an array`);
    for (const l of y.lines) {
      if (typeof l.label !== "string" || typeof l.amount !== "number" || !Number.isFinite(l.amount)) throw new Error(`year ${y.year}: each line needs a string label and a numeric amount`);
    }
  }
  const seen = new Set<number>();
  for (const y of pkg.years) {
    if (seen.has(y.year)) throw new Error(`duplicate year ${y.year}`);
    seen.add(y.year);
  }
}
