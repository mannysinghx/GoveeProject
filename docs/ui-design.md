# The interface: how it looks and why

The interface is called **Lumen**. It was redesigned on 22 November 2026; the original is saved ([how](ui-snapshots/README.md)). Only `apps/web` changed. No server code, API, database table or setting was touched.

## The idea

A light controller should feel lit by the lights. So:

- **The glow behind the app follows your lights.** When Govee has reported a colour for lights that are on, the screen is washed with that colour; red lights, a red glow. With nothing to follow it is a steady warm tone. It fades over about two seconds and never moves otherwise. In Settings, Appearance, it can be set to steady warm or switched off.
- **Lights are drawn as light.** A light string is a row of glowing beads: hollow when off, dim when dim, breathing softly when live. The dashboard shows every light as one long string. A preset is the row of colours it paints, with a soft glow of them underneath.
- **Everything else stays quiet**, so colour is the loudest thing on the screen. Quiet surfaces, one warm accent, large rounded shapes.

The look is the same on every screen size, and the layout changes to suit the hand and the screen that is using it.

## What it adapts to

| | |
|---|---|
| Phone | A floating glass dock with Home, Scenes, Groups, Timers and More. More opens a sheet with the rest, the theme choice and Sign out. Forms and dialogs rise from the bottom as sheets, where a thumb is. Safe areas are respected (notch, home bar, landscape). |
| Tablet / small laptop | A slim rail of icons with tooltips. |
| Computer | A full rail with names, and a search bar that opens the command palette. |
| Big monitor or TV | Everything is sized in `rem`, so above 1920 px wide and again above 2560 px the whole interface grows. |
| Keyboard | Ctrl+K or Command+K opens the palette from anywhere; `/` opens it when no field has focus. It jumps to a page, applies a scene (with the same confirmation as everywhere else) or runs an action. Arrow keys, Home, End, Enter. Every control is also an ordinary button or link, so nothing depends on it. |
| Touch | Main controls are 44 px tall (compact ones 36 px), there is no double-tap zoom delay, and cards do not lift on hover on devices that cannot hover. |
| Day and night | **Auto** (follows the device), **Day** or **Night**, from the top bar, More, the palette or Settings. Applied before the first paint, so there is no flash. |
| Reduced motion | All animation drops to nothing. |
| More contrast, forced colours | Borders strengthen; shapes keep their outlines. |
| Screen readers | One `h1` per page, labelled groups and buttons, the tab title names the page, decorative pictures are hidden, and every picture of light sits beside words that say the same thing. |

## Colour

Tokens are CSS variables in `apps/web/src/styles/index.css`, defined once for Night and once for Day, and exposed to Tailwind as semantic names. Use these, never a hex value in a component:

| Token | For |
|---|---|
| `canvas`, `surface`, `raised`, `inset` | The page, a card, a raised control or hovered row, a well or field inside a card |
| `fg`, `fg-2`, `fg-3`, `fg-4` | Text, strongest to quietest |
| `line`, `line-strong` | Hairlines, borders |
| `accent`, `accent-text`, `accent-ui`, `accent-wash`, `on-accent` | The warm brand colour as a fill, as text, as a control or focus ring, as a tint, and the text on a fill |
| `good`, `warn`, `bad`, `info` (and `-wash`) | Status. Always with an icon or words |

**Contrast is tested, not hoped for.** `src/styles/theme-contrast.test.ts` reads the real stylesheet and checks every pairing in both themes: text on every surface at 4.5:1, text on the primary button across its whole gradient, status colours on their washes, focus rings and selected states at 3:1 on every surface. Change a colour and the test says whether it still reads.

## Building blocks

| Where | What |
|---|---|
| `components/ui.tsx` | `Button`, `Segmented`, `Card`, `SectionCard`, `PageHeader`, `Badge`, `Notice`, `Loading`, `EmptyState`, `Field`, `Dialog` (a sheet on phones), `Detail`. Same props as before the redesign, so every page picked up the new look. |
| `components/light.tsx` | `LightStrip`, `HouseStrip`, `Spectrum`, `OnlineRing`, and the helpers behind them: what a light is showing (`lookOfDevice`) and the colours for the glow (`glowColors`). |
| `components/Ambient.tsx` | The glow layer. |
| `components/CommandPalette.tsx` | The palette. |
| `app/AppShell.tsx`, `app/nav.ts` | Rail, top bar, dock, More sheet. `nav.ts` is the one list of places; the rail, the dock, the sheet and the palette all read it. |
| `components/AuthLayout.tsx` | The frame for sign-in, setup, sign-up and the pages email links open. |
| `lib/theme.ts`, `lib/preference-store.ts` | Theme and glow choices, kept in this browser only (`glm.theme`, `glm.glow`), with storage failures handled. |
| `public/theme-init.js` | Sets the theme before the first paint. It is a file of its own because the server's content security policy allows scripts from this site only. Keep its storage key and colours in step with `lib/theme.ts`. |

## Adding or changing a page

1. Start with `PageHeader` for the one `h1`, then `SectionCard`, `Card` or `tile` surfaces. Do not invent colours, radii or shadows.
2. Draw colour with `Spectrum` and lights with `LightStrip`, and say the same thing in words next to them.
3. Anything that opens over the page is a `Dialog`. It becomes a sheet on phones for free.
4. Tests find things by role and name, not by class. The one place a test uses a class (`.card`, for a card found by its heading) is deliberate.

## What it does not do

- The glow follows a light's reported or accepted colour, or its colour temperature. Govee does not report segment colours, so after a painted pattern the glow follows only what the app can know, and the lights themselves are the truth. This is the same honesty as the rest of the app: nothing here claims more than Govee said.
- The theme and glow choices are per browser. They are not saved to the account.
- No fonts are downloaded. The interface uses each platform's own typeface (San Francisco, Segoe UI, Roboto), with the rounded variant for headings where the platform has one, because the security policy allows nothing from outside this site.
