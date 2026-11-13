# Changelog

## Unreleased — 2026-11-13

- Share pure extension-side video-ID and channel-URL validation. Preserve URL
  normalization, caller-specific errors and strict field/accessor checks. Require
  string IDs in direct transcript formatting calls rather than coercing objects.
  Keep serialized page-reader checks independent and unchanged.

- Consolidate Settings, Help and annotation frame CSS around shared dimension
  and clearance tokens. Remove unused expanded-size tokens and the duplicate
  annotation-input rule. Keep the existing frame, scrolling and focus geometry;
  annotation sizing now reads its pixel bounds from the same CSS tokens.

- Give Settings defaults and numeric ranges one shared policy owner; initialize
  controls from those rules and the annotation limit from its data contract.
  Name owner-specific timers, schema versions, safety limits and reader bounds
  while preserving current values and self-contained injected functions.

- Serialize and coalesce popup refreshes. Discard reads invalidated by newer
  requests, preserve awaited action refreshes, and reuse them for their storage
  notifications. Keep external updates and recovery after read failures working.

- Expand the single on-demand annotation editor beneath its source bookmark
  instead of above the list. Use 500ms easing in both directions and follow
  expansion with list scrolling so the row and editor actions remain visible.
  Preserve drafts/focus during background refreshes, clear the form on close,
  and reserve space around controls so focus outlines are not clipped.

- Add `*` to toggle Settings outside text fields, with repeat protection and
  focus on the first group when opening. Document it in Help and the gear tooltip.

- Ease Help and Settings disclosures over 500ms in both directions. Start opening
  at zero even when a browser reports the natural height of collapsed content;
  preserve smooth reversal during rapid toggles and immediate reduced-motion behavior.

- Arrange the toolbar as search, Settings gear, Help question mark, and the
  YT Waypoints icon for About. Keep labelled tooltips and keyboard activation.

- Rename the user-facing Options panel to Settings. Use a theme-aware SVG gear
  to open it and “Hide settings” to close it. Keep the full green group focus
  outline visible above content and dividers.

- Organize Options into six independently expandable groups with current-setting
  summaries and contextual explanations. Reuse Help's keyboard navigation,
  reversible eased motion and reduced-motion behavior. Start with all groups
  collapsed and keep the frame fixed while expanded content scrolls internally.
- Keep transcript format choices and examples inside the original popup width.
  Preserve existing preferences, actions, automatic saving and browser permissions.

## 2.3.0 — 2026-11-12

- Compact shortcut help into one-line summaries with independently expandable
  explanations. Add Up/Down focus, 333ms eased toggles, selected-row backgrounds,
  and reduced-motion support. Fix the help frame height and reserve scrollbar
  width so toggles scroll internally without resizing or shifting the popup.
- Add keyboard-driven markers (`m`, `[` / `]`), annotation editing (`a`), and
  visibility toggle (`M`). Thin blue/green lines overlay the existing timeline
  without adding row height or marker buttons/lists. Deleting a marker also
  deletes its annotation. Ctrl/Command+Enter saves the requested note editor.
  Read chapters from supported open YouTube page models and use chapter titles
  as default annotations, preserving personal overrides, clears, and removals.
  No new browser permissions or OAuth flow.
- Add independently versioned marker properties, video-start notes, retained
  chapter-removal identities, and validated version-2 JSON transfer.
- Build readable popup, content-script, and early-theme bundles using pinned
  WXT/Vite and ES-import entry points. Include local source maps, a dependency
  lockfile, and reproducible reviewer-source build instructions.
- Expand compressed JavaScript and test fixtures into consistent readable
  formatting. Clarify private storage/version helpers and subtitle time formatting;
  preserve storage fields, exported data, and playback behavior.
- Split popup coordination into focused player-client, settings, bookmark,
  export, list, input, and dialog modules. Preserve the shared action queue,
  storage lifetime guards, injected-function serialization, and established UI.
- Popup regressions now load the production HTML script order and call the
  owning modules. Existing behavior assertions remain in place.
- Group visible trash below current bookmarks, retaining newest-first ordering
  within each group. Only the focused row has a colored outline: green for
  current bookmarks, red for trash. Inactive rows retain neutral dividers.
