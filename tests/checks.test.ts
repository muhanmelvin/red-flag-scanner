/**
 * Per-check unit tests on hand-computed micro-fixtures, including the
 * boundary cases: exactly at threshold, one cent over, missing optional
 * fields, single-year packages.
 */

import { describe, expect, it } from "vitest";
import { scan } from "../src/engine/scan.ts";
import type { Finding, LeaseLite, ScanResult } from "../src/engine/types.ts";
import { L, LEASE_CAP, LEASE_NO_CAP, P, Y } from "./fixtures.ts";
import { expectedAmortization, monthsInService } from "../src/engine/checks/rf09_capital.ts";
import { isRoundAmount } from "../src/engine/checks/rf05_round.ts";

const of = (r: ScanResult, id: string): Finding[] => r.findings.filter((f) => f.check_id === id);
const skipped = (r: ScanResult, id: string) => r.skipped.find((s) => s.check_id === id);

describe("RF-01 year-over-year variance", () => {
  it("flags exactly at the threshold when material", () => {
    const r = scan(P([Y(2023, [L("Landscaping", 20_000)]), Y(2024, [L("Landscaping", 23_000)])]));
    const f = of(r, "RF-01");
    expect(f).toHaveLength(1);
    expect(f[0]!.severity).toBe("review");
    expect(f[0]!.tenant_exposure_usd).toBe(300);
    expect(f[0]!.tenant_impact_usd).toBeUndefined();
    expect(f[0]!.year).toEqual([2023, 2024]);
  });
  it("does not flag one cent under the threshold", () => {
    const r = scan(P([Y(2023, [L("Landscaping", 20_000)]), Y(2024, [L("Landscaping", 22_999.99)])]));
    expect(of(r, "RF-01")).toHaveLength(0);
  });
  it("gates on tenant-level materiality", () => {
    const r = scan(P([Y(2023, [L("Pest", 2_000)]), Y(2024, [L("Pest", 2_400)])]));
    expect(of(r, "RF-01")).toHaveLength(0);
    const r2 = scan(P([Y(2023, [L("Pest", 2_000)]), Y(2024, [L("Pest", 2_400)])]), { materiality_usd: 10 });
    expect(of(r2, "RF-01")).toHaveLength(1);
  });
  it("compares pre-gross-up actuals and skips amortization lines", () => {
    const cap = { total_cost: 120_000, useful_life_months: 120, in_service: "2020-01-01" };
    const r = scan(
      P([
        Y(2023, [L("Lighting", 10_000), L("Roof amort", 12_000, { capital: cap })]),
        Y(2024, [L("Lighting", 12_500, { gross_up: { actual: 10_300 } }), L("Roof amort", 20_000, { capital: cap })]),
      ]),
    );
    expect(of(r, "RF-01")).toHaveLength(0);
  });
  it("skips on a single year and says why", () => {
    const r = scan(P([Y(2023, [L("Landscaping", 20_000)])]));
    expect(skipped(r, "RF-01")?.reason).toMatch(/two or more years/);
    expect(r.checks_run).not.toContain("RF-01");
  });
});

describe("RF-02 / RF-03 new and vanished categories", () => {
  it("plain new line is review; new fee is high; new non-controllable under a cap is high", () => {
    const r = scan(
      P(
        [
          Y(2023, [L("A", 1_000)]),
          Y(2024, [L("A", 1_000), L("B", 5_000), L("Admin fee", 2_000, { is_fee: true, bucket: "non_controllable" }), L("C", 3_000, { bucket: "non_controllable" })]),
        ],
        LEASE_CAP,
      ),
    );
    const f = of(r, "RF-02");
    expect(f.map((x) => [x.category, x.severity])).toEqual(
      expect.arrayContaining([
        ["B", "review"],
        ["Admin fee", "high"],
        ["C", "high"],
      ]),
    );
  });
  it("vanished line is review and cross-references a similar-size new line", () => {
    const r = scan(P([Y(2023, [L("Security", 10_000)]), Y(2024, [L("Patrol services", 10_500, { bucket: "non_controllable" })])]));
    const v = of(r, "RF-03");
    expect(v).toHaveLength(1);
    expect(v[0]!.related).toEqual(expect.arrayContaining([expect.stringMatching(/^RF-02:2023-2024:patrol/), expect.stringMatching(/^RF-04:2023-2024:patrol/)]));
    const n = of(r, "RF-02");
    expect(n[0]!.related).toEqual(expect.arrayContaining([expect.stringMatching(/^RF-03:2023-2024:security/)]));
  });
  it("a re-labelled line (synonym) is a pair, not new+vanished", () => {
    const r = scan(P([Y(2023, [L("R&M", 1_000)]), Y(2024, [L("Repairs & Maintenance", 1_050)])]));
    expect(of(r, "RF-02")).toHaveLength(0);
    expect(of(r, "RF-03")).toHaveLength(0);
  });
});

