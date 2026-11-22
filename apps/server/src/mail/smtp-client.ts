import net from 'node:net';
import tls from 'node:tls';
import { isLoopbackHost, type SmtpConfig } from '../config/env.js';
import { assertSafeAddress, dotStuff } from './message.js';

/**
 * A small SMTP client (RFC 5321) for handing mail to one mail server, built on node:net and
 * node:tls. It does only what sending a message needs: EHLO, STARTTLS, AUTH PLAIN or LOGIN,
 * MAIL, RCPT, DATA and QUIT.
 *
 * - Certificates are always checked. There is no option to turn that off.
 * - The password is only sent over TLS, except to a server on this computer.
 * - After STARTTLS, anything the server sent before the handshake is refused, so a
 *   man-in-the-middle cannot slip in replies that the encrypted session would then trust.
 */

export interface SmtpClientOptions extends SmtpConfig {
  /** The name given in EHLO, such as lightup.ink. */
  heloName: string;
  /** Tests only: a certificate authority to trust, for the local test server. */
  ca?: string | Buffer;
}

export class SmtpError extends Error {
  constructor(
    message: string,
    /** True when trying again later may work: a 4xx reply, a timeout or a dropped connection. */
    readonly transient: boolean,
    readonly replyCode: number | null = null,
    /** Signing in was refused. Every message would fail the same way until the login is fixed. */
    readonly authFailed = false,
  ) {
    super(message);
    this.name = 'SmtpError';
  }
}

interface Reply {
  code: number;
  lines: string[];
}

const MAX_REPLY_BYTES = 64 * 1024;

/** Server text in errors is cut short and kept to printable characters. */
function describe(reply: Reply): string {
  return `${reply.code} ${reply.lines.join(' ').replace(/[^\x20-\x7e]/g, '?').slice(0, 200)}`;
}

class Connection {
  private socket: net.Socket | tls.TLSSocket;
  private buffer = '';
  private waiting: { resolve: (reply: Reply) => void; reject: (error: Error) => void } | null = null;
  private failure: Error | null = null;
  private readonly onData = (chunk: Buffer) => {
    this.buffer += chunk.toString('latin1');
    if (this.buffer.length > MAX_REPLY_BYTES) this.fail(new SmtpError('The mail server sent too much at once.', true));
    this.deliver();
  };
  private readonly onError = (error: Error) => this.fail(new SmtpError(`Connection to the mail server failed: ${error.message}`, true));
  private readonly onClose = () => this.fail(new SmtpError('The mail server closed the connection.', true));
  private readonly onTimeout = () => {
    this.fail(new SmtpError('The mail server did not answer in time.', true));
    this.socket.destroy();
  };

  constructor(socket: net.Socket | tls.TLSSocket, private readonly timeoutMs: number) {
    this.socket = socket;
    this.attach();
  }

  get encrypted(): boolean {
    return this.socket instanceof tls.TLSSocket && this.socket.encrypted === true;
  }

  private attach(): void {
    this.socket.setTimeout(this.timeoutMs);
    this.socket.on('data', this.onData);
    this.socket.on('error', this.onError);
    this.socket.on('close', this.onClose);
    this.socket.on('timeout', this.onTimeout);
  }

  private detach(): void {
    this.socket.off('data', this.onData);
    this.socket.off('error', this.onError);
    this.socket.off('close', this.onClose);
    this.socket.off('timeout', this.onTimeout);
  }

  private fail(error: Error): void {
    this.failure ??= error;
    const waiting = this.waiting;
    this.waiting = null;
    waiting?.reject(this.failure);
  }

  /** A complete reply is lines of "NNN-text" ending with one "NNN text". */
  private parse(): Reply | null {
    const lines: string[] = [];
    let offset = 0;
    for (;;) {
      const end = this.buffer.indexOf('\n', offset);
      if (end === -1) return null;
      const line = this.buffer.slice(offset, end).replace(/\r$/, '');
      offset = end + 1;
      const match = /^(\d{3})([ -])(.*)$/.exec(line) ?? /^(\d{3})()()$/.exec(line);
      if (!match) {
        this.fail(new SmtpError('The mail server sent a reply this client cannot read.', true));
        return null;
      }
      lines.push(match[3] ?? '');
      if (match[2] !== '-') {
        this.buffer = this.buffer.slice(offset);
        return { code: Number(match[1]), lines };
      }
    }
  }

  private deliver(): void {
    if (!this.waiting) return;
    const reply = this.parse();
    if (!reply) return;
    const waiting = this.waiting;
    this.waiting = null;
    waiting.resolve(reply);
  }

  read(): Promise<Reply> {
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      this.waiting = { resolve, reject };
      this.deliver();
    });
  }

  write(text: string): void {
    if (this.failure) return;
    this.socket.write(text, 'latin1');
  }

  async command(line: string, expect: number[]): Promise<Reply> {
    this.write(`${line}\r\n`);
    return this.expect(expect);
  }

  async expect(expect: number[]): Promise<Reply> {
    const reply = await this.read();
    if (!expect.includes(reply.code)) {
      throw new SmtpError(`The mail server refused: ${describe(reply)}`, reply.code >= 400 && reply.code < 500, reply.code);
    }
    return reply;
  }

  /** Swaps the plain socket for TLS over it. Anything already buffered is refused. */
  async upgrade(options: tls.ConnectionOptions): Promise<void> {
    if (this.buffer.length > 0) {
      throw new SmtpError('The mail server sent data before encryption started. Refusing to continue.', false);
    }
    this.detach();
    const plain = this.socket;
    const secure = await new Promise<tls.TLSSocket>((resolve, reject) => {
      const timer = setTimeout(() => {
        plain.destroy();
        reject(new SmtpError('Timed out starting encryption with the mail server.', true));
      }, this.timeoutMs);
      const socket = tls.connect({ ...options, socket: plain }, () => {
        clearTimeout(timer);
        resolve(socket);
      });
      socket.once('error', (error) => {
        clearTimeout(timer);
        reject(new SmtpError(`Could not start encryption with the mail server: ${error.message}`, true));
      });
    });
    this.socket = secure;
    this.attach();
  }

  close(): void {
    this.detach();
    this.socket.on('error', () => undefined);
    this.socket.end();
    this.socket.destroy();
  }
}

