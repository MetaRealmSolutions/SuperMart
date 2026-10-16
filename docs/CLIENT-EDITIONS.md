# Client Editions & Module Entitlements

One codebase, many clients. A client edition is a set of enabled modules stored in `module_entitlements`; the registry is `shared/modules.ts`.

| Module id | Letter | Depends on | Basic | Inventory | Full |
|---|---|---|---|---|---|
| `core` (mandatory) | — | — | ✔ | ✔ | ✔ |
| `pricing` | A | core | | | ✔ |
| `warehouse` | B | core | | ✔ | ✔ |
| `store_ops` | C | warehouse | | ✔ | ✔ |
| `procurement` | D | warehouse | | | ✔ |
| `advanced_pos` | E | core | | | ✔ |
| `inventory_controls` | F | core | | ✔ | ✔ |
| `finance` | G | core | | | ✔ |
| `reports` | H | core | | | ✔ |
| `access` | I | core | | | ✔ |

Employees/roles basics and settings/operations (J) are part of **core** (user CRUD, settings, demo reset); `access` adds the audit-log viewer and employee activity history.

## Rules (all enforced + tested)
* `core` can never be disabled; enabling a module requires its dependencies; disabling a module that another enabled module needs is refused.
* Disabled modules disappear from navigation and their API methods return `MODULE_DISABLED` (server-side).
* Disabling never deletes data; re-enabling restores it.
* Entitlement changes are audited (`modules.changed`).

## Switching
* New database: `SUPERMART_EDITION=basic|inventory|full`.
* Running system: Settings & Modules → apply an edition or toggle modules (needs `modules.manage`: owner/administrator).
* Demo reset can reseed under a chosen edition.

## Licensing later
There is deliberately no fake online subscription. To add licensing, make `applyEntitlements` (server/services/system.ts) derive the allowed set from a signed licence file (e.g. Ed25519-signed JSON `{client, modules, expires}` verified with an embedded public key) and reject sets outside it. UI and services need no change because they only consult the entitlement table.
