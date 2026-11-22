import fs from 'node:fs';
import readline from 'node:readline';
import { PASSWORD_MIN_LENGTH } from '@glm/shared';
import { hashPassword, identifierHash } from '../auth/auth-service.js';
import { accountFileFor, cutoverOwner, LegacyOwnerMirror, openControlDatabase } from '../auth/control.js';
import { loadConfig, loadDotEnv } from '../config/env.js';
import { openDatabase, runMigrations } from '../database/database.js';
import { systemClock } from '../shared/clock.js';

/**
 * Offline account recovery. No email is involved: anyone who can run this already controls
 * the server and its database files. Only that user's sessions are signed out.
 *
 * Interactive: npm run reset-password                  (the owner)
 *              npm run reset-password -- --user NAME   (a username or email)
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
  const question = 'New password: ';
  (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s: string) => {
    if (s.includes(question)) originalWrite.call(rl, s);
  };
  const answer = await new Promise<string>((resolve) => rl.question(question, resolve));
  rl.close();
  process.stdout.write('\n');
  return answer.trim();
}

interface UserRow {
  id: number;
  username: string | null;
  email: string | null;
}

async function main(): Promise<void> {
  loadDotEnv();
  const config = loadConfig();
  const args = process.argv.slice(2);
  const userIndex = args.indexOf('--user');
  const who = userIndex >= 0 ? args[userIndex + 1] : undefined;
  if (userIndex >= 0 && !who) {
    console.error('Usage: npm run reset-password -- [--user <username-or-email>]');
    process.exit(2);
  }

  const ownerDb = openDatabase(config.databasePath);
  runMigrations(ownerDb, config.migrationsDir);
  const control = openControlDatabase(config);
  // If the app has not started since the control database arrived, the owner moves now.
  cutoverOwner(control, ownerDb, accountFileFor(config), systemClock);

  const user = (
    who
      ? control.prepare('SELECT id, username, email FROM users WHERE username = ? COLLATE NOCASE OR email = ? COLLATE NOCASE').get(who, who)
      : control.prepare('SELECT id, username, email FROM users WHERE id = 1').get()
  ) as UserRow | undefined;
  if (!user) {
    console.error(who ? `No user "${who}".` : 'There is no owner account yet. Open the app and complete first-run setup instead.');
    process.exit(1);
  }

  const password = await readPassword();
  if (password.length < PASSWORD_MIN_LENGTH) {
    console.error(`The password must have at least ${PASSWORD_MIN_LENGTH} characters. Nothing was changed.`);
    process.exit(1);
  }

  const passwordHash = await hashPassword(password);
  const now = new Date().toISOString();
  const names = [user.username, user.email].filter((n): n is string => n !== null).map(identifierHash);
  control.transaction(() => {
    control.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(passwordHash, now, user.id);
    control.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
    for (const name of names) {
      control.prepare("DELETE FROM login_attempts WHERE throttle_key = ? OR throttle_key LIKE ? ESCAPE '\\'").run(`id:${name}`, `pair:${name}:%`);
    }
    control.prepare(`DELETE FROM login_attempts WHERE throttle_key LIKE ?`).run(`pair:user-${user.id}:%`);
    control
      .prepare("INSERT INTO audit_events (created_at, user_id, event, ip, details_json) VALUES (?, ?, 'password_reset_cli', NULL, NULL)")
      .run(now, user.id);
  })();
  if (user.id === 1) {
    // Keeps the old copy in the owner's file in step, so a rollback accepts the new password.
    new LegacyOwnerMirror(ownerDb).passwordChanged(passwordHash, now);
    ownerDb
      .prepare(
        `INSERT INTO activity_events (created_at, event_type, outcome, message)
         VALUES (?, 'auth', 'warning', 'Owner password was reset from the server command line. All of the owner''s sessions were signed out.')`,
      )
      .run(now);
  }
  control.close();
  ownerDb.close();
  console.log(`Password updated for "${user.username ?? user.email}". That user's sessions were signed out.`);
}

main().catch((error: unknown) => {
  console.error('Password reset failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
