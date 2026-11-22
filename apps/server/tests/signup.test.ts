import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ChallengeDto, SessionDto } from '@glm/shared';
import { buildApp } from '../src/app/build-app.js';
import { configSecrets, createPlatform } from '../src/app/context.js';
import { resolveAccountFile } from '../src/auth/control.js';
import type { PushSender } from '../src/notifications/push-sender.js';
import { solveChallenge } from '../src/security/proof-of-work.js';
import { createLogger, SecretRegistry } from '../src/shared/logger.js';
import { FakeSmtp, linkIn, tokenIn, type ReceivedMail } from './support/fake-smtp.js';
import { authedClient, createHarness, FakeClock, testConfig, type Harness } from './support/harness.js';
import { mockFullDevice, TEST_API_KEY } from './support/mock-govee.js';

const PASSWORD = 'correct-horse-battery';
const NEW_PASSWORD = 'member-password-123';
const OWNER_AI_KEY = 'deepseek-owner-key-not-real-77';

/** The harness, with a fake mail server, links pointing at lightup.ink, and an easy puzzle. */
async function signupHarness(extraEnv: NodeJS.ProcessEnv = {}, options: { mail?: boolean; pushSender?: PushSender } = {}) {
  const smtp = new FakeSmtp({ security: 'plain' });
  await smtp.start();
  const mailEnv =
    options.mail === false
      ? {}
      : { SMTP_HOST: '127.0.0.1', SMTP_PORT: String(smtp.port), SMTP_SECURITY: 'plain', MAIL_FROM: 'info@lightup.ink' };
  const h = await createHarness({
    env: { ...mailEnv, PUBLIC_URL: 'https://lightup.ink', SIGNUP_POW_DIFFICULTY: '4', ...extraEnv },
    ...(options.pushSender ? { overrides: { pushSender: options.pushSender } } : {}),
  });
  return { h, smtp };
}

async function proof(app: FastifyInstance) {
  const { challenge, difficulty } = (await app.inject({ method: 'GET', url: '/api/v1/auth/challenge' })).json() as ChallengeDto;
  return { challenge, nonce: solveChallenge(challenge, difficulty) };
}

const post = (app: FastifyInstance, url: string, payload: object, ip = '203.0.113.7') =>
  app.inject({ method: 'POST', url: `/api/v1${url}`, payload, remoteAddress: ip });

async function register(app: FastifyInstance, email: string, ip?: string) {
  return post(app, '/auth/register', { email, ...(await proof(app)) }, ip);
}

