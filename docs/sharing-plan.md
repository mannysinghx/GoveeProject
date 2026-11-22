# Sharing designs between accounts

Asked on 22 November 2026: share the owner's lights and schedules with every user, let people import them into their own space independently of the owner's, let users share their own creations too, and give everyone a Shared space in the menu.

Nothing here is built yet.

## Decisions (owner, 22 November 2026)

| # | Question | Decision |
|---|---|---|
| D1 | What "sharing lights" means | **Copies of designs.** Presets and patterns, groups and schedules are copied into the importer's account and pointed at *their* lights. A Govee key controls only its own Govee account's lights, so nobody gets control of anyone else's lights, and nothing done to the original ever touches a copy |
| D2 | Moderation | **Live, owner can hide.** Shared items appear for everyone at once. The owner sees everything shared, can hide or remove any item, and can stop a person sharing. Each member has a cap on shared items |
| D3 | Who made it | **A display name** each person chooses the first time they share. Email addresses never appear |
| D4 | Import onto different lights | **Match, then confirm.** The app suggests which of the importer's lights each design goes to (by model and segment count); they confirm or change it. Imported schedules start switched off |

## What exists today, and why import needs mapping

- Each person has their own account file with their own lights, groups, presets and schedules (`docs/architecture.md`, "Platform and accounts"). Nothing is shared between files.
- A preset is a list of actions. Each action names a light by its id in that account (`PresetActionDto.deviceId`), or none, meaning "pick a light when applying".
- Patterns are `segmentColor` actions: colours on segment numbers. The owner's H805C strings expose 27 segments; someone else's lights may have more or fewer.
- Scenes are `scene` actions with Govee's scene key. Govee's own scenes depend on the light's model; DIY scenes and snapshots belong to one Govee account and do not exist anywhere else.
- A schedule targets one light or one group by id, and runs either power on/off or a preset by id. Sunrise and sunset use the account's own location and time zone.
- Groups are a name and a list of light ids.

So a shared item cannot carry ids. It carries **light slots** instead, and import fills each slot with one of the importer's lights.

## How it works

### Sharing

- **What can be shared:** a preset (including patterns), a group, a schedule, or a bundle of these. A schedule brings the preset and group it uses. Built-in presets and holiday shows are not shared, because everyone already has them.
- **A share is a snapshot.** The server copies the item at that moment into a self-contained bundle, stored in the control database (`shared_items`), not in anyone's account file. Editing or deleting the original later changes nothing that was shared or imported. "Update share" publishes a new snapshot, and "Stop sharing" removes it from the Shared space. Copies already imported stay.
- **What a bundle holds:** names and descriptions, actions, recurrence and timing, and one slot per light used. A slot holds the light's model (SKU), segment count and a label. **It never holds** light ids, Govee device ids, the original light names (they can say "Bob's bedroom"), the sharer's location, time zone, email or account id. Slot labels default to "Light 1 (H805C)", and the sharer can rename them while sharing.
- **The owner's shares** show as "Light Manager", the official section. The owner can share everything in one step ("Share all my lights and schedules") and choose items to leave out.
- **Members' shares** show under their display name. Caps: 25 shared items per member, names up to 80 characters, descriptions up to 500, no links in text (a URL is refused when sharing). The owner has no cap.

### The Shared space

- A new **Shared** item in everyone's menu. Sections: "Light Manager" (the owner's) first, then "Community". Each card shows a colour preview for patterns, a summary for schedules ("Daily at sunset, Diwali show"), the slots it needs ("2 lights, H805C"), who shared it and when.
- Search and filter by kind (pattern or preset, schedule, group), with a "Mine" tab for what you have shared.
- **"Import everything from Light Manager"** in one step: all the owner's shared items, with one shared matching step for their slots.

### Importing

1. Pick an item, several, or everything from Light Manager.
2. **Match:** the app suggests one of your lights for each slot: same model first, then the same segment count, then any light with colour. You can change each choice, or leave a slot as "pick a light when applying".
3. **Fit:** a pattern made for 27 segments on a light with a different number is scaled to fit. Each of your segments takes the colour at the same relative position. A Govee scene is copied only if your matched light lists the same scene. Otherwise that step is marked "choose a scene" and you pick one. DIY scenes and snapshots are never copied.
4. **Create:** new presets, groups and schedules in your own account, marked "Imported from Light Manager" (or the sharer's display name). They count against your caps (50 groups, 200 presets, 200 schedules). Imported schedules are **switched off** and use your own time zone and location. The import says if it would go over a cap and imports nothing in that case.
5. From then on they are yours. Change or delete them freely. Importing the same item again makes a second copy, and the item says you already imported it.

### Moderation (owner only)

- In Settings, "Shared items": everything shared, newest first, with Hide, Remove and "Stop this person sharing".
- Hidden and removed items leave the Shared space at once. Copies already imported stay with the people who imported them.
- Display names: the owner can reset an unsuitable one. Names are unique, 3 to 30 characters, letters, numbers, spaces and simple punctuation.

### Privacy, deletion, export

- Deleting an account removes that person's shared items from the Shared space. Copies other people imported stay, because they are theirs. The privacy page will say so.
- "Download my data" includes what you shared.
- The privacy page lists what a share makes public: the item, its slot labels, and your display name.

### Safety

- Import never trusts a stored bundle: it is checked against the same rules as a new preset, group or schedule, size-limited, and refused whole if any part fails.
- A share is read only from the sharer's own account, and an import writes only to the importer's own account. The two-person test is extended to the new routes.
- Imported schedules start off, so importing alone can never change anyone's lights.
- Shared text is shown as plain text, never as HTML.

## Phases

| Phase | What | Done when |
|---|---|---|
| S1 | Server: display names; bundle builder (ids replaced by slots, nothing private); `shared_items` in the control database with a migration; share, update, stop sharing, list, owner moderation; caps | Tests prove a bundle holds no ids, names, location or email; member caps; owner hide and remove; the two-person test covers the new routes |
| S2 | Server: import with matching suggestions, segment scaling, the scene rules, schedules off, caps checked before anything is written, "imported from" marks | Tests for each matching rule, scaling 27 to 20 and to 54 segments, a scene missing on the target model, a DIY scene, a cap that would be exceeded (nothing written), and importing everything from the owner |
| S3 | Web: Shared page in the menu, share buttons on presets, groups and schedules, the import and match step, "Import everything from Light Manager", owner moderation in Settings, the display name prompt | Component tests, and a real browser walk-through on a local build: the owner shares everything, a member imports onto lights of a different model, nothing runs until they switch a schedule on |
| S4 | Privacy page and docs, mutation checks, local CI, one push for your approval | As before |

Rough size: similar to Phase 5. S1 and S2 are mostly server work and tests, S3 the pages.

## Not included, unless asked

- Live links, where an import follows the original's later changes (D1 chose independent copies).
- Likes, comments, reports from members, or ranking.
- Sharing to one person only.
- Sharing Govee DIY scenes (they exist only in the sharer's Govee account).
