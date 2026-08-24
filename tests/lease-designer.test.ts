/**
 * A session at the lease designer, simulated without a DOM: the same sequence
 * of edits the page performs — get-or-create a draft, apply, rescan.
 *
 * The load-bearing guarantee is that the authored packages are never touched.
 * The designer edits a *copy*; the golden manifests are safe by construction,
 * and this suite is the proof.
 */

import { describe, expect, it } from "vitest";
import Ajv from "ajv";
import schema from "../schema/recon-package.schema.json";
import { CLAUSE_DEFAULTS, CLAUSE_LABEL, CLAUSE_REMOVE, cloneLease, FIELDS, leaseEquals } from "../src/lease/fields.ts";
import type { ClauseId } from "../src/lease/fields.ts";
import { buildLeaseDoc, sectionsOf, sectionText } from "../src/lease/doc.ts";
import { scan } from "../src/engine/scan.ts";
import type { LeaseLite, ReconPackage } from "../src/engine/types.ts";
import { PACKAGES, packageById } from "../src/data/index.ts";

const ajv = new Ajv({ allErrors: true, strict: true, multipleOfPrecision: 6 });
const validate = ajv.compile(schema);

const MWB = packageById("MW-B")!;
const CLAUSES: ClauseId[] = ["cap", "fee", "gross_up", "capital", "stated_share"];

/** The page's own model: a draft per package, and a package that reads through it. */
class Session {
  private drafts = new Map<string, LeaseLite>();
  constructor(private readonly pkg: ReconPackage) {}

  effective(): ReconPackage {
    const d = this.drafts.get(this.pkg.meta.package_id);
    return d ? { ...this.pkg, lease_lite: d } : this.pkg;
  }
  edit(mutate: (l: LeaseLite) => void): void {
    const id = this.pkg.meta.package_id;
    const draft = this.drafts.get(id) ?? cloneLease(this.pkg.lease_lite);
    mutate(draft);
    if (leaseEquals(draft, this.pkg.lease_lite)) this.drafts.delete(id);
    else this.drafts.set(id, draft);
  }
  reset(): void {
    this.drafts.delete(this.pkg.meta.package_id);
  }
  edited(): boolean {
    return this.drafts.has(this.pkg.meta.package_id);
  }
}

describe("the designer never touches the package it edits", () => {
  it("five edits, a strike and an add later, every authored package is byte-identical", () => {
    const before = PACKAGES.map((p) => JSON.stringify(p));
    const s = new Session(MWB);
    s.edit((l) => FIELDS["cap.pct"].set(l, 12));
    s.edit((l) => FIELDS["cap.method"].set(l, "compounded"));
    s.edit((l) => FIELDS["cap.base_year_amount"].set(l, 200_000));
    s.edit((l) => CLAUSE_REMOVE.fee(l));
    s.edit((l) => CLAUSE_DEFAULTS.gross_up(l));
    scan(s.effective());
    buildLeaseDoc(s.effective());
    expect(PACKAGES.map((p) => JSON.stringify(p))).toEqual(before);
  });

  it("the draft diverges while the signed lease stands still", () => {
    const signed = JSON.stringify(MWB.lease_lite);
    const s = new Session(MWB);
    s.edit((l) => FIELDS["cap.pct"].set(l, 12));
    expect(s.effective().lease_lite.cap!.pct).toBe(12);
    expect(MWB.lease_lite.cap!.pct).toBe(5);
    expect(JSON.stringify(MWB.lease_lite)).toBe(signed);
  });

  it("the scan follows the draft, not the signed lease", () => {
    const s = new Session(MWB);
    s.edit((l) => CLAUSE_REMOVE.cap(l));
    expect(scan(s.effective()).skipped.map((x) => x.check_id)).toContain("RF-06");
    expect(scan(MWB).checks_run).toContain("RF-06");
  });
});

