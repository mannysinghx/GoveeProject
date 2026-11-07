import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { authedClient, createHarness, testConfig, type Harness } from './support/harness.js';
import { mockFullDevice, TEST_API_KEY } from './support/mock-govee.js';
import { ConfigError, loadConfig } from '../src/config/env.js';
import { createSecretScrubber } from '../src/shared/logger.js';

const PASSWORD = 'correct-horse-battery';

describe('authentication', () => {
  let h: Harness;

  beforeEach(async () => {
    h = await createHarness();
  });
  afterEach(() => h.close());

  const inject = (app: FastifyInstance, method: 'GET' | 'POST', url: string, payload?: object) =>
    app.inject({ method, url, ...(payload ? { payload } : {}) });

  describe('first-run setup', () => {
    it('reports setup as required until an owner exists', async () => {
      const before = (await inject(h.app, 'GET', '/api/v1/auth/session')).json();
      expect(before).toMatchObject({ setupRequired: true, authenticated: false, csrfToken: null });
      await authedClient(h.app);
      expect((await inject(h.app, 'GET', '/api/v1/auth/session')).json()).toMatchObject({ setupRequired: false });
    });

    it('can only be completed once', async () => {
      await authedClient(h.app);
      const second = await inject(h.app, 'POST', '/api/v1/auth/setup', { username: 'attacker', password: 'another-long-password' });
      expect(second.statusCode).toBe(409);
      expect(second.json().error.code).toBe('setup_complete');
      const rows = h.ctx.db.prepare('SELECT username FROM users').all();
      expect(rows).toEqual([{ username: 'owner' }]);
    });

    it('survives two setup requests racing', async () => {
      const results = await Promise.all([
        inject(h.app, 'POST', '/api/v1/auth/setup', { username: 'a', password: PASSWORD }),
        inject(h.app, 'POST', '/api/v1/auth/setup', { username: 'b', password: PASSWORD }),
      ]);
      expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
      expect(h.ctx.db.prepare('SELECT COUNT(*) AS n FROM users').get()).toEqual({ n: 1 });
    });

    it('rejects a short password', async () => {
      const response = await inject(h.app, 'POST', '/api/v1/auth/setup', { username: 'owner', password: 'short' });
      expect(response.statusCode).toBe(400);
    });

    it('has no default credentials', async () => {
      const response = await inject(h.app, 'POST', '/api/v1/auth/login', { username: 'admin', password: 'admin' });
      expect(response.statusCode).toBe(401);
    });
  });

  describe('setup code when reachable beyond loopback', () => {
    it('requires the generated code when bound to a non-loopback address', async () => {
      const lan = await createHarness({ env: { HOST: '0.0.0.0' } });
      try {
        const session = (await inject(lan.app, 'GET', '/api/v1/auth/session')).json();
        expect(session.setupCodeRequired).toBe(true);

        const noCode = await inject(lan.app, 'POST', '/api/v1/auth/setup', { username: 'owner', password: PASSWORD });
        expect(noCode.statusCode).toBe(403);
        const wrong = await inject(lan.app, 'POST', '/api/v1/auth/setup', { username: 'owner', password: PASSWORD, setupCode: 'nope' });
        expect(wrong.statusCode).toBe(403);

        const right = await inject(lan.app, 'POST', '/api/v1/auth/setup', {
          username: 'owner',
          password: PASSWORD,
          setupCode: lan.ctx.generatedSetupCode ?? '',
        });
        expect(right.statusCode).toBe(201);
        expect((await inject(lan.app, 'GET', '/api/v1/auth/session')).json().setupCodeRequired).toBe(false);
      } finally {
        await lan.close();
      }
    });

    it('uses SETUP_TOKEN when configured', async () => {
      const configured = await createHarness({ env: { SETUP_TOKEN: 'my-setup-token-value' } });
      try {
        expect(configured.ctx.generatedSetupCode).toBeNull();
        const response = await inject(configured.app, 'POST', '/api/v1/auth/setup', {
          username: 'owner',
          password: PASSWORD,
          setupCode: 'my-setup-token-value',
        });
        expect(response.statusCode).toBe(201);
      } finally {
        await configured.close();
      }
    });
  });

  describe('passwords', () => {
    it('stores an Argon2id hash, never the plaintext', async () => {
      await authedClient(h.app, PASSWORD);
      const row = h.ctx.db.prepare('SELECT password_hash FROM users').get() as { password_hash: string };
      expect(row.password_hash).toMatch(/^\$argon2id\$/);
      expect(row.password_hash).not.toContain(PASSWORD);
      const dump = JSON.stringify(h.ctx.db.prepare('SELECT * FROM activity_events').all());
      expect(dump).not.toContain(PASSWORD);
      expect(h.logs()).not.toContain(PASSWORD);
    });

    it('stores session tokens only as hashes', async () => {
      const client = await authedClient(h.app);
      const rows = h.ctx.db.prepare('SELECT token_hash FROM sessions').all() as { token_hash: string }[];
      expect(rows).toHaveLength(1);
      expect(rows[0]?.token_hash).not.toBe(client.cookies.glm_session);
    });

    it('changes the password, signs out other sessions, and keeps the caller signed in', async () => {
      const client = await authedClient(h.app, PASSWORD);
      const other = await inject(h.app, 'POST', '/api/v1/auth/login', { username: 'owner', password: PASSWORD });
      const otherCookie = other.cookies.find((c) => c.name === 'glm_session')!.value;

      const wrong = await client.post('/api/v1/auth/change-password', {
        currentPassword: 'not-the-password',
        newPassword: 'a-brand-new-password',
      });
      expect(wrong.statusCode).toBe(403);

      const changed = await client.post('/api/v1/auth/change-password', {
        currentPassword: PASSWORD,
        newPassword: 'a-brand-new-password',
      });
      expect(changed.statusCode).toBe(200);
      expect(changed.cookies.find((c) => c.name === 'glm_session')?.value).toBeTruthy();

      const stale = await h.app.inject({ method: 'GET', url: '/api/v1/devices', cookies: { glm_session: otherCookie } });
      expect(stale.statusCode).toBe(401);
      const oldLogin = await inject(h.app, 'POST', '/api/v1/auth/login', { username: 'owner', password: PASSWORD });
      expect(oldLogin.statusCode).toBe(401);
      const newLogin = await inject(h.app, 'POST', '/api/v1/auth/login', { username: 'owner', password: 'a-brand-new-password' });
      expect(newLogin.statusCode).toBe(200);
    });
  });

  describe('sessions', () => {
    it('sets a hardened cookie', async () => {
      const response = await inject(h.app, 'POST', '/api/v1/auth/setup', { username: 'owner', password: PASSWORD });
      const cookie = response.cookies.find((c) => c.name === 'glm_session');
      expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/' });
      expect(cookie?.secure).toBeFalsy(); // Plain HTTP in this test, with COOKIE_SECURE=auto.
    });

    it('marks the cookie Secure when configured', async () => {
      const secure = await createHarness({ env: { COOKIE_SECURE: 'true' } });
      try {
        const response = await inject(secure.app, 'POST', '/api/v1/auth/setup', { username: 'owner', password: PASSWORD });
        expect(response.cookies.find((c) => c.name === 'glm_session')?.secure).toBe(true);
      } finally {
        await secure.close();
      }
    });

    it('expires sessions', async () => {
      const client = await authedClient(h.app);
      expect((await client.get('/api/v1/devices')).statusCode).toBe(200);
      h.clock.advance(169 * 3600 * 1000); // TTL is 168 hours.
      expect((await client.get('/api/v1/devices')).statusCode).toBe(401);
      expect(h.ctx.db.prepare('SELECT COUNT(*) AS n FROM sessions').get()).toEqual({ n: 0 });
    });

    it('ends the session on logout', async () => {
      const client = await authedClient(h.app);
      expect((await client.post('/api/v1/auth/logout')).statusCode).toBe(204);
      expect((await client.get('/api/v1/devices')).statusCode).toBe(401);
    });

    it('rejects a made-up session cookie', async () => {
      const response = await h.app.inject({ method: 'GET', url: '/api/v1/devices', cookies: { glm_session: 'forged' } });
      expect(response.statusCode).toBe(401);
    });
  });

  describe('login throttling', () => {
    const attempt = (password: string, ip = '10.0.0.1') =>
      h.app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: ip, payload: { username: 'owner', password } });

    it('locks an address out after repeated failures, even for the right password', async () => {
      await authedClient(h.app, PASSWORD);
      for (let i = 0; i < 5; i++) expect((await attempt('wrong-password')).statusCode).toBe(401);
      const locked = await attempt(PASSWORD);
      expect(locked.statusCode).toBe(429);
      expect(locked.json().error.code).toBe('login_throttled');
      expect(Number(locked.headers['retry-after'])).toBeGreaterThan(0);
    });

    it('leaves other addresses unaffected, and unlocks after the wait', async () => {
      await authedClient(h.app, PASSWORD);
      for (let i = 0; i < 5; i++) await attempt('wrong-password');
      expect((await attempt(PASSWORD, '10.0.0.2')).statusCode).toBe(200);
      h.clock.advance(61_000);
      expect((await attempt(PASSWORD)).statusCode).toBe(200);
    });

    it('lengthens the lockout as failures continue', async () => {
      await authedClient(h.app, PASSWORD);
      for (let i = 0; i < 5; i++) await attempt('wrong-password');
      h.clock.advance(61_000);
      await attempt('wrong-password');
      const locked = await attempt(PASSWORD);
      expect(Number(locked.headers['retry-after'])).toBeGreaterThan(60);
    });

    it('slows guessing spread across many addresses', async () => {
      await authedClient(h.app, PASSWORD);
      for (let i = 0; i < 30; i++) await attempt('wrong-password', `10.1.0.${i}`);
      expect((await attempt(PASSWORD, '10.2.0.1')).statusCode).toBe(429);
    });

    it('gives the same answer for a wrong username and a wrong password', async () => {
      await authedClient(h.app, PASSWORD);
      const wrongUser = await h.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'nobody', password: PASSWORD } });
      const wrongPass = await attempt('wrong-password', '10.3.0.1');
      expect(wrongUser.statusCode).toBe(wrongPass.statusCode);
      expect(wrongUser.json().error.message).toBe(wrongPass.json().error.message);
    });
  });
});

