# AI build: progress and hand-over

This file is for whoever picks up the AI work next, on any account, tool or computer, without the conversation that produced it. Everything needed is in this repository; nothing depends on a chat history, a scratch folder or a running session.

Last updated: 9 November 2026, after the review fixes and the first push.

The plan itself is [ai-features-plan.md](ai-features-plan.md). [PROGRESS.md](PROGRESS.md) remains the progress document for the whole project and points here.

## 1. Where it stopped

| | |
|---|---|
| Branch | `claude/stoic-antonelli-c7ec73` |
| Last code commit | `9c139c2` Fix what the review of Ask found. Local CI passed on it in full. This document's update is committed after it. |
| Based on | `main` at `81e115b`, merged in as `543bbe3` |
| Uncommitted | Nothing |
| Pushed? | **Yes**, as a backup, with the owner's approval ("Yes, after CI"). `origin/claude/stoic-antonelli-c7ec73` holds `9c139c2`; later documentation commits may be local until the next push. Railway deploys only `main`, so pushing deployed nothing. |
| Deployed? | **Yes.** `main` was fast-forwarded to `9cb9eb3` on 10 November 2026 at 07:14 UTC, with the owner's approval. Railway deployment `6dceade9` succeeded, migration `005_ai.sql` applied, and the three providers loaded from Railway variables. Roll back by redeploying `2de021d` in Railway. |
| Where it is on disk | `/Volumes/ARGUS5/PROJECTS/GoveeProject/.claude/worktrees/stoic-antonelli-c7ec73`, a git worktree of `/Volumes/ARGUS5/PROJECTS/GoveeProject` |

The code is safe on GitHub. To back up commits made since the last push, run local CI on them and then push again, with the owner's approval:

```bash
git -C /Volumes/ARGUS5/PROJECTS/GoveeProject/.claude/worktrees/stoic-antonelli-c7ec73 push
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
| Server: the `apps/server/src/ai/` module, config, migration `005_ai.sql`, routes, wiring | `npm test` in the Node 26 container | **428 passed**: the existing 392, plus 36 in `tests/ai.test.ts` |
| Web: Ask on the Connections and Activity pages, AI section in Settings | `npm test` | **153 passed**, including 5 in `src/features/ai/ai.test.tsx` |
| Shared | `npm test` | 55 passed |
| Type check and lint | `npm run typecheck`, `npx eslint .` | Clean |
| Independent review of `ed0fd9b` | 5 reviewers, each finding checked by 2 skeptics: 41 distinct findings, 25 confirmed, 8 split, 8 refuted | All confirmed findings fixed in `9c139c2`, each with a test. The two serious ones were checked by undoing each fix and watching its test fail. See section 5. |
| In a real browser | Production build against the Govee mock, with no AI key: Connections, Activity and Settings at desktop width and 375 px. No horizontal scroll, no console errors. | Shows "No AI provider is set up yet" as intended. **What an answer looks like has only been seen in tests,** because no AI key was available. |
| Local CI on `ed0fd9b` | `bash scripts/ci-local.sh --image ed0fd9b` | Failed at the type check: a test file only, fixed in `9c139c2` |
| **Local CI on `9c139c2`** | `bash scripts/ci-local.sh --image 9c139c2`: clean checkout, Linux, Node 26 | **Passed in full:** install, build, type check, lint, all tests, production dependency audit (0 vulnerabilities), the frontend bundle check, the production image build and its smoke test |

## 4. In flight

**Phase 2 (Describe a pattern, Describe a schedule) is built on this branch,** without the "colours from a photo" option.
- **Tests:** 651 pass (shared 55, server 436, web 160).
- **Browser:** seen at desktop and phone width against the Govee mock, with placeholder keys and no AI request sent.
- **Next:** full local CI, then the owner's approval to deploy.
- **What a deploy changes:** it redeploys `@glm/server`, with no database change.
- **Code:**
  - `apps/server/src/ai/drafts.ts` (prompts and checks)
  - `AiService.draftPattern` and `draftSchedule`, the routes `POST /api/v1/ai/draft-pattern` and `/draft-schedule`
  - `apps/web/src/features/ai/DescribeBox.tsx`, and `applyPatternDraft` in `pattern-model.ts`

Not started yet:

- **The first real questions to each provider.** This needs the owner's keys in `.env` locally, or in Railway. Each question costs a fraction of a cent.

## 5. Open findings

Review findings fixed in `9c139c2`, recorded so nobody re-raises them:

- Sunrise and sunset schedules leaked latitude and longitude through `list_schedules`.
- Gemini 3's `extra_content` (thought signature) was dropped from replayed tool calls.
- `finish_reason` was ignored.
- The 8-request limit applied per provider rather than per question.
- There was no deadline per question, and no cap on tool calls or tool output.
- Local errors rested every provider.
- Retry-After was ignored for a lone provider, and a provider stayed marked as resting after answering.
- An answer's cost left out what failed providers spent.
- Failed sign-ins could crowd real events out of `search_activity`.
- Tool names on `Object.prototype` were accepted.
- GLM-5.3 was sent thinking "disabled".
- Gemini's array-wrapped errors were not read.
- Answers were not announced to screen readers.
- Several tests were too weak to catch a regression.

Still open:

| # | Finding | Where | Severity | Who decides |
|---|---|---|---|---|
| 1 | GLM-4.7-Flash with `thinking: {type: 'disabled'}` is unverified. Z.ai documents it as optional, "disabled" or "enabled", but it has not been sent for real. | `apps/server/src/ai/providers.ts`, the `glm` entry | Medium | The first real question. If GLM rejects it, the question moves on and the error shows in Settings. |
| 2 | Gemini's `extra_content` handling follows Google's thought-signature rules, but has only been tested against the stand-in. | `providers.ts` | Medium | The first real Gemini question that uses a tool |
| 3 | A new Gemini key may not reach `gemini-2.5-flash-lite`, because Google limits 2.5 models to people who used them before. The default is `gemini-3.1-flash-lite`. | `GEMINI_MODEL` | Low | Owner, if they want the cheaper model |
| 4 | `docs/govee-integration.md`, row 14, says no page confirms that a new Govee key disables the old one. Govee's notice, effective 15 May 2026, now does. The Settings text "may invalidate" is out of date too. | `docs/govee-integration.md`, `apps/web/src/features/settings/SettingsPage.tsx` (`ServerConfiguration`) | Low | Anyone, separately from the AI work |
| 5 | `scripts/ci-local.sh` is not executable in git (mode 100644), so `scripts/ci-local.sh --image` fails with "permission denied". Use `bash scripts/ci-local.sh --image`, as `npm run ci` does. | `scripts/ci-local.sh` | Low | Owner; a mode change is a one-line commit |
| 6 | `main` keeps moving, because other sessions work on it. This branch's `docs/PROGRESS.md` and `docs/OPS_LOG.md` changes may conflict, and migration `005` must still be the next free number when merging. | Merge time | Medium | Whoever merges |
| 7 | Split review points, judged not worth changing now. A request that a provider bills but that returns HTTP 200 with an unusable body is estimated, not exact. The cursor is not persisted, so a restart begins again with the first provider. | `ai-service.ts` | Low | None needed |

## 6. Next steps, in order

1. The owner asks a few questions in Ask on www.lightup.ink. Round-robin means three questions reach all three providers. Then check Settings, then AI, for any provider marked as resting, and its note.
2. Fix any model or parameter a provider rejects. Record the real token counts in the plan's Cost section, and correct any model or parameter the providers reject, open findings 1 and 2 especially.
3. Check Ask against five real past events from production data, which needs the owner: a missed run, an offline light, a rate limit, a schedule skipped by policy, and a catch-up.
4. The owner decides D3 (the cap; the default is $5) and D7 (which providers' data terms are acceptable). Drop a provider by removing its key in Railway.
5. Then Phase 2 of the plan.

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

The branch is on GitHub.

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
