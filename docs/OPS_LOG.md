# Operations log

One line per action with a side effect outside the working tree: timestamp · what · why · how to undo · verified?

- 2026-11-06 · Created local git repository on `main` · project had none and the build needs commits · delete `.git` · yes
- 2026-11-06 · Built local Docker images tagged `govee-light-manager:ci-*` and ran throwaway smoke-test containers and volumes · local CI image check · `docker image rm` the tag; containers and volumes remove themselves · yes
- 2026-11-06 · Set the GitHub remote and pushed `main` to github.com/mannysinghx/GoveeProject (public, was empty) · owner asked for it, open source · delete the branch or repository on GitHub; published code may already be cached · see `git log origin/main`
- 2026-11-07 · Railway `goveeproject`: deleted `@glm/web` (never deployed; no variables, domain or volume) · backend serves the frontend, and the service could only crash-loop · recreate from the repo if ever wanted · yes
- 2026-11-07 · Railway `goveeproject`, `@glm/server`: set start command, healthcheck, watch patterns, sleep off, restart always; added volume at `/data`; set variables; generated public domain · first working deployment · revert in the dashboard; deleting the volume destroys the database · see docs/deploy-railway.md
- 2026-11-07 · Railway `@glm/server`: changed `TRUST_PROXY` from 1 to 2, which restarted the app · live test showed clients sharing a Railway edge address · set it back to 1 · yes, the client address is correct and forged headers are ignored
- 2026-11-07 · Read the production database over `railway ssh`, read-only, for device capabilities and status errors · to design patterns from real data · nothing changed · yes
- 2026-11-07 · Deployed the pattern editor and the group status fix to Railway · owner asked for DIY-style patterns; status polling failed every minute on a Govee group · redeploy the previous deployment in Railway; no database changes · see `docs/PROGRESS.md`
- 2026-11-07 · Deployed the multi-string pattern editor to Railway · owner asked for all strings shown in series · redeploy the previous deployment in Railway; adds one optional setting, no migration · see `docs/PROGRESS.md`
- 2026-11-07 · Read device capabilities from the production database over `railway ssh`, read-only · to check whether real lights expose anything finer than segments · nothing changed · yes, they report segments 0 to 26 only