- Add space below the visible list so the popup's rounded corners do not clip
  the final row's focus outline.
- Added support for modern YouTube transcript panels without a target ID or
  legacy language footer, using the page's video-bound `/get_panel` request.
- Parse chapter-grouped transcript paragraphs from a fresh terminal response;
  reject incomplete, ambiguous, unsupported, wrong-video, or changed-panel data.
- Modern panels supply start times only. Markdown/plain text/JSON preserve all
  passages; JSON ends remain null and SRT/WebVTT explain the missing cue ends.
- Added reader, response-schema, serializer, and clipboard/file-offer regressions
  based on the reported Firefox layout. Installed-extension retesting is pending.

## Unreleased — 2026-11-11

### Transcript completeness

- Replaced first-mounted-row extraction with a request for YouTube's complete
  selected-language response. Video-bound page tokens and matching language
  selection are required; no default-language guess or third-party API is used.
- Fail clearly on unverified/continued/loading/unknown responses, timeouts,
  oversized payloads, and navigation/language changes. Partial text is never
  copied or offered as a file, across all seven formats.
- Preserve supplied cue ends and millisecond timestamps, clipping overlaps and
  media padding. Final cues no longer extend across trailing video silence.
- Added bounded serialized-reader fixtures, 33 failure cases per adapter, and
  export/clipboard safety regressions. Full automated suite passes; current
  YouTube/native-browser integration remains to be accepted.

### Player data validation

- Added shared extension-side validation for page-derived playback, metadata,
  and transcript results, including video identity, main-frame delivery,
  operation-specific fields, numeric bounds, string/URL limits, and payload size.
- Invalid open-player responses now show an error without changing a bookmark;
  they no longer fall back to a saved-only position change.
- Metadata enrichment/autosave use the same boundary. Valid positions retain
  matching duration, and delayed frame/slider results preserve newer imports.
- Added malformed-result, no-write, empty-error, metadata/autosave, and serialized
  identity/navigation regressions. Transcript completeness was subsequently addressed by the reader changes above.

### Slider keyboard behavior

- Slider Left/Right now queues one absolute seek, without an earlier row-level
  relative seek from the document capture handler. Row arrows retain relative
  scrubbing, and sliders retain their configured step and Shift multiplier.
- Preserved slider focus after updates and left modified/composition keys to
  native handling. Added capture/target and repeat regressions.
- Added an optional headless Chrome real-DOM regression with 15 cases per built
  adapter. Full automated checks pass; installed-extension acceptance is pending.

### Bookmark data integrity

- Replaced full-map bookmark writes with shared versioned mutations so saves
  from different tabs preserve unrelated bookmarks and fields.
- Added deletion/lifetime handling so delayed saves cannot restore deleted
  bookmarks or overwrite a deliberately re-added/imported record.
- Kept JSON transfer format v1 and per-video imported-position adoption,
  including identical reimports. Settings and permissions are unchanged.
- Added safe journal checkpointing and independent-context tests for save,
  delete, re-add, import, cleanup, and storage-failure races.
- Legacy bookmarks migrate into durable checkpoints before old keys are removed.
  Export current JSON before downgrading; older builds cannot read new changes.
- Automated checks pass for both browser packages; native acceptance is pending.

### Deletion modes and trash

- Added Timed (default) and Permanent deletion modes in Options. Timed moves
  rows to hidden trash; Permanent removes stored row content immediately.
- Added persistent Show trash, searchable red-tinted trash rows, a Restore
  checkbox, and Empty trash. Current bookmarks remain in the normal list.
- Added configurable trash retention from 1–365 days, defaulting to one week.
  Expiry runs at the next active popup/YouTube-tab check; no worker or new
  permission is required. Retention changes apply to existing trash too.
- Permanent deletion/expiry also removes old journal and migration payloads,
  retaining only identity/version guards. Permanent deletion has no Undo.
- Trash stops autosaving and is excluded from bookmark JSON exports. Trash and
  permanent deletions are not silently recreated by auto-bookmark on reopening.
- Added restore-versus-expiry/bulk-delete race coverage, retention and payload
  erasure checks, popup tests, and trash color contrast checks for both themes.
