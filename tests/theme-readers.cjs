const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

async function main() {
  const { readGhosttyColors, detectThemeFormat, checkThemeText } =
    await import("../src/shared/theme-readers.mjs");
  const { deriveThemeColors, contrastRatio, themeSlug, asciiText, createConvertedTheme } =
    await import("../src/shared/theme-convert.mjs");
  const { normalizeTheme, THEME_COLOR_ROLES } = await import("../src/shared/theme-data.mjs");
  const text =
    "# Synthetic theme\nbackground = #20242a\nforeground = f0f0f0\npalette = 4=#8888ee\npalette = 2=#66bb88\n";
  const source = readGhosttyColors(text);
  assert.equal(detectThemeFormat(text), "ghostty");
  assert.equal(detectThemeFormat('<?xml version="1.0"?><plist/>'), "iterm");
  assert.equal(detectThemeFormat('{"format":"yt-waypoints-theme"}'), "waypoints");
  assert.equal(detectThemeFormat('{"videos":{}}'), "unknown");
  assert.equal(detectThemeFormat("plain text"), "unknown");
  assert.equal(source.palette.background, "#20242a");
  assert.equal(
    readGhosttyColors(
      text + "font-family = Unused\nconfig-file = https://example.com/never-fetch\n",
    ).ignored,
    2,
  );
  assert.equal(
    readGhosttyColors(text.replace("#20242a", '"#ABCDEF"')).palette.background,
    "#abcdef",
  );
  for (const extra of [
    "background = #111111",
    "palette = 4=#111111",
    "palette = 256=#111111",
    "palette = 01=#111111",
    "selection-background = red",
    "cursor-text =",
    "broken setting",
  ])
    assert.throws(() => readGhosttyColors(text + extra));
  assert.throws(() => readGhosttyColors("background=#000000"), /foreground/);
  assert.throws(() => readGhosttyColors(text.replace("#20242a", "#20242a # inline comment")));
  assert.throws(() => checkThemeText("x".repeat(262145)), /exceeds/);
  assert.throws(() => checkThemeText("😀".repeat(70000)), /exceeds/);
  assert.throws(() => checkThemeText(null));
  assert.equal(themeSlug("  Café ... Warm___  Theme!!  "), "cafe-warm-theme");
  assert.equal(themeSlug("日本語"), "");
  assert.ok(/^[\x00-\x7f]*$/.test(asciiText("© 2026 ‘Theme’ — Café")));
  assert.equal(contrastRatio("#000000", "#ffffff"), 21);
  assert.equal(contrastRatio("#112233", "#112233"), 1);
  function check(result) {
    assert.deepEqual(Object.keys(result.colors).sort(), [...THEME_COLOR_ROLES].sort());
    const colors = result.colors;
    const surfaces = [
      "surface",
      "surface-raised",
      "surface-hover",
      "selected",
      "trash-surface",
      "trash-hover",
    ];
    for (const role of ["text", "text-muted", "danger", "marker-chapter", "marker-user"])
      for (const surface of surfaces)
        assert.ok(contrastRatio(colors[role], colors[surface]) >= 4.5, `${role}/${surface}`);
    for (const role of ["control-border", "current-border", "trash-border", "focus"])
      for (const surface of surfaces) assert.ok(contrastRatio(colors[role], colors[surface]) >= 3);
    for (const role of ["accent", "positive"])
      for (const suffix of ["", "-hover"])
        assert.ok(contrastRatio(colors[`on-${role}`], colors[role + suffix]) >= 4.5);
  }
  const palettes = [
    source.palette,
    { background: "#ffffff", foreground: "#222222", palette: {} },
    { background: "#777777", foreground: "#777777", palette: {} },
    { background: "#000000", foreground: "#000000", palette: {} },
    { background: "#faf0e0", foreground: "#fffffe", palette: { 4: "#ff00ff", 2: "#ff8800" } },
  ];
  for (const palette of palettes) {
    const before = JSON.stringify(palette);
    const result = deriveThemeColors(palette);
    check(result);
    assert.deepEqual(result, deriveThemeColors(palette));
    assert.equal(JSON.stringify(palette), before);
    assert.equal(result.colors.surface, palette.background);
  }
  const theme = createConvertedTheme(source, "Café -- Test!", "Évening Theme.ghostty");
  assert.equal(theme.name, "cafe-test");
  assert.equal(theme.source.name, "evening-theme-ghostty");
  assert.deepEqual(normalizeTheme(theme), theme);
  assert.ok(/^[\x00-\x7f]*$/.test(JSON.stringify(theme.source)));
  console.log(
    "PASS: Ghostty assignments, format detection, bounds, slug/provenance sanitization and deterministic contrast-checked conversion",
  );
  // Optional read-only compatibility scan of the user's installed collection.
  if (process.argv[2]) {
    const directory = path.resolve(process.argv[2]);
    let count = 0;
    for (const file of fs.readdirSync(directory)) {
      const full = path.join(directory, file);
      if (!fs.statSync(full).isFile()) continue;
      check(deriveThemeColors(readGhosttyColors(fs.readFileSync(full, "utf8")).palette));
      count++;
    }
    console.log(
      `PASS: ${count} installed Ghostty files parsed and converted, with every contrast constraint checked`,
    );
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
