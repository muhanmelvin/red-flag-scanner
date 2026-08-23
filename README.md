# Recon Red-Flag Scanner

A deterministic, browser-only checklist that ranks red flags in a landlord's operating-expense reconciliation — caps, fees, pro-rata share, capital, gross-ups, arithmetic — and hands you the working and a finding-letter sentence for each one.

> The landlord prepares the statement, allocates the expenses, and holds all the records. This scanner runs the tenant-side checklist in your browser — **your file never leaves your machine.**

**Live demo:** _set after first deploy — see [Hosting](#hosting)_ · **Single-file build:** `npm run build:single` → `dist-single/index.html` opens offline.

![Sixty-second scan of the MW-B package](docs/demo.gif)

_(GIF to record after the first deploy: pick **MW-B**, read the summary band, expand the top finding, press **Copy finding**.)_

---

## What it does in sixty seconds

1. Pick one of three preloaded reconciliation packages — or upload your own XLSX/CSV.
2. The engine runs twelve checks instantly (well under 50 ms) and shows a **ranked red-flag report**: each finding with a severity, an estimated dollar impact on the tenant, and a **Show the working** table.
3. Expand any finding and press **Copy finding** — the narrative and the arithmetic land on your clipboard, written in finding-letter register.
4. A **Checks not run** footer lists every check that could not run and why. An auditor trusts a tool more when it says what it *didn't* test.

## Why there is no AI in the arithmetic

Every number on the page comes from `scan()` — a pure TypeScript function, integer cents throughout, compiled straight into the page. The same function is pinned by a test suite against hand-computed fixtures and against three synthetic packages with planted findings; it is deterministic (same input → deep-equal output) and it never sees a network.

A language model can draft prose well and cannot be trusted to decide whether a cap was breached or by how much. So the engine computes and the roadmap's v2 narrative layer will *write from engine output* — it will never compute a number. That boundary is the design; it is also why the whole thing runs as a free static page with no server and no keys.

## The check catalog

| ID | Check | What it implements | Severity when tripped |
|---|---|---|---|
| RF-01 | Year-over-year variance | Large swings; errors cluster around transitions | review |
| RF-02 | New category appeared | New line items; escalates for new fees or new non-controllable lines under a cap | review / high |
| RF-03 | Category vanished | Categories that vanish and reappear elsewhere (cross-referenced to RF-02/RF-04) | review |
| RF-04 | Controllable → non-controllable migration | The bridge: re-classification out of the capped pool, priced against the rebuilt cap | review / high |
| RF-05 | Round-number test | Round pool figures signal estimates and allocations | info / review |
| RF-06 | Cap compliance / cap-on-cap | Rebuilds the full-term ceiling (non-cumulative, cumulative, compounded; amount-paid, actual or prior-cap basis), applies the lesser-of rule, and detects the "billed exactly +5% every year" pattern | high (+ review pattern) |
| RF-07 | Fee tests | One service, one fee; fee recomputed on the permitted base; fee-on-fee; stacked fees; fee placement vs. the cap | high / review |
| RF-08 | Pro-rata share tests | Stated share, recomputed share, denominator shrinkage, pool × share tie-out | high / review |
| RF-09 | Capital & amortization | Cost ÷ months × months in service (+ simple interest); amortization past end of life; lumps that should have been amortized | high / review |
| RF-10 | Gross-up sanity | Variable costs only, never beyond the target occupancy; fixed costs grossed up | high / review |
| RF-11 | Arithmetic tie-out | Subtotals, tenant allocation, balance due — verify, don't assume | high |
| RF-12 | Identical-amount test | The previous-year trap: an amount repeated to the cent | review |

Severity policy: **high** = a lease-terms or arithmetic violation with a computable impact; **review** = a pattern that warrants a document request; **info** = context, or a quantified finding below the materiality threshold. Findings sort by severity, then impact. Three knobs are exposed in the page (materiality, swing threshold, round-number floor).

Two dollar fields are deliberately kept apart: `tenant_impact_usd` is an estimated overcharge and is summed in the summary band; `tenant_exposure_usd` is the tenant-level amount *at stake* in a question-type finding (a swing, an identical amount) and is never summed.

## The three packages

All synthetic — the fictional **Maplewood Commerce Center** (168,000 sf GLA), the same universe as the *AI for Auditors* course and the Cap Trap Explorer. Authored by [`tools/author-packages.mjs`](tools/author-packages.mjs) so every derived figure is computed once, to the cent, and every planted finding is documented in code. Each ships with a findings manifest that the golden tests enforce.

| Package | Tenant | Story | Planted |
|---|---|---|---|
| **MW-B** | Halverson Sporting Goods, 24,000 sf, 2023–2025 | The cap year: a 5% cap on controllables billed as an escalator; a fee computed on CAM + insurance + taxes; a security line that leaves the capped pool under a new name | RF-06 ×2 + pattern, RF-07 ×3, RF-04, RF-02, RF-03 (≈ $7.5k tenant impact) |
| **MW-C** | Copperline Outfitters, 30,000 sf, 2021–2022 | The capital year: occupancy falls 98% → 82%; a $148,500 parking-lot job expensed as repairs; insurance grossed up; the share denominator shrinks with vacancy; a balance that doesn't add | RF-09, RF-10, RF-08 (a, c), RF-11, RF-12, RF-05 ×2, RF-02 |
| **MW-A** | Tessaro Home Goods, 18,000 sf, 2024–2025 | The clean year: no cap, everything ties, one honest 18% swing on snow removal | exactly one review finding, zero high — proves the scanner doesn't cry wolf |

## Architecture

```
            ReconPackage (JSON, schema/recon-package.schema.json)
                 │
   ┌─────────────┴──────────────┐
   │  src/engine/  (pure)       │      gates/  (never committed: the private deny-list)
   │   scan(pkg, config)        │        ├─ tests/no-client-identifiers.test.ts   ← fails `npm test`
   │   ├─ normalize.ts  labels  │        └─ scripts/build-gate.mjs                 ← deletes dist/, exits 1
   │   ├─ cap.ts        ceiling │
   │   ├─ lines.ts / share.ts   │
   │   └─ checks/rf01…rf12.ts   │
   └─────────────┬──────────────┘
                 │  Finding[] + SkipRecord[] (sorted, with working + narrative)
   ┌─────────────┴──────────────┐
   │  src/ui/   (DOM only)      │   src/ingest/parse.ts  (SheetJS, lazy chunk)
   │   cards · summary · list   │     XLSX/CSV → grid → explicit mapping → ReconPackage
   └────────────────────────────┘
```

Hard boundary: nothing in `src/engine/` imports from `src/ui/` or touches `window`. The engine has no I/O, no clock, no network; a check that cannot run returns a skip record rather than throwing, and a check that throws is caught and reported as skipped — the scan never goes down.

## Upload path

Drop an `.xlsx`, `.xls` or `.csv` (wide format: one label column, one amount column per year, section header rows understood — [template.xlsx](public/template.xlsx)). The page detects the header row, guesses column roles, and shows an **explicit mapping screen** — columns on the left, canonical roles on the right, pre-filled, you confirm — then a preview with per-line bucket and fee flags, then a compact lease-terms form. Nothing is silent. A JSON package in the canonical schema skips the mapping.

Privacy is true by construction, not by promise: `src/` contains no network primitive (a test enforces it) and `index.html` ships a Content-Security-Policy with `connect-src 'none'`, so the page cannot open a connection even if it wanted to.

## Running it

```bash
npm install
npm test            # 194 tests: per-check units, golden packages, determinism, schema, ingest, privacy, client-data gate
npm run dev         # http://localhost:5173
npm run build       # vite build → scripts/build-gate.mjs (refuses to ship a client identifier)
npm run build:single  # one self-contained dist-single/index.html (offline / quick share)
npm run data:build  # regenerate src/data/*.json from tools/author-packages.mjs
npx vite-node tools/print-scan.ts MW-B   # CLI twin of the page
```

The test gate and build gate read a private deny-list that is **never committed** — see [`gates/README.md`](gates/README.md). Locally, create `gates/denylist.local.json`; in CI and on the host, set the `CLIENT_DENYLIST` secret and `REQUIRE_PRIVATE_DENYLIST=1`.

## Hosting

Public repo + free static host, $0:

- **Cloudflare Pages** (primary): Connect to Git → build command `npm run build`, output `dist`, env vars `CLIENT_DENYLIST` (JSON array) and `REQUIRE_PRIVATE_DENYLIST=1`. Custom domain free; Registrar domain ≈ $10/yr.
- **GitHub Pages** (wired in [`.github/workflows/ci.yml`](.github/workflows/ci.yml)): enable Pages with *Source: GitHub Actions* and add the `CLIENT_DENYLIST` secret; every push to `main` deploys to `https://<user>.github.io/<repo>/`.
- Linking it from an existing site is a menu item pointing at either URL (or a subdomain mapped to the Pages project).

## Roadmap

- **v1.1** — MW-D: the *AI for Auditors* Appendix B teardown statement as a fourth package; per-year tenant_amount ingestion; print stylesheet polish.
- **v2** — narrative layer: an LLM drafts the finding letter *from* engine output (`Finding[]` in, prose out). It never computes a number; the engine's working table stays the authority and is attached verbatim.
- **v2** — lease-abstract import from the Recon Forensics `AuditAbstract` schema so `lease_lite` is derived, not typed.

## Status

v1.0 — all twelve checks, three packages, upload path, gates, CI. Built from the build plan in *Lease Audit Projects / Red Flag Scanner*. Synthetic data only; no client lease, statement or figure appears anywhere in this repository or its output, and two automated gates keep it that way.
