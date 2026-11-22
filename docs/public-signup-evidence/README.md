# Evidence for public sign-up

**Phase 3 cutover rehearsal, 22 November 2026.** `rehearse-cutover.sh.txt` runs the version deployed at the time (`19166b3`, built in `/old`) and the Phase 3 build (`b4cd681`, in `/app`) on one data folder, against the Govee mock, with test data and a throwaway master key it never prints. `rehearse-cutover-output.txt` is what it printed.

To repeat it, in a `node:26-bookworm-slim` container with the repo at `/app`, built, and `git archive 19166b3` built at `/old`:

```bash
bash rehearse-cutover.sh
```

The `.txt` endings stop these being run or linted by accident.
