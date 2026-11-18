// Copyright 2026 Daniel Smith
// SPDX-License-Identifier: Apache-2.0
// List rendering, slider ownership, drag lifetime, and row/focus restoration.
globalThis.WAYPOINTS_CREATE_POPUP_LIST = ({
  document,
  listEl,
  searchEl,
  clearSearchEl,
  getSearchResults,
  showSearchResults,
  getVideos,
  getTrash,
  getSettings,
  updateHeaderMode,
  headerControl,
  fmt,
  linkFor,
  openVideo,
  actions,
  enqueue,
  setStatus,
  refresh,
  markers,
}) => {
  let activeScrubber = null;
  const { seekTo, deleteVideo, restoreTrashVideo } = actions;

  function makeScrubber(v, meta, when) {
    const slider = document.createElement("input");
    slider.type = "range";
    slider.className = "bar";
    slider.dataset.id = v.id;
    slider.min = "0";
    slider.max = String(v.duration);
    slider.step = "1";
    slider.value = String(Math.min(v.duration, Math.max(0, v.t)));
    slider.setAttribute("aria-label", `Playback position for ${v.title || v.id}`);
    let lastCommitted = Number(slider.value);
    let cancelled = false;
    const value = () => Math.floor(Math.min(v.duration, Math.max(0, Number(slider.value))));
    function paint() {
      slider.style.setProperty("--progress", `${(value() / v.duration) * 100}%`);
      slider.setAttribute("aria-valuetext", `${fmt(value())} of ${fmt(v.duration)}`);
      slider.title = `${fmt(value())} / ${fmt(v.duration)}`;
    }
    function preview() {
      paint();
      meta.textContent = `${fmt(value())} / ${fmt(v.duration)} · ${when}`;
      setStatus(`Seek to ${fmt(value())}`);
    }
    function commit() {
      if (cancelled) return;
      const wasDragging = activeScrubber === slider;
      if (wasDragging) activeScrubber = null;
      const time = value();
      if (time === lastCommitted) {
        if (wasDragging) renderList();
        return;
      }
      lastCommitted = time;
      enqueue(async () => {
        try {
          await seekTo(v.id, time);
        } finally {
          await refresh();
        }
      });
    }
    function cancel() {
      if (activeScrubber !== slider) return;
      cancelled = true;
      activeScrubber = null;
      renderList();
      setStatus("Scrub cancelled.");
    }
    paint();
    slider.addEventListener("click", (event) => event.stopPropagation());
    slider.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || activeScrubber) return;
      event.stopPropagation();
      cancelled = false;
      activeScrubber = slider;
      slider.setPointerCapture(event.pointerId);
      slider.focus();
    });
    slider.addEventListener("input", preview);
    slider.addEventListener("change", commit);
    slider.addEventListener("pointerup", () => {
      if (activeScrubber === slider) commit();
    });
    slider.addEventListener("pointercancel", cancel);
    slider.addEventListener("lostpointercapture", cancel);
    slider.addEventListener("keydown", (event) => {
      if (
        event.isComposing ||
        event.defaultPrevented ||
        event.ctrlKey ||
        event.altKey ||
        event.metaKey
      )
        return;
      if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      const settings = getSettings();
      const step = settings.scrubSeconds * (event.shiftKey ? settings.shiftMultiplier : 1);
      slider.value = String(
        Math.min(v.duration, Math.max(0, value() + (event.key === "ArrowRight" ? step : -step))),
      );
      preview();
      commit();
    });
    return slider;
  }

  function focusables() {
    return [headerControl(), ...listEl.querySelectorAll(".main")];
  }

  let pendingFocusIndex = null;

  function renderList({ refreshSearch = false } = {}) {
    const savedVideos = getVideos();
    const trashVideos = getTrash();
    const settings = getSettings();
    // Native range dragging must retain the same DOM node until release/cancel.
    // Keep the single editor, its source row, focus and draft stable while
    // background autosave/chapter/storage snapshots update. Closing refreshes.
    if (activeScrubber || markers.editorOpen) return;
    updateHeaderMode();
    const query = searchEl.value.trim();
    clearSearchEl.hidden = searchEl.value.length === 0;
    const eligible = [
      ...Object.values(savedVideos),
      ...(settings.showTrash ? Object.values(trashVideos) : []),
    ].sort(
      (a, b) =>
        Number(Object.hasOwn(trashVideos, a.id)) - Number(Object.hasOwn(trashVideos, b.id)) ||
        b.updated - a.updated ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
    const result = getSearchResults(eligible, query, settings, refreshSearch);
    showSearchResults(result);
    const byId = new Map(eligible.map((video) => [video.id, video]));
    const videos = result.ids.map((id) => byId.get(id));
    // Keep keyboard focus on the same row or slider across re-renders.
    const focusedId = document.activeElement?.dataset?.id;
    const focusedSlider =
      document.activeElement?.type === "range" && document.activeElement.classList.contains("bar");
    listEl.replaceChildren();
    if (!videos.length) {
      const li = document.createElement("li");
      li.className = "empty";
      li.textContent = result.error
        ? "Search needs attention."
        : query
          ? "No matching videos."
          : "No bookmarks yet.";
      listEl.append(li);
    }
    for (const v of videos) {
      const inTrash = Object.hasOwn(trashVideos, v.id);
      const li = document.createElement("li");
      if (inTrash) li.className = "trash-row";

      const main = document.createElement("div");
      main.className = "main";
      main.tabIndex = 0;
      main.dataset.id = v.id;
      main.title = v.channelName ? `${v.channelName}\n${linkFor(v)}` : linkFor(v);
      main.addEventListener("click", () => openVideo(v));

      if (settings.showThumbnails) {
        const thumbnail = document.createElement("span");
        thumbnail.className = "thumbnail";
        thumbnail.setAttribute("aria-hidden", "true");
        const img = document.createElement("img");
        img.alt = "";
        img.width = 64;
        img.height = 36;
        img.loading = "lazy";
        img.decoding = "async";
        img.referrerPolicy = "no-referrer";
        img.addEventListener("error", () => {
          img.hidden = true;
        });
        img.src = `https://i.ytimg.com/vi/${encodeURIComponent(v.id)}/mqdefault.jpg`;
        thumbnail.append(img);
        main.append(thumbnail);
      }
      const details = document.createElement("div");
      details.className = "details";

      const title = document.createElement("div");
      title.className = "title";
      title.textContent = v.title || v.id;

      const meta = document.createElement("div");
      meta.className = "meta";
      const when = new Date(v.updated).toLocaleDateString();
      meta.textContent = v.duration
        ? `${fmt(v.t)} / ${fmt(v.duration)} · ${when}`
        : `${fmt(v.t)} · ${when}`;

      details.append(title);
      if (v.channelName) {
        const channel = document.createElement("div");
        channel.className = "channel-name";
        const channelTitle = document.createElement("span");
        channelTitle.className = "channel-title";
        channelTitle.textContent = v.channelName;
        channel.append(channelTitle);
        const preview = inTrash ? "" : markers.annotationPreview(v);
        if (preview) {
          const annotation = document.createElement("span");
          annotation.className = "channel-annotation";
          const excerpt = document.createElement("span");
          excerpt.className = "annotation-excerpt";
          excerpt.textContent = preview;
          annotation.append(excerpt);
          channel.append(annotation);
          channel.title = `${v.channelName} (${preview})`;
        }
        details.append(channel);
      }
      if (inTrash) meta.textContent = `Trash · ${meta.textContent}`;
      details.append(meta);

      if (v.duration && !inTrash) {
        const timeline = document.createElement("div");
        timeline.className = "timeline";
        timeline.append(makeScrubber(v, meta, when));
        markers.decorate(v, timeline);
        details.append(timeline);
      }
      main.append(details);

      const del = document.createElement("button");
      del.className = "del";
      del.tabIndex = -1;
      del.textContent = "×";
      del.title =
        inTrash || settings.deletionMode === "permanent" ? "Permanently delete" : "Move to trash";
      del.setAttribute("aria-label", `${del.title}: ${v.title || v.id}`);
      del.addEventListener("click", () => enqueue(() => deleteVideo(v.id)));

      li.append(main);
      if (inTrash) {
        const restoreLabel = document.createElement("label");
        restoreLabel.className = "trash-restore";
        const restore = document.createElement("input");
        restore.type = "checkbox";
        restore.dataset.id = v.id;
        restore.checked = false;
        restore.disabled = false;
        restore.setAttribute("aria-label", `Move to current: ${v.title || v.id}`);
        restore.addEventListener("change", () => enqueue(() => restoreTrashVideo(v.id)));
        const label = document.createElement("span");
        label.textContent = "Restore";
        restoreLabel.append(restore, label);
        li.append(restoreLabel);
      }
      li.append(del);
      listEl.append(li);
    }
    if (pendingFocusIndex !== null) {
      const items = focusables();
      items[Math.min(pendingFocusIndex, items.length - 1)]?.focus();
      pendingFocusIndex = null;
    } else if (focusedId) {
      const row = listEl.querySelector(`.main[data-id="${CSS.escape(focusedId)}"]`);
      if (row) (focusedSlider ? row.querySelector(".bar") || row : row).focus();
      else headerControl().focus();
    }
  }

  function setPendingFocusIndex(index) {
    pendingFocusIndex = index;
  }

  return Object.freeze({ renderList, focusables, setPendingFocusIndex });
};
