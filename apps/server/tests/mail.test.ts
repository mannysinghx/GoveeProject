import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { configSecrets } from '../src/app/context.js';
import { openControlDatabase } from '../src/auth/control.js';
import { ConfigError } from '../src/config/env.js';
import { buildMessage, dotStuff, MailFormatError, quotedPrintable } from '../src/mail/message.js';
import { MailOutbox, type MailSender } from '../src/mail/outbox.js';
import { sendSmtp, SmtpError, type SmtpClientOptions } from '../src/mail/smtp-client.js';
import { leadingZeroBits, ProofOfWork, solveChallenge } from '../src/security/proof-of-work.js';
import { createLogger } from '../src/shared/logger.js';
import { FakeSmtp, TEST_TLS, type FakeSmtpOptions } from './support/fake-smtp.js';
import { FakeClock, testConfig } from './support/harness.js';

/** The error a send failed with. Fails the test if it did not fail. */
async function failure(sending: Promise<void>): Promise<SmtpError> {
  try {
    await sending;
  } catch (error) {
    return error as SmtpError;
  }
  throw new Error('Expected the send to fail');
}

const MAIL = { from: 'info@lightup.ink', fromName: 'Light Manager', to: 'person@example.com' };
const CONTENT = { subject: 'Hello', text: 'Line one\n.starts with a dot\nCafé ☕', html: '<p>Hi</p>' };

/** Undoes quoted-printable, for checking what a reader would see. */
const decodeQp = (text: string) =>
  Buffer.from(text.replace(/=\r\n/g, '').replace(/=([0-9A-F]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16))), 'latin1').toString('utf8');

describe('message builder', () => {
  it('builds a two-part message with the headers mail servers expect', () => {
    const { data, messageId } = buildMessage(MAIL, CONTENT, new Date('2026-11-22T10:00:00Z'));
    expect(data).toContain('From: "Light Manager" <info@lightup.ink>\r\n');
    expect(data).toContain('To: <person@example.com>\r\n');
    expect(data).toContain('Subject: Hello\r\n');
    expect(data).toContain('Date: Sun, 22 Nov 2026 10:00:00 +0000\r\n');
    expect(data).toContain(`Message-ID: ${messageId}\r\n`);
    expect(messageId).toMatch(/^<[0-9a-f]{32}@lightup\.ink>$/);
    expect(data).toContain('Auto-Submitted: auto-generated');
    expect(data).toMatch(/Content-Type: multipart\/alternative; boundary="glm-[0-9a-f]{24}"/);
    expect(data.split('\r\n').every((line) => line.length <= 998)).toBe(true);
    expect([...data].every((c) => c.charCodeAt(0) < 128)).toBe(true);
    expect(decodeQp(data)).toContain('Café ☕');
  });

  it('refuses a line break in any header, rather than cleaning it', () => {
    const date = new Date();
    expect(() => buildMessage(MAIL, { ...CONTENT, subject: 'Hi\r\nBcc: victim@example.com' }, date)).toThrow(MailFormatError);
    expect(() => buildMessage({ ...MAIL, to: 'a@example.com\r\nBcc: b@example.com' }, CONTENT, date)).toThrow(MailFormatError);
    expect(() => buildMessage({ ...MAIL, to: 'a@example.com>, <b@example.com' }, CONTENT, date)).toThrow(MailFormatError);
    expect(() => buildMessage({ ...MAIL, fromName: 'Light\nManager' }, CONTENT, date)).toThrow(MailFormatError);
  });

  it('encodes a non-ASCII subject, and keeps quoted-printable lines short', () => {
    const { data } = buildMessage(MAIL, { ...CONTENT, subject: 'Lumière' }, new Date());
    expect(data).toContain(`Subject: =?UTF-8?B?${Buffer.from('Lumière').toString('base64')}?=`);
    const long = quotedPrintable('x'.repeat(300) + ' end');
    expect(long.split('\r\n').every((line) => line.length <= 76)).toBe(true);
    expect(decodeQp(long)).toBe('x'.repeat(300) + ' end');
    expect(quotedPrintable('trailing space ')).toBe('trailing space=20');
    expect(quotedPrintable('a=b')).toBe('a=3Db');
  });

  it('dot-stuffs every line that starts with a dot', () => {
    expect(dotStuff('.one\r\ntwo\r\n.three\n..four')).toBe('..one\r\ntwo\r\n..three\r\n...four');
  });
});

