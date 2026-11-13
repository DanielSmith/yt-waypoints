// Input routing preserves modal guards, native editing, and slider key ownership.
globalThis.WAYPOINTS_CREATE_POPUP_INPUT = ({
  document,
  transfer,
  player,
  actions,
  dialogs,
  exportsController,
  listController,
  markers,
  getSettings,
  getVideos,
  getTrash,
  searchEl,
  clearSearchEl,
  optionsToggle,
  isOptionsOpen,
  setOptionsOpen,
  requestSearch,
  updateHeaderMode,
  escapeClosesPopup,
  enqueue,
  setThumbnails,
  toggleMarkers,
  setStatus,
  closePopup,
}) => {
  let helpEscapeHeld = false;
  const { parseVideoLink, linkFor, navigateVideo } = player;
  const { loadVideos, importVideos, deleteVideo, controlPlayback, togglePlay, scrub } = actions;
  const { closeAbout, closeHelp, openHelp } = dialogs;
  const { closeFileSave, copyVideos, copyText, exportTranscript } = exportsController;
  const { renderList, focusables } = listController;
  const nativeControls = ["theme-select", "deletion-mode", "trash-days"].map((id) =>
    document.getElementById(id),
  );

  async function openPastedVideo(link) {
    const videos = await loadVideos();
    const target = { id: link.id, t: link.t ?? videos[link.id]?.t ?? 0 };
    await navigateVideo(target, link.t !== null);
    searchEl.value = "";
    renderList();
    closePopup();
  }

  function pasteIntoPopup(event) {
    if (
      event.defaultPrevented ||
      dialogs.helpOpen ||
      dialogs.aboutOpen ||
      exportsController.fileSaveOpen ||
      markers.editorOpen
    )
      return;
    const text = event.clipboardData?.getData("text/plain").trim();
    if (!text) return;
    if (/^[\[{]/.test(text)) {
      event.preventDefault();
      let incoming;
      try {
        // Validate the entire payload before queuing a single merge/write.
        incoming = transfer.parse(text);
      } catch (error) {
        setStatus(`Import failed: ${error.message}`);
        return;
      }
      enqueue(() => importVideos(incoming));
      return;
    }
    const link = parseVideoLink(text);
    // Ordinary pastes within search retain native insertion/selection behavior.
    if (!link && document.activeElement === searchEl) return;
    event.preventDefault();
    requestSearch();
    setOptionsOpen(false);
    searchEl.value = text;
    renderList();
    searchEl.focus();
    if (link) enqueue(() => openPastedVideo(link));
  }

  // Keyboard: ↑/↓ move between search and the filtered rows,
  // Enter opens, Space plays/pauses, ←/→ scrub by the configured amount,
  // Delete/Backspace removes the focused row.
  function handleKeydown(e) {
    const settings = getSettings();
    const savedVideos = getVideos();
    const trashVideos = getTrash();
    if (e.isComposing) return;
    if (
      markers.editorOpen &&
      !dialogs.helpOpen &&
      !dialogs.aboutOpen &&
      !exportsController.fileSaveOpen
    ) {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.repeat) {
        e.preventDefault();
        enqueue(markers.saveEditor);
        return;
      }
      if (
        e.key === "Escape" &&
        !escapeClosesPopup &&
        !document.getElementById("help-dialog").open &&
        !document.getElementById("about-dialog").open
      ) {
        e.preventDefault();
        enqueue(markers.closeEditor);
      }
      return;
    }
    const active = document.activeElement;
    const tag = (active?.tagName || active?.tag || "").toLowerCase();
    if (
      active?.isContentEditable ||
      tag === "textarea" ||
      (tag === "input" &&
        active !== searchEl &&
        !["range", "checkbox", "button", "submit"].includes(active.type))
    )
      return;
    if (dialogs.aboutOpen) {
      if (e.key === "Escape" && !escapeClosesPopup) {
        e.preventDefault();
        e.stopPropagation();
        closeAbout();
      }
      return;
    }
    if (
      e.key === "*" &&
      !e.ctrlKey &&
      !e.altKey &&
      !e.metaKey &&
      active !== searchEl &&
      !dialogs.helpOpen &&
      !exportsController.fileSaveOpen
    ) {
      e.preventDefault();
      if (!e.repeat) {
        const open = !isOptionsOpen();
        setOptionsOpen(open);
        if (!open) optionsToggle.focus();
      }
      return;
    }
    // Native select navigation/type-ahead must not invoke popup shortcuts.
    if (nativeControls.includes(document.activeElement)) return;
    if (exportsController.fileSaveOpen) {
      if (e.key === "Escape") {
        e.preventDefault();
        closeFileSave();
      }
      return;
    }
    if (exportsController.handleFormatKey(e)) return;
    // Chromium can consume Escape here. Firefox reserves it for closing the
    // entire toolbar popup, outside the control of content event listeners.
    if (e.key === "Escape" && escapeClosesPopup) return;
    if (e.key === "Escape" && (dialogs.helpOpen || helpEscapeHeld)) {
      e.preventDefault();
      e.stopPropagation();
      helpEscapeHeld = true;
      closeHelp();
      return;
    }
    if (document.activeElement?.type === "checkbox") return;
    const modified = e.ctrlKey || e.altKey || e.metaKey;
    const helpKey = e.key === "?" || e.key.toLowerCase() === "h";
    if (dialogs.helpOpen) {
      if (!modified && helpKey) {
        e.preventDefault();
        if (!e.repeat) closeHelp();
      }
      return;
    }
    if (modified) return;
    if (e.key === "M" && document.activeElement !== searchEl) {
      e.preventDefault();
      if (!e.repeat) toggleMarkers().catch((error) => setStatus(error.message));
      return;
    }
    if (helpKey && document.activeElement !== searchEl) {
      e.preventDefault();
      if (!e.repeat) openHelp();
      return;
    }
    if (e.key === "C" && document.activeElement !== searchEl) {
      e.preventDefault();
      if (!e.repeat) copyVideos();
      return;
    }
    if (
      e.key === "t" &&
      !e.ctrlKey &&
      !e.altKey &&
      !e.metaKey &&
      document.activeElement !== searchEl
    ) {
      e.preventDefault();
      if (!e.repeat)
        setThumbnails(!settings.showThumbnails).catch((error) => setStatus(error.message));
      return;
    }
    if (isOptionsOpen()) return;
    if (
      e.key === "/" &&
      !e.ctrlKey &&
      !e.altKey &&
      !e.metaKey &&
      document.activeElement !== searchEl
    ) {
      e.preventDefault();
      requestSearch();
      updateHeaderMode();
      searchEl.focus();
      return;
    }
    if (document.activeElement === optionsToggle) return;
    // Text editing keys belong to search; only ↑/↓ move into the result list.
    if (document.activeElement === searchEl && e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    // The document runs in capture, before a range can stop propagation.
    // Its arrows belong to that control, not the enclosing bookmark row.
    const keyTarget = e.target || document.activeElement;
    if (keyTarget?.type === "range" && ["ArrowLeft", "ArrowRight"].includes(e.key)) return;
    const items = focusables();
    const row =
      items.find(
        (item) => item.dataset.id && item.dataset.id === document.activeElement?.dataset?.id,
      ) || document.activeElement;
    const i = items.indexOf(row);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = e.key === "ArrowDown" ? Math.min(items.length - 1, i + 1) : Math.max(0, i - 1);
      items[next]?.focus();
      return;
    }
    if (!row?.classList.contains("main")) return;
    const id = row.dataset.id;
    if (!trashVideos[id] && ["m", "a", "[", "]"].includes(e.key)) {
      const key = e.key;
      e.preventDefault();
      if (!e.repeat)
        enqueue(() =>
          key === "m"
            ? markers.toggle(id)
            : key === "a"
              ? markers.edit(id)
              : markers.navigate(id, key === "]" ? 1 : -1),
        );
      return;
    }
    if (tag === "button" && ["Enter", " "].includes(e.key)) return;
    if (trashVideos[id]) {
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        enqueue(() => deleteVideo(id));
      } else if (e.key === "Enter") {
        e.preventDefault();
        row.click();
      }
      return;
    }

    if (e.key === "T") {
      e.preventDefault();
      if (!e.repeat) exportTranscript(id);
    } else if ([",", ".", "<", ">"].includes(e.key)) {
      e.preventDefault();
      const rate = e.shiftKey || e.key === "<" || e.key === ">";
      enqueue(() =>
        controlPlayback(id, rate ? "rate" : "frame", [".", ">"].includes(e.key) ? 1 : -1),
      );
    } else if (e.key === "u" || e.key === "c") {
      e.preventDefault();
      const video = savedVideos[id];
      if (e.repeat || !video) return;
      if (e.key === "c") copyVideos({ [id]: video }, false);
      else copyText(linkFor(video), "Copied video URL.", "Could not copy URL. Please try again.");
    } else if (e.key === "Enter") {
      e.preventDefault();
      row.click();
    } else if (e.key === " ") {
      e.preventDefault();
      enqueue(() => togglePlay(id));
    } else if (["ArrowLeft", "ArrowRight"].includes(e.key)) {
      e.preventDefault();
      const step = settings.scrubSeconds * (e.shiftKey ? settings.shiftMultiplier : 1);
      enqueue(() => scrub(id, e.key === "ArrowRight" ? step : -step));
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      listController.setPendingFocusIndex(i); // same position after re-render
      enqueue(() => deleteVideo(id));
    }
  }

  function handleKeyup(e) {
    if (e.key !== "Escape" || !helpEscapeHeld) return;
    e.preventDefault();
    e.stopPropagation();
    helpEscapeHeld = false;
  }

  function installKeyboard() {
    document.addEventListener("keydown", handleKeydown, true);
    document.addEventListener("keyup", handleKeyup, true);
  }

  function initControls() {
    searchEl.addEventListener("input", renderList);
    document.addEventListener("paste", pasteIntoPopup);
    clearSearchEl.addEventListener("click", () => {
      searchEl.value = "";
      renderList();
      searchEl.focus();
    });
  }

  return Object.freeze({ installKeyboard, initControls });
};
