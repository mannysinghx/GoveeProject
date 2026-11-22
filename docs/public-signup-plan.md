# Opening lightup.ink to the public: email sign-up and bring-your-own AI key

**Status: a plan only. Nothing here is built, and production was not changed.**
Written 21 November 2026, against `cca931a` on `claude/public-registration-email-verify-d03096`. Line references are to that commit.

This builds on [multi-user-plan.md](multi-user-plan.md) (7 November), which designed invite-only accounts and was put on hold on 9 November. The owner has now asked for **open sign-up**:

1. Anyone can register with an email address.
2. The address is verified by a link sent to that inbox.
3. Only then are they asked for a password.
4. Then they are sent to sign in with the new email and password.
5. **Nothing third-party.** Everything is built in-house.
6. Each person may add their **own LLM API key** for the AI features. Without one, AI is off for them.

## The short version

- **Sign-up, verification, passwords and sessions** can all be built in-house with **no new dependencies.** The project already has Argon2id hashing, hashed session tokens, CSRF, and deny-by-default routes. About a week of work.
- **The large part is not sign-up. It is giving each person their own lights.** Today the whole server is one person: one `users` row, one Govee key from an environment variable, one set of services. A stranger who registers today would see and control **the owner's lights**. Opening sign-up without the per-account split from the multi-user plan would be a serious breach. That split is about 2 to 3 weeks of work.
- **Email is the one part that cannot be fully self-contained.** The app can build, sign and send each message itself. But a message still has to be handed to a mail server, and **Railway blocks outbound SMTP below the Pro plan** ([Railway docs](https://docs.railway.com/networking/outbound-networking#email-delivery)). Recommendation: an in-house SMTP client that hands mail to a mailbox the owner already runs for `lightup.ink`. See [Email, built in-house](#email-built-in-house).
- **Bring-your-own AI key** is small, about 2 to 3 days. But today's AI code has three process-wide pieces of state that would let one person block or break AI for everyone. They must become per-person first.

## What the code does today (checked at `cca931a`)

| # | Finding | Where | Why it matters for public sign-up |
|---|---|---|---|
| 1 | The `users` table allows only `id = 1`, and auth code hard-codes that id in 6 places | `migrations/001_initial.sql:6`, `apps/server/src/auth/auth-service.ts:77`, `:103`, `:146`, `:194`, `apps/server/src/cli/reset-password.ts:40`, `:55` | A second account cannot exist |
| 2 | Sign-in is by **username**. No email is stored anywhere | `packages/shared/src/schemas.ts:62`, `:75` | The email flow needs a new identity model |
| 3 | One Govee key for the whole process, from `GOVEE_API_KEY`, fixed when the transport is built | `apps/server/src/config/env.ts:67`, `apps/server/src/app/context.ts:131` | Every account would control the owner's lights |
| 4 | Every routes file takes its services once at startup (`const { … } = ctx`), across 9 files and **75 routes** (65 when the multi-user plan was written) | e.g. `apps/server/src/devices/device-routes.ts:23` | Routes cannot serve a different person's data without this change |
| 5 | No data table has an owner, and names are unique across the whole database | `migrations/001_initial.sql:99`, `:113` | Two people could not both have a group called "Front" |
| 6 | Changing a password deletes **every** session | `auth-service.ts:197` | One person's password change would sign everyone out |
| 7 | Login throttling has a **global** counter: 30 failures from anywhere lock everyone out for 5 minutes, and any success clears it | `auth-service.ts:16`, `:255`, `:259` | On a public site, anyone can lock out every user, and an attacker can reset the limit by signing in to their own account |
| 8 | Forgotten password: the sign-in page says to run `npm run reset-password` on the server | `apps/web/src/features/auth/LoginPage.tsx:56` | Public users need email reset |
| 9 | AI keys come only from server variables (`DEEPSEEK_API_KEY`, `GEMINI_API_KEY`, `GLM_API_KEY`) | `env.ts:104` to `:109` | Needs a per-person key |
| 10 | AI allows **one request at a time for the whole server** (`busy`), 6 a minute in total (`recent`), and rests a provider for everyone when it fails | `apps/server/src/ai/ai-service.ts:107` to `:109`, `:198`, `:207` | One person's question blocks everyone's. One person's bad key rests that provider for an hour **for everyone** |
| 11 | The AI monthly cap is one total for the whole database | `apps/server/src/ai/ledger.ts:73` | With own keys, each person's cap must be their own |
| 12 | The secret scrubber is built once at startup from the server's own keys | `context.ts:108`, `:114` | Keys added later by people would not be scrubbed from logs or activity |
| 13 | `/system/status` shows the database path, Node version and uptime to anyone signed in | `apps/server/src/system/system-routes.ts` | Fine for the owner, not for the public |
| 14 | A new account with lights gets 46 enabled holiday schedules with no consent (measured in the multi-user plan) | `apps/server/src/presets/builtin-presets.ts` | Strangers' lights would change for holidays they never chose |
| 15 | No general request limit on signed-in routes | `apps/server/package.json` has no rate-limit plugin | One account could hog the server |

What already helps: Argon2id at OWASP settings (`auth-service.ts:10`), session tokens stored only as SHA-256 hashes, `httpOnly` + `SameSite=Strict` cookies (`apps/server/src/auth/cookies.ts`), CSRF on every mutating route, deny-by-default auth that path spellings cannot get around (`apps/server/src/app/build-app.ts:149`), a strict CSP, and a 12-character password minimum (`schemas.ts:54`). AI hosts are fixed in code, so a key can only be sent to its own provider (`apps/server/src/ai/providers.ts:5`).

## The sign-up flow, as asked

```
/register          enter email  ──►  "Check your inbox"   (same answer whether or not the address is known)
                                          │
inbox              email with a link: https://lightup.ink/verify#t=<token>
                                          │
/verify            page shows the address, asks for a password twice  ──►  account created, nothing signed in
                                          │
/login?verified=1  "Your account is ready. Sign in."  enter email + new password  ──►  onboarding
```

Onboarding after the first sign-in: time zone, Govee key, which holiday shows to turn on (off by default), and optionally an AI key.

### How each step works

**1. Register** (`POST /api/v1/auth/register`, public)
- Takes an email and a proof-of-work answer (see [Abuse controls](#abuse-controls-with-no-third-party-captcha)). The address is trimmed, lowercased and NFKC-normalised, and must be at most 254 characters and contain no CR or LF characters.
- **The response is always the same** 202, "If that address can be used, we've sent a link", so the form cannot be used to find out who has an account.
- New address: store a verification token, valid for 30 minutes, and queue the email.
- Address already has an account: queue a different email instead: "You already have an account. Sign in, or reset your password."
- No `users` row is created yet, so abandoned sign-ups leave no accounts behind, only tokens that expire and are deleted.

**2. The link**
- The token is 32 random bytes, stored only as a SHA-256 hash, single use, 30 minutes.
- It goes in the URL **fragment** (`#t=`), which browsers never send to the server, so it stays out of request logs, `Referer` headers and proxy logs.
- **Opening the link changes nothing.** Mail security scanners, such as Outlook Safe Links, open links to check them. If opening the link used it up, they would burn real people's links. The token is only used when the person submits their password.

**3. Set a password** (`POST /api/v1/auth/verify/check`, then `POST /api/v1/auth/verify/complete`, both public)
- `check` returns the address, so the page can show which account is being made. It returns the same "expired or already used" error for every bad token.
- `complete` takes the token and the password, using the existing 12-character rule. In **one transaction** it marks the token used and creates the user with `email_verified_at` set. Two submissions at once cannot make two accounts, because the email column is unique.
- **No session is created**, so the person signs in themselves, as asked.

**4. Sign in** (`POST /api/v1/auth/login`)
- Signs in by email instead of username. Kept from today: the dummy hash for unknown names, so timing reveals nothing, and the same error for a wrong email or a wrong password.
- New throttling, as in the multi-user plan: failures counted per address-and-email, per address, and more slowly per email. A success clears only that person's own counter. **The global lockout goes away** (finding 7). Password hashing is limited to a few at once, so a flood of sign-ins gets 429 instead of exhausting memory: each hash takes 19 MiB.

**Also needed for a public site, using the same machinery**
- **Forgotten password by email**: a 30-minute single-use link, the same opening-changes-nothing rule, and the same "we sent a link if…" answer. A reset signs out only that person.
- **Resend the link**, at most once a minute and 5 times a day per address.
- **Change email**, verified at the new address, with a notice sent to the old one.
- **Delete my account** (asks for the password again) and **export my data**.
- Password change signs out only that person's other sessions (finding 6).

## Email, built in-house

### What can be in-house: all of the software

| Part | Built with | Rough size |
|---|---|---|
| SMTP client: EHLO, STARTTLS, AUTH, MAIL/RCPT/DATA, dot-stuffing, timeouts, certificate checks always on | `node:net`, `node:tls` | About 300 lines |
| Message builder: plain text and HTML versions, RFC 5322 headers, Message-ID, quoted-printable encoding, refusing header injection | Plain TypeScript | About 150 lines |
| DKIM signing (rsa-sha256, relaxed canonicalisation), needed only if the app sends directly to recipients | `node:crypto` | About 150 lines |
| A durable outbox table: mail is queued in SQLite and a worker sends it with retries and backoff. A restart loses nothing, and the register response does not wait for SMTP, so its timing cannot reveal anything | `better-sqlite3`, already used | About 200 lines |
| Templates: verify, already registered, reset, email changed | Plain TypeScript | Small |
| A local fake SMTP server for tests and `dev:mock`, like the existing Govee mock | `node:net` | About 150 lines |

There are no new npm packages: no nodemailer, no auth library, no captcha service.

### What cannot be in-house: something has to accept the message

Railway's documentation says: "SMTP is only available on the Pro plan and above". On Free, Trial and Hobby, outbound SMTP is disabled and Railway points to HTTP email services, which are third-party. **Whether this project is on Pro is not confirmed.** The workspace listing does not show the plan.

| Option | How | Deliverability | Verdict |
|---|---|---|---|
| **A. Hand mail to an existing mailbox** (recommended) | The in-house client logs in on port 587 to the mail host `lightup.ink` already uses, or one the owner sets up, and sends as, say, `no-reply@lightup.ink` | Good. That host already has a reputation, reverse DNS and DKIM | Needs Railway Pro, one SMTP login stored as a Railway variable, and SPF, DKIM and DMARC records for that host |
| B. Send straight to each recipient's mail server | `node:dns` looks up the recipient's MX records, the app connects on port 25 and signs with its own DKIM key | **Poor and unpredictable.** It needs a static outbound address (Railway Pro), plus reverse DNS for that address, which Railway may not let you set (unverified). Large providers such as Gmail expect it (from their sender guidelines, not re-checked today), and a new address has no reputation, so mail is likely to go to spam or be refused | Not recommended, even though it is the most "in-house" option |
| C. Run a mail server elsewhere, such as a VPS that allows reverse DNS | Postfix or similar, and the app hands mail to it | Better than B after warming up | Another server to run, patch and keep off spam blocklists. Not worth it at this size |

Option A keeps all the code in-house, and only the last hop goes through a mailbox the owner already controls.

### Decided: option A, through `info@lightup.ink` on Namecheap Private Email (owner, 21 November 2026)

**What `lightup.ink`'s DNS already has** (looked up with `dig` on 21 November 2026):

| Record | Found | Needed |
|---|---|---|
| MX | `mx1.privateemail.com`, `mx2.privateemail.com` | Nothing to change |
| SPF (`TXT lightup.ink`) | `v=spf1 include:spf.privateemail.com ~all` | Nothing to change, because the app sends through Private Email's servers, not from Railway's address |
| DKIM | Nothing at `default._domainkey.lightup.ink`. Other selectors were not checked | **Owner:** turn on DKIM in the Private Email panel, and add the TXT record it gives |
| DMARC (`_dmarc.lightup.ink`) | None | **Owner:** add one, starting with `v=DMARC1; p=none; rua=mailto:info@lightup.ink`, and tighten it to `quarantine` once mail is seen passing |

**Connection**, from [Namecheap's mail client settings](https://www.namecheap.com/support/knowledgebase/article.aspx/1179/2175/general-private-email-configuration-for-mail-clients-and-mobile-devices/) and [IMAP/SMTP details](https://www.namecheap.com/support/knowledgebase/article.aspx/10820/2179/private-email-caldavcardav-and-imapsmtp-details/):
- Host `mail.privateemail.com`, port **465 with TLS from the start** (port 587 with STARTTLS also works). Only encrypted connections are accepted.
- The username is the full address, `info@lightup.ink`. Authentication is required.
- "Connect third-party apps" (SMTP access) has to be on in Private Email's settings. Namecheap mentions an application password, so a separate password for the app is preferable to the mailbox's main one.

**Limits**, from [Namecheap's sending limits](https://www.namecheap.com/support/knowledgebase/article.aspx/10719/2179/email-sending-and-usage-limits-for-private-email/):
- 500 emails an hour per mailbox on paid plans, and 20 an hour on a trial. At most 50 recipients per message.
- Namecheap says the service is not built for mass mailing, and can lower limits.
- The app sends one message per recipient, and only transactional mail: verify, already registered, reset, email changed. So the outbox must stay under the hourly limit, for example at most 300 an hour, leaving room for the owner's own mail. Anything past that waits in the outbox, rather than failing.
- That limit also caps sign-ups at a few hundred an hour, which is above the planned launch cap of 50 a day.

**How it is wired into the app**:
- New Railway variables: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER=info@lightup.ink`, `SMTP_PASSWORD` and `MAIL_FROM`.
- **The owner sets `SMTP_PASSWORD` in Railway themselves.** It is never pasted into a chat or a file, and is added to the log scrubber like the other keys.
- `SMTP_HOST` is accepted only if it is `mail.privateemail.com`, `smtp.privateemail.com`, or loopback for the test server. That is the same guard `GOVEE_API_BASE_URL` has (`apps/server/src/config/env.ts:203`), so a typo or a hostile variable cannot send the mailbox password anywhere else.
- The client supports TLS from the start on 465 as well as STARTTLS on 587, always checks certificates, and refuses to send the password over an unencrypted connection.
- Mail is sent **as `info@lightup.ink`**, so replies and bounces land in that inbox. A `no-reply@lightup.ink` alias on the same mailbox is optional.

**Still to confirm:** that Railway lets connections out to port 465 or 587. That needs the Pro plan (P2). One test send from Railway will settle it, once the client is built.

## Bring your own AI key

### What changes

| Today | After |
|---|---|
| Keys from server variables only (`env.ts:104`) | Each person adds a provider, a model and a key in **Settings → AI**. The key is tested with one tiny request before it is saved |
| One lock, one per-minute count, one cursor and one resting state for the whole server (`ai-service.ts:107` to `:109`) | All of them per person. They fall out naturally if each account gets its own `AiService`, as in the per-account design. A process-wide limit of about 8 AI requests at once protects the server, because each request can hold a connection for up to 120 seconds |
| One monthly cap of $5 for the whole database (`ledger.ts:73`, `env.ts:102`) | Each person sets their own cap, defaulting to $5. It is their money, but the cap still guards against a runaway loop |
| `reason: 'no_providers'` tells the owner to set a server variable (`AskCard.tsx:17`) | A new reason, `no_key`: "Add your own AI key in Settings to use Ask and Describe". `DescribeBox` already hides itself when AI is unavailable (`DescribeBox.tsx:24`) |
| Scrubber fixed at startup (finding 12) | Scrubber per account, including that person's AI and Govee keys |

### How keys are stored

The same scheme as the Govee key in the multi-user plan, so it is built once:
- AES-256-GCM via `node:crypto`, under a master secret held in the Railway variable `CREDENTIAL_KEYS`, never in the database or a backup.
- A random nonce for each row, and the account id bound as additional data, so a row copied to another account will not decrypt.
- **No API returns a key, not even its last 4 characters.** Settings shows "Connected on 21 Nov" and offers Replace and Remove.
- It is not stored in React state or query caches after submit.

### Providers: keep the fixed list

Today's hosts are fixed in code, so a key can only go to its own provider (`providers.ts:5`). Letting people enter **any URL** ("my own OpenAI-compatible server") would mean the server sends requests to addresses strangers choose. That is server-side request forgery: they could reach Railway's internal network. **Recommendation: keep the fixed list** (DeepSeek, Gemini, GLM), and add others, such as OpenAI, as fixed entries if people ask. A custom URL is possible later, but only with checks that refuse private and internal addresses after the name is resolved.

### Privacy note for the policy page

Ask sends summaries of that person's own lights, schedules and history to the provider they chose, under their own key. That is their choice, but the privacy page must say it. It already sends nothing about location (`packages/shared/src/ai.ts:146`).

## The part that makes this safe: one database per person

This is unchanged from [multi-user-plan.md](multi-user-plan.md#the-design) and still recommended:

- `control.sqlite` holds users, email tokens, sessions, login attempts, the email outbox, encrypted credentials and the audit log.
- Each person gets `accounts/<random id>.sqlite`, with today's migrations unchanged. The owner's existing file stays where it is and becomes account 1. **The owner's data is not rewritten**, and going back is a redeploy.
- Routes look up the signed-in person's services on each request. Removing the shared services from the context turns any route that was missed into a **compile error**, not a silent leak.
- A route census test fails if a new route is not classed as public, account or admin. A two-person test calls every route with person A's ids under person B's session, and expects 404 with A's data unchanged.
- An account loads its timers only once it has a Govee key. Unverified sign-ups never get a file at all.

Measured cost from the earlier plan: about 1.3 MB of memory per account after a restart, and up to about 4 MB just after setup. 500 accounts is roughly 0.7 to 2.4 GB.

## Abuse controls with no third-party captcha

| Risk | In-house control |
|---|---|
| Bots creating sign-ups | **Proof of work**: the server issues a signed challenge, and the browser finds a matching SHA-256 answer with WebCrypto, taking about 1 to 3 seconds. Plus a hidden honeypot field, per-address limits on `/register` (for example 10 an hour), a **daily cap on new accounts** (for example 50), and a total cap at launch (for example 500) |
| Using the form to flood someone's inbox | At most 1 email a minute and 5 a day per address, whatever the IP. Old tokens are replaced, not added to |
| Throwaway addresses | A small list of disposable-email domains kept in the repo (optional, as data, not a service) |
| Password guessing | The throttling above, and a limit on how many hashes run at once |
| Testing stolen Govee or AI keys through the form | About 5 key checks an hour per account, one account per Govee key (a keyed fingerprint), and an audit log |
| One account hogging the server | Per-account request limits (for example 120 a minute), caps on devices, presets and schedules, and the existing queue cap |
| The owner needs to stop everything | An admin switch to **turn off sign-ups**, and one to pause all background traffic |

## Decisions the owner needs to make

| # | Decision | Recommendation |
|---|---|---|
| P1 | How email leaves the server: A, B or C above | **Decided 21 November 2026: A, through `info@lightup.ink` on Namecheap Private Email.** See above |
| P2 | Is the Railway account on Pro? Without Pro, no SMTP leaves Railway at all | **Answered 21 November 2026: Pro (the owner's answer; not shown by the Railway tools).** A test send from Railway, once the client is built, confirms port 465 is open |
| P3 | Your own AI keys in the server variables: only for you, or shared with everyone? | **Decided 21 November 2026: only the owner.** Everyone else adds their own key, or AI stays off for them |
| P4 | AI providers: fixed list, or any URL? | **Decided 21 November 2026: fixed list** (DeepSeek, Gemini, GLM). More are added the same way, never as a typed-in URL |
| P5 | You sign in by email too? | **Taken as recommended (not asked): yes.** Your address is added to your account during the cutover, and your password stays the same |
| P6 | Launch caps | **Decided 21 November 2026: 50 new accounts a day, 500 in total**, adjustable from the admin screen |
| P7 | Govee's terms on hosting other people's keys are still unread and unanswered (multi-user plan, D2). Build now, or wait? | **Decided 21 November 2026: build now.** Sign-up stays off in production until the owner switches it on. If Govee says no later, accounts can export their data and the self-hosting route remains |
| P8 | Terms of service and a privacy policy, which a public site needs. The app holds emails, IP addresses, latitude and longitude, and home routines | Have them written or reviewed by someone qualified before launch. Not something this plan can settle |

## Build order

Each phase is built and tested in full, run through `bash scripts/ci-local.sh --image` on the exact commit, and then proposed as **one** push for approval. Sizes are rough.

| Phase | What | Size | Production change |
|---|---|---|---|
| 0 | The answers to P1 to P8 | Waiting | None |
| 1 | **Safety net**: a verified backup of every file, a copy off Railway, an automated restore drill | 1 to 2 days | The CLI only |
| 2 | **The split, with no visible change**: platform and account contexts, routes per request, one account (yours), per-account scrubber, parallel shutdown. All 759 current tests still pass, plus the route census | 3 to 5 days | None visible |
| 3 | **Control database and your cutover**: users by email, sessions per user, new throttling, encrypted credentials, your file registered as account 1, `GOVEE_API_KEY` kept for 2 weeks as the way back | 3 to 5 days | Your sign-in moves to email |
| 4 | **Email and sign-up**: SMTP client, outbox, fake SMTP server for tests, register, verify, set password, then sign in; reset, resend, change email, proof of work, caps, the sign-up switch. Sign-up stays **off** in production | About 1 week | Sign-up deployed but off |
| 5 | **Onboarding and own keys**: connect and replace a Govee key, holiday shows opt-in, AI key per person with per-person lock, cap and resting, delete and export, admin screen, privacy and terms pages | 1 to 2 weeks | Still off |
| 6 | **One trusted outside person**: turn sign-up on with a cap of 1 or 2 and watch for 2 weeks | Calendar time | Sign-up on, capped |
| 7 | **Public**: raise the caps | Small | On |

Stopping after any phase leaves a working site.

**Tests that must exist before phase 6:** the two-person isolation test on every route; no key in any response, log line or activity record (extending `apps/server/tests/security.test.ts`); the same answer from register, reset and resend whether or not an address is known; a link that has only been opened still works; two `complete` submissions at once make one account; the email bombing limit; header injection refused in the SMTP client; the AI lock, cap and resting kept apart per person.

## Not verified

- That SMTP really leaves Railway on port 465. The owner says the account is Pro, but nothing has been sent yet
- DKIM under any selector other than `default`. MX and SPF were looked up, and DMARC is missing
- Namecheap's hourly limit counts emails in its main article, but recipients on its newer MCP tools page. One recipient per message makes the two the same
- Gmail's and Outlook's current requirements for senders were not re-checked today
- Govee's terms on hosting other people's keys
- All sizes. None of this has been built
