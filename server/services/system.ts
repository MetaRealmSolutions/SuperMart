import { define, z } from '../api';
import { AppError } from '../errors';
import { EDITIONS, MODULES, MODULE_BY_ID, validateEnabledSet, type ModuleId } from '../../shared/modules';
import type { Ctx } from '../ctx';

export const APP_VERSION = '0.1.0';

const moduleIds = MODULES.map((m) => m.id) as [ModuleId, ...ModuleId[]];

/**
 * Apply an entitlement set. Only the module_entitlements flags change — business records of a
 * disabled module are never deleted and reappear when the module is re-enabled.
 */
export function applyEntitlements(ctx: Ctx, enabled: ModuleId[], opts: { audit?: boolean } = {}): void {
  const set = new Set<ModuleId>(['core', ...enabled]);
  const problems = validateEnabledSet(set);
  if (problems.length) throw new AppError('VALIDATION', problems.join(' '));
  ctx.tx(() => {
    const st = ctx.db.prepare(
      'INSERT INTO module_entitlements(module_id, enabled, updated_at) VALUES (?,?,?) ON CONFLICT(module_id) DO UPDATE SET enabled=excluded.enabled, updated_at=excluded.updated_at',
    );
    for (const m of MODULES) st.run(m.id, set.has(m.id) ? 1 : 0, ctx.ts());
    if (opts.audit !== false) ctx.audit('modules.changed', 'modules', undefined, { enabled: [...set] });
  });
}

define('modules.list', {
  module: 'core',
  perm: 'catalog.view',
  handler: (ctx) => {
    const on = ctx.enabledModules();
    return MODULES.map((m) => ({ ...m, enabled: on.has(m.id) }));
  },
});

define('modules.set', {
  module: 'core',
  perm: 'modules.manage',
  input: z.object({ enabled: z.array(z.enum(moduleIds)) }),
  handler: (ctx, i) => {
    applyEntitlements(ctx, i.enabled);
    return { enabled: [...ctx.enabledModules()] };
  },
});

define('modules.applyEdition', {
  module: 'core',
  perm: 'modules.manage',
  input: z.object({ edition: z.enum(['basic', 'inventory', 'full']) }),
  handler: (ctx, i) => {
    applyEntitlements(ctx, EDITIONS[i.edition].modules);
    ctx.db
      .prepare("INSERT INTO settings(key,value) VALUES('edition',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
      .run(i.edition);
    return { edition: i.edition, enabled: [...ctx.enabledModules()] };
  },
});

export const SETTING_KEYS = [
  'store_name',
  'store_address',
  'store_phone',
  'gstin',
  'receipt_footer',
  'receipt_width_chars',
  'printer_name',
  'pos_location_id',
  'max_cashier_discount_pct',
  'currency',
  'tax_label',
] as const;

define('settings.get', {
  module: 'core',
  perm: 'catalog.view',
  handler: (ctx) => {
    const rows = ctx.db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  },
});

define('settings.set', {
  module: 'core',
  perm: 'settings.manage',
  input: z.object({ values: z.record(z.string(), z.string().max(500)) }),
  handler: (ctx, i) =>
    ctx.tx(() => {
      for (const [k, v] of Object.entries(i.values)) {
        if (!(SETTING_KEYS as readonly string[]).includes(k)) throw new AppError('VALIDATION', `Unknown setting ${k}`);
        ctx.db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, v);
      }
      ctx.audit('settings.changed', 'settings', undefined, i.values);
      return { ok: true };
    }),
});

define('system.info', {
  module: 'core',
  perm: 'catalog.view',
  handler: (ctx) => {
    const mig = ctx.db.prepare('SELECT id FROM schema_migrations ORDER BY id').all() as { id: string }[];
    return {
      version: APP_VERSION,
      node: process.version,
      edition: ctx.setting('edition', 'custom'),
      migrations: mig.map((m) => m.id),
      payments: 'DEMO/MOCK — no real payment processing',
      moduleNames: Object.fromEntries(Object.entries(MODULE_BY_ID).map(([k, v]) => [k, v.name])),
    };
  },
});
