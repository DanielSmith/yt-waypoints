const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

async function main() {
  const { normalizeTheme, normalizeThemeBackup, THEME_COLOR_ROLES, THEME_LIMITS } =
    await import("../src/shared/theme-data.mjs");
  const fixture = (name) =>
    JSON.parse(
      fs.readFileSync(path.join(__dirname, `fixtures/themes/${name}.waypoints-theme.json`), "utf8"),
    );
  const dark = fixture("dark");
  const light = fixture("light");
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const reject = (edit, expression = /Invalid theme data/) => {
    const value = clone(dark);
    edit(value);
    assert.throws(() => normalizeThemeBackup(value), expression);
  };
  for (const appearance of ["light", "dark"]) {
    const css = fs.readFileSync(
      path.join(__dirname, `../src/shared/themes/${appearance}.css`),
      "utf8",
    );
    const roles = [...css.matchAll(/--color-([a-z-]+)\s*:/g)].map((match) => match[1]);
    assert.deepEqual([...THEME_COLOR_ROLES].sort(), roles.sort());
    const original = fixture(appearance);
    const normalized = normalizeThemeBackup(original);
    assert.deepEqual(normalized, original);
    assert.deepEqual(normalizeThemeBackup(JSON.parse(JSON.stringify(normalized))), original);
  }
  const collection = {
    format: "yt-waypoints-themes",
    version: 1,
    themes: [dark.theme, light.theme],
  };
  assert.deepEqual(normalizeThemeBackup(collection), collection);
  assert.deepEqual(normalizeThemeBackup({ ...collection, themes: [] }).themes, []);
  const sameName = clone(collection);
  sameName.themes[1].name = sameName.themes[0].name;
  assert.equal(normalizeThemeBackup(sameName).themes.length, 2, "Names are labels, not identity");
  assert.throws(
    () => normalizeThemeBackup({ ...collection, themes: [dark.theme, dark.theme] }),
    /duplicate theme ID/,
  );
  const original = clone(dark.theme);
  const normalized = normalizeTheme(original);
  normalized.colors.text = "#000000";
  normalized.source.palette.palette["1"] = "#000000";
  assert.deepEqual(
    original,
    dark.theme,
    "Normalization returns detached data without changing the source",
  );
  const uppercase = clone(dark.theme);
  uppercase.colors.text = "#ABCDEF";
  uppercase.colors.backdrop = "#ABCDEF80";
  assert.equal(normalizeTheme(uppercase).colors.text, "#abcdef");
  assert.equal(normalizeTheme(uppercase).colors.backdrop, "#abcdef80");
  assert.equal(normalizeTheme(light.theme).source.format, "iterm");
  const futureConverter = clone(dark.theme);
  futureConverter.source.converterVersion = 999;
  assert.deepEqual(
    normalizeTheme(futureConverter).colors,
    dark.theme.colors,
    "A newer converter revision does not invalidate saved resolved colors",
  );
  const missingSlots = clone(dark.theme);
  missingSlots.source.palette.palette = {};
  delete missingSlots.source.palette.selectionBackground;
  assert.deepEqual(normalizeTheme(missingSlots).source.palette.palette, {});
  console.log(
    "PASS: theme fixtures match both CSS role sets; single/collection backups round-trip resolved colors and provenance without mutation",
  );

  for (const value of [null, [], "theme", 1]) assert.throws(() => normalizeTheme(value));
  reject((value) => {
    value.version = 2;
  }, /unsupported backup version/);
  reject((value) => {
    value.version = "1";
  });
  reject((value) => {
    value.format = "yt-waypoints";
  }, /unsupported backup format/);
  reject((value) => {
    value.themes = [];
  });
  reject((value) => {
    delete value.theme;
  });
  reject((value) => {
    value.theme.id = "light";
  }, /invalid theme ID/);
  reject((value) => {
    value.theme.id = "theme:../../settings";
  });
  reject((value) => {
    value.theme.appearance = "system";
  });
  reject((value) => {
    value.theme.name = " ";
  });
  reject((value) => {
    value.theme.name = "x".repeat(THEME_LIMITS.nameCharacters + 1);
  });
  reject((value) => {
    value.theme.name = "bad\u0000name";
  });
  reject((value) => {
    delete value.theme.colors.text;
  }, /missing required field/);
  reject((value) => {
    value.theme.colors.width = "500px";
  }, /unexpected field/);
  for (const paint of [
    "red",
    "#abc",
    "#112233ff",
    "url(https://example.com)",
    "var(--color-text)",
    "#123456;display:none",
  ])
    reject((value) => {
      value.theme.colors.text = paint;
    });
  reject((value) => {
    value.theme.colors.backdrop = "#112233";
  });
  reject((value) => {
    value.theme.source.format = "css";
  });
  reject((value) => {
    value.theme.source.converterVersion = 0;
  });
  reject((value) => {
    value.theme.source.converterVersion = 1.5;
  });
  reject((value) => {
    delete value.theme.source.palette.background;
  });
  reject((value) => {
    value.theme.source.palette.foreground = "#11223380";
  });
  for (const key of ["256", "-1", "01", "__proto__"])
    reject((value) => {
      Object.defineProperty(value.theme.source.palette.palette, key, {
        value: "#112233",
        enumerable: true,
      });
    });
  for (const url of [
    "javascript:alert(1)",
    "http://example.com",
    "https://user:password@example.com",
    "https://example.com/a b",
  ])
    reject((value) => {
      value.theme.source.attribution.url = url;
    });
  reject((value) => {
    value.theme.source.attribution.notice = "x".repeat(THEME_LIMITS.noticeCharacters + 1);
  });
  console.log(
    "PASS: unsupported versions/fields, incomplete roles, CSS payloads, invalid palette values and provenance are rejected",
  );

  let accessed = false;
  for (const field of ["name", "colors", "source"]) {
    reject((value) => {
      Object.defineProperty(value.theme, field, {
        get() {
          accessed = true;
          throw Error("Getter invoked");
        },
        enumerable: true,
      });
    }, /data fields/);
  }
  reject((value) => {
    Object.defineProperty(value.theme.colors, "text", { value: "#112233", enumerable: false });
  });
  reject((value) => {
    value.theme[Symbol("extra")] = "hidden";
  });
  reject((value) => {
    Object.setPrototypeOf(value.theme, { inherited: true });
  });
  reject((value) => {
    value.theme.toJSON = () => {
      accessed = true;
    };
  });
  const polluted = JSON.parse(
    JSON.stringify(dark).replace('"appearance":', '"__proto__":{"polluted":true},"appearance":'),
  );
  assert.throws(() => normalizeThemeBackup(polluted), /unexpected field/);
  assert.equal({}.polluted, undefined);
  const accessorArray = [dark.theme];
  Object.defineProperty(accessorArray, "0", {
    get() {
      accessed = true;
    },
    enumerable: true,
  });
  assert.throws(
    () => normalizeThemeBackup({ ...collection, themes: accessorArray }),
    /collection entry/,
  );
  assert.throws(() => normalizeThemeBackup({ ...collection, themes: new Array(1) }));
  const extendedArray = [dark.theme];
  extendedArray.extra = 1;
  assert.throws(() => normalizeThemeBackup({ ...collection, themes: extendedArray }));
  assert.equal(accessed, false, "Validation does not invoke getters or toJSON");
  console.log(
    "PASS: accessor/symbol/hidden/prototype fields and sparse or extended arrays cannot enter the portable contract",
  );

  const many = Array.from({ length: THEME_LIMITS.themes }, (_, index) => {
    const theme = clone(dark.theme);
    theme.id = `theme:${index.toString(16).padStart(8, "0")}-1111-4111-8111-111111111111`;
    return theme;
  });
  assert.equal(normalizeThemeBackup({ ...collection, themes: many }).themes.length, 100);
  assert.throws(
    () => normalizeThemeBackup({ ...collection, themes: [...many, light.theme] }),
    /collection/,
  );
  for (const theme of many) {
    theme.source.palette.palette = Object.fromEntries(
      Array.from({ length: 256 }, (_, index) => [String(index), "#123456"]),
    );
    theme.source.attribution.notice = "😀".repeat(THEME_LIMITS.noticeCharacters / 2);
  }
  const large = { ...collection, themes: many };
  assert.ok(new TextEncoder().encode(JSON.stringify(large)).length > THEME_LIMITS.backupBytes);
  assert.throws(() => normalizeThemeBackup(large), /byte limit/);
  assert.equal(THEME_LIMITS.libraryBytes, THEME_LIMITS.backupBytes);
  console.log(
    "PASS: theme count and UTF-8 backup byte limits bound a collection independently of character counts",
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