describe("RF-04 migration", () => {
  it("prices a move out of a binding capped pool and escalates to high", () => {
    const r = scan(
      P(
        [
          Y(2023, [L("A", 60_000), L("B", 40_000)]),
          Y(2024, [L("A", 70_000), L("B", 40_000, { bucket: "non_controllable" })]),
        ],
        LEASE_CAP,
      ),
    );
    const f = of(r, "RF-04");
    expect(f).toHaveLength(1);
    expect(f[0]!.severity).toBe("high");
    // pool 70,000 + 40,000 restored = 110,000 vs cap 105,000 → 5,000 escapes → 10% share = 500
    expect(f[0]!.tenant_impact_usd).toBe(500);
    expect(f[0]!.working.some((w) => w.label === "Bridge")).toBe(true);
  });
  it("is review when the pool has room, and review without a cap", () => {
    const r = scan(P([Y(2023, [L("A", 50_000), L("B", 40_000)]), Y(2024, [L("A", 50_000), L("B", 40_000, { bucket: "non_controllable" })])], LEASE_CAP));
    expect(of(r, "RF-04")[0]!.severity).toBe("review");
    const r2 = scan(P([Y(2023, [L("A", 50_000), L("B", 40_000)]), Y(2024, [L("A", 50_000), L("B", 40_000, { bucket: "non_controllable" })])]));
    expect(of(r2, "RF-04")[0]!.severity).toBe("review");
    expect(of(r2, "RF-04")[0]!.tenant_impact_usd).toBeUndefined();
  });
  it("catches a renamed-and-moved line through amount similarity", () => {
    const r = scan(P([Y(2023, [L("A", 60_000), L("Security", 40_000)]), Y(2024, [L("A", 70_000), L("Life safety", 42_000, { bucket: "non_controllable" })])], LEASE_CAP));
    const f = of(r, "RF-04");
    expect(f).toHaveLength(1);
    expect(f[0]!.category).toBe("Life safety");
    expect(f[0]!.related).toHaveLength(2);
  });
});

describe("RF-05 round numbers", () => {
  it("tests multiples of $1,000 from the minimum and $500 above $20k", () => {
    expect(isRoundAmount(500_000, 500_000)).toBe(true); // $5,000
    expect(isRoundAmount(400_000, 500_000)).toBe(false); // below min
    expect(isRoundAmount(2_050_000, 500_000)).toBe(true); // $20,500
    expect(isRoundAmount(1_950_000, 500_000)).toBe(false); // $19,500
    expect(isRoundAmount(500_001, 500_000)).toBe(false); // one cent over
  });
  it("is info alone, review when the line is also new or swung", () => {
    const r = scan(P([Y(2023, [L("A", 5_000), L("B", 10_000)]), Y(2024, [L("A", 5_000), L("B", 13_000), L("C", 7_000)])]));
    const f = of(r, "RF-05");
    const by = Object.fromEntries(f.map((x) => [`${x.category}:${x.year}`, x.severity]));
    expect(by["A:2023"]).toBe("info");
    expect(by["B:2024"]).toBe("review"); // +30%
    expect(by["C:2024"]).toBe("review"); // new
  });
});

