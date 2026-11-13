// Shared Settings contract for popup controls and storage retention.
// No DOM, page access, persistence or mutable settings state.
(() => {
  const numeric = Object.freeze({
    scrubSeconds: Object.freeze({ min: 1, max: 60, defaultValue: 10 }),
    shiftMultiplier: Object.freeze({ min: 1, max: 10, defaultValue: 3 }),
    trashDays: Object.freeze({ min: 1, max: 365, defaultValue: 7 }),
  });
  const defaults = Object.freeze({
    autoBookmark: true,
    includeChannelNames: true,
    showThumbnails: true,
    showMarkers: true,
    offerSaveFile: false,
    showTrash: false,
    deletionMode: "timed",
  });
  const isIntegerInRange = (value, rule) =>
    Number.isInteger(value) && value >= rule.min && value <= rule.max;
  const normalizeInteger = (value, rule) =>
    isIntegerInRange(value, rule) ? value : rule.defaultValue;
  const retentionDays = (value) => normalizeInteger(value, numeric.trashDays);

  // Match the existing shared-service registration used by popup/content entrypoints.
  globalThis.WAYPOINTS_SETTINGS_POLICY = Object.freeze({
    numeric,
    defaults,
    isIntegerInRange,
    normalizeInteger,
    retentionDays,
  });
})();
