/**
 * The statement, reassembled — a pure presentation model of the landlord's
 * reconciliation as a year-by-year table, plus the mapping from a finding to
 * the rows it is about.
 *
 * DOM-free on purpose: the engine/UI split is mirrored here so the table's
 * arithmetic and its finding→row mapping are unit-tested in node, and only
 * `recon-table.ts` touches the document.
 *
 * Cross-year line matching is strict equality on `normalizeLabel`. The engine's
 * matcher adds Dice similarity on top of that, so an odd upload that renames a
 * line between years may render it as two rows here. Cosmetic only — the
 * upgrade path is to reuse `matchLines()` from `src/engine/normalize.ts`.
 */

import type { Bucket, Finding, ReconLine, ReconPackage, ReconYear, ScanResult } from "../engine/types.ts";
import { normalizeLabel } from "../engine/normalize.ts";
import { sumCents, toCents, toDollars, usd } from "../engine/money.ts";

export type RowKind = "meta" | "line" | "subtotal" | "total" | "cap" | "tenant";

export interface ReconCell {
  /** Money value in dollars when the row is a money row; null when the year has none. */
  amount: number | null;
  /** Already-formatted value for rows that are not money (occupancy, sf, share, a pool label). */
  text?: string;
  /** Small print under the value: the tenant's share of the line, capital or gross-up detail. */
  note?: string;
}

export interface ReconRow {
  /** Stable key; the target of `rowKeysForFinding`. */
  key: string;
  label: string;
  kind: RowKind;
  bucket?: Bucket;
  /** One cell per entry in `model.years`, same order. */
  cells: ReconCell[];
}

export interface ReconBlock {
  id: string;
  title: string;
  rows: ReconRow[];
}

export interface ReconTableModel {
  package_id: string;
  years: number[];
  blocks: ReconBlock[];
  /** Normalized `cap_summary.pool_label`s — a cap finding's category is one of these. */
  capPoolLabels: string[];
}

// ---------------------------------------------------------------------------
// Formatting helpers (presentation only; the money itself stays in cents)
// ---------------------------------------------------------------------------

function num(v: number, max = 4): string {
  return v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: max });
}

function bucketWord(b: Bucket | undefined): string {
  return b === "non_controllable" ? "non-controllable" : b === "controllable" ? "controllable" : "unclassified";
}

function lineNote(lines: ReconLine[], rowBucket: Bucket | undefined): string | undefined {
  const parts: string[] = [];
  const tenant = lines.filter((l) => l.tenant_amount !== undefined);
  if (tenant.length) parts.push(`tenant ${usd(sumCents(tenant.map((l) => toCents(l.tenant_amount!))))}`);
  for (const l of lines) {
    if (l.capital) {
      const yrs = l.capital.useful_life_months / 12;
      parts.push(`capital ${usd(toCents(l.capital.total_cost))} over ${l.capital.useful_life_months} months (${num(yrs, 1)} yr), in service ${l.capital.in_service}`);
    }
    if (l.gross_up) {
      parts.push(`grossed up from ${usd(toCents(l.gross_up.actual))}${l.gross_up.factor !== undefined ? ` × ${num(l.gross_up.factor, 4)}` : ""}`);
    }
  }
  const buckets = [...new Set(lines.map((l) => l.bucket))];
  if (buckets.length === 1 && buckets[0] !== rowBucket) parts.push(`classified ${bucketWord(buckets[0])}`);
  return parts.length ? parts.join(" · ") : undefined;
}

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

interface Slot {
  label: string;
  section: string;
  bucket: Bucket | undefined;
  byYear: Map<number, ReconLine[]>;
}

function collect(years: ReconYear[], want: (l: ReconLine) => boolean): { sections: string[]; slots: Map<string, Slot> } {
  const sections: string[] = [];
  const slots = new Map<string, Slot>();
  for (const y of years) {
    for (const line of y.lines) {
      if (!want(line)) continue;
      const section = line.section || "Other";
      if (!sections.includes(section)) sections.push(section);
      const key = `${section}||${normalizeLabel(line.label)}`;
      let slot = slots.get(key);
      if (!slot) {
        slot = { label: line.label, section, bucket: line.bucket, byYear: new Map() };
        slots.set(key, slot);
      }
      const arr = slot.byYear.get(y.year) ?? [];
      arr.push(line);
      slot.byYear.set(y.year, arr);
    }
  }
  return { sections, slots };
}

