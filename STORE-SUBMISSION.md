# Publishing YT Waypoints

One source project produces **two independent store uploads**. The store ZIP
contains the ready-to-run extension; each store reviews and distributes its own
browser flavor. Building does not publish anything, sign into an account, or
create a listing.

## 1. Build the packages

```sh
python3 scripts/build.py
```

For version 1.8.9 the generated files are:

| File | Use |
| --- | --- |
| `artifacts/yt-waypoints-chrome-1.8.9.zip` | Upload to Chrome Web Store; Chrome and Brave users install this listing |
| `artifacts/yt-waypoints-firefox-1.8.9.zip` | Upload to Mozilla Add-ons (AMO) |
| `artifacts/yt-waypoints-source-1.8.9.zip` | Reviewer source/build instructions; not an installable extension |

Do not ZIP the parent project directory. Backups, tests, and build scripts must
not be in the installable extension package. The build handles this and puts
`manifest.json` at the ZIP root.

Each package contains identical shared feature files. The browser-specific
files select Firefox’s extension identity/data declaration, the appropriate shortcut-settings help, and browser manifest settings.
Both flavors use identical PNG icon artwork. Neither flavor
contains a background handler, service worker, or fullscreen overlay.
Firefox's data declaration says no data is collected or transmitted to the
developer. Browser-local records still exist, as described in PRIVACY.md.

## 2. Complete live acceptance checks

Load/reload each generated folder using the instructions in README.md. Keep the
same existing Chrome unpacked path so its installation identity stays stable.

In **each browser**, check:

- Opening on a new YouTube video auto-bookmarks it, unless disabled in Options.
  With auto-bookmark off, an unsaved video shows a green Add bookmark button;
  clicking saves it, and `/` switches to search. Saved videos show search.
- The current video's row receives focus. `/` focuses search; searching ignores
  case; typing `/` while in search works; × clears the search.
- Deleting by row × or keyboard shows the green Add bookmark button. It restores
  the last deleted video and position; `/` switches back to search.
- Options hide search/restore; the saved scrub distance and Shift multiplier
  work; preferences and bookmarks survive a browser restart.
- The toolbar icon and configured launch shortcut open the ordinary popup.
  Fullscreen controls are currently disabled; exit video fullscreen first.
- If upgrading from the fullscreen experiment, assign the launch key to **Open
  YT Waypoints menu** in the browser’s shortcut settings if needed.
- Opening another bookmark goes to the intended tab/video. No extension console
  errors appear.

Automated mocked checks cannot confirm the actual browser integration. Perform
these live checks before submitting either flavor.

## 3. Chrome Web Store (also serves Brave)

1. Register/sign in at the [Chrome Developer Dashboard](https://chrome.google.com/webstore/devconsole).
   Complete the account requirements presented there.
2. Create a new item and upload `yt-waypoints-chrome-1.8.9.zip`.
3. Fill in the listing: name, summary, description, category, screenshots, and
   requested graphics. The existing icon files are extension icons; store
   screenshots/promotional images are separate work.
4. Complete the Privacy tab: single purpose, permission justifications, and data
   handling. Review and host `PRIVACY.md` at a public URL, then use that URL for
   the policy. A local Markdown file is not a public policy URL.
5. Select distribution/visibility and submit for review when satisfied.

Suggested single purpose: "Save, search, and resume bookmarked YouTube videos
at their saved playback positions."

Permission explanations grounded in this implementation:

- `storage`: keep bookmarks and preferences in this browser profile.
- `activeTab`: interact with the tab the user is invoking the extension on.
- `scripting`: read player position/title and implement seek/play/pause controls.
- YouTube host access: autosave bookmarked videos on YouTube, including
  when the popup is closed.

There is no runtime dependency on remotely hosted code. Disclosures must match
what the extension actually reads and stores locally, even though the developer
receives none of it.

Official guidance: [prepare the ZIP](https://developer.chrome.com/docs/webstore/prepare),
[publish and complete listing/privacy fields](https://developer.chrome.com/docs/webstore/publish).
Brave supports Chromium extensions through the
[Chrome Web Store](https://support.brave.app/hc/en-us/articles/360017909112-How-can-I-add-extensions-to-Brave).

## 4. Firefox Add-ons

1. Sign in to the [Mozilla Add-ons Developer Hub](https://addons.mozilla.org/developers/).
2. Submit a new add-on and choose distribution on addons.mozilla.org for a
   public Firefox listing. Upload `yt-waypoints-firefox-1.8.9.zip`.
3. Resolve validator findings. The extension ID is `yt-waypoints@local`; the store display name is
   YT Waypoints. Keep this ID stable for future releases.
4. Supply `yt-waypoints-source-1.8.9.zip` in the source-code upload if requested
   for the build, with `python3 scripts/build.py firefox` as the reproduction
   command. This project does not minify or bundle JavaScript; the source ZIP
   is included so reviewers can reproduce manifest assembly as well.
5. Fill in listing text, screenshots, support/contact details, privacy
   information, and select **Apache License 2.0** as the distribution license. Submit for review when satisfied.

Mozilla reviews/signs the submitted extension; a locally generated ZIP is not a
signed public Firefox release. You do not upload the Chrome ZIP to Firefox or
its reviewer source ZIP as the installable package.

Official guidance: [submit an add-on](https://extensionworkshop.com/documentation/publish/submitting-an-add-on/),
[reviewer source/build instructions](https://extensionworkshop.com/documentation/publish/source-code-submission/),
[data declarations required for new extensions](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/).

## Later releases

Edit `src/shared/` for features and `src/firefox/` or `src/chrome/` for browser
specifics. Increase the version once in `package.json`, run tests/build, perform
the necessary live checks, and upload each new browser ZIP to its **existing**
store listing. Store accounts, listing IDs, review decisions, and releases are
separate. Never change the Firefox ID after publishing merely to match the name.

## Remaining before public release

Live acceptance checks, screenshots/listing graphics, a hosted privacy-policy
URL, developer accounts/listing details, and review of
store validation results. No submission or account action has been performed.
