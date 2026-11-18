const assert = require("node:assert/strict");

async function main() {
  const { classifyPopupSearch, createAlapSearchView } =
    await import("../src/shared/alap-search-view.mjs");
  const A = "aaaaaaaaaaa",
    B = "bbbbbbbbbbb",
    C = "ccccccccccc";
  const macros = {
    business: { linkItems: ".work *sort:duration* *limit:1*" },
    sample: { linkItems: ".work *shuffle* *limit:2*" },
  };
  for (const text of [
    "Mr. Smith",
    "name@example.com",
    "@Business",
    "@café-lab",
    "@doc.example",
    ".NET",
    "...",
  ]) {
    assert.deepEqual(classifyPopupSearch(text, macros), { kind: "text", text });
  }
  for (const text of [
    "@business",
    ".work",
    "(.work | .other)",
    "(@missing)",
    "@business-.other",
  ]) {
    assert.equal(classifyPopupSearch(text, macros).kind, "alap", text);
  }
  for (const text of [".", "@"]) {
    assert.deepEqual(classifyPopupSearch(text, macros), { kind: "text", text: "" });
  }
  assert.deepEqual(classifyPopupSearch('"@business"', macros), { kind: "text", text: "@business" });
  assert.deepEqual(classifyPopupSearch('".NET guide"', macros), {
    kind: "text",
    text: ".NET guide",
  });

  let draws = 0;
  const view = createAlapSearchView({
    classify: classifyPopupSearch,
    random: () => {
      draws++;
      return 0;
    },
  });
  const inputs = {
    videos: [
      {
        id: A,
        title: "Office",
        tags: ["work"],
        duration: 300,
        channelUrl: "https://www.youtube.com/@Business",
      },
      { id: B, title: "Short", tags: ["work"], duration: 100 },
      { id: C, title: ".NET guide", tags: ["work", "other"], duration: 200 },
    ],
    macros,
    scope: false,
  };
  const read = (query, options) => view.read(inputs, query, options);
  assert.deepEqual(read("work").ids, [A, B, C]);
  assert.equal(read(".").error, null);
  assert.deepEqual(read(".").ids, [A, B, C]);
  assert.deepEqual(read("@business").ids, [B]);
  assert.deepEqual(read('"@business"').ids, [A]);
  inputs.includeChannelNames = false;
  assert.deepEqual(read('"@business"').ids, []);
  assert.deepEqual(read("@Business").ids, []);
  assert.deepEqual(read("(.work + .other)").ids, [C]);
  assert.deepEqual(read('".NET guide"').ids, [C]);
  assert.ok(read("(@missing)").error);
  assert.equal(read(".missing").error, null);

  const sampled = read("@sample");
  assert.deepEqual(sampled.ids, [B, C]);
  assert.equal(sampled.rootInputCount, 3);
  assert.equal(draws, 2);
  inputs.videos = [{ ...inputs.videos[1], updated: 9 }, inputs.videos[2], inputs.videos[0]];
  assert.deepEqual(read("@sample").ids, [B, C]);
  assert.equal(read("@sample").stale, true);
  assert.equal(read("@sample").rootInputCount, null);
  assert.equal(draws, 2);

  // The journal can report a purge followed by a re-add in one snapshot.
  inputs.retired = { [B]: "retired-generation" };
  assert.deepEqual(read("@sample").ids, [C]);
  assert.equal(draws, 2);
  assert.deepEqual(read("@sample", { refresh: true }).ids, [C, A]);
  assert.equal(draws, 4);
  inputs.scope = true;
  assert.equal(read("@sample").rootInputCount, 3);
  assert.equal(draws, 6);
  delete macros.sample;
  assert.match(read("@sample").error, /Saved search unavailable/);
  assert.ok(
    read("@sample", { refresh: true }).error,
    "A removed macro does not silently become text",
  );
  assert.equal(read('"@sample"').error, null);

  inputs.macroError = "Saved macros could not be read.";
  assert.deepEqual(read(".other").ids, [C]);
  assert.match(read("(@missing)").error, /could not be read/);
  console.log(
    "PASS: popup search dispatch, saved-name collisions, refined snapshots, counts, refresh and invalidation",
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
