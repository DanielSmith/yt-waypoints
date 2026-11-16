# Creating a YT Waypoints theme

Choose **Settings (gear) → Appearance → Theme** to use System, Light, or Dark. The preference
is local to this browser and is not part of bookmark JSON transfers.

## Files and responsibilities

| File | Responsibility |
| --- | --- |
| `src/shared/theme.js` | Validated palette owner, startup/selection, unsaved preview/cancel, and System/storage updates |
| `src/shared/theme-library.mjs` | Bounded local library, serialized mutations, merge/restore and backup serialization |
| `src/shared/theme-data.mjs` | Portable theme/backup validation and bounds (3.0 development) |
| `src/shared/theme-readers.mjs` | Ghostty/iTerm color-only readers (3.0 development) |
| `src/shared/theme-convert.mjs` | Shared role mapping, derivation, contrast checks and reports (3.0 development) |
| `src/shared/themes/light.css` | Complete light palette and native `color-scheme` |
| `src/shared/themes/dark.css` | Complete dark palette and native `color-scheme` |
| `src/shared/styles/tokens.css` | Shared fonts, text sizes, radii, and popup/panel dimensions |
| `src/shared/popup.css` | Component layout, interaction states, and references to theme tokens |
| `src/entrypoints/popup.html` | Loads the initializer and stylesheets; declares the theme selector |

Edit `src/shared/`, then rebuild. The generated browser folders are replaced
by the build. No CSS framework or preprocessor is required.

## Shared dimensions and clearances

`styles/tokens.css` owns structural dimensions separately from palette colors:

- `--popup-frame-height` is 520px for Settings, Help and inline annotation editing.
  The Help dialog reserves `--dialog-viewport-clearance` (20px total), giving it
  a default 500px height with the existing viewport cap.
- `--popup-bottom-clearance` keeps 16px below list/Settings content, clear of the
  browser popup's bottom corners. Normal bookmark lists retain their 420px cap.
- `--annotation-control-clearance` reserves 6px around editor controls for full
  focus outlines. `--annotation-scroll-clearance` reserves a 4px scroll target.
- Annotation input height defaults to 80px, with 40px minimum and 160px maximum.
  JavaScript reads the input bounds and scroll-clearance tokens when fitting the
  source row and editor into the list viewport; keep those tokens as pixel values.

Change these defaults in the shared token file when the change should apply to
every theme. Theme-specific palette values remain in `themes/*.css`.

## Theme contract

A theme defines its colors under `:root[data-theme="THEME-ID"]`. The initializer
resolves System to `light` or `dark` and places that ID on the document root.
There are no duplicated light/dark palettes in media queries or JavaScript.
All UI palette values belong in these theme files, including status colors,
trash backgrounds/hover states, and marker colors (`--color-marker-chapter`
for blue chapter lines and `--color-marker-user` for green personal
lines). Both marker roles meet 4.5:1 contrast on list surfaces. Component CSS uses
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

## Saved themes in 3.0 development

The System/Light/Dark CSS palettes remain dependable startup/reset fallbacks.
Custom records are validated complete color maps, applied through the same roles
by the single owner in `theme.js`. They do not supply fonts, dimensions, CSS,
selectors or executable code. The existing Theme selector lists saved records;
file import/backup controls are a separate step and are not implemented yet.

The storage/application backend is available on `WAYPOINTS_THEME` for the future
import controller. It does not require editing CSS files or registering each ID:

- `ready`: finishes the initial combined library/preference read before popup
  Settings normalization. `choices` lists built-ins and validated saved themes;
  duplicate names are disambiguated with their full UUIDs.
- `save(theme, {select, conflict})` and `restore(backup, options)`: validate and
  save one record or an entire native backup. They never reconvert saved colors.
- `select(id)`: persist an existing custom or built-in choice. `apply(id)` remains
  an unsaved explicit application for existing consumers; `sync(id)` updates
  persisted-state rendering without discarding an active import preview.
- `preview(theme)` / `cancelPreview()`: apply validated unsaved colors without
  writing, then reload the latest persisted choice on cancellation. A later
  preview survives an older delayed save/select/reset completing.
- `remove(id)`: delete only that record, resetting a selected removed theme to
  System in the same storage set. `reset()`: select System without deleting user
  palettes, even when a malformed library needs recovery.
- `export(id)` / `export()`: compact single-theme / full-library native JSON,
  with exact resolved colors, source palette, converter revision and provenance.
