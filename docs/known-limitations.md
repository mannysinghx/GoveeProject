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
- **One cell is one segment.** An H805C reports 27. The Govee app paints individual bulbs, and the public API does not offer that.
- **Patterns change gradually.** Each color is a separate command, at about one a second per light with the default rate limit. A gradient across 27 segments takes about 27 seconds.
- **No read-back.** Govee does not report segment colors, so the app cannot show what the lights are displaying.
- **Lights change independently.** Sending to a group does not keep them in step.

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
