# YT Waypoints

Save your place in YouTube videos and return to it later. Open YT Waypoints
while watching a video to add it, then use the popup to scrub, play or pause,
switch between saved videos, and search your collection. Available for Firefox,
Chrome, and Brave.

## Start using Waypoints

These features work with the default settings; no setup in Settings is needed.

### Add a waypoint

Open a YouTube video, then click the YT Waypoints toolbar icon or press
**Command+Shift+Y on macOS**, **Ctrl+Shift+Y elsewhere**. Exit video fullscreen
before opening the popup.

Opening the popup automatically bookmarks a new video at its current position.
While a bookmarked video plays, its saved position updates every 5 seconds,
including the progress shown while the popup is open. You do not need to keep
the popup open for your position to be saved.

A video you previously removed is not automatically added again. Use
**Add bookmark** or **Restore bookmark** to bring it back.

### Scrub, play, and pause

Use **Up / Down** to select a saved video in the popup.

- **Space** plays or pauses the selected video when it is open in a YouTube tab.
- **Left / Right** moves 10 seconds backward or forward.
- **Shift + Left / Right** moves 30 seconds backward or forward.
- Hover over a row's progress bar to reveal its handle, then drag it to preview
  a time and release to seek. You can also click the track.

Scrubbing keeps the popup open and preserves the video's playing/paused state.
If the video is closed, scrubbing changes its saved resume point without opening
it. Videos without a known duration do not show a progress slider.

### Switch between saved videos

Click a row, or select it and press **Enter**, to open the video. Waypoints
switches to an existing tab for that video when available, or opens it at the saved position.

### Search your collection

