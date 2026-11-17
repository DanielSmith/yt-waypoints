const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
async function main() {
  const data = await import("../src/shared/alap-data.mjs");
  const {
    ALAP_LIMITS: limits,
    suggestTagSlug,
    normalizeVideoTags,
    readVideoTags,
    resolveImportedTags,
    inspectAlapExpression,
    normalizeMacros,
    normalizeMacroLibrary,
    renameMacro,
    removeMacro,
  } = data;
  const fixture = (name) =>
    JSON.parse(fs.readFileSync(path.join(__dirname, `fixtures/alap/${name}.json`), "utf8"));
  const valid = fixture("valid"),
    invalid = fixture("invalid");
  const original = JSON.stringify(valid);
  assert.deepEqual(normalizeVideoTags(valid.tags), valid.tags);
  assert.deepEqual(normalizeMacroLibrary(valid.library), valid.library);
  assert.deepEqual(
    normalizeMacroLibrary(JSON.parse(JSON.stringify(normalizeMacroLibrary(valid.library)))),
    valid.library,
  );
  assert.equal(suggestTagSlug("US-politics / New York"), "us_politics_new_york");
  assert.equal(suggestTagSlug("  Café __ Society  "), "cafe_society");
  for (const input of ["東京", "---", "", "a\u0000b", "x".repeat(257)])
    assert.throws(() => suggestTagSlug(input));
  for (const value of invalid.tags) assert.throws(() => normalizeVideoTags(value));
  for (const value of invalid.macros) assert.throws(() => normalizeMacros(value));
  assert.deepEqual(readVideoTags({ title: "old bookmark" }), []);
  assert.deepEqual(resolveImportedTags({ tags: ["nyc"] }, {}), ["nyc"]);
  assert.deepEqual(resolveImportedTags({ tags: ["nyc"] }, { tags: [] }), []);
  assert.deepEqual(resolveImportedTags({ tags: ["nyc"] }, { tags: ["sf"] }), ["sf"]);
  assert.deepEqual(resolveImportedTags({}, {}), []);
  for (const value of [undefined, null, "nyc", {}, ["NYC"]])
    assert.throws(() => resolveImportedTags({}, { tags: value }));
  const source = { tags: ["sf", "nyc"] };
  const read = readVideoTags(source);
  read.push("politics");
  assert.deepEqual(source.tags, ["sf", "nyc"]);
  const renamed = renameMacro(valid.library, "cities", "places");
  assert.equal(renamed.macros.city_politics.linkItems, ".politics + @places - .finished");
  assert.ok(!Object.hasOwn(renamed.macros, "cities"));
  assert.throws(() => renameMacro(valid.library, "cities", "city_politics"), /already exists/);
  assert.throws(() => removeMacro(valid.library, "cities"), /depends/);
  assert.deepEqual(Object.keys(removeMacro(valid.library, "city_politics").macros), ["cities"]);
  assert.equal(JSON.stringify(valid), original, "operations never mutate input");
  assert.equal(
    renameMacro(
      {
        version: 1,
        macros: {
          a: { linkItems: ".nyc" },
          ab: { linkItems: "@a" },
          both: { linkItems: "@a | @ab" },
        },
      },
      "a",
      "x",
    ).macros.both.linkItems,
    "@x | @ab",
  );
  for (const value of [null, [], 1, new Date()]) assert.throws(() => normalizeMacros(value));
  for (const value of [
    { version: 2, macros: {} },
    { version: 1, macros: {}, extra: true },
  ])
    assert.throws(() => normalizeMacroLibrary(value));
  const getter = {};
  Object.defineProperty(getter, "tags", {
    enumerable: true,
    get() {
      throw Error("getter executed");
    },
  });
  assert.throws(() => readVideoTags(getter), /tags data field/);
  const macroGetter = {};
  Object.defineProperty(macroGetter, "a", {
    enumerable: true,
    get() {
      throw Error("getter executed");
    },
  });
  assert.throws(() => normalizeMacros(macroGetter), /macro data fields/);
  const tags = ["nyc"];
  Object.defineProperty(tags, 0, {
    enumerable: true,
    get() {
      throw Error("getter executed");
    },
  });
  assert.throws(() => normalizeVideoTags(tags), /data elements/);
  assert.throws(() => normalizeVideoTags(Array(1)), /sparse/);
  assert.throws(() => normalizeMacros(JSON.parse('{"__proto__":{"linkItems":".nyc"}}')));
  assert.deepEqual(
    normalizeMacros(
      JSON.parse('{"constructor":{"linkItems":".nyc"},"prototype":{"linkItems":".politics"}}'),
    ),
    { constructor: { linkItems: ".nyc" }, prototype: { linkItems: ".politics" } },
  );
  assert.equal({}.polluted, undefined);
  const symbol = {};
  symbol[Symbol("macro")] = { linkItems: ".nyc" };
  assert.throws(() => normalizeMacros(symbol));
  for (const expression of [
    "",
    "@",
    ".",
    "nyc",
    ".a .b",
    "()",
    "(.a",
    ".a)",
    ".a, .b",
    '"@channel"',
    ".a *unique:url*",
    ".a + + .b",
    ".a + .b\u0000",
  ])
    assert.throws(() => inspectAlapExpression(expression));
  assert.deepEqual(inspectAlapExpression(" .politics + (@cities | .sf) ").references, ["cities"]);
  assert.equal(
    inspectAlapExpression(".nyc | .sf + .politics").expression,
    ".nyc | .sf + .politics",
    "syntax is preserved, not re-evaluated",
  );
  assert.equal(
    inspectAlapExpression("(".repeat(32) + ".nyc" + ")".repeat(32)).references.length,
    0,
  );
  assert.throws(() => inspectAlapExpression("(".repeat(33) + ".nyc" + ")".repeat(33)), /grouping/);
  assert.equal(normalizeVideoTags(Array.from({ length: 100 }, (_, i) => `tag_${i}`)).length, 100);
  assert.throws(() => normalizeVideoTags(Array.from({ length: 101 }, (_, i) => `tag_${i}`)));
  assert.equal(normalizeVideoTags(["a".repeat(64)])[0].length, 64);
  assert.throws(() => normalizeVideoTags(["a".repeat(65)]));
  assert.equal(
    normalizeMacros({ a: { linkItems: ".nyc" }, b: { linkItems: "@a" } }).b.linkItems,
    "@a",
  );
  assert.throws(() => normalizeMacros({ a: { linkItems: "@a" } }), /circular/);
  assert.throws(() => normalizeMacros({ a: { linkItems: "@missing" } }), /unknown/);
  assert.throws(
    () => normalizeMacros({ a: { linkItems: "@b" }, b: { linkItems: "@a" } }),
    /circular/,
  );
  const chain = (count) =>
    Object.fromEntries(
      Array.from({ length: count }, (_, i) => [
        `m${i}`,
        { linkItems: i === count - 1 ? ".nyc" : `@m${i + 1}` },
      ]),
    );
  assert.equal(Object.keys(normalizeMacros(chain(10))).length, 10);
  assert.throws(() => normalizeMacros(chain(11)), /nesting/);
  assert.throws(
    () => normalizeMacros(Object.fromEntries(Object.entries(chain(11)).reverse())),
    /nesting/,
  );
  const repeated = {
    a: { linkItems: Array(500).fill(".x").join("|") },
    b: { linkItems: "@a | @a" },
  };
  assert.throws(() => normalizeMacros(repeated), /tokens/);
  const grouping = {
    a: { linkItems: "(".repeat(20) + ".nyc" + ")".repeat(20) },
    b: { linkItems: "(".repeat(20) + "@a" + ")".repeat(20) },
  };
  assert.throws(() => normalizeMacros(grouping), /grouping/);
  assert.throws(
    () =>
      normalizeMacros(
        Object.fromEntries(Array.from({ length: 101 }, (_, i) => [`m${i}`, { linkItems: ".nyc" }])),
      ),
    /too many/,
  );
  assert.throws(
    () =>
      normalizeMacros({
        a: { linkItems: ".nyc" },
        b: { linkItems: Array(1000).fill("@a").join(" | ") },
      }),
    /oversized/,
  );
  const huge = Object.fromEntries(
    Array.from({ length: 100 }, (_, i) => [`m${i}`, { linkItems: `.x${" ".repeat(3000)}|.y` }]),
  );
  assert.throws(() => normalizeMacros(huge), /256 KiB/);
  assert.equal(inspectAlapExpression(Array(512).fill(".x").join("|")).references.length, 0);
  assert.throws(() => inspectAlapExpression(Array(513).fill(".x").join("|")), /tokens/);
  assert.equal(limits.tokens, 1024);
  console.log(
    "PASS: Alap contract fixtures, tag import intent, normalization, bounded nested macros/rename/removal, strict syntax, bounds and hostile object rejection; no runtime dependencies",
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
