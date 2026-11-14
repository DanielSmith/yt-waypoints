// Human-readable position clocks. Subtitle cue formatting remains separate.
(() => {
  function displayTimestamp(seconds) {
    // UI values normally arrive validated. Do not coerce objects or strings
    // when formatting an unavailable/invalid position for display.
    const total = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const remainingSeconds = String(total % 60).padStart(2, "0");
    return hours
      ? `${hours}:${String(minutes).padStart(2, "0")}:${remainingSeconds}`
      : `${minutes}:${remainingSeconds}`;
  }

  globalThis.WAYPOINTS_TIME_FORMAT = Object.freeze({ displayTimestamp });
})();
