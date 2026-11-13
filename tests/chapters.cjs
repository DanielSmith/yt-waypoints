const assert = require("node:assert/strict");
const vm = require("node:vm");
const { readModule } = require("./runtime.cjs");
const flavor = process.argv[2] || "firefox";
const ID = "aaaaaaaaaaa",
  OTHER = "bbbbbbbbbbb";
const plain = (value) => JSON.parse(JSON.stringify(value));
const reader = vm.runInNewContext(readModule("chapter-reader.js") + "\nWAYPOINTS_READ_CHAPTERS");
const schema = vm.runInNewContext(readModule("player-results.js") + "\nWAYPOINTS_PLAYER_RESULTS", {
  URL,
});
const data = vm.runInNewContext(readModule("marker-data.js") + "\nWAYPOINTS_MARKERS");
const row = (t, title) => ({
  chapterRenderer: { timeRangeStartMillis: t * 1000, title: { simpleText: title } },
});
function bar(
  items = [row(0, "Introduction"), row(60, "The main idea"), row(120, "Closing thoughts")],
  id = ID,
) {
  return {
    currentVideoEndpoint: { watchEndpoint: { videoId: id } },
    playerOverlays: {
      playerOverlayRenderer: {
        decoratedPlayerBarRenderer: {
          decoratedPlayerBarRenderer: {
            playerBar: { chapteredPlayerBarRenderer: { chapters: items } },
          },
        },
      },
    },
  };
}
function panel(id = ID) {
  return {
    engagementPanels: [
      {
        engagementPanelSectionListRenderer: {
          targetId: "engagement-panel-macro-markers-description-chapters",
          content: {
            macroMarkersListRenderer: {
              contents: [0, 60, 120].map((t, index) => ({
                macroMarkersListItemRenderer: {
                  title: { runs: [{ text: "Chapter " + index }] },
                  timeDescription: { simpleText: `0${Math.floor(t / 60)}:00` },
                  onTap: { watchEndpoint: { videoId: id, startTimeSeconds: t } },
                },
              })),
            },
          },
        },
      },
    ],
  };
}
function fixture(root, options = {}) {
  const location = { search: "?v=" + (options.locationId || ID) };
  const watch = {
    getAttribute: () => options.watchId || ID,
    data: options.initial ? undefined : root,
  };
  if (options.wrapped) watch.wrappedJSObject = { data: watch.data };
  const video = { duration: options.duration === undefined ? 300 : options.duration };
  const globals = {
    URLSearchParams,
    expectedId: ID,
    location,
    document: {
      querySelector(selector) {
        if (selector === "ytd-watch-flexy:not([hidden])") return watch;
        if (selector.includes("ad-showing")) return options.ad ? {} : null;
        if (selector === "video") return video;
        return null;
      },
    },
    ...(options.initial ? { ytInitialData: root } : {}),
  };
  options.modify?.({ root, location, watch, video });
  return vm.runInNewContext(`(${reader.toString()})(expectedId)`, globals);
}
const expected = [
  { t: 0, title: "Introduction" },
  { t: 60, title: "The main idea" },
  { t: 120, title: "Closing thoughts" },
];
for (const options of [{}, { initial: true }, { wrapped: true }]) {
  const result = fixture(bar(), options);
  assert.deepEqual(plain(result.chapters), expected);
  assert.equal(result.available, true);
  assert.deepEqual(plain(schema.validate("chapters", result, ID).chapters), expected);
}
assert.equal(
  fixture(panel()).chapters.length,
  3,
  "video-bound engagement panels work without root identity",
);
const panelFallback = { ...bar([]), ...panel() };
assert.equal(
  fixture(panelFallback).chapters.length,
  3,
  "a loading bar does not block an independently validated panel",
);
const byDescription = panel();
for (const item of byDescription.engagementPanels[0].engagementPanelSectionListRenderer.content
  .macroMarkersListRenderer.contents)
  delete item.macroMarkersListItemRenderer.onTap.watchEndpoint.startTimeSeconds;
assert.equal(fixture(byDescription).chapters[2].t, 120);
const modern = panel();
modern.engagementPanels[0].engagementPanelSectionListRenderer.targetId =
  "engagement-panel-macro-markers-auto-chapters";
modern.engagementPanels[0].engagementPanelSectionListRenderer.content.macroMarkersListRenderer.contents =
  [
    {
      macroMarkersPanelItemViewModel: {
        title: { content: "Automatic chapter" },
        onTap: { innertubeCommand: { watchEndpoint: { videoId: ID, startTimeSeconds: "0" } } },
      },
    },
  ];
assert.equal(fixture(modern).chapters[0].title, "Automatic chapter");
assert.equal(fixture(bar(undefined, OTHER)).available, false, "stale global response is ignored");
const unbound = bar();
delete unbound.currentVideoEndpoint;
assert.equal(
  fixture(unbound).available,
  false,
  "unbound player bars cannot supply another video's chapters",
);
const captions = panel();
captions.engagementPanels[0].engagementPanelSectionListRenderer.targetId =
  "engagement-panel-searchable-transcript";
