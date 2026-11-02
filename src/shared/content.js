// Auto-save: while a *bookmarked* video plays, keep its saved time current.
// Videos you haven't bookmarked are never recorded.
const api = globalThis.browser ?? globalThis.chrome;
const INTERVAL_MS = 5000; // Also refreshes popup progress through storage.onChanged.
let lastSaved = { id: null, t: -1 };

function currentVideoId() {
  if (location.pathname !== "/watch") return null;
  return new URLSearchParams(location.search).get("v");
}

let importGeneration = 0;
let importRevision = null;
const handledImports = new Set();

function adoptImportedPosition(request, videos) {
  if (!request || typeof request.revision !== "string") return true;
  if (request.revision !== importRevision) {
    importRevision = request.revision;
    handledImports.clear();
  }
  const id = currentVideoId();
  if (!id || handledImports.has(id) || !request.videos || !Object.hasOwn(request.videos, id)) return true;
  const target = request.videos[id];
  const entry = videos[id];
  if (!entry || entry.t !== target.t || !Number.isSafeInteger(target.t) || target.t < 0) {
    handledImports.add(id); // A subsequent edit/deletion superseded this import.
    return true;
  }
  const video = document.querySelector("video");
  const watch = document.querySelector("ytd-watch-flexy:not([hidden])");
  if (!video || !isFinite(video.duration) || video.duration <= 0 ||
      document.querySelector(".html5-video-player.ad-showing") ||
      (watch?.getAttribute("video-id") && watch.getAttribute("video-id") !== id)) return false;
  try { video.currentTime = Math.min(video.duration, target.t); } catch { return false; }
  handledImports.add(id);
  lastSaved = { id: null, t: -1 };
  return true;
}

async function followImport() {
  const generation = importGeneration;
  const { videos = {}, importedPositions } = await api.storage.local.get(["videos", "importedPositions"]);
  if (generation === importGeneration) adoptImportedPosition(importedPositions, videos);
}

api.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.importedPositions) return;
  importGeneration++;
  followImport().catch(() => {});
});
followImport().catch(() => {});

async function autosave() {
  const id = currentVideoId();
  const video = document.querySelector("video");
  if (!id || !video) return;
  const generation = importGeneration;
  const { videos = {}, importedPositions } = await api.storage.local.get(["videos", "importedPositions"]);
  if (generation !== importGeneration || currentVideoId() !== id ||
      document.querySelector("video") !== video || !adoptImportedPosition(importedPositions, videos)) return;
  if (document.querySelector(".html5-video-player.ad-showing")) return;
  const t = Math.floor(video.currentTime);
  if (t < 5) return;
  const info = WAYPOINTS_READ_METADATA();
  if (lastSaved.id === id && lastSaved.t === t &&
      lastSaved.channelName === info.channelName && lastSaved.channelUrl === info.channelUrl) return;
  const entry = videos[id];
  if (!entry) return;

  const duration = isFinite(video.duration) ? Math.floor(video.duration) : 0;
  // On YouTube's in-page navigation, the <video> may briefly still hold the
  // previous video. A duration mismatch means it isn't this one yet.
  if (entry.duration && duration && Math.abs(entry.duration - duration) > 2) return;

  const channel = info.channelName
    ? { channelName: info.channelName, channelUrl: info.channelUrl }
    : {};
  videos[id] = { ...entry, ...channel, t, duration: duration || entry.duration, updated: Date.now() };
  await api.storage.local.set({ videos });
  if (generation === importGeneration) lastSaved = { id, t, channelName: info.channelName, channelUrl: info.channelUrl };
}

function tick() {
  const video = document.querySelector("video");
  if (video && !video.paused) autosave().catch(() => {});
}

setInterval(tick, INTERVAL_MS);
// Media events don't bubble, but capture on document catches them.
document.addEventListener("loadedmetadata", () => autosave().catch(() => {}), true);
document.addEventListener("pause", () => autosave().catch(() => {}), true);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") autosave().catch(() => {});
});
window.addEventListener("pagehide", () => autosave().catch(() => {}));
