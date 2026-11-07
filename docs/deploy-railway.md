# Deploying to Railway

The app runs on Railway as **one** service, built from the root `Dockerfile`, with a persistent volume for its SQLite database. Railway's automatic monorepo detection suggests one service per workspace. Do not keep that split: the backend serves the frontend, and a separate web service has nothing to run.

On Railway the app is on the public internet, protected by its own sign-in. Read [Security](security.md) first. Keep a strong owner password.

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
| `TRUST_PROXY` | Number of proxies in front of the app, currently `1` | Client addresses for login throttling. To check it, see below. |
| `COOKIE_SECURE` | `true` | Railway serves the app over HTTPS |
| `ALLOWED_HOSTS` | Your Railway domain, plus any custom domain | Requests for any other host name are refused |

`HOST`, `NODE_ENV` and `DATABASE_PATH` are already set in the `Dockerfile`.

## First sign-in

Setup requires a one-time code, because the site is public. Find `setupCodeForFirstRun` in the service's **Deploy Logs**. The code changes on every restart until the owner account exists.

## Checking `TRUST_PROXY`

Send a request with a forged `X-Forwarded-For` header, then look for `remoteAddress` in the Deploy Logs. It should show your real address, not the forged one and not an internal Railway address.

## Backup

Railway's volume backups are one option. To take your own copy of the database, run this from a linked project, then download it through a volume browser or your own tooling:

```bash
railway ssh node apps/server/dist/cli/backup.js /data/backup.sqlite
```

## Password reset

```bash
railway ssh node apps/server/dist/cli/reset-password.js
```
