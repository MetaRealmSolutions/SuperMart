import type { App } from './ctx';
import { Ctx } from './ctx';
import { hashPin } from './services/auth';
import { applyEntitlements } from './services/system';
import { moveStock } from './ledger';
import { EDITIONS, type ModuleId } from '../shared/modules';
import type { Role } from '../shared/permissions';

/** Demo accounts. PINs are DEMO-ONLY credentials documented in docs/DEMO-GUIDE.md. */
export const DEMO_USERS: { username: string; name: string; role: Role; pin: string }[] = [
  { username: 'owner', name: 'Olivia Owner', role: 'owner', pin: '1111' },
  { username: 'admin', name: 'Arjun Admin', role: 'administrator', pin: '2222' },
  { username: 'manager', name: 'Meera Manager', role: 'manager', pin: '3333' },
  { username: 'purchaser', name: 'Pooja Purchasing', role: 'purchasing_officer', pin: '4444' },
  { username: 'warehouse', name: 'Wasim Warehouse', role: 'warehouse_operator', pin: '5555' },
  { username: 'floor', name: 'Farah Floor', role: 'floor_staff', pin: '6666' },
  { username: 'cashier', name: 'Chetan Cashier', role: 'cashier', pin: '7777' },
  { username: 'cashier2', name: 'Charu Cashier', role: 'cashier', pin: '7778' },
  { username: 'accountant', name: 'Anita Accountant', role: 'accountant', pin: '8888' },
];

export interface DemoProduct {
  sku: string;
  name: string;
  category: string;
  brand: string;
  unit?: string;
  weighed?: boolean;
  price: number; // minor, tax-inclusive
  mrp: number;
  cost: number;
  tax: number; // percent
  barcode?: string;
  batch?: boolean;
  reorder?: number; // units
  shelf: number; // opening units on shelf
  backroom: number;
  godown: number;
}

const P = (
  sku: string,
  name: string,
  category: string,
  brand: string,
  price: number,
  mrp: number,
  cost: number,
  tax: number,
  shelf: number,
  backroom: number,
  godown: number,
  extra: Partial<DemoProduct> = {},
): DemoProduct => ({ sku, name, category, brand, price, mrp, cost, tax, shelf, backroom, godown, ...extra });

