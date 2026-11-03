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

## Accessibility

Keep keyboard navigation, visible focus, labelled controls, and status feedback.
Help must support keyboard dismissal and return focus to the previous control.

Context comes from README.md, NEXT-SESSION.md, the existing popup, and the
requested shortcut/help behavior.
