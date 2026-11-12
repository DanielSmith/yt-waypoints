const assert = require("node:assert/strict");
const vm = require("node:vm");
const { randomUUID } = require("node:crypto");
const { readModule } = require("./runtime.cjs");
const flavor = process.argv[2] || "firefox";
const ID = "aaaaaaaaaaa";
const plain = (value) => JSON.parse(JSON.stringify(value));
const user = (id, t, extra = {}) => ({ id: "u:" + id, t, origin: "user", ...extra });
const chapter = (t, extra = {}) => ({ id: "c:" + t * 1000, t, origin: "chapter", ...extra });
const base = (extra = {}) => ({
  id: ID,
  title: "Fixture",
  t: 80,
  duration: 1000,
  updated: 1,
  ...extra,
});

function fixture(seed = base()) {
  const raw = { videos: { [ID]: structuredClone(seed) } };
  let writes = 0;
  function client() {
    const api = {
      storage: {
        local: {
          get: async () => structuredClone(raw),
          set: async (values) => {
            writes++;
            Object.assign(raw, structuredClone(values));
          },
          remove: async (keys) => {
            for (const key of keys) delete raw[key];
          },
        },
      },
    };
    const context = vm.createContext({
      [flavor === "firefox" ? "browser" : "chrome"]: api,
      crypto: { randomUUID },
      URL,
    });
    vm.runInContext(readModule("storage.js") + "\n" + readModule("transfer.js"), context);
    return {
      storage: context.WAYPOINTS_STORAGE,
      data: context.WAYPOINTS_MARKERS,
      transfer: context.WAYPOINTS_TRANSFER,
    };
  }
  return { client, raw, writes: () => writes };
}