describe('SMTP client', () => {
  let server: FakeSmtp | null = null;
  afterEach(async () => {
    await server?.stop();
    server = null;
  });

  async function serve(options: FakeSmtpOptions): Promise<FakeSmtp> {
    server = new FakeSmtp(options);
    await server.start();
    return server;
  }

  const client = (security: SmtpClientOptions['security'], extra: Partial<SmtpClientOptions> = {}): SmtpClientOptions => ({
    host: '127.0.0.1',
    port: server!.port,
    security,
    user: 'info@lightup.ink',
    password: 'mailbox-password-not-real',
    timeoutMs: 2000,
    heloName: 'lightup.ink',
    ca: TEST_TLS.cert,
    ...extra,
  });

  const message = () => buildMessage(MAIL, CONTENT, new Date()).data;
  const envelope = { from: MAIL.from, to: MAIL.to };

  it('sends over TLS from the start, signs in with PLAIN, and the message arrives intact', async () => {
    const smtp = await serve({ security: 'tls', auth: { user: 'info@lightup.ink', password: 'mailbox-password-not-real' } });
    const data = message();
    await sendSmtp(client('tls'), envelope, data);
    expect(smtp.messages).toHaveLength(1);
    const [mail] = smtp.messages;
    expect(mail).toMatchObject({ from: MAIL.from, to: [MAIL.to], authUser: 'info@lightup.ink', encrypted: true });
    expect(`${mail!.data}\r\n`).toBe(data);
    expect(smtp.commands).toContain('AUTH PLAIN [hidden]');
  });

  it('upgrades with STARTTLS before signing in, and can use LOGIN', async () => {
    const smtp = await serve({ security: 'starttls', auth: { user: 'info@lightup.ink', password: 'mailbox-password-not-real' }, mechanisms: ['LOGIN'] });
    await sendSmtp(client('starttls'), envelope, message());
    expect(smtp.messages[0]).toMatchObject({ authUser: 'info@lightup.ink', encrypted: true });
    expect(smtp.commands.indexOf('STARTTLS')).toBeLessThan(smtp.commands.indexOf('AUTH LOGIN'));
  });

  it('refuses a certificate it does not trust, before any password is sent', async () => {
    const smtp = await serve({ security: 'tls', untrusted: true, auth: { user: 'u', password: 'p' } });
    await expect(sendSmtp(client('tls'), envelope, message())).rejects.toThrow(SmtpError);
    expect(smtp.commands.some((c) => c.startsWith('AUTH'))).toBe(false);
    expect(smtp.messages).toHaveLength(0);
  });

  it('refuses the certificate too when it arrives through STARTTLS', async () => {
    const smtp = await serve({ security: 'starttls', untrusted: true, auth: { user: 'u', password: 'p' } });
    await expect(sendSmtp(client('starttls'), envelope, message())).rejects.toThrow(/encryption/);
    expect(smtp.commands.some((c) => c.startsWith('AUTH'))).toBe(false);
  });

  it('stops when STARTTLS is required but not offered, and never sends the password', async () => {
    const smtp = await serve({ security: 'plain', auth: { user: 'u', password: 'p' } });
    await expect(sendSmtp(client('starttls'), envelope, message())).rejects.toThrow(/does not offer STARTTLS/);
    expect(smtp.commands.some((c) => c.startsWith('AUTH'))).toBe(false);
  });

  it('refuses replies slipped in before the TLS handshake', async () => {
    const smtp = await serve({ security: 'starttls', injectAfterStarttls: true, auth: { user: 'u', password: 'p' } });
    await expect(sendSmtp(client('starttls'), envelope, message())).rejects.toThrow(/before encryption started/);
    expect(smtp.messages).toHaveLength(0);
  });

  it('will not make an unencrypted connection to a server that is not on this computer', async () => {
    const options: SmtpClientOptions = { host: 'mail.privateemail.com', port: 25, security: 'plain', user: 'u', password: 'p', timeoutMs: 1000, heloName: 'lightup.ink' };
    await expect(sendSmtp(options, envelope, message())).rejects.toThrow(
      /unencrypted connection/,
    );
  });

  it('sends over plain SMTP to this computer, for development', async () => {
    const smtp = await serve({ security: 'plain' });
    await sendSmtp(client('plain', { user: null, password: null }), envelope, message());
    expect(smtp.messages[0]).toMatchObject({ authUser: null, encrypted: false });
  });

  it('tells a temporary refusal from a permanent one, and a refused sign-in from both', async () => {
    const auth = { user: 'info@lightup.ink', password: 'mailbox-password-not-real' };
    await serve({ security: 'tls', auth, failAt: { rcpt: '450 4.2.0 Mailbox busy' } });
    const temporary = await failure(sendSmtp(client('tls'), envelope, message()));
    expect(temporary).toMatchObject({ transient: true, replyCode: 450, authFailed: false });
    await server!.stop();

    await serve({ security: 'tls', auth, failAt: { rcpt: '550 5.1.1 No such user' } });
    const permanent = await failure(sendSmtp(client('tls'), envelope, message()));
    expect(permanent).toMatchObject({ transient: false, replyCode: 550 });
    await server!.stop();

    await serve({ security: 'tls', auth });
    const refused = await failure(sendSmtp(client('tls', { password: 'wrong' }), envelope, message()));
    expect(refused).toMatchObject({ authFailed: true, transient: true, replyCode: 535 });
    expect(String(refused.message)).not.toContain('wrong');
  });

  it('gives up on a server that never answers', async () => {
    await serve({ security: 'plain', silent: true });
    const error = await failure(sendSmtp(client('plain', { user: null, password: null, timeoutMs: 200 }), envelope, message()));
    expect(error).toMatchObject({ transient: true });
    expect(error.message).toMatch(/did not answer in time/);
  });

  it('refuses addresses that could inject SMTP commands', async () => {
    await serve({ security: 'plain' });
    await expect(sendSmtp(client('plain'), { from: MAIL.from, to: 'a@b.com>\r\nRCPT TO:<c@d.com' }, message())).rejects.toThrow(
      MailFormatError,
    );
    expect(server!.commands).toHaveLength(0);
  });
});

