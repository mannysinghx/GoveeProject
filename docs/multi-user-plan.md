# Letting other people use lightup.ink with their own lights

**Status: a plan only. Nothing here is built, and production was not changed.**
Written 7 November 2026 UTC, against `main` at `10bb5c8`. Line references are to that commit.

## The short version

Today, nobody else can use the site: the database allows one account and the server holds one Govee key. It can be changed, and most of the work is smaller than it first looks if each person gets their own database file. The harder parts are outside the code: Govee's terms, handling other people's keys, and being responsible for a service strangers depend on.

**Recommendation**

1. **Ask Govee first.** Govee's developer terms were not publicly readable, and at least one third-party project describes keys as personal-use only. If Govee says no, hosting for others stops here, and a self-hosting guide is the fallback.
2. **Start invite-only,** with people you know, capped at about 25 accounts. Open sign-up is a separate later decision. It adds email, spam and legal work.
3. **Give each person their own SQLite file** and keep your existing file exactly where it is. Your data is not rewritten, and going back is a redeploy.
4. **Encrypt each Govee key** with a secret held outside the database.

One warning that applies today: **do not press Submit on "Apply for API Key" in the Govee Home app** unless you mean to replace your key. Govee disables the old key immediately, which would stop the live site until the new one is installed.

## Decisions you need to make

