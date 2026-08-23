/**
 * Golden package tests — the definition of correct (§5 of the build plan).
 * For each Maplewood package: every manifest finding must be present (matched
 * on check_id + year + category, impact within range) and there must be zero
 * unplanned `high` findings. MW-A additionally pins the total finding count.
 */

import { describe, expect, it } from "vitest";
import { scan } from "../src/engine/scan.ts";
import { PACKAGES, packageById } from "../src/data/index.ts";
import type { Finding } from "../src/engine/types.ts";
import mwaManifest from "../src/data/manifests/mw-a.manifest.json";
import mwbManifest from "../src/data/manifests/mw-b.manifest.json";
import mwcManifest from "../src/data/manifests/mw-c.manifest.json";

interface ManifestFinding {
  check_id: string;
  year: number | [number, number];
  category: string;
  severity: "info" | "review" | "high";
  expected_impact_range?: [number, number];
  note?: string;
}
interface Manifest {
  package_id: string;
  findings: ManifestFinding[];
  expected_total_findings?: number;
  expected_high?: number;
  expected_high_min?: number;
}

const manifests: Manifest[] = [mwaManifest, mwbManifest, mwcManifest] as unknown as Manifest[];

const sameYear = (a: Finding["year"], b: ManifestFinding["year"]) =>
  Array.isArray(a) && Array.isArray(b) ? a[0] === b[0] && a[1] === b[1] : a === b;

function find(findings: Finding[], m: ManifestFinding): Finding | undefined {
  return findings.find((f) => f.check_id === m.check_id && sameYear(f.year, m.year) && f.category === m.category);
}

describe.each(manifests)("golden package $package_id", (manifest) => {
  const pkg = packageById(manifest.package_id)!;
  const result = scan(pkg);

  it("exists and scans without throwing", () => {
    expect(pkg).toBeDefined();
    expect(result.findings).toBeInstanceOf(Array);
  });

  it.each(manifest.findings.map((m) => [`${m.check_id} ${JSON.stringify(m.year)} ${m.category}`, m] as const))(
    "contains planted finding %s",
    (_label, m) => {
      const f = find(result.findings, m);
      expect(f, `missing ${m.check_id} for ${m.category} ${JSON.stringify(m.year)}\nhave: ${result.findings.map((x) => `${x.check_id} ${JSON.stringify(x.year)} ${x.category} [${x.severity}]`).join("\n")}`).toBeDefined();
      expect(f!.severity).toBe(m.severity);
      if (m.expected_impact_range) {
        expect(f!.tenant_impact_usd, `impact missing on ${f!.id}`).toBeDefined();
        expect(f!.tenant_impact_usd!).toBeGreaterThanOrEqual(m.expected_impact_range[0]);
        expect(f!.tenant_impact_usd!).toBeLessThanOrEqual(m.expected_impact_range[1]);
      }
    },
  );

  it("has zero unplanned high findings", () => {
    const plannedHigh = manifest.findings.filter((m) => m.severity === "high");
    const unplanned = result.findings.filter((f) => f.severity === "high" && !plannedHigh.some((m) => find([f], m)));
    expect(unplanned.map((f) => `${f.check_id} ${JSON.stringify(f.year)} ${f.category}: ${f.title}`)).toEqual([]);
  });

  if (manifest.expected_total_findings !== undefined) {
    it(`has exactly ${manifest.expected_total_findings} finding(s)`, () => {
      expect(result.findings.map((f) => `${f.check_id} ${f.category} [${f.severity}]`)).toHaveLength(manifest.expected_total_findings!);
    });
  }
  if (manifest.expected_high !== undefined) {
    it(`has ${manifest.expected_high} high finding(s)`, () => {
      expect(result.totals.high).toBe(manifest.expected_high);
    });
  }
  if (manifest.expected_high_min !== undefined) {
    it(`has at least ${manifest.expected_high_min} high finding(s)`, () => {
      expect(result.totals.high).toBeGreaterThanOrEqual(manifest.expected_high_min!);
    });
  }

  it("every finding carries narrative, working and refs", () => {
    for (const f of result.findings) {
      expect(f.narrative.length).toBeGreaterThan(40);
      expect(f.working.length).toBeGreaterThan(0);
      expect(f.refs.length).toBeGreaterThan(0);
      expect(f.id).toMatch(/^RF-\d\d:/);
    }
  });

  it("findings are sorted by severity then impact", () => {
    const rank = { high: 0, review: 1, info: 2 };
    for (let i = 1; i < result.findings.length; i++) {
      const a = result.findings[i - 1]!;
      const b = result.findings[i]!;
      expect(rank[a.severity]).toBeLessThanOrEqual(rank[b.severity]);
      if (a.severity === b.severity) expect(a.tenant_impact_usd ?? -1).toBeGreaterThanOrEqual(b.tenant_impact_usd ?? -1);
    }
  });
});

describe("MW-B planted impact lands in the believable band", () => {
  it("total estimated tenant impact is between $4,000 and $8,000", () => {
    const r = scan(packageById("MW-B")!);
    expect(r.totals.estimated_impact_usd).toBeGreaterThanOrEqual(4000);
    expect(r.totals.estimated_impact_usd).toBeLessThanOrEqual(8000);
  });
});

describe("determinism", () => {
  it.each(PACKAGES.map((p) => [p.meta.package_id, p] as const))("%s: scan twice → deep-equal", (_id, pkg) => {
    const a = scan(pkg);
    const b = scan(JSON.parse(JSON.stringify(pkg)));
    expect(a).toEqual(b);
  });
  it("never mutates its input", () => {
    const pkg = packageById("MW-B")!;
    const before = JSON.stringify(pkg);
    scan(pkg);
    expect(JSON.stringify(pkg)).toBe(before);
  });
});
