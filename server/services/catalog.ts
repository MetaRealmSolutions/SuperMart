import { define, z } from '../api';
import { AppError } from '../errors';
import { posLocationId } from '../batches';
import { UNITS } from '../../shared/qty';
import type { Ctx } from '../ctx';

const int = z.number().int();
const minor = int.min(0).max(100_000_000);

const productInput = z.object({
  id: int.optional(),
  sku: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(120),
  categoryId: int.nullable().default(null),
  brandId: int.nullable().default(null),
  unit: z.enum(UNITS).default('pcs'),
  isWeighed: z.boolean().default(false),
  priceMinor: minor,
  mrpMinor: minor.default(0),
  costMinor: minor.default(0),
  taxRateBp: int.min(0).max(2800).default(0),
  trackBatch: z.boolean().default(false),
  reorderLevelMilli: int.min(0).default(0),
  active: z.boolean().default(true),
  barcodes: z.array(z.string().trim().min(3).max(32)).max(10).default([]),
});

export function getProductRow(ctx: Ctx, id: number): any {
  const p = ctx.db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  if (!p) throw new AppError('NOT_FOUND', 'Product not found.');
  return p;
}

define('catalog.listProducts', {
  module: 'core',
  perm: 'catalog.view',
  input: z.object({
    search: z.string().trim().max(80).optional(),
    categoryId: int.optional(),
    includeInactive: z.boolean().default(false),
    page: int.min(1).default(1),
    pageSize: int.min(1).max(500).default(100),
  }),
  handler: (ctx, i) => {
    const pos = posLocationId(ctx);
    const where: string[] = [];
    const args: unknown[] = [];
    if (!i.includeInactive) where.push('p.active = 1');
    if (i.categoryId) (where.push('p.category_id = ?'), args.push(i.categoryId));
    if (i.search) {
      where.push('(p.name LIKE ? OR p.sku LIKE ? OR EXISTS (SELECT 1 FROM barcodes b WHERE b.product_id = p.id AND b.barcode LIKE ?))');
      const like = `%${i.search}%`;
      args.push(like, like, like);
    }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = (ctx.db.prepare(`SELECT COUNT(*) c FROM products p ${w}`).get(...args) as { c: number }).c;
    const rows = ctx.db
      .prepare(
        `SELECT p.id, p.sku, p.name, p.unit, p.is_weighed, p.price_minor, p.mrp_minor, p.cost_minor, p.tax_rate_bp, p.track_batch, p.reorder_level_milli, p.active,
                p.category_id, p.brand_id, c.name AS category, b.name AS brand,
                (SELECT COALESCE(SUM(qty_milli),0) FROM stock s WHERE s.product_id = p.id AND s.status = 'sellable' AND s.location_id = ?) AS shelf_milli,
                (SELECT COALESCE(SUM(qty_milli),0) FROM stock s WHERE s.product_id = p.id) AS total_milli,
                (SELECT group_concat(barcode, ', ') FROM barcodes WHERE product_id = p.id) AS barcodes
         FROM products p LEFT JOIN categories c ON c.id = p.category_id LEFT JOIN brands b ON b.id = p.brand_id
         ${w} ORDER BY p.name LIMIT ? OFFSET ?`,
      )
      .all(pos, ...args, i.pageSize, (i.page - 1) * i.pageSize);
    return { rows, total };
  },
});

define('catalog.getProduct', {
  module: 'core',
  perm: 'catalog.view',
  input: z.object({ id: int }),
  handler: (ctx, i) => {
    const p = getProductRow(ctx, i.id);
    const barcodes = (
      ctx.db.prepare('SELECT barcode FROM barcodes WHERE product_id = ? ORDER BY barcode').all(i.id) as { barcode: string }[]
    ).map((b) => b.barcode);
    const history = ctx.db
      .prepare('SELECT ts, field, old_minor, new_minor, actor_id FROM price_history WHERE product_id = ? ORDER BY id DESC LIMIT 50')
      .all(i.id);
    return { ...p, barcodes, history };
  },
});

