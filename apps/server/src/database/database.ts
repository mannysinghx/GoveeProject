import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { Logger } from 'pino';

export type Db = Database.Database;

export function openDatabase(databasePath: string): Db {
  if (databasePath !== ':memory:') {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  }
  const db = new Database(databasePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');
  return db;
}

export interface MigrationResult {
  applied: string[];
  current: string | null;
}

/**
 * Applies pending NNN_name.sql files in order, each in its own transaction.
 * A migration that changed after being applied stops startup, because the
 * database no longer matches what the code expects.
 */
export function runMigrations(db: Db, migrationsDir: string, logger?: Logger): MigrationResult {
  if (!fs.existsSync(migrationsDir)) {
    throw new Error(`Migrations directory not found: ${migrationsDir}`);
  }
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    checksum TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`);

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => /^\d+_.+\.sql$/.test(f))
    .sort();

  const appliedRows = db.prepare('SELECT name, checksum FROM schema_migrations').all() as {
    name: string;
    checksum: string;
  }[];
  const appliedByName = new Map(appliedRows.map((r) => [r.name, r.checksum]));
  const insert = db.prepare('INSERT INTO schema_migrations (name, checksum, applied_at) VALUES (?, ?, ?)');

  const applied: string[] = [];
  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    const checksum = crypto.createHash('sha256').update(sql).digest('hex');
    const previous = appliedByName.get(file);
    if (previous !== undefined) {
      if (previous !== checksum) {
        throw new Error(`Migration ${file} changed after it was applied. Restore the original file.`);
      }
      continue;
    }
    db.transaction(() => {
      db.exec(sql);
      insert.run(file, checksum, new Date().toISOString());
    })();
    applied.push(file);
    logger?.info({ migration: file }, 'Applied database migration');
  }

  const current = files.at(-1) ?? null;
  logger?.info({ applied: applied.length, current }, 'Database migrations complete');
  return { applied, current };
}

export function currentSchemaVersion(db: Db): string | null {
  const row = db.prepare('SELECT name FROM schema_migrations ORDER BY name DESC LIMIT 1').get() as
    | { name: string }
    | undefined;
  return row?.name ?? null;
}

export function checkDatabase(db: Db): boolean {
  try {
    const row = db.prepare('SELECT 1 AS ok').get() as { ok: number } | undefined;
    return row?.ok === 1;
  } catch {
    return false;
  }
}
