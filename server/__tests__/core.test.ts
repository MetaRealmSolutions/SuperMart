import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { moveStock } from '../ledger';
import { Ctx } from '../ctx';
import { dispatch } from '../api';
import { makeEnv, type TestEnv } from './helpers';

export const pid = (env: TestEnv, sku: string): number =>
  (env.app.db.prepare('SELECT id FROM products WHERE sku = ?').get(sku) as { id: number }).id;
export const shelfId = (env: TestEnv): number =>
  Number((env.app.db.prepare("SELECT value FROM settings WHERE key='pos_location_id'").get() as any).value);
export const shelfQty = (env: TestEnv, sku: string): number =>
  (
    env.app.db
      .prepare("SELECT COALESCE(SUM(qty_milli),0) q FROM stock WHERE product_id=? AND location_id=? AND status='sellable'")
      .get(pid(env, sku), shelfId(env)) as any
  ).q;
const count = (env: TestEnv, table: string): number => (env.app.db.prepare(`SELECT COUNT(*) c FROM ${table}`).get() as any).c;
let seq = 0;
const ref = () => `test-ref-${++seq}-${Math.random().toString(36).slice(2, 8)}`;

/** Invariant: the stock table always equals the net of the movement ledger, per product. */
export function assertLedgerConsistent(env: TestEnv): void {
  const rows = env.app.db
    .prepare(
      `SELECT p.sku,
        COALESCE((SELECT SUM(qty_milli) FROM stock_ledger WHERE product_id=p.id AND to_location_id IS NOT NULL),0)
        - COALESCE((SELECT SUM(qty_milli) FROM stock_ledger WHERE product_id=p.id AND from_location_id IS NOT NULL),0) AS ledger_net,
        COALESCE((SELECT SUM(qty_milli) FROM stock WHERE product_id=p.id),0) AS on_hand
       FROM products p`,
    )
    .all() as { sku: string; ledger_net: number; on_hand: number }[];
  for (const r of rows) expect(r.on_hand, `ledger vs stock for ${r.sku}`).toBe(r.ledger_net);
}

