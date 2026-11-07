# Progress

Current state of the project, so anyone can pick it up without the original conversation.

## Where it stopped

- Branch: `main`, pushed to <https://github.com/mannysinghx/GoveeProject>. `git log -1` shows the last commit.
- Version 1 is built and verified against a local stand-in for the Govee API. On a real account, discovery and status work and power commands to a group are accepted. **Whether real lights respond correctly has not been confirmed.** See `docs/govee-integration.md`.
- Deployed on Railway at <https://glmserver-production.up.railway.app> (project `goveeproject`, service `@glm/server`). The owner has set the key and created the account. See `docs/deploy-railway.md`.

## Done and verified

| Piece | How it was checked |
|---|---|
| Backend, frontend, shared code | `npm test`: 416 tests (server 301, web 111, shared 4) |
| Connection monitor, offline detection, catch-up, one box per LED | Real browser against the mock, production build, with one mock light offline, on desktop and at phone width. `scripts/ci-local.sh --image` passed on `481cbdb`. Deployed: migration `002_connection.sql` applied, monitor started at 130-second intervals, status checks ran for all 3 strings and skipped the Govee group, new routes return 401 without a session. No command was sent to real lights. Diagnosis and catch-up have not yet run against a real outage. |
| Pattern editor, all strings in series | Real browser against the mock, production build: drag painting across strings, repeat, flip surviving a reload, per-string sending, phone width. Not yet sent to real lights. |
| Repeat in the pattern editor | Real browser against the mock, production build: a painted pattern with a blank filled all segments across strings, following right-to-left rows. `scripts/ci-local.sh --image` passed on `e05ed8a`, and it is deployed: the live build contains it, health is OK, and the monitor restarted. Not yet tried on real lights. |
| Railway deployment | Health, HTTPS redirect, HSTS, 401s, setup code, volume survives a restart (0 migrations on second boot), clean SIGTERM, real client address with forged headers ignored. The owner has signed in on it. |
| Type check, lint, build, dependency audit, clean install on Linux | `scripts/ci-local.sh` |
| Production image, hardened as in Compose | `scripts/ci-local.sh --image` |
| Every screen, under the real CSP | Production build in a real browser, against `apps/server/scripts/mock-govee.ts`, on desktop and at phone width |
| Scheduler in real time: live run, graceful stop, missed runs, catch-up, restart inside grace, no duplicates, backup and reset CLIs, no secrets in logs or database | A throwaway script against the production build |
| Security and correctness review | Independent review found 12 defects, including a login bypass through percent-encoded paths. All were reproduced and fixed, with regression tests in `apps/server/tests/hardening.test.ts`. |

## In flight

Nothing.

## Open findings and decisions

| Item | Where | Severity | Who decides |
|---|---|---|---|
| Real-device behaviour is unverified, especially DIY scenes | `docs/acceptance-checklist.md`, `docs/govee-integration.md` | High until tested | Owner, with real lights |
| The H805C has 108 LEDs and 4 per segment: calculated from a manual, a third-party comparison and 27 reported segments, not stated by Govee | `docs/govee-integration.md`, `apps/web/src/features/patterns/pattern-model.ts` | Medium | Owner, by counting LEDs on real lights |
| Offline detection matches the word "offline" in Govee's message | `apps/server/src/govee/cloud-transport.ts` | Low | Revisit if Govee changes the wording |
| License is MIT, copyright "mannysinghx" | `LICENSE` | Low | Owner can change it |
| GitHub Actions: none exist, and CI runs locally by policy | `scripts/ci-local.sh` | None | Owner |
| The global login limit could be used to block sign-in for 5 minutes at a time | `docs/security.md` | Low while off the public internet | Owner, if exposing it |

## Next steps, in order

1. Send a pattern to one real H805C string and check it, including the LED count, with `docs/acceptance-checklist.md`.
2. Work through the rest of the checklist.
3. Correct anything the checklist disproves. Adapters are isolated in `apps/server/src/govee/`, and each open question is listed in `docs/govee-integration.md`.

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
scripts/ci-local.sh --image
```
