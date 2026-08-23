/**
 * "Your file never leaves your browser" is true by construction: nothing in
 * src/ or index.html can open a network connection, and the page ships a CSP
 * with connect-src 'none'. This test keeps it that way.
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const root = resolve(__dirname, "..");
const NETWORK = [/\bfetch\s*\(/, /XMLHttpRequest/, /\bWebSocket\b/, /sendBeacon/, /EventSource/, /navigator\.share/, /<img[^>]+src=["']https?:/i, /<script[^>]+src=["']https?:/i, /<link[^>]+href=["']https?:/i];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|js|mjs|html|css)$/.test(name)) out.push(p);
  }
  return out;
}

describe("privacy: no network primitives", () => {
  const files = [...walk(join(root, "src")), ...(existsSync(join(root, "index.html")) ? [join(root, "index.html")] : [])];
  it.each(files.map((f) => [relative(root, f), f] as const))("%s opens no network connection", (_rel, file) => {
    const text = readFileSync(file, "utf8");
    for (const re of NETWORK) expect(text, `${_rel} matches ${re}`).not.toMatch(re);
  });

  it("index.html declares a CSP with connect-src 'none'", () => {
    const html = readFileSync(join(root, "index.html"), "utf8");
    expect(html).toMatch(/http-equiv="Content-Security-Policy"/);
    expect(html).toMatch(/connect-src 'none'/);
  });
});
