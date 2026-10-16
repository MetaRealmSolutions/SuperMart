import type { DB } from './db';
import { AppError } from './errors';
import type { ModuleId } from '../shared/modules';
import { roleHas, type Permission, type Role } from '../shared/permissions';

export interface User {
  id: number;
  username: string;
  name: string;
  role: Role;
}

export interface App {
  db: DB;
  /** Injectable clock so tests and the demo are deterministic. */
  now: () => Date;
}

export class Ctx {
  constructor(
    public app: App,
    public user: User | null,
  ) {}

  get db(): DB {
    return this.app.db;
  }

  ts(): string {
    return this.app.now().toISOString();
  }

  today(): string {
    return this.ts().slice(0, 10);
  }

  enabledModules(): Set<ModuleId> {
    const rows = this.db.prepare('SELECT module_id FROM module_entitlements WHERE enabled = 1').all() as { module_id: ModuleId }[];
    const set = new Set<ModuleId>(rows.map((r) => r.module_id));
    set.add('core');
    return set;
  }

  has(module: ModuleId): boolean {
    return module === 'core' || this.enabledModules().has(module);
  }

  requireModule(module: ModuleId): void {
    if (!this.has(module)) throw new AppError('MODULE_DISABLED', `The "${module}" module is not enabled for this installation.`);
  }

  can(perm: Permission): boolean {
    return !!this.user && roleHas(this.user.role, perm);
  }

  require(perm: Permission): void {
    if (!this.user) throw new AppError('UNAUTHENTICATED', 'Sign in required.');
    if (!this.can(perm)) throw new AppError('FORBIDDEN', `Your role (${this.user.role}) lacks permission "${perm}".`);
  }

  actor(): User {
    if (!this.user) throw new AppError('UNAUTHENTICATED', 'Sign in required.');
    return this.user;
  }

  audit(action: string, entity?: string, entityId?: string | number, detail?: unknown): void {
    this.db
      .prepare('INSERT INTO audit_log(ts, actor_id, action, entity, entity_id, detail) VALUES (?,?,?,?,?,?)')
      .run(
        this.ts(),
        this.user?.id ?? null,
        action,
        entity ?? null,
        entityId === undefined ? null : String(entityId),
        detail === undefined ? null : JSON.stringify(detail),
      );
  }

  tx<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  nextCounter(name: string): number {
    this.db.prepare('INSERT INTO counters(name, value) VALUES (?, 0) ON CONFLICT(name) DO NOTHING').run(name);
    this.db.prepare('UPDATE counters SET value = value + 1 WHERE name = ?').run(name);
    return (this.db.prepare('SELECT value FROM counters WHERE name = ?').get(name) as { value: number }).value;
  }

  setting(key: string, fallback = ''): string {
    const r = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    return r ? r.value : fallback;
  }
}
