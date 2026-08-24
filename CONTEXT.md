# Domain glossary

The words this project uses, in the sense it uses them. These are user-facing
terms — they appear in the interface, in the code and here, and they should
mean the same thing in all three. Nothing about implementation belongs in this
file.

## The package

**Reconciliation package** — one lease, one premises, several years of a
landlord's operating-expense reconciliation, together with the lease terms the
checks need. The unit a scan runs on.

**Statement** — the landlord's reconciliation for one year, as the landlord
presented it: expense lines under their own captions and sections, the fees,
the capped pool, and what was charged to the tenant.

**Statement view** — the reading of a package that shows those figures as a
table, year by year, rather than as conclusions about them.

**Line** — one caption on the statement with an amount for a year. A line
belongs to a *section* (the landlord's grouping: CAM, Taxes, Insurance) and a
*bucket* (controllable or non-controllable, as the landlord classified it).

**Capped pool** — the group of expenses a cap applies to, and the landlord's
own arithmetic about it: what it actually cost, what the landlord says the cap
allowed, and what was billed.

## The lease

**Signed lease** — the lease terms a package was authored with. The document of
record for that package; the scanner never changes it.

**Model lease** — the readable lease generated from those terms. Illustrative:
it shows what the abstracted terms say, in the register a lease says it. It is
not an executed document and does not purport to be one.

**Operative clause** — a clause the lease has: a cap, a fee, a gross-up right.

**Negative clause** — the same numbered section where the lease has no such
term, stated as the absence it is ("This Lease contains no cap on Operating
Expenses"). Absence is a lease term too, and often the decisive one.

**Redlined lease** (a *draft*) — a working copy of a signed lease, edited in
the lease designer. It exists for the session and is discarded on reset; the
signed lease is untouched throughout.

## The scan

**Check** — one test, RF-01 to RF-12. A check either runs and returns findings,
or declines to run and says why.

**Finding** — one thing worth raising: what it is, which year, the arithmetic
behind it, and a sentence written to go into a finding letter.

**Skip** — a check that could not run, with the reason. A scanner that says
what it did *not* test is worth more than one that implies it tested
everything.

**Tenant impact** — the estimated overcharge at the tenant's share. Summed
across findings.

**Amount at stake** — the tenant-level amount a question-type finding concerns
(a swing, a repeated figure). Not an overcharge, and never summed.

**Baseline scan** — the scan of a package against its *signed* lease. What a
redlined scan is compared against.

**Redline diff** — the difference between the two: findings resolved, findings
created, findings repriced, and checks that stopped or started running because
a clause was struck or added.
