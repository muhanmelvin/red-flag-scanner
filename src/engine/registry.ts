/** Ordered list of checks. Order is the order they appear in "checks run". */

import type { Check } from "./types.ts";
import { RF01 } from "./checks/rf01_yoy.ts";
import { RF02 } from "./checks/rf02_new_category.ts";
import { RF03 } from "./checks/rf03_vanished.ts";
import { RF04 } from "./checks/rf04_migration.ts";
import { RF05 } from "./checks/rf05_round.ts";
import { RF06 } from "./checks/rf06_cap.ts";
import { RF07 } from "./checks/rf07_fees.ts";
import { RF08 } from "./checks/rf08_share.ts";
import { RF09 } from "./checks/rf09_capital.ts";
import { RF10 } from "./checks/rf10_grossup.ts";
import { RF11 } from "./checks/rf11_tieout.ts";
import { RF12 } from "./checks/rf12_identical.ts";

export const CHECKS: readonly Check[] = Object.freeze([
  RF01, RF02, RF03, RF04, RF05, RF06, RF07, RF08, RF09, RF10, RF11, RF12,
]);

/** Catalog metadata for the UI and README: what each check implements. */
export const CHECK_CATALOG: ReadonlyArray<{ id: string; title: string; concept: string }> = Object.freeze([
  { id: "RF-01", title: "Year-over-year variance", concept: "Large swings; errors cluster around transitions" },
  { id: "RF-02", title: "New category appeared", concept: "New line items" },
  { id: "RF-03", title: "Category vanished", concept: "Categories that vanish and reappear elsewhere" },
  { id: "RF-04", title: "Controllable → non-controllable migration", concept: "The bridge: re-classification out of the capped pool" },
  { id: "RF-05", title: "Round-number test", concept: "Round numbers signal estimates and allocations" },
  { id: "RF-06", title: "Cap compliance / cap-on-cap", concept: "Lesser-of rule; cap grown on the cap" },
  { id: "RF-07", title: "Fee tests", concept: "One service, one fee; fee on the permitted base only" },
  { id: "RF-08", title: "Pro-rata share tests", concept: "Stated share, denominator drift and shrinkage, tie-out" },
  { id: "RF-09", title: "Capital & amortization", concept: "Cost ÷ months × months in service; lumps that should amortize" },
  { id: "RF-10", title: "Gross-up sanity", concept: "Variable costs only, never beyond the target occupancy" },
  { id: "RF-11", title: "Arithmetic tie-out", concept: "Verify, don't assume" },
  { id: "RF-12", title: "Identical-amount test", concept: "The previous-year trap" },
]);