describe("reset restores the signed lease", () => {
  it("an edit marks the lease redlined; reset clears it", () => {
    const s = new Session(MWB);
    expect(s.edited()).toBe(false);
    s.edit((l) => FIELDS["cap.pct"].set(l, 12));
    expect(s.edited()).toBe(true);
    s.reset();
    expect(s.edited()).toBe(false);
    expect(leaseEquals(s.effective().lease_lite, MWB.lease_lite)).toBe(true);
    expect(scan(s.effective())).toEqual(scan(MWB));
  });

  it("editing a value back to what it was is not a redline", () => {
    const s = new Session(MWB);
    s.edit((l) => FIELDS["cap.pct"].set(l, 12));
    s.edit((l) => FIELDS["cap.pct"].set(l, 5));
    expect(s.edited()).toBe(false);
  });

  it("leaseEquals ignores the order keys happen to sit in", () => {
    const a: LeaseLite = { share: { numerator_sf: 1000, denominator_basis: "GLA" }, fees: [], capital_life_years: 10 };
    const b: LeaseLite = { capital_life_years: 10, fees: [], share: { denominator_basis: "GLA", numerator_sf: 1000 } };
    expect(leaseEquals(a, b)).toBe(true);
    expect(leaseEquals(a, { ...a, capital_life_years: 11 })).toBe(false);
  });

  it("striking a clause and adding it back is a redline, not a no-op", () => {
    const s = new Session(MWB);
    s.edit((l) => CLAUSE_REMOVE.cap(l));
    s.edit((l) => CLAUSE_DEFAULTS.cap(l));
    expect(s.edited()).toBe(true);
    expect(s.effective().lease_lite.cap!.base_year_amount).toBeUndefined();
  });
});

describe("clauses the designer drafts are valid leases", () => {
  it.each(CLAUSES)("adding %s produces a package the engine and the schema both accept", (clause) => {
    const s = new Session(MWB);
    s.edit((l) => CLAUSE_REMOVE[clause](l));
    s.edit((l) => CLAUSE_DEFAULTS[clause](l, { sharePct: 14.2857, baseYear: 2022, baseAmount: 86_517.36 }));
    const pkg = s.effective();
    expect(() => scan(pkg)).not.toThrow();
    expect(validate(pkg), JSON.stringify(validate.errors, null, 2)).toBe(true);
  });

  it.each(CLAUSES)("striking %s produces a package the engine and the schema both accept", (clause) => {
    const s = new Session(MWB);
    s.edit((l) => CLAUSE_REMOVE[clause](l));
    const pkg = s.effective();
    expect(() => scan(pkg)).not.toThrow();
    expect(validate(pkg), JSON.stringify(validate.errors, null, 2)).toBe(true);
  });

  it("striking the fee empties the array rather than deleting it", () => {
    const s = new Session(MWB);
    s.edit((l) => CLAUSE_REMOVE.fee(l));
    expect(s.effective().lease_lite.fees).toEqual([]);
    expect(Array.isArray(s.effective().lease_lite.fees)).toBe(true);
  });

  it("every clause has a label the buttons can use", () => {
    for (const c of CLAUSES) expect(CLAUSE_LABEL[c].length).toBeGreaterThan(3);
  });
});

describe("the document follows the redline", () => {
  it("the cap clause rewrites itself when the rate changes", () => {
    const s = new Session(MWB);
    const before = sectionText(sectionsOf(buildLeaseDoc(s.effective())).find((x) => x.ref === "6.02")!);
    s.edit((l) => FIELDS["cap.pct"].set(l, 12));
    const after = sectionText(sectionsOf(buildLeaseDoc(s.effective())).find((x) => x.ref === "6.02")!);
    expect(before).toContain("five percent (5%)");
    expect(after).toContain("twelve percent (12%)");
  });

  it("striking a clause turns its section into the negative clause", () => {
    const s = new Session(MWB);
    s.edit((l) => CLAUSE_REMOVE.cap(l));
    const sec = sectionsOf(buildLeaseDoc(s.effective())).find((x) => x.ref === "6.02")!;
    expect(sec.present).toBe(false);
    expect(sec.clauseOn).toBe(false);
    expect(sectionText(sec)).toContain("no cap on Operating Expenses");
  });

  it("adding a clause the package never had makes its section operative", () => {
    const s = new Session(packageById("MW-A")!);
    expect(sectionsOf(buildLeaseDoc(s.effective())).find((x) => x.ref === "6.02")!.present).toBe(false);
    s.edit((l) => CLAUSE_DEFAULTS.cap(l, { baseYear: 2023, baseAmount: 50_000 }));
    const sec = sectionsOf(buildLeaseDoc(s.effective())).find((x) => x.ref === "6.02")!;
    expect(sec.present).toBe(true);
    expect(sectionText(sec)).toContain("five percent (5%)");
    expect(sectionText(sec)).toContain("$50,000.00");
  });
});
