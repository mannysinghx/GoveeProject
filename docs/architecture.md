# Architecture

## Overview

```
Browser
  |  same origin; no CORS, and the Govee key never reaches this side
  v
React frontend (apps/web), served by the backend in production
  |  /api/v1, with a session cookie and a CSRF token
  v
Fastify backend (apps/server)
  |-- auth/        Owner account, sessions, CSRF, login throttling
  |-- devices/     Discovery, capabilities, state, scenes, command validation
  |-- commands/    Dispatch queue, command history, multi-device runs
  |-- groups/      App-level groups
  |-- presets/     App-managed presets
  |-- scheduler/   Occurrence rules and the durable scheduler
  |-- activity/    Activity log
  |-- system/      Settings, diagnostics, housekeeping
  |-- govee/       Transport interface, cloud adapter, rate limiter, capability parsing
  |-- database/    SQLite access and migrations
  v
Official Govee cloud API --> your Govee devices
```

`packages/shared` holds the Zod schemas and types used on both sides, so input rules and API shapes cannot drift apart.

## Boundaries

- **The browser never calls Govee.** All Govee traffic starts in `govee/cloud-transport.ts`.
- **The client never supplies Govee addresses or capability structures.** It names a device by internal id, and an action in the app's own vocabulary. `devices/command-builder.ts` turns that into a Govee payload, using limits from the stored capabilities. Scene values come from the server's cache and are looked up by key.
- **The transport knows nothing about the database, and vice versa.** Services above the `LightTransport` interface never see HTTP.
- **Controls are data-driven.** `govee/capabilities.ts` normalizes raw capabilities, and the UI renders from the result. Nothing checks a model number, apart from a cosmetic highlight for the H805C.
- **Authentication is deny by default.** A hook attached to every route under `/api/v1` requires a session unless the route declares itself public. It does not look at URL text, so no spelling of a path can avoid it.

## Command lifecycle

```
Route -> command-builder (validate) -> queue -> limiter -> transport -> Govee
                                         |
                       command_history + capability_states updated at each step
                                         |
                       later: status refresh -> reconcile -> confirmed / mismatch / not_reported
```

A command moves through these statuses:

| Status | Meaning |
|---|---|
| `queued`, `sending` | Waiting, or in flight |
| `accepted` | Govee took the request. **Not** proof that the lights changed. |
| `rejected` | Govee answered and refused it |
| `failed` | Not delivered after bounded retries, or the reply could not be understood. Outcome unknown. |
| `superseded` | A newer command for the same setting replaced it while queued |
| `interrupted` | The app stopped first. It is not resent. |

Separately, `verification` records what a later Govee report showed:

| Verification | Meaning |
|---|---|
| `unverified` | No later report yet |
| `confirmed` | A later report, from an online device, shows the same value |
| `mismatch` | A later report shows a different value. Can still become `confirmed`, since reports can lag. |
| `not_reported` | Govee gives no value for this setting |

The app stores requested, accepted and reported values separately for each setting (`capability_states`), with timestamps, so the UI can show each without implying the others.

## Dispatch queue

`commands/command-queue.ts`:

