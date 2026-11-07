# Govee Light Manager

A self-hosted web app for managing Govee outdoor lights through the official Govee API, starting with the H805C Permanent Outdoor Lights Elite. It works with other Govee models because every control comes from what the API reports for your device, not from the model number.

**What it does**

- Discovers the lights on your Govee account and shows what each one reports it can do
- Turns lights on and off, and sets brightness, colour and colour temperature
- Paints color patterns across a light string, and activates Govee scenes, when your device exposes them through the API
- Saves presets of several steps, groups lights by area, and applies either to many lights
- Runs schedules, including sunrise and sunset, whether or not a browser is open
- Keeps a history of commands and schedule runs, and has a diagnostics screen for troubleshooting

**What to expect**

- It needs an internet connection, because it controls lights through Govee's cloud.
- It has reached the real Govee service, and an H805C reports 27 paintable segments, but no one has yet confirmed the lights respond correctly. Check your own with the [acceptance checklist](docs/acceptance-checklist.md).
- "Accepted" in this app means Govee took the request, not that your lights changed. See [Why some features may be missing](#why-some-features-may-be-missing) and [Known limitations](docs/known-limitations.md).

The software is free and open source, with no subscription. Your hardware, electricity, internet service and any domain or hosting you choose may still cost money.

## Technology

React, TypeScript, Vite, Tailwind CSS and TanStack Query in the browser. Node.js LTS, Fastify, Zod and SQLite (through better-sqlite3) on the server. Argon2id for passwords, Luxon for time zones, suncalc for sun times. Tests run on Vitest and React Testing Library. Docker Compose is optional.

The only outside service the running app talks to is the official Govee API.

## Quick start

### 1. Get a Govee API key

Add your lights in the Govee Home mobile app first. Then, in that app, open **Settings** and choose **Apply for API Key**. [Govee's instructions](https://developer.govee.com/reference/apply-you-govee-api-key).

Govee does not say whether applying for a new key invalidates an old one, so assume it may, and check anything else that uses your key.

### 2. Set `GOVEE_API_KEY`

```bash
cp .env.example .env
```

Open `.env` and put your key on the `GOVEE_API_KEY=` line. The key stays on the server. It never reaches the browser, the logs or the database, and `.env` is ignored by git.

### 3. Start the app

With Docker:

```bash
docker compose up -d --build
```

Or directly, with [Node.js](https://nodejs.org) 22.12+, 24, or 26 (26 is the current LTS):

```bash
npm ci
```

```bash
npm run build
```

```bash
npm start
```

Then open <http://localhost:8787>. Either way, the app is only reachable from this computer until you decide otherwise. See [Remote access](docs/security.md#remote-access).

### 4. Create the owner account

The setup screen appears the first time you open the app. There is one account, it lives on your server, and it can only be created once.

With Docker, the setup screen also asks for a setup code, because the app inside the container is not bound to loopback. Get it from the log:

```bash
docker compose logs app | grep setupCodeForFirstRun
```

### 5. Find your H805C

After you create the account, the app takes you to **Connect to Govee**. Choose **Test connection and find devices**. Your H805C is marked as *Permanent Outdoor Lights Elite* if Govee returns it. Being listed does not mean it is online, so open it to check.

## Using the app

**Inspect what your lights report.** Open a device from the dashboard. **Capabilities reported by Govee** lists everything the API returned, and **Developer diagnostics** shows the raw JSON. Anything missing is listed as not exposed through the official API.

**Create a preset.** Go to **Scenes & Presets**, choose **New preset**, and add steps in order, such as turn on, set brightness, set a colour. Leave **Device** on *Whichever device or group it is applied to* to reuse the preset anywhere, or choose a device to tie a step to it. Scenes and segments must be tied to a device.

**Paint a pattern.** Go to **Scenes & Presets** and choose **Paint a pattern**. The app finds every light string on your account and shows them one after another. Put them in the order they run on your house, and flip any that start from the other end; this is remembered. Pick a background and a fill color, then drag across the strings, or use the gradient and repeat tools, which carry on from one string to the next. **Send** tries it, and **Save pattern** keeps it as a preset. Each color takes one command per string, so fewer colors change faster. Moving effects such as Twinkle run inside the lights and cannot be sent through the public API; make those in the Govee Home app and activate them from Scenes if the API lists them.

**Create a schedule.** Go to **Schedules** and choose **New schedule**. Pick a target, an action and when it should run. The panel at the bottom shows the actual next run times before you save.

**Why schedules need the app running.** Schedules live in this app, not in the lights. The server has to be running, with internet access, for them to happen. If it was off, the run is recorded as missed. By default nothing else happens. You can choose per schedule to catch up with the most recent missed run. Older runs are never replayed.

**Daylight saving.** A time that does not exist because clocks went forward runs later by the size of the change, so 02:30 runs at 03:30. A time that happens twice because clocks went back runs once, the first time. The schedule screen tells you when this applies.

## Why some features may be missing

Govee lists the H805C as supported, but that does not guarantee every feature is available through the public API. This app shows only what your device reports, and does not use unofficial APIs.

- Scenes in the Govee app may not all be exposed through the API.
- DIY scenes can be activated if listed, but not created or edited here.
- Patterns need segment control, which only appears if your device reports it. A segment is not necessarily one bulb.
- Govee does not report segment colors, so a pattern cannot show as confirmed. Check the lights themselves.
- Groups made in the Govee Home app offer power only, with no status. To paint them, use a group in this app with the individual lights.
- Commands reach lights through Govee's cloud, so smooth fast animation is not possible.

## Troubleshooting a missing or offline device

**Not in the list?** Check that it is in the Govee Home app on the same account as your key, then choose **Refresh device list**. Models not on [Govee's supported list](https://developer.govee.com/docs/support-product-model) will not appear.

**Offline?** Check the lights in the Govee Home app first. If they are offline there too, the problem is power or Wi-Fi. While Govee reports a device as offline, the values shown are historical, and a command can be accepted by Govee without reaching the lights.

More in the [troubleshooting guide](docs/troubleshooting.md).

## Backup and restore

Back up your database while the app runs, and keep a copy of `.env` somewhere safe.

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

To restore, and for what a backup contains, see the [backup section of the security guide](docs/security.md#backup-and-restore).

## Updating

Back up first. Migrations run by themselves at startup and cannot be undone by going back to an older version.

Docker:

```bash
git pull
```

```bash
docker compose up -d --build
```

Direct install:

```bash
git pull
```

```bash
npm ci
```

```bash
npm run build
```

Then restart the app.

## Running the tests

No Govee key or physical light is needed:

```bash
npm test
```

The project's full CI runs locally, in a Linux container, against a clean checkout of a commit. It runs the build, type check, lint, tests and a dependency audit, and needs Docker:

```bash
scripts/ci-local.sh
```

To also build the production image and smoke test it:

```bash
scripts/ci-local.sh --image
```

To try the interface with no key or lights, run it against the included stand-in API, and open <http://localhost:5187>. The app clearly says it is in test mode, and the devices are invented:

```bash
npm run dev:mock
```

## Documentation

- [First-run setup and installation](docs/setup.md)
- [Deploying to Railway](docs/deploy-railway.md)
- [Architecture](docs/architecture.md)
- [Govee integration, and decisions made where Govee's documentation is unclear](docs/govee-integration.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Security and backup](docs/security.md)
- [Real-device acceptance checklist](docs/acceptance-checklist.md)
- [Known limitations and features not implemented](docs/known-limitations.md)
- [Project progress](docs/PROGRESS.md)

## License

[MIT](LICENSE). This project is not affiliated with or endorsed by Govee.
