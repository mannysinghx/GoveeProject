# Evidence for the multi-user plan

Throwaway measurements behind [the plan](../multi-user-plan.md). They use a stand-in for Govee and throwaway SQLite files. They never contact Govee or production.

The files end in `.txt` so that lint, the build and `.gitignore` leave them alone.

| File | What it is |
|---|---|
| `rebuild-test.mjs.txt` | Runs the usual table-rebuild recipe through the real `runMigrations` |
| `scale-test.mjs.txt` | One full set of services per account, in its own file. Arguments: account count, then optionally `reuse`, then optionally `small`. |
| `run-in-docker.sh.txt` | The commands run inside the container, in the corrected run |
| `results-first-run.log.txt` | Rebuild test, and 10 to 1,000 accounts. Its "one monitor pass" lines are not valid, because those checks were skipped as too recent. |
| `results-corrected-run.log.txt` | 100 and 500 accounts, a valid monitor timing, restarts, and the smaller cache |

To repeat, from the repository root. Replace `<commit>` with the commit under test, and expect a few minutes per run:

```bash
D=$(mktemp -d); mkdir "$D/exp"; cp docs/multi-user-evidence/rebuild-test.mjs.txt "$D/exp/rebuild-test.mjs"; cp docs/multi-user-evidence/scale-test.mjs.txt "$D/exp/scale-test.mjs"; git archive <commit> > "$D/app.tar"; tar -rf "$D/app.tar" -C "$D" exp; docker run --rm -i --cpus=2 --ulimit nofile=65536:65536 node:26-bookworm-slim bash -c "$(cat docs/multi-user-evidence/run-in-docker.sh.txt)" < "$D/app.tar"
```

The first run used `node rebuild-test.mjs` and account counts of 10, 100, 500 and 1,000. Add those lines to the script to repeat it. The command above is assembled from the steps used and was not itself re-run.

Measured at commit `10bb5c8`, on Node 26.13 in Linux, limited to 2 CPUs.