describe('catalog & stock receipt', () => {
  it('adds a product, records a receipt and updates inventory + moving-average cost', () => {
    const env = makeEnv();
    const { id } = env.call('manager', 'catalog.saveProduct', {
      sku: 'NEW-1',
      name: 'Test Item',
      priceMinor: 10000,
      mrpMinor: 11000,
      costMinor: 0,
      taxRateBp: 500,
      barcodes: ['9990001112223'],
    });
    const shelf = shelfId(env);
    env.call('manager', 'stock.adjust', {
      productId: id,
      locationId: shelf,
      deltaMilli: 10000,
      reason: 'receipt',
      unitCostMinor: 6000,
      note: 'first delivery',
    });
    env.call('manager', 'stock.adjust', { productId: id, locationId: shelf, deltaMilli: 10000, reason: 'receipt', unitCostMinor: 8000 });
    expect(shelfQty(env, 'NEW-1')).toBe(20000);
    expect((env.app.db.prepare('SELECT cost_minor c FROM products WHERE id=?').get(id) as any).c).toBe(7000);
    const led = env.call<any[]>('manager', 'stock.ledger', { productId: id });
    expect(led).toHaveLength(2);
    expect(led[0]).toMatchObject({ reason: 'receipt', qty_milli: 10000, actor: 'Meera Manager' });
    expect(env.call<any>('cashier', 'catalog.lookup', { code: '9990001112223' }).matches[0].id).toBe(id);
    assertLedgerConsistent(env);
  });

  it('rejects duplicate SKU/barcode, price above MRP, and fractional units for non-weighed items', () => {
    const env = makeEnv();
    expect(() => env.call('manager', 'catalog.saveProduct', { sku: 'RICE-5K', name: 'dup', priceMinor: 1 })).toThrow(/already used/);
    expect(() => env.call('manager', 'catalog.saveProduct', { sku: 'X', name: 'x', priceMinor: 2000, mrpMinor: 1000 })).toThrow(
      /exceed MRP/,
    );
    expect(() => env.call('manager', 'catalog.saveProduct', { sku: 'X', name: 'x', priceMinor: 100, barcodes: ['8901000000011'] })).toThrow(
      /belongs to another product/,
    );
    expect(() =>
      env.call('manager', 'stock.adjust', { productId: pid(env, 'RICE-5K'), locationId: shelfId(env), deltaMilli: 500, reason: 'found' }),
    ).toThrow(/whole units/);
  });

  it('never lets stock go negative and requires a note for reductions', () => {
    const env = makeEnv();
    const p = pid(env, 'SALT-1K');
    expect(() =>
      env.call('manager', 'stock.adjust', { productId: p, locationId: shelfId(env), deltaMilli: -1000, reason: 'theft_loss' }),
    ).toThrow(/note/);
    const before = shelfQty(env, 'SALT-1K');
    expect(() =>
      env.call('manager', 'stock.adjust', {
        productId: p,
        locationId: shelfId(env),
        deltaMilli: -999000,
        reason: 'theft_loss',
        note: 'too many',
      }),
    ).toThrow(/Insufficient/);
    expect(shelfQty(env, 'SALT-1K')).toBe(before);
  });

  it('records damage as damaged stock (kept on record) and keeps price history/audit', () => {
    const env = makeEnv();
    const p = pid(env, 'SALT-1K');
    const before = shelfQty(env, 'SALT-1K');
    env.call('warehouse', 'stock.adjust', {
      productId: p,
      locationId: shelfId(env),
      deltaMilli: -2000,
      reason: 'damage',
      note: 'dropped carton',
    });
    expect(shelfQty(env, 'SALT-1K')).toBe(before - 2000);
    const damaged = env.app.db.prepare("SELECT SUM(qty_milli) q FROM stock WHERE product_id=? AND status='damaged'").get(p) as any;
    expect(damaged.q).toBe(2000);
    const prod = env.call<any>('manager', 'catalog.getProduct', { id: p });
    env.call('manager', 'catalog.saveProduct', {
      ...prod,
      barcodes: prod.barcodes,
      priceMinor: 3000,
      categoryId: prod.category_id,
      brandId: prod.brand_id,
      isWeighed: !!prod.is_weighed,
      trackBatch: !!prod.track_batch,
      active: true,
      taxRateBp: prod.tax_rate_bp,
      mrpMinor: prod.mrp_minor,
      costMinor: prod.cost_minor,
      reorderLevelMilli: prod.reorder_level_milli,
    });
    expect(env.call<any>('manager', 'catalog.getProduct', { id: p }).history[0]).toMatchObject({
      field: 'price_minor',
      old_minor: 2800,
      new_minor: 3000,
    });
    expect(env.app.db.prepare("SELECT COUNT(*) c FROM audit_log WHERE action='price.changed'").get()).toMatchObject({ c: 1 });
    assertLedgerConsistent(env);
  });
});

