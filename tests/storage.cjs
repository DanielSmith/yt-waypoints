// Independent extension/content contexts sharing one asynchronous storage area.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { randomUUID } = require("node:crypto");
const flavor = process.argv[2] || "firefox";
const { readModule: read } = require("./runtime.cjs");
const A = "aaaaaaaaaaa";
const B = "bbbbbbbbbbb";
const initial = () => ({
  videos: {
    [A]: { id: A, title: "A", t: 10, duration: 1000, updated: 1 },
    [B]: { id: B, title: "B", t: 20, duration: 1000, updated: 1 },
  },
});
function sharedStorage(seed = initial()) {
  const data = structuredClone(seed);
  const subscribers = [];
  function client() {
    let hold;
    const api = {
      storage: {
        onChanged: { addListener: (fn) => subscribers.push(fn) },
        local: {
          async get(keys) {
            const snapshot = structuredClone(
              keys == null
                ? data
                : Object.fromEntries(
                    (Array.isArray(keys) ? keys : [keys]).map((key) => [key, data[key]]),
                  ),
            );
            if (hold?.kind === "get") {
              const pending = hold;
              hold = null;
              pending.enter();
              await pending.promise;
            }
            return snapshot;
          },
          async set(value) {
            if (hold?.kind === "set") {
              const pending = hold;
              hold = null;
              pending.enter();
              await pending.promise;
            }
            const changes = {};
            for (const [key, item] of Object.entries(value)) {
              changes[key] = {
                oldValue: structuredClone(data[key]),
                newValue: structuredClone(item),
              };
              data[key] = structuredClone(item);
            }
            subscribers.forEach((fn) => fn(changes, "local"));
          },
          async remove(keys) {
            if (hold?.kind === "remove") {
              const pending = hold;
              hold = null;
              pending.enter();
              await pending.promise;
            }
            const changes = {};
            for (const key of keys) {
              changes[key] = { oldValue: data[key] };
              delete data[key];
            }
            subscribers.forEach((fn) => fn(changes, "local"));
          },
        },
      },
    };
    return {
      api,
      hold(kind) {
        let release, enter;
        const entered = new Promise((resolve) => (enter = resolve));
        const promise = new Promise((resolve) => (release = resolve));
        hold = { kind, promise, enter };
        return { entered, release };
      },
    };
  }
  return { data, client };
}
function context(client, id = A) {
  const video = { currentTime: id === A ? 100 : 200, duration: 1000, paused: false };
  const ctx = vm.createContext({
    browser: client.api,
    crypto: { randomUUID },
    console,
    document: {
      querySelector: (selector) => (selector === "video" ? video : null),
      addEventListener() {},
    },
    location: { pathname: "/watch", search: "?v=" + id },
    URLSearchParams,
    window: {
      addEventListener(type, callback) {
        if (type === "pagehide") ctx.autosave = callback;
      },
    },
    setInterval() {},
    WAYPOINTS_READ_METADATA: () => ({
      id,
      t: Math.floor(video.currentTime),
      duration: Math.floor(video.duration),
      title: "Fixture",
    }),
  });
  vm.runInContext(read("storage.js"), ctx);
  vm.runInContext(read("transfer.js"), ctx);
  vm.runInContext(read("player-results.js"), ctx);
  vm.runInContext(read("content.js"), ctx);
  return { ctx, video, run: (script) => vm.runInContext(script, ctx) };
}
async function videos(ctx) {
  return (await ctx.WAYPOINTS_STORAGE.read()).videos;
}
async function main() {
  const shared = sharedStorage();
  const a = context(shared.client(), A);
  const b = context(shared.client(), B);
  await Promise.all([a.run("autosave()"), b.run("autosave()")]);
  let saved = await videos(a.ctx, shared.data);
  assert.equal(saved[A].t, 100, "simultaneous saves preserve the first tab update");
  assert.equal(saved[B].t, 200, "simultaneous saves preserve the second tab update");
  console.log("PASS: simultaneous independent tab autosaves preserve both positions");

  const deletion = sharedStorage();
  const writer = deletion.client();
  const tab = context(writer);
  const popup = context(deletion.client());
  // Hold the actual write, after every stale-read/generation check has already passed.
  const held = writer.hold("set");
  const saving = tab.run("autosave()");
  await held.entered;
  await popup.run(`(async () => { const snapshot = await WAYPOINTS_STORAGE.read();
      delete snapshot.videos['${B}']; await WAYPOINTS_STORAGE.save(snapshot); })()`);
  held.release();
  await saving;
  assert.equal(
    (await videos(tab.ctx, deletion.data))[B],
    undefined,
    "late autosave cannot resurrect another deleted bookmark",
  );
  console.log("PASS: held autosave cannot restore an unrelated deletion");

  async function snapshot(tab) {
    return tab.ctx.WAYPOINTS_STORAGE.read();
  }
  async function edit(tab, apply) {
    const state = await snapshot(tab);
    apply(state.videos);
    await tab.ctx.WAYPOINTS_STORAGE.save(state);
  }
  async function fresh(seed = initial()) {
    const shared = sharedStorage(seed);
    const client = shared.client();
    const tab = context(client);
    const other = context(shared.client());
    // Let the initial import-follow read settle before arming test barriers.
    for (let i = 0; i < 10; i++) await Promise.resolve();
    return { shared, client, tab, other };
  }

  // Same-video deletion wins even when the old save lands after deletion.
  for (const readd of [false, true]) {
    const { shared, client, tab, other } = await fresh();
    const held = client.hold("set");
    const saving = tab.run("autosave()");
    await held.entered;
    await edit(other, (videos) => delete videos[A]);
    if (readd)
      await edit(other, (videos) => {
        videos[A] = { ...initial().videos[A], t: 450 };
      });
    held.release();
    await saving;
    const saved = (await snapshot(other)).videos;
    assert.equal(saved[A]?.t, readd ? 450 : undefined);
    assert.equal(saved[B].t, 20);
    assert.equal(
      shared.data.videos,
      undefined,
      "permanent deletion removes the legacy payload after durable migration",
    );
  }
  console.log("PASS: deletion and explicit re-add block delayed same-video autosaves");

  // Separate fields on the same bookmark merge rather than replacing each other.
  {
    const { tab, other } = await fresh();
    const left = await snapshot(tab);
    const right = await snapshot(other);
    left.videos[A].channelName = "Updated channel";
    right.videos[A].t = 350;
    await Promise.all([
      tab.ctx.WAYPOINTS_STORAGE.save(left),
      other.ctx.WAYPOINTS_STORAGE.save(right),
    ]);
    const saved = (await snapshot(tab)).videos[A];
    assert.equal(saved.t, 350);
    assert.equal(saved.channelName, "Updated channel");
    assert.equal(saved.title, "A");
  }
  console.log("PASS: concurrent metadata and playback edits preserve both fields");

  // Same-field concurrent updates converge regardless of physical arrival order.
  {
    const { shared, tab, other } = await fresh();
    const left = await snapshot(tab);
    const right = await snapshot(other);
    left.videos[A].t = 300;
    right.videos[A].t = 400;
    await Promise.all([
      tab.ctx.WAYPOINTS_STORAGE.save(left),
      other.ctx.WAYPOINTS_STORAGE.save(right),
    ]);
    const expected = (await snapshot(tab)).videos;
    const reversed = Object.fromEntries(Object.entries(shared.data).reverse());
    assert.deepEqual(
      JSON.parse(JSON.stringify(tab.ctx.WAYPOINTS_STORAGE.decode(reversed).videos)),
      JSON.parse(JSON.stringify(expected)),
    );
    await edit(other, (videos) => {
      videos[A].t = 500;
    });
    assert.equal((await snapshot(tab)).videos[A].t, 500, "a causally later edit wins");
  }
  console.log("PASS: same-field concurrent edits converge and later observed edits win");

  // Import renews the lifetime, so an already-issued stale save cannot undo it.
  {
    const { client, tab, other } = await fresh();
    const held = client.hold("set");
    const saving = tab.run("autosave()");
    await held.entered;
    const incoming = { [A]: { ...initial().videos[A], t: 796 } };
    await other.ctx.WAYPOINTS_STORAGE.importVideos(incoming);
    held.release();
    await saving;
    assert.equal((await snapshot(tab)).videos[A].t, 796);
    assert.equal(tab.video.currentTime, 796, "live tab adopts imported position");
    tab.video.currentTime = 30;
    await other.ctx.WAYPOINTS_STORAGE.importVideos(incoming);
    for (let i = 0; i < 20; i++) await Promise.resolve();
    assert.equal(tab.video.currentTime, 796, "identical reimport renews player adoption");
    assert.equal((await snapshot(tab)).videos[B].t, 20);
  }
  console.log("PASS: import wins over held autosaves and identical reimports renew adoption");

  // Concurrent imports of different videos both survive and both tabs follow.
  {
    const { shared, tab, other } = await fresh();
    const b = context(shared.client(), B);
    await Promise.all([
      other.ctx.WAYPOINTS_STORAGE.importVideos({ [A]: { ...initial().videos[A], t: 600 } }),
      b.ctx.WAYPOINTS_STORAGE.importVideos({ [B]: { ...initial().videos[B], t: 700 } }),
    ]);
    for (let i = 0; i < 30; i++) await Promise.resolve();
    const saved = (await snapshot(tab)).videos;
    assert.equal(saved[A].t, 600);
    assert.equal(saved[B].t, 700);
    assert.equal(tab.video.currentTime, 600);
    assert.equal(b.video.currentTime, 700);
    tab.video.currentTime = 640;
    await other.ctx.WAYPOINTS_STORAGE.importVideos({ [B]: { ...initial().videos[B], t: 710 } });
    for (let i = 0; i < 30; i++) await Promise.resolve();
    assert.equal(tab.video.currentTime, 640, "unrelated import does not re-adopt an older target");
  }
  console.log("PASS: concurrent imports retain unrelated records and per-video adoption");

  // Deletions survive checkpoints, fresh contexts, and writes held across cleanup.
  {
    const { shared, client, tab, other } = await fresh();
    const held = client.hold("set");
    const saving = tab.run("autosave()");
    await held.entered;
    await edit(other, (videos) => delete videos[A]);
    for (let i = 0; i < 140; i++)
      await edit(other, (videos) => {
        videos[B].t = 200 + i;
      });
    assert.ok(
      Object.keys(shared.data).filter((key) => key.startsWith("waypoints.bookmarks.v2:")).length <
        64,
    );
    held.release();
    await saving;
    const reopened = context(shared.client());
    const saved = (await snapshot(reopened)).videos;
    assert.equal(saved[A], undefined);
    assert.equal(saved[B].t, 339);
    assert.equal(
      shared.data.videos,
      undefined,
      "compaction migrates the legacy baseline without retaining old payloads",
    );
    const copied = JSON.parse(reopened.ctx.WAYPOINTS_TRANSFER.stringify(saved));
    assert.deepEqual(Object.keys(copied.videos), [B]);
    assert.deepEqual(Object.keys(copied.videos[B]).sort(), [
      "duration",
      "id",
      "t",
      "title",
      "updated",
    ]);
    assert.deepEqual(Object.keys(copied).sort(), ["format", "version", "videos"]);
  }
  console.log(
    "PASS: bounded journal compaction preserves tombstones, delayed edits, reopening, and clean JSON exports",
  );

  // Overlapping compactors and a new write between checkpoint and cleanup.
  {
    const { shared, client, tab, other } = await fresh();
    for (let i = 0; i < 63; i++)
      await edit(other, (videos) => {
        videos[B].t = 100 + i;
      });
    const held = client.hold("remove");
    const compacting = edit(tab, (videos) => {
      videos[B].t = 500;
    });
    await held.entered;
    await edit(other, (videos) => {
      delete videos[A];
    });
    await other.ctx.WAYPOINTS_STORAGE.compact();
    held.release();
    await compacting;
    const saved = (await snapshot(context(shared.client()))).videos;
    assert.equal(saved[A], undefined);
    assert.equal(saved[B].t, 500);
  }
  console.log("PASS: overlapping compactions and unseen concurrent deletion preserve state");

  // Failed writes reject without changing state; failed cleanup retains recovery data.
  {
    const { client, tab, other } = await fresh();
    const originalSet = client.api.storage.local.set;
    client.api.storage.local.set = async () => {
      throw Error("quota");
    };
    await assert.rejects(
      edit(tab, (videos) => {
        delete videos[A];
      }),
      /quota/,
    );
    assert.equal((await snapshot(other)).videos[A].t, 10);
    client.api.storage.local.set = originalSet;
    for (let i = 0; i < 63; i++)
      await edit(other, (videos) => {
        videos[B].t = 100 + i;
      });
    client.api.storage.local.set = async (value) => {
      if (Object.values(value).some((entry) => entry.kind === "checkpoint"))
        throw Error("checkpoint quota");
      await originalSet(value);
    };
    await assert.rejects(
      edit(tab, (videos) => {
        delete videos[A];
      }),
      /stored-content cleanup failed/,
    );
    assert.equal((await snapshot(other)).videos[A], undefined);
    client.api.storage.local.set = originalSet;
    client.api.storage.local.remove = async () => {
      throw Error("cleanup failed");
    };
    await tab.ctx.WAYPOINTS_STORAGE.compact().catch(() => {});
    assert.equal((await snapshot(other)).videos[A], undefined);
  }
  console.log(
    "PASS: failed writes are reported; failed checkpoint/cleanup cannot lose committed data",
  );

  // Trash is an explicit lifetime, hidden from current reads and autosaving.
  {
    const { shared, client, tab, other } = await fresh();
    const held = client.hold("set");
    const saving = tab.run("autosave()");
    await held.entered;
    await other.ctx.WAYPOINTS_STORAGE.trash(A);
    held.release();
    await saving;
    let state = await snapshot(other);
    assert.equal(state.videos[A], undefined);
    assert.equal(state.trash[A].t, 10, "pre-trash autosave cannot edit the trash row");
    await tab.run("autosave()");
    assert.equal((await snapshot(other)).trash[A].t, 10);
    await other.ctx.WAYPOINTS_STORAGE.restore(A);
    state = await snapshot(tab);
    assert.equal(state.videos[A].t, 10);
    assert.equal(state.trash[A], undefined);
    await tab.run("autosave()");
    assert.equal((await snapshot(other)).videos[A].t, 100);
    assert.equal((await snapshot(context(shared.client()))).videos[B].t, 20);
  }
  console.log(
    "PASS: trash stops autosave, blocks delayed saves, and restores exact data to current",
  );

  // Expiry uses the configured age, and physically removes payloads/legacy copies.
  {
    const seed = initial();
    seed.settings = { trashDays: 7 };
    seed.videos[A].title = "PRIVATE-EXPIRED-TITLE";
    const { shared, tab, other } = await fresh(seed);
    await tab.ctx.WAYPOINTS_STORAGE.trash(A);
    const trashedAt = (await snapshot(other)).trashTimes[A];
    assert.equal(await other.ctx.WAYPOINTS_STORAGE.expire(trashedAt + 7 * 86400000 - 1), 0);
    assert.equal(await other.ctx.WAYPOINTS_STORAGE.expire(trashedAt + 7 * 86400000), 1);
    const state = await snapshot(context(shared.client()));
    assert.equal(state.trash[A], undefined);
    assert.equal(state.videos[A], undefined);
    assert.equal(state.videos[B].t, 20);
    assert.equal(JSON.stringify(shared.data).includes("PRIVATE-EXPIRED-TITLE"), false);
    assert.equal(await tab.ctx.WAYPOINTS_STORAGE.restore(A), false);
  }
  console.log(
    "PASS: exact retention boundary, irreversible expiry, payload erasure, and preserved current rows",
  );

  // Manual permanent deletion scrubs every observed journal/legacy copy and Undo.
  {
    const seed = initial();
    seed.videos[A].title = "PRIVATE-PURGED-TITLE";
    const { shared, client, tab, other } = await fresh(seed);
    const held = client.hold("set");
    const saving = tab.run("autosave()");
    await held.entered;
    await other.ctx.WAYPOINTS_STORAGE.purge([A]);
    assert.equal(JSON.stringify(shared.data).includes("PRIVATE-PURGED-TITLE"), false);
    held.release();
    await saving;
    assert.equal(
      JSON.stringify(shared.data).includes("PRIVATE-PURGED-TITLE"),
      false,
      "late writes clean up retired payload too",
    );
    assert.equal((await snapshot(other)).videos[A], undefined);
    await edit(other, (videos) => {
      videos[A] = { ...initial().videos[A], title: "New title" };
    });
    assert.equal((await snapshot(tab)).videos[A].title, "New title");
    assert.equal(JSON.stringify(shared.data).includes("PRIVATE-PURGED-TITLE"), false);
  }
  console.log(
    "PASS: permanent deletion scrubs payloads before returning and after late writers, while allowing a fresh re-add",
  );

  {
    const { shared, tab, other } = await fresh();
    await tab.ctx.WAYPOINTS_STORAGE.trash(A);
    await other.ctx.WAYPOINTS_STORAGE.trash(B);
    await tab.ctx.WAYPOINTS_STORAGE.restore(B);
    assert.equal(await other.ctx.WAYPOINTS_STORAGE.emptyTrash(), 1);
    const state = await snapshot(context(shared.client()));
    assert.deepEqual(Object.keys(state.trash), []);
    assert.equal(state.videos[A], undefined);
    assert.equal(state.videos[B].t, 20);
    assert.equal(await tab.ctx.WAYPOINTS_STORAGE.emptyTrash(), 0);
  }
  console.log("PASS: empty trash purges only trash and preserves already-restored/current records");

  // An expiry already in flight must not discard an explicit concurrent restore.
  {
    const { client, tab, other } = await fresh();
    await other.ctx.WAYPOINTS_STORAGE.trash(A);
    const when = (await snapshot(other)).trashTimes[A];
    const held = client.hold("set");
    const expiring = tab.ctx.WAYPOINTS_STORAGE.expire(when + 7 * 86400000);
    await held.entered;
    await other.ctx.WAYPOINTS_STORAGE.restore(A);
    held.release();
    await expiring;
    assert.equal((await snapshot(tab)).videos[A].t, 10);
    assert.equal((await snapshot(tab)).trash[A], undefined);
  }
  console.log("PASS: explicit restore wins over an already-issued automatic expiry");

  {
    const { client, tab, other } = await fresh();
    await other.ctx.WAYPOINTS_STORAGE.trash(A);
    const held = client.hold("set");
    const emptying = tab.ctx.WAYPOINTS_STORAGE.emptyTrash();
    await held.entered;
    await other.ctx.WAYPOINTS_STORAGE.restore(A);
    held.release();
    await emptying;
    assert.equal((await snapshot(tab)).videos[A].t, 10);
  }
  console.log("PASS: Empty trash cannot remove an explicitly restored row in a concurrent context");
}
const deadline = setTimeout(() => {
  console.error("Storage regression timed out at an asynchronous barrier");
  process.exit(1);
}, 15000);
main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => clearTimeout(deadline));
