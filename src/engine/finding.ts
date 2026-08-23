import type { Finding, Severity, SkipRecord } from "./types.ts";
import { normalizeLabel } from "./normalize.ts";

export interface FindingInput {
  check_id: string;
  title: string;
  severity: Severity;
  year: number | [number, number];
  category?: string;
  tenant_impact_usd?: number; // dollars
  tenant_exposure_usd?: number; // dollars, at stake (not summed)
  narrative: string;
  working: Array<{ label: string; value: string }>;
  refs: string[];
  related?: string[];
  /** Distinguishes several findings of one check in one year (e.g. fee sub-tests). */
  tag?: string;
}

export function findingId(check_id: string, year: number | [number, number], category?: string, tag?: string): string {
  const y = Array.isArray(year) ? `${year[0]}-${year[1]}` : String(year);
  const parts = [check_id, y];
  if (tag) parts.push(tag);
  if (category) parts.push(normalizeLabel(category).replace(/\s+/g, "-") || "line");
  return parts.join(":");
}

export function mkFinding(input: FindingInput): Finding {
  const { tag, ...rest } = input;
  const f: Finding = {
    id: findingId(input.check_id, input.year, input.category, tag),
    ...rest,
  };
  if (f.tenant_impact_usd === undefined) delete f.tenant_impact_usd;
  if (f.tenant_exposure_usd === undefined) delete f.tenant_exposure_usd;
  if (f.category === undefined) delete f.category;
  if (!f.related || f.related.length === 0) delete f.related;
  return f;
}

export function skip(check_id: string, title: string, reason: string): SkipRecord {
  return { check_id, title, skipped: true, reason };
}

export function yearLabel(year: number | [number, number]): string {
  return Array.isArray(year) ? `${year[0]}→${year[1]}` : String(year);
}
