import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { verify } from '@node-rs/argon2';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DiscoveryResultDto } from '@glm/shared';
import { hashPassword, hashToken } from '../src/auth/auth-service.js';
import { ConfigError, parseCredentialKeys, PROJECT_ROOT } from '../src/config/env.js';
import { openDatabase, runMigrations } from '../src/database/database.js';
import { CredentialStore } from '../src/security/credentials.js';
import { authedClient, createHarness, FakeClock, type Harness } from './support/harness.js';
import { mockBasicDevice, mockFullDevice, TEST_API_KEY } from './support/mock-govee.js';

const MIGRATIONS = path.join(PROJECT_ROOT, 'migrations');
const PASSWORD = 'correct-horse-battery';
const key = (byte: number) => Buffer.alloc(32, byte).toString('base64');
const KEYS_V1 = `1:${key(1)}`;

describe('the control database', () => {
  let dir: string;
  let live: string;
  let controlPath: string;
  const open: Harness[] = [];

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glm-control-'));
    live = path.join(dir, 'live.sqlite');
    controlPath = path.join(dir, 'control.sqlite');
  });

  afterEach(async () => {
    while (open.length > 0) await open.pop()!.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  async function start(env: NodeJS.ProcessEnv = {}): Promise<Harness> {
    const h = await createHarness({ env: { DATABASE_PATH: live, ...env } });
    open.push(h);
    return h;
  }

  async function stop(h: Harness): Promise<void> {
    open.splice(open.indexOf(h), 1);
    await h.close();
  }

  /** A first start with CREDENTIAL_KEYS: setup makes the owner, and the key is stored against them. */
  async function firstRunWithKey(): Promise<void> {
    const h = await start({ CREDENTIAL_KEYS: KEYS_V1 });
    await authedClient(h.app, PASSWORD);
    expect(h.platform.control.prepare('SELECT COUNT(*) AS n FROM credentials').get()).toEqual({ n: 1 });
    await stop(h);
  }

  /** The owner's file as the deployed version leaves it: an owner and a live session in it. */
  async function previousVersionFile(): Promise<{ token: string; csrf: string; hash: string }> {
    const db = openDatabase(live);
    runMigrations(db, MIGRATIONS);
    const hash = await hashPassword(PASSWORD);
    const token = crypto.randomBytes(32).toString('base64url');
    const csrf = crypto.randomBytes(32).toString('base64url');
    db.prepare("INSERT INTO users (id, username, password_hash, created_at, updated_at) VALUES (1, 'owner', ?, '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z')").run(hash);
    db.prepare("INSERT INTO sessions (token_hash, user_id, csrf_token, expires_at, created_at) VALUES (?, 1, ?, '2026-06-20T00:00:00.000Z', '2026-06-15T00:00:00.000Z')").run(
      hashToken(token),
      csrf,
    );
    db.close();
    return { token, csrf, hash };
  }

  const fileRows = () => {
    const db = new Database(live, { readonly: true });
    try {
      return {
        users: db.prepare('SELECT id, username, password_hash FROM users').all() as { id: number; username: string; password_hash: string }[],
        sessions: db.prepare('SELECT token_hash FROM sessions').all() as { token_hash: string }[],
      };
    } finally {
      db.close();
    }
  };

  const login = (h: Harness, username: string, password: string, ip = '10.9.0.1') =>
    h.app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: ip, payload: { username, password } });

  async function addMember(h: Harness, username: string, password: string): Promise<number> {
    const result = h.platform.control
      .prepare(
        "INSERT INTO users (username, password_hash, role, status, account_file, created_at, updated_at) VALUES (?, ?, 'member', 'active', 'member.sqlite', ?, ?)",
      )
      .run(username, await hashPassword(password), h.clock.nowIso(), h.clock.nowIso());
    return Number(result.lastInsertRowid);
  }

  describe('moving the owner in', () => {
    it("copies the owner and their live session, leaves the owner's file as it was, and keeps them signed in", async () => {
      const old = await previousVersionFile();
      const before = fileRows();
      const h = await start();

      const users = h.platform.control.prepare('SELECT id, username, password_hash, role, account_file FROM users').all();
      expect(users).toEqual([{ id: 1, username: 'owner', password_hash: old.hash, role: 'owner', account_file: 'live.sqlite' }]);
      expect(fileRows()).toEqual(before);

      const session = await h.app.inject({ method: 'GET', url: '/api/v1/auth/session', cookies: { glm_session: old.token } });
      expect(session.json()).toMatchObject({ authenticated: true, username: 'owner', csrfToken: old.csrf, setupRequired: false });
      expect((await login(h, 'owner', PASSWORD)).statusCode).toBe(200);
      expect(h.platform.control.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE event = 'cutover'").get()).toEqual({ n: 1 });
    });

    it('is safe to repeat: a second start changes nothing', async () => {
      await previousVersionFile();
      await stop(await start());
      const h = await start();
      expect(h.platform.control.prepare('SELECT COUNT(*) AS n FROM users').get()).toEqual({ n: 1 });
      expect(h.platform.control.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE event LIKE 'cutover%'").get()).toEqual({ n: 1 });
    });

    it('takes a password the previous version changed after a rollback, so rolling forward never brings back an old one', async () => {
      await previousVersionFile();
      await stop(await start());

      // Rolled back: the previous version changes the password, and signs everyone out.
      const db = openDatabase(live);
      db.prepare("UPDATE users SET password_hash = ?, updated_at = '2026-12-01T00:00:00.000Z' WHERE id = 1").run(await hashPassword('changed-while-rolled-back'));
      db.prepare('DELETE FROM sessions').run();
      db.close();

      const h = await start();
      expect((await login(h, 'owner', PASSWORD)).statusCode).toBe(401);
      expect((await login(h, 'owner', 'changed-while-rolled-back', '10.9.0.2')).statusCode).toBe(200);
      expect(h.platform.control.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE event = 'cutover_newer_password'").get()).toEqual({ n: 1 });
    });

    it("keeps the owner's old tables in step, so the previous version accepts the new password and not a signed-out session", async () => {
      const old = await previousVersionFile();
      const h = await start();
      const client = await (async () => {
        const res = await login(h, 'owner', PASSWORD);
        const cookie = res.cookies.find((c) => c.name === 'glm_session')!.value;
        return { cookie, csrf: res.json().csrfToken as string };
      })();

      // Signing out the copied session removes it from the owner's file too.
      await h.app.inject({ method: 'POST', url: '/api/v1/auth/logout', cookies: { glm_session: old.token }, headers: { 'x-csrf-token': old.csrf } });
      expect(fileRows().sessions.map((s) => s.token_hash)).not.toContain(hashToken(old.token));

      const changed = await h.app.inject({
        method: 'POST',
        url: '/api/v1/auth/change-password',
        cookies: { glm_session: client.cookie },
        headers: { 'x-csrf-token': client.csrf },
        payload: { currentPassword: PASSWORD, newPassword: 'the-new-owner-password' },
      });
      expect(changed.statusCode).toBe(200);
      const file = fileRows();
      expect(file.sessions).toEqual([]);
      expect(await verify(file.users[0]!.password_hash, 'the-new-owner-password')).toBe(true);
      const controlHash = (h.platform.control.prepare('SELECT password_hash FROM users WHERE id = 1').get() as { password_hash: string }).password_hash;
      expect(file.users[0]!.password_hash).toBe(controlHash);

      // And rolling forward again does not count that as a newer password from the old version.
      await stop(h);
      const again = await start();
      expect(again.platform.control.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE event = 'cutover_newer_password'").get()).toEqual({ n: 0 });
      expect((await login(again, 'owner', 'the-new-owner-password')).statusCode).toBe(200);
    });

    it('creates the owner in the control database on a fresh install, never in the account file', async () => {
      const h = await start();
      await authedClient(h.app, PASSWORD);
      expect(h.platform.control.prepare('SELECT id, role FROM users').all()).toEqual([{ id: 1, role: 'owner' }]);
      expect(fileRows().users).toEqual([]);
    });
  });

  describe('sign-in throttling', () => {
    it('has no lockout shared by every account', async () => {
      const h = await start();
      await authedClient(h.app, PASSWORD);
      await addMember(h, 'neighbour', 'neighbour-password-123');
      for (let i = 0; i < 40; i++) await login(h, 'owner', 'wrong-password', `10.20.0.${i}`);
      expect((await login(h, 'owner', PASSWORD, '10.30.0.1')).statusCode).toBe(429);
      expect((await login(h, 'neighbour', 'neighbour-password-123', '10.30.0.2')).statusCode).toBe(200);
    });

    it("cannot be reset by signing in to one's own account", async () => {
      const h = await start();
      await authedClient(h.app, PASSWORD);
      await addMember(h, 'attacker', 'attacker-password-123');
      for (let i = 0; i < 4; i++) expect((await login(h, 'owner', 'wrong-password', '10.40.0.1')).statusCode).toBe(401);
      expect((await login(h, 'attacker', 'attacker-password-123', '10.40.0.1')).statusCode).toBe(200);
      expect((await login(h, 'owner', 'wrong-password', '10.40.0.1')).statusCode).toBe(401);
      expect((await login(h, 'owner', PASSWORD, '10.40.0.1')).statusCode).toBe(429);
    });

    it('stops one address trying many names', async () => {
      const h = await start();
      await authedClient(h.app, PASSWORD);
      for (let i = 0; i < 30; i++) await login(h, `someone-${i}`, 'wrong-password', '10.50.0.1');
      expect((await login(h, 'owner', PASSWORD, '10.50.0.1')).statusCode).toBe(429);
      expect((await login(h, 'owner', PASSWORD, '10.50.0.2')).statusCode).toBe(200);
    });

    it('keeps typed names only as hashes', async () => {
      const h = await start();
      await login(h, 'a-name-someone-typed@example.com', 'wrong-password');
      const keys = JSON.stringify(h.platform.control.prepare('SELECT throttle_key FROM login_attempts').all());
      expect(keys).not.toContain('a-name-someone-typed');
      expect(keys).toContain('10.9.0.1');
    });

    it('refuses a suspended account, and its sessions', async () => {
      const h = await start();
      const client = await authedClient(h.app, PASSWORD);
      h.platform.control.prepare("UPDATE users SET status = 'suspended'").run();
      expect((await client.get('/api/v1/devices')).statusCode).toBe(401);
      const response = await login(h, 'owner', PASSWORD);
      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe('account_suspended');
    });
  });

  describe('the encrypted Govee key', () => {
    it('stores the key from GOVEE_API_KEY encrypted, and keeps using it', async () => {
      const h = await start({ CREDENTIAL_KEYS: KEYS_V1 });
      h.mock.devices = [mockFullDevice(), mockBasicDevice()];
      const client = await authedClient(h.app, PASSWORD);
      expect(((await client.post('/api/v1/devices/discover')).json() as DiscoveryResultDto).total).toBe(2);
      const dump = JSON.stringify(h.platform.control.prepare('SELECT * FROM credentials').all());
      expect(dump).toContain('"kind":"govee"');
      expect(dump).not.toContain(TEST_API_KEY);
      expect(fs.readFileSync(controlPath).includes(Buffer.from(TEST_API_KEY))).toBe(false);
    });

    it('uses the stored key once GOVEE_API_KEY is removed, and hides it in logs', async () => {
      await firstRunWithKey();
      const h = await start({ CREDENTIAL_KEYS: KEYS_V1, GOVEE_API_KEY: '' });
      expect(h.ctx.config.govee.apiKey).toBeNull();
      h.mock.devices = [mockFullDevice()];
      const signedIn = await login(h, 'owner', PASSWORD);
      const cookies = { glm_session: signedIn.cookies.find((c) => c.name === 'glm_session')!.value };
      const discover = await h.app.inject({ method: 'POST', url: '/api/v1/devices/discover', cookies, headers: { 'x-csrf-token': signedIn.json().csrfToken } });
      expect(discover.statusCode).toBe(200);
      expect((discover.json() as DiscoveryResultDto).total).toBe(1);
      h.ctx.logger.warn(`echo ${TEST_API_KEY}`);
      expect(h.logs()).not.toContain(TEST_API_KEY);
      expect(h.logs()).toContain('Using the stored, encrypted Govee key');
    });

    it('follows GOVEE_API_KEY when it changes, so changing the variable still works', async () => {
      await firstRunWithKey();
      const h = await start({ CREDENTIAL_KEYS: KEYS_V1, GOVEE_API_KEY: 'a-replacement-key-value' });
      const stored = h.platform.credentials.get(1, 'govee');
      expect(stored).toEqual({ secret: 'a-replacement-key-value', status: 'active' });
      expect(h.platform.control.prepare("SELECT details_json FROM audit_events WHERE event = 'govee_key_stored' ORDER BY id").all()).toEqual([
        { details_json: '{"replaced":false}' },
        { details_json: '{"replaced":true}' },
      ]);
    });

    it('with the wrong master key and no variable, uses no key and overwrites nothing', async () => {
      await firstRunWithKey();
      const before = new Database(controlPath, { readonly: true }).prepare('SELECT * FROM credentials').all();
      const h = await start({ CREDENTIAL_KEYS: `1:${key(9)}`, GOVEE_API_KEY: '' });
      expect(h.ctx.transport.isConfigured()).toBe(false);
      expect(h.logs()).toContain('The stored Govee key cannot be read');
      expect(h.platform.control.prepare('SELECT * FROM credentials').all()).toEqual(before);
    });

    it('without CREDENTIAL_KEYS, stores nothing and uses GOVEE_API_KEY as before', async () => {
      const h = await start();
      expect(h.platform.credentials.enabled()).toBe(false);
      expect(h.ctx.transport.isConfigured()).toBe(true);
      expect(h.platform.control.prepare('SELECT COUNT(*) AS n FROM credentials').get()).toEqual({ n: 0 });
      expect(h.logs()).toContain('CREDENTIAL_KEYS is not set');
    });
  });
});

describe('CredentialStore', () => {
  function store(keys: string) {
    const db = openDatabase(':memory:');
    runMigrations(db, path.join(MIGRATIONS, 'control'));
    for (const id of [1, 2]) {
      db.prepare("INSERT INTO users (id, username, password_hash, role, account_file, created_at, updated_at) VALUES (?, ?, 'x', ?, 'f', 'now', 'now')").run(
        id,
        `user${id}`,
        id === 1 ? 'owner' : 'member',
      );
    }
    return { db, credentials: new CredentialStore(db, parseCredentialKeys(keys), new FakeClock()) };
  }

  it('round-trips, and never stores the secret readably', () => {
    const { db, credentials } = store(KEYS_V1);
    credentials.put(1, 'govee', 'the-secret-govee-key');
    expect(credentials.get(1, 'govee')).toEqual({ secret: 'the-secret-govee-key', status: 'active' });
    expect(JSON.stringify(db.prepare('SELECT * FROM credentials').all())).not.toContain('the-secret-govee-key');
  });

  it('will not decrypt a row copied to another user', () => {
    const { db, credentials } = store(KEYS_V1);
    credentials.put(1, 'govee', 'the-secret-govee-key');
    db.prepare("INSERT INTO credentials SELECT 2, kind, key_version, iv, ciphertext, auth_tag, 'other', status, created_at, updated_at FROM credentials WHERE user_id = 1").run();
    expect(credentials.get(2, 'govee')).toMatchObject({ error: expect.stringContaining('could not be decrypted') });
  });

  it('keeps old rows readable after a new master key is added, and encrypts new ones with it', () => {
    const { db, credentials } = store(KEYS_V1);
    credentials.put(1, 'govee', 'key-from-version-one');
    const rotated = new CredentialStore(db, parseCredentialKeys(`2:${key(2)},1:${key(1)}`), new FakeClock());
    expect(rotated.get(1, 'govee')).toEqual({ secret: 'key-from-version-one', status: 'active' });
    rotated.put(2, 'govee', 'key-for-user-two');
    expect(db.prepare('SELECT user_id, key_version FROM credentials ORDER BY user_id').all()).toEqual([
      { user_id: 1, key_version: 1 },
      { user_id: 2, key_version: 2 },
    ]);
    const withoutOld = new CredentialStore(db, parseCredentialKeys(`2:${key(2)}`), new FakeClock());
    expect(withoutOld.get(1, 'govee')).toEqual({ error: 'Master key version 1 is not in CREDENTIAL_KEYS.' });
  });

  it('refuses one Govee key on two accounts', () => {
    const { credentials } = store(KEYS_V1);
    credentials.put(1, 'govee', 'shared-key-value');
    expect(() => credentials.put(2, 'govee', 'shared-key-value')).toThrow(/already connected to another account/);
    credentials.put(1, 'govee', 'shared-key-value');
  });

  it('reports bad CREDENTIAL_KEYS without ever showing a key', () => {
    const short = Buffer.alloc(16, 7).toString('base64');
    for (const raw of [`1:${short}`, `x:${key(1)}`, `1:${key(1)},1:${key(2)}`, `0:${key(1)}`]) {
      let message = '';
      try {
        parseCredentialKeys(raw);
      } catch (error) {
        expect(error).toBeInstanceOf(ConfigError);
        message = (error as Error).message;
      }
      expect(message).not.toBe('');
      expect(message).not.toContain(short);
      expect(message).not.toContain(key(1));
      expect(message).not.toContain(key(2));
    }
    expect(parseCredentialKeys(`1:${key(1)},3:${key(3)}`).current).toBe(3);
  });
});
