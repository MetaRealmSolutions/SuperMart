import { define, z } from '../api';
import { posLocationId } from '../batches';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const range = z.object({ from: date, to: date });

/**
 * Definitions (documented in docs/FEATURES.md):
 *  - "Net sales" = Σ total of COMPLETED sales (tax-inclusive), dated by the store-local business date. Returns are shown separately.
 *  - "Gross margin" is NOT profit: it ignores expenses. It is only calculated in the Finance module.
 */
define('reports.salesSummary', {
  module: 'core',
  perm: 'reports.basic',
  input: range,
  handler: (ctx, i) => {
    const days = ctx.db
      .prepare(
        `SELECT business_date AS date, COUNT(*) AS bills, SUM(gross_minor) AS gross_minor, SUM(discount_minor) AS discount_minor,
                SUM(tax_minor) AS tax_minor, SUM(total_minor) AS net_minor
         FROM sales WHERE status = 'completed' AND business_date BETWEEN ? AND ? GROUP BY business_date ORDER BY business_date`,
      )
      .all(i.from, i.to) as any[];
    const totals = days.reduce(
      (a, d) => ({
        bills: a.bills + d.bills,
        gross_minor: a.gross_minor + d.gross_minor,
        discount_minor: a.discount_minor + d.discount_minor,
        tax_minor: a.tax_minor + d.tax_minor,
        net_minor: a.net_minor + d.net_minor,
      }),
      { bills: 0, gross_minor: 0, discount_minor: 0, tax_minor: 0, net_minor: 0 },
    );
    return { days, totals };
  },
});

define('reports.topProducts', {
  module: 'core',
  perm: 'reports.basic',
  input: range.extend({ limit: z.number().int().min(1).max(100).default(20) }),
  handler: (ctx, i) =>
    ctx.db
      .prepare(
        `SELECT sl.product_id, sl.sku, sl.name, SUM(sl.qty_milli) AS qty_milli, SUM(sl.total_minor) AS revenue_minor,
                SUM(sl.total_minor - sl.tax_minor) AS revenue_ex_tax_minor
         FROM sale_lines sl JOIN sales s ON s.id = sl.sale_id
         WHERE s.status = 'completed' AND s.business_date BETWEEN ? AND ? GROUP BY sl.product_id ORDER BY revenue_minor DESC LIMIT ?`,
      )
      .all(i.from, i.to, i.limit),
});

define('reports.paymentSummary', {
  module: 'core',
  perm: 'reports.basic',
  input: range,
  handler: (ctx, i) => {
    const rows = ctx.db
      .prepare(
        `SELECT p.method, p.kind, p.status, COUNT(*) AS count, SUM(p.amount_minor) AS amount_minor
         FROM payments p JOIN sales s ON s.id = p.sale_id WHERE s.business_date BETWEEN ? AND ? GROUP BY p.method, p.kind, p.status ORDER BY p.method, p.kind, p.status`,
      )
      .all(i.from, i.to);
    const attempts = ctx.db
      .prepare(
        `SELECT status, COUNT(*) AS count, SUM(amount_minor) AS amount_minor FROM payment_attempts WHERE substr(ts,1,10) BETWEEN ? AND ? GROUP BY status`,
      )
      .all(i.from, i.to);
    return { rows, attempts, note: 'All payments are DEMO/MOCK.' };
  },
});

define('dashboard.summary', {
  module: 'core',
  perm: 'catalog.view',
  handler: (ctx) => {
    const out: Record<string, unknown> = {};
    if (ctx.can('sales.view')) {
      const own = ctx.can('sales.view_all') ? '' : 'AND cashier_id = ?';
      const args = ctx.can('sales.view_all') ? [ctx.localDate()] : [ctx.localDate(), ctx.actor().id];
      out.today = ctx.db
        .prepare(
          `SELECT COUNT(*) AS bills, COALESCE(SUM(total_minor),0) AS total_minor FROM sales WHERE status='completed' AND business_date = ? ${own}`,
        )
        .get(...args);
      out.pendingPayments = (
        ctx.db
          .prepare(`SELECT COUNT(*) c FROM sales WHERE status='pending_payment' ${ctx.can('sales.view_all') ? '' : 'AND cashier_id = ?'}`)
          .get(...(ctx.can('sales.view_all') ? [] : [ctx.actor().id])) as { c: number }
      ).c;
      out.scope = ctx.can('sales.view_all') ? 'store' : 'mine';
    }
    if (ctx.can('stock.view')) {
      const pos = posLocationId(ctx);
      out.lowStock = ctx.db
        .prepare(
          `SELECT p.id, p.name, p.reorder_level_milli, COALESCE(SUM(s.qty_milli),0) AS store_milli
           FROM products p LEFT JOIN stock s ON s.product_id = p.id AND s.status='sellable' AND s.location_id IN (SELECT id FROM locations WHERE kind IN ('shelf','backroom'))
           WHERE p.active = 1 AND p.reorder_level_milli > 0 GROUP BY p.id HAVING store_milli < p.reorder_level_milli ORDER BY store_milli LIMIT 10`,
        )
        .all();
      out.emptyShelf = (
        ctx.db
          .prepare(
            `SELECT COUNT(*) c FROM products p WHERE p.active=1 AND NOT EXISTS (SELECT 1 FROM stock s WHERE s.product_id=p.id AND s.location_id=? AND s.status='sellable' AND s.qty_milli>0)`,
          )
          .get(pos) as { c: number }
      ).c;
    }
    return out;
  },
});
