# Data Model & Stock Rules

Source of truth: `server/migrations/*.ts`. Money = integer paise; quantity = integer milli-units.

## Inventory model
A physical unit exists in exactly one row of `stock(product_id, location_id, batch_id, status)`:
* **Location kind**: `godown` (warehouse), `backroom` (store back stock), `shelf` (sales floor — the only kind POS sells from).
* **Status**: `sellable`, `quarantine`, `damaged`. Only `sellable` stock on the POS shelf location that is not expired can be sold.
* **Total store stock** = backroom + shelf; replenishment moves backroom → shelf and leaves the total unchanged.
* `batch_id = 0` means "no batch".

Every change goes through `moveStock` and produces a `stock_ledger` row: product, batch, qty, from/to (location, status), reason, ref_type/ref_id, actor, timestamp, unit cost.

## Phase 0 tables
`settings`, `module_entitlements`, `users`, `sessions`, `audit_log`, `counters`, `categories`, `brands`, `products`, `barcodes`, `price_history`, `locations`, `batches`, `stock`, `stock_ledger`, `sales`, `sale_lines`, `payments`, `payment_attempts`.

Later phases append tables via new migrations; this document is extended in the same PR.
