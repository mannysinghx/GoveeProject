# AI build: progress and hand-over

This file is for whoever picks up the AI work next, on any account, tool or computer, without the conversation that produced it. Everything needed is in this repository; nothing depends on a chat history, a scratch folder or a running session.

Last updated: 9 November 2026, 20:45 UTC.

The plan itself is [ai-features-plan.md](ai-features-plan.md). [PROGRESS.md](PROGRESS.md) remains the progress document for the whole project and points here.

## 1. Where it stopped

| | |
|---|---|
| Branch | `claude/stoic-antonelli-c7ec73` |
| Last commit | `ed0fd9b` Add Ask, answered by DeepSeek, Gemini and GLM in turn. This document is committed after it. |
| Based on | `main` at `81e115b`, merged in as `543bbe3` |
| Uncommitted | Nothing |
| **Pushed?** | **No.** The branch exists only on the owner's Mac. GitHub (`origin`) has `main` only. |
| Deployed? | No. Production on Railway runs `main` and has none of this. |
| Where it is on disk | `/Volumes/ARGUS5/PROJECTS/GoveeProject/.claude/worktrees/stoic-antonelli-c7ec73`, a git worktree of `/Volumes/ARGUS5/PROJECTS/GoveeProject` |

**The one thing that could lose work:** the branch is not on GitHub. If this Mac's disk were lost, so would these commits be. To protect it, push the branch once local CI passes. A branch other than `main` does not deploy, because Railway watches `main` only. Pushing needs the owner's approval under the project rules.

```bash
git -C /Volumes/ARGUS5/PROJECTS/GoveeProject push -u origin claude/stoic-antonelli-c7ec73
```

If pushing is not wanted, a single-file backup of the branch can be kept anywhere, and restored with `git clone ai-build.bundle`:

```bash
git -C /Volumes/ARGUS5/PROJECTS/GoveeProject bundle create ~/ai-build.bundle main claude/stoic-antonelli-c7ec73
```

## 2. What the owner decided

All on 9 November 2026, in their words where it matters.

| Decision | What was said |
|---|---|
| No sign-up | "we dont need any signup". [multi-user-plan.md](multi-user-plan.md) is on hold. |
| Free for now | "it should be free for now": no paid plans, no charging anyone |
| Build Phase 1 | "Start Phase 1" |
| Providers | "exclude anthropic adk and only use deepseek 4 flash cheap models, google gemini flash cheapest models, GLM flash" models, "in round robin manner" |

Still open, for the owner (details in the plan):

- **D3:** the monthly cap. The default is $5, and $1 would do.
- **D5:** web search for events.
- **D6:** photo check, after a trial.
- **D7:** accepting where each provider keeps data: DeepSeek in China, Gemini's free tier used to improve Google products, Z.ai in Singapore.

## 3. Done and verified

| Piece | How it was checked | Result |
|---|---|---|
| Plans: [multi-user-plan.md](multi-user-plan.md), [ai-features-plan.md](ai-features-plan.md) | Claims checked against code and against provider and Railway documentation; scale measured in Docker (evidence in `docs/multi-user-evidence/`) | Committed `30127c9`, `372e3d7` |
| Provider facts: model names, endpoints, prices, data terms | Read from each provider's own documentation on 9 November 2026; links in the plan's "The providers" section | Recorded in the plan and in section 7 below |
| Server: the `apps/server/src/ai/` module, config, migration `005_ai.sql`, routes, wiring | `npx vitest run` in `apps/server`, in the Node 26 container | **407 passed**: the existing 392, plus 15 new in `tests/ai.test.ts` |
| Web: Ask on the Connections and Activity pages, AI section in Settings | `npx vitest run` in `apps/web`: 148 passed before the new tests; the new `src/features/ai/ai.test.tsx` alone, 5 passed | Passed. The full web suite was not re-run after the new test file was added. |
| Type check | `npm run typecheck -w @glm/server` and `-w @glm/web` | **Passed before `tests/ai.test.ts` was written. Fails now**, see 4a |
| Lint | `npx eslint apps/server packages/shared apps/web` | Clean |
| In a real browser | Production build against the Govee mock, with no AI key: Connections, Activity and Settings at desktop width and 375 px. No horizontal scroll, no console errors. | Shows "No AI provider is set up yet" as intended. **What an answer looks like has only been seen in tests,** because no AI key was available. |
| Local CI on `ed0fd9b`: `bash scripts/ci-local.sh --image ed0fd9b` | Clean checkout in Linux, Node 26 | **Failed at type check**, see 4a. Build and install passed; tests, audit and image were not reached. |

## 4. In flight

### 4a. CI failure to fix (blocks any push)

`apps/server/tests/ai.test.ts:99`, in the test "uses only providers with a key, in the order given". It spreads `testConfig()`, which is an already-parsed `AppConfig`, into `loadConfig()`, which expects raw environment strings. Vitest does not type-check, so the test passes; `tsc` rejects it with TS2352.

**Fix:** replace `...testConfig(),` with the raw values the test needs, and remove the `as NodeJS.ProcessEnv` cast if it is no longer needed:

