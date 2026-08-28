/**
 * Milestone M5b — the drift test for the Recon Foundry interchange.
 *
 * Recon Foundry generates complete synthetic reconciliation packages, and one
 * of the files it emits is a ReconPackage in this engine's own shape. To keep a
 * forged package honest it carries **copies** of five of this repo's rules —
 * the round-number test, the capital-keyword list, the label normalizer, the
 * amortization arithmetic and the fee base — because the family rule is that
 * apps do not import one another.
 *
 * Copies drift, and the drift is silent in the direction that matters: Foundry
 * would go on believing a clean package is invisible here long after a check
 * had learned to see it. So the pair below lives in *this* repo. The package
 * and the manifest of what should be found in it are generated over there
 * (`recon-foundry/tools/export-fixtures.mjs`, pinned seeds) and run through the
 * real engine here, on the commit that changes the engine.
 *
 * A red test in this file is a question with two answers, and it is worth
 * deciding which one before touching anything: either a check changed on
 * purpose and Foundry's copies are stale, or a check changed by accident.
 * Regenerating the fixtures answers neither.
 *
 * Two things the manifest says that the golden Maplewood manifests do not:
 *
 * - `cofires` — checks a planted scheme fires *without* being the finding it
 *   was planted for. Moving a line out of the capped pool makes a category
 *   vanish and another appear; those are consequences, not surprises, and a
 *   test that forbade them would forbid the scheme.
 * - `document_only_findings` — schemes no check here can raise at all. The kept
 *   tax refund is the whole of that count: a refund the landlord received and
 *   did not credit is not a fact any reconciliation statement contains, so
 *   there is nothing on the page for a check to test. It is the standing
 *   argument for a future RF-13 that reads tax backup, and until that check
 *   exists this test pins the gap rather than papering over it.
 */

import { describe, expect, it } from "vitest";
import { scan } from "../src/engine/scan.ts";
import { CHECK_CATALOG } from "../src/engine/registry.ts";
import type { Finding, ReconPackage } from "../src/engine/types.ts";

import cleanPackage from "./fixtures/foundry/clean.package.json";
import cleanManifest from "./fixtures/foundry/clean.manifest.json";
import capPackage from "./fixtures/foundry/cap-migration.package.json";
import capManifest from "./fixtures/foundry/cap-migration.manifest.json";
import fivePackage from "./fixtures/foundry/all-five.package.json";
import fiveManifest from "./fixtures/foundry/all-five.manifest.json";

interface ManifestFinding {
  check_id: string;
  year: number | [number, number];
  category: string;
  severity: "info" | "review" | "high";
  expected_impact_range?: [number, number];
  /** The finding may land under the materiality threshold and drop to info. */
  materiality_sensitive?: boolean;
  note?: string;
}

interface FoundryManifest {
  package_id: string;
  expected_high_min: number;
  expected_total_findings?: number;
  expected_high?: number;
  findings: ManifestFinding[];
  cofires: string[];
  total_planted_tenant_impact: number;
  document_only_findings: number;
}

const fixture = (pkg: unknown, manifest: unknown, name: string) => ({
  name,
  pkg: pkg as unknown as ReconPackage,
  manifest: manifest as unknown as FoundryManifest,
});

const CLEAN = fixture(cleanPackage, cleanManifest, "clean");
const SCHEMED = [fixture(capPackage, capManifest, "cap-migration"), fixture(fivePackage, fiveManifest, "all-five")];
const ALL = [CLEAN, ...SCHEMED];

const sameYear = (a: Finding["year"], b: ManifestFinding["year"]) =>
  Array.isArray(a) && Array.isArray(b) ? a[0] === b[0] && a[1] === b[1] : a === b;

function find(findings: Finding[], m: ManifestFinding): Finding | undefined {
  return findings.find((f) => f.check_id === m.check_id && sameYear(f.year, m.year) && f.category === m.category);
}

const describeFindings = (findings: Finding[]) =>
  findings.map((f) => `${f.check_id} ${JSON.stringify(f.year)} ${f.category} [${f.severity}]`).join("\n");

