# Progress

Current state of the project, so anyone can pick it up without the original conversation.

## Where it stopped

- **Newest work, 13 November 2026:** branch `claude/govee-light-recognition-b1a7e4`, ahead of `main` (`adab10a`), **committed locally, not pushed and not deployed.** It fixes lights showing a frozen or wrong status, and adds daily color schemes, pattern search and sort, and one brightness for all lights. See "In flight" below. Nothing is uncommitted.
- Branch: `main`, pushed to <https://github.com/mannysinghx/GoveeProject>. `git log -1` shows the last commit.
- Version 1 is built and verified against a local stand-in for the Govee API. On a real account, discovery and status work and power commands to a group are accepted. **Whether real lights respond correctly has not been confirmed.** See `docs/govee-integration.md`.
- Deployed on Railway at <https://glmserver-production.up.railway.app> (project `goveeproject`, service `@glm/server`). The owner has set the key and created the account. See `docs/deploy-railway.md`.

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
| Railway deployment | Health, HTTPS redirect, HSTS, 401s, setup code, volume survives a restart (0 migrations on second boot), clean SIGTERM, real client address with forged headers ignored. The owner has signed in on it. |
| Type check, lint, build, dependency audit, clean install on Linux | `scripts/ci-local.sh` |
| Production image, hardened as in Compose | `scripts/ci-local.sh --image` |
| Every screen, under the real CSP | Production build in a real browser, against `apps/server/scripts/mock-govee.ts`, on desktop and at phone width |
| Scheduler in real time: live run, graceful stop, missed runs, catch-up, restart inside grace, no duplicates, backup and reset CLIs, no secrets in logs or database | A throwaway script against the production build |
| Security and correctness review | Independent review found 12 defects, including a login bypass through percent-encoded paths. All were reproduced and fixed, with regression tests in `apps/server/tests/hardening.test.ts`. |

## In flight

**Light status, daily color schemes, pattern search, one brightness (13 November 2026).** On `claude/govee-light-recognition-b1a7e4`: `459c84f` (light status) and `b2ee3c2` (the three features). Waiting for the owner to approve one push to `main`, which deploys `@glm/server`.

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

Nothing else in this checkout. The white-LED fix is on the branch `fix/white-leds`, not deployed, and needs a rebase onto `origin/main`. The untracked `marketing/` folder is not part of this work.

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
| License is MIT, copyright "mannysinghx" | `LICENSE` | Low | Owner can change it |
| GitHub Actions: none exist, and CI runs locally by policy | `scripts/ci-local.sh` | None | Owner |
| The global login limit could be used to block sign-in for 5 minutes at a time | `docs/security.md` | Low while off the public internet | Owner, if exposing it |

## Next steps, in order

0. Get the owner's approval for one push of `claude/govee-light-recognition-b1a7e4` to `main`. Run `bash scripts/ci-local.sh --image` on the exact commit first (the file is not executable, so it needs `bash`, or `npm run ci -- --image`). After the deploy, check the log shows `006_light_status.sql` applied and 19 built-in presets added, then watch one background check.
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

Then open <http://localhost:5187>. For real lights, see `README.md`.

Before any push, run the CI on the exact commit. It never uses GitHub:

```bash
bash scripts/ci-local.sh --image
```

## Proposals not started

- Letting other people sign up: [the plan](multi-user-plan.md). **On hold.** On 9 November 2026 the owner said no sign-up is needed for now.
- AI features for the owner's own account, free to use, with a monthly spending cap: [the plan](ai-features-plan.md). It is waiting on the decisions listed in it, and nothing is built.
