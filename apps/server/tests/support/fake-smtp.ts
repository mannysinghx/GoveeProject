import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import tls from 'node:tls';
import { fileURLToPath } from 'node:url';

/**
 * A stand-in mail server for tests and development, like the Govee mock. It speaks enough
 * SMTP for the app's client, records every message, and can be told to misbehave.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
/** A self-signed certificate for localhost, made for these tests only. See smtp-tls/README.md. */
export const TEST_TLS = {
  cert: fs.readFileSync(path.join(here, 'smtp-tls/trusted-cert.pem')),
  key: fs.readFileSync(path.join(here, 'smtp-tls/trusted-key.pem')),
  untrustedCert: fs.readFileSync(path.join(here, 'smtp-tls/untrusted-cert.pem')),
  untrustedKey: fs.readFileSync(path.join(here, 'smtp-tls/untrusted-key.pem')),
};

export interface ReceivedMail {
  from: string;
  to: string[];
  /** The message as sent, with dot-stuffing undone. */
  data: string;
  authUser: string | null;
  encrypted: boolean;
}

export interface FakeSmtpOptions {
  security?: 'plain' | 'starttls' | 'tls';
  /** Offer STARTTLS on a plain connection. Defaults to true for "starttls". */
  advertiseStarttls?: boolean;
  /** Use the certificate the client does not trust. */
  untrusted?: boolean;
  auth?: { user: string; password: string } | null;
  mechanisms?: ('PLAIN' | 'LOGIN')[];
  /** Answer a stage with this reply instead, such as { rcpt: '450 4.2.0 Try later' }. */
  failAt?: Partial<Record<'greeting' | 'ehlo' | 'auth' | 'mail' | 'rcpt' | 'data' | 'end', string>>;
  /** Send a stray reply right after "220" to STARTTLS, as a man-in-the-middle would. */
  injectAfterStarttls?: boolean;
  /** Accept connections but never answer. */
  silent?: boolean;
}

export class FakeSmtp {
  readonly messages: ReceivedMail[] = [];
  /** Every command line received, with AUTH data hidden. */
  readonly commands: string[] = [];
  private server: net.Server | null = null;
  private readonly sockets = new Set<net.Socket>();
  port = 0;
  private waiters: (() => void)[] = [];

  constructor(public options: FakeSmtpOptions = {}) {}

  private pair(): { cert: Buffer; key: Buffer } {
    return this.options.untrusted ? { cert: TEST_TLS.untrustedCert, key: TEST_TLS.untrustedKey } : { cert: TEST_TLS.cert, key: TEST_TLS.key };
  }

  private context(): tls.SecureContext {
    return tls.createSecureContext(this.pair());
  }

  async start(port = 0): Promise<void> {
    const onConnection = (socket: net.Socket) => this.session(socket, this.options.security === 'tls');
    this.server =
      this.options.security === 'tls'
        ? tls.createServer(this.pair(), onConnection)
        : net.createServer(onConnection);
    this.server.on('tlsClientError', () => undefined);
    await new Promise<void>((resolve) => this.server!.listen(port, '127.0.0.1', resolve));
    this.port = (this.server.address() as net.AddressInfo).port;
  }

  async stop(): Promise<void> {
    for (const socket of this.sockets) socket.destroy();
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
  }

  /** Resolves once `count` messages have arrived in total. */
  async waitFor(count: number, timeoutMs = 5000): Promise<ReceivedMail[]> {
    const deadline = Date.now() + timeoutMs;
    while (this.messages.length < count) {
      if (Date.now() > deadline) throw new Error(`Expected ${count} messages, got ${this.messages.length}`);
      await new Promise<void>((resolve) => {
        this.waiters.push(resolve);
        setTimeout(resolve, 50);
      });
    }
    return this.messages;
  }

