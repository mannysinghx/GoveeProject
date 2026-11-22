import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { z } from 'zod';

/**
 * Backups that prove themselves. A backup is a SQLite online-backup copy, which is safe while
 * the app runs, plus a manifest next to it: its hash, size, integrity result, migrations and
 * row counts. A restore checks all of that before touching anything, and never deletes the
 * file it replaces: it moves it aside.
 */

const MIGRATION_FILE = /^\d+_.+\.sql$/;

export interface MigrationEntry {
  name: string;
  checksum: string;
}

/** What a database file holds, read without changing it. */
export interface DatabaseReport {
  /** "ok", or SQLite's list of problems. */
  integrity: string;
  foreignKeyProblems: number;
  migrations: MigrationEntry[];
  latestMigration: string | null;
  /** Rows in every table, by name. */
  tables: Record<string, number>;
}

const manifestSchema = z.object({
  format: z.literal(1),
  createdAt: z.string(),
  file: z.string(),
  bytes: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  integrity: z.string(),
  foreignKeyProblems: z.number().int().nonnegative(),
  latestMigration: z.string().nullable(),
  migrations: z.array(z.object({ name: z.string(), checksum: z.string() })),
  tables: z.record(z.string(), z.number().int().nonnegative()),
});
export type BackupManifest = z.infer<typeof manifestSchema>;

export class BackupError extends Error {
  constructor(
    message: string,
    readonly problems: string[] = [],
  ) {
    super(problems.length > 0 ? `${message} ${problems.join(' ')}` : message);
    this.name = 'BackupError';
  }
}

export function manifestPathFor(file: string): string {
  return `${file}.manifest.json`;
}

export async function sha256File(file: string): Promise<string> {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

const quoteIdentifier = (name: string) => `"${name.replace(/"/g, '""')}"`;

/**
 * A fresh copy keeps the live database's WAL mode in its header, so opening it read-only would
 * leave -wal and -shm files beside it. Switching the copy, never the live file, to rollback mode
 * makes it one self-contained file. Only that header byte changes. The app switches a restored
 * file back to WAL when it opens it.
 */
function makeStandalone(copy: string): void {
  const db = new Database(copy, { fileMustExist: true });
  try {
    db.pragma('journal_mode = DELETE');
  } finally {
    db.close();
  }
}

/** Reads a database file without writing to it. */
export function inspectDatabase(file: string): DatabaseReport {
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    const integrity = (db.pragma('integrity_check') as { integrity_check: string }[])
      .map((row) => row.integrity_check)
      .join('; ');
    const foreignKeyProblems = (db.pragma('foreign_key_check') as unknown[]).length;
    const names = (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as {
        name: string;
      }[]
    ).map((row) => row.name);
    const tables: Record<string, number> = {};
    for (const name of names) {
      tables[name] = (db.prepare(`SELECT COUNT(*) AS n FROM ${quoteIdentifier(name)}`).get() as { n: number }).n;
    }
    const migrations = names.includes('schema_migrations')
      ? (db.prepare('SELECT name, checksum FROM schema_migrations ORDER BY name').all() as MigrationEntry[])
      : [];
    return { integrity, foreignKeyProblems, migrations, latestMigration: migrations.at(-1)?.name ?? null, tables };
  } finally {
    db.close();
  }
}

/** The migration files this build of the app has, with the checksums it would record. */
export function migrationsOnDisk(migrationsDir: string): MigrationEntry[] {
  return fs
    .readdirSync(migrationsDir)
    .filter((f) => MIGRATION_FILE.test(f))
    .sort()
    .map((name) => ({
      name,
      checksum: crypto.createHash('sha256').update(fs.readFileSync(path.join(migrationsDir, name), 'utf8')).digest('hex'),
    }));
}

export interface Compatibility {
  /** Applied in the backup but unknown to this build: the backup is newer than the code. */
  unknown: string[];
  /** Applied in the backup with different contents: the app would refuse to start. */
  changed: string[];
  /** In this build but not yet in the backup. These run, as usual, the next time the app starts. */
  pending: string[];
}

export function compareMigrations(applied: MigrationEntry[], available: MigrationEntry[]): Compatibility {
  const byName = new Map(available.map((m) => [m.name, m.checksum]));
  const appliedNames = new Set(applied.map((m) => m.name));
  return {
    unknown: applied.filter((m) => !byName.has(m.name)).map((m) => m.name),
    changed: applied.filter((m) => byName.has(m.name) && byName.get(m.name) !== m.checksum).map((m) => m.name),
    pending: available.filter((m) => !appliedNames.has(m.name)).map((m) => m.name),
  };
}