describe('mail outbox', () => {
  const setup = (sender: MailSender | null, hourlyLimit = 300) => {
    const clock = new FakeClock();
    const control = openControlDatabase(testConfig());
    const logger = createLogger({ level: 'silent', secrets: [] });
    const outbox = new MailOutbox(control, sender, clock, logger, { from: 'info@lightup.ink', fromName: 'Light Manager', hourlyLimit, pollMs: 1000 });
    const rows = () =>
      control.prepare('SELECT status, attempts, text_body, html_body, last_error FROM mail_outbox ORDER BY id').all() as {
        status: string;
        attempts: number;
        text_body: string | null;
        html_body: string | null;
      }[];
    return { clock, control, outbox, rows };
  };
  const queue = (outbox: MailOutbox, to = 'person@example.com', ttlMs = 30 * 60_000) =>
    outbox.enqueue({ to, kind: 'signup', content: { subject: 'S', text: 'link https://x/verify#t=secret', html: '<a>x</a>' }, ttlMs });

  it('sends, then clears the message text, which can hold a link', async () => {
    const sent: string[] = [];
    const { outbox, rows } = setup(async (_envelope, data) => void sent.push(data));
    queue(outbox);
    expect(await outbox.processDue()).toBe(1);
    expect(sent[0]).toContain('t=3Dsecret');
    expect(rows()[0]).toMatchObject({ status: 'sent', attempts: 1, text_body: null, html_body: null });
  });

  it('tries again later after a temporary failure, not before', async () => {
    let fail = true;
    const { clock, outbox, rows } = setup(async () => {
      if (fail) throw new SmtpError('busy', true, 451);
    });
    queue(outbox);
    expect(await outbox.processDue()).toBe(0);
    expect(rows()[0]).toMatchObject({ status: 'queued', attempts: 1 });
    clock.advance(30_000);
    fail = false;
    expect(await outbox.processDue()).toBe(0);
    clock.advance(31_000);
    expect(await outbox.processDue()).toBe(1);
    expect(rows()[0]).toMatchObject({ status: 'sent', attempts: 2 });
  });

  it('gives up on a permanent failure, and clears the text', async () => {
    const { outbox, rows } = setup(async () => {
      throw new SmtpError('no such user', false, 550);
    });
    queue(outbox);
    await outbox.processDue();
    expect(rows()[0]).toMatchObject({ status: 'failed', text_body: null, html_body: null });
  });

  it('keeps within the hourly limit, and sends the rest the next hour', async () => {
    const { clock, outbox, rows } = setup(async () => undefined, 2);
    for (let i = 0; i < 3; i += 1) queue(outbox, `p${i}@example.com`, 3 * 3600_000);
    expect(await outbox.processDue()).toBe(2);
    expect(rows().map((r) => r.status)).toEqual(['sent', 'sent', 'queued']);
    clock.advance(3600_000 + 1);
    expect(await outbox.processDue()).toBe(1);
  });

  it('drops a message whose link expired before it could be sent', async () => {
    const { clock, outbox, rows } = setup(async () => undefined);
    queue(outbox, 'late@example.com', 60_000);
    clock.advance(60_001);
    expect(await outbox.processDue()).toBe(0);
    expect(rows()[0]).toMatchObject({ status: 'expired', text_body: null });
  });

  it('pauses everything when the mail server refuses the app\'s sign-in', async () => {
    let calls = 0;
    const { clock, outbox } = setup(async () => {
      calls += 1;
      throw new SmtpError('refused', true, 535, true);
    });
    queue(outbox, 'a@example.com');
    queue(outbox, 'b@example.com');
    await outbox.processDue();
    expect(calls).toBe(1);
    clock.advance(10 * 60_000);
    await outbox.processDue();
    expect(calls).toBe(1);
  });

  it('sends nothing when mail is not set up, and keeps the message waiting', async () => {
    const { outbox, rows } = setup(null);
    queue(outbox);
    expect(outbox.configured()).toBe(false);
    expect(await outbox.processDue()).toBe(0);
    expect(rows()[0]).toMatchObject({ status: 'queued' });
  });

  it('puts a message caught mid-send by a crash back in the queue', async () => {
    const { control, outbox, rows } = setup(async () => undefined);
    queue(outbox);
    control.prepare("UPDATE mail_outbox SET status = 'sending'").run();
    outbox.start();
    await outbox.stop();
    expect(rows()[0]!.status).not.toBe('sending');
  });
});

