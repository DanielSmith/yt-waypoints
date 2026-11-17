// Copyright 2026 Daniel Smith
// SPDX-License-Identifier: Apache-2.0
export function startAutosave(context) {
  let active = true;
  context?.onInvalidated(() => {
    active = false;
  });
  // Auto-save: while a *bookmarked* video plays, keep its saved time current.
  // Videos you haven't bookmarked are never recorded.
  const api = globalThis.browser ?? globalThis.chrome;
  const AUTOSAVE_INTERVAL_MS = 5000; // Also refreshes popup progress through storage.onChanged.
  const MIN_AUTOSAVE_POSITION_SECONDS = 5;
  const NAVIGATION_DURATION_TOLERANCE_SECONDS = 2;
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
    const id = currentVideoId();
    if (!id || !request.videos || !Object.hasOwn(request.videos, id)) return true;
    const target = request.videos[id];
    const revision = target.revision || request.revision;
    if (revision !== importRevision) {
      importRevision = revision;
      handledImports.clear();
    }
    if (handledImports.has(id)) return true;
    const entry = videos[id];
    if (!entry || entry.t !== target.t || !Number.isSafeInteger(target.t) || target.t < 0) {
      handledImports.add(id); // A subsequent edit/deletion superseded this import.
      return true;
    }
    const video = document.querySelector("video");
    const watch = document.querySelector("ytd-watch-flexy:not([hidden])");
    if (
      !video ||
      !isFinite(video.duration) ||
      video.duration <= 0 ||
      document.querySelector(".html5-video-player.ad-showing") ||
      (watch?.getAttribute("video-id") && watch.getAttribute("video-id") !== id)
    )
      return false;
    try {
      video.currentTime = Math.min(video.duration, target.t);
    } catch {
      return false;
    }
    handledImports.add(id);
    lastSaved = { id: null, t: -1 };
    return true;
  }

  async function followImport() {
    const generation = importGeneration;
    const { videos = {}, importedPositions } = await WAYPOINTS_STORAGE.read();
    if (active && generation === importGeneration) adoptImportedPosition(importedPositions, videos);
  }

  const onStorageChanged = (changes, area) => {
    if (!active) return;
    if (area !== "local" || !WAYPOINTS_STORAGE.imported(changes)) return;
    importGeneration++;
    followImport().catch(() => {});
  };
  api.storage.onChanged.addListener(onStorageChanged);
  context?.onInvalidated(() => api.storage.onChanged.removeListener(onStorageChanged));
  followImport().catch(() => {});
  WAYPOINTS_STORAGE.expire().catch(() => {});

  async function autosave() {
    if (!active) return;
    const id = currentVideoId();
    const video = document.querySelector("video");
    if (!id || !video) return;
    const generation = importGeneration;
    const snapshot = await WAYPOINTS_STORAGE.read();
    const { videos, importedPositions } = snapshot;
    if (
      !active ||
      generation !== importGeneration ||
      currentVideoId() !== id ||
      document.querySelector("video") !== video ||
      !adoptImportedPosition(importedPositions, videos)
    )
      return;
    if (document.querySelector(".html5-video-player.ad-showing")) return;
    if (!Number.isFinite(video.currentTime) || video.currentTime < 0) return;
    const t = Math.floor(video.currentTime);
    if (t < MIN_AUTOSAVE_POSITION_SECONDS) return;
    let info;
    try {
      info = WAYPOINTS_PLAYER_RESULTS.metadata(WAYPOINTS_READ_METADATA(id), id);
    } catch {
      return;
    } // Never let an invalid page value corrupt an autosave.
    if (info.t !== t) return;
    const entry = videos[id];
    if (!entry) return;
    const lifetime = JSON.stringify(snapshot.records[id].life.v);
    if (
      lastSaved.id === id &&
      lastSaved.lifetime === lifetime &&
      lastSaved.t === t &&
      lastSaved.channelName === info.channelName &&
      lastSaved.channelUrl === info.channelUrl
    )
      return;
    const duration = info.duration;
    if ((duration || entry.duration) && t > (duration || entry.duration)) return;
    // On YouTube's in-page navigation, the <video> may briefly still hold the
    // previous video. A duration mismatch means it isn't this one yet.
    if (
      entry.duration &&
      duration &&
      Math.abs(entry.duration - duration) > NAVIGATION_DURATION_TOLERANCE_SECONDS
    )
      return;

    const channel = info.channelName
      ? { channelName: info.channelName, channelUrl: info.channelUrl }
      : {};
    videos[id] = {
      ...entry,
      ...channel,
      t,
      duration: duration || entry.duration,
      updated: Date.now(),
    };
    await WAYPOINTS_STORAGE.save(snapshot);
    if (generation === importGeneration)
      lastSaved = { id, t, lifetime, channelName: info.channelName, channelUrl: info.channelUrl };
  }

  function tick() {
    WAYPOINTS_STORAGE.expire().catch(() => {});
    const video = document.querySelector("video");
    if (video && !video.paused) autosave().catch(() => {});
  }

  if (context) context.setInterval(tick, AUTOSAVE_INTERVAL_MS);
  else setInterval(tick, AUTOSAVE_INTERVAL_MS);
  function listen(target, type, callback, capture = false) {
    target.addEventListener(type, callback, capture);
    context?.onInvalidated(() => target.removeEventListener(type, callback, capture));
  }
  // Media events don't bubble, but capture on document catches them.
  listen(document, "loadedmetadata", () => autosave().catch(() => {}), true);
  listen(document, "pause", () => autosave().catch(() => {}), true);
  listen(document, "visibilitychange", () => {
    if (document.visibilityState === "hidden") autosave().catch(() => {});
  });
  listen(window, "pagehide", () => autosave().catch(() => {}));
}