- `subscribe(listener)`: update existing popup choices/selection after another
  context changes storage. It does not write bookmarks or fetch resources.

Library data is stored only under `waypoints.themes.v1`, as the normalized
schema-1 collection envelope. Selection remains in `settings.theme`, preserving
existing System/Light/Dark values; no migration write occurs on startup. The
library and selection are read together. Portable IDs never become storage keys.
Unknown/deleted IDs and unreadable/corrupt state recover to a usable System
palette without silently deleting user data. Mutations reject malformed libraries
rather than overwriting them; Reset can still recover the selection.

Restores merge whole records, preserve unrelated themes, and validate the entire
result before one `storage.local.set`. Identical ID/content is skipped. A
conflicting ID rejects the whole restore by default; explicit `conflict:
"replace"` replaces that record, or `"keep-both"` assigns a fresh UUID. Duplicate
names are allowed. Empty collections are no-op restores. Optional `select: true`
selects the last restored/reused record. Limits remain 100 themes, 32 KiB per
record and 1 MiB of compact UTF-8 collection data. Errors/quota failures propagate
without reporting a successful save or removing the previous local selection.

Library mutations use one Web Lock name across popups, with a fresh read inside
that lock, preventing concurrent collection saves from overwriting each other.
If Web Locks is unavailable, library mutations fail with a clear error rather
than using an unsafe cross-context fallback. Existing built-in Settings writes
still work using the previous context's serialized queue. Settings commits capture
field intent and merge with the latest settings under the same lock when
available, so an unrelated preference change cannot restore a stale theme ID.

`theme.js` validates the entire custom record before applying only allowlisted
`--color-*` values and native `color-scheme`. It clears all owned overrides before
applying another palette or returning to a built-in; component code cannot set
palette colors. Initial reads and asynchronous refreshes use revision guards.
These are backend/application capabilities; the end-user import/picker/backup
controls remain step 6.

## Verify a theme

Check the bookmark list (including focus, progress sliders, and Add bookmark),
Settings and native inputs, transcript format hover/focus previews, help, and
both stages of the optional file-save dialog. Check keyboard focus, disabled
controls, empty results, validation errors, and long titles in both browsers.

Automated tests scan every packaged UI stylesheet (including shared tokens),
inline HTML styles, presentation-color attributes, and JavaScript inline paint
setters for palette bypasses. They reject named colors, hex/functional colors,
literal color fallbacks, and non-palette aliases outside theme files. Only the
validated theme owner may write custom palette variables/color-scheme. They also
check the built-in role sets, text/button/control contrast,
selection persistence, System updates, storage failures, and startup races.
Native Firefox/Chrome checks remain useful for browser-specific control styling.

## Marker colors

`--color-marker-chapter` supplies blue chapter lines and
`--color-marker-user` supplies green personal lines in every theme.
Components reference these semantic roles; JavaScript sets positions, not colors.
Theme-specific shades retain the blue/green distinction and meet 4.5:1 contrast
against list/button surfaces. Both origins use thin vertical lines over the same timeline; there is no separate marker lane or list.
Annotating a chapter marker preserves its origin and blue presentation.

## 3.0 development: portable theme data, schema 1

This section defines the data contract for the 3.0 theming work. Terminal-file
readers, conversion, persistent custom themes and import/export UI are not wired
into the extension yet. Existing System/Light/Dark behavior below is unchanged.
The pure validators live in `src/shared/theme-data.mjs`; synthetic portable
fixtures are in `tests/fixtures/themes/`. Run `node tests/theme-data.cjs`.

Ghostty and XML iTerm files are input formats, not our stored theme format.
Readers will produce a normalized source palette. A converter will produce a
complete resolved theme, which can be backed up without losing derived colors.
No raw terminal configuration, arbitrary CSS, fonts or dimensions are stored.

### Portable envelopes

A single theme uses this envelope and suggested suffix `.waypoints-theme.json`:

```json
{
  "format": "yt-waypoints-theme",
  "version": 1,
  "theme": { "id": "theme:00000001-1111-4111-8111-111111111111", "...": "see record below" }
}
```

A collection uses `.waypoints-themes.json`:

```json
{
  "format": "yt-waypoints-themes",
  "version": 1,
  "themes": []
}
```

