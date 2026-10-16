/** Money is always an integer number of minor units (paise). Quantities are integer milli-units (1000 = 1 unit). */

export const CURRENCY_SYMBOL = '₹';

/** Integer division rounding half away from zero. */
export function roundDiv(n: number, d: number): number {
  if (d === 0) throw new Error('Division by zero');
  const sign = n < 0 !== d < 0 ? -1 : 1;
  const an = Math.abs(n);
  const ad = Math.abs(d);
  return sign * Math.floor((2 * an + ad) / (2 * ad));
}

export function assertMinor(v: number, label = 'amount'): number {
  if (!Number.isSafeInteger(v)) throw new Error(`${label} must be an integer number of minor units`);
  return v;
}

export function formatMoney(minor: number): string {
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  const rupees = Math.floor(abs / 100);
  const paise = String(abs % 100).padStart(2, '0');
  return `${sign}${CURRENCY_SYMBOL}${rupees.toLocaleString('en-IN')}.${paise}`;
}

/** Parse a user-typed decimal ("12.5", "1,200") into minor units without float drift. */
export function parseMoney(text: string): number | null {
  const m = /^\s*(-?)(\d[\d,]*)(?:\.(\d{1,2}))?\s*$/.exec(text);
  if (!m) return null;
  const rupees = Number(m[2].replace(/,/g, ''));
  const paise = Number((m[3] ?? '').padEnd(2, '0') || '0');
  const v = rupees * 100 + paise;
  return m[1] ? -v : v;
}

/** unit price (minor per 1 unit) × quantity (milli-units) → minor, rounded half away from zero. */
export function lineAmount(unitMinor: number, qtyMilli: number): number {
  return roundDiv(unitMinor * qtyMilli, 1000);
}

/** amount × basis points (1% = 100bp). */
export function percentOf(amountMinor: number, bp: number): number {
  return roundDiv(amountMinor * bp, 10000);
}

/** Tax contained in a tax-inclusive gross amount. */
export function taxFromInclusive(grossMinor: number, rateBp: number): number {
  return roundDiv(grossMinor * rateBp, 10000 + rateBp);
}

/** Split `total` proportionally to `weights` so the parts always sum exactly to `total`. */
export function allocate(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) return weights.map(() => 0);
  const out = weights.map((w) => Math.floor((total * w) / sum));
  let rest = total - out.reduce((a, b) => a + b, 0);
  for (let i = 0; rest > 0; i = (i + 1) % out.length) {
    if (weights[i] > 0) {
      out[i] += 1;
      rest--;
    }
  }
  return out;
}