describe('POS pricing & checkout', () => {
  it('calculates quantities, discounts, tax and totals exactly (integer paise)', () => {
    const env = makeEnv();
    const sugar = pid(env, 'SUGAR-1K'); // 48.00, GST 5% inclusive
    const cola = pid(env, 'COLA-750'); // 40.00, GST 18% inclusive
    const q = env.call<any>('cashier', 'pos.quote', {
      items: [
        { productId: sugar, qtyMilli: 2000 },
        { productId: cola, qtyMilli: 1000, discountBp: 1000 },
      ],
    });
    expect(q.grossMinor).toBe(9600 + 4000);
    expect(q.manualDiscountMinor).toBe(400);
    expect(q.totalMinor).toBe(13200);
    expect(q.taxMinor).toBe(457 + 549); // round(9600*5/105)=457 ; round(3600*18/118)=549
    expect(q.lines[1].netMinor).toBe(3600);
    expect(q.needsApproval).toBe(false);
  });

  it('prices weighed items by fractional quantity', () => {
    const env = makeEnv();
    const q = env.call<any>('cashier', 'pos.quote', { items: [{ productId: pid(env, 'BANANA'), qtyMilli: 1250 }] });
    expect(q.totalMinor).toBe(7500); // 1.25kg @ 60.00
  });

  it('a successful cash sale completes, decreases stock exactly, writes ledger and gives change', () => {
    const env = makeEnv();
    const before = shelfQty(env, 'SUGAR-1K');
    const res = env.call<any>('cashier', 'pos.checkout', {
      clientRef: ref(),
      items: [{ productId: pid(env, 'SUGAR-1K'), qtyMilli: 3000 }],
      payments: [{ method: 'cash', amountMinor: 14400, tenderedMinor: 15000 }],
    });
    expect(res.sale.status).toBe('completed');
    expect(res.sale).toMatchObject({ total_minor: 14400, paid_minor: 14400, change_minor: 600 });
    expect(res.payments[0]).toMatchObject({ method: 'cash', status: 'approved', simulated: 1 });
    expect(res.payments[0].reference).toMatch(/^MOCK-CASH-/);
    expect(shelfQty(env, 'SUGAR-1K')).toBe(before - 3000);
    const led = env.call<any[]>('manager', 'stock.ledger', { refType: 'sale', refId: String(res.sale.id) });
    expect(led.map((l) => l.qty_milli)).toEqual([3000]);
    assertLedgerConsistent(env);
  });

  it('is idempotent: retrying the same clientRef never double-sells', () => {
    const env = makeEnv();
    const req = {
      clientRef: 'idem-0001',
      items: [{ productId: pid(env, 'SALT-1K'), qtyMilli: 1000 }],
      payments: [{ method: 'cash', amountMinor: 2800 }],
    };
    const before = shelfQty(env, 'SALT-1K');
    const a = env.call<any>('cashier', 'pos.checkout', req);
    const b = env.call<any>('cashier', 'pos.checkout', req);
    expect(b.duplicate).toBe(true);
    expect(b.sale.id).toBe(a.sale.id);
    expect(shelfQty(env, 'SALT-1K')).toBe(before - 1000);
  });

  it('a declined card does NOT create a completed sale or touch stock, but the attempt is logged', () => {
    const env = makeEnv();
    const sales = count(env, 'sales');
    const before = shelfQty(env, 'SALT-1K');
    let err: any;
    try {
      env.call('cashier', 'pos.checkout', {
        clientRef: ref(),
        items: [{ productId: pid(env, 'SALT-1K'), qtyMilli: 1000 }],
        payments: [{ method: 'card', amountMinor: 2800, scenario: 'declined' }],
      });
    } catch (e) {
      err = e;
    }
    expect(err.code).toBe('PAYMENT_FAILED');
    expect(count(env, 'sales')).toBe(sales);
    expect(shelfQty(env, 'SALT-1K')).toBe(before);
    expect(env.app.db.prepare('SELECT status FROM payment_attempts ORDER BY id DESC LIMIT 1').get()).toMatchObject({ status: 'declined' });
  });

  it('a split tender with one failed leg voids the approved leg and records no sale', () => {
    const env = makeEnv();
    const sales = count(env, 'sales');
    expect(() =>
      env.call('cashier', 'pos.checkout', {
        clientRef: ref(),
        items: [{ productId: pid(env, 'SUGAR-1K'), qtyMilli: 2000 }],
        payments: [
          { method: 'cash', amountMinor: 5000 },
          { method: 'upi', amountMinor: 4600, scenario: 'failed' },
        ],
      }),
    ).toThrow(/Payment not completed/);
    expect(count(env, 'sales')).toBe(sales);
    const statuses = env.app.db.prepare('SELECT method, status FROM payment_attempts ORDER BY id DESC LIMIT 2').all();
    expect(statuses).toEqual(
      expect.arrayContaining([
        { method: 'cash', status: 'cancelled' },
        { method: 'upi', status: 'failed' },
      ]),
    );
  });

  it('pending UPI keeps the sale pending (stock held); success completes it, failure cancels, refunds and restores stock', () => {
    const env = makeEnv();
    const sugar = pid(env, 'SUGAR-1K');
    const before = shelfQty(env, 'SUGAR-1K');
    const mk = () =>
      env.call<any>('cashier', 'pos.checkout', {
        clientRef: ref(),
        items: [{ productId: sugar, qtyMilli: 2000 }],
        payments: [
          { method: 'cash', amountMinor: 5000 },
          { method: 'upi', amountMinor: 4600, scenario: 'pending' },
        ],
      });
    const a = mk();
    expect(a.sale.status).toBe('pending_payment');
    expect(a.sale.paid_minor).toBe(5000);
    expect(shelfQty(env, 'SUGAR-1K')).toBe(before - 2000);
    const done = env.call<any>('cashier', 'pos.resolvePayment', { saleId: a.sale.id, outcome: 'success' });
    expect(done.sale).toMatchObject({ status: 'completed', paid_minor: 9600 });
    expect(() => env.call('cashier', 'pos.resolvePayment', { saleId: a.sale.id, outcome: 'success' })).toThrow(/not awaiting/);

    const b = mk();
    const cancelled = env.call<any>('cashier', 'pos.resolvePayment', { saleId: b.sale.id, outcome: 'failed' });
    expect(cancelled.sale.status).toBe('cancelled');
    expect(cancelled.payments.filter((p: any) => p.kind === 'refund')).toHaveLength(1);
    expect(shelfQty(env, 'SUGAR-1K')).toBe(before - 2000); // only the completed sale's units are gone
    assertLedgerConsistent(env);
  });

  it('rejects payments that do not equal the total, and over-stock sales', () => {
    const env = makeEnv();
    const items = [{ productId: pid(env, 'SALT-1K'), qtyMilli: 1000 }];
    const before = shelfQty(env, 'SALT-1K');
    expect(() =>
      env.call('cashier', 'pos.checkout', { clientRef: ref(), items, payments: [{ method: 'cash', amountMinor: 100 }] }),
    ).toThrow(/must equal the bill total/);
    const tooMany = before + 1000;
    expect(() =>
      env.call('cashier', 'pos.checkout', {
        clientRef: ref(),
        items: [{ productId: pid(env, 'SALT-1K'), qtyMilli: tooMany }],
        payments: [{ method: 'cash', amountMinor: 2800 * (tooMany / 1000) }],
      }),
    ).toThrow(/available/);
    expect(shelfQty(env, 'SALT-1K')).toBe(before);
  });

  it('blocks expired and quarantined stock from sale, and sells FEFO otherwise', () => {
    const env = makeEnv();
    const juice = pid(env, 'JUICE-1L');
    const shelf = shelfId(env);
    // Add a second, earlier-expiring batch on the shelf.
    env.call('manager', 'stock.adjust', {
      productId: juice,
      locationId: shelf,
      deltaMilli: 5000,
      reason: 'receipt',
      batchNo: 'EARLY',
      expiryDate: '2026-03-12',
      unitCostMinor: 8000,
    });
    const sell = (qty: number) =>
      env.call<any>('cashier', 'pos.checkout', {
        clientRef: ref(),
        items: [{ productId: juice, qtyMilli: qty }],
        payments: [{ method: 'cash', amountMinor: 11000 * (qty / 1000) }],
      });
    const r = sell(7000); // 5 from EARLY first, then 2 from the later batch
    const byBatch = r.lines.map((l: any) => [l.batch_no, l.qty_milli]);
    expect(byBatch).toEqual([
      ['EARLY', 5000],
      ['JUICE-1L-S1', 2000],
    ]);
    // Expire the remaining shelf batch → cannot be sold.
    env.app.db.prepare("UPDATE batches SET expiry_date = '2026-03-01' WHERE product_id = ? AND batch_no = 'JUICE-1L-S1'").run(juice);
    try {
      sell(1000);
      expect.unreachable();
    } catch (e: any) {
      expect(e.code).toBe('STOCK_BLOCKED');
    }
    // Quarantined stock is not sellable either.
    const admin = env.as('manager');
    env.app.db.transaction(() =>
      moveStock(admin, {
        productId: pid(env, 'SALT-1K'),
        qtyMilli: shelfQty(env, 'SALT-1K'),
        from: { locationId: shelf, status: 'sellable' },
        to: { locationId: shelf, status: 'quarantine' },
        reason: 'quarantine',
      }),
    )();
    expect(() =>
      env.call('cashier', 'pos.checkout', {
        clientRef: ref(),
        items: [{ productId: pid(env, 'SALT-1K'), qtyMilli: 1000 }],
        payments: [{ method: 'cash', amountMinor: 2800 }],
      }),
    ).toThrow(/available/);
    assertLedgerConsistent(env);
  });

  it('enforces the cashier discount limit; manager approval (Advanced POS) or a manager login may exceed it', () => {
    const env = makeEnv();
    const items = [{ productId: pid(env, 'RICE-5K'), qtyMilli: 1000, discountBp: 2000 }];
    const total = 64900 - 12980;
    const req = (extra = {}) => ({ clientRef: ref(), items, payments: [{ method: 'cash', amountMinor: total }], ...extra });
    expect(() => env.call('cashier', 'pos.checkout', req())).toThrow(/exceeds your limit/);
    expect(() => env.call('cashier', 'pos.checkout', req({ approval: { username: 'manager', pin: '0000' } }))).toThrow(/approval failed/);
    expect(() => env.call('cashier', 'pos.checkout', req({ approval: { username: 'cashier2', pin: '7778' } }))).toThrow(/approval failed/); // a cashier cannot approve
    const ok = env.call<any>('cashier', 'pos.checkout', req({ approval: { username: 'manager', pin: '3333' } }));
    expect(ok.sale.approver_name).toBe('Meera Manager');
    expect(
      env.app.db
        .prepare("SELECT COUNT(*) c FROM audit_log WHERE action IN ('approval.granted','approval.denied','sale.discount_approved')")
        .get(),
    ).toMatchObject({ c: 4 });
    expect(env.call<any>('manager', 'pos.checkout', req()).sale.discount_minor).toBe(12980);
  });

  it('without the Advanced POS module there is no approval path for an over-limit discount', () => {
    const env = makeEnv({ edition: 'basic' });
    const items = [{ productId: pid(env, 'RICE-5K'), qtyMilli: 1000, discountBp: 2000 }];
    const req = {
      clientRef: ref(),
      items,
      payments: [{ method: 'cash', amountMinor: 51920 }],
      approval: { username: 'manager', pin: '3333' },
    };
    expect(() => env.call('cashier', 'pos.checkout', req)).toThrow(/exceeds your limit/);
    expect(() => env.call('cashier', 'pos.receipt', { saleId: 1, reprint: true })).toThrow(/not enabled/);
  });
});

