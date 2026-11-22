import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MEMBER_LIMITS, type AiStatusDto, type GoveeKeyStatusDto, type PersonalAiDto } from '@glm/shared';
import { TEST_API_KEY, mockFullDevice } from './support/mock-govee.js';
import { MEMBER_PASSWORD, membersHarness, OWNER_PASSWORD, signIn, TEST_CREDENTIAL_KEYS, type MembersHarness } from './support/members.js';

/*
 * A person's own account: connecting their Govee key and AI keys, their AI cap, lock and
 * resting state, export, delete, the owner's list of accounts, and the per-account limits.
 * Nothing here contacts Govee or an AI provider: Govee is the local mock, and AI is FakeAi.
 */

const GOOD_AI_KEY = 'sk-member-good-key-1a2b3c4d';
const OTHER_GOOD_AI_KEY = 'sk-member-other-key-9z8y7x';
const BAD_AI_KEY = 'sk-member-bad-key-00000000';
/** The owner's key, from the server's variables. */
const OWNER_AI_KEY = 'sk-owner-server-key-55';

/** A stand-in for the AI providers. Keys in `valid` are accepted; anything else gets 401. */
class FakeAi {
  readonly valid = new Set<string>([GOOD_AI_KEY, OTHER_GOOD_AI_KEY, OWNER_AI_KEY]);
  readonly seen: { host: string; key: string }[] = [];
  /** While set, every request waits for it. */
  hold: Promise<void> | null = null;

