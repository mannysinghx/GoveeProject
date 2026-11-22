import path from 'node:path';
import { loadConfig, loadDotEnv } from '../config/env.js';
import { createVerifiedBackup } from '../database/backup.js';

/**
 * Makes a consistent copy of the database using SQLite's online backup API, so it is safe
 * while the app is running. Copying the file directly is not, because recent writes may
 * still be in the WAL file.
 *
 * The copy is checked before it is kept, and a manifest is written next to it
 * (<file>.manifest.json) with its SHA-256, size, migrations and row counts, so it can be
 * verified again later, after it has been moved, with `npm run db:verify`.
 *
 * Usage: npm run db:backup -- [destination-file]
 */
async function main(): Promise<void> {
  loadDotEnv();
  const config = loadConfig();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const destination = path.resolve(
    process.argv[2] ?? path.join(path.dirname(config.databasePath), 'backups', `govee-light-manager-${stamp}.sqlite`),
  );
  const { file, manifestPath, manifest } = await createVerifiedBackup(config.databasePath, destination);
  const rows = Object.values(manifest.tables).reduce((sum, n) => sum + n, 0);
  console.log(`Backup written to ${file}`);
  console.log(`Manifest written to ${manifestPath}`);
  console.log(
    `Checked: integrity ok, ${Object.keys(manifest.tables).length} tables, ${rows} rows, ` +
      `latest migration ${manifest.latestMigration ?? 'none'}, ${manifest.bytes} bytes, sha256 ${manifest.sha256}`,
  );
}

main().catch((error: unknown) => {
  console.error('Backup failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