```ts
const config = loadConfig({
  NODE_ENV: 'test',
  DATABASE_PATH: ':memory:',
  AI_PROVIDERS: 'glm, nonsense, deepseek, glm',
  DEEPSEEK_API_KEY: 'a-key',
  GLM_API_KEY: 'b-key',
  GEMINI_API_KEY: '',
});
```

Then remove `testConfig` from that file's imports if nothing else uses it, and re-run the type check and the whole of `scripts/ci-local.sh --image`.

### 4b. Independent review, running when this was written

A multi-agent review of `ed0fd9b` was started:

- **The reviewers:** five, one angle each: provider API correctness against the saved docs, security and privacy, concurrency and the spending cap, integration with the existing app, and test strength.
- **Verification:** two skeptics per finding try to refute it.
- **Its results live only in that session.** If they never arrive here, run the review again; the angles above are the brief.
- **How to apply them:** apply the confirmed findings together with 4a, as one batch.

When results arrive, record them in section 5 with file, line and severity.

### 4c. Not started

- **The first real questions to each provider.** This needs the owner's keys in `.env` locally, or in Railway. Each question costs a fraction of a cent.
- **Deployment.** One push to `main`, after approval. It redeploys the `@glm/server` service and applies migration `005_ai.sql`, which only adds the tables `ai_usage` and `ai_questions`.

## 5. Open findings

| # | Finding | Where | Severity | Who decides |
|---|---|---|---|---|
| 1 | Type error breaks local CI | `apps/server/tests/ai.test.ts:99` | High: blocks push | Fix, see 4a |
| 2 | GLM-4.7-Flash with `thinking: {type: 'disabled'}` is unverified. Z.ai's docs say GLM-4.7 "will think compulsorily" when thinking is on, but do not say whether disabling it is accepted. | `apps/server/src/ai/providers.ts`, the `glm` entry | Medium | First real question. If GLM rejects it, the question moves to the next provider and the error shows in Settings. |
| 3 | A new Gemini key may not reach `gemini-2.5-flash-lite`, because Google limits 2.5 models to people who used them before. The default is therefore `gemini-3.1-flash-lite`. | `GEMINI_MODEL` | Low | Owner, if they want the cheaper model |
| 4 | `docs/govee-integration.md`, row 14, says no page confirms that a new Govee key disables the old one. Govee's notice, effective 15 May 2026, now does. The Settings text "may invalidate" is out of date too. | `docs/govee-integration.md`, `apps/web/src/features/settings/SettingsPage.tsx` (`ServerConfiguration`) | Low | Anyone, separately from the AI work |
| 5 | `scripts/ci-local.sh` is not executable in git (mode 100644), so `scripts/ci-local.sh --image` fails with "permission denied". Use `bash scripts/ci-local.sh --image`, as `npm run ci` does. | `scripts/ci-local.sh` | Low | Owner; a mode change is a one-line commit |
| 6 | `main` keeps moving, because other sessions work on it. This branch's `docs/PROGRESS.md` and `docs/OPS_LOG.md` changes may conflict, and migration `005` must still be the next free number when merging. | Merge time | Medium | Whoever merges |

## 6. Next steps, in order

1. Fix 4a, apply the confirmed review findings, and commit.
2. Run `bash scripts/ci-local.sh --image` on that exact commit. It must pass completely.
3. Ask the owner to push the branch as a backup, then decide D3 and D7.
4. With the owner's keys in a local `.env`, never pasted into a chat, ask one real question per provider against the dev-mock stack. Record the real token counts in the plan's Cost section, and correct any model or parameter the providers reject, finding 2 especially.
5. Check Ask against five real past events from production data, which needs the owner: a missed run, an offline light, a rate limit, a schedule skipped by policy, and a catch-up.
6. Merge `main` in again, check the migration number, re-run CI, and propose one deployment, with what changed, what was tested, the risk and how to undo it. Undo is redeploying the previous `main` commit in Railway; the two new tables can stay.
7. Then Phase 2 of the plan.

## 7. Facts the code depends on

Checked on 9 November 2026. If a provider changes these, update `apps/server/src/ai/providers.ts`, which holds every one of them, and the plan.

| | DeepSeek | Gemini | Z.ai GLM |
|---|---|---|---|
| Endpoint | `POST https://api.deepseek.com/chat/completions` | `POST https://generativelanguage.googleapis.com/v1beta/openai/chat/completions` | `POST https://api.z.ai/api/paas/v4/chat/completions` |
| Auth | `Authorization: Bearer <key>` | `Authorization: Bearer <GEMINI_API_KEY>` | `Authorization: Bearer <key>` |
| Default model | `deepseek-flash`, served by DeepSeek-V4.1-Flash; `deepseek-v4-flash` is a legacy alias | `gemini-3.1-flash-lite`, shutting down 7 May 2027, replacement `gemini-3.5-flash-lite` | `glm-4.7-flash` |
| Thinking | On by default. Sent: `thinking: {type: 'disabled'}`. With thinking on and tools, `reasoning_content` must be passed back. | Sent: `reasoning_effort: 'low'` | Sent: `thinking: {type: 'disabled'}` (unverified, finding 2) |
| Price per million tokens, in / out | $0.30 / $1.20 at peak, half off-peak | $0.25 / $1.50; free tier available | Free |
| Data | Processed and stored in China; terms under Chinese law | Free tier: may be used to improve Google products, and human reviewers may read it. Paid: not used. | Processed in Singapore; API content not used for improvement unless agreed |

