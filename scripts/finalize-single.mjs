/**
 * Post-processes the single-file build: the page's CSP says `script-src 'self'`,
 * which forbids the inline <script> that vite-plugin-singlefile produces. Rather
 * than loosen the policy to 'unsafe-inline', add the SHA-256 hash of each inline
 * script so exactly those scripts — and nothing else — may run.
 *
 *   node scripts/finalize-single.mjs   # rewrites dist-single/index.html in place
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const file = resolve(root, "dist-single/index.html");
let html = readFileSync(file, "utf8");

const hashes = [];
for (const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) {
  const body = m[1];
  if (!body.trim()) continue;
  hashes.push(`'sha256-${createHash("sha256").update(body, "utf8").digest("base64")}'`);
}
if (hashes.length === 0) {
  console.error("finalize-single: no inline scripts found — was this a single-file build?");
  process.exit(1);
}
const before = html;
html = html.replace(/script-src 'self'/, `script-src 'self' ${hashes.join(" ")}`);
if (html === before) {
  console.error("finalize-single: CSP meta not found");
  process.exit(1);
}
writeFileSync(file, html, "utf8");
console.log(`finalize-single: CSP allows ${hashes.length} inline script(s) by hash.`);
