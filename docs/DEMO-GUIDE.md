# Demo Guide

Scenarios are added as modules land. Current:

1. `npm run dev`, open the web URL.
2. Sign in as `manager` / `3333`. Open **Settings & Modules**.
3. Apply **Basic Mart** → navigation shrinks to core only. Apply **Full Mart** → all modules reappear; data is untouched.
4. Sign in as `cashier` / `7777`: Settings shows no module controls (role lacks `modules.manage`).
5. As `owner`/`1111`: Settings → Demo data → Reset restores the baseline.
