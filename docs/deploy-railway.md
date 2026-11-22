# Deploying to Railway

The app runs on Railway as **one** service, built from the root `Dockerfile`, with a persistent volume for its SQLite database. Railway's automatic monorepo detection suggests one service per workspace. Do not keep that split: the backend serves the frontend, and a separate web service has nothing to run.

On Railway the app is on the public internet, protected by its own sign-in. Read [Security](security.md) first. Keep a strong owner password.

Current deployment: project `goveeproject`, service `@glm/server`, <https://glmserver-production.up.railway.app>.

## Service settings

| Setting | Value | Why |
|---|---|---|
| Source | This repository, `main` | |
| Build | The root `Dockerfile`, with no custom build command | |
| Start command | `node apps/server/dist/main.js` | Runs Node directly, so it receives Railway's stop signal and shuts down cleanly |
| Healthcheck path | `/api/v1/health` | Exempt from the Host check, so Railway's checker can reach it |
| Replicas | 1 | One instance per database |
| Sleep | Off | Schedules need a running process |
| Restart policy | Always | So schedules resume after a crash |
| Volume | Mounted at `/data` | Without it, every deploy erases the database |
| Watch patterns | `/apps/server/**`, `/apps/web/**`, `/packages/**`, `/migrations/**`, `/Dockerfile`, `/package.json`, `/package-lock.json` | Code changes redeploy. Documentation changes do not. |

## Variables

| Variable | Value | Why |
|---|---|---|
| `GOVEE_API_KEY` | Your key | Set this yourself in the Railway dashboard |
| `PORT` | `8787` | Matches the domain's target port |
| `RAILWAY_RUN_UID` | `0` | Railway mounts volumes as root, so the image's `node` user could not write to `/data` |
| `TRUST_PROXY` | `2` | Railway puts two proxies in front of the app, measured November 2026. Login throttling depends on this. To check it, see below. |
| `COOKIE_SECURE` | `true` | Railway serves the app over HTTPS |
| `ALLOWED_HOSTS` | Your Railway domain, plus any custom domain | Requests for any other host name are refused |

`HOST`, `NODE_ENV` and `DATABASE_PATH` are already set in the `Dockerfile`.

Optional, for Ask: any of `DEEPSEEK_API_KEY`, `GEMINI_API_KEY` and `GLM_API_KEY`, plus `AI_MONTHLY_LIMIT_USD` if the default of $5 does not suit. Set keys yourself in the dashboard. Each change restarts the app. These keys are for the owner's account only; people who sign up do not get them.

For email and sign-up, see "Email and sign-up" below.

Claude sessions working on this project must not read variables with Railway's `list-variables`, because it returns their values, which would put keys in a transcript.

## First sign-in

Set `GOVEE_API_KEY` first, because changing a variable restarts the app. Then find `setupCodeForFirstRun` in the service's **Deploy Logs**. Setup requires this one-time code because the site is public. The code changes on every restart until the owner account exists.

## Checking `TRUST_PROXY`

Send one request normally and one with a forged `X-Forwarded-For` header, then look for `remoteAddress` in the Deploy Logs. Both should show your real address. If it shows a Railway address, the value is too low and all visitors share one login-throttling address. If it shows the forged address, the value is too high, and anyone could dodge throttling. Recheck if Railway changes its network.

## Backup

Railway's volume backups are one copy, but they [can only restore into the same project, and are lost if the volume is wiped](https://docs.railway.com/volumes/backups). Keep your own copy off Railway as well.

**Copy a backup to this computer.** Run this from the repo, with the Railway CLI logged in and linked to `goveeproject`:

```bash
bash scripts/pull-backup.sh
```

It makes a backup on the server with the app's own command (SQLite's online backup, safe while the app runs). It brings that backup back with its SHA-256 and size, and checks both on arrival. Then it runs SQLite's integrity check, and deletes the temporary copy on the server. It saves to `~/GoveeBackups`, readable only by you. The copy holds your password hash, the push signing key and your home's location, so keep it out of the repo and out of shared folders. It works with the version deployed on 14 November (`19166b3`), so no deploy is needed first. Until the next deploy, the copy has no manifest, so only SQLite's own checks apply.

**Check a backup** against this version of the app, after `npm run build`:

```bash
npm run db:verify -- ~/GoveeBackups/<file>.sqlite
```

**Restore.** `restore.js` verifies the backup, refuses while anything has the database open, and moves the current file aside with its WAL files, never deleting it. Then it checks the restored file against the backup:

