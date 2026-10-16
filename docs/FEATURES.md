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
| Core: catalog, stock, POS, billing, mock payments | ⏳ | Phase 1 |
| Warehouse / store ops | ⏳ | Phase 2 |
| Procurement / batches / controls | ⏳ | Phase 3 |
| Advanced POS | ⏳ | Phase 4 |
| Finance / reports | ⏳ | Phase 5 |
| Windows desktop package | ⏳ | Phase 6 |

This table is updated with every feature PR; nothing is listed as implemented unless it works end-to-end.
