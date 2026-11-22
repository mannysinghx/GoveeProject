# Progress

Current state of the project, so anyone can pick it up without the original conversation.

## Where it stopped

- **Newest, 22 November 2026, 18:52 UTC: deployed.** `main` is at `08e1532` (internal details removed from pages and responses), and Railway runs it (deployment `ac4c5e73`). Mail is configured (`SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD` set by the owner, `PUBLIC_URL`), and `CREDENTIAL_KEYS` is set: the owner's Govee key is now stored encrypted. Sign-up is still off. **Not yet known:** whether mail gets out (the first send settles it: the owner adds an address in Settings). Docs commits after `08e1532` are local.
- **Earlier on 22 November 2026: Phases 1 to 5 of public sign-up and the key help, deployed.** `main` is at `f34a56f`, pushed at 18:22 UTC with the owner's approval after a production backup, and Railway runs it (deployment `b846617b`). Sign-up is off, mail is off, and keys are not stored until the owner sets the variables listed under "Push proposal". Docs commits after `f34a56f` are local. Phase 5 (`0386fd2` server, `4282c23` web) adds each person's own Govee and AI keys, export and delete, the owner's accounts list, per-member limits, getting-started steps, and draft privacy and terms pages. Earlier: Branch `claude/public-registration-email-verify-d03096`: Phase 1 (`0b04d18`) adds verified backups, restore, and a way to copy a backup off Railway. Phase 2 (`d0c3cfe`) splits the server into a platform and one context per account. Phase 3 (`b4cd681`) moves sign-in to a control database, with per-account throttling and encrypted keys. Phase 4 (`1ef9e69` server, `b1a1da6` web, `5b2241f` CI script) adds email sign-up, reset and address change with an in-house mail client, off until the owner turns it on. See "Public sign-up" under "In flight". On 22 November, help on getting a Govee key and an AI key, with low-cost models, was added to the sign-up page (`84d6dea`). Nothing is uncommitted. Before the push, production ran `cca931a` (the white-LED merge, deployed 14 November 2026 at 03:37 UTC, Railway deployment `4016d6a2`), not `19166b3` as these notes said until 22 November. The plan and decisions are in [public-signup-plan.md](public-signup-plan.md).
- **13 November 2026: deployed.** `main` was at `19166b3` (14 November, 02:53 UTC). Since then `main` is at `cca931a`, which merges the white-LED fix, and Railway has run it since 14 November, 03:37 UTC (deployment `4016d6a2`, found in Railway's deployment list on 22 November; that push is not in this branch's `OPS_LOG.md`). It fixes lights showing a frozen or wrong status, and adds daily color schemes, pattern search and sort, and one brightness for all lights. See "In flight" below. The branch `claude/govee-light-recognition-b1a7e4` holds the same commits plus the deployment record, which is local only. Nothing is uncommitted.
- Branch: `main`, pushed to <https://github.com/mannysinghx/GoveeProject>. `git log -1` shows the last commit.
- Version 1 is built and verified against a local stand-in for the Govee API. On a real account, discovery and status work and power commands to a group are accepted. **Whether real lights respond correctly has not been confirmed.** See `docs/govee-integration.md`.
- Deployed on Railway at <https://www.lightup.ink>, also <https://lightup.ink> and <https://glmserver-production.up.railway.app> (project `goveeproject`, service `@glm/server`). The owner has set the key and created the account. See `docs/deploy-railway.md`.

## Done and verified

| Piece | How it was checked |
|---|---|
| Backend, frontend, shared code | `npm test`: 595 tests (server 392, web 148, shared 55) |
| Connection monitor, offline detection, catch-up, one box per LED | Real browser against the mock, production build, with one mock light offline, on desktop and at phone width. `scripts/ci-local.sh --image` passed on `481cbdb`. Deployed: migration `002_connection.sql` applied, monitor started at 130-second intervals, status checks ran for all 3 strings and skipped the Govee group, new routes return 401 without a session. No command was sent to real lights. Diagnosis and catch-up have not yet run against a real outage. |
| Pattern editor, all strings in series | Real browser against the mock, production build: drag painting across strings, repeat, flip surviving a reload, per-string sending, phone width. Not yet sent to real lights. |
| Repeat in the pattern editor | Real browser against the mock, production build: a painted pattern with a blank filled all segments across strings, following right-to-left rows. `scripts/ci-local.sh --image` passed on `e05ed8a`, and it is deployed: the live build contains it, health is OK, and the monitor restarted. Not yet tried on real lights. |
| 20 festival presets, New Year fireworks, yearly schedules, exact start times | Real browser against the mock, production build, with real scene names: presets listed in calendar order, yearly schedule shown and editable, phone width. A run due at 04:37:00.000 started at 04:37:00.000 on the real clock. `scripts/ci-local.sh --image` passed on `c00ee26`, and it is deployed: migration `003` applied, 21 presets installed, the Fireworks effect is set on all 3 strings from their real scene lists, and both schedules show their next run as January 1, 2027, Los Angeles time. **No effect has been run on real lights by this check.** |
| One color for everything, in the pattern editor | Real browser against the mock, production build, on desktop and at phone width. **Committed locally, not deployed yet.** |
| Holiday calendar, Diwali show, notifications, Web Push | Real browser against the mock, production build, on desktop and at phone width: 21 shows listed soonest first with Diwali on 2026-11-08, Lights Check answers saved to Activity, offline string reported, service worker registered with no-cache headers. The real `web-push` library signed and encrypted a message in a test. The service worker's code was run against a stand-in for the browser. `scripts/ci-local.sh --image` passed on `10bb5c8`, and it is deployed: migration `004` applied, 16 more presets, 44 more schedules (49 in all), Diwali's next run is 2026-11-09T01:00Z with its 7 steps, the Fireworks effect is set on all 3 strings, the fireworks schedules are tagged, and push keys exist. `/sw.js` and the manifest are served on both addresses. **Not tried on a real phone, or on real lights: no device has turned on alerts yet.** |
| Editing the holiday calendar | Real browser against the mock, production build, on desktop and at phone width: changed time, pattern and end, survived a reload, clashes refused, original settings restored. `scripts/ci-local.sh --image` passed on `2de021d`, and it is deployed. Not yet used on the real account. |
| First real notification | Switch OFF on 2026-11-07 at 07:00:00.006 UTC, 6 ms after it was due: all accepted, and a Lights Check notification was created. No phone has alerts on yet. |
| White-LED fixes and Check my lights | Unit tests, and a real browser against the mock, production build, at desktop and phone width. **Deployed as `cca931a` on 14 November 2026 (Railway deployment `4016d6a2`, SUCCESS). The physical cause isn't confirmed on real lights.** |
| Railway deployment | Health, HTTPS redirect, HSTS, 401s, setup code, volume survives a restart (0 migrations on second boot), clean SIGTERM, real client address with forged headers ignored. The owner has signed in on it. |
| Type check, lint, build, dependency audit, clean install on Linux | `scripts/ci-local.sh` |
| Production image, hardened as in Compose | `scripts/ci-local.sh --image` |
| Every screen, under the real CSP | Production build in a real browser, against `apps/server/scripts/mock-govee.ts`, on desktop and at phone width |
| Scheduler in real time: live run, graceful stop, missed runs, catch-up, restart inside grace, no duplicates, backup and reset CLIs, no secrets in logs or database | A throwaway script against the production build |
| Security and correctness review | Independent review found 12 defects, including a login bypass through percent-encoded paths. All were reproduced and fixed, with regression tests in `apps/server/tests/hardening.test.ts`. |

