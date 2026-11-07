# Real-device acceptance checklist

**Automated tests use a stand-in for the Govee API. Everything below needs your real H805C and a real API key, and none of it has been done yet.** Please fill in the results. They are what will settle the open questions in [Govee integration](govee-integration.md).

Before you start, keep **Activity** open in a second tab. Have someone able to see the lights, or test after dark from where you can see them.

Record: date, app version, firmware version from the Govee app, and H805C segment count if shown.

| # | Step | Expected | Result | Notes |
|---|---|---|---|---|
| 1 | **Discover.** Connect to Govee, then Test connection and find devices. | The H805C is listed and marked Permanent Outdoor Lights Elite. | | |
| 2 | **Inspect capabilities.** Open the device, and expand Developer diagnostics. | The list matches the raw JSON. Controls shown match the capabilities listed. Save this JSON, as it answers many open questions. | | |
| 3 | **Power off, then on.** | Each shows Accepted, then Confirmed once Govee reports it. The lights physically change. Note the delay. | | |
| 4 | **Brightness.** Move the slider and release. | One command per release. The lights change. | | |
| 5 | **Solid colour.** Apply pure red `#ff0000`, then pure green and blue. | The lights show the right colours, with channels in the right order. | | |
| 6 | **Colour temperature,** if listed. | Range matches the capability. Warm is warm and cool is cool. | | |
| 7 | **Refresh state.** Use Refresh status. | Values match the lights. Note which settings say Not reported. | | |
| 8 | **Segments, only if listed.** Set one segment to red. Then build a multi-step arrangement. | Note how many bulbs one segment covers. Do not assume one segment is one bulb. | | |
| 9 | **Scenes, only if listed.** Refresh scenes, then activate a dynamic scene, a device-list scene, a DIY scene and a snapshot, as available. | Each changes the lights. **Record any rejection and its message.** DIY control is undocumented, so it is the most likely to fail. | | |
| 10 | **Scheduled action.** Create a one-time schedule for 2 minutes from now, then close the browser. | It runs on time. History shows the run. | | |
| 11 | **Recurring schedule across a restart.** Create a daily schedule. Restart the app before it runs. | It still runs, once. | | |
| 12 | **Missed run.** Stop the app across a scheduled time, then start it. | History shows Missed. Nothing is sent, unless you chose catch up. | | |
| 13 | **Offline.** Cut power to the lights for a few minutes. Refresh status, then send a command. | Shows Offline with historical values. Note whether Govee accepts or rejects the command. **Record this.** | | |
| 14 | **Recovery from offline.** Restore power, and refresh. | Returns to Online. | | |
| 15 | **Preset.** Create turn on, then brightness, then colour, and apply it. | Steps run in order. Results are reported per step. | | |
| 16 | **Group,** if you have more than one device. | Results per device. Unsupported actions are skipped with a reason. | | |
| 17 | **Rate limit behaviour.** Move sliders quickly for a minute. | No errors shown, or a clear rate-limit message. Check for rate-limit events in Activity. | | |

## Questions these tests should answer

Please note the answers, since the documentation does not settle them:

1. What does a successful `device/control` response contain? The server does not log bodies by default, so a developer would need to capture this.
2. Does `device/state` report a value for each capability on the H805C? Which ones are empty?
3. How long after an accepted command does a report show the new value?
4. Does the H805C report segments? How many, and how many bulbs does each cover?
5. Does it accept `diyScene` commands, and with which capability type?
6. What does Govee do with a command sent to an offline device?
7. Does applying for a new API key invalidate the old one?
8. Are any rate-limit headers returned?

## Which tests need what

| Test type | Needs a Govee key | Needs physical lights |
|---|---|---|
| `npm test`, `scripts/ci-local.sh` | No | No |
| `npm run dev:mock` | No | No |
| Steps 1, 2 and 7 above | Yes | Lights must be on your account |
| All other steps above | Yes | Yes |
