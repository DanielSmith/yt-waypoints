const assert = require("node:assert/strict");
const vm = require("node:vm");

module.exports = async ({ createPopupFixture }) => {
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
  // Marker shortcuts, paste/import, and settings cannot steal an active editor.
  for (const key of ["m", "M", "a", "]", "[", "c", "C", "t", "h"])
    await markerKey(manualMarkers, key);
  assert.equal(await manualMarkers.paste('{"videos":{}}'), false);
  manualMarkers.els["settings-toggle"].click();
  assert.equal(manualMarkers.els["settings-panel"].hidden, true);
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
  markerExport.els["settings-toggle"].click();
  markerExport.els["copy-videos"].click();
  await markerExport.settle();
  assert.equal(
    JSON.parse(markerExport.clipboardWrites.at(-1)).videos.aaaaaaaaaaa.startNote,
    markerVideo.startNote,
  );
  console.log(
    "PASS: packaged single/all-row and Settings JSON copies preserve marker annotations and removal records",
  );
};
