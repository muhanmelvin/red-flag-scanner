import { describe, expect, it } from "vitest";
import { dice, matchLines, normalizeLabel } from "../src/engine/normalize.ts";
import { L } from "./fixtures.ts";

describe("normalizeLabel", () => {
  it.each([
    ["R&M", "repairs maintenance"],
    ["Repairs & Maintenance", "repairs maintenance"],
    ["Repair and maint.", "repairs maintenance"],
    ["Mgmt Fee (3%)", "management fee"],
    ["Management fee (3%)", "management fee"],
    ["Admin fee", "administrative fee"],
    ["Snow", "snow removal"],
    ["Snow plowing", "snow removal"],
    ["Snow & ice removal", "snow removal"],
    ["RE Taxes", "real estate taxes"],
    ["Real Estate Tax", "real estate taxes"],
    ["Property tax", "real estate taxes"],
    ["Parking Lot Repairs", "parking repairs"],
    ["Parking lot repair", "parking repairs"],
    ["Contract services – cleaning", "contract cleaning"],
    ["Parking lot resurfacing – amortization (yr 2 of 10)", "parking resurfacing amortization"],
    ["Parking lot resurfacing – amortization (yr 3 of 10)", "parking resurfacing amortization"],
    ["  Landscaping   &  Grounds ", "landscaping grounds"],
  ])("%s → %s", (input, expected) => {
    expect(normalizeLabel(input)).toBe(expected);
  });

  it("is idempotent", () => {
    for (const s of ["R&M", "Mgmt Fee (3%)", "Snow plowing", "Common area lighting – electricity"]) {
      const once = normalizeLabel(s);
      expect(normalizeLabel(once)).toBe(once);
    }
  });
});

describe("dice", () => {
  it("is 1 for identical, 0 for disjoint", () => {
    expect(dice("security", "security")).toBe(1);
    expect(dice("abc", "xyz")).toBe(0);
  });
  it("treats near-identical strings as similar", () => {
    expect(dice("parking repairs", "parking repair")).toBeGreaterThan(0.8);
    expect(dice("security", "life safety patrol")).toBeLessThan(0.5);
  });
});

describe("matchLines", () => {
  it("pairs exact, label-only and similar labels; reports vanished and appeared", () => {
    const prev = [L("Security", 100), L("Landscaping & grounds", 200), L("Parking Lot Repairs", 300, { section: "CAM" }), L("Gone", 50)];
    const curr = [L("Security", 110, { section: "Non-controllable", bucket: "non_controllable" }), L("Landscaping and grounds", 210), L("Parking lot repair", 310), L("Brand new", 60)];
    const m = matchLines(prev, curr);
    expect(m.pairs.map((p) => [p.prev.label, p.curr.label, p.how])).toEqual([
      ["Landscaping & grounds", "Landscaping and grounds", "exact"],
      ["Parking Lot Repairs", "Parking lot repair", "exact"],
      ["Security", "Security", "label"],
    ]);
    expect(m.vanished.map((l) => l.label)).toEqual(["Gone"]);
    expect(m.appeared.map((l) => l.label)).toEqual(["Brand new"]);
  });
  it("never pairs one line twice", () => {
    const prev = [L("Repairs", 1), L("Repairs", 2, { section: "Other" })];
    const curr = [L("Repairs", 3)];
    const m = matchLines(prev, curr);
    expect(m.pairs).toHaveLength(1);
    expect(m.vanished).toHaveLength(1);
  });
});
