import './services';
import { dispatch } from './api';
import { Ctx, type App } from './ctx';
import { openDb } from './db';
import { AppError } from './errors';
import { login, logout, userFromToken } from './services/auth';
import { seedDemo } from './seed';

export interface CreateAppOptions {
  file?: string;
  now?: () => Date;
  /** Seed the demo baseline when the database has no users yet. */
  seedIfEmpty?: boolean;
  edition?: 'basic' | 'inventory' | 'full';
}

export function createApp(opts: CreateAppOptions = {}): App {
  const app: App = { db: openDb(opts.file ?? ':memory:'), now: opts.now ?? (() => new Date()) };
  if (opts.seedIfEmpty) {
    const n = (app.db.prepare('SELECT COUNT(*) c FROM users').get() as { c: number }).c;
    if (n === 0) seedDemo(app, { edition: opts.edition ?? 'full' });
  }
  return app;
}

/** Transport-independent entry point used by the HTTP server (token) and tests. */
export function handleRequest(app: App, token: string | null, method: string, input: unknown): unknown {
  const anon = new Ctx(app, null);
  if (method === 'auth.login') {
    const i = input as { username?: string; pin?: string };
    if (typeof i?.username !== 'string' || typeof i?.pin !== 'string') throw new AppError('VALIDATION', 'username and pin are required.');
    return login(anon, i.username, i.pin);
  }
  if (method === 'auth.logout') {
    if (token) logout(anon, token);
    return { ok: true };
  }
  const user = token ? userFromToken(anon, token) : null;
  return dispatch(new Ctx(app, user), method, input);
}

export { Ctx };
