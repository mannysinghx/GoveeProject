import fs from 'node:fs';
import readline from 'node:readline';
import { PASSWORD_MIN_LENGTH } from '@glm/shared';
import { hashPassword } from '../auth/auth-service.js';
import { loadConfig, loadDotEnv } from '../config/env.js';
import { openDatabase, runMigrations } from '../database/database.js';

/**
 * Offline account recovery. No email is involved: anyone who can run this already
 * controls the server and its database file. Every session is signed out.
 *
 * Interactive: npm run reset-password
 * Piped:       printf '%s\n' "$NEW_PASSWORD" | npm run reset-password
 */

async function readPassword(): Promise<string> {
  if (!process.stdin.isTTY) {
    const data = fs.readFileSync(0, 'utf8');
    return data.split('\n')[0]?.trim() ?? '';
  }
  // Interactive input is not echoed to the terminal.
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const originalWrite = (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput;
  const question = 'New owner password: ';
  (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s: string) => {
    if (s.includes(question)) originalWrite.call(rl, s);
  };
  const answer = await new Promise<string>((resolve) => rl.question(question, resolve));
  rl.close();
  process.stdout.write('\n');
  return answer.trim();
}

async function main(): Promise<void> {
  loadDotEnv();
  const config = loadConfig();
  const db = openDatabase(config.databasePath);
  runMigrations(db, config.migrationsDir);

  const owner = db.prepare('SELECT username FROM users WHERE id = 1').get() as { username: string } | undefined;
  if (!owner) {
    console.error('There is no owner account yet. Open the app and complete first-run setup instead.');
    process.exit(1);
  }

  const password = await readPassword();
  if (password.length < PASSWORD_MIN_LENGTH) {
    console.error(`The password must have at least ${PASSWORD_MIN_LENGTH} characters. Nothing was changed.`);
    process.exit(1);
  }

  const passwordHash = await hashPassword(password);
  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = 1').run(passwordHash, now);
    db.prepare('DELETE FROM sessions').run();
    db.prepare('DELETE FROM login_attempts').run();
    db.prepare(
      `INSERT INTO activity_events (created_at, event_type, outcome, message)
       VALUES (?, 'auth', 'warning', 'Owner password was reset from the server command line. All sessions were signed out.')`,
    ).run(now);
  })();
  db.close();
  console.log(`Password updated for "${owner.username}". All sessions were signed out.`);
}

main().catch((error: unknown) => {
  console.error('Password reset failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