export function readManifest(file: string): BackupManifest | null {
  const manifestPath = manifestPathFor(file);
  if (!fs.existsSync(manifestPath)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch {
    throw new BackupError(`The manifest ${manifestPath} is not valid JSON.`);
  }
  const parsed = manifestSchema.safeParse(raw);
  if (!parsed.success) throw new BackupError(`The manifest ${manifestPath} is not in the expected form.`);
  return parsed.data;
}

export interface VerifyResult {
  report: DatabaseReport;
  bytes: number;
  sha256: string;
  manifest: BackupManifest | null;
  compatibility: Compatibility | null;
  /** Empty when the file can be trusted. */
  problems: string[];
}

/**
 * Checks a backup. With a manifest, the hash, size and row counts must all match it. Without
 * one, the file must still pass SQLite's own checks. With a migrations folder, it must be a
 * file this build of the app can open.
 */
export async function verifyBackup(file: string, options: { migrationsDir?: string } = {}): Promise<VerifyResult> {
  if (!fs.existsSync(file)) throw new BackupError(`No file at ${file}.`);
  const manifest = readManifest(file);
  const bytes = fs.statSync(file).size;
  const sha256 = await sha256File(file);
  const problems: string[] = [];

  if (manifest) {
    if (manifest.sha256 !== sha256) problems.push('Its SHA-256 does not match the manifest, so the file changed or was damaged in transit.');
    if (manifest.bytes !== bytes) problems.push(`It is ${bytes} bytes, but the manifest says ${manifest.bytes}.`);
  }

  let report: DatabaseReport;
  try {
    report = inspectDatabase(file);
  } catch (error) {
    throw new BackupError(`${file} could not be read as a SQLite database: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (report.integrity !== 'ok') problems.push(`SQLite's integrity check failed: ${report.integrity.slice(0, 300)}`);
  if (report.foreignKeyProblems > 0) problems.push(`${report.foreignKeyProblems} rows point at rows that do not exist.`);

  if (manifest && problems.length === 0) {
    const names = new Set([...Object.keys(manifest.tables), ...Object.keys(report.tables)]);
    for (const name of [...names].sort()) {
      const expected = manifest.tables[name];
      const actual = report.tables[name];
      if (expected !== actual) problems.push(`Table ${name} has ${actual ?? 'no'} rows, but the manifest says ${expected ?? 'none'}.`);
    }
  }

  let compatibility: Compatibility | null = null;
  if (options.migrationsDir) {
    compatibility = compareMigrations(report.migrations, migrationsOnDisk(options.migrationsDir));
    if (compatibility.unknown.length > 0) {
      problems.push(`It was made by a newer version of the app (unknown migrations: ${compatibility.unknown.join(', ')}).`);
    }
    if (compatibility.changed.length > 0) {
      problems.push(`Migrations differ from this version of the app: ${compatibility.changed.join(', ')}. The app would refuse to start.`);
    }
  }

  return { report, bytes, sha256, manifest, compatibility, problems };
}

function sameFile(a: string, b: string): boolean {
  const resolve = (p: string) => {
    try {
      return fs.realpathSync(p);
    } catch {
      return path.resolve(p);
    }
  };
  return resolve(a) === resolve(b);
}

/**
 * Makes a backup, checks it, and writes its manifest. The copy is written under a temporary
 * name and only renamed once it has passed, so a half-written or failed backup never sits at
 * the name someone will later trust. Never overwrites an existing file.
 */
export async function createVerifiedBackup(
  source: string,
  destination: string,
  now: () => Date = () => new Date(),
): Promise<{ file: string; manifestPath: string; manifest: BackupManifest }> {
  if (!fs.existsSync(source)) throw new BackupError(`No database found at ${source}.`);
  const file = path.resolve(destination);
  if (sameFile(source, file) || [`${source}-wal`, `${source}-shm`].some((p) => sameFile(p, file))) {
    throw new BackupError('The backup cannot be written over the database itself.');
  }
  const manifestPath = manifestPathFor(file);
  for (const existing of [file, manifestPath]) {
    if (fs.existsSync(existing)) throw new BackupError(`${existing} already exists. Choose a new name; nothing was overwritten.`);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });

  const partial = `${file}.partial`;
  fs.rmSync(partial, { force: true });
  const db = new Database(source, { readonly: true, fileMustExist: true });
  try {
    await db.backup(partial);
  } finally {
    db.close();
  }

  try {
    makeStandalone(partial);
    const report = inspectDatabase(partial);
    if (report.integrity !== 'ok') throw new BackupError(`The copy failed SQLite's integrity check: ${report.integrity.slice(0, 300)}`);
    if (report.foreignKeyProblems > 0) {
      throw new BackupError(`The copy has ${report.foreignKeyProblems} rows pointing at rows that do not exist.`);
    }
    const manifest: BackupManifest = {
      format: 1,
      createdAt: now().toISOString(),
      file: path.basename(file),
      bytes: fs.statSync(partial).size,
      sha256: await sha256File(partial),
      integrity: report.integrity,
      foreignKeyProblems: report.foreignKeyProblems,
      latestMigration: report.latestMigration,
      migrations: report.migrations,
      tables: report.tables,
    };
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
    fs.renameSync(partial, file);
    return { file, manifestPath, manifest };
  } catch (error) {
    fs.rmSync(partial, { force: true });
    throw error;
  }
}

/**
 * True when another connection has the database open. In WAL mode every open connection holds
 * a shared lock on the file, so asking for an exclusive one fails while the app is running.
 */
export function databaseInUse(file: string): boolean {
  if (!fs.existsSync(file)) return false;
  const db = new Database(file, { fileMustExist: true, timeout: 0 });
  try {
    db.pragma('locking_mode = EXCLUSIVE');
    // The first read after this takes the exclusive lock, or fails if anyone else holds the file.
    db.prepare('BEGIN EXCLUSIVE').run();
    db.prepare('COMMIT').run();
    return false;
  } catch (error) {
    if ((error as { code?: string }).code?.startsWith('SQLITE_BUSY')) return true;
    throw error;
  } finally {
    db.close();
  }
}

export interface RestoreResult {
  target: string;
  /** Where the files it replaced now are. Moving them back undoes the restore. */
  movedAside: string[];
  verified: VerifyResult;
}

/**
 * Restores a backup to `target`. The backup is verified first, against its manifest when it has
 * one, and must be openable by this build of the app. An existing target is only replaced when
 * asked, never while the app has it open, and is moved aside with its WAL files rather than
 * deleted. The restored file is checked against the backup afterwards.
 */
export async function restoreBackup(options: {
  backup: string;
  target: string;
  replace: boolean;
  migrationsDir: string;
  now?: () => Date;
}): Promise<RestoreResult> {
  const now = options.now ?? (() => new Date());
  const backup = path.resolve(options.backup);
  const target = path.resolve(options.target);
  if (sameFile(backup, target)) throw new BackupError('The backup and the target are the same file.');

  const verified = await verifyBackup(backup, { migrationsDir: options.migrationsDir });
  if (verified.problems.length > 0) throw new BackupError('The backup did not pass its checks, so nothing was restored.', verified.problems);

  const companions = [target, `${target}-wal`, `${target}-shm`];
  if (companions.some((p) => fs.existsSync(p))) {
    if (!options.replace) {
      throw new BackupError(`${target} already exists. Pass --replace to move it aside and restore over it.`);
    }
    if (fs.existsSync(target) && databaseInUse(target)) {
      throw new BackupError(`${target} is open in another process. Stop the app first; nothing was changed.`);
    }
  }
  // Listed after the check above, which opens the file and can tidy its WAL files away.
  const existing = companions.filter((p) => fs.existsSync(p));

  const stamp = now().toISOString().replace(/[:.]/g, '-');
  const movedAside: string[] = [];
  for (const file of existing) {
    const aside = file.replace(/(-wal|-shm)?$/, `.before-restore-${stamp}$1`);
    fs.renameSync(file, aside);
    movedAside.push(aside);
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });
  const partial = `${target}.restoring`;
  fs.rmSync(partial, { force: true });
  const source = new Database(backup, { readonly: true, fileMustExist: true });
  try {
    await source.backup(partial);
  } finally {
    source.close();
  }

  // An older backup may still be in WAL mode. Checking it read-only must not leave files behind.
  makeStandalone(partial);
  const restored = inspectDatabase(partial);
  const problems: string[] = [];
  if (restored.integrity !== 'ok') problems.push(`The restored file failed SQLite's integrity check: ${restored.integrity.slice(0, 300)}`);
  for (const [name, rows] of Object.entries(verified.report.tables)) {
    if (restored.tables[name] !== rows) problems.push(`Table ${name} has ${restored.tables[name] ?? 'no'} rows after restoring, not ${rows}.`);
  }
  if (problems.length > 0) {
    fs.rmSync(partial, { force: true });
    // Put back exactly what was there.
    for (const aside of movedAside) fs.renameSync(aside, aside.replace(`.before-restore-${stamp}`, ''));
    throw new BackupError('The restored copy did not match the backup, so the original was put back.', problems);
  }
  fs.renameSync(partial, target);
  return { target, movedAside, verified };
}
