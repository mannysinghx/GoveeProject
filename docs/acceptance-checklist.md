# Real-device acceptance checklist

**Automated tests use a stand-in for the Govee API. Everything below needs your real H805C and a real API key.** Discovery works on a real account, but no step below has been signed off by checking the lights. Please fill in the results. They are what will settle the open questions in [Govee integration](govee-integration.md).

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
| 8a | **One string.** In Paint a pattern, untick all but one string. Send a repeating red and white pattern. | Red and white in the expected places. Note which physical end is segment 0, and flip the string if it is the wrong way round. Check colors reach the far end. | | |
| 8b | **All strings in series.** Tick them all, arrange their order, and paint across a join between two strings. | The paint crosses the join on the house where it does on screen. Note how long they take. | | |
| 8c | **Saved pattern.** Save it, then apply it from Scenes & Presets. | The same result, with no target needed. | | |
| 9 | **Scenes, only if listed.** Refresh scenes, then activate a dynamic scene, a device-list scene, a DIY scene and a snapshot, as available. | Each changes the lights. **Record any rejection and its message.** DIY control is undocumented, so it is the most likely to fail. | | |
| 10 | **Scheduled action.** Create a one-time schedule for 2 minutes from now, then close the browser. | It runs on time. History shows the run. | | |
| 11 | **Recurring schedule across a restart.** Create a daily schedule. Restart the app before it runs. | It still runs, once. | | |
| 12 | **Missed run.** Stop the app across a scheduled time, then start it. | History shows Missed. Nothing is sent, unless you chose catch up. | | |
| 13 | **Offline.** Cut power to the lights for a few minutes. Refresh status, then send a command. | Shows Offline with historical values. Note whether Govee accepts or rejects the command. **Record this.** | | |
| 14 | **Recovery from offline.** Restore power, and refresh. | Returns to Online. | | |
| 15 | **Preset.** Create turn on, then brightness, then colour, and apply it. | Steps run in order. Results are reported per step. | | |
| 16 | **Group,** if you have more than one device. | Results per device. Unsupported actions are skipped with a reason. | | |
| 17 | **Rate limit behaviour.** Move sliders quickly for a minute. | No errors shown, or a clear rate-limit message. Check for rate-limit events in Activity. | | |

## Notifications and holidays

These need your real phone and lights:

1. **Turn on alerts.** On iPhone, add the app to your Home Screen from Safari and open it from there. Go to **Notifications**, choose **Turn on for this device**, then **Send a test**. It should appear on your phone within a few seconds. This has not yet been tried on a real phone.
2. **Try with the app closed.** Close it, and send a preset from another device. Check the notification arrives, and note whether **Looks right** and **Didn't change** appear on it.
3. **Check Diwali.** Under **Schedules**, it should say Sunday, November 8, 5:00 PM to 8:00 PM. At 4:45 PM you should get a reminder with a Skip option. At 5:00 PM the lights should show Diwali colors, then Fireworks at 5:30, taking turns until they go off at 8:00.
4. **Answer Lights Check.** Say whether the colors matched the squares. Answers are kept in **Activity**.

## Festival presets and fireworks

These need your real lights:

1. **Try the fireworks.** On **Scenes & Presets**, choose **Try it** under New Year fireworks. Check that all strings show the effect, and how far out of step they are.
2. **Note how long it runs.** It should carry on by itself, with no more commands. If it stops, the 12:30 AM end time needs rethinking.
3. **Try a moving effect and a pattern,** such as Thanksgiving: Govee Effect and Veterans Day: Red, White & Blue. Check the colors look right.
4. **Check Schedules.** New Year Fireworks should show its next run as 12:00 AM on January 1 in your time zone.

## White LEDs

Run **Check my lights** (**LEDs look wrong?** on the pattern page) and keep the report it gives you. If Test 1 is wrong, the problem isn't segment commands. If only Test 2 is wrong, it is. Test 3 shows how many LEDs one segment really covers.

## LED boxes and connection monitoring

These need your real lights:

1. **Paint one segment.** Set the background to one color, paint one outlined group in another, and send it. Count the LEDs that change. The editor assumes 4 on an H805C. If it differs, or the group is in the wrong place, report it, because the LED layout is calculated, not reported by Govee.
2. **Check the direction.** Paint LEDs 1 to 4. They should be at the controller end. If they are at the far end, use **Flip**.
3. **Unplug one string.** Within a few minutes, **Connections** should show it offline and name it. Plug it back in, and it should show as back online, with how long it was out.
4. **Send a pattern while it is unplugged.** It should say the light is offline and list the pattern as missed. Turn on automatic resending, plug it back in, and check the colors arrive.

## Questions these tests should answer

Please note the answers, since the documentation does not settle them:

1. What does a successful `device/control` response contain? The server does not log bodies by default, so a developer would need to capture this.
2. Does `device/state` report a value for each capability on the H805C? Which ones are empty?
3. How long after an accepted command does a report show the new value?
4. How many bulbs does each of the H805C's 27 segments cover? (It reports 27. The bulb count is unknown.)
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
