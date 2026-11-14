const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { readModule } = require("./runtime.cjs");
const metadataSource = readModule("popup-shortcuts.js");
function factoryFromSource(source) {
  return vm.runInNewContext(metadataSource + "\n" + source + "\nWAYPOINTS_CREATE_POPUP_INPUT");
}
const currentFactory = factoryFromSource(readModule("popup-input.js"));
const ID = "aaaaaaaaaaa";

function createRoutingFixture(profile = {}, factory = currentFactory) {
  const state = {
    editor: false,
    about: false,
    help: false,
    file: false,
    format: false,
    options: false,
    ...profile,
  };
  const log = [];
  const tasks = [];
  const settings = { scrubSeconds: 7, shiftMultiplier: 4, showThumbnails: false };
  const videos = { [ID]: { id: ID, t: 20, title: "Fixture" } };
  const doc = {
    activeElement: null,
    listeners: {},
    addEventListener(type, fn) {
      this.listeners[type] = fn;
    },
  };
  function node(name, tagName = "DIV", type = "", dataset = {}, main = false) {
    return {
      name,
      tagName,
      type,
      dataset,
      value: "",
      classList: { contains: (value) => main && value === "main" },
      events: {},
      addEventListener(type, fn) {
        this.events[type] = fn;
      },
      focus() {
        doc.activeElement = this;
        log.push(["focus", name]);
      },
      click() {
        log.push(["open", name]);
      },
    };
  }
  const nodes = {
    search: node("search", "INPUT", "text"),
    gear: node("gear", "BUTTON"),
    row: node("row", "DIV", "", { id: ID }, true),
    second: node("second", "DIV", "", { id: "bbbbbbbbbbb" }, true),
    slider: node("slider", "INPUT", "range", { id: ID }),
    settingSlider: node("settingSlider", "INPUT", "range"),
    checkbox: node("checkbox", "INPUT", "checkbox"),
    theme: node("theme", "SELECT"),
    deletion: node("deletion", "SELECT"),
    trashDays: node("trashDays", "INPUT", "number"),
    note: node("note", "TEXTAREA"),
    filename: node("filename", "INPUT", "text"),
    button: node("button", "BUTTON"),
    rowButton: node("rowButton", "BUTTON", "", { id: ID }),
    heading: node("heading", "SUMMARY"),
    editable: node("editable"),
  };
  nodes.editable.isContentEditable = true;
  const elements = {
    "theme-select": nodes.theme,
    "deletion-mode": nodes.deletion,
    "trash-days": nodes.trashDays,
    "help-dialog": {
      get open() {
        return state.help;
      },
    },
    "about-dialog": {
      get open() {
        return state.about;
      },
    },
  };
  doc.getElementById = (id) => elements[id];
  doc.activeElement = nodes[profile.active || "row"];
  const asyncAction =
    (name) =>
    (...args) => {
      log.push([name, ...args]);
      return Promise.resolve();
    };
  const close = (name, field) => () => {
    log.push([name]);
    state[field] = false;
  };
  const controller = factory({
    document: doc,
    transfer: {
      parse(text) {
        log.push(["parseJson", text]);
        if (text === "[bad") throw Error("Invalid JSON");
        return { payload: true };
      },
    },
    player: {
      parseVideoLink(text) {
        return text.startsWith("https://youtu.be/") ? { id: ID, t: 90 } : null;
      },
      linkFor: (video) => `https://www.youtube.com/watch?v=${video.id}&t=${video.t}s`,
      navigateVideo: asyncAction("navigate"),
    },
    actions: {
      loadSnapshot: async () => ({ videos }),
      importVideos: asyncAction("import"),
      deleteVideo: asyncAction("delete"),
      controlPlayback: asyncAction("playback"),
      togglePlay: asyncAction("play"),
      scrub: asyncAction("scrub"),
    },
    dialogs: {
      get helpOpen() {
        return state.help;
      },
      get aboutOpen() {
        return state.about;
      },
      closeAbout: close("closeAbout", "about"),
      closeHelp: close("closeHelp", "help"),
      openHelp() {
        state.help = true;
        log.push(["openHelp"]);
      },
    },
    exportsController: {
      get fileSaveOpen() {
        return state.file;
      },
      closeFileSave: close("closeFile", "file"),
      copyVideos: asyncAction("copyVideos"),
      copyText: asyncAction("copyText"),
      exportTranscript: asyncAction("transcript"),
      handleFormatKey(e) {
        if (!state.format) return false;
        log.push(["format", e.key]);
        if (e.ctrlKey || e.altKey || e.metaKey) return true;
        if (["Escape", "Tab"].includes(e.key)) {
          state.format = false;
          if (e.key === "Escape") e.preventDefault();
        } else if (
          ["ArrowUp", "ArrowDown", "Home", "End", "Enter", " "].includes(e.key) &&
          !e.ctrlKey &&
          !e.altKey &&
          !e.metaKey
        )
          e.preventDefault();
        return true;
      },
    },
    listController: {
      renderList() {
        log.push(["render"]);
      },
      focusables: () => [nodes.search, nodes.row, nodes.second],
      setPendingFocusIndex: (index) => log.push(["pendingFocus", index]),
    },
    markers: {
      get editorOpen() {
        return state.editor;
      },
      saveEditor: asyncAction("saveNote"),
      closeEditor: asyncAction("closeNote"),
      toggle: asyncAction("marker"),
      edit: asyncAction("annotation"),
      navigate: asyncAction("markerNavigation"),
    },
    getSettings: () => settings,
    getVideos: () => videos,
    getTrash: () => (state.trash ? { [ID]: videos[ID] } : {}),
    searchEl: nodes.search,
    clearSearchEl: node("clear", "BUTTON"),
    optionsToggle: nodes.gear,
    isOptionsOpen: () => state.options,
    setOptionsOpen(open) {
      state.options = open;
      log.push(["settings", open]);
    },
    requestSearch() {
      log.push(["requestSearch"]);
    },
    updateHeaderMode() {
      log.push(["header"]);
    },
    escapeClosesPopup: Boolean(profile.firefox),
    enqueue(fn) {
      const task = Promise.resolve().then(fn);
      tasks.push(task);
      return task;
    },
    setThumbnails(show) {
      log.push(["thumbnails", show]);
      settings.showThumbnails = show;
      return Promise.resolve();
    },
    toggleMarkers: asyncAction("markerVisibility"),
    setStatus: (message) => log.push(["status", message]),
    closePopup: () => log.push(["closePopup"]),
  });
  controller.installKeyboard();
  controller.initControls();
  async function settle() {
    for (let i = 0; i < 10; i++) await Promise.resolve();
    await Promise.all(tasks);
  }
  function keyboardEvent(key, extra = {}) {
    return {
      key,
      defaultPrevented: false,
      prevented: 0,
      stopped: 0,
      target: nodes[state.target || state.active || "row"],
      preventDefault() {
        this.defaultPrevented = true;
        this.prevented++;
      },
      stopPropagation() {
        this.stopped++;
      },
      ...extra,
    };
  }
  const snapshot = (e) =>
    JSON.parse(
      JSON.stringify({
        log,
        prevented: e.prevented,
        stopped: e.stopped,
        active: doc.activeElement?.name,
        state: {
          editor: state.editor,
          about: state.about,
          help: state.help,
          file: state.file,
          format: state.format,
          options: state.options,
        },
        search: nodes.search.value,
      }),
    );
  return {
    log,
    nodes,
    state,
    async key(key, extra = {}) {
      const e = keyboardEvent(key, extra);
      doc.listeners.keydown(e);
      await settle();
      return snapshot(e);
    },
    async keyup(key, extra = {}) {
      const e = keyboardEvent(key, extra);
      doc.listeners.keyup(e);
      await settle();
      return snapshot(e);
    },
    async paste(text, extra = {}) {
      const e = keyboardEvent("paste", { clipboardData: { getData: () => text }, ...extra });
      doc.listeners.paste(e);
      await settle();
      return snapshot(e);
    },
  };
}

