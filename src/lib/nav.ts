export interface NavItem {
  href: string;
  label: string;
  module: string;
  perm: string;
  group: string;
}

/** Navigation is filtered by enabled modules AND role permissions (server re-checks both). */
export const NAV: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', module: 'core', perm: 'catalog.view', group: 'Home' },
  { href: '/pos', label: 'Cashier / POS', module: 'core', perm: 'pos.sell', group: 'Sell' },
  { href: '/sales', label: 'Sales History', module: 'core', perm: 'sales.view', group: 'Sell' },
  { href: '/products', label: 'Products', module: 'core', perm: 'catalog.view', group: 'Inventory' },
  { href: '/stock', label: 'Stock', module: 'core', perm: 'stock.view', group: 'Inventory' },
  { href: '/reports', label: 'Sales Reports', module: 'core', perm: 'reports.basic', group: 'Insight' },
  { href: '/users', label: 'Users', module: 'core', perm: 'users.manage', group: 'Admin' },
  { href: '/settings', label: 'Settings & Modules', module: 'core', perm: 'catalog.view', group: 'Admin' },
];