- **One FIFO per device, one request in flight per device.** A later command cannot overtake an earlier one. Devices do not block each other.
- **Coalescing.** A queued brightness is replaced by a newer brightness. Colour, temperature and scene share a key, because each overrides the others. Replacement only happens between neighbours in the queue, so ordering that later commands might depend on is never disturbed. Commands from presets, groups and segment plans are never coalesced.
- **Retries.** Bounded, with exponential backoff and jitter, honouring `Retry-After`. Only rate limits, timeouts, network errors and 5xx responses are retried. Commands set absolute values, so a retry after a timeout cannot compound.
- **Rate limits.** See [Govee integration](govee-integration.md#rate-limits). A 429 pauses all Govee traffic for the requested time, up to an hour per response. A command that cannot be sent within `QUEUE_MAX_WAIT_MS` of being queued fails, rather than firing long after anyone expected it.

## Multi-device runs

`commands/action-service.ts` runs presets, group actions and scheduled actions:

- On each device, steps run one at a time and in order.
- A step the device cannot do is skipped with an explanation, and the rest continue.
- If a step fails, the remaining steps for that device are skipped. There is little point setting a colour if "turn on" did not go through.
- Devices run independently. Nothing claims they changed together or atomically.
- Every run is stored in `execution_runs` with a result per device and step. Its status is never called "success": it is `all_accepted`, `partial`, `failed` or `skipped`.

## Scheduler

`scheduler/occurrences.ts` is a pure calculation that turns a recurrence and an IANA zone into instants. `scheduler/scheduler.ts` runs them from durable state.

Each tick, every 15 seconds:

1. Read due schedules from SQLite (`next_run_at <= now`).
2. In one transaction per schedule: work out each occurrence since `last_evaluated_at`, insert a `schedule_executions` row for it, and move the schedule forward.
3. Run the claimed occurrence, if any, after that transaction commits.

**No in-memory timers hold schedule state.** On startup, the first tick finds everything that came due while the app was down.

**Duplicate prevention.** `UNIQUE (schedule_id, occurrence_key)` is the guard. The key is built from the wall-clock date and time rather than the instant, along with the zone and any coordinates, so editing those creates a genuinely new occurrence. An occurrence can only be claimed once, across restarts, across a rewound schedule row, and even by a second process.

**Crash policy.** A run still marked `running` at startup becomes `interrupted` and is not retried. It may have partly executed, and repeating lighting commands blindly is worse than reporting it.

### Exact start times

The scheduler checks for due runs every `SCHEDULER_TICK_SECONDS` (default 15). When a run is due before the next check, it also sets a timer for that moment, so runs start on time rather than up to a tick late. In a real-time test against the mock, a run due at 04:37:00.000 started at 04:37:00.000.

### Daylight-saving policy

| Case | Policy | Example, New York |
|---|---|---|
| Spring forward: the time does not exist | Moves forward by the size of the gap | 02:30 on 8 March 2026 runs at 03:30 EDT |
| Fall back: the time happens twice | Runs once, at the first instant | 01:30 on 1 November 2026 runs at 01:30 EDT, not again at 01:30 EST |

Next-run displays carry a note when either applies, so the screen shows the actual time. Tests cover both, including a 30-minute gap on Lord Howe Island.

### Missed-run policy

A run is on time if it starts within `SCHEDULE_GRACE_SECONDS` (default 120). Later than that:

| Per-schedule policy | Behaviour |
|---|---|
| `skip` (default) | Every missed run is recorded as `missed`. Nothing is sent. |
| `run_latest` | Older runs are recorded as `missed`. The newest runs once, marked as a recovery, if it is within `SCHEDULE_CATCHUP_MAX_HOURS` (default 12). |

History is never replayed, and after a long outage only the newest 100 runs per schedule are itemized. Time spent disabled is not an outage, so re-enabling reports nothing as missed. Changing a schedule's timing resets its evaluation point for the same reason.

### Sunrise and sunset

Calculated on the server by suncalc from a latitude and longitude you enter. No outside service is involved. On dates when the sun does not rise or set at that location, there is no occurrence, and the preview lists those dates.

### One instance

Run one copy of the app per database. Unique occurrence keys stop a second instance from double-firing a schedule, but queues and rate limits are held in memory and are not shared, so two instances could exceed Govee's limits together. Multi-replica operation is not supported.

## State and polling

Reads through `GET /devices` come from the app's own cache and never call Govee. Status is requested only:

- when a person asks (**Refresh status**),
- about 2.5 seconds after an accepted command, plus one follow-up if something still differs, or
- while the dashboard is open and visible, at a configurable interval (default 60 seconds, minimum 30).

A device is shown as `stale` once its last report is older than a configurable age (default 5 minutes), and a report made while Govee says the device is offline is marked historical. Govee's own documentation says such values have no reference significance.

## Pacing and base color

Commands to one light are at least a second apart, with no burst, and a light gets an extra second after turning on. When a plan's segment commands cover a whole string, `withBaseCoat` in `action-service.ts` sends its main color to the whole string first. This is decided when a plan runs, so older presets get it too, and stored presets don't change. It's skipped for steps naming only some segments, which must leave the rest alone, and for the **Check my lights** tests (`plainSegments`).

## Built-in presets

`packages/shared/src/festival-presets.ts` lists the festival presets. `apps/server/src/presets/builtin-presets.ts` writes them to the ordinary `presets` table, tied to the current strings in the owner's arrangement, marked with `builtin_key`. It runs at startup, after discovery, after a settings change and hourly, and writes nothing if nothing changed. Because they are rebuilt, they are read-only; a duplicate is an ordinary preset.

A preset with a `sceneName` uses that Govee scene on each light that lists it, and its colors on any light that does not. Scenes are fetched once per light here.

The New Year show is set up once, recorded in `builtin_installs`, so a schedule or group the owner deletes stays deleted: a yearly schedule at 00:00 on January 1 in the default time zone (missed runs are skipped), a second at 00:30 that turns the lights off (a missed run runs late, so lights are not left on), and a group of all strings. The fireworks are never kept for catch-up.

## Connection monitoring

`apps/server/src/connection/` checks every monitorable light in the background, whether or not a browser is open. The interval is `CONNECTION_CHECK_SECONDS` (default 120), lengthened when needed so checks stay within a quarter of the daily budget: with 3 lights and the default budget, every 130 seconds, or about 2,000 requests a day. Govee groups are skipped because Govee gives no status for them.

- **Incidents** (`connection_incidents`) record each problem once, with a unique index allowing one open incident per problem, so restarts and repeated checks cannot duplicate them.
- **Diagnosis** (`diagnosis.ts`) is a set of fixed rules, with no model, that compares what is and is not working: one light offline while others are online, all offline, every status request failing, or the key rejected. It reports a likely cause. It cannot see inside a light or a home network.
- **Self-healing** covers only what software can reach: rechecking the device list at most hourly when something is missing, and carrying on through temporary failures.
- **Catch-up** (`missed_deliveries`) keeps only the newest thing each light could not receive because it was offline. It is off by default (`catchUpEnabled`). A delivery is claimed before anything is sent, so a crash cannot repeat it. It is not sent if it is older than `MISSED_DELIVERY_MAX_HOURS` (default 24), or if the light has accepted something newer since.

Background status failures are recorded as incidents, not as a line in the activity log per check.

## Database

SQLite in WAL mode, with foreign keys on, through better-sqlite3. Hand-written SQL migrations in `migrations/` run at startup, each in a transaction, and are checksummed so a changed migration stops startup. Related writes use transactions. Old activity and command history is pruned after `HISTORY_RETENTION_DAYS` (default 90).

Devices are never deleted by discovery, only marked `missing`, so history, presets and schedules survive and reconnect if the device returns.

## Future LAN control

`govee/transport.ts` defines `LightTransport` (`discoverDevices`, `getDeviceState`, `sendCommand`, and the scene calls). A LAN adapter could implement it without changes above that line. It is not implemented. Before anyone adds it, H805C LAN support must be confirmed from Govee's guide and by physical testing, and it should not be assumed that LAN and cloud capabilities match, that any given command exists, or that operation is fully offline. A browser cannot replace the backend for this, because local control needs a process on the same network as the lights.

## Project layout

```
apps/server/src/     Backend, organized by area as above
apps/server/tests/   Backend tests, plus support/mock-govee.ts
apps/web/src/        Frontend: app/, components/, features/, lib/, styles/, test/
packages/shared/     Schemas, types, colour conversion, descriptions
migrations/          SQL migrations
scripts/ci-local.sh  The project's CI
```

Tests sit next to the code they cover in `apps/web` and `packages/shared`, and in `apps/server/tests` for the backend, rather than in one top-level `tests/` directory.