describe('permissions & visibility', () => {
  it('blocks restricted operations for unauthorised roles (server-side)', () => {
    const env = makeEnv();
    const p = pid(env, 'SALT-1K');
    expect(() =>
      env.call('cashier', 'stock.adjust', { productId: p, locationId: shelfId(env), deltaMilli: 1000, reason: 'found' }),
    ).toThrow(/lacks permission/);
    expect(() => env.call('cashier', 'catalog.saveProduct', { sku: 'Z', name: 'z', priceMinor: 1 })).toThrow(/lacks permission/);
    expect(() => env.call('cashier', 'reports.salesSummary', { from: '2026-03-01', to: '2026-03-10' })).toThrow(/lacks permission/);
    expect(() => env.call('cashier', 'users.list')).toThrow(/lacks permission/);
    expect(() =>
      env.call('accountant', 'pos.checkout', {
        clientRef: ref(),
        items: [{ productId: p, qtyMilli: 1000 }],
        payments: [{ method: 'cash', amountMinor: 2800 }],
      }),
    ).toThrow(/lacks permission/);
    expect(() => env.call('warehouse', 'catalog.saveProduct', { sku: 'Z', name: 'z', priceMinor: 1 })).toThrow(/lacks permission/);
  });

  it('price edits on existing products need price.edit', () => {
    const env = makeEnv();
    const p = pid(env, 'SALT-1K');
    const prod = env.call<any>('purchaser', 'catalog.getProduct', { id: p });
    const base = {
      id: p,
      sku: prod.sku,
      name: prod.name,
      priceMinor: prod.price_minor,
      mrpMinor: prod.mrp_minor,
      costMinor: prod.cost_minor,
      taxRateBp: prod.tax_rate_bp,
    };
    expect(env.call('purchaser', 'catalog.saveProduct', { ...base, name: 'Salt 1kg renamed' })).toHaveProperty('id');
    expect(() => env.call('purchaser', 'catalog.saveProduct', { ...base, priceMinor: 100 })).toThrow(/price\.edit/);
  });

  it('cashiers only see their own sales; managers see all', () => {
    const env = makeEnv();
    const all = env.call<any[]>('manager', 'pos.listSales', {});
    const mine = env.call<any[]>('cashier', 'pos.listSales', {});
    expect(all.length).toBeGreaterThan(mine.length);
    expect(mine.every((s) => s.cashier_name === 'Chetan Cashier')).toBe(true);
    const other = all.find((s) => s.cashier_name !== 'Chetan Cashier');
    expect(() => env.call('cashier', 'pos.getSale', { id: other.id })).toThrow(/only view your own/);
  });
});

