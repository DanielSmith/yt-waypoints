const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
async function main() {
  const { searchVideos } = await import("../src/shared/alap-query.mjs");
  const { classifySearchInput } = await import("../src/shared/alap-search-input.mjs");
  const { prepareAlapQuery } = await import("../src/shared/alap-query-expression.mjs");
  const { createVideoCatalog } = await import("../src/shared/alap-video-catalog.mjs");
  const { TagExpressionParser, TAG_PARSER_LIMITS } =
    await import("../src/vendor/alap-tags-core/index.mjs");
  const { ALAP_LIMITS } = await import("../src/shared/alap-data.mjs");
  const { checkAlapBoundary, ALAP_QUERY_SOURCES } =
    await import("../scripts/check-alap-boundary.mjs");
  const videos = [
    {
      id: "dQw4w9WgXcQ",
      title: "NYC politics",
      tags: ["politics", "nyc"],
      channelName: "Civic talks",
      channelUrl: "https://www.youtube.com/@Civic",
    },
    { id: "aqz-KE-bpKQ", title: "SF interview", tags: ["sf", "interview"] },
    { id: "jNQXAC9IVRw", title: "Mr. Smith in New York", tags: ["nyc", "interview", "finished"] },
    { id: "abcdefghijk", title: "Legacy bookmark" },
  ];
  const macros = {
    cities: { linkItems: "(.sf | .nyc)" },
    politics: { linkItems: ".politics + (.sf | .nyc) - .finished" },
  };
  const ids = (text) => searchVideos(videos, text, { macros }).ids;
  const original = JSON.stringify(videos);
  assert.deepEqual(ids(".politics + .nyc"), [videos[0].id]);
  assert.deepEqual(
    ids("@cities"),
    videos.slice(0, 3).map((v) => v.id),
  );
  assert.deepEqual(ids("@politics"), [videos[0].id]);
  assert.deepEqual(
    ids(".politics | .sf + .interview"),
    [videos[1].id],
    "left-to-right, not AND precedence",
  );
  assert.deepEqual(ids(".politics | (.sf + .interview)"), [videos[0].id, videos[1].id]);
  assert.deepEqual(ids("@cities - .finished"), [videos[0].id, videos[1].id]);
  assert.deepEqual(
    ids(".nyc | .politics"),
    [videos[0].id, videos[2].id],
    "deduplication preserves caller order",
  );
  assert.deepEqual(
    ids(""),
    videos.map((v) => v.id),
  );
  assert.deepEqual(ids("mr. smith"), [videos[2].id]);
  assert.deepEqual(ids("interview"), [videos[1].id, videos[2].id]);
  assert.deepEqual(ids("civic"), [videos[0].id]);
  assert.deepEqual(searchVideos(videos, "civic", { includeChannelNames: false }).ids, []);
  for (const text of ["Mr. Smith", "name@example.com", "https://example.com"])
    assert.equal(classifySearchInput(text).kind, "text");
  for (const text of [".", "@", "(.nyc | .sf)", "@cities"])
    assert.equal(classifySearchInput(text).kind, "alap");
  const hostile = [
    ":web:https://example.com:",
    ":json:source:",
    ":time:7d:",
    "/pattern/",
    ".nyc *limit:1abc*",
    "#element",
    "item_id",
    ".nyc,.sf",
    ".nyc +",
    ".nyc ? .sf",
    ".nyc\u0000",
  ];
  let networkCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => {
    networkCalls++;
    throw new Error("Unexpected network access");
  };
  try {
    for (const expression of hostile) assert.throws(() => prepareAlapQuery(expression, macros));
    assert.throws(() => prepareAlapQuery("@missing", macros), /unknown/i);
    for (const expression of hostile)
      assert.throws(() =>
        prepareAlapQuery("@unsafe", { ...macros, unsafe: { linkItems: expression } }),
      );
    assert.throws(() =>
      prepareAlapQuery("@unsafe", {
        unsafe: {
          linkItems: ".nyc",
          handler: () => {
            throw new Error("executed");
          },
        },
      }),
    );
    assert.deepEqual(
      ids(":web:https://example.com:"),
      [],
      "plain text is never interpreted as a source",
    );
    assert.deepEqual(ids("@politics"), [videos[0].id]);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(networkCalls, 0);
  assert.deepEqual(
    searchVideos(videos, "@nested", {
      macros: { ...macros, nested: { linkItems: "@cities - .finished" } },
    }).ids,
    [videos[0].id, videos[1].id],
  );
  assert.throws(() =>
    prepareAlapQuery("@a", {
      a: { linkItems: "@b" },
      b: { linkItems: ":web:https://example.com:" },
    }),
  );
  const chain = (count) =>
    Object.fromEntries(
      Array.from({ length: count }, (_, i) => [
        `m${i}`,
        { linkItems: i === count - 1 ? ".nyc" : `@m${i + 1}` },
      ]),
    );
  assert.deepEqual(searchVideos(videos, "@m0", { macros: chain(10) }).ids, [
    videos[0].id,
    videos[2].id,
  ]);
  assert.throws(() => prepareAlapQuery("@m0", chain(11)), /nesting/);
  assert.equal(JSON.stringify(videos), original);
  const catalog = createVideoCatalog(videos);
  assert.equal(
    Object.keys(catalog.allLinks)[1],
    "video_1",
    "hyphenated video IDs never become syntax",
  );
  for (const record of Object.values(catalog.allLinks))
    assert.deepEqual(Object.keys(record).sort(), [
      "channel",
      "duration",
      "label",
      "posted",
      "tags",
      "title",
      "updated",
    ]);
  catalog.allLinks.video_0.tags.push("changed");
  assert.equal(videos[0].tags.includes("changed"), false);
  assert.throws(() => createVideoCatalog([videos[0], videos[0]]), /unique/);
  const parser = new TagExpressionParser({
    a: { tags: ["nyc", "politics"] },
    b: { tags: ["sf"] },
    c: { tags: ["nyc"] },
  });
  assert.deepEqual(parser.query(".nyc + .politics | .sf"), ["a", "b"]);
  for (const expression of [
    ...hostile,
    "@cities",
    "()",
    ".nyc .sf",
    ".nyc)",
    "",
    "(".repeat(33) + ".nyc" + ")".repeat(33),
  ])
    assert.throws(() => parser.query(expression), expression);
  assert.throws(
    () => new TagExpressionParser({ a: { tags: ["nyc"], url: "https://example.com" } }),
  );
  assert.throws(() => new TagExpressionParser({ protocols: { web: {} } }));
  assert.throws(() => new TagExpressionParser({ a: { tags: ["new-york"] } }));
  assert.deepEqual(parser.query(".sf"), ["b"], "errors leave parser usable");
  assert.equal(TAG_PARSER_LIMITS.tokens, ALAP_LIMITS.tokens);
  assert.equal(TAG_PARSER_LIMITS.groups, ALAP_LIMITS.groupDepth);
  const wide = { many: { linkItems: Array(500).fill(".nyc").join("|") } };
  assert.throws(() => prepareAlapQuery("@many | @many", wide), /tokens/);
  const group = { a: { linkItems: "(".repeat(20) + ".nyc" + ")".repeat(20) } };
  assert.throws(() => prepareAlapQuery("(".repeat(20) + "@a" + ")".repeat(20), group), /grouping/);
  const long = { a: { linkItems: `.nyc${" ".repeat(3000)}|.sf` } };
  assert.throws(
    () => prepareAlapQuery(Array(6).fill("@a").join("|"), long),
    /expanded expression/i,
  );
  const root = path.resolve(__dirname, "..");
  checkAlapBoundary(root);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "waypoints-alap-boundary-"));
  const copy = (relative) => {
    const dest = path.join(temp, relative);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(root, relative), dest);
  };
  for (const relative of [
    ...ALAP_QUERY_SOURCES,
    "package.json",
    "package-lock.json",
    "src/vendor/alap-tags-core/PROVENANCE.json",
    "src/vendor/alap-tags-core/README.md",
    "src/vendor/alap-tags-core/LICENSE",
  ])
    copy(relative);
  const target = path.join(temp, "src/shared/alap-query.mjs");
  fs.appendFileSync(target, '\nfetch("https://example.com");\n');
  assert.throws(() => checkAlapBoundary(temp), /capability/);
  copy("src/shared/alap-query.mjs");
  fs.appendFileSync(target, '\nimport "alap/core";\n');
  assert.throws(() => checkAlapBoundary(temp), /external dependency/);
  copy("src/shared/alap-query.mjs");
  fs.appendFileSync(path.join(temp, "src/vendor/alap-tags-core/index.mjs"), "\n// change\n");
  assert.throws(() => checkAlapBoundary(temp), /hash changed/);
  copy("src/vendor/alap-tags-core/index.mjs");
  for (const name of ["syntax.mjs", "refiners.mjs"]) {
    const relative = `src/vendor/alap-tags-core/${name}`;
    fs.appendFileSync(path.join(temp, relative), "\n// change\n");
    assert.throws(() => checkAlapBoundary(temp), /hash changed/);
    copy(relative);
  }
  console.log(
    "PASS: pruned tag core, strict local macro/query boundary, ordered Alap semantics, text dispatch, shared adapter, bounds and submission tripwires",
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
