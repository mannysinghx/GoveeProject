# Troubleshooting

Start at **Activity**. The diagnostics panel shows whether the database, scheduler and Govee key are in order, and when Govee was last reached. Errors include a reference that matches `reqId` in the server log.

Server logs:

```bash
docker compose logs -f app
```

For a direct install, logs go to the terminal, or to wherever your service manager sends them.

## Setup

**The setup screen asks for a code.** Someone else might be able to reach the app, so a code is required. This applies in Docker, off loopback, and behind a proxy:

```bash
docker compose logs app | grep setupCodeForFirstRun
```

It changes on restart. Set `SETUP_TOKEN` in `.env` for a fixed one.

**"This host name is not allowed."** You reached the app using a name other than `localhost` or `127.0.0.1`, or a name missing from `ALLOWED_HOSTS`. Add it to `ALLOWED_HOSTS` and restart.

**Blank page or "The web app has not been built."** Run `npm run build`.

**The app will not start, and names a setting.** It stopped at a bad value in `.env`. The message names the setting without showing its value.

**`GOVEE_API_BASE_URL must be...`** The app refuses to send your key to anything but the official Govee host or loopback. Remove the setting.

## Connecting to Govee

| What you see | Likely cause | What to do |
|---|---|---|
| *No API key is configured* | `GOVEE_API_KEY` is empty or was not loaded | Set it in `.env` and restart. With Docker, recreate the container with `docker compose up -d`. |
| *Govee rejected the API key* | Wrong key, or it was replaced | Check for spaces. If you applied for a new key, use the newest one. |
| *Could not reach the Govee service* | No internet or DNS on the server | Check from the server, or from inside the container. |
| *Govee did not respond in time* | Temporary | Try again shortly. The app retries a limited number of times. |
| *Rate limit reached* | Too many requests | Wait a minute. The app slows down by itself. Check **Govee requests today** in diagnostics. |
| *Daily Govee request budget* | The app's own safety limit | Resets at 00:00 UTC or on restart. Raise `GOVEE_DAILY_REQUEST_BUDGET` if needed. |

## Devices

**A light is offline.** Open **Connections** for the likely cause and what to try. If some lights are online, look at that light's power and Wi-Fi. If all of them are offline, look at what they share: your router, internet or power. The app cannot fix these itself. It can resend a missed pattern when the light returns, if you turn that on under **Patterns lights missed**.

**Some LEDs stay white or don't take the color.** On the pattern page, choose **LEDs look wrong?**. It runs three tests you check by eye, gives the likely cause, and lets you mark the wrong LEDs and resend their segments. The app can't read LED colors itself.

**A painted box changes other boxes too.** LEDs in the same outlined group are one segment, the smallest part Govee's API can color.

**The LED count looks wrong.** It is worked out from the model's published specs. If you cut or extended a string, enter your count next to it in the pattern editor.

**A device is not listed.**

1. Check that it appears in the Govee Home app, on the same account as your key.
2. Choose **Refresh device list** on the dashboard.
3. Check that its model is on [Govee's supported list](https://developer.govee.com/docs/support-product-model).

**A device shows "No longer discovered".** Govee's last device list did not include it. History, presets and schedules are kept, but it cannot be controlled. If you removed and re-added it in the Govee app, it may come back with a new identifier and appear as a new device.

**A device shows "Offline".** Govee reports it as offline. Check the Govee Home app. If it is offline there too, check power and Wi-Fi. Values shown are historical until it returns.

**Status shows "Unknown" or "Not reported".** Govee returned no value. An empty value means the setting cannot be queried, according to Govee's documentation. That is why some commands can never show as confirmed.

## Controls

**A control I expected is missing.** Controls appear only if Govee reports the capability for your device. Open **Developer diagnostics** on the device page to see what was returned. Govee's app may offer features that the public API does not. Refresh the device list if your device was updated recently.

**A command says "Accepted by Govee" but the lights did not change.** Accepted means only that Govee took the request. Check that the device is online. Use **Refresh status** to see what Govee now reports. If this repeats on a device that is online, please note the details from the [acceptance checklist](acceptance-checklist.md), since real-device behaviour is not yet verified.

**A command says "Later Govee report shows a different value".** Govee's report may lag behind a command, and the app checks once more on its own. If it persists, the command may not have taken effect, or the device may report that value differently.

**A command says "Rejected by Govee".** Govee refused it. The message includes Govee's reason. This may mean the app's reading of a capability needs correcting: see [unclear documentation](govee-integration.md#decisions-made-where-the-documentation-is-unclear).

**A command says "Not delivered".** The request never got a clear answer after retries, so it may or may not have taken effect.

**Scenes are empty, or fewer than in the Govee app.** Use **Refresh scenes**. Only scenes the API returns can be listed.

**A DIY scene fails to activate.** The documentation gives no DIY control example, so this is the most likely thing to need a change after real-device testing. See decision 4 in [Govee integration](govee-integration.md).

## Schedules

**A schedule did not run.** Open its **History**.

| History shows | Meaning |
|---|---|
| *Missed* | The app was not running, or started more than 2 minutes late. By default it does not catch up. Edit the schedule to change this. |
| *Interrupted* | The app stopped during the run. It is not repeated, because it may have partly executed. |
| *Failed* | Commands could not be delivered, or the target no longer exists. The reason is listed. |
| *Partly accepted* | Some devices or steps did not go through. |
| *Nothing sent* | Nothing was applicable. For example, every step was unsupported, or the group is empty. |
| Nothing at all | Check that the schedule is enabled, its dates include today, and **Scheduler** is *running* in diagnostics. |

**The wrong time.** Check the schedule's time zone, which is separate from the server's. The next-run display shows the real time, including daylight-saving adjustments.

**No sunrise or sunset on some dates.** At high latitudes the event may not happen. Those dates are skipped, and the preview says so.

## Sign-in

**"Too many failed attempts."** Wait for the time shown. It grows with repeated failures.

**Forgotten password.** See [account recovery](security.md#account-recovery).

**Signed out unexpectedly.** Sessions last 7 days (`SESSION_TTL_HOURS`). Changing your password signs out all other sessions.

**Sign-in does not stick behind a reverse proxy.** Set `TRUST_PROXY=true` and make sure the proxy sends `X-Forwarded-Proto`. Otherwise the cookie's Secure setting may not match.

## Database

**`Migration ... changed after it was applied`.** A migration file differs from what was applied. Restore the original with `git checkout migrations/`. Do not edit applied migrations.

**`SQLITE_BUSY`, or the database is locked.** Check that only one copy of the app is running against this file.
