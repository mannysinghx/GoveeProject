import crypto from 'node:crypto';

/**
 * Builds RFC 5322 messages: a plain-text and an HTML version, each quoted-printable, so any
 * text is safe on the wire. Every header value is checked, and a line break in one is refused
 * rather than cleaned, so header injection cannot happen quietly.
 */

export interface MailContent {
  subject: string;
  text: string;
  html: string;
}

export interface MailEnvelope {
  /** The bare sender address, such as info@lightup.ink. */
  from: string;
  fromName: string;
  to: string;
}

export class MailFormatError extends Error {}

/** ASCII, no spaces, no angle brackets, no line breaks: safe inside <...> in SMTP and headers. */
const SAFE_ADDRESS = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[A-Za-z0-9.-]{1,253}$/;

export function assertSafeAddress(address: string, what: string): void {
  if (!SAFE_ADDRESS.test(address)) throw new MailFormatError(`${what} is not a plain email address.`);
}

function assertHeaderValue(value: string, what: string): void {
  if (/[\r\n\0]/.test(value)) throw new MailFormatError(`${what} contains a line break.`);
}

/** An encoded word (RFC 2047) when the text is not plain printable ASCII. */
function encodeHeaderText(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

/** A display name, quoted, with quotes and backslashes escaped. */
function encodeDisplayName(name: string): string {
  if (/^[\x20-\x7e]*$/.test(name)) return `"${name.replace(/["\\]/g, (c) => `\\${c}`)}"`;
  return encodeHeaderText(name);
}

/** RFC 5322 date, in UTC. */
export function formatMailDate(date: Date): string {
  return date.toUTCString().replace(/GMT$/, '+0000');
}

/**
 * Quoted-printable (RFC 2045): printable ASCII stays as it is, everything else becomes =XX,
 * and lines are kept under 76 characters with soft breaks. Line breaks become CRLF.
 */
export function quotedPrintable(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  for (const line of lines) {
    const bytes = Buffer.from(line, 'utf8');
    let current = '';
    for (let i = 0; i < bytes.length; i += 1) {
      const byte = bytes[i]!;
      const last = i === bytes.length - 1;
      let piece: string;
      if ((byte >= 33 && byte <= 126 && byte !== 61) || ((byte === 32 || byte === 9) && !last)) {
        piece = String.fromCharCode(byte);
      } else {
        piece = `=${byte.toString(16).toUpperCase().padStart(2, '0')}`;
      }
      if (current.length + piece.length > 75) {
        out.push(`${current}=`);
        current = '';
      }
      current += piece;
    }
    out.push(current);
  }
  return out.join('\r\n');
}

export interface BuiltMessage {
  messageId: string;
  /** The whole message, CRLF line endings, before SMTP dot-stuffing. */
  data: string;
}

export function buildMessage(envelope: MailEnvelope, content: MailContent, date: Date): BuiltMessage {
  assertSafeAddress(envelope.from, 'The sender');
  assertSafeAddress(envelope.to, 'The recipient');
  assertHeaderValue(envelope.fromName, 'The sender name');
  assertHeaderValue(content.subject, 'The subject');

  const domain = envelope.from.split('@')[1]!;
  const messageId = `<${crypto.randomBytes(16).toString('hex')}@${domain}>`;
  const boundary = `glm-${crypto.randomBytes(12).toString('hex')}`;

  const headers = [
    `From: ${encodeDisplayName(envelope.fromName)} <${envelope.from}>`,
    `To: <${envelope.to}>`,
    `Subject: ${encodeHeaderText(content.subject)}`,
    `Date: ${formatMailDate(date)}`,
    `Message-ID: ${messageId}`,
    'MIME-Version: 1.0',
    // Automatic mail (RFC 3834): out-of-office replies are not sent back to it.
    'Auto-Submitted: auto-generated',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];
  const part = (type: string, body: string) =>
    [`--${boundary}`, `Content-Type: ${type}; charset=utf-8`, 'Content-Transfer-Encoding: quoted-printable', '', quotedPrintable(body)].join('\r\n');

  const data = [
    ...headers,
    '',
    part('text/plain', content.text),
    part('text/html', content.html),
    `--${boundary}--`,
    '',
  ].join('\r\n');
  return { messageId, data };
}

/** SMTP's DATA ending is a line holding a single dot, so a line starting with a dot gets another. */
export function dotStuff(data: string): string {
  const normalized = data.replace(/\r\n?|\n/g, '\r\n');
  return normalized.replace(/(^|\r\n)\./g, '$1..');
}