- Fixed delayed settings saves discarding later checkbox/retention changes.
- Visually inspected light/dark list and Options in headless Chrome fixtures;
  corrected the narrow Options header. Native extension acceptance is pending.

## 2.2.0 — 2026-11-07

### Themes and CSS organization

- Added complete light and dark palettes in separate, self-contained theme
  files: `src/shared/themes/light.css` and `src/shared/themes/dark.css`.
- Added a persistent **System / Light / Dark** selector at the top of Options.
  System is the default and follows device appearance changes while the popup
  is open; an explicit choice overrides the device setting.
- Extracted all component colors into semantic CSS custom properties for
  surfaces, text, borders, buttons, positive actions, selection, focus, sliders,
  errors, and dialog backdrops. Native form controls use the selected theme's
  `color-scheme`.
- Moved shared typography, radii, popup dimensions, and common sizing into
  `src/shared/styles/tokens.css`. Component layout and interaction rules remain
  in `popup.css`, formatted with one declaration per line and section comments.
- Consolidated common secondary-button and select styling. Light/dark themes
  cover bookmarks, Options, transcript format explanations, help, and filename
  dialogs. Focused rows use a full outline and themed selection background.
- Added an early theme initializer, including protection against a delayed
  settings read overwriting a newer theme selection. Unknown preferences fall
  back to System; a failed initial theme read retains system styling.
- Added [THEMES.md](THEMES.md) with the CSS contract and instructions for adding
  another theme. Theme documentation and this changelog are included in the
  reviewer-source archive.
- Added automated checks for theme selection/persistence, live system changes,
  startup races, complete palette coverage, text/button/control contrast, and
  native select keyboard behavior.
- Bumped the version to 2.2.0 for this substantial theme refactor. Earlier
  2.1.0 packages remain available separately; no store submission is recorded.

## 2.1.0 — 2026-11-07

Changes since **2.0.4**, covering the local development builds 2.0.5 through
2.0.8. Version 2.1.0 packages have been built for Firefox and Chrome/Brave;
store submission and publication of this version have not been confirmed.

### Playback shortcuts

- Replaced the comma/period and angle-bracket scrub aliases with controls
  matching YouTube's shortcut layout:

  | Shortcut | Action |
  | --- | --- |
  | `,` | Previous frame |
  | `.` | Next frame |
  | `<` / Shift + comma | Decrease playback speed |
  | `>` / Shift + period | Increase playback speed |

- Frame stepping automatically pauses a playing video before seeking and
  leaves it paused afterward. There is no request to pause manually.
- Frame steps use the video's reported frame rate rather than assuming 30 fps.
  The lookup supports player statistics, selected stream formats, video data,
  and an unambiguous match to the displayed video resolution. If the frame
  rate cannot be determined, the action reports an error without pausing.
- Speed changes use YouTube's available playback rates when accessible. If
  that API is unavailable, the video element provides quarter-speed steps
  within the standard 0.25×–2× range, preserving an already higher current speed
  as the upper bound.
- These controls operate on an already-open video and respect missing-player,
  loading, changed-video, and ad states. They do not open closed videos.
- Left/Right arrows retain the configured scrub distance; Shift + Left/Right
  retains the configured multiplier.

### Transcript copying and formats

- Added uppercase `T` (Shift + t) to copy the selected video's transcript.
  Lowercase `t` continues to toggle thumbnails.
- Added **Copy transcript** in Options, targeting the previously selected
  bookmark or the current YouTube video.
- Reads timed segments from YouTube's native transcript panel in an open tab,
  using its displayed language. Opens **Show transcript** when available and
  waits up to eight seconds for content. Handles both classic and newer
  transcript segment markup, and checks for navigation during loading.
- Added seven output formats:

  | Format | Best use | Extension |
  | --- | --- | --- |
  | **Markdown with linked timestamps — default** | Obsidian notes with links back to each moment | `.md` |
  | Markdown with bold timestamps | Notes in the style of Obsidian Web Clipper | `.md` |
  | Plain text with timestamps | Text editors, email, and general clipboard use | `.txt` |
  | Plain text without timestamps | Continuous reading and text processing | `.txt` |
  | SRT subtitles | Subtitle editors and video players | `.srt` |
  | WebVTT subtitles | Web video captions and browser players | `.vtt` |
  | JSON with timed segments | Scripts, indexing, and structured processing | `.json` |