## Marketing

The deck is an artifact: <https://claude.ai/artifact/Bf4UZRaCtK94riR9jSjx54>. The video, screenshots and how they were made are in `marketing/` in the main checkout, not committed. They show the version at `10bb5c8`, with sample lights.

## In flight

**Public sign-up (21 and 22 November 2026).** The owner asked to open the site to the public: email sign-up verified through the inbox, then a password, then sign-in; nothing third-party; and each person's own AI key, with AI off without one. The plan is [public-signup-plan.md](public-signup-plan.md). Decided: email goes through `info@lightup.ink` on Namecheap Private Email (P1); Railway is Pro (P2, the owner's word); the owner's AI keys are for the owner only (P3); a fixed list of AI providers (P4); launch caps of 50 a day and 500 in total (P6); build now, with sign-up off in production until switched on (P7). P5 (sign in by email) was taken as recommended, not asked. P8 (terms and privacy policy) is the owner's.

Phase 1, the safety net, is done:

| Piece | How it was checked |
|---|---|
| `backup.js` checks its copy (integrity, foreign keys), makes it one self-contained file, writes a manifest (SHA-256, size, migrations, row counts) and never overwrites anything | `apps/server/tests/backup-restore.test.ts`, 8 tests against the real app on a real file, backed up while running. One test fails if a check is broken on purpose (in-use detection, tried). The row-count check after a restore could not be made to fail with a good copy, so no test exercises it |
| `verify-backup.js` (`npm run db:verify`) and `restore.js` (`npm run db:restore`): refuses an open database, a damaged copy or one from a newer build; moves the old file aside, never deletes it | Same tests. A restored copy starts with 0 migrations applied, keeps every row and next run time, and the same password signs in |
| `scripts/pull-backup.sh` copies a backup from Railway, or `--docker` a container, checking hash and size on arrival | Against a container running the **deployed** backup command (`19166b3`'s, rebuilt), and the new one: copy arrived intact, integrity ok, nothing left on the server. A copy damaged in transit was refused and nothing saved (exit 1) |
| Everything together | `bash scripts/ci-local.sh --image 0b04d18`: passed, 767 tests, 0 vulnerabilities, and the backup round trip out of the hardened image. See `docs/OPS_LOG.md` |

**Not done:** no backup has been pulled from production. The permission check refused a database read on production over `railway ssh` on 13 November, so the owner runs `bash scripts/pull-backup.sh` themself, or approves Claude running it. How to restore **on Railway** is not worked out, because stopping the app also stops the container `railway ssh` reaches (`docs/deploy-railway.md`, "Backup").

**Owner to do:** turn on DKIM in Private Email and add its DNS record; add a DMARC record (`v=DMARC1; p=none; rua=mailto:info@lightup.ink`); turn on SMTP access for `info@lightup.ink`. Later, when the email code exists, set `SMTP_PASSWORD` in Railway yourself.

Phase 2, the split with no visible change, is done (`d0c3cfe`). How it works is in `docs/architecture.md`, "Platform and accounts".

| Piece | How it was checked |
|---|---|
| `PlatformContext` with no account services, and `AccountContext` per person, wired as before | Type check. A test file reaching `platform.devices` fails to compile (`TS2339`). It was tried, then removed |
| 75 routes get their services from `accountOf(request)` | The 481 existing server tests pass unchanged. A route census in `apps/server/tests/accounts.test.ts` lists all 75, 5 of them public |
| A valid session with no loaded account gets 503, never another account's data | Test, which fails when that check is removed (tried) |
| Secrets added after startup are scrubbed | Test, which fails when the logger's scrubber is fixed at startup again (tried) |
| Accounts stop in parallel, each in the original order | Test, which fails when shutdown runs one account at a time (tried) |
| The real server process | Built server against the Govee mock in Node 26: health, setup, discovery (3 lights), a group, a power command accepted, status, 401 when signed out, then SIGTERM: "Shutdown complete", exit 0, no error lines |
| Everything together | `bash scripts/ci-local.sh --image d0c3cfe`: passed, 774 tests, 0 vulnerabilities. See `docs/OPS_LOG.md` |

Known limits, by design for now: sign-in still lives in the owner's file (Phase 3 moves it). `/notification-actions` uses `accounts.sole()`, which throws once a second account exists (Phase 4 replaced it). Log lines are not yet tagged with an account (members' are, since Phase 4).

