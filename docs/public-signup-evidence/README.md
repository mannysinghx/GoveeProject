# Evidence for public sign-up

**Phase 3 cutover rehearsal, 22 November 2026.** `rehearse-cutover.sh.txt` runs the version deployed at the time (`19166b3`, built in `/old`) and the Phase 3 build (`b4cd681`, in `/app`) on one data folder, against the Govee mock, with test data and a throwaway master key it never prints. `rehearse-cutover-output.txt` is what it printed.

To repeat it, in a `node:26-bookworm-slim` container with the repo at `/app`, built, and `git archive 19166b3` built at `/old`:

```bash
bash rehearse-cutover.sh
```

The `.txt` endings stop these being run or linted by accident.

**Phase 4 mutation checks, 22 November 2026.** `phase4-mutations.py.txt` breaks one guarantee at a time (accounts kept apart, the owner's Govee and AI keys never given to a member, links single-use and unchanged by opening, the same answer for every address, the per-address mail limit, owner-only routes, notification buttons per account, reset signing out, caps rechecked, the bot trap, the proof of work, link text cleared, STARTTLS injection, certificate checks, header injection, the SMTP host allow-list, account file paths), runs the test that should notice, and puts the file back. Result: 20 of 22 caught. `phase4-mutations-paired.py.txt` removes the two that were held by a second guard together with that guard: both caught.

To repeat, in the dev container with the repo at `/app` and dependencies installed:

```bash
python3 phase4-mutations.py.txt
```

```bash
python3 phase4-mutations-paired.py.txt
```
