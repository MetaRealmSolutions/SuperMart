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
  { href: '/settings', label: 'Settings & Modules', module: 'core', perm: 'catalog.view', group: 'Admin' },
];
