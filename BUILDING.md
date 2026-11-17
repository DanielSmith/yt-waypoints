# Reproduce the extension packages

Build from this directory, including when unpacking the reviewer-source ZIP.
The source archive includes original JavaScript, WXT/Vite configuration, tests,
assets, package.json, and package-lock.json. Do not upload this source archive
as the installable extension; supply it separately to AMO for code review.

## Environment

- Python 3.9 or newer (standard library only).
- Node.js 22.12 or newer and npm with lockfile v3 support (npm 9 or newer).
- WXT **0.21.5** and Vite **7.3.8**, pinned exactly with transitive dependencies
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

## Test runner and source checks

`npm test` runs the complete build, dependency-free source checks, all existing
pure and adapter suites (Firefox then Chrome), and package/reviewer-source
reproducibility. The runner executes argument arrays without a shell, stops at the
first failure and preserves a nonzero child exit code. Builds remain sequential.

```sh
npm test
npm test -- --list
npm test -- --suite storage --flavor firefox
npm test -- --suite popup --suite player-results --flavor chrome --skip-build
node tests/run.cjs --suite packages
npm run check
```

Repeat `--suite` or `--flavor` to select several; without selectors, every default
suite runs. Unknown options/names fail before any commands execute. Adapter
selection filters adapter tests only: builds and package checks still cover both
outputs. Source-only suites need no build. Adapter/package suites rebuild both
packages unless `--skip-build` is explicitly supplied with fresh existing outputs.
The popup runner below still supports selecting an individual popup feature.

Real-DOM tests remain opt-in, preserving the previous default test scope:

```sh
node tests/run.cjs --suite keyboard-browser --flavor chrome --skip-build
```

`npm run check` uses only the existing Node/Python standard libraries. It parses
JavaScript with Node `--check`, Python with `ast.parse` (no bytecode/cache writes),
JSON with JSON.parse, and checks trailing whitespace/final newlines. It checks
source, scripts, tests, textual assets and shipped root configuration/docs;
generated packages, node_modules and private development notes are excluded.
It also runs within the default test command and works without Git.

These are syntax/whitespace checks, not semantic linting, type checking or CSS/HTML
validation. `.prettierrc.json` sets preferences, but no formatter/linter is pinned
in package.json or package-lock.json. A locally cached **Prettier 3.9.6** was used
manually on step 14's two new JavaScript files; that cache is not a reproducible
project tool. A future decision must explicitly pin a formatter/linter (and its
scope/configuration) or provide another versioned toolchain. This step adds no
package, performs no automatic download and claims no project-wide format/lint gate.

## Focused popup integration tests

Build the browser packages first. The popup runner loads the actual generated
bundle into independent fake browser/DOM contexts. These integration tests do
not establish native browser acceptance.

```sh
node tests/popup.cjs --list
node tests/popup.cjs firefox seeking
node tests/popup.cjs chrome exports transfer
node tests/popup.cjs firefox                 # all popup suites
node tests/popup.cjs chrome                  # all popup suites
```

With no suite names, the runner executes every registered suite in order. A
failure stops the run and identifies its adapter and suite. Unknown adapters or
suite names fail before running cases. `npm test` continues to run all popup
suites for both adapters, alongside the other existing tests and package checks.

| Suite             | Coverage                                                                            |
| ----------------- | ----------------------------------------------------------------------------------- |
| policy            | Defaults, ranges and initialized controls                                           |
| refresh           | Ordered/coalesced reads, external updates and recovery                              |
| markers           | Chapters, marker commands, annotation drafts and lifetime/session races             |
| appearance        | Themes and serialized bundled page actions                                          |
| navigation        | About, list/search focus, Settings transitions and auto-bookmarking                 |
| exports           | Playback shortcuts, transcript formats, clipboard-first file offers and URL cleanup |
| bookmarks         | Undo, thumbnails, paste navigation and channel metadata/search                      |
| seeking           | Saved/live seeks, slider commit/cancel and one-key/one-seek ownership               |
| transfer          | Row/global clipboard, Help isolation, strict import and cross-context round trips   |
| trash-settings    | Trash/expiry/purge, delayed settings writes, previews and failure recovery          |
| player-boundaries | Hostile/partial page results, delayed lifetimes and transcript completeness         |

