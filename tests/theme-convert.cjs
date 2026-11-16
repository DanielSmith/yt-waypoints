const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

async function main() {
  const {
    deriveThemeColors, convertTheme, checkThemeContrast, contrastRatio,
    THEME_CONVERTER_VERSION, THEME_LIGHTNESS_THRESHOLD,
  } = await import("../src/shared/theme-convert.mjs");
  const { normalizeThemeBackup, THEME_COLOR_ROLES } = await import("../src/shared/theme-data.mjs");
  const palettes = [
    { background: "#20242a", foreground: "#f0f0f0", palette: {} },
    { background: "#ffffff", foreground: "#222222", palette: {} },
    { background: "#777777", foreground: "#777777", palette: {} },
    { background: "#000000", foreground: "#000000", palette: {} },
    { background: "#faf0e0", foreground: "#fffffe", selectionBackground: "#ff00ff", palette: { 4: "#ff00ff", 2: "#ff8800" } },
  ];
  for (const palette of palettes) {
    const original = structuredClone(palette);
    const result = deriveThemeColors(palette);
    assert.deepEqual(palette, original, "Conversion must not modify source colors");
    assert.deepEqual(result, deriveThemeColors(palette), "All resolved colors and diagnostics must be deterministic");
    assert.deepEqual(Object.keys(result.colors).sort(), [...THEME_COLOR_ROLES].sort());
    assert.equal(result.colors.surface, palette.background);
    assert.equal(result.diagnostics.contrast.passed, true);
    assert.equal(result.diagnostics.contrast.failures.length, 0);
    // Test the actual adjacent track as well as the list surface. A complete
    // role map alone did not establish that thin timeline lines were visible.
    for (const role of ["marker-chapter", "marker-user", "accent"])
      assert.ok(contrastRatio(result.colors[role], result.colors.track) >= 3, `${role}/track`);
    for (const role of ["accent", "accent-hover", "positive", "positive-hover", "checkbox", "focus"])
      for (const surface of ["surface", "surface-raised", "surface-hover", "selected", "trash-surface", "trash-hover"])
        assert.ok(contrastRatio(result.colors[role], result.colors[surface]) >= 3, `${role}/${surface}`);
    for (const adjustment of result.diagnostics.adjustments) {
      assert.notEqual(adjustment.from, adjustment.to);
      assert.equal(result.colors[adjustment.role], adjustment.to);
    }
  }
  assert.equal(deriveThemeColors(palettes[0]).appearance, "dark");
  assert.equal(deriveThemeColors(palettes[1]).appearance, "light");
  assert.equal(THEME_LIGHTNESS_THRESHOLD, 0.65);
  for (const appearance of ["light", "dark"]) {
    const result = deriveThemeColors(palettes[0], { appearance });
    assert.equal(result.appearance, appearance);
    assert.equal(result.diagnostics.appearance.requested, appearance);
    assert.equal(result.diagnostics.contrast.passed, true);
    assert.equal(result.colors.surface, palettes[0].background);
  }
  assert.throws(() => deriveThemeColors(palettes[0], { appearance: "system" }), /appearance/);
  assert.throws(() => deriveThemeColors({ ...palettes[0], foreground: "red" }), /sRGB/);
  const unsuitable = {
    background: "#20242a", foreground: "#f0f0f0",
    palette: { 1: "#ffff00", 9: "#dd4444", 2: "#ff8800", 10: "#00aa44", 4: "#ff00ff", 12: "#0a60b0" },
  };
  const semantic = deriveThemeColors(unsuitable);
  assert.deepEqual(semantic.diagnostics.semanticSources, { red: "palette.9", green: "palette.10", blue: "palette.12" });
  const channels = (value) => [1, 3, 5].map((offset) => parseInt(value.slice(offset, offset + 2), 16));
  const chapter = channels(semantic.colors["marker-chapter"]);
  const personal = channels(semantic.colors["marker-user"]);
  assert.ok(chapter[2] > chapter[0] && chapter[2] > chapter[1], "Chapter markers remain blue despite a purple slot 4");
  assert.ok(personal[1] > personal[0] && personal[1] > personal[2], "Personal markers remain green despite an orange slot 2");
  const lowContrast = deriveThemeColors(palettes[3]);
  assert.ok(lowContrast.diagnostics.adjustments.some((item) => item.role === "text" && item.from === "#000000"));
  assert.equal(lowContrast.diagnostics.fallbacks.filter((item) => ["red", "green", "blue"].includes(item.role)).length, 3);
  const broken = { ...semantic.colors, "on-accent": semantic.colors.accent };
  const report = checkThemeContrast(broken);
  assert.equal(report.passed, false);
  assert.ok(report.failures.some((item) => item.foreground === "on-accent" && item.background === "accent" && item.ratio === 1 && item.minimum === 4.5));
  assert.throws(() => checkThemeContrast({ ...semantic.colors, text: "inherit" }), /text/);
  assert.throws(() => deriveThemeColors({ background: "#747474", foreground: "#ffffff", palette: {} }), /Cannot convert text:.*contrast/);
  const converted = convertTheme({ format: "ghostty", palette: unsuitable }, "Fixture");
  assert.equal(converted.theme.source.converterVersion, THEME_CONVERTER_VERSION);
  assert.equal(THEME_CONVERTER_VERSION, 2);
  assert.deepEqual(converted.theme.source.palette, unsuitable);
  assert.equal(converted.diagnostics.contrast.passed, true);
  assert.equal(Object.hasOwn(converted.theme, "diagnostics"), false, "Ephemeral diagnostics do not change the portable schema");
  for (const name of ["light", "dark"]) {
    const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, `fixtures/themes/${name}.waypoints-theme.json`), "utf8"));
    const restored = normalizeThemeBackup(fixture);
    assert.deepEqual(restored.theme.colors, fixture.theme.colors, "Native backups retain the exact resolved colors");
    assert.equal(restored.theme.source.converterVersion, fixture.theme.source.converterVersion);
  }
  console.log("PASS: conversion policy, explicit appearance, semantic bright-slot fallbacks, adjacent-surface contrast, adjustment/failure diagnostics and unchanged native restore");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
