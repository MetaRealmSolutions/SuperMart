import { define, z } from '../api';
import type { Ctx } from '../ctx';
import { AppError } from '../errors';
import { moveStock } from '../ledger';
import { posLocationId } from '../batches';
import { authorize, refund, SCENARIOS, type PaymentMethod, type PaymentResult } from '../payments';
import { verifyApprover } from './auth';
import { assertQtyForProduct } from './stock';
import { allocate, formatMoney, lineAmount, percentOf, taxFromInclusive } from '../../shared/money';
import { formatQty } from '../../shared/qty';

const int = z.number().int();

export interface Lot {
  batchId: number;
  qtyMilli: number;
}

export interface PricedLine {
  productId: number;
  sku: string;
  name: string;
  unit: string;
  qtyMilli: number;
  unitPriceMinor: number;
  grossMinor: number;
  manualDiscountMinor: number;
  promoDiscountMinor: number;
  cartDiscountMinor: number;
  netMinor: number;
  taxRateBp: number;
  costMinor: number;
  lots: Lot[];
}

export interface PricedCart {
  lines: PricedLine[];
  grossMinor: number;
  manualDiscountMinor: number;
  promoDiscountMinor: number;
  couponDiscountMinor: number;
  couponCode: string | null;
  discountMinor: number;
  totalMinor: number;
  taxMinor: number;
  needsApproval: boolean;
}

/**
 * Extension point for the Product & Pricing module: may fill `promoDiscountMinor` on lines and return a
 * coupon discount for the cart. Hooks only run when their module is enabled (the hook checks ctx.has itself).
 */
export type PricingHook = (ctx: Ctx, lines: PricedLine[], couponCode: string | null) => { couponDiscountMinor: number } | void;
export const pricingHooks: PricingHook[] = [];

/** Extension point for the Advanced POS module (open shift requirement). Returns shift id or null. */
export type ShiftHook = (ctx: Ctx) => number | null;
export const shiftHooks: ShiftHook[] = [];

const itemInput = z.object({
  productId: int,
  qtyMilli: int.min(1).max(1_000_000),
  discountMinor: int.min(0).optional(),
  discountBp: int.min(0).max(10000).optional(),
});

const cartInput = z.object({
  items: z.array(itemInput).min(1).max(200),
  cartDiscountMinor: int.min(0).optional(),
  cartDiscountBp: int.min(0).max(10000).optional(),
  couponCode: z.string().trim().max(30).optional(),
});

/** Sellable, non-expired lots at the POS shelf, First-Expiry-First-Out (no-batch stock last). */
export function availableLots(ctx: Ctx, productId: number, locationId: number): Lot[] {
  const rows = ctx.db
    .prepare(
      `SELECT s.batch_id, s.qty_milli FROM stock s LEFT JOIN batches b ON b.id = s.batch_id
       WHERE s.product_id = ? AND s.location_id = ? AND s.status = 'sellable' AND s.qty_milli > 0 AND (b.expiry_date IS NULL OR b.expiry_date >= ?)
       ORDER BY (b.expiry_date IS NULL), b.expiry_date, s.batch_id`,
    )
    .all(productId, locationId, ctx.today()) as { batch_id: number; qty_milli: number }[];
  return rows.map((r) => ({ batchId: r.batch_id, qtyMilli: r.qty_milli }));
}

function allocateLots(ctx: Ctx, p: { id: number; name: string }, locationId: number, qty: number): Lot[] {
  const lots = availableLots(ctx, p.id, locationId);
  const have = lots.reduce((a, l) => a + l.qtyMilli, 0);
  if (have < qty) {
    const anyStock = ctx.db
      .prepare("SELECT COALESCE(SUM(qty_milli),0) q FROM stock WHERE product_id=? AND location_id=? AND status='sellable'")
      .get(p.id, locationId) as { q: number };
    if (anyStock.q >= qty) {
      throw new AppError(
        'STOCK_BLOCKED',
        `"${p.name}": only ${formatQty(have)} sellable (the rest is expired) — expired stock cannot be sold.`,
        { productId: p.id },
      );
    }
    throw new AppError('INSUFFICIENT_STOCK', `"${p.name}": only ${formatQty(have)} available, ${formatQty(qty)} requested.`, {
      productId: p.id,
      available: have,
    });
  }
  const out: Lot[] = [];
  let need = qty;
  for (const l of lots) {
    if (need <= 0) break;
    const take = Math.min(need, l.qtyMilli);
    out.push({ batchId: l.batchId, qtyMilli: take });
    need -= take;
  }
  return out;
}

