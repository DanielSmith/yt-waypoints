# Creating a YT Waypoints theme

Choose **Show options → Theme** to use System, Light, or Dark. The preference
is local to this browser and is not part of bookmark JSON transfers.

## Files and responsibilities

| File | Responsibility |
| --- | --- |
| `src/shared/theme.js` | Theme IDs/labels, saved preference at startup, and System appearance changes |
| `src/shared/themes/light.css` | Complete light palette and native `color-scheme` |
| `src/shared/themes/dark.css` | Complete dark palette and native `color-scheme` |
| `src/shared/styles/tokens.css` | Shared fonts, text sizes, radii, and popup/panel dimensions |
| `src/shared/popup.css` | Component layout, interaction states, and references to theme tokens |
| `src/shared/popup.html` | Loads the initializer and stylesheets; declares the theme selector |

Edit `src/shared/`, then rebuild. The generated browser folders are replaced
by the build. No CSS framework or preprocessor is required.

## Theme contract

A theme defines its colors under `:root[data-theme="THEME-ID"]`. The initializer
resolves System to `light` or `dark` and places that ID on the document root.
There are no duplicated light/dark palettes in media queries or JavaScript.
All UI palette values belong in these theme files, including status colors,
trash backgrounds/hover states, and future marker colors. Component CSS uses
`--color-*` references. `transparent`, `inherit`, and `currentColor` are neutral
structural values, not additional palettes. Progress percentages and disabled
opacity are shared interaction values, not literal color definitions.

Copy either built-in theme as the starting point. Supply every color role:

| Roles | Used for |
| --- | --- |
| `--color-surface`, `--color-surface-raised`, `--color-surface-hover` | Main surface, secondary controls, and hover/preview surfaces |
| `--color-text`, `--color-text-muted` | Main labels and supporting text |
| `--color-border`, `--color-control-border` | Dividers and form-control boundaries |
| `--color-current-border`, `--color-trash-border` | Focus outlines: green for current bookmarks, red for trash; inactive rows use neutral dividers |
| `--color-accent`, `--color-accent-hover`, `--color-on-accent` | Primary actions and progress indicators; text on primary actions |
| `--color-positive`, `--color-positive-hover`, `--color-on-positive` | Add/restore bookmark actions and their text |
| `--color-checkbox` | Native checkbox accent |
| `--color-track` | Empty progress tracks and thumbnail placeholders |
| `--color-focus`, `--color-selected` | Keyboard focus outline and selected bookmark surface |
| `--color-trash-surface`, `--color-trash-hover` | Trash row background and hover tint |
| `--color-danger` | Filename validation/save errors |
| `--color-backdrop` | Translucent dialog backdrop |

Also set `color-scheme: light` or `color-scheme: dark` so browser-rendered
controls and scrollbars match the palette. Built-in palettes use OKLCH colors.

Use `--color-on-accent` and `--color-on-positive` rather than assuming button
text should always be white. Dark themes may need dark text on bright buttons.
Keep normal and muted text at least 4.5:1 against their surfaces, and focus
indicators/control boundaries at least 3:1 against the main surface.

## Add another theme

1. Copy `themes/light.css` or `themes/dark.css` to `themes/my-theme.css`.
2. Change its selector to `:root[data-theme="my-theme"]`, then edit its colors
   and choose the native `color-scheme`. Keep the complete role set.
3. Add a stylesheet link in `popup.html` alongside the two built-in palettes:

   ```html
   <link rel="stylesheet" href="themes/my-theme.css">
   ```

4. Add `{ id: "my-theme", label: "My theme" }` to `choices` in `theme.js`.
   Options populates its selector from this list; no popup-handler changes
   are needed. System continues to use the built-in light/dark themes.
5. Run `npm test`, then reload the extension. Select your theme in Options.
   Extend the palette/contrast checks in `tests/theme.cjs` to cover it.

For a color-only theme, component rules in `popup.css` need no changes. Themes
may also override shared variables such as `--font-ui`, `--radius-control`, or
`--popup-width`; keep the expanded transcript dropdown within browser popup
size limits. Change shared defaults in `styles/tokens.css` only when the change
should apply to every theme.

## Verify a theme

Check the bookmark list (including focus, progress sliders, and Add bookmark),
Options and native inputs, transcript format hover/focus previews, help, and
both stages of the optional file-save dialog. Check keyboard focus, disabled
controls, empty results, validation errors, and long titles in both browsers.

Automated tests scan every packaged UI stylesheet (including shared tokens),
inline HTML styles, presentation-color attributes, and JavaScript inline paint
setters for palette bypasses. They reject named colors, hex/functional colors,
literal color fallbacks, and non-palette aliases outside theme files. They also
check the built-in role sets, text/button/control contrast,
selection persistence, System updates, storage failures, and startup races.
Native Firefox/Chrome checks remain useful for browser-specific control styling.

## Planned marker colors

When markers are implemented, define chapter-marker blue and user-marker green
as separate semantic roles in every theme (for example,
`--color-marker-chapter` and `--color-marker-user`). Components must use those
roles rather than hard-coded blue/green values or JavaScript color setters.
Theme-specific shades may vary for contrast while retaining the confirmed
blue/green origin distinction. These roles are planned, not unused palette
tokens added ahead of the feature.
