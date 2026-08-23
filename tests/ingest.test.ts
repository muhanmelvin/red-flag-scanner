/**
 * Upload path: a messy, real-shaped workbook round-trips into a scannable
 * package — title rows, blank rows, section header rows, "$1,234.56" strings,
 * parentheses negatives, a Total row that must be skipped.
 */

import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { buildPackage, detectHeader, extractLines, guessColumns, inferBucket, parseSheet, readWorkbook, toNumber } from "../src/ingest/parse.ts";
import { scan } from "../src/engine/scan.ts";

function messyWorkbook(): Uint8Array {
  const rows: (string | number | null)[][] = [
    ["Maple Plaza — Annual Reconciliation of Operating Expenses", null, null, null],
    ["Prepared by the landlord's property accountant", null, null, null],
    [null, null, null, null],
    ["Expense", "Section", "2023 Actual", "2024 Actual"],
    ["Controllable CAM", null, null, null],
    ["Landscaping & grounds", null, "$15,118.40", "$14,362.18"],
    ["R&M", null, 26402.75, 21880.12],
    ["Security", null, "17,638.90", "18,204.00"],
    ["  Subtotal controllable", null, 59160.05, 54446.3],
    ["Non-controllable CAM", null, null, null],
    ["Snow removal", null, 13870.15, 15212.4],
    ["Credit — insurance recovery", null, "(1,250.00)", "(980.00)"],
    ["Fees", null, null, null],
    ["Management fee (3%)", "Fees", 8183.11, 8347.83],
    ["Real estate taxes", "Taxes", 108412.6, 112318.92],
    ["Insurance", "Insurance", 49266.8, 53118.44],
    ["Total", null, 237641.71, 245300.89],
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Recon");
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
}

describe("ingest: messy XLSX → package", () => {
  const bytes = messyWorkbook();
  const { workbook, sheetNames } = readWorkbook(bytes, "statement.xlsx");
  const sheet = parseSheet(workbook, sheetNames[0]!, sheetNames);

  it("finds the header row below the title rows and guesses columns", () => {
    expect(sheet.headerRow).toBe(2); // blank rows are dropped by the reader
    const roles = sheet.columns.map((c) => c.role);
    expect(roles[0]).toEqual({ kind: "label" });
    expect(roles[1]).toEqual({ kind: "section" });
    expect(roles[2]).toEqual({ kind: "amount", year: 2023 });
    expect(roles[3]).toEqual({ kind: "amount", year: 2024 });
    expect(sheet.warnings).toEqual([]);
  });

  it("extracts lines, carries section headers, parses money strings, skips subtotals/totals", () => {
    const { lines } = extractLines(sheet.grid, sheet.headerRow, sheet.columns);
    const byLabel = Object.fromEntries(lines.map((l) => [l.label, l]));
    expect(Object.keys(byLabel)).toEqual(["Landscaping & grounds", "R&M", "Security", "Snow removal", "Credit — insurance recovery", "Management fee (3%)", "Real estate taxes", "Insurance"]);
    expect(byLabel["Landscaping & grounds"]!.amounts).toEqual({ 2023: 15118.4, 2024: 14362.18 });
    expect(byLabel["Landscaping & grounds"]!.section).toBe("Controllable CAM");
    expect(byLabel["Landscaping & grounds"]!.bucket).toBe("controllable");
    expect(byLabel["Snow removal"]!.section).toBe("Non-controllable CAM");
    expect(byLabel["Snow removal"]!.bucket).toBe("non_controllable");
    expect(byLabel["Credit — insurance recovery"]!.amounts[2023]).toBe(-1250);
    expect(byLabel["Management fee (3%)"]!.is_fee).toBe(true);
    expect(byLabel["Management fee (3%)"]!.section).toBe("Fees");
    expect(byLabel["Real estate taxes"]!.bucket).toBe("non_controllable");
  });

  it("builds a package that scans and finds the planted fee base error", () => {
    const { lines } = extractLines(sheet.grid, sheet.headerRow, sheet.columns);
    const pkg = buildPackage(lines, { tenant_name: "T", property_name: "Maple Plaza", premises_sf: 24_000, denominator_sf: 168_000, billed_pct: 14.2857, fee: { kind: "management", rate_pct: 3, base: "cam_only" } }, "UP-1");
    expect(pkg.years.map((y) => y.year)).toEqual([2023, 2024]);
    const r = scan(pkg);
    const fee = r.findings.filter((f) => f.check_id === "RF-07" && f.severity === "high");
    expect(fee).toHaveLength(2);
  });
});

describe("ingest helpers", () => {
  it("toNumber handles $, commas, parentheses, blanks", () => {
    expect(toNumber("$1,234.56")).toBe(1234.56);
    expect(toNumber("(1,250.00)")).toBe(-1250);
    expect(toNumber("")).toBeNull();
    expect(toNumber("n/a")).toBeNull();
    expect(toNumber(12)).toBe(12);
  });
  it("inferBucket reads bucket cells, sections and labels", () => {
    expect(inferBucket("Landscaping", "Controllable CAM")).toBe("controllable");
    expect(inferBucket("Landscaping", "CAM", "Non-controllable")).toBe("non_controllable");
    expect(inferBucket("Real estate taxes", "")).toBe("non_controllable");
    expect(inferBucket("Mystery", "")).toBe("unknown");
  });
  it("detectHeader and guessColumns cope with a CSV-like single-year sheet", () => {
    const grid = [["Line item", "Amount"], ["Landscaping", 100], ["Taxes", 200]];
    expect(detectHeader(grid)).toBe(0);
    const cols = guessColumns(grid, 0);
    expect(cols[0]!.role.kind).toBe("label");
    expect(cols[1]!.role.kind).toBe("amount");
  });
  it("CSV input parses the same way", () => {
    const csv = "Line item,Section,2023,2024\nLandscaping,CAM,100,110\nTaxes,Taxes,500,520\n";
    const { workbook, sheetNames } = readWorkbook(new TextEncoder().encode(csv), "x.csv");
    const sheet = parseSheet(workbook, sheetNames[0]!, sheetNames);
    const { lines } = extractLines(sheet.grid, sheet.headerRow, sheet.columns);
    expect(lines).toHaveLength(2);
    expect(lines[0]!.amounts).toEqual({ 2023: 100, 2024: 110 });
  });
});