Phase 3, the control database and the owner's cutover, is done (`b4cd681`). How it works: `docs/security.md`, "Where accounts live" and "Encrypted keys", and `docs/deploy-railway.md`.

| Piece | How it was checked |
|---|---|
| `control.sqlite` with users, sessions, login attempts, encrypted credentials and an audit log | `apps/server/tests/control.test.ts`, 20 tests, and the existing security tests, now reading the control database. One of those still passed while checking the wrong file (session expiry counted the owner's file). It was caught and corrected |
| The owner moves in on start, with live sessions; safe to repeat; the file's old tables untouched | Tests, and the rehearsal below |
| Rollback stays safe: old tables kept in step on password change and sign-out; a password the old version changed wins on roll-forward | Tests, each failing when its rule is removed (tried), and the rehearsal |
| No shared lockout; one account's sign-in cannot reset another's counter; one address trying many names is stopped; names stored hashed | Tests, two failing when the counter is shared or a success clears every counter (tried) |
| AES-256-GCM credentials bound to user and kind; versioned master keys; one Govee key per account; config errors never show a key | Tests; the binding test fails when the user is left out of the encryption (tried) |
| The Govee key: stored from `GOVEE_API_KEY`, follows it when it changes, used once it is removed; nothing overwritten with the wrong master key | Tests. A real ordering bug was found here and fixed: the key was stored before the owner's row existed. Maintenance also read "key configured" once at startup; it now asks each time |
| Backups, `pull-backup.sh`, verify and restore cover both databases | Tests, and the CI round trip |
| **Rehearsal with the deployed `19166b3`** on the same files | Old version set up and discovered 3 lights; this build kept that session signed in and stored the key encrypted (not readable in the file); password changed; rolled back: old version refused the old password and the signed-out session, took the new one, 3 lights intact; the old version changed the password; rolled forward: the newest password won; without `GOVEE_API_KEY`, discovery worked from the stored key. No error lines and no key in any log. Script and output: `docs/public-signup-evidence/` |
| Everything together | `bash scripts/ci-local.sh --image b4cd681`: passed, 794 tests, 0 vulnerabilities. See `docs/OPS_LOG.md` |

The old tables in the owner's file stay until a later, separate step. **To use encrypted storage in production, the owner sets `CREDENTIAL_KEYS` in Railway themself**, made as in `docs/security.md`, and keeps a copy in a password manager.

Phase 4, email and sign-up, is done (`1ef9e69`, `b1a1da6`, `5b2241f`). How it works: `docs/security.md`, "Email sign-up"; `docs/architecture.md`, "Email and sign-up"; `docs/deploy-railway.md`, "Email and sign-up". **Sign-up is off** until the owner turns it on in Settings, and cannot be turned on until mail is set up.

| Piece | How it was checked |
|---|---|
| SMTP client: TLS on 465 and STARTTLS on 587 with certificates checked, PLAIN and LOGIN, no password over plain, replies slipped in before the handshake refused, 4xx, 5xx and refused sign-in told apart, timeouts | `apps/server/tests/mail.test.ts` against `tests/support/fake-smtp.ts`, a fake mail server using test-only certificates (`tests/support/smtp-tls/`) |
| Message builder refuses line breaks in headers; quoted-printable; dot-stuffing | Same file |
| Outbox: sends one at a time, retries with backoff, 300 an hour, drops expired links, clears the text once sent, pauses when the mailbox refuses the login, recovers after a crash | Same file |
| `SMTP_HOST` only `mail.privateemail.com`, `smtp.privateemail.com` or loopback; plain only to loopback; `SMTP_PASSWORD` scrubbed | Same file |
| Register, the link (opening it twice changes nothing), set password with no session, sign in by email | `apps/server/tests/signup.test.ts`, 25 tests, through the HTTP API with real mail to the fake server |
| Same answer for new and known addresses; one email a minute and five a day per address; ten requests an hour per network address; proof of work single-use; hidden bot field; caps of a day and in total, also when the link is used; the switch, owner-only | Same file |
| Two submissions at once make one account; links expire in 30 minutes and a new one replaces the old | Same file |
| Reset signs out only that person; the owner adds an address, signs in with it, resets by email, and the old tables in the owner's file follow the new password; changing an address tells the old one and kills reset links sent there | Same file |
| Members get their own file, no Govee key and no AI keys; every signed-in route called as a member with the owner's real ids returns nothing of the owner's and changes nothing; phone notification buttons reach only their own account; accounts reload after a restart | Same file. The isolation test was first found to stop at body validation on many routes; it now sends valid bodies, and every id route reaches its lookup and returns 404 or 422 |
| Web pages: create an account, check your inbox, choose a password, sign in, forgot, reset, confirm address, Settings email card, owner's sign-up card | `apps/web/src/features/auth/email-pages.test.tsx`, 17 tests, including the browser's proof of work |
| Breaking each guarantee on purpose | 22 mutations. 20 were caught on their own. The other 2 were each held by a second guard (the token re-read inside the transaction; the reset only applying while the address still matches), and were caught once both guards were removed |
| The real built server in a browser | A local container with the mock Govee and the fake mail server: registered, the email arrived through the real SMTP client, the link opened the password page and left the address bar, the account was made with no sign-in, "Your account is ready" with the address filled in, signed in to an empty dashboard of its own, no Sign-up card in the member's Settings. No console errors, no error lines, no token or password in the server log |
| Everything together | `bash scripts/ci-local.sh --image 5b2241f`: passed, 869 tests (shared 71, server 566, web 232), 0 vulnerabilities, image smoke test, backup round trip. The run before it, on `b1a1da6`, passed every check and then failed only on the CI script's own fixed expectation of `001_control.sql`, which `5b2241f` corrects. See `docs/OPS_LOG.md` |

**Not verified:** no mail has left Railway yet. Whether port 465 is open from Railway is settled by the first send after deploy (add your own address in Settings). DKIM and DMARC for `lightup.ink` are still to be set up by the owner.

**Owner to do for mail:** turn on SMTP access for `info@lightup.ink` (an app password is better), DKIM and DMARC as above, then set `SMTP_HOST`, `SMTP_USER` and `SMTP_PASSWORD` in Railway yourself, after the push.

Phase 5, onboarding and own keys, is done (`0386fd2` server, `4282c23` web). How it works: `docs/security.md`, "People's own keys and accounts"; `docs/architecture.md`, "People's own accounts". Sign-up is still off.

| Piece | How it was checked |
|---|---|
| Govee key from the browser: checked with Govee, stored encrypted, used only by that account, one account per key; the owner's `GOVEE_API_KEY` still wins while set, and the owner can connect one when it is not; no master key means no storing | `apps/server/tests/own-account.test.ts`, against the mock Govee |
| Own AI keys: priced models only, checked with one request, one account per key, never the owner's; each person's own cap, lock and resting state, and a new key starts afresh; 8 at once on the server | Same file, with a stand-in for the providers |
| 5 key checks an hour; keys scrubbed; no key in any response, log line or the control database's text | Same file |
| Export with the password, no secret in it; delete (members only) removes sign-in, keys, sign-in history and the file, leaves everyone else as they were, and the address can sign up again | Same file, delete on a real file on disk |
| Accounts list owner-only; suspend ends sessions and unloads the account, and old sessions stay ended after reactivating | Same file |
| 300 requests a minute per member; caps of 50 groups, 200 presets and 200 schedules, built-ins not counted, owner not capped | Same file |
| Members' holiday shows set up off; turning one on is their choice | Same file |
| Route census: 96 routes, 12 public, 4 owner-only. The two-person test now also covers the new routes | `apps/server/tests/accounts.test.ts`, `signup.test.ts` |
| Pages: Govee key, AI keys, export, delete, accounts, getting started, privacy and terms; the key leaves the form after sending | `apps/web/src/features/account/account.test.tsx`, 13 tests |
| Breaking each guarantee on purpose | 26 mutations: 22 caught at first; 3 weak tests strengthened, then caught; 1 held by a second guard, caught when both are removed. `docs/public-signup-evidence/` |
| The real built server in a browser | Local container with the mock Govee and the fake mail server: owner setup, sign-up on, a member registered by email, connected the mock key on the Connect page and found 3 lights, all 21 holiday shows off, the Settings cards right for each role, the time-zone button, sign-out and delete both landing on the sign-in page, the file gone. No error lines, and no key, password or link in the server log |
| `pull-backup.sh` with a member | Against a snapshot of that container: the owner file, control database and the member's file came back, each matching the server and passing the integrity check; nothing left on the server; the script's own exit code 0 |
| Everything together | `bash scripts/ci-local.sh --image 4282c23`: passed, 898 tests (shared 71, server 582, web 245), 0 vulnerabilities, image smoke test, backup round trip. See `docs/OPS_LOG.md` |

**Found and fixed while checking, already in production:** signing out left the signed-in pages on screen, since the first build (`useLogout` cleared the cache, removing the session query it then asked to refresh). Confirmed in a real browser on the unfixed build, then fixed with `showSignedOut`, with a test (`apps/web/src/features/auth/sign-out.test.tsx`).

**A mistake, logged in `docs/OPS_LOG.md`:** one test run sent 3 requests to the real DeepSeek API with a made-up key, before members' accounts got the test's stand-in. DeepSeek refused them. Fixed before any further run.

**Not checked in a browser:** adding an AI key (it would send a key to a real provider); the export download itself (covered by tests). **Not done:** no AI or Govee request has been made with a real member's key.

**Help with keys on the sign-up page (`84d6dea`, 22 November 2026).** Asked by the owner: help on getting a Govee API key and an AI key, with recommended low-cost models.

| Piece | How it was checked |
|---|---|
| Sign-up page, "What you will need": Govee steps (profile, gear, Apply for API Key; one key per Govee account) and a link to Govee's guide; AI providers cheapest first, each with its key page, the model to pick and its price: Z.ai `glm-4.7-flash` free, Gemini `gemini-2.5-flash-lite` $0.10 / $0.40, DeepSeek `deepseek-flash` $0.30 / $1.20 at peak | `apps/web/src/features/auth/email-pages.test.tsx`; a real browser on a local build, at desktop and phone width (no sideways scroll, no console errors) |
| The same AI list in Settings above the add-key form; the Connect page uses the same Govee steps | `apps/web/src/features/account/account.test.tsx` |
| The list (`AI_KEY_GUIDES` in shared) stays in step with the server: each recommended model can be picked, is the cheapest for its provider, and its shown price is what the monthly limit counts | `apps/server/tests/key-guide.test.ts`, 4 tests |
| Prices and key pages | Read on the providers' own pages on 22 November: DeepSeek's pricing page (`deepseek-flash` $0.15 / $0.60 off-peak, $0.30 / $1.20 peak; `deepseek-v4-flash` retired but accepted at the same price), Z.ai's pricing page (GLM-4.7-Flash and GLM-4.5-Flash free), Google's pricing page (2.5 Flash-Lite $0.10 / $0.40, from a summary of that part of the page, not read word for word). DeepSeek's key page comes from its docs; Z.ai's and Google's key page addresses from search results, not opened |
| Everything | 904 tests (shared 71, server 586, web 247), type check and lint clean, in the dev container |

**Next:** the push below, with the owner's approval, after the owner has pulled a production backup. Then Phase 6: sign-up on, capped at 1 or 2 trusted people.

**Internal details removed (`04f2782`, 22 November 2026, after the deploy).** The owner: "remove all internal commands from public site and also do not reveal any tools and how site functionals internal because of the platform IP."

| Piece | How it was checked |
|---|---|
| Pages: no server setting names, commands, docs paths, ".env", "restart the app", "server log", hosting or mail provider, hash algorithm, Node.js version, Govee API address. Owner-only text too, because the web app's code ships to every visitor | `apps/web/src/public-text.test.ts` over all web source with comments removed; it fails when the old sign-in text is put back (tried). The built bundle searched for the same words: none |
| Server messages: error messages, key notes, connection advice, a schedule failure ("See the server log"), a rate-limit note (it held Govee's API path), Govee network failures (no cause code). `/system/status` gives members no Node.js version or Govee address | `apps/server/tests/public-text.test.ts` over every message the server sends; it found the schedule and rate-limit messages the first sweep missed, and fails when "See the server log" is put back (tried) |
| Everything | 910 tests (shared 71, server 589, web 250), type check and lint clean |

**Not changed, the owner's call:** the source code itself is public on GitHub (`mannysinghx/GoveeProject`, MIT licence, since 6 November), including `docs/`, which describe how everything works. If the platform's design is to be kept private, the repository has to be made private; nothing on the site can hide what the repository shows. **Sign-up on the sign-in page:** the "Create an account" link shows only while sign-up is on. It is off by the owner's decision P7, and cannot be turned on until mail is set up (`SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD`, then Settings, Sign-up).

**Push proposal 2:** fast-forward `main` from `f34a56f` (what Railway runs) to the commit that records this, after local CI passes on it. It redeploys `@glm/server` only, with no database change, so undo is redeploying `f34a56f` (deployment `b846617b`). The owner's own reset without email moves from the sign-in page to `docs/security.md` only: the owner should add an email address in Settings so "Forgot your password?" works for them.

**Push: deployed 22 November 2026.** The owner approved ("Backup done, push"). No backup was found on this Mac, so with the owner's approval Claude ran `bash scripts/pull-backup.sh`: `~/GoveeBackups/govee-light-manager-2026-11-22T18-22-25Z.sqlite`, hash matching the server, integrity ok, 1 user, 4 devices, 50 schedules, 76 presets. `f34a56f` was pushed to `main` at 18:22:45 UTC; Railway deployment `b846617b` succeeded at 18:24 UTC. The log shows both control migrations applied, the owner moved in with 2 sessions, no warnings or errors, and no 5xx responses; the owner's open dashboard kept working across the restart; new routes answer 401 without a session; the live page has the key help. Details in `docs/OPS_LOG.md`. **Not yet seen:** the owner signing in again on this version, the new Settings cards, a scheduled run on this version. The proposal as approved:

- **What:** fast-forward `main` from `cca931a` (what Railway runs) to `f34a56f`: 18 commits, Phases 1 to 5 and the key help. `git push origin f34a56f:main`. Local CI passed on `f34a56f` (904 tests, 0 vulnerabilities, image smoke test, backup round trip; `docs/OPS_LOG.md`). The commit recording that result comes after it and stays local. `main` has nothing this branch lacks.
- **What redeploys:** `@glm/server`, the project's only service. Its watch patterns (`/apps/server/**`, `/apps/web/**`, `/packages/**`, `/migrations/**`, `/Dockerfile`, `/package*.json`) all match. One build, one restart.
- **What happens on first start**, from the code and the rehearsal: control migrations `001_control.sql` and `002_signup.sql` create `/data/control.sqlite`, next to `/data/govee-light-manager.sqlite` on the volume (the live log shows that path). The owner and live sessions are copied in, so the owner stays signed in. The owner's file gets no new migration and its old sign-in tables are kept, and kept in step. `GOVEE_API_KEY` keeps working. Without `CREDENTIAL_KEYS`, no key is stored and the key forms say so. Sign-up stays off, and cannot be turned on until mail is set up.
- **What the owner will see:** Settings gains Email, Sign-up, Your data and Accounts cards; signing out now returns to the sign-in page (the bug fix); privacy and terms pages, marked as drafts.
- **No new variable is needed for the push.** Every new setting is optional.
- **Risk:** the move into `control.sqlite` runs on the real file for the first time. It was rehearsed on copies made by the deployed version `19166b3`; production runs `cca931a`, which changes only light commands, Check my lights and the pattern editor, none of sign-in, the database or backups. A failed start fails Railway's health check, and Railway keeps the running deployment.
- **Before:** the owner runs `bash scripts/pull-backup.sh` (Phase 1; it works with the deployed backup command).
- **How to undo:** redeploy `cca931a` in Railway (deployment `4016d6a2`, marked as one that can be rolled back). The old version ignores `control.sqlite` and `accounts/`. A password changed in the new version also changed in the old tables, so it still works; the owner may have to sign in again. The git history stays; a code revert would be a new commit.
- **After, read-only:** deployment SUCCESS; the log shows the control migrations applied, the owner moved in, and no warnings or errors; health OK; the new routes answer 401 without a session; the owner signs in.
- **Variables the owner sets afterwards, each change restarts the app:** `CREDENTIAL_KEYS` (before Phase 6); `SMTP_HOST`, `SMTP_USER` and `SMTP_PASSWORD` **in one change** (the server refuses to start with a user or password and no host); `PUBLIC_URL=https://lightup.ink` (otherwise email links point at the Railway address, the first in `ALLOWED_HOSTS`).

**Light status, daily color schemes, pattern search, one brightness (13 November 2026).** `459c84f` (light status) and `b2ee3c2` (the three features), with two test and CI fixes after them. **Deployed** on 14 November 2026 at 02:53 UTC as `19166b3`, with the owner's approval ("Yes, deploy"): Railway deployment `1f11c53f` succeeded, the log shows `006_light_status.sql` applied and no warnings or errors at startup, health is OK, the three new routes return 401 without a session, and the live bundle contains the new screens. Roll back by redeploying `adab10a` (deployment `458df907`) in Railway; the two new columns can stay. **Not yet seen after the deploy:** a background check's result, the 19 new built-in presets, or anything on real lights. The owner has not switched on the daily change, so no new schedule exists.

What was wrong, from the production log (Railway, read-only, 7 to 14 November):

| Finding | Evidence | Fix |
|---|---|---|
| All three strings stopped being checked for 24 hours | 12 November, 19:04 to 19:08 UTC: status requests timed out, then Govee answered `bad_request` (code 400) once for each string. `device-service.ts` treated that as permanent and held status checks back for a day (`REFUSED_STATUS_RETRY_MS`), a rule written for Govee groups. Outdoor Center's "offline" incident from 16:49 UTC never closed. | A refusal for a real light is asked again at the next check. Repeats are spaced 5 minutes, doubling, up to 6 hours. Groups keep the one-day wait. |
| Lights flagged offline on one answer | 10 November, 11:51 UTC: all three reported offline in the same check and were back 2 minutes later. Outdoor Center (`4609a559`) was flagged 9 times in 4 days, several for one check only. | A light is called offline only when two answers in a row say so. The monitor asks the second time 20 seconds later. Until then it shows "Checking connection". |
| A refused command did not update the light's status | 14 November, 02:11 UTC: commands to Outdoor Center were rejected as offline four times. Nothing recorded that against the light. | A command refused as offline counts as one "offline" answer, and triggers a status check. |

**Not verified:** the production database could not be read this session (the tool was refused permission), so the stored state of each light was inferred from the log and the code, not seen. Whether Outdoor Center is really offline now is the owner's to check in the Govee Home app: Govee was still refusing its commands as offline at 02:12 UTC on 14 November, which the app cannot change. Govee's device list returned 4 of 4 devices in every discovery that week, so "missing from the list" was not the cause.

| Piece | How it was checked |
|---|---|
| Light status | `apps/server/tests/light-status.test.ts`, 10 tests. Four of them fail with the old one-day rule put back, and pass with the fix. Real browser against the mock, production build: an offline string showed "Checking connection", then "Offline" about 20 seconds later, and the dashboard alert followed. |
| Check lights now (dashboard) | Same tests and browser run: it refreshes the device list and every light's status at once, and names any light it could not read. It replaces "Refresh device list". |
| 18 still color schemes, Today's Color Scheme, the daily rotation | `packages/shared/src/daily-scheme.test.ts`: the scheme changes every day from 1 November to 31 December in 2026 to 2033, never uses a moving effect, and keeps Veterans Day, Thanksgiving, Christmas Eve, Christmas and New Year's Eve. `apps/server/tests/daily-scheme.test.ts`: the colors sent on three consecutive evenings match that day's scheme. |
| Change automatically every day | Server tests, and the real browser: switching it on made one schedule, "Daily color scheme", daily at 16:05 on "All light strings", and the page showed its next run. |
| Search, sort and filter on Scenes & Presets | `apps/web/src/features/presets/presets.test.tsx`, and the real browser: "red white" narrowed 74 to 12, and sorting by name reordered them. |
| Brightness for all lights | Server and web tests, and the real browser: the slider sent 51% to all three test lights. The two online ones reported 51% and were confirmed. The offline one was named as not taking it. |
| Everything together | `npm test` in the Node 26 container: 723 tests (server 460, web 192, shared 71). Type check, lint and build clean. Phone width: no sideways scrolling on Scenes & Presets. |
| Local CI | `bash scripts/ci-local.sh --image` on `1dfd60e`: every check passed (723 tests, 0 vulnerabilities, image health, frontend, auth and setup code), then the script's last line failed with "Setup code was not logged". That was the script, not the app: the code was in the log, and `docker logs | grep -q` under `pipefail` fails about one run in eight (reproduced 1 of 8 by hand). The script is fixed in the next commit. The result on the final commit is in `docs/OPS_LOG.md`. |

**None of this has been tried on real lights.** The browser runs used the mock.

How it works, for whoever picks this up:

- `migrations/006_light_status.sql` adds `offline_streak` and `status_failures` to `devices`. Rolling back the code is safe with the columns left in place: the old version does not read them.
- `Connectivity` has a new value, `checking`. `ConnectionMonitor.confirmNewlyOffline` asks the second time.
- "Today's Color Scheme" is the built-in preset `daily-scheme`. `PresetService.apply` swaps in the scheme for the local date at the moment it runs (`packages/shared/src/daily-scheme.ts`). Its stored steps are refreshed hourly by `BuiltinPresets`, for display only.
- "Change automatically every day" stores nothing of its own. `DailySchemeService` finds, makes or edits a daily schedule that applies that preset. Rolling back leaves an ordinary preset schedule behind, which the old version runs as a fixed pattern.
- `POST /api/v1/lights/brightness` sends only a brightness command to each light that has one, never to a Govee group.

**AI Ask (Phase 1 of `docs/ai-features-plan.md`)** is built on the branch `claude/stoic-antonelli-c7ec73`, reviewed, fixed, and **passed local CI in full on `9c139c2`**. Ask is **deployed** (`9cb9eb3`, 10 November 2026, 07:14 UTC), and so are Describe a pattern and Describe a schedule (`69ae69d`, 14:03 UTC). No AI request has reached a provider yet. **Everything needed to carry on is in [ai-build-progress.md](ai-build-progress.md):** where it stopped, what is verified, the open findings, the next steps, and how to resume on any computer.

**White-LED fix merged (14 November 2026).** On 13 November the owner sent photos: one end of each of the three strings stays white under this app, while the Govee app colors the whole string. The fix from `fix/white-leds` (`f0b1b37`, 6 November) is merged into this branch. A pattern covering a whole string now sets the string to its main color with one whole-string command (`colorRgb`) before the segment commands, commands to one light go at least a second apart, and there is a pause after turning a light on. The merge kept the CI script from this branch. 759 tests pass (shared 71, server 473, web 215).

**Likely cause, not confirmed:** Govee's API exposes 27 segments per string, and the app paints all 27, so the white end is probably LEDs those segments do not cover. A whole-string color should reach them, so they would show the pattern's main color, not the pattern itself. To confirm, set one string to a single color from its device page and see whether the white end changes. If the API really cannot address that end segment by segment, it cannot show the pattern there.

## Open findings and decisions

| Item | Where | Severity | Who decides |
|---|---|---|---|
| Outdoor Center drops off often: flagged offline 9 times from 9 to 12 November, and Govee refused its commands as offline on 14 November | Production log; the Connections page after deploy | Medium | Owner: check its power and Wi-Fi signal. Software cannot fix this |
| The daily color scheme defaults to 16:05, just after the owner's daily Switch ON 16:00 and Apply Pattern 16:01. Whatever runs last shows, so a later schedule replaces the day's scheme | `apps/server/src/presets/daily-scheme-service.ts`, production schedules | Low | Owner: pick the time, or pause Apply Pattern |
| "Control brightness of the colors as a single unit" was read as one brightness for every light. If per-pattern brightness was meant, that is not built | `apps/web/src/features/presets/MasterBrightness.tsx` | Low | Owner |
| The daily rotation covers November and December only. Other months show warm white | `packages/shared/src/daily-scheme.ts` | Low | Owner, if wanted for other months |
| What Govee's 400 said on 12 November is unknown: the log keeps the category, not the message | `apps/server/src/govee/gateway.ts` (`noteFailure`) | Low | Log the message next time, if it recurs |
| Real-device behaviour is unverified, especially DIY scenes | `docs/acceptance-checklist.md`, `docs/govee-integration.md` | High until tested | Owner, with real lights |
| The H805C has 108 LEDs and 4 per segment: calculated from a manual, a third-party comparison and 27 reported segments, not stated by Govee | `docs/govee-integration.md`, `apps/web/src/features/patterns/pattern-model.ts` | Medium | Owner, by counting LEDs on real lights |
| Offline detection matches the word "offline" in Govee's message | `apps/server/src/govee/cloud-transport.ts` | Low | Revisit if Govee changes the wording |
| The owner's nightly Switch OFF at 23:00 means lights are off for the hour before the show, including on New Year's Eve | Production schedules | Low | Owner: change it for December 31 if wanted |
| Real phone delivery of Web Push is untested, including whether iPhones show the buttons | `docs/acceptance-checklist.md` | Medium | Owner, with a real phone |
| The owner's daily Switch ON 16:00, Apply Pattern 16:01 and Switch OFF 23:00 still run on holidays, so the usual pattern shows before each holiday starts | Production schedules | Low | Owner |
| Diwali dates come from one calendar for Los Angeles, and end at 2037 | `packages/shared/src/holidays.ts` | Low | Owner |
| Many holidays have no official colors, so those are suggestions | `packages/shared/src/festival-presets.ts` | Low | Owner |
| Lights Check says "1 string" when a schedule targets a Govee group, such as the owner's Switch OFF, because it counts targets | `apps/server/src/notifications/notification-service.ts` | Low | Fix with the next push |
| One end of each string stays white (owner's photos, 13 November). Likely LEDs outside the 27 segments the API exposes; not confirmed. The base color fix makes them show the main color | `docs/govee-integration.md`, `apps/server/src/commands/action-service.ts` | High | Owner, by running Check my lights after deploying |
| Reading LED colors would need Govee's private channel and account login, outside the official-API brief | `docs/govee-integration.md` | Decision | Owner |
| License is MIT, copyright "mannysinghx" | `LICENSE` | Low | Owner can change it |
| GitHub Actions: none exist, and CI runs locally by policy | `scripts/ci-local.sh` | None | Owner |
| ~~The global login limit could be used to block sign-in for 5 minutes at a time~~ Removed in Phase 3: no counter is shared by every account | `docs/security.md` | Resolved | |
| ~~`pull-backup.sh` did not bring back members' files~~ It does since Phase 5 | `scripts/pull-backup.sh` | Resolved | |
| ~~Members told to set `GOVEE_API_KEY`~~ They connect their own key since Phase 5 | | Resolved | |
| Privacy and terms pages are drafts, marked as such on the page, written from what the code does | `apps/web/src/features/legal/LegalPages.tsx` | High before sign-up opens to the public | Owner (P8): have them reviewed |
| Sign-in history (audit log) is kept with no time limit, until the account is deleted. The privacy page says it is kept to protect the account, without a period | `apps/server/src/auth/auth-service.ts` (`audit`) | Medium before Phase 7 | Owner: pick a retention, then build pruning |
| Lights per account are not capped: discovery adds whatever Govee returns for that person's key | `apps/server/src/devices/device-service.ts` | Low | Later, if needed |
| Not built: a disposable-address list (optional in the plan), and an owner switch to pause all background traffic | `docs/public-signup-plan.md` | Low | Owner |
| `CREDENTIAL_KEYS` must be set in Railway before members can connect any key | `docs/deploy-railway.md` | High before Phase 6 | Owner |
| `PUBLIC_URL` is not set in Railway, so email links would point at `glmserver-production.up.railway.app` | `apps/server/src/config/env.ts` (`resolvePublicUrl`) | Medium before mail is turned on | Owner: set `https://lightup.ink` |
| Google says new AI Studio keys are "auth keys". Whether they work with the OpenAI-compatible endpoint the app uses is not checked | `apps/server/src/ai/providers.ts` | Low, unverified | Check with the first real Gemini key |
| Members' account files carry the old, unused `users`, `sessions` and `login_attempts` tables from `001_initial.sql` | `migrations/001_initial.sql` | Low, harmless | Later cleanup |
| A fresh install of this version, rolled back to `19166b3`, would offer owner setup again, because the old `users` table is empty. Not the production case: the owner exists there | `apps/server/src/auth/control.ts` | Low | None needed for production |
| No mail has been sent from Railway: port 465 from Railway, and DKIM and DMARC for `lightup.ink`, are unconfirmed | `docs/deploy-railway.md` | Medium | Owner, after the push |

## Next steps, in order

0. After the 22 November deploys: the owner copies `CREDENTIAL_KEYS` from Railway into a password manager; adds an email address in Settings (the first real send; if nothing arrives, the deploy log says why); turns on DKIM and adds DMARC in Namecheap DNS; then turns sign-up on in Settings, Sign-up. Then Phase 6 (sign-up on, capped at 1 or 2 trusted people), only when asked.
0. After the 14 November deploy: have the owner open the dashboard, press Check lights now, and compare each light with the Govee Home app. Then open Scenes & Presets, confirm the color scheme of the day is there, and switch on the daily change if wanted. Check Outdoor Center's power and Wi-Fi. Before any later push, run `bash scripts/ci-local.sh --image` on the exact commit (the file is not executable, so it needs `bash`, or `npm run ci -- --image`).
1. Have the owner turn on alerts on a phone, using the final web address, and press Send a test.
2. Check the first real Diwali run on 2026-11-08 at 5 PM Los Angeles time.
3. Send a pattern to one real H805C string and check it, including the LED count, with `docs/acceptance-checklist.md`.
4. Work through the rest of the checklist.
5. Correct anything the checklist disproves. Adapters are isolated in `apps/server/src/govee/`, and each open question is listed in `docs/govee-integration.md`.

## How to resume

Needs Node 22.12+, 24 or 26 (26 is in `.nvmrc`), and Docker for CI.

```bash
git clone https://github.com/mannysinghx/GoveeProject && cd GoveeProject
```

```bash
npm ci
```

```bash
npm test
```

```bash
npm run dev:mock
```

Then open <http://localhost:5187>. For real lights, see `README.md`. `dev:mock` also starts a fake mail server on port 2525; links from sign-up and reset emails appear in its output (the `mail` lines). Sign-up is off until you turn it on in Settings, Sign-up, as the owner.

Tests for this work ran in Linux, in a container with the repo at `/app`, because this Mac's Node 23 is outside the supported versions. From the repo:

```bash
docker run -d --name glm-dev-phase1 -w /app node:26-bookworm-slim sleep infinity
```

```bash
git ls-files -co --exclude-standard | COPYFILE_DISABLE=1 tar --no-mac-metadata -cf - -T - | docker exec -i glm-dev-phase1 tar -xf - -C /app
```

```bash
docker exec -w /app glm-dev-phase1 sh -c 'npm ci && npm test'
```

The Phase 4 and Phase 5 mutation checks are in `docs/public-signup-evidence/`, with how to run them.

Before any push, run the CI on the exact commit. It never uses GitHub:

```bash
bash scripts/ci-local.sh --image
```

## Proposals not started

- **Sharing designs between accounts** (asked 22 November 2026): [the plan](sharing-plan.md). Decisions D1 to D4 made by the owner (copies of designs, live with owner moderation, display names, match then confirm). Nothing built; phases S1 to S4 wait for the owner's go-ahead.

- **Open public sign-up with email verification, built in-house, plus bring-your-own AI key** (asked for 21 November 2026): [the plan](public-signup-plan.md). Being built: Phases 1 to 5 are done, see "Public sign-up" under "In flight". Still open: P8 (terms and privacy policy, the owner's).
- Letting other people sign up, invite-only: [the plan](multi-user-plan.md). On 9 November 2026 the owner said no sign-up was needed. The 21 November request above supersedes that, and reuses its design.
- AI features for the owner's own account, free to use, with a monthly spending cap: [the plan](ai-features-plan.md). It is waiting on the decisions listed in it, and nothing is built.