| # | Decision | Options | Recommendation | What the recommendation costs you |
|---|---|---|---|---|
| D1 | Who can use it? | A. Self-hosting guide only. B. Invite-only on lightup.ink. C. Open sign-up. | B now, and publish A anyway. Decide C after running B for a season. | You personally invite and support people. |
| D2 | Wait for Govee's answer before building? | Wait, or build at risk. | Wait. Read the terms and ask the questions in [Govee and legal](#govee-and-legal-questions). | Possibly weeks with no reply. Phases 1 and 2 could start at low risk if you prefer. |
| D3 | The brief says the key must never reach browser JavaScript. A person can only enter their own key in a browser. | Narrow the rule, or have no self-service. | Narrow it: the server never sends a key **to** a browser, and the browser only handles it while the person enters it. | The strict rule is gone. A malicious browser extension on that person's computer could read the key as it is typed. |
| D4 | The brief limits outside services to Govee. Web Push has already bent that (`docs/security.md:161`). Email would bend it further. | No email, or an email provider. | No email service while invite-only. Collect a contact address, and send invite and reset links by hand. Open sign-up needs a provider. | Your time on each forgotten password. |
| D5 | How is data separated? | One file per person, an owner column on every table, or Postgres. | One file per person. See [the comparison](#how-to-separate-peoples-data). | Fleet-style operations: migrating and backing up many files. |
| D6 | Who runs the service, legally? | You personally, or a company. | Your choice, with advice from a lawyer before strangers join. | Legal fees and possibly insurance. Not estimated here. |
| D7 | Free or paid, and how many accounts? | Free or charged, with a cap. | Free, capped at 25, then 100 once the numbers below are checked on Railway. | Hosting costs fall on you. Charging raises the commercial-use question with Govee. |
| D8 | How often should background checks run for other people? | Every 2 minutes as now, or slower. | Every 5 minutes by default. Yours can stay at 2. | Others notice a dropped light up to 5 minutes later. It reduces traffic that could look abusive to Govee. |
| D9 | Should new accounts get holiday shows automatically? | On, as now, or opt-in. | Opt-in, after asking for a time zone. See finding 7 below. | One more onboarding step. |
| D10 | Where do backups live, and for how long? | Railway only, or also a separate store. | Railway daily and weekly, plus nightly copies to a Railway bucket. No monthly backups, so deleted accounts leave backups within about 30 days. | A few dollars a month. A failure of Railway itself is still not covered. |
| D11 | Can you see other people's data? | Technically yes, as whoever has server access. | The admin screen shows no lights, schedules or keys, and the privacy policy says plainly that server access exists. | You cannot look at someone's setup when helping them, unless they show you. |

## What stands in the way today

Each of these was checked in the code on `main`.

| # | Finding | Where |
|---|---|---|
| 1 | The `users` table allows only row 1, and auth code hard-codes that id. | `migrations/001_initial.sql:6`, `apps/server/src/auth/auth-service.ts:77`, `:146`, `:194`, `apps/server/src/cli/reset-password.ts:40` |
| 2 | One key, one transport, one rate limiter and one set of services for the whole process. | `apps/server/src/app/context.ts:120`, `:125` |
| 3 | No data table has an owner, and names are unique across the whole database. A second person could not have a group called "Front" if you do. | `migrations/001_initial.sql:54`, `:99`, `:113` |
| 4 | Routes capture their services when the app starts, not per request. | `apps/server/src/devices/device-routes.ts:21`, and the same in each routes file |
| 5 | Changing your password signs out **everyone**. | `apps/server/src/auth/auth-service.ts:197` |
| 6 | A successful sign-in clears the shared failure counter, and that counter also lets anyone lock everyone out for 5 minutes. With other accounts, an attacker could sign in to their own account to reset the limit between guesses at yours. | `apps/server/src/auth/auth-service.ts:255`, `:258` |
| 7 | **A new account with lights gets 46 enabled schedules, with no consent,** so someone else's lights would start changing for holidays they never asked for. Measured, not just read. Their time zone comes from one call on the setup screen. If a new sign-up flow misses it, they fall back to the server's zone, and on UTC that puts New Year fireworks at 4 PM in Los Angeles. | `apps/server/src/presets/builtin-presets.ts:265`, `:279`, `:312`, `:322`, `apps/web/src/features/auth/SetupPage.tsx:88`, `apps/server/src/system/settings-service.ts:8` |
| 8 | Diagnostics show the database path, Node version and uptime to anyone signed in. | `apps/server/src/system/system-routes.ts:22`, `:33` |
| 9 | The daily request count is in memory and resets on every restart. | `apps/server/src/govee/rate-limiter.ts:53` |
| 10 | The secret scrubber is built once at startup from a fixed list of secrets. | `apps/server/src/app/context.ts:101`, `apps/server/src/shared/logger.ts:56` |
| 11 | Messages tell people to edit `GOVEE_API_KEY` on the server, which others cannot do. | `apps/server/src/govee/cloud-transport.ts:119`, `:241`, `apps/server/src/connection/diagnosis.ts:32`, `:43` |
| 12 | Phone notification buttons have no session. The server finds the notification from the token alone, which needs a way to find the right account first. | `apps/server/src/notifications/notification-routes.ts:53` |
| 13 | Shutdown is forced after 15 seconds, and services stop one after another. With many accounts that would run out of time. | `apps/server/src/main.ts` |
| 14 | There is no general request limit on signed-in routes. The per-device queue limit is the only brake. | `apps/server/package.json` has no rate-limit plugin |
| 15 | No tested way exists to get a backup off Railway, and restore has never been run against production data. | `docs/deploy-railway.md`, "Backup" |

One thing that helps: there is no mutable state at module level. A search found only three constant sets, so a separate set of services per person really would be separate.

## How to separate people's data

| | One file per person (recommended) | Owner column in one file | Postgres |
|---|---|---|---|
| **If a query forgets the owner** | Not possible: the query can only see one person's file | Silent leak of someone else's data. 148 statements in 18 files must each be right. | Silent leak, unless row-level security is set up and correct |
| **Future tables, such as other sessions adding features** | Separate automatically | Each one must remember the column | Each one must remember the policy |
| **Your existing data** | Untouched. The current file becomes yours. | Up to 22 tables changed in production, and those with unique names or keys rebuilt | Everything moved to a new system |
| **Going back** | Redeploy the previous version | Restore a backup, losing anything since | Restore, and rewrite the app back |
| **Delete one person** | Delete a file | Careful delete across every table | Careful delete across every table |
| **Restore one person** | Copy one file | Hard: a restore affects everyone | Hard |
| **Work needed** | Medium: split the context, change 65 routes | Large, and every future change carries the risk | Very large: all database calls are synchronous today and would become asynchronous |
| **Queries across everyone** | Awkward, so kept to a small control database | Easy | Easy |
| **Memory** | Higher: see the measurements | Lowest | Separate database service to pay for |
| **More than one server** | No, but accounts could move to a second service | No | Possible, but queues and limits would also need sharing |

**Why rebuilding tables is especially risky here.** I tested it. Adding owners to tables with `UNIQUE` constraints means rebuilding them, and SQLite ignores `PRAGMA foreign_keys = OFF` inside a transaction, which is how `runMigrations` runs every migration (`apps/server/src/database/database.ts:15`, `:64`). On a throwaway database, the usual rebuild recipe on `devices`:

- **deleted all status history, capability state, group membership and command history**, and blanked the device on activity records, while reporting success
- failed safely only when a preset happened to be pinned to that device, which would make it look safe or unsafe depending on the data

If an owner column is ever chosen, the runner would first need a mode that runs outside a transaction with foreign keys off.

### Measured: one set of services per person

Each account had its own SQLite file and its own full set of services, with all background timers running, as `main.ts` starts them. Three lights per account, and a stand-in for Govee taking 150 ms per request. Linux container, Node 26, limited to 2 CPUs. **Nothing was sent to Govee, and Railway's disk may be slower.**

| Accounts | Memory, new accounts just set up | Memory after a restart | Everything idle: delay, 99th percentile | Same-moment run on every account | Longest stall during it | Every account checks its lights at once | Back up and verify every file |
|---|---|---|---|---|---|---|---|
| 10 | 147 MB | Not measured | 13 ms | 30 commands, 0.2 s | 12 ms | Not measured | 0.1 s |
| 100 | 530 to 553 MB | Not measured | 13 ms | 300 commands, 0.3 s | 22 to 40 ms | 300 requests, 0.5 s, 30 ms stall | 0.4 s |
| 500 | 1.8 to 2.4 GB | 0.6 to 0.7 GB | 13 to 16 ms | 1,500 commands, 0.7 to 1.1 s | 95 to 106 ms | 1,500 requests, 0.8 s, 72 to 159 ms stall | 2.3 s |
| 1,000 | 3.7 to 3.9 GB | Not measured | 12 ms | 3,000 commands, 2.9 s | **1,050 ms** | Not measured | 6.0 s |

What this shows:

- **Memory is the real cost:** roughly 1.3 MB per account after a restart, and up to about 4 MB per account just after setup. A 256 KB database cache per account cut the idle restart figure from 716 MB to 565 MB. Its effect on query speed was not measured.
- **Idle cost is small.** All those timers barely register, and the baseline delay of about 11 ms is mostly the sampling interval.
- **A stall delays other people's pages, not just lights.** Under 500 accounts the worst case is about 160 ms. At 1,000, firing every account at the same instant stalls the server for a second, so the random offsets and the request limit below are needed well before then.
- **Setting up many accounts in the same moment is slow:** 0.8 s of stall at 100, up to 6.8 s at 500 and 10.5 s at 1,000. This only happened because the test set up all of them at once, and real sign-ups arrive one at a time. Reloading existing accounts after a restart stalled for at most 88 ms at 500.
- **A restart is quick.** Opening 500 existing files and checking their migrations took 0.3 to 2.2 s, well inside Railway's 60-second health check.
- **Each account holds 3 open files.** The test allowed 65,536. Railway's limit was not checked.
- **This is the best case for CPU.** The stand-in does no HTTPS, and real requests cost more, so treat these as a lower bound.

The scripts and raw output are in [`docs/multi-user-evidence/`](multi-user-evidence/). A monitor timing in the first run was discarded, because the checks had been skipped as too recent. The corrected run confirms the request counts.

## The design

### Two kinds of database

```
/data/control.sqlite                       Accounts, sessions, keys, invites, limits, audit log
/data/govee-light-manager.sqlite           Your existing file, unchanged, now "account 1"
/data/accounts/<random id>.sqlite          Everyone else: devices, groups, presets, schedules, history
```

`AppContext` splits in two. A **platform context** has one copy of config, logger, control database, accounts and credentials. An **account context** has one copy per person of everything else that exists today: database, transport, limiter, queue, scheduler, monitor, notifications and built-in presets.

The current migrations stay in `migrations/` for account files, and control migrations go in `migrations/control/`. The runner already ignores subfolders, because it only matches `NNN_name.sql` files.

Routes change from `const { devices } = ctx` at startup to looking up the signed-in person's context per request. Removing those services from the platform context turns any missed route into a **compile error**, not a silent leak.

### Accounts and sign-up

| Table in `control.sqlite` | Holds |
|---|---|
| `users` | Id, username, contact email, password hash, role (`admin` or `member`), status, file path, time zone |
| `sessions` | As today, with a real `user_id` |
| `login_attempts` | Throttling, redesigned below |
| `invites` | Hash of a single-use token, who created it, expiry, who used it |
| `credentials` | The encrypted Govee key, below |
| `recovery_codes`, `password_resets` | Hashes only |
| `request_counts` | Requests per key per day, so budgets survive restarts |
| `audit_events` | Sign-ins, key changes, resets and admin actions, across accounts |

**Sign-up, invite-only.** You create an invite on an admin screen and send the link yourself. The person sets a username and a password of at least 12 characters (`packages/shared/src/schemas.ts:54`), accepts the terms and saves their recovery codes. Then they choose a time zone, connect their Govee key and choose which holiday shows they want. The current setup screen and its code go away after migration.

**Sign-in and throttling.** Failures are counted per account and address, per address and, more slowly, per account. A success clears only that person's account-and-address counter. The all-address lockout goes away, because with real users it becomes a way to block everyone. Password hashing gets a concurrency limit, so a flood of sign-ins returns 429 rather than exhausting memory. Each hash costs 19 MiB.

**Later.** Optional two-factor codes would add no outside service. They are worth doing before open sign-up.

### Password reset, with no email today

The Govee key does not depend on the password, so a reset never loses it. The key **cannot** be encrypted with the password, because schedules have to use it when nobody is signed in.

| Method | Works by | Costs | What could go wrong |
|---|---|---|---|
| **Recovery codes** (do this) | 10 single-use codes shown once at sign-up, stored only as hashes | Nothing | People lose them |
| **Admin reset link** (do this) | You check who is asking, and create a link valid for 1 hour | Your time | Someone talks you into resetting another person's account. Audited, and they get a notice in the app. |
| **Server command** (keep) | `reset-password` gains a `--username` and signs out only that person | Nothing | Only for you |
| **Email link** (only for open sign-up) | A transactional provider sends a 30-minute link | An outside service (D4), plus SPF, DKIM and DMARC on lightup.ink | Spam folders, account enumeration, provider outage. Provider pricing not checked. |

A reset signs out only that person, and an attacker who gets in still cannot read the Govee key out of the app.

### Storing each person's Govee key

Govee offers no sign-in delegation that I could find, so each person has to paste their key. **That key controls every light on their account, and only they can revoke it,** by applying for a new one in the Govee app.

**Encryption.** AES-256-GCM from `node:crypto`, with no new dependency, as `docs/known-limitations.md:83` already requires.

- The master secret is a Railway variable, `CREDENTIAL_KEYS`, listing numbered versions such as `2:<base64>,1:<base64>`. It is never stored in a database or a backup.
- Each row has a random nonce, its master key version, and the account id bound as additional data, so a row copied onto another account fails to decrypt.
- A separate keyed fingerprint, `HMAC(key derived from the secret, Govee key)`, is stored under a unique index. It stops two accounts using one key, which would double the real request rate. Only someone already holding that key can learn it is in use.
- `GoveeCloudTransport` takes a function returning the current key rather than a fixed string. Everything else stays: the fixed Govee host, `redirect: 'error'`, and the header being set only there.

**What this protects, honestly.** It protects a leaked backup, database file or SQL dump. It does **not** protect against someone who has Railway variables as well as the volume, or who runs code inside the live process. Either of those gets every key. An outside key service would narrow this at the cost of the brief's outside-services rule. I do not recommend one at this size.

**Keeping the key out of places it must not go**

| Place | Rule | Checked by |
|---|---|---|
| Browser | Sent once, on connect. No API returns it, not even in part. Not kept in React state or query caches, and cleared after sending. | Test that no response contains it; the existing bundle check in `scripts/ci-local.sh` |
| Logs | Scrubber per account, plus the existing `redact` paths. Request bodies stay unlogged. | Extend the existing tests in `apps/server/tests/security.test.ts` |
| Activity, history, notifications | Scrubbed by each account's `ActivityService`. Rejected-key messages never include it. | Test with a fake key echoed by the mock |
| Git and tests | Fake values only, as `TEST_API_KEY` does today | Existing practice |
| Claude sessions | **Never call Railway's `list-variables` for this project, or print the master secret.** It returns values, which would put them in a transcript. | Add to `docs/deploy-railway.md` |

**When someone changes their Govee key.** Applying for a new key kills the old one immediately ([Govee's notice, effective 15 May 2026](https://developer.govee.com/changelog/important-policy-update-important-notice-regarding-api-key-security-management)). So:

1. The onboarding text says: if you already have a key for Home Assistant or similar, reuse it, because a new one breaks that. Requests from both count against the same limits.
2. Replacing a key tests it with one device-list call **before** saving. The old one stays if that fails.
3. If the new key shows entirely different devices, the person is warned, because their schedules would then point at missing lights.
4. Key checks are limited to about 5 per hour per account, so the form cannot be used to test stolen keys.

**When a key stops working.** The first 401 or 403 sets the credential to `rejected`, stops all requests on it, and tells the person. A single daily retry covers a Govee mistake. Today the monitor would keep asking for every light on every pass (`apps/server/src/connection/connection-monitor.ts:192`), which is what a badly behaved client looks like to Govee.

**Rotating the master secret.** Add version 2 to the variable and restart. A command re-encrypts all rows in one transaction and verifies each, then version 1 is removed with another restart. Keep retired versions offline for as long as any backup needs them.

**Losing it.** The app still starts. Accounts show "reconnect your Govee key" and no row is overwritten, so nothing else is lost. Keep a copy in your password manager, away from the backups.

**If the secret and data both leak.** There is nothing the app can revoke. Every affected person must apply for a new key in the Govee app. The response is: mark all credentials `needs_reentry`, notify people, rotate the secret. This is the main reason to collect a contact address even without an email service.

### Isolation, table by table

| Table | Where it goes | Note |
|---|---|---|
| `users`, `sessions`, `login_attempts` | Control | Old copies stay in your file until a later cleanup, so going back works |
| `devices`, `device_states`, `capability_states`, `device_scenes` | Account file | `UNIQUE (sku, govee_device_id)` is then per person |
| `groups`, `group_devices`, `presets`, `preset_actions` | Account file | Name uniqueness is then per person |
| `execution_runs`, `command_history`, `activity_events` | Account file | Failed sign-ins for unknown names go to control `audit_events` instead |
| `schedules`, `schedule_executions`, `show_skips`, `builtin_installs` | Account file | |
| `connection_incidents`, `missed_deliveries` | Account file | |
| `application_settings` | Account file | Settings and `_system.*` become per person |
| `notifications`, `notification_tokens`, `push_subscriptions` | Account file | Tokens gain an account prefix, finding 12 |
| `push_keys` | Account file | Each account signs its own push messages. Contains a private key, so backups stay secret. |
| `schema_migrations` | Both | Each file tracks itself |

### Isolation, route by route

There are 65 routes on `main`, 5 of them public.

| Routes | Count | Change |
|---|---|---|
| `/auth/*` | 5 | Move to platform. `setup` becomes invite sign-up. Password changes affect one person. |
| `/health` | 1 | Platform. Gives overall status only. |
| `/system/status` | 1 | Split: own Govee status for everyone. Path, Node version, uptime and capacity for admins only. |
| `/dashboard/summary`, `/settings` | 3 | Per account |
| `/devices/*`, `/commands/:id` | 15 | Per account |
| `/groups/*` | 6 | Per account |
| `/presets/*` | 8 | Per account |
| `/schedules/*` | 12 | Per account |
| `/activity` | 1 | Per account |
| `/connection/*` | 4 | Per account |
| `/notifications/*` | 8 | Per account. Signing out must also remove that browser's push subscription, or a shared phone keeps getting someone's alerts. |
| `/notification-actions` | 1 | Public. Finds the account from the token prefix. Unknown account and bad token give the same answer. |
| **New** `/auth/invite`, `/auth/recover` | | Public, and rate limited |
| **New** `/account`, `/account/govee-key`, `/account/export` | | Own account. Delete requires the password again. |
| **New** `/admin/*` | | Admin only, and no access to anyone's lights |

**How this stays true over time**

1. **A compile error** for a route that still uses the old shared services.
2. **A route census test.** A Fastify `onRoute` hook lists every route, and the test fails unless each one is classified as public, account or admin. A route added by any future session fails until someone classifies it.
3. **A two-person test.** Every account route is called with person A's real ids under person B's session and must return 404, with no change to A's data.
4. **One resolver.** Only one function turns a session into an account context, so the remaining risk has one place to review.

### Rate limits and daily budgets

A per-account limiter already gives the right limits, because Govee's limits are per account and per device.

| Govee limit ([current reference](https://developer.govee.com/reference/get-you-devices)) | App default, per key |
|---|---|
| Device list: 30 per minute per account | 20 |
| Control: 12 per second per account, burst 80 | 8 |
| Control: 2 per second per device, burst 6 | 1 |
| State: 30 per minute per device | 20 |
| Scenes: 30 per minute per device | 10 |
| Daily: none in the current reference. [An older Govee page](https://govee.readme.io/reference/rate-limiting) from January 2025 says 10,000 per day. | 8,000 |

Added on top:

- **Daily counts survive restarts.** They are saved to `request_counts` about once a minute. Govee's own day boundary is unknown, so a restart or a boundary difference could still overshoot slightly.
- **Scheduled runs get a reserve.** The last 10% of a day's budget is for schedules, so a pattern-painting session cannot use up tonight's run.
- **A process-wide limit** on simultaneous Govee requests, about 32, protects the server.
- **A shared-address guard. This is the biggest unknown.** Every account's requests come from Railway's address, and whether Govee limits per address is not documented. If several unrelated keys get 429s within a minute, all accounts pause and you get an alert. Static outbound addresses are [available on Railway Pro](https://docs.railway.com/networking/static-outbound-ips), if Govee asks to allow-list one.
- **A per-account limit on signed-in routes,** such as 120 requests a minute and tighter on discovery. This can be built without a new dependency.

### Schedulers, the monitor and shared timing

Each account keeps its own scheduler and monitor unchanged, which keeps the crash and restart behaviour that has already been tested.

| Situation | Behaviour |
|---|---|
| No key connected, or account suspended | Context not loaded, no timers, no cost |
| Key rejected | Scheduler still records occurrences, runs fail with "reconnect your key", one notification only, no Govee calls |
| Startup | The server starts listening first, then loads accounts in small batches. Railway's health check allows 60 seconds. Requests for an account not yet loaded get a clear 503. |
| Timers | Each account's start is offset randomly, so ticks and checks do not line up |
| Everyone's midnight | Runs are bounded by the process-wide limit. Queued commands time out after 60 seconds, and scheduled runs have 2 minutes of grace, so a long backlog fails visibly rather than firing late. |
| Bad migration on one file | That account is quarantined and returns 503, you are alerted, and others keep working. Migrations must stay additive, as they are now. |
| Shutdown | Services stop in parallel per account, within the 15-second limit |
| Long-unused accounts | After 90 days with no sign-in, checks stop until the person returns. Schedules keep running. |

**Monitor traffic.** At the current rate, 3 lights means about 2,000 requests a day per key. With 100 accounts that is about 200,000 requests a day from one address, and 1,000 accounts would be 2 million. That is why D8 suggests 5 minutes, which is 864 requests per key per day.

### Is SQLite on one Railway volume still enough?

**Yes, for invite-only and likely for hundreds of accounts.** The measurements above support that up to 500, but they are a best case, and Railway's disk and real HTTPS traffic need their own check before relying on those numbers. The volume is 50 GB, and a new account's file is about 0.7 MB, plus up to about 1 MB of write-ahead log.

The real limit is not speed. It is that **one process on one volume in one region is a single point of failure.** [Railway does not allow replicas with volumes](https://docs.railway.com/volumes/reference), so a crash, deploy or regional problem stops everyone's schedules until it recovers. Tell people that plainly. Every deploy is a short outage for everyone, so deploys should avoid evenings and holidays.

**Change approach if any of these becomes true:**

- Event-loop delay stays above about 100 ms at the 99th percentile during normal use
- Memory cost outgrows what you are willing to pay
- Restart takes long enough to delay schedules past their grace period
- People need better availability than one server can give

The first step then is moving some account files to a second service, with a router in front. Postgres would be a rewrite and is not worth doing before that.

### Migrating your data, with a tested backup and restore

**Your data is not rewritten.** Your file stays at its current path. The migration only creates `control.sqlite` and copies in your account row and your key.

**Before touching production**

1. **Build the way out first.** Add a command that backs up every file and verifies it, and a tested way to get a copy off Railway. Streaming through `railway ssh` is unproven for binary data, so it has to be compressed and base64-encoded, then checked against a SHA-256 hash and with `PRAGMA integrity_check`.
2. **Rehearse on a real copy, with your approval, on this Mac in Docker,** because it holds your account and device data. Rehearsal rules, because the app acts when it starts:
   - `GOVEE_API_BASE_URL` points at the local mock, and no real key is present
   - `SCHEDULER_ENABLED=false` and `CONNECTION_MONITOR_ENABLED=false` for the first start
   - Then turn the scheduler on, against the mock, to confirm that no occurrence fires twice
   - Delete the copy afterwards
3. **Rehearse the restore, both ways.** Restore the full set, and restore just one account. Compare row counts per table, `integrity_check`, `foreign_key_check`, and each schedule's `next_run_at`, then sign in.
4. **Automate the restore drill** so it runs in `scripts/ci-local.sh` against seeded data.

**The cutover, as one deploy**

| Step | Action | Undo |
|---|---|---|
| 1 | Pick a time at least 48 hours from any show. **Not around Diwali on 8 November, and avoid the run-up to New Year's Eve.** Stop other deployments for the day. | |
| 2 | Note row counts and every schedule's `next_run_at` | |
| 3 | Back up with the verified command, download it, check the hash. Also create a Railway volume backup. | |
| 4 | Add `CREDENTIAL_KEYS`, and keep `GOVEE_API_KEY`. This restarts the app. | Remove it |
| 5 | Deploy. On first start: create `control.sqlite`, copy your account row, encrypt your key from `GOVEE_API_KEY`, and register your file. It repeats safely if interrupted. | Redeploy the previous version |
| 6 | Sign in again, and check all 3 strings online, the schedules and the counts. **Send no commands to lights as a check.** | As above |
| 7 | Wait for one real scheduled run | As above |
| 8 | Only after about 2 weeks, remove `GOVEE_API_KEY`. | Set it again |
| 9 | Only after a further backup, remove the unused `users`, `sessions` and `login_attempts` from your file. It contains an old copy of your password hash. | Restore. **This is the one-way step.** |

**What going back can and cannot do.** Until step 9, the previous version finds its own file and tables intact and `GOVEE_API_KEY` still set, so a redeploy restores service. Anything changed in the meantime stays, because it is the same file. Other people's accounts cannot be served by the old version. Their files stay on disk and are usable again after rolling forward.

**The limits of a restore.** Backups run nightly, so up to a day of changes can be lost. As `docs/security.md` already notes, an older backup can let a recent `run_latest` occurrence run again. Master secrets are stored separately from backups, so restoring needs both. Railway backups [can only restore into the same project and are deleted if the volume is wiped](https://docs.railway.com/volumes/backups), which is why D10 adds a second location. Bucket backups should be encrypted, because they hold home locations and device lists.

### Abuse controls

| Risk | Control | Cost |
|---|---|---|
| Fake accounts | Invites only, with a per-person invite limit. Open sign-up would add verified email and a challenge, which is another outside service unless self-hosted. | Slower growth |
| Password guessing and sign-up floods | The throttling above, a limit on simultaneous hashing, and limits per address | An office or shared address can occasionally be slowed |
| Someone using a stolen Govee key | Audit log, a key-check limit, one account per key, a suspend button, an address for reports | You handle reports |
| One account hogging the server | Limits per account on devices (200), presets, schedules, groups, and history retention. Existing queue cap. | Limits need tuning |
| Disk filling | Per-account file size alert, stop writing history over a limit, volume alert at 70% | Small amount of code |
| Sending messages to anyone | Push only goes to allow-listed services, as now. Names people type appear only to them. | None |
| Harm from a hosted page | No shared content, no public pages, no file uploads, so this is low | None |
| You being locked out | A second admin method: the server command. | None |

There is also an admin screen for accounts, status, invites, suspension, usage and capacity, with an emergency switch to stop sign-ups or all background traffic.

### Govee and legal questions

**This is not legal advice, and none of it has been answered yet.**

**What is known about Govee**

- Applying for a key involves accepting a "Govee Developer API Terms of Service", and "3rd party integration" is listed as a possible reason ([Govee's page](https://govee.readme.io/reference/applying-for-an-api-key)). **I could not find the text anywhere public.** It may only be on the apply screen in the Govee Home app.
- To read them, open that screen and **do not press Submit.**
- One third-party project's README says ["The keys are for personal use only"](https://www.github.com/lordofscripts/govee). This is secondhand, and could not be checked against the terms.
- Govee's developer site [calls the platform a beta](https://developer.govee.com/docs/getting-started) and points to its community forum for questions.

**Ask Govee, in writing**

1. May a third party host a service where each user supplies their own key? Does it matter if it is free or paid?
2. May a service store user keys, encrypted, and use them while the user is away?
3. Are there limits per IP address? Should a shared server address be registered?
4. Is there a daily limit today, and when does its day reset?
5. Is there an OAuth or partner route, so people would not need to hand over keys?
6. May the site say it works with Govee, and is there wording they prefer?

**Check with a lawyer before accepting strangers**

| Question | Why it matters here |
|---|---|
| Terms of service | The MIT license covers the code, not a hosted service. Lights changing at night, missed schedules and outages all need terms. |
| Privacy policy | The app holds emails, IP addresses, **latitude and longitude for sunrise schedules, which can be a home address,** and schedules and history that can show when someone is home. |
| Which privacy laws apply | California and other US state laws depend on size and purpose. Any EU or UK resident could bring in GDPR and UK GDPR. Limiting invites to the US reduces this but does not settle it. |
| Breach duties | Passwords and keys are held. Notification duties vary by state. |
| Sub-processors | Railway hosts everything. Apple, Google and Mozilla carry push messages. Any email provider would be added. |
| Personal or company liability | Decision D6. Possibly insurance. |
| The "Govee" name | "Govee Light Manager" uses a trademark. The public site should say it is not affiliated. Renaming may be advised. |
| Minimum age, deletion and export | A policy is needed. Account delete and export are in the plan. |

## What it would cost

Using [Railway's published prices](https://docs.railway.com/pricing/plans): memory $10 per GB per month, CPU $20 per vCPU per month, storage $0.15 per GB per month, outbound traffic $0.05 per GB. Your 50 GB volume suggests the Pro plan, which I did not confirm. Production currently uses about 60 MB of memory, peaking at 115 MB, and almost no CPU, which is a day of data for one account.

These are estimates. Memory uses 4 MB per account plus 100 MB, which is the high figure measured. CPU on real traffic was not measured, so it is a guess of 0.1 vCPU per 100 accounts. Storage **assumes 20 MB per account,** and traffic assumes 3 KB per request with checks every 5 minutes.

| Accounts | Memory | CPU | Storage | Traffic | About per month, on top of your Railway plan |
|---|---|---|---|---|---|
| 25 | $2 | $0.50 | $0.10 | $0.10 | **$3** |
| 100 | $5 | $2 | $0.30 | $0.40 | **$8** |
| 500 | $20 | $10 | $1.50 | $2 | **$34** |
| 1,000 | $40 | $20 | $3 | $4 | **$67** |

Backups add a little more storage, billed at the same rate on what they hold beyond the volume.

Those are hosting costs only. The larger costs are:

- **Build time.** Phases below.
- **Your time:** support, invites, password resets, Govee's replies, and any incident.
- **Legal:** not estimated.
- **An email provider,** only for open sign-up. Pricing not checked.

## What could go wrong

| Risk | How likely | How bad | What limits it |
|---|---|---|---|
| Govee forbids hosted use, now or later | Unknown | Service ends | Ask first. The self-hosting guide is the fallback. Keep people's data exportable. |
| Govee limits by shared address | Unknown | Everyone's lights stop responding | Shared-address guard, slower checks, ask Govee, static addresses |
| Keys leaked by a server compromise | Low | Every person's lights can be controlled, and they must each replace their key | Encryption, minimal access, an incident plan. Cannot be fully prevented. |
| The wrong person's data shown | Low with this design | Severe loss of trust | One resolver, compile errors, census and two-person tests |
| Migration damages your data | Low | Your setup is lost | File is untouched, verified backup, rehearsal, redeploy to undo |
| A long refactor conflicts with other work | **High** | Slow merges, or lost fixes | Land `fix/white-leds` first, keep Phase 1 short and mechanical, pause feature work during it. It touches all 9 routes files and `context.ts`. |
| A backup exists but cannot be restored | Medium until drilled | Discovered at the worst moment | Automated restore drill |
| Master secret lost | Low | Everyone reconnects | Password-manager copy. Data is unaffected. |
| A person's schedule fails and they blame you | **High** eventually | Support load | Clear status, terms, and no promise of availability |
| Holiday shows surprising new people | Certain if not changed | Lights change unexpectedly at the wrong hour | Opt-in, D9 |
| An app bug breaks everyone at once | Medium | All accounts down | Local CI, a staged rollout: you first, then invites |
| Testing is limited by having one real Govee account | **High** | Multi-key behaviour is only proven against a mock | Invite one trusted person first, and treat it as a test |

## Build order

Sizes are rough estimates. Following the deploy rule, each phase is built and tested in full, then proposed as **one** push with approval. Run `scripts/ci-local.sh --image` on the exact commit first. Each server change restarts the only instance, so choose times accordingly.

| Phase | What | Size | Deploys | Finished when |
|---|---|---|---|---|
| **0. Answers** | D1 to D11, Govee's reply, read the terms, a first legal conversation | Waiting, no code | None | Decisions recorded here |
| **1. Safety net** | Verified backup command, off-Railway copy, automated restore drill, real-copy rehearsal | Small, about 1 to 2 days | One, if the CLI ships to production | A restored copy passes every comparison |
| **2. Split, with no visible change** | Platform and account contexts, routes per request, one account only. Fixes for shutdown and scrubbing. All current tests pass. | Medium, about 3 to 5 days | One, with no database change | Route census passes, and nothing changes for you |
| **3. Accounts and keys** | Control database, your cutover, encrypted keys, new throttling, sign-ups off | Medium, about 3 to 5 days | One, the cutover above | You sign in, schedules run, key encrypted, undo tested locally |
| **4. Invites** | Invites, onboarding, key connect and replace, recovery codes, admin screen, per-account limits, opt-in shows, delete and export, terms and privacy pages, wording changes (8 web source files mention the owner or the variable) | Large, about 1 to 2 weeks | One | Two-person test passes on every route, and no key appears in responses or logs |
| **5. One real second person** | Invite one trusted person, watch for 2 weeks | Calendar time | Fixes batched into one | Two real keys work side by side, with no 429s across keys |
| **6. Up to 25 people** | Nightly backups to a second location, alerts, a load run on Railway | Small | One | Measured on Railway, and a restore drill run on real backups |
| **7. Open sign-up, only if chosen** | Email, verification, challenge, two-factor, stronger abuse tools, a renewed legal review | Large | One or more | A separate decision after running phase 6 for a season |

Stopping after any phase leaves a working site. A self-hosting guide could be published at any point and needs almost no code.

## Where this stands

- **Branch:** `claude/stoic-antonelli-c7ec73`, documents only, not pushed. Nothing is deployed, and no production data or settings changed.
- **Done:** this plan and its [evidence](multi-user-evidence/).
- **In flight:** nothing.
- **Next steps, in order:** you decide D1 to D11, and someone reads Govee's terms and sends Govee the questions above. Nothing else should start before that, unless you choose to build at risk under D2.
- **To resume:** read this file, then repeat the measurements by following `docs/multi-user-evidence/README.md`.

## How this was checked

| Claim | How |
|---|---|
| Blocking findings and line numbers | Read the code on `main` at `10bb5c8`. Route, statement and table counts come from `git grep` on that commit. |
| Table rebuilds lose data | Ran the recipe through the real `runMigrations` on throwaway data, in Docker |
| 46 enabled schedules on a new account | Measured on a throwaway file with a stand-in for Govee. With no setup screen in the test, they were in UTC. |
| Scale figures | Measured as described, with these caveats: a stand-in for Govee, a local disk, 2 CPUs, a short run, and no web traffic in the test |
| Backup and integrity on many files | Used the same SQLite backup call as `apps/server/src/cli/backup.ts`, on throwaway files |
| Govee's key policy and rate tables | Read from Govee's pages on this date |
| Railway's prices, limits and backup behaviour | Read from Railway's documentation on this date |
| Production usage and volume size | Railway metrics and service description, read-only. The production database itself was not opened. |

**Not verified**

- Whether Govee allows this, and its per-address limits
- Performance on Railway's real disk
- How large a real account's file grows over 90 days. The cost table assumes 20 MB.
- `TRUST_PROXY=2` with the custom domain. `docs/deploy-railway.md` describes the check. Re-run it before Phase 3, because throttling depends on it.
- Backup over `railway ssh`, and any restore involving production data
- Whether your Railway plan is Pro
- The design itself: none of it has been built, so sizes are estimates and new problems will turn up

## Follow-ups this found, outside this plan

- `docs/govee-integration.md:96` says no page confirms that a new key disables the old one. Govee's notice now does. The row and any key warning should be updated.
- The shared login counter (finding 6) already lets anyone on the internet block sign-in for 5 minutes. `docs/security.md` lists this as known. It matters more now that the site has a public domain.

## Sources

- Govee: [API key policy notice](https://developer.govee.com/changelog/important-policy-update-important-notice-regarding-api-key-security-management), [device list reference and current limits](https://developer.govee.com/reference/get-you-devices), [applying for a key](https://govee.readme.io/reference/applying-for-an-api-key), [older rate limits](https://govee.readme.io/reference/rate-limiting), [getting started](https://developer.govee.com/docs/getting-started)
- Third-party mention of personal use, unconfirmed: [lordofscripts/govee](https://www.github.com/lordofscripts/govee)
- Railway: [volumes](https://docs.railway.com/volumes/reference), [backups](https://docs.railway.com/volumes/backups), [pricing](https://docs.railway.com/pricing/plans), [static outbound IPs](https://docs.railway.com/networking/static-outbound-ips)
