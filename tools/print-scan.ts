/**
 * Prints a full scan of one preloaded package to the console — the CLI twin
 * of the web page, useful for eyeballing narratives during development.
 *
 *   npx vite-node tools/print-scan.ts MW-B
 */
import { scan } from "../src/engine/scan.ts";
import { packageById, PACKAGES } from "../src/data/index.ts";

const id = process.argv[2] ?? "MW-B";
const pkg = packageById(id);
if (!pkg) {
  console.error(`unknown package ${id}; have ${PACKAGES.map((p) => p.meta.package_id).join(", ")}`);
  process.exit(1);
}
const r = scan(pkg);
console.log(`\n${pkg.meta.package_id} — ${pkg.meta.tenant_name} @ ${pkg.meta.property_name}`);
console.log(`high ${r.totals.high} · review ${r.totals.review} · info ${r.totals.info} · est. impact $${r.totals.estimated_impact_usd.toFixed(2)}`);
console.log(`checks run: ${r.checks_run.join(", ")}`);
for (const s of r.skipped) console.log(`  skipped ${s.check_id}: ${s.reason}`);
for (const f of r.findings) {
  console.log(`\n[${f.severity.toUpperCase()}] ${f.check_id} ${Array.isArray(f.year) ? f.year.join("→") : f.year} — ${f.title}`);
  if (f.tenant_impact_usd !== undefined) console.log(`  impact $${f.tenant_impact_usd.toFixed(2)}`);
  if (f.tenant_exposure_usd !== undefined) console.log(`  exposure $${f.tenant_exposure_usd.toFixed(2)}`);
  console.log(`  ${f.narrative}`);
  for (const w of f.working) console.log(`    · ${w.label}: ${w.value}`);
  if (f.related?.length) console.log(`  related: ${f.related.join(", ")}`);
  console.log(`  refs: ${f.refs.join(" | ")}  id=${f.id}`);
}
