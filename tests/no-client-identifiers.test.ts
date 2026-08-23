/**
 * Test gate (§8 of the build plan): no client identifier anywhere in the
 * source tree that ships. The deny-list itself is private — see gates/README.md.
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { findHits, loadDenyList } from "../gates/denylist.mjs";

const root = resolve(__dirname, "..");
const SCAN_DIRS = ["src", "schema", "tools", "scripts", "public"];
const SCAN_FILES = ["index.html", "README.md"];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|mjs|js|json|html|css|md|txt|csv)$/.test(name)) out.push(p);
  }
  return out;
}

describe("client-data gate (source)", () => {
  const { terms, source, privateCount } = loadDenyList();

  it("loads a deny-list", () => {
    expect(terms.length).toBeGreaterThan(0);
    // In CI / hosting builds the private list is mandatory; locally, warn loudly.
    if (process.env.REQUIRE_PRIVATE_DENYLIST === "1") expect(source).not.toBe("none");
    if (source === "none") console.warn("\n⚠ no private deny-list loaded — create gates/denylist.local.json (see gates/README.md)\n");
    else expect(privateCount).toBeGreaterThan(0);
  });

  it("the canary mechanism works", () => {
    expect(findHits("hello CANARY-CLIENT-TOKEN-DO-NOT-SHIP world", terms)).toHaveLength(1);
    expect(findHits("hello world", terms)).toHaveLength(0);
  });

  const files = [
    ...SCAN_DIRS.filter((d) => existsSync(join(root, d))).flatMap((d) => walk(join(root, d))),
    ...SCAN_FILES.map((f) => join(root, f)).filter((f) => existsSync(f)),
  ].filter((f) => !/[\\/]denylist\.local\.json$/.test(f));

  it.each(files.map((f) => [relative(root, f), f] as const))("%s carries no client identifier", (_rel, file) => {
    const text = readFileSync(file, "utf8");
    const hits = findHits(text, terms);
    expect(hits, `deny-listed term(s) in ${_rel}: ${hits.join(", ")}`).toEqual([]);
  });

  it("the synthetic packages declare themselves synthetic", () => {
    for (const id of ["mw-a", "mw-b", "mw-c"]) {
      const pkg = JSON.parse(readFileSync(join(root, "src/data", `${id}.json`), "utf8"));
      expect(pkg.meta.property_name).toBe("Maplewood Commerce Center");
    }
  });
});
