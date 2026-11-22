import type { MailContent } from './message.js';

/**
 * The emails the app sends. All transactional: one person, one reason, no tracking pixels or
 * outside images. Every value put into the HTML is escaped.
 */

export const APP_NAME = 'Light Manager';

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function layout(paragraphs: string[], button?: { label: string; href: string }): string {
  const body = paragraphs.map((p) => `<p style="margin:0 0 16px">${escapeHtml(p)}</p>`).join('');
  const action = button
    ? `<p style="margin:0 0 24px"><a href="${escapeHtml(button.href)}" style="display:inline-block;padding:10px 18px;background:#b45309;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600">${escapeHtml(button.label)}</a></p>` +
      `<p style="margin:0 0 16px;font-size:13px;color:#555">If the button does not work, copy this address into your browser:<br><span style="word-break:break-all">${escapeHtml(button.href)}</span></p>`
    : '';
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f6f6f6;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111;line-height:1.5"><div style="max-width:520px;margin:0 auto;background:#fff;padding:24px;border-radius:8px">${body}${action}<p style="margin:24px 0 0;font-size:12px;color:#777">${escapeHtml(APP_NAME)}</p></div></body></html>`;
}

function mail(subject: string, paragraphs: string[], button?: { label: string; href: string }): MailContent {
  const text = [...paragraphs, ...(button ? [`${button.label}: ${button.href}`] : []), APP_NAME].join('\n\n');
  return { subject, text, html: layout(paragraphs, button) };
}

const IGNORE = 'If you did not ask for this, you can ignore this email. Nothing changes unless the link is used.';

export function signupMail(link: string, minutes: number): MailContent {
  return mail(
    `Finish creating your ${APP_NAME} account`,
    [
      `Someone, hopefully you, asked to create a ${APP_NAME} account with this address.`,
      `Open the link below to choose a password. It works once, for ${minutes} minutes.`,
      IGNORE,
    ],
    { label: 'Choose a password', href: link },
  );
}

export function alreadyRegisteredMail(loginLink: string, forgotLink: string): MailContent {
  return mail(
    `You already have a ${APP_NAME} account`,
    [
      `Someone asked to create a ${APP_NAME} account with this address, but it already has one, so no new account was made.`,
      `To sign in, go to ${loginLink}. If you have forgotten your password, you can reset it at ${forgotLink}.`,
      'If this was not you, you can ignore this email. Your account has not changed.',
    ],
  );
}

export function resetMail(link: string, minutes: number): MailContent {
  return mail(
    `Reset your ${APP_NAME} password`,
    [
      `Someone, hopefully you, asked to reset the password for the ${APP_NAME} account at this address.`,
      `Open the link below to choose a new one. It works once, for ${minutes} minutes. Resetting signs you out everywhere.`,
      'If you did not ask for this, ignore this email. Your password stays the same.',
    ],
    { label: 'Choose a new password', href: link },
  );
}

export function emailChangeMail(link: string, minutes: number): MailContent {
  return mail(
    `Confirm your new ${APP_NAME} sign-in address`,
    [
      `Someone signed in to ${APP_NAME} asked to use this address to sign in.`,
      `Open the link below to confirm it. It works once, for ${minutes} minutes.`,
      IGNORE,
    ],
    { label: 'Confirm this address', href: link },
  );
}

export function emailChangedNotice(newEmail: string): MailContent {
  return mail(`Your ${APP_NAME} sign-in address was changed`, [
    `The sign-in address for your ${APP_NAME} account was changed to ${newEmail}. You will now sign in with that address.`,
    'If you did not make this change, reset your password from the new address, or contact the person who runs this site.',
  ]);
}
