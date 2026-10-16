/**
 * Central module registry. A single codebase serves every client edition; an edition is just a
 * set of enabled optional modules. Core is mandatory and can never be disabled.
 */
export type ModuleId =
  'core' | 'pricing' | 'warehouse' | 'store_ops' | 'procurement' | 'advanced_pos' | 'inventory_controls' | 'finance' | 'reports' | 'access';

export interface ModuleDef {
  id: ModuleId;
  letter: string;
  name: string;
  description: string;
  mandatory: boolean;
  dependsOn: ModuleId[];
}

export const MODULES: ModuleDef[] = [
  {
    id: 'core',
    letter: '-',
    name: 'Core (Stock + POS + Billing)',
    description: 'Catalog, basic stock, POS, billing, mock payments, sales history, basic reports, essential users.',
    mandatory: true,
    dependsOn: [],
  },
  {
    id: 'pricing',
    letter: 'A',
    name: 'Product & Pricing',
    description: 'Price history, promotions, coupons, price labels, CSV import/export.',
    mandatory: false,
    dependsOn: ['core'],
  },
  {
    id: 'warehouse',
    letter: 'B',
    name: 'Godown & Warehouse',
    description: 'Godown locations, bins, gate entries, GRNs, discrepancies.',
    mandatory: false,
    dependsOn: ['core'],
  },
  {
    id: 'store_ops',
    letter: 'C',
    name: 'Store & Shelf Inventory',
    description: 'Warehouse-to-store transfers, shelf replenishment, shelf capacity, alerts.',
    mandatory: false,
    dependsOn: ['warehouse'],
  },
  {
    id: 'procurement',
    letter: 'D',
    name: 'Suppliers & Procurement',
    description: 'Suppliers, purchase requests/orders, approvals, partial receipts, purchase returns, supplier payments.',
    mandatory: false,
    dependsOn: ['warehouse'],
  },
  {
    id: 'advanced_pos',
    letter: 'E',
    name: 'Advanced POS & Cashier Ops',
    description: 'Shifts, cash drawer, hold/resume, returns, voids, manager approvals.',
    mandatory: false,
    dependsOn: ['core'],
  },
  {
    id: 'inventory_controls',
    letter: 'F',
    name: 'Inventory Controls',
    description: 'Batches & expiry (FEFO), stock counts, quarantine, write-offs, valuation, reorder suggestions.',
    mandatory: false,
    dependsOn: ['core'],
  },
  {
    id: 'finance',
    letter: 'G',
    name: 'Finance & Accounts',
    description: 'Expenses, COGS, gross margin, settlement reconciliation, ledgers, tax summary, daily closing.',
    mandatory: false,
    dependsOn: ['core'],
  },
  {
    id: 'reports',
    letter: 'H',
    name: 'Reports & Analytics',
    description: 'Advanced reports with filters and CSV export.',
    mandatory: false,
    dependsOn: ['core'],
  },
  {
    id: 'access',
    letter: 'I',
    name: 'Employees & Access Control',
    description: 'User management, audit log viewer, employee activity history.',
    mandatory: false,
    dependsOn: ['core'],
  },
];

export const MODULE_BY_ID = Object.fromEntries(MODULES.map((m) => [m.id, m])) as Record<ModuleId, ModuleDef>;

export const EDITIONS: Record<string, { name: string; modules: ModuleId[] }> = {
  basic: { name: 'Basic Mart', modules: ['core'] },
  inventory: { name: 'Inventory Mart', modules: ['core', 'warehouse', 'store_ops', 'inventory_controls'] },
  full: { name: 'Full Mart', modules: MODULES.map((m) => m.id) },
};

/** Returns a list of problems; empty means the set is a valid entitlement configuration. */
export function validateEnabledSet(enabled: Iterable<ModuleId>): string[] {
  const set = new Set(enabled);
  const problems: string[] = [];
  if (!set.has('core')) problems.push('The core module is mandatory and cannot be disabled.');
  for (const id of set) {
    for (const dep of MODULE_BY_ID[id]?.dependsOn ?? []) {
      if (!set.has(dep)) problems.push(`Module "${id}" requires "${dep}" to be enabled.`);
    }
  }
  return problems;
}