async function run() {
  const shortcuts = vm.runInNewContext(metadataSource + "\nWAYPOINTS_SHORTCUTS");
  assert.ok(Object.isFrozen(shortcuts) && Object.isFrozen(shortcuts.definitions));
  for (const definition of Object.values(shortcuts.definitions))
    assert.ok(Object.isFrozen(definition) && Object.isFrozen(definition.keys));
  assert.equal(shortcuts.matches("markerToggle", "m"), true);
  assert.equal(shortcuts.matches("markerToggle", "M"), false);
  assert.equal(shortcuts.matches("markerVisibility", "M"), true);
  assert.equal(shortcuts.matches("transcript", "t"), false);
  for (const key of ["h", "H", "?"]) assert.equal(shortcuts.matches("help", key), true);
  assert.equal(shortcuts.label("settings"), "*");
  assert.equal(shortcuts.label("help"), "h / ?");
  assert.throws(() => shortcuts.matches("toString", "x"), /Unknown popup shortcut/);
  const html = fs.readFileSync(path.join(__dirname, "../src/entrypoints/popup.html"), "utf8");
  const labels = [...html.matchAll(/data-shortcut-label="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(labels.length, 22);
  assert.equal(new Set(labels).size, 22);
  for (const name of labels) assert.ok(shortcuts.label(name));
  console.log(
    "PASS: immutable shortcut metadata shares exact-case keys and all 22 Help labels without context/dispatch rules",
  );

  const cases = [
    [{}, "m", {}, "marker", true],
    [{}, "M", {}, "markerVisibility", true],
    [{}, "a", {}, "annotation", true],
    [{}, "[", {}, "markerNavigation", true],
    [{}, "]", {}, "markerNavigation", true],
    [{}, "T", {}, "transcript", true],
    [{}, "t", {}, "thumbnails", true],
    [{}, "c", {}, "copyVideos", true],
    [{}, "C", {}, "copyVideos", true],
    [{}, "u", {}, "copyText", true],
    [{}, " ", {}, "play", true],
    [{}, "ArrowRight", { shiftKey: true }, "scrub", true],
    [{}, ">", {}, "playback", true],
    [{ active: "search" }, "m", {}, null, false],
    [{ active: "search" }, "*", { shiftKey: true }, null, false],
    [{ active: "search" }, "/", {}, null, false],
    [{ active: "search" }, "ArrowDown", {}, "focus", true],
    [{ active: "slider" }, "ArrowRight", {}, null, false],
    [{ target: "slider" }, "ArrowLeft", {}, null, false],
    [{ options: true, active: "settingSlider" }, "ArrowRight", {}, null, false],
    [{ options: true, active: "theme" }, "h", {}, null, false],
    [{ options: true, active: "theme" }, "*", {}, "settings", true],
    [{ options: true, active: "checkbox" }, "*", { code: "NumpadMultiply" }, "settings", true],
    [{ options: true, active: "checkbox" }, "t", {}, null, false],
    [{ active: "note", editor: true }, "m", {}, null, false],
    [{ active: "note", editor: true }, "Enter", { ctrlKey: true }, "saveNote", true],
    [{ active: "note", editor: true }, "Enter", { metaKey: true }, "saveNote", true],
    [{ active: "note", editor: true }, "Enter", { ctrlKey: true, altKey: true }, "saveNote", true],
    [{ active: "note", editor: true }, "Enter", { ctrlKey: true, repeat: true }, null, false],
    [{ active: "note", editor: true }, "Escape", {}, "closeNote", true],
    [{ active: "note", editor: true, firefox: true }, "Escape", {}, null, false],
    [{ about: true, active: "button" }, "*", {}, null, false],
    [{ about: true, active: "button" }, "Escape", {}, "closeAbout", true],
    [{ help: true, active: "button" }, "M", {}, null, false],
    [{ help: true, active: "button" }, "H", {}, "closeHelp", true],
    [{ help: true, active: "button" }, "Escape", {}, "closeHelp", true],
    [{ help: true, active: "button", firefox: true }, "Escape", {}, null, false],
    [{ editor: true, help: true, active: "button" }, "Enter", { ctrlKey: true }, null, false],
    [{ file: true, active: "filename" }, "Escape", {}, null, false],
    [{ file: true, active: "button", firefox: true }, "Escape", {}, "closeFile", true],
    [{ file: true, active: "button" }, "*", {}, null, false],
    [{ format: true, options: true, active: "button" }, "*", {}, "settings", true],
    [
      { format: true, options: true, active: "button", firefox: true },
      "Escape",
      {},
      "format",
      true,
    ],
    [{ trash: true }, "m", {}, null, false],
    [{ trash: true }, "Delete", {}, "delete", true],
    [{}, "m", { repeat: true }, null, true],
    [{}, " ", { repeat: true }, "play", true],
    [{}, "*", { shiftKey: true, code: "Digit8" }, "settings", true],
  ];
  for (const [profile, key, extra, expected, prevented] of cases) {
    const result = await createRoutingFixture(profile).key(key, extra);
    assert.equal(
      result.log[0]?.[0] || null,
      expected,
      JSON.stringify({ profile, key, extra, result }),
    );
    assert.equal(result.prevented > 0, prevented, JSON.stringify({ profile, key, extra, result }));
  }
  for (const modifier of ["ctrlKey", "altKey", "metaKey", "isComposing"])
    for (const key of ["m", "M", "*", "t", "T", "c", "C", "u", " ", "ArrowRight"]) {
      const result = await createRoutingFixture().key(key, { [modifier]: true });
      assert.equal(result.log.length, 0);
      assert.equal(result.prevented, 0);
    }
  const held = createRoutingFixture({ help: true, active: "button" });
  assert.equal((await held.key("Escape")).prevented, 1);
  assert.equal((await held.key("Escape", { repeat: true })).prevented, 1);
  assert.equal((await held.keyup("Escape")).prevented, 1);
  assert.equal((await held.key("Escape")).prevented, 0);
  console.log(
    "PASS: explicit context precedence preserves editing/modal/native controls, Settings priority, repeats, modifiers and held Escape",
  );

  for (const blocked of [{ editor: true }, { help: true }, { about: true }, { file: true }]) {
    const result = await createRoutingFixture(blocked).paste('{"videos":{}}');
    assert.equal(result.log.length, 0);
    assert.equal(result.prevented, 0);
  }
  const plain = await createRoutingFixture({ active: "search" }).paste("ordinary text");
  assert.equal(plain.prevented, 0);
  const imported = await createRoutingFixture().paste('{"videos":{}}');
  assert.equal(imported.prevented, 1);
  assert.equal(imported.log.at(-1)[0], "import");
  const invalid = await createRoutingFixture().paste("[bad");
  assert.equal(invalid.log.at(-1)[0], "status");
  const linked = await createRoutingFixture().paste("https://youtu.be/aaaaaaaaaaa");
  assert.equal(linked.log.at(-1)[0], "closePopup");
  console.log(
    "PASS: paste stays independent of command routing and preserves modal/editor, text, JSON and sanitized-link paths",
  );
}
module.exports = { createRoutingFixture, factoryFromSource };
if (require.main === module)
  run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
