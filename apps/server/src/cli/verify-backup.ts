import { loadConfig, loadDotEnv } from '../config/env.js';
import { verifyBackup } from '../database/backup.js';

/**
 * Checks a backup without changing it: its manifest (hash, size, row counts) when one is next
 * to it, SQLite's integrity and foreign key checks, and whether this version of the app can
 * open it. Exits 1 if anything is wrong.
 *
 * Usage: npm run db:verify -- <backup-file>
 */
async function main(): Promise<void> {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: npm run db:verify -- <backup-file>');
    process.exit(2);
  }
  loadDotEnv();
  const config = loadConfig();
  const result = await verifyBackup(file, { migrationsDir: config.migrationsDir });
  const rows = Object.values(result.report.tables).reduce((sum, n) => sum + n, 0);

  console.log(`File:        ${file}`);
  console.log(`Size:        ${result.bytes} bytes`);
  console.log(`SHA-256:     ${result.sha256}`);
  console.log(`Manifest:    ${result.manifest ? `found, made ${result.manifest.createdAt}` : 'none, so only SQLite checks apply'}`);
  console.log(`Integrity:   ${result.report.integrity === 'ok' ? 'ok' : 'FAILED'}`);
  console.log(`Foreign keys: ${result.report.foreignKeyProblems === 0 ? 'ok' : `${result.report.foreignKeyProblems} problems`}`);
  console.log(`Migrations:  latest ${result.report.latestMigration ?? 'none'}`);
  if (result.compatibility && result.compatibility.pending.length > 0) {
    console.log(`             would apply on next start: ${result.compatibility.pending.join(', ')}`);
  }
  console.log(`Tables:      ${Object.keys(result.report.tables).length}, ${rows} rows`);
  for (const [name, count] of Object.entries(result.report.tables)) console.log(`  ${name.padEnd(28)} ${count}`);

  if (result.problems.length > 0) {
    console.error('\nNOT SAFE TO USE:');
    for (const problem of result.problems) console.error(`- ${problem}`);
    process.exit(1);
  }
  console.log('\nVerified: safe to restore with this version of the app.');
}

main().catch((error: unknown) => {
  console.error('Verify failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
