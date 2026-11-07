# First-run setup and installation

## What you need

- Your lights added in the Govee Home mobile app
- A Govee developer API key. In the Govee Home app, open **Settings** and choose **Apply for API Key** ([Govee's instructions](https://developer.govee.com/reference/apply-you-govee-api-key)). Govee's documentation does not say whether a new key replaces an old one, so assume it may.
- A computer that stays on, if you want schedules to run
- Either Docker, or Node.js 22.12+, 24, or 26 (26 is the current LTS)

## Option A: Docker Compose

```bash
cp .env.example .env
```

Edit `.env` and set `GOVEE_API_KEY`. Then:

```bash
docker compose up -d --build
```

Open <http://localhost:8787>. The setup screen asks for a setup code, because the app inside the container is bound to all of the container's interfaces. Get it from the log:

```bash
docker compose logs app | grep setupCodeForFirstRun
```

The code changes on each start and stops working once the owner account exists. To choose your own, set `SETUP_TOKEN` in `.env`.

Data is kept in the `govee-data` Docker volume. It survives rebuilds and container removal. `docker compose down -v` deletes it.

The container is published on `127.0.0.1` only, runs as a non-root user with a read-only root filesystem, and has all Linux capabilities dropped.

## Option B: Direct install

```bash
cp .env.example .env
```

Edit `.env` and set `GOVEE_API_KEY`. Then:

```bash
npm ci
```

```bash
npm run build
```

```bash
npm start
```

Open <http://localhost:8787>. Bound to loopback, setup needs no code.

Data is kept in `./data/govee-light-manager.sqlite`.

To keep it running across reboots, use your system's service manager. A systemd example, assuming the project is in `/opt/govee-light-manager`:

```ini
[Unit]
Description=Govee Light Manager
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=glm
WorkingDirectory=/opt/govee-light-manager
Environment=NODE_ENV=production
ExecStart=/usr/bin/node apps/server/dist/main.js
Restart=on-failure
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/opt/govee-light-manager/data

[Install]
WantedBy=multi-user.target
```

Run only one copy of the app against a database. See [the architecture document](architecture.md#one-instance).

## First-run steps in the app

1. **Welcome.** Reminds you of what you need.
2. **Create the owner account.** A username and a password of at least 12 characters. It stays on your server, and no email is involved. This can only be done once.
3. **Connect to Govee.** Shows whether the server has a key and tests it by requesting your device list. If no key is set, add `GOVEE_API_KEY` to `.env` and restart the app.

Your browser's time zone becomes the default for new schedules. You can change it under **Settings**.

## Settings in `.env`

`.env.example` lists every common setting with an explanation. The ones you are most likely to change:

| Setting | Default | Purpose |
|---|---|---|
| `GOVEE_API_KEY` | none | Your Govee key |
| `HOST` | `127.0.0.1` | Address to listen on. Read [Remote access](security.md#remote-access) before changing it. |
| `PORT` | `8787` | Port to listen on |
| `ALLOWED_HOSTS` | localhost names | Host names browsers may use |
| `COOKIE_SECURE` | `auto` | Secure session cookies. Set to `true` behind HTTPS. |
| `DATABASE_PATH` | `./data/govee-light-manager.sqlite` | Where data is kept |
| `SETUP_TOKEN` | none | Your own setup code |
| `SCHEDULE_GRACE_SECONDS` | `120` | How late a run can be and still count as on time |
| `SCHEDULE_CATCHUP_MAX_HOURS` | `12` | Oldest missed run the catch-up option will recover |
| `GOVEE_LIMIT_*` | below Govee's limits | See [Govee integration](govee-integration.md#rate-limits) |

Restart the app after changing `.env`.
