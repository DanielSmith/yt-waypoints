const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const clone = (value) => structuredClone(value);
async function main() {
  const {
    createThemeLibrary,
    THEME_LIBRARY_KEY: key,
    parseThemeBackup,
    serializeThemeBackup,
  } = await import("../src/shared/theme-library.mjs");
  const dark = JSON.parse(
    fs.readFileSync(path.join(__dirname, "fixtures/themes/dark.waypoints-theme.json")),
  ).theme;
  const light = JSON.parse(
    fs.readFileSync(path.join(__dirname, "fixtures/themes/light.waypoints-theme.json")),
  ).theme;
  let data = {
      settings: { theme: "dark", showMarkers: false, scrubSeconds: 15 },
      videos: { saved: { t: 42 } },
    },
    writes = 0,
    fail = false;
  let tail = Promise.resolve();
  const locks = {
    request(name, task) {
      assert.equal(name, "yt-waypoints-theme-library-v1");
      const pending = tail.then(task);
      tail = pending.catch(() => {});
      return pending;
    },
  };
  const api = {
    storage: {
      local: {
        async get(keys) {
          return clone(Object.fromEntries(keys.map((name) => [name, data[name]])));
        },
        async set(changes) {
          if (fail) throw Error("Quota unavailable");
          writes++;
          Object.assign(data, clone(changes));
        },
      },
    },
  };
  const store = createThemeLibrary(api, { locks });
  const second = createThemeLibrary(api, { locks });
  assert.deepEqual(await store.read(), { themes: [], selected: "dark" });
  const bookmark = clone(data.videos);
  await store.save(dark, { select: true });
  assert.equal((await store.read()).selected, dark.id);
  assert.equal(data.settings.scrubSeconds, 15);
  assert.deepEqual(data.videos, bookmark);
  const single = await store.export(dark.id);
  assert.deepEqual(parseThemeBackup(single).theme, dark);
  const beforeDuplicate = writes;
  await store.restore(single);
  assert.equal(writes, beforeDuplicate, "Identical content is skipped without a write");
  await Promise.all([
    store.save(light),
    second.save({ ...dark, id: "theme:11111111-1111-4111-8111-111111111111", name: "third" }),
  ]);
  assert.equal((await store.read()).themes.length, 3, "Concurrent contexts retain disjoint saves");
  const changed = { ...dark, name: "changed", colors: { ...dark.colors, text: "#010203" } };
  let before = clone(data),
    beforeWrites = writes;
  await assert.rejects(
    store.restore({
      format: "yt-waypoints-themes",
      version: 1,
      themes: [{ ...light, id: "theme:22222222-1111-4111-8111-111111111111" }, changed],
    }),
    /already exists/,
  );
  assert.deepEqual(
    data,
    before,
    "A conflict late in a collection cannot partially restore earlier entries",
  );
  assert.equal(writes, beforeWrites);
  await store.save(changed, { conflict: "replace" });
  assert.deepEqual(
    (await store.read()).themes.find((item) => item.id === dark.id),
    changed,
  );
  await store.save(dark, { conflict: "keep-both", select: true });
  const state = await store.read();
  assert.equal(state.themes.length, 4);
  const copied = state.themes.find((item) => item.id === state.selected);
  assert.notEqual(copied.id, dark.id);
  assert.deepEqual(copied.colors, dark.colors);
  assert.equal(copied.source.converterVersion, dark.source.converterVersion);
  await store.remove(copied.id);
  assert.equal((await store.read()).selected, "system");
  assert.equal((await store.read()).themes.length, 3);
  await store.select(light.id);
  // A non-theme preference saved from a stale popup must retain the latest selection.
  await second.persistSettings({ theme: "dark", showMarkers: true, scrubSeconds: 15 }, [
    "showMarkers",
  ]);
  assert.equal(data.settings.theme, light.id);
  assert.equal(data.settings.showMarkers, true);
  const backup = await store.export();
  assert.equal(parseThemeBackup(backup).themes.length, 3);
  const exact = parseThemeBackup(backup);
  assert.deepEqual(parseThemeBackup(serializeThemeBackup(exact.themes)), exact);
  before = clone(data);
  fail = true;
  await assert.rejects(store.remove(light.id), /Quota/);
  await assert.rejects(
    store.save({ ...light, id: "theme:33333333-1111-4111-8111-111111111111" }),
    /Quota/,
  );
  assert.deepEqual(data, before, "Failed writes preserve library and selection");
  fail = false;
  for (const invalid of [
    "not json",
    "x".repeat(1048577),
    { format: "yt-waypoints-themes", version: 2, themes: [] },
    { format: "yt-waypoints-themes", version: 1, themes: [dark, { ...light, colors: {} }] },
  ]) {
    await assert.rejects(store.restore(invalid));
    assert.deepEqual(data, before, "Invalid backups fail atomically");
  }
  await assert.rejects(store.select("theme:../../settings"), /Unknown/);
  data.settings.theme = "theme:retired";
  assert.equal((await store.read()).selected, "system");
  data[key] = { version: 999 };
  await assert.rejects(store.read());
  before = clone(data);
  await assert.rejects(store.save(dark));
  assert.deepEqual(data, before, "Corrupt libraries are not silently overwritten");
  await store.reset();
  assert.equal(data.settings.theme, "system");
  assert.deepEqual(
    data[key],
    before[key],
    "Reset recovers selection without discarding corrupt user data",
  );
  const unsupported = createThemeLibrary(api, { locks: null });
  await assert.rejects(unsupported.save(dark), /Web Locks/);
  await unsupported.reset();
  data[key] = {
    format: "yt-waypoints-themes",
    version: 1,
    themes: Array.from({ length: 100 }, (_, index) => ({
      ...dark,
      id: `theme:${index.toString(16).padStart(8, "0")}-1111-4111-8111-111111111111`,
    })),
  };
  before = clone(data);
  await assert.rejects(
    store.save({ ...light, id: "theme:ffffffff-1111-4111-8111-111111111111" }),
    /collection/,
  );
  assert.deepEqual(data, before, "Count bounds apply to the merged library");
  const large = (index) => ({
    ...dark,
    id: `theme:${index.toString(16).padStart(8, "0")}-2222-4222-8222-222222222222`,
    source: {
      ...dark.source,
      palette: {
        ...dark.source.palette,
        palette: Object.fromEntries(
          Array.from({ length: 256 }, (_, slot) => [String(slot), "#123456"]),
        ),
      },
      attribution: { notice: "😀".repeat(2048) },
    },
  });
  data[key] = {
    format: "yt-waypoints-themes",
    version: 1,
    themes: Array.from({ length: 60 }, (_, index) => large(index)),
  };
  assert.equal((await store.read()).themes.length, 60);
  before = clone(data);
  await assert.rejects(
    store.restore({
      format: "yt-waypoints-themes",
      version: 1,
      themes: Array.from({ length: 30 }, (_, index) => large(index + 60)),
    }),
    /byte limit/,
  );
  assert.deepEqual(
    data,
    before,
    "UTF-8 byte bounds apply atomically to a merged library below the count cap",
  );
  assert.deepEqual(data.videos, bookmark, "No theme operation changes bookmark data");
  console.log(
    "PASS: bounded theme library, exact backups, atomic conflicts/failures, explicit replace/keep-both, selected removal/reset, concurrent saves and stale-settings protection",
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
