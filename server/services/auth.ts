import crypto from 'node:crypto';
import { define, z } from '../api';
import { Ctx, type User } from '../ctx';
import { AppError } from '../errors';
import { ROLES, ROLE_PERMISSIONS, type Role } from '../../shared/permissions';

const SESSION_HOURS = 12;
const MAX_FAILS = 5;
const LOCK_MINUTES = 1;

const scryptN = () => (process.env.VITEST ? 1024 : 16384);

export function hashPin(pin: string): string {
  const salt = crypto.randomBytes(16);
  const n = scryptN();
  const h = crypto.scryptSync(pin, salt, 32, { N: n });
  return `${n}:${salt.toString('hex')}:${h.toString('hex')}`;
}

export function verifyPin(pin: string, stored: string): boolean {
  const [n, salt, hash] = stored.split(':');
  const h = crypto.scryptSync(pin, Buffer.from(salt, 'hex'), 32, { N: Number(n) });
  return crypto.timingSafeEqual(h, Buffer.from(hash, 'hex'));
}

const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

export function userFromToken(ctx: Ctx, token: string): User | null {
  const row = ctx.db
    .prepare(
      `SELECT u.id, u.username, u.name, u.role, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND u.active = 1`,
    )
    .get(sha(token)) as (User & { expires_at: string }) | undefined;
  if (!row || row.expires_at < ctx.ts()) return null;
  return { id: row.id, username: row.username, name: row.name, role: row.role };
}

export function login(ctx: Ctx, username: string, pin: string): { token: string; user: User } {
  const row = ctx.db.prepare('SELECT * FROM users WHERE username = ?').get(username) as any;
  const bad = () => new AppError('UNAUTHENTICATED', 'Invalid username or PIN.');
  if (!row || !row.active) throw bad();
  if (row.locked_until && row.locked_until > ctx.ts())
    throw new AppError('UNAUTHENTICATED', 'Account temporarily locked after repeated failures. Try again shortly.');
  if (!verifyPin(pin, row.pin_hash)) {
    const fails = row.failed_attempts + 1;
    const lock = fails >= MAX_FAILS ? new Date(ctx.app.now().getTime() + LOCK_MINUTES * 60000).toISOString() : null;
    ctx.db.prepare('UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?').run(lock ? 0 : fails, lock, row.id);
    ctx.audit('auth.login_failed', 'user', row.id);
    throw bad();
  }
  ctx.db.prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?').run(row.id);
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(ctx.app.now().getTime() + SESSION_HOURS * 3600000).toISOString();
  ctx.db
    .prepare('INSERT INTO sessions(token_hash, user_id, created_at, expires_at) VALUES (?,?,?,?)')
    .run(sha(token), row.id, ctx.ts(), expires);
  const user: User = { id: row.id, username: row.username, name: row.name, role: row.role };
  new Ctx(ctx.app, user).audit('auth.login', 'user', row.id);
  return { token, user };
}

export function logout(ctx: Ctx, token: string): void {
  ctx.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(token));
}

/** Verify a manager's PIN for a sensitive operation; returns the approver. Audited. */
export function verifyApprover(ctx: Ctx, username: string, pin: string, action: string): User {
  const row = ctx.db.prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(username) as any;
  const role = row?.role as Role | undefined;
  if (!row || !role || !ROLE_PERMISSIONS[role].includes('pos.approve') || !verifyPin(pin, row.pin_hash)) {
    ctx.audit('approval.denied', 'user', row?.id ?? username, { action });
    throw new AppError('APPROVAL_REQUIRED', 'Manager approval failed: invalid approver or PIN.');
  }
  ctx.audit('approval.granted', 'user', row.id, { action });
  return { id: row.id, username: row.username, name: row.name, role };
}

define('auth.me', {
  module: 'core',
  perm: 'catalog.view',
  handler: (ctx) => ({ user: ctx.user, permissions: ROLE_PERMISSIONS[ctx.user!.role], modules: [...ctx.enabledModules()] }),
});

// --- user management (core: essential users & roles) ---
define('users.list', {
  module: 'core',
  perm: 'users.manage',
  handler: (ctx) => ctx.db.prepare('SELECT id, username, name, role, active, created_at FROM users ORDER BY id').all(),
});

define('users.save', {
  module: 'core',
  perm: 'users.manage',
  input: z.object({
    id: z.number().int().optional(),
    username: z
      .string()
      .min(2)
      .max(40)
      .regex(/^[a-z0-9._-]+$/),
    name: z.string().min(1).max(80),
    role: z.enum(ROLES),
    pin: z
      .string()
      .regex(/^\d{4,8}$/, 'PIN must be 4–8 digits')
      .optional(),
    active: z.boolean().default(true),
  }),
  handler: (ctx, i) =>
    ctx.tx(() => {
      const actor = ctx.actor();
      // Only the owner may create or modify owner/administrator accounts.
      if ((i.role === 'owner' || i.role === 'administrator') && actor.role !== 'owner') {
        throw new AppError('FORBIDDEN', 'Only the owner can assign owner/administrator roles.');
      }
      if (i.id) {
        const old = ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(i.id) as any;
        if (!old) throw new AppError('NOT_FOUND', 'User not found.');
        if ((old.role === 'owner' || old.role === 'administrator') && actor.role !== 'owner')
          throw new AppError('FORBIDDEN', 'Only the owner can modify this account.');
        if (old.role === 'owner' && (i.role !== 'owner' || !i.active)) {
          const owners = ctx.db.prepare("SELECT COUNT(*) c FROM users WHERE role='owner' AND active=1 AND id<>?").get(i.id) as {
            c: number;
          };
          if (owners.c === 0) throw new AppError('CONFLICT', 'At least one active owner is required.');
        }
        ctx.db
          .prepare('UPDATE users SET username=?, name=?, role=?, active=? WHERE id=?')
          .run(i.username, i.name, i.role, i.active ? 1 : 0, i.id);
        if (i.pin) ctx.db.prepare('UPDATE users SET pin_hash=? WHERE id=?').run(hashPin(i.pin), i.id);
        if (old.role !== i.role) ctx.audit('permission.role_changed', 'user', i.id, { from: old.role, to: i.role });
        if (!i.active && old.active) ctx.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(i.id);
        if (i.pin) ctx.audit('user.pin_reset', 'user', i.id);
        return { id: i.id };
      }
      if (!i.pin) throw new AppError('VALIDATION', 'A PIN is required for new users.');
      const dup = ctx.db.prepare('SELECT 1 FROM users WHERE username = ?').get(i.username);
      if (dup) throw new AppError('CONFLICT', 'Username already exists.');
      const r = ctx.db
        .prepare('INSERT INTO users(username, name, role, pin_hash, active, created_at) VALUES (?,?,?,?,?,?)')
        .run(i.username, i.name, i.role, hashPin(i.pin), i.active ? 1 : 0, ctx.ts());
      ctx.audit('user.created', 'user', Number(r.lastInsertRowid), { role: i.role });
      return { id: Number(r.lastInsertRowid) };
    }),
});
