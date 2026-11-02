// Named, self-contained functions: executeScript serializes each into the page.
// The popup uses these operations to read or control the YouTube player.
globalThis.WAYPOINTS_PLAYER_ACTIONS = {
  bookmark: () => {
    const v = document.querySelector("video");
    return {
      id: new URLSearchParams(location.search).get("v"),
      t: v ? Math.floor(v.currentTime) : 0,
      duration: v && isFinite(v.duration) ? Math.floor(v.duration) : 0,
      title: document.title.replace(/^\(\d+\)\s*/, "").replace(/\s*-\s*YouTube$/, ""),
    };
  },
  seek: (delta) => {
    const el = document.querySelector("video");
    if (!el || !isFinite(el.duration)) return null;
    if (document.querySelector(".html5-video-player.ad-showing")) return null;
    el.currentTime = Math.min(el.duration, Math.max(0, el.currentTime + delta));
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
