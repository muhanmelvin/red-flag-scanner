/**
 * Build gate (§8 of the build plan). Runs after `vite build`: re-scans the
 * output directory for deny-listed client identifiers and, on any hit, deletes
 * the output and exits non-zero so no deploy step can pick it up.
 *
 *   node scripts/build-gate.mjs            # scans dist/ (or dist-single/ when SINGLE_FILE=1)
 *   node scripts/build-gate.mjs some/dir   # scans an explicit directory
 */

import { readdirSync, readFileSync, rmSync, statSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findHits, loadDenyList } from "../gates/denylist.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = resolve(root, process.argv[2] ?? (process.env.SINGLE_FILE === "1" ? "dist-single" : "dist"));

if (!existsSync(target)) {
  console.error(`build-gate: ${relative(root, target)} does not exist — run the build first.`);
  process.exit(1);
}

let list;
try {
  list = loadDenyList();
} catch (err) {
  console.error(`build-gate: ${err.message}`);
  process.exit(1);
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const files = walk(target);
const hits = [];
let bytes = 0;
for (const f of files) {
  const buf = readFileSync(f);
  bytes += buf.length;
  const text = buf.toString("utf8");
  const h = findHits(text, list.terms);
  if (h.length) hits.push({ file: relative(root, f), terms: h });
}

if (hits.length) {
  console.error("\nBUILD REFUSED — client identifier in a public artifact:");
  for (const h of hits) console.error(`  ${h.file}: ${h.terms.join(", ")}`);
  console.error(`\nDeleting ${relative(root, target)}. Public pages run on the synthetic Maplewood corpus only.\n`);
  rmSync(target, { recursive: true, force: true });
  process.exit(1);
}

const kb = (bytes / 1024).toFixed(1);
console.log(
  `build-gate: clean — ${files.length} file(s), ${kb} kB scanned against ${list.terms.length} term(s) ` +
    `(${list.privateCount} private via ${list.source}, ${list.publicCount} public).` +
    (list.source === "none" ? "  ⚠ no private deny-list loaded" : ""),
);
