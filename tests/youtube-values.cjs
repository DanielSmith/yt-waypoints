const assert = require("node:assert/strict");
const vm = require("node:vm");
const { readModule } = require("./runtime.cjs");
const context = vm.createContext({ URL, URLSearchParams });
for (const name of ["player-results.js", "transfer.js", "transcript.js", "player-client.js"])
  vm.runInContext(readModule(name), context);
const values = context.WAYPOINTS_YOUTUBE_VALUES;
for (const [url, expected] of [
  ["https://www.youtube.com/@Business", "@Business"],
  ["https://www.youtube.com/@Business/?ignored=tracking#fragment", "@Business"],
  ["https://www.youtube.com/channel/UCExample", "UCExample"],
  ["https://www.youtube.com/user/Example/", "Example"],
  ["https://www.youtube.com/@Caf%C3%A9", "@Café"],
  [undefined, ""],
  [null, ""],
  ["", ""],
  ["invalid", ""],
  ["https://www.youtube.com/", ""],
  ["https://example.com/@Other", ""],
  ["https://www.youtube.com/@bad%", ""],
])
  assert.equal(values.channelUrlSegment(url), expected);
const schema = context.WAYPOINTS_PLAYER_RESULTS;
const transfer = context.WAYPOINTS_TRANSFER;
const formats = context.WAYPOINTS_TRANSCRIPT;
const id = "aaaaaaaaaaa";
const metadata = (extra = {}) => ({ id, t: 2, duration: 100, title: "Fixture", ...extra });
const record = (extra = {}) => ({ ...metadata(), updated: 1, ...extra });
const imported = (video) => transfer.merge({}, { [id]: video }).videos[id];
assert.ok(Object.isFrozen(values) && Object.isFrozen(values.CHANNEL_URL_ISSUE));

for (const candidate of [id, "AbC_09-xYz1", "___________", "-----------", "12345678901"]) {
  assert.equal(values.isVideoId(candidate), true);
  assert.equal(schema.isId(candidate), true);
}
let coercions = 0;
const coercible = {
  toString() {
    coercions++;
    return id;
  },
  valueOf() {
    coercions++;
    return 12345678901;
  },
};
for (const candidate of [
  undefined,
  null,
  false,
  12345678901,
  {},
  [],
  [id],
  new String(id),
  coercible,
  "",
  "aaaaaaaaaa",
  "aaaaaaaaaaaa",
  "aaaaaaaaaa!",
  "éaaaaaaaaaa",
  id + "\n",
  " " + id,
]) {
  assert.equal(values.isVideoId(candidate), false);
  assert.equal(schema.isId(candidate), false);
}
assert.equal(coercions, 0, "ID validation must not coerce arbitrary objects");
const raw = { complete: true, duration: 10, segments: [{ start: 0, end: 2, text: "Speech" }] };
for (const candidate of [12345678901, coercible, new String(id), [id]])
  assert.throws(
    () => formats.prepare({ id: candidate }, raw),
    /Could not read the timed transcript/,
  );
assert.equal(coercions, 0, "Transcript IDs must not invoke object conversion");
assert.equal(formats.prepare({ id }, raw).video.id, id);
console.log(
  "PASS: shared video-ID validation requires an eleven-character string without coercion",
);

const fullPrefix = "https://www.youtube.com/@";
const barePrefix = "https://youtube.com/@";
const accepted = [
  ["https://youtube.com/@Alice", fullPrefix + "Alice"],
  ["https://m.youtube.com/@Alice/?tracking=drop#bio", fullPrefix + "Alice"],
  ["HTTPS://YOUTUBE.COM/@Alice", fullPrefix + "Alice"],
  ["https://www.youtube.com:443/@Alice", fullPrefix + "Alice"],
  ["https://youtube.com/channel/UC_fixture/", "https://www.youtube.com/channel/UC_fixture"],
  ["https://m.youtube.com/c/Creator?utm=x", "https://www.youtube.com/c/Creator"],
  ["https://youtube.com/user/Creator#about", "https://www.youtube.com/user/Creator"],
  ["https://youtube.com/%40Alice", "https://www.youtube.com/%40Alice"],
  ["https://youtube.com/@caf%C3%A9", "https://www.youtube.com/@caf%C3%A9"],
  ["https://youtube.com/@café", "https://www.youtube.com/@caf%C3%A9"],
  ["https://youtube.com/@Alice%2f", "https://www.youtube.com/@Alice%2f"],
  ["https://youtube.com/@Alice?ignored=%00", fullPrefix + "Alice"],
  [
    fullPrefix + "x".repeat(2048 - fullPrefix.length),
    fullPrefix + "x".repeat(2048 - fullPrefix.length),
  ],
  [
    barePrefix + "x".repeat(2048 - fullPrefix.length),
    fullPrefix + "x".repeat(2048 - fullPrefix.length),
  ],
];
for (const [input, expected] of accepted) {
  const result = values.normalizeChannelUrl(input);
  assert.equal(result.issue, null, input);
  assert.equal(result.url, expected, input);
  assert.equal(schema.metadata(metadata({ channelUrl: input }), id).channelUrl, expected);
  assert.equal(imported(record({ channelUrl: input })).channelUrl, expected);
}
console.log(
  "PASS: channel normalization agrees across helper, page-result boundary and transfer, including encoding and length limits",
);