define('catalog.saveProduct', {
  module: 'core',
  perm: 'catalog.edit',
  input: productInput,
  handler: (ctx, i) =>
    ctx.tx(() => {
      if (i.mrpMinor > 0 && i.priceMinor > i.mrpMinor) throw new AppError('VALIDATION', 'Selling price cannot exceed MRP.');
      if (i.isWeighed && !['kg', 'g', 'l', 'ml'].includes(i.unit))
        throw new AppError('VALIDATION', 'Weighed products need a measurable unit (kg, g, l, ml).');
      const dupSku = ctx.db.prepare('SELECT id FROM products WHERE sku = ? AND id <> ?').get(i.sku, i.id ?? 0);
      if (dupSku) throw new AppError('CONFLICT', `SKU "${i.sku}" is already used.`);
      for (const code of i.barcodes) {
        const owner = ctx.db.prepare('SELECT product_id FROM barcodes WHERE barcode = ?').get(code) as { product_id: number } | undefined;
        if (owner && owner.product_id !== (i.id ?? -1)) throw new AppError('CONFLICT', `Barcode ${code} belongs to another product.`);
      }
      const now = ctx.ts();
      let id = i.id;
      if (id) {
        const old = getProductRow(ctx, id);
        const priceFields: [string, number, number][] = [
          ['price_minor', old.price_minor, i.priceMinor],
          ['mrp_minor', old.mrp_minor, i.mrpMinor],
          ['cost_minor', old.cost_minor, i.costMinor],
        ];
        const changed = priceFields.filter(([, o, n]) => o !== n);
        if (changed.length) {
          ctx.require('price.edit');
          for (const [field, o, n] of changed) {
            ctx.db
              .prepare('INSERT INTO price_history(product_id, ts, actor_id, field, old_minor, new_minor) VALUES (?,?,?,?,?,?)')
              .run(id, now, ctx.user!.id, field, o, n);
            ctx.audit('price.changed', 'product', id, { field, from: o, to: n });
          }
        }
        if (old.tax_rate_bp !== i.taxRateBp) {
          ctx.require('price.edit');
          ctx.audit('tax.changed', 'product', id, { from: old.tax_rate_bp, to: i.taxRateBp });
        }
        ctx.db
          .prepare(
            `UPDATE products SET sku=?, name=?, category_id=?, brand_id=?, unit=?, is_weighed=?, price_minor=?, mrp_minor=?, cost_minor=?, tax_rate_bp=?,
             track_batch=?, reorder_level_milli=?, active=?, updated_at=? WHERE id=?`,
          )
          .run(
            i.sku,
            i.name,
            i.categoryId,
            i.brandId,
            i.unit,
            i.isWeighed ? 1 : 0,
            i.priceMinor,
            i.mrpMinor,
            i.costMinor,
            i.taxRateBp,
            i.trackBatch ? 1 : 0,
            i.reorderLevelMilli,
            i.active ? 1 : 0,
            now,
            id,
          );
        if (old.active && !i.active) ctx.audit('product.deactivated', 'product', id);
      } else {
        id = Number(
          ctx.db
            .prepare(
              `INSERT INTO products(sku,name,category_id,brand_id,unit,is_weighed,price_minor,mrp_minor,cost_minor,tax_rate_bp,track_batch,reorder_level_milli,active,created_at,updated_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            )
            .run(
              i.sku,
              i.name,
              i.categoryId,
              i.brandId,
              i.unit,
              i.isWeighed ? 1 : 0,
              i.priceMinor,
              i.mrpMinor,
              i.costMinor,
              i.taxRateBp,
              i.trackBatch ? 1 : 0,
              i.reorderLevelMilli,
              i.active ? 1 : 0,
              now,
              now,
            ).lastInsertRowid,
        );
        ctx.db
          .prepare('INSERT INTO price_history(product_id, ts, actor_id, field, old_minor, new_minor) VALUES (?,?,?,?,NULL,?)')
          .run(id, now, ctx.user!.id, 'price_minor', i.priceMinor);
        ctx.audit('product.created', 'product', id, { sku: i.sku });
      }
      ctx.db.prepare('DELETE FROM barcodes WHERE product_id = ?').run(id);
      for (const code of new Set(i.barcodes)) ctx.db.prepare('INSERT INTO barcodes(barcode, product_id) VALUES (?,?)').run(code, id);
      return { id };
    }),
});

/**
 * Barcode / SKU / name lookup used by POS. Exact barcode or SKU wins; otherwise a name search.
 * Barcode scanners behave as keyboard input, so the UI simply submits the typed text here.
 */
define('catalog.lookup', {
  module: 'core',
  perm: 'catalog.view',
  input: z.object({ code: z.string().trim().min(1).max(80) }),
  handler: (ctx, i) => {
    const pos = posLocationId(ctx);
    const select = `SELECT p.id, p.sku, p.name, p.unit, p.is_weighed, p.price_minor, p.mrp_minor, p.tax_rate_bp, p.active,
        (SELECT COALESCE(SUM(s.qty_milli),0) FROM stock s LEFT JOIN batches bt ON bt.id = s.batch_id
           WHERE s.product_id = p.id AND s.location_id = ? AND s.status = 'sellable' AND (bt.expiry_date IS NULL OR bt.expiry_date >= ?)) AS available_milli`;
    const today = ctx.today();
    const bc = ctx.db
      .prepare(
        `${select}, b.pack_qty_milli AS pack_qty_milli FROM barcodes b JOIN products p ON p.id = b.product_id WHERE b.barcode = ? AND p.active = 1`,
      )
      .get(pos, today, i.code) as any;
    if (bc) return { exact: true, matches: [bc] };
    const sku = ctx.db
      .prepare(`${select}, 1000 AS pack_qty_milli FROM products p WHERE p.sku = ? COLLATE NOCASE AND p.active = 1`)
      .get(pos, today, i.code) as any;
    if (sku) return { exact: true, matches: [sku] };
    const like = `%${i.code}%`;
    const matches = ctx.db
      .prepare(
        `${select}, 1000 AS pack_qty_milli FROM products p WHERE p.active = 1 AND (p.name LIKE ? OR p.sku LIKE ?) ORDER BY p.name LIMIT 20`,
      )
      .all(pos, today, like, like);
    return { exact: false, matches };
  },
});

define('catalog.listCategories', {
  module: 'core',
  perm: 'catalog.view',
  handler: (ctx) => ctx.db.prepare('SELECT id, name, parent_id FROM categories ORDER BY name').all(),
});
define('catalog.listBrands', {
  module: 'core',
  perm: 'catalog.view',
  handler: (ctx) => ctx.db.prepare('SELECT id, name FROM brands ORDER BY name').all(),
});
define('catalog.saveCategory', {
  module: 'core',
  perm: 'catalog.edit',
  input: z.object({ name: z.string().trim().min(1).max(60) }),
  handler: (ctx, i) => {
    const r = ctx.db.prepare('INSERT INTO categories(name) VALUES (?) ON CONFLICT(name) DO NOTHING').run(i.name);
    const row = ctx.db.prepare('SELECT id FROM categories WHERE name = ?').get(i.name) as { id: number };
    if (r.changes) ctx.audit('category.created', 'category', row.id);
    return { id: row.id };
  },
});
define('catalog.saveBrand', {
  module: 'core',
  perm: 'catalog.edit',
  input: z.object({ name: z.string().trim().min(1).max(60) }),
  handler: (ctx, i) => {
    const r = ctx.db.prepare('INSERT INTO brands(name) VALUES (?) ON CONFLICT(name) DO NOTHING').run(i.name);
    const row = ctx.db.prepare('SELECT id FROM brands WHERE name = ?').get(i.name) as { id: number };
    if (r.changes) ctx.audit('brand.created', 'brand', row.id);
    return { id: row.id };
  },
});
