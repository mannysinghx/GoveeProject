# The classic UI, saved

On 22 November 2026 the interface was redesigned (see [the design notes](../ui-design.md)). The original is kept two ways, so nothing was lost and either can be brought back.

## What it looked like

Dark charcoal with amber, a left sidebar on a computer, a seven-item tab bar on a phone, plain cards and small buttons. Screenshots taken from the last commit before the redesign, `ffe49b6`, running against the mock Govee API (the lights shown are test data):

| Screen | File |
|---|---|
| Dashboard, computer | [desktop-dashboard.jpg](classic/desktop-dashboard.jpg) |
| A light's page | [desktop-device-detail.jpg](classic/desktop-device-detail.jpg) |
| Scenes & Presets | [desktop-presets.jpg](classic/desktop-presets.jpg) |
| Schedules | [desktop-schedules.jpg](classic/desktop-schedules.jpg) |
| Groups | [desktop-groups.jpg](classic/desktop-groups.jpg) |
| Dashboard, phone | [phone-dashboard.jpg](classic/phone-dashboard.jpg) |

## Where the code is

The git tag **`ui-classic-2026-11-22`** points at `ffe49b6`, the last commit with the classic UI. The redesign changed only the web app (`apps/web`) in code; the docs and README were updated to match. The server, the shared package, the database and every API are the same, so the classic interface still works against today's server.

To look at it without changing anything, in a second folder:

```bash
git worktree add ../classic-ui ui-classic-2026-11-22
```

To put it back in place of the redesign, replace the web app wholesale. Removing the current files first matters, because the redesign added files the classic UI does not have, and a plain checkout would leave them behind:

```bash
git rm -r -q apps/web && git checkout ui-classic-2026-11-22 -- apps/web
```

Then run the checks and commit the result. The tag is local until it is pushed with `git push origin ui-classic-2026-11-22`; it was not pushed as part of the redesign.
