import { define, z } from '../api';
import { AppError } from '../errors';
import { applyReceiptCost, moveStock } from '../ledger';
import { posLocationId, resolveBatch } from '../batches';
import type { Ctx } from '../ctx';

const int = z.number().int();

export const INBOUND_REASONS = ['opening', 'receipt', 'correction_in', 'found'] as const;
export const OUTBOUND_REASONS = ['correction_out', 'damage', 'expiry', 'theft_loss', 'sample'] as const;

/** Non-weighed products can only move in whole units. */
export function assertQtyForProduct(ctx: Ctx, productId: number, qtyMilli: number): any {
  const p = ctx.db.prepare('SELECT id, name, is_weighed, active FROM products WHERE id = ?').get(productId) as any;
  if (!p) throw new AppError('NOT_FOUND', `Product #${productId} not found.`);
  if (!p.is_weighed && qtyMilli % 1000 !== 0)
    throw new AppError('VALIDATION', `"${p.name}" is sold in whole units; fractional quantity not allowed.`);
  return p;
}

define('stock.locations', {
  module: 'core',
  perm: 'stock.view',
  handler: (ctx) =>
    ctx.db
      .prepare('SELECT id, code, name, kind, site, zone, rack, bin, capacity_milli, active FROM locations ORDER BY kind, site, code')
      .all(),
});

define('stock.levels', {
  module: 'core',
  perm: 'stock.view',
  input: z.object({
    productId: int.optional(),
    locationId: int.optional(),
    search: z.string().trim().max(80).optional(),
    page: int.min(1).default(1),
    pageSize: int.min(1).max(500).default(200),
  }),
  handler: (ctx, i) => {
    const where = ['s.qty_milli > 0'];
    const args: unknown[] = [];
    if (i.productId) (where.push('s.product_id = ?'), args.push(i.productId));
    if (i.locationId) (where.push('s.location_id = ?'), args.push(i.locationId));
    if (i.search) (where.push('(p.name LIKE ? OR p.sku LIKE ?)'), args.push(`%${i.search}%`, `%${i.search}%`));
    const rows = ctx.db
      .prepare(
        `SELECT s.product_id, s.location_id, s.batch_id, s.status, s.qty_milli, p.sku, p.name, p.unit, p.cost_minor, l.name AS location, l.kind AS location_kind,
                bt.batch_no, bt.expiry_date
         FROM stock s JOIN products p ON p.id = s.product_id JOIN locations l ON l.id = s.location_id LEFT JOIN batches bt ON bt.id = s.batch_id
         WHERE ${where.join(' AND ')} ORDER BY p.name, l.kind, bt.expiry_date LIMIT ? OFFSET ?`,
      )
      .all(...args, i.pageSize, (i.page - 1) * i.pageSize);
    return rows;
  },
});

/** One row per product with where its stock sits. Never double counts: each unit is in exactly one bucket. */
define('stock.summary', {
  module: 'core',
  perm: 'stock.view',
  handler: (ctx) => {
    const pos = posLocationId(ctx);
    return ctx.db
      .prepare(
        `SELECT p.id, p.sku, p.name, p.unit, p.reorder_level_milli, p.cost_minor, c.name AS category,
           COALESCE(SUM(CASE WHEN s.status='sellable' AND s.location_id = ? THEN s.qty_milli END),0) AS shelf_milli,
           COALESCE(SUM(CASE WHEN s.status='sellable' AND l.kind = 'backroom' THEN s.qty_milli END),0) AS backroom_milli,
           COALESCE(SUM(CASE WHEN s.status='sellable' AND l.kind = 'godown' THEN s.qty_milli END),0) AS godown_milli,
           COALESCE(SUM(CASE WHEN s.status <> 'sellable' THEN s.qty_milli END),0) AS held_milli,
           COALESCE(SUM(s.qty_milli),0) AS total_milli
         FROM products p LEFT JOIN categories c ON c.id = p.category_id LEFT JOIN stock s ON s.product_id = p.id LEFT JOIN locations l ON l.id = s.location_id
         WHERE p.active = 1 GROUP BY p.id ORDER BY p.name`,
      )
      .all(pos);
  },
});

