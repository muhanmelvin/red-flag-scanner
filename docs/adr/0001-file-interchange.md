# 0001 — Apps in this family exchange files, not requests

**Status:** accepted · 2026-08-28

## Context

Recon Foundry forges complete synthetic reconciliation packages, and one of the
files it emits is a ReconPackage in this engine's canonical shape. That makes an
obvious feature available: a button here that fetches a freshly forged package
from `foundry.petriumalpha.com`, or a Foundry that posts one straight into this
page. Either would save the visitor a download and an upload.

The decision was recorded until now only in a comment at the top of
`recon-foundry/src/engine/render/recon-package.ts`, which is not where anyone
would look for it before proposing the feature.

## Decision

The interchange between two apps in this family is **a file**: downloaded in one,
uploaded to the other, or committed as a test fixture. No app fetches from
another, and no app is embedded in another.

The only coupling permitted is an anchor the visitor clicks. It lives in one
named module per repo — `src/ui/foundry-link.ts` here,
`src/ui/scanner-link.ts` there — so that the privacy tests can pin exactly what
may name a remote host.

## Why

**The claim on the masthead is the product.** Every page here says your file
never leaves your browser, and it is true by construction rather than by policy:
`index.html` ships a Content-Security-Policy with `connect-src 'none'`, and
`tests/privacy.test.ts` fails on the mere presence of a network primitive in the
source. A single legitimate fetch turns a fact into a promise. An auditor
handing this page a landlord's statement is entitled to the fact.

**It would not survive the builds we actually ship.** `npm run build:single`
produces one offline HTML file, which is how this app gets handed to someone on
a plane. A feature that only works with a live sibling site is a feature that is
broken in half the distributions.

**Files decouple versions.** A package forged today is still readable by this
engine next year, and a fixture pair committed here is what tells us when it
stops being — see `tests/foundry.test.ts`. A live call couples two deploy
schedules and hides drift instead of surfacing it.

**The saving is one click.** Weighed against the three reasons above.

## Consequences

- Discoverability has to be paid for in the UI, since it cannot be paid for in
  code: the picker names Recon Foundry and links to it, and the upload panel
  says a forged JSON package is the only input that exercises all twelve checks.
- `schema/recon-package.schema.json` is duplicated, byte-for-byte, in every repo
  that speaks the format. `app-starter/INTERCHANGE.md` is the spec.
- Drift between the copies is caught by fixtures, not by types:
  `tests/fixtures/foundry/` holds packages generated over there and scanned by
  the real engine here.

## What would reopen this

A second app needing the *same* data at the same moment on the same screen —
not a handover but a genuine composition. That is a different feature from the
one considered here, and it would need its own answer to the privacy claim
before it got one from this file.
