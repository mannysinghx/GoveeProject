# Known limitations

## Not yet verified

- **No one has confirmed yet that real lights respond correctly.** Discovery, status and power commands to a group have worked against the real Govee service, as far as Govee's responses show. Segment, colour and scene commands have not been sent to real lights. See the [acceptance checklist](acceptance-checklist.md) and [what the real service has shown](govee-integration.md#what-the-real-service-has-shown).
- **DIY scene activation** is the least certain feature. The documentation shows no control example and gives three different capability types.

## Limits of the Govee cloud API

- An accepted request does not prove a physical change, and the API does not report every setting. Some commands can never show as confirmed.
- Control depends on internet access and on Govee's service being available.
- Smooth, fast animation is not possible, because of rate limits and cloud latency.
- Scenes and features in the Govee app may not be exposed. Commands to several lights arrive one after another, not in sync.
- The API can activate, but not create or edit, DIY scenes.

## Limits of patterns

- **Static only.** Clockwise, Twinkle, Breathe and similar effects run inside the lights, and the public API cannot send them.
- **One box is one LED, but LEDs can only change in groups.** An H805C reports 27 segments, so its 108 LED boxes change 4 at a time. **Colouring every LED separately is not possible through Govee's API.** Its segment command takes only a list of segment numbers ("see govee app"), and the lights report 27 segments and nothing finer (checked in Govee's documentation on 10 November 2026, and against what the lights report). The Govee app may offer finer control, and the public API does not. Govee's separate LAN control might, but it is unconfirmed for this model, and a server on Railway cannot reach lights in your home.
- **Repeat carries on onward by default.** It copies the painted sequence in the same order from where the pattern ends, to the end of the last string, and leaves the boxes before it alone. "Both ways" fills backwards as well. Blank boxes inside the pattern repeat as blanks.
- **The LED count is calculated, not reported.** It comes from published specs for the model, and only the H805C is listed so far. Other models show one box per segment until you enter a count. See [LEDs per string](govee-integration.md#leds-per-string).
- **Patterns change gradually.** Each color is a separate command, at about one a second per light with the default rate limit. A gradient across three strings of 27 segments takes about 27 seconds, with the strings changing at the same time.
- **No read-back.** Govee does not report segment or LED colors, so the app can't read what the lights are displaying or detect an LED that missed a command. **Check my lights** relies on you looking at them. See [Reading each LED](govee-integration.md#reading-each-led).
- **Some LEDs may stay white.** The cause isn't confirmed on real lights yet. See [When LEDs stay white](govee-integration.md#when-leds-stay-white).
- **Lights change independently.** Strings shown in series are still separate lights, so they do not change in step.
- **Scheduling a pattern across strings** needs a target that includes them all, such as a group in this app. With a smaller target, the other strings' steps are skipped and reported.
- **The string order is what you set.** The API does not say how lights are physically arranged. The first guess uses "left", "center" and "right" in their names.

## Limits of this version

- **Schedules run in the app, not on the lights.** They do not run while the app is stopped, or when the internet or Govee is unavailable.
- **One owner account.** No additional users or roles.
- **One app instance per database.** Queues and rate limits are held in memory.
- **Serverless hosts do not fit.** The app needs an always-on process and a persistent disk, so platforms such as Vercel cannot run it as built. [Railway](deploy-railway.md) can.
- **The rate-limit counters reset on restart,** including the daily budget. Govee's own limits do not.
- **Commands waiting in the queue are lost on shutdown.** They are recorded as interrupted and are not resent.
- **The API key is changed in `.env`,** with a restart. There is no screen for it.
- **Secrets are not encrypted at rest.** See [Security](security.md#known-limitations).
- **Scene names and segment counts** reflect the last discovery or refresh, so they can be out of date until you refresh.
- **A device re-added in the Govee app** may get a new identifier and appear as a new device. Presets tied to the old one will not follow it.
- **Presets tied to a device** cannot be moved to another device in one step. Edit their steps instead.

## Limits of festival presets and the fireworks

- **Govee decides how a moving effect looks.** The app can only start one. It cannot change its colors, speed or length.
- **The fireworks are not a timed show.** Each string gets its commands separately, about one a second, so they start about 3 seconds after midnight and are not synchronized with each other.
- **The server's clock and the default time zone decide "midnight".** The show uses the default time zone set when it was installed. If you change that setting later, change the schedule too.
- **Other schedules still run.** A nightly "turn off" still runs on New Year's Eve, and the show turns the lights back on at midnight.
- **Festival dates are not automatic.** Only the fireworks run by themselves. Other festival presets run when you apply or schedule them.

## Limits of the month and heritage presets

- **They are only presets.** Nothing schedules them. Apply one from Scenes & Presets, or make a schedule that uses it.
- **Most have no official colors.** They are suggestions from flags, ribbons and common custom, and sources differ. Childhood-cancer gold, for example, is listed for different months in different places, so it is not included.
- **Black is a dark segment.** Black History Month, Progress Pride and Kwanzaa include black, which stays unlit and leaves a gap in the pattern. That has not been tried on real lights.
- **Moving dates are for you to choose.** Lunar New Year, Holi, Eid and Hanukkah follow lunar or Hebrew calendars, and the Winter Solstice shifts by a day between years. Their cards say roughly when they fall, and the app does not know the date.
- **Smooth looks are steps.** The wave presets (Aurora, Cherry Blossom, Sunset, Winter Solstice) use 5 to 7 colors, because every color is a separate command.

## Limits of the holiday calendar

- **Your own schedules still run.** A daily "turn on" and "apply pattern" show your usual pattern until the holiday starts, and a nightly "turn off" still runs, including during New Year's Eve.
- **Diwali's date is one calendar's, for Los Angeles.** It is not a fact from Govee or a government, and it ends at 2037.
- **Many holidays have no official colors.** Those are suggestions. Duplicate a preset and point the schedule at your copy to change one.
- **Effects are not blended with patterns.** A string shows either fixed colors or an effect, so Diwali takes turns rather than combining them.
- **New holidays need an app update.** The list is built in, though you can add your own schedule for any date.
- **Holiday dates cannot be edited.** They are worked out for each year. To use another date, skip that year's show and add a one-time schedule.
- **Steps stay on one date.** A show cannot cross midnight, so to end after midnight, turn off its end time and add a schedule of your own.
- **Your changes apply every year,** not just to the next date.

## Limits of notifications

- **Real phone delivery has not been tested.** It was checked up to the point of handing a correctly signed, encrypted message to the push library. It depends on Apple, Google or Mozilla's push service and your phone.
- **iPhones need the app on the Home Screen,** on iOS 16.4 or later. Notification buttons may not appear there; tap the notification to answer in the app.
- **Web Push uses your browser maker's push service.** It needs no account, and the content is encrypted, but the service does see that a message was sent to your device, and when. If that service is down, the app still shows the notification.
- **A notification appears when sending finishes,** a few seconds after a run starts, so it can report what really happened.
- **Skip must arrive before the show starts.** Answering after that records the answer but cannot undo what has run.

## Limits of Ask and Describe

- **Answers can be wrong.** They come from small, low-cost models. Each answer links to the records it used, so check those before acting on it.
- **Not tested against the real providers yet.** The request format follows each provider's documentation, and the tests use a stand-in. The first real questions will confirm the model names and settings, especially GLM's.
- **Data leaves the server.** See [AI](security.md#ai) for what is sent and where.
- **Drafts are suggestions.** Describe fills the pattern or schedule editor, and you check it there. A model can misread a description, so look at the pattern and the "next runs" list before you Send or Save.
- **Patterns are still, and made of whole segments.** Describe cannot make movement, and several LEDs share each segment, so "every fourth LED" becomes the nearest whole-segment version.
- **A schedule draft is one schedule.** "On at sunset, off at 11" needs two schedules. The draft makes the first and says so in its note.
- **No photo option yet.** "Use colours from a photo" is not built.
- **It only reads.** Ask cannot change lights, schedules or settings, and cannot see anything the app has not recorded, such as changes made in the Govee Home app.
- **Costs are estimates.** They use each provider's listed paid price, and DeepSeek's peak rate, so the real bill should be the same or lower.

## Limits of connection monitoring

- **It diagnoses and retries. It does not repair.** Govee's public API has no restart, Wi-Fi or firmware commands, and a hosted server cannot reach your home network.
- **Causes are likely, not certain.** They come from comparing which lights respond.
- **There are no email or text alerts.** Problems appear under Notifications, and on your phone if you turn that on.
- **Delay.** A drop can take a couple of minutes to appear, and a shorter drop between checks can go unnoticed.
- **Accepted is not confirmed.** A resent pattern is reported as accepted by Govee, which does not report segment colors.
- **Catching up restores segment colors, not everything.** Only what the app tried to send while the light was offline is kept, and only the newest for each light. Changes made in the Govee Home app are not known to it.

## Features not implemented, and why

| Feature | Why |
|---|---|
| LAN control | Optional for version 1. H805C support is unconfirmed, and the protocol needs physical testing first. The transport interface leaves room for it. See [Architecture](architecture.md#future-lan-control). |
| Music mode and toggle capabilities | Outside this version's scope. They are listed read-only under Capabilities when reported. |
| Device event subscriptions | Not needed for lighting control. Govee documents them on a separate page, which was not used. |
| Creating or editing Govee DIY scenes | The public API does not offer this. The pattern editor saves app presets instead. |
| Moving pattern effects | Would need a stream of cloud commands, which rate limits make slow and uneven. |
| Entering the API key in the browser | The brief prefers an environment variable for version 1. If added later, the key must be encrypted at rest with a key held outside the database. |
| Multi-replica operation | Needs shared queue and rate-limit state. Not needed for a single home. |
| Automatic HTTPS | Left to a reverse proxy you control, so the app does not depend on any particular service. |
| Playwright end-to-end tests | Optional in the brief. Backend flows are covered through Fastify injection and a real local HTTP mock, and the UI through React Testing Library. Every screen was also checked by hand in a real browser against the production build. No end-to-end suite runs in CI. |
