/**
 * XLSX/CSV → canonical ReconPackage, in two explicit steps:
 *   1. parseWorkbook(): bytes → a grid + a best-guess column mapping
 *   2. buildPackage(): grid + confirmed mapping + lease-lite form → ReconPackage
 * Nothing here is silent: the mapping is shown to the user and confirmed.
 * Pure functions (no DOM) so they are unit-testable in node.
 */

import * as XLSX from "xlsx";
import type { Bucket, LeaseLite, ReconLine, ReconPackage, ReconYear } from "../engine/types.ts";
import { normalizeLabel } from "../engine/normalize.ts";

export type Cell = string | number | boolean | null;
export type Grid = Cell[][];

export type ColumnRole = { kind: "ignore" } | { kind: "label" } | { kind: "section" } | { kind: "bucket" } | { kind: "amount"; year: number };

export interface ColumnGuess {
  index: number;
  header: string;
  role: ColumnRole;
  sample: string; // first few non-empty values, for the mapping screen
}

export interface ParsedSheet {
  sheetName: string;
  sheetNames: string[];
  grid: Grid;
  headerRow: number; // index into grid
  columns: ColumnGuess[];
  warnings: string[];
}

const YEAR_RE = /\b(19[89]\d|20\d\d)\b/;

export function readWorkbook(data: ArrayBuffer | Uint8Array, filename: string): { workbook: XLSX.WorkBook; sheetNames: string[] } {
  const isCsv = /\.csv$/i.test(filename);
  const workbook = XLSX.read(data, { type: "array", raw: false, cellDates: false, ...(isCsv ? { FS: "," } : {}) });
  return { workbook, sheetNames: workbook.SheetNames };
}

export function sheetToGrid(workbook: XLSX.WorkBook, sheetName: string): Grid {
  const ws = workbook.Sheets[sheetName];
  if (!ws) throw new Error(`sheet "${sheetName}" not found`);
  const rows = XLSX.utils.sheet_to_json<Cell[]>(ws, { header: 1, raw: true, defval: null, blankrows: false });
  return rows.map((r) => r.map((c) => (typeof c === "string" ? c.trim() : c)));
}

function looksNumeric(c: Cell): boolean {
  if (typeof c === "number") return Number.isFinite(c);
  if (typeof c === "string") return /^\(?-?\$?\s?[\d,]+(\.\d+)?\)?$/.test(c.replace(/\s/g, "")) && /\d/.test(c);
  return false;
}