export const DEMO_PRODUCTS: DemoProduct[] = [
  P('RICE-5K', 'Basmati Rice 5kg', 'Grocery', 'Daawat', 64900, 69900, 54000, 5, 12, 20, 80, { barcode: '8901000000011', reorder: 20 }),
  P('ATTA-5K', 'Whole Wheat Atta 5kg', 'Grocery', 'Aashirvaad', 26500, 28000, 22000, 0, 15, 25, 100, {
    barcode: '8901000000028',
    reorder: 25,
  }),
  P('SUGAR-1K', 'Sugar 1kg', 'Grocery', 'Madhur', 4800, 5200, 4000, 5, 30, 40, 200, { barcode: '8901000000035', reorder: 40 }),
  P('SALT-1K', 'Iodised Salt 1kg', 'Grocery', 'Tata', 2800, 3000, 2200, 0, 30, 30, 150, { barcode: '8901000000042' }),
  P('OIL-1L', 'Sunflower Oil 1L', 'Grocery', 'Fortune', 15900, 17500, 13500, 5, 20, 30, 120, {
    barcode: '8901000000059',
    reorder: 30,
    unit: 'l',
  }),
  P('DAL-1K', 'Toor Dal 1kg', 'Grocery', 'Tata Sampann', 16500, 18000, 13800, 5, 18, 22, 90, { barcode: '8901000000066' }),
  P('TEA-250', 'Tea Powder 250g', 'Beverages', 'Brooke Bond', 12500, 13500, 10000, 5, 14, 18, 60, { barcode: '8901000000073' }),
  P('COFFEE-100', 'Instant Coffee 100g', 'Beverages', 'Nescafe', 31000, 33500, 25500, 12, 10, 10, 40, { barcode: '8901000000080' }),
  P('COLA-750', 'Cola 750ml', 'Beverages', 'Thums', 4000, 4000, 3000, 18, 40, 60, 240, { barcode: '8901000000097', unit: 'ml' }),
  P('JUICE-1L', 'Mixed Fruit Juice 1L', 'Beverages', 'Real', 11000, 12000, 8800, 12, 16, 20, 60, {
    barcode: '8901000000103',
    batch: true,
    unit: 'l',
  }),
  P('MILK-1L', 'Toned Milk 1L', 'Dairy', 'Amul', 5400, 5400, 4800, 0, 25, 30, 0, {
    barcode: '8901000000110',
    batch: true,
    unit: 'l',
    reorder: 30,
  }),
  P('CURD-400', 'Fresh Curd 400g', 'Dairy', 'Amul', 3500, 3500, 2800, 0, 16, 10, 0, { barcode: '8901000000127', batch: true }),
  P('PANEER-200', 'Paneer 200g', 'Dairy', 'Amul', 9000, 9500, 7200, 5, 10, 8, 0, { barcode: '8901000000134', batch: true }),
  P('BUTTER-100', 'Butter 100g', 'Dairy', 'Amul', 5800, 6000, 4900, 12, 12, 12, 30, { barcode: '8901000000141', batch: true }),
  P('BREAD-400', 'Sandwich Bread 400g', 'Bakery', 'Britannia', 4500, 4500, 3500, 0, 20, 15, 0, { barcode: '8901000000158', batch: true }),
  P('BISC-GD', 'Good Day Biscuits', 'Snacks', 'Britannia', 3000, 3000, 2300, 18, 40, 50, 300, { barcode: '8901000000165' }),
  P('CHIPS-52', 'Potato Chips 52g', 'Snacks', 'Lays', 2000, 2000, 1500, 12, 50, 60, 400, { barcode: '8901000000172' }),
  P('NOODLE-70', 'Instant Noodles 70g', 'Snacks', 'Maggi', 1400, 1400, 1000, 12, 60, 80, 500, { barcode: '8901000000189' }),
  P('CHOC-BAR', 'Milk Chocolate Bar', 'Snacks', 'Cadbury', 4000, 4000, 3000, 18, 35, 40, 200, { barcode: '8901000000196' }),
  P('SOAP-100', 'Bath Soap 100g', 'Personal Care', 'Lux', 4200, 4500, 3200, 18, 30, 40, 240, { barcode: '8901000000202' }),
  P('SHAMPOO-180', 'Shampoo 180ml', 'Personal Care', 'Clinic Plus', 14500, 16000, 11000, 18, 12, 18, 72, { barcode: '8901000000219' }),
  P('PASTE-150', 'Toothpaste 150g', 'Personal Care', 'Colgate', 9500, 10500, 7400, 18, 24, 30, 120, { barcode: '8901000000226' }),
  P('DETERG-1K', 'Detergent Powder 1kg', 'Household', 'Surf Excel', 22000, 24000, 17500, 18, 10, 16, 60, {
    barcode: '8901000000233',
    reorder: 15,
  }),
  P('DISH-500', 'Dishwash Liquid 500ml', 'Household', 'Vim', 10500, 11500, 8200, 18, 14, 18, 60, { barcode: '8901000000240' }),
  P('TISSUE-4', 'Toilet Tissue 4 Rolls', 'Household', 'Origami', 18000, 20000, 14000, 18, 8, 10, 40, { barcode: '8901000000257' }),
  P('BANANA', 'Bananas (loose)', 'Fruits & Vegetables', 'Local', 6000, 6000, 4500, 0, 12, 10, 0, {
    unit: 'kg',
    weighed: true,
    barcode: '2000000000015',
  }),
  P('TOMATO', 'Tomatoes (loose)', 'Fruits & Vegetables', 'Local', 4000, 4000, 2800, 0, 15, 10, 0, {
    unit: 'kg',
    weighed: true,
    barcode: '2000000000022',
  }),
  P('ONION', 'Onions (loose)', 'Fruits & Vegetables', 'Local', 3500, 3500, 2500, 0, 20, 30, 0, {
    unit: 'kg',
    weighed: true,
    barcode: '2000000000039',
  }),
  P('APPLE', 'Apples (loose)', 'Fruits & Vegetables', 'Local', 18000, 18000, 14000, 0, 8, 6, 0, {
    unit: 'kg',
    weighed: true,
    barcode: '2000000000046',
  }),
  P('BAG-L', 'Carry Bag (large)', 'Household', 'SuperMart', 500, 500, 250, 18, 100, 200, 1000, { barcode: '8901000000264' }),
];

/** Wipes every business table (not schema_migrations) so the documented baseline can be re-seeded. */
export function wipeAll(app: App): void {
  const db = app.db;
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> 'schema_migrations'")
    .all() as { name: string }[];
  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      for (const t of tables) db.prepare(`DELETE FROM "${t.name}"`).run();
      if (db.prepare("SELECT 1 FROM sqlite_master WHERE name='sqlite_sequence'").get()) db.prepare('DELETE FROM sqlite_sequence').run();
    })();
  } finally {
    db.pragma('foreign_keys = ON');
  }
}

export type SeedExtension = (ctx: Ctx) => void;
const extensions: SeedExtension[] = [];
export function registerSeed(fn: SeedExtension): void {
  extensions.push(fn);
}

export interface SeedOptions {
  edition?: keyof typeof EDITIONS;
  /** Include demo sales history (needs the POS service). */
  history?: boolean;
}

