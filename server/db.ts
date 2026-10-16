import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import m001 from './migrations/001_core';
import m002 from './migrations/002_business_date';

export type DB = Database.Database;

export const MIGRATIONS: { id: string; sql: string }[] = [
  { id: '001_core', sql: m001 },
  { id: '002_business_date', sql: m002 },
];

export function runMigrations(db: DB, list = MIGRATIONS): string[] {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const done = new Set(
    db
      .prepare('SELECT id FROM schema_migrations')
      .all()
      .map((r: any) => r.id),
  );
  const applied: string[] = [];
  for (const m of list) {
    if (done.has(m.id)) continue;
    db.transaction(() => {
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_migrations(id, applied_at) VALUES (?, ?)').run(m.id, new Date().toISOString());
    })();
    applied.push(m.id);
  }
  return applied;
}

export function openDb(file: string): DB {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  runMigrations(db);
  return db;
}
