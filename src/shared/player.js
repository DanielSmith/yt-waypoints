// Named, self-contained functions: executeScript serializes each into the page.
// The popup uses these operations to read or control the YouTube player.
globalThis.WAYPOINTS_PLAYER_ACTIONS = {
  bookmark: globalThis.WAYPOINTS_READ_METADATA,
  seek: (delta) => {
    const el = document.querySelector("video");
    if (!el || !isFinite(el.duration)) return null;
    if (document.querySelector(".html5-video-player.ad-showing")) return null;
    el.currentTime = Math.min(el.duration, Math.max(0, el.currentTime + delta));
    return { t: Math.floor(el.currentTime), duration: Math.floor(el.duration), paused: el.paused };
  },
  seekTo: (time, expectedId = null) => {
    if (expectedId && new URLSearchParams(location.search).get("v") !== expectedId) return null;
    const el = document.querySelector("video");
    if (!el || !isFinite(el.duration) || el.duration <= 0) return null;
    if (document.querySelector(".html5-video-player.ad-showing")) return null;
    el.currentTime = Math.min(el.duration, Math.max(0, time));
    return { t: Math.floor(el.currentTime), duration: Math.floor(el.duration), paused: el.paused };
  },
  toggle: () => {
    const el = document.querySelector("video");
    if (!el) return null;
    if (el.paused) el.play().catch(() => {});
    else el.pause();
    return { t: Math.floor(el.currentTime), paused: el.paused };
  },
};
