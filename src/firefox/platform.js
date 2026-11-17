// Copyright 2026 Daniel Smith
// SPDX-License-Identifier: Apache-2.0
globalThis.WAYPOINTS_SHORTCUT_HELP =
  "Change the launch shortcut in Firefox: Add-ons → gear menu → Manage Extension Shortcuts.";
// Firefox reserves Escape for dismissing browser-action popups (Mozilla bug 1443758).
globalThis.WAYPOINTS_ESCAPE_CLOSES_POPUP = true;
// A native chooser can unload a toolbar popup; choose theme files in a stable tab.
globalThis.WAYPOINTS_THEME_PICKER_IN_TAB = true;
// Firefox 128+ supports MAIN. Older Firefox retries without world when rejected.
globalThis.WAYPOINTS_PLAYER_LEGACY_FALLBACK = true;