```bash
node apps/server/dist/cli/restore.js <backup>.sqlite --to <database>.sqlite --replace
```

To undo a restore, move the `.before-restore-<time>` files back.

**Not worked out yet: restoring on Railway.** The app holds the database open while it runs, so the restore will refuse. But stopping the service also stops the container that `railway ssh` connects to. One way is a temporary start command that keeps the container up without the app, such as `sleep infinity`, then restore, then put the start command back. That is untested, and it is a production change that needs the owner's approval. The restore drill so far runs on test data in `apps/server/tests/backup-restore.test.ts`, and on a backup pulled from the production image in `scripts/ci-local.sh --image`.

A backup made on the server alone:

```bash
railway ssh node apps/server/dist/cli/backup.js /data/backups/manual.sqlite
```

After the next deploy, this also writes `manual.sqlite.manifest.json`, and it refuses to overwrite an existing file.

## Encrypted keys and the control database

From the version with Phase 3 of `docs/public-signup-plan.md`, sign-in lives in `/data/control.sqlite`, next to the existing database on the same volume. It is created and filled on the first start, and the existing file is not rewritten. See `docs/security.md`, "Where accounts live".

To store the Govee key encrypted, set `CREDENTIAL_KEYS` in the service's variables, made as in `docs/security.md`, "Encrypted keys". Keep `GOVEE_API_KEY` set for about two weeks after that, as the way back. **Never call Railway's `list-variables` tool for this project from a Claude session**, because it returns values.

**Rolling back** to a version before the control database is a redeploy. That version reads the old tables in the owner's file, which have been kept in step: the current password works, and signed-out sessions stay signed out. Sessions made after the upgrade are not in those tables, so the owner signs in again. `control.sqlite` stays on the volume, unused, and is picked up again when rolling forward.

## Email and sign-up

From the version with Phase 4 of `docs/public-signup-plan.md`, the app sends its own email through `info@lightup.ink` on Namecheap Private Email, for sign-up, password reset and address changes. **Sign-up stays off** until the owner turns it on in Settings, and it cannot be turned on until mail is set up.

**Before setting the variables,** in Namecheap: turn on SMTP access ("Connect third-party apps") for `info@lightup.ink`, preferably with an app password; turn on DKIM and add its DNS record; add a DMARC record, starting with `v=DMARC1; p=none; rua=mailto:info@lightup.ink`.

| Variable | Value | Why |
|---|---|---|
| `SMTP_HOST` | `mail.privateemail.com` | Only this, `smtp.privateemail.com` or loopback is accepted, so the password cannot be sent anywhere else |
| `SMTP_PORT` | `465` (the default) | TLS from the start. `587` uses STARTTLS |
| `SMTP_USER` | `info@lightup.ink` | |
| `SMTP_PASSWORD` | The mailbox's app password | **Set it yourself in the Railway dashboard.** Never in a file or a chat. It is scrubbed from logs |
| `MAIL_FROM` | `info@lightup.ink` (defaults to `SMTP_USER`) | Replies and bounces land there |
| `PUBLIC_URL` | `https://lightup.ink` | Where links in emails point. Defaults to the first host in `ALLOWED_HOSTS` |

Optional: `MAIL_HOURLY_LIMIT` (default 300, under Namecheap's 500 an hour) and `SIGNUP_POW_DIFFICULTY` (default 18).

**Check it works** before turning sign-up on: in Settings, add your own email address under "Sign-in email". The confirmation email is the first test send from Railway. If it does not arrive, the Deploy Logs say why ("Could not send an email", "Gave up sending an email" or "The mail server refused the app's sign-in"). Whether Railway lets mail out on port 465 has not been confirmed yet.

**Turning sign-up on:** Settings, Sign-up, "Turn sign-up on". The same card shows the caps (50 a day and 500 in total to start), accounts made, and mail waiting or not delivered. Turning it off stops new sign-ups at once; people who already have an account keep signing in and can still reset their password.

**Member accounts' files** are in `/data/accounts/`, one per person. `backup.js` copies each of them into `<backup>.accounts/` next to the backup. **`scripts/pull-backup.sh` does not bring them back yet**: it copies the owner's file and the control database only. That must be added before sign-up is switched on for anyone.

## Password reset

With an email address on the account, use "Forgot your password?" on the sign-in page. Otherwise, on the server:

```bash
railway ssh node apps/server/dist/cli/reset-password.js
```
