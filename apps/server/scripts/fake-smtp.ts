import { FakeSmtp, linkIn } from '../tests/support/fake-smtp.js';

/**
 * A mail server on this computer for `npm run dev:mock`, so sign-up and password reset can be
 * tried with no real mailbox. It prints each message's link. Development only: it is not part
 * of the production build, and the app refuses plain SMTP to any other host.
 */
const PORT = Number(process.env.FAKE_SMTP_PORT ?? 2525);
const smtp = new FakeSmtp({ security: 'plain' });
await smtp.start(PORT);
console.log(`Fake mail server on 127.0.0.1:${PORT}. Links from sign-up and reset emails appear here.`);

let shown = 0;
setInterval(() => {
  for (const mail of smtp.messages.slice(shown)) {
    const subject = /^Subject: (.*)$/m.exec(mail.data)?.[1] ?? '(no subject)';
    let link = '(no link)';
    try {
      link = linkIn(mail);
    } catch {
      // Notices carry no link.
    }
    console.log(`\nTo: ${mail.to.join(', ')}\nSubject: ${subject}\n${link}`);
  }
  shown = smtp.messages.length;
}, 500);
