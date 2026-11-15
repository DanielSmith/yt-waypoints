const assert = require("node:assert/strict");
const vm = require("node:vm");
const { transferSeed } = require("./seeds.cjs");

module.exports = async ({ createPopupFixture, flavor }) => {
  const { a, b, c, d, record, local } = transferSeed();
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
  shortcuts.els["settings-toggle"].click();
  shortcuts.els["settings-toggle"].focus();
  await key("C");
  assert.deepEqual(JSON.parse(shortcuts.clipboardWrites.at(-1)).videos, local.videos);
  await key("h");
  assert.equal(shortcuts.els["help-dialog"].open, true);
  await key(flavor === "firefox" ? "h" : "Escape");
  assert.equal(shortcuts.doc.activeElement, shortcuts.els["settings-toggle"]);
  console.log(
    "PASS: row URL/JSON and all-JSON shortcuts, importable single export, filter/modifier/repeat/search safety, modal help isolation and focus restoration",
  );
  const transferPopup = await createPopupFixture(local, "https://example.com/");
  transferPopup.els["settings-toggle"].click();
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
  assert.equal(transferPopup.els["settings-panel"].hidden, true);
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
  fallbackCopy.els["settings-toggle"].click();
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
    "PASS: Settings JSON export/copy and offscreen fallback, paste merge stays open, pasted source wins, settings/unrelated rows preserved, invalid JSON is atomic, repeated import unchanged, cross-browser-ready round trip",
  );
};
