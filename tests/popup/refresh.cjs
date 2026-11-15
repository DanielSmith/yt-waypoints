const assert = require("node:assert/strict");
const vm = require("node:vm");

module.exports = async ({ createPopupFixture }) => {
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
};