describe('proof of work', () => {
  it('accepts a correct answer once, and nothing else', () => {
    const clock = new FakeClock();
    const pow = new ProofOfWork(clock, 8);
    const { challenge, difficulty } = pow.issue();
    expect(difficulty).toBe(8);
    const nonce = solveChallenge(challenge, difficulty);
    // An answer that does not meet the difficulty: the first number that fails.
    let wrong = 0;
    while (leadingZeroBits(createHash('sha256').update(`${challenge}:${wrong}`).digest()) >= difficulty) wrong += 1;
    expect(pow.verify(challenge, String(wrong))).toBe(false);
    expect(pow.verify(challenge, 'abc')).toBe(false);
    expect(pow.verify(challenge, nonce)).toBe(true);
    expect(pow.verify(challenge, nonce)).toBe(false);
  });

  it('refuses expired, altered, foreign and too-easy challenges', () => {
    const clock = new FakeClock();
    const pow = new ProofOfWork(clock, 6);
    const expiring = pow.issue();
    clock.advance(10 * 60_000 + 1);
    expect(pow.verify(expiring.challenge, solveChallenge(expiring.challenge, 6))).toBe(false);

    const real = pow.issue().challenge;
    const parts = real.split('.');
    const easier = [parts[0], parts[1], '1', parts[3], parts[4]].join('.');
    expect(pow.verify(easier, solveChallenge(easier, 1))).toBe(false);

    const other = new ProofOfWork(clock, 6).issue().challenge;
    expect(pow.verify(other, solveChallenge(other, 6))).toBe(false);

    const strict = new ProofOfWork(clock, 6);
    const weak = new ProofOfWork(clock, 2);
    expect(strict.verify(weak.issue().challenge, '0')).toBe(false);
  });

  it('counts leading zero bits', () => {
    expect(leadingZeroBits(new Uint8Array([0, 0, 0x10]))).toBe(19);
    expect(leadingZeroBits(new Uint8Array([0x80]))).toBe(0);
    expect(leadingZeroBits(new Uint8Array([0, 1]))).toBe(15);
  });
});