/** Pure(ish) pricing: no writes. Used by quote and checkout so the screen and the bill can never disagree. */
export function priceCart(ctx: Ctx, input: z.infer<typeof cartInput>): PricedCart {
  const locationId = posLocationId(ctx);
  const merged = new Map<number, z.infer<typeof itemInput>>();
  for (const it of input.items) {
    const prev = merged.get(it.productId);
    if (prev) {
      if (it.discountMinor || it.discountBp || prev.discountMinor || prev.discountBp)
        throw new AppError('VALIDATION', 'Discounts must be set on a single cart line per product.');
      prev.qtyMilli += it.qtyMilli;
    } else merged.set(it.productId, { ...it });
  }
  const lines: PricedLine[] = [];
  for (const it of merged.values()) {
    const p = assertQtyForProduct(ctx, it.productId, it.qtyMilli);
    const full = ctx.db.prepare('SELECT * FROM products WHERE id = ?').get(it.productId) as any;
    if (!full.active) throw new AppError('VALIDATION', `"${full.name}" is inactive and cannot be sold.`);
    const gross = lineAmount(full.price_minor, it.qtyMilli);
    let manual = it.discountMinor ?? (it.discountBp ? percentOf(gross, it.discountBp) : 0);
    if (manual > gross) manual = gross;
    lines.push({
      productId: p.id,
      sku: full.sku,
      name: full.name,
      unit: full.unit,
      qtyMilli: it.qtyMilli,
      unitPriceMinor: full.price_minor,
      grossMinor: gross,
      manualDiscountMinor: manual,
      promoDiscountMinor: 0,
      cartDiscountMinor: 0,
      netMinor: gross - manual,
      taxRateBp: full.tax_rate_bp,
      costMinor: full.cost_minor,
      lots: allocateLots(ctx, p, locationId, it.qtyMilli),
    });
  }
  const grossMinor = lines.reduce((a, l) => a + l.grossMinor, 0);

  // Promotions / coupon (Product & Pricing module), applied to what remains after manual line discounts.
  let couponDiscountMinor = 0;
  const coupon = input.couponCode ? input.couponCode.toUpperCase() : null;
  for (const hook of pricingHooks) {
    const r = hook(ctx, lines, coupon);
    if (r) couponDiscountMinor += r.couponDiscountMinor;
  }
  for (const l of lines) {
    l.promoDiscountMinor = Math.min(l.promoDiscountMinor, l.grossMinor - l.manualDiscountMinor);
    l.netMinor = l.grossMinor - l.manualDiscountMinor - l.promoDiscountMinor;
  }

  // Cart-level manual discount + coupon, allocated across lines so the parts sum exactly.
  const afterLines = lines.reduce((a, l) => a + l.netMinor, 0);
  let cartManual = input.cartDiscountMinor ?? (input.cartDiscountBp ? percentOf(afterLines, input.cartDiscountBp) : 0);
  cartManual = Math.min(cartManual, afterLines);
  const couponCapped = Math.min(couponDiscountMinor, afterLines - cartManual);
  const cartTotalDiscount = cartManual + couponCapped;
  const parts = allocate(
    cartTotalDiscount,
    lines.map((l) => l.netMinor),
  );
  lines.forEach((l, idx) => {
    const d = Math.min(parts[idx], l.netMinor);
    l.cartDiscountMinor = d;
    l.netMinor -= d;
  });
  // Rounding corner: if capping left a remainder, push it onto lines with room.
  let leftover = cartTotalDiscount - lines.reduce((a, l) => a + l.cartDiscountMinor, 0);
  for (const l of lines) {
    if (leftover <= 0) break;
    const d = Math.min(leftover, l.netMinor);
    l.cartDiscountMinor += d;
    l.netMinor -= d;
    leftover -= d;
  }

  const manualDiscountMinor = lines.reduce((a, l) => a + l.manualDiscountMinor, 0) + cartManual;
  const promoDiscountMinor = lines.reduce((a, l) => a + l.promoDiscountMinor, 0);
  const totalMinor = lines.reduce((a, l) => a + l.netMinor, 0);
  const taxMinor = lines.reduce((a, l) => a + taxFromInclusive(l.netMinor, l.taxRateBp), 0);

  const maxBp = Math.round(Number(ctx.setting('max_cashier_discount_pct', '10')) * 100);
  const manualBp = grossMinor > 0 ? Math.round((manualDiscountMinor * 10000) / grossMinor) : 0;
  return {
    lines,
    grossMinor,
    manualDiscountMinor,
    promoDiscountMinor,
    couponDiscountMinor: couponCapped,
    couponCode: coupon,
    discountMinor: grossMinor - totalMinor,
    totalMinor,
    taxMinor,
    needsApproval: manualDiscountMinor > 0 && manualBp > maxBp,
  };
}

