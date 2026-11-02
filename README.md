# YT Waypoints

Local YouTube bookmarks and saved playback positions for Firefox, Chrome, and
Brave. Both browser flavors now use the same popup, search, keyboard controls,
options, delete/restore behavior, and autosave. While a bookmarked video plays,
its saved position and open-popup progress update every 5 seconds. Fullscreen controls are currently
disabled; exit video fullscreen before opening the popup.
There is no account, developer-operated server, analytics, or automatic browser-to-browser sync.

Optional thumbnails appear at the start of each bookmark row. They are on by
default. Press `t` outside search or use **Options → Show thumbnails (t)** to
change the same saved preference. Typing `t` in search continues to enter text.
The checkbox and `t` toggle directly, with no additional permission request or
confirmation screen. A note in Options explains that thumbnail images load from
YouTube's image server; see PRIVACY.md.

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
