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

Optional, for Ask: any of `DEEPSEEK_API_KEY`, `GEMINI_API_KEY` and `GLM_API_KEY`, plus `AI_MONTHLY_LIMIT_USD` if the default of $5 does not suit. Set keys yourself in the dashboard. Each change restarts the app.

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

## Password reset

```bash
railway ssh node apps/server/dist/cli/reset-password.js
```
