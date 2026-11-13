# YT Waypoints product context

## Register

product

## Users and purpose

People watching long YouTube videos use the browser toolbar popup to save,
find, and resume their place. Bookmarks and settings stay in browser-local
storage, with manual JSON transfer between browsers.

## Personality and boundaries

Compact, direct, familiar. Preserve the existing native-feeling system type,
light and dark themes, and ordinary popup. No fullscreen overlay on YouTube,
background worker, account flow, or extra permissions for shortcuts.

## Design principles

- Keep the video list central and the permanent shortcut hint short.
- Put the complete shortcut reference in a small help overlay on request.
- Preserve search typing, native modifier shortcuts, and selected-row focus.
- Use the existing strict JSON transfer format for both one-row and all-row copy.
- Keep component rules separate from palette definitions. Light and dark
  themes use a shared semantic color contract; System follows device appearance
  unless the user explicitly chooses a theme in Settings.

## Accessibility

Keep keyboard navigation, visible focus, labelled controls, and status feedback.
Help must support keyboard dismissal and return focus to the previous control.

Context comes from README.md, NEXT-SESSION.md, the existing popup, and the
requested shortcut/help behavior.

## Deletion and trash

Timed deletion is the default, with seven-day retention and hidden trash.
Current rows remain in the list; Show trash includes searchable red-tinted
trash rows with an explicit Restore toggle. Permanent mode, Empty trash, and
expiry remove row content from live storage, retaining only identity/version
guards against stale saves. Expiry runs at the next active popup/YouTube-tab
check; preserve the no-worker/no-additional-permissions boundary. Trash is not
autosaved or exported as current bookmark JSON.
