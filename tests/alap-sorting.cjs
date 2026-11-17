const assert = require("node:assert/strict");
async function main() {
  const { searchVideos, createVideoSearchSnapshot } = await import("../src/shared/alap-query.mjs");
  const { createVideoCatalog } = await import("../src/shared/alap-video-catalog.mjs");
  const { readPostedTime } = await import("../src/shared/alap-posted-time.mjs");
  const { TagExpressionParser } = await import("../src/vendor/alap-tags-core/index.mjs");
  const { applyRefiners } = await import("../src/vendor/alap-tags-core/refiners.mjs");
  const videos = [
    {
      title: "Episode 100",
      channelName: "Zeta",
      duration: 100,
      updated: 300,
      posted: "2026-11-17T12:30:00Z",
      tags: ["watch", "anime"],
    },
    {
      title: "episode 9",
      channelName: "Alpha 10",
      duration: 9,
      updated: 100,
      posted: "2026-11-17T07:00:00-05:00",
      tags: ["watch", "documentary"],
    },
    {
      title: "EPISODE 9",
      channelName: "Alpha 2",
      duration: 9,
      updated: 200,
      posted: "2026-11-17T13:00:00+01:00",
      tags: ["watch", "anime"],
    },
    {
      title: " ",
      channelName: "",
      duration: 0,
      updated: 0,
      posted: "2026-11-17",
      tags: ["watch", "documentary"],
    },
    { duration: NaN, updated: Infinity, posted: null, tags: ["watch"] },
    {
      title: "Episode 2",
      channelName: "alpha 2",
      duration: 300,
      updated: 400,
      posted: "2026-11-17T12:45:00.001Z",
      tags: ["watch", "anime"],
    },
  ].map((video, index) => ({ ...video, id: `v${String(index).padStart(10, "0")}` }));
  const ids = (indexes) => indexes.map((index) => videos[index].id);
  const search = (expression, options) => searchVideos(videos, expression, options);
  for (const field of ["label", "title"])
    assert.deepEqual(search(`.watch *sort:${field}*`).ids, ids([5, 1, 2, 0, 3, 4]));
  assert.deepEqual(search(".watch *sort*").ids, ids([5, 1, 2, 0, 3, 4]));
  assert.deepEqual(search(".watch *sort:label* *reverse*").ids, ids([4, 3, 0, 2, 1, 5]));
  assert.deepEqual(search(".watch *sort:channel*").ids, ids([2, 5, 1, 0, 3, 4]));
  for (const field of ["duration", "updated", "posted"])
    assert.deepEqual(search(`.watch *sort:${field}*`).ids, ids([1, 2, 0, 5, 3, 4]), field);
  assert.deepEqual(
    search(".watch *sort:duration* *reverse*").ids,
    ids([4, 3, 5, 0, 2, 1]),
    "literal reverse moves unknowns too",
  );
  assert.deepEqual(search(".watch *limit:3* *sort:duration*").ids, ids([1, 2, 0]));
  assert.deepEqual(search(".watch *sort:duration* *skip:1* *limit:2*").ids, ids([2, 0]));
  assert.deepEqual(
    search("@short", { macros: { short: { linkItems: ".watch *sort:duration* *limit:3*" } } }).ids,
    ids([1, 2, 0]),
  );
  assert.deepEqual(
    search(".documentary | .anime").ids,
    ids([0, 1, 2, 3, 5]),
    "unrefined queries retain base caller order",
  );
  const groups = "(.anime *sort:duration* *limit:1*) | (.documentary *sort:duration* *limit:1*)";
  assert.deepEqual(search(groups).ids, ids([2, 1]), "preserve refined group union order");
  assert.deepEqual(
    search(groups + " *sort:label*").ids,
    ids([2, 1]),
    "outer stable sort preserves incoming tie order",
  );
  const limited = search(".watch *sort:duration* *limit:2*");
  assert.deepEqual(
    {
      input: limited.rootInputCount,
      output: limited.resultCount,
      refined: limited.hasRefiners,
      shuffle: limited.hasShuffle,
      stages: limited.refinerCount,
    },
    { input: 6, output: 2, refined: true, shuffle: false, stages: 2 },
  );
  assert.equal(search(groups).rootInputCount, null, "no imaginary pre-refiner group universe");
  const outer = search(`(${groups}) *limit:1*`);
  assert.equal(outer.rootInputCount, 2, "root pipeline counts already-refined group input");
  assert.equal(outer.resultCount, 1);
  assert.equal(outer.refinerCount, 5);
  assert.equal(search(".missing *limit:2*").rootInputCount, 0);
  assert.equal(search(".missing *limit:2*").resultCount, 0);
  assert.equal(search(".watch *limit:0*").rootInputCount, 6);
  assert.equal(search(".watch *limit:0*").resultCount, 0);
  assert.equal(search("episode").rootInputCount, null);
  assert.equal(search("episode").hasRefiners, false);
  assert.equal(search("episode").resultCount, 4);
  assert.deepEqual(search("alpha").ids, ids([1, 2, 5]));
  assert.deepEqual(search("alpha", { includeChannelNames: false }).ids, []);
  assert.deepEqual(search("watch").ids, ids([0, 1, 2, 3, 4, 5]));
  assert.equal(search("a * b").kind, "text");
  assert.throws(() => search(".missing *sort:url*"), /sort field/);

  const utc = Date.parse("2026-11-17T12:00:00Z");
  assert.equal(readPostedTime(videos[1].posted), utc);
  assert.equal(readPostedTime(videos[2].posted), utc);
  assert.equal(readPostedTime(utc), utc);
  assert.equal(readPostedTime("2024-02-29T12:00:00.12Z"), Date.parse("2024-02-29T12:00:00.120Z"));
  assert.equal(readPostedTime("2026-11-17T12:00:00+05:30"), Date.parse("2026-11-17T06:30:00Z"));
  for (const value of [
    undefined,
    null,
    true,
    {},
    new Date(),
    utc.toString(),
    NaN,
    Infinity,
    -1,
    0,
    1.5,
    8640000000000001,
    "2026-11-17",
    "2026-11-17T12:00:00",
    "2026-02-29T12:00:00Z",
    "2026-04-31T12:00:00Z",
    "2026-13-01T12:00:00Z",
    "2026-11-17T24:00:00Z",
    "2026-11-17T12:00:60Z",
    "2026-11-17T12:00:00+24:00",
    "2026-11-17T12:00:00+01:60",
    "2026-11-17T12:00:00.1234Z",
  ])
    assert.equal(readPostedTime(value), null, String(value));
  const catalog = createVideoCatalog(videos);
  assert.equal(catalog.allLinks.video_3.posted, null);
  assert.equal(catalog.allLinks.video_3.duration, null);
  assert.equal(catalog.allLinks.video_4.updated, null);
  assert.equal(catalog.allLinks.video_1.posted, catalog.allLinks.video_2.posted);
  assert.equal(Object.hasOwn(catalog.allLinks.video_0, "channelUrl"), false);
  catalog.allLinks.video_0.tags.push("detached");
  catalog.allLinks.video_0.duration = 999;
  assert.equal(videos[0].tags.includes("detached"), false);
  assert.equal(videos[0].duration, 100);
  const getter = { id: videos[0].id, tags: ["watch"] };
  Object.defineProperty(getter, "duration", {
    enumerable: true,
    get() {
      throw Error("getter executed");
    },
  });
  assert.throws(() => createVideoCatalog([getter]), /own data fields/);
  assert.throws(
    () =>
      createVideoCatalog([
        Object.assign(Object.create({ title: "inherited" }), { id: videos[0].id }),
      ]),
    /plain bookmark/,
  );

  // Snapshot ownership is explicit: input changes do not mutate an existing view.
  const mutable = videos.map((video) => ({ ...video, tags: [...video.tags] }));
  const snapshot = createVideoSearchSnapshot(mutable);
  mutable[0].duration = 1;
  mutable[0].title = "Changed";
  mutable[0].tags.length = 0;
  assert.deepEqual(snapshot.search(".watch *sort:duration* *limit:3*").ids, ids([1, 2, 0]));
  assert.deepEqual(snapshot.search("episode 100").ids, ids([0]));
  assert.deepEqual(searchVideos(mutable, ".watch *sort:duration* *limit:3*").ids, ids([1, 2, 5]));
  let calls = 0;
  const evaluation = {
    random: () => {
      calls++;
      return 0;
    },
  };
  const shuffled = snapshot.search(".watch *shuffle* *limit:3*", { evaluation });
  assert.deepEqual(shuffled.ids, ids([1, 2, 3]));
  assert.equal(calls, 5);
  assert.equal(shuffled.hasShuffle, true);
  assert.equal(shuffled.rootInputCount, 6);
  shuffled.ids.push("caller-change");
  assert.deepEqual(
    snapshot.search(".watch *shuffle* *limit:3*", { evaluation }).ids,
    ids([1, 2, 3]),
  );
  assert.equal(calls, 10, "explicit re-evaluation consumes a new shuffle; no hidden cache");
  assert.throws(() => snapshot.search(".watch *shuffle* | .anime", { evaluation }));
  assert.equal(calls, 10, "invalid expression consumes no random values");
  assert.throws(
    () => snapshot.search(".watch *shuffle*", { evaluation: { random: () => 1 } }),
    /shuffle source/,
  );

  // The generic derivative has typed descriptors but no bookmark policy.
  const generic = new TagExpressionParser(
    { a: { tags: ["x"], cost: 100 }, b: { tags: ["x"], cost: 9 }, c: { tags: ["x"], cost: null } },
    { fields: ["cost"], fieldTypes: { cost: "number" } },
  );
  assert.deepEqual(generic.query(".x *sort:cost*"), ["b", "a", "c"]);
  assert.deepEqual(generic.resolve(".x *sort:cost* *limit:1*").rootInputCount, 3);
  assert.throws(() => generic.query(".x *sort:duration*"), /sort field/);
  assert.throws(
    () =>
      new TagExpressionParser(
        { a: { tags: ["x"], cost: "9" } },
        { fields: ["cost"], fieldTypes: { cost: "number" } },
      ),
    /catalog scalar/,
  );
  assert.throws(
    () => new TagExpressionParser({}, { fields: ["cost"], fieldTypes: { cost: () => 0 } }),
    /sort type/,
  );
  assert.throws(() => new TagExpressionParser({}, { fields: ["tags"] }), /sort field/);
  assert.throws(
    () => new TagExpressionParser({}, { fields: ["cost"], fieldTypes: { other: "number" } }),
    /sort type/,
  );
  const raw = [{ cost: 2 }, { cost: 0 }, { cost: -1 }];
  assert.deepEqual(
    applyRefiners(raw, [{ name: "sort", args: ["cost"] }], {
      fields: ["cost"],
      fieldTypes: { cost: "number" },
    }).map((v) => v.cost),
    [-1, 0, 2],
  );
  const frozen = videos.map((video) =>
    Object.freeze({ ...video, tags: Object.freeze([...video.tags]) }),
  );
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = () => {
      throw Error("Unexpected I/O");
    };
    assert.deepEqual(searchVideos(frozen, ".watch *sort:duration*").ids, ids([1, 2, 0, 5, 3, 4]));
  } finally {
    globalThis.fetch = originalFetch;
  }
  console.log(
    "PASS: typed bookmark sorts, publication instants/precision, stable ties/missing values, refined ordering/counts, detached snapshots, controlled shuffle and local-only evaluation",
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