/** Build the documented demo baseline from an empty database. */
export function seedDemo(app: App, opts: SeedOptions = {}): void {
  const edition = opts.edition ?? 'full';
  const system = new Ctx(app, null);
  system.tx(() => {
    const db = app.db;
    const now = system.ts();
    applyEntitlements(system, EDITIONS[edition].modules as ModuleId[], { audit: false });
    const setting = db.prepare('INSERT INTO settings(key,value) VALUES(?,?)');
    const defaults: Record<string, string> = {
      edition,
      store_name: 'SuperMart Demo Store',
      store_address: '12 Market Road, Pune 411001',
      store_phone: '020-5550100',
      gstin: '27AAAAA0000A1Z5 (DEMO)',
      receipt_footer: 'Thank you! DEMO receipt — no real payment taken.',
      receipt_width_chars: '42',
      printer_name: 'Browser print dialog',
      max_cashier_discount_pct: '10',
      currency: 'INR',
      tax_label: 'GST (included in price)',
    };
    for (const [k, v] of Object.entries(defaults)) setting.run(k, v);

    const loc = db.prepare('INSERT INTO locations(code, name, kind, site, zone, rack, bin) VALUES (?,?,?,?,?,?,?)');
    const shelf = Number(loc.run('SHELF-1', 'Sales Floor Shelves', 'shelf', 'Store 1', 'Floor', null, null).lastInsertRowid);
    const back = Number(loc.run('BACK-1', 'Store Backroom', 'backroom', 'Store 1', 'Backroom', null, null).lastInsertRowid);
    const god = Number(loc.run('GDN-A1', 'Main Godown — Zone A', 'godown', 'Main Godown', 'A', 'R1', 'B1').lastInsertRowid);
    loc.run('GDN-B1', 'Main Godown — Zone B (Cold)', 'godown', 'Main Godown', 'B', 'R1', 'B1');
    db.prepare("INSERT INTO settings(key,value) VALUES('pos_location_id', ?)").run(String(shelf));

    const user = db.prepare('INSERT INTO users(username, name, role, pin_hash, active, created_at) VALUES (?,?,?,?,1,?)');
    for (const u of DEMO_USERS) user.run(u.username, u.name, u.role, hashPin(u.pin), now);

    const cat = new Map<string, number>();
    const brand = new Map<string, number>();
    const ensure = (m: Map<string, number>, table: string, name: string) => {
      if (!m.has(name)) m.set(name, Number(db.prepare(`INSERT INTO ${table}(name) VALUES (?)`).run(name).lastInsertRowid));
      return m.get(name)!;
    };
    const ins = db.prepare(
      `INSERT INTO products(sku,name,category_id,brand_id,unit,is_weighed,price_minor,mrp_minor,cost_minor,tax_rate_bp,track_batch,reorder_level_milli,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    );
    const bc = db.prepare('INSERT INTO barcodes(barcode, product_id) VALUES (?,?)');
    const opener = new Ctx(app, { id: 1, username: 'owner', name: 'Olivia Owner', role: 'owner' });
    for (const p of DEMO_PRODUCTS) {
      const id = Number(
        ins.run(
          p.sku,
          p.name,
          ensure(cat, 'categories', p.category),
          ensure(brand, 'brands', p.brand),
          p.unit ?? 'pcs',
          p.weighed ? 1 : 0,
          p.price,
          p.mrp,
          p.cost,
          p.tax * 100,
          p.batch ? 1 : 0,
          (p.reorder ?? 10) * 1000,
          now,
          now,
        ).lastInsertRowid,
      );
      if (p.barcode) bc.run(p.barcode, id);
      bc.run(`SKU:${p.sku}`, id);
      const put = (locationId: number, units: number, batchNo?: string) => {
        if (units <= 0) return;
        let batchId = 0;
        if (p.batch) {
          const exp = new Date(app.now().getTime() + 14 * 86400000).toISOString().slice(0, 10);
          batchId = Number(
            db
              .prepare('INSERT INTO batches(product_id, batch_no, mfg_date, expiry_date) VALUES (?,?,?,?)')
              .run(id, batchNo ?? `${p.sku}-B1`, now.slice(0, 10), exp).lastInsertRowid,
          );
        }
        moveStock(opener, {
          productId: id,
          batchId,
          qtyMilli: units * 1000,
          to: { locationId, status: 'sellable' },
          reason: 'opening',
          note: 'Demo opening stock',
          unitCostMinor: p.cost,
        });
      };
      put(shelf, p.shelf, `${p.sku}-S1`);
      put(back, p.backroom, `${p.sku}-K1`);
      put(god, p.godown, `${p.sku}-G1`);
    }
    for (const ext of extensions) ext(system);
  });
}

export function resetDemo(app: App, opts: SeedOptions = {}): void {
  wipeAll(app);
  seedDemo(app, opts);
}
