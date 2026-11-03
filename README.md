# YT Waypoints

Local YouTube bookmarks and saved playback positions for Firefox, Chrome, and
Brave, with search across video titles and channel names. While a bookmarked
video plays, its saved position and open-popup progress
update every 5 seconds. There is no account, developer-operated server,
analytics, or automatic browser-to-browser sync.

## Using Waypoints

Open the popup using its toolbar icon or **Command+Shift+Y on macOS**,
**Ctrl+Shift+Y elsewhere**. Exit video fullscreen before opening the popup.

### Upcoming in 2.0.4: keyboard shortcuts and help

Version 2.0.3 remains the submitted store release. These additions are in the
local 2.0.4 build and have not been submitted to either store.

The compact hint shows search, play, open, and **h / ? toggle help**. Click **h / ? toggle help** or
press `?` or `h` outside search for the complete shortcut table. Close it with
the same keys, Close, or a click outside the table; focus returns to
the previously selected row or control.

Firefox reserves Escape to close the entire toolbar popup, even while help is
open; use `h`, `?`, or Close to dismiss only help. Chromium handles Escape within
help. See [Mozilla bug 1443758](https://bugzilla.mozilla.org/show_bug.cgi?id=1443758).

| Key | Action |
| --- | --- |
| Left / Right, or comma / period (`<` / `>` keys) | Scrub by the configured distance |
| Shift + a scrub key | Apply the configured multiplier |
| Space | Play / pause the selected video |
| Delete / Backspace | Remove the selected row |
| Enter | Open the selected video |
| Up / Down | Move between rows and search |
| `/` | Search |
| `t` | Toggle thumbnails |
| `u` | Copy the selected video's clean URL, including its saved position |
| `c` | Copy just the selected row in the standard JSON transfer envelope |
| `C` (Shift + c) | Copy all saved videos as JSON, including filtered-out rows |
| `h` / `?` | Toggle help |

The help table displays your current scrub distance and multiplier. On keyboards
where Shift produces `<` and `>`, those shifted keys apply the multiplier; use
unshifted comma and period for an ordinary step. The arrow keys still work.
Letter shortcuts leave search typing and Command/Ctrl/Alt combinations alone.
Row copy commands require a focused row; uppercase `C` also works in Options.
Copying uses the existing clipboard handling without additional permissions.

### Paste a YouTube link

1. Copy a YouTube video link.
2. Open the Waypoints popup.
3. Press **Command+V on macOS** or **Ctrl+V elsewhere**.

**You do not need to focus the search field or press Enter.** Paste works when
a bookmark row, the Add bookmark button, or Options has focus. Waypoints reveals
search, switches to an existing tab for the video or opens it, clears search
after successful navigation, and closes the popup.

- A timestamp in the pasted link is honored.
- Without a timestamp, an already open video keeps its current position. A
  closed bookmarked video resumes at its saved position; a new video starts at
  the beginning.
- Standard watch links, `youtu.be` links, and Shorts, live, and embed video links
  are accepted. Only recognized YouTube video URLs are opened. Navigation uses
  a clean HTTPS URL built from a validated video ID and optional time, dropping
  tracking and playlist parameters.
- Pasting ordinary text outside search focuses search and filters the list.
  Ordinary text pasted inside search keeps normal text editing behavior.
- If navigation fails, the pasted link stays in search and an error is shown.

Clipboard text is accessed only when you paste. No clipboard-reading permission
is requested.

### Copy, back up, and import videos

Version 2.0 adds manual JSON transfer between Firefox, Chrome, and Brave:

1. In the source browser, open **Show options** and scroll to **Export saved videos**
   at the bottom.
2. Click **Copy JSON**. The JSON is copied without being displayed in the panel;
   paste it into a text editor and save a `.json` file if you want a backup.
3. Open Waypoints in the other browser and paste the JSON anywhere in its popup.
   It merges the videos and reports how many were added, updated, or unchanged.

The export includes **all saved videos**, even when search filters the visible
list, with titles, playback positions, durations, timestamps, and available
channel metadata. Browser preferences are not exported or imported. This is a
manual copy/merge feature, not automatic synchronization.

Merge rules:

- New video IDs are added; videos absent from the import are never deleted.
- For matching IDs, **the pasted entry supplies the resume point**, even if
  the local browser has a newer autosave timestamp. Import explicitly chooses
  the source snapshot. Missing channel/title/duration metadata can be filled
  from the local entry.
- Import also moves matching open YouTube players to the imported position,
  preserving their playing/paused state. A local handoff marker lets a loading
  player apply the position before autosaving; an old playhead must not erase
  the imported point. Reload existing YouTube tabs when updating the extension.
- Reimporting identical data does not duplicate/change bookmarks, but requests
  that open players restore those same positions again.
- The entire import is validated before saving. Malformed or unsupported JSON
  and invalid video data leave existing bookmarks untouched. Imports are limited
  to 5 million characters. Copy all of the JSON, including its outer braces.

The popup stays open after import, clears search, and shows the merged list.
Pasted YouTube links still open videos, and ordinary pasted text still searches.
Waypoints accepts its own versioned export, a raw video map or array, and a
storage snapshot containing a `videos` object. Any `settings` in a snapshot are
ignored. The JSON `version` field identifies the transfer format, not the app
version.

Accepted video fields are strictly limited to `id`, `title`, `t`, `duration`,
`updated`, `channelName`, and `channelUrl`. Unknown fields are discarded during
parsing, merging, and export. Positions, durations, and timestamps must be
nonnegative safe integers; numeric strings, booleans, fractions, and nulls are
rejected. IDs must be valid 11-character YouTube IDs and match their map key.
Titles are limited to 1,000 characters, channel names to 200, and channel URLs
to 2,048. Text controls/whitespace are normalized, and all displayed text uses
text content rather than HTML. Channel URLs must resolve to a recognized HTTPS
YouTube channel path; credentials, foreign hosts, control characters, and
encoded path separators are rejected. Invalid known fields reject the entire
import before any storage change.

Copy runs only when you click **Copy JSON** or invoke a copy shortcut, and import uses your paste event;
no additional clipboard permissions are requested. A compatibility fallback uses
a temporary offscreen selection, which is removed immediately. If copying fails,
the popup shows an error; it never exposes a JSON editor in Options.

### Scrub a video

**Hover over a row's progress bar to reveal its handle, then drag it.** The row
previews the target time while you drag. Release to seek the open video or, if
the video is closed, update its saved resume point. Clicking the track also
seeks to that position.

Scrubbing keeps the popup open and does not open the video or change its
playing/paused state. Progress updates do not interrupt an active drag, and
cancelling a drag leaves the saved position unchanged. Videos without a known
duration do not show a progress slider.

| Control | Action |
| --- | --- |
| Drag the handle or click the track | Preview a position; seek/save on release |
| Left / Right arrow on a row or slider | Scrub by the configured distance, 10 seconds by default |
| Shift + Left / Right arrow | Apply the configured multiplier, ×3 by default |

Set the arrow-key distance and Shift multiplier in **Show options**.

### Search titles and channels

Press `/` to focus on the search input field. Search ignores case and matches against your saved **video titles or
channel names by default**. For example, searching for `Bloomberg` finds videos
from that channel even when “Bloomberg” is not in their titles.

Turn off **Show options → Include channel names in search** for title-only
matching. The setting persists between sessions. Channel names remain visible
beneath video titles when available, even with channel-name searching off.

Channel metadata is read from the video's owner information on the YouTube page
using existing permissions, without an API key or extra lookup request. New
bookmarks include `channelName` and `channelUrl` when available. Older bookmarks
are enriched while their videos play or when the popup opens on those videos.
Opening the popup to enrich a bookmark preserves its saved playback position
and update timestamp. Unavailable metadata leaves the known channel untouched.

### Thumbnails

Thumbnails appear at the start of each bookmark row and are on by default.
Press `t` outside search or use **Options → Show thumbnails (t)** to change the
same saved preference. Typing `t` in search continues to enter text. The checkbox
and `t` toggle directly, with no additional permission request or confirmation
screen. Thumbnails load from YouTube's image server; see [PRIVACY.md](PRIVACY.md).

The popup layout lives in `src/shared/popup.html`, with styles in the linked
`src/shared/popup.css`. Both browser builds share these files.

## Source and build outputs

```text
src/
  shared/                 edit features here once for both browsers
  firefox/                Firefox manifest and shortcut help
  chrome/                 Chrome manifest and shortcut help
scripts/build.py           copies files and creates store ZIPs
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

## Build

Requires Python 3.9+ (standard library only). Node.js 18+ is needed for tests,
not for creating the extension packages. There is no dependency installation.

```sh
python3 scripts/build.py          # both browsers
python3 scripts/build.py firefox  # just Firefox
python3 scripts/build.py chrome   # just Chrome/Brave
```

Equivalent shortcuts: `npm run build`, `npm run build:firefox`, and
`npm run build:chrome`. The version in `package.json` is applied to both
manifests. Increase it before submitting an update, then build again.

This is an assembly step: shared files are copied unchanged, the appropriate
browser-specific files are added, the manifest version is filled in, and a ZIP
is created with `manifest.json` at its root. There is no compilation,
minification, remote code, or generated source transformation beyond the
manifest's version field. Sources and build scripts run on macOS, Linux, or
Windows with Python. Initial validation was performed on macOS with Python 3.

## Load locally

After building, reload the extension and existing YouTube tabs.

- Firefox: `about:debugging` → This Firefox → Load Temporary Add-on →
  `yt-waypoints-firefox/manifest.json`. For an existing installation, use Reload.
- Chrome: `chrome://extensions` → Developer mode → Load unpacked →
  `yt-waypoints-chrome/`. For an existing installation at that path, use Reload.
- Brave: the same steps at `brave://extensions` with the Chrome directory.

Both builds use the browser’s normal toolbar popup and action shortcut, with
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

## Test

```sh
npm test
```

This builds both flavors, runs popup interaction tests against each built
package, and checks packaging and reproducibility. The manifests and ZIPs are
also checked for the absence of fullscreen/background/worker files. Tests use
mock browser/DOM objects; live acceptance testing remains necessary. Local store-submission notes, when present, contain the checks and upload steps.

## Backups

The full shared-source version with fullscreen support is preserved in
`backups/before-removing-fullscreen-20261102-130420/`, with file hashes. Earlier
pre-refactor and fullscreen/delete backups remain intact. Backups never enter
build ZIPs. The historical fullscreen notes and rollback utility are archived
there rather than included in the current project or packages.

## Icon artwork

Both browser builds use the same PNG artwork from `src/shared/icons/`, exported
at 16, 32, 48, 96, and 128 pixels. The original transparent image and exact
generation prompt are preserved under `assets/`. The image was generated with
the built-in image-generation tool, then resized for browser icons.

## License

YT Waypoints is licensed under the [Apache License, Version 2.0](LICENSE).
The license is included in both extension packages and the reviewer source ZIP.