describe("RF-06 cap compliance", () => {
  it("flags billing above the lease ceiling and chains amount_paid correctly", () => {
    const r = scan(P([Y(2023, [L("A", 110_000)]), Y(2024, [L("A", 108_000)])], LEASE_CAP));
    const f = of(r, "RF-06").filter((x) => x.severity === "high");
    expect(f).toHaveLength(1);
    expect(f[0]!.year).toBe(2023);
    expect(f[0]!.tenant_impact_usd).toBe(500); // (110,000 − 105,000) × 10%
    // 2024: paid 2023 = 105,000 → cap 110,250 > 108,000 → clean
  });
  it("prior_cap and actual_expenses bases chain differently", () => {
    const mk = (basis: "amount_paid" | "actual_expenses" | "prior_cap"): LeaseLite => ({ ...LEASE_CAP, cap: { ...LEASE_CAP.cap!, basis } });
    const years = [Y(2023, [L("A", 110_000)]), Y(2024, [L("A", 114_000)])];
    // amount_paid: 2024 cap = 105,000 × 1.05 = 110,250 → excess 3,750
    expect(of(scan(P(years, mk("amount_paid")), { materiality_usd: 0 }), "RF-06").find((f) => f.year === 2024)!.tenant_impact_usd).toBe(375);
    // actual_expenses: 2024 cap = 110,000 × 1.05 = 115,500 → clean
    expect(of(scan(P(years, mk("actual_expenses"))), "RF-06").find((f) => f.year === 2024)).toBeUndefined();
    // prior_cap: 2024 cap = 105,000 × 1.05 = 110,250 → excess 3,750
    expect(of(scan(P(years, mk("prior_cap")), { materiality_usd: 0 }), "RF-06").find((f) => f.year === 2024)!.tenant_impact_usd).toBe(375);
  });
  it("cumulative and compounded methods", () => {
    const mk = (method: "cumulative" | "compounded"): LeaseLite => ({ ...LEASE_CAP, cap: { ...LEASE_CAP.cap!, method } });
    const years = [Y(2023, [L("A", 100_000)]), Y(2024, [L("A", 100_000)]), Y(2025, [L("A", 116_000)])];
    // cumulative: 2025 cap = 100,000 × (1 + 0.05 × 3) = 115,000 → excess 1,000 → $100
    const cum = of(scan(P(years, mk("cumulative")), { materiality_usd: 0 }), "RF-06").find((f) => f.year === 2025)!;
    expect(cum.tenant_impact_usd).toBe(100);
    // compounded: 2025 cap = 100,000 × 1.05³ = 115,762.50 → excess 237.50 → $23.75
    const comp = of(scan(P(years, mk("compounded")), { materiality_usd: 0 }), "RF-06").find((f) => f.year === 2025)!;
    expect(comp.tenant_impact_usd).toBe(23.75);
  });
  it("with no resolved base, the first year is the base and is not tested", () => {
    const lease: LeaseLite = { ...LEASE_CAP, cap: { ...LEASE_CAP.cap!, base_year: undefined, base_year_amount: undefined } };
    const r = scan(P([Y(2023, [L("A", 200_000)]), Y(2024, [L("A", 220_000)])], lease));
    const f = of(r, "RF-06").filter((x) => x.severity === "high");
    expect(f).toHaveLength(1);
    expect(f[0]!.year).toBe(2024);
    expect(f[0]!.tenant_impact_usd).toBe(1_000); // 220,000 − 210,000 = 10,000 × 10%
  });
  it("detects the cap billed as a floor and the exact-5% pattern", () => {
    const years = [
      Y(2023, [L("A", 100_000)], { cap_summary: { pool_actual: 100_000, pool_allowed: 105_000, pool_billed: 100_000 } }),
      Y(2024, [L("A", 95_000)], { cap_summary: { pool_actual: 95_000, pool_allowed: 105_000, pool_billed: 105_000 } }),
      Y(2025, [L("A", 90_000)], { cap_summary: { pool_actual: 90_000, pool_allowed: 110_250, pool_billed: 110_250 } }),
    ];
    const r = scan(P(years, LEASE_CAP));
    const highs = of(r, "RF-06").filter((x) => x.severity === "high");
    expect(highs.map((f) => f.year)).toEqual([2025, 2024]);
    expect(highs.find((f) => f.year === 2024)!.title).toMatch(/billed at the cap, not at actual/);
    // 2025 lease cap = 95,000 × 1.05 = 99,750; billed 110,250; required 90,000 → excess 20,250 → $2,025
    expect(highs.find((f) => f.year === 2025)!.tenant_impact_usd).toBe(2_025);
    const pattern = of(r, "RF-06").find((x) => x.id.includes("pattern"));
    expect(pattern).toBeDefined();
    expect(pattern!.severity).toBe("review");
    expect(pattern!.related).toHaveLength(2);
  });
  it("skips with a reason when there is no cap, or years are not consecutive", () => {
    expect(skipped(scan(P([Y(2023, [L("A", 1)])])), "RF-06")?.reason).toMatch(/no cap/);
    expect(skipped(scan(P([Y(2023, [L("A", 1)]), Y(2025, [L("A", 1)])], LEASE_CAP)), "RF-06")?.reason).toMatch(/not consecutive/);
  });
});