assert.equal(fixture(captions).available, false, "transcript rows are not chapters");
for (const options of [
  { ad: true },
  { locationId: OTHER },
  { watchId: OTHER },
  { duration: 0 },
  { duration: Infinity },
])
  assert.ok(fixture(bar(), options).error);
const wrongPanel = panel(OTHER);
assert.ok(fixture(wrongPanel).error);
const missingId = panel();
delete missingId.engagementPanels[0].engagementPanelSectionListRenderer.content
  .macroMarkersListRenderer.contents[0].macroMarkersListItemRenderer.onTap.watchEndpoint.videoId;
assert.ok(fixture(missingId).error);
for (const bad of [null, "x", -1, Infinity, NaN, 300000, 0.1]) {
  const items = [row(0, "Good"), row(60, "Bad")];
  items[1].chapterRenderer.timeRangeStartMillis = bad;
  assert.ok(fixture(bar(items)).error);
}
for (const items of [
  [row(0, "")],
  [row(0, "x".repeat(1001))],
  [row(0, "One"), row(0, "Duplicate")],
  [row(5, "Later"), row(1, "Earlier")],
  [],
  new Array(1001),
])
  assert.ok(fixture(bar(items)).error);
assert.ok(
  fixture(bar(), {
    modify({ root, location }) {
      Object.defineProperty(
        root.playerOverlays.playerOverlayRenderer.decoratedPlayerBarRenderer
          .decoratedPlayerBarRenderer.playerBar.chapteredPlayerBarRenderer.chapters[0]
          .chapterRenderer,
        "title",
        {
          get() {
            location.search = "?v=" + OTHER;
            return { simpleText: "Changed" };
          },
        },
      );
    },
  }).error,
);

const valid = fixture(bar());
for (const result of [
  { ...valid, id: OTHER },
  { ...valid, duration: 0 },
  { ...valid, available: "yes" },
  { ...valid, chapters: [{ t: 0, title: "" }] },
  { ...valid, chapters: [{ t: 300, title: "End" }] },
  { ...valid, chapters: [{ t: 0, title: "Start", url: "javascript:bad()" }] },
  {
    ...valid,
    chapters: [
      { t: 1, title: "One" },
      { t: 1, title: "Duplicate" },
    ],
  },
])
  assert.throws(() => schema.validate("chapters", result, ID));
const seeded = data.refreshChapters(
  [],
  expected.map((point) => ({ id: data.chapterId(point.t), origin: "chapter", ...point })),
);
assert.equal(data.annotation(seeded[1]), "The main idea", "title is the initial annotation");
seeded[1].note = "My edited annotation";
const updated = data.refreshChapters(seeded, [
  { id: "c:60000", origin: "chapter", t: 60, title: "Updated source title" },
]);
assert.equal(updated[1].title, "Updated source title");
assert.equal(data.annotation(updated[1]), "My edited annotation");
updated[1].note = "";
assert.equal(
  data.annotation(
    data.refreshChapters(updated, [
      { id: "c:60000", origin: "chapter", t: 60, title: "Another title" },
    ])[1],
  ),
  "",
  "explicit clearing survives refresh",
);
updated[1].removed = true;
assert.equal(
  data.annotation(
    data.refreshChapters(updated, [
      { id: "c:60000", origin: "chapter", t: 60, title: "Another title" },
    ])[1],
  ),
  "",
  "removed annotations stay deleted",
);
assert.equal(data.annotation({ id: "u:one", t: 0, origin: "user", title: "Not a chapter" }), "");
const continued = bar();
continued.playerOverlays.playerOverlayRenderer.decoratedPlayerBarRenderer.decoratedPlayerBarRenderer.playerBar.chapteredPlayerBarRenderer.continuations =
  [{}];
assert.ok(fixture(continued).error, "continued chapter model is not seeded partially");
const playerFactory = vm.runInNewContext(
  readModule("player-client.js") + "\nWAYPOINTS_CREATE_PLAYER_CLIENT",
  { URL, URLSearchParams },
);
(async () => {
  for (const legacyFallback of [true, false]) {
    const attempts = [];
    const client = playerFactory({
      api: {
        scripting: {
          async executeScript(request) {
            attempts.push(request.world);
            if (request.world === "MAIN")
              throw Error("Invalid value MAIN for world: unsupported world");
            return [{ frameId: 0, result: valid }];
          },
        },
      },
      actions: { chapters: reader },
      resultSchema: schema,
      legacyFallback,
      watchPattern: /^https:\/\/www\.youtube\.com\/watch/,
    });
    const result = await client.inPlayer(7, "chapters", [ID]);
    assert.deepEqual(attempts, legacyFallback ? ["MAIN", undefined] : ["MAIN"]);
    if (legacyFallback) assert.equal(result.chapters.length, 3);
    else assert.ok(result.error);
  }
  console.log(
    `PASS: ${flavor} serialized chapter reader, supported models, identity/navigation/ad guards, schemas, Firefox fallback and default annotation preservation`,
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
