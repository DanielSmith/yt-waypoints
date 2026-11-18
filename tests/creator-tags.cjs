const assert = require("node:assert/strict");
const vm = require("node:vm");

async function main() {
  const { readCreatorTags, fetchCreatorTags, creatorTagOptions } =
    await import("../src/shared/creator-tags.mjs");
  const id = "abcdefghijk",
    other = "zyxwvutsrqp";
  const url = "https://www.youtube.com/watch?v=" + id;
  const execute = (overrides = {}) => {
    const location = new URL(url);
    let watchId = id;
    const watch = { getAttribute: () => watchId };
    const player = {
      getPlayerResponse: () => ({
        videoDetails: { videoId: id, keywords: ["Field notes", "Anthropic", 3, "x".repeat(257)] },
      }),
    };
    const context = {
      URLSearchParams,
      location,
      document: { querySelector: (selector) => (selector === "#movie_player" ? player : watch) },
      ...overrides,
    };
    return JSON.parse(
      JSON.stringify(
        vm.runInNewContext(`(${readCreatorTags.toString()})(${JSON.stringify(id)})`, context),
      ),
    );
  };
  assert.deepEqual(execute(), { state: "ready", id, keywords: ["Field notes", "Anthropic"] });
  assert.deepEqual(
    execute({
      location: new URL(url.replace(id, other)),
    }),
    { state: "changing" },
  );
  const watch = { getAttribute: () => id };
  const at = (player) => ({
    querySelector: (selector) => (selector === "#movie_player" ? player : watch),
  });
  assert.deepEqual(
    execute({
      document: at({
        getPlayerResponse: () => ({ videoDetails: { videoId: other, keywords: ["wrong"] } }),
      }),
      wrappedJSObject: { ytInitialPlayerResponse: { videoDetails: { videoId: id } } },
    }),
    { state: "ready", id, keywords: [] },
  );
  assert.deepEqual(
    execute({
      document: at(null),
      ytInitialPlayerResponse: { videoDetails: { videoId: other } },
    }),
    { state: "unavailable" },
  );
  const during = new URL(url);
  assert.deepEqual(
    execute({
      location: during,
      document: at({
        getPlayerResponse: () => {
          during.searchParams.set("v", other);
          return { videoDetails: { videoId: id, keywords: ["old"] } };
        },
      }),
    }),
    { state: "changing" },
  );

  const payload = { state: "ready", id, keywords: ["a", "a", "b"] };
  const requestLog = [];
  const api = {
    tabs: {
      query: async () => [
        { id: 8, url: url.replace(id, other) },
        { id: 7, url },
      ],
      get: async () => ({ url }),
    },
    scripting: {
      executeScript: async (request) => {
        requestLog.push(request);
        if (request.world === "MAIN") throw new Error("Unsupported world MAIN");
        return [{ frameId: 0, result: payload }];
      },
    },
  };
  assert.deepEqual(await fetchCreatorTags(api, id), ["a", "b"]);
  assert.equal(requestLog.length, 2);
  assert.deepEqual(requestLog[1].target, { tabId: 7, frameIds: [0] });
  assert.equal(requestLog[1].world, undefined);
  const reject = (change, error) =>
    assert.rejects(fetchCreatorTags({ ...api, ...change }, id), error);
  await reject(
    {
      tabs: {
        query: async () => [{ id: 7, url: "https://www.youtube.com.example/watch?v=" + id }],
      },
    },
    /Open this video/,
  );
  await reject(
    { tabs: { ...api.tabs, get: async () => ({ url: url.replace(id, other) }) } },
    /changed videos/,
  );
  for (const result of [
    { ...payload, id: other },
    { ...payload, keywords: Array(101).fill("x") },
    { ...payload, keywords: ["x".repeat(257)] },
    { ...payload, keywords: [null] },
  ])
    await reject(
      { scripting: { executeScript: async () => [{ frameId: 0, result }] } },
      /invalid creator/,
    );
  await reject(
    { scripting: { executeScript: async () => [{ frameId: 3, result: payload }] } },
    /valid response/,
  );

  const choices = creatorTagOptions(
    ["Field notes", "field-notes", "Personal", "Anthropic", "🍉"],
    ["personal"],
    new Set(["anthropic"]),
  );
  assert.deepEqual(
    choices.filter((x) => !x.reason).map((x) => x.tag),
    ["field_notes"],
  );
  assert.match(choices[3].reason, /Removed/);
  assert.match(choices[4].reason, /make a tag/);
  console.log(
    "PASS: serialized creator-tag reader, video identity, bounds, Firefox fallback, and safe draft options",
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
