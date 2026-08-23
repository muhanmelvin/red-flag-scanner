/**
 * The preloaded synthetic packages. All three describe the fictional
 * Maplewood Commerce Center — the same universe as the AI for Auditors course
 * and the Cap Trap Explorer. Authored by tools/author-packages.mjs.
 */

import type { ReconPackage } from "../engine/types.ts";
import mwa from "./mw-a.json";
import mwb from "./mw-b.json";
import mwc from "./mw-c.json";

export const PACKAGES: readonly ReconPackage[] = Object.freeze([
  mwb as unknown as ReconPackage,
  mwc as unknown as ReconPackage,
  mwa as unknown as ReconPackage,
]);

export function packageById(id: string): ReconPackage | undefined {
  return PACKAGES.find((p) => p.meta.package_id === id);
}