function slotRow(slot: Slot, years: number[]): ReconRow {
  return {
    key: `line:${normalizeLabel(slot.label)}`,
    label: slot.label,
    kind: "line",
    bucket: slot.bucket,
    cells: years.map((y) => {
      const lines = slot.byYear.get(y);
      if (!lines || lines.length === 0) return { amount: null };
      const cents = sumCents(lines.map((l) => toCents(l.amount)));
      const note = lineNote(lines, slot.bucket);
      return note === undefined ? { amount: toDollars(cents) } : { amount: toDollars(cents), note };
    }),
  };
}

function subtotalRow(key: string, label: string, rows: ReconRow[], years: number[]): ReconRow {
  return {
    key,
    label,
    kind: "subtotal",
    cells: years.map((_, i) => {
      const vals = rows.map((r) => r.cells[i]!.amount).filter((v): v is number => v !== null);
      return vals.length === 0 ? { amount: null } : { amount: toDollars(sumCents(vals.map(toCents))) };
    }),
  };
}

/**
 * Build the table model. `result` is optional: without it the share row falls
 * back to whatever the statement itself declares.
 */
export function buildReconModel(pkg: ReconPackage, result?: ScanResult | null): ReconTableModel {
  const years = [...pkg.years].sort((a, b) => a.year - b.year);
  const ys = years.map((y) => y.year);
  const blocks: ReconBlock[] = [];

  // 1 — statement basis.
  const metaRows: ReconRow[] = [];
  if (years.some((y) => y.occupancy_pct !== undefined)) {
    metaRows.push({
      key: "meta:occupancy",
      label: "Average occupancy",
      kind: "meta",
      cells: years.map((y) => (y.occupancy_pct === undefined ? { amount: null } : { amount: null, text: `${num(y.occupancy_pct, 2)}%` })),
    });
  }
  if (years.some((y) => y.denominator_sf !== undefined)) {
    metaRows.push({
      key: "meta:denominator",
      label: "Share denominator",
      kind: "meta",
      cells: years.map((y) => (y.denominator_sf === undefined ? { amount: null } : { amount: null, text: `${num(y.denominator_sf, 0)} sf` })),
    });
  }
  if (years.some((y) => y.gross_up_applied !== undefined)) {
    metaRows.push({
      key: "meta:grossup",
      label: "Gross-up applied",
      kind: "meta",
      cells: years.map((y) => (y.gross_up_applied === undefined ? { amount: null } : { amount: null, text: y.gross_up_applied ? "yes" : "no" })),
    });
  }
  if (metaRows.length) blocks.push({ id: "meta", title: "Statement basis", rows: metaRows });

  // 2 — expense body, by the statement's own sections.
  const expenses = collect(years, (l) => !l.is_fee);
  for (const section of expenses.sections) {
    const rows = [...expenses.slots.values()].filter((s) => s.section === section).map((s) => slotRow(s, ys));
    if (rows.length === 0) continue;
    rows.push(subtotalRow(`subtotal:${normalizeLabel(section) || section.toLowerCase()}`, `${section} subtotal`, rows, ys));
    blocks.push({ id: `section:${section}`, title: section, rows });
  }

  // 3 — fees, kept apart: the cap's fee treatment turns on them.
  const feeSlots = [...collect(years, (l) => l.is_fee === true).slots.values()];
  if (feeSlots.length) {
    const rows = feeSlots.map((s) => slotRow(s, ys));
    if (rows.length > 1) rows.push(subtotalRow("subtotal:fees", "Fees subtotal", rows, ys));
    blocks.push({ id: "fees", title: "Fees", rows });
  }

  // Everything the landlord put on the statement, at property level.
  const allRows = [...expenses.slots.values(), ...feeSlots].map((s) => slotRow(s, ys));
  if (allRows.length) {
    blocks.push({
      id: "total",
      title: "Total",
      rows: [{ ...subtotalRow("total:pool", "Total property-level expenses", allRows, ys), kind: "total" as const }],
    });
  }

  // 4 — the landlord's own cap computation, where the statement shows one.
  const capPoolLabels: string[] = [];
  for (const y of years) {
    const l = y.cap_summary?.pool_label;
    if (l) {
      const n = normalizeLabel(l);
      if (!capPoolLabels.includes(n)) capPoolLabels.push(n);
    }
  }
  if (years.some((y) => y.cap_summary)) {
    const capRows: ReconRow[] = [];
    if (years.some((y) => y.cap_summary?.pool_label)) {
      capRows.push({
        key: "cap:label",
        label: "Pool as labeled",
        kind: "cap",
        cells: years.map((y) => (y.cap_summary?.pool_label ? { amount: null, text: y.cap_summary.pool_label } : { amount: null })),
      });
    }
    capRows.push({
      key: "cap:actual",
      label: "Capped pool — actual",
      kind: "cap",
      cells: years.map((y) => (y.cap_summary ? { amount: y.cap_summary.pool_actual } : { amount: null })),
    });
    if (years.some((y) => y.cap_summary?.pool_allowed !== undefined)) {
      capRows.push({
        key: "cap:allowed",
        label: "Cap for the year, as stated",
        kind: "cap",
        cells: years.map((y) => (y.cap_summary?.pool_allowed === undefined ? { amount: null } : { amount: y.cap_summary.pool_allowed })),
      });
    }
    capRows.push({
      key: "cap:billed",
      label: "Capped pool — billed",
      kind: "cap",
      cells: years.map((y) => (y.cap_summary ? { amount: y.cap_summary.pool_billed } : { amount: null })),
    });
    blocks.push({ id: "cap", title: "Capped pool", rows: capRows });
  }

  // 5 — what reached the tenant.
  const share = result?.share_by_year ?? {};
  const tenantRows: ReconRow[] = [];
  if (years.some((y) => y.tenant_summary?.pro_rata_share_pct !== undefined || share[y.year])) {
    tenantRows.push({
      key: "share",
      label: "Pro-rata share",
      kind: "tenant",
      cells: years.map((y) => {
        const billed = y.tenant_summary?.pro_rata_share_pct;
        const engine = share[y.year];
        if (billed === undefined && !engine) return { amount: null };
        const text = `${num(billed ?? engine!.pct, 4)}%`;
        const note = billed === undefined ? `${engine!.source} by the scanner` : engine && Math.abs(engine.pct - billed) > 0.0001 ? `scanner: ${num(engine.pct, 4)}% (${engine.source})` : "as billed";
        return { amount: null, text, note };
      }),
    });
  }
  const tenantField = (key: string, label: string, get: (y: ReconYear) => number | undefined) => {
    if (!years.some((y) => get(y) !== undefined)) return;
    tenantRows.push({
      key,
      label,
      kind: "tenant",
      cells: years.map((y) => {
        const v = get(y);
        return v === undefined ? { amount: null } : { amount: v };
      }),
    });
  };
  tenantField("tenant-total", "Tenant total", (y) => y.tenant_summary?.tenant_total);
  tenantField("estimates", "Estimates paid", (y) => y.tenant_summary?.estimates_paid);
  tenantField("balance", "Balance due", (y) => y.tenant_summary?.balance_due);
  if (tenantRows.length) blocks.push({ id: "tenant", title: "Tenant", rows: tenantRows });

  return { package_id: pkg.meta.package_id, years: ys, blocks, capPoolLabels };
}

