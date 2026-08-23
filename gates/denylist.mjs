/**
 * Client-data deny-list loader — shared by the test gate
 * (tests/no-client-identifiers.test.ts) and the build gate
 * (scripts/build-gate.mjs).
 *
 * The private list of identifiers is NEVER committed. It is loaded from, in
 * order:
 *   1. the CLIENT_DENYLIST environment variable (JSON array or comma-separated)
 *      — this is how CI and the hosting build get it, from a secret;
 *   2. gates/denylist.local.json (git-ignored) — the local developer copy.
 *
 * gates/denylist.public.json is committed and holds only generic canaries; it
 * exists so the mechanism itself is testable in a clean clone. When
 * REQUIRE_PRIVATE_DENYLIST=1 (set in CI and in the hosting build), a missing
 * private list fails loudly instead of passing silently.
 */

import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

function parseList(raw) {
  const t = raw.trim();
  if (!t) return [];
  if (t.startsWith("[")) return JSON.parse(t);
  return t.split(",").map((s) => s.trim()).filter(Boolean);
}

export function loadDenyList() {
  const pub = JSON.parse(readFileSync(resolve(here, "denylist.public.json"), "utf8"));
  let priv = [];
  let source = "none";
  if (process.env.CLIENT_DENYLIST && process.env.CLIENT_DENYLIST.trim()) {
    priv = parseList(process.env.CLIENT_DENYLIST);
    source = "env";
  } else if (existsSync(resolve(here, "denylist.local.json"))) {
    priv = JSON.parse(readFileSync(resolve(here, "denylist.local.json"), "utf8"));
    source = "local";
  }
  const required = process.env.REQUIRE_PRIVATE_DENYLIST === "1";
  if (required && source === "none") {
    throw new Error(
      "REQUIRE_PRIVATE_DENYLIST=1 but no private deny-list was found. Set the CLIENT_DENYLIST secret (JSON array) or create gates/denylist.local.json.",
    );
  }
  const terms = [...new Set([...pub, ...priv].map((s) => String(s)).filter((s) => s.length >= 3))];
  return { terms, source, privateCount: priv.length, publicCount: pub.length };
}

/** Returns the deny-listed terms found in `text` (case-insensitive). */
export function findHits(text, terms) {
  const lower = text.toLowerCase();
  return terms.filter((t) => lower.includes(t.toLowerCase()));
}