Press **/** to focus search, then type part of a video title or channel name.
Search ignores case and filters your saved videos. Use Up / Down to move through
the results, then Enter to open one.

Thumbnails and available channel names appear alongside video titles by default.

## More things you can do

### Paste a YouTube link

Copy a YouTube video link, open the popup, and press **Command+V on macOS** or
**Ctrl+V elsewhere**. You do not need to focus search or press Enter. Waypoints
switches to an existing tab or opens the video, then closes the popup.

A timestamp in the link is honored. Without one, an open video keeps its current
position; a closed bookmarked video resumes at its saved position, and a new
video starts at the beginning. Standard watch links, `youtu.be`, Shorts, live,
and embed video links are accepted. Tracking and playlist parameters are removed.

Pasting ordinary text searches your collection. If opening a link fails, the
link stays in search and an error is shown.

### Copy a link or transcript

Select a row and press **u** to copy its clean YouTube URL, including the saved
position.

Press **Shift+T** to copy the selected video's transcript. The video must be
open in a YouTube tab and have an available transcript. The default output is
**Markdown with linked timestamps**, including the video title and source URL.
You can also select a video, open **Settings (gear)**, and click **Copy transcript**.

### Markers and annotations (development build)

Select a saved video row. Marker controls are keyboard driven:

- **m** toggles a marker at the live playback position, or the saved position
  for a closed video. A marker within two seconds is removed instead of creating
  a duplicate. Removing a marker also deletes its annotation.
- **[** / **]** navigate previous/next markers without wrapping. Playing/paused
  state is preserved; a closed video's saved resume point changes. Navigation
  requires a known duration.
- **a** adds or edits the current marker's annotation. Without a current marker,
  it uses **0:00**, even when markers exist elsewhere. Adding a marker or
  navigating to one establishes the current marker for this popup.
- **M** shows/hides marker lines. Hidden markers and notes stay stored and are
  included in JSON exports. Visibility is also available in Settings.

Markers are thin vertical lines over the existing timeline, green for personal
markers and blue for chapter markers. There are no extra marker buttons, lists,
restoration controls, or additional row height. The lines leave slider dragging
and clicking alone.

A single annotation editor expands directly beneath its bookmark row when
requested, using the same 500ms easing as Help and Settings. The list scrolls
as needed to keep the source row and editor actions visible. Notes load on demand;
closing clears the editor. Background updates preserve the active draft and text
selection until you save or cancel. **Ctrl/⌘+Enter** or **Save**
saves the note; **Cancel** discards the draft. **a** reopens the existing note
instead of creating another. Notes preserve line breaks and are plain text.
Removing a marker clears its note and personal label; creating another marker
there does not restore the deleted annotation. A removal identity remains to
prevent delayed edits or chapter refreshes from recreating it.

Current selection resets when the popup closes or the bookmark lifetime changes.
Chapter loading reads supported chapter models from open YouTube watch tabs
when the popup opens, retrying every five seconds while it remains open. Chapters
become blue markers. Navigate with **[** / **]**, then press **a**: the chapter
title is the default annotation. Your edited or explicitly cleared note overrides
that default and survives source-title refreshes. Missing/unsupported chapter
models leave saved markers intact and do not block personal markers. Closed
videos retain chapters previously saved or imported.

### Remove a waypoint and restore it

Click **×** on a row or select it and press **Delete / Backspace**. By default,
the bookmark moves to hidden trash for **7 days** before permanent deletion.
The header's **Restore bookmark** button restores the most recently trashed
bookmark. To find and restore other trash, enable its display in Settings.

### Back up or transfer saved videos

1. Open **Settings (gear) → Backup & files → Copy JSON**, or press **Shift+C**.
2. Paste the copy into a text editor and save it as a `.json` file for a backup.
3. To restore or transfer it, paste the complete JSON into a Waypoints popup,
   including in another browser. The popup stays open and reports the result.

The copy includes all current bookmarks, even those hidden by search. Trash and
preferences are excluded. Import merges bookmarks without removing videos
absent from the copy. For a matching video, the imported saved position takes
precedence and is applied to matching open players too.

Press lowercase **c** on a selected row to copy only that bookmark as JSON.
See the [transfer reference](docs/behavior-reference.md#bookmark-transfer-and-validation)
for accepted formats and validation rules.

## Customize with Settings

Open **Settings (gear)** for six expandable groups, all visible at first:
**Appearance**, **Bookmarks & search**, **Playback & keyboard**, **Trash & deletion**,
**Transcripts**, and **Backup & files**. Each heading summarizes its current settings.
Groups open independently and start collapsed each time you reopen Settings.

Use Up/Down on a group heading to move between groups, Enter/Space to toggle,
and Tab to reach its controls. Arrow keys inside controls retain their usual
behavior. Changes save locally and automatically. Like Help, Settings has a fixed
frame and scrolls internally without resizing, including transcript previews.

### Choose automatic or manual bookmarking

**Auto-bookmark** is on by default: opening the popup on a new video saves it.
Turn it off to choose when to use **Add bookmark** instead. The change applies
next time you open the popup.

### Adjust playback controls

**Arrow-key scrub** changes the Left / Right distance from its default of
**10 seconds** to any value from 1–60 seconds. **Shift multiplier** changes the
Shift distance from its default of **×3** to a multiplier from 1–10.

### Change the list and search

- **Show thumbnails (t)** is on by default. Turn it off to hide images, or press
  lowercase **t** outside search to toggle the same preference.
- **Include channel names in search** is on by default. Turn it off for title-only
  matching. Available channel names still appear beneath titles.

### Manage trash and deletion

**Show trash in the list and search** is off by default. Turn it on to include
trash alongside current bookmarks. Trash rows have a red tint, a “Trash” label,
and a **Restore** checkbox.

**Permanently delete trash after** defaults to **7 days** and accepts 1–365 days.
Changing it also affects existing trash. Cleanup happens while the extension is
active; if it is inactive at the deadline, cleanup waits until the next active
check. **Empty trash** permanently removes all trash immediately.

**Deletion mode → Permanent: delete now** makes × and Delete remove a bookmark
immediately, with no Undo. The default is **Timed: move to trash**. Deleting a
visible trash row also permanently removes it.

### Choose a transcript format

**Transcript format** controls both copying and optional file saving:

| Format | Best use | File |
| --- | --- | --- |
| Markdown with linked timestamps (default) | Notes with links back to each moment | `.md` |
| Markdown with bold timestamps | Notes in the style of Obsidian Web Clipper | `.md` |
| Plain text with timestamps | Text editors, email, and clipboard use | `.txt` |
| Plain text without timestamps | Continuous reading and text processing | `.txt` |
| SRT subtitles | Subtitle editors and video players | `.srt` |
| WebVTT subtitles | Web video captions and browser players | `.vtt` |
| JSON with timed segments | Scripts, indexing, and structured processing | `.json` |

Open the dropdown and hover over a choice to preview its explanation and example.
The explanation and example appear below the choices within the panel.
With the keyboard, use arrows to preview and Enter or Space to choose. Previewing
alone does not change the saved format.

### Enable file-save offers

**Offer to save to file** is off by default. Turn it on to receive an **Also save
to file?** prompt after successfully copying a transcript or all bookmarks as
JSON. Choose **Yes**, adjust the filename if needed, then **Save file**.

Copying happens first. Declining the offer, cancelling, or a save failure leaves
the clipboard copy intact. Single-row JSON and URL copies do not trigger it.
The browser's download settings decide whether you are asked for a destination.

### Choose an appearance

**Theme** defaults to **System**, following your device's light or dark
appearance. Choose **Light** or **Dark** to keep a fixed appearance.

## Keyboard reference

The toolbar runs left to right: search, Settings (gear), Help (**?**), and
About (the YT Waypoints icon). Help opens the keyboard reference; About shows
the version and product information. Each icon has a tooltip and accessible label.

Press **h** or **?** outside search, or click **h / ? toggle help**, to open the
compact shortcut list. Use **Up/Down** or **Tab** to focus a row, then **Enter**
or **Space** (or click) to expand/collapse its explanation. Multiple rows can
stay open. Opening and closing ease over half a second (500ms); expanded rows use the selected
row background. Reduced-motion settings skip the animation. The help popup and
dialog keep fixed heights, with reserved scrollbar space and internal scrolling
as needed. Use **h**, **?**, or Close to dismiss help. Expanding a row does not
run its shortcut.

| Key | Action |
| --- | --- |
| Left / Right | Scrub by the configured distance |
| Shift + Left / Right | Apply the configured multiplier |
| `,` / `.` | Previous / next frame; pauses automatically (video must be open) |
| `<` / `>` (Shift + comma / period) | Decrease / increase playback speed (video must be open) |
| Space | Play / pause the selected video |
| Delete / Backspace | Remove the selected row |
| Enter | Open the selected video |
| Up / Down | Move between rows and search |
| `/` | Search |
| `t` | Toggle thumbnails |
| `T` (Shift + t) | Copy the selected video's transcript in your chosen format (video must be open) |
| `m` | Toggle a marker at the live or saved position |
| `a` | Add/edit the current annotation, or the video-start note at 0:00 |
| `M` | Show / hide marker lines |
| `Ctrl/⌘ + Enter` | Save the open annotation |
| `[` / `]` | Previous / next marker |
| `u` | Copy the selected video's clean URL, including its saved position |
| `c` | Copy just the selected row in the standard JSON transfer envelope |
| `C` (Shift + c) | Copy all saved videos as JSON, including filtered-out rows |
| `*` | Toggle Settings outside text fields |
| `h` / `?` | Toggle help |

Letter shortcuts leave search typing and Command/Ctrl/Alt combinations alone.
Single-row copy commands require a focused row; Shift+C also works in Settings.
The in-popup help shows your configured scrub distance and multiplier.

## Privacy and limitations

Bookmarks and preferences stay in this browser. There is no account,
developer-operated server, analytics, or automatic browser-to-browser sync.
Thumbnails load from YouTube's image server. Clipboard text is read only when
you paste; copy commands run when you request them. See [PRIVACY.md](PRIVACY.md).

- Play/pause, frame stepping, speed changes, and transcript copying require an
  open video. Scrubbing can also adjust a closed video's saved position.
- Transcript copying depends on YouTube providing a complete supported response.
  You may need to open **Show transcript** on YouTube first. Incomplete or
  unsupported responses produce an error rather than copying partial text.
- Some newer transcript panels provide start times without cue ends. Use
  Markdown, plain text, or JSON for those videos; SRT and WebVTT are unavailable.
- Firefox reserves Escape to close the entire toolbar popup, including when
  help or a dropdown is open. Use **h**, **?**, or Close to dismiss only help.
  See [Mozilla bug 1443758](https://bugzilla.mozilla.org/show_bug.cgi?id=1443758).
- Reload the extension and existing YouTube tabs after upgrading. Before
  downgrading, use **Copy JSON** for a backup; older builds cannot read the new
  storage format. Uninstalling the extension can lose its local data.

See the [behavior and technical reference](docs/behavior-reference.md) for
playback details, transcript extraction, import validation, and storage handling.

## Development

### Source and build outputs

Markers and annotations use independently versioned storage fields and are
included in single-row and all-row JSON transfers. Exports containing them use
transfer version 2; bookmark-only exports stay at version 1. Older JSON imports
preserve existing local marker data. Keep a current JSON backup before
downgrading, as older versions cannot preserve the new data.

The popup is assembled from focused scripts imported by `src/entries/popup.js`
and built with WXT/Vite. `popup.html` loads the early theme script and the
popup bundle:

| File in `src/shared/` | Responsibility |
| --- | --- |
| `popup.js` | Startup, module wiring, shared action queue, header state, and storage refresh |
| `player-client.js` | Tab navigation and validated injected requests, including Firefox fallback |
| `popup-refresh.mjs` | Orders and coalesces popup reads so stale snapshots cannot replace newer views |
| `youtube-values.js` | Pure video-ID and channel-URL validation shared by extension-side consumers |
| `settings-policy.js` | Immutable Settings defaults/ranges shared by controls, normalization and trash retention |
| `display-time.js` | Shared ordinary position-clock formatting; subtitle milliseconds remain separate |
| `popup-dom.js` | Bounded summary navigation, surviving focus return and dialog-dismissal bindings |
| `popup-settings.js` | Settings normalization, captured field changes, persistence, cached form bindings and shared previews |
| `popup-disclosures.js` | Shared reversible disclosure motion for Settings and Help |
| `popup-bookmarks.js` | Bookmark/import/trash actions and lifetime-bound playback-position saves |
| `popup-exports.js` | Transcript format UI, copying, clipboard fallback, and optional file saving |
| `popup-list.js` | Filtering, grouped sorting, rows, sliders, and focus restoration |
| `popup-annotation-editor.js` | Single on-demand form, immutable draft sessions, motion/scrolling, errors and focus lifecycle |
| `popup-markers.js` | Marker selection/commands, chapter refresh, timeline overlays and guarded annotation persistence |
| `chapter-reader.js` | Self-contained read-only extraction from video-bound YouTube chapter models |
| `popup-input.js` | Keyboard and paste routing, modal guards, and native editing behavior |
| `popup-dialogs.js` | Help/About lifecycle and focus return |

Each module receives its collaborators and state readers from the coordinator.
Private interaction state, such as an active drag or pending transcript, stays
inside its owning module. Bookmark snapshots remain tied to the lifetime read
before a player request. Injected functions remain self-contained in `player.js`,
`metadata.js`, and `transcript-reader.js`; `player-results.js` validates their
results before bookmark writes. The existing storage, transfer, transcript
serialization, and theme modules retain their separate roles.

```text
src/
  shared/                 edit features here once for both browsers
  firefox/                Firefox manifest and shortcut help
  chrome/                 Chrome manifest and shortcut help
src/entrypoints/          WXT popup HTML, content, and early-theme entrypoints
src/entries/              popup ES-import dependency wiring
wxt.config.mjs             WXT/Vite settings and browser manifest selection
scripts/build-wxt.mjs      staged production build using the WXT API
scripts/build.py           bundles, copies static files, and creates store ZIPs
yt-waypoints-firefox/     generated, loadable Firefox extension
yt-waypoints-chrome/      generated, loadable Chrome/Brave extension
artifacts/                 generated store ZIPs and reviewer source ZIP
```

The two familiar extension directories are now **generated outputs**, not
independent source trees. Their paths stay the same so an existing unpacked
Chrome/Brave installation can be reloaded in place. Do not edit generated files:
the next build replaces them. Browser-local bookmarks and settings are not part
of the source tree and are not modified by a build. Keep your existing browser
installation; uninstalling/reinstalling can lose its local data.

### Build

Requires Python 3.9+, Node.js 22.12+, and npm 9+. Install the pinned WXT/Vite
development dependencies first. [BUILDING.md](BUILDING.md) contains reviewer
instructions, the validated environment, and reproducibility details.

```sh
npm ci
python3 scripts/build.py          # both browsers
python3 scripts/build.py firefox  # just Firefox
python3 scripts/build.py chrome   # just Chrome/Brave
```

Equivalent shortcuts: `npm run build`, `npm run build:firefox`, and
`npm run build:chrome`. The version in `package.json` is applied to both
manifests. Increase it before submitting an update, then build again.

WXT/Vite creates readable, unminified popup, content-script, and early-theme
bundles with local source maps containing the original sources. The appropriate
browser adapter is included in each popup bundle. Static assets are copied,
the manifest version is filled in, and a ZIP is created with `manifest.json`
at its root. The reviewer-source ZIP includes original code, the lockfile, and
exact build instructions; submit it separately alongside the Firefox package.
Building after `npm ci` needs no network.

### Develop with Vite

```sh
npm run dev           # Chrome
npm run dev:firefox   # Firefox
```

WXT serves development pages through Vite and rebuilds content scripts as files
change. Browser auto-launch is disabled to keep existing profiles untouched.
Load the generated `.output/chrome-mv3-dev/` or `.output/firefox-mv3-dev/` in a
separate development profile. These outputs include development tooling and are
not store packages. WXT adds a development-only reload background and localhost
access; production packages exclude these. Production build commands above preserve the established
loadable folder paths. Both browsers use Manifest V3.

### Load locally

After building, reload the extension and existing YouTube tabs.

- Firefox: `about:debugging` → This Firefox → Load Temporary Add-on →
  `yt-waypoints-firefox/manifest.json`. For an existing installation, use Reload.
- Chrome: `chrome://extensions` → Developer mode → Load unpacked →
  `yt-waypoints-chrome/`. For an existing installation at that path, use Reload.
- Brave: the same steps at `brave://extensions` with the Chrome directory.

Both production builds use the browser’s normal toolbar popup and action shortcut, with
no background handler or service worker. Firefox uses the extension
ID `yt-waypoints@local`. Keep this ID stable for future releases.

The launch shortcut is **Open YT Waypoints menu**. Defaults:

- All browsers: Ctrl+Shift+Y (Command+Shift+Y on macOS).

Chrome does not permit Ctrl+Alt or Command+Option shortcut suggestions. The build
checks for these restrictions. If upgrading from the fullscreen experiment, your old custom
shortcut may need reassigning to this ordinary popup action.

- Chrome: `chrome://extensions/shortcuts`
- Brave: `brave://extensions/shortcuts`
- Firefox: `about:addons` → gear → Manage Extension Shortcuts

### Test

```sh
npm test
```

This builds both flavors, runs popup interaction tests against each built
package, exercises independent contexts against shared asynchronous storage,
and checks packaging and reproducibility. The manifests and ZIPs are
also checked for the absence of fullscreen/background/worker files. Tests use
mock browser/DOM objects; live acceptance testing remains necessary. Local store-submission notes, when present, contain the checks and upload steps.

An optional real-DOM keyboard regression runs against each built adapter in
headless Chrome/Chromium, using disposable fixture storage and an isolated
profile:

```sh
node tests/keyboard-browser.cjs chrome
node tests/keyboard-browser.cjs firefox
```

Set `WAYPOINTS_CHROME_BINARY` if the browser executable is not in a standard
location. This checks 32 real DOM keyboard cases per adapter, including help focus,
independent disclosures, animation/reduced motion, fixed geometry, and markers,
annotation editing, selection/focus, and capture/target propagation; the Firefox argument
selects the Firefox adapter, not the Firefox browser engine. It does not replace
native installed-extension testing on YouTube. It is separate from `npm test`
so the standard suite does not require a browser installation.

### Backups

The full shared-source version with fullscreen support is preserved in
`backups/before-removing-fullscreen-20261102-130420/`, with file hashes. Earlier
pre-refactor and fullscreen/delete backups remain intact. Backups never enter
build ZIPs. The historical fullscreen notes and rollback utility are archived
there rather than included in the current project or packages.

### Icon artwork

Both browser builds use the same PNG artwork from `src/shared/icons/`, exported
at 16, 32, 48, 96, and 128 pixels. The original transparent image and exact
generation prompt are preserved under `assets/`. The image was generated with
the built-in image-generation tool, then resized for browser icons.

### License

YT Waypoints is licensed under the [Apache License, Version 2.0](LICENSE).
The license is included in both extension packages and the reviewer source ZIP.