  readonly fetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const key = (new Headers(init?.headers).get('authorization') ?? '').replace(/^Bearer /, '');
    this.seen.push({ host: url.hostname, key });
    if (this.hold) await this.hold;
    if (!this.valid.has(key)) {
      return new Response(JSON.stringify({ error: { message: 'Authentication Fails, invalid api key' } }), { status: 401 });
    }
    return new Response(
      JSON.stringify({
        choices: [{ message: { role: 'assistant', content: 'All your lights are fine.' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 100, completion_tokens: 20 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };
}

/** The owner has no Govee key of their own here, so a member can connect the mock's one key. */
async function start(env: NodeJS.ProcessEnv = {}, ai = new FakeAi()) {
  const m = await membersHarness(
    { GOVEE_API_KEY: '', CREDENTIAL_KEYS: TEST_CREDENTIAL_KEYS, DEEPSEEK_API_KEY: OWNER_AI_KEY, ...env },
    { aiFetch: ai.fetch },
  );
  return { m, ai };
}

describe('connecting a Govee key from the browser', () => {
  let m: MembersHarness;
  afterEach(() => m.close());

  it('checks the key with Govee, stores it encrypted, and uses it only for that account', async () => {
    ({ m } = await start());
    m.h.mock.devices = [mockFullDevice()];
    const member = await m.member('lights@example.com');

    const before = (await member.get('/account/govee')).json() as GoveeKeyStatusDto;
    expect(before).toMatchObject({ connected: false, source: null, canChange: true });
    expect((await member.post('/devices/discover')).statusCode).toBeGreaterThanOrEqual(400);

    const connect = await member.put('/account/govee', { apiKey: TEST_API_KEY });
    expect(connect.statusCode).toBe(200);
    expect(connect.json()).toMatchObject({ connected: true, source: 'account' });
    expect(connect.body).not.toContain(TEST_API_KEY);
    expect((await member.get('/account/govee')).body).not.toContain(TEST_API_KEY);

    // Stored encrypted against user 2. The text of the key is nowhere in the control database.
    const row = m.h.platform.control.prepare("SELECT ciphertext FROM credentials WHERE user_id = 2 AND kind = 'govee'").get() as
      | { ciphertext: string }
      | undefined;
    expect(row).toBeDefined();
    const dump = JSON.stringify(m.h.platform.control.prepare('SELECT * FROM credentials').all());
    expect(dump).not.toContain(TEST_API_KEY);

    const discover = await member.post('/devices/discover');
    expect(discover.statusCode).toBe(200);
    expect((await member.get('/devices')).json().devices).toHaveLength(1);
    // The owner still has no key: theirs is a separate account.
    expect(m.h.platform.accounts.forUser(1)!.transport.isConfigured()).toBe(false);
    expect((await m.owner.get('/api/v1/devices')).json().devices).toEqual([]);
    expect(m.h.logs()).not.toContain(TEST_API_KEY);
    // Anything that ever holds the key, such as an activity record or log line, has it hidden.
    expect(m.h.platform.secrets.scrub(`key ${TEST_API_KEY} here`)).not.toContain(TEST_API_KEY);

    // Removing it stops the account using it.
    const removed = await member.delete('/account/govee');
    expect(removed.json()).toMatchObject({ connected: false });
    expect(m.h.platform.accounts.forUser(2)!.transport.isConfigured()).toBe(false);
  });

  it('refuses a key Govee rejects, keeps nothing, and limits how many keys can be tried', async () => {
    ({ m } = await start());
    const member = await m.member('tries@example.com');
    const wrong = await member.put('/account/govee', { apiKey: 'not-the-right-key-1234' });
    expect([wrong.statusCode, wrong.json().error.code]).toEqual([422, 'govee_key_rejected']);
    expect(m.h.platform.control.prepare('SELECT COUNT(*) AS n FROM credentials WHERE user_id = 2').get()).toEqual({ n: 0 });
    expect(m.h.logs()).not.toContain('not-the-right-key-1234');

    for (let i = 1; i < MEMBER_LIMITS.keyChecksPerHour; i += 1) {
      expect((await member.put('/account/govee', { apiKey: `wrong-key-number-${i}` })).statusCode).toBe(422);
    }
    const limited = await member.put('/account/govee', { apiKey: TEST_API_KEY });
    expect([limited.statusCode, limited.json().error.code]).toEqual([429, 'too_many_key_checks']);
    // Govee was not asked about the key past the limit.
    expect(m.h.mock.requests.filter((r) => r.headers['govee-api-key'] === TEST_API_KEY)).toHaveLength(0);

    m.h.clock.advance(3600_000);
    expect((await member.put('/account/govee', { apiKey: TEST_API_KEY })).statusCode).toBe(200);
  });

  it('connects one Govee key to one account only', async () => {
    ({ m } = await start());
    const first = await m.member('first@example.com');
    const second = await m.member('second@example.com');
    expect((await first.put('/account/govee', { apiKey: TEST_API_KEY })).statusCode).toBe(200);
    const again = await second.put('/account/govee', { apiKey: TEST_API_KEY });
    expect([again.statusCode, again.json().error.code]).toEqual([409, 'credential_in_use']);
  });

  it('cannot store a key when the server has no master key', async () => {
    ({ m } = await start({ CREDENTIAL_KEYS: '' }));
    const member = await m.member('nokeys@example.com');
    expect((await member.get('/account/govee')).json()).toMatchObject({ canChange: false });
    const response = await member.put('/account/govee', { apiKey: TEST_API_KEY });
    expect([response.statusCode, response.json().error.code]).toEqual([503, 'credentials_unavailable']);
  });

  it("leaves the owner's GOVEE_API_KEY in charge while it is set", async () => {
    ({ m } = await start({ GOVEE_API_KEY: TEST_API_KEY }));
    const status = (await m.owner.get('/api/v1/account/govee')).json() as GoveeKeyStatusDto;
    expect(status).toMatchObject({ connected: true, source: 'server', canChange: false });
    const put = await m.h.app.inject({
      method: 'PUT',
      url: '/api/v1/account/govee',
      cookies: m.owner.cookies,
      headers: { 'x-csrf-token': m.owner.csrfToken },
      payload: { apiKey: 'another-key-123456' },
    });
    expect([put.statusCode, put.json().error.code]).toEqual([409, 'govee_key_on_server']);
  });

  it('lets the owner connect a key from the browser when GOVEE_API_KEY is not set', async () => {
    ({ m } = await start());
    m.h.mock.devices = [mockFullDevice()];
    const put = await m.h.app.inject({
      method: 'PUT',
      url: '/api/v1/account/govee',
      cookies: m.owner.cookies,
      headers: { 'x-csrf-token': m.owner.csrfToken },
      payload: { apiKey: TEST_API_KEY },
    });
    expect(put.json()).toMatchObject({ connected: true, source: 'account' });
    expect((await m.owner.post('/api/v1/devices/discover')).statusCode).toBe(200);
  });
});

describe('holiday shows for new accounts', () => {
  let m: MembersHarness;
  afterEach(() => m.close());

  it('sets them up switched off for a member, who turns on the ones they want', async () => {
    // The owner's are set up switched on, as they always were: see builtin-presets.test.ts.
    ({ m } = await start());
    m.h.mock.devices = [mockFullDevice()];
    const member = await m.member('shows@example.com');
    expect((await member.put('/account/govee', { apiKey: TEST_API_KEY })).statusCode).toBe(200);
    expect((await member.post('/devices/discover')).statusCode).toBe(200);
    const account = m.h.platform.accounts.forUser(2)!;
    await account.builtins.sync();

    const shows = account.db.prepare('SELECT enabled FROM schedules WHERE builtin_show IS NOT NULL').all() as { enabled: number }[];
    expect(shows.length).toBeGreaterThan(10);
    expect(shows.every((show) => show.enabled === 0)).toBe(true);
    expect(account.db.prepare('SELECT COUNT(*) AS n FROM schedules WHERE enabled = 1').get()).toEqual({ n: 0 });
    const holidays = (await member.get('/holidays')).json().holidays as { key: string; enabled: boolean }[];
    expect(holidays.length).toBeGreaterThan(10);
    expect(holidays.every((holiday) => !holiday.enabled)).toBe(true);

    const turnedOn = await member.post(`/holidays/${holidays[0]!.key}/enabled`, { enabled: true });
    expect(turnedOn.statusCode).toBe(200);
    const after = (turnedOn.json().holidays as { key: string; enabled: boolean }[]).filter((holiday) => holiday.enabled);
    expect(after.map((holiday) => holiday.key)).toEqual([holidays[0]!.key]);
  });
});

describe('own AI keys', () => {
  let m: MembersHarness;
  let ai: FakeAi;
  afterEach(() => m.close());

  const connect = (client: Awaited<ReturnType<MembersHarness['member']>>, apiKey = GOOD_AI_KEY, model = 'deepseek-flash') =>
    client.put('/account/ai/keys/deepseek', { model, apiKey });

  it('turns AI on for a member with their own key, used only for them, never shown', async () => {
    ({ m, ai } = await start());
    const member = await m.member('ai@example.com');
    expect((await member.get('/ai/status')).json()).toMatchObject({ enabled: false, reason: 'no_key' });

    const response = await connect(member);
    expect(response.statusCode).toBe(200);
    const body = response.json() as PersonalAiDto;
    expect(body.keys).toEqual([{ provider: 'deepseek', label: 'DeepSeek', model: 'deepseek-flash', connectedAt: expect.any(String) }]);
    expect(response.body).not.toContain(GOOD_AI_KEY);
    expect((await member.get('/account/ai')).body).not.toContain(GOOD_AI_KEY);

    const status = (await member.get('/ai/status')).json() as AiStatusDto;
    expect(status).toMatchObject({ enabled: true, reason: null });
    expect(JSON.stringify(status)).not.toContain(GOOD_AI_KEY);

    const asked = await member.post('/ai/ask', { question: 'Are my lights fine?' });
    expect(asked.statusCode).toBe(200);
    // The check and the question went with the member's key, never the owner's.
    expect(ai.seen.filter((s) => s.key === GOOD_AI_KEY)).toHaveLength(2);
    expect(ai.seen.some((s) => s.key === OWNER_AI_KEY)).toBe(false);
    // The cost is the member's: the owner's month is untouched.
    expect((await m.owner.get('/api/v1/ai/status')).json().monthSpentUsd).toBe(0);
    expect((await member.get('/ai/status')).json().monthSpentUsd).toBeGreaterThan(0);
    expect(m.h.logs()).not.toContain(GOOD_AI_KEY);
    expect(m.h.platform.secrets.scrub(`key ${GOOD_AI_KEY} here`)).not.toContain(GOOD_AI_KEY);
    expect(JSON.stringify(m.h.platform.control.prepare('SELECT * FROM credentials').all())).not.toContain(GOOD_AI_KEY);

    expect((await member.delete('/account/ai/keys/deepseek')).json().keys).toEqual([]);
    expect((await member.get('/ai/status')).json()).toMatchObject({ enabled: false, reason: 'no_key' });
  });

  it('refuses a key the provider rejects, a model with no listed price, and the owner', async () => {
    ({ m, ai } = await start());
    const member = await m.member('aibad@example.com');
    const bad = await connect(member, BAD_AI_KEY);
    expect([bad.statusCode, bad.json().error.code]).toEqual([422, 'ai_key_rejected']);
    expect((await member.get('/account/ai')).json().keys).toEqual([]);
    expect(m.h.logs()).not.toContain(BAD_AI_KEY);

    // One AI key belongs to one account, whatever model is picked with it.
    expect((await connect(member, GOOD_AI_KEY, 'deepseek-flash')).statusCode).toBe(200);
    const other = await m.member('aiother@example.com');
    const reused = await connect(other, GOOD_AI_KEY, 'deepseek-v4-flash');
    expect([reused.statusCode, reused.json().error.code]).toEqual([409, 'credential_in_use']);

    const unknownModel = await connect(member, GOOD_AI_KEY, 'deepseek-reasoner-max');
    expect([unknownModel.statusCode, unknownModel.json().error.code]).toEqual([422, 'ai_model_unknown']);

    const ownerPut = await m.h.app.inject({
      method: 'PUT',
      url: '/api/v1/account/ai/keys/deepseek',
      cookies: m.owner.cookies,
      headers: { 'x-csrf-token': m.owner.csrfToken },
      payload: { model: 'deepseek-flash', apiKey: GOOD_AI_KEY },
    });
    expect([ownerPut.statusCode, ownerPut.json().error.code]).toEqual([409, 'ai_keys_on_server']);
  });

  it("keeps each person's cap, lock and resting state apart", async () => {
    ({ m, ai } = await start());
    const a = await m.member('a@example.com');
    const b = await m.member('b@example.com');
    expect((await connect(a)).statusCode).toBe(200);
    expect((await connect(b, OTHER_GOOD_AI_KEY)).statusCode).toBe(200);

    // A's cap at zero stops A, not B or the owner.
    expect((await a.patch('/account/ai', { monthlyLimitUsd: 0 })).json().monthlyLimitUsd).toBe(0);
    expect((await a.get('/ai/status')).json().reason).toBe('limit_reached');
    expect((await b.get('/ai/status')).json().reason).toBeNull();
    expect((await a.patch('/account/ai', { monthlyLimitUsd: 2 })).statusCode).toBe(200);

    // While A's question is still running, B and the owner can ask.
    let release!: () => void;
    ai.hold = new Promise<void>((resolve) => (release = resolve));
    const slow = a.post('/ai/ask', { question: 'A slow question?' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect((await a.post('/ai/ask', { question: 'A second question?' })).json().error.code).toBe('ai_busy');
    ai.hold = null;
    expect((await b.post('/ai/ask', { question: 'B can ask?' })).statusCode).toBe(200);
    expect((await m.owner.post('/api/v1/ai/ask', { question: 'Owner can ask?' })).statusCode).toBe(200);
    release();
    expect((await slow).statusCode).toBe(200);

    // A's key stops working: A's provider rests, B's does not.
    ai.valid.delete(GOOD_AI_KEY);
    expect((await a.post('/ai/ask', { question: 'Now?' })).statusCode).toBe(502);
    expect((await a.get('/ai/status')).json().providers[0].available).toBe(false);
    expect((await b.get('/ai/status')).json().providers[0].available).toBe(true);
    // A new key starts afresh.
    ai.valid.add('sk-member-replacement-key-42');
    expect((await connect(a, 'sk-member-replacement-key-42')).statusCode).toBe(200);
    expect((await a.get('/ai/status')).json().providers[0].available).toBe(true);
  });

  it('limits how many AI requests run at once on the whole server', async () => {
    ({ m, ai } = await start());
    const member = await m.member('gate@example.com');
    expect((await connect(member)).statusCode).toBe(200);
    const gate = m.h.platform.aiGate;
    for (let i = 0; i < gate.max; i += 1) expect(gate.tryEnter()).toBe(true);
    const busy = await member.post('/ai/ask', { question: 'Too many at once?' });
    expect([busy.statusCode, busy.json().error.code]).toEqual([503, 'ai_server_busy']);
    gate.leave();
    expect((await member.post('/ai/ask', { question: 'Room now?' })).statusCode).toBe(200);
    expect(gate.running).toBe(gate.max - 1);
  });
});

describe('export and delete', () => {
  let m: MembersHarness;
  afterEach(() => m.close());

  it('exports the person’s own data, with the password, and no secret of any kind', async () => {
    ({ m } = await start());
    const member = await m.member('export@example.com');
    await member.post('/groups', { name: 'Member Porch', deviceIds: [] });
    await member.put('/account/govee', { apiKey: TEST_API_KEY });
    await member.put('/account/ai/keys/deepseek', { model: 'deepseek-flash', apiKey: GOOD_AI_KEY });

    const wrong = await member.post('/account/export', { currentPassword: 'not-my-password' });
    expect(wrong.statusCode).toBe(403);

    const response = await member.post('/account/export', { currentPassword: MEMBER_PASSWORD });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-disposition']).toMatch(/^attachment; filename="light-manager-export-\d{4}-\d{2}-\d{2}\.json"$/);
    const data = response.json() as { account: { email: string; connectedKeys: { kind: string }[] }; tables: Record<string, unknown[]> };
    expect(data.account.email).toBe('export@example.com');
    expect(data.account.connectedKeys.map((k) => k.kind)).toEqual(['ai:deepseek', 'govee']);
    expect(data.tables.groups).toEqual([expect.objectContaining({ name: 'Member Porch' })]);
    for (const hidden of ['users', 'sessions', 'login_attempts', 'push_keys', 'notification_tokens', 'schema_migrations']) {
      expect(data.tables[hidden], hidden).toBeUndefined();
    }
    for (const secret of [TEST_API_KEY, GOOD_AI_KEY, '$argon2']) expect(response.body).not.toContain(secret);
  });

  it("deletes a member's account, file and keys, and nothing of anyone else's", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glm-delete-'));
    try {
      ({ m } = await start({ DATABASE_PATH: path.join(dir, 'owner.sqlite'), SCHEDULER_ENABLED: 'false' }));
      await m.owner.post('/api/v1/groups', { name: 'Owner Front', deviceIds: [] });
      const keep = await m.member('keep@example.com');
      await keep.post('/groups', { name: 'Kept Porch', deviceIds: [] });
      const gone = await m.member('gone@example.com');
      await gone.put('/account/govee', { apiKey: TEST_API_KEY });
      // The owner is 1, keep@ is 2.
      const goneId = 3;
      const file = (m.h.platform.control.prepare('SELECT account_file FROM users WHERE id = ?').get(goneId) as { account_file: string }).account_file;
      expect(fs.existsSync(path.join(dir, file))).toBe(true);

      const owner = await m.owner.post('/api/v1/account/delete', { currentPassword: OWNER_PASSWORD, confirm: 'DELETE' });
      expect([owner.statusCode, owner.json().error.code]).toEqual([403, 'owner_cannot_delete']);
      expect((await gone.post('/account/delete', { currentPassword: MEMBER_PASSWORD, confirm: 'delete' })).statusCode).toBe(400);
      expect((await gone.post('/account/delete', { currentPassword: 'wrong-password!', confirm: 'DELETE' })).statusCode).toBe(403);

      const auditCount = (where = '') =>
        (m.h.platform.control.prepare(`SELECT COUNT(*) AS n FROM audit_events ${where}`).get(...(where ? [goneId] : [])) as { n: number }).n;
      const theirs = auditCount('WHERE user_id = ?');
      const everyone = auditCount();
      expect(theirs).toBeGreaterThan(0);
      const deleted = await gone.post('/account/delete', { currentPassword: MEMBER_PASSWORD, confirm: 'DELETE' });
      expect(deleted.statusCode).toBe(204);
      expect(deleted.cookies.find((c) => c.name === 'glm_session')?.value).toBe('');

      const control = m.h.platform.control;
      expect(control.prepare('SELECT COUNT(*) AS n FROM users WHERE id = ?').get(goneId)).toEqual({ n: 0 });
      for (const table of ['sessions', 'credentials', 'email_tokens', 'audit_events']) {
        expect(control.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`).get(goneId), table).toEqual({ n: 0 });
      }
      // Their history went (not just unlinked), and one line records that an account was deleted.
      expect(auditCount()).toBe(everyone - theirs + 1);
      expect(control.prepare("SELECT details_json FROM audit_events WHERE event = 'account_deleted'").get()).toEqual({
        details_json: JSON.stringify({ deletedUserId: goneId }),
      });
      expect(m.h.platform.accounts.forUser(goneId)).toBeNull();
      expect(fs.existsSync(path.join(dir, file))).toBe(false);
      expect((await gone.get('/devices')).statusCode).toBe(401);
      expect((await signIn(m.h.app, 'gone@example.com', MEMBER_PASSWORD)).response.statusCode).toBe(401);

      // Everyone else is as they were.
      expect((await keep.get('/groups')).json().groups.map((g: { name: string }) => g.name)).toEqual(['Kept Porch']);
      expect((await m.owner.get('/api/v1/groups')).json().groups.map((g: { name: string }) => g.name)).toEqual(['Owner Front']);

      // The address can sign up again, and gets a fresh, empty account. The Govee key is free again.
      m.h.clock.advance(61_000);
      const back = await m.member('gone@example.com');
      expect((await back.get('/groups')).json().groups).toEqual([]);
      expect((await back.put('/account/govee', { apiKey: TEST_API_KEY })).statusCode).toBe(200);
    } finally {
      await m.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("the owner's list of accounts", () => {
  let m: MembersHarness;
  afterEach(() => m.close());

  it('lists accounts for the owner only, and suspends and reactivates a member', async () => {
    ({ m } = await start());
    const member = await m.member('listed@example.com');
    expect((await member.get('/admin/accounts')).statusCode).toBe(404);

    const list = (await m.owner.get('/api/v1/admin/accounts')).json().accounts as { id: number; email: string; status: string }[];
    expect(list.map((a) => [a.id, a.email, a.status])).toEqual([
      [1, 'owner', 'active'],
      [2, 'listed@example.com', 'active'],
    ]);
    expect(JSON.stringify(list)).not.toMatch(/password|hash|token/i);

    const suspended = await m.owner.patch('/api/v1/admin/accounts/2', { status: 'suspended' });
    expect(suspended.json().accounts[1]).toMatchObject({ status: 'suspended', devices: null });
    expect((await member.get('/devices')).statusCode).toBe(401);
    expect((await signIn(m.h.app, 'listed@example.com', MEMBER_PASSWORD)).response.statusCode).toBe(403);
    expect(m.h.platform.accounts.forUser(2)).toBeNull();

    expect((await m.owner.patch('/api/v1/admin/accounts/1', { status: 'suspended' })).json().error.code).toBe('owner_account');
    expect((await m.owner.patch('/api/v1/admin/accounts/99', { status: 'suspended' })).statusCode).toBe(404);

    await m.owner.patch('/api/v1/admin/accounts/2', { status: 'active' });
    // Sessions from before the suspension do not come back. The person signs in again.
    expect((await member.get('/devices')).statusCode).toBe(401);
    const again = await signIn(m.h.app, 'listed@example.com', MEMBER_PASSWORD);
    expect(again.response.statusCode).toBe(200);
    expect((await again.get('/devices')).statusCode).toBe(200);
  });
});

describe('per-account limits', () => {
  let m: MembersHarness;
  afterEach(() => m.close());

  it('slows a member who sends too many requests, and nobody else', async () => {
    ({ m } = await start());
    const member = await m.member('busy@example.com');
    // Signing in counted as none: the limit is on signed-in requests.
    for (let i = 0; i < MEMBER_LIMITS.requestsPerMinute; i += 1) {
      const response = await member.get('/groups');
      if (response.statusCode !== 200) throw new Error(`Request ${i + 1} was refused: ${response.body}`);
    }
    const refused = await member.get('/groups');
    expect([refused.statusCode, refused.json().error.code]).toEqual([429, 'too_many_requests']);
    expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);
    expect((await m.owner.get('/api/v1/groups')).statusCode).toBe(200);
    m.h.clock.advance(60_000);
    expect((await member.get('/groups')).statusCode).toBe(200);
  });

  it("caps a member's groups, presets and schedules, not counting built-ins, and not the owner's", async () => {
    ({ m } = await start());
    const member = await m.member('caps@example.com');
    const db = m.h.platform.accounts.forUser(2)!.db;
    const now = new Date().toISOString();
    for (let i = 0; i < MEMBER_LIMITS.groups; i += 1) {
      db.prepare('INSERT INTO groups (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(`g${i}`, `Group ${i}`, now, now);
    }
    const group = await member.post('/groups', { name: 'One too many', deviceIds: [] });
    expect([group.statusCode, group.json().error.code]).toEqual([409, 'account_limit_reached']);
    // The owner, past the same number, can still make more.
    for (let i = 0; i < MEMBER_LIMITS.groups; i += 1) {
      m.h.ctx.db.prepare('INSERT INTO groups (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(`o${i}`, `Owner group ${i}`, now, now);
    }
    expect((await m.owner.post('/api/v1/groups', { name: 'Owner has no cap', deviceIds: [] })).statusCode).toBe(201);

    const preset = { name: 'Mine', actions: [{ deviceId: null, action: { type: 'power', on: true } }] };
    for (let i = 0; i < MEMBER_LIMITS.presets; i += 1) {
      db.prepare('INSERT INTO presets (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(`p${i}`, `Preset ${i}`, now, now);
    }
    db.prepare("INSERT INTO presets (id, name, created_at, updated_at, builtin_key) VALUES ('b1', 'Built in', ?, ?, 'x')").run(now, now);
    expect((await member.post('/presets', preset)).json().error.code).toBe('account_limit_reached');
    db.prepare("DELETE FROM presets WHERE id = 'p0'").run();
    // A built-in does not count, so one more fits.
    expect((await member.post('/presets', preset)).statusCode).toBe(201);
  });
});