(async () => {
  const shared = fixture();
  const a = shared.client(),
    b = shared.client();
  assert.deepEqual(plain(a.data.anchor([], null)), { markerId: null, t: 0 });
  assert.deepEqual(plain(a.data.anchor([user("one", 60)], null)), { markerId: null, t: 0 });
  assert.deepEqual(plain(a.data.anchor([user("one", 60)], "u:one")), { markerId: "u:one", t: 60 });
  assert.equal(a.data.anchor([user("one", 60, { removed: true })], "u:one").t, 0);
  const note = "First line\n\n  Keep indentation and <plain text>.";
  assert.equal(a.data.note(note), note);
  for (const markers of [
    null,
    {},
    [user("one", -1)],
    [user("one", NaN)],
    [user("one", Infinity)],
    [user("one", "2")],
    [user("one", 0.0001)],
    [user("one", 1, { origin: "other" })],
    [chapter(1, { id: "c:2000" })],
    [user("one", 1), user("one", 2)],
    [user("one", 1, { note: "x".repeat(10001) })],
    [user("one", 1, { removed: "yes" })],
    new Array(a.data.MAX_MARKERS + 1),
  ]) {
    assert.throws(() => a.data.normalize(markers));
  }
  const hostile = user("getter", 1);
  Object.defineProperty(hostile, "note", {
    get() {
      throw Error("getter invoked");
    },
  });
  assert.throws(() => a.data.normalize([hostile]), /Invalid marker note/);
  const safe = a.data.normalize([user("one", 1, { script: "bad()", url: "javascript:bad()" })]);
  assert.deepEqual(plain(safe), [user("one", 1)]);

  // Two independent contexts start from the same snapshot; both additions survive.
  const left = await a.storage.read(),
    right = await b.storage.read();
  left.videos[ID].markers = [user("one", 10, { note })];
  right.videos[ID].markers = [chapter(30, { title: "Original" })];
  await Promise.all([a.storage.save(left), b.storage.save(right)]);
  let video = (await a.storage.read()).videos[ID];
  assert.equal(video.markers.length, 2);
  assert.equal(video.markers[0].note, note);

  // A chapter-title refresh, a personal note edit, and autosave touch separate fields.
  const refresh = await a.storage.read(),
    edit = await b.storage.read(),
    autosave = await a.storage.read();
  refresh.videos[ID].markers[1].title = "Refreshed";
  edit.videos[ID].markers[1].note = "My own note";
  autosave.videos[ID].t = 796;
  await Promise.all([a.storage.save(refresh), b.storage.save(edit), a.storage.save(autosave)]);
  video = (await a.storage.read()).videos[ID];
  assert.equal(video.t, 796);
  assert.equal(video.markers[1].title, "Refreshed");
  assert.equal(video.markers[1].note, "My own note");

  // Removing a point creates a tombstone, not a partial marker that a late note revives.
  const removal = await a.storage.read(),
    late = await b.storage.read();
  removal.videos[ID].markers = removal.videos[ID].markers.filter(
    (marker) => marker.id !== "c:30000",
  );
  late.videos[ID].markers[1].note = "Late note";
  await Promise.all([a.storage.save(removal), b.storage.save(late)]);
  video = (await a.storage.read()).videos[ID];
  assert.equal(video.markers[1].removed, true);
  assert.equal(video.markers[1].note, "Late note");
  assert.equal(a.data.anchor(video.markers, "c:30000").t, 0);
  const refreshed = a.data.refreshChapters(video.markers, [
    chapter(30, { title: "New chapter title", note: "Page note" }),
    chapter(50),
  ]);
  assert.equal(refreshed.length, 3);
  assert.equal(refreshed[1].title, "New chapter title");
  assert.equal(refreshed[1].note, "Late note");
  assert.equal(refreshed[1].removed, true);
  assert.equal(refreshed[0].origin, "user");
  assert.throws(() => a.data.refreshChapters([], [user("not-chapter", 2)]));

  // Video-start notes do not create markers or move the resume point.
  const empty = fixture(base());
  const e = empty.client();
  let snapshot = await e.storage.read();
  snapshot.videos[ID].startNote = note;
  await e.storage.save(snapshot);
  video = (await e.storage.read()).videos[ID];
  assert.equal(video.startNote, note);
  assert.equal(video.t, 80);
  assert.equal(video.markers, undefined);

  // Old transfers leave local annotation data alone; new ones merge stable IDs.
  const old = a.transfer.parse(
    JSON.stringify({ format: "yt-waypoints", version: 1, videos: { [ID]: base({ t: 12 }) } }),
  );
  await a.storage.importVideos(old);
  video = (await a.storage.read()).videos[ID];
  assert.equal(video.markers.length, 2);
  assert.equal(video.markers[1].removed, true);
  const incoming = { [ID]: base({ markers: [user("two", 90)], startNote: note }) };
  await a.storage.importVideos(incoming);
  video = (await a.storage.read()).videos[ID];
  assert.equal(video.markers.length, 3);
  assert.equal(video.startNote, note);
  const exported = a.transfer.stringify({ [ID]: video });
  assert.equal(JSON.parse(exported).version, 2);
  assert.deepEqual(plain(a.transfer.parse(exported)[ID]), plain(video));
  assert.equal(JSON.parse(a.transfer.stringify({ [ID]: base() })).version, 1);
  const roundtrip = a.transfer.merge({ [ID]: video }, a.transfer.parse(exported));
  assert.equal(roundtrip.counts.kept, 1, "identical marker imports do not count as changed");
  const startRoundtrip = e.transfer.parse(
    e.transfer.stringify({ [ID]: (await e.storage.read()).videos[ID] }),
  );
  assert.equal(startRoundtrip[ID].startNote, note);
  assert.equal(startRoundtrip[ID].markers, undefined);
  const cleared = e.transfer.merge(startRoundtrip, { [ID]: base({ startNote: "" }) });
  assert.equal(cleared.videos[ID].startNote, "", "explicit empty annotations clear the note");
  const staleImport = await b.storage.read();
  staleImport.videos[ID].markers[0].note = "Old lifetime note";
  await a.storage.importVideos({ [ID]: base({ t: 88 }) });
  await b.storage.save(staleImport);
  video = (await a.storage.read()).videos[ID];
  assert.equal(
    video.markers[0].note,
    note,
    "an old editor cannot overwrite a newer import lifetime",
  );

  // Reject a malformed import atomically, before even its valid resume point is written.
  const before = shared.writes();
  await assert.rejects(a.storage.importVideos({ [ID]: base({ markers: [user("bad", -1)] }) }));
  assert.equal(shared.writes(), before);
  await a.storage.compact(true);
  assert.deepEqual(plain((await shared.client().storage.read()).videos[ID]), plain(video));

  // Lifetime changes defeat an annotation save held across permanent deletion/re-add.
  const stale = await b.storage.read();
  stale.videos[ID].markers[0].note = "Must not return";
  await a.storage.purge([ID]);
  await b.storage.save(stale);
  assert.equal((await a.storage.read()).videos[ID], undefined);
  assert.ok(
    !JSON.stringify(shared.raw).includes(note),
    "permanent purge erases annotation payloads",
  );
  snapshot = await a.storage.read();
  snapshot.videos[ID] = base();
  await a.storage.save(snapshot);
  await b.storage.save(stale);
  assert.equal((await a.storage.read()).videos[ID].markers, undefined);

  // Trash/restore preserves notes; content remains excluded from current-only export.
  snapshot = await e.storage.read();
  snapshot.videos[ID].markers = [user("last", 3)];
  await e.storage.save(snapshot);
  await e.storage.trash(ID);
  snapshot = await e.storage.read();
  assert.equal(snapshot.trash[ID].startNote, note);
  assert.deepEqual(plain(e.transfer.parse(e.transfer.stringify(snapshot.videos))), {});
  await e.storage.restore(ID);
  assert.equal((await e.storage.read()).videos[ID].startNote, note);
  console.log(
    `PASS: ${flavor} marker validation, anchors, independent edits, deletion races, transfer, compaction, trash and purge`,
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
