# Govee integration

Written from Govee's developer documentation as read on 6 November 2026, and corrected by what one real account returned on 7 November 2026. Automated tests use a local stand-in that follows the same shapes.

## What the real service has shown

From a live account with three H805C strings and one group. Commands were only sent to the group, and only accepted responses were seen. **Whether anything changed physically has not been confirmed, and segment, colour and scene commands have not been sent to real lights.**

| Question | Answer from the real API |
|---|---|
| What does an H805C report? | Power, gradient toggle, brightness, per-segment brightness, per-segment colour, RGB colour, colour temperature, scenes, music mode, DIY scenes, snapshots, DreamView toggle |
| Segments | **27, addressed 0 to 26, in the `elementRange` and `size` form.** How many bulbs one covers is still unknown. |
| Colour temperature and brightness | Reported with values while online |
| What cannot be read back? | Segment colour, segment brightness, scenes, DIY scenes, snapshots, music mode and both toggles all return empty. A painted pattern can never show as confirmed. |
| Scene options in the device list | None. Lists must come from the scene endpoints, using **Refresh scenes**. |
| `diyScene` capability type | `devices.capabilities.dynamic_scene` on this model |
| Govee groups | Listed with sku `SameModeGroup`, no type, and power only. Control is accepted. `device/state` answers HTTP 200 with code 400, "devices not exist". |

## Endpoints used

Base URL `https://openapi.api.govee.com`, authenticated with the header `Govee-API-Key`.

| Purpose | Request |
|---|---|
| List devices and capabilities | `GET /router/api/v1/user/devices` |
| Control a device | `POST /router/api/v1/device/control` |
| Device state | `POST /router/api/v1/device/state` |
| Dynamic scenes | `POST /router/api/v1/device/scenes` |
| DIY scenes | `POST /router/api/v1/device/diy-scenes` |

No private or reverse-engineered APIs are used. The configured base URL must be the official host. The only exception is a loopback address, which exists for local testing and is flagged clearly in the UI. Anything else stops startup, so a mistake cannot send your key elsewhere.

## Offline lights

A command to an offline light has been seen to return HTTP 200 with a body `code` of 400 and the message "Device is offline. Please check the Wi-Fi connection." The app detects the word *offline* in Govee's message and reports `device_offline`, not `bad_request`, so it does not suggest the app sent something invalid. It is not retried. Matching on message text is fragile: if Govee changes the wording, this goes back to reading as an invalid request.

## Status requests Govee refuses

When Govee refuses a status request outright, the app stops polling that device for 24 hours, rather than failing every minute forever. Asking by hand still goes through, and a successful report clears this. Temporary failures, such as timeouts and 5xx responses, keep polling as normal.

## Patterns

Govee's public API has no way to create or upload a DIY scene, or to send effects such as Clockwise, Twinkle or Breathe, which run inside the lights. The pattern editor instead sends `segmentedColorRgb` commands, one per colour, and saves the result as an app preset. Static patterns only. Sending motion over the cloud would be slow and uneven at these rate limits, so it is not offered.

The editor counts as a string each device Govee currently lists with `segmentedColorRgb`, and draws them in series. That is an app-level view: the API has no idea how strings relate physically, so order and direction are the owner's to set, and each device still receives its own commands.

To use a moving effect, make it in the Govee Home app. If the API lists it, activate it from **Scenes**.

## H805C

Govee's supported-model list includes `H805C`. The list says nothing about which capabilities a model has, so this project assumes none of them. Everything comes from the response for your own device. Specifically, this app does **not** assume:

- that individual-bulb control exists, or that a segment is one bulb
- any segment count or addressing
- that every scene in the Govee app is available through the API
- that DIY scenes can be created through the API
- that an accepted command changed anything physically

### Scenes on an H805C

The scenes endpoint returned 113 scenes for a real H805C, including Fireworks, New Years, Thanksgiving, Christmas Eve, Winter Wonderland and Fall. Scene ids are read from Govee for each light, never hard-coded. **None of these has been activated on real lights from this app yet**, so how they look, and whether they carry on after the app stops sending commands, is unconfirmed.

### LEDs per string

Govee's API reports neither length nor LED count, so these come from outside it:

