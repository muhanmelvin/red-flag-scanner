/**
 * Two scans of the same statement under two leases, compared.
 *
 * The key is `finding.id` — `check_id:year[:tag]:slug(category)`, every part of
 * it derived from the statement rather than the lease. Rewrite a lease term and
 * a finding keeps its identity if it survives, so "resolved", "new" and
 * "changed" mean what they say.
 *
 * Pure and DOM-free.
 */

import type { Finding, ScanResult, SkipRecord } from "../engine/types.ts";

export interface FindingChange {
  before: Finding;
  after: Finding;
}

export interface ScanDiff {
  /** In the current scan, not in the baseline. */
  added: Finding[];
  /** In the baseline, gone from the current scan. */
  resolved: Finding[];
  /** Same finding, different severity or different money. */
  changed: FindingChange[];
  baselineImpact: number;
  currentImpact: number;
  /** Checks that ran against the signed lease and no longer run — a clause was struck. */
  skipsGained: SkipRecord[];
  /** Checks that could not run against the signed lease and now can — a clause was added. */
  checksGained: string[];
}

function moneyOf(f: Finding): string {
  return `${f.severity}|${f.tenant_impact_usd ?? ""}|${f.tenant_exposure_usd ?? ""}`;
}

export function diffScan(baseline: ScanResult, current: ScanResult): ScanDiff {
  const before = new Map(baseline.findings.map((f) => [f.id, f]));
  const after = new Map(current.findings.map((f) => [f.id, f]));

  const added = current.findings.filter((f) => !before.has(f.id));
  const resolved = baseline.findings.filter((f) => !after.has(f.id));
  const changed: FindingChange[] = [];
  for (const f of baseline.findings) {
    const now = after.get(f.id);
    if (now && moneyOf(now) !== moneyOf(f)) changed.push({ before: f, after: now });
  }

  const ranBefore = new Set(baseline.checks_run);
  const runsNow = new Set(current.checks_run);
  const skipsGained = current.skipped.filter((s) => ranBefore.has(s.check_id));
  const checksGained = current.checks_run.filter((id) => !ranBefore.has(id));

  return {
    added,
    resolved,
    changed,
    baselineImpact: baseline.totals.estimated_impact_usd,
    currentImpact: current.totals.estimated_impact_usd,
    skipsGained,
    checksGained,
  };
}

/** Nothing moved: the redlined lease produces the same report as the signed one. */
export function diffIsEmpty(d: ScanDiff): boolean {
  return d.added.length === 0 && d.resolved.length === 0 && d.changed.length === 0 && d.skipsGained.length === 0 && d.checksGained.length === 0;
}
