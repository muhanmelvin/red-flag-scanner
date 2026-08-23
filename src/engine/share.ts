/**
 * Tenant share per year. Impact is always reported at the tenant level, so
 * every check needs a share; this is the one place that decides which one.
 *
 * Precedence: the share the landlord actually billed (tenant pays that) →
 * recomputed from the landlord's denominator → the lease's stated share.
 */

import type { ReconPackage, ShareSource } from "./types.ts";

export function shareFor(
  pkg: ReconPackage,
  year: number,
): { frac: number; source: ShareSource } | null {
  const y = pkg.years.find((x) => x.year === year);
  const billed = y?.tenant_summary?.pro_rata_share_pct;
  if (billed !== undefined && billed > 0) return { frac: billed / 100, source: "billed" };
  const den = y?.denominator_sf;
  if (den !== undefined && den > 0) {
    return { frac: pkg.lease_lite.share.numerator_sf / den, source: "computed" };
  }
  const stated = pkg.lease_lite.share.stated_pct;
  if (stated !== undefined && stated > 0) return { frac: stated / 100, source: "stated" };
  return null;
}

/** Lease-correct share: stated if the lease states one, else numerator / landlord denominator. */
export function leaseShareFor(pkg: ReconPackage, year: number): number | null {
  const stated = pkg.lease_lite.share.stated_pct;
  if (stated !== undefined && stated > 0) return stated / 100;
  const y = pkg.years.find((x) => x.year === year);
  if (y?.denominator_sf) return pkg.lease_lite.share.numerator_sf / y.denominator_sf;
  return null;
}
