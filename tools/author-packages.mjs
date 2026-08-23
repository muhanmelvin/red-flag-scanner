/**
 * Authors the three Maplewood synthetic packages (MW-A / MW-B / MW-C) and
 * their findings manifests, writing JSON into src/data/.
 *
 *   npm run data:build
 *
 * Everything here is SYNTHETIC — the fictional Maplewood Commerce Center
 * (168,000 sf GLA) from the AI for Auditors course and the Cap Trap Explorer.
 * The script exists so that every derived figure (fees, tenant totals,
 * balances, the landlord's cap schedule) is computed once, to the cent, and
 * so that the planted findings are documented in code rather than in prose.
 * Amounts are handled as integer cents and written as dollars.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(root, "src/data");
const manifestDir = resolve(outDir, "manifests");

const PROPERTY = "Maplewood Commerce Center";
const GLA = 168_000;

// ---- cents helpers -------------------------------------------------------
const c = (dollars) => Math.round(dollars * 100 + 1e-9);
const d = (cents) => Math.round(cents) / 100;
const pctOf = (cents, pct) => Math.round(cents * (pct / 100) + 1e-9);
const shareOf = (cents, frac) => Math.round(cents * frac + 1e-9);
const sum = (xs) => xs.reduce((a, b) => a + b, 0);

function line(label, section, bucket, amountCents, extra = {}) {
  return { label, section, bucket, amount: d(amountCents), ...extra };
}

/** Attach tenant_amount = pool × share to every line (rounded per line, as landlords do). */
function withTenantAmounts(lines, frac) {
  return lines.map((l) => ({ ...l, tenant_amount: d(shareOf(c(l.amount), frac)) }));
}

const RESURFACING = {
  total_cost: 148_500,
  useful_life_months: 120,
  in_service: "2022-04-01",
};

// ===========================================================================
// MW-A — "The clean year" — Tessaro Home Goods, 18,000 sf, no cap
// ===========================================================================
function buildMWA() {
  const sf = 18_000;
  const frac = sf / GLA; // 0.107142857…
  const billedPct = 10.7143;
  const fracBilled = billedPct / 100;

  const years = [];
  const base = {
    2024: {
      landscaping: c(14_362.18), rm: c(22_918.40), sweep: c(6_745.90), security: c(18_204.00), trash: c(7_381.52), pest: c(2_260.80),
      amort: c(14_850.00), lighting: c(11_926.77), snow: c(15_212.40), taxes: c(112_318.92), insurance: c(53_118.44), estimates: c(39_600.00),
    },
    2025: {
      landscaping: c(14_905.70), rm: c(21_466.15), sweep: c(6_981.25), security: c(18_750.12), trash: c(7_602.96), pest: c(2_318.64),
      amort: c(14_850.00), lighting: c(12_488.03), snow: c(17_950.63), taxes: c(115_802.47), insurance: c(57_770.30), estimates: c(41_400.00),
    },
  };
  for (const [ys, v] of Object.entries(base)) {
    const year = Number(ys);
    const cam = [
      line("Landscaping & grounds", "CAM", "controllable", v.landscaping),
      line("Repairs & maintenance", "CAM", "controllable", v.rm),
      line("Sweeping & striping", "CAM", "controllable", v.sweep),
      line("Security", "CAM", "controllable", v.security),
      line("Trash removal", "CAM", "controllable", v.trash),
      line("Pest control", "CAM", "controllable", v.pest),
      line(`Parking lot resurfacing – amortization (yr ${year - 2022 + 1} of 10)`, "CAM", "controllable", v.amort, { capital: RESURFACING }),
      line("Common area lighting – electricity", "CAM", "non_controllable", v.lighting),
      line("Snow removal", "CAM", "non_controllable", v.snow),
    ];
    const camTotal = sum(cam.map((l) => c(l.amount)));
    const fee = pctOf(camTotal, 3); // correct: 3% of CAM only
    const lines = withTenantAmounts(
      [
        ...cam,
        line("Management fee (3%)", "CAM", "controllable", fee, { is_fee: true }),
        line("Real estate taxes", "Taxes", "non_controllable", v.taxes),
        line("Insurance", "Insurance", "non_controllable", v.insurance),
      ],
      fracBilled,
    );
    const tenantTotal = sum(lines.map((l) => c(l.tenant_amount)));
    years.push({
      year,
      denominator_sf: GLA,
      lines,
      tenant_summary: {
        pro_rata_share_pct: billedPct,
        tenant_total: d(tenantTotal),
        estimates_paid: d(v.estimates),
        balance_due: d(tenantTotal - v.estimates),
      },
    });
  }

  const pkg = {
    meta: {
      package_id: "MW-A",
      property_name: PROPERTY,
      tenant_name: "Tessaro Home Goods",
      premises_sf: sf,
      currency: "USD",
      schema_version: "1.0",
      story: "The clean year. Two years, no cap, everything ties — except one honest 18% swing on snow removal. Proves the scanner doesn't cry wolf.",
    },
    lease_lite: {
      share: { numerator_sf: sf, denominator_basis: "GLA" },
      fees: [{ kind: "management", rate_pct: 3, base: "cam_only" }],
      capital_life_years: 10,
    },
    years,
  };
  const manifest = {
    package_id: "MW-A",
    expected_total_findings: 1,
    expected_high: 0,
    findings: [
      { check_id: "RF-01", year: [2024, 2025], category: "Snow removal", severity: "review", note: "harsh winter: +18.0%, the teaching moment — a flag is a question" },
    ],
  };
  return { pkg, manifest };
}

