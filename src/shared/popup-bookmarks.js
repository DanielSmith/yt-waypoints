// Copyright 2026 Daniel Smith
// SPDX-License-Identifier: Apache-2.0
// Bookmark operations retain pre-request snapshots and storage lifetime guards.
globalThis.WAYPOINTS_CREATE_POPUP_BOOKMARKS = ({
  storage,
  player,
  watchPattern,
  getSettings,
  getCurrentId,
  setStatus,
  showPlayer,
  fmt,
  refresh,
  openVideo,
  onImport,
  onTrash,
  clearRestoreState,
  getRestoreBookmark,
}) => {
  const { activeTab, videoIdOf, findVideoTab, inPlayer } = player;

  // A mutation owns the complete storage snapshot: videos are editable, while
  // original/records/clock retain field diffs and the observed bookmark lifetime.
  // Read before requesting player data, then save that same context. Never re-read
  // after a delayed result or save a bare videos map: deletion/import/re-add must
  // supersede the old lifetime, and unrelated field edits must survive the save.
  const loadSnapshot = () => storage.read();
  const saveSnapshot = (snapshot) => storage.save(snapshot);

  async function importVideos(incoming) {
    const { counts, positions } = await storage.importVideos(incoming);
    await onImport();
    setStatus(
      `Import: ${counts.added} added, ${counts.updated} updated, ${counts.kept} unchanged.`,
    );
    if (Object.keys(positions).length) {
      try {
        const tabs = await player.listVideoTabs();
        const outcomes = await Promise.allSettled(
          tabs
            .filter((tab) => Object.hasOwn(positions, videoIdOf(tab.url)))
            .map((tab) =>
              inPlayer(tab.id, "seekTo", [positions[videoIdOf(tab.url)].t, videoIdOf(tab.url)]),
            ),
        );
        const failed = outcomes.filter(
          (outcome) => outcome.status === "rejected" || outcome.value?.error,
        ).length;
        if (failed)
          setStatus(
            `Import saved; could not move ${failed} open ${failed === 1 ? "player" : "players"} to the imported position.`,
          );
      } catch {
        /* The saved positions remain available even if a tab disappears. */
      }
    }
  }

  async function bookmarkCurrent() {
    const tab = await activeTab();
    if (!tab?.url || !watchPattern.test(tab.url)) {
      setStatus("Open a YouTube video first.");
      return;
    }
    const snapshot = await loadSnapshot();
    const { videos } = snapshot;
    const info = await inPlayer(tab.id, "bookmark", [videoIdOf(tab.url)]);
    if (info.error) return setStatus(info.error);
    if (snapshot.trash[info.id]) {
      await restoreTrashVideo(info.id);
      return;
    }
    videos[info.id] = { ...info, updated: Date.now() };
    await saveSnapshot(snapshot);
    setStatus(`Saved at ${fmt(info.t)}.`);
  }

  // Enrich an existing bookmark without overwriting its saved time or recency.
  async function refreshCurrentChannel() {
    const tab = await activeTab();
    if (!tab || videoIdOf(tab.url) !== getCurrentId()) return;
    const snapshot = await loadSnapshot();
    const { videos } = snapshot;
    const info = await inPlayer(tab.id, "bookmark", [videoIdOf(tab.url)]);
    if (info.error) return setStatus(info.error);
    if (!info.channelName) return;
    const entry = videos[getCurrentId()];
    if (!entry || (entry.channelName === info.channelName && entry.channelUrl === info.channelUrl))
      return;
    videos[getCurrentId()] = {
      ...entry,
      channelName: info.channelName,
      channelUrl: info.channelUrl,
    };
    await saveSnapshot(snapshot);
  }

  async function deleteVideo(id) {
    const snapshot = await storage.read();
    const inTrash = Boolean(snapshot.trash[id]);
    if (!snapshot.videos[id] && !inTrash) return;
    if (getSettings().deletionMode === "timed" && !inTrash) {
      await storage.trash(id);
      onTrash({ id, title: snapshot.videos[id].title });
      setStatus(`Moved to trash. Permanently deleted after ${getSettings().trashDays} days.`);
    } else {
      // Permanent means no in-memory Undo copy and no retained row payload.
      clearRestoreState();
      await storage.purge([id]);
      setStatus("Bookmark permanently deleted.");
    }
    await refresh();
  }

  async function restoreTrashVideo(id) {
    const restored = await storage.restore(id);
    clearRestoreState();
    await refresh();
    setStatus(restored ? "Bookmark moved to current." : "Bookmark is no longer in trash.");
  }

  async function restoreBookmark() {
    const bookmark = getRestoreBookmark();
    if (bookmark) {
      await restoreTrashVideo(bookmark.id);
    } else {
      await bookmarkCurrent();
      await refresh();
    }
  }

  async function emptyTrash() {
    clearRestoreState(false);
    const count = await storage.emptyTrash();
    await refresh();
    setStatus(
      count
        ? `Permanently deleted ${count} trashed ${count === 1 ? "bookmark" : "bookmarks"}.`
        : "Trash is empty.",
    );
  }

  // Both seek commands retain the pre-request lifetime and save only changed
  // fields. The player client validates results before they reach this owner.
  // Do not round live results or change playback state; the player owns both.
  async function seekBookmark(id, operation, value) {
    const snapshot = await loadSnapshot();
    const v = snapshot.videos[id];
    if (!v) return;

    const tab = await findVideoTab(id);
    const live = tab ? await inPlayer(tab.id, operation, [value, id]) : null;
    if (live?.error) return setStatus(live.error);
    if (live) {
      v.t = live.t;
      v.duration = live.duration;
      showPlayer(live);
    } else {
      // Relative scrubbing preserves fractional seconds and can advance without
      // a known duration. Absolute slider commits floor and require its bound.
      v.t =
        operation === "seek"
          ? Math.min(v.duration || Infinity, Math.max(0, v.t + value))
          : Math.floor(Math.min(v.duration, Math.max(0, value)));
      setStatus(`Resume point ${fmt(v.t)}`);
    }
    // Leave recency alone so a seek never jumps the row to the top.
    await saveSnapshot(snapshot);
  }

  // Seek from the live player's current position, or move the saved resume point.
  function scrub(id, delta) {
    return seekBookmark(id, "seek", delta);
  }

  // Commit an absolute slider position using the same lifetime-bound save path.
  function seekTo(id, time) {
    return seekBookmark(id, "seekTo", time);
  }

  async function controlPlayback(id, operation, direction) {
    const snapshot = operation === "frame" ? await loadSnapshot() : null;
    const videos = snapshot?.videos;
    if (operation === "frame" && !videos[id]) return;
    const tab = await findVideoTab(id);
    if (!tab) return setStatus("Open this video on YouTube first.");
    const result = await inPlayer(tab.id, "playback", [operation, direction, id]);
    if (!result)
      return setStatus(
        "YouTube playback controls are unavailable. Wait for the video to load and try again.",
      );
    if (result.error) return setStatus(result.error);
    if (operation === "rate") return setStatus(`Playback speed ${result.rate}×`);
    if (videos[id]) {
      videos[id].t = result.t;
      videos[id].duration = result.duration;
      await saveSnapshot(snapshot);
    }
    setStatus(`${direction > 0 ? "Next" : "Previous"} frame (${result.fps} fps).`);
  }

  // Space: play/pause the video in its open tab. Not open → open it (like Enter).
  async function togglePlay(id) {
    const snapshot = await loadSnapshot();
    const { videos } = snapshot;
    const v = videos[id];
    if (!v) return;

    const tab = await findVideoTab(id);
    if (!tab) return openVideo(v);

    const state = await inPlayer(tab.id, "toggle", [id]);
    if (state?.error) return setStatus(state.error);
    if (!state) {
      setStatus("Player isn't ready in that tab yet.");
      return;
    }
    showPlayer(state);
    if (!state.duration && v.duration && state.t > v.duration)
      return setStatus("Invalid player response: position exceeds the saved video duration.");
    v.t = state.t;
    v.duration = state.duration || v.duration || 0;
    await saveSnapshot(snapshot);
  }

  return Object.freeze({
    loadSnapshot,
    saveSnapshot,
    importVideos,
    bookmarkCurrent,
    refreshCurrentChannel,
    deleteVideo,
    restoreTrashVideo,
    restoreBookmark,
    emptyTrash,
    scrub,
    controlPlayback,
    seekTo,
    togglePlay,
  });
};
