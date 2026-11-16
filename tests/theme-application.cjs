const fs = require("node:fs"),
  vm = require("node:vm"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const flavor = process.argv[2] || "chrome";
const source = fs.readFileSync(path.join(__dirname, `../yt-waypoints-${flavor}/theme.js`), "utf8");
const dark = JSON.parse(
  fs.readFileSync(path.join(__dirname, "fixtures/themes/dark.waypoints-theme.json")),
).theme;
const light = JSON.parse(
  fs.readFileSync(path.join(__dirname, "fixtures/themes/light.waypoints-theme.json")),
).theme;
const key = "waypoints.themes.v1";
let data = { settings: { theme: "dark", autoBookmark: false }, videos: { preserved: { t: 71 } } },
  writes = 0,
  fail = false;
const listeners = [];
let holdNextWrite = false,
  releaseWrite;
let tail = Promise.resolve();
const locks = {
  request(name, callback) {
    const next = tail.then(callback);
    tail = next.catch(() => {});
    return next;
  },
};
function client({ pending = false } = {}) {
  let context,
    release,
    firstRead = true;
  const values = {},
    root = {
      dataset: {},
      style: {
        setProperty(name, value) {
          values[name] = value;
        },
        removeProperty(name) {
          delete values[name];
        },
      },
    };
  const media = {
    matches: false,
    addEventListener(type, fn) {
      this.listener = fn;
    },
  };
  const local = {
    async get(keys) {
      const raw = JSON.stringify(Object.fromEntries(keys.map((name) => [name, data[name]])));
      if (pending && firstRead) {
        firstRead = false;
        await new Promise((resolve) => {
          release = resolve;
        });
      }
      return vm.runInContext(`JSON.parse(${JSON.stringify(raw)})`, context);
    },
    async set(changes) {
      if (fail) throw Error("Storage failed");
      if (holdNextWrite) {
        holdNextWrite = false;
        await new Promise((resolve) => {
          releaseWrite = resolve;
        });
      }
      writes++;
      const clean = JSON.parse(JSON.stringify(changes));
      Object.assign(data, clean);
      for (const fn of listeners)
        fn(
          Object.fromEntries(Object.keys(clean).map((name) => [name, { newValue: clean[name] }])),
          "local",
        );
    },
  };
  context = vm.createContext({
    document: { documentElement: root },
    TextEncoder,
    URL,
    crypto: require("node:crypto").webcrypto,
    navigator: { locks },
    matchMedia: () => media,
    [flavor === "firefox" ? "browser" : "chrome"]: {
      storage: { local, onChanged: { addListener: (fn) => listeners.push(fn) } },
    },
  });
  vm.runInContext(source, context);
  return {
    api: context.WAYPOINTS_THEME,
    root,
    values,
    media,
    input: (value) =>
      vm.runInContext(`JSON.parse(${JSON.stringify(JSON.stringify(value))})`, context),
    release: () => release(),
  };
}
const flush = async () => {
  for (let n = 0; n < 50; n++) await Promise.resolve();
};
async function main() {
  const first = client();
  await first.api.ready;
  assert.equal(first.root.dataset.theme, "dark");
  await first.api.save(first.input(dark), { select: true });
  for (const [role, value] of Object.entries(dark.colors))
    assert.equal(first.values[`--color-${role}`], value);
  assert.equal(first.values["color-scheme"], "dark");
  const reopened = client();
  await reopened.api.ready;
  assert.equal(
    reopened.values["--color-text"],
    dark.colors.text,
    "Selected palette survives reopen",
  );
  await reopened.api.save(reopened.input(light));
  await first.api.preview(first.input(light));
  const beforePreviewWrites = writes;
  await reopened.api.select("dark");
  await flush();
  assert.equal(
    first.values["--color-text"],
    light.colors.text,
    "External changes do not discard an unsaved preview",
  );
  assert.equal(writes, beforePreviewWrites + 1);
  await first.api.cancelPreview();
  assert.equal(
    Object.keys(first.values).length,
    0,
    "Cancelling clears every custom override and returns to latest selection",
  );
  assert.equal(first.root.dataset.theme, "dark");
  const unsafe = structuredClone(light);
  unsafe.colors.surface = "url(https://example.com)";
  await assert.rejects(first.api.preview(first.input(unsafe)));
  assert.equal(Object.keys(first.values).length, 0);
  await first.api.select(dark.id);
  await flush();
  assert.equal(
    reopened.values["--color-text"],
    dark.colors.text,
    "Another popup follows selection changes",
  );
  await reopened.api.remove(dark.id);
  await flush();
  assert.equal(
    first.root.dataset.theme,
    "light",
    "Selected removal returns to current System appearance",
  );
  assert.equal(Object.keys(first.values).length, 0);
  first.media.matches = true;
  first.media.listener();
  assert.equal(first.root.dataset.theme, "dark");
  await first.api.select(light.id);
  first.media.matches = false;
  first.media.listener();
  assert.equal(
    first.values["--color-text"],
    light.colors.text,
    "Custom themes ignore System changes",
  );
  const snapshot = JSON.stringify(data);
  fail = true;
  await assert.rejects(first.api.remove(light.id), /Storage failed/);
  assert.equal(JSON.stringify(data), snapshot);
  assert.equal(first.values["--color-text"], light.colors.text);
  fail = false;
  const backup = JSON.parse(await first.api.export(light.id));
  assert.deepEqual(backup.theme, light);
  holdNextWrite = true;
  const saving = first.api.save(
    first.input({
      ...dark,
      id: "theme:aaaaaaaa-1111-4111-8111-111111111111",
      name: "Delayed save",
    }),
    { select: true },
  );
  await flush();
  assert.equal(typeof releaseWrite, "function");
  await first.api.preview(first.input(light));
  releaseWrite();
  await saving;
  assert.equal(
    first.values["--color-text"],
    light.colors.text,
    "A late save cannot discard a newer preview",
  );
  await first.api.cancelPreview();
  assert.equal(
    first.values["--color-text"],
    dark.colors.text,
    "Cancel follows the newly persisted theme after a held save",
  );
  const racing = client({ pending: true });
  racing.api.apply("dark");
  racing.release();
  await racing.api.ready;
  assert.equal(
    racing.root.dataset.theme,
    "dark",
    "Late startup read cannot replace explicit apply",
  );
  data[key] = { version: 500 };
  for (const fn of listeners) fn({ [key]: { newValue: data[key] } }, "local");
  await flush();
  assert.equal(
    Object.keys(first.values).length,
    0,
    "Invalid external library cannot leave stale custom CSS",
  );
  await first.api.reset();
  assert.equal(data.settings.theme, "system");
  assert.deepEqual(data.videos, { preserved: { t: 71 } });
  console.log(
    `PASS: ${flavor} complete palette/reopen, cross-popup updates, unsaved preview/cancel, unsafe CSS rejection, System/reset/removal and late-startup protection`,
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
