import { loadConfig, loadDotEnv } from '../config/env.js';
import { restoreBackup } from '../database/backup.js';

/**
 * Restores a backup. The app must be stopped: the restore refuses while anything has the
 * target open. The backup is verified first, and the file it replaces is moved aside with
 * its WAL files, never deleted, so moving it back undoes the restore.
 *
 * Usage: npm run db:restore -- <backup-file> --to <database-file> [--replace]
 *
 * --to is required, so a restore over the live database is always typed out on purpose.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const toIndex = args.indexOf('--to');
  const target = toIndex >= 0 ? args[toIndex + 1] : undefined;
  const replace = args.includes('--replace');
  const backup = args.find((arg, i) => !arg.startsWith('--') && i !== toIndex + 1);
  if (!backup || !target) {
    console.error('Usage: npm run db:restore -- <backup-file> --to <database-file> [--replace]');
    process.exit(2);
  }
  loadDotEnv();
  const config = loadConfig();
  const result = await restoreBackup({ backup, target, replace, migrationsDir: config.migrationsDir });
  console.log(`Restored ${backup} to ${result.target}.`);
  console.log(`Checked: integrity ok, row counts match the backup in all ${Object.keys(result.verified.report.tables).length} tables.`);
  if (result.movedAside.length > 0) {
    console.log('The files it replaced were moved aside, not deleted. To undo, stop the app and move them back:');
    for (const file of result.movedAside) console.log(`  ${file}`);
  }
  if (result.verified.compatibility && result.verified.compatibility.pending.length > 0) {
    console.log(`On its next start the app will apply: ${result.verified.compatibility.pending.join(', ')}.`);
  }
}

main().catch((error: unknown) => {
  console.error('Restore failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
