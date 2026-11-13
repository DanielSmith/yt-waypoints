const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const path = require("node:path");
const flavor = process.argv[2] || "firefox";
const source = require("./runtime.cjs").readModule("player-results.js");
const schema = vm.runInNewContext(source + "\nWAYPOINTS_PLAYER_RESULTS", { URL });
const id = "aaaaaaaaaaa";
const other = "bbbbbbbbbbb";
const base = { id, t: 100, duration: 1000, paused: true };
const frame = { ...base, fps: 60 };
const metadata = { id, title: "Example", t: 100, duration: 1000 };
let rejected = 0;
function reject(operation, result, args = ["frame", 1, id]) {
  assert.throws(() => schema.validate(operation, result, id, args), /Invalid player response/);
  rejected++;
}
for (const operation of ["position", "seek", "seekTo", "toggle"]) {
  const clean = schema.validate(operation, base, id);
  assert.deepEqual(JSON.parse(JSON.stringify(clean)), base);
  for (const result of [
    null,
    false,
    "100",
    [],
    {},
    { ...base, id: other },
    { ...base, id: "short" },
    { ...base, t: "100" },
    { ...base, t: NaN },
    { ...base, t: Infinity },
    { ...base, t: -1 },
    { ...base, t: 1.5 },
    { ...base, t: 1001 },
    { ...base, duration: -1 },
    { ...base, duration: "1000" },
    { ...base, duration: Infinity },
    { ...base, duration: schema.MAX_SECONDS + 1 },
    { ...base, paused: "false" },
    { ...base, payload: "unexpected" },
  ])
    reject(operation, result);
}
for (const operation of ["position", "seek", "seekTo"]) reject(operation, { ...base, duration: 0 });
assert.equal(schema.validate("toggle", { ...base, duration: 0 }, id).duration, 0);
for (const fps of [24, 29.97, 30, 60, 240])
  assert.equal(schema.validate("playback", { ...frame, fps }, id, ["frame"]).fps, fps);
for (const fps of [undefined, null, "60", 0, -1, Infinity, NaN, 241])
  reject("playback", { ...frame, fps });
reject("playback", { ...frame, paused: false });
for (const rate of [0.25, 1, 1.25, 2, 4, 16])
  assert.equal(schema.validate("playback", { id, rate }, id, ["rate"]).rate, rate);
for (const rate of [undefined, null, "1.25", false, 0, -1, Infinity, NaN, 16.1])
  reject("playback", { id, rate }, ["rate"]);
reject("playback", { id: other, rate: 1.25 }, ["rate"]);
reject("playback", { id, rate: 1.25, t: 0 }, ["rate"]);
reject("playback", frame, ["unknown"]);
assert.equal(
  schema.metadata({ ...metadata, duration: 0 }, id).t,
  100,
  "unknown metadata duration remains supported",
);
assert.equal(schema.metadata({ ...metadata, title: "" }, id).title, id);
assert.equal(schema.metadata({ ...metadata, title: "Hello\nworld" }, id).title, "Hello world");
assert.equal(
  schema.metadata({ ...metadata, title: "<img src=x>" }, id).title,
  "<img src=x>",
  "text remains inert text",
);
assert.equal(
  schema.metadata(
    {
      ...metadata,
      channelName: "  Channel  ",
      channelUrl: "https://m.youtube.com/@Channel?tracking=drop",
    },
    id,
  ).channelUrl,
  "https://www.youtube.com/@Channel",
);
for (const result of [
  { ...metadata, id: other },
  { ...metadata, title: "x".repeat(1001) },
  { ...metadata, channelName: "x".repeat(201) },
  { ...metadata, title: {} },
  { ...metadata, channelUrl: "https://evil.example/@Channel" },
  { ...metadata, channelUrl: "http://youtube.com/@Channel" },
  { ...metadata, channelUrl: "https://user@youtube.com/@Channel" },
  { ...metadata, channelUrl: "https://youtube.com:444/@Channel" },
  { ...metadata, channelUrl: "https://youtube.com/@Channel%2Fother" },
  { ...metadata, channelUrl: "https://youtube.com/@Channel%0Aother" },
  {
    ...metadata,
    channelUrl: "https://youtube.com/@" + "x".repeat(2048 - "https://youtube.com/@".length),
  },
  { ...metadata, updated: 123 },
  { ...metadata, channelUrl: "x".repeat(2049) },
])
  reject("bookmark", result);
