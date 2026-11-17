const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
async function main() {
  const { createThemeImportController } = await import("../src/shared/popup-theme-import.mjs");
  const { createThemeLibrary, THEME_LIBRARY_KEY } = await import("../src/shared/theme-library.mjs");
  const { normalizeTheme } = await import("../src/shared/theme-data.mjs");
  const fixtures = ["dark", "light"].map(
    (name) =>
      JSON.parse(
        fs.readFileSync(path.join(__dirname, `fixtures/themes/${name}.waypoints-theme.json`)),
      ).theme,
  );
  let data = {
      settings: { theme: "dark", offerSaveFile: false },
      videos: { unchanged: { t: 15 } },
    },
    fail = false,
    writes = 0;
  const listeners = [],
    downloads = [],
    timers = [],
    blobs = [];
  const api = {
    storage: {
      local: {
        async get(keys) {
          return structuredClone(Object.fromEntries(keys.map((key) => [key, data[key]])));
        },
        async set(changes) {
          if (fail) throw Error("Storage unavailable");
          writes++;
          Object.assign(data, structuredClone(changes));
        },
      },
    },
  };
  const store = createThemeLibrary(api, { locks: { request: (name, action) => action() } });
  let state = await store.read(),
    visible = null;
  const update = async () => {
    state = await store.read();
    listeners.forEach((listener) => listener(state.selected));
  };
  const service = {
    get choices() {
      return [
        { id: "system" },
        { id: "light" },
        { id: "dark" },
        ...state.themes.map((theme) => ({ id: theme.id, name: theme.name, label: theme.name })),
      ];
    },
    subscribe(fn) {
      listeners.push(fn);
    },
    async preview(theme) {
      visible = normalizeTheme(theme);
    },
    async cancelPreview() {
      visible = null;
      await update();
    },
    async save(theme, options) {
      const result = await store.save(theme, options);
      await update();
      return result;
    },
    async restore(input, options) {
      const result = await store.restore(input, options);
      await update();
      return result;
    },
    async remove(id) {
      const result = await store.remove(id);
      await update();
      return result;
    },
    async reset() {
      await store.reset();
      await update();
    },
    export: (id) => store.export(id),
  };
  class Element {
    constructor(tag) {
      this.tag = tag;
      this.value = "";
      this.textContent = "";
      this.children = [];
      this.events = {};
      this.hidden = false;
      this.classes = new Set();
      this.classList = {
        toggle: (name, value) => (value ? this.classes.add(name) : this.classes.delete(name)),
        add: (name) => this.classes.add(name),
        remove: (name) => this.classes.delete(name),
      };
    }
    addEventListener(type, fn) {
      this.events[type] = fn;
    }
    append(item) {
      this.children.push(item);
    }
    replaceChildren(...items) {
      this.children = items;
    }
    focus() {
      doc.activeElement = this;
    }
    click() {
      if (this.tag === "a") downloads.push({ filename: this.download, url: this.href });
      else return this.events.click?.();
    }
    remove() {}
  }
  const nodes = {},
    doc = {
      getElementById: (id) => (nodes[id] ||= new Element()),
      createElement: (tag) => new Element(tag),
      body: new Element("body"),
    };
  const $ = doc.getElementById;
  const controller = createThemeImportController({
    document: doc,
    service,
    getSelection: () => state.selected,
    setStatus() {},
  });
  controller.init();
  const source = "background=#20242a\nforeground=#f0f0f0\npalette=4=#5591dd\n";
  const file = (text, name = "comparison.ghostty") => ({
    name,
    size: new TextEncoder().encode(text).length,
    arrayBuffer: async () => new TextEncoder().encode(text).buffer,
    slice: (a, b) => ({ text: async () => text.slice(a, b) }),
  });
  const originalVideos = structuredClone(data.videos);
  await controller.loadFile(file(source));
  assert.equal(writes, 0);
  assert.ok(visible && !$("theme-import-preview").hidden);
  assert.equal($("theme-import-save").textContent, "Save and use");
  $("theme-import-name").value = "";
  await $("theme-import-name").events.change();
  assert.equal($("theme-import-save").disabled, true);
  assert.equal(visible, null, "Invalid draft clears its preview");
  assert.equal(
    $("theme-import-notes").textContent,
    "",
    "Invalid draft cannot retain a successful contrast report",
  );
  $("theme-import-name").value = "comparison";
  await $("theme-import-name").events.change();
  $("theme-import-appearance").value = "light";
  await $("theme-import-appearance").events.change();
  assert.equal(visible.appearance, "light");
  await controller.cancel();
  assert.equal(data.settings.theme, "dark");
  assert.equal(visible, null);
  assert.equal(writes, 0, "Preview and cancel write nothing");
  await controller.loadFile(file(source));
  fail = true;
  await $("theme-import-save").click();
  assert.equal(data[THEME_LIBRARY_KEY], undefined);
  assert.ok($("theme-message").textContent.includes("Storage unavailable"));
  assert.equal($("theme-import-preview").hidden, false, "Failed save keeps a retryable draft");
  fail = false;
  await $("theme-import-save").click();
  const selected = state.selected;
  assert.equal(state.themes.length, 1);
  assert.ok(selected.startsWith("theme:"));
  assert.equal($("theme-import-preview").hidden, true);
  const native = { format: "yt-waypoints-themes", version: 1, themes: fixtures };
  await controller.loadFile(file(JSON.stringify(native), "backup.json"));
  assert.equal($("theme-import-appearance-label").hidden, true);
  assert.equal($("theme-import-save").textContent, "Restore themes");
  await $("theme-import-save").click();
  assert.equal(state.selected, selected, "Native restore never switches selection");
  assert.deepEqual(
    state.themes.find((theme) => theme.id === fixtures[0].id),
    fixtures[0],
  );
  const conflict = {
    format: "yt-waypoints-theme",
    version: 1,
    theme: { ...fixtures[0], name: "Changed" },
  };
  await controller.loadFile(file(JSON.stringify(conflict), "conflict.json"));
  const count = state.themes.length;
  await $("theme-import-save").click();
  assert.equal(state.themes.length, count);
  assert.ok($("theme-message").textContent.includes("already exists"));
  $("theme-import-conflict").value = "keep-both";
  await $("theme-import-save").click();
  assert.equal(state.themes.length, count + 1);
  assert.equal(state.selected, selected);
  const beforeInvalid = writes;
  await controller.loadFile(file("invalid file"));
  assert.equal(writes, beforeInvalid);
  assert.equal($("theme-import-preview").hidden, true);
  await controller.loadFile({
    name: "huge",
    size: 1048577,
    arrayBuffer() {
      throw Error("Should not read oversize data");
    },
  });
  assert.ok($("theme-message").textContent.includes("1 MiB"));
  await controller.loadFile(file(JSON.stringify({ ...native, themes: [] }), "empty.json"));
  assert.ok($("theme-message").textContent.includes("empty"));
  let release;
  const pending = controller.loadFile({
    ...file(source),
    arrayBuffer: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  });
  for (let i = 0; i < 50 && !release; i++) await Promise.resolve();
  assert.equal(typeof release, "function");
  await controller.cancel();
  release(new TextEncoder().encode(source).buffer);
  await pending;
  assert.equal(
    $("theme-import-preview").hidden,
    true,
    "Late file reads cannot reopen a cancelled draft",
  );
  const originalCreate = URL.createObjectURL,
    originalRevoke = URL.revokeObjectURL,
    originalTimeout = global.setTimeout;
  try {
    URL.createObjectURL = (blob) => {
      blobs.push(blob);
      return originalCreate(blob);
    };
    global.setTimeout = (fn) => {
      timers.push(fn);
    };
    await $("theme-export").click();
    await $("theme-backup").click();
    assert.equal(downloads.length, 2);
    assert.ok(downloads[0].filename.endsWith(".waypoints-theme.json"));
    assert.ok(downloads[1].filename.endsWith(".waypoints-themes.json"));
    assert.equal(JSON.parse(await blobs[0].text()).theme.id, selected);
    assert.equal(JSON.parse(await blobs[1].text()).themes.length, state.themes.length);
    assert.equal(timers.length, 2, "Each direct download schedules URL cleanup");
    timers.forEach((fn) => fn());
    URL.createObjectURL = () => {
      throw Error("Download unavailable");
    };
    await $("theme-backup").click();
    assert.ok($("theme-message").textContent.includes("Download unavailable"));
  } finally {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
    global.setTimeout = originalTimeout;
  }
  await $("theme-remove").click();
  assert.equal(state.selected, "system");
  assert.equal(
    state.themes.some((theme) => theme.id === selected),
    false,
  );
  const savedCount = state.themes.length;
  await $("theme-reset").click();
  assert.equal(state.themes.length, savedCount, "System reset retains saved palettes");
  assert.deepEqual(data.videos, originalVideos);
  let opened = 0,
    localPickerClicks = 0;
  $("theme-file").click = () => {
    localPickerClicks++;
  };
  const routed = createThemeImportController({
    document: doc,
    service,
    getSelection: () => state.selected,
    setStatus() {},
    openPicker: async () => {
      opened++;
    },
  });
  routed.init();
  await $("theme-import").click();
  assert.equal(opened, 1);
  assert.equal(
    localPickerClicks,
    0,
    "A routed picker never opens a native dialog in the transient popup",
  );
  assert.ok($("theme-import").textContent.includes("tab"));
  console.log(
    "PASS: theme import UI preview/cancel, appearance override, save retry, native collection/conflicts, bounded/stale reads, independent downloads, remove/reset and bookmark preservation",
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
