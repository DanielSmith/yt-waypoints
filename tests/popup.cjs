const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const path = require("node:path");
const { readBundle } = require("./runtime.cjs");
const flavor = process.argv[2] || "firefox";
const extension = path.resolve(__dirname, "../yt-waypoints-" + flavor);
// Load the production script list in order, so new module wiring is tested.
const popupScripts = [
  ...fs
    .readFileSync(path.join(extension, "popup.html"), "utf8")
    .matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g),
].map((match) => match[1]);
async function createPopupFixture(
  initial = {},
  url = "https://www.youtube.com/watch?v=aaaaaaaaaaa",
  behavior = {},
) {
  const data = structuredClone(initial);
  const listeners = [];
  const themeListeners = [];
  const themeMedia = {
    matches: !!behavior.dark,
    addEventListener: (event, fn) => themeListeners.push(fn),
  };
  let writes = 0;
  let closeCount = 0;

  const navigation = [];
  const executions = [];
  const clipboardWrites = [];
  const downloads = [];
  const timers = [];
  const doc = {
    activeElement: null,
    listeners: {},
    addEventListener(t, fn) {
      this.listeners[t] = fn;
    },
  };
  class FakeElement {
    constructor(tag = "div") {
      this.tag = tag;
      this.children = [];
      this.dataset = {};
      this.style = {
        setProperty(name, value) {
          this[name] = value;
        },
      };
      this.events = {};
      this.hidden = false;
      this.disabled = true;
      this.value = "";
      this.className = "";
      this.classList = {
        contains: (n) => this.className.split(" ").includes(n),
        toggle: () => {},
        add: () => {},
        remove: () => {},
      };
    }
    showModal() {
      this.open = true;
      els["help-close"].focus();
    }
    close() {
      this.open = false;
    }
    addEventListener(t, fn) {
      this.events[t] = fn;
    }
    setAttribute(k, v) {
      this[k] = v;
    }
    append(...els) {
      for (const el of els) {
        el.remove();
        el.parentNode = this;
      }
      this.children.push(...els);
    }
    contains(el) {
      return el === this || this.children.some((child) => child.contains(el));
    }
    remove() {
      if (this.parentNode)
        this.parentNode.children = this.parentNode.children.filter((el) => el !== this);
    }
    replaceChildren(...els) {
      this.children = els;
    }
    querySelectorAll(selector) {
      return this.children.flatMap((e) => [
        ...((selector === ".main" && e.className === "main") ||
        (selector === ".bar" && e.className === "bar")
          ? [e]
          : []),
        ...e.querySelectorAll(selector),
      ]);
    }
    querySelector(selector) {
      return selector === ".bar"
        ? this.querySelectorAll(".bar")[0]
        : this.querySelectorAll(".main").find((e) => selector.includes(`"${e.dataset.id}"`));
    }
    scrollIntoView(options) {
      this.scrolled = options.block;
    }
    select() {
      this.selectionStart = 0;
      this.selectionEnd = this.value.length;
    }
    setSelectionRange(start, end) {
      this.selectionStart = start;
      this.selectionEnd = end;
    }
    setPointerCapture(id) {
      this.capturedPointer = id;
    }
    focus() {
      doc.activeElement = this;
      this.events.focus?.();
      doc.listeners.focusin?.({ target: this });
    }
    click() {
      if (this.tag === "a") downloads.push({ filename: this.download, href: this.href });
      this.events.click?.({ target: this, stopPropagation() {}, preventDefault() {} });
    }
  }
  const ids = [
    "appearance-summary",
    "bookmarks-summary",
    "playback-summary",
    "trash-summary",
    "trash-expiry-help",
    "transcripts-summary",
    "backup-summary",
    "show-markers",
    "annotation-editor",
    "annotation-text",
    "annotation-save",
    "annotation-cancel",
    "annotation-error",
    "annotation-target",
    "offer-save-file",
    "file-save-dialog",
    "file-name-fields",
    "file-save-name",
    "file-save-confirm",
    "file-save-cancel",
    "file-save-title",
    "file-save-description",
    "file-save-error",
    "transcript-format-toggle",
    "transcript-format-menu",
    "transcript-format-list",
    "transcript-format-picker",
    "transcript-format-use",
    "transcript-format-description",
    "transcript-format-example",
    "transcript-target",
    "copy-transcript",
    "help-escape",
    "help-dialog",
    "help-toggle",
    "help-close",
    "help-scrub",
    "help-scrub-detail",
    "help-multiplier",
    "help-multiplier-detail",
    "help-escape-detail",
    "copy-videos",
    "include-channel-names",
    "show-thumbnails",
    "shortcut-help",
    "restore-bookmark",
    "list",
    "status",
    "search",
    "search-control",
    "clear-search",
    "hint",
    "options-toggle",
    "settings-toggle-label",
    "options-panel",
    "auto-bookmark",
    "scrub-seconds",
    "shift-multiplier",
    "scrub-value",
    "multiplier-value",
    "shift-preview",
  ];
  const els = Object.fromEntries(ids.map((id) => [id, new FakeElement()]));
  for (const id of ["about-toggle", "about-dialog", "about-close", "about-version"])
    els[id] = new FakeElement();
  els["about-dialog"].showModal = function () {
    this.open = true;
    els["about-close"].focus();
  };
  for (const id of ["deletion-mode", "trash-days", "show-trash", "empty-trash", "trash-count"])
    els[id] = new FakeElement();
  els["deletion-mode"].tag = "select";
  els["theme-select"] = new FakeElement("select");
  doc.documentElement = new FakeElement("html");
  els["file-save-dialog"].showModal = function () {
    this.open = true;
    els["file-save-cancel"].focus();
  };
  els["options-panel"].hidden = true;
  doc.body = new FakeElement("body");
  doc.execCommand = (command) => {
    const field = doc.body.children.find((el) => el.tag === "textarea");
    if (command !== "copy" || !field || behavior.failLegacyClipboard) return false;
    clipboardWrites.push(field.value);
    return true;
  };
  doc.querySelector = () => new FakeElement();
  doc.getElementById = (id) => els[id];
  doc.createElement = (tag) => new FakeElement(tag);
  // No runtime or permissions API is supplied: the popup must work without
  // thumbnail consent plumbing on both platforms.
  const browser = {
    runtime: { getManifest: () => ({ version: require("../package.json").version }) },
    storage: {
      local: {
        get: async (key) =>
          structuredClone(
            key == null
              ? data
              : Object.fromEntries((Array.isArray(key) ? key : [key]).map((k) => [k, data[k]])),
          ),
        remove: async (keys) => {
          if (behavior.failStorageRemove) throw Error("Test cleanup failure");
          for (const key of keys) delete data[key];
        },
        set: async (obj) => {
          writes++;
          const changes = {};
          for (const [k, v] of Object.entries(obj)) {
            changes[k] = { newValue: structuredClone(v) };
            data[k] = structuredClone(v);
          }
          for (const fn of listeners) fn(changes, "local");
        },
      },
      onChanged: { addListener: (fn) => listeners.push(fn) },
    },
    tabs: {
      query: async (q) => (q.active ? [{ id: 1, windowId: 1, url }] : behavior.tabs || []),
      update: async (id, changes) => {
        if (behavior.failNavigation) throw Error("Navigation failed");
        navigation.push({ type: "update", id, ...changes });
      },
      create: async (changes) => {
        if (behavior.failNavigation) throw Error("Navigation failed");
        navigation.push({ type: "create", ...changes });
      },
    },
    windows: { update: async (id, changes) => navigation.push({ type: "window", id, ...changes }) },
    scripting: {
      executeScript: async (request) => {
        executions.push({
          operation: request.func.name,
          args: Array.from(request.args || []),
          tabId: request.target.tabId,
        });
        if (behavior.executeScript) {
          const responses = await behavior.executeScript(request, data);
          return Array.isArray(responses)
            ? responses.map((response) => ({ frameId: 0, ...response }))
            : responses;
        }
        if (request.func.name === "chapters")
          return [
            {
              frameId: 0,
              result: { id: request.args[0], duration: 1000, available: false, chapters: [] },
            },
          ];
        if (
          request.func.name === "WAYPOINTS_READ_METADATA" ||
          request.func === context.WAYPOINTS_READ_METADATA
        )
          return [
            {
              frameId: 0,
              result: behavior.metadata || {
                id: "aaaaaaaaaaa",
                t: 100,
                duration: 1000,
                title: "Test video",
              },
            },
          ];
        return [
          { frameId: 0, result: { id: request.args.at(-1), t: 100, duration: 1000, paused: true } },
        ];
      },
    },
  };
  const context = vm.createContext({
    [flavor === "chrome" ? "chrome" : "browser"]: browser,
    matchMedia: () => themeMedia,
    document: doc,
    window: {
      close() {
        closeCount++;
      },
    },
    crypto: { randomUUID: require("node:crypto").randomUUID },
    navigator: {
      clipboard: {
        writeText: async (text) => {
          if (behavior.failClipboard) throw Error("Clipboard unavailable");
          clipboardWrites.push(text);
        },
      },
    },
    URL,
    URLSearchParams,
    Blob,
    setTimeout: (fn) => timers.push(fn),
    CSS: { escape: (s) => s },
    console,
  });
  for (const script of popupScripts) {
    vm.runInContext(readBundle(extension, script), context, {
      filename: script,
    });
  }
  const settle = async () => {
    for (let i = 0; i < 100; i++) await Promise.resolve();
  };
  await settle();
  assert.equal(els.search.disabled, false, els.status.textContent);
  return {
    get data() {
      const snapshot = context.WAYPOINTS_STORAGE.decode(data);
      return {
        ...structuredClone(data),
        videos:
          data.videos ||
          Object.keys(snapshot.videos).length ||
          Object.keys(data).some((key) => key.startsWith("waypoints.bookmarks.v2:"))
            ? JSON.parse(JSON.stringify(snapshot.videos))
            : undefined,
        ...(snapshot.importedPositions ? { importedPositions: snapshot.importedPositions } : {}),
      };
    },
    els,
    doc,
    context,
    settle,
    navigation,
    executions,
    clipboardWrites,
    downloads,
    timers,
    closed: () => closeCount,
    writes: () => writes,
    systemTheme(dark) {
      themeMedia.matches = dark;
      themeListeners.forEach((fn) => fn());
    },
    async paste(text) {
      let prevented = false;
      doc.listeners.paste({
        clipboardData: { getData: () => text },
        preventDefault() {
          prevented = true;
        },
      });
      await settle();
      return prevented;
    },
  };
}
(async () => {
  console.log("Popup target:", flavor);
  const policyFixture = await createPopupFixture({}, "https://example.com/");
  const policy = policyFixture.context.WAYPOINTS_SETTINGS_POLICY;
  assert.ok(
    Object.isFrozen(policy) && Object.isFrozen(policy.defaults) && Object.isFrozen(policy.numeric),
  );
  for (const [name, controlId, min, max, fallback] of [
    ["scrubSeconds", "scrub-seconds", 1, 60, 10],
    ["shiftMultiplier", "shift-multiplier", 1, 10, 3],
    ["trashDays", "trash-days", 1, 365, 7],
  ]) {
    assert.ok(Object.isFrozen(policy.numeric[name]));
    const control = policyFixture.els[controlId];
    assert.equal(control.min, String(min));
    assert.equal(control.max, String(max));
    assert.equal(control.step, "1");
    assert.equal(control.defaultValue, String(fallback));
    assert.equal(String(control.value), String(fallback));
    for (const value of [min, max, fallback]) {
      policyFixture.context.policyValue = value;
      assert.equal(
        vm.runInContext(`normalizeSettings({${name}:policyValue}).${name}`, policyFixture.context),
        value,
      );
    }
    for (const value of [0, max + 1, 1.5, String(max), NaN, Infinity, null, undefined]) {
      policyFixture.context.policyValue = value;
      assert.equal(
        vm.runInContext(`normalizeSettings({${name}:policyValue}).${name}`, policyFixture.context),
        fallback,
      );
      if (name === "trashDays")
        assert.equal(policyFixture.context.WAYPOINTS_STORAGE.retentionDays(value), 7);
    }
  }
  const policyDefaults = JSON.parse(
    JSON.stringify(vm.runInContext("normalizeSettings({})", policyFixture.context)),
  );
  assert.deepEqual(policyDefaults, {
    autoBookmark: true,
    includeChannelNames: true,
    showThumbnails: true,
    showMarkers: true,
    scrubSeconds: 10,
    shiftMultiplier: 3,
    transcriptFormat: "markdown-linked",
    offerSaveFile: false,
    theme: "system",
    deletionMode: "timed",
    trashDays: 7,
    showTrash: false,
  });
  for (const [name, fallback] of Object.entries({
    autoBookmark: true,
    includeChannelNames: true,
    showThumbnails: true,
    showMarkers: true,
    offerSaveFile: false,
    showTrash: false,
  })) {
    for (const value of [true, false]) {
      policyFixture.context.policyValue = value;
      assert.equal(
        vm.runInContext(`normalizeSettings({${name}:policyValue}).${name}`, policyFixture.context),
        value,
      );
    }
    for (const value of [undefined, null, 0, "false"]) {
      policyFixture.context.policyValue = value;
      assert.equal(
        vm.runInContext(`normalizeSettings({${name}:policyValue}).${name}`, policyFixture.context),
        fallback,
      );
    }
  }
  assert.equal(policyFixture.context.WAYPOINTS_STORAGE.retentionDays(1), 1);
  assert.equal(policyFixture.context.WAYPOINTS_STORAGE.retentionDays(365), 365);
  assert.equal(policyFixture.els["annotation-text"].maxLength, 10000);
  assert.equal(policyFixture.context.WAYPOINTS_MARKERS.MAX_NOTE_CHARACTERS, 10000);
  assert.match(policyFixture.els["trash-expiry-help"].textContent, /^Default: 7 days \(one week\)/);
  console.log(
    "PASS: immutable settings policy preserves defaults, numeric bounds, retention and initialized control/annotation constraints",
  );

  // Refresh requests must not commit stale snapshots or rebuild twice for a
  // single local settings write followed by its storage notification.
  const refreshId = "aaaaaaaaaaa";
  const refreshFixture = await createPopupFixture(
    {
      settings: { autoBookmark: false },
      videos: {
        [refreshId]: {
          id: refreshId,
          title: "Initial refresh view",
          t: 10,
          duration: 100,
          updated: 1,
        },
      },
    },
    "https://example.com/",
  );
  const originalRefreshStorage = refreshFixture.context.WAYPOINTS_STORAGE;
  const oldRefreshSnapshot = await originalRefreshStorage.read();
  const newRefreshSnapshot = structuredClone(oldRefreshSnapshot);
  oldRefreshSnapshot.videos[refreshId].title = "Older pending read";
  newRefreshSnapshot.videos[refreshId].title = "Newest requested view";
  const refreshReads = [];
  refreshFixture.context.WAYPOINTS_STORAGE = {
    ...originalRefreshStorage,
    read: () => new Promise((resolve, reject) => refreshReads.push({ resolve, reject })),
  };
  const refreshRow = refreshFixture.els.list.querySelectorAll(".main")[0];
  refreshRow.focus();
  const earlierRefresh = vm.runInContext("render()", refreshFixture.context);
  await refreshFixture.settle();
  const laterRefresh = vm.runInContext("render()", refreshFixture.context);
  await refreshFixture.settle();
  assert.equal(refreshReads.length, 1, "overlapping refreshes must not read concurrently");
  refreshReads[0].resolve(oldRefreshSnapshot);
  await refreshFixture.settle();
  assert.equal(
    vm.runInContext("savedVideos.aaaaaaaaaaa.title", refreshFixture.context),
    "Initial refresh view",
    "an invalidated older read must not paint",
  );
  assert.equal(refreshReads.length, 2, "a request during a read needs a fresh follow-up");
  refreshReads[1].resolve(newRefreshSnapshot);
  await Promise.all([earlierRefresh, laterRefresh]);
  assert.equal(
    vm.runInContext("savedVideos.aaaaaaaaaaa.title", refreshFixture.context),
    "Newest requested view",
  );
  assert.equal(
    refreshFixture.doc.activeElement.dataset.id,
    refreshId,
    "coordinated refresh must retain row focus",
  );
  refreshFixture.context.WAYPOINTS_STORAGE = originalRefreshStorage;
  let refreshReadCount = 0;
  refreshFixture.context.WAYPOINTS_STORAGE = {
    ...originalRefreshStorage,
    read() {
      refreshReadCount++;
      return originalRefreshStorage.read();
    },
  };
  const replaceRefreshList = refreshFixture.els.list.replaceChildren.bind(refreshFixture.els.list);
  let refreshPaints = 0;
  refreshFixture.els.list.replaceChildren = (...children) => {
    refreshPaints++;
    replaceRefreshList(...children);
  };
  refreshFixture.els["show-markers"].checked = false;
  refreshFixture.els["show-markers"].events.change();
  await refreshFixture.settle();
  assert.equal(refreshPaints, 1, "one Settings save and its notification should paint once");
  assert.equal(refreshReadCount, 1, "one Settings save should need only one view read");
  refreshPaints = 0;
  await vm.runInContext(
    "api.storage.local.set({settings:{...settings, showMarkers:true}})",
    refreshFixture.context,
  );
  await refreshFixture.settle();
  assert.equal(
    refreshPaints,
    1,
    "external storage changes must still refresh without a local action",
  );
  assert.equal(vm.runInContext("settings.showMarkers", refreshFixture.context), true);
  refreshFixture.context.WAYPOINTS_STORAGE = {
    ...originalRefreshStorage,
    read: () => Promise.reject(new Error("Refresh storage unavailable")),
  };
  await vm.runInContext(
    "api.storage.local.set({settings:{...settings, showMarkers:false}})",
    refreshFixture.context,
  );
  await refreshFixture.settle();
  assert.match(
    refreshFixture.els.status.textContent,
    /Refresh storage unavailable/,
    "background refresh failures must be visible",
  );
  refreshFixture.context.WAYPOINTS_STORAGE = originalRefreshStorage;
  await vm.runInContext(
    "api.storage.local.set({settings:{...settings, showMarkers:true}})",
    refreshFixture.context,
  );
  await refreshFixture.settle();
  assert.equal(
    vm.runInContext("settings.showMarkers", refreshFixture.context),
    true,
    "a failed refresh must not poison later notifications",
  );
  console.log(
    "PASS: serialized refreshes reject stale views, retain focus and coalesce local notifications without losing external updates",
  );

  const markerId = "aaaaaaaaaaa";
  const markerSeed = (extra = {}) => ({
    id: markerId,
    title: "Marker fixture",
    t: 15,
    duration: 100,
    updated: 1,
    ...extra,
  });
  const markerPoint = (id, t, extra = {}) => ({ id: "u:" + id, t, origin: "user", ...extra });
  const markerFixture = (video = markerSeed(), behavior = {}, settings = {}) =>
    createPopupFixture(
      { videos: { [markerId]: video }, settings: { autoBookmark: false, ...settings } },
      "https://example.com/",
      behavior,
    );
  let chapterTitle = "Introduction";
  let chapterTime = 15;
  let chapterAvailable = true;
  const chapterSource = await markerFixture(
    markerSeed({ markers: [{ id: "u:personal", t: 90, origin: "user", note: "Personal note" }] }),
    {
      tabs: [{ id: 4, url: `https://www.youtube.com/watch?v=${markerId}` }],
      async executeScript(request) {
        if (request.func.name === "chapters")
          return [
            {
              result: {
                id: markerId,
                duration: 100,
                available: chapterAvailable,
                chapters: chapterAvailable
                  ? [
                      { t: 0, title: chapterTitle },
                      { t: 40, title: "Deep dive" },
                    ]
                  : [],
              },
            },
          ];
        if (request.func.name === "seekTo") chapterTime = request.args[0];
        return [{ result: { id: markerId, t: chapterTime, duration: 100, paused: false } }];
      },
    },
  );
  await chapterSource.settle();
  assert.equal(
    chapterSource.data.videos[markerId].markers.length,
    3,
    "open saved videos seed chapters automatically",
  );
  assert.equal(
    chapterSource.data.videos[markerId].t,
    15,
    "chapter loading does not move resume time",
  );
  chapterSource.els.list.querySelectorAll(".main")[0].focus();
  chapterSource.doc.listeners.keydown({ key: "[", preventDefault() {} });
  await chapterSource.settle();
  chapterSource.doc.listeners.keydown({ key: "a", preventDefault() {} });
  await chapterSource.settle();
  assert.equal(chapterSource.els["annotation-text"].value, "Introduction");
  chapterSource.els["annotation-text"].value = "My edited introduction";
  chapterSource.els["annotation-save"].click();
  await chapterSource.settle();
  chapterTitle = "Updated chapter title";
  await vm.runInContext(`markers.refreshChapters("${markerId}")`, chapterSource.context);
  let chapterRecord = chapterSource.data.videos[markerId].markers.find(
    (point) => point.id === "c:0",
  );
  assert.equal(chapterRecord.title, chapterTitle);
  assert.equal(chapterRecord.note, "My edited introduction");
  chapterSource.doc.listeners.keydown({ key: "a", preventDefault() {} });
  await chapterSource.settle();
  chapterSource.els["annotation-text"].value = "";
  chapterSource.els["annotation-save"].click();
  await chapterSource.settle();
  await vm.runInContext(`markers.refreshChapters("${markerId}")`, chapterSource.context);
  chapterRecord = chapterSource.data.videos[markerId].markers.find((point) => point.id === "c:0");
  assert.equal(chapterRecord.note, "", "chapter refresh preserves explicitly cleared annotations");
  chapterSource.doc.listeners.keydown({ key: "m", preventDefault() {} });
  await chapterSource.settle();
  await vm.runInContext(`markers.refreshChapters("${markerId}")`, chapterSource.context);
  chapterRecord = chapterSource.data.videos[markerId].markers.find((point) => point.id === "c:0");
  assert.equal(chapterRecord.removed, true, "chapter refresh never restores a removed marker");
  assert.equal(chapterRecord.note, undefined);
  assert.equal(
    chapterSource.data.videos[markerId].markers.find((point) => point.id === "u:personal").note,
    "Personal note",
  );
  chapterAvailable = false;
  const beforeUnavailable = JSON.stringify(chapterSource.data.videos[markerId].markers);
  await vm.runInContext(`markers.refreshChapters("${markerId}")`, chapterSource.context);
  assert.equal(JSON.stringify(chapterSource.data.videos[markerId].markers), beforeUnavailable);
  let releaseChapters;
  const delayedChapters = await markerFixture(markerSeed(), {
    tabs: [{ id: 4, url: `https://www.youtube.com/watch?v=${markerId}` }],
    executeScript: () =>
      new Promise((resolve) => {
        releaseChapters = resolve;
      }),
  });
  await delayedChapters.settle();
  await vm.runInContext(
    `WAYPOINTS_STORAGE.importVideos({"${markerId}":{id:"${markerId}",t:50,duration:100}})`,
    delayedChapters.context,
  );
  releaseChapters([
    {
      result: {
        id: markerId,
        duration: 100,
        available: true,
        chapters: [{ t: 0, title: "Stale source" }],
      },
    },
  ]);
  await delayedChapters.settle();
  assert.equal(delayedChapters.data.videos[markerId].markers, undefined);
  assert.equal(delayedChapters.data.videos[markerId].t, 50);
  console.log(
    "PASS: automatic chapter seeding, default title annotations, preservation of edits/clears/removals and delayed import lifetime safety",
  );
  async function markerKey(popup, key, extra = {}) {
    popup.doc.listeners.keydown({ key, preventDefault() {}, stopPropagation() {}, ...extra });
    await popup.settle();
  }
  const clustered = await markerFixture(
    markerSeed({
      t: 10,
      markers: [
        { id: "c:10000", t: 10, origin: "chapter", title: "A chapter" },
        markerPoint("same", 10, { note: "Personal note" }),
        markerPoint("near", 11),
        markerPoint("later", 30),
      ],
    }),
  );
  clustered.els.list.querySelectorAll(".main")[0].focus();
  await markerKey(clustered, "]"); // Establish a point beyond the cluster.
  await markerKey(clustered, "[");
  assert.equal(clustered.data.videos[markerId].t, 11);
  await markerKey(clustered, "[");
  assert.equal(clustered.data.videos[markerId].t, 10);
  await markerKey(clustered, "a");
  assert.equal(clustered.els["annotation-text"].value, "Personal note");
  clustered.els["annotation-cancel"].click();
  await clustered.settle();
  await markerKey(clustered, "m");
  assert.equal(
    clustered.data.videos[markerId].markers.find((point) => point.id === "u:same").removed,
    true,
  );
  assert.equal(
    clustered.data.videos[markerId].markers.find((point) => point.id === "c:10000").removed,
    undefined,
    "toggle removes the selected coincident marker",
  );
  await markerKey(clustered, "]");
  await markerKey(clustered, "[");
  await markerKey(clustered, "[");
  await markerKey(clustered, "a");
  assert.equal(
    clustered.els["annotation-text"].value,
    "A chapter",
    "coincident chapter remains keyboard reachable",
  );
  clustered.els["annotation-cancel"].click();
  await clustered.settle();
  const manualMarkers = await markerFixture();
  manualMarkers.els.list.querySelectorAll(".main")[0].focus();
  await markerKey(manualMarkers, "m");
  assert.equal(manualMarkers.data.videos[markerId].markers[0].t, 15);
  assert.equal(manualMarkers.data.videos[markerId].t, 15);
  assert.equal(manualMarkers.data.settings?.showMarkers ?? true, true);
  let markerWrites = manualMarkers.writes();
  for (const extra of [
    { repeat: true },
    { ctrlKey: true },
    { metaKey: true },
    { altKey: true },
    { isComposing: true },
  ])
    await markerKey(manualMarkers, "m", extra);
  assert.equal(manualMarkers.writes(), markerWrites);
  await markerKey(manualMarkers, "M", { shiftKey: true });
  assert.equal(manualMarkers.data.settings.showMarkers, false);
  const afterHide = manualMarkers.writes();
  await markerKey(manualMarkers, "M", { repeat: true, shiftKey: true });
  assert.equal(manualMarkers.writes(), afterHide);
  await markerKey(manualMarkers, "M", { shiftKey: true });
  assert.equal(manualMarkers.data.settings.showMarkers, true);
  for (let index = 0; index < 2; index++)
    manualMarkers.doc.listeners.keydown({ key: "M", shiftKey: true, preventDefault() {} });
  await vm.runInContext("queue", manualMarkers.context);
  await manualMarkers.settle();
  assert.equal(manualMarkers.data.settings.showMarkers, true, "two fast M presses toggle twice");
  markerWrites = manualMarkers.writes();
  await markerKey(manualMarkers, "a");
  assert.match(manualMarkers.els["annotation-target"].textContent, /Marker 0:15/);
  manualMarkers.els["annotation-text"].value = "My marker note\nSecond line";
  // Marker shortcuts, paste/import, and options cannot steal an active editor.
  for (const key of ["m", "M", "a", "]", "[", "c", "C", "t", "h"])
    await markerKey(manualMarkers, key);
  assert.equal(await manualMarkers.paste('{"videos":{}}'), false);
  manualMarkers.els["options-toggle"].click();
  assert.equal(manualMarkers.els["options-panel"].hidden, true);
  assert.equal(manualMarkers.writes(), markerWrites);
  manualMarkers.els["annotation-save"].click();
  await manualMarkers.settle();
  assert.equal(manualMarkers.data.videos[markerId].markers[0].note, "My marker note\nSecond line");
  assert.equal(manualMarkers.els["annotation-editor"].hidden, true);
  await markerKey(manualMarkers, "m");
  assert.equal(manualMarkers.data.videos[markerId].markers[0].removed, true);
  assert.equal(manualMarkers.data.videos[markerId].markers[0].note, undefined);
  await markerKey(manualMarkers, "m");
  const freshMarker = manualMarkers.data.videos[markerId].markers.find((marker) => !marker.removed);
  assert.equal(freshMarker.note, undefined, "re-adding a marker cannot restore its old annotation");
  await markerKey(manualMarkers, "a");
  assert.equal(manualMarkers.els["annotation-text"].value, "");
  manualMarkers.els["annotation-text"].value = "New note";
  await markerKey(manualMarkers, "Enter", { ctrlKey: true });
  assert.equal(
    manualMarkers.data.videos[markerId].markers.find((marker) => !marker.removed).note,
    "New note",
  );

  const startNote = await markerFixture(markerSeed({ t: 88 }));
  startNote.els.list.querySelectorAll(".main")[0].focus();
  await markerKey(startNote, "a");
  assert.match(startNote.els["annotation-target"].textContent, /Video start 0:00/);
  startNote.els["annotation-text"].value = "A note at the start";
  startNote.els["annotation-save"].click();
  await startNote.settle();
  assert.equal(startNote.data.videos[markerId].startNote, "A note at the start");
  assert.equal(startNote.data.videos[markerId].t, 88);
  assert.equal(startNote.data.videos[markerId].markers, undefined);
  await markerKey(startNote, "a");
  startNote.els["annotation-text"].value = "";
  startNote.els["annotation-save"].click();
  await startNote.settle();
  assert.equal(startNote.data.videos[markerId].startNote, "");

  const chapterMarker = { id: "c:30000", t: 30, origin: "chapter", title: "A chapter" };
  const markerNav = await markerFixture(
    markerSeed({ markers: [markerPoint("first", 10), markerPoint("second", 20), chapterMarker] }),
  );
  markerNav.els.list.querySelectorAll(".main")[0].focus();
  await markerKey(markerNav, "a");
  assert.match(markerNav.els["annotation-target"].textContent, /Video start 0:00/);
  markerNav.els["annotation-cancel"].click();
  await markerNav.settle();
  await markerKey(markerNav, "[");
  assert.equal(markerNav.data.videos[markerId].t, 10);
  markerWrites = markerNav.writes();
  await markerKey(markerNav, "[");
  assert.equal(markerNav.writes(), markerWrites);
  assert.match(markerNav.els.status.textContent, /No previous marker/);
  await markerKey(markerNav, "]");
  assert.equal(markerNav.data.videos[markerId].t, 20);
  await markerKey(markerNav, "]");
  assert.equal(markerNav.data.videos[markerId].t, 30);
  await markerKey(markerNav, "]");
  assert.match(markerNav.els.status.textContent, /No next marker/);
  await markerKey(markerNav, "a");
  markerNav.els["annotation-text"].value = "Chapter annotation";
  markerNav.els["annotation-save"].click();
  await markerNav.settle();
  assert.equal(markerNav.data.videos[markerId].markers[2].origin, "chapter");
  assert.equal(markerNav.data.videos[markerId].markers[2].note, "Chapter annotation");
  markerNav.els["show-markers"].checked = false;
  markerNav.els["show-markers"].events.change();
  await markerNav.settle();
  assert.equal(markerNav.data.settings.showMarkers, false);
  assert.equal(markerNav.data.videos[markerId].markers.length, 3);
  await markerKey(markerNav, "c");
  assert.equal(
    JSON.parse(markerNav.clipboardWrites.at(-1)).videos[markerId].markers[2].note,
    "Chapter annotation",
  );
  const hiddenReopen = await createPopupFixture(markerNav.data, "https://example.com/");
  assert.equal(hiddenReopen.els["show-markers"].checked, false);

  const openMarkerTab = { id: 4, windowId: 1, url: `https://www.youtube.com/watch?v=${markerId}` };
  const liveMarker = await markerFixture(markerSeed(), {
    tabs: [openMarkerTab],
    executeScript: async () => [{ result: { id: markerId, t: 70, duration: 100, paused: false } }],
  });
  liveMarker.els.list.querySelectorAll(".main")[0].focus();
  await markerKey(liveMarker, "m");
  assert.equal(liveMarker.data.videos[markerId].markers[0].t, 70);
  assert.equal(liveMarker.data.videos[markerId].t, 15);
  assert.equal(liveMarker.executions.at(-1).operation, "position");
  for (const result of [
    null,
    { error: "Wait for the YouTube ad to finish." },
    { id: "bbbbbbbbbbb", t: 70, duration: 100, paused: false },
  ]) {
    const invalid = await markerFixture(markerSeed(), {
      tabs: [openMarkerTab],
      executeScript: async () => [{ result }],
    });
    invalid.els.list.querySelectorAll(".main")[0].focus();
    await markerKey(invalid, "m");
    assert.equal(invalid.writes(), 0);
    assert.equal(invalid.data.videos[markerId].markers, undefined);
  }
  // A delayed valid position cannot attach a new marker to an imported lifetime.
  let releaseMarkerPosition;
  const delayedMarker = await markerFixture(markerSeed(), {
    tabs: [openMarkerTab],
    executeScript: () =>
      new Promise((resolve) => {
        releaseMarkerPosition = resolve;
      }),
  });
  const markerPending = vm.runInContext(`markers.toggle("${markerId}")`, delayedMarker.context);
  await delayedMarker.settle();
  await vm.runInContext(
    `WAYPOINTS_STORAGE.importVideos({"${markerId}": {id:"${markerId}", t:90, duration:100}})`,
    delayedMarker.context,
  );
  releaseMarkerPosition([{ result: { id: markerId, t: 70, duration: 100, paused: false } }]);
  await assert.rejects(markerPending, /bookmark changed/);
  assert.equal(delayedMarker.data.videos[markerId].markers, undefined);
  assert.equal(delayedMarker.data.videos[markerId].t, 90);

  // Concurrent note changes keep the unsaved draft visible and require reopening.
  const conflictingNote = await markerFixture(markerSeed({ startNote: "Original" }));
  conflictingNote.els.list.querySelectorAll(".main")[0].focus();
  await markerKey(conflictingNote, "a");
  conflictingNote.els["annotation-text"].value = "My draft";
  await vm.runInContext(
    `(async () => { const s=await WAYPOINTS_STORAGE.read(); s.videos["${markerId}"].startNote="Other editor"; await WAYPOINTS_STORAGE.save(s); })()`,
    conflictingNote.context,
  );
  conflictingNote.els["annotation-save"].click();
  await conflictingNote.settle();
  assert.equal(conflictingNote.data.videos[markerId].startNote, "Other editor");
  assert.equal(conflictingNote.els["annotation-text"].value, "My draft");
  assert.match(conflictingNote.els["annotation-error"].textContent, /changed elsewhere/);
  conflictingNote.els["annotation-cancel"].click();
  await conflictingNote.settle();
  await markerKey(conflictingNote, "a");
  conflictingNote.els["annotation-text"].value = "Draft after import";
  await vm.runInContext(
    `WAYPOINTS_STORAGE.importVideos({"${markerId}": {id:"${markerId}", t:90}})`,
    conflictingNote.context,
  );
  conflictingNote.els["annotation-save"].click();
  await conflictingNote.settle();
  assert.match(conflictingNote.els["annotation-error"].textContent, /bookmark changed/);
  assert.equal(conflictingNote.els["annotation-text"].value, "Draft after import");
  conflictingNote.els["annotation-cancel"].click();
  await conflictingNote.settle();
  const unknownMarker = await markerFixture(
    markerSeed({ duration: 0, markers: [markerPoint("outside", 10)] }),
  );
  unknownMarker.els.list.querySelectorAll(".main")[0].focus();
  await markerKey(unknownMarker, "[");
  assert.match(unknownMarker.els.status.textContent, /read its duration/);
  assert.equal(unknownMarker.data.videos[markerId].t, 15);
  console.log(
    "PASS: marker shortcuts, live/closed positions, selection, annotations/start fallback, editing guards, hide/export, navigation and delayed/conflicting lifetime safety",
  );
  // The UI gets a frozen identity/value context, not the full storage snapshot.
  // Changing marker selection while editing cannot redirect the eventual write.
  const anchoredDraft = await markerFixture(
    markerSeed({
      markers: [
        markerPoint("first", 10, { note: "First original" }),
        markerPoint("second", 20, { note: "Second original" }),
      ],
    }),
  );
  await vm.runInContext(`markers.edit("${markerId}", "u:first")`, anchoredDraft.context);
  const originalDraft = vm.runInContext("annotationEditor.draft", anchoredDraft.context);
  assert.ok(Object.isFrozen(originalDraft));
  assert.deepEqual(
    Object.keys(originalDraft).sort(),
    ["id", "markerId", "time", "originalNote", "lifetime"].sort(),
  );
  assert.equal(originalDraft.id, markerId);
  assert.equal(originalDraft.markerId, "u:first");
  assert.equal(originalDraft.time, 10);
  assert.equal(originalDraft.originalNote, "First original");
  const originalLifetime = JSON.stringify(
    (await anchoredDraft.context.WAYPOINTS_STORAGE.read()).records[markerId].life.v,
  );
  assert.equal(originalDraft.lifetime, originalLifetime);
  for (const name of ["id", "markerId", "originalNote", "lifetime"])
    assert.equal(Reflect.set(originalDraft, name, "mutated"), false, name);
  anchoredDraft.els["annotation-text"].value = "Edit belongs to first";
  await vm.runInContext(`markers.select("${markerId}", "u:second")`, anchoredDraft.context);
  await assert.rejects(
    vm.runInContext(`markers.remove("${markerId}", "u:first")`, anchoredDraft.context),
    /Save or cancel/,
  );
  await vm.runInContext("markers.saveEditor()", anchoredDraft.context);
  assert.equal(anchoredDraft.data.videos[markerId].markers[0].note, "Edit belongs to first");
  assert.equal(anchoredDraft.data.videos[markerId].markers[1].note, "Second original");
  assert.equal(
    anchoredDraft.data.videos[markerId].t,
    20,
    "saving a note must preserve an intervening seek",
  );
  assert.equal(vm.runInContext("annotationEditor.draft", anchoredDraft.context), null);
  assert.equal(anchoredDraft.els["annotation-text"].value, "");
  console.log(
    "PASS: annotation UI receives immutable context without snapshots; saves retain the original anchor and preserve other fields",
  );

  const removedDraft = await markerFixture(
    markerSeed({ markers: [markerPoint("gone", 10, { note: "Before removal" })] }),
  );
  await vm.runInContext(`markers.edit("${markerId}", "u:gone")`, removedDraft.context);
  removedDraft.els["annotation-text"].value = "Keep my unsaved text";
  await vm.runInContext(
    `(async()=>{const s=await WAYPOINTS_STORAGE.read();s.videos["${markerId}"].markers[0].removed=true;await WAYPOINTS_STORAGE.save(s);})()`,
    removedDraft.context,
  );
  await vm.runInContext("markers.saveEditor()", removedDraft.context);
  assert.match(removedDraft.els["annotation-error"].textContent, /marker was removed/);
  assert.equal(removedDraft.els["annotation-text"].value, "Keep my unsaved text");
  assert.equal(removedDraft.els["annotation-editor"].hidden, false);
  assert.equal(removedDraft.data.videos[markerId].markers[0].removed, true);
  await vm.runInContext("markers.closeEditor()", removedDraft.context);

  // Hold the validation read before import: even if that read returns an older
  // valid view, the mutation is still bound to the original lifetime.
  const heldDraft = await markerFixture(markerSeed({ startNote: "Before import" }));
  await vm.runInContext(`markers.edit("${markerId}")`, heldDraft.context);
  const heldIdentity = vm.runInContext("annotationEditor.draft", heldDraft.context);
  heldDraft.els["annotation-text"].value = "Obsolete local edit";
  const heldApi = heldDraft.context.browser || heldDraft.context.chrome;
  const heldGet = heldApi.storage.local.get;
  let releaseDraftRead;
  heldApi.storage.local.get = async (keys) => {
    const value = await heldGet(keys);
    if (keys === null) {
      heldApi.storage.local.get = heldGet;
      await new Promise((resolve) => {
        releaseDraftRead = resolve;
      });
    }
    return value;
  };
  const heldSave = vm.runInContext("markers.saveEditor()", heldDraft.context);
  await heldDraft.settle();
  assert.ok(releaseDraftRead);
  assert.equal(heldDraft.els["annotation-save"].disabled, true);
  await vm.runInContext(
    `WAYPOINTS_STORAGE.importVideos({"${markerId}":{id:"${markerId}",t:90,duration:100,startNote:"Imported note"}})`,
    heldDraft.context,
  );
  releaseDraftRead();
  await heldSave;
  assert.equal(heldDraft.data.videos[markerId].startNote, "Imported note");
  assert.equal(heldDraft.data.videos[markerId].t, 90);
  assert.equal(vm.runInContext("annotationEditor.draft", heldDraft.context), heldIdentity);
  assert.match(heldDraft.els["annotation-error"].textContent, /bookmark changed/);
  assert.equal(heldDraft.els["annotation-text"].value, "Obsolete local edit");
  assert.equal(heldDraft.els["annotation-save"].disabled, false);
  await vm.runInContext("markers.closeEditor()", heldDraft.context);
  console.log(
    "PASS: external marker removal and import during a held annotation save retain drafts without writing into a new lifetime",
  );

  // Two direct edit requests may finish their reads in a different order.
  // The first form to open keeps ownership instead of being silently replaced.
  const concurrentEdit = await markerFixture(
    markerSeed({
      markers: [
        markerPoint("first", 10, { note: "First" }),
        markerPoint("second", 20, { note: "Second" }),
      ],
    }),
  );
  const editApi = concurrentEdit.context.browser || concurrentEdit.context.chrome;
  const editGet = editApi.storage.local.get;
  let releaseEditRead;
  editApi.storage.local.get = async (keys) => {
    const value = await editGet(keys);
    editApi.storage.local.get = editGet;
    await new Promise((resolve) => {
      releaseEditRead = resolve;
    });
    return value;
  };
  const delayedEdit = vm.runInContext(
    `markers.edit("${markerId}","u:first")`,
    concurrentEdit.context,
  );
  await concurrentEdit.settle();
  assert.ok(releaseEditRead);
  await vm.runInContext(`markers.edit("${markerId}","u:second")`, concurrentEdit.context);
  releaseEditRead();
  await delayedEdit;
  assert.equal(
    vm.runInContext("annotationEditor.draft.markerId", concurrentEdit.context),
    "u:second",
  );
  assert.equal(concurrentEdit.els["annotation-text"].value, "Second");
  await vm.runInContext("markers.closeEditor()", concurrentEdit.context);

  // UI-level late results are isolated from a subsequent form, independently
  // of the domain-level lifetime checks above.
  const uiSessions = await markerFixture(markerSeed({ startNote: "Stored note" }));
  const sessionLife = JSON.stringify(
    (await uiSessions.context.WAYPOINTS_STORAGE.read()).records[markerId].life.v,
  );
  uiSessions.context.firstUiDraft = Object.freeze({
    id: markerId,
    markerId: null,
    time: 0,
    originalNote: "First view",
    lifetime: sessionLife,
  });
  let rejectUiSave;
  uiSessions.context.firstUiSave = () =>
    new Promise((resolve, reject) => {
      rejectUiSave = reject;
    });
  assert.equal(
    vm.runInContext(
      "annotationEditor.open({draft:firstUiDraft,save:firstUiSave})",
      uiSessions.context,
    ),
    true,
  );
  uiSessions.els["annotation-text"].value = "Old UI text";
  const staleUiSave = vm.runInContext("annotationEditor.save()", uiSessions.context);
  await uiSessions.settle();
  assert.ok(rejectUiSave);
  await vm.runInContext("annotationEditor.close()", uiSessions.context);
  uiSessions.context.secondUiDraft = Object.freeze({
    id: markerId,
    markerId: null,
    time: 0,
    originalNote: "Second view",
    lifetime: sessionLife,
  });
  uiSessions.context.secondUiSave = async () => {};
  assert.equal(
    vm.runInContext(
      "annotationEditor.open({draft:secondUiDraft,save:secondUiSave})",
      uiSessions.context,
    ),
    true,
  );
  uiSessions.els["annotation-text"].value = "New UI draft";
  rejectUiSave(new Error("Late error from the old form"));
  await staleUiSave;
  assert.equal(
    vm.runInContext("annotationEditor.draft", uiSessions.context),
    uiSessions.context.secondUiDraft,
  );
  assert.equal(uiSessions.els["annotation-text"].value, "New UI draft");
  assert.equal(uiSessions.els["annotation-error"].textContent, "");
  assert.equal(uiSessions.els["annotation-save"].disabled, false);
  assert.equal(uiSessions.els["annotation-cancel"].disabled, false);
  assert.equal(uiSessions.data.videos[markerId].startNote, "Stored note");
  await vm.runInContext("annotationEditor.close()", uiSessions.context);
  let resolveUiSave;
  uiSessions.context.firstUiSave = () =>
    new Promise((resolve) => {
      resolveUiSave = resolve;
    });
  vm.runInContext(
    "annotationEditor.open({draft:firstUiDraft,save:firstUiSave})",
    uiSessions.context,
  );
  const staleUiSuccess = vm.runInContext("annotationEditor.save()", uiSessions.context);
  await uiSessions.settle();
  assert.ok(resolveUiSave);
  await vm.runInContext("annotationEditor.close()", uiSessions.context);
  vm.runInContext(
    "annotationEditor.open({draft:secondUiDraft,save:secondUiSave})",
    uiSessions.context,
  );
  uiSessions.els["annotation-text"].value = "Do not close this new draft";
  const statusBeforeOldSuccess = uiSessions.els.status.textContent;
  resolveUiSave();
  await staleUiSuccess;
  assert.equal(
    vm.runInContext("annotationEditor.draft", uiSessions.context),
    uiSessions.context.secondUiDraft,
  );
  assert.equal(uiSessions.els["annotation-text"].value, "Do not close this new draft");
  assert.equal(uiSessions.els["annotation-editor"].hidden, false);
  assert.equal(uiSessions.els.status.textContent, statusBeforeOldSuccess);
  await vm.runInContext("annotationEditor.close()", uiSessions.context);
  console.log(
    "PASS: overlapping edit reads and late UI save results cannot replace or poison a newer annotation session",
  );

  const markerVideo = {
    id: "aaaaaaaaaaa",
    title: "Marker export",
    t: 80,
    duration: 1000,
    updated: 1,
    markers: [
      { id: "u:kept", t: 12, origin: "user", note: "Personal\nannotation" },
      { id: "c:30000", t: 30, origin: "chapter", title: "Chapter", removed: true },
    ],
    startNote: "Note at the start",
  };
  const markerExport = await createPopupFixture(
    { settings: { autoBookmark: false }, videos: { aaaaaaaaaaa: markerVideo } },
    "https://example.com/",
  );
  markerExport.els.list.querySelectorAll(".main")[0].focus();
  for (const key of ["c", "C"]) {
    markerExport.doc.listeners.keydown({ key, preventDefault() {} });
    await markerExport.settle();
    const copied = JSON.parse(markerExport.clipboardWrites.at(-1));
    assert.equal(copied.version, 2);
    assert.deepEqual(copied.videos.aaaaaaaaaaa.markers, markerVideo.markers);
    assert.equal(copied.videos.aaaaaaaaaaa.startNote, markerVideo.startNote);
  }
  markerExport.els["options-toggle"].click();
  markerExport.els["copy-videos"].click();
  await markerExport.settle();
  assert.equal(
    JSON.parse(markerExport.clipboardWrites.at(-1)).videos.aaaaaaaaaaa.startNote,
    markerVideo.startNote,
  );
  console.log(
    "PASS: packaged single/all-row and Options JSON copies preserve marker annotations and removal records",
  );
  const themed = await createPopupFixture(
    {
      settings: { autoBookmark: false },
      videos: { aaaaaaaaaaa: { id: "aaaaaaaaaaa", title: "Keep me", t: 42 } },
    },
    "https://example.com/",
    { dark: true },
  );
  // Serialize functions from the actual Vite bundle, without its enclosing
  // scope or any factory globals, just as scripting.executeScript does.
  const bundledActions = themed.context.WAYPOINTS_PLAYER_ACTIONS;
  const id = "aaaaaaaaaaa";
  const video = {
    currentTime: 10,
    duration: 120,
    paused: false,
    playbackRate: 1,
    pause() {
      this.paused = true;
    },
    play() {
      this.paused = false;
      return Promise.resolve();
    },
  };
  const page = {
    URLSearchParams,
    location: { search: "?v=" + id },
    document: {
      querySelector(selector) {
        if (selector.includes("ad-showing")) return null;
        if (selector === "ytd-watch-flexy:not([hidden])") return { getAttribute: () => id };
        return selector.includes("video") ? video : null;
      },
      getElementById() {
        return null;
      },
    },
  };
  const chapterWatch = { getAttribute: () => id };
  const originalQuery = page.document.querySelector;
  page.document.querySelector = (selector) =>
    selector === "ytd-watch-flexy:not([hidden])" ? chapterWatch : originalQuery(selector);
  page.ytInitialData = {
    currentVideoEndpoint: { watchEndpoint: { videoId: id } },
    playerOverlays: {
      playerOverlayRenderer: {
        decoratedPlayerBarRenderer: {
          decoratedPlayerBarRenderer: {
            playerBar: {
              chapteredPlayerBarRenderer: {
                chapters: [
                  {
                    chapterRenderer: {
                      timeRangeStartMillis: 0,
                      title: { simpleText: "Bundled chapter" },
                    },
                  },
                ],
              },
            },
          },
        },
      },
    },
  };
  const injected = (name, args) =>
    vm.runInNewContext(`(${bundledActions[name].toString()})(...args)`, { ...page, args });
  assert.equal(injected("position", [id]).t, 10);
  assert.equal(injected("chapters", [id]).chapters[0].title, "Bundled chapter");
  assert.equal(video.currentTime, 10, "reading marker position does not seek");
  assert.equal(video.paused, false, "reading marker position does not pause");
  assert.equal(injected("seek", [5, id]).t, 15);
  assert.equal(injected("seekTo", [30, id]).t, 30);
  assert.equal(injected("toggle", [id]).paused, true);
  assert.equal(injected("playback", ["rate", 1, id]).rate, 1.25);
  assert.match((await injected("transcript", ["bbbbbbbbbbb"])).error, /video|transcript/i);
  assert.match(injected("bookmark", ["bbbbbbbbbbb"]).error, /changed videos/);
  console.log(
    "PASS: Vite-bundled injected functions execute after serialization in a fresh page context",
  );
  assert.equal(themed.els["theme-select"].value, "system");
  assert.equal(themed.doc.documentElement.dataset.theme, "dark");
  themed.systemTheme(false);
  assert.equal(themed.doc.documentElement.dataset.theme, "light");
  themed.els["options-toggle"].click();
  themed.els["theme-select"].focus();
  for (const key of ["h", "t", "C", "ArrowDown"])
    themed.doc.listeners.keydown({
      key,
      preventDefault() {
        throw Error("native theme select intercepted");
      },
    });
  themed.els["theme-select"].value = "light";
  themed.els["theme-select"].events.change();
  await themed.settle();
  assert.equal(themed.data.settings.theme, "light");
  themed.systemTheme(true);
  assert.equal(
    themed.doc.documentElement.dataset.theme,
    "light",
    "explicit choice ignores system changes",
  );
  themed.els["theme-select"].value = "dark";
  themed.els["theme-select"].events.change();
  await themed.settle();
  const themeReopen = await createPopupFixture(themed.data, "https://example.com/");
  assert.equal(themeReopen.doc.documentElement.dataset.theme, "dark");
  assert.deepEqual(
    themed.data.videos,
    { aaaaaaaaaaa: { id: "aaaaaaaaaaa", title: "Keep me", t: 42 } },
    "theme selection never changes bookmarks",
  );
  themed.els["auto-bookmark"].checked = true;
  themed.els["auto-bookmark"].events.change();
  await themed.settle();
  assert.equal(themed.data.settings.theme, "dark", "other settings preserve selected theme");
  const invalidTheme = await createPopupFixture(
    { settings: { autoBookmark: false, theme: "unknown" } },
    "https://example.com/",
  );
  assert.equal(invalidTheme.els["theme-select"].value, "system");
  console.log(
    "PASS: system/light/dark themes, live system changes, persisted overrides, native select keys, bookmark/settings preservation",
  );
  const initial = {
    settings: { autoBookmark: false },
    videos: {
      a: { id: "a", title: "Dario and Daniela", t: 100, updated: 3 },
      b: { id: "b", title: "Making Videos in Resolve", t: 50, updated: 2 },
      c: { id: "c", title: "Video animation tips", t: 20, updated: 1 },
    },
  };
  let p = await createPopupFixture(initial);
  const about = await createPopupFixture(initial);
  about.els["about-toggle"].click();
  assert.equal(about.els["about-dialog"].open, true);
  assert.equal(
    about.els["about-version"].textContent,
    `Version ${require("../package.json").version}`,
  );
  assert.equal(about.doc.activeElement, about.els["about-close"]);
  const aboutWrites = about.writes();
  for (const key of ["Delete", "t", "T", "C", "h", "ArrowRight"]) {
    about.doc.listeners.keydown({
      key,
      preventDefault() {
        throw Error("About invoked a background shortcut");
      },
    });
  }
  assert.equal(await about.paste("https://www.youtube.com/watch?v=abcdefghijk"), false);
  assert.equal(about.writes(), aboutWrites);
  assert.equal(about.clipboardWrites.length, 0);
  assert.equal(about.navigation.length, 0);
  about.els["about-close"].click();
  assert.equal(about.els["about-dialog"].open, false);
  assert.equal(about.doc.activeElement, about.els["about-toggle"]);
  about.els["about-toggle"].click();
  about.els["about-dialog"].events.cancel({ preventDefault() {} });
  assert.equal(about.els["about-dialog"].open, false);
  console.log(
    "PASS: About displays manifest version, isolates shortcuts/paste, closes and restores focus",
  );
  p.doc.listeners.keydown({ key: "/", preventDefault() {} });
  const rows = () => p.els.list.querySelectorAll(".main").map((e) => e.dataset.id);
  assert.deepEqual(rows(), ["a", "b", "c"]);
  p.els.search.value = "VIDEO";
  p.els.search.events.input();
  assert.deepEqual(rows(), ["b", "c"]);
  assert.equal(p.els["clear-search"].hidden, false);
  assert.equal(p.writes(), 0, "search must never change saved bookmarks");
  p.els.search.value = "missing";
  p.els.search.events.input();
  assert.deepEqual(rows(), []);
  assert.equal(p.els.list.children[0].textContent, "No matching videos.");
  p.els["clear-search"].click();
  assert.deepEqual(rows(), ["a", "b", "c"]);
  assert.equal(p.els.search.value, "");
  assert.equal(p.els["clear-search"].hidden, true);
  assert.equal(p.doc.activeElement, p.els.search);
  for (const key of ["Backspace", "Delete", "ArrowLeft", "ArrowRight", " ", "Enter"]) {
    let prevented = false;
    p.doc.listeners.keydown({
      key,
      preventDefault() {
        prevented = true;
      },
    });
    assert.equal(prevented, false, `search editing key ${key} must stay native`);
  }
  p.els.search.value = "resolve";
  p.els.search.events.input();
  p.doc.listeners.keydown({ key: "ArrowDown", preventDefault() {} });
  assert.equal(p.doc.activeElement.dataset.id, "b");
  p.doc.listeners.keydown({ key: "Delete", preventDefault() {} });
  await p.settle();
  assert.equal(p.data.videos.b, undefined);
  assert.ok(p.data.videos.a && p.data.videos.c);
  assert.equal(p.doc.activeElement, p.els["restore-bookmark"]);
  assert.equal(p.els["search-control"].hidden, true);
  assert.equal(p.els["restore-bookmark"].hidden, false);
  p.doc.listeners.keydown({ key: "/", preventDefault() {} });
  assert.equal(p.doc.activeElement, p.els.search);
  assert.equal(p.els["restore-bookmark"].hidden, true);
  assert.equal(p.els["search-control"].hidden, false);
  console.log(
    "PASS: live title filtering, case-insensitive matching, empty state, clear, safe text editing, filtered-row navigation/deletion",
  );
  p.els.search.value = "Dario";
  p.els.search.events.input();
  p.els["options-toggle"].click();
  assert.equal(p.els["search-control"].hidden, true);
  assert.equal(p.els.list.hidden, true);
  assert.equal(p.els["options-panel"].hidden, false);
  p.els["options-toggle"].click();
  assert.equal(p.els["search-control"].hidden, false);
  assert.equal(p.els.search.value, "Dario");
  assert.deepEqual(rows(), ["a"]);
  await vm.runInContext(
    '(async () => { const snapshot = await bookmarks.loadSnapshot(); const { videos } = snapshot; videos.a.title = "Renamed title"; await bookmarks.saveSnapshot(snapshot); await render(); })()',
    p.context,
  );
  assert.deepEqual(rows(), [], "storage refresh must keep applying current search");
  console.log("PASS: options hide search, restore query/filter, storage refresh respects search");
  p = await createPopupFixture();
  assert.equal(p.data.videos.aaaaaaaaaaa.t, 100);
  assert.equal(p.doc.activeElement.dataset.id, "aaaaaaaaaaa");
  assert.equal(p.doc.activeElement.scrolled, "nearest");
  let prevented = false;
  p.doc.listeners.keydown({
    key: "/",
    preventDefault() {
      prevented = true;
    },
  });
  assert.equal(prevented, true);
  assert.equal(p.doc.activeElement, p.els.search);
  p.els.search.value = "video/";
  prevented = false;
  p.doc.listeners.keydown({
    key: "/",
    preventDefault() {
      prevented = true;
    },
  });
  assert.equal(prevented, false);
  assert.equal(p.els.search.value, "video/");
  const firstRow = p.els.list.querySelectorAll(".main")[0];
  firstRow.focus();
  p.doc.listeners.keydown({
    key: "/",
    ctrlKey: true,
    preventDefault() {
      throw Error("modified slash intercepted");
    },
  });
  assert.equal(p.doc.activeElement, firstRow);
  p.els["options-toggle"].click();
  p.doc.listeners.keydown({
    key: "/",
    preventDefault() {
      throw Error("hidden search focused");
    },
  });
  assert.equal(p.doc.activeElement, firstRow);
  p.els["options-toggle"].click();
  console.log(
    "PASS: slash focuses search; slash typing, modifier shortcuts, and options mode remain unaffected",
  );
  const existing = await createPopupFixture({
    settings: { autoBookmark: false },
    videos: {
      aaaaaaaaaaa: { id: "aaaaaaaaaaa", title: "Current", t: 70, updated: 1 },
      other: { id: "other", title: "Newer", t: 10, updated: 2 },
    },
  });
  assert.equal(existing.doc.activeElement.dataset.id, "aaaaaaaaaaa");
  assert.equal(existing.data.videos.aaaaaaaaaaa.t, 70);
  const unsaved = await createPopupFixture({ settings: { autoBookmark: false } });
  assert.equal(unsaved.doc.activeElement, unsaved.els["restore-bookmark"]);
  assert.equal(unsaved.els["restore-bookmark"].hidden, false);
  assert.equal(unsaved.els["search-control"].hidden, true);
  assert.equal(unsaved.data.videos, undefined, "opening with auto-bookmark off must not save");
  unsaved.els["options-toggle"].click();
  assert.equal(unsaved.els["restore-bookmark"].hidden, true);
  unsaved.els["options-toggle"].click();
  assert.equal(unsaved.els["restore-bookmark"].hidden, false);
  unsaved.els["restore-bookmark"].click();
  await unsaved.settle();
  assert.equal(unsaved.data.videos.aaaaaaaaaaa.t, 100);
  assert.equal(unsaved.data.settings.autoBookmark, false);
  assert.equal(unsaved.els["restore-bookmark"].hidden, true);
  assert.equal(unsaved.els["search-control"].hidden, false);
  const manualSearch = await createPopupFixture({ settings: { autoBookmark: false } });
  manualSearch.doc.listeners.keydown({ key: "/", preventDefault() {} });
  assert.equal(manualSearch.doc.activeElement, manualSearch.els.search);
  await vm.runInContext("render()", manualSearch.context);
  assert.equal(
    manualSearch.els["restore-bookmark"].hidden,
    true,
    "storage refresh must not steal search",
  );
  assert.equal(manualSearch.els["search-control"].hidden, false);
  const toggled = await createPopupFixture(initial);
  await vm.runInContext("settings.autoBookmark = true", toggled.context);
  toggled.els["options-toggle"].click();
  toggled.els["auto-bookmark"].checked = false;
  toggled.els["auto-bookmark"].events.change();
  await toggled.settle();
  toggled.els["options-toggle"].click();
  assert.equal(toggled.els["restore-bookmark"].hidden, false);
  assert.equal(toggled.els["search-control"].hidden, true);
  assert.equal(
    existing.els["restore-bookmark"].hidden,
    true,
    "already saved video needs no Add button",
  );
  assert.equal(existing.writes(), 0, "existing position must not be overwritten");
  console.log(
    "PASS: manual bookmark button with auto-bookmark off, save/return to search, slash override survives refresh, options toggle, existing bookmark untouched",
  );
  const nonVideo = await createPopupFixture({}, "https://example.com/");
  assert.equal(nonVideo.doc.activeElement, nonVideo.els.search);
  console.log(
    "PASS: bookmarked row focused/scrolled; unsaved video gets manual action; non-video page gets search",
  );
  p.els.search.value = "no match";
  p.els.search.events.input();
  assert.equal(p.data.videos.aaaaaaaaaaa.t, 100);
  console.log("PASS: default auto-bookmark retained");
  const scrubber = await createPopupFixture({
    settings: { autoBookmark: false, scrubSeconds: 7, shiftMultiplier: 4 },
    videos: {
      aaaaaaaaaaa: { id: "aaaaaaaaaaa", title: "Saved", t: 100, duration: 1000, updated: 1 },
    },
  });
  scrubber.doc.listeners.keydown({ key: "ArrowRight", preventDefault() {} });
  await scrubber.settle();
  assert.equal(scrubber.data.videos.aaaaaaaaaaa.t, 107);
  scrubber.doc.listeners.keydown({ key: "ArrowLeft", shiftKey: true, preventDefault() {} });
  await scrubber.settle();
  assert.equal(scrubber.data.videos.aaaaaaaaaaa.t, 79);
  for (const key of [">", "<", ".", ","]) {
    scrubber.doc.listeners.keydown({ key, preventDefault() {} });
    await scrubber.settle();
    assert.equal(
      scrubber.data.videos.aaaaaaaaaaa.t,
      79,
      "frame/rate controls never change a closed video resume point",
    );
    assert.match(scrubber.els.status.textContent, /Open this video/);
  }
  console.log("PASS: ordinary popup uses saved arrow scrub distance and Shift multiplier");
  const controlsId = "abcdefghijk";
  const timedTranscript = {
    id: controlsId,
    complete: true,
    source: "youtube-transcript-response",
    language: "English",
    segments: [
      { start: 0, end: 5, text: "First line" },
      { start: 90, end: 95, text: "Second line" },
    ],
    duration: 100,
  };
  let transcriptResult = timedTranscript;
  const controls = await createPopupFixture(
    {
      settings: { autoBookmark: false },
      videos: {
        [controlsId]: { id: controlsId, title: "Saved", t: 100, duration: 1000, updated: 1 },
      },
    },
    "https://example.com/",
    {
      tabs: [{ id: 7, url: `https://www.youtube.com/watch?v=${controlsId}` }],
      executeScript: async (request) => {
        if (request.func.name === "transcript") return [{ result: transcriptResult }];
        assert.equal(request.world, "MAIN");
        return [
          {
            result:
              request.args[0] === "rate"
                ? { id: controlsId, rate: 1.25 }
                : { id: controlsId, t: 101, duration: 1000, paused: true, fps: 60 },
          },
        ];
      },
    },
  );
  const controlKey = async (key, extra = {}) => {
    controls.doc.listeners.keydown({ key, preventDefault() {}, ...extra });
    await controls.settle();
  };
  controls.els.list.querySelectorAll(".main")[0].focus();
  for (const [key, extra, action, direction] of [
    [",", {}, "frame", -1],
    [".", {}, "frame", 1],
    ["<", {}, "rate", -1],
    [">", {}, "rate", 1],
    [",", { shiftKey: true }, "rate", -1],
    [".", { shiftKey: true }, "rate", 1],
  ]) {
    await controlKey(key, extra);
    assert.deepEqual(controls.executions.at(-1), {
      operation: "playback",
      args: [action, direction, controlsId],
      tabId: 7,
    });
  }
  await controlKey("T", { shiftKey: true });
  assert.match(
    controls.clipboardWrites.at(-1),
    /\[1:30\]\(https:\/\/www.youtube.com\/watch\?v=abcdefghijk&t=90s\) · Second line/,
  );
  assert.equal(controls.els["offer-save-file"].checked, false);
  assert.ok(!controls.els["file-save-dialog"].open, "default does not offer a file");
  assert.notEqual(
    controls.data.settings.showThumbnails,
    false,
    "uppercase T must not toggle thumbnails",
  );
  const executionCount = controls.executions.length;
  for (const extra of [{ repeat: true }, { ctrlKey: true }, { metaKey: true }, { altKey: true }])
    await controlKey("T", extra);
  assert.equal(controls.executions.length, executionCount);
  controls.els.search.focus();
  for (const key of ["T", ",", ".", "<", ">"])
    await controlKey(key, {
      preventDefault() {
        throw Error("search intercepted");
      },
    });
  assert.equal(controls.executions.length, executionCount);
  controls.els.list.querySelectorAll(".main")[0].focus();
  await controlKey("h");
  await controlKey("T");
  assert.equal(controls.executions.length, executionCount);
  await controlKey("h");
  const transcriptCopies = controls.clipboardWrites.length;
  for (const result of [{ error: "No transcript available." }, { text: "" }, null]) {
    transcriptResult = result;
    await controlKey("T");
    assert.equal(
      controls.clipboardWrites.length,
      transcriptCopies,
      "unavailable transcript preserves clipboard",
    );
    assert.match(controls.els.status.textContent, /transcript/);
  }
  scrubber.doc.listeners.keydown({ key: "T", preventDefault() {} });
  await scrubber.settle();
  assert.match(scrubber.els.status.textContent, /Open this video/);
  assert.equal(scrubber.clipboardWrites.length, 0);
  console.log(
    "PASS: frame/speed shortcut routing, open-tab requirement, uppercase transcript copy, repeats/modifiers/search/help guards",
  );
  for (const [result, message] of [
    [{ error: new Error("Permission denied to page method") }, "Permission denied to page method"],
    [{}, "returned no result"],
  ]) {
    const failure = await createPopupFixture(
      { settings: { autoBookmark: false } },
      "https://example.com/",
      {
        executeScript: async () => [result],
      },
    );
    const response = await vm.runInContext(
      'playerClient.inPlayer(7,"playback",["frame",1,"abcdefghijk"])',
      failure.context,
    );
    assert.ok(
      response.error.includes(message),
      "injection failures must retain an actionable reason",
    );
  }
  let worldAttempts = [];
  const compatibility = await createPopupFixture(
    { settings: { autoBookmark: false } },
    "https://example.com/",
    {
      executeScript: async (request) => {
        worldAttempts.push(request.world);
        if (request.world === "MAIN")
          throw Error("Invalid value MAIN for world: unsupported world");
        return [{ result: { id: request.args[2], rate: 1.25 } }];
      },
    },
  );
  const compatibilityResult = await vm.runInContext(
    'playerClient.inPlayer(7,"playback",["rate",1,"abcdefghijk"])',
    compatibility.context,
  );
  if (flavor === "firefox") {
    assert.equal(compatibilityResult.rate, 1.25);
    assert.deepEqual(worldAttempts, ["MAIN", undefined]);
  } else {
    assert.match(compatibilityResult.error, /Invalid value/);
    assert.deepEqual(worldAttempts, ["MAIN"]);
  }

  transcriptResult = timedTranscript;
  controls.els["options-toggle"].click();
  assert.match(controls.els["transcript-target"].textContent, /Saved/);
  controls.els["transcript-format-toggle"].click();
  assert.equal(controls.els["transcript-format-menu"].hidden, false);
  const choices = controls.els["transcript-format-list"].children;
  assert.equal(choices.length, 7);
  const currentLabel = controls.els["transcript-format-toggle"].textContent;
  choices[4].events.mouseenter();
  assert.match(controls.els["transcript-format-use"].textContent, /Subtitle editors/);
  assert.equal(
    controls.els["transcript-format-toggle"].textContent,
    currentLabel,
    "hover previews without committing",
  );
  await controlKey("Escape");
  assert.equal(controls.els["transcript-format-menu"].hidden, true);
  assert.equal(controls.doc.activeElement, controls.els["transcript-format-toggle"]);
  controls.els["transcript-format-toggle"].click();
  await controlKey("End");
  assert.match(controls.els["transcript-format-use"].textContent, /Scripts/);
  await controlKey("Enter");
  assert.equal(controls.data.settings.transcriptFormat, "json");
  assert.equal(controls.els["transcript-format-menu"].hidden, true);
  controls.els["copy-transcript"].click();
  await controls.settle();
  assert.equal(JSON.parse(controls.clipboardWrites.at(-1)).segments[1].end, 95);
  controls.els["offer-save-file"].checked = true;
  controls.els["offer-save-file"].events.change();
  await controls.settle();
  assert.equal(controls.data.settings.offerSaveFile, true);
  controls.els["copy-transcript"].click();
  await controls.settle();
  assert.equal(controls.els["file-save-dialog"].open, true);
  assert.equal(controls.downloads.length, 0, "offering never downloads automatically");
  assert.equal(controls.els["file-name-fields"].hidden, true);
  const beforeSaveCopy = controls.clipboardWrites.at(-1);
  controls.els["file-save-confirm"].click();
  assert.equal(controls.doc.activeElement, controls.els["file-save-name"]);
  controls.els["file-save-name"].value = "../bad";
  controls.els["file-save-confirm"].click();
  assert.equal(controls.downloads.length, 0);
  assert.match(controls.els["file-save-error"].textContent, /filename/);
  controls.els["file-save-name"].value = "my-transcript";
  controls.els["file-save-confirm"].click();
  assert.equal(controls.downloads.at(-1).filename, "my-transcript.json");
  assert.equal(controls.clipboardWrites.at(-1), beforeSaveCopy, "saving never replaces clipboard");
  const jsonFile = await (await fetch(controls.downloads.at(-1).href)).text();
  assert.equal(JSON.parse(jsonFile).video.id, controlsId);
  assert.equal(controls.els["file-save-dialog"].open, false);
  controls.els["copy-videos"].click();
  await controls.settle();
  const allVideosCopy = controls.clipboardWrites.at(-1);
  assert.equal(JSON.parse(allVideosCopy).format, "yt-waypoints");
  assert.equal(
    controls.els["file-save-dialog"].open,
    true,
    "global JSON uses the same offer toggle",
  );
  assert.match(controls.els["file-save-name"].value, /^yt-waypoints-bookmarks-.*\.json$/);
  controls.els["file-save-cancel"].click();
  assert.equal(controls.clipboardWrites.at(-1), allVideosCopy);
  assert.equal(controls.downloads.length, 1);
  controls.els["copy-videos"].click();
  await controls.settle();
  controls.els["file-save-confirm"].click();
  controls.els["file-save-name"].value = "all-videos.json";
  controls.els["file-save-confirm"].click();
  const savedBookmarks = await (await fetch(controls.downloads.at(-1).href)).text();
  assert.equal(
    savedBookmarks,
    controls.clipboardWrites.at(-1),
    "saved global JSON exactly matches clipboard",
  );
  controls.els["copy-videos"].click();
  await controls.settle();
  const duringPrompt = controls.clipboardWrites.length;
  await controlKey("C");
  await controlKey("t");
  assert.equal(
    controls.clipboardWrites.length,
    duringPrompt,
    "save dialog blocks background shortcuts",
  );
  await controls.paste("{bad");
  assert.equal(controls.clipboardWrites.length, duringPrompt);
  await controlKey("Escape");
  assert.equal(controls.els["file-save-dialog"].open, false);
  controls.els["copy-videos"].click();
  await controls.settle();
  const failedSaveCopy = controls.clipboardWrites.at(-1);
  controls.els["file-save-confirm"].click();
  controls.context.Blob = class {
    constructor() {
      throw Error("Download unavailable");
    }
  };
  controls.els["file-save-confirm"].click();
  assert.equal(controls.els["file-save-dialog"].open, true);
  assert.match(controls.els["file-save-error"].textContent, /clipboard copy is unchanged/);
  assert.equal(controls.clipboardWrites.at(-1), failedSaveCopy);
  controls.context.Blob = Blob;
  controls.els["file-save-cancel"].click();
  controls.els["options-toggle"].click();
  controls.els.list.querySelectorAll(".main")[0].focus();
  await controlKey("c");
  assert.equal(
    controls.els["file-save-dialog"].open,
    false,
    "single-row copy is outside the global JSON offer",
  );
  await controlKey("C");
  assert.equal(
    controls.els["file-save-dialog"].open,
    true,
    "uppercase C offers the all-bookmark file",
  );
  controls.els["file-save-cancel"].click();
  controls.els["options-toggle"].click();
  controls.els["offer-save-file"].checked = false;
  controls.els["offer-save-file"].events.change();
  await controls.settle();
  controls.els["copy-videos"].click();
  await controls.settle();
  assert.equal(
    controls.els["file-save-dialog"].open,
    false,
    "turning the shared option off suppresses JSON offers",
  );
  controls.els["copy-transcript"].click();
  await controls.settle();
  assert.equal(
    controls.els["file-save-dialog"].open,
    false,
    "turning the shared option off suppresses transcript offers",
  );
  controls.els["offer-save-file"].checked = true;
  controls.els["offer-save-file"].events.change();
  await controls.settle();
  const reopenedFormats = await createPopupFixture(controls.data, "https://example.com/");
  assert.equal(
    reopenedFormats.els["transcript-format-toggle"].textContent,
    "JSON with timed segments",
  );
  assert.equal(reopenedFormats.els["offer-save-file"].checked, true);
  const invalidFormat = await createPopupFixture(
    { settings: { autoBookmark: false, transcriptFormat: "bad" } },
    "https://example.com/",
  );
  assert.equal(
    invalidFormat.els["transcript-format-toggle"].textContent,
    "Markdown with linked timestamps",
  );
  invalidFormat.els["options-toggle"].click();
  assert.equal(invalidFormat.els["copy-transcript"].disabled, true);
  const failedClipboard = await createPopupFixture(
    {
      settings: { autoBookmark: false, offerSaveFile: true },
      videos: { [controlsId]: { id: controlsId, title: "Saved", t: 0 } },
    },
    "https://example.com/",
    {
      tabs: [{ id: 7, url: `https://www.youtube.com/watch?v=${controlsId}` }],
      failClipboard: true,
      failLegacyClipboard: true,
      executeScript: async () => [{ result: timedTranscript }],
    },
  );
  failedClipboard.els["copy-videos"].click();
  await failedClipboard.settle();
  assert.ok(!failedClipboard.els["file-save-dialog"].open);
  assert.match(failedClipboard.els.status.textContent, /Could not copy JSON/);
  failedClipboard.els.list.querySelectorAll(".main")[0].focus();
  failedClipboard.doc.listeners.keydown({ key: "T", preventDefault() {} });
  await failedClipboard.settle();
  assert.ok(!failedClipboard.els["file-save-dialog"].open);
  assert.match(failedClipboard.els.status.textContent, /Could not copy transcript/);
  for (const timer of controls.timers) timer();
  console.log(
    "PASS: default linked Markdown, dropdown hover/focus, keyboard commit/Escape, persistent preferences, transcript/global JSON clipboard-first offers, filename validation, downloads and cancellation",
  );
  const undo = await createPopupFixture(initial);
  await vm.runInContext('bookmarks.deleteVideo("b")', undo.context);
  assert.equal(undo.els["restore-bookmark"].hidden, false);
  assert.equal(undo.els["search-control"].hidden, true);
  undo.els["options-toggle"].click();
  assert.equal(undo.els["restore-bookmark"].hidden, true);
  undo.els["options-toggle"].click();
  assert.equal(undo.els["restore-bookmark"].hidden, false);
  undo.els["restore-bookmark"].click();
  await undo.settle();
  assert.deepEqual(
    undo.data.videos.b,
    initial.videos.b,
    "restore exact deleted entry/time, not the active video",
  );
  assert.equal(undo.els["restore-bookmark"].hidden, true);
  assert.equal(undo.els["search-control"].hidden, false);
  await vm.runInContext('bookmarks.deleteVideo("b");', undo.context);
  await vm.runInContext('bookmarks.deleteVideo("c");', undo.context);
  undo.els["restore-bookmark"].click();
  await undo.settle();
  assert.equal(undo.data.videos.b, undefined);
  assert.deepEqual(undo.data.videos.c, initial.videos.c);
  await vm.runInContext('bookmarks.deleteVideo("c")', undo.context);
  await vm.runInContext(
    '(async () => { const snapshot = await bookmarks.loadSnapshot(); const { videos } = snapshot; videos.c = { id: "c", title: "Video animation tips", t: 999, updated: 1 }; await bookmarks.saveSnapshot(snapshot); })()',
    undo.context,
  );
  undo.els["restore-bookmark"].click();
  await undo.settle();
  assert.equal(undo.data.videos.c.t, 999, "undo must not overwrite a newly saved entry");
  console.log(
    "PASS: deletion shows restore button, undo preserves original bookmark, latest deletion wins, slash returns to search, options hide button, newer saves preserved",
  );
  const defaults = await createPopupFixture(initial);
  assert.equal(defaults.els["show-thumbnails"].checked, true, "missing preference defaults to on");
  const thumbs = await createPopupFixture({
    ...initial,
    settings: { ...initial.settings, showThumbnails: false },
  });
  // Use tag-aware traversal for img checks, independent of row markup.
  const collect = (el, tag) =>
    el.children.flatMap((c) => [...(c.tag === tag ? [c] : []), ...collect(c, tag)]);
  assert.equal(collect(defaults.els.list, "img").length, 3, "default setting renders thumbnails");
  assert.equal(collect(thumbs.els.list, "img").length, 0, "explicit off preference is preserved");
  const row = thumbs.els.list.querySelectorAll(".main")[1];
  row.focus();
  thumbs.doc.listeners.keydown({ key: "t", preventDefault() {} });
  await thumbs.settle();
  assert.equal(
    thumbs.els["options-panel"].hidden,
    true,
    "t toggles without opening Options or a confirmation",
  );
  assert.equal(thumbs.data.settings.showThumbnails, true);
  assert.equal(thumbs.els["show-thumbnails"].checked, true);
  assert.equal(thumbs.doc.activeElement.dataset.id, row.dataset.id);
  let imgs = collect(thumbs.els.list, "img");
  assert.equal(imgs.length, 3);
  assert.equal(imgs[0].src, "https://i.ytimg.com/vi/a/mqdefault.jpg");
  assert.equal(imgs[0].referrerPolicy, "no-referrer");
  assert.equal(imgs[0].loading, "lazy");
  imgs[0].events.error();
  assert.equal(imgs[0].hidden, true, "unavailable image hides broken-image icon");
  const writes = thumbs.writes();
  thumbs.doc.listeners.keydown({ key: "t", repeat: true, preventDefault() {} });
  await thumbs.settle();
  assert.equal(thumbs.writes(), writes, "held shortcut toggles only once");
  thumbs.doc.listeners.keydown({
    key: "t",
    ctrlKey: true,
    preventDefault() {
      throw Error("modified t intercepted");
    },
  });
  thumbs.els.search.focus();
  thumbs.doc.listeners.keydown({
    key: "t",
    preventDefault() {
      throw Error("search t intercepted");
    },
  });
  assert.equal(thumbs.data.settings.showThumbnails, true);
  thumbs.els["options-toggle"].click();
  thumbs.els["show-thumbnails"].checked = false;
  thumbs.els["show-thumbnails"].events.change();
  await thumbs.settle();
  assert.equal(thumbs.data.settings.showThumbnails, false);
  assert.equal(collect(thumbs.els.list, "img").length, 0);
  thumbs.els["show-thumbnails"].checked = true;
  thumbs.els["show-thumbnails"].events.change();
  await thumbs.settle();
  assert.equal(thumbs.data.settings.showThumbnails, true);
  thumbs.els["scrub-seconds"].value = "12";
  thumbs.els["shift-multiplier"].value = "4";
  thumbs.els["scrub-seconds"].events.change();
  await thumbs.settle();
  assert.equal(
    thumbs.data.settings.showThumbnails,
    true,
    "other preference edits preserve thumbnail choice",
  );
  const reopened = await createPopupFixture(thumbs.data);
  assert.equal(reopened.els["show-thumbnails"].checked, true, "preference survives reopening");
  assert.equal(collect(reopened.els.list, "img").length, 3);
  thumbs.els["options-toggle"].click();
  thumbs.els.search.value = "resolve";
  thumbs.els.search.events.input();
  assert.equal(collect(thumbs.els.list, "img").length, 1, "only matching rows load images");
  const upgraded = await createPopupFixture({
    ...initial,
    settings: { autoBookmark: false, showThumbnails: true, thumbnailNoticeAccepted: true },
  });
  assert.equal(
    upgraded.els["show-thumbnails"].checked,
    true,
    "existing thumbnail preference survives the update",
  );
  assert.equal(collect(upgraded.els.list, "img").length, 3);
  console.log(
    "PASS: direct thumbnail shortcut/checkbox without permissions API; setting persists; typing/modifiers/repeat safe; filtered images/focus/error fallback; upgrade keeps preference",
  );
  const videoId = "dQw4w9WgXcQ";
  const pasted = await createPopupFixture({ settings: { autoBookmark: false } });
  assert.equal(pasted.doc.activeElement, pasted.els["restore-bookmark"]);
  assert.equal(await pasted.paste(`https://youtu.be/${videoId}?si=tracking&t=1m30s`), true);
  assert.deepEqual(pasted.navigation, [
    { type: "update", id: 1, url: `https://www.youtube.com/watch?v=${videoId}&t=90s` },
  ]);
  assert.equal(pasted.els.search.value, "");
  assert.equal(pasted.els["clear-search"].hidden, true);
  assert.equal(pasted.els["search-control"].hidden, false);
  assert.equal(pasted.closed(), 1);
  assert.equal(pasted.writes(), 0, "pasting does not modify bookmarks");
  const bookmark = { id: videoId, title: "Saved", t: 123, duration: 1000, updated: 1 };
  const saved = { settings: { autoBookmark: false }, videos: { [videoId]: bookmark } };
  const tab = { id: 9, windowId: 3, url: `https://www.youtube.com/watch?v=${videoId}` };
  const existingPaste = await createPopupFixture(saved, undefined, { tabs: [tab] });
  await existingPaste.paste(tab.url + "&ignored=invalid");
  assert.deepEqual(existingPaste.navigation, [
    { type: "window", id: 3, focused: true },
    { type: "update", id: 9, active: true },
  ]);
  const timed = await createPopupFixture(saved, undefined, { tabs: [tab] });
  await timed.paste(tab.url + "&t=80");
  assert.equal(timed.navigation[0].url, tab.url + "&t=80s");
  assert.equal(timed.navigation.at(-1).active, true);
  const newTab = await createPopupFixture(saved, "https://example.com/");
  newTab.els["options-toggle"].click();
  await newTab.paste(tab.url + "&list=playlist&si=tracking");
  assert.deepEqual(newTab.navigation, [{ type: "create", url: tab.url + "&t=123s" }]);
  assert.equal(newTab.els["options-panel"].hidden, true);
  const queryPaste = await createPopupFixture(initial);
  queryPaste.els.search.focus();
  await queryPaste.paste(tab.url);
  assert.equal(queryPaste.closed(), 1);
  const textPaste = await createPopupFixture(initial);
  textPaste.els.list.querySelectorAll(".main")[0].focus();
  assert.equal(await textPaste.paste("VIDEO"), true);
  assert.equal(textPaste.doc.activeElement, textPaste.els.search);
  assert.deepEqual(
    textPaste.els.list.querySelectorAll(".main").map((r) => r.dataset.id),
    ["b", "c"],
  );
  assert.equal(textPaste.navigation.length, 0);
  assert.equal(textPaste.closed(), 0);
  assert.equal(
    await textPaste.paste("more text"),
    false,
    "ordinary paste in search uses native text editing",
  );
  const failed = await createPopupFixture({ settings: { autoBookmark: false } }, undefined, {
    failNavigation: true,
  });
  await failed.paste(tab.url);
  assert.equal(failed.closed(), 0);
  assert.equal(failed.els.search.value, tab.url);
  assert.equal(failed.els.status.textContent, "Navigation failed");
  const parsed = (value) =>
    JSON.parse(
      vm.runInContext(
        "JSON.stringify(playerClient.parseVideoLink(" + JSON.stringify(value) + "))",
        pasted.context,
      ),
    );
  for (const link of [
    tab.url,
    `https://youtube.com/watch?v=${videoId}`,
    `www.youtube.com/watch?v=${videoId}`,
    `https://m.youtube.com/shorts/${videoId}`,
    `https://www.youtube.com/live/${videoId}`,
    `https://www.youtube.com/embed/${videoId}`,
  ]) {
    assert.deepEqual(parsed(link), { id: videoId, t: null });
  }
  assert.equal(parsed(tab.url + "&t=1h2m3s").t, 3723);
  assert.equal(parsed(tab.url + "#t=45s").t, 45);
  assert.equal(parsed(`https://www.youtube.com/embed/${videoId}?start=0`).t, 0);
  for (const invalid of [
    "javascript:alert(1)",
    "data:text/html,test",
    "file:///tmp/video",
    `https://www.youtube.com.evil.example/watch?v=${videoId}`,
    `https://youtube.com@evil.example/watch?v=${videoId}`,
    `https://someone@www.youtube.com/watch?v=${videoId}`,
    `https://www.youtube.com:8443/watch?v=${videoId}`,
    `https://www.youtube.com/redirect?q=${encodeURIComponent(tab.url)}`,
    `https://www.youtube.com/channel/${videoId}`,
    tab.url + "&v=aaaaaaaaaaa",
    tab.url + "&t=-1",
    tab.url + "&t=oops",
    tab.url + "&t=999999999999999999999999",
    "https://youtube.com/watch?v=short",
    "https://youtube.com/watch?v=%3Cscript%3E",
    tab.url + " " + tab.url,
  ]) {
    assert.equal(parsed(invalid), null, invalid);
    const bad = await createPopupFixture({ settings: { autoBookmark: false } });
    await bad.paste(invalid);
    assert.equal(bad.navigation.length, 0, invalid);
    assert.equal(bad.writes(), 0);
  }
  console.log(
    "PASS: paste anywhere navigates using canonical YouTube links, honors timestamps/resume points, clears search on success, keeps failed input, text filters normally, unsafe URLs never navigate",
  );
  const channelData = {
    settings: { autoBookmark: false, showThumbnails: false },
    videos: {
      a: {
        id: "a",
        title: "The EV push",
        channelName: "Bloomberg",
        channelUrl: "https://www.youtube.com/@Bloomberg",
        t: 30,
        updated: 2,
      },
      b: {
        id: "b",
        title: "Bloomberg interview recap",
        channelName: "Tech Talks",
        t: 15,
        updated: 1,
      },
      c: { id: "c", title: "Old bookmark", t: 10, updated: 0 },
    },
  };
  const channels = await createPopupFixture(channelData);
  assert.equal(channels.els["include-channel-names"].checked, true);
  channels.doc.listeners.keydown({ key: "/", preventDefault() {} });
  channels.els.search.value = "bLoOmBeRg";
  channels.els.search.events.input();
  const channelRows = () => channels.els.list.querySelectorAll(".main").map((r) => r.dataset.id);
  assert.deepEqual(
    channelRows(),
    ["a", "b"],
    "default search matches channel or title, ignoring case",
  );
  channels.els["options-toggle"].click();
  channels.els["include-channel-names"].checked = false;
  channels.els["include-channel-names"].events.change();
  await channels.settle();
  assert.deepEqual(channelRows(), ["b"], "disabling channel search keeps title matches");
  assert.equal(channels.data.settings.includeChannelNames, false);
  channels.els["options-toggle"].click();
  const channelReopen = await createPopupFixture(channels.data);
  assert.equal(
    channelReopen.els["include-channel-names"].checked,
    false,
    "explicit off preference persists",
  );
  channels.els["options-toggle"].click();
  channels.els["include-channel-names"].checked = true;
  channels.els["include-channel-names"].events.change();
  await channels.settle();
  assert.deepEqual(channelRows(), ["a", "b"]);
  assert.deepEqual(
    channels.data.videos,
    channelData.videos,
    "search preference never edits bookmarks",
  );
  const legacy = {
    settings: { autoBookmark: false },
    videos: {
      aaaaaaaaaaa: {
        id: "aaaaaaaaaaa",
        title: "Original title",
        t: 42,
        duration: 1000,
        updated: 123,
      },
    },
  };
  const metadata = {
    id: "aaaaaaaaaaa",
    title: "Page title",
    t: 900,
    duration: 1000,
    channelName: "Bloomberg",
    channelUrl: "https://www.youtube.com/@Bloomberg",
  };
  const enriched = await createPopupFixture(legacy, undefined, { metadata });
  assert.equal(enriched.data.videos.aaaaaaaaaaa.channelName, "Bloomberg");
  assert.equal(enriched.data.videos.aaaaaaaaaaa.t, 42);
  assert.equal(enriched.data.videos.aaaaaaaaaaa.updated, 123);
  assert.equal(enriched.data.videos.aaaaaaaaaaa.title, "Original title");
  assert.equal(enriched.writes(), 1);
  const present = await createPopupFixture(enriched.data, undefined, { metadata });
  assert.equal(present.writes(), 0);
  const unavailable = await createPopupFixture(enriched.data);
  assert.equal(unavailable.data.videos.aaaaaaaaaaa.channelName, "Bloomberg");
  const wrong = await createPopupFixture(legacy, undefined, {
    metadata: { ...metadata, id: "previous" },
  });
  assert.equal(wrong.data.videos.aaaaaaaaaaa.channelName, undefined);
  assert.equal(wrong.writes(), 0);
  const newBookmark = await createPopupFixture({ settings: { autoBookmark: false } }, undefined, {
    metadata,
  });
  newBookmark.els["restore-bookmark"].click();
  await newBookmark.settle();
  assert.equal(newBookmark.data.videos.aaaaaaaaaaa.channelName, "Bloomberg");
  console.log(
    "PASS: case-insensitive title/channel search, default on, persisted off toggle, missing channel tolerated, channel capture/backfill preserves saved time and recency",
  );
  const seekData = {
    settings: { autoBookmark: false, scrubSeconds: 7, shiftMultiplier: 4 },
    videos: {
      aaaaaaaaaaa: { id: "aaaaaaaaaaa", title: "Scrub me", t: 100, duration: 1000, updated: 123 },
    },
  };
  // Relative saved-only movement retains fractional time and treats unknown
  // duration as unbounded. Absolute slider commits floor and retain a zero bound.
  for (const [method, time, duration, value, expected] of [
    ["scrub", 100.75, 1000, 7.5, 108.25],
    ["scrub", 100.75, 1000, -200, 0],
    ["scrub", 995.5, 1000, 10, 1000],
    ["scrub", 100.75, 0, 7.5, 108.25],
    ["seekTo", 100.75, 1000, 108.75, 108],
    ["seekTo", 100.75, 1000, -10, 0],
    ["seekTo", 100.75, 1000, 1500, 1000],
    ["seekTo", 0, 0, 108.75, 0],
  ]) {
    const saved = await createPopupFixture(
      {
        ...seekData,
        videos: { aaaaaaaaaaa: { ...seekData.videos.aaaaaaaaaaa, t: time, duration } },
      },
      "https://example.com/",
    );
    await vm.runInContext(`bookmarks.${method}("aaaaaaaaaaa", ${value})`, saved.context);
    assert.equal(saved.data.videos.aaaaaaaaaaa.t, expected, `${method}, duration ${duration}`);
    assert.equal(saved.data.videos.aaaaaaaaaaa.updated, 123);
    assert.equal(saved.data.videos.aaaaaaaaaaa.duration, duration);
    assert.equal(
      saved.els.status.textContent,
      `Resume point ${Math.floor(expected / 60)}:${String(Math.floor(expected % 60)).padStart(2, "0")}`,
    );
    assert.equal(saved.executions.length, 0);
  }
  for (const [method, operation] of [
    ["scrub", "seek"],
    ["seekTo", "seekTo"],
  ]) {
    for (const paused of [false, true]) {
      const seeking = await createPopupFixture(seekData, "https://example.com/", {
        tabs: [{ id: 7, url: "https://www.youtube.com/watch?v=aaaaaaaaaaa" }],
        executeScript: async () => [
          { result: { id: "aaaaaaaaaaa", t: 750, duration: 1200, paused } },
        ],
      });
      seeking.executions.length = 0; // Exclude the startup chapter probe.
      await vm.runInContext(`bookmarks.${method}("aaaaaaaaaaa", 7.5)`, seeking.context);
      assert.deepEqual(seeking.executions, [{ operation, args: [7.5, "aaaaaaaaaaa"], tabId: 7 }]);
      assert.equal(
        seeking.data.videos.aaaaaaaaaaa.t,
        750,
        "use the validated live position rather than calculating from saved time",
      );
      assert.equal(seeking.data.videos.aaaaaaaaaaa.duration, 1200);
      assert.equal(seeking.data.videos.aaaaaaaaaaa.updated, 123);
      assert.equal(seeking.writes(), 1);
      assert.equal(seeking.els.status.textContent, `${paused ? "⏸ Paused" : "▶ Playing"} at 12:30`);
      await vm.runInContext(`bookmarks.${method}("missing", 7.5)`, seeking.context);
      assert.equal(seeking.executions.length, 1, "missing bookmarks cannot request a seek");
      assert.equal(seeking.writes(), 1);
    }
  }
  console.log(
    "PASS: shared seek flow preserves relative/absolute bounds, fractional/rounded saved times, live results, recency, status and one request/save",
  );

  const drag = await createPopupFixture(seekData, "https://example.com/");
  const findSlider = () => {
    const walk = (el) => (el.className === "bar" ? el : el.children.map(walk).find(Boolean));
    return walk(drag.els.list);
  };
  let slider = findSlider();
  assert.equal(slider.type, "range");
  assert.equal(slider.value, "100");
  let stopped = false;
  slider.events.click({
    stopPropagation() {
      stopped = true;
    },
  });
  assert.equal(stopped, true);
  slider.events.pointerdown({ button: 0, pointerId: 1, stopPropagation() {} });
  slider.value = "650";
  slider.events.input();
  assert.equal(drag.data.videos.aaaaaaaaaaa.t, 100, "drag only previews before release");
  assert.equal(drag.writes(), 0);
  assert.equal(slider.style["--progress"], "65%");
  await vm.runInContext(
    '(async () => { const snapshot = await bookmarks.loadSnapshot(); const { videos } = snapshot; videos.extra = {id: "extra",title: "Concurrent bookmark",t:5,duration:60,updated:1}; videos.aaaaaaaaaaa.t = 105; await bookmarks.saveSnapshot(snapshot); })()',
    drag.context,
  );
  const writesBeforeDragCommit = drag.writes();
  await vm.runInContext("render()", drag.context);
  assert.equal(findSlider(), slider, "autosave rerender keeps the native dragging element");
  assert.equal(slider.value, "650");
  slider.events.pointerup();
  slider.events.change();
  await drag.settle();
  assert.equal(drag.data.videos.aaaaaaaaaaa.t, 650);
  assert.equal(drag.data.videos.aaaaaaaaaaa.updated, 123);
  assert.equal(drag.writes(), writesBeforeDragCommit + 1, "pointerup/change commits once");
  assert.ok(drag.data.videos.extra);
  assert.equal(drag.navigation.length, 0);
  assert.equal(drag.closed(), 0);
  slider = findSlider();
  slider.events.pointerdown({ button: 0, pointerId: 2, stopPropagation() {} });
  slider.value = "850";
  slider.events.input();
  slider.events.pointercancel();
  slider.events.change();
  await drag.settle();
  assert.equal(
    drag.data.videos.aaaaaaaaaaa.t,
    650,
    "cancelled drag restores original saved position",
  );
  assert.equal(findSlider().value, "650");
  assert.equal(drag.writes(), writesBeforeDragCommit + 1);
  slider = findSlider();
  slider.events.pointerdown({ button: 0, pointerId: 3, stopPropagation() {} });
  slider.events.pointerup();
  await drag.settle();
  assert.equal(
    drag.writes(),
    writesBeforeDragCommit + 1,
    "clicking an unchanged position cannot freeze rendering or write",
  );
  slider = findSlider();
  slider.focus();
  slider.events.keydown({
    key: "ArrowRight",
    shiftKey: true,
    preventDefault() {},
    stopPropagation() {},
  });
  await drag.settle();
  assert.equal(
    drag.data.videos.aaaaaaaaaaa.t,
    678,
    "slider keyboard follows configured Shift multiplier",
  );
  const live = await createPopupFixture(seekData, "https://example.com/", {
    tabs: [{ id: 7, windowId: 1, url: "https://www.youtube.com/watch?v=aaaaaaaaaaa" }],
    executeScript: async (request, data) => {
      data.videos.late = { id: "late", title: "Added while seeking", t: 2, duration: 50 };
      return [{ result: { id: "aaaaaaaaaaa", t: 750, duration: 1000, paused: true } }];
    },
  });
  const liveSlider = live.els.list.querySelectorAll(".bar")[0];
  liveSlider.value = "750";
  liveSlider.events.input();
  liveSlider.events.change();
  await live.settle();
  assert.equal(live.data.videos.aaaaaaaaaaa.t, 750);
  assert.ok(live.data.videos.late);
  assert.deepEqual(live.executions.at(-1), {
    operation: "seekTo",
    args: [750, "aaaaaaaaaaa"],
    tabId: 7,
  });
  assert.equal(live.navigation.length, 0);
  assert.equal(live.closed(), 0);
  assert.ok(live.els.status.textContent.includes("Paused"));
  console.log(
    "PASS: drag preview/commit/cancel, no row-open click, active drag survives autosave, single commit, configured keyboard steps, live seek and saved-only seek preserve other bookmarks",
  );
  // Deliver the same key through document capture and then the focused target.
  // Calling only slider.events.keydown misses the original duplicate-seek bug.
  async function dispatchKey(popup, target, key, extra = {}) {
    let stopped = false;
    const event = {
      key,
      target,
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
      stopPropagation() {
        stopped = true;
      },
      ...extra,
    };
    target.focus();
    popup.doc.listeners.keydown(event);
    if (!stopped) target.events.keydown?.(event);
    await popup.settle();
    return event;
  }
  const barOf = (popup) => {
    const walk = (element) =>
      element.className === "bar" ? element : element.children.map(walk).find(Boolean);
    return walk(popup.els.list);
  };
  for (const [key, shiftKey, expected] of [
    ["ArrowRight", false, 107],
    ["ArrowLeft", false, 93],
    ["ArrowRight", true, 128],
    ["ArrowLeft", true, 72],
  ]) {
    const keyboardSlider = await createPopupFixture(seekData, "https://example.com/", {
      tabs: [{ id: 7, url: "https://www.youtube.com/watch?v=aaaaaaaaaaa" }],
      executeScript: async (request) => [
        {
          result: {
            id: "aaaaaaaaaaa",
            t: request.func.name === "seek" ? 700 + request.args[0] : request.args[0],
            duration: 1000,
            paused: true,
          },
        },
      ],
    });
    const event = await dispatchKey(keyboardSlider, barOf(keyboardSlider), key, { shiftKey });
    assert.deepEqual(
      keyboardSlider.executions
        .filter((call) => call.operation !== "chapters")
        .map((call) => call.operation),
      ["seekTo"],
      "one slider arrow must issue exactly one absolute seek",
    );
    assert.deepEqual(keyboardSlider.executions.find((call) => call.operation === "seekTo").args, [
      expected,
      "aaaaaaaaaaa",
    ]);
    assert.equal(keyboardSlider.data.videos.aaaaaaaaaaa.t, expected);
    assert.equal(keyboardSlider.writes(), 1);
    assert.equal(event.defaultPrevented, true, "prevent the native extra range step");
    assert.equal(
      keyboardSlider.doc.activeElement,
      barOf(keyboardSlider),
      "keep keyboard focus on the updated slider",
    );
    await dispatchKey(keyboardSlider, keyboardSlider.doc.activeElement, key, {
      shiftKey,
      repeat: true,
    });
    assert.deepEqual(
      keyboardSlider.executions
        .filter((call) => call.operation !== "chapters")
        .map((call) => call.operation),
      ["seekTo", "seekTo"],
    );
  }
  const guardedSlider = await createPopupFixture(seekData, "https://example.com/");
  for (const extra of [
    { ctrlKey: true },
    { altKey: true },
    { metaKey: true },
    { isComposing: true },
  ]) {
    const event = await dispatchKey(guardedSlider, barOf(guardedSlider), "ArrowRight", extra);
    assert.equal(event.defaultPrevented, false, "modified/composition keys remain native");
  }
  assert.equal(guardedSlider.writes(), 0);
  assert.equal(guardedSlider.data.videos.aaaaaaaaaaa.t, 100);
  const closedSlider = await createPopupFixture(seekData, "https://example.com/");
  await dispatchKey(closedSlider, barOf(closedSlider), "ArrowRight", { shiftKey: true });
  assert.equal(closedSlider.data.videos.aaaaaaaaaaa.t, 128);
  assert.equal(closedSlider.writes(), 1);
  assert.equal(closedSlider.executions.length, 0);
  const rowArrows = await createPopupFixture(seekData, "https://example.com/", {
    tabs: [{ id: 7, url: "https://www.youtube.com/watch?v=aaaaaaaaaaa" }],
    executeScript: async () => [
      { result: { id: "aaaaaaaaaaa", t: 707, duration: 1000, paused: true } },
    ],
  });
  await dispatchKey(rowArrows, rowArrows.els.list.querySelectorAll(".main")[0], "ArrowRight");
  assert.deepEqual(
    rowArrows.executions
      .filter((call) => call.operation !== "chapters")
      .map((call) => call.operation),
    ["seek"],
    "row arrows retain relative playback scrubbing",
  );
  console.log(
    "PASS: capture/target keyboard ownership, one seek per slider arrow, Shift/repeat/focus, native modifier/composition keys, closed-video updates, and row-relative arrows",
  );
  const a = "aaaaaaaaaaa",
    b = "bbbbbbbbbbb",
    c = "ccccccccccc",
    d = "ddddddddddd";
  const record = (id, t, updated) => ({ id, title: "Video " + id, t, duration: 1000, updated });
  const local = {
    settings: { autoBookmark: false, showThumbnails: false, includeChannelNames: false },
    videos: { [a]: record(a, 10, 100), [b]: record(b, 80, 300), [d]: record(d, 1, 9) },
  };
  const shortcuts = await createPopupFixture(local, "https://example.com/");
  const key = async (key, extra = {}) => {
    shortcuts.doc.listeners.keydown({ key, preventDefault() {}, stopPropagation() {}, ...extra });
    await shortcuts.settle();
  };
  shortcuts.els.search.value = "Video " + b;
  shortcuts.els.search.events.input();
  shortcuts.els.list.querySelectorAll(".main")[0].focus();
  await key("u");
  assert.equal(shortcuts.clipboardWrites.at(-1), `https://www.youtube.com/watch?v=${b}&t=80s`);
  await key("c");
  const single = JSON.parse(shortcuts.clipboardWrites.at(-1));
  assert.deepEqual(single, {
    format: "yt-waypoints",
    version: 1,
    videos: { [b]: local.videos[b] },
  });
  const singleTarget = await createPopupFixture(
    { settings: { autoBookmark: false } },
    "https://example.com/",
  );
  await singleTarget.paste(shortcuts.clipboardWrites.at(-1));
  assert.deepEqual(singleTarget.data.videos, single.videos);
  await key("C", { shiftKey: true });
  assert.deepEqual(JSON.parse(shortcuts.clipboardWrites.at(-1)).videos, local.videos);
  const copies = shortcuts.clipboardWrites.length;
  for (const name of ["u", "c", "C"]) {
    await key(name, { repeat: true });
    await key(name, { metaKey: true });
    await key(name, { ctrlKey: true });
    await key(name, { altKey: true });
  }
  assert.equal(shortcuts.clipboardWrites.length, copies);
  await key("?");
  assert.equal(shortcuts.els["help-dialog"].open, true);
  assert.equal(shortcuts.doc.activeElement, shortcuts.els["help-close"]);
  assert.equal(shortcuts.els["help-scrub"].textContent, "Scrub 10s");
  assert.equal(shortcuts.els["help-multiplier"].textContent, "Scrub 30s");
  await key("?", { repeat: true });
  assert.equal(shortcuts.els["help-dialog"].open, true);
  for (const name of ["Delete", "t", "C", "ArrowRight", "Enter"]) await key(name);
  assert.equal(
    await shortcuts.paste(JSON.stringify({ videos: { [a]: record(a, 999, 100) } })),
    false,
  );
  assert.deepEqual(shortcuts.data, local, "help isolates background actions");
  assert.equal(shortcuts.clipboardWrites.length, copies);
  // Storage-driven rerenders replace the focused row while help is visible.
  await vm.runInContext("render()", shortcuts.context);
  await key("h");
  assert.equal(shortcuts.els["help-dialog"].open, false);
  assert.equal(shortcuts.doc.activeElement, shortcuts.els.list.querySelectorAll(".main")[0]);
  shortcuts.els["help-toggle"].click();
  assert.equal(shortcuts.els["help-dialog"].open, true);
  let escapePrevented = 0,
    escapeStopped = 0;
  const escapeEvent = {
    key: "Escape",
    preventDefault() {
      escapePrevented++;
    },
    stopPropagation() {
      escapeStopped++;
    },
  };
  shortcuts.doc.listeners.keydown(escapeEvent);
  shortcuts.doc.listeners.keydown({ ...escapeEvent, repeat: true });
  shortcuts.doc.listeners.keyup(escapeEvent);
  if (flavor === "firefox") {
    assert.equal(escapePrevented, 0, "Firefox owns popup dismissal; do not pretend to suppress it");
    assert.equal(escapeStopped, 0);
    assert.equal(shortcuts.els["help-escape"].textContent, "Close popup");
    assert.match(shortcuts.els["help-escape-detail"].textContent, /Firefox reserves Escape/);
    await key("h");
  } else {
    assert.equal(escapePrevented, 3, "consume Escape down, held repeats, and release");
    assert.equal(escapeStopped, 3, "consume Escape propagation within the document");
    assert.equal(shortcuts.els["help-escape"].textContent, "Close help");
  }
  assert.equal(shortcuts.els["help-dialog"].open, false);
  assert.equal(shortcuts.closed(), 0, "extension code never calls window.close for help");
  shortcuts.doc.listeners.keydown({
    key: "Escape",
    preventDefault() {
      throw Error("ordinary popup Escape intercepted");
    },
  });
  shortcuts.doc.listeners.keyup({
    key: "Escape",
    preventDefault() {
      throw Error("ordinary popup Escape release intercepted");
    },
  });
  await key("h");
  shortcuts.els["help-close"].click();
  assert.equal(shortcuts.els["help-dialog"].open, false);
  shortcuts.els.search.focus();
  for (const name of ["?", "h", "u", "c", "C", "<", ">"])
    await key(name, {
      preventDefault() {
        throw Error("search typing intercepted");
      },
    });
  assert.equal(shortcuts.clipboardWrites.length, copies);
  shortcuts.els["options-toggle"].click();
  shortcuts.els["options-toggle"].focus();
  await key("C");
  assert.deepEqual(JSON.parse(shortcuts.clipboardWrites.at(-1)).videos, local.videos);
  await key("h");
  assert.equal(shortcuts.els["help-dialog"].open, true);
  await key(flavor === "firefox" ? "h" : "Escape");
  assert.equal(shortcuts.doc.activeElement, shortcuts.els["options-toggle"]);
  console.log(
    "PASS: row URL/JSON and all-JSON shortcuts, importable single export, filter/modifier/repeat/search safety, modal help isolation and focus restoration",
  );
  const transferPopup = await createPopupFixture(local, "https://example.com/");
  transferPopup.els["options-toggle"].click();
  transferPopup.els["copy-videos"].click();
  await transferPopup.settle();
  assert.equal(transferPopup.clipboardWrites.length, 1);
  assert.deepEqual(JSON.parse(transferPopup.clipboardWrites[0]).videos, local.videos);
  assert.equal(JSON.parse(transferPopup.clipboardWrites[0]).settings, undefined);
  const incoming = {
    format: "yt-waypoints",
    version: 1,
    videos: { [a]: record(a, 60, 200), [b]: record(b, 5, 100), [c]: record(c, 20, 150) },
  };
  assert.equal(await transferPopup.paste(JSON.stringify(incoming)), true);
  assert.equal(transferPopup.data.videos[a].t, 60);
  assert.equal(transferPopup.data.videos[b].t, 5);
  assert.ok(transferPopup.data.videos[c]);
  assert.ok(transferPopup.data.videos[d]);
  assert.deepEqual(transferPopup.data.settings, local.settings);
  assert.equal(transferPopup.navigation.length, 0);
  assert.equal(transferPopup.closed(), 0);
  assert.equal(transferPopup.els.search.value, "");
  assert.equal(transferPopup.els["options-panel"].hidden, true);
  assert.equal(transferPopup.els.status.textContent, "Import: 1 added, 2 updated, 0 unchanged.");
  const repeatWrites = transferPopup.writes();
  await transferPopup.paste(JSON.stringify(incoming));
  assert.equal(
    transferPopup.writes(),
    repeatWrites + 1,
    "repeated import renews the open-player handoff",
  );
  const beforeWrites = transferPopup.writes();
  const before = JSON.stringify(transferPopup.data);
  await transferPopup.paste(
    JSON.stringify({ videos: { [c]: record(c, 30, 999), [a]: { id: a, t: -1 } } }),
  );
  assert.equal(
    JSON.stringify(transferPopup.data),
    before,
    "invalid later record cannot partially import earlier valid record",
  );
  assert.ok(transferPopup.els.status.textContent.startsWith("Import failed:"));
  assert.equal(transferPopup.writes(), beforeWrites);
  await transferPopup.paste("{bad json");
  assert.equal(JSON.stringify(transferPopup.data), before);
  assert.equal(transferPopup.writes(), beforeWrites);
  const fallbackCopy = await createPopupFixture(local, "https://example.com/", {
    failClipboard: true,
  });
  fallbackCopy.els["options-toggle"].click();
  fallbackCopy.els["copy-videos"].focus();
  fallbackCopy.els["copy-videos"].click();
  await fallbackCopy.settle();
  assert.deepEqual(JSON.parse(fallbackCopy.clipboardWrites[0]).videos, local.videos);
  assert.equal(fallbackCopy.doc.body.children.length, 0, "temporary copy field is always removed");
  assert.equal(fallbackCopy.doc.activeElement, fallbackCopy.els["copy-videos"]);
  const failedCopy = await createPopupFixture(local, "https://example.com/", {
    failClipboard: true,
    failLegacyClipboard: true,
  });
  failedCopy.els["copy-videos"].click();
  await failedCopy.settle();
  assert.equal(failedCopy.clipboardWrites.length, 0);
  assert.equal(failedCopy.doc.body.children.length, 0);
  assert.equal(failedCopy.els.status.textContent, "Could not copy JSON. Please try again.");
  const roundTrip = await createPopupFixture(
    { settings: { autoBookmark: false } },
    "https://example.com/",
  );
  await roundTrip.paste(transferPopup.clipboardWrites[0]);
  assert.deepEqual(roundTrip.data.videos, local.videos);
  const strict = await createPopupFixture(
    { settings: { autoBookmark: false, showThumbnails: false } },
    "https://example.com/",
  );
  const badFields = {
    ...record(c, 20, 100),
    title: "<img src=x onerror=bad()>",
    url: "javascript:bad()",
    thumbnail: "https://evil.example/x",
    settings: { injected: true },
    constructor: { polluted: true },
  };
  await strict.paste(
    JSON.stringify({
      format: "yt-waypoints",
      version: 1,
      videos: { [c]: badFields },
      settings: { showThumbnails: true },
      unknown: ["drop"],
    }),
  );
  assert.deepEqual(Object.keys(strict.data.videos[c]).sort(), [
    "duration",
    "id",
    "t",
    "title",
    "updated",
  ]);
  assert.equal(strict.data.videos[c].title, "<img src=x onerror=bad()>");
  assert.equal(strict.data.settings.showThumbnails, false);
  assert.equal(strict.navigation.length, 0);
  const stored = JSON.stringify(strict.data);
  const strictWrites = strict.writes();
  await strict.paste(
    JSON.stringify({ videos: { [a]: record(a, 5, 300), [b]: { ...record(b, 2, 300), t: "2" } } }),
  );
  assert.equal(JSON.stringify(strict.data), stored);
  assert.equal(strict.writes(), strictWrites);
  const activeImport = await createPopupFixture(
    { settings: { autoBookmark: false }, videos: { [a]: record(a, 85, 1793659999999) } },
    "https://example.com/",
    {
      tabs: [{ id: 7, windowId: 1, url: "https://www.youtube.com/watch?v=" + a }],
      executeScript: async () => [{ result: { id: a, t: 796, duration: 1000, paused: true } }],
    },
  );
  await activeImport.paste(JSON.stringify({ videos: { [a]: record(a, 796, 1793656321686) } }));
  assert.equal(activeImport.data.videos[a].t, 796);
  assert.deepEqual(activeImport.executions.at(-1), {
    operation: "seekTo",
    args: [796, a],
    tabId: 7,
  });
  assert.equal(activeImport.data.importedPositions.videos[a].t, 796);
  console.log(
    "PASS: Options JSON export/copy and offscreen fallback, paste merge stays open, pasted source wins, settings/unrelated rows preserved, invalid JSON is atomic, repeated import unchanged, cross-browser-ready round trip",
  );

  // Trash is hidden by default, searchable on request, and restorable by a toggle.
  const trashSeed = {
    settings: { autoBookmark: false, showThumbnails: false },
    videos: {
      [a]: {
        ...record(a, 120, 2),
        title: "Private deleted chapter notes",
        channelName: "Sample channel",
      },
      [b]: { ...record(b, 240, 1), title: "Current interview" },
    },
  };
  const trashUI = await createPopupFixture(trashSeed, "https://example.com/");
  assert.equal(trashUI.els["deletion-mode"].value, "timed");
  assert.equal(trashUI.els["trash-days"].value, "7");
  assert.equal(trashUI.els["show-trash"].checked, false);
  await vm.runInContext(`bookmarks.deleteVideo("${a}")`, trashUI.context);
  assert.equal(trashUI.data.videos[a], undefined);
  assert.ok((await trashUI.context.WAYPOINTS_STORAGE.read()).trash[a]);
  assert.deepEqual(
    trashUI.els.list.querySelectorAll(".main").map((row) => row.dataset.id),
    [b],
  );
  await vm.runInContext("exportsController.copyVideos()", trashUI.context);
  assert.deepEqual(
    Object.keys(JSON.parse(trashUI.clipboardWrites.at(-1)).videos),
    [b],
    "all-current export excludes hidden trash",
  );
  const noRebookmark = await createPopupFixture(
    { ...trashUI.data, settings: { ...trashUI.data.settings, autoBookmark: true } },
    "https://www.youtube.com/watch?v=" + a,
  );
  assert.equal(
    noRebookmark.data.videos[a],
    undefined,
    "opening a trashed video does not auto-bookmark it",
  );
  assert.equal(noRebookmark.executions.length, 0);
  trashUI.els["show-trash"].checked = true;
  trashUI.els["show-trash"].events.change();
  await trashUI.settle();
  assert.equal(trashUI.els.list.querySelectorAll(".main").length, 2);
  assert.deepEqual(
    trashUI.els.list.querySelectorAll(".main").map((row) => row.dataset.id),
    [b, a],
    "current bookmarks precede newer trash",
  );
  let trashRow = trashUI.els.list.children.find((row) => row.className === "trash-row");
  assert.ok(trashRow);
  const trashMeta = trashRow.children[0].children
    .find((el) => el.className === "details")
    .children.find((el) => el.className === "meta");
  assert.ok(trashMeta.textContent.startsWith("Trash ·"));
  trashUI.doc.listeners.keydown({ key: "/", preventDefault() {} });
  trashUI.els.search.value = "private deleted";
  trashUI.els.search.events.input();
  assert.deepEqual(
    trashUI.els.list.querySelectorAll(".main").map((row) => row.dataset.id),
    [a],
  );
  trashUI.els.search.value = "Sample channel";
  trashUI.els.search.events.input();
  assert.equal(
    trashUI.els.list.querySelectorAll(".main").length,
    1,
    "trash participates in channel search too",
  );
  trashRow = trashUI.els.list.children.find((row) => row.className === "trash-row");
  const restoreToggle = trashRow.children.find((el) => el.className === "trash-restore")
    .children[0];
  restoreToggle.focus();
  trashUI.doc.listeners.keydown({
    key: " ",
    preventDefault() {
      throw Error("restore checkbox key intercepted");
    },
  });
  restoreToggle.checked = true;
  restoreToggle.events.change();
  await trashUI.settle();
  assert.equal(trashUI.data.videos[a].t, 120);
  assert.equal(trashUI.doc.activeElement.dataset.id, a, "restore returns focus to the current row");
  assert.equal((await trashUI.context.WAYPOINTS_STORAGE.read()).trash[a], undefined);
  assert.equal(
    trashUI.els.list.children.some((row) => row.className === "trash-row"),
    false,
  );
  console.log(
    "PASS: timed default, hidden/searchable tinted trash, restore toggle, current-only JSON, no automatic re-bookmarking",
  );

  trashUI.els["deletion-mode"].value = "permanent";
  trashUI.els["deletion-mode"].events.change();
  await trashUI.settle();
  await vm.runInContext(`bookmarks.deleteVideo("${a}")`, trashUI.context);
  assert.equal(trashUI.data.videos[a], undefined);
  assert.equal(JSON.stringify(trashUI.data).includes("Private deleted chapter notes"), false);
  assert.equal(
    vm.runInContext("deletedBookmark", trashUI.context),
    null,
    "permanent deletion has no recoverable header copy",
  );
  assert.equal(trashUI.els["restore-bookmark"].hidden, true);
  const permanentlyReopened = await createPopupFixture(
    { ...trashUI.data, settings: { ...trashUI.data.settings, autoBookmark: true } },
    "https://www.youtube.com/watch?v=" + a,
  );
  assert.equal(
    permanentlyReopened.data.videos[a],
    undefined,
    "a permanent deletion is not silently re-bookmarked",
  );
  assert.equal(permanentlyReopened.executions.length, 0);
  assert.equal(
    permanentlyReopened.els["restore-bookmark"].hidden,
    false,
    "explicit Add bookmark remains available",
  );
  trashUI.els["deletion-mode"].value = "timed";
  trashUI.els["deletion-mode"].events.change();
  await trashUI.settle();
  await vm.runInContext(`bookmarks.deleteVideo("${b}")`, trashUI.context);
  trashUI.els["empty-trash"].click();
  await trashUI.settle();
  assert.deepEqual(Object.keys((await trashUI.context.WAYPOINTS_STORAGE.read()).trash), []);
  assert.equal(JSON.stringify(trashUI.data).includes("Current interview"), false);
  console.log(
    "PASS: permanent deletion physically purges stored content and Undo; Empty trash purges trashed rows",
  );

  const retention = await createPopupFixture(trashSeed, "https://example.com/");
  retention.els["trash-days"].value = "2";
  retention.els["trash-days"].events.change();
  await retention.settle();
  assert.equal(retention.data.settings.trashDays, 2);
  const reopenedTrash = await createPopupFixture(retention.data, "https://example.com/");
  assert.equal(reopenedTrash.els["trash-days"].value, "2");
  for (const value of ["", "0", "1.5", "366"]) {
    const before = retention.writes();
    retention.els["trash-days"].value = value;
    retention.els["trash-days"].events.change();
    await retention.settle();
    assert.equal(retention.writes(), before);
    assert.equal(retention.els["trash-days"].value, "2");
  }
  await vm.runInContext(`bookmarks.deleteVideo("${a}")`, retention.context);
  const expiredSeed = retention.data;
  for (const entry of Object.values(expiredSeed)) {
    if (entry?.version === 2 && entry.records?.[a]?.life.status === "trash")
      entry.records[a].life.trashedAt -= 3 * 86400000;
  }
  const expiredPopup = await createPopupFixture(expiredSeed, "https://example.com/");
  assert.equal(
    (await expiredPopup.context.WAYPOINTS_STORAGE.read()).trash[a],
    undefined,
    "popup opening runs overdue cleanup",
  );
  assert.equal(JSON.stringify(expiredPopup.data).includes("Private deleted chapter notes"), false);
  console.log(
    "PASS: retained/validated trash settings, existing-trash expiry, and overdue cleanup on popup open",
  );

  const delayed = await createPopupFixture(trashSeed, "https://example.com/");
  const delayedApi = delayed.context.browser || delayed.context.chrome;
  const originalSettingsSet = delayedApi.storage.local.set;
  let releaseSettings;
  delayedApi.storage.local.set = async (value) => {
    if (value.settings) {
      delayedApi.storage.local.set = originalSettingsSet;
      await new Promise((resolve) => (releaseSettings = resolve));
    }
    return originalSettingsSet(value);
  };
  delayed.els["include-channel-names"].checked = false;
  delayed.els["include-channel-names"].events.change();
  await delayed.settle();
  delayed.els["show-trash"].checked = true;
  delayed.els["show-trash"].events.change();
  delayed.els["trash-days"].value = "14";
  delayed.els["trash-days"].events.change();
  releaseSettings();
  await delayed.settle();
  assert.equal(delayed.data.settings.includeChannelNames, false);
  assert.equal(delayed.data.settings.showTrash, true);
  assert.equal(delayed.data.settings.trashDays, 14);
  console.log("PASS: delayed settings saves preserve later visibility and retention changes");

  // Live slider previews use the form values, while change commits only its
  // captured field. Form synchronization must not disturb the focused control.
  const previewSettings = await createPopupFixture(
    { settings: { autoBookmark: false } },
    "https://example.com/",
  );
  previewSettings.els["options-toggle"].click();
  const previewScrub = previewSettings.els["scrub-seconds"];
  const previewMultiplier = previewSettings.els["shift-multiplier"];
  previewScrub.focus();
  const previewWrites = previewSettings.writes();
  previewScrub.value = "12";
  previewMultiplier.value = "4";
  previewScrub.events.input();
  assert.equal(previewSettings.els["scrub-value"].textContent, "12 s");
  assert.equal(previewSettings.els["multiplier-value"].textContent, "×4");
  assert.equal(
    previewSettings.els["shift-preview"].textContent,
    "Shift + ← or → moves 48 seconds.",
  );
  assert.equal(previewSettings.writes(), previewWrites, "input preview must not save settings");
  assert.equal(vm.runInContext("settings.scrubSeconds", previewSettings.context), 10);
  assert.equal(previewSettings.doc.activeElement, previewScrub);
  previewScrub.events.change();
  await vm.runInContext("queue", previewSettings.context);
  await previewSettings.settle();
  assert.equal(previewSettings.data.settings.scrubSeconds, 12);
  assert.equal(
    previewSettings.data.settings.shiftMultiplier,
    3,
    "scrub change must not save an uncommitted multiplier",
  );
  assert.equal(
    previewSettings.els["shift-preview"].textContent,
    "Shift + ← or → moves 36 seconds.",
  );
  assert.equal(previewSettings.doc.activeElement, previewScrub);
  previewMultiplier.value = "4";
  previewMultiplier.events.input();
  assert.equal(
    previewSettings.els["shift-preview"].textContent,
    "Shift + ← or → moves 48 seconds.",
  );
  previewMultiplier.events.change();
  await vm.runInContext("queue", previewSettings.context);
  const reopenedPreview = await createPopupFixture(previewSettings.data, "https://example.com/");
  assert.equal(reopenedPreview.els["scrub-value"].textContent, "12 s");
  assert.equal(reopenedPreview.els["multiplier-value"].textContent, "×4");
  assert.equal(reopenedPreview.els["playback-summary"].textContent, "12s · Shift 48s");
  console.log(
    "PASS: shared Settings previews use unsaved controls without writes, commit field-specific values and retain focus/reopen state",
  );

  function holdNextSettingsWrite(popup) {
    const api = popup.context.browser || popup.context.chrome;
    const original = api.storage.local.set;
    let release, reject;
    let entered = false;
    const pending = new Promise((yes, no) => {
      release = yes;
      reject = no;
    });
    api.storage.local.set = async (value) => {
      if (value.settings) {
        api.storage.local.set = original;
        entered = true;
        await pending;
      }
      return original(value);
    };
    return { release, reject, entered: () => entered };
  }

  const rapidSettings = await createPopupFixture(
    { settings: { autoBookmark: false } },
    "https://example.com/",
  );
  rapidSettings.els["options-toggle"].click();
  const rapidGate = holdNextSettingsWrite(rapidSettings);
  rapidSettings.els["include-channel-names"].checked = false;
  rapidSettings.els["include-channel-names"].events.change();
  await rapidSettings.settle();
  assert.ok(rapidGate.entered());
  for (const [controlId, checked] of [
    ["auto-bookmark", true],
    ["show-markers", false],
    ["show-markers", true],
    ["show-markers", false],
    ["offer-save-file", true],
    ["show-trash", true],
    ["include-channel-names", true],
  ]) {
    rapidSettings.els[controlId].checked = checked;
    rapidSettings.els[controlId].events.change();
  }
  for (const theme of ["light", "dark"]) {
    rapidSettings.els["theme-select"].value = theme;
    rapidSettings.els["theme-select"].events.change();
  }
  for (const [controlId, value] of [
    ["scrub-seconds", "17"],
    ["shift-multiplier", "5"],
    ["trash-days", "14"],
  ]) {
    rapidSettings.els[controlId].value = value;
    rapidSettings.els[controlId].events.change();
  }
  rapidSettings.els["theme-select"].value = "system";
  rapidSettings.els["show-markers"].checked = true;
  rapidSettings.els["trash-days"].value = "1";
  rapidSettings.els["trash-days"].focus();
  rapidGate.release();
  await vm.runInContext("queue", rapidSettings.context);
  await rapidSettings.settle();
  for (const [name, expected] of Object.entries({
    autoBookmark: true,
    includeChannelNames: true,
    showMarkers: false,
    offerSaveFile: true,
    showTrash: true,
    theme: "dark",
    scrubSeconds: 17,
    shiftMultiplier: 5,
    trashDays: 14,
    showThumbnails: true,
  }))
    assert.equal(rapidSettings.data.settings[name], expected, name);
  assert.equal(rapidSettings.doc.activeElement, rapidSettings.els["trash-days"]);
  const reopenedRapid = await createPopupFixture(rapidSettings.data, "https://example.com/");
  assert.equal(reopenedRapid.els["theme-select"].value, "dark");
  assert.equal(reopenedRapid.els["show-markers"].checked, false);
  assert.equal(reopenedRapid.els["auto-bookmark"].checked, true);
  assert.equal(reopenedRapid.els["include-channel-names"].checked, true);
  assert.equal(reopenedRapid.els["offer-save-file"].checked, true);
  assert.equal(reopenedRapid.els["show-trash"].checked, true);
  assert.equal(reopenedRapid.els["playback-summary"].textContent, "17s · Shift 85s");
  assert.ok(reopenedRapid.els["appearance-summary"].textContent.startsWith("Dark ·"));
  console.log(
    "PASS: rapid mapped checkbox/theme/numeric changes retain captured intent across a held write and persist summaries on reopen",
  );

  const pendingThumbnails = await createPopupFixture(
    { settings: { autoBookmark: false, showThumbnails: true } },
    "https://example.com/",
  );
  pendingThumbnails.els["options-toggle"].click();
  const thumbnailGate = holdNextSettingsWrite(pendingThumbnails);
  const thumbnailWrites = pendingThumbnails.writes();
  pendingThumbnails.els["show-thumbnails"].checked = false;
  pendingThumbnails.els["show-thumbnails"].events.change();
  await pendingThumbnails.settle();
  assert.ok(thumbnailGate.entered());
  assert.equal(pendingThumbnails.els["show-thumbnails"].disabled, true);
  await vm.runInContext("setThumbnails(true)", pendingThumbnails.context);
  pendingThumbnails.els["theme-select"].value = "dark";
  pendingThumbnails.els["theme-select"].events.change();
  pendingThumbnails.els["theme-select"].focus();
  assert.equal(pendingThumbnails.writes(), thumbnailWrites);
  thumbnailGate.release();
  await vm.runInContext("queue", pendingThumbnails.context);
  await pendingThumbnails.settle();
  assert.equal(
    pendingThumbnails.data.settings.showThumbnails,
    false,
    "pending thumbnail requests are ignored",
  );
  assert.equal(pendingThumbnails.data.settings.theme, "dark");
  assert.equal(pendingThumbnails.writes(), thumbnailWrites + 2);
  assert.equal(pendingThumbnails.els["show-thumbnails"].disabled, false);
  assert.equal(pendingThumbnails.els["show-thumbnails"].checked, false);
  assert.equal(pendingThumbnails.doc.activeElement, pendingThumbnails.els["theme-select"]);

  const failedThumbnails = await createPopupFixture(
    { settings: { autoBookmark: false, showThumbnails: true } },
    "https://example.com/",
  );
  const failureGate = holdNextSettingsWrite(failedThumbnails);
  failedThumbnails.els["show-thumbnails"].checked = false;
  failedThumbnails.els["show-thumbnails"].events.change();
  await failedThumbnails.settle();
  assert.ok(failureGate.entered());
  assert.equal(failedThumbnails.els["show-thumbnails"].disabled, true);
  failureGate.reject(new Error("Settings write failed"));
  await vm.runInContext("queue", failedThumbnails.context);
  await failedThumbnails.settle();
  assert.equal(failedThumbnails.data.settings.showThumbnails, true);
  assert.equal(failedThumbnails.els["show-thumbnails"].disabled, false);
  assert.equal(failedThumbnails.els["show-thumbnails"].checked, true);
  assert.match(failedThumbnails.els.status.textContent, /Settings write failed/);
  failedThumbnails.els["show-thumbnails"].checked = false;
  failedThumbnails.els["show-thumbnails"].events.change();
  await vm.runInContext("queue", failedThumbnails.context);
  await failedThumbnails.settle();
  assert.equal(failedThumbnails.data.settings.showThumbnails, false);
  assert.equal(failedThumbnails.els["show-thumbnails"].disabled, false);
  console.log(
    "PASS: thumbnails retain pending suppression/disabled state, other field intent and failure recovery",
  );

  const cleanupFailure = { failStorageRemove: true };
  const retryCleanup = await createPopupFixture(
    expiredSeed,
    "https://example.com/",
    cleanupFailure,
  );
  assert.equal(
    retryCleanup.els["empty-trash"].disabled,
    false,
    "expiry failure does not disable cleanup controls",
  );
  assert.ok(retryCleanup.els.status.textContent.includes("cleanup failed"));
  assert.equal(
    JSON.stringify(retryCleanup.data).includes("Private deleted chapter notes"),
    true,
    "failed removal retains recovery sources",
  );
  cleanupFailure.failStorageRemove = false;
  retryCleanup.els["empty-trash"].click();
  await retryCleanup.settle();
  assert.equal(JSON.stringify(retryCleanup.data).includes("Private deleted chapter notes"), false);
  console.log(
    "PASS: startup cleanup failure is reported without blocking controls; Empty trash retries physical removal",
  );

  const hostileId = "zzzzzzzzzzz";
  const originalHostileVideo = {
    id: hostileId,
    title: "Preserve my bookmark",
    t: 100,
    duration: 1000,
    updated: 1,
  };
  const hostilePlayer = await createPopupFixture(
    { settings: { autoBookmark: false }, videos: { [hostileId]: originalHostileVideo } },
    "https://example.com/",
    {
      tabs: [{ id: 7, url: "https://www.youtube.com/watch?v=" + hostileId }],
      executeScript: async () => [
        {
          frameId: 0,
          result: { id: hostileId, t: "not-a-number", duration: 1000, paused: true, fps: 60 },
        },
      ],
    },
  );
  await vm.runInContext(
    `bookmarks.controlPlayback("${hostileId}", "frame", 1)`,
    hostilePlayer.context,
  );
  assert.deepEqual(
    hostilePlayer.data.videos[hostileId],
    originalHostileVideo,
    "malformed page-world result must not overwrite the bookmark",
  );
  assert.equal(hostilePlayer.writes(), 0);
  assert.match(hostilePlayer.els.status.textContent, /invalid.*response/i);

  // Every persistence path must stop on invalid open-player data, with no
  // saved-only fallback. Reuse one popup so writes must remain zero throughout.
  let boundaryPayload;
  let boundaryEnvelope;
  let boundaryThrow;
  const boundary = await createPopupFixture(
    { settings: { autoBookmark: false }, videos: { [hostileId]: originalHostileVideo } },
    "https://example.com/",
    {
      tabs: [{ id: 7, url: "https://www.youtube.com/watch?v=" + hostileId }],
      executeScript: async () => {
        if (boundaryThrow !== undefined) throw boundaryThrow;
        return boundaryEnvelope || [{ frameId: 0, result: boundaryPayload }];
      },
    },
  );
  const good = { id: hostileId, t: 101, duration: 1000, paused: true };
  for (const command of [
    `bookmarks.scrub("${hostileId}", 10)`,
    `bookmarks.seekTo("${hostileId}", 300)`,
    `bookmarks.togglePlay("${hostileId}")`,
    `bookmarks.controlPlayback("${hostileId}", "frame", 1)`,
  ]) {
    for (const bad of [
      null,
      "wrong",
      [],
      { ...good, t: "bad" },
      { ...good, t: NaN },
      { ...good, t: Infinity },
      { ...good, t: -1 },
      { ...good, t: 1001 },
      { ...good, duration: -1 },
      { ...good, duration: Infinity },
      { ...good, paused: "yes" },
      { ...good, id: "yyyyyyyyyyy" },
      { t: 101 },
      { ...good, unexpected: "x".repeat(10000) },
    ]) {
      boundaryPayload =
        command.startsWith("bookmarks.controlPlayback") &&
        bad &&
        typeof bad === "object" &&
        !Array.isArray(bad)
          ? { ...bad, fps: 60 }
          : bad;
      await vm.runInContext(command, boundary.context);
      assert.deepEqual(boundary.data.videos[hostileId], originalHostileVideo);
      assert.equal(
        boundary.writes(),
        0,
        "invalid player response must not write, including fallback",
      );
      assert.match(boundary.els.status.textContent, /response|no result/i);
    }
  }
  boundaryPayload = { ...good, fps: 60 };
  for (const envelope of [
    [],
    [{ frameId: 1, result: boundaryPayload }],
    [
      { frameId: 0, result: boundaryPayload },
      { frameId: 0, result: boundaryPayload },
    ],
    [{ frameId: 0, error: new Error("Page script failed") }],
    { result: boundaryPayload },
  ]) {
    boundaryEnvelope = envelope;
    await vm.runInContext(
      `bookmarks.controlPlayback("${hostileId}", "frame", 1)`,
      boundary.context,
    );
    assert.equal(boundary.writes(), 0);
    assert.deepEqual(boundary.data.videos[hostileId], originalHostileVideo);
  }
  boundaryEnvelope = null;
  for (const thrown of [new Error(""), new Error("   "), "", "Permission denied"]) {
    boundaryThrow = thrown;
    await vm.runInContext(
      `bookmarks.controlPlayback("${hostileId}", "frame", 1)`,
      boundary.context,
    );
    assert.equal(boundary.writes(), 0, "even an empty thrown error must stop persistence");
    assert.deepEqual(boundary.data.videos[hostileId], originalHostileVideo);
    assert.ok(boundary.els.status.textContent);
  }
  boundaryThrow = undefined;
  boundaryEnvelope = null;
  for (const rate of ["1.25", Infinity, NaN, 0, -1, 17]) {
    boundaryPayload = { id: hostileId, rate };
    await vm.runInContext(`bookmarks.controlPlayback("${hostileId}", "rate", 1)`, boundary.context);
    assert.match(boundary.els.status.textContent, /invalid player response/i);
    assert.equal(boundary.writes(), 0);
  }
  boundaryPayload = { ...good, fps: 60 };
  await vm.runInContext(`bookmarks.controlPlayback("${hostileId}", "frame", 1)`, boundary.context);
  assert.equal(boundary.data.videos[hostileId].t, 101);
  assert.equal(boundary.writes(), 1);
  boundaryPayload = { id: hostileId, rate: 1.25 };
  await vm.runInContext(`bookmarks.controlPlayback("${hostileId}", "rate", 1)`, boundary.context);
  assert.match(boundary.els.status.textContent, /1.25/);
  assert.equal(boundary.writes(), 1, "speed responses do not mutate bookmarks");
  console.log(
    "PASS: malformed/wrong-video/oversized results and injection envelopes preserve bookmarks across all playback paths; valid frame/rate responses work",
  );

  for (const metadata of [
    { id: hostileId, title: "Wrong position", t: "100", duration: 1000 },
    { id: "yyyyyyyyyyy", title: "Wrong video", t: 100, duration: 1000 },
    { id: hostileId, title: "x".repeat(1001), t: 100, duration: 1000 },
    {
      id: hostileId,
      title: "Unsafe owner",
      t: 100,
      duration: 1000,
      channelUrl: "https://evil.example/@Fake",
    },
  ]) {
    const invalidMetadata = await createPopupFixture(
      { settings: { autoBookmark: false }, videos: { [hostileId]: originalHostileVideo } },
      "https://www.youtube.com/watch?v=" + hostileId,
      { metadata },
    );
    await vm.runInContext("bookmarks.bookmarkCurrent()", invalidMetadata.context);
    assert.equal(invalidMetadata.writes(), 0);
    assert.deepEqual(invalidMetadata.data.videos[hostileId], originalHostileVideo);
    assert.match(invalidMetadata.els.status.textContent, /invalid player response/i);
  }
  console.log("PASS: invalid page metadata cannot create/enrich/overwrite a saved bookmark");

  // Valid responses update duration too, preserving the stored t <= duration invariant.
  boundaryPayload = { id: hostileId, t: 1500, duration: 2000, paused: true, fps: 60 };
  await vm.runInContext(`bookmarks.controlPlayback("${hostileId}", "frame", 1)`, boundary.context);
  assert.equal(boundary.data.videos[hostileId].t, 1500);
  assert.equal(boundary.data.videos[hostileId].duration, 2000);
  for (const command of [
    `bookmarks.controlPlayback("${hostileId}", "frame", 1)`,
    `bookmarks.seekTo("${hostileId}", 300)`,
  ]) {
    let releaseResult;
    const delayedPlayer = await createPopupFixture(
      { settings: { autoBookmark: false }, videos: { [hostileId]: originalHostileVideo } },
      "https://example.com/",
      {
        tabs: [{ id: 7, url: "https://www.youtube.com/watch?v=" + hostileId }],
        executeScript: async (request) => {
          await new Promise((resolve) => (releaseResult = resolve));
          return [
            {
              frameId: 0,
              result: { ...good, ...(request.func.name === "playback" ? { fps: 60 } : {}) },
            },
          ];
        },
      },
    );
    const pending = vm.runInContext(command, delayedPlayer.context);
    await delayedPlayer.settle();
    assert.equal(typeof releaseResult, "function");
    await delayedPlayer.context.WAYPOINTS_STORAGE.importVideos({
      [hostileId]: { ...originalHostileVideo, t: 796 },
    });
    releaseResult();
    await pending;
    await delayedPlayer.settle();
    assert.equal(
      delayedPlayer.data.videos[hostileId].t,
      796,
      "a valid but delayed response cannot overwrite a newer import lifetime",
    );
  }
  console.log(
    "PASS: accepted positions retain matching duration; delayed valid frame/slider results cannot overwrite a newer import",
  );

  // Every delayed bookmark writer must retain its pre-player lifetime, including
  // metadata creation/enrichment. Startup reads finish before this gate is armed.
  for (const command of [
    `bookmarks.scrub("${hostileId}", 10)`,
    `bookmarks.seekTo("${hostileId}", 300)`,
    `bookmarks.togglePlay("${hostileId}")`,
    `bookmarks.controlPlayback("${hostileId}", "frame", 1)`,
    "bookmarks.bookmarkCurrent()",
    "bookmarks.refreshCurrentChannel()",
  ]) {
    for (const conflict of ["trash", "purge", "import", "readd", "fields"]) {
      let armed = false;
      let release;
      const delayed = await createPopupFixture(
        { settings: { autoBookmark: false }, videos: { [hostileId]: originalHostileVideo } },
        "https://www.youtube.com/watch?v=" + hostileId,
        {
          tabs: [{ id: 7, url: "https://www.youtube.com/watch?v=" + hostileId }],
          executeScript: async (request) => {
            if (request.func.name === "chapters")
              return [
                { result: { id: hostileId, duration: 1000, available: false, chapters: [] } },
              ];
            if (armed) await new Promise((resolve) => (release = resolve));
            const metadata = !["seek", "seekTo", "toggle", "playback"].includes(request.func.name);
            return [
              {
                result: {
                  id: hostileId,
                  t: 321,
                  duration: 1000,
                  ...(metadata
                    ? {
                        title: "Player title",
                        ...(armed ? { channelName: "Delayed channel" } : {}),
                      }
                    : { paused: true, ...(request.func.name === "playback" ? { fps: 60 } : {}) }),
                },
              },
            ];
          },
        },
      );
      armed = true;
      const pending = vm.runInContext(command, delayed.context);
      await delayed.settle();
      assert.equal(typeof release, "function", `${command} must reach the held player`);
      const storage = delayed.context.WAYPOINTS_STORAGE;
      if (conflict === "trash") await storage.trash(hostileId);
      if (conflict === "purge" || conflict === "readd") await storage.purge([hostileId]);
      if (conflict === "import")
        await storage.importVideos({ [hostileId]: { ...originalHostileVideo, t: 796 } });
      if (conflict === "readd" || conflict === "fields") {
        const snapshot = await storage.read();
        snapshot.videos[hostileId] =
          conflict === "readd"
            ? { ...originalHostileVideo, title: "New lifetime", t: 555 }
            : { ...snapshot.videos[hostileId], startNote: "Concurrent note" };
        snapshot.videos.yyyyyyyyyyy = { id: "yyyyyyyyyyy", title: "Concurrent video", t: 5 };
        await storage.save(snapshot);
      }
      const before = (await storage.read()).videos;
      release();
      await pending;
      await delayed.settle();
      const after = (await storage.read()).videos;
      if (conflict === "fields") {
        assert.equal(after[hostileId].startNote, "Concurrent note", command);
        assert.deepEqual(after.yyyyyyyyyyy, before.yyyyyyyyyyy, command);
        assert.equal(
          after[hostileId].t,
          command.includes("refreshCurrentChannel") ? 100 : 321,
          command,
        );
      } else {
        assert.deepEqual(after, before, `${command} must respect ${conflict}`);
        if (conflict === "trash")
          assert.ok((await storage.read()).trash[hostileId], "late bookmark cannot restore trash");
      }
    }
  }
  console.log(
    "PASS: all six bookmark writers preserve pre-player lifetimes through trash/purge/import/re-add and retain concurrent notes/other videos",
  );

  // Replacing/copying the editable map keeps context explicit on the snapshot;
  // no object-identity registration is needed, even across a concurrent edit.
  const copied = await createPopupFixture(
    {
      settings: { autoBookmark: false },
      videos: { [hostileId]: originalHostileVideo },
    },
    "https://example.com/",
  );
  await vm.runInContext(
    `(async () => {
    const snapshot = await bookmarks.loadSnapshot();
    const concurrent = await bookmarks.loadSnapshot();
    concurrent.videos["${hostileId}"].startNote = "Keep concurrent note";
    await bookmarks.saveSnapshot(concurrent);
    snapshot.videos = { ...snapshot.videos,
      ["${hostileId}"]: { ...snapshot.videos["${hostileId}"], t: 222 } };
    await bookmarks.saveSnapshot(snapshot);
  })()`,
    copied.context,
  );
  assert.equal(copied.data.videos[hostileId].t, 222);
  assert.equal(copied.data.videos[hostileId].startNote, "Keep concurrent note");
  console.log(
    "PASS: copied videos maps retain explicit snapshot context and field-specific merging",
  );

  for (const transcript of [
    { id: "yyyyyyyyyyy", duration: 1000, segments: [{ start: 0, text: "Wrong video" }] },
    { id: hostileId, duration: 1000, segments: [{ start: 0, text: "x".repeat(10001) }] },
    { id: hostileId, duration: 1000, segments: [{ start: 9999, text: "Outside duration" }] },
  ]) {
    boundaryPayload = transcript;
    const copies = boundary.clipboardWrites.length;
    const before = JSON.stringify(boundary.data.videos);
    await vm.runInContext(`exportsController.exportTranscript("${hostileId}")`, boundary.context);
    assert.equal(boundary.clipboardWrites.length, copies);
    assert.equal(JSON.stringify(boundary.data.videos), before);
    assert.match(boundary.els.status.textContent, /invalid player response/i);
  }
  console.log(
    "PASS: invalid transcript identity, timing, and text limits preserve clipboard and bookmarks",
  );

  const partialTranscript = {
    id: hostileId,
    duration: 3600,
    segments: [{ start: 0, end: 5, text: "Only a mounted row" }],
  };
  const partialExport = await createPopupFixture(
    {
      settings: { autoBookmark: false, offerSaveFile: true },
      videos: { [hostileId]: originalHostileVideo },
    },
    "https://example.com/",
    {
      tabs: [{ id: 7, url: "https://www.youtube.com/watch?v=" + hostileId }],
      executeScript: async (request) => {
        assert.equal(
          request.world,
          "MAIN",
          "transcript page data is read in MAIN with the existing legacy fallback",
        );
        return [{ frameId: 0, result: partialTranscript }];
      },
    },
  );
  partialExport.clipboardWrites.push("Keep my clipboard");
  for (const format of [
    "markdown-linked",
    "markdown",
    "text-timed",
    "text",
    "srt",
    "vtt",
    "json",
  ]) {
    await vm.runInContext(
      `settings.transcriptFormat = "${format}"; exportsController.exportTranscript("${hostileId}")`,
      partialExport.context,
    );
    assert.deepEqual(partialExport.clipboardWrites, ["Keep my clipboard"]);
    assert.ok(!partialExport.els["file-save-dialog"].open);
    assert.equal(partialExport.downloads.length, 0);
    assert.equal(partialExport.writes(), 0);
    assert.match(partialExport.els.status.textContent, /completeness/i);
  }
  console.log(
    "PASS: all seven export paths reject unverified partial transcripts without changing clipboard/bookmarks or offering a file",
  );
  const modernTranscript = {
    id: hostileId,
    duration: 1500,
    complete: true,
    source: "youtube-panel-response",
    language: "YouTube panel (language not supplied)",
    segments: [
      { start: 3, end: null, text: "First modern passage" },
      { start: 1419, end: null, text: "Last modern passage" },
    ],
  };
  const modernExport = await createPopupFixture(
    {
      settings: { autoBookmark: false, offerSaveFile: true },
      videos: { [hostileId]: originalHostileVideo },
    },
    "https://example.com/",
    {
      tabs: [{ id: 7, url: "https://www.youtube.com/watch?v=" + hostileId }],
      executeScript: async () => [{ frameId: 0, result: modernTranscript }],
    },
  );
  for (const format of ["srt", "vtt"]) {
    const before = JSON.stringify(modernExport.data.videos);
    await vm.runInContext(
      `settings.transcriptFormat = "${format}"; exportsController.exportTranscript("${hostileId}")`,
      modernExport.context,
    );
    assert.equal(modernExport.clipboardWrites.length, 0);
    assert.equal(JSON.stringify(modernExport.data.videos), before);
    assert.ok(!modernExport.els["file-save-dialog"].open);
    assert.equal(modernExport.downloads.length, 0);
    assert.match(modernExport.els.status.textContent, /choose Markdown, plain text, or JSON/);
  }
  for (const format of ["markdown-linked", "markdown", "text-timed", "text", "json"]) {
    await vm.runInContext(
      `settings.transcriptFormat = "${format}"; exportsController.exportTranscript("${hostileId}")`,
      modernExport.context,
    );
    assert.match(modernExport.clipboardWrites.at(-1), /First modern passage/);
    assert.match(modernExport.clipboardWrites.at(-1), /Last modern passage/);
    assert.ok(modernExport.els["file-save-dialog"].open);
    modernExport.els["file-save-cancel"].click();
    await modernExport.settle();
  }
  assert.equal(modernExport.writes(), 0);
  console.log(
    "PASS: modern panel copies all text in five formats; subtitle rejection preserves clipboard/bookmarks and suppresses file offers",
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
