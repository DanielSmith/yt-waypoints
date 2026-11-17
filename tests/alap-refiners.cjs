const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
async function main() {
  const { TagExpressionParser } = await import("../src/vendor/alap-tags-core/index.mjs");
  const { applyRefiners } = await import("../src/vendor/alap-tags-core/refiners.mjs");
  const { parseRefinerStep, tokenize } = await import("../src/vendor/alap-tags-core/syntax.mjs");
  const {
    normalizeMacros,
    normalizeMacroLibrary,
    inspectMacroExpression,
    renameMacro,
    removeMacro,
    ALAP_LIMITS,
  } = await import("../src/shared/alap-data.mjs");
  const { prepareAlapQuery } = await import("../src/shared/alap-query-expression.mjs");
  const { ALAP_SORT_FIELDS } = await import("../src/shared/alap-refiner-profile.mjs");
  const { classifySearchInput } = await import("../src/shared/alap-search-input.mjs");
  const catalog = {
    a: { tags: ["anime", "watchlist"] },
    b: { tags: ["documentary", "watchlist"] },
    c: { tags: ["anime", "documentary"] },
  };
  const parser = new TagExpressionParser(catalog, { fields: ALAP_SORT_FIELDS });
  const query = (expression, macros = {}) =>
    parser.query(prepareAlapQuery(expression, macros).expandedExpression);
  assert.deepEqual(query(".watchlist *reverse* *limit:1*"), ["b"]);
  assert.deepEqual(query(".watchlist *limit:1* *reverse*"), ["a"]);
  assert.deepEqual(query(".watchlist *skip:1*"), ["b"]);
  assert.deepEqual(query(".watchlist *skip:0* *limit:0002*"), ["a", "b"]);
  assert.deepEqual(query(".watchlist *skip:1000000*"), []);
  assert.deepEqual(query(".watchlist *limit:0*"), []);
  assert.deepEqual(query("(.anime *limit:1*) | (.documentary *limit:1*)"), ["a", "b"]);
  assert.deepEqual(query("(.documentary *reverse*) | .anime"), ["c", "b", "a"]);
  assert.deepEqual(query("(.anime | .documentary) *limit:1*"), ["a"]);
  assert.deepEqual(query("(.anime *reverse*) + .documentary"), ["c"]);
  assert.deepEqual(query("(.anime *reverse*) - .documentary"), ["a"]);
  const macros = {
    take: { linkItems: "*limit:1*" },
    alias: { linkItems: "@take" },
    view: { linkItems: ".watchlist @alias" },
    reverse: { linkItems: "*reverse*" },
    combined: { linkItems: "@reverse @alias" },
  };
  assert.deepEqual(query("@view", macros), ["a"]);
  assert.deepEqual(query(".watchlist @combined", macros), ["b"]);
  assert.deepEqual(
    query(".anime + @places", { places: { linkItems: ".documentary | .watchlist" } }),
    ["c", "a", "b"],
    "textual substitution remains textual",
  );
  assert.throws(() => prepareAlapQuery("@take", macros), /Choose a tag or view/);
  assert.equal(inspectMacroExpression("*reverse*").kind, "modifier");
  assert.equal(inspectMacroExpression(".anime *limit:2*").kind, "view");
  assert.equal(normalizeMacroLibrary({ version: 1, macros }).version, 1);
  const renamed = renameMacro({ version: 1, macros }, "take", "first");
  assert.equal(renamed.macros.alias.linkItems, "@first");
  assert.equal(macros.alias.linkItems, "@take");
  assert.throws(() => removeMacro({ version: 1, macros }, "take"), /depends/);
  assert.throws(
    () => normalizeMacros({ a: { linkItems: "@b" }, b: { linkItems: "*reverse* @a" } }),
    /circular/,
  );
  assert.throws(() => normalizeMacros({ a: { linkItems: "*reverse* @missing" } }), /unknown/);
  for (const bad of [
    "*limit:1* + .anime",
    ".anime + *limit:1*",
    "*reverse* .anime",
    ".anime *reverse* | .documentary",
    "(.anime @take",
    ".anime @take +",
  ]) {
    assert.throws(() => prepareAlapQuery(bad, macros), bad);
    assert.throws(() => normalizeMacros({ ...macros, invalid: { linkItems: bad } }), bad);
  }
  const invalid = [
    "sort:",
    "sort:url",
    "sort:constructor",
    "sort:label:extra",
    "unique:url",
    "settings:theme:dark",
    "unknown",
    "reverse:1",
    "shuffle:1",
    "limit",
    "limit:",
    "limit:-1",
    "limit:+1",
    "limit:1.5",
    "limit:1e2",
    "limit:2abc",
    "limit:1000001",
    "skip:NaN",
    "skip:1:2",
    "sort:__proto__",
    " sort",
    "limit: 2",
  ];
  for (const step of invalid) {
    assert.throws(() => prepareAlapQuery(`.missing *${step}*`), step);
    assert.throws(() => parser.query(`.missing *${step}*`), step);
  }
  for (const field of ALAP_SORT_FIELDS) assert.doesNotThrow(() => query(`.anime *sort:${field}*`));
  for (const bad of [
    ".anime *limit:2",
    ".anime *limit:2**",
    ".anime *shuffle* :web:source:",
    "@view",
    ".anime,.documentary",
    ".anime /regex/",
  ])
    assert.throws(() => parser.query(bad), bad);
  assert.equal(tokenize(".anime *reverse*").length, 2);
  const stages = " *reverse*".repeat(ALAP_LIMITS.refiners);
  assert.doesNotThrow(() => query(`.anime${stages}`));
  assert.throws(() => query(`.anime${stages} *reverse*`), /too many refiners/);
  assert.throws(
    () => query(`(.anime${" *reverse*".repeat(16)}) | (.documentary${" *reverse*".repeat(17)})`),
    /too many refiners/,
  );
  const sixteen = { r: { linkItems: "*reverse* ".repeat(16) } };
  assert.doesNotThrow(() => query(".anime @r @r", sixteen));
  assert.throws(() => query(".anime @r @r *reverse*", sixteen), /too many refiners/);
  const chain = (count) =>
    Object.fromEntries(
      Array.from({ length: count }, (_, i) => [
        `m${i}`,
        { linkItems: i === count - 1 ? "*reverse*" : `@m${i + 1}` },
      ]),
    );
  assert.doesNotThrow(() => query(".anime @m0", chain(10)));
  assert.throws(() => query(".anime @m0", chain(11)), /nesting/);
  const items = [
    { id: "a", label: "B" },
    { id: "b", label: "A" },
    { id: "c", label: "A" },
  ];
  const before = JSON.stringify(items);
  const run = (names, options) =>
    applyRefiners(
      items,
      names.map((name) => parseRefinerStep(name)),
      options,
    ).map((item) => item.id);
  assert.deepEqual(run(["sort"]), ["b", "c", "a"], "stable string sorting inherited from upstream");
  assert.deepEqual(run(["sort", "reverse", "limit:2"]), ["a", "c"]);
  assert.deepEqual(run(["shuffle"], { random: () => 0 }), ["b", "c", "a"]);
  assert.equal(JSON.stringify(items), before);
  let randomCalls = 0;
  assert.throws(() =>
    applyRefiners(
      items,
      [
        { name: "shuffle", args: [] },
        { name: "limit", args: ["bad"] },
      ],
      {
        random: () => {
          randomCalls++;
          return 0;
        },
      },
    ),
  );
  assert.equal(randomCalls, 0, "validate all stages before running any");
  const originalRandom = Math.random;
  try {
    Math.random = () => {
      randomCalls++;
      return 0;
    };
    assert.throws(() => parser.query(".anime *shuffle* | .documentary"));
    assert.equal(randomCalls, 0, "validate the whole query before evaluation");
  } finally {
    Math.random = originalRandom;
  }
  for (const value of [-0.1, 1, NaN, Infinity])
    assert.throws(() => run(["shuffle"], { random: () => value }), /shuffle source/);
  assert.equal(classifySearchInput("a * b").kind, "text");
  assert.equal(classifySearchInput("*reverse*").kind, "text");
  const fixture = JSON.parse(
    fs.readFileSync(path.join(__dirname, "fixtures/alap/refiners-upstream.json"), "utf8"),
  );
  const parity = new TagExpressionParser(fixture.catalog);
  for (const test of fixture.cases)
    assert.deepEqual(parity.query(test.expression), test.ids, test.expression);
  assert.deepEqual(parser.query(".anime"), ["a", "c"], "errors do not poison subsequent queries");
  console.log(
    `PASS: strict refiner grammar, five pipelines, grouped ordering, modifier macros, bounds, no side effects on invalid queries and ${fixture.cases.length} pinned-upstream parity cases`,
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
