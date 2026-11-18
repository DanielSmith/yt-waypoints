const assert = require("node:assert/strict");
const vm = require("node:vm");
const { bookmarkSeed } = require("./seeds.cjs");

module.exports = async ({ createPopupFixture }) => {
  const initial = bookmarkSeed();
  let p = await createPopupFixture(initial);
  const about = await createPopupFixture(initial);
  about.els["about-toggle"].click();
  assert.equal(about.els["about-dialog"].open, true);
  assert.equal(
    about.els["about-version"].textContent,
    `Version ${require("../../package.json").version}`,
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
  assert.deepEqual(rows(), ["aaaaaaaaaaa", "bbbbbbbbbbb", "ccccccccccc"]);
  p.els.search.value = ".";
  p.els.search.events.input();
  assert.deepEqual(rows(), ["aaaaaaaaaaa", "bbbbbbbbbbb", "ccccccccccc"]);
  assert.equal(p.els["search-feedback"].textContent, "");
  assert.equal(p.els.search["aria-invalid"], "false");
  p.els.search.value = "VIDEO";
  p.els.search.events.input();
  assert.deepEqual(rows(), ["bbbbbbbbbbb", "ccccccccccc"]);
  assert.equal(p.els["clear-search"].hidden, false);
  assert.equal(p.writes(), 0, "search must never change saved bookmarks");
  p.els.search.value = "missing";
  p.els.search.events.input();
  assert.deepEqual(rows(), []);
  assert.equal(p.els.list.children[0].textContent, "No matching videos.");
  p.els["clear-search"].click();
  assert.deepEqual(rows(), ["aaaaaaaaaaa", "bbbbbbbbbbb", "ccccccccccc"]);
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
  assert.equal(p.doc.activeElement.dataset.id, "bbbbbbbbbbb");
  p.doc.listeners.keydown({ key: "Delete", preventDefault() {} });
  await p.settle();
  assert.equal(p.data.videos.bbbbbbbbbbb, undefined);
  assert.ok(p.data.videos.aaaaaaaaaaa && p.data.videos.ccccccccccc);
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
  p.els["settings-toggle"].click();
  assert.equal(p.els["search-control"].hidden, true);
  assert.equal(p.els.list.hidden, true);
  assert.equal(p.els["settings-panel"].hidden, false);
  p.els["settings-toggle"].click();
  assert.equal(p.els["search-control"].hidden, false);
  assert.equal(p.els.search.value, "Dario");
  assert.deepEqual(rows(), ["aaaaaaaaaaa"]);
  await vm.runInContext(
    '(async () => { const snapshot = await bookmarks.loadSnapshot(); const { videos } = snapshot; videos.aaaaaaaaaaa.title = "Renamed title"; await bookmarks.saveSnapshot(snapshot); await render(); })()',
    p.context,
  );
  assert.deepEqual(rows(), [], "storage refresh must keep applying current search");
  console.log("PASS: settings hide search, restore query/filter, storage refresh respects search");
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
  p.els["settings-toggle"].click();
  p.doc.listeners.keydown({
    key: "/",
    preventDefault() {
      throw Error("hidden search focused");
    },
  });
  assert.equal(p.doc.activeElement, firstRow);
  p.els["settings-toggle"].click();
  console.log(
    "PASS: slash focuses search; slash typing, modifier shortcuts, and settings mode remain unaffected",
  );
  const existing = await createPopupFixture({
    settings: { autoBookmark: false },
    videos: {
      aaaaaaaaaaa: { id: "aaaaaaaaaaa", title: "Current", t: 70, updated: 1 },
      nnnnnnnnnnn: { id: "nnnnnnnnnnn", title: "Newer", t: 10, updated: 2 },
    },
  });
  assert.equal(existing.doc.activeElement.dataset.id, "aaaaaaaaaaa");
  assert.equal(existing.data.videos.aaaaaaaaaaa.t, 70);
  const unsaved = await createPopupFixture({ settings: { autoBookmark: false } });
  assert.equal(unsaved.doc.activeElement, unsaved.els["restore-bookmark"]);
  assert.equal(unsaved.els["restore-bookmark"].hidden, false);
  assert.equal(unsaved.els["search-control"].hidden, true);
  assert.equal(unsaved.data.videos, undefined, "opening with auto-bookmark off must not save");
  unsaved.els["settings-toggle"].click();
  assert.equal(unsaved.els["restore-bookmark"].hidden, true);
  unsaved.els["settings-toggle"].click();
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
  const toggled = await createPopupFixture(initial, "https://www.youtube.com/watch?v=ddddddddddd");
  await vm.runInContext("settings.autoBookmark = true", toggled.context);
  toggled.els["settings-toggle"].click();
  toggled.els["auto-bookmark"].checked = false;
  toggled.els["auto-bookmark"].events.change();
  await toggled.settle();
  toggled.els["settings-toggle"].click();
  assert.equal(toggled.els["restore-bookmark"].hidden, false);
  assert.equal(toggled.els["search-control"].hidden, true);
  assert.equal(
    existing.els["restore-bookmark"].hidden,
    true,
    "already saved video needs no Add button",
  );
  assert.equal(existing.writes(), 0, "existing position must not be overwritten");
  console.log(
    "PASS: manual bookmark button with auto-bookmark off, save/return to search, slash override survives refresh, settings toggle, existing bookmark untouched",
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
};
