/**
 * Canonical input and output shapes for the Red-Flag Scanner engine.
 *
 * These types are normative: `schema/recon-package.schema.json` mirrors the
 * input side, and every shipped package validates against it. Amounts are in
 * dollars with at most two decimals; the engine converts to integer cents at
 * the boundary and never does float arithmetic on money.
 */

/** A multi-year reconciliation package for one lease / premises. */
export interface ReconPackage {
  meta: {
    package_id: string; // e.g. "MW-B"
    property_name: string; // synthetic only
    tenant_name: string; // synthetic only
    premises_sf: number;
    currency: "USD";
    schema_version: "1.0";
    /** One-line story shown on the package card. Optional for uploads. */
    story?: string;
  };
  lease_lite: LeaseLite; // the minimal abstract the checks need
  years: ReconYear[]; // ascending; 2+ years enables the cross-year checks
}

export interface ReconYear {
  year: number; // calendar year of the reconciliation
  occupancy_pct?: number; // average occupancy, 0–100, if stated
  denominator_sf?: number; // the share denominator the landlord used this year
  gross_up_applied?: boolean;
  lines: ReconLine[];
  /**
   * The landlord's own cap computation, if the statement shows one. When
   * present, `pool_billed` (not the sum of the capped lines) is what the
   * tenant was charged for the capped pool.
   */
  cap_summary?: {
    pool_label?: string; // e.g. "Controllable CAM (subject to cap)"
    pool_actual: number; // the landlord's stated actual for the capped pool
    pool_allowed?: number; // the landlord's stated cap for the year
    pool_billed: number; // what the landlord billed for the capped pool
  };
  tenant_summary?: {
    pro_rata_share_pct?: number; // as billed, 0–100
    tenant_total?: number; // the landlord's total charge to the tenant
    estimates_paid?: number;
    balance_due?: number; // positive = tenant owes
  };
}

export type Bucket = "controllable" | "non_controllable" | "unknown";

export interface ReconLine {
  label: string; // exactly as it appears on the statement
  section: string; // the statement's grouping, e.g. "CAM", "Taxes", "Insurance"
  bucket?: Bucket; // as the landlord classified it
  amount: number; // property-level (pool) amount for the year, as billed
  tenant_amount?: number; // tenant-billed amount if the statement shows it
  is_fee?: boolean; // admin/mgmt fee line as labeled
  capital?: {
    // present if the line is amortized capital
    total_cost: number;
    useful_life_months: number;
    interest_rate_pct?: number;
    in_service: string; // ISO date
  };
  gross_up?: {
    // present if the statement shows a gross-up adjustment on this line
    actual: number; // pre-gross-up amount
    factor?: number; // the multiplier the landlord applied, if shown
  };
}

export interface LeaseLite {
  share: {
    stated_pct?: number; // if the lease states a fixed share
    numerator_sf: number; // premises SF
    denominator_basis: "GLA" | "GLOA" | "unknown";
  };
  cap?: {
    // omit if no cap (cap checks are then skipped, and say so)
    applies_to: "controllable" | "all_cam" | "total_opex";
    pct: number; // e.g. 5
    method: "non_cumulative" | "cumulative" | "compounded";
    basis: "amount_paid" | "actual_expenses" | "prior_cap"; // tenant-favorable is amount_paid
    base_year_amount?: number; // resolved base (pool $) for `base_year`
    base_year?: number; // defaults to the year before the first year in the package
    fee_treatment: "inside_cap" | "outside_cap";
  };
  fees: Array<{
    kind: "management" | "administrative";
    rate_pct: number; // e.g. 3 means 3%
    base: "cam_only" | "cam_plus_insurance" | "all_opex" | "receipts";
  }>;
  capital_threshold?: number; // $ above which items must be amortized, if the lease states one
  capital_life_years?: number; // lease-stated amortization life, if any
  gross_up?: { allowed: boolean; to_pct?: number }; // e.g. gross up variable costs to 95%
}

// ---------------------------------------------------------------------------
// Engine output
// ---------------------------------------------------------------------------

export type Severity = "info" | "review" | "high";

export interface Finding {
  /** Stable per-scan id: `${check_id}:${year}:${slug}` — used for cross-references. */
  id: string;
  check_id: string; // "RF-06"
  title: string; // "Cap grown on the cap, not on actuals"
  severity: Severity;
  year: number | [number, number];
  category?: string; // the line/label concerned
  tenant_impact_usd?: number; // estimated overcharge at tenant level; omit when not computable; never guess
  /** Tenant-level amount at stake for question-type findings (swings, identical amounts). Not an overcharge; not summed. */
  tenant_exposure_usd?: number;
  narrative: string; // 1–3 sentences, finding-letter register
  working: Array<{ label: string; value: string }>; // the arithmetic, line by line
  refs: string[]; // corpus concept implemented
  /** Ids of findings this one should be read with (e.g. RF-03 ↔ RF-02 ↔ RF-04). */
  related?: string[];
  /** Set when the engine downgraded severity because impact fell below materiality. */
  suppressed_by_materiality?: boolean;
}

export interface SkipRecord {
  check_id: string;
  title: string;
  skipped: true;
  reason: string;
}

export interface ScanConfig {
  materiality_usd: number; // default 250 (tenant-level)
  yoy_pct_threshold: number; // default 15
  round_number_min_usd: number; // default 5000 (pool-level)
}

export const DEFAULT_CONFIG: ScanConfig = Object.freeze({
  materiality_usd: 250,
  yoy_pct_threshold: 15,
  round_number_min_usd: 5000,
});

export interface ScanResult {
  package_id: string;
  findings: Finding[]; // sorted: severity desc, impact desc, then check id / year
  skipped: SkipRecord[];
  checks_run: string[];
  /** Share the engine used per year, with where it came from. */
  share_by_year: Record<number, { pct: number; source: ShareSource }>;
  totals: {
    high: number;
    review: number;
    info: number;
    estimated_impact_usd: number; // sum of computable impacts across all findings
  };
  config: ScanConfig;
}

export type ShareSource = "billed" | "computed" | "stated" | "unknown";

// ---------------------------------------------------------------------------
// Check contract
// ---------------------------------------------------------------------------

/** Everything a check may read. Built once per scan, never mutated by checks. */
export interface CheckContext {
  pkg: ReconPackage;
  config: ScanConfig;
  years: ReconYear[]; // ascending copy
  /** Tenant share fraction (0–1) per year, or null if unknowable. */
  share: (year: number) => { frac: number; source: ShareSource } | null;
}

export type CheckOutcome = Finding[] | SkipRecord;

export interface Check {
  id: string;
  title: string;
  run: (ctx: CheckContext) => CheckOutcome;
}
