/**
 * The model lease is generated from the abstract the scan runs on, so the
 * document and the findings can never disagree. These tests pin that: the
 * parameters reach the prose, a silent abstract still yields a citable clause,
 * and every check's citation resolves for every package.
 */

import { describe, expect, it } from "vitest";
import { buildLeaseDoc, sectionsOf, sectionText } from "../src/lease/doc.ts";
import type { LeaseSection } from "../src/lease/doc.ts";
import { anchorFor, ARTICLES, CLAUSE_FOR_CHECK, SECTION_TITLE } from "../src/lease/sections.ts";
import { FIELDS, fieldById, feeFields, pctProse, words } from "../src/lease/fields.ts";
import type { FieldId } from "../src/lease/fields.ts";
import { CHECK_CATALOG } from "../src/engine/registry.ts";
import type { LeaseLite, ReconPackage } from "../src/engine/types.ts";
import { packageById } from "../src/data/index.ts";
import { L, P, Y, LEASE_CAP, LEASE_NO_CAP } from "./fixtures.ts";

const MWB = packageById("MW-B")!;
const MWA = packageById("MW-A")!;

function capped(lease: LeaseLite = LEASE_CAP): ReconPackage {
  return P([Y(2023, [L("Landscaping", 100)]), Y(2024, [L("Landscaping", 110)])], lease);
}
function section(pkg: ReconPackage, ref: string): LeaseSection {
  const s = sectionsOf(buildLeaseDoc(pkg)).find((x) => x.ref === ref);
  if (!s) throw new Error(`no section ${ref}`);
  return s;
}

describe("numbers as a lease reads them", () => {
  it("spells whole numbers below one hundred and leaves the rest in digits", () => {
    expect(words(5)).toBe("five");
    expect(words(95)).toBe("ninety-five");
    expect(words(30)).toBe("thirty");
    expect(words(4.5)).toBeNull();
    expect(words(120)).toBeNull();
  });

  it("renders a percentage the way a clause does", () => {
    expect(pctProse(5)).toBe("five percent (5%)");
    expect(pctProse(4.5)).toBe("4.5%");
  });
});

describe("clause text carries the abstract's own values", () => {
  it("§6.02 states the cap rate, method, base and fee treatment", () => {
    const text = sectionText(section(capped(), "6.02"));
    expect(text).toContain("5%");
    expect(text).toContain("non-cumulative");
    expect(text).toContain("$100,000.00");
    expect(text).toContain("2022");
    expect(text).toContain("excluded from");
    expect(text).toContain("lesser of");
  });

  it("moving the fee inside the cap rewrites the sentence", () => {
    const inside: LeaseLite = { ...LEASE_CAP, cap: { ...LEASE_CAP.cap!, fee_treatment: "inside_cap" } };
    expect(sectionText(section(capped(inside), "6.02"))).toContain("included within");
    expect(sectionText(section(capped(inside), "6.02"))).not.toContain("excluded from");
  });

  it("a cap-on-cap basis reads as the cap-on-cap clause it is", () => {
    const onCap: LeaseLite = { ...LEASE_CAP, cap: { ...LEASE_CAP.cap!, basis: "prior_cap" } };
    expect(sectionText(section(capped(onCap), "6.02"))).toContain("whether or not that amount was incurred");
  });

  it("§6.03 states the fee rate and the base it may be charged on", () => {
    const text = sectionText(section(capped(), "6.03"));
    expect(text).toContain("three percent (3%)");
    expect(text).toContain("Common Area Maintenance costs only");
    expect(text).toContain("No fee is chargeable on Taxes");
  });

  it("MW-B's document reflects MW-B's abstract, not a default", () => {
    const text = sectionText(section(MWB, "6.02"));
    expect(text).toContain("five percent (5%)");
    expect(text).toContain("$86,517.36");
    expect(text).toContain("2022");
  });

  it("§2.01 and §4.01 read the premises area from the abstract", () => {
    expect(sectionText(section(MWB, "2.01"))).toContain("24,000 rentable square feet");
    expect(sectionText(section(MWB, "4.01"))).toContain("Gross Leasable Area");
  });

  it("a fixed share reads as a fixed share", () => {
    const fixed: LeaseLite = { ...LEASE_NO_CAP, share: { ...LEASE_NO_CAP.share, stated_pct: 12.5 } };
    const s = section(capped(fixed), "4.01");
    expect(s.clauseOn).toBe(true);
    expect(sectionText(s)).toContain("fixed at 12.5%");
  });
});

describe("negative clauses keep every anchor alive", () => {
  it("no cap in the abstract still yields a §6.02 that says so", () => {
    const s = section(capped(LEASE_NO_CAP), "6.02");
    expect(s.present).toBe(false);
    expect(s.clause).toBe("cap");
    expect(sectionText(s)).toContain("no cap on Operating Expenses");
  });

  it("no fee, no capital terms and no gross-up each read as a prohibition", () => {
    const pkg = capped(LEASE_NO_CAP);
    expect(sectionText(section(pkg, "6.03"))).toContain("no management or administrative fee");
    expect(sectionText(section(pkg, "6.04"))).toContain("no capital threshold");
    expect(sectionText(section(pkg, "6.05"))).toContain("no occupancy gross-up");
  });

  it("a gross-up clause that forbids gross-up is operative, not absent", () => {
    const forbidden: LeaseLite = { ...LEASE_NO_CAP, gross_up: { allowed: false } };
    const s = section(capped(forbidden), "6.05");
    expect(s.present).toBe(true);
    expect(sectionText(s)).toContain("shall not gross up");
  });

  it("every section of the skeleton renders for every package, present or not", () => {
    for (const pkg of [MWA, MWB, capped(LEASE_NO_CAP)]) {
      const refs = sectionsOf(buildLeaseDoc(pkg)).map((s) => s.ref);
      expect(refs).toEqual(ARTICLES.flatMap((a) => a.sections.map((s) => s.ref)));
      for (const s of sectionsOf(buildLeaseDoc(pkg))) expect(sectionText(s).length).toBeGreaterThan(20);
    }
  });
});

