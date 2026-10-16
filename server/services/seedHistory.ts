import { dispatch } from '../api';
import { Ctx } from '../ctx';
import { registerSeed } from '../seed';
import { AppError } from '../errors';
import { moveStock } from '../ledger';

/** Small deterministic PRNG so the demo baseline is reproducible. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Seeds one week of POS history through the real checkout path (so stock, ledger and payments stay consistent). */
registerSeed((system) => {
  const app = system.app;
  const rnd = mulberry32(20260310);
  const real = app.now;
  const base = real();
  const cashiers = (['cashier', 'cashier2'] as const).map(
    (u) => app.db.prepare('SELECT id, username, name, role FROM users WHERE username = ?').get(u) as any,
  );
  const products = app.db.prepare('SELECT id, is_weighed FROM products WHERE active = 1 ORDER BY id').all() as {
    id: number;
    is_weighed: number;
  }[];
  const shelf = Number((app.db.prepare("SELECT value FROM settings WHERE key='pos_location_id'").get() as any).value);
  const owner = new Ctx(app, app.db.prepare("SELECT id, username, name, role FROM users WHERE username='owner'").get() as any);
  let n = 0;
  try {
    // The week's trading happened on top of a larger opening shelf stock (booked 8 days ago), so the
    // demo shelves still look healthy after the history is replayed.
    app.now = () => new Date(base.getTime() - 8 * 86400000);
    for (const p of products) {
      const row = app.db
        .prepare(
          "SELECT batch_id FROM stock WHERE product_id = ? AND location_id = ? AND status = 'sellable' ORDER BY qty_milli DESC LIMIT 1",
        )
        .get(p.id, shelf) as { batch_id: number } | undefined;
      moveStock(owner, {
        productId: p.id,
        batchId: row?.batch_id ?? 0,
        qtyMilli: 30000,
        to: { locationId: shelf, status: 'sellable' },
        reason: 'opening',
        note: 'Demo: pre-history shelf stock',
      });
    }
    for (let back = 7; back >= 1; back--) {
      const bills = 5 + Math.floor(rnd() * 4);
      for (let b = 0; b < bills; b++) {
        const when = new Date(base.getTime() - back * 86400000);
        when.setUTCHours(4 + Math.floor(rnd() * 10), Math.floor(rnd() * 60), 0, 0); // ~09:30–19:30 IST
        app.now = () => when;
        const cashier = new Ctx(app, cashiers[Math.floor(rnd() * cashiers.length)]);
        const items = Array.from({ length: 1 + Math.floor(rnd() * 4) }, () => {
          const p = products[Math.floor(rnd() * products.length)];
          return { productId: p.id, qtyMilli: p.is_weighed ? 500 + Math.floor(rnd() * 3) * 500 : 1000 * (1 + Math.floor(rnd() * 3)) };
        });
        const dedup = [...new Map(items.map((i) => [i.productId, i])).values()];
        try {
          const quote: any = dispatch(cashier, 'pos.quote', { items: dedup });
          const r = rnd();
          const method = r < 0.5 ? 'cash' : r < 0.8 ? 'upi' : 'card';
          dispatch(cashier, 'pos.checkout', {
            clientRef: `seed-${back}-${b}`,
            items: dedup,
            payments: [
              {
                method,
                amountMinor: quote.totalMinor,
                ...(method === 'cash' ? { tenderedMinor: Math.ceil(quote.totalMinor / 10000) * 10000 } : {}),
              },
            ],
          });
          n++;
        } catch (e) {
          if (!(e instanceof AppError)) throw e; // out of stock etc. → skip this bill
        }
      }
    }
  } finally {
    app.now = real;
  }
  void n;
});