export function toNumber(c: Cell): number | null {
  if (typeof c === "number") return Number.isFinite(c) ? c : null;
  if (typeof c !== "string") return null;
  let s = c.replace(/[$,\s]/g, "");
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (s === "" || s === "-") return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

function yearOf(c: Cell): number | null {
  if (typeof c === "number" && Number.isInteger(c) && c >= 1980 && c <= 2100) return c;
  if (typeof c === "string") {
    const m = YEAR_RE.exec(c);
    if (m) return Number(m[1]);
  }
  return null;
}

/**
 * Find the header row: within the first 10 rows, the row with the most
 * year-like cells plus at least one text cell. Falls back to the first row
 * with ≥ 2 non-empty cells.
 */
export function detectHeader(grid: Grid): number {
  let best = -1;
  let bestScore = 0;
  for (let r = 0; r < Math.min(10, grid.length); r++) {
    const row = grid[r]!;
    const years = row.filter((c) => yearOf(c) !== null).length;
    const texts = row.filter((c) => typeof c === "string" && c.length > 0 && yearOf(c) === null).length;
    const score = years * 2 + (texts > 0 ? 1 : 0);
    if (years >= 1 && texts >= 1 && score > bestScore) { best = r; bestScore = score; }
  }
  if (best >= 0) return best;
  for (let r = 0; r < Math.min(10, grid.length); r++) if (grid[r]!.filter((c) => c !== null && c !== "").length >= 2) return r;
  return 0;
}

export function guessColumns(grid: Grid, headerRow: number): ColumnGuess[] {
  const header = grid[headerRow] ?? [];
  const body = grid.slice(headerRow + 1);
  const ncol = Math.max(header.length, ...body.map((r) => r.length));
  const guesses: ColumnGuess[] = [];
  let labelAssigned = false;
  for (let c = 0; c < ncol; c++) {
    const head = header[c];
    const headStr = head === null || head === undefined ? "" : String(head);
    const values = body.map((r) => r[c] ?? null).filter((v) => v !== null && v !== "");
    const numeric = values.filter(looksNumeric).length;
    const texty = values.filter((v) => typeof v === "string" && !looksNumeric(v)).length;
    const sample = values.slice(0, 3).map((v) => String(v)).join(" · ");
    const hn = normalizeLabel(headStr);
    let role: ColumnRole = { kind: "ignore" };
    const year = yearOf(head ?? null);
    if (year !== null && numeric >= Math.max(1, values.length * 0.5)) role = { kind: "amount", year };
    else if (/\bsection\b|\bgroup\b|\bcategory\b/.test(hn)) role = { kind: "section" };
    else if (/\bbucket\b|\bclass(ification)?\b|\bcontrollable\b/.test(hn)) role = { kind: "bucket" };
    else if (!labelAssigned && texty >= Math.max(1, values.length * 0.5) && (/\bline\b|\bitem\b|\blabel\b|\bdescription\b|\bexpense\b|\baccount\b/.test(hn) || texty > numeric)) {
      role = { kind: "label" };
      labelAssigned = true;
    } else if (numeric >= Math.max(1, values.length * 0.5) && /amount|total|actual/.test(hn)) {
      // A single amount column without a year: ask the user for the year (default: current-1).
      role = { kind: "amount", year: new Date().getFullYear() - 1 };
    }
    guesses.push({ index: c, header: headStr || `Column ${String.fromCharCode(65 + (c % 26))}`, role, sample });
  }
  if (!labelAssigned) {
    // No obvious label column: take the first text-dominant column.
    const first = guesses.find((g) => g.role.kind === "ignore" && body.some((r) => typeof r[g.index] === "string"));
    if (first) first.role = { kind: "label" };
  }
  return guesses;
}

export function parseSheet(workbook: XLSX.WorkBook, sheetName: string, sheetNames: string[]): ParsedSheet {
  const grid = sheetToGrid(workbook, sheetName);
  const warnings: string[] = [];
  if (grid.length < 2) warnings.push("The sheet has fewer than two rows.");
  const headerRow = detectHeader(grid);
  const columns = guessColumns(grid, headerRow);
  if (!columns.some((c) => c.role.kind === "label")) warnings.push("No label column detected — pick one below.");
  if (!columns.some((c) => c.role.kind === "amount")) warnings.push("No amount column detected — the template uses one column per year, headed by the year.");
  return { sheetName, sheetNames, grid, headerRow, columns, warnings };
}

// ---------------------------------------------------------------------------
// Step 2: grid + confirmed mapping → lines per year
// ---------------------------------------------------------------------------

export interface DraftLine {
  label: string;
  section: string;
  bucket: Bucket;
  is_fee: boolean;
  amounts: Record<number, number>; // year → pool amount
}

const FEE_RE = /\b(management|administrative|admin|supervisory|overhead) fees?\b/;
const TAX_RE = /\btax(es)?\b/;
const INS_RE = /\binsurance\b/;
const NONCTL_RE = /non ?controllable|uncontrollable|not controllable/;
const CTL_RE = /\bcontrollable\b/;

export function inferBucket(label: string, section: string, bucketCell?: Cell): Bucket {
  const b = bucketCell === null || bucketCell === undefined ? "" : normalizeLabel(String(bucketCell));
  if (b) {
    if (NONCTL_RE.test(b)) return "non_controllable";
    if (CTL_RE.test(b)) return "controllable";
  }
  const s = normalizeLabel(section);
  const l = normalizeLabel(label);
  if (NONCTL_RE.test(s) || NONCTL_RE.test(l)) return "non_controllable";
  if (CTL_RE.test(s)) return "controllable";
  if (TAX_RE.test(s) || INS_RE.test(s) || TAX_RE.test(l) || INS_RE.test(l)) return "non_controllable";
  if (/\butilit|\belectric|\bsnow\b/.test(l)) return "non_controllable";
  return "unknown";
}

export function extractLines(grid: Grid, headerRow: number, columns: ColumnGuess[]): { lines: DraftLine[]; warnings: string[] } {
  const labelCol = columns.find((c) => c.role.kind === "label")?.index;
  const sectionCol = columns.find((c) => c.role.kind === "section")?.index;
  const bucketCol = columns.find((c) => c.role.kind === "bucket")?.index;
  const amountCols = columns.filter((c): c is ColumnGuess & { role: { kind: "amount"; year: number } } => c.role.kind === "amount");
  const warnings: string[] = [];
  if (labelCol === undefined) throw new Error("Choose a label column.");
  if (amountCols.length === 0) throw new Error("Choose at least one amount column and give it a year.");
  const years = amountCols.map((c) => c.role.year);
  if (new Set(years).size !== years.length) throw new Error("Two amount columns carry the same year.");

  const lines: DraftLine[] = [];
  let currentSection = "";
  for (let r = headerRow + 1; r < grid.length; r++) {
    const row = grid[r]!;
    const rawLabel = row[labelCol];
    const label = rawLabel === null || rawLabel === undefined ? "" : String(rawLabel).trim();
    const amounts: Record<number, number> = {};
    let any = false;
    for (const c of amountCols) {
      const v = toNumber(row[c.index] ?? null);
      if (v !== null) { amounts[c.role.year] = v; any = true; }
    }
    if (!label && !any) continue;
    const nl = normalizeLabel(label);
    if (!any) {
      // A label with no amounts is a section header (e.g. "Controllable CAM").
      if (label && !/^total/.test(nl)) currentSection = label;
      continue;
    }
    if (/^(sub)?total\b|^grand total|^tenant/.test(nl)) continue; // never scan the landlord's own subtotals as lines
    if (!label) { warnings.push(`Row ${r + 1} has amounts but no label; skipped.`); continue; }
    const section = sectionCol !== undefined && row[sectionCol] ? String(row[sectionCol]) : currentSection || "Operating expenses";
    const bucket = inferBucket(label, section, bucketCol !== undefined ? row[bucketCol] : undefined);
    lines.push({ label, section, bucket, is_fee: FEE_RE.test(nl), amounts });
  }
  if (lines.length === 0) throw new Error("No expense lines found under the header row.");
  return { lines, warnings };
}

export interface LeaseForm {
  tenant_name: string;
  property_name: string;
  premises_sf: number;
  denominator_sf?: number;
  stated_pct?: number;
  billed_pct?: number;
  cap?: NonNullable<LeaseLite["cap"]>;
  fee?: LeaseLite["fees"][number];
  capital_threshold?: number;
  capital_life_years?: number;
  gross_up?: LeaseLite["gross_up"];
}

export function buildPackage(lines: DraftLine[], form: LeaseForm, packageId = "UPLOAD"): ReconPackage {
  const years = [...new Set(lines.flatMap((l) => Object.keys(l.amounts).map(Number)))].sort((a, b) => a - b);
  const reconYears: ReconYear[] = years.map((year) => {
    const ls: ReconLine[] = lines
      .filter((l) => l.amounts[year] !== undefined)
      .map((l) => {
        const line: ReconLine = { label: l.label, section: l.section, bucket: l.bucket, amount: Math.round(l.amounts[year]! * 100) / 100 };
        if (l.is_fee) line.is_fee = true;
        return line;
      });
    const y: ReconYear = { year, lines: ls };
    if (form.denominator_sf) y.denominator_sf = form.denominator_sf;
    if (form.billed_pct) y.tenant_summary = { pro_rata_share_pct: form.billed_pct };
    return y;
  });
  const lease: LeaseLite = {
    share: { numerator_sf: form.premises_sf, denominator_basis: "unknown", ...(form.stated_pct ? { stated_pct: form.stated_pct } : {}) },
    fees: form.fee ? [form.fee] : [],
  };
  if (form.cap) lease.cap = form.cap;
  if (form.capital_threshold) lease.capital_threshold = form.capital_threshold;
  if (form.capital_life_years) lease.capital_life_years = form.capital_life_years;
  if (form.gross_up) lease.gross_up = form.gross_up;
  return {
    meta: {
      package_id: packageId,
      property_name: form.property_name || "Uploaded statement",
      tenant_name: form.tenant_name || "Tenant",
      premises_sf: form.premises_sf,
      currency: "USD",
      schema_version: "1.0",
      story: "Uploaded in this browser session. Parsed and scanned locally; nothing was sent anywhere.",
    },
    lease_lite: lease,
    years: reconYears,
  };
}
