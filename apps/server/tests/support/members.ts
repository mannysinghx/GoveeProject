import type { FastifyInstance } from 'fastify';
import type { ChallengeDto, SessionDto } from '@glm/shared';
import type { ContextOverrides } from '../../src/app/context.js';
import { solveChallenge } from '../../src/security/proof-of-work.js';
import { FakeSmtp, tokenIn } from './fake-smtp.js';
import { authedClient, createHarness, type Harness } from './harness.js';

/** Helpers for tests with more than one person: a mail server, sign-up, and signing in by email. */

export const OWNER_PASSWORD = 'correct-horse-battery';
export const MEMBER_PASSWORD = 'member-password-123';
/** A 32-byte master key for encrypted credentials, as CREDENTIAL_KEYS takes it. */
export const TEST_CREDENTIAL_KEYS = `1:${Buffer.alloc(32, 7).toString('base64')}`;

export type Client = Awaited<ReturnType<typeof signIn>>;

export interface MembersHarness {
  h: Harness;
  smtp: FakeSmtp;
  owner: Awaited<ReturnType<typeof authedClient>>;
  /** Signs up an address and signs it in. */
  member: (email: string) => Promise<Client>;
  close: () => Promise<void>;
}

const post = (app: FastifyInstance, url: string, payload: object, ip = '203.0.113.7') =>
  app.inject({ method: 'POST', url: `/api/v1${url}`, payload, remoteAddress: ip });

async function proof(app: FastifyInstance) {
  const { challenge, difficulty } = (await app.inject({ method: 'GET', url: '/api/v1/auth/challenge' })).json() as ChallengeDto;
  return { challenge, nonce: solveChallenge(challenge, difficulty) };
}

export async function signIn(app: FastifyInstance, username: string, password: string) {
  const response = await post(app, '/auth/login', { username, password });
  const cookie = response.cookies.find((c) => c.name === 'glm_session');
  const body = response.json() as SessionDto;
  const cookies = { glm_session: cookie?.value ?? '' };
  const headers = { 'x-csrf-token': body.csrfToken ?? '' };
  return {
    response,
    body,
    get: (url: string) => app.inject({ method: 'GET', url: `/api/v1${url}`, cookies }),
    post: (url: string, payload?: object) =>
      app.inject({ method: 'POST', url: `/api/v1${url}`, cookies, headers, ...(payload ? { payload } : {}) }),
    put: (url: string, payload: object) => app.inject({ method: 'PUT', url: `/api/v1${url}`, cookies, headers, payload }),
    patch: (url: string, payload: object) => app.inject({ method: 'PATCH', url: `/api/v1${url}`, cookies, headers, payload }),
    delete: (url: string) => app.inject({ method: 'DELETE', url: `/api/v1${url}`, cookies, headers }),
  };
}

/** The harness with mail, sign-up switched on by the owner, and a way to make members. */
export async function membersHarness(env: NodeJS.ProcessEnv = {}, overrides: ContextOverrides = {}): Promise<MembersHarness> {
  const smtp = new FakeSmtp({ security: 'plain' });
  await smtp.start();
  const h = await createHarness({
    env: {
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: String(smtp.port),
      SMTP_SECURITY: 'plain',
      MAIL_FROM: 'info@lightup.ink',
      PUBLIC_URL: 'https://lightup.ink',
      SIGNUP_POW_DIFFICULTY: '4',
      ...env,
    },
    overrides,
  });
  const owner = await authedClient(h.app, OWNER_PASSWORD);
  const on = await owner.patch('/api/v1/admin/signup', { enabled: true });
  if (on.statusCode !== 200) throw new Error(`Could not turn sign-up on: ${on.body}`);

  const member = async (email: string): Promise<Client> => {
    // A different network address for each, so the per-address sign-up limit never applies.
    const ip = `198.51.100.${(smtp.messages.length % 250) + 1}`;
    const registered = await post(h.app, '/auth/register', { email, ...(await proof(h.app)) }, ip);
    if (registered.statusCode !== 202) throw new Error(`Register failed: ${registered.body}`);
    await h.platform.outbox.processDue();
    const mail = [...smtp.messages].reverse().find((m) => m.to.includes(email));
    if (!mail) throw new Error(`No mail for ${email}`);
    const done = await post(h.app, '/auth/register/complete', { token: tokenIn(mail), password: MEMBER_PASSWORD });
    if (done.statusCode !== 201) throw new Error(`Complete failed: ${done.body}`);
    const client = await signIn(h.app, email, MEMBER_PASSWORD);
    if (client.response.statusCode !== 200) throw new Error(`Sign-in failed: ${client.response.body}`);
    return client;
  };

  return {
    h,
    smtp,
    owner,
    member,
    close: async () => {
      for (const account of h.platform.accounts.all()) {
        if (account.userId === 1) continue;
        await h.platform.accounts.unload(account.userId);
      }
      await h.close();
      await smtp.stop();
    },
  };
}
