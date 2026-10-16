# SuperMart

A modular supermarket / mart management system (POS, billing, inventory, godown, procurement, finance, reports) built with **Expo (React Native Web) + TypeScript**, a **Node API** and **SQLite**. Desktop-first. **All payments are simulated (DEMO/MOCK).**

> Status: under active development — see [docs/FEATURES.md](docs/FEATURES.md) for what is implemented and tested, and [CHANGELOG.md](CHANGELOG.md).

## Requirements
* Node.js 22+ and npm 10+ (developed on Node 22.16)
* Windows, macOS or Linux

## Quick start
```bash
npm install
npm run dev          # API on :4000 + Expo web dev server on :8081
```
Open the Expo web URL, sign in with a demo account (see below). First start creates `data/supermart.db` and seeds demo data.

Single-process "production-style" run (API serves the built web app):
```bash
npm run start:prod   # builds web, then serves http://127.0.0.1:4000
```

## Scripts
| Command | Purpose |
|---|---|
| `npm run dev` | API + Expo web dev server |
| `npm run server` | API only (`tsx server/index.ts`) |
| `npm test` | Vitest unit + integration tests |
| `npm run typecheck` | `tsc --noEmit` (strict) |
| `npm run lint` | Expo/ESLint |
| `npm run build:web` | Production web export to `dist/` |
| `node scripts/smoke.mjs` | Boot real server and verify login over HTTP (after `build:web`) |
| `npm run check` | typecheck + lint + tests |

## Configuration
Copy `.env.example`; every value has a safe default. `SUPERMART_EDITION=basic|inventory|full` picks the edition for a **new** database. Editions/modules can also be changed in-app (Settings & Modules).

## Demo accounts (DEMO ONLY)
| User | PIN | Role |
|---|---|---|
| owner | 1111 | Owner |
| admin | 2222 | Administrator |
| manager | 3333 | Manager |
| purchaser | 4444 | Purchasing officer |
| warehouse | 5555 | Warehouse operator |
| floor | 6666 | Floor staff |
| cashier / cashier2 | 7777 / 7778 | Cashier |
| accountant | 8888 | Accountant |

Reset the demo baseline any time: Settings → Demo data → Reset (owner/admin).

## Documentation
* [Architecture & decisions](docs/ARCHITECTURE.md)
* [Features & status](docs/FEATURES.md)
* [Client editions](docs/CLIENT-EDITIONS.md)
* [Data model](docs/DATA-MODEL.md)
* [Demo guide](docs/DEMO-GUIDE.md)
* [Changelog](CHANGELOG.md)

## Safety notes
* Demo PINs are public. Do not expose the server beyond localhost without TLS and changing all PINs.
* No real payment gateway, bank or card processing exists in this project.
