// Auto-save: while a *bookmarked* video plays, keep its saved time current.
// Videos you haven't bookmarked are never recorded.
const api = globalThis.browser ?? globalThis.chrome;
const INTERVAL_MS = 5000; // Also refreshes popup progress through storage.onChanged.
let lastSaved = { id: null, t: -1 };

function currentVideoId() {
  if (location.pathname !== "/watch") return null;
  return new URLSearchParams(location.search).get("v");
}

async function autosave() {
  const id = currentVideoId();
  const video = document.querySelector("video");
  if (!id || !video) return;
  // Skip ads: their currentTime isn't the real video's.
  if (document.querySelector(".html5-video-player.ad-showing")) return;

  const t = Math.floor(video.currentTime);
  if (t < 5) return; // page still loading or seeking to &t=
  const info = WAYPOINTS_READ_METADATA();
  if (lastSaved.id === id && lastSaved.t === t &&
      lastSaved.channelName === info.channelName && lastSaved.channelUrl === info.channelUrl) return;

  const { videos = {} } = await api.storage.local.get("videos");
  const entry = videos[id];
  if (!entry) return; // not bookmarked; do nothing

  const duration = isFinite(video.duration) ? Math.floor(video.duration) : 0;
  // On YouTube's in-page navigation, the <video> may briefly still hold the
  // previous video. A duration mismatch means it isn't this one yet.
  if (entry.duration && duration && Math.abs(entry.duration - duration) > 2) return;

  const channel = info.channelName
    ? { channelName: info.channelName, channelUrl: info.channelUrl }
    : {};
  videos[id] = { ...entry, ...channel, t, duration: duration || entry.duration, updated: Date.now() };
  await api.storage.local.set({ videos });
  lastSaved = { id, t, channelName: info.channelName, channelUrl: info.channelUrl };
}

function tick() {
  const video = document.querySelector("video");
  if (video && !video.paused) autosave().catch(() => {});
}

setInterval(tick, INTERVAL_MS);
// Media events don't bubble, but capture on document catches them.
document.addEventListener("pause", () => autosave().catch(() => {}), true);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") autosave().catch(() => {});
});
window.addEventListener("pagehide", () => autosave().catch(() => {}));