describe("the fixtures are the packages the manifests describe", () => {
  it.each(ALL.map((f) => [f.name, f] as const))("%s pairs a package with its own manifest", (_name, f) => {
    expect(f.pkg.meta.package_id).toBe(f.manifest.package_id);
    expect(f.pkg.meta.schema_version).toBe("1.0");
    expect(f.pkg.years.length).toBeGreaterThanOrEqual(2);
  });
});

describe("a clean forged package is invisible", () => {
  const result = scan(CLEAN.pkg);

  it("raises no finding of any severity", () => {
    expect(describeFindings(result.findings)).toBe("");
  });

  it("prices no impact", () => {
    expect(result.totals.estimated_impact_usd).toBe(0);
  });

  it("still runs the checks — an empty result is not an unrun one", () => {
    // A package that skipped every check would also raise nothing, which is the
    // one way this test could pass while proving nothing at all.
    expect(result.checks_run.length).toBeGreaterThanOrEqual(10);
  });
});

describe.each(SCHEMED.map((f) => [f.name, f] as const))("forged package %s", (_name, f) => {
  const result = scan(f.pkg);

  it.each(f.manifest.findings.map((m) => [`${m.check_id} ${JSON.stringify(m.year)} ${m.category}`, m] as const))(
    "raises planted finding %s",
    (_label, m) => {
      const hit = find(result.findings, m);
      expect(hit, `missing ${m.check_id} for ${m.category} ${JSON.stringify(m.year)}\nhave:\n${describeFindings(result.findings)}`).toBeDefined();
      // Materiality is a tenant decision, not a fact about the scheme: a real
      // overcharge under the threshold is reported as info. The manifest marks
      // where that is possible rather than pretending the severity is fixed.
      expect(m.materiality_sensitive ? [m.severity, "info"] : [m.severity]).toContain(hit!.severity);
      if (m.expected_impact_range) {
        expect(hit!.tenant_impact_usd, `impact missing on ${hit!.id}`).toBeDefined();
        expect(hit!.tenant_impact_usd!).toBeGreaterThanOrEqual(m.expected_impact_range[0]);
        expect(hit!.tenant_impact_usd!).toBeLessThanOrEqual(m.expected_impact_range[1]);
      }
    },
  );

  it("raises no high finding the manifest did not plant or declare a co-fire of", () => {
    const unplanned = result.findings.filter(
      (x) => x.severity === "high" && !f.manifest.findings.some((m) => find([x], m)) && !f.manifest.cofires.includes(x.check_id),
    );
    expect(unplanned.map((x) => `${x.check_id} ${JSON.stringify(x.year)} ${x.category}: ${x.title}`)).toEqual([]);
  });

  it(`reports at least ${f.manifest.expected_high_min} high finding(s)`, () => {
    expect(result.totals.high).toBeGreaterThanOrEqual(f.manifest.expected_high_min);
  });

  it("prices something, and less than the whole truth", () => {
    // The manifest's total is what the schemes are worth to the tenant; the
    // scan's total is what these checks can see of it. Under, never over.
    expect(result.totals.estimated_impact_usd).toBeGreaterThan(0);
    expect(result.totals.estimated_impact_usd).toBeLessThanOrEqual(f.manifest.total_planted_tenant_impact);
  });
});

describe("the gap the interchange is honest about", () => {
  it("all-five plants a scheme no check here can raise", () => {
    expect(fiveManifest.document_only_findings).toBeGreaterThanOrEqual(1);
  });

  it("there is no check for it, and the catalog says so by ending at RF-12", () => {
    // If a future RF-13 reads tax backup, this is the line that will fail, and
    // failing is correct: the fixtures and Foundry's answer key both need to
    // learn that the refund became visible.
    expect(CHECK_CATALOG.map((c) => c.id)).toHaveLength(12);
    expect(CHECK_CATALOG.map((c) => c.id).includes("RF-13")).toBe(false);
  });
});

describe("determinism holds across the interchange", () => {
  it.each(ALL.map((f) => [f.name, f] as const))("%s: scan twice → deep-equal, input untouched", (_name, f) => {
    const before = JSON.stringify(f.pkg);
    const a = scan(f.pkg);
    const b = scan(JSON.parse(before) as ReconPackage);
    expect(a).toEqual(b);
    expect(JSON.stringify(f.pkg)).toBe(before);
  });
});
