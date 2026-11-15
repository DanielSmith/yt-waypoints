const assert = require("node:assert/strict");
const vm = require("node:vm");

module.exports = async ({ createPopupFixture }) => {
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
};