describe('reports reconcile with underlying records', () => {
  it('sales summary == Σ sale lines == Σ approved payments for completed sales', () => {
    const env = makeEnv();
    const rep = env.call<any>('manager', 'reports.salesSummary', { from: '2000-01-01', to: '2999-12-31' });
    const lines = env.app.db
      .prepare(
        "SELECT SUM(sl.total_minor) t, SUM(sl.tax_minor) x FROM sale_lines sl JOIN sales s ON s.id=sl.sale_id WHERE s.status='completed'",
      )
      .get() as any;
    const pays = env.app.db
      .prepare(
        "SELECT SUM(p.amount_minor) t FROM payments p JOIN sales s ON s.id=p.sale_id WHERE s.status='completed' AND p.kind='payment' AND p.status='approved'",
      )
      .get() as any;
    expect(rep.totals.bills).toBeGreaterThan(20);
    expect(rep.totals.net_minor).toBe(lines.t);
    expect(rep.totals.net_minor).toBe(pays.t);
    expect(rep.totals.tax_minor).toBe(lines.x);
    expect(rep.totals.gross_minor - rep.totals.discount_minor).toBe(rep.totals.net_minor);
    const top = env.call<any[]>('manager', 'reports.topProducts', { from: '2000-01-01', to: '2999-12-31', limit: 100 });
    expect(top.reduce((a, r) => a + r.revenue_minor, 0)).toBe(rep.totals.net_minor);
    assertLedgerConsistent(env);
  });

  it('seeded history is internally consistent (ledger == stock) and mock-labelled', () => {
    const env = makeEnv();
    assertLedgerConsistent(env);
    const methods = env.call<any>('manager', 'reports.paymentSummary', { from: '2000-01-01', to: '2999-12-31' });
    expect(methods.note).toMatch(/DEMO\/MOCK/);
  });
});