// ---------------------------------------------------------------------------
// Finding → rows
// ---------------------------------------------------------------------------

/**
 * The rows a finding is about, in table order. Empty when the finding's
 * category names nothing the table shows — the caller hides the affordance
 * rather than guessing at a row.
 */
export function rowKeysForFinding(f: Finding, model: ReconTableModel): string[] {
  const present = new Set<string>();
  for (const b of model.blocks) for (const r of b.rows) present.add(r.key);
  const want = new Set<string>();
  const add = (k: string) => {
    if (present.has(k)) want.add(k);
  };

  const category = (f.category ?? "").trim();
  if (category) {
    const n = normalizeLabel(category);
    if (n === "pro rata share") {
      add("share");
      add("meta:denominator");
    } else if (n === "tenant total" || n === "tenant allocation") {
      add("tenant-total");
      add("share");
    } else if (n === "balance due") {
      add("balance");
      add("estimates");
    } else if (n === "capped pool" || model.capPoolLabels.includes(n)) {
      add("cap:actual");
      add("cap:allowed");
      add("cap:billed");
    } else {
      // RF-07 names a composite base as "Label A + Label B".
      for (const part of category.split(" + ")) add(`line:${normalizeLabel(part)}`);
    }
  }
  if (f.check_id === "RF-10") {
    add("meta:occupancy");
    add("meta:grossup");
  }

  const out: string[] = [];
  for (const b of model.blocks) for (const r of b.rows) if (want.has(r.key) && !out.includes(r.key)) out.push(r.key);
  return out;
}

/** The years a finding covers, as table columns. */
export function yearsOfFinding(f: Finding): number[] {
  return Array.isArray(f.year) ? [...f.year] : [f.year];
}