The single-theme example abbreviates the record and is not a valid import;
the fixture files contain complete valid examples. Empty collections are valid
backups, not instructions to erase a local library. Exactly one of `theme` or
`themes` is accepted, according to format. Only schema version 1 is supported.
Theme records inherit that schema from their containing backup/library envelope.
Bookmark-transfer envelopes and settings do not belong in these files.

### Normalized theme record

All five fields are required; unknown fields are rejected throughout the schema.

| Field | Contract |
| --- | --- |
| `id` | `theme:` followed by a lowercase UUID v4; an opaque identity, never a raw storage key. Existing built-in IDs `system`, `light`, `dark` are separate and cannot be supplied here |
| `name` | Nonblank text, maximum 80 UTF-16 code units; control characters rejected |
| `appearance` | `light` or `dark`; the native color-scheme, not a System preference |
| `colors` | Every current semantic role below, with the `--color-` prefix omitted; no extra roles |
| `source` | Source format, normalized original palette, converter revision and optional provenance |

The 25 required color roles are `surface`, `surface-raised`, `surface-hover`,
`text`, `text-muted`, `border`, `control-border`, `current-border`, `trash-border`,
`accent`, `accent-hover`, `on-accent`, `positive`, `positive-hover`, `on-positive`,
`checkbox`, `track`, `marker-chapter`, `marker-user`, `focus`, `selected`,
`trash-surface`, `trash-hover`, `danger`, `backdrop`.

All colors are sRGB `#RRGGBB` except `backdrop`, which requires `#RRGGBBAA`.
Hex digits accept either case and normalize to lowercase. No named colors,
functions, CSS variable references or declarations. Opacity is not supported on
other roles or normalized source colors in schema 1. Resolved colors are
authoritative: restoring a backup does not derive them again or silently migrate
them to a newer converter. Contrast/semantic hue acceptance is a separate
converter/application concern in later steps; structural validation alone does
not certify that a palette is readable.

`source` has required `format` (`ghostty`, `iterm` or `builtin`),
`converterVersion` (a positive safe-integer algorithm revision, independent of app
SemVer), and `palette`. Optional `name` retains the original source label (80
code units). A newer converter revision can be retained/restored without having
that converter installed, since the resolved colors are already present.

`source.palette` contains required opaque `background`, `foreground`, and
`palette` (a sparse object keyed by canonical decimal strings `0` through `255`).
The inner `palette` may be empty. Optional opaque fields are
`selectionBackground`, `selectionForeground`, `cursorColor`, `cursorText`,
`linkColor` and `boldColor`. The latter two retain useful iTerm source colors.
Missing palette slots stay absent; validators must not invent colors. Readers
must convert supported source color spaces to sRGB before creating this record,
or report an unsupported format. Nonopaque terminal colors require a deliberate
future policy; do not silently drop their alpha.

Optional `source.attribution` accepts `author`, `license` (160 code units each),
`notice` (4096 code units, with tabs/newlines permitted), and `url` (2048 code
units, HTTPS with no credentials or whitespace). Provenance is plain metadata,
not HTML, CSS or an instruction to fetch anything. Optional fields are omitted,
not null. Labels/notices retain their text rather than being silently rewritten.

### Limits, validation and future restore behavior

- Ghostty/iTerm input files: at most 256 KiB, checked before reading/parsing.
- One normalized record: at most 32 KiB of compact UTF-8 JSON.
- Collection: at most 100 themes, each with a distinct ID.
- Native backup input and serialized collection: at most 1 MiB. The future
  exporter should write compact JSON and check the actual downloaded bytes.
- Local saved library: at most 1 MiB using the same normalized collection
  envelope for size accounting. Storage/count enforcement belongs to step 5.
- File readers must enforce raw-byte limits before JSON/XML/text parsing;
  this step's object validators check normalized serialized sizes afterward.
- Validators return fresh normalized records without changing the input. They
  reject unsupported fields, object prototypes, accessors, hidden/symbol fields,
  sparse/extended arrays and duplicate IDs. No storage/DOM operation is performed.

Duplicate names are allowed; names are display labels, not identity. The later UI
must disambiguate duplicate labels, for example with a short ID. On restore into
an existing library, identical ID/content can be skipped; conflicting content for
an existing ID requires an explicit replace/keep-both choice. Keep-both assigns a
fresh local UUID. No automatic overwrite or merge of color fields. A collection
must validate in full before any mutation, and unrelated themes remain intact.
These restore behaviors are implemented by the theme-library backend; file
controls and user-facing conflict choices remain step 6.

