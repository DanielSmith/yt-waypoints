const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const path = require("node:path");
const { readBundle } = require("../runtime.cjs");
function createPopupHarness(flavor) {
  const extension = path.resolve(__dirname, "../../yt-waypoints-" + flavor);
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
          removeProperty(name) {
            delete this[name];
          },
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
      "settings-toggle",
      "settings-toggle-label",
      "settings-panel",
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
    els["settings-panel"].hidden = true;
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
      runtime: { getManifest: () => ({ version: require("../../package.json").version }) },
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
      windows: {
        update: async (id, changes) => navigation.push({ type: "window", id, ...changes }),
      },
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
            {
              frameId: 0,
              result: { id: request.args.at(-1), t: 100, duration: 1000, paused: true },
            },
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
      TextEncoder,
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
  return { createPopupFixture };
}

module.exports = { createPopupHarness };
