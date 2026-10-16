import { Platform } from 'react-native';
import { formatMoney, parseMoney } from '../../shared/money';
import { formatQty } from '../../shared/qty';

export { formatMoney, parseMoney, formatQty };

/** Browser-local calendar date as YYYY-MM-DD. */
export function localDate(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return localDate(d);
}

export function newRef(prefix = 'pos'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function money(minor: number | null | undefined): string {
  return formatMoney(minor ?? 0);
}

/** Convert user-typed money ("12.5") to minor units; null when invalid. */
export function toMinor(text: string): number | null {
  return parseMoney(text);
}

export function minorToText(minor: number): string {
  return (minor / 100).toFixed(2);
}

export function qtyText(milli: number, unit?: string): string {
  return `${formatQty(milli)}${unit && unit !== 'pcs' ? ` ${unit}` : ''}`;
}

/** Print monospaced receipt lines via a popup window (web only). */
export function printReceipt(lines: string[]): void {
  if (Platform.OS !== 'web') return;
  const w = window.open('', '_blank', 'width=420,height=640');
  if (!w) return;
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  w.document.write(
    `<html><head><title>Receipt</title><style>body{font-family:Consolas,monospace;font-size:12px;white-space:pre}</style></head><body>${esc(lines.join('\n'))}</body></html>`,
  );
  w.document.close();
  w.focus();
  w.print();
}