`tests/popup/harness.cjs` owns fixture construction; each fixture creates fresh
storage data, document, browser API, listeners and VM. `seeds.cjs` supplies fresh
input objects. Related delayed actions stay within their feature suite; no live
fixture or mutable test state is handed from one suite to another.

## Real-DOM checks and previews

Build first, then run the separate Chrome-engine fixture. Both adapter names use
headless Chrome/Chromium with a fresh temporary profile, fake extension data and
the actual bundled popup. This does not establish native Firefox/Chrome/Brave
acceptance and does not use an installed extension's profile or bookmarks.

```sh
node tests/keyboard-browser.cjs chrome
node tests/keyboard-browser.cjs firefox
node tests/keyboard-browser.cjs chrome --preview-settings
node tests/keyboard-browser.cjs firefox --preview-editor --dark
node tests/keyboard-browser.cjs chrome --preview-help-expanded
```

Ordinary and preview commands run every feature check before preview staging.
They share a 500×650 layout viewport; the report records the actual content viewport
and checks that it fits the full 360×520 popup. Preview flags only select the final
screen and request a screenshot. Other flags: `--preview` (list),
`--preview-settings-expanded`, `--preview-settings-bookmarks`,
`--preview-settings-transcripts`, and `--preview-help`. `--dark` selects the dark
preview. `--preview-theme-import` shows an active theme draft (also accepts
`--dark`). Existing WAYPOINTS_MARKER_PREVIEW / WAYPOINTS_PREVIEW_THEME environment
settings remain available. Set WAYPOINTS_CHROME_BINARY to select the browser.

The command prints an evidence directory containing result.json, dom.html,
browser.stderr.log and the generated fixture. Previews also save popup.png.
Reports identify Chrome as the engine, the selected adapter, viewport and completed
feature counts. Failure reports identify the active stage. The temporary profile
is retained there for diagnosis; it is separate from user profiles.

`tests/keyboard/` separates setup, test helpers, nine feature files, preview staging,
fixture generation, options and browser launch/reporting. Normal command waits
finish editor animations explicitly; dedicated motion cases still sample 500ms
opening/closing, intermediate heights and reversal. Initialization/layout polling
and queue checks are bounded, and the browser process has a 45-second deadline.
The CDP runner waits in real time so native Web Lock delivery cannot be outrun
by a simulated clock. Current coverage is 62 cases, including custom palette
application, exact backup export, unsaved preview/cancel, selected-theme removal,
Settings focus-ring clearance,
compact annotation editing/previews,
reduced motion, native controls, focus,
scroll/outline geometry, modal cancellation and preserved annotation drafts. New
cases can update the feature expectations in cases.cjs without a fixed count cap.

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

CSS and PNG/SVG icon assets are copied unchanged. The settings gear is an external
SVG used as a CSS mask; its visible color comes from the existing theme token.
Both prefixed and standard mask rules support the configured browser targets.
HTML is processed by Vite, manifests receive the
package.json version, and ZIP entries have stable ordering, timestamps, and
permissions. No build timestamp, absolute workspace path, or environment version
is embedded in the packages. Source map paths are relative and deterministic.

For the current development version `3.0.0-alpha.1`, the outputs are:

```text
yt-waypoints-firefox/                 loadable Firefox extension
yt-waypoints-chrome/                  loadable Chrome/Brave extension
artifacts/yt-waypoints-firefox-3.0.0-alpha.1.zip
artifacts/yt-waypoints-chrome-3.0.0-alpha.1.zip
artifacts/yt-waypoints-source-3.0.0-alpha.1.zip  original sources for reviewers
```

`package.json` owns the full SemVer version. Archive names and About retain
`3.0.0-alpha.1`; WXT emits numeric `version: "3.0.0"` for both browser manifests
and `version_name: "3.0.0-alpha.1"` for Chrome. Firefox omits `version_name`.
About receives its label at build time so it shows the same alpha on both browsers.
The same configuration is used by production builds and WXT development mode.