const malformed = [
  undefined,
  null,
  false,
  42,
  {},
  [],
  new String(fullPrefix + "Alice"),
  "",
  "/@Alice",
  "not a url",
  " https://youtube.com/@Alice",
  fullPrefix + "Alice\n",
  fullPrefix + "Alice\u007f",
  fullPrefix + "%",
  fullPrefix + "%E0%A4%A",
  fullPrefix + "x".repeat(2049),
  barePrefix + "x".repeat(2049 - fullPrefix.length),
  fullPrefix + "é".repeat(350),
  "https://youtube.com:65536/@Alice",
];
const notChannel = [
  "http://youtube.com/@Alice",
  "ftp://youtube.com/@Alice",
  "javascript:alert(1)",
  "https://evil.example/@Alice",
  "https://youtube.com.evil.example/@Alice",
  "https://sub.youtube.com/@Alice",
  "https://youtu.be/@Alice",
  "https://youtube-nocookie.com/@Alice",
  "https://user:pass@youtube.com/@Alice",
  "https://user@youtube.com/@Alice",
  "https://youtube.com:8443/@Alice",
  "https://youtube.com/watch?v=aaaaaaaaaaa",
  "https://youtube.com/@Alice/videos",
  "https://youtube.com/",
  "https://youtube.com/@",
  "https://youtube.com/channel/",
  "https://youtube.com/@Alice//",
  fullPrefix + "Alice%00",
  fullPrefix + "Alice%20",
  fullPrefix + "Alice%7f",
  fullPrefix + "Alice%5cBob",
  fullPrefix + "Alice%3fquery",
  fullPrefix + "Alice%23section",
];
for (const [cases, issue, message] of [
  [malformed, values.CHANNEL_URL_ISSUE.MALFORMED, "Invalid channel URL."],
  [notChannel, values.CHANNEL_URL_ISSUE.NOT_CHANNEL, "Only YouTube channel URLs can be imported."],
]) {
  for (const input of cases) {
    const result = values.normalizeChannelUrl(input);
    assert.equal(result.url, null);
    assert.equal(result.issue, issue, String(input));
    assert.throws(() => schema.metadata(metadata({ channelUrl: input }), id), {
      message:
        "Invalid player response: invalid channel URL. Reload the YouTube tab and try again.",
    });
    // Undefined channelUrl is optional in transfer, unlike a present undefined
    // result field. Preserve that caller-specific contract.
    if (input !== undefined)
      assert.throws(() => imported(record({ channelUrl: input })), { message });
  }
}
assert.equal(Object.hasOwn(imported(record({ channelUrl: undefined })), "channelUrl"), false);
console.log(
  "PASS: malformed/unsupported channel inputs preserve each caller's exact error and optional-field behavior",
);

const channelCoercion = {
  toString() {
    coercions++;
    return fullPrefix + "Alice";
  },
};
assert.equal(values.normalizeChannelUrl(channelCoercion).issue, values.CHANNEL_URL_ISSUE.MALFORMED);
assert.equal(coercions, 0);
let getterReads = 0;
const getter = {
  enumerable: true,
  get() {
    getterReads++;
    return fullPrefix + "Alice";
  },
};
const accessorMetadata = Object.defineProperty(metadata(), "channelUrl", getter);
const accessorRecord = Object.defineProperty(record(), "channelUrl", getter);
assert.throws(() => schema.metadata(accessorMetadata, id), /accessor fields are not allowed/);
assert.throws(() => imported(accessorRecord), /Invalid video channelUrl/);
assert.equal(getterReads, 0);
const unknownMetadata = Object.defineProperty(metadata(), "unknown", getter);
const unknownRecord = Object.defineProperty(record(), "unknown", getter);
assert.throws(() => schema.metadata(unknownMetadata, id), /unexpected fields/);
assert.equal(Object.hasOwn(imported(unknownRecord), "unknown"), false);
assert.equal(getterReads, 0, "Unknown imported getters must still be ignored");
const inherited = Object.assign(Object.create({ channelUrl: "javascript:alert(1)" }), record());
assert.equal(Object.hasOwn(imported(inherited), "channelUrl"), false);
const inheritedMetadata = Object.assign(
  Object.create({ channelUrl: "javascript:alert(1)" }),
  metadata(),
);
assert.equal(Object.hasOwn(schema.metadata(inheritedMetadata, id), "channelUrl"), false);
assert.throws(() => schema.metadata(metadata({ unexpected: true }), id), /unexpected fields/);
assert.throws(() => schema.metadata(metadata({ t: -1 }), id), /invalid position/);
assert.throws(() => imported(record({ t: -1 })), /Invalid playback position/);
console.log(
  "PASS: extraction preserves field allowlists, accessor/prototype isolation and existing numeric checks",
);

const client = context.WAYPOINTS_CREATE_PLAYER_CLIENT({ resultSchema: schema });
for (const candidate of [id, "AbC_09-xYz1"]) {
  assert.equal(client.videoIdOf(`https://www.youtube.com/watch?v=${candidate}`), candidate);
  assert.equal(client.parseVideoLink(`https://youtu.be/${candidate}`).id, candidate);
}
assert.equal(client.parseVideoLink("https://youtu.be/too-short"), null);
assert.equal(client.videoIdOf("https://www.youtube.com/watch?v=bad"), null);
console.log("PASS: player-client URL parsing uses the shared ID boundary");
