# SuperMart — Architecture & Decision Record

## Summary

A single TypeScript codebase:

```
shared/   Pure domain code used by BOTH server and UI: money, quantity, module registry, role permissions
server/   API (HTTP+JSON), business services, SQLite persistence, migrations, seed data   (Node 22)
src/      Expo (React Native Web) UI — Expo Router, desktop-first                          (browser / Electron)
docs/     Documentation
```

```
 Browser / Electron window            Node process (one per store)
┌──────────────────────────┐  POST    ┌──────────────────────────────────────────┐
│ Expo Router UI           │ /api/rpc │ http.ts  → handleRequest(token, method)  │
│  src/lib/api.ts (rpc)    │ ───────► │ api.ts dispatch:                         │
│  nav/guards (UX only)    │          │   authenticate → module entitlement →    │
└──────────────────────────┘          │   role permission → zod validation       │
                                      │ services/*  (business rules, transactions)│
                                      │ ledger.ts   (ONLY writer of `stock`)      │
                                      │ SQLite (better-sqlite3, WAL)              │
                                      └──────────────────────────────────────────┘
```

## Decisions

### D1 — Database: SQLite behind a local Node API (not browser storage, not a cloud DB)
* Requirement: persistent, transactional, auditable retail data; single-computer demo now; multi-terminal later.
* SQLite (`better-sqlite3`, WAL, `foreign_keys=ON`) gives real ACID transactions, constraints (`CHECK qty >= 0`) and trivial backup (copy the file / `VACUUM INTO`). No server install on a shop PC.
* The UI never touches the DB. It calls the API, so the *same* API serves a future second terminal.
* Rejected: `expo-sqlite` in the browser (WASM, experimental on web, per-browser data, no path to sharing); IndexedDB (no relational constraints); Postgres (operational burden unjustified for a one-store demo).

### D2 — Multi-terminal upgrade path (documented, not silently assumed)
* **Today:** one process, one DB file, `HOST=127.0.0.1`. Separate desktop installs do **not** share data — each has its own database.
* **Upgrade:** run the same server on one store PC with `HOST=0.0.0.0`; cashier/warehouse/manager terminals open `http://<store-pc>:4000`. Everything required already exists: token sessions, per-request authorization, serialized transactional writes (SQLite single-writer + `busy_timeout`). Before exposing to a LAN you must add TLS (reverse proxy) and firewall rules; PIN login is rate-limited (lockout) but is not a substitute for network security.
* **Beyond one store:** swap SQLite for Postgres behind the same service functions (all SQL is in `server/`), add central sync. Out of scope now.

### D3 — Authorization is enforced in the API, never only in the UI
`server/api.ts` `dispatch()` is the single choke point: authenticated user → module enabled → every declared permission → zod input validation. Methods without a declared permission fail registration. UI hiding (`src/lib/nav.ts`, `Guard`) is convenience only. Module-specific *behaviour inside* shared services (e.g. batches in checkout) re-checks via `ctx.has(module)`.

### D4 — Modules are entitlements, not code forks
`shared/modules.ts` is the registry (ids, dependencies, editions). State lives in `module_entitlements`. Disabling flips a flag; **no data is deleted**, and re-enabling restores it. Dependencies are validated on every change (`validateEnabledSet`). Editions (Basic/Inventory/Full) are just named sets. Licensing later: replace the source of the enabled set with a signed licence file/key check inside `applyEntitlements`; nothing else changes.

### D5 — Money and quantity are integers
Money = integer paise. Quantity = integer milli-units (1000 = 1 pcs/kg/l). Selling prices are **tax-inclusive** (Indian MRP convention); tax = `round(gross × rate / (1+rate))`, half away from zero (`shared/money.ts`). Cart discounts are allocated across lines with `allocate()` so parts sum exactly. No floating point in totals.

### D6 — One stock mutator
`server/ledger.ts::moveStock` is the only code that changes the `stock` table, and always writes a `stock_ledger` row (reason, source, destination, quantity, actor, timestamp, reference). A physical unit exists in exactly one `(location, batch, status)` row, so nothing is double counted. Negative stock is impossible (check + `CHECK` constraint); no override is implemented.

### D7 — Payments are mock-only
`server/payments.ts` (Phase 1) is a deterministic adapter labelled DEMO/MOCK. No card/UPI credentials are accepted or stored; the scenario (approve/decline/pending) is chosen explicitly by the operator.

### D8 — Desktop packaging (Windows)
Electron is justified because shop staff need a double-click app with an embedded server and no browser/Node install. The shell (Phase 6) only starts the same Node server and opens a window on it; **no business logic lives in Electron**. Native module (`better-sqlite3`) must be rebuilt for Electron's ABI (`electron-builder` does this). See README for packaging status.

### D9 — Authentication & sessions
Username + numeric PIN, hashed with scrypt (per-user salt). 5 failures → 1-minute lockout. Session tokens are 256-bit random, stored only as SHA-256, expire after 12 h, and are revoked on logout/deactivation. Demo PINs are intentionally weak and documented — change them for any real use.

### D10 — Migrations
Ordered TS migrations (`server/migrations/NNN_*.ts`) applied transactionally and recorded in `schema_migrations`. Never edit an applied migration; add a new one. All module tables always exist regardless of entitlement.

## Business-logic locations
| Concern | File |
|---|---|
| Dispatch, auth, entitlement, permission | `server/api.ts`, `server/ctx.ts` |
| Stock mutation | `server/ledger.ts` |
| Module registry / editions | `shared/modules.ts` |
| Roles & permissions | `shared/permissions.ts` |
| Money/qty maths | `shared/money.ts`, `shared/qty.ts` |
| Services | `server/services/*.ts` |

## Testing strategy
Vitest. Business rules and transactional workflows are tested at the service layer against an in-memory SQLite database seeded with the real demo baseline (`server/__tests__/`). HTTP/boot is covered by `scripts/smoke.mjs` in CI.
