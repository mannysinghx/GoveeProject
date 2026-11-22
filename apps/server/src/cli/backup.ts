import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { resolveAccountFile } from '../auth/control.js';
import { loadConfig, loadDotEnv } from '../config/env.js';
import { controlBackupPathFor, createVerifiedBackup, type BackupManifest } from '../database/backup.js';

/**
 * Makes a consistent copy of the database using SQLite's online backup API, so it is safe
 * while the app is running. Copying the file directly is not, because recent writes may
 * still be in the WAL file.
 *
 * Both databases are copied: the owner's account file, and the control database (users,
 * sessions, encrypted keys) next to it as <name>.control.sqlite, when it exists. Each copy is
 * checked before it is kept, and gets a manifest (<file>.manifest.json) with its SHA-256,
 * size, migrations and row counts, so it can be verified again later with `npm run db:verify`.
 *
 * Each member's account file, if there are any, is copied the same way into a folder beside
 * the backup, <name>.accounts/, under its own file name.
 *
 * Usage: npm run db:backup -- [destination-file]
 */
function summary(label: string, file: string, manifest: BackupManifest): string {
  const rows = Object.values(manifest.tables).reduce((sum, n) => sum + n, 0);
  return (
    `${label} written to ${file}\n` +
    `Checked: integrity ok, ${Object.keys(manifest.tables).length} tables, ${rows} rows, ` +
    `latest migration ${manifest.latestMigration ?? 'none'}, ${manifest.bytes} bytes, sha256 ${manifest.sha256}`
  );
}

async function main(): Promise<void> {
  loadDotEnv();
  const config = loadConfig();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const destination = path.resolve(
    process.argv[2] ?? path.join(path.dirname(config.databasePath), 'backups', `govee-light-manager-${stamp}.sqlite`),
  );
  const account = await createVerifiedBackup(config.databasePath, destination);
  console.log(summary('Backup', account.file, account.manifest));
  console.log(`Manifest written to ${account.manifestPath}`);

  if (config.controlDatabasePath !== ':memory:' && fs.existsSync(config.controlDatabasePath)) {
    const control = await createVerifiedBackup(config.controlDatabasePath, controlBackupPathFor(destination));
    console.log(summary('Control database backup', control.file, control.manifest));
    console.log(`Manifest written to ${control.manifestPath}`);

    const reader = new Database(config.controlDatabasePath, { readonly: true, fileMustExist: true });
    const members = reader.prepare("SELECT id, account_file FROM users WHERE role = 'member' ORDER BY id").all() as {
      id: number;
      account_file: string;
    }[];
    reader.close();
    const membersDir = `${destination.replace(/\.sqlite$/, '')}.accounts`;
    let copied = 0;
    for (const member of members) {
      const source = resolveAccountFile(config, member.account_file);
      // A member whose file was never made (it is made when first loaded) has nothing to copy.
      if (!fs.existsSync(source)) continue;
      const result = await createVerifiedBackup(source, path.join(membersDir, path.basename(source)));
      copied += 1;
      console.log(summary(`Account ${member.id} backup`, result.file, result.manifest));
    }
    console.log(members.length === 0 ? 'No member accounts.' : `Backed up ${copied} of ${members.length} member accounts to ${membersDir}`);
  } else {
    console.log('No control database yet, so only the account file was backed up.');
  }
}

main().catch((error: unknown) => {
  console.error('Backup failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
