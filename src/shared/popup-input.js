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
  const shortcuts = WAYPOINTS_SHORTCUTS;
  const { matches, definitions } = shortcuts;
  let helpEscapeHeld = false;
  const { parseVideoLink, linkFor, navigateVideo } = player;
  const { loadSnapshot, importVideos, deleteVideo, controlPlayback, togglePlay, scrub } = actions;
  const { closeAbout, closeHelp, openHelp } = dialogs;
  const { closeFileSave, copyVideos, copyText, exportTranscript } = exportsController;
  const { renderList, focusables } = listController;
  const nativeControls = ["theme-select", "deletion-mode", "trash-days"].map((id) =>
    document.getElementById(id),
  );

  async function openPastedVideo(link) {
    const { videos } = await loadSnapshot();
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

  const tagOf = (element) => (element?.tagName || element?.tag || "").toLowerCase();
  const helpDialog = document.getElementById("help-dialog");
  const aboutDialog = document.getElementById("about-dialog");

  // Contexts consume application routing without suppressing native editing
  // unless they perform an explicit command (save/cancel/dismiss).
  function handleEditingContext(e, active) {
    if (
      markers.editorOpen &&
      !dialogs.helpOpen &&
      !dialogs.aboutOpen &&
      !exportsController.fileSaveOpen
    ) {
      if (matches("annotationSave", e.key) && (e.ctrlKey || e.metaKey) && !e.repeat) {
        e.preventDefault();
        enqueue(markers.saveEditor);
      } else if (
        matches("escape", e.key) &&
        !escapeClosesPopup &&
        !helpDialog.open &&
        !aboutDialog.open
      ) {
        e.preventDefault();
        enqueue(markers.closeEditor);
      }
      return true;
    }
    const tag = tagOf(active);
    return Boolean(
      active?.isContentEditable ||
      tag === "textarea" ||
      (tag === "input" &&
        active !== searchEl &&
        !["range", "checkbox", "button", "submit"].includes(active.type)),
    );
  }

  function handleAboutContext(e) {
    if (!dialogs.aboutOpen) return false;
    if (matches("escape", e.key) && !escapeClosesPopup) {
      e.preventDefault();
      e.stopPropagation();
      closeAbout();
    }
    return true;
  }

  // This global command intentionally precedes native selects/checkboxes and
  // the format picker. Text, annotation, About, Help and file-save guards win.
  function handleSettingsShortcut(e, active) {
    if (
      !matches("settings", e.key) ||
      e.ctrlKey ||
      e.altKey ||
      e.metaKey ||
      active === searchEl ||
      dialogs.helpOpen ||
      exportsController.fileSaveOpen
    )
      return false;
    e.preventDefault();
    if (!e.repeat) {
      const open = !isOptionsOpen();
      setOptionsOpen(open);
      if (!open) optionsToggle.focus();
    }
    return true;
  }

  function handleControlOrModalContext(e, active) {
    if (nativeControls.includes(active)) return true;
    if (exportsController.fileSaveOpen) {
      if (matches("escape", e.key)) {
        e.preventDefault();
        closeFileSave();
      }
      return true;
    }
    if (exportsController.handleFormatKey(e)) return true;
    // Firefox reserves toolbar-popup Escape outside content event control.
    if (matches("escape", e.key) && escapeClosesPopup) return true;
    if (matches("escape", e.key) && (dialogs.helpOpen || helpEscapeHeld)) {
      e.preventDefault();
      e.stopPropagation();
      helpEscapeHeld = true;
      closeHelp();
      return true;
    }
    if (active?.type === "checkbox") return true;
    if (dialogs.helpOpen) {
      if (!e.ctrlKey && !e.altKey && !e.metaKey && matches("help", e.key)) {
        e.preventDefault();
        if (!e.repeat) closeHelp();
      }
      return true;
    }
    return false;
  }

  function handleGlobalCommand(e, active) {
    if (active === searchEl) return false;
    if (matches("markerVisibility", e.key)) {
      e.preventDefault();
      if (!e.repeat) toggleMarkers().catch((error) => setStatus(error.message));
    } else if (matches("help", e.key)) {
      e.preventDefault();
      if (!e.repeat) openHelp();
    } else if (matches("allJson", e.key)) {
      e.preventDefault();
      if (!e.repeat) copyVideos();
    } else if (matches("thumbnails", e.key)) {
      e.preventDefault();
      if (!e.repeat)
        setThumbnails(!getSettings().showThumbnails).catch((error) => setStatus(error.message));
    } else return false;
    return true;
  }

  function handleSearchShortcut(e, active) {
    if (active === searchEl || !matches("focusSearch", e.key)) return false;
    e.preventDefault();
    requestSearch();
    updateHeaderMode();
    searchEl.focus();
    return true;
  }

  function usesNativeListInput(e, active) {
    if (active === optionsToggle) return true;
    if (active === searchEl && !matches("selectVideo", e.key)) return true;
    // Document capture runs before a slider can stop propagation itself.
    const target = e.target || active;
    return target?.type === "range" && matches("scrub", e.key);
  }

  function handleListCommands(e, active) {
    const settings = getSettings();
    const savedVideos = getVideos();
    const trashVideos = getTrash();
    const tag = tagOf(active);
    const items = focusables();
    const row =
      items.find((item) => item.dataset.id && item.dataset.id === active?.dataset?.id) || active;
    const i = items.indexOf(row);
    if (matches("selectVideo", e.key)) {
      e.preventDefault();
      const next =
        e.key === definitions.selectVideo.next
          ? Math.min(items.length - 1, i + 1)
          : Math.max(0, i - 1);
      items[next]?.focus();
      return;
    }
    if (!row?.classList.contains("main")) return;
    const id = row.dataset.id;
    if (
      !trashVideos[id] &&
      (matches("markerToggle", e.key) ||
        matches("annotationEdit", e.key) ||
        matches("markerNavigation", e.key))
    ) {
      const key = e.key;
      e.preventDefault();
      if (!e.repeat)
        enqueue(() =>
          matches("markerToggle", key)
            ? markers.toggle(id)
            : matches("annotationEdit", key)
              ? markers.edit(id)
              : markers.navigate(id, key === definitions.markerNavigation.next ? 1 : -1),
        );
      return;
    }
    if (tag === "button" && (matches("openVideo", e.key) || matches("playPause", e.key))) return;
    if (trashVideos[id]) {
      if (matches("deleteBookmark", e.key)) {
        e.preventDefault();
        enqueue(() => deleteVideo(id));
      } else if (matches("openVideo", e.key)) {
        e.preventDefault();
        row.click();
      }
      return;
    }

    if (matches("transcript", e.key)) {
      e.preventDefault();
      if (!e.repeat) exportTranscript(id);
    } else if (matches("playbackFrame", e.key) || matches("playbackRate", e.key)) {
      e.preventDefault();
      const rate = e.shiftKey || matches("playbackRate", e.key);
      enqueue(() =>
        controlPlayback(
          id,
          rate ? "rate" : "frame",
          e.key === definitions.playbackFrame.next || e.key === definitions.playbackRate.next
            ? 1
            : -1,
        ),
      );
    } else if (matches("videoUrl", e.key) || matches("videoJson", e.key)) {
      e.preventDefault();
      const video = savedVideos[id];
      if (e.repeat || !video) return;
      if (matches("videoJson", e.key)) copyVideos({ [id]: video }, false);
      else copyText(linkFor(video), "Copied video URL.", "Could not copy URL. Please try again.");
    } else if (matches("openVideo", e.key)) {
      e.preventDefault();
      row.click();
    } else if (matches("playPause", e.key)) {
      e.preventDefault();
      enqueue(() => togglePlay(id));
    } else if (matches("scrub", e.key)) {
      e.preventDefault();
      const step = settings.scrubSeconds * (e.shiftKey ? settings.shiftMultiplier : 1);
      enqueue(() => scrub(id, e.key === definitions.scrub.next ? step : -step));
    } else if (matches("deleteBookmark", e.key)) {
      e.preventDefault();
      listController.setPendingFocusIndex(i); // same position after re-render
      enqueue(() => deleteVideo(id));
    }
  }
  // Keep precedence here, not in shortcut metadata or a dispatch framework.
  function handleKeydown(e) {
    const active = document.activeElement;
    if (e.isComposing) return;
    if (handleEditingContext(e, active)) return;
    if (handleAboutContext(e)) return;
    if (handleSettingsShortcut(e, active)) return;
    if (handleControlOrModalContext(e, active)) return;
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (handleGlobalCommand(e, active)) return;
    if (isOptionsOpen()) return;
    if (handleSearchShortcut(e, active)) return;
    if (usesNativeListInput(e, active)) return;
    handleListCommands(e, active);
  }

  function handleKeyup(e) {
    if (!matches("escape", e.key) || !helpEscapeHeld) return;
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
