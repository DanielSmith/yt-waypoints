// Read-only key/label metadata, not a dispatcher. Contexts, modifiers and repeat
// policies remain explicit in popup-input.js, including the early Settings key.
(() => {
  const shortcut = (keys, label, hintLabel = label) =>
    Object.freeze({ keys: Object.freeze([...keys]), label, hintLabel });
  const pair = (previous, next, label) =>
    Object.freeze({
      keys: Object.freeze([previous, next]),
      previous,
      next,
      label,
      hintLabel: label,
    });
  const scrub = pair("ArrowLeft", "ArrowRight", "← / →");
  const definitions = Object.freeze({
    markerToggle: shortcut(["m"], "m"),
    markerVisibility: shortcut(["M"], "M"),
    annotationEdit: shortcut(["a"], "a"),
    annotationSave: shortcut(["Enter"], "Ctrl/⌘ + Enter"),
    markerNavigation: pair("[", "]", "[ / ]"),
    scrub,
    shiftScrub: shortcut(scrub.keys, `Shift + ${scrub.label}`),
    playbackFrame: pair(",", ".", ", / ."),
    playbackRate: pair("<", ">", "< / >"),
    playPause: shortcut([" "], "Space", "space"),
    deleteBookmark: shortcut(["Delete", "Backspace"], "Delete / Backspace"),
    openVideo: shortcut(["Enter"], "Enter", "↵"),
    selectVideo: pair("ArrowUp", "ArrowDown", "↑ / ↓"),
    focusSearch: shortcut(["/"], "/"),
    thumbnails: shortcut(["t"], "t"),
    transcript: shortcut(["T"], "T"),
    videoUrl: shortcut(["u"], "u"),
    videoJson: shortcut(["c"], "c"),
    allJson: shortcut(["C"], "C"),
    settings: shortcut(["*"], "*"),
    help: shortcut(["h", "H", "?"], "h / ?"),
    escape: shortcut(["Escape"], "Escape"),
  });
  function get(name) {
    if (!Object.hasOwn(definitions, name)) throw new Error(`Unknown popup shortcut: ${name}`);
    return definitions[name];
  }
  const matches = (name, key) => get(name).keys.includes(key);
  const label = (name) => get(name).label;
  const hint = (name) => get(name).hintLabel;
  globalThis.WAYPOINTS_SHORTCUTS = Object.freeze({ definitions, matches, label, hint });
})();
