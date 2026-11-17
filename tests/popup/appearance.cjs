const assert = require("node:assert/strict");
const vm = require("node:vm");

module.exports = async ({ createPopupFixture, flavor }) => {
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
  assert.equal(
    themed.context.WAYPOINTS_THEME_PICKER_IN_TAB,
    flavor === "firefox",
    "Only Firefox must route theme picking out of the transient popup",
  );
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
  themed.els["settings-toggle"].click();
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
};