### Conversion policy (revision 2)

Require background/foreground; they have no guessed input defaults. Preserve
source selection colors in the source metadata; use selection background as a
blend target when supplied, and derive the selected surface otherwise.
The starting accent candidate is a supplied link color, then palette slot 4,
then 12 if missing; absent
accent candidates fall back to the shared semantic blue seed. Red/green/blue status/marker candidates start with slots 1/2/4 and
their bright variants 9/10/12; actual hue and contrast must be checked. A purple
"blue" slot may be a usable accent but must not erase our chapter-blue distinction.
If needed, derive a status/marker shade from the built-in semantic hue and the
imported background. Never treat a palette index as a guarantee of hue.

`src/shared/theme-convert.mjs` implements the shared conversion policy. It does
not apply palettes, read/write storage, or regenerate saved themes. This is the
working policy for end-to-end integration; aesthetic refinements can follow.

- `deriveThemeColors(palette, {appearance: "auto"})` returns `appearance`, the
  complete 25-role `colors` map, and ephemeral `diagnostics`. Auto uses OKLab
  background lightness >= 0.65 for light, otherwise dark. Readers currently have
  no appearance metadata; callers may supply `light` or `dark` for known metadata
  or a deliberate override, including midtone palettes. No override UI is added
  at this stage. A conflicting recipe can still fail contrast validation.
- The original normalized source palette is preserved, including unused
  selection-foreground, cursor and bold colors. Surface keeps the exact source
  background. Foreground and all other mapped colors may change for contrast.
- Mix shades in OKLab. The recipe direction is `#141820` for light appearance,
  `#f5f6f8` for dark. Raised/hover surfaces mix 4%/8% toward that direction.
  Selected mixes 15% toward source selection-background or the recipe direction.
  Trash surface/hover mix 6%/10% toward the semantic red seed. Muted text starts
  at 70% corrected text plus 30% background; divider, control-border and track
  start at 25%, 50% and 20% corrected text against the surface.
- Red/green/blue seeds use OKLCH hues 25/150/255 degrees. Examine both the normal
  and bright source slot; accept chroma >= 0.04 and hue within 35 degrees.
  Otherwise synthesize lightness 0.65/chroma 0.13 at the semantic hue. Chapter
  and personal markers must retain their respective blue/green hue after repair
  (minimum resulting chroma 0.02), or conversion fails with the affected role.
- Accent uses source link color, slot 4, slot 12, then semantic blue; accent need
  not be blue. Positive actions and current-row/checkbox outlines use green.
  Focus uses the corrected accent. Button text starts from the higher-contrast
  of `#12151a` and `#fafbfc`. Backdrop is fixed `#10131880`.
- Contrast repair searches the nearest passing OKLab lightness in steps of
  1/512 (darker first on ties), preserving hue where possible. Out-of-sRGB colors
  reduce chroma at fixed lightness/hue using a bounded binary search; final
  contrast is measured on the quantized sRGB hex output. Neutral extremes are a
  last resort; semantic marker hue is separately checked afterward.
- Text, muted text, error text and markers meet 4.5:1 across base, raised, hover,
  selected and both trash surfaces. Focus/control/current/trash borders,
  checkboxes and base/hover actions meet 3:1 there. Button text meets 4.5:1 on
  base and hover actions. Markers and filled progress meet 3:1 against the track;
  repair the track if needed. Decorative dividers, tint differences, backdrop
  compositing and disabled opacity are not additional contrast guarantees.
- Hover starts 4% toward the recipe direction and must retain surface and
  button-text contrast. If no nearby shade works, retaining the base action
  color is allowed and reported. This aesthetic choice can be revisited later.
- `checkThemeContrast(colors)` checks a complete normalized map and returns
  `passed`, check count and role-pair failures. A derived palette must pass the
  final check. Failure errors identify the affected role/pair; no partial theme
  is returned.
- `convertTheme(source, name, filename, options)` returns `{theme, diagnostics}`;
  `createConvertedTheme(...)` is the convenience form returning only the portable
  theme. Diagnostics report classification, semantic sources/fallbacks and
  contrast-adjusted role/from/to values. They are not fields in schema-1 backups.

New converted records carry `source.converterVersion: 2`; backups remain schema 1.
Native restore retains saved colors and converter revision without deriving or
contrast-repairing them. Future conversion changes must increment the converter
revision; regeneration is explicit. Do not silently recolor existing records.