const paymentInput = z.object({
  method: z.enum(['cash', 'card', 'upi']),
  amountMinor: int.min(1),
  tenderedMinor: int.min(1).optional(),
  scenario: z.enum(['approved', 'declined', 'success', 'pending', 'failed']).optional(),
});

const checkoutInput = cartInput.extend({
  clientRef: z.string().trim().min(6).max(64),
  customerName: z.string().trim().max(80).optional(),
  payments: z.array(paymentInput).max(4).default([]),
  approval: z.object({ username: z.string().min(1).max(40), pin: z.string().min(1).max(12) }).optional(),
});

define('pos.quote', {
  module: 'core',
  perm: 'pos.sell',
  input: cartInput,
  handler: (ctx, i) => {
    const c = priceCart(ctx, i);
    if (c.manualDiscountMinor > 0 && !ctx.can('pos.discount')) throw new AppError('FORBIDDEN', 'Your role cannot give discounts.');
    return { ...c, canApprove: ctx.can('pos.discount_unlimited') };
  },
});

function recordAttempts(
  ctx: Ctx,
  clientRef: string,
  rows: { method: string; amount: number; scenario?: string; result: PaymentResult; status?: string }[],
): void {
  const st = ctx.db.prepare(
    'INSERT INTO payment_attempts(ts, client_ref, cashier_id, method, amount_minor, status, reference, scenario) VALUES (?,?,?,?,?,?,?,?)',
  );
  for (const r of rows)
    st.run(
      ctx.ts(),
      clientRef,
      ctx.user?.id ?? null,
      r.method,
      r.amount,
      r.status ?? r.result.status,
      r.result.reference,
      r.scenario ?? null,
    );
}

