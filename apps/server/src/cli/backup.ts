import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { loadConfig, loadDotEnv } from '../config/env.js';

/**
 * Makes a consistent copy of the database using SQLite's online backup API, so it
 * is safe while the app is running. Copying the file directly is not, because
 * recent writes may still be in the WAL file.
 *
 * Usage: npm run db:backup -- [destination-file]
 */
async function main(): Promise<void> {
  loadDotEnv();
  const config = loadConfig();
  if (!fs.existsSync(config.databasePath)) {
    console.error(`No database found at ${config.databasePath}.`);
    process.exit(1);
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const destination = path.resolve(
    process.argv[2] ?? path.join(path.dirname(config.databasePath), 'backups', `govee-light-manager-${stamp}.sqlite`),
  );
  fs.mkdirSync(path.dirname(destination), { recursive: true });

  const db = new Database(config.databasePath, { readonly: true });
  await db.backup(destination);
  db.close();
  console.log(`Backup written to ${destination}`);
}

main().catch((error: unknown) => {
  console.error('Backup failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
