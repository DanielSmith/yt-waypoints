const assert = require("node:assert/strict");
const vm = require("node:vm");
const { transferSeed } = require("./seeds.cjs");

module.exports = async ({ createPopupFixture }) => {
  const { a, b, record } = transferSeed();
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
  previewSettings.els["settings-toggle"].click();
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
  rapidSettings.els["settings-toggle"].click();
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
  pendingThumbnails.els["settings-toggle"].click();
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
};
