/**
 * The statement view is a reading of the package, not a second opinion on it:
 * these tests pin the columns, the cent-exact subtotals, the visible gaps, and
 * the finding→row mapping that makes "Show in statement" trustworthy.
 */

import { describe, expect, it } from "vitest";
import { buildReconModel, rowKeysForFinding, yearsOfFinding } from "../src/ui/recon-model.ts";
import type { ReconBlock, ReconRow, ReconTableModel } from "../src/ui/recon-model.ts";
import type { Finding, ReconPackage } from "../src/engine/types.ts";
import { scan } from "../src/engine/scan.ts";
import { packageById } from "../src/data/index.ts";
import { L, P, Y, LEASE_CAP } from "./fixtures.ts";

const MWB = packageById("MW-B")!;
const MWC = packageById("MW-C")!;

function rows(model: ReconTableModel): ReconRow[] {
  return model.blocks.flatMap((b: ReconBlock) => b.rows);
}
function row(model: ReconTableModel, key: string): ReconRow {
  const r = rows(model).find((x) => x.key === key);
  if (!r) throw new Error(`no row ${key}; have ${rows(model).map((x) => x.key).join(", ")}`);
  return r;
}
function findingBy(pkg: ReconPackage, pred: (f: Finding) => boolean): Finding {
  const f = scan(pkg).findings.find(pred);
  if (!f) throw new Error("no such finding");
  return f;
}

describe("buildReconModel — columns and structure", () => {
  it("one column per year, ascending, even when the package is unsorted", () => {
    const pkg = P([Y(2025, [L("Landscaping", 100)]), Y(2023, [L("Landscaping", 90)])]);
    expect(buildReconModel(pkg).years).toEqual([2023, 2025]);
  });

  it("groups lines under the statement's own sections, in first-appearance order", () => {
    const model = buildReconModel(MWB, scan(MWB));
    const sectionBlocks = model.blocks.filter((b) => b.id.startsWith("section:")).map((b) => b.title);
    expect(sectionBlocks).toEqual(["CAM", "Taxes", "Insurance"]);
  });

  it("a line that appears in only one year leaves a visible gap in the others", () => {
    const pkg = P([Y(2023, [L("Landscaping", 100)]), Y(2024, [L("Landscaping", 110), L("Security patrol", 50)])]);
    const model = buildReconModel(pkg);
    expect(row(model, "line:security patrol").cells.map((c) => c.amount)).toEqual([null, 50]);
  });

  it("matches a line across years through label normalization", () => {
    const pkg = P([Y(2023, [L("Repairs & Maintenance", 100)]), Y(2024, [L("Repairs and maintenance", 120)])]);
    const model = buildReconModel(pkg);
    const matched = rows(model).filter((r) => r.key === "line:repairs maintenance");
    expect(matched).toHaveLength(1);
    expect(matched[0]!.cells.map((c) => c.amount)).toEqual([100, 120]);
  });
});

describe("buildReconModel — arithmetic", () => {
  it("section subtotals are cent-exact over floats that would drift", () => {
    const pkg = P([Y(2023, [L("A", 0.1), L("B", 0.2)])]);
    const model = buildReconModel(pkg);
    expect(row(model, "subtotal:cam").cells[0]!.amount).toBe(0.3);
  });

  it("the total row covers fee lines as well as expense lines", () => {
    const pkg = P([Y(2023, [L("Landscaping", 1000), L("Management fee", 30, { section: "Fees", is_fee: true })])]);
    const model = buildReconModel(pkg);
    expect(row(model, "subtotal:cam").cells[0]!.amount).toBe(1000);
    expect(row(model, "total:pool").cells[0]!.amount).toBe(1030);
  });

  it("MW-B's CAM subtotal equals the sum of its CAM lines, to the cent", () => {
    const model = buildReconModel(MWB, scan(MWB));
    const y0 = MWB.years[0]!;
    const expected = y0.lines.filter((l) => l.section === "CAM" && !l.is_fee).reduce((s, l) => s + Math.round(l.amount * 100), 0) / 100;
    expect(row(model, "subtotal:cam").cells[0]!.amount).toBe(expected);
  });

  it("keeps fee lines out of the expense sections and in their own block", () => {
    const model = buildReconModel(MWB, scan(MWB));
    const fees = model.blocks.find((b) => b.id === "fees")!;
    expect(fees.rows.map((r) => r.label)).toEqual(["Management fee (3%)"]);
    const cam = model.blocks.find((b) => b.id === "section:CAM")!;
    expect(cam.rows.some((r) => /management fee/i.test(r.label))).toBe(false);
  });

  it("carries capital and gross-up detail as cell notes", () => {
    const model = buildReconModel(MWC, scan(MWC));
    const notes = rows(model).flatMap((r) => r.cells.map((c) => c.note ?? ""));
    expect(notes.some((n) => /grossed up from/.test(n))).toBe(true);
  });
});