describe("RF-07 fees", () => {
  it("(a) recomputes the fee on the permitted base and names the base that reproduces the billed figure", () => {
    const r = scan(P([Y(2023, [L("CAM", 200_000), L("Taxes", 100_000, { section: "Taxes" }), L("Management fee", 9_000, { is_fee: true })])], LEASE_CAP));
    const f = of(r, "RF-07");
    expect(f).toHaveLength(1);
    expect(f[0]!.severity).toBe("high");
    expect(f[0]!.tenant_impact_usd).toBe(300); // (9,000 − 6,000) × 10%
    expect(f[0]!.working.find((w) => w.label === "Billed fee reproduces as")!.value).toMatch(/all operating expenses/);
  });
  it("(a) recognises a fee on the fee", () => {
    // fee = 3% × (200,000 + fee) → fee = 6,185.57
    const r = scan(P([Y(2023, [L("CAM", 200_000), L("Management fee", 6_185.57, { is_fee: true })])], LEASE_CAP), { materiality_usd: 0 });
    const f = of(r, "RF-07")[0]!;
    expect(f.working.find((w) => w.label === "Billed fee reproduces as")!.value).toMatch(/fee on the fee/);
  });
  it("(a) passes a correct fee and tolerates $1", () => {
    const r = scan(P([Y(2023, [L("CAM", 200_000), L("Management fee", 6_000.99, { is_fee: true })])], LEASE_CAP));
    expect(of(r, "RF-07")).toHaveLength(0);
  });
  it("(b) stacked management + administrative fees are review", () => {
    const r = scan(P([Y(2023, [L("CAM", 100_000), L("Management fee", 3_000, { is_fee: true }), L("Administrative fee", 1_000, { is_fee: true })])], LEASE_CAP));
    const b = of(r, "RF-07").find((f) => f.id.includes(":b:"));
    expect(b?.severity).toBe("review");
  });
  it("(c) fee kept outside the capped pool when the lease puts it inside is high", () => {
    const lease: LeaseLite = { ...LEASE_CAP, cap: { ...LEASE_CAP.cap!, fee_treatment: "inside_cap" } };
    const r = scan(P([Y(2023, [L("CAM", 100_000), L("Management fee", 3_000, { is_fee: true, bucket: "non_controllable" })])], lease));
    const c = of(r, "RF-07").find((f) => f.id.includes(":c:"));
    expect(c?.severity).toBe("high");
  });
  it("skips when there is nothing to test", () => {
    expect(skipped(scan(P([Y(2023, [L("CAM", 1)])])), "RF-07")?.reason).toMatch(/no fee lines/);
  });
});

describe("RF-08 share", () => {
  it("(a) billed above stated is high with pool × difference", () => {
    const lease: LeaseLite = { ...LEASE_NO_CAP, share: { ...LEASE_NO_CAP.share, stated_pct: 10 } };
    const r = scan(P([Y(2023, [L("A", 100_000)], { tenant_summary: { pro_rata_share_pct: 10.5 }, denominator_sf: undefined })], lease));
    const a = of(r, "RF-08").find((f) => f.id.includes(":a:"))!;
    expect(a.severity).toBe("high");
    expect(a.tenant_impact_usd).toBe(500);
  });
  it("(b) drift beyond 0.05 points is flagged; within is not", () => {
    const r = scan(P([Y(2023, [L("A", 1_000_000)], { tenant_summary: { pro_rata_share_pct: 10.2 } })]));
    expect(of(r, "RF-08").find((f) => f.id.includes(":b:"))?.severity).toBe("high");
    expect(of(r, "RF-08").find((f) => f.id.includes(":b:"))?.tenant_impact_usd).toBe(2_000);
    const r2 = scan(P([Y(2023, [L("A", 100_000)], { tenant_summary: { pro_rata_share_pct: 10.04 } })]));
    expect(of(r2, "RF-08").find((f) => f.id.includes(":b:"))).toBeUndefined();
  });
  it("(c) shrinking denominator is review", () => {
    const r = scan(P([Y(2023, [L("A", 1_000)]), Y(2024, [L("A", 1_000)], { denominator_sf: 90_000, tenant_summary: { pro_rata_share_pct: 11.1111 } })]));
    expect(of(r, "RF-08").find((f) => f.id.includes(":c:"))?.severity).toBe("review");
  });
  it("(d) tenant total must tie to pool × share within $1", () => {
    const r = scan(P([Y(2023, [L("A", 100_000)], { tenant_summary: { pro_rata_share_pct: 10, tenant_total: 10_000.99 } })]));
    expect(of(r, "RF-08").find((f) => f.id.includes(":d:"))).toBeUndefined();
    const r2 = scan(P([Y(2023, [L("A", 100_000)], { tenant_summary: { pro_rata_share_pct: 10, tenant_total: 10_400 } })]));
    expect(of(r2, "RF-08").find((f) => f.id.includes(":d:"))?.tenant_impact_usd).toBe(400);
  });
});

