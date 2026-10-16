# Features & Status

Legend: ✅ implemented **and** covered by automated tests · 🟡 implemented, partially tested · ⏳ planned · ❌ deferred

| Area | Status | Notes |
|---|---|---|
| Project foundation (Expo, TS strict, lint, CI) | ✅ | |
| Module registry, editions, dependency validation | ✅ | `shared/modules.ts` |
| Entitlement enforcement in API + UI | ✅ | |
| Users, PIN login, lockout, sessions, roles/permissions | ✅ | |
| Audit log writes | ✅ | viewer lands with `access` module |
| Migrations, demo seed, demo reset | ✅ | |
| Core: product catalog, barcodes, price history | ✅ | API tested; UI built, not browser-tested |
| Core: stock levels, adjustments, movement ledger | ✅ | negative stock impossible; ledger == stock invariant tested |
| Core: POS cart pricing, tax-inclusive GST, discounts + limit | ✅ | integer paise |
| Core: mock cash/card/UPI, split tender, pending/declined handling | ✅ | no sale on decline; pending holds stock |
| Core: receipts, sales history, basic reports, dashboard | 🟡 | receipts/reports tested at API; UI not browser-tested |
| Core: FEFO, expired/quarantined blocking | ✅ | |
| Warehouse / store ops | ⏳ | Phase 2 |
| Procurement / batches / controls | ⏳ | Phase 3 |
| Advanced POS | ⏳ | Phase 4 |
| Finance / reports | ⏳ | Phase 5 |
| Windows desktop package | ⏳ | Phase 6 |

This table is updated with every feature PR; nothing is listed as implemented unless it works end-to-end.


## Definitions
* **Net sales** = Σ totals of *completed* bills (tax-inclusive), by store-local business date (`utc_offset_minutes`, default +05:30). Not profit.
* **Weighed items** accept fractional quantities (milli-units); others whole units only.
* Not implemented (yet): weighing-scale/price-embedded barcodes; cash rounding.
