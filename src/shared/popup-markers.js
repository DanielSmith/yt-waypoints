// Marker interactions own selection and drafts. Storage snapshots bind every
// delayed operation to its original bookmark lifetime, never to a later import.
globalThis.WAYPOINTS_CREATE_POPUP_MARKERS = ({
  document,
  storage,
  data,
  player,
  getSettings,
  enqueue,
  refresh,
  setStatus,
  fmt,
  focusRow,
}) => {
  const current = new Map();
  let editor = null;
  const editorEl = document.getElementById("annotation-editor");
  const noteEl = document.getElementById("annotation-text");
  const saveEl = document.getElementById("annotation-save");
  const cancelEl = document.getElementById("annotation-cancel");
  const errorEl = document.getElementById("annotation-error");
  const life = (snapshot, id) => JSON.stringify(snapshot.records[id]?.life.v);
  const points = (video) => (video.markers || []).filter((marker) => !marker.removed);
  const find = (video, id) => points(video).find((marker) => marker.id === id);

  function sync(snapshot) {
    for (const [id, selected] of current) {
      if (
        !snapshot.videos[id] ||
        life(snapshot, id) !== selected.life ||
        !find(snapshot.videos[id], selected.markerId)
      )
        current.delete(id);
    }
  }
  async function snapshotFor(id) {
    const snapshot = await storage.read();
    sync(snapshot);
    if (!snapshot.videos[id]) throw new Error("This bookmark is no longer current.");
    return snapshot;
  }
  async function stillCurrent(snapshot, id) {
    const latest = await storage.read();
    if (!latest.videos[id] || life(latest, id) !== life(snapshot, id))
      throw new Error("This bookmark changed. Try again on the current bookmark.");
    return latest;
  }
  async function position(snapshot, id) {
    const tab = await player.findVideoTab(id);
    if (!tab) return { ...snapshot.videos[id], tab: null };
    const result = await player.inPlayer(tab.id, "position", [id]);
    if (!result || result.error) throw new Error(result?.error || "The player is not ready.");
    return { ...result, tab };
  }
  async function toggle(id) {
    const snapshot = await snapshotFor(id);
    const actual = await position(snapshot, id);
    await stillCurrent(snapshot, id);
    const video = snapshot.videos[id];
    const nearby = points(video)
      .filter((marker) => Math.abs(marker.t - actual.t) <= 2)
      .sort(
        (a, b) =>
          Number(b.id === current.get(id)?.markerId) - Number(a.id === current.get(id)?.markerId) ||
          Math.abs(a.t - actual.t) - Math.abs(b.t - actual.t) ||
          a.t - b.t ||
          Number(a.origin === "chapter") - Number(b.origin === "chapter") ||
          a.id.localeCompare(b.id),
      )[0];
    if (nearby) return remove(id, nearby.id, snapshot);
    const marker = { id: `u:${crypto.randomUUID()}`, t: actual.t, origin: "user" };
    video.markers = [...(video.markers || []), marker];
    if (!video.duration && actual.duration) video.duration = actual.duration;
    await storage.save(snapshot);
    const latest = await stillCurrent(snapshot, id);
    if (!find(latest.videos[id], marker.id))
      throw new Error("Marker could not be added. Try again.");
    current.set(id, { markerId: marker.id, life: life(snapshot, id) });
    await refresh();
    setStatus(
      `Added marker at ${fmt(marker.t)}.${getSettings().showMarkers ? "" : " Markers hidden (M to show)."}`,
    );
  }
  async function remove(id, markerId, snapshot) {
    if (editor?.id === id && editor.markerId === markerId)
      throw new Error("Save or cancel this note before removing its marker.");
    snapshot ||= await snapshotFor(id);
    const marker = find(snapshot.videos[id], markerId);
    if (!marker) throw new Error("This marker is no longer available.");
    marker.removed = true;
    delete marker.note;
    delete marker.label;
    await storage.save(snapshot);
    await stillCurrent(snapshot, id);
    if (current.get(id)?.markerId === markerId) current.delete(id);
    await refresh();
    setStatus(`Removed marker and its annotation at ${fmt(marker.t)}.`);
  }
  async function select(id, markerId, suppliedSnapshot, suppliedPosition) {
    const snapshot = suppliedSnapshot || (await snapshotFor(id));
    const marker = find(snapshot.videos[id], markerId);
    if (!marker) throw new Error("This marker is no longer available.");
    const actual = suppliedPosition || (await position(snapshot, id));
    if (!actual.duration)
      throw new Error("Open this video on YouTube to read its duration before navigating markers.");
    if (marker.t > actual.duration)
      throw new Error("This marker is outside the available video duration.");
    await stillCurrent(snapshot, id);
    let result = { t: Math.floor(marker.t), duration: actual.duration };
    if (actual.tab) {
      result = await player.inPlayer(actual.tab.id, "seekTo", [marker.t, id]);
      if (!result || result.error)
        throw new Error(result?.error || "The player could not seek to this marker.");
    }
    await stillCurrent(snapshot, id);
    snapshot.videos[id].t = result.t;
    snapshot.videos[id].duration = result.duration;
    await storage.save(snapshot);
    const latest = await stillCurrent(snapshot, id);
    if (!find(latest.videos[id], markerId))
      throw new Error("This marker was removed while seeking.");
    current.set(id, { markerId, life: life(snapshot, id) });
    await refresh();
    setStatus(`Marker at ${fmt(marker.t)}${actual.tab ? "" : " (saved resume point)"}.`);
  }
  async function navigate(id, direction) {
    const snapshot = await snapshotFor(id);
    const actual = await position(snapshot, id);
    const available = points(snapshot.videos[id]);
    const index = available.findIndex((point) => point.id === current.get(id)?.markerId);
    const marker =
      index >= 0 && Math.abs(available[index].t - actual.t) <= 2
        ? available[index + direction]
        : direction > 0
          ? available.find((point) => point.t > actual.t + 2)
          : available.filter((point) => point.t < actual.t - 2).at(-1);
    if (!marker) return setStatus(direction > 0 ? "No next marker." : "No previous marker.");
    await select(id, marker.id, snapshot, actual);
  }
  async function refreshChapters(id) {
    const initial = await storage.read();
    if (!initial.videos[id]) return false;
    const tab = await player.findVideoTab(id);
    if (!tab) return false;
    const result = await player.inPlayer(tab.id, "chapters", [id]);
    if (!result || result.error || !result.available) return false;
    // Use the latest notes/removals, while retaining the pre-request lifetime.
    const latest = await storage.read();
    if (!latest.videos[id] || life(initial, id) !== life(latest, id)) return false;
    const video = latest.videos[id];
    const chapters = result.chapters.map(({ t, title }) => ({
      id: data.chapterId(t),
      t,
      title,
      origin: "chapter",
    }));
    const merged = data.refreshChapters(video.markers || [], chapters);
    if (JSON.stringify(merged) === JSON.stringify(video.markers || [])) return false;
    video.markers = merged;
    if (!video.duration) video.duration = result.duration;
    await storage.save(latest);
    await refresh();
    return true;
  }
  async function edit(id, markerId) {
    if (editor) return setStatus("Save or cancel the open note first.");
    const snapshot = await snapshotFor(id);
    if (markerId !== undefined) {
      if (markerId !== null && !find(snapshot.videos[id], markerId))
        throw new Error("This marker is no longer available.");
      if (markerId === null) current.delete(id);
      else current.set(id, { markerId, life: life(snapshot, id) });
    }
    const anchor = data.anchor(snapshot.videos[id].markers || [], current.get(id)?.markerId);
    const marker = anchor.markerId ? find(snapshot.videos[id], anchor.markerId) : null;
    editor = {
      id,
      markerId: anchor.markerId,
      snapshot,
      note: marker ? data.annotation(marker) : snapshot.videos[id].startNote || "",
    };
    noteEl.value = editor.note;
    document.getElementById("annotation-target").textContent =
      `${snapshot.videos[id].title || id} · ${marker ? "Marker" : "Video start"} ${fmt(anchor.t)}`;
    errorEl.textContent = "";
    editorEl.hidden = false;
    noteEl.focus();
  }
  function closeEditor() {
    if (!editor) return;
    const id = editor.id;
    editor = null;
    noteEl.value = "";
    editorEl.hidden = true;
    focusRow(id);
  }
  async function saveEditor() {
    if (!editor || saveEl.disabled) return;
    const pending = editor;
    const note = noteEl.value;
    saveEl.disabled = true;
    cancelEl.disabled = true;
    errorEl.textContent = "";
    try {
      data.note(note);
      const latest = await stillCurrent(pending.snapshot, pending.id);
      const draft = {
        ...pending.snapshot,
        videos: JSON.parse(JSON.stringify(pending.snapshot.videos)),
      };
      const beforeVideo = draft.videos[pending.id];
      const latestVideo = latest.videos[pending.id];
      const before = pending.markerId ? find(beforeVideo, pending.markerId) : beforeVideo;
      const now = pending.markerId ? find(latestVideo, pending.markerId) : latestVideo;
      if (!now) throw new Error("This marker was removed. Copy your draft, then cancel.");
      const noteField = pending.markerId ? "note" : "startNote";
      if (note !== pending.note) {
        if ((pending.markerId ? data.annotation(now) : now[noteField] || "") !== pending.note)
          throw new Error(
            "This note changed elsewhere. Copy your draft, then cancel and reopen it.",
          );
        before[noteField] = note;
      }
      draft.clock = latest.clock;
      await storage.save(draft);
      await stillCurrent(draft, pending.id);
      closeEditor();
      await refresh();
      setStatus("Annotation saved.");
    } catch (error) {
      errorEl.textContent = error.message;
    } finally {
      saveEl.disabled = false;
      cancelEl.disabled = false;
    }
  }
  function decorate(video, timeline) {
    if (!getSettings().showMarkers || !video.duration) return;
    const active = points(video).filter((marker) => marker.t <= video.duration);
    if (!active.length) return;
    const overlay = document.createElement("div");
    overlay.className = "marker-overlay";
    overlay.setAttribute("aria-hidden", "true");
    timeline.setAttribute("role", "group");
    timeline.setAttribute(
      "aria-label",
      `Playback timeline, ${active.length} markers. Use [ and ] to navigate, a to annotate.`,
    );
    const painted = new Set();
    for (const marker of active) {
      // Coalesce subpixel clusters, retaining all points for keyboard navigation.
      const key = `${marker.origin}:${Math.round((marker.t / video.duration) * 1000)}`;
      if (painted.has(key)) continue;
      painted.add(key);
      const line = document.createElement("span");
      line.className = `marker-line marker-${marker.origin}`;
      line.dataset.markerId = marker.id;
      line.style.setProperty("--marker-position", `${(marker.t / video.duration) * 100}%`);
      overlay.append(line);
    }
    timeline.append(overlay);
  }
  function init() {
    saveEl.addEventListener("click", () => enqueue(saveEditor));
    cancelEl.addEventListener("click", closeEditor);
    saveEl.disabled = false;
    cancelEl.disabled = false;
  }
  return Object.freeze({
    toggle,
    remove,
    select,
    navigate,
    refreshChapters,
    edit,
    saveEditor,
    closeEditor,
    decorate,
    sync,
    init,
    get editorOpen() {
      return Boolean(editor);
    },
  });
};