describe('route protection', () => {
  let h: Harness;
  const routes: { method: string; url: string; isPublic: boolean }[] = [];

  beforeEach(async () => {
    routes.length = 0;
    h = await createHarness();
  });
  afterEach(() => h.close());

  it('requires a session on every route except an explicit public list', async () => {
    const listed = h.app.printRoutes({ commonPrefix: false, includeHooks: false });
    expect(listed).toContain('devices');

    const client = await authedClient(h.app);
    void client;

    const protectedRoutes: [string, string][] = [
      ['GET', '/api/v1/devices'],
      ['POST', '/api/v1/devices/discover'],
      ['POST', '/api/v1/devices/refresh-due'],
      ['GET', '/api/v1/devices/x'],
      ['POST', '/api/v1/devices/x/refresh'],
      ['GET', '/api/v1/devices/x/commands'],
      ['POST', '/api/v1/devices/x/power'],
      ['POST', '/api/v1/devices/x/brightness'],
      ['POST', '/api/v1/devices/x/color'],
      ['POST', '/api/v1/devices/x/color-temperature'],
      ['POST', '/api/v1/devices/x/segments'],
      ['GET', '/api/v1/devices/x/scenes'],
      ['POST', '/api/v1/devices/x/scenes/refresh'],
      ['POST', '/api/v1/devices/x/scenes/y/apply'],
      ['GET', '/api/v1/commands/x'],
      ['GET', '/api/v1/groups'],
      ['POST', '/api/v1/groups'],
      ['GET', '/api/v1/groups/x'],
      ['PATCH', '/api/v1/groups/x'],
      ['DELETE', '/api/v1/groups/x'],
      ['POST', '/api/v1/groups/x/apply'],
      ['GET', '/api/v1/presets'],
      ['POST', '/api/v1/presets'],
      ['GET', '/api/v1/presets/x'],
      ['PATCH', '/api/v1/presets/x'],
      ['DELETE', '/api/v1/presets/x'],
      ['POST', '/api/v1/presets/x/duplicate'],
      ['POST', '/api/v1/presets/x/apply'],
      ['POST', '/api/v1/presets/apply-draft'],
      ['GET', '/api/v1/schedules'],
      ['POST', '/api/v1/schedules'],
      ['POST', '/api/v1/schedules/preview'],
      ['GET', '/api/v1/schedules/x'],
      ['PATCH', '/api/v1/schedules/x'],
      ['DELETE', '/api/v1/schedules/x'],
      ['POST', '/api/v1/schedules/x/enable'],
      ['POST', '/api/v1/schedules/x/disable'],
      ['GET', '/api/v1/schedules/x/executions'],
      ['GET', '/api/v1/activity'],
      ['GET', '/api/v1/settings'],
      ['PATCH', '/api/v1/settings'],
      ['GET', '/api/v1/system/status'],
      ['GET', '/api/v1/dashboard/summary'],
      ['POST', '/api/v1/auth/logout'],
      ['POST', '/api/v1/auth/change-password'],
    ];
    for (const [method, url] of protectedRoutes) {
      const response = await h.app.inject({ method: method as 'GET', url });
      expect(response.statusCode, `${method} ${url}`).toBe(401);
    }
  });

  it('denies by default, so an unknown API path also needs a session', async () => {
    expect((await h.app.inject({ method: 'GET', url: '/api/v1/nope' })).statusCode).toBe(401);
    const client = await authedClient(h.app);
    expect((await client.get('/api/v1/nope')).statusCode).toBe(404);
  });

  it('leaves only health and the sign-in routes public', async () => {
    expect((await h.app.inject({ method: 'GET', url: '/api/v1/health' })).statusCode).toBe(200);
    expect((await h.app.inject({ method: 'GET', url: '/api/v1/auth/session' })).statusCode).toBe(200);
  });

  describe('CSRF', () => {
    it('rejects a state change with no token', async () => {
      const client = await authedClient(h.app);
      const response = await h.app.inject({
        method: 'POST',
        url: '/api/v1/groups',
        cookies: client.cookies,
        payload: { name: 'x' },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe('csrf_failed');
      expect(h.ctx.groups.list()).toEqual([]);
    });

    it('rejects a wrong token', async () => {
      const client = await authedClient(h.app);
      const response = await h.app.inject({
        method: 'DELETE',
        url: '/api/v1/groups/x',
        cookies: client.cookies,
        headers: { 'x-csrf-token': 'wrong' },
      });
      expect(response.statusCode).toBe(403);
    });

    it('does not need a token to read', async () => {
      const client = await authedClient(h.app);
      const response = await h.app.inject({ method: 'GET', url: '/api/v1/groups', cookies: client.cookies });
      expect(response.statusCode).toBe(200);
    });

    it('accepts the correct token', async () => {
      const client = await authedClient(h.app);
      const response = await client.post('/api/v1/groups', { name: 'x' });
      expect(response.statusCode).toBe(201);
    });
  });

  describe('host checks', () => {
    it('blocks unknown Host headers on a loopback bind, stopping DNS rebinding', async () => {
      const response = await h.app.inject({
        method: 'POST',
        url: '/api/v1/auth/setup',
        headers: { host: 'evil.example.com' },
        payload: { username: 'attacker', password: PASSWORD },
      });
      expect(response.statusCode).toBe(421);
      expect(h.ctx.auth.setupRequired()).toBe(true);
    });

    it('accepts localhost names with any port', async () => {
      for (const host of ['localhost:8787', '127.0.0.1:8787', '[::1]:8787']) {
        const response = await h.app.inject({ method: 'GET', url: '/api/v1/auth/session', headers: { host } });
        expect(response.statusCode, host).toBe(200);
      }
    });

    it('honours ALLOWED_HOSTS', async () => {
      const allowed = await createHarness({ env: { ALLOWED_HOSTS: 'lights.home.arpa' } });
      try {
        const good = await allowed.app.inject({ method: 'GET', url: '/api/v1/auth/session', headers: { host: 'lights.home.arpa:8787' } });
        const bad = await allowed.app.inject({ method: 'GET', url: '/api/v1/auth/session', headers: { host: 'localhost' } });
        expect(good.statusCode).toBe(200);
        expect(bad.statusCode).toBe(421);
      } finally {
        await allowed.close();
      }
    });
  });

  describe('security headers and CORS', () => {
    it('sends a restrictive CSP and related headers', async () => {
      const response = await h.app.inject({ method: 'GET', url: '/api/v1/health' });
      const csp = String(response.headers['content-security-policy']);
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("script-src 'self'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).not.toContain('upgrade-insecure-requests');
      expect(response.headers['x-content-type-options']).toBe('nosniff');
    });

    it('sends no CORS headers, so other origins cannot read responses', async () => {
      const response = await h.app.inject({
        method: 'GET',
        url: '/api/v1/health',
        headers: { origin: 'https://evil.example.com' },
      });
      expect(response.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('returns a request id for troubleshooting, on success and on errors', async () => {
      const ok = await h.app.inject({ method: 'GET', url: '/api/v1/health' });
      expect(ok.headers['x-request-id']).toBeTruthy();
      const bad = await h.app.inject({ method: 'GET', url: '/api/v1/devices' });
      expect(bad.json().error.requestId).toBe(bad.headers['x-request-id']);
    });

    it('accepts a safe inbound request id and replaces an unsafe one', async () => {
      const safe = await h.app.inject({ method: 'GET', url: '/api/v1/health', headers: { 'x-request-id': 'abc-12345' } });
      expect(safe.headers['x-request-id']).toBe('abc-12345');
      const unsafe = await h.app.inject({ method: 'GET', url: '/api/v1/health', headers: { 'x-request-id': 'bad id\twith spaces!' } });
      expect(unsafe.headers['x-request-id']).not.toContain('bad');
    });
  });
});

describe('secrets', () => {
  let h: Harness;

  beforeEach(async () => {
    h = await createHarness();
    h.mock.devices = [mockFullDevice()];
  });
  afterEach(() => h.close());

  it('never returns the API key, in any response, through a full workflow', async () => {
    const client = await authedClient(h.app);
    const responses = [
      await client.get('/api/v1/auth/session'),
      await client.post('/api/v1/devices/discover'),
      await client.get('/api/v1/devices'),
      await client.get('/api/v1/system/status'),
      await client.get('/api/v1/settings'),
      await client.get('/api/v1/activity'),
      await client.get('/api/v1/health'),
    ];
    const device = (responses[2]!.json() as { devices: { id: string }[] }).devices[0]!;
    responses.push(await client.get(`/api/v1/devices/${device.id}`));
    responses.push(await client.post(`/api/v1/devices/${device.id}/power`, { on: true }));
    responses.push(await client.post(`/api/v1/devices/${device.id}/refresh`));
    for (const response of responses) {
      expect(response.statusCode).toBeLessThan(500);
      expect(response.body).not.toContain(TEST_API_KEY);
      expect(JSON.stringify(response.headers)).not.toContain(TEST_API_KEY);
    }
    const status = responses[3]!.json() as { govee: { keyConfigured: boolean } };
    expect(status.govee.keyConfigured).toBe(true);
  });

  it('never writes the key to logs or activity, including when Govee echoes it back', async () => {
    h.mock.intercept = (request, res) => {
      if (request.path.endsWith('/devices')) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ code: 400, message: `bad key ${TEST_API_KEY}` }));
        return true;
      }
      return false;
    };
    const client = await authedClient(h.app);
    const response = await client.post('/api/v1/devices/discover');
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(response.body).not.toContain(TEST_API_KEY);

    const activity = await client.get('/api/v1/activity');
    expect(activity.body).toContain('Device discovery failed');
    expect(activity.body).not.toContain(TEST_API_KEY);
    expect(h.logs()).not.toContain(TEST_API_KEY);
    const stored = JSON.stringify(h.ctx.db.prepare('SELECT * FROM activity_events').all());
    expect(stored).not.toContain(TEST_API_KEY);
  });

  it('scrubs the key from any log line as a last line of defence', async () => {
    h.ctx.logger.info({ note: `leak ${TEST_API_KEY}`, nested: { deep: TEST_API_KEY } }, `message ${TEST_API_KEY}`);
    expect(h.logs()).toContain('[REDACTED]');
    expect(h.logs()).not.toContain(TEST_API_KEY);
  });

  it('never stores the key in the settings table', async () => {
    const client = await authedClient(h.app);
    await client.post('/api/v1/devices/discover');
    const rows = JSON.stringify(h.ctx.db.prepare('SELECT * FROM application_settings').all());
    expect(rows).not.toContain(TEST_API_KEY);
  });

  it('does not let a client set arbitrary settings', async () => {
    const client = await authedClient(h.app);
    const response = await client.patch('/api/v1/settings', { GOVEE_API_KEY: 'x', statusPollSeconds: 90 });
    expect(response.statusCode).toBe(200);
    const stored = JSON.stringify(h.ctx.db.prepare('SELECT * FROM application_settings').all());
    expect(stored).not.toContain('GOVEE_API_KEY');
    expect(stored).toContain('statusPollSeconds');
  });

  it('keeps a short scrubber from mangling everything', () => {
    const scrub = createSecretScrubber(['abc', null, undefined, 'long-secret']);
    expect(scrub('abc long-secret')).toBe('abc [REDACTED]');
  });
});

describe('configuration safety', () => {
  it('refuses to send the key to a non-official host', () => {
    expect(() => loadConfig({ GOVEE_API_BASE_URL: 'https://evil.example.com' })).toThrow(ConfigError);
    expect(() => loadConfig({ GOVEE_API_BASE_URL: 'http://openapi.api.govee.com' })).toThrow(ConfigError);
    expect(() => loadConfig({ GOVEE_API_BASE_URL: 'https://openapi.api.govee.com.evil.example' })).toThrow(ConfigError);
  });

  it('accepts the official host and flags loopback as a test endpoint', () => {
    expect(loadConfig({}).govee.usingLocalTestEndpoint).toBe(false);
    expect(loadConfig({ GOVEE_API_BASE_URL: 'http://127.0.0.1:9' }).govee.usingLocalTestEndpoint).toBe(true);
  });

  it('binds to localhost by default', () => {
    expect(loadConfig({}).host).toBe('127.0.0.1');
  });

  it('does not put the key value in configuration errors', () => {
    try {
      loadConfig({ GOVEE_API_KEY: 'super-secret-value', PORT: 'not-a-port' });
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as Error).message).not.toContain('super-secret-value');
    }
  });

  it('treats an empty key as not configured', () => {
    expect(testConfig({ GOVEE_API_KEY: '   ' }).govee.apiKey).toBeNull();
  });
});