- Markdown and timed plain-text exports include the video title and source
  URL. Untimed plain text contains only transcript text. JSON includes video
  metadata and segment start/end times in seconds; it is separate from the
  existing bookmark backup format.
- Subtitle cue ends are derived from the next segment's start, with the final
  cue ending at the video duration. Timing has the precision shown in
  YouTube's transcript panel; these exports are not original caption files.
- Joined segments sharing a displayed start time to avoid zero-length cues.
  SRT/WebVTT export requires valid end times and a known final video duration;
  JSON permits an unknown final end as `null`.
- Added timing validation, Markdown escaping, Unicode support, and suggested
  transcript filenames based on the video title and ID. Failed transcript
  retrieval or formatting does not replace the clipboard with empty output.

### Options interface

- Added a persistent **Transcript format** dropdown. Hovering or focusing a
  choice displays its best use, a fuller explanation, and an example in a
  panel to the right. The popup widens while the dropdown is open.
- Added keyboard preview and selection: arrows navigate, Enter/Space select,
  and Escape cancels where the browser permits it. Previewing alone does not
  change the saved preference.
- Moved **Transcript format** and **Offer to save to file** to the bottom of
  Options, below **Export saved videos**.
- Updated shortcut help and documentation for the new controls and formats.

### Optional file saving

- Added one shared **Offer to save to file** preference, **off by default**.
  It applies to transcript copies and all-bookmark JSON exports through
  **Copy JSON** or uppercase `C`.
- Copying to the clipboard happens first. When the preference is enabled and
  copying succeeds, a small dialog asks **“Also save to file?”**
- Choosing **Yes** reveals a filename field with a suggested name. The correct
  extension is appended if needed; empty names and folder paths are rejected.
- **No thanks**, **Cancel**, and download failures preserve the clipboard copy.
  Clipboard failures do not open a save offer. Single-row JSON copy (`c`) and
  URL copy (`u`) do not trigger the offer.
- Saved files contain the same output as the clipboard and follow browser
  download settings. File-saving dialogs isolate filename typing and paste
  from background popup shortcuts and import handling.

### Player access and diagnostics

- Changed playback actions to request the page's MAIN execution world in
  current Firefox and Chromium. Firefox versions before 128 can retry in the
  isolated world when the world option is explicitly rejected.
- Guarded private player-method access and removed page-array callbacks from
  the older Firefox compatibility path.
- Added a video-element fallback for playback-speed changes.
- Replaced swallowed script failures with specific messages for injection
  errors, rejected access, empty results, and unavailable player states.

### Privacy, packaging, and verification

- No additional extension permissions, external transcript service, API key,
  or speech-recognition service were added. Transcript content is not saved
  in extension storage; pending file output is held in popup memory.
- Updated the README, privacy policy, and local handoff notes.
- Added automated coverage for player controls and failures, automatic
  pausing, all seven transcript formats, dropdown interaction, saved
  preferences, clipboard-first save offers, filename validation, cancellation,
  and downloaded content.
- The full automated suite passed for both browser flavors before the final
  version-only bump. Version 2.1.0 build/package checks also passed, including
  shared-source parity and reproducible reviewer-source builds.
- Native-browser confirmation of the reported frame-step/speed issue and
  acceptance checks for transcript extraction, dropdown layout, clipboard
  access, and file downloads remain outstanding. Automated browser/DOM mocks
  do not establish successful integration with the live YouTube page.

### Development version history

These were local development versions, not confirmed store releases:

| Version | Changes introduced |
| --- | --- |
| 2.0.5 | YouTube-style frame/speed shortcuts and initial transcript copying |
| 2.0.6 | Seven transcript formats, format explanations, and the shared optional file-save flow |
| 2.0.7 | Revised player access, compatibility fallbacks, clearer failure messages, and relocation of transcript/file options |
| 2.0.8 | Automatic pausing before frame stepping |
| 2.1.0 | Version bump and rebuilt Firefox, Chrome/Brave, and reviewer-source packages |

The shortcut-help dialog and `u` / `c` / `C` copy commands already existed in
2.0.4. This release extends them rather than introducing those commands anew.