describe('persistence', () => {
  it('data survives an application restart (same database file)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-persist-'));
    const file = path.join(dir, 'p.db');
    const a = createApp({ file, seedIfEmpty: true, edition: 'basic' });
    const cashier = a.db.prepare("SELECT id, username, name, role FROM users WHERE username='cashier'").get() as any;

    const prod = (a.db.prepare("SELECT id FROM products WHERE sku='SALT-1K'").get() as any).id;
    const sale: any = dispatch(new Ctx(a, cashier), 'pos.checkout', {
      clientRef: 'persist-0001',
      items: [{ productId: prod, qtyMilli: 1000 }],
      payments: [{ method: 'cash', amountMinor: 2800 }],
    });
    const sales = (a.db.prepare('SELECT COUNT(*) c FROM sales').get() as any).c;
    a.db.close();
    const b = createApp({ file, seedIfEmpty: true });
    expect((b.db.prepare('SELECT COUNT(*) c FROM sales').get() as any).c).toBe(sales); // not reseeded
    expect(b.db.prepare('SELECT receipt_no FROM sales WHERE id = ?').get(sale.sale.id)).toMatchObject({ receipt_no: sale.sale.receipt_no });
    expect(new Ctx(b, null).enabledModules().size).toBe(1); // entitlements persisted (basic)
    b.db.close();
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* Windows may hold the file briefly */
    }
  });
});
