/** Quantities are stored as integer milli-units (1000 = 1 pcs / 1 kg / 1 l). */
export const MILLI = 1000;

export function toMilli(v: number | string): number {
  const n = typeof v === 'string' ? Number(v.trim()) : v;
  if (!Number.isFinite(n)) throw new Error('Invalid quantity');
  return Math.round(n * MILLI);
}

export function fromMilli(m: number): number {
  return m / MILLI;
}

export function formatQty(m: number): string {
  if (m % MILLI === 0) return String(m / MILLI);
  return (m / MILLI).toFixed(3).replace(/0+$/, '');
}

export const UNITS = ['pcs', 'kg', 'g', 'l', 'ml', 'pack', 'carton'] as const;
export type Unit = (typeof UNITS)[number];
