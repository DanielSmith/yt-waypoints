// Copyright 2026 Daniel Smith
// SPDX-License-Identifier: Apache-2.0
// Shared converter: perceptual shade derivation and measured sRGB contrast.
// No storage, UI, network or automatic regeneration of saved theme colors.
import { normalizeSourcePalette, normalizeTheme, THEME_COLOR_ROLES } from "./theme-data.mjs";
export const THEME_CONVERTER_VERSION = 2;
export const THEME_LIGHTNESS_THRESHOLD = 0.65;
const UI_SURFACES = ["surface", "surface-raised", "surface-hover", "selected", "trash-surface", "trash-hover"];

const clamp = (x, low = 0, high = 1) => Math.min(high, Math.max(low, x));
const linear = (x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
const encoded = (x) => (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055);
const rgb = (hex) => [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255);
export function contrastRatio(a, b) {
  const luminance = (hex) =>
    rgb(hex)
      .map(linear)
      .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
function lab(hex) {
  const [r, g, b] = rgb(hex).map(linear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
function linearRgb([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}
function color([L, a, b]) {
  L = clamp(L);
  const inGamut = (scale) =>
    linearRgb([L, a * scale, b * scale]).every((x) => x >= -0.0000001 && x <= 1.0000001);
  let low = 0,
    high = 1;
  if (!inGamut(1)) {
    for (let i = 0; i < 20; i++) {
      const middle = (low + high) / 2;
      if (inGamut(middle)) low = middle;
      else high = middle;
    }
  } else low = 1;
  return (
    "#" +
    linearRgb([L, a * low, b * low])
      .map((x) =>
        Math.round(clamp(encoded(clamp(x))) * 255)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}
const mix = (a, b, weight) =>
  color(lab(a).map((value, index) => value * (1 - weight) + lab(b)[index] * weight));
function repair(candidate, constraints, fallback) {
  const passes = (value) =>
    constraints.every(([surface, ratio]) => contrastRatio(value, surface) >= ratio);
  if (passes(candidate)) return candidate;
  const [L, a, b] = lab(candidate);
  for (let delta = 1; delta <= 512; delta++) {
    for (const sign of [-1, 1]) {
      const next = L + (sign * delta) / 512;
      if (next < 0 || next > 1) continue;
      const value = color([next, a, b]);
      if (passes(value)) return value;
    }
  }
  for (const value of ["#000000", "#ffffff"]) if (passes(value)) return value;
  if (fallback && passes(fallback)) return fallback;
  throw new Error("This palette cannot meet the required contrast across its surfaces.");
}
function hasHue(value, hue, minimumChroma = 0.04) {
  const [, a, b] = lab(value);
  const angle = ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
  const distance = Math.abs(((angle - hue + 540) % 360) - 180);
  return Math.hypot(a, b) >= minimumChroma && distance <= 35;
}
function semantic(palette, slot, hue, role, diagnostics) {
  for (const index of [slot, slot + 8]) {
    const value = palette.palette[String(index)];
    if (value && hasHue(value, hue)) {
      diagnostics.semanticSources[role] = `palette.${index}`;
      return value;
    }
  }
  const fallback = color([
    0.65,
    0.13 * Math.cos((hue * Math.PI) / 180),
    0.13 * Math.sin((hue * Math.PI) / 180),
  ]);
  diagnostics.semanticSources[role] = "fallback";
  diagnostics.fallbacks.push({ role, color: fallback, reason: "Source slots missing or outside the semantic hue range." });
  return fallback;
}

// Accept a complete normalized role map. Diagnostics stay outside saved themes.
export function checkThemeContrast(colors) {
  for (const role of THEME_COLOR_ROLES) {
    if (typeof colors?.[role] !== "string" || !(role === "backdrop" ? /^#[\da-f]{8}$/i : /^#[\da-f]{6}$/i).test(colors[role]))
      throw new Error(`Invalid resolved theme color: ${role}.`);
  }
  const failures = [];
  let checks = 0;
  const check = (foreground, background, minimum) => {
    const ratio = contrastRatio(colors[foreground], colors[background]);
    checks++;
    if (ratio < minimum) failures.push({ foreground, background, minimum, ratio });
  };
  for (const surface of UI_SURFACES) {
    for (const role of ["text", "text-muted", "danger", "marker-chapter", "marker-user"])
      check(role, surface, 4.5);
    for (const role of ["control-border", "current-border", "trash-border", "focus", "checkbox", "accent", "accent-hover", "positive", "positive-hover"])
      check(role, surface, 3);
  }
  for (const role of ["accent", "positive"])
    for (const suffix of ["", "-hover"]) check(`on-${role}`, role + suffix, 4.5);
  for (const role of ["marker-chapter", "marker-user", "accent"]) check(role, "track", 3);
  return { passed: failures.length === 0, checks, failures };
}

export function deriveThemeColors(input, { appearance: requested = "auto" } = {}) {
  if (!["auto", "light", "dark"].includes(requested))
    throw new Error("Theme appearance must be auto, light or dark.");
  const palette = normalizeSourcePalette(input);
  const lightness = lab(palette.background)[0];
  const appearance = requested === "auto"
    ? lightness >= THEME_LIGHTNESS_THRESHOLD ? "light" : "dark"
    : requested;
  const diagnostics = {
    appearance: { requested, resolved: appearance, lightness, threshold: THEME_LIGHTNESS_THRESHOLD },
    semanticSources: {},
    fallbacks: [],
    adjustments: [],
  };
  const adjusted = (role, candidate, constraints, fallback) => {
    let value;
    try {
      value = repair(candidate, constraints, fallback);
    } catch (error) {
      throw new Error(`Cannot convert ${role}: ${error.message}`);
    }
    if (value !== candidate)
      diagnostics.adjustments.push({ role, from: candidate, to: value, reason: "contrast" });
    return value;
  };
  const direction = appearance === "light" ? "#141820" : "#f5f6f8";
  const red = semantic(palette, 1, 25, "red", diagnostics),
    green = semantic(palette, 2, 150, "green", diagnostics),
    blue = semantic(palette, 4, 255, "blue", diagnostics);
  const colors = {
    surface: palette.background,
    "surface-raised": mix(palette.background, direction, 0.04),
    "surface-hover": mix(palette.background, direction, 0.08),
    selected: mix(palette.background, palette.selectionBackground || direction, 0.15),
    "trash-surface": mix(palette.background, red, 0.06),
    "trash-hover": mix(palette.background, red, 0.1),
  };
  const surfaces = Object.values(colors);
  const constraints = (ratio) => surfaces.map((surface) => [surface, ratio]);
  colors.text = adjusted("text", palette.foreground, constraints(4.5));
  colors["text-muted"] = adjusted("text-muted", mix(colors.text, colors.surface, 0.3), constraints(4.5));
  colors.border = mix(colors.surface, colors.text, 0.25);
  colors["control-border"] = adjusted("control-border", mix(colors.surface, colors.text, 0.5), constraints(3));
  colors["current-border"] = adjusted("current-border", green, constraints(3));
  colors["trash-border"] = adjusted("trash-border", red, constraints(3));
  colors["marker-chapter"] = adjusted("marker-chapter", blue, constraints(4.5));
  colors["marker-user"] = adjusted("marker-user", green, constraints(4.5));
  for (const [role, hue] of [["marker-chapter", 255], ["marker-user", 150]])
    if (!hasHue(colors[role], hue, 0.02))
      throw new Error(`Cannot convert ${role}: contrast repair cannot preserve its semantic hue.`);
  colors.danger = adjusted("danger", red, constraints(4.5));
  const accent = palette.linkColor || palette.palette["4"] || palette.palette["12"] || blue;
  for (const [role, value] of [
    ["accent", accent],
    ["positive", green],
  ]) {
    colors[role] = adjusted(role, value, constraints(3));
    const choices = ["#12151a", "#fafbfc"].sort(
      (a, b) => contrastRatio(b, colors[role]) - contrastRatio(a, colors[role]),
    );
    colors[`on-${role}`] = adjusted(`on-${role}`, choices[0], [[colors[role], 4.5]]);
    colors[`${role}-hover`] = adjusted(
      `${role}-hover`,
      mix(colors[role], direction, 0.04),
      [...constraints(3), [colors[`on-${role}`], 4.5]],
      colors[role],
    );
    if (colors[`${role}-hover`] === colors[role])
      diagnostics.fallbacks.push({ role: `${role}-hover`, color: colors[role], reason: "Retained base action color to meet surface and button-text contrast." });
  }
  colors.checkbox = colors["current-border"];
  colors.track = adjusted("track", mix(colors.surface, colors.text, 0.2),
    ["marker-chapter", "marker-user", "accent"].map((role) => [colors[role], 3]), colors.surface);
  colors.focus = colors.accent;
  colors.backdrop = "#10131880";
  diagnostics.contrast = checkThemeContrast(colors);
  if (!diagnostics.contrast.passed) {
    const failure = diagnostics.contrast.failures[0];
    throw new Error(`Cannot convert ${failure.foreground}/${failure.background}: ${failure.ratio.toFixed(2)}:1 is below ${failure.minimum}:1.`);
  }
  return {
    appearance,
    colors: Object.fromEntries(THEME_COLOR_ROLES.map((role) => [role, colors[role]])),
    diagnostics,
  };
}
export function asciiText(value) {
  return String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/[^\x20-\x7e\n\t]/g, "");
}
export function themeSlug(value) {
  return asciiText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
}
export function convertTheme(source, name, filename = "", options = {}) {
  const slug = themeSlug(name);
  if (!slug) throw new Error("Enter a name containing ASCII letters or numbers.");
  const { appearance, colors, diagnostics } = deriveThemeColors(source.palette, options);
  const theme = normalizeTheme({
    id: `theme:${crypto.randomUUID()}`,
    name: slug,
    appearance,
    colors,
    source: {
      format: source.format,
      converterVersion: THEME_CONVERTER_VERSION,
      palette: source.palette,
      name: themeSlug(filename || name),
      attribution: {
        notice: `Converted from ${source.format}; source: ${themeSlug(filename || name)}; input: ${filename ? "file" : "paste"}.`,
      },
    },
  });
  return { theme, diagnostics };
}

// Convenience for callers that only need the portable record.
export function createConvertedTheme(source, name, filename = "", options = {}) {
  return convertTheme(source, name, filename, options).theme;
}