- The H805C is the Permanent Outdoor Lights Elite. Its [manual listing](https://manuals.plus/govee/h805c-permanent-outdoor-light-elite-manual) gives 150 ft.
- A [third-party comparison](https://www.glowtraxusa.com/blogs/articles/govee-permanent-lights-original-vs-2-vs-elite-vs-pro-what-is-actually-different) gives about 72 lights per 100 ft for the Elite, which works out to 108. A search summary of a retailer listing also said 108, but that page could not be read directly, and no Govee page was found stating it.
- Real H805C lights report segments 0 to 26, with nothing finer. 108 / 27 is 4 LEDs per segment. **This is arithmetic, not something Govee documents.** Check it by painting one segment and counting the LEDs that change.

The owner can enter a different count per string, such as after cutting or extending one. The editor then spreads the LEDs evenly across the segments.

## Decisions made where the documentation is unclear

Each of these is isolated in `govee/cloud-transport.ts` or `govee/capabilities.ts`, so correcting one after real-device testing should be a small change.

| # | What the documentation shows | What the app does | Check on a real device |
|---|---|---|---|
| 1 | The success response of `device/control` is **not documented**. | Accepts any HTTP 2xx whose body has no failing `code`, and records whether `code: 200` was actually present. | Note the real response body. |
| 2 | The failure table lists codes (400, 404, 429) without saying if they are HTTP statuses or body fields. | Checks both. An HTTP 200 with a body `code` other than 200 is a failure. **Confirmed:** Govee does send errors this way. | |
| 3 | Envelopes differ: the device list uses `code/message/data`, while state and scenes use `requestId/msg/code/payload`. | Parses each endpoint its own way and reads either `message` or `msg`. | |
| 4 | `diyScene` appears under three types: `dynamic_scene`, `dynamic_setting` and `diy_color_setting`. There is no DIY control example anywhere. | Sends the type this device's own device-list entry reports, with the option's integer value. Any type is recognised. | **Activate a DIY scene.** This is the most likely to need a change. |
| 5 | The scene page says static scenes from the device list and dynamic scenes from the scenes endpoint are controlled the same way. Static samples show integer values, dynamic ones `{paramId, id}`. | Sends whichever value Govee returned, unchanged. Other shapes are ignored rather than forwarded. | Activate one of each. |
| 6 | `snapshot` is listed under `dynamic_scene`, with no control example. | Treated like other ENUM scenes. The control page says values are as defined in the device list. | Activate a snapshot, if listed. |
| 7 | The `segmentedColorRgb` example uses `0x0000ff`, which is not valid JSON. | Sends a decimal integer. | Set a segment colour. |
| 8 | No formula is given for colour integers. The range is 0 to 16777215. | Uses `(r << 16) \| (g << 8) \| b`, as in the project brief. | Set red, and check it is red. |
| 9 | Segment fields appear as an `options` list or as `elementRange` plus `size`. | Reads both. If neither is usable, no segment control is offered. | Inspect the capability JSON. |
| 10 | Samples contain typos such as `reauired`, and the prefix `device.capabilities`. | Tolerates them, and sends the type exactly as Govee returned it. | |
| 11 | Examples write `Host: https://openapi.api.govee.com`. A Host header carries no scheme. | Treats that as the base URL. | |
| 12 | The page says an empty state value means "the instance does not support query". | Shows *Not reported*, and cannot confirm that setting. | Refresh state and compare with the capability list. |
| 13 | `online: false` means the status is "historical data and has no reference significance". | Marks values historical, shows the device as offline, and does not confirm commands from such a report. | Test with the lights unpowered. |
| 14 | No page says whether a new API key invalidates the old one. | Warns that it may. Not verified. | |
| 15 | No rate-limit response headers are documented. | Reads `Retry-After` and common `*-ratelimit-*` spellings if present. Nothing depends on them. | Look at real response headers. |
| 16 | The rate-limit table omits `device/diy-scenes`. | Applies the scenes limit to it. | |

## Rate limits

From Govee's table, read on 6 November 2026. These may change, so all are configurable.

| Endpoint | Documented | App default | Variable |
|---|---|---|---|
| Device list | 30 per minute, per account | 20 per minute | `GOVEE_LIMIT_LIST_PER_MINUTE` |
| Control | 12 per second per account (burst 80) | 8 per second | `GOVEE_LIMIT_CONTROL_ACCOUNT_PER_SECOND` |
| Control | 2 per second per device (burst 6) | 1 per second | `GOVEE_LIMIT_CONTROL_DEVICE_PER_SECOND` |
| State | 30 per minute per device | 20 per minute | `GOVEE_LIMIT_STATE_PER_MINUTE` |
| Scenes | 30 per minute per device | 10 per minute | `GOVEE_LIMIT_SCENES_PER_MINUTE` |

The app also keeps its own daily budget, `GOVEE_DAILY_REQUEST_BUDGET`, default 8000 requests. The current documentation states no daily limit, but other Govee documentation has described different limits over time, so this is a safety net. The count is held in memory and resets at 00:00 UTC or on restart.

A 429 from Govee pauses all traffic for the time it asks, or for one second if it does not say. The event is recorded in Activity.

## Capability handling

| Govee instance | App control |
|---|---|
| `powerSwitch` | Power |
| `brightness` | Brightness slider |
| `colorRgb` | Colour picker |
| `colorTemperatureK` | Temperature slider, using this device's own range |
| `segmentedColorRgb` | Segment colour |
| `segmentedBrightness` | Segment brightness |
| `lightScene`, `diyScene`, `snapshot` | Scene list |
| Anything else, such as `musicMode` and toggles | Listed read-only under Capabilities |

A capability with unreadable metadata is listed read-only rather than offered with guessed limits.

## Discovery behaviour

The device list is requested only when you ask, and then at most once every `DISCOVERY_REFRESH_HOURS` (default 24) once you have run it for the first time. Ordinary page loads never call it.