define('pos.checkout', {
  module: 'core',
  perm: 'pos.sell',
  input: checkoutInput,
  handler: (ctx, i) => {
    const dup = ctx.db.prepare('SELECT id FROM sales WHERE client_ref = ?').get(i.clientRef) as { id: number } | undefined;
    if (dup) return { ...loadSale(ctx, dup.id), duplicate: true };

    const cart = priceCart(ctx, i);
    let approvedBy: number | null = null;
    if (cart.manualDiscountMinor > 0) {
      ctx.require('pos.discount');
      if (cart.needsApproval && !ctx.can('pos.discount_unlimited')) {
        if (!i.approval || !ctx.has('advanced_pos')) {
          throw new AppError(
            'APPROVAL_REQUIRED',
            `Discount exceeds your limit (${ctx.setting('max_cashier_discount_pct', '10')}%). A manager must apply or approve it.`,
          );
        }
        approvedBy = verifyApprover(ctx, i.approval.username, i.approval.pin, 'pos.discount').id;
      }
    }
    const paySum = i.payments.reduce((a, p) => a + p.amountMinor, 0);
    if (paySum !== cart.totalMinor)
      throw new AppError('VALIDATION', `Payments (${formatMoney(paySum)}) must equal the bill total (${formatMoney(cart.totalMinor)}).`);
    for (const p of i.payments) {
      if (p.method !== 'cash' && p.tenderedMinor !== undefined) throw new AppError('VALIDATION', 'Only cash can have a tendered amount.');
      if (p.tenderedMinor !== undefined && p.tenderedMinor < p.amountMinor)
        throw new AppError('VALIDATION', 'Cash tendered is less than the amount.');
      if (p.scenario && !SCENARIOS[p.method].includes(p.scenario))
        throw new AppError('VALIDATION', `Scenario "${p.scenario}" is not valid for ${p.method}.`);
    }

    const shiftId = shiftHooks.reduce<number | null>((acc, h) => acc ?? h(ctx), null);
    const results = i.payments.map((p) => authorize(ctx, p.method as PaymentMethod, p.scenario));
    const bad = results.find((r) => r.status === 'declined' || r.status === 'failed');
    if (bad) {
      recordAttempts(
        ctx,
        i.clientRef,
        i.payments.map((p, idx) => ({
          method: p.method,
          amount: p.amountMinor,
          scenario: p.scenario,
          result: results[idx],
          status: results[idx].status === 'approved' ? 'cancelled' : undefined,
        })),
      );
      throw new AppError('PAYMENT_FAILED', `Payment not completed: ${bad.message}. No sale was recorded and stock is unchanged.`, {
        results: results.map((r, idx) => ({ method: i.payments[idx].method, ...r })),
      });
    }

    try {
      return ctx.tx(() => {
        const today = ctx.localDate();
        const receiptNo = `R${today.replace(/-/g, '')}-${String(ctx.nextCounter(`receipt:${today}`)).padStart(5, '0')}`;
        const pending = results.some((r) => r.status === 'pending');
        const paid = i.payments.reduce((a, p, idx) => a + (results[idx].status === 'approved' ? p.amountMinor : 0), 0);
        const change = i.payments.reduce((a, p) => a + (p.tenderedMinor ? p.tenderedMinor - p.amountMinor : 0), 0);
        const locationId = posLocationId(ctx);
        const saleId = Number(
          ctx.db
            .prepare(
              `INSERT INTO sales(receipt_no, client_ref, ts, business_date, cashier_id, shift_id, location_id, status, gross_minor, discount_minor, total_minor, tax_minor, paid_minor, change_minor, coupon_code, customer_name, approved_by)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            )
            .run(
              receiptNo,
              i.clientRef,
              ctx.ts(),
              today,
              ctx.actor().id,
              shiftId,
              locationId,
              pending ? 'pending_payment' : 'completed',
              cart.grossMinor,
              cart.discountMinor,
              cart.totalMinor,
              cart.taxMinor,
              paid,
              change,
              cart.couponCode,
              i.customerName ?? null,
              approvedBy,
            ).lastInsertRowid,
        );
        const insLine = ctx.db.prepare(
          `INSERT INTO sale_lines(sale_id, product_id, batch_id, sku, name, qty_milli, unit_price_minor, gross_minor, discount_minor, total_minor, tax_rate_bp, tax_minor, unit_cost_minor)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        );
        for (const l of cart.lines) {
          const w = l.lots.map((x) => x.qtyMilli);
          const grossParts = allocate(l.grossMinor, w);
          const discParts = allocate(l.grossMinor - l.netMinor, w);
          l.lots.forEach((lot, idx) => {
            const net = grossParts[idx] - discParts[idx];
            insLine.run(
              saleId,
              l.productId,
              lot.batchId,
              l.sku,
              l.name,
              lot.qtyMilli,
              l.unitPriceMinor,
              grossParts[idx],
              discParts[idx],
              net,
              l.taxRateBp,
              taxFromInclusive(net, l.taxRateBp),
              l.costMinor,
            );
            moveStock(ctx, {
              productId: l.productId,
              batchId: lot.batchId,
              qtyMilli: lot.qtyMilli,
              from: { locationId, status: 'sellable' },
              reason: 'sale',
              refType: 'sale',
              refId: saleId,
              unitCostMinor: l.costMinor,
            });
          });
        }
        const insPay = ctx.db.prepare(
          `INSERT INTO payments(sale_id, ts, method, kind, amount_minor, tendered_minor, status, reference, scenario, shift_id) VALUES (?,?,?,'payment',?,?,?,?,?,?)`,
        );
        i.payments.forEach((p, idx) =>
          insPay.run(
            saleId,
            ctx.ts(),
            p.method,
            p.amountMinor,
            p.tenderedMinor ?? null,
            results[idx].status,
            results[idx].reference,
            p.scenario ?? null,
            shiftId,
          ),
        );
        recordAttempts(
          ctx,
          i.clientRef,
          i.payments.map((p, idx) => ({ method: p.method, amount: p.amountMinor, scenario: p.scenario, result: results[idx] })),
        );
        if (approvedBy) ctx.audit('sale.discount_approved', 'sale', saleId, { approvedBy, discountMinor: cart.manualDiscountMinor });
        return { ...loadSale(ctx, saleId), duplicate: false };
      });
    } catch (e) {
      recordAttempts(
        ctx,
        i.clientRef,
        i.payments.map((p, idx) => ({
          method: p.method,
          amount: p.amountMinor,
          scenario: p.scenario,
          result: results[idx],
          status: 'cancelled',
        })),
      );
      throw e;
    }
  },
});

/** Put a (pending / cancelled) sale's stock back on the shelf it came from. */
export function restoreSaleStock(ctx: Ctx, saleId: number, reason: string): void {
  const sale = ctx.db.prepare('SELECT location_id FROM sales WHERE id = ?').get(saleId) as { location_id: number };
  const lines = ctx.db
    .prepare('SELECT product_id, batch_id, qty_milli, unit_cost_minor, returned_milli FROM sale_lines WHERE sale_id = ?')
    .all(saleId) as any[];
  for (const l of lines) {
    const qty = l.qty_milli - l.returned_milli;
    if (qty > 0)
      moveStock(ctx, {
        productId: l.product_id,
        batchId: l.batch_id,
        qtyMilli: qty,
        to: { locationId: sale.location_id, status: 'sellable' },
        reason,
        refType: 'sale',
        refId: saleId,
        unitCostMinor: l.unit_cost_minor,
      });
  }
}

define('pos.resolvePayment', {
  module: 'core',
  perm: 'pos.sell',
  input: z.object({ saleId: int, outcome: z.enum(['success', 'failed']) }),
  handler: (ctx, i) =>
    ctx.tx(() => {
      const sale = ctx.db.prepare('SELECT * FROM sales WHERE id = ?').get(i.saleId) as any;
      if (!sale) throw new AppError('NOT_FOUND', 'Sale not found.');
      if (sale.status !== 'pending_payment') throw new AppError('INVALID_STATE', `Sale is ${sale.status}, not awaiting payment.`);
      if (!ctx.can('sales.view_all') && sale.cashier_id !== ctx.actor().id)
        throw new AppError('FORBIDDEN', 'You can only resolve your own pending sales.');
      const pend = ctx.db.prepare("SELECT * FROM payments WHERE sale_id = ? AND status = 'pending'").all(i.saleId) as any[];
      if (i.outcome === 'success') {
        ctx.db.prepare("UPDATE payments SET status = 'approved' WHERE sale_id = ? AND status = 'pending'").run(i.saleId);
        const paid = (
          ctx.db
            .prepare("SELECT COALESCE(SUM(amount_minor),0) s FROM payments WHERE sale_id=? AND kind='payment' AND status='approved'")
            .get(i.saleId) as { s: number }
        ).s;
        ctx.db.prepare("UPDATE sales SET status='completed', paid_minor=? WHERE id=?").run(paid, i.saleId);
      } else {
        ctx.db.prepare("UPDATE payments SET status = 'failed' WHERE sale_id = ? AND status = 'pending'").run(i.saleId);
        // Refund whatever was already collected (mock), then return the goods to the shelf.
        const approved = ctx.db
          .prepare("SELECT * FROM payments WHERE sale_id=? AND kind='payment' AND status='approved'")
          .all(i.saleId) as any[];
        for (const p of approved) {
          const r = refund(ctx, p.method);
          ctx.db
            .prepare(
              `INSERT INTO payments(sale_id, ts, method, kind, amount_minor, status, reference, shift_id) VALUES (?,?,?,'refund',?,?,?,?)`,
            )
            .run(i.saleId, ctx.ts(), p.method, p.amount_minor, r.status, r.reference, p.shift_id);
        }
        restoreSaleStock(ctx, i.saleId, 'sale_cancelled');
        ctx.db.prepare("UPDATE sales SET status='cancelled', paid_minor=0 WHERE id=?").run(i.saleId);
        ctx.audit('sale.cancelled_payment_failed', 'sale', i.saleId, { pending: pend.length });
      }
      return loadSale(ctx, i.saleId);
    }),
});

export function loadSale(ctx: Ctx, id: number): any {
  const sale = ctx.db
    .prepare(
      `SELECT s.*, u.name AS cashier_name, a.name AS approver_name, l.name AS location_name
       FROM sales s JOIN users u ON u.id = s.cashier_id LEFT JOIN users a ON a.id = s.approved_by JOIN locations l ON l.id = s.location_id WHERE s.id = ?`,
    )
    .get(id) as any;
  if (!sale) throw new AppError('NOT_FOUND', 'Sale not found.');
  const lines = ctx.db
    .prepare('SELECT sl.*, b.batch_no FROM sale_lines sl LEFT JOIN batches b ON b.id = sl.batch_id WHERE sl.sale_id = ? ORDER BY sl.id')
    .all(id);
  const payments = ctx.db.prepare('SELECT * FROM payments WHERE sale_id = ? ORDER BY id').all(id);
  return { sale, lines, payments };
}

function assertCanSee(ctx: Ctx, sale: { cashier_id: number }): void {
  ctx.require('sales.view');
  if (!ctx.can('sales.view_all') && sale.cashier_id !== ctx.actor().id)
    throw new AppError('FORBIDDEN', 'You can only view your own sales.');
}

define('pos.getSale', {
  module: 'core',
  perm: 'sales.view',
  input: z.object({ id: int }),
  handler: (ctx, i) => {
    const r = loadSale(ctx, i.id);
    assertCanSee(ctx, r.sale);
    return r;
  },
});

define('pos.listSales', {
  module: 'core',
  perm: 'sales.view',
  input: z.object({
    from: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    to: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    status: z.enum(['completed', 'pending_payment', 'cancelled', 'voided']).optional(),
    cashierId: int.optional(),
    search: z.string().trim().max(40).optional(),
    page: int.min(1).default(1),
    pageSize: int.min(1).max(500).default(100),
  }),
  handler: (ctx, i) => {
    const where = ['1=1'];
    const args: unknown[] = [];
    if (!ctx.can('sales.view_all')) (where.push('s.cashier_id = ?'), args.push(ctx.actor().id));
    else if (i.cashierId) (where.push('s.cashier_id = ?'), args.push(i.cashierId));
    if (i.from) (where.push('s.business_date >= ?'), args.push(i.from));
    if (i.to) (where.push('s.business_date <= ?'), args.push(i.to));
    if (i.status) (where.push('s.status = ?'), args.push(i.status));
    if (i.search) (where.push('(s.receipt_no LIKE ? OR s.customer_name LIKE ?)'), args.push(`%${i.search}%`, `%${i.search}%`));
    const rows = ctx.db
      .prepare(
        `SELECT s.id, s.receipt_no, s.ts, s.business_date, s.status, s.total_minor, s.discount_minor, s.tax_minor, s.cashier_id, u.name AS cashier_name,
                (SELECT group_concat(DISTINCT method) FROM payments p WHERE p.sale_id = s.id AND p.kind='payment') AS methods
         FROM sales s JOIN users u ON u.id = s.cashier_id WHERE ${where.join(' AND ')} ORDER BY s.id DESC LIMIT ? OFFSET ?`,
      )
      .all(...args, i.pageSize, (i.page - 1) * i.pageSize);
    return rows;
  },
});

export function receiptLines(ctx: Ctx, id: number, duplicate: boolean): string[] {
  const { sale, lines, payments } = loadSale(ctx, id);
  const W = Math.max(24, Math.min(80, Number(ctx.setting('receipt_width_chars', '42'))));
  const center = (s: string) => (s.length >= W ? s : ' '.repeat(Math.floor((W - s.length) / 2)) + s);
  const row = (l: string, r: string) => (l.length + r.length >= W ? `${l} ${r}` : l + ' '.repeat(W - l.length - r.length) + r);
  const rule = '-'.repeat(W);
  const out: string[] = [
    center(ctx.setting('store_name', 'SuperMart')),
    center(ctx.setting('store_address')),
    center(`Ph: ${ctx.setting('store_phone')}`),
    center(`GSTIN: ${ctx.setting('gstin')}`),
    rule,
  ];
  if (duplicate) out.push(center('*** DUPLICATE RECEIPT ***'));
  out.push(row(`Bill: ${sale.receipt_no}`, sale.business_date), row(`Cashier: ${sale.cashier_name}`, ctx.localTime(new Date(sale.ts))));
  if (sale.customer_name) out.push(`Customer: ${sale.customer_name}`);
  if (sale.status !== 'completed') out.push(center(`** STATUS: ${sale.status.toUpperCase().replace('_', ' ')} **`));
  out.push(rule);
  for (const l of lines as any[]) {
    out.push(l.name.slice(0, W));
    const detail = `  ${formatQty(l.qty_milli)} x ${formatMoney(l.unit_price_minor)}`;
    out.push(row(detail, formatMoney(l.gross_minor)));
    if (l.discount_minor > 0) out.push(row('  Discount', `-${formatMoney(l.discount_minor)}`));
  }
  out.push(rule, row('Subtotal', formatMoney(sale.gross_minor)));
  if (sale.discount_minor > 0) out.push(row('Total discount', `-${formatMoney(sale.discount_minor)}`));
  out.push(row('TOTAL', formatMoney(sale.total_minor)), row(ctx.setting('tax_label', 'Tax included'), formatMoney(sale.tax_minor)), rule);
  for (const p of payments as any[]) {
    out.push(row(`${p.kind === 'refund' ? 'Refund ' : ''}${p.method.toUpperCase()} [DEMO] ${p.status}`, formatMoney(p.amount_minor)));
    out.push(`  ref ${p.reference}`);
  }
  if (sale.change_minor > 0) out.push(row('Change', formatMoney(sale.change_minor)));
  out.push(rule, center(ctx.setting('receipt_footer', 'Thank you!')));
  return out;
}

define('pos.receipt', {
  module: 'core',
  perm: 'sales.view',
  input: z.object({ saleId: int, reprint: z.boolean().default(false) }),
  handler: (ctx, i) => {
    if (i.reprint) ctx.requireModule('advanced_pos');
    const r = loadSale(ctx, i.saleId);
    assertCanSee(ctx, r.sale);
    if (i.reprint) ctx.audit('receipt.reprinted', 'sale', i.saleId);
    return { receiptNo: r.sale.receipt_no, lines: receiptLines(ctx, i.saleId, i.reprint) };
  },
});