These alpha builds are for local development, not store submission. WXT strips
the prerelease suffix: alpha.1, alpha.2 and final 3.0.0 would share a numeric
version. A separately versioned store prerelease channel would need an explicit
update-ordering policy before publishing alphas. This branch does not enroll one.
Existing 2.3.0 archives/CRX remain in artifacts; the main branch retains 2.3 for
bug fixes. Switching branches does not itself rebuild the ignored loadable folders.

Tests compare rebuilt ZIP bytes with the originals, including source maps and
the reviewer-source archive. They also verify that a failed bundle or manifest
validation leaves the previously loadable extension intact. Preserve installed
extension identities, output paths, and real browser data; reload existing
installations and YouTube tabs after a successful build.

## Signing material and uploads

Keep signing keys outside this repository. Git ignores common signing-key
filenames, but the build independently checks all distributed source inputs
before building either browser. Every archive entry is checked again before
publication. Common key containers (`.pem`, `.key`, `.p12`, `.pfx`, `.pkcs8`,
`.ppk` and standard SSH private-key names) and PEM private-key headers are
rejected. A rejection preserves the existing archive. These checks are targeted
packaging protection, not a general-purpose secret scan or cryptographic audit.

The build creates ZIPs only. If the existing Chrome Web Store listing requires
Verified CRX Uploads, pack `yt-waypoints-chrome/` with the existing private key
matching its registered public key and upload that CRX instead of the Chrome
ZIP. Never generate a replacement key as part of an ordinary release. Keep the
key out of the folder being packed. Firefox uses its own ZIP for AMO submission;
the reviewer-source ZIP is supplied separately when requested for source review.

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

The packaged `themes.html` / `theme-manager.js` page reuses trusted Appearance
markup and the same import controller. Firefox opens it before native file
selection; it initializes no bookmark or player controller. Both pages use the
same validated theme owner and local storage. No additional permission is needed.

## Copyright and license headers

Authored application sources and build/configuration scripts carry short
`Copyright 2026 Daniel Smith` and `SPDX-License-Identifier: Apache-2.0` headers.
Tests do not require individual headers. JSON/binary assets are not modified to
insert comments, and existing vendored attribution is preserved. Rollup inserts
one YT Waypoints copyright/license banner into each JavaScript bundle as part of
generation, so source maps and reviewer rebuilds remain consistent. Packages
continue to include the full `LICENSE` and `THIRD-PARTY-NOTICES.md`; the package
checks verify the generated banners as well as those files.

## Restricted Alap query source

The checked-in `src/vendor/alap-tags-core/` is a deliberately pruned, readable
Alap derivative pinned by commit/provenance and derivative SHA-256. Builds do not
fetch Alap, install its npm package, use a sibling checkout or regenerate the
module. See its README and license. Protocol handlers, data-source registries,
regex and dynamic execution are absent. R1 adds bounded sort/reverse/limit/skip/shuffle
pipelines; macros expand to supported selection expressions or reusable modifier
chains. R2 adds copied scalar sort values, typed comparisons and ordered refined
results; current popup entries remain unwired. Publication-time sorting accepts
known exact timestamps but does not collect them from YouTube or persist them.
Definitions can reference other
local macros with a 10-definition depth limit, cycle rejection and bounded output.

`scripts/build.py` runs `node scripts/check-alap-boundary.mjs` before modifying
outputs. That check rejects unrestricted Alap dependencies/imports, new query
module dependencies, host/dynamic execution primitives and unreviewed derivative
changes. The reviewer-source archive includes the check and the pruned module.
A purposeful derivative update requires reviewing the source and provenance/hash
together; this guard is an accidental-regression tripwire, not a security proof.

Step 2 supplies shared modules and the standalone development consumer. The popup
and content-script entries do not yet import the adapter; this does not enable
Alap search, tag storage or macros in the installed extension.
