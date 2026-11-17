const assert = require("node:assert/strict");

async function main() {
  await import("../src/shared/youtube-values.js");
  await import("../src/shared/marker-data.js");
  await import("../src/shared/transfer.js");
  const { createAlapTransfer, mergeMacroBackup, importAlapBackup } =
    await import("../src/shared/alap-transfer.mjs");
  const { createMacroStore } = await import("../src/shared/alap-macro-store.mjs");
  const codec = createAlapTransfer(WAYPOINTS_TRANSFER);
  const id = "abcdefghijk";
  const video = { id, title: "Video", t: 4, duration: 100, updated: 9, startNote: "First" };
  const library = (macros) => ({ version: 1, macros });
  const local = library({ few: { linkItems: "*limit:1*" }, view: { linkItems: ".research @few" } });
  const incoming = {
    few: { linkItems: "*limit:3*" },
    view: { linkItems: ".research @few" },
    new_view: { linkItems: "@view *reverse*" },
  };
  const backup = (record, macroLibrary = library(incoming)) =>
    JSON.stringify({
      format: "yt-waypoints",
      version: 3,
      videos: { [id]: record },
      macroLibrary,
    });
  assert.equal(JSON.parse(codec.stringify({ [id]: video })).version, 2);
  assert.equal(
    codec.parse(JSON.stringify({ videos: { [id]: { ...video, tags: ["ignored"] } } })).includeTags,
    false,
  );
  const tagged = { ...video, tags: ["research"] };
  const parsed = codec.parse(codec.stringify({ [id]: tagged }, library(incoming)));
  assert.deepEqual(parsed.videos[id], tagged);
  assert.deepEqual(parsed.macros, incoming);
  assert.equal(codec.parse(codec.stringify({ [id]: tagged })).macros, null);
  const priv = {
    format: "yt-waypoints-alap-editor",
    version: 1,
    bookmarks: { format: "yt-waypoints", version: 2, videos: { [id]: tagged } },
    macros: incoming,
  };
  assert.deepEqual(codec.parse(JSON.stringify(priv)), parsed);
  assert.deepEqual(codec.parse(backup({ ...video, tags: [] })).videos[id].tags, []);
  assert.equal(Object.hasOwn(codec.parse(backup(video)).videos[id], "tags"), false);
  for (const value of [null, "research", ["Research"], ["research", "research"]])
    assert.throws(() => codec.parse(backup({ ...video, tags: value })), /Invalid Alap/);
  assert.throws(() => codec.parse(backup({ ...video, posted: "2026-11-17" })), /unsupported video/);
  assert.throws(
    () => codec.parse(backup(tagged, library({ bad: { linkItems: "@missing" } }))),
    /unknown/i,
  );
  assert.throws(() => codec.parse(JSON.stringify({ ...priv, version: 2 })), /version/);

  assert.deepEqual(mergeMacroBackup(local, incoming, "keep").macros.few, local.macros.few);
  assert.deepEqual(mergeMacroBackup(local, incoming, "replace").macros.few, incoming.few);
  const renamed = mergeMacroBackup(local, incoming, "rename");
  assert.equal(renamed.macros.few.linkItems, "*limit:1*");
  assert.equal(renamed.macros.view.linkItems, ".research @few");
  assert.equal(renamed.macros.few_imported_1.linkItems, "*limit:3*");
  assert.equal(renamed.macros.view_imported_1.linkItems, ".research @few_imported_1");
  assert.equal(renamed.macros.new_view.linkItems, "@view_imported_1 *reverse*");
  assert.deepEqual(
    mergeMacroBackup(renamed, incoming, "rename"),
    renamed,
    "retry reuses renamed definitions",
  );
  assert.throws(() => mergeMacroBackup(local, incoming), /Choose/);
  const key = "waypoints.macros.v1";
  let registry = { revision: "original", library: local },
    macroWrites = 0;
  let bookmarkWrites = 0,
    failMacro = false,
    failBookmarks = false;
  const store = createMacroStore(
    {
      storage: {
        local: {
          get: async () => ({ [key]: structuredClone(registry) }),
          set: async (values) => {
            if (failMacro) throw new Error("Macro storage unavailable");
            registry = structuredClone(values[key]);
            macroWrites++;
          },
        },
      },
    },
    { locks: { request: (_name, action) => action() } },
  );
  const storage = {
    importVideos: async (videos, options) => {
      assert.deepEqual(videos[id], tagged);
      assert.equal(options.includeTags, true);
      if (failBookmarks) throw new Error("Bookmark storage unavailable");
      bookmarkWrites++;
      return { counts: { added: 1 } };
    },
  };
  const commit = (choice) =>
    importAlapBackup(parsed, { storage, macroStore: store, chooseConflicts: choice });
  assert.equal(await commit(() => null), null);
  failMacro = true;
  await assert.rejects(
    commit(() => "rename"),
    /Macro storage unavailable/,
  );
  assert.equal(bookmarkWrites, 0);
  assert.equal(macroWrites, 0);
  failMacro = false;
  failBookmarks = true;
  await assert.rejects(
    commit(() => "rename"),
    /Macros saved.*Paste the same backup/,
  );
  assert.equal(bookmarkWrites, 0);
  assert.equal(macroWrites, 1);
  failBookmarks = false;
  await commit(() => "rename");
  assert.equal(bookmarkWrites, 1);
  assert.equal(macroWrites, 1, "partial failure is recoverable without duplicating macros");

  registry = { revision: "original", library: local };
  await assert.rejects(
    commit(async () => {
      await store.replace("original", library({ few: { linkItems: "*limit:7*" } }));
      return "replace";
    }),
    /changed in another editor/,
  );
  assert.equal(bookmarkWrites, 1, "stale conflict choice cannot write bookmarks");
  console.log(
    "PASS: Alap backup codecs, private editor migration, conflict policies, revision checks and retry",
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
