import type { Ctx } from './ctx';
import { AppError } from './errors';

export interface BatchSpec {
  batchNo?: string;
  mfgDate?: string;
  expiryDate?: string;
}

/** Batch/expiry tracking is available whenever the warehouse (GRN) or inventory-controls module is enabled. */
export function batchesEnabled(ctx: Ctx): boolean {
  return ctx.has('inventory_controls') || ctx.has('warehouse');
}

/**
 * Find or create a batch for a product. Returns 0 ("no batch") when batch tracking is not in play.
 * Re-using a batch number with a different expiry date is rejected to keep FEFO trustworthy.
 */
export function resolveBatch(ctx: Ctx, productId: number, spec?: BatchSpec): number {
  const product = ctx.db.prepare('SELECT track_batch, name FROM products WHERE id = ?').get(productId) as
    { track_batch: number; name: string } | undefined;
  if (!product) throw new AppError('NOT_FOUND', 'Product not found.');
  if (!batchesEnabled(ctx) || !product.track_batch) return 0;
  if (!spec?.batchNo)
    throw new AppError('VALIDATION', `Batch number and expiry date are required for batch-tracked product "${product.name}".`);
  if (!spec.expiryDate) throw new AppError('VALIDATION', `Expiry date is required for batch ${spec.batchNo} of "${product.name}".`);
  const existing = ctx.db
    .prepare('SELECT id, expiry_date FROM batches WHERE product_id = ? AND batch_no = ?')
    .get(productId, spec.batchNo) as { id: number; expiry_date: string | null } | undefined;
  if (existing) {
    if (existing.expiry_date && existing.expiry_date !== spec.expiryDate) {
      throw new AppError('CONFLICT', `Batch ${spec.batchNo} already exists with expiry ${existing.expiry_date}.`);
    }
    return existing.id;
  }
  return Number(
    ctx.db
      .prepare('INSERT INTO batches(product_id, batch_no, mfg_date, expiry_date) VALUES (?,?,?,?)')
      .run(productId, spec.batchNo, spec.mfgDate ?? null, spec.expiryDate).lastInsertRowid,
  );
}

export function posLocationId(ctx: Ctx): number {
  const configured = Number(ctx.setting('pos_location_id', '0'));
  if (configured) {
    const ok = ctx.db.prepare("SELECT id FROM locations WHERE id = ? AND kind = 'shelf' AND active = 1").get(configured);
    if (ok) return configured;
  }
  const first = ctx.db.prepare("SELECT id FROM locations WHERE kind = 'shelf' AND active = 1 ORDER BY id LIMIT 1").get() as
    { id: number } | undefined;
  if (!first) throw new AppError('INVALID_STATE', 'No active shelf location is configured for POS.');
  return first.id;
}
