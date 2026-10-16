import { createApp } from '../app';
import { dispatch } from '../api';
import { Ctx, type App } from '../ctx';
import { seedDemo } from '../seed';
import type { Role } from '../../shared/permissions';

export interface TestEnv {
  app: App;
  /** Context for a seeded demo user, by username (owner, manager, cashier, ...). */
  as: (username: string) => Ctx;
  call: <T = any>(username: string, method: string, input?: unknown) => T;
  setNow: (iso: string) => void;
}

export function makeEnv(opts: { edition?: 'basic' | 'inventory' | 'full'; seed?: boolean; start?: string } = {}): TestEnv {
  let current = new Date(opts.start ?? '2026-03-10T09:00:00.000Z');
  const app = createApp({ now: () => current });
  if (opts.seed !== false) seedDemo(app, { edition: opts.edition ?? 'full' });
  const as = (username: string) => {
    const u = app.db.prepare('SELECT id, username, name, role FROM users WHERE username = ?').get(username) as {
      id: number;
      username: string;
      name: string;
      role: Role;
    };
    return new Ctx(app, u);
  };
  return {
    app,
    as,
    call: (username, method, input) => dispatch(as(username), method, input) as any,
    setNow: (iso) => {
      current = new Date(iso);
    },
  };
}
