// Portable theme data only. No DOM, storage, terminal-file parsing or derivation.
export const THEME_FORMAT = "yt-waypoints-theme";
export const THEMES_FORMAT = "yt-waypoints-themes";
export const THEME_SCHEMA_VERSION = 1;
export const THEME_LIMITS = Object.freeze({
  nameCharacters: 80,
  attributionCharacters: 160,
  noticeCharacters: 4096,
  urlCharacters: 2048,
  sourceFileBytes: 262144,
  themeBytes: 32768,
  themes: 100,
  backupBytes: 1048576,
  libraryBytes: 1048576,
});
export const THEME_COLOR_ROLES = Object.freeze([
  "surface",
  "surface-raised",
  "surface-hover",
  "text",
  "text-muted",
  "border",
  "control-border",
  "current-border",
  "trash-border",
  "accent",
  "accent-hover",
  "on-accent",
  "positive",
  "positive-hover",
  "on-positive",
  "checkbox",
  "track",
  "marker-chapter",
  "marker-user",
  "focus",
  "selected",
  "trash-surface",
  "trash-hover",
  "danger",
  "backdrop",
]);

const fail = (message) => {
  throw new Error(`Invalid theme data: ${message}.`);
};

function record(value, allowed, required = allowed) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("expected an object");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== null && prototype !== Object.prototype) fail("expected a plain object");
  const fields = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    if (!allowed.includes(key)) fail("unexpected field");
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value"))
      fail("only enumerable data fields are supported");
    fields[key] = descriptor.value;
  }
  if (required.some((key) => !Object.hasOwn(fields, key))) fail("missing required field");
  return fields;
}

function text(value, limit, multiline = false) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > limit ||
    (multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/).test(
      value,
    )
  )
    fail("invalid text");
  return value;
}

function color(value, alpha = false) {
  if (typeof value !== "string" || !(alpha ? /^#[\da-f]{8}$/i : /^#[\da-f]{6}$/i).test(value))
    fail("expected an sRGB hex color");
  return value.toLowerCase();
}

function boundedJson(value, limit) {
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > limit)
    fail("serialized byte limit exceeded");
  return value;
}

export function normalizeSourcePalette(value) {
  const optional = [
    "selectionBackground",
    "selectionForeground",
    "cursorColor",
    "cursorText",
    "linkColor",
    "boldColor",
  ];
  const source = record(
    value,
    ["background", "foreground", "palette", ...optional],
    ["background", "foreground", "palette"],
  );
  // Fixed keys avoid importing arbitrary properties or treating palette slots
  // as CSS names. Missing slots remain missing; conversion owns their fallback.
  const entries = record(
    source.palette,
    Array.from({ length: 256 }, (_, index) => String(index)),
    [],
  );
  const palette = Object.fromEntries(
    Object.entries(entries).map(([key, value]) => [key, color(value)]),
  );
  const result = {
    background: color(source.background),
    foreground: color(source.foreground),
    palette,
  };
  for (const key of optional) {
    if (Object.hasOwn(source, key)) result[key] = color(source[key]);
  }
  return result;
}

function normalizeSource(value) {
  const source = record(
    value,
    ["format", "converterVersion", "palette", "name", "attribution"],
    ["format", "converterVersion", "palette"],
  );
  if (!["ghostty", "iterm", "builtin"].includes(source.format)) fail("unsupported source format");
  if (!Number.isSafeInteger(source.converterVersion) || source.converterVersion < 1)
    fail("invalid converter version");
  const result = {
    format: source.format,
    converterVersion: source.converterVersion,
    palette: normalizeSourcePalette(source.palette),
  };
  if (Object.hasOwn(source, "name")) result.name = text(source.name, THEME_LIMITS.nameCharacters);
  if (Object.hasOwn(source, "attribution")) {
    const attribution = record(source.attribution, ["author", "license", "url", "notice"], []);
    result.attribution = {};
    for (const key of ["author", "license", "notice"]) {
      if (Object.hasOwn(attribution, key))
        result.attribution[key] = text(
          attribution[key],
          key === "notice" ? THEME_LIMITS.noticeCharacters : THEME_LIMITS.attributionCharacters,
          key === "notice",
        );
    }
    if (Object.hasOwn(attribution, "url")) {
      const url = text(attribution.url, THEME_LIMITS.urlCharacters);
      let parsed;
      try {
        parsed = new URL(url);
      } catch {
        fail("invalid attribution URL");
      }
      if (parsed.protocol !== "https:" || parsed.username || parsed.password || /\s/.test(url))
        fail("invalid attribution URL");
      result.attribution.url = url; // Metadata only: never fetched or applied as CSS.
    }
  }
  return result;
}

export function normalizeTheme(value) {
  const theme = record(value, ["id", "name", "appearance", "colors", "source"]);
  if (
    typeof theme.id !== "string" ||
    !/^theme:[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/.test(theme.id)
  )
    fail("invalid theme ID");
  if (!["light", "dark"].includes(theme.appearance)) fail("invalid appearance");
  const colors = record(theme.colors, THEME_COLOR_ROLES);
  return boundedJson(
    {
      id: theme.id,
      name: text(theme.name, THEME_LIMITS.nameCharacters),
      appearance: theme.appearance,
      colors: Object.fromEntries(
        THEME_COLOR_ROLES.map((role) => [role, color(colors[role], role === "backdrop")]),
      ),
      source: normalizeSource(theme.source),
    },
    THEME_LIMITS.themeBytes,
  );
}

export function normalizeThemeBackup(value) {
  const envelope = record(value, ["format", "version", "theme", "themes"], ["format", "version"]);
  if (envelope.version !== THEME_SCHEMA_VERSION) fail("unsupported backup version");
  let result;
  if (envelope.format === THEME_FORMAT) {
    if (!Object.hasOwn(envelope, "theme") || Object.hasOwn(envelope, "themes"))
      fail("expected a single theme");
    result = {
      format: THEME_FORMAT,
      version: THEME_SCHEMA_VERSION,
      theme: normalizeTheme(envelope.theme),
    };
  } else if (envelope.format === THEMES_FORMAT) {
    const themes = envelope.themes;
    if (
      Object.hasOwn(envelope, "theme") ||
      !Array.isArray(themes) ||
      themes.length > THEME_LIMITS.themes
    )
      fail("invalid theme collection");
    // Check descriptors before reading any entry; JSON arrays are dense and
    // cannot carry named properties, symbols, accessors or hidden fields.
    if (Reflect.ownKeys(themes).length !== themes.length + 1) fail("invalid collection fields");
    const normalized = [];
    const ids = new Set();
    for (let index = 0; index < themes.length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(themes, String(index));
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value"))
        fail("invalid collection entry");
      const theme = normalizeTheme(descriptor.value);
      if (ids.has(theme.id)) fail("duplicate theme ID");
      ids.add(theme.id);
      normalized.push(theme);
    }
    result = { format: THEMES_FORMAT, version: THEME_SCHEMA_VERSION, themes: normalized };
  } else fail("unsupported backup format");
  return boundedJson(result, THEME_LIMITS.backupBytes);
}