describe("RF-09 capital", () => {
  it("months in service and expected amortization", () => {
    expect(monthsInService("2023-04-01", 120, 2023).months).toBe(9);
    expect(monthsInService("2023-04-01", 120, 2024).months).toBe(12);
    expect(monthsInService("2023-04-01", 120, 2033).months).toBe(3);
    expect(monthsInService("2023-04-01", 120, 2034).months).toBe(0);
    expect(expectedAmortization({ total_cost: 120_000, useful_life_months: 120, in_service: "2023-04-01" }, 2023)).toEqual({ principal: 900_000, interest: 0, months: 9 });
    // 6% simple interest on the declining balance, Apr–Dec 2023: Σ balances 1,044,000 × 0.5% = 5,220
    expect(expectedAmortization({ total_cost: 120_000, useful_life_months: 120, in_service: "2023-04-01", interest_rate_pct: 6 }, 2023).interest).toBe(522_000);
  });
  it("flags over-billed installments, billing after the end of life, and lumps that look capital", () => {
    const lease: LeaseLite = { ...LEASE_NO_CAP, capital_threshold: 10_000, capital_life_years: 10 };
    const r = scan(
      P(
        [
          Y(2023, [
            L("Roof amort", 12_000, { capital: { total_cost: 120_000, useful_life_months: 120, in_service: "2023-04-01" } }),
            L("Old HVAC amort", 1_000, { capital: { total_cost: 60_000, useful_life_months: 120, in_service: "2010-01-01" } }),
            L("Roof replacement", 50_000),
            L("Small repair", 5_000),
          ]),
        ],
        lease,
      ),
      { materiality_usd: 0 },
    );
    const f = of(r, "RF-09");
    expect(f.find((x) => x.category === "Roof amort")!.tenant_impact_usd).toBe(300); // (12,000 − 9,000) × 10%
    expect(f.find((x) => x.category === "Old HVAC amort")!.title).toMatch(/after its amortization ended/);
    const lump = f.find((x) => x.category === "Roof replacement")!;
    expect(lump.severity).toBe("review");
    expect(lump.tenant_impact_usd).toBe(4_500); // (50,000 − 5,000) × 10%
    expect(f.find((x) => x.category === "Small repair")).toBeUndefined();
  });
  it("skips when the lease gives nothing to test lumps against and there is no capital line", () => {
    expect(skipped(scan(P([Y(2023, [L("Roof replacement", 50_000)])])), "RF-09")).toBeDefined();
  });
});

describe("RF-10 gross-up", () => {
  const lease: LeaseLite = { ...LEASE_NO_CAP, gross_up: { allowed: true, to_pct: 95 } };
  it("fixed cost grossed up is high; variable within the target is clean; beyond the target is high", () => {
    const r = scan(
      P(
        [
          Y(2023, [
            L("Insurance", 11_875, { section: "Insurance", gross_up: { actual: 10_000 } }),
            L("Janitorial", 118_750, { gross_up: { actual: 100_000 } }),
            L("Utilities", 125_000, { gross_up: { actual: 100_000 } }),
          ], { occupancy_pct: 80, gross_up_applied: true }),
        ],
        lease,
      ),
    );
    const f = of(r, "RF-10");
    expect(f.find((x) => x.category === "Insurance")!.tenant_impact_usd).toBe(187.5);
    expect(f.find((x) => x.category === "Janitorial")).toBeUndefined();
    expect(f.find((x) => x.category === "Utilities")!.tenant_impact_usd).toBe(625); // (125,000 − 118,750) × 10%
  });
  it("heuristic: fixed line grows by the gross-up factor while occupancy falls", () => {
    const r = scan(P([Y(2023, [L("Taxes", 100_000, { section: "Taxes" })], { occupancy_pct: 95 }), Y(2024, [L("Taxes", 118_750, { section: "Taxes" })], { occupancy_pct: 80, gross_up_applied: true })], lease));
    expect(of(r, "RF-10").find((x) => x.category === "Taxes")?.severity).toBe("review");
  });
  it("skips when no gross-up applies", () => {
    expect(skipped(scan(P([Y(2023, [L("A", 1)])])), "RF-10")).toBeDefined();
  });
});