describe('mail configuration', () => {
  const env = (extra: NodeJS.ProcessEnv) => () => testConfig({ SMTP_USER: 'info@lightup.ink', SMTP_PASSWORD: 'x', ...extra });

  it('accepts Private Email, with TLS on 465 by default and STARTTLS on 587', () => {
    expect(env({ SMTP_HOST: 'mail.privateemail.com' })().mail.smtp).toMatchObject({ port: 465, security: 'tls' });
    expect(env({ SMTP_HOST: 'mail.privateemail.com', SMTP_PORT: '587' })().mail.smtp).toMatchObject({ security: 'starttls' });
    expect(env({ SMTP_HOST: 'mail.privateemail.com' })().mail.from).toBe('info@lightup.ink');
  });

  it('refuses any other mail server, so the password cannot be sent elsewhere', () => {
    expect(env({ SMTP_HOST: 'smtp.evil.example' })).toThrow(ConfigError);
    expect(env({ SMTP_HOST: 'mail.privateemail.com.evil.example' })).toThrow(ConfigError);
  });

  it('allows plain SMTP only to this computer, and needs both parts of the login', () => {
    expect(env({ SMTP_HOST: 'mail.privateemail.com', SMTP_SECURITY: 'plain' })).toThrow(/only allowed for a mail server on this computer/);
    expect(() => testConfig({ SMTP_HOST: 'mail.privateemail.com', SMTP_USER: 'info@lightup.ink' })).toThrow(/both/);
    expect(() => testConfig({ SMTP_PASSWORD: 'x' })).toThrow(/SMTP_HOST is not/);
    expect(testConfig({ SMTP_HOST: '127.0.0.1', SMTP_SECURITY: 'plain', SMTP_PORT: '2525', MAIL_FROM: 'dev@localhost.test' }).mail.smtp).toMatchObject({
      security: 'plain',
      user: null,
    });
    expect(() => testConfig({ SMTP_HOST: '127.0.0.1', MAIL_FROM: 'not an address' })).toThrow(/MAIL_FROM/);
  });

  it('never puts a value in a configuration error, and hides the mailbox password from logs', () => {
    const secret = 'mailbox-secret-c1d2e3';
    try {
      testConfig({ SMTP_HOST: 'smtp.evil.example', SMTP_USER: 'info@lightup.ink', SMTP_PASSWORD: secret });
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
    const config = testConfig({ SMTP_HOST: 'mail.privateemail.com', SMTP_USER: 'info@lightup.ink', SMTP_PASSWORD: secret });
    expect(configSecrets(config)).toContain(secret);
  });

  it('builds links from PUBLIC_URL, refusing plain http except on this computer', () => {
    expect(testConfig({ PUBLIC_URL: 'https://lightup.ink/' }).publicUrl).toBe('https://lightup.ink');
    expect(testConfig({ ALLOWED_HOSTS: 'lightup.ink,glmserver-production.up.railway.app' }).publicUrl).toBe('https://lightup.ink');
    expect(() => testConfig({ PUBLIC_URL: 'http://lightup.ink' })).toThrow(ConfigError);
    expect(testConfig({ PUBLIC_URL: 'http://localhost:5173' }).publicUrl).toBe('http://localhost:5173');
  });
});
