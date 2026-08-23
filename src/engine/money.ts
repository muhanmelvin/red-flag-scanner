/**
 * Money helpers. The engine works in integer cents; these convert at the
 * boundary and format for narratives. No float arithmetic on money anywhere
 * else in `src/engine/`.
 */

/** Dollars (≤ 2 dp) → integer cents. Rounds half away from zero. */
export function toCents(dollars: number): number {
  if (!Number.isFinite(dollars)) throw new Error(`toCents: not a finite number: ${dollars}`);
  const sign = dollars < 0 ? -1 : 1;
  return sign * Math.round(Math.abs(dollars) * 100 + 1e-9);
}

/** Integer cents → dollars number (for output fields). */
export function toDollars(cents: number): number {
  return Math.round(cents) / 100;
}

/** cents × rate (as a fraction, e.g. 0.03) → cents, rounded half up to the cent. */
export function mulRate(cents: number, rate: number): number {
  const sign = cents < 0 ? -1 : 1;
  return sign * Math.round(Math.abs(cents) * rate + 1e-9);
}

/** cents × percent (e.g. 5 means 5%) → cents. */
export function pct(cents: number, percent: number): number {
  return mulRate(cents, percent / 100);
}

/** Format integer cents as $1,234.56 (negative as -$1,234.56). */
export function usd(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const dollars = Math.floor(abs / 100);
  const rem = abs % 100;
  const body = dollars.toLocaleString("en-US") + "." + String(rem).padStart(2, "0");
  return (neg ? "-$" : "$") + body;
}

/** Format a fraction (0.0714285) as a percentage with n decimals. */
export function pctStr(frac: number, decimals = 2): string {
  return (frac * 100).toFixed(decimals) + "%";
}

/** Format a signed percentage change from a ratio (0.18 → "+18.0%"). */
export function deltaStr(frac: number, decimals = 1): string {
  const v = frac * 100;
  const s = v.toFixed(decimals);
  return (v > 0 ? "+" : "") + s + "%";
}

export function sumCents(values: number[]): number {
  let s = 0;
  for (const v of values) s += v;
  return s;
}
