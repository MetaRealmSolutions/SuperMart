import { describe, expect, it } from 'vitest';
import { makeEnv } from './helpers';
import { handleRequest } from '../app';
import { Ctx } from '../ctx';
import { EDITIONS, validateEnabledSet } from '../../shared/modules';
import { allocate, formatMoney, lineAmount, parseMoney, roundDiv, taxFromInclusive } from '../../shared/money';
import { runMigrations, MIGRATIONS } from '../db';
import { resetDemo } from '../seed';

describe('money', () => {
  it('rounds half away from zero with integers only', () => {
    expect(roundDiv(5, 2)).toBe(3);
    expect(roundDiv(-5, 2)).toBe(-3);
    expect(roundDiv(4, 2)).toBe(2);
  });
  it('computes line amounts and inclusive tax without float drift', () => {
    expect(lineAmount(19999, 3000)).toBe(59997);
    expect(lineAmount(6000, 1250)).toBe(7500); // 1.25kg @ 60.00
    expect(taxFromInclusive(11800, 1800)).toBe(1800);
    expect(taxFromInclusive(10500, 500)).toBe(500);
  });
  it('allocates exactly', () => {
    const parts = allocate(100, [1, 1, 1]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(100);
  });
  it('formats and parses', () => {
    expect(formatMoney(123456)).toBe('₹1,234.56');
    expect(parseMoney('12.5')).toBe(1250);
    expect(parseMoney('abc')).toBeNull();
  });
});

describe('module registry', () => {
  it('rejects sets missing core or dependencies', () => {
    expect(validateEnabledSet(['pricing']).length).toBeGreaterThan(0);
    expect(validateEnabledSet(['core', 'store_ops'])[0]).toMatch(/requires "warehouse"/);
    for (const e of Object.values(EDITIONS)) expect(validateEnabledSet(e.modules)).toEqual([]);
  });
});

describe('entitlements', () => {
  it('Basic Mart enables only core', () => {
    const env = makeEnv({ edition: 'basic' });
    const mods = env
      .call<any[]>('manager', 'modules.list')
      .filter((m) => m.enabled)
      .map((m) => m.id);
    expect(mods).toEqual(['core']);
  });
  it('refuses to disable a module another enabled module depends on', () => {
    const env = makeEnv({ edition: 'full' });
    const enabled = env
      .call<any[]>('owner', 'modules.list')
      .filter((m) => m.enabled && m.id !== 'warehouse')
      .map((m) => m.id);
    expect(() => env.call('owner', 'modules.set', { enabled })).toThrow(/requires "warehouse"/);
  });
  it('only modules.manage roles can change entitlements', () => {
    const env = makeEnv();
    expect(() => env.call('manager', 'modules.set', { enabled: ['core'] })).toThrow(/lacks permission/);
  });
});

describe('auth', () => {
  it('logs in, resolves the token, rejects bad PINs and locks out', () => {
    const env = makeEnv();
    const bad = () => handleRequest(env.app, null, 'auth.login', { username: 'cashier', pin: '0000' });
    expect(() => handleRequest(env.app, null, 'auth.me', {})).toThrow(/Sign in/);
    for (let i = 0; i < 5; i++) expect(bad).toThrow(/Invalid/);
    expect(() => handleRequest(env.app, null, 'auth.login', { username: 'cashier', pin: '7777' })).toThrow(/locked/);
    const ok: any = handleRequest(env.app, null, 'auth.login', { username: 'manager', pin: '3333' });
    const me: any = handleRequest(env.app, ok.token, 'auth.me', {});
    expect(me.user.role).toBe('manager');
    handleRequest(env.app, ok.token, 'auth.logout', {});
    expect(() => handleRequest(env.app, ok.token, 'auth.me', {})).toThrow(/Sign in/);
  });
  it('only the owner can mint owner/administrator accounts', () => {
    const env = makeEnv();
    expect(() => env.call('admin', 'users.save', { username: 'x1', name: 'X', role: 'owner', pin: '1234' })).toThrow(/Only the owner/);
    expect(env.call('admin', 'users.save', { username: 'x2', name: 'X', role: 'cashier', pin: '1234' })).toHaveProperty('id');
  });
});

describe('migrations & demo reset', () => {
  it('migrations are idempotent', () => {
    const env = makeEnv({ seed: false });
    expect(runMigrations(env.app.db, MIGRATIONS)).toEqual([]);
  });
  it('demo reset restores the documented baseline', () => {
    const env = makeEnv();
    const count = (t: string) => (env.app.db.prepare(`SELECT COUNT(*) c FROM ${t}`).get() as any).c;
    const baseline = { products: count('products'), users: count('users'), stock: count('stock') };
    env.app.db.prepare('UPDATE products SET price_minor = 1 WHERE id = 1').run();
    env.app.db.prepare('DELETE FROM stock').run();
    resetDemo(env.app, { edition: 'full' });
    expect({ products: count('products'), users: count('users'), stock: count('stock') }).toEqual(baseline);
    expect((env.app.db.prepare('SELECT price_minor p FROM products WHERE id = 1').get() as any).p).toBeGreaterThan(1);
  });
  it('reset via API requires permission and explicit confirmation', () => {
    const env = makeEnv();
    expect(() => env.call('cashier', 'system.resetDemo', { confirm: 'RESET' })).toThrow(/lacks permission/);
    expect(() => env.call('owner', 'system.resetDemo', { confirm: 'yes' })).toThrow();
    expect(env.call('owner', 'system.resetDemo', { confirm: 'RESET', edition: 'basic' })).toMatchObject({ ok: true });
    expect(new Ctx(env.app, null).enabledModules().size).toBe(1);
  });
});