// ===========================================================================
// MW-B — "The cap year" — Halverson Sporting Goods, 24,000 sf
//   5% non-cumulative cap on controllables, basis amount_paid, fee outside cap
//   3% management fee on CAM only (billed on CAM + insurance + taxes)
// ===========================================================================
function buildMWB() {
  const sf = 24_000;
  const frac = sf / GLA; // 0.142857142…
  const billedPct = 14.2857;
  const fracBilled = billedPct / 100;
  const CAP_PCT = 5;
  const BASE_2022_PAID = c(86_517.36); // resolved 2022 amount paid for the capped pool

  const ctl = {
    2023: { landscaping: c(15_118.40), rm: c(26_402.75), sweep: c(6_533.48), security: c(17_638.90), trash: c(7_102.30), pest: c(2_186.40), amort: c(14_850.00) },
    2024: { landscaping: c(14_362.18), rm: c(21_880.12), sweep: c(6_745.90), security: c(18_204.00), trash: c(7_381.52), pest: c(2_260.80), amort: c(14_850.00) },
    2025: { landscaping: c(15_240.66), rm: c(24_960.40), sweep: c(7_212.85), security: c(19_950.36), trash: c(7_860.22), pest: c(2_397.18), amort: c(14_850.00) },
  };
  const other = {
    2023: { lighting: c(11_388.52), snow: c(13_870.15), taxes: c(108_412.60), insurance: c(49_266.80), estimates: c(38_400.00) },
    2024: { lighting: c(11_926.77), snow: c(15_212.40), taxes: c(112_318.92), insurance: c(53_118.44), estimates: c(40_800.00) },
    2025: { lighting: c(12_488.03), snow: c(16_104.35), taxes: c(115_802.47), insurance: c(57_770.30), estimates: c(43_200.00) },
  };

  const years = [];
  const ledger = {}; // per-year working for the manifest
  let prevBilled = null;
  let prevPaidCorrect = BASE_2022_PAID;
  for (const year of [2023, 2024, 2025]) {
    const v = ctl[year];
    const o = other[year];
    const controllable = [
      line("Landscaping & grounds", "CAM", "controllable", v.landscaping),
      line("Repairs & maintenance", "CAM", "controllable", v.rm),
      line("Sweeping & striping", "CAM", "controllable", v.sweep),
      ...(year < 2025 ? [line("Security", "CAM", "controllable", v.security)] : []),
      line("Trash removal", "CAM", "controllable", v.trash),
      line("Pest control", "CAM", "controllable", v.pest),
      line(`Parking lot resurfacing – amortization (yr ${year - 2022 + 1} of 10)`, "CAM", "controllable", v.amort, { capital: RESURFACING }),
    ];
    const nonControllable = [
      line("Common area lighting – electricity", "CAM", "non_controllable", o.lighting),
      line("Snow removal", "CAM", "non_controllable", o.snow),
      // 2025: Security re-labelled and moved to the non-controllable section.
      ...(year === 2025 ? [line("Life safety & patrol services", "CAM", "non_controllable", v.security)] : []),
    ];
    const camLines = [...controllable, ...nonControllable];
    const camTotal = sum(camLines.map((l) => c(l.amount)));
    // Planted RF-07a: fee billed on CAM + insurance + taxes instead of CAM only.
    const feeBase = camTotal + o.insurance + o.taxes;
    const fee = pctOf(feeBase, 3);
    const feeCorrect = pctOf(camTotal, 3);

    // Landlord's cap schedule (the planted cap-on-cap / escalator billing).
    const poolActual = sum(controllable.map((l) => c(l.amount)));
    const allowedCorrect = prevPaidCorrect + pctOf(prevPaidCorrect, CAP_PCT);
    let llAllowed;
    let billed;
    if (year === 2023) {
      llAllowed = allowedCorrect; // 2023 computed correctly: base × 1.05
      billed = Math.min(poolActual, llAllowed); // under the cap → actual
    } else {
      llAllowed = prevBilled + pctOf(prevBilled, CAP_PCT); // cap grown on last year's billing
      billed = llAllowed; // the cap billed as an escalator, regardless of actual
    }
    const paidCorrect = Math.min(poolActual, allowedCorrect);

    const lines = [
      ...camLines,
      line("Management fee (3%)", "Fees", "non_controllable", fee, { is_fee: true }),
      line("Real estate taxes", "Taxes", "non_controllable", o.taxes),
      line("Insurance", "Insurance", "non_controllable", o.insurance),
    ];
    const nonPoolTotal = sum(nonControllable.map((l) => c(l.amount))) + fee + o.taxes + o.insurance;
    const tenantTotal = shareOf(billed + nonPoolTotal, fracBilled);
    years.push({
      year,
      denominator_sf: GLA,
      lines,
      cap_summary: {
        pool_label: "Controllable CAM (subject to 5% cap)",
        pool_actual: d(poolActual),
        pool_allowed: d(llAllowed),
        pool_billed: d(billed),
      },
      tenant_summary: {
        pro_rata_share_pct: billedPct,
        tenant_total: d(tenantTotal),
        estimates_paid: d(o.estimates),
        balance_due: d(tenantTotal - o.estimates),
      },
    });
    ledger[year] = {
      pool_actual: d(poolActual), allowed_correct: d(allowedCorrect), paid_correct: d(paidCorrect), billed: d(billed), ll_allowed: d(llAllowed),
      cap_excess_pool: d(billed - paidCorrect), cap_excess_tenant: d(shareOf(billed - paidCorrect, fracBilled)),
      fee_billed: d(fee), fee_correct: d(feeCorrect), fee_excess_pool: d(fee - feeCorrect), fee_excess_tenant: d(shareOf(fee - feeCorrect, fracBilled)),
      security_outside_pool: year === 2025 ? d(v.security) : 0,
      migration_excess_pool: year === 2025 ? d(Math.min(v.security, Math.max(0, poolActual + v.security - allowedCorrect))) : 0,
      migration_excess_tenant: year === 2025 ? d(shareOf(Math.min(v.security, Math.max(0, poolActual + v.security - allowedCorrect)), fracBilled)) : 0,
    };
    prevBilled = billed;
    prevPaidCorrect = paidCorrect;
  }

  const pkg = {
    meta: {
      package_id: "MW-B",
      property_name: PROPERTY,
      tenant_name: "Halverson Sporting Goods",
      premises_sf: sf,
      currency: "USD",
      schema_version: "1.0",
      story: "The cap year. Three years under a 5% cap on controllables: the cap billed as an escalator, a fee computed on the wrong base, and a security line that quietly leaves the capped pool.",
    },
    lease_lite: {
      share: { numerator_sf: sf, denominator_basis: "GLA" },
      cap: {
        applies_to: "controllable",
        pct: CAP_PCT,
        method: "non_cumulative",
        basis: "amount_paid",
        base_year: 2022,
        base_year_amount: d(BASE_2022_PAID),
        fee_treatment: "outside_cap",
      },
      fees: [{ kind: "management", rate_pct: 3, base: "cam_only" }],
      capital_life_years: 10,
    },
    years,
  };
  const tol = (x) => [Math.floor(x * 0.98), Math.ceil(x * 1.02 + 1)];
  const manifest = {
    package_id: "MW-B",
    expected_high_min: 7,
    ledger,
    findings: [
      { check_id: "RF-06", year: 2024, category: "Controllable CAM (subject to 5% cap)", severity: "high", expected_impact_range: tol(ledger[2024].cap_excess_tenant) },
      { check_id: "RF-06", year: 2025, category: "Controllable CAM (subject to 5% cap)", severity: "high", expected_impact_range: tol(ledger[2025].cap_excess_tenant) },
      { check_id: "RF-06", year: [2023, 2025], category: "Capped pool", severity: "review", note: "cap-on-cap pattern: billed grows exactly 5% in 2024 and 2025" },
      { check_id: "RF-07", year: 2023, category: "Management fee (3%)", severity: "high", expected_impact_range: tol(ledger[2023].fee_excess_tenant) },
      { check_id: "RF-07", year: 2024, category: "Management fee (3%)", severity: "high", expected_impact_range: tol(ledger[2024].fee_excess_tenant) },
      { check_id: "RF-07", year: 2025, category: "Management fee (3%)", severity: "high", expected_impact_range: tol(ledger[2025].fee_excess_tenant) },
      { check_id: "RF-04", year: [2024, 2025], category: "Life safety & patrol services", severity: "high", expected_impact_range: tol(ledger[2025].migration_excess_tenant) },
      { check_id: "RF-02", year: [2024, 2025], category: "Life safety & patrol services", severity: "high" },
      { check_id: "RF-03", year: [2024, 2025], category: "Security", severity: "review" },
      { check_id: "RF-01", year: [2023, 2024], category: "Repairs & maintenance", severity: "review", note: "the −17% dip that puts the pool under the cap" },
    ],
    total_planted_tenant_impact: d(
      c(ledger[2024].cap_excess_tenant) + c(ledger[2025].cap_excess_tenant) + c(ledger[2023].fee_excess_tenant) + c(ledger[2024].fee_excess_tenant) + c(ledger[2025].fee_excess_tenant) + c(ledger[2025].migration_excess_tenant),
    ),
  };
  return { pkg, manifest };
}