The app's ledger counts every model at its paid price, peak for DeepSeek, so the monthly cap never relies on a free allowance. A model with no listed price counts at $2 / $10 per million tokens.

## 8. How to resume

### On this Mac

```bash
cd /Volumes/ARGUS5/PROJECTS/GoveeProject/.claude/worktrees/stoic-antonelli-c7ec73
```

```bash
git status
```

```bash
git log --oneline -5
```

### On another computer

Only possible after the branch is pushed, or copied as a bundle (section 1).

```bash
git clone https://github.com/mannysinghx/GoveeProject && cd GoveeProject
```

```bash
git checkout claude/stoic-antonelli-c7ec73
```

### Building and testing

The project needs Node 22.12+, 24 or 26 (26 is in `.nvmrc`). This Mac has Node 23, so all work here ran in a Node 26 Linux container that mounts the worktree, with dependencies kept in Docker volumes so they never mix with macOS builds.

```bash
docker run -d --name glm-dev -v "$PWD":/w -v glm-dev-nm:/w/node_modules -v glm-dev-nm-server:/w/apps/server/node_modules -v glm-dev-nm-web:/w/apps/web/node_modules -v glm-dev-nm-shared:/w/packages/shared/node_modules -w /w -e CI=true node:26-bookworm-slim sleep infinity
```

```bash
docker exec glm-dev sh -c 'apt-get update -qq && apt-get install -y -qq --no-install-recommends python3 make g++ && npm ci --no-audit --no-fund'
```

```bash
docker exec glm-dev sh -c 'npm run build && npm run typecheck && npx eslint . && npm test'
```

Before any push, the full CI on the exact commit. It never uses GitHub:

```bash
bash scripts/ci-local.sh --image
```

On a machine with Node 26 installed, the same commands run without the container: `npm ci`, `npm test` and so on.

### Seeing it in a browser, with no real Govee or AI calls

```bash
npm run dev:mock
```

Then open <http://localhost:5187>. This uses `apps/server/dev-mock.env` and the local Govee mock. To try Ask for real, add one or more of `DEEPSEEK_API_KEY`, `GEMINI_API_KEY` and `GLM_API_KEY` to a local `.env`, which git ignores. Never put them in a commit, a chat or a log.

### Keys and production

- AI keys go in Railway variables, set by the owner in the dashboard.
- A Claude session must not read Railway variables with `list-variables`, because it returns values.
- Production is the `goveeproject` project, service `@glm/server`, at <https://www.lightup.ink>. See [deploy-railway.md](deploy-railway.md).

## 9. Map of the change

| Area | Files |
|---|---|
| Provider client, prices, hosts | `apps/server/src/ai/providers.ts` |
| Round-robin, failover, tool loop, references, cap | `apps/server/src/ai/ai-service.ts` |
| Read-only tools and what they leave out | `apps/server/src/ai/ask-tools.ts` |
| Usage and questions storage | `apps/server/src/ai/ledger.ts`, `migrations/005_ai.sql` |
| Routes | `apps/server/src/ai/ai-routes.ts`: `GET /api/v1/ai/status`, `POST /api/v1/ai/ask`, `GET /api/v1/ai/questions` |
| Settings | `apps/server/src/config/env.ts`, with the `AI_*`, `DEEPSEEK_*`, `GEMINI_*` and `GLM_*` variables; `.env.example`; `docs/setup.md` |
| Wiring | `apps/server/src/app/context.ts` (`configSecrets`, `ai`), `app/build-app.ts`, `main.ts`, `system/maintenance.ts` (pruning) |
| Shared types | `packages/shared/src/ai.ts` |
| Web | `apps/web/src/features/ai/AskCard.tsx`, `AiSettings.tsx`, `apps/web/src/lib/queries.ts` (`useAiStatus`, `useAiQuestions`, `useAskAi`) |
| Tests | `apps/server/tests/ai.test.ts`, `apps/web/src/features/ai/ai.test.tsx` |
| Docs | `docs/security.md#ai`, `docs/known-limitations.md` ("Limits of Ask"), `docs/architecture.md` ("AI"), `docs/deploy-railway.md` |

## 10. Local things that are not in the repository, and do not need to be

- **The session's scratch folder:** copies of provider pages, CI logs and edit scripts. Every fact taken from them is written into this file and the plan.
- **Docker:** the container `glm-dev` and the volumes `glm-dev-nm`, `glm-dev-nm-server`, `glm-dev-nm-web` and `glm-dev-nm-shared`. Recreate them with the commands in section 8. They are logged in `docs/OPS_LOG.md`.
- **`.claude/launch.json` in this worktree:** ignored by git, and holds preview entries pointing at scratch scripts. Not needed; use `npm run dev:mock`.
