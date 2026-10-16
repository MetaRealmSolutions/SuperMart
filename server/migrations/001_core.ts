export default `
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE module_entitlements (
  module_id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  pin_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  actor_id INTEGER,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id TEXT,
  detail TEXT
);
CREATE INDEX idx_audit_ts ON audit_log(ts);
CREATE INDEX idx_audit_actor ON audit_log(actor_id);

CREATE TABLE counters (
  name TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);

CREATE TABLE categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  parent_id INTEGER REFERENCES categories(id)
);

CREATE TABLE brands (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sku TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category_id INTEGER REFERENCES categories(id),
  brand_id INTEGER REFERENCES brands(id),
  unit TEXT NOT NULL DEFAULT 'pcs',
  is_weighed INTEGER NOT NULL DEFAULT 0,
  price_minor INTEGER NOT NULL CHECK (price_minor >= 0),   -- tax-inclusive selling price per unit
  mrp_minor INTEGER NOT NULL DEFAULT 0,
  cost_minor INTEGER NOT NULL DEFAULT 0,                    -- moving-average purchase cost per unit
  tax_rate_bp INTEGER NOT NULL DEFAULT 0,                   -- 1% = 100bp, tax is included in price
  track_batch INTEGER NOT NULL DEFAULT 0,
  reorder_level_milli INTEGER NOT NULL DEFAULT 0,
  parent_product_id INTEGER REFERENCES products(id),        -- variant grouping
  variant_label TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_products_name ON products(name);
CREATE INDEX idx_products_category ON products(category_id);

CREATE TABLE barcodes (
  barcode TEXT PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id),
  pack_qty_milli INTEGER NOT NULL DEFAULT 1000,             -- units of product represented by one scan
  label TEXT
);
CREATE INDEX idx_barcodes_product ON barcodes(product_id);

CREATE TABLE price_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id),
  ts TEXT NOT NULL,
  actor_id INTEGER,
  field TEXT NOT NULL,
  old_minor INTEGER,
  new_minor INTEGER NOT NULL
);

CREATE TABLE locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('godown','backroom','shelf')),
  site TEXT NOT NULL DEFAULT 'Main',
  zone TEXT,
  rack TEXT,
  bin TEXT,
  capacity_milli INTEGER,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id),
  batch_no TEXT NOT NULL,
  mfg_date TEXT,
  expiry_date TEXT,
  UNIQUE (product_id, batch_no)
);

-- batch_id 0 = "no batch". One physical unit lives in exactly one (location, batch, status) row.
CREATE TABLE stock (
  product_id INTEGER NOT NULL REFERENCES products(id),
  location_id INTEGER NOT NULL REFERENCES locations(id),
  batch_id INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('sellable','quarantine','damaged')),
  qty_milli INTEGER NOT NULL CHECK (qty_milli >= 0),
  PRIMARY KEY (product_id, location_id, batch_id, status)
);

CREATE TABLE stock_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  product_id INTEGER NOT NULL REFERENCES products(id),
  batch_id INTEGER NOT NULL DEFAULT 0,
  qty_milli INTEGER NOT NULL CHECK (qty_milli > 0),
  from_location_id INTEGER,
  from_status TEXT,
  to_location_id INTEGER,
  to_status TEXT,
  reason TEXT NOT NULL,
  ref_type TEXT,
  ref_id TEXT,
  actor_id INTEGER,
  note TEXT,
  unit_cost_minor INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_ledger_product ON stock_ledger(product_id, ts);
CREATE INDEX idx_ledger_ref ON stock_ledger(ref_type, ref_id);

CREATE TABLE sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_no TEXT NOT NULL UNIQUE,
  client_ref TEXT NOT NULL UNIQUE,
  ts TEXT NOT NULL,
  cashier_id INTEGER NOT NULL REFERENCES users(id),
  shift_id INTEGER,
  location_id INTEGER NOT NULL REFERENCES locations(id),
  status TEXT NOT NULL CHECK (status IN ('completed','pending_payment','cancelled','voided')),
  gross_minor INTEGER NOT NULL,
  discount_minor INTEGER NOT NULL,
  total_minor INTEGER NOT NULL,
  tax_minor INTEGER NOT NULL,
  paid_minor INTEGER NOT NULL DEFAULT 0,
  change_minor INTEGER NOT NULL DEFAULT 0,
  coupon_code TEXT,
  customer_name TEXT,
  approved_by INTEGER,
  note TEXT
);
CREATE INDEX idx_sales_ts ON sales(ts);

CREATE TABLE sale_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL REFERENCES sales(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  batch_id INTEGER NOT NULL DEFAULT 0,
  sku TEXT NOT NULL,
  name TEXT NOT NULL,
  qty_milli INTEGER NOT NULL CHECK (qty_milli > 0),
  unit_price_minor INTEGER NOT NULL,
  gross_minor INTEGER NOT NULL,
  discount_minor INTEGER NOT NULL DEFAULT 0,
  total_minor INTEGER NOT NULL,
  tax_rate_bp INTEGER NOT NULL,
  tax_minor INTEGER NOT NULL,
  unit_cost_minor INTEGER NOT NULL DEFAULT 0,
  returned_milli INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_sale_lines_sale ON sale_lines(sale_id);
CREATE INDEX idx_sale_lines_product ON sale_lines(product_id);

CREATE TABLE payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL REFERENCES sales(id),
  ts TEXT NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('cash','card','upi')),
  kind TEXT NOT NULL CHECK (kind IN ('payment','refund')),
  amount_minor INTEGER NOT NULL,
  tendered_minor INTEGER,
  status TEXT NOT NULL CHECK (status IN ('approved','pending','declined','failed','cancelled')),
  reference TEXT NOT NULL UNIQUE,
  scenario TEXT,
  return_id INTEGER,
  shift_id INTEGER,
  simulated INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_payments_sale ON payments(sale_id);

-- Declined / failed attempts never create a sale, but are kept for diagnostics and reconciliation.
CREATE TABLE payment_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  client_ref TEXT NOT NULL,
  cashier_id INTEGER,
  method TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  status TEXT NOT NULL,
  reference TEXT NOT NULL,
  scenario TEXT
);
`;
