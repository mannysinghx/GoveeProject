# Security and backup

## Summary

| Area | What the app does |
|---|---|
| Govee API key | Server environment only. Never sent to the browser, logged or stored in the database. |
| Passwords | Argon2id, using OWASP's minimum parameters (19 MiB, 2 iterations) |
| Sessions | Random token in an HttpOnly, SameSite=Strict cookie. Only its SHA-256 hash is stored. Expires after 7 days. |
| CSRF | A per-session token is required in a header on every state-changing request |
| Login throttling | Lockouts per address that grow with repeated failures, plus a limit across all addresses. Holds up under parallel requests and survives restarts. |
| First-run setup | Can complete once, enforced by a database constraint. Needs a code unless the app is bound to loopback with no proxy or outside host name configured. |
| Network | Binds to `127.0.0.1` by default. No CORS headers. Unknown Host headers are rejected on loopback binds and in the Docker Compose setup, which blocks DNS rebinding. |
| Headers | A restrictive Content-Security-Policy with no inline or third-party scripts, plus the Helmet defaults |
| Routes | Deny by default. Only health, session status, login and setup are public. |
| Input | Validated with Zod on the server. Device limits are enforced server-side from stored capabilities. |

The Content-Security-Policy allows inline styles because the colour picker injects a small style tag. Scripts remain restricted to the app's own files.

## API key handling

The key is read from `GOVEE_API_KEY` at startup. The settings screen can only say whether one is configured. Its value is scrubbed from every log line and activity record as a last line of defence, including if Govee were to echo it back in an error. Tests assert this.

`.env` is ignored by git. Keep it readable only by the account running the app:

```bash
chmod 600 .env
```

Replacing the key means editing `.env` and restarting. There is no way to enter it in the browser in this version.

The app refuses to send the key to any host other than `openapi.api.govee.com`, apart from a loopback address for local testing. It also refuses to follow redirects from Govee, so the key cannot be forwarded elsewhere that way.

## Remote access

The app is not exposed to the internet by default, and should not be exposed directly.

### On a trusted local network

Direct install, in `.env`:

```
HOST=0.0.0.0
ALLOWED_HOSTS=192.168.1.20,lights.home.arpa
```

Docker: change the port mapping in `docker-compose.yml` to `"8787:8787"`, and set `ALLOWED_HOSTS` in `.env`. Without it, requests using your LAN address are refused.

This sends passwords and cookies over plain HTTP, so anyone able to watch your network could capture them. Use it only on a network you trust.

Bound beyond loopback, setup requires a code. Complete setup yourself before others can reach the app.

### On a hosting service

See [Deploying to Railway](deploy-railway.md). There, the app is on the public internet, protected only by its own sign-in.

### From outside your home

Do not forward a port directly to the app. Use one of these:

1. **A VPN into your network**, such as WireGuard. The app stays private.
2. **An HTTPS reverse proxy you control**, such as Caddy or nginx, in front of it. Then set in `.env`:

   ```
   TRUST_PROXY=true
   COOKIE_SECURE=true
   ALLOWED_HOSTS=lights.example.com
   ```

   With `COOKIE_SECURE=true`, HSTS and related headers are also enabled. Setup then needs a code, because the bind address no longer says who can connect.

   `TRUST_PROXY=true` means one proxy: the app takes the client address from the last `X-Forwarded-For` entry. If more proxies sit in front, set the number instead, such as `TRUST_PROXY=2`. Each proxy must append to that header, and the original `Host` must reach the app. Keep the app bound to loopback or a private interface, so traffic cannot bypass the proxy. Only set this when a proxy really is in front, or clients can forge their address and get around login throttling.

No particular tunnel or hosted service is needed.

## Account recovery

There is no email reset. If you can run commands on the server, you own the data anyway, so recovery happens there. This signs out every session, clears login lockouts and records the reset in Activity.

Direct install, after `npm run build`:

```bash
npm run reset-password
```

Docker:

```bash
docker compose exec -it app node apps/server/dist/cli/reset-password.js
```

To reset from a script, pipe the password in rather than putting it on a command line, where it could land in shell history.

If you would rather start over, stop the app and delete the database. This erases presets, schedules and history too.

## Backup and restore

**What to back up**

- The SQLite database: account, devices, presets, groups, schedules and history
- `.env`: your Govee key and settings. Store it as carefully as the key itself.

The database holds your password hash, device identifiers and activity history, but no API key and no usable session tokens. Treat backups as private anyway.

**Making a backup.** This is safe while the app runs. Copying the database file directly is not, because recent writes may still be in the `-wal` file.

Direct install:

```bash
npm run db:backup -- ./backups/lights.sqlite
```

Docker:

```bash
docker compose exec app node apps/server/dist/cli/backup.js /data/backup.sqlite
```

```bash
docker compose cp app:/data/backup.sqlite ./backup.sqlite
```

**Restoring, direct install.** Stop the app first. Replace the file, and remove any leftover WAL files, because they belong to the old database:

```bash
cp ./backups/lights.sqlite ./data/govee-light-manager.sqlite
```

```bash
rm -f ./data/govee-light-manager.sqlite-wal ./data/govee-light-manager.sqlite-shm
```

Then start the app.

**Restoring, Docker:**

```bash
docker compose stop app
```

```bash
docker compose run --rm --no-deps -v "$PWD/backup.sqlite:/restore.sqlite:ro" --entrypoint sh app -c "cp /restore.sqlite /data/govee-light-manager.sqlite && rm -f /data/govee-light-manager.sqlite-wal /data/govee-light-manager.sqlite-shm"
```

```bash
docker compose up -d
```

**After restoring.** Schedules resume from the restored state. Occurrences recorded in the backup cannot run twice. Runs that came due since the backup are treated as missed, under each schedule's policy. An older backup may be missing occurrences that did run, in which case a recent one could run again under `run_latest`.

Migrations run forward only, so restore a backup made by the same or an older version of the app.

## Logging

Logs are structured JSON on standard output. They include startup and shutdown, migrations, discovery, command results, rate limits, schedule runs, sign-in events, and request ids.

They never include the API key, passwords, password hashes, session cookies, authorization headers or environment secrets. A setup code is printed once when setup is open on a non-loopback address, because whoever installs the app needs it. It works once at most, and is regenerated on restart.

## Notifications

Web Push is the one thing that sends data somewhere other than Govee: encrypted messages go through the push service of your browser's maker. It needs no account, and only the subscribed browser can read them. Its address is checked against a list of known push services, so a signed-in user cannot make the server call other hosts.

The server's push signing key is stored in the database (`push_keys`), never logged or returned by the API, and so is included in backups; treat backups as secret. If it is lost, each device must turn alerts on again. Device addresses are not returned by the API either.

Buttons on phone notifications use a public route, `POST /api/v1/notification-actions`. It needs a random single-use token, stored only as a hash, that expires after 7 days and can only answer one notification: confirming the lights, or skipping one show on one date. It cannot do anything else, and it never sends a command to a light.

## Known limitations

- **Local encryption.** The key lives in plain text in `.env`, and the database is not encrypted. Anyone with read access to the server's files has both. Disk encryption and file permissions are your protection here.
- **Single account.** There are no roles. Anyone signed in has full control.
- **Sign-in over HTTP.** Without HTTPS, credentials are unencrypted in transit. This is why the default is loopback.
- **Login throttling** counts by address. Behind a proxy without the right `TRUST_PROXY` value, all clients can end up sharing one address.
- **Lockout as nuisance.** The limit across all addresses means someone able to reach the sign-in page from many addresses could block sign-in for 5 minutes at a time. Sessions already signed in keep working, and schedules are unaffected. This is another reason to keep the app off the public internet.
