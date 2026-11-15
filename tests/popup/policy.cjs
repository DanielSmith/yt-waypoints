const assert = require("node:assert/strict");
const vm = require("node:vm");

module.exports = async ({ createPopupFixture }) => {
  const policyFixture = await createPopupFixture({}, "https://example.com/");
  const policy = policyFixture.context.WAYPOINTS_SETTINGS_POLICY;
  assert.ok(
    Object.isFrozen(policy) && Object.isFrozen(policy.defaults) && Object.isFrozen(policy.numeric),
  );
  for (const [name, controlId, min, max, fallback] of [
    ["scrubSeconds", "scrub-seconds", 1, 60, 10],
    ["shiftMultiplier", "shift-multiplier", 1, 10, 3],
    ["trashDays", "trash-days", 1, 365, 7],
  ]) {
    assert.ok(Object.isFrozen(policy.numeric[name]));
    const control = policyFixture.els[controlId];
    assert.equal(control.min, String(min));
    assert.equal(control.max, String(max));
    assert.equal(control.step, "1");
    assert.equal(control.defaultValue, String(fallback));
    assert.equal(String(control.value), String(fallback));
    for (const value of [min, max, fallback]) {
      policyFixture.context.policyValue = value;
      assert.equal(
        vm.runInContext(`normalizeSettings({${name}:policyValue}).${name}`, policyFixture.context),
        value,
      );
    }
    for (const value of [0, max + 1, 1.5, String(max), NaN, Infinity, null, undefined]) {
      policyFixture.context.policyValue = value;
      assert.equal(
        vm.runInContext(`normalizeSettings({${name}:policyValue}).${name}`, policyFixture.context),
        fallback,
      );
      if (name === "trashDays")
        assert.equal(policyFixture.context.WAYPOINTS_STORAGE.retentionDays(value), 7);
    }
  }
  const policyDefaults = JSON.parse(
    JSON.stringify(vm.runInContext("normalizeSettings({})", policyFixture.context)),
  );
  assert.deepEqual(policyDefaults, {
    autoBookmark: true,
    includeChannelNames: true,
    showThumbnails: true,
    showMarkers: true,
    scrubSeconds: 10,
    shiftMultiplier: 3,
    transcriptFormat: "markdown-linked",
    offerSaveFile: false,
    theme: "system",
    deletionMode: "timed",
    trashDays: 7,
    showTrash: false,
  });
  for (const [name, fallback] of Object.entries({
    autoBookmark: true,
    includeChannelNames: true,
    showThumbnails: true,
    showMarkers: true,
    offerSaveFile: false,
    showTrash: false,
  })) {
    for (const value of [true, false]) {
      policyFixture.context.policyValue = value;
      assert.equal(
        vm.runInContext(`normalizeSettings({${name}:policyValue}).${name}`, policyFixture.context),
        value,
      );
    }
    for (const value of [undefined, null, 0, "false"]) {
      policyFixture.context.policyValue = value;
      assert.equal(
        vm.runInContext(`normalizeSettings({${name}:policyValue}).${name}`, policyFixture.context),
        fallback,
      );
    }
  }
  assert.equal(policyFixture.context.WAYPOINTS_STORAGE.retentionDays(1), 1);
  assert.equal(policyFixture.context.WAYPOINTS_STORAGE.retentionDays(365), 365);
  assert.equal(policyFixture.els["annotation-text"].maxLength, 10000);
  assert.equal(policyFixture.context.WAYPOINTS_MARKERS.MAX_NOTE_CHARACTERS, 10000);
  assert.match(policyFixture.els["trash-expiry-help"].textContent, /^Default: 7 days \(one week\)/);
  console.log(
    "PASS: immutable settings policy preserves defaults, numeric bounds, retention and initialized control/annotation constraints",
  );
};