describe("citations", () => {
  it("the map covers exactly the check catalog", () => {
    expect(Object.keys(CLAUSE_FOR_CHECK).sort()).toEqual(CHECK_CATALOG.map((c) => c.id).sort());
  });

  it("every ref resolves to a section, for a capped and an uncapped package", () => {
    for (const pkg of [MWB, capped(LEASE_NO_CAP)]) {
      const refs = new Set(sectionsOf(buildLeaseDoc(pkg)).map((s) => s.ref));
      for (const [check, cites] of Object.entries(CLAUSE_FOR_CHECK)) {
        expect(cites.length, `${check} cites nothing`).toBeGreaterThan(0);
        for (const r of cites) {
          expect(refs.has(r), `${check} cites §${r}, which no package renders`).toBe(true);
          expect(SECTION_TITLE[r]).toBeTruthy();
        }
      }
    }
  });

  it("anchors are DOM-safe and unique", () => {
    const anchors = sectionsOf(buildLeaseDoc(MWB)).map((s) => anchorFor(s.ref));
    expect(anchorFor("6.02")).toBe("sec-6-02");
    expect(new Set(anchors).size).toBe(anchors.length);
    for (const a of anchors) expect(a).toMatch(/^[a-z0-9-]+$/);
  });
});

describe("the field registry", () => {
  it("round-trips every static field through set and get", () => {
    const probe: Record<string, string | number> = {
      "share.stated_pct": 11.25,
      "share.numerator_sf": 33_000,
      "share.denominator_basis": "GLOA",
      "cap.applies_to": "total_opex",
      "cap.pct": 7,
      "cap.method": "compounded",
      "cap.basis": "prior_cap",
      "cap.base_year": 2021,
      "cap.base_year_amount": 12_345.67,
      "cap.fee_treatment": "inside_cap",
      capital_threshold: 7_500,
      capital_life_years: 15,
      "gross_up.to_pct": 100,
    };
    for (const [id, value] of Object.entries(probe)) {
      const lease: LeaseLite = structuredClone(LEASE_CAP);
      lease.gross_up = { allowed: true, to_pct: 95 };
      const d = FIELDS[id as keyof typeof FIELDS];
      d.set(lease, value);
      expect(d.get(lease), `${id} did not round-trip`).toBe(value);
      expect(d.prose(lease).length).toBeGreaterThan(0);
    }
  });

  it("clearing an optional field removes it rather than storing undefined", () => {
    const lease: LeaseLite = structuredClone(LEASE_CAP);
    FIELDS["cap.base_year_amount"].set(lease, undefined);
    expect("base_year_amount" in lease.cap!).toBe(false);
    expect(FIELDS["cap.base_year_amount"].prose(lease)).toContain("reconciled for that Lease Year");
  });

  it("resolves indexed fee fields", () => {
    const lease: LeaseLite = structuredClone(LEASE_CAP);
    const rate = fieldById("fee.0.rate_pct" as FieldId)!;
    rate.set(lease, 4);
    expect(lease.fees[0]!.rate_pct).toBe(4);
    expect(rate.prose(lease)).toBe("four percent (4%)");
    expect(feeFields(0).map((f) => f.id)).toEqual(["fee.0.rate_pct", "fee.0.kind", "fee.0.base"]);
    expect(fieldById("fee.9.rate_pct" as FieldId)!.get(lease)).toBeUndefined();
    expect(fieldById("not.a.field" as FieldId)).toBeUndefined();
  });

  it("every field run in the document resolves to a descriptor", () => {
    for (const pkg of [MWA, MWB, capped(), capped(LEASE_NO_CAP)]) {
      for (const s of sectionsOf(buildLeaseDoc(pkg))) {
        for (const p of s.paragraphs) {
          for (const r of p.runs) {
            if (!("field" in r)) continue;
            const d = fieldById(r.field);
            expect(d, `no descriptor for ${r.field}`).toBeDefined();
            expect(r.text).toBe(d!.prose(pkg.lease_lite));
          }
        }
      }
    }
  });
});

describe("determinism and non-mutation", () => {
  it("same package, deep-equal document", () => {
    expect(buildLeaseDoc(MWB)).toEqual(buildLeaseDoc(MWB));
  });

  it("never touches the package it reads", () => {
    const before = JSON.stringify(MWB);
    buildLeaseDoc(MWB);
    expect(JSON.stringify(MWB)).toBe(before);
  });

  it("names a generic landlord for a package outside the synthetic property", () => {
    const doc = buildLeaseDoc(capped());
    expect(doc.parties).toContain("TEST CENTER OWNER, LLC");
    expect(doc.notice).toContain("not an executed document");
  });
});
