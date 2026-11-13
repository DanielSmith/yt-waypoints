# Reproduce the extension packages

Build from this directory, including when unpacking the reviewer-source ZIP.
The source archive includes original JavaScript, WXT/Vite configuration, tests,
assets, package.json, and package-lock.json. Do not upload this source archive
as the installable extension; supply it separately to AMO for code review.

## Environment

- Python 3.9 or newer (standard library only).
- Node.js 22.12 or newer and npm with lockfile v3 support (npm 9 or newer).
- WXT **0.21.5** and Vite **7.3.1**, pinned exactly with transitive dependencies
  in package-lock.json.
- Validation environment: macOS 15.8, Node v26.13.1, npm 11.20.0,
  Python 3.14.7. macOS, Linux, and Windows are supported build environments;
  cross-OS byte identity has not been independently verified.

## Exact commands

```sh
npm ci
python3 scripts/build.py
```

`npm ci` installs the locked build dependencies and platform binaries, then runs
`wxt prepare` to generate local framework metadata.
Use a fresh `npm ci` on each OS; do not copy node_modules between platforms.
Do not use `--ignore-scripts` or `--omit=dev`: the build tools are development
dependencies and their native binaries require installation checks. Once installed, building needs no network.
No application dependency is fetched or executed remotely by the extension.

Optional single-browser builds and verification:

```sh
python3 scripts/build.py firefox
python3 scripts/build.py chrome
npm test
```

`npm run build`, `npm run build:firefox`, and `npm run build:chrome` invoke those
same Python commands. Tests rebuild both browsers and rebuild all three ZIPs
from an extracted reviewer-source archive, using a fresh offline `npm ci`.
The npm cache populated by the initial install must remain available for that
offline reproducibility check. A cache failure is an environment failure, not
permission to skip comparison.

## Outputs and transformations

`scripts/build.py` invokes `scripts/build-wxt.mjs` (the WXT build API) in a
staging directory, validates the result, and replaces the existing loadable
folder only after success. Python retains the deterministic packaging step.

- `wxt.config.mjs` sets Manifest V3 for both browsers, reads the existing browser
  manifest defaults, chooses the platform adapter, disables auto-imports and
  browser auto-launch, and configures readable production output/source maps.
- `src/entrypoints/popup.html` is the WXT popup, importing the dependency wiring
  in `src/entries/popup.js`. Vite emits a local module under `chunks/`.
- `src/entrypoints/content.js` registers the YouTube-only autosaver through WXT.
  Its classic bundle lives in `content-scripts/`. WXT invalidation cleans up
  intervals and listeners when a content script is replaced.
- `src/entrypoints/theme.js` emits the classic `theme.js`, executed in the popup
  head before CSS. The popup coordinator continues using the same theme API.

Existing factory APIs and dependency injection remain intact. Output targets
Firefox 115 / Chrome 110 with minification disabled. Injected page functions must
remain self-contained after serialization. Each bundle has a linked local
source map containing original source contents. A conservative 5,000,000-byte
per-JavaScript-file guard runs before replacing a loadable folder. Neither
production manifest adds permissions, host access, or a background worker.

CSS/icons are copied unchanged, HTML is processed by Vite, manifests receive the
package.json version, and ZIP entries have stable ordering, timestamps, and
permissions. No build timestamp, absolute workspace path, or environment version
is embedded in the packages. Source map paths are relative and deterministic.

For version `2.3.0`, the outputs are:

```text
yt-waypoints-firefox/                 loadable Firefox extension
yt-waypoints-chrome/                  loadable Chrome/Brave extension
artifacts/yt-waypoints-firefox-2.3.0.zip
artifacts/yt-waypoints-chrome-2.3.0.zip
artifacts/yt-waypoints-source-2.3.0.zip  original sources for reviewers
```

Tests compare rebuilt ZIP bytes with the originals, including source maps and
the reviewer-source archive. They also verify that a failed bundle or manifest
validation leaves the previously loadable extension intact. Preserve installed
extension identities, output paths, and real browser data; reload existing
installations and YouTube tabs after a successful build.

## Vite development

```sh
npm run dev
npm run dev:firefox
```

WXT serves popup pages with Vite and watches/rebuilds extension scripts. Browser
auto-launch is disabled. Load `.output/chrome-mv3-dev/` or
`.output/firefox-mv3-dev/` manually in a separate development profile. Development
outputs contain dev-server/reload tooling, a reload background, and localhost
access. These are excluded from production. Never submit development outputs.
Production builds above retain the existing `yt-waypoints-*` install paths.
Do not run concurrent builds against the same checkout; WXT's `.wxt` metadata
is shared. The Python all-browser build runs targets sequentially.
