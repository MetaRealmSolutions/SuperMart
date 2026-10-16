// Boots the real server (fresh temp DB, built web assets) and verifies login + a protected call over HTTP.
// Usage: node scripts/smoke.mjs   (run `npm run build:web` first)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const port = 4100 + Math.floor(Math.random() * 500);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'supermart-smoke-'));
const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
  env: { ...process.env, PORT: String(port), SUPERMART_DB: path.join(dir, 'smoke.db') },
  stdio: ['ignore', 'pipe', 'inherit'],
});

const rpc = async (method, input, token) => {
  const r = await fetch(`http://127.0.0.1:${port}/api/rpc`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ method, input }),
  });
  return r.json();
};

async function waitUp() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/`);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('server did not start');
}

let code = 0;
try {
  await waitUp();
  const login = await rpc('auth.login', { username: 'manager', pin: '3333' });
  if (!login.ok) throw new Error('login failed');
  const mods = await rpc('modules.list', {}, login.result.token);
  if (!mods.ok || !mods.result.some((m) => m.id === 'core' && m.enabled)) throw new Error('modules.list failed');
  const anon = await rpc('modules.list', {});
  if (anon.ok) throw new Error('unauthenticated call unexpectedly succeeded');
  console.log('smoke test OK on port', port);
} catch (e) {
  console.error('smoke test FAILED:', e.message);
  code = 1;
} finally {
  child.kill();
  await new Promise((r) => (child.exitCode !== null ? r() : child.once('exit', r)));
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* temp dir cleanup is best-effort (Windows may still hold the SQLite file) */
  }
  process.exit(code);
}
