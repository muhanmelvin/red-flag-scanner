/** Micro-fixtures for the per-check unit tests. Hand-computable on purpose. */

import type { LeaseLite, ReconLine, ReconPackage, ReconYear } from "../src/engine/types.ts";

export const LEASE_NO_CAP: LeaseLite = {
  share: { numerator_sf: 10_000, denominator_basis: "GLA" },
  fees: [],
};

export const LEASE_CAP: LeaseLite = {
  share: { numerator_sf: 10_000, denominator_basis: "GLA" },
  cap: {
    applies_to: "controllable",
    pct: 5,
    method: "non_cumulative",
    basis: "amount_paid",
    base_year: 2022,
    base_year_amount: 100_000,
    fee_treatment: "outside_cap",
  },
  fees: [{ kind: "management", rate_pct: 3, base: "cam_only" }],
};

export function L(label: string, amount: number, o: Partial<ReconLine> = {}): ReconLine {
  return { label, section: "CAM", bucket: "controllable", amount, ...o };
}

export function Y(year: number, lines: ReconLine[], o: Partial<ReconYear> = {}): ReconYear {
  // 10,000 / 100,000 = 10% share unless overridden.
  return { year, denominator_sf: 100_000, lines, tenant_summary: { pro_rata_share_pct: 10 }, ...o };
}

export function P(years: ReconYear[], lease: LeaseLite = LEASE_NO_CAP, id = "T"): ReconPackage {
  return {
    meta: { package_id: id, property_name: "Test Center", tenant_name: "Test Tenant", premises_sf: 10_000, currency: "USD", schema_version: "1.0" },
    lease_lite: lease,
    years,
  };
}