describe("buildReconModel — blocks appear only when the statement has the data", () => {
  it("MW-B shows the cap block and the tenant block", () => {
    const model = buildReconModel(MWB, scan(MWB));
    const ids = model.blocks.map((b) => b.id);
    expect(ids).toContain("cap");
    expect(ids).toContain("tenant");
    expect(row(model, "cap:billed").cells.map((c) => c.amount)).toEqual(MWB.years.map((y) => y.cap_summary!.pool_billed));
    expect(row(model, "balance").cells.map((c) => c.amount)).toEqual(MWB.years.map((y) => y.tenant_summary!.balance_due));
  });

  it("a statement with no cap summary and no tenant summary shows neither block", () => {
    const pkg: ReconPackage = {
      ...P([{ year: 2023, lines: [L("Landscaping", 100)] }]),
      lease_lite: LEASE_CAP,
    };
    const model = buildReconModel(pkg);
    expect(model.blocks.map((b) => b.id)).not.toContain("cap");
    expect(model.blocks.map((b) => b.id)).not.toContain("tenant");
  });

  it("the statement-basis band lists only the facts the statement states", () => {
    const bare = buildReconModel(P([{ year: 2023, lines: [L("Landscaping", 100)] }]));
    expect(bare.blocks.map((b) => b.id)).not.toContain("meta");
    const full = buildReconModel(MWC, scan(MWC));
    const meta = full.blocks.find((b) => b.id === "meta")!;
    expect(meta.rows.map((r) => r.key)).toContain("meta:occupancy");
    expect(meta.rows.map((r) => r.key)).toContain("meta:denominator");
  });
});

describe("rowKeysForFinding", () => {
  const modelB = buildReconModel(MWB, scan(MWB));
  const modelC = buildReconModel(MWC, scan(MWC));

  it("a cap finding points at the cap block, by the landlord's own pool label", () => {
    const f = findingBy(MWB, (x) => x.check_id === "RF-06" && !Array.isArray(x.year));
    expect(f.category).toBe("Controllable CAM (subject to 5% cap)");
    expect(rowKeysForFinding(f, modelB)).toEqual(["cap:actual", "cap:allowed", "cap:billed"]);
  });

  it("a line finding points at that line's row", () => {
    const f = findingBy(MWB, (x) => x.check_id === "RF-01");
    expect(rowKeysForFinding(f, modelB)).toEqual([`line:${"repairs maintenance"}`]);
  });

  it("a fee finding points at the fee row", () => {
    const f = findingBy(MWB, (x) => x.check_id === "RF-07");
    expect(rowKeysForFinding(f, modelB)).toContain("line:management fee");
  });

  it("a composite fee base splits on ' + ' and points at both lines", () => {
    const model = buildReconModel(P([Y(2023, [L("Landscaping", 100), L("Security", 50)])]));
    const f = { check_id: "RF-07", category: "Landscaping + Security" } as Finding;
    expect(rowKeysForFinding(f, model)).toEqual(["line:landscaping", "line:security"]);
  });

  it("share, tenant-total and balance findings point at the tenant block", () => {
    const share = { check_id: "RF-08", category: "Pro-rata share" } as Finding;
    expect(rowKeysForFinding(share, modelC)).toEqual(["meta:denominator", "share"]);
    const total = { check_id: "RF-11", category: "Tenant allocation" } as Finding;
    expect(rowKeysForFinding(total, modelC)).toEqual(["share", "tenant-total"]);
    const bal = { check_id: "RF-11", category: "Balance due" } as Finding;
    expect(rowKeysForFinding(bal, modelC)).toEqual(["estimates", "balance"]);
  });

  it("a gross-up finding adds the occupancy and gross-up basis rows", () => {
    const f = findingBy(MWC, (x) => x.check_id === "RF-10");
    const keys = rowKeysForFinding(f, modelC);
    expect(keys).toContain("meta:occupancy");
    expect(keys.some((k) => k.startsWith("line:"))).toBe(true);
  });

  it("returns nothing rather than guessing when the category names no row", () => {
    expect(rowKeysForFinding({ check_id: "RF-01", category: "Nothing on this statement" } as Finding, modelB)).toEqual([]);
    expect(rowKeysForFinding({ check_id: "RF-01" } as Finding, modelB)).toEqual([]);
  });

  it("every key it returns exists in the model", () => {
    const keys = new Set(rows(modelB).map((r) => r.key));
    for (const f of scan(MWB).findings) for (const k of rowKeysForFinding(f, modelB)) expect(keys.has(k)).toBe(true);
  });

  it("yearsOfFinding covers single years and year pairs", () => {
    expect(yearsOfFinding({ year: 2024 } as Finding)).toEqual([2024]);
    expect(yearsOfFinding({ year: [2024, 2025] } as Finding)).toEqual([2024, 2025]);
  });
});

describe("determinism and non-mutation", () => {
  it("same package, deep-equal model", () => {
    expect(buildReconModel(MWB, scan(MWB))).toEqual(buildReconModel(MWB, scan(MWB)));
  });

  it("never touches the package it reads", () => {
    const before = JSON.stringify(MWC);
    buildReconModel(MWC, scan(MWC));
    expect(JSON.stringify(MWC)).toBe(before);
  });
});
