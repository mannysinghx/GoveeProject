# Progress

Current state of the project, so anyone can pick it up without the original conversation.

## Where it stopped

- Branch: `main`, pushed to <https://github.com/mannysinghx/GoveeProject>. `git log -1` shows the last commit.
- Version 1 is built and verified against a local stand-in for the Govee API. It has **not** been run against the real Govee service or a real H805C.

## Done and verified

| Piece | How it was checked |
|---|---|
| Backend, frontend, shared code | `npm test`: 306 tests (server 250, web 52, shared 4) |
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
| License is MIT, copyright "mannysinghx" | `LICENSE` | Low | Owner can change it |
| GitHub Actions: none exist, and CI runs locally by policy | `scripts/ci-local.sh` | None | Owner |
| The global login limit could be used to block sign-in for 5 minutes at a time | `docs/security.md` | Low while off the public internet | Owner, if exposing it |

## Next steps, in order

1. Get a Govee API key and put it in `.env`.
2. Work through `docs/acceptance-checklist.md` with the real H805C.
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