function tlsOptions(options: SmtpClientOptions): tls.ConnectionOptions {
  return {
    host: options.host,
    // SNI takes a name, never an address.
    ...(net.isIP(options.host) === 0 ? { servername: options.host } : {}),
    rejectUnauthorized: true,
    minVersion: 'TLSv1.2',
    ...(options.ca ? { ca: options.ca } : {}),
  };
}

async function open(options: SmtpClientOptions): Promise<Connection> {
  return new Promise((resolve, reject) => {
    // With TLS from the start, "connected" means the handshake and certificate check passed.
    const socket =
      options.security === 'tls'
        ? tls.connect({ ...tlsOptions(options), port: options.port }, () => ready())
        : net.connect({ host: options.host, port: options.port }, () => ready());
    const timer = setTimeout(() => {
      socket.off('error', failed);
      socket.on('error', () => undefined);
      socket.destroy();
      reject(new SmtpError('Timed out connecting to the mail server.', true));
    }, options.timeoutMs);
    function failed(error: Error) {
      clearTimeout(timer);
      reject(new SmtpError(`Could not connect to the mail server: ${error.message}`, true));
    }
    function ready() {
      clearTimeout(timer);
      socket.off('error', failed);
      resolve(new Connection(socket, options.timeoutMs));
    }
    socket.once('error', failed);
  });
}

function capabilities(reply: Reply): Set<string> {
  // The first line is the server's greeting name. The rest are keywords, with arguments.
  return new Set(reply.lines.slice(1).map((line) => line.trim().toUpperCase()));
}

function authMechanisms(caps: Set<string>): Set<string> {
  const mechanisms = new Set<string>();
  for (const cap of caps) {
    if (cap.startsWith('AUTH ') || cap.startsWith('AUTH=')) {
      for (const name of cap.slice(5).split(/\s+/)) mechanisms.add(name);
    }
  }
  return mechanisms;
}

/** Sends one message to one recipient. Resolves once the server has accepted it. */
export async function sendSmtp(options: SmtpClientOptions, envelope: { from: string; to: string }, data: string): Promise<void> {
  assertSafeAddress(envelope.from, 'The sender');
  assertSafeAddress(envelope.to, 'The recipient');
  if (/[\r\n]/.test(options.heloName)) throw new SmtpError('The EHLO name contains a line break.', false);
  if (options.security === 'plain' && !isLoopbackHost(options.host)) {
    throw new SmtpError('Refusing an unencrypted connection to a mail server that is not on this computer.', false);
  }

  const connection = await open(options);
  try {
    await connection.expect([220]);
    let caps = capabilities(await connection.command(`EHLO ${options.heloName}`, [250]));

    if (options.security === 'starttls') {
      if (!caps.has('STARTTLS')) {
        throw new SmtpError('The mail server does not offer STARTTLS, so the connection would not be encrypted.', false);
      }
      await connection.command('STARTTLS', [220]);
      await connection.upgrade(tlsOptions(options));
      caps = capabilities(await connection.command(`EHLO ${options.heloName}`, [250]));
    }

    if (options.user !== null && options.password !== null) {
      if (!connection.encrypted && !isLoopbackHost(options.host)) {
        throw new SmtpError('Refusing to send the mailbox password over an unencrypted connection.', false);
      }
      const mechanisms = authMechanisms(caps);
      try {
        if (mechanisms.has('PLAIN')) {
          const token = Buffer.from(`\0${options.user}\0${options.password}`, 'utf8').toString('base64');
          await connection.command(`AUTH PLAIN ${token}`, [235]);
        } else if (mechanisms.has('LOGIN')) {
          await connection.command('AUTH LOGIN', [334]);
          await connection.command(Buffer.from(options.user, 'utf8').toString('base64'), [334]);
          await connection.command(Buffer.from(options.password, 'utf8').toString('base64'), [235]);
        } else {
          throw new SmtpError('The mail server offers no sign-in method this client supports.', false);
        }
      } catch (error) {
        if (error instanceof SmtpError && error.replyCode !== null) {
          throw new SmtpError('The mail server refused the SMTP_USER and SMTP_PASSWORD sign-in.', true, error.replyCode, true);
        }
        throw error;
      }
    }

    await connection.command(`MAIL FROM:<${envelope.from}>`, [250]);
    await connection.command(`RCPT TO:<${envelope.to}>`, [250, 251]);
    await connection.command('DATA', [354]);
    const body = dotStuff(data);
    connection.write(body.endsWith('\r\n') ? body : `${body}\r\n`);
    await connection.command('.', [250]);
    try {
      await connection.command('QUIT', [221]);
    } catch {
      // The message was already accepted. A messy goodbye changes nothing.
    }
  } finally {
    connection.close();
  }
}