describe("RF-11 arithmetic tie-out", () => {
  it("balance due, per-line tenant amounts and stated pool actual must reproduce", () => {
    const r = scan(
      P(
        [
          Y(2023, [L("A", 100_000, { tenant_amount: 10_000 }), L("B", 50_000, { tenant_amount: 5_250 })], {
            tenant_summary: { pro_rata_share_pct: 10, tenant_total: 15_250, estimates_paid: 10_000, balance_due: 5_862.40 },
            cap_summary: { pool_actual: 140_000, pool_billed: 140_000 },
          }),
        ],
        LEASE_CAP,
      ),
    );
    const f = of(r, "RF-11");
    expect(f.find((x) => x.id.includes(":balance:"))!.tenant_impact_usd).toBe(612.4);
    expect(f.find((x) => x.id.includes(":lines:"))!.tenant_impact_usd).toBe(250);
    expect(f.find((x) => x.id.includes(":pool:"))).toBeDefined();
  });
  it("is silent when everything ties", () => {
    const r = scan(P([Y(2023, [L("A", 100_000, { tenant_amount: 10_000 })], { tenant_summary: { pro_rata_share_pct: 10, tenant_total: 10_000, estimates_paid: 9_000, balance_due: 1_000 } })]));
    expect(of(r, "RF-11")).toHaveLength(0);
  });
});

describe("RF-12 identical amounts", () => {
  it("flags identical material amounts, ignores immaterial and amortization lines", () => {
    const cap = { total_cost: 120_000, useful_life_months: 120, in_service: "2020-01-01" };
    const r = scan(P([Y(2023, [L("Janitorial", 9_864), L("Pest", 1_000), L("Amort", 12_000, { capital: cap })]), Y(2024, [L("Janitorial", 9_864), L("Pest", 1_000), L("Amort", 12_000, { capital: cap })])]));
    const f = of(r, "RF-12");
    expect(f.map((x) => x.category)).toEqual(["Janitorial"]);
    expect(f[0]!.tenant_exposure_usd).toBe(986.4);
  });
});

describe("engine policies", () => {
  it("downgrades quantified findings below materiality to info and marks them", () => {
    const r = scan(P([Y(2023, [L("CAM", 10_000), L("Taxes", 5_000, { section: "Taxes" }), L("Management fee", 450, { is_fee: true })])], LEASE_CAP));
    const f = of(r, "RF-07")[0]!;
    expect(f.tenant_impact_usd).toBe(15);
    expect(f.severity).toBe("info");
    expect(f.suppressed_by_materiality).toBe(true);
  });
  it("a check that cannot run never throws — it is reported as skipped", () => {
    const r = scan(P([Y(2023, [L("A", 1)])]));
    const ids = r.skipped.map((s) => s.check_id);
    expect(ids).toEqual(expect.arrayContaining(["RF-01", "RF-02", "RF-03", "RF-04", "RF-06", "RF-12"]));
    for (const s of r.skipped) expect(s.reason.length).toBeGreaterThan(10);
  });
  it("rejects malformed packages with a message", () => {
    expect(() => scan({} as never)).toThrow(/package_id/);
    expect(() => scan(P([]))).toThrow(/years/);
  });
  it("honors config overrides", () => {
    const r = scan(P([Y(2023, [L("A", 20_000)]), Y(2024, [L("A", 22_000)])]), { yoy_pct_threshold: 5, materiality_usd: 0 });
    expect(of(r, "RF-01")).toHaveLength(1);
    expect(r.config.yoy_pct_threshold).toBe(5);
  });
});