// ===========================================================================
// MW-C — "The capital year" — Copperline Outfitters, 30,000 sf
//   no cap; gross-up to 95%; occupancy 98% → 82%; denominator switched to occupied area
// ===========================================================================
function buildMWC() {
  const sf = 30_000;
  const STATED_PCT = 17.86;
  const OCC = { 2021: 98, 2022: 82 };
  const DEN = { 2021: GLA, 2022: Math.round(GLA * 0.82) }; // 168,000 → 137,760 (occupied area)
  const billedPct = { 2021: 17.8571, 2022: 21.777 }; // 30,000/168,000 ; 30,000/137,760
  const grossFactor = 95 / 82; // 1.158536…

  const v = {
    2021: { landscaping: c(13_846.20), rm: c(19_774.55), sweep: c(6_104.30), security: c(16_420.75), trash: c(6_640.88), pest: c(2_042.60), janitorial: c(9_864.00), lighting: c(10_050.20), taxes: c(97_412.50), insurance: c(42_980.60), estimates: c(43_200.00) },
    2022: { landscaping: c(14_000.00), rm: c(20_418.92), sweep: c(6_318.95), security: c(16_980.10), trash: c(6_889.40), pest: c(2_112.75), janitorial: c(9_864.00), lightingActual: c(10_412.60), taxes: c(101_218.36), insuranceActual: c(45_128.40), estimates: c(44_400.00) },
  };

  const years = [];
  const ledger = {};
  for (const year of [2021, 2022]) {
    const x = v[year];
    const frac = billedPct[year] / 100;
    const cam = [
      line("Landscaping & grounds", "CAM", "controllable", x.landscaping),
      line("Repairs & maintenance", "CAM", "controllable", x.rm),
      line("Sweeping & striping", "CAM", "controllable", x.sweep),
      line("Security", "CAM", "controllable", x.security),
      line("Trash removal", "CAM", "controllable", x.trash),
      line("Pest control", "CAM", "controllable", x.pest),
      line("Janitorial – common areas", "CAM", "controllable", x.janitorial),
    ];
    if (year === 2022) {
      // Planted RF-09: the resurfacing expensed as a lump under an R&M label.
      cam.push(line("Parking Lot R&M", "CAM", "controllable", c(148_500.00)));
    }
    let lighting;
    let insurance;
    if (year === 2021) {
      lighting = line("Common area lighting – electricity", "CAM", "non_controllable", x.lighting);
      insurance = line("Insurance", "Insurance", "non_controllable", x.insurance);
    } else {
      // Variable cost grossed up legitimately (to 95% at 82% occupancy)…
      const lightingGross = Math.round(x.lightingActual * grossFactor);
      lighting = line("Common area lighting – electricity", "CAM", "non_controllable", lightingGross, { gross_up: { actual: d(x.lightingActual), factor: Number(grossFactor.toFixed(4)) } });
      // …and a fixed cost grossed up wrongly (planted RF-10).
      const insGross = Math.round(x.insuranceActual * grossFactor);
      insurance = line("Insurance", "Insurance", "non_controllable", insGross, { gross_up: { actual: d(x.insuranceActual), factor: Number(grossFactor.toFixed(4)) } });
    }
    const taxes = line("Real estate taxes", "Taxes", "non_controllable", x.taxes);
    const lines = withTenantAmounts([...cam, lighting, taxes, insurance], frac);
    const tenantTotal = sum(lines.map((l) => c(l.tenant_amount)));
    // Planted RF-11: 2022 balance due mis-added by $612.40.
    const balance = tenantTotal - x.estimates + (year === 2022 ? c(612.40) : 0);
    years.push({
      year,
      occupancy_pct: OCC[year],
      denominator_sf: DEN[year],
      gross_up_applied: year === 2022,
      lines,
      tenant_summary: {
        pro_rata_share_pct: billedPct[year],
        tenant_total: d(tenantTotal),
        estimates_paid: d(x.estimates),
        balance_due: d(balance),
      },
    });
    const pool = sum(lines.map((l) => c(l.amount)));
    ledger[year] = {
      pool: d(pool),
      share_excess_tenant: year === 2022 ? d(shareOf(pool, (billedPct[2022] - STATED_PCT) / 100)) : 0,
      insurance_grossup_pool: year === 2022 ? d(c(insurance.amount) - x.insuranceActual) : 0,
      insurance_grossup_tenant: year === 2022 ? d(shareOf(c(insurance.amount) - x.insuranceActual, frac)) : 0,
      resurfacing_excess_if_capital_pool: year === 2022 ? d(c(148_500) - Math.round(c(148_500) / 10)) : 0,
      resurfacing_excess_if_capital_tenant: year === 2022 ? d(shareOf(c(148_500) - Math.round(c(148_500) / 10), frac)) : 0,
    };
  }

  const pkg = {
    meta: {
      package_id: "MW-C",
      property_name: PROPERTY,
      tenant_name: "Copperline Outfitters",
      premises_sf: sf,
      currency: "USD",
      schema_version: "1.0",
      story: "The capital year. Occupancy falls from 98% to 82%: a $148,500 parking-lot job expensed as repairs, insurance grossed up, a denominator that shrinks with vacancy, and a balance that doesn't add.",
    },
    lease_lite: {
      share: { stated_pct: STATED_PCT, numerator_sf: sf, denominator_basis: "GLA" },
      fees: [],
      capital_threshold: 10_000,
      capital_life_years: 10,
      gross_up: { allowed: true, to_pct: 95 },
    },
    years,
  };
  const tol = (x) => [Math.floor(x * 0.98), Math.ceil(x * 1.02 + 1)];
  const manifest = {
    package_id: "MW-C",
    ledger,
    findings: [
      { check_id: "RF-09", year: 2022, category: "Parking Lot R&M", severity: "review", expected_impact_range: tol(ledger[2022].resurfacing_excess_if_capital_tenant) },
      { check_id: "RF-10", year: 2022, category: "Insurance", severity: "high", expected_impact_range: tol(ledger[2022].insurance_grossup_tenant) },
      { check_id: "RF-08", year: 2022, category: "Pro-rata share", severity: "high", expected_impact_range: tol(ledger[2022].share_excess_tenant), note: "billed 21.777% vs stated 17.86%" },
      { check_id: "RF-08", year: [2021, 2022], category: "Pro-rata share", severity: "review", note: "denominator 168,000 → 137,760" },
      { check_id: "RF-11", year: 2022, category: "Balance due", severity: "high", expected_impact_range: [612, 613] },
      { check_id: "RF-12", year: [2021, 2022], category: "Janitorial – common areas", severity: "review" },
      { check_id: "RF-05", year: 2022, category: "Parking Lot R&M", severity: "review", note: "round and new" },
      { check_id: "RF-05", year: 2022, category: "Landscaping & grounds", severity: "info" },
      { check_id: "RF-02", year: [2021, 2022], category: "Parking Lot R&M", severity: "review" },
    ],
  };
  return { pkg, manifest };
}

// ---------------------------------------------------------------------------
await mkdir(manifestDir, { recursive: true });
const built = [buildMWA(), buildMWB(), buildMWC()];
for (const { pkg, manifest } of built) {
  const id = pkg.meta.package_id.toLowerCase();
  await writeFile(resolve(outDir, `${id}.json`), JSON.stringify(pkg, null, 2) + "\n", "utf8");
  await writeFile(resolve(manifestDir, `${id}.manifest.json`), JSON.stringify(manifest, null, 2) + "\n", "utf8");
  console.log(`${pkg.meta.package_id}: ${pkg.years.length} years, ${pkg.years.reduce((n, y) => n + y.lines.length, 0)} lines → src/data/${id}.json`);
}