async function login(app: FastifyInstance, username: string, password: string) {
  const response = await post(app, '/auth/login', { username, password });
  const cookie = response.cookies.find((c) => c.name === 'glm_session');
  const body = response.json() as SessionDto;
  const cookies = { glm_session: cookie?.value ?? '' };
  const headers = { 'x-csrf-token': body.csrfToken ?? '' };
  return {
    response,
    body,
    get: (url: string) => app.inject({ method: 'GET', url, cookies }),
    post: (url: string, payload?: object) => app.inject({ method: 'POST', url, cookies, headers, ...(payload ? { payload } : {}) }),
    patch: (url: string, payload: object) => app.inject({ method: 'PATCH', url, cookies, headers, payload }),
    delete: (url: string) => app.inject({ method: 'DELETE', url, cookies, headers }),
    inject: (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
      app.inject({ method, url, cookies, headers, ...(payload ? { payload } : {}) }),
  };
}

describe('email sign-up', () => {
  let h: Harness;
  let smtp: FakeSmtp;
  let owner: Awaited<ReturnType<typeof authedClient>>;

  beforeEach(async () => {
    // The owner has an AI key in the server's variables, which only the owner may use (P3).
    ({ h, smtp } = await signupHarness({ DEEPSEEK_API_KEY: OWNER_AI_KEY }));
    owner = await authedClient(h.app, PASSWORD);
    expect((await owner.patch('/api/v1/admin/signup', { enabled: true })).statusCode).toBe(200);
  });
  afterEach(async () => {
    await h.close();
    await smtp.stop();
  });

  const deliver = async (): Promise<ReceivedMail[]> => {
    await h.platform.outbox.processDue();
    return smtp.messages;
  };
  const users = () => h.platform.control.prepare('SELECT id, email, role, email_verified_at FROM users ORDER BY id').all() as {
    id: number;
    email: string | null;
    role: string;
    email_verified_at: string | null;
  }[];

  /** Registers, follows the link, sets a password. Returns the address. */
  async function signUp(email = 'new@example.com', password = NEW_PASSWORD): Promise<string> {
    const before = smtp.messages.length;
    expect((await register(h.app, email)).statusCode).toBe(202);
    const mails = await deliver();
    expect(mails).toHaveLength(before + 1);
    const token = tokenIn(mails.at(-1)!);
    const done = await post(h.app, '/auth/register/complete', { token, password });
    expect(done.statusCode).toBe(201);
    return email;
  }

  it('registers, verifies the inbox, asks for a password, then needs a separate sign-in', async () => {
    const response = await register(h.app, '  New@Example.COM ');
    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ ok: true });
    // Nothing exists yet but a link.
    expect(users()).toHaveLength(1);

    const [mail] = await deliver();
    expect(mail).toMatchObject({ from: 'info@lightup.ink', to: ['new@example.com'] });
    expect(mail!.data).toContain('Subject: Finish creating your Light Manager account');
    const link = linkIn(mail!);
    expect(link).toMatch(/^https:\/\/lightup\.ink\/verify#t=[A-Za-z0-9_-]{43}$/);
    const token = tokenIn(mail!);

    // Opening the link, even twice, as a mail scanner would, uses nothing up.
    for (let i = 0; i < 2; i += 1) {
      const check = await post(h.app, '/auth/link/check', { token });
      expect(check.statusCode).toBe(200);
      expect(check.json()).toEqual({ purpose: 'signup', email: 'new@example.com' });
    }

    const done = await post(h.app, '/auth/register/complete', { token, password: NEW_PASSWORD });
    expect(done.statusCode).toBe(201);
    expect(done.json()).toEqual({ email: 'new@example.com' });
    expect(done.cookies.find((c) => c.name === 'glm_session')).toBeUndefined();
    expect(users()[1]).toMatchObject({ email: 'new@example.com', role: 'member' });
    expect(users()[1]!.email_verified_at).not.toBeNull();

    // The link is spent.
    expect((await post(h.app, '/auth/link/check', { token })).json().error.code).toBe('link_invalid');
    expect((await post(h.app, '/auth/register/complete', { token, password: NEW_PASSWORD })).statusCode).toBe(400);

    const member = await login(h.app, 'NEW@example.com', NEW_PASSWORD);
    expect(member.response.statusCode).toBe(200);
    expect(member.body).toMatchObject({ authenticated: true, role: 'member', email: 'new@example.com', username: 'new@example.com' });
  });

  it('gives a stranger their own empty account, never the owner\'s lights or keys', async () => {
    h.mock.devices = [mockFullDevice()];
    expect((await owner.post('/api/v1/devices/discover')).statusCode).toBe(200);
    await signUp();
    const member = await login(h.app, 'new@example.com', NEW_PASSWORD);
    const requestsBefore = h.mock.requests.length;

    expect((await member.get('/api/v1/devices')).json().devices).toEqual([]);
    const discover = await member.post('/api/v1/devices/discover');
    expect(discover.statusCode).toBeGreaterThanOrEqual(400);
    // No request reached Govee on the member's behalf, so the owner's key was never used for them.
    expect(h.mock.requests.length).toBe(requestsBefore);
    const status = (await member.get('/api/v1/system/status')).json();
    expect(status.govee.keyConfigured).toBe(false);
    expect(status.database.path).toBeNull();
    expect((await owner.get('/api/v1/system/status')).json().database.path).toBe(':memory:');
    expect((await member.get('/api/v1/ai/status')).json()).toMatchObject({ enabled: false, reason: 'no_providers', providers: [] });
    expect((await owner.get('/api/v1/ai/status')).json()).toMatchObject({ enabled: true });
    expect((await member.post('/api/v1/ai/ask', { question: 'Which lights are on?' })).statusCode).toBeGreaterThanOrEqual(400);

    // The owner's lights are untouched and still the owner's.
    expect((await owner.get('/api/v1/devices')).json().devices).toHaveLength(1);
    const memberAccount = h.platform.accounts.forUser(2)!;
    expect(memberAccount.db).not.toBe(h.ctx.db);
    expect(memberAccount.transport.isConfigured()).toBe(false);
  });

  it('answers the same for a new address and one that has an account, and tells only the inbox', async () => {
    await signUp('taken@example.com');
    // Past the one-email-a-minute limit for that address.
    h.clock.advance(61_000);
    const fresh = await register(h.app, 'fresh@example.com');
    const taken = await register(h.app, 'taken@example.com');
    expect(taken.statusCode).toBe(fresh.statusCode);
    expect(taken.body).toBe(fresh.body);
    const mails = await deliver();
    const toTaken = mails.filter((m) => m.to[0] === 'taken@example.com').at(-1)!;
    expect(toTaken.data).toContain('Subject: You already have a Light Manager account');
    expect(() => linkIn(toTaken)).toThrow();
    expect(users().filter((u) => u.email === 'taken@example.com')).toHaveLength(1);
  });

  it('makes one account when the form is sent twice at once', async () => {
    await register(h.app, 'race@example.com');
    const token = tokenIn((await deliver()).at(-1)!);
    const results = await Promise.all([
      post(h.app, '/auth/register/complete', { token, password: NEW_PASSWORD }),
      post(h.app, '/auth/register/complete', { token, password: 'a-different-password' }),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 400]);
    expect(users().filter((u) => u.email === 'race@example.com')).toHaveLength(1);
  });

  it('expires links after 30 minutes, and a new link replaces the old one', async () => {
    await register(h.app, 'slow@example.com');
    const first = tokenIn((await deliver()).at(-1)!);
    h.clock.advance(61_000);
    await register(h.app, 'slow@example.com');
    const second = tokenIn((await deliver()).at(-1)!);
    expect((await post(h.app, '/auth/link/check', { token: first })).statusCode).toBe(400);
    h.clock.advance(30 * 60_000 + 1);
    expect((await post(h.app, '/auth/link/check', { token: second })).statusCode).toBe(400);
    expect((await post(h.app, '/auth/register/complete', { token: second, password: NEW_PASSWORD })).statusCode).toBe(400);
  });

  it('sends an address at most one email a minute and five a day, whoever asks, and says nothing about it', async () => {
    const answers = [];
    for (let i = 0; i < 3; i += 1) answers.push((await register(h.app, 'victim@example.com', `198.51.100.${i}`)).body);
    expect(new Set(answers).size).toBe(1);
    expect((await deliver()).filter((m) => m.to[0] === 'victim@example.com')).toHaveLength(1);
    for (let i = 0; i < 10; i += 1) {
      h.clock.advance(61_000);
      await register(h.app, 'victim@example.com', `198.51.100.${10 + i}`);
    }
    expect((await deliver()).filter((m) => m.to[0] === 'victim@example.com')).toHaveLength(5);
  });

  it('limits each network address to ten sign-up requests an hour', async () => {
    for (let i = 0; i < 10; i += 1) expect((await register(h.app, `user${i}@example.com`, '192.0.2.9')).statusCode).toBe(202);
    const blocked = await register(h.app, 'user10@example.com', '192.0.2.9');
    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers['retry-after']).toBe('3600');
    expect((await register(h.app, 'user10@example.com', '192.0.2.10')).statusCode).toBe(202);
  });

  it('needs a solved, unused puzzle, and quietly ignores the hidden field bots fill in', async () => {
    const { challenge } = (await h.app.inject({ method: 'GET', url: '/api/v1/auth/challenge' })).json() as ChallengeDto;
    const bad = await post(h.app, '/auth/register', { email: 'bot@example.com', challenge, nonce: '1' });
    expect([bad.statusCode, bad.json().error.code]).toEqual([400, 'challenge_failed']);

    const answer = await proof(h.app);
    expect((await post(h.app, '/auth/register', { email: 'one@example.com', ...answer })).statusCode).toBe(202);
    expect((await post(h.app, '/auth/register', { email: 'two@example.com', ...answer })).json().error.code).toBe('challenge_failed');

    const trap = await post(h.app, '/auth/register', { email: 'bot@example.com', ...(await proof(h.app)), website: 'http://spam.example' });
    expect(trap.statusCode).toBe(202);
    expect((await deliver()).map((m) => m.to[0])).toEqual(['one@example.com']);
    expect(h.platform.control.prepare("SELECT COUNT(*) AS n FROM email_tokens WHERE email = 'bot@example.com'").get()).toEqual({ n: 0 });
  });

  it('refuses addresses that are not plain email addresses', async () => {
    for (const email of ['no-at-sign', 'a@b', 'ünicode@example.com', 'a@example.com\r\nBcc: x@example.com', `${'x'.repeat(65)}@example.com`]) {
      expect((await post(h.app, '/auth/register', { email, ...(await proof(h.app)) })).statusCode).toBe(400);
    }
  });

  it('stops new accounts at the daily cap, even for a link already sent', async () => {
    expect((await owner.patch('/api/v1/admin/signup', { dailyCap: 1 })).json()).toMatchObject({ dailyCap: 1, createdLastDay: 0 });
    await register(h.app, 'second@example.com');
    const pending = tokenIn((await deliver()).at(-1)!);
    await signUp('first@example.com');
    const full = await register(h.app, 'third@example.com');
    expect([full.statusCode, full.json().error.code]).toEqual([403, 'signup_full']);
    const late = await post(h.app, '/auth/register/complete', { token: pending, password: NEW_PASSWORD });
    expect(late.json().error.code).toBe('signup_full');
    expect((await h.app.inject({ method: 'GET', url: '/api/v1/auth/session' })).json().signupOpen).toBe(false);
    // The link was not used up, so it works once there is room again.
    h.clock.advance(24 * 3600_000);
    expect((await post(h.app, '/auth/link/check', { token: pending })).statusCode).toBe(400);
  });

  it('stops new accounts at the total cap', async () => {
    await owner.patch('/api/v1/admin/signup', { totalCap: 1 });
    await signUp('only@example.com');
    expect((await register(h.app, 'more@example.com')).json().error.code).toBe('signup_full');
  });

  it('can be switched off by the owner, and is off until switched on', async () => {
    await owner.patch('/api/v1/admin/signup', { enabled: false });
    expect((await register(h.app, 'late@example.com')).json().error.code).toBe('signup_closed');
    expect((await h.app.inject({ method: 'GET', url: '/api/v1/auth/session' })).json().signupOpen).toBe(false);
  });

  it('lets only the owner see or change the sign-up switch', async () => {
    await signUp();
    const member = await login(h.app, 'new@example.com', NEW_PASSWORD);
    expect((await member.get('/api/v1/admin/signup')).statusCode).toBe(404);
    expect((await member.patch('/api/v1/admin/signup', { enabled: false })).statusCode).toBe(404);
    expect(h.platform.signup.settings().enabled).toBe(true);
    expect((await h.app.inject({ method: 'GET', url: '/api/v1/admin/signup' })).statusCode).toBe(401);
    expect((await owner.get('/api/v1/admin/signup')).json()).toMatchObject({ enabled: true, mailConfigured: true, createdTotal: 1 });
  });

  describe('password reset by email', () => {
    it('sends a link only to an address with an account, answering the same either way', async () => {
      await signUp();
      h.clock.advance(61_000);
      const known = await post(h.app, '/auth/password/forgot', { email: 'new@example.com', ...(await proof(h.app)) });
      const unknown = await post(h.app, '/auth/password/forgot', { email: 'nobody@example.com', ...(await proof(h.app)) });
      expect([known.statusCode, known.body]).toEqual([unknown.statusCode, unknown.body]);
      const mails = await deliver();
      expect(mails.map((m) => m.to[0])).toEqual(['new@example.com', 'new@example.com']);
      expect(linkIn(mails.at(-1)!)).toMatch(/^https:\/\/lightup\.ink\/reset#t=/);
    });

    it('sets the new password and signs out only that person', async () => {
      await signUp();
      const member = await login(h.app, 'new@example.com', NEW_PASSWORD);
      h.clock.advance(61_000);
      await post(h.app, '/auth/password/forgot', { email: 'new@example.com', ...(await proof(h.app)) });
      const token = tokenIn((await deliver()).at(-1)!);
      expect((await post(h.app, '/auth/link/check', { token })).json()).toEqual({ purpose: 'reset', email: 'new@example.com' });
      // A reset link cannot be used to make an account.
      expect((await post(h.app, '/auth/register/complete', { token, password: 'whatever-password' })).statusCode).toBe(400);

      const reset = await post(h.app, '/auth/password/reset', { token, password: 'brand-new-password' });
      expect([reset.statusCode, reset.json().email]).toEqual([200, 'new@example.com']);
      expect((await member.get('/api/v1/devices')).statusCode).toBe(401);
      expect((await owner.get('/api/v1/devices')).statusCode).toBe(200);
      expect((await login(h.app, 'new@example.com', NEW_PASSWORD)).response.statusCode).toBe(401);
      expect((await login(h.app, 'new@example.com', 'brand-new-password')).response.statusCode).toBe(200);
      expect((await post(h.app, '/auth/password/reset', { token, password: 'again-a-password' })).statusCode).toBe(400);
    });

    it('works while sign-up is switched off, for people who already have an account', async () => {
      await signUp();
      await owner.patch('/api/v1/admin/signup', { enabled: false });
      h.clock.advance(61_000);
      expect((await post(h.app, '/auth/password/forgot', { email: 'new@example.com', ...(await proof(h.app)) })).statusCode).toBe(202);
      expect((await deliver()).at(-1)!.data).toContain('Reset your Light Manager password');
    });
  });

  describe('sign-in address', () => {
    it('lets the owner add an address, sign in with it, and reset by email, keeping the old tables in step', async () => {
      // As on the live site: the owner's row still in their own file, from before the control database.
      h.ctx.db
        .prepare("INSERT INTO users (id, username, password_hash, created_at, updated_at) VALUES (1, 'owner', 'old-hash', '2026-01-01', '2026-01-01')")
        .run();
      expect((await owner.post('/api/v1/auth/email/change', { newEmail: 'me@lightup.ink', currentPassword: 'wrong-password' })).statusCode).toBe(403);
      const asked = await owner.post('/api/v1/auth/email/change', { newEmail: 'Me@LightUp.ink', currentPassword: PASSWORD });
      expect(asked.statusCode).toBe(202);
      const mail = (await deliver()).at(-1)!;
      expect(mail.to).toEqual(['me@lightup.ink']);
      const token = tokenIn(mail);
      expect(linkIn(mail)).toMatch(/\/confirm-email#t=/);
      expect((await post(h.app, '/auth/email/confirm', { token })).json()).toEqual({ email: 'me@lightup.ink' });
      // No old address, so no notice.
      expect(await deliver()).toHaveLength(1);

      const byEmail = await login(h.app, 'me@lightup.ink', PASSWORD);
      expect(byEmail.body).toMatchObject({ role: 'owner', email: 'me@lightup.ink', username: 'owner' });
      expect((await login(h.app, 'owner', PASSWORD)).response.statusCode).toBe(200);

      h.clock.advance(61_000);
      await post(h.app, '/auth/password/forgot', { email: 'me@lightup.ink', ...(await proof(h.app)) });
      const resetToken = tokenIn((await deliver()).at(-1)!);
      expect((await post(h.app, '/auth/password/reset', { token: resetToken, password: 'owner-new-password' })).statusCode).toBe(200);
      const control = h.platform.control.prepare('SELECT password_hash FROM users WHERE id = 1').get() as { password_hash: string };
      const legacy = h.ctx.db.prepare('SELECT password_hash FROM users WHERE id = 1').get() as { password_hash: string };
      expect(legacy.password_hash).toBe(control.password_hash);
      expect(h.ctx.db.prepare('SELECT COUNT(*) AS n FROM sessions').get()).toEqual({ n: 0 });
    });

    it('tells the old address when a member changes theirs, and stops reset links sent there', async () => {
      await signUp('old@example.com');
      const member = await login(h.app, 'old@example.com', NEW_PASSWORD);
      h.clock.advance(61_000);
      await post(h.app, '/auth/password/forgot', { email: 'old@example.com', ...(await proof(h.app)) });
      const oldReset = tokenIn((await deliver()).at(-1)!);

      await member.post('/api/v1/auth/email/change', { newEmail: 'new-address@example.com', currentPassword: NEW_PASSWORD });
      const confirm = tokenIn((await deliver()).at(-1)!);
      await post(h.app, '/auth/email/confirm', { token: confirm });
      const notice = (await deliver()).at(-1)!;
      expect(notice.to).toEqual(['old@example.com']);
      expect(notice.data).toContain('Subject: Your Light Manager sign-in address was changed');

      expect((await post(h.app, '/auth/password/reset', { token: oldReset, password: 'hijack-password' })).statusCode).toBe(400);
      expect((await member.get('/api/v1/auth/session')).json().email).toBe('new-address@example.com');
      expect((await login(h.app, 'old@example.com', NEW_PASSWORD)).response.statusCode).toBe(401);
    });

    it('answers the same when the new address is taken, and sends it nothing', async () => {
      await signUp('a@example.com');
      await signUp('b@example.com');
      const member = await login(h.app, 'a@example.com', NEW_PASSWORD);
      const sent = smtp.messages.length;
      const response = await member.post('/api/v1/auth/email/change', { newEmail: 'b@example.com', currentPassword: NEW_PASSWORD });
      expect(response.statusCode).toBe(202);
      expect(await deliver()).toHaveLength(sent);
    });
  });

  it('puts no link, token or password in the log', async () => {
    await signUp();
    h.clock.advance(61_000);
    await post(h.app, '/auth/password/forgot', { email: 'new@example.com', ...(await proof(h.app)) });
    expect(smtp.messages.length + (await h.platform.outbox.processDue())).toBe(2);
    for (const mail of await deliver()) {
      expect(h.logs()).not.toContain(tokenIn(mail));
    }
    expect(h.logs()).not.toContain(NEW_PASSWORD);
    expect(h.logs()).not.toContain('#t=');
    const stored = JSON.stringify(h.platform.control.prepare('SELECT * FROM email_tokens').all());
    for (const mail of smtp.messages) expect(stored).not.toContain(tokenIn(mail));
    // Sent mail keeps no text, so the database holds no live link.
    expect(h.platform.control.prepare('SELECT COUNT(*) AS n FROM mail_outbox WHERE text_body IS NOT NULL').get()).toEqual({ n: 0 });
  });
});

describe('two accounts side by side', () => {
  /**
   * Every signed-in route, called by a member with the owner's real ids. Each must answer from
   * the member's own account, so no response carries the owner's data, and the owner's data is
   * the same afterwards.
   */
  it('never serves or changes one person\'s data for another, on any route', async () => {
    const { h, smtp } = await signupHarness();
    try {
      const owner = await authedClient(h.app, PASSWORD);
      await owner.patch('/api/v1/admin/signup', { enabled: true });
      h.mock.devices = [mockFullDevice()];
      const { devices } = (await owner.post('/api/v1/devices/discover')).json() as { devices: { id: string }[] };
      const deviceId = devices[0]!.id;
      const group = (await owner.post('/api/v1/groups', { name: 'Owner Front', deviceIds: [deviceId] })).json() as { id: string };
      const preset = (
        await owner.post('/api/v1/presets', { name: 'Owner Warm', actions: [{ deviceId: null, action: { type: 'power', on: true } }] })
      ).json() as { id: string };
      const schedule = (
        await owner.post('/api/v1/schedules', {
          name: 'Owner Nightly',
          enabled: true,
          timeZone: 'UTC',
          recurrence: { kind: 'daily', time: '20:00' },
          target: { type: 'group', groupId: group.id },
          action: { type: 'power', on: true },
          missedRunPolicy: 'skip',
        })
      ).json() as { id: string };
      const command = (await owner.post(`/api/v1/devices/${deviceId}/power`, { on: true })).json() as { commandId?: string; id?: string };
      const notification = h.ctx.notifications.sendTest();
      expect(group.id && preset.id && schedule.id).toBeTruthy();

      const snapshot = () =>
        JSON.stringify({
          devices: h.ctx.db.prepare('SELECT id, name FROM devices ORDER BY id').all(),
          groups: h.ctx.db.prepare('SELECT * FROM groups ORDER BY id').all(),
          presets: h.ctx.db.prepare('SELECT id, name, updated_at FROM presets ORDER BY id').all(),
          schedules: h.ctx.db.prepare('SELECT id, name, enabled, updated_at FROM schedules ORDER BY id').all(),
          settings: h.ctx.db.prepare('SELECT * FROM application_settings').all(),
          commands: h.ctx.db.prepare('SELECT COUNT(*) AS n FROM command_history').get(),
          notifications: h.ctx.db.prepare('SELECT id, read_at, answer FROM notifications ORDER BY id').all(),
        });
      const before = snapshot();

      await register(h.app, 'member@example.com');
      await h.platform.outbox.processDue();
      await post(h.app, '/auth/register/complete', { token: tokenIn(smtp.messages.at(-1)!), password: NEW_PASSWORD });
      const member = await login(h.app, 'member@example.com', NEW_PASSWORD);

      const ids: Record<string, string> = {
        ':id': deviceId,
        ':sceneId': '1',
        ':key': 'valentines-day',
      };
      // Valid bodies, so each request gets past validation to the lookup that matters.
      const bodies: Record<string, object> = {
        'PATCH /api/v1/settings': { defaultTimeZone: 'Europe/Paris' },
        'POST /api/v1/lights/brightness': { value: 40 },
        'POST /api/v1/devices/:id/power': { on: false },
        'POST /api/v1/devices/:id/brightness': { value: 10 },
        'POST /api/v1/devices/:id/color': { hex: '#00ff00' },
        'POST /api/v1/devices/:id/color-temperature': { kelvin: 3000 },
        'POST /api/v1/devices/:id/segments': { operations: [{ segments: [0], hex: '#00ff00' }] },
        'PATCH /api/v1/groups/:id': { name: 'Hijacked' },
        'POST /api/v1/groups/:id/apply': { action: { type: 'power', on: false } },
        'PATCH /api/v1/presets/:id': { name: 'Hijacked' },
        'PATCH /api/v1/schedules/:id': { name: 'Hijacked' },
        'POST /api/v1/holidays/:key/enabled': { enabled: true },
        'POST /api/v1/holidays/:key/skip': { skip: true },
        'POST /api/v1/notifications/:id/respond': { action: 'looks_right' },
      };
      const idFor = (url: string) => {
        if (url.startsWith('/api/v1/groups/')) return group.id;
        if (url.startsWith('/api/v1/presets/')) return preset.id;
        if (url.startsWith('/api/v1/schedules/')) return schedule.id;
        if (url.startsWith('/api/v1/commands/')) return command.commandId ?? command.id ?? '1';
        if (url.startsWith('/api/v1/notifications/') && url.includes('respond')) return String(notification.id);
        if (url.startsWith('/api/v1/notifications/push/')) return '1';
        if (url.startsWith('/api/v1/connection/missed/')) return '1';
        return deviceId;
      };
      const ownerMarkers = [deviceId, 'Owner Front', 'Owner Warm', 'Owner Nightly', mockFullDevice().deviceName];
      // Routes that act on the caller's own session or sign-in, not on account data.
      const skip = new Set(['POST /api/v1/auth/logout', 'POST /api/v1/auth/change-password', 'POST /api/v1/auth/email/change']);
      const routes = h.app.routeTable.filter((r) => r.url.startsWith('/api/v1') && !r.public && !skip.has(`${r.method} ${r.url}`));
      expect(routes.length).toBeGreaterThan(65);

      for (const route of routes) {
        const url = route.url.replace(':id', idFor(route.url)).replace(':sceneId', ids[':sceneId']!).replace(':key', ids[':key']!);
        const body = bodies[`${route.method} ${route.url}`] ?? (route.method === 'GET' || route.method === 'DELETE' ? undefined : {});
        const response = await member.inject(route.method as 'GET', url, body);
        const label = `${route.method} ${route.url} -> ${response.statusCode}`;
        if (route.owner) {
          expect(response.statusCode, label).toBe(404);
          continue;
        }
        // Answered from the member's account. (A 503 for "no Govee key" is the member's own state.)
        expect(response.body, label).not.toContain('account_unavailable');
        for (const marker of ownerMarkers) expect(response.body, `${label} shows the owner's ${marker}`).not.toContain(marker);
        // A route given the owner's id finds nothing in the member's account.
        if (route.url.includes(':id') && !route.url.startsWith('/api/v1/notifications/push/')) {
          expect([404, 422], label).toContain(response.statusCode);
        }
      }
      expect(snapshot()).toBe(before);
      expect(h.mock.requests.filter((r) => r.headers['govee-api-key'] === TEST_API_KEY).length).toBeGreaterThan(0);
    } finally {
      await h.close();
      await smtp.stop();
    }
  });

  it('routes a phone notification button to the account it came from', async () => {
    const sent: string[] = [];
    const sender: PushSender = { send: async (_target, payload) => void sent.push(payload) };
    const { h, smtp } = await signupHarness({}, { pushSender: sender });
    try {
      const owner = await authedClient(h.app, PASSWORD);
      await owner.patch('/api/v1/admin/signup', { enabled: true });
      await register(h.app, 'member@example.com');
      await h.platform.outbox.processDue();
      await post(h.app, '/auth/register/complete', { token: tokenIn(smtp.messages.at(-1)!), password: NEW_PASSWORD });
      const member = await login(h.app, 'member@example.com', NEW_PASSWORD);
      const endpoint = 'https://fcm.googleapis.com/fcm/send/abc123';
      const keys = { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' };
      expect((await member.post('/api/v1/notifications/push/subscribe', { endpoint, keys, label: 'Phone' })).statusCode).toBe(200);
      const account = h.platform.accounts.forUser(2)!;
      account.notifications.notify({ kind: 'test', severity: 'info', title: 'T', body: 'B', link: '/', actions: ['looks_right'] });
      await account.notifications.idle();
      const token = (JSON.parse(sent.at(-1)!) as { actions: { token: string }[] }).actions[0]!.token;
      expect(token.startsWith('2.')).toBe(true);

      // The same token sent to the owner's account finds nothing there.
      const forged = `1.${token.slice(2)}`;
      expect((await post(h.app, '/notification-actions', { token: forged })).statusCode).toBe(404);
      expect((await post(h.app, '/notification-actions', { token: `99.${token.slice(2)}` })).statusCode).toBe(404);
      expect((await post(h.app, '/notification-actions', { token })).statusCode).toBe(200);
      expect(account.notifications.list(5).items[0]!.answer).toBe('looks_right');
    } finally {
      await h.close();
      await smtp.stop();
    }
  });
});

describe('sign-up with no mail set up', () => {
  it('cannot be switched on, and the sign-in page offers no sign-up', async () => {
    const { h, smtp } = await signupHarness({}, { mail: false });
    try {
      const owner = await authedClient(h.app, PASSWORD);
      const response = await owner.patch('/api/v1/admin/signup', { enabled: true });
      expect([response.statusCode, response.json().error.code]).toEqual([409, 'mail_not_configured']);
      expect((await owner.get('/api/v1/auth/session')).json().signupOpen).toBe(false);
      expect((await register(h.app, 'x@example.com')).json().error.code).toBe('signup_closed');
    } finally {
      await h.close();
      await smtp.stop();
    }
  });
});

describe('member accounts on disk', () => {
  it('refuses a recorded account file that points outside the data folder', () => {
    const config = testConfig({ DATABASE_PATH: '/data/owner.sqlite' });
    expect(resolveAccountFile(config, 'accounts/abc.sqlite')).toBe('/data/accounts/abc.sqlite');
    expect(() => resolveAccountFile(config, '../etc/passwd')).toThrow(/outside/);
    expect(() => resolveAccountFile(config, '/data/accounts/abc.sqlite')).toThrow(/outside/);
  });

  it('gives each member their own file next to the control database, and loads it again after a restart', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glm-signup-'));
    const smtp = new FakeSmtp({ security: 'plain' });
    await smtp.start();
    const env = {
      DATABASE_PATH: path.join(dir, 'owner.sqlite'),
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: String(smtp.port),
      SMTP_SECURITY: 'plain',
      MAIL_FROM: 'info@lightup.ink',
      SIGNUP_POW_DIFFICULTY: '4',
      SCHEDULER_ENABLED: 'false',
    };
    const start = async () => {
      const config = testConfig(env);
      const secrets = new SecretRegistry(configSecrets(config));
      const platform = createPlatform(config, { clock: new FakeClock(), secrets, logger: createLogger({ level: 'silent', secrets }) });
      const app = await buildApp(platform);
      await app.ready();
      return { platform, app };
    };
    const stop = async ({ platform, app }: Awaited<ReturnType<typeof start>>) => {
      await app.close();
      await platform.accounts.stopCore();
      platform.control.close();
    };
    try {
      const first = await start();
      const owner = await authedClient(first.app, PASSWORD);
      await owner.patch('/api/v1/admin/signup', { enabled: true });
      await register(first.app, 'disk@example.com');
      await first.platform.outbox.processDue();
      await post(first.app, '/auth/register/complete', { token: tokenIn(smtp.messages.at(-1)!), password: NEW_PASSWORD });
      const member = await login(first.app, 'disk@example.com', NEW_PASSWORD);
      await member.post('/api/v1/groups', { name: 'Member Porch', deviceIds: [] });
      const row = first.platform.control.prepare('SELECT account_file FROM users WHERE id = 2').get() as { account_file: string };
      expect(row.account_file).toMatch(/^accounts\/[0-9a-f]{24}\.sqlite$/);
      expect(fs.existsSync(path.join(dir, row.account_file))).toBe(true);
      await stop(first);

      const second = await start();
      expect(second.platform.accounts.all().map((a) => a.userId)).toEqual([1, 2]);
      const again = await login(second.app, 'disk@example.com', NEW_PASSWORD);
      expect((await again.get('/api/v1/groups')).json().groups.map((g: { name: string }) => g.name)).toEqual(['Member Porch']);
      expect(second.platform.accounts.forUser(1)!.groups.list()).toEqual([]);
      await stop(second);
    } finally {
      await smtp.stop();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
