import type { Ctx } from './ctx';
import { AppError } from './errors';

export type StockStatus = 'sellable' | 'quarantine' | 'damaged';

export interface StockPoint {
  locationId: number;
  status: StockStatus;
}

export interface Move {
  productId: number;
  batchId?: number;
  qtyMilli: number;
  from?: StockPoint;
  to?: StockPoint;
  reason: string;
  refType?: string;
  refId?: string | number;
  note?: string;
  unitCostMinor?: number;
}

/**
 * The ONLY function that mutates the stock table. Every call writes a ledger row, so any
 * quantity can be traced to a reason, a source/destination, an actor and a timestamp.
 * Must be called inside ctx.tx() together with the business record that justifies it.
 * Negative stock is never allowed: an insufficient source row raises INSUFFICIENT_STOCK.
 */
export function moveStock(ctx: Ctx, m: Move): void {
  if (!Number.isSafeInteger(m.qtyMilli) || m.qtyMilli <= 0)
    throw new AppError('VALIDATION', 'Stock quantity must be a positive integer (milli-units).');
  if (!m.from && !m.to) throw new AppError('VALIDATION', 'A stock move needs a source or destination.');
  const batch = m.batchId ?? 0;
  const db = ctx.db;
  if (m.from) {
    const row = db
      .prepare('SELECT qty_milli FROM stock WHERE product_id=? AND location_id=? AND batch_id=? AND status=?')
      .get(m.productId, m.from.locationId, batch, m.from.status) as { qty_milli: number } | undefined;
    const have = row?.qty_milli ?? 0;
    if (have < m.qtyMilli) {
      throw new AppError(
        'INSUFFICIENT_STOCK',
        `Insufficient ${m.from.status} stock (have ${have / 1000}, need ${m.qtyMilli / 1000}) for product #${m.productId}.`,
        {
          productId: m.productId,
          have,
          need: m.qtyMilli,
        },
      );
    }
    db.prepare('UPDATE stock SET qty_milli = qty_milli - ? WHERE product_id=? AND location_id=? AND batch_id=? AND status=?').run(
      m.qtyMilli,
      m.productId,
      m.from.locationId,
      batch,
      m.from.status,
    );
  }
  if (m.to) {
    db.prepare(
      `INSERT INTO stock(product_id, location_id, batch_id, status, qty_milli) VALUES (?,?,?,?,?)
       ON CONFLICT(product_id, location_id, batch_id, status) DO UPDATE SET qty_milli = qty_milli + excluded.qty_milli`,
    ).run(m.productId, m.to.locationId, batch, m.to.status, m.qtyMilli);
  }
  db.prepare(
    `INSERT INTO stock_ledger(ts, product_id, batch_id, qty_milli, from_location_id, from_status, to_location_id, to_status, reason, ref_type, ref_id, actor_id, note, unit_cost_minor)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    ctx.ts(),
    m.productId,
    batch,
    m.qtyMilli,
    m.from?.locationId ?? null,
    m.from?.status ?? null,
    m.to?.locationId ?? null,
    m.to?.status ?? null,
    m.reason,
    m.refType ?? null,
    m.refId === undefined ? null : String(m.refId),
    ctx.user?.id ?? null,
    m.note ?? null,
    m.unitCostMinor ?? 0,
  );
}

export function stockQty(ctx: Ctx, productId: number, opts: { locationId?: number; status?: StockStatus; batchId?: number } = {}): number {
  const where = ['product_id = ?'];
  const args: unknown[] = [productId];
  if (opts.locationId !== undefined) (where.push('location_id = ?'), args.push(opts.locationId));
  if (opts.status) (where.push('status = ?'), args.push(opts.status));
  if (opts.batchId !== undefined) (where.push('batch_id = ?'), args.push(opts.batchId));
  const r = ctx.db.prepare(`SELECT COALESCE(SUM(qty_milli),0) AS q FROM stock WHERE ${where.join(' AND ')}`).get(...args) as { q: number };
  return r.q;
}

/**
 * Receiving stock at a cost updates the product's moving-average cost across all on-hand stock
 * (sellable + quarantine + damaged, all locations) before the new quantity is added.
 */
export function applyReceiptCost(ctx: Ctx, productId: number, qtyMilli: number, unitCostMinor: number): void {
  if (unitCostMinor <= 0) return;
  const onHand = stockQty(ctx, productId);
  const p = ctx.db.prepare('SELECT cost_minor FROM products WHERE id = ?').get(productId) as { cost_minor: number };
  const newCost = onHand <= 0 ? unitCostMinor : Math.round((onHand * p.cost_minor + qtyMilli * unitCostMinor) / (onHand + qtyMilli));
  ctx.db.prepare('UPDATE products SET cost_minor = ?, updated_at = ? WHERE id = ?').run(newCost, ctx.ts(), productId);
}
