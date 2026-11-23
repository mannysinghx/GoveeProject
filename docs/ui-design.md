# The interface: how it looks and why

The interface is called **Lumen**. It was redesigned on 22 November 2026; the original is saved ([how](ui-snapshots/README.md)). Only the web app (`apps/web`) changed in code; the docs and README were updated to match. No server code, API, database table or setting was touched.

## The idea

A light controller should feel lit by the lights. So:

- **The glow behind the app follows your lights.** When Govee has reported a colour for lights that are on, the screen is washed with that colour; red lights, a red glow. With nothing to follow it is a steady warm tone. It fades over about two seconds and never moves otherwise. In Settings, Appearance, it can be set to steady warm or switched off.
- **Lights are drawn as light.** A light string is a row of glowing beads: hollow when off, dim when dim, breathing softly when live. The dashboard shows every light as one long string. A preset is the row of colours it paints, with a soft glow of them underneath.
- **Everything else stays quiet**, so colour is the loudest thing on the screen. Quiet surfaces, one warm accent, large rounded shapes.

The look is the same on every screen size, and the layout changes to suit the hand and the screen that is using it.

## What it adapts to

| | |
|---|---|
| Phone | Looked at by hand down to 320 px wide, in one browser (Chromium), and a test guards one cause of sideways overflow; not yet seen on a real phone, so the safe-area handling is by design, not observed. A floating glass dock with Home, Scenes, Groups, Timers and More. More opens a sheet with the rest, the theme choice and Sign out. Forms and dialogs rise from the bottom as sheets, where a thumb is. Safe areas are respected (notch, home bar, landscape). |
| Tablet / small laptop | A slim sidebar of icons with a caption under each, so a finger or the keyboard can see what each place is, and the search bar. |
| Computer | A full sidebar with names, and the search bar that opens the command palette. |
| Big monitor or TV | Nearly everything is sized in `rem`, so at 1920 px wide and above, and again at 2560 px, the whole interface grows. |
| Keyboard | Ctrl+K, or Command+K on a Mac, opens the command palette from anywhere. It jumps to a page, applies a scene (with the same confirmation as everywhere else) or runs an action; arrow keys, Home, End and Enter. There is deliberately no single-key shortcut such as `/`: a key that cannot be turned off catches people using speech input or a switch (WCAG 2.1.4). Every control is also an ordinary button or link, so nothing depends on the palette. |
| Touch | Main controls are 44 px tall (compact ones 36 px), there is no double-tap zoom delay, and cards do not lift on hover on devices that cannot hover. |
| Day and night | **Auto** (follows the device), **Day** or **Night**, from the top bar, More, the palette or Settings. Applied before the first paint, so there is no flash. |
| Reduced motion | Animation drops to nothing, including the slider thumb's press. |
| More contrast, forced colours | With more contrast asked for, borders strengthen in both themes. In forced colours, selected and current states (including More, when you are on one of its pages) get an outline that a focus outline still beats, fields keep a visible focus outline, and anything painted with an inline colour, such as a swatch or a bead, keeps it. |
| Screen readers | Once a page has loaded, one `h1` and no skipped heading levels, labelled groups and buttons, accessible names that contain the words you see on the places in the menu, the search bar and the buttons that start a scene ("Home", "Timers", "Show it now"), a tab title that names each page (the dashboard's is the app's name, and it goes back to what it was when you sign out), unread notifications marked "New" in words, decorative pictures hidden, and every picture of light beside words that say the same thing. A dialog gives focus back to the control that opened it. |

## Colour

Tokens are CSS variables in `apps/web/src/styles/index.css`, defined once for Night and once for Day, and exposed to Tailwind as semantic names. Use these, never a hex value in a component:

| Token | For |
|---|---|
| `canvas`, `surface`, `raised`, `inset` | The page, a card, a raised control or hovered row, a well or field inside a card |
| `fg`, `fg-2`, `fg-3`, `fg-4` | Text, strongest to quietest |
| `line`, `line-strong` | Hairlines, borders |
| `field-line` | The edge of a text field, select or colour box: 3:1 on every surface, tested |
| `accent`, `accent-text`, `accent-ui`, `accent-wash`, `on-accent` | The warm brand colour as a fill, as text, as a control or focus ring, as a tint, and the text on a fill |
| `good`, `warn`, `bad`, `info` (and `-wash`) | Status. Always with an icon or words |

**Contrast is tested, not hoped for.** `src/styles/theme-contrast.test.ts` reads the real stylesheet and checks the colour tokens in both themes: text on every surface at 4.5:1, text on the primary button across its whole gradient, status colours on their washes, the `accent-ui` colour that focus rings, sliders and the ring or border that marks a selected state are drawn in at 3:1 on every surface, and the edge of a text field (`--field-line`) at 3:1. It checks the tokens, not each component, and it cannot see a colour with transparency laid over another, so selected states use the full-strength `accent-ui` ring, not a faint one. A palette change that fails it cannot ship.

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
4. Tests find things by role and name, not by class. A few look for a class on purpose: `.card` (a card found by its heading), `.ambient` (the glow layer) and `.bead` (a string's beads); the pattern editor's tests use `data-led` and `data-cell` attributes.
5. Every `grid` needs a base column (`grid-cols-1` or another `grid-cols-N`), or one wide child can push the page sideways on a 320 px phone. `src/layout-guards.test.ts` reads the source and fails if one is missing.

## Set the mood

A card at the top of Scenes & Presets (`features/ai/MoodBox.tsx`). It is a small chat: your words on the right as a bubble, the reply below as an inset card, newest first, so the answer is always under the box. The reply shows the title and a sentence on why it fits, a bead strip per light with its brightness, the three checks (each with a tick or a warning and its notes), and what happened to the lights. A look that is not clean, or any look while Preview first is on, shows why it is waiting and a **Set my lights** button. **Try another take** asks again with the same words, and **Save as preset** asks for a name first, so a clash with an existing preset is a message and not a loss. If AI is not set up the card is replaced by a note that links to Settings, and the card is left out when there are no lights. Pure helpers (when to apply at once, how the checks read, the preset description) are in `features/ai/mood-model.ts` with their own tests. How it works on the server: [ai-features-plan.md](ai-features-plan.md), feature 7.

## What it does not do

- The glow follows a light's reported or accepted colour or its colour temperature, and a warm white for a light that is on but reports neither. Govee does not report segment colours, so after a painted pattern the glow follows only what the app can know, and the lights themselves are the truth. This is the same honesty as the rest of the app: nothing here claims more than Govee said.
- The installed iPhone web app uses the system's status bar (`apple-mobile-web-app-status-bar-style=default`), so the clock stays readable in both themes. This has not been checked on a real iPhone.
- The theme and glow choices are per browser. They are not saved to the account.
- No fonts are downloaded. The interface uses each platform's own typeface (San Francisco, Segoe UI, Roboto), with the rounded variant for headings where the platform has one, because the security policy allows nothing from outside this site.
