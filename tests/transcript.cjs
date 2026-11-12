const fs = require("node:fs"),
  vm = require("node:vm"),
  assert = require("node:assert/strict"),
  path = require("node:path");
const flavor = process.argv[2] || "firefox";
const transcript = vm.runInNewContext(
  require("./runtime.cjs").readModule("transcript.js") + "\nWAYPOINTS_TRANSCRIPT",
);
const video = { id: "abcdefghijk", title: "A [title] / café", channelName: "Channel" };
const raw = {
  complete: true,
  segments: [
    { start: 0, text: "Hello *world*." },
    { start: 90, text: "A < B & C" },
    { start: 3661.5, text: "日本語" },
  ],
  duration: 3670,
};
const prepared = transcript.prepare(video, raw);
assert.equal(transcript.get().id, "markdown-linked");
assert.equal(transcript.get("bad").id, "markdown-linked");
const linked = transcript.output(prepared, "markdown-linked");
assert.ok(linked.text.startsWith("# A \\[title\\] / café"));
assert.ok(
  linked.text.includes("[1:01:01](https://www.youtube.com/watch?v=abcdefghijk&t=3661.5s) · 日本語"),
);
assert.ok(linked.text.includes("Hello \\*world\\*\\."));
assert.equal(linked.filename, "a-title-cafe-abcdefghijk.md");
assert.ok(transcript.output(prepared, "markdown").text.includes("**1:30** · A \\< B & C"));
assert.ok(transcript.output(prepared, "text-timed").text.includes("1:30 · A < B & C"));
assert.equal(transcript.output(prepared, "text").text, "Hello *world*.\nA < B & C\n日本語\n");
const srt = transcript.output(prepared, "srt");
assert.ok(srt.text.includes("1\n00:00:00,000 --> 00:01:30,000\nHello *world*."));
assert.ok(srt.text.includes("3\n01:01:01,500 --> 01:01:10,000\n日本語"));
assert.ok(!srt.text.includes("Source:"));
const vtt = transcript.output(prepared, "vtt");
assert.ok(vtt.text.startsWith("WEBVTT\n\n00:00:00.000 --> 00:01:30.000"));
assert.ok(vtt.text.includes("A &lt; B &amp; C"));
const json = JSON.parse(transcript.output(prepared, "json").text);
assert.equal(json.video.url, "https://www.youtube.com/watch?v=abcdefghijk");
assert.equal(json.segments[1].end, 3661.5);
assert.equal(json.segments[2].end, 3670);
const duplicate = transcript.prepare(video, {
  complete: true,
  segments: [
    { start: 1, text: "One" },
    { start: 1, text: "Two" },
  ],
  duration: 2,
});
assert.equal(duplicate.segments.length, 1);
assert.equal(duplicate.segments[0].text, "One Two");
const noDuration = transcript.prepare(video, { ...raw, duration: null });
assert.equal(noDuration.segments.at(-1).end, null);
for (const format of ["srt", "vtt"])
  assert.throws(() => transcript.output(noDuration, format), /known video duration/);
for (const segments of [
  [],
  [{ start: -1, text: "Bad" }],
  [{ start: NaN, text: "Bad" }],
  [{ start: 1, text: "" }],
  [
    { start: 5, text: "Later" },
    { start: 1, text: "Earlier" },
  ],
]) {
  assert.throws(() => transcript.prepare(video, { complete: true, segments, duration: 10 }));
}
assert.throws(() => transcript.prepare({ ...video, id: "../bad" }, raw));
const untrusted = transcript.prepare({ ...video, title: "<script>bad()</script>\n# forged" }, raw);
assert.ok(!transcript.output(untrusted, "markdown-linked").text.includes("<script>"));
console.log(
  "PASS:",
  flavor,
  "all seven transcript formats, metadata/Markdown escaping, Unicode, filenames, hours/fractions, derived ends, duplicate starts, invalid timing and missing-duration guards",
);

for (const complete of [false, undefined])
  assert.throws(() => transcript.prepare(video, { ...raw, complete }), /completeness/);
const precise = transcript.prepare(video, {
  complete: true,
  duration: 3600,
  segments: [
    { start: 0, end: 5, text: "First" },
    { start: 90, end: 95, text: "Last" },
  ],
});
assert.equal(precise.segments[1].end, 95);
assert.ok(transcript.output(precise, "srt").text.includes("00:01:30,000 --> 00:01:35,000"));
assert.equal(JSON.parse(transcript.output(precise, "json").text).segments[1].end, 95);
console.log(
  "PASS:",
  flavor,
  "unverified transcript rejection and supplied final cue ends without stretching to video duration",
);
const modern = transcript.prepare(video, {
  complete: true,
  source: "youtube-panel-response",
  duration: 3600,
  segments: [
    { start: 3, end: null, text: "First" },
    { start: 1419, end: null, text: "Last" },
  ],
});
assert.ok(
  modern.segments.every((segment) => segment.end === null),
  "modern paragraph starts do not establish any caption end",
);
for (const format of ["markdown-linked", "markdown", "text-timed", "text", "json"]) {
  assert.ok(transcript.output(modern, format).text.includes("Last"));
}
for (const format of ["srt", "vtt"])
  assert.throws(() => transcript.output(modern, format), /lacks cue end times/);
assert.equal(JSON.parse(transcript.output(modern, "json").text).segments.at(-1).end, null);
const modernDuplicate = transcript.prepare(video, {
  complete: true,
  source: "youtube-panel-response",
  duration: 3600,
  segments: [
    { start: 3, end: null, text: "One" },
    { start: 3, end: null, text: "Two" },
  ],
});
assert.equal(modernDuplicate.segments[0].text, "One Two");
assert.equal(modernDuplicate.segments[0].end, null);
console.log(
  "PASS:",
  flavor,
  "modern start-only exports retain all text and null ends; subtitle output fails without invented timing",
);
