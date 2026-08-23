# Client-data gates

Everything public in this repo runs on the synthetic Maplewood corpus only. Two
automated gates enforce that, and both read the same deny-list:

1. **Test gate** — `tests/no-client-identifiers.test.ts` scans `src/`, `schema/`,
   `tools/`, `index.html` and `README.md` for every deny-listed term and fails
   `npm test` on a hit.
2. **Build gate** — `scripts/build-gate.mjs` runs after `vite build`, re-scans
   the output directory, and on a hit **deletes the output and exits non-zero**,
   so nothing reaches a deploy step.

## Where the deny-list lives

- `gates/denylist.public.json` — committed; generic canaries only. Exists so the
  mechanism is testable in a clean clone.
- `gates/denylist.local.json` — **git-ignored**; the private list of real site
  codes, client names and source-library folder names. Copy it from the Cap
  Trap Explorer repo; never reconstruct it from memory into a committed file.
- `CLIENT_DENYLIST` — environment variable (JSON array), used by CI and by the
  hosting build. Set it as a GitHub Actions secret and as a Cloudflare Pages /
  GitHub Pages environment variable.

With `REQUIRE_PRIVATE_DENYLIST=1` (CI and hosting builds set this), a missing
private list fails the gate instead of passing silently.