  private session(initial: net.Socket, encrypted: boolean): void {
    let socket: net.Socket = initial;
    this.sockets.add(initial);
    socket.on('error', () => undefined);
    if (this.options.silent) return;

    const opts = this.options;
    const offerStarttls = !encrypted && (opts.advertiseStarttls ?? opts.security === 'starttls');
    let buffer = '';
    let inData = false;
    let dataLines: string[] = [];
    let from = '';
    let to: string[] = [];
    let authUser: string | null = null;
    let loginStep: 'user' | 'password' | null = null;
    let loginUser = '';
    const send = (line: string) => socket.write(`${line}\r\n`);
    const fail = (stage: keyof NonNullable<FakeSmtpOptions['failAt']>) => {
      const reply = opts.failAt?.[stage];
      if (reply) send(reply);
      return Boolean(reply);
    };

    const checkAuth = (user: string, password: string) => {
      if (fail('auth')) return;
      if (opts.auth && user === opts.auth.user && password === opts.auth.password) {
        authUser = user;
        send('235 2.7.0 Authentication successful');
      } else {
        send('535 5.7.8 Authentication failed');
      }
    };

    const handle = (line: string) => {
      if (inData) {
        if (line === '.') {
          inData = false;
          if (fail('end')) return;
          this.messages.push({ from, to, data: dataLines.join('\r\n'), authUser, encrypted });
          for (const waiter of this.waiters.splice(0)) waiter();
          send('250 2.0.0 Queued');
          return;
        }
        dataLines.push(line.startsWith('..') ? line.slice(1) : line);
        return;
      }
      if (loginStep) {
        const value = Buffer.from(line, 'base64').toString('utf8');
        this.commands.push('[auth data]');
        if (loginStep === 'user') {
          loginUser = value;
          loginStep = 'password';
          send('334 UGFzc3dvcmQ6');
        } else {
          loginStep = null;
          checkAuth(loginUser, value);
        }
        return;
      }
      const upper = line.toUpperCase();
      this.commands.push(upper.startsWith('AUTH PLAIN ') ? 'AUTH PLAIN [hidden]' : line);
      if (upper.startsWith('EHLO ')) {
        if (fail('ehlo')) return;
        const caps = ['250-fake.smtp.test greets you'];
        if (offerStarttls) caps.push('250-STARTTLS');
        if (opts.auth) caps.push(`250-AUTH ${(opts.mechanisms ?? ['PLAIN', 'LOGIN']).join(' ')}`);
        caps.push('250 8BITMIME');
        socket.write(caps.map((c) => `${c}\r\n`).join(''));
      } else if (upper === 'STARTTLS' && offerStarttls) {
        socket.write(opts.injectAfterStarttls ? '220 2.0.0 Ready\r\n250 injected\r\n' : '220 2.0.0 Ready\r\n');
        socket.removeAllListeners('data');
        const secure = new tls.TLSSocket(socket, { isServer: true, secureContext: this.context() });
        secure.on('error', () => undefined);
        this.sockets.add(secure);
        socket = secure;
        encrypted = true;
        buffer = '';
        socket.on('data', onData);
      } else if (upper.startsWith('AUTH PLAIN ')) {
        const [, user = '', password = ''] = Buffer.from(line.slice(11), 'base64').toString('utf8').split('\0');
        checkAuth(user, password);
      } else if (upper === 'AUTH LOGIN') {
        loginStep = 'user';
        send('334 VXNlcm5hbWU6');
      } else if (upper.startsWith('MAIL FROM:')) {
        if (opts.auth && !authUser) return send('530 5.7.0 Authentication required');
        if (fail('mail')) return;
        from = line.slice(10).replace(/[<>]/g, '');
        to = [];
        send('250 2.1.0 OK');
      } else if (upper.startsWith('RCPT TO:')) {
        if (fail('rcpt')) return;
        to.push(line.slice(8).replace(/[<>]/g, ''));
        send('250 2.1.5 OK');
      } else if (upper === 'DATA') {
        if (fail('data')) return;
        inData = true;
        dataLines = [];
        send('354 End data with <CR><LF>.<CR><LF>');
      } else if (upper === 'QUIT') {
        send('221 2.0.0 Bye');
        socket.end();
      } else {
        send('502 5.5.2 Command not recognized');
      }
    };

    const onData = (chunk: Buffer) => {
      buffer += chunk.toString('latin1');
      let index: number;
      while ((index = buffer.indexOf('\r\n')) !== -1) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        handle(line);
      }
    };
    socket.on('data', onData);
    if (!fail('greeting')) send('220 fake.smtp.test ESMTP ready');
  }
}

/** The link in a received message, such as https://lightup.ink/verify#t=... */
export function linkIn(mail: ReceivedMail): string {
  const decoded = mail.data.replace(/=\r\n/g, '').replace(/=([0-9A-F]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
  const match = /https?:\/\/[^\s"<]+#t=[A-Za-z0-9_-]+/.exec(decoded);
  if (!match) throw new Error('No link in that message');
  return match[0];
}

export const tokenIn = (mail: ReceivedMail) => linkIn(mail).split('#t=')[1]!;