const transcript = {
  id,
  duration: 1000,
  complete: true,
  source: "youtube-transcript-response",
  language: "English",
  segments: [
    { start: 0, end: 5, text: "First" },
    { start: 90.5, end: 95, text: "Second" },
  ],
};
reject("transcript", { ...transcript, complete: false });
reject("transcript", { ...transcript, complete: undefined });
reject("transcript", { ...transcript, source: "mounted-rows" });
reject("transcript", { ...transcript, language: "" });
assert.equal(schema.validate("transcript", transcript, id).segments.length, 2);
assert.equal(schema.validate("transcript", { ...transcript, duration: null }, id).duration, null);
const modernTranscript = {
  ...transcript,
  source: "youtube-panel-response",
  language: "YouTube panel (language not supplied)",
  segments: transcript.segments.map((segment) => ({ ...segment, end: null })),
};
assert.equal(schema.validate("transcript", modernTranscript, id).segments.at(-1).end, null);
reject("transcript", {
  ...transcript,
  segments: [{ start: 0, end: null, text: "Legacy requires cue ends" }],
});
reject("transcript", {
  ...modernTranscript,
  segments: [{ start: 0, end: 5, text: "Do not invent modern cue ends" }],
});
reject("transcript", {
  ...modernTranscript,
  segments: [{ start: 0, text: "Explicit null end required" }],
});
reject("transcript", { ...modernTranscript, complete: false });
for (const result of [
  { ...transcript, id: other },
  { ...transcript, duration: Infinity },
  { ...transcript, segments: [] },
  { ...transcript, segments: new Array(50001).fill({ start: 0, text: "x" }) },
  { ...transcript, segments: [{ start: 1000, text: "Late" }] },
  { ...transcript, segments: [{ start: "1", end: 2, text: "Wrong type" }] },
  { ...transcript, segments: [{ start: 1, end: 2, text: "x".repeat(10001) }] },
  {
    ...transcript,
    segments: [
      { start: 90, text: "Later" },
      { start: 0, text: "Earlier" },
    ],
  },
  {
    ...transcript,
    segments: new Array(201)
      .fill(null)
      .map((_, index) => ({ start: index, end: index + 1, text: "x".repeat(10000) })),
  },
  {
    ...transcript,
    segments: new Array(201)
      .fill(null)
      .map((_, index) => ({ start: index, end: index + 1, text: "x" + " ".repeat(9999) })),
  },
  {
    ...transcript,
    segments: Object.assign([{ start: 0, text: "First" }], { extra: "unexpected" }),
  },
  { ...transcript, segments: new Array(1) },
])
  reject("transcript", result);
assert.equal(
  schema.validate("playback", { error: "Wait for the ad." }, id).error,
  "Wait for the ad.",
);
for (const result of [
  { error: {} },
  { error: "x".repeat(501) },
  { error: "" },
  { error: "Oops", ...frame },
])
  reject("playback", result);
let getterCalls = 0;
reject("playback", {
  ...frame,
  get t() {
    getterCalls++;
    return 100;
  },
});
reject("bookmark", Object.assign(Object.create(metadata), {}));
assert.equal(getterCalls, 0, "never evaluate a page-result getter");
assert.equal(frame.t, 100, "validation never mutates input");
console.log(
  `PASS: ${flavor} player-result schemas, metadata/URL limits, transcript bounds, identity, own fields, and ${rejected} rejected malformed cases`,
);