define('stock.adjust', {
  module: 'core',
  perm: 'stock.adjust',
  input: z.object({
    productId: int,
    locationId: int,
    batchId: int.min(0).default(0),
    deltaMilli: int.refine((n) => n !== 0, 'Quantity change cannot be zero'),
    reason: z.enum([...INBOUND_REASONS, ...OUTBOUND_REASONS]),
    note: z.string().trim().max(300).default(''),
    unitCostMinor: int.min(0).max(100_000_000).default(0),
    batchNo: z.string().trim().max(40).optional(),
    mfgDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    expiryDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  }),
  handler: (ctx, i) =>
    ctx.tx(() => {
      const inbound = (INBOUND_REASONS as readonly string[]).includes(i.reason);
      if (inbound !== i.deltaMilli > 0)
        throw new AppError(
          'VALIDATION',
          `Reason "${i.reason}" is ${inbound ? 'an increase' : 'a decrease'}; quantity sign does not match.`,
        );
      if (!inbound && i.note.length < 3) throw new AppError('VALIDATION', 'A note (min 3 characters) is required for stock reductions.');
      const loc = ctx.db.prepare('SELECT id, kind FROM locations WHERE id = ? AND active = 1').get(i.locationId);
      if (!loc) throw new AppError('NOT_FOUND', 'Location not found or inactive.');
      assertQtyForProduct(ctx, i.productId, Math.abs(i.deltaMilli));
      const qty = Math.abs(i.deltaMilli);
      const ref = `ADJ-${ctx.nextCounter('adjustment')}`;
      if (inbound) {
        const batchId = resolveBatch(ctx, i.productId, { batchNo: i.batchNo, mfgDate: i.mfgDate, expiryDate: i.expiryDate });
        if (i.reason === 'receipt') applyReceiptCost(ctx, i.productId, qty, i.unitCostMinor);
        moveStock(ctx, {
          productId: i.productId,
          batchId,
          qtyMilli: qty,
          to: { locationId: i.locationId, status: 'sellable' },
          reason: i.reason,
          refType: 'adjustment',
          refId: ref,
          note: i.note,
          unitCostMinor: i.unitCostMinor,
        });
      } else {
        // 'damage' keeps the units on record as damaged stock (traceable); all other decreases remove them.
        moveStock(ctx, {
          productId: i.productId,
          batchId: i.batchId,
          qtyMilli: qty,
          from: { locationId: i.locationId, status: 'sellable' },
          to: i.reason === 'damage' ? { locationId: i.locationId, status: 'damaged' } : undefined,
          reason: i.reason,
          refType: 'adjustment',
          refId: ref,
          note: i.note,
        });
      }
      ctx.audit('stock.adjusted', 'product', i.productId, { ref, reason: i.reason, deltaMilli: i.deltaMilli, locationId: i.locationId });
      return { ref };
    }),
});

define('stock.ledger', {
  module: 'core',
  perm: 'stock.view',
  input: z.object({
    productId: int.optional(),
    reason: z.string().max(40).optional(),
    refType: z.string().max(40).optional(),
    refId: z.string().max(60).optional(),
    page: int.min(1).default(1),
    pageSize: int.min(1).max(500).default(100),
  }),
  handler: (ctx, i) => {
    const where = ['1=1'];
    const args: unknown[] = [];
    if (i.productId) (where.push('l.product_id = ?'), args.push(i.productId));
    if (i.reason) (where.push('l.reason = ?'), args.push(i.reason));
    if (i.refType) (where.push('l.ref_type = ?'), args.push(i.refType));
    if (i.refId) (where.push('l.ref_id = ?'), args.push(i.refId));
    return ctx.db
      .prepare(
        `SELECT l.id, l.ts, l.product_id, p.sku, p.name, l.batch_id, bt.batch_no, l.qty_milli, l.reason, l.ref_type, l.ref_id, l.note,
                fl.name AS from_location, l.from_status, tl.name AS to_location, l.to_status, u.name AS actor
         FROM stock_ledger l JOIN products p ON p.id = l.product_id
         LEFT JOIN locations fl ON fl.id = l.from_location_id LEFT JOIN locations tl ON tl.id = l.to_location_id
         LEFT JOIN users u ON u.id = l.actor_id LEFT JOIN batches bt ON bt.id = l.batch_id
         WHERE ${where.join(' AND ')} ORDER BY l.id DESC LIMIT ? OFFSET ?`,
      )
      .all(...args, i.pageSize, (i.page - 1) * i.pageSize);
  },
});
