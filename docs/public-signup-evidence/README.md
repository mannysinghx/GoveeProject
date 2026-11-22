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

**Phase 5 mutation checks, 22 November 2026.** `phase5-mutations.py.txt` breaks one guarantee at a time: a Govee key checked with Govee before it is kept; the key-check limit; the owner's `GOVEE_API_KEY` not replaceable from the browser; a member's own Govee key used, and the owner's AI keys never given to them; each member's own AI cap; one AI key per account, whatever model; only priced models; AI keys checked; connected keys scrubbed; the server-wide AI limit; resting state tied to the key; holiday shows off for members; the per-member request limit; caps that ignore built-ins and spare the owner; the owner's account not deletable; delete and export needing the password; delete removing the file, the sign-in history and the loaded account; the push signing key kept out of exports; suspending ending sessions and unloading the account; the accounts list owner-only. First run: 22 of 26 caught. Three were weak tests and were strengthened (the owner never neared a cap; deleting a user only unlinks its history rows, so counting by user found nothing either way; suspended sessions stay refused but would come back on reactivation), then caught. The fourth, connected keys not scrubbed, is held by a second guard (keys are scrubbed again when first read), and `phase5-mutations-paired.py.txt`, which removes both, is caught.

```bash
python3 phase5-mutations.py.txt
```

```bash
python3 phase5-mutations-paired.py.txt
```
