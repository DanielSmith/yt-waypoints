const assert = require("node:assert/strict");

// Ordinary and screenshot runs must exercise exactly the same layout viewport.
const windowSize = Object.freeze({ width: 500, height: 650 });
const previewFlags = {
  "--preview-settings-expanded": "settings-expanded",
  "--preview-settings-transcripts": "settings-transcripts",
  "--preview-settings-bookmarks": "settings-bookmarks",
  "--preview-settings": "settings",
  "--preview-help-expanded": "help-expanded",
  "--preview-help": "help",
  "--preview-editor": "editor",
  "--preview": "list",
};

function parseOptions(args, env = process.env) {
  const flavor = args[0] && !args[0].startsWith("--") ? args.shift() : "chrome";
  assert.ok(["chrome", "firefox"].includes(flavor), "Choose chrome or firefox");
  for (const flag of args)
    assert.ok(Object.hasOwn(previewFlags, flag) || flag === "--dark", `Unknown flag: ${flag}`);
  const preview = Object.keys(previewFlags).find((flag) => args.includes(flag));
  const mode = preview ? previewFlags[preview] : env.WAYPOINTS_MARKER_PREVIEW || "";
  const theme = args.includes("--dark") ? "dark" : env.WAYPOINTS_PREVIEW_THEME || "light";
  assert.ok(["", ...Object.values(previewFlags)].includes(mode), `Unknown preview: ${mode}`);
  assert.ok(["light", "dark"].includes(theme), `Unknown preview theme: ${theme}`);
  return { flavor, preview: mode, theme, windowSize };
}

module.exports = { parseOptions };
