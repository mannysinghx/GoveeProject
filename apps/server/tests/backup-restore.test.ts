import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DiscoveryResultDto } from '@glm/shared';
import { PROJECT_ROOT } from '../src/config/env.js';
import { openDatabase } from '../src/database/database.js';
import {
  BackupError,
  createVerifiedBackup,
  databaseInUse,
  inspectDatabase,
  manifestPathFor,
  readManifest,
  restoreBackup,
  sha256File,
  verifyBackup,
} from '../src/database/backup.js';
import { authedClient, createHarness, type Harness } from './support/harness.js';
import { mockBasicDevice, mockFullDevice } from './support/mock-govee.js';

const MIGRATIONS = path.join(PROJECT_ROOT, 'migrations');
const PASSWORD = 'correct-horse-battery';

/** A restore drill: real app, real file, backed up while running, restored, and run again. */
describe('backup and restore', () => {
  let dir: string;
  let live: string;
  const open: Harness[] = [];

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glm-backup-'));
    live = path.join(dir, 'live.sqlite');
  });

  afterEach(async () => {
    while (open.length > 0) await open.pop()!.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  async function startApp(databasePath: string): Promise<Harness> {
    const h = await createHarness({ env: { DATABASE_PATH: databasePath } });
    open.push(h);
    return h;
  }

  async function stopApp(h: Harness): Promise<void> {
    open.splice(open.indexOf(h), 1);
    await h.close();
  }

  /** The owner's kind of data: lights, a group, a preset, a schedule, a command and settings. */
  async function seededApp(): Promise<Harness> {
    const h = await startApp(live);
    h.mock.devices = [mockFullDevice(), mockBasicDevice()];
    const client = await authedClient(h.app, PASSWORD);
    const { devices } = (await client.post('/api/v1/devices/discover')).json() as DiscoveryResultDto;
    const light = devices[0]!;
    expect((await client.post('/api/v1/groups', { name: 'Front', deviceIds: devices.map((d) => d.id) })).statusCode).toBe(201);
    expect(
      (await client.post('/api/v1/presets', { name: 'Christmas', actions: [{ deviceId: null, action: { type: 'power', on: true } }] }))
        .statusCode,
    ).toBe(201);
    expect(
      (
        await client.post('/api/v1/schedules', {
          name: 'Porch on',
          timeZone: 'America/Los_Angeles',
          recurrence: { kind: 'daily', time: '18:00' },
          target: { type: 'device', deviceId: light.id },
          action: { type: 'power', on: true },
        })
      ).statusCode,
    ).toBe(201);
    expect((await client.post(`/api/v1/devices/${light.id}/power`, { on: true })).statusCode).toBeLessThan(300);
    expect((await client.patch('/api/v1/settings', { defaultTimeZone: 'America/Los_Angeles' })).statusCode).toBe(200);
    return h;
  }

  const nextRuns = (file: string) => {
    const db = new Database(file, { readonly: true });
    try {
      return db.prepare('SELECT id, name, next_run_at FROM schedules ORDER BY id').all();
    } finally {
      db.close();
    }
  };

  it('backs up the live database while the app is running, and the copy passes every check', async () => {
    await seededApp();
    const { file, manifestPath, manifest } = await createVerifiedBackup(live, path.join(dir, 'backups', 'one.sqlite'));

    expect(fs.existsSync(file)).toBe(true);
    expect(fs.existsSync(manifestPath)).toBe(true);
    expect(fs.existsSync(`${file}.partial`)).toBe(false);
    expect(manifest.integrity).toBe('ok');
    expect(manifest.sha256).toBe(await sha256File(file));
    expect(manifest.latestMigration).toBe(fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort().at(-1));
    expect(manifest.tables).toMatchObject({ users: 1, sessions: 1, groups: 1, schedules: 1 });
    expect(manifest.tables.devices).toBe(2);
    expect(manifest.tables.presets).toBeGreaterThanOrEqual(1);
    expect(manifest.tables.command_history).toBeGreaterThanOrEqual(1);

    const verified = await verifyBackup(file, { migrationsDir: MIGRATIONS });
    expect(verified.problems).toEqual([]);
    expect(verified.compatibility).toEqual({ unknown: [], changed: [], pending: [] });
    // One self-contained file and its manifest: no -wal, -shm or partial files, even after checking it.
    expect(fs.readdirSync(path.join(dir, 'backups')).sort()).toEqual(['one.sqlite', 'one.sqlite.manifest.json']);
  });

  it('restores a copy the app runs on: same rows, same next run times, and the same password signs in', async () => {
    const original = await seededApp();
    const { file, manifest } = await createVerifiedBackup(live, path.join(dir, 'one.sqlite'));
    const runsBefore = nextRuns(file);
    await stopApp(original);

    const restoredPath = path.join(dir, 'restored', 'db.sqlite');
    const result = await restoreBackup({ backup: file, target: restoredPath, replace: false, migrationsDir: MIGRATIONS });
    expect(result.movedAside).toEqual([]);
    expect(inspectDatabase(restoredPath).tables).toEqual(manifest.tables);
    expect(nextRuns(restoredPath)).toEqual(runsBefore);
    expect(fs.readdirSync(path.dirname(restoredPath))).toEqual(['db.sqlite']);

    const restored = await startApp(restoredPath);
    expect(restored.logs()).toContain('"applied":0');
    const login = await restored.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'owner', password: PASSWORD } });
    expect(login.statusCode).toBe(200);
    expect(restored.ctx.groups.list().map((g) => g.name)).toEqual(['Front']);
    expect(restored.ctx.schedules.list().map((s) => s.name)).toEqual(['Porch on']);
  });

  it('catches a copy damaged after it was made', async () => {
    await seededApp();
    const { file } = await createVerifiedBackup(live, path.join(dir, 'one.sqlite'));
    const bytes = fs.readFileSync(file);
    const middle = Math.floor(bytes.length / 2);
    bytes[middle] = bytes[middle]! ^ 0xff;
    fs.writeFileSync(file, bytes);

    const verified = await verifyBackup(file, { migrationsDir: MIGRATIONS });
    expect(verified.problems.join(' ')).toContain('SHA-256 does not match');
    await expect(restoreBackup({ backup: file, target: path.join(dir, 'x.sqlite'), replace: false, migrationsDir: MIGRATIONS })).rejects.toThrow(
      BackupError,
    );
    expect(fs.existsSync(path.join(dir, 'x.sqlite'))).toBe(false);
  });

  it('refuses a backup from a newer version of the app, and leaves the target alone', async () => {
    await seededApp();
    const { file } = await createVerifiedBackup(live, path.join(dir, 'one.sqlite'));
    // As if a later build had applied a migration this build does not have.
    fs.rmSync(manifestPathFor(file));
    const db = new Database(file);
    db.prepare("INSERT INTO schema_migrations (name, checksum, applied_at) VALUES ('999_future.sql', 'x', '2027-01-01')").run();
    db.close();

    const verified = await verifyBackup(file, { migrationsDir: MIGRATIONS });
    expect(verified.manifest).toBeNull();
    expect(verified.compatibility?.unknown).toEqual(['999_future.sql']);

    const target = path.join(dir, 'target.sqlite');
    fs.writeFileSync(target, 'untouched');
    await expect(restoreBackup({ backup: file, target, replace: true, migrationsDir: MIGRATIONS })).rejects.toThrow(/newer version/);
    expect(fs.readFileSync(target, 'utf8')).toBe('untouched');
  });

  it('never overwrites an existing backup, or the database itself', async () => {
    await seededApp();
    const first = await createVerifiedBackup(live, path.join(dir, 'one.sqlite'));
    const hash = await sha256File(first.file);

    await expect(createVerifiedBackup(live, first.file)).rejects.toThrow(/already exists/);
    await expect(createVerifiedBackup(live, live)).rejects.toThrow(/over the database itself/);
    await expect(createVerifiedBackup(live, `${live}-wal`)).rejects.toThrow(/over the database itself/);
    expect(await sha256File(first.file)).toBe(hash);
    expect(fs.readdirSync(dir).filter((f) => f.endsWith('.partial'))).toEqual([]);
  });

  it('will not restore over a database that the app has open', async () => {
    const h = await seededApp();
    const { file } = await createVerifiedBackup(live, path.join(dir, 'one.sqlite'));
    expect(databaseInUse(live)).toBe(true);
    const hash = await sha256File(live);

    await expect(restoreBackup({ backup: file, target: live, replace: true, migrationsDir: MIGRATIONS })).rejects.toThrow(/open in another process/);
    expect(await sha256File(live)).toBe(hash);
    expect(fs.readdirSync(dir).filter((f) => f.includes('before-restore'))).toEqual([]);

    await stopApp(h);
    expect(databaseInUse(live)).toBe(false);
  });

  it('needs --replace for an existing target, then moves it aside, so moving it back undoes the restore', async () => {
    const h = await seededApp();
    const { file, manifest } = await createVerifiedBackup(live, path.join(dir, 'one.sqlite'));
    await stopApp(h);

    // A different database where the backup is going.
    const target = path.join(dir, 'other.sqlite');
    const other = openDatabase(target);
    other.exec('CREATE TABLE marker (id INTEGER)');
    other.prepare('INSERT INTO marker VALUES (42)').run();
    other.close();
    const otherHash = await sha256File(target);

    await expect(restoreBackup({ backup: file, target, replace: false, migrationsDir: MIGRATIONS })).rejects.toThrow(/--replace/);
    expect(await sha256File(target)).toBe(otherHash);

    const result = await restoreBackup({ backup: file, target, replace: true, migrationsDir: MIGRATIONS, now: () => new Date('2026-11-21T10:00:00Z') });
    expect(result.movedAside).toEqual([path.join(dir, 'other.sqlite.before-restore-2026-11-21T10-00-00-000Z')]);
    expect(await sha256File(result.movedAside[0]!)).toBe(otherHash);
    expect(inspectDatabase(target).tables).toEqual(manifest.tables);
    expect(fs.existsSync(`${target}.restoring`)).toBe(false);
  });

  it('writes a manifest that reads back exactly', async () => {
    await seededApp();
    const { file, manifest } = await createVerifiedBackup(live, path.join(dir, 'one.sqlite'), () => new Date('2026-11-21T09:00:00Z'));
    expect(readManifest(file)).toEqual(manifest);
    expect(manifest.createdAt).toBe('2026-11-21T09:00:00.000Z');
    expect(manifest.file).toBe('one.sqlite');
    expect(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')).toBe(manifest.sha256);
  });
});
