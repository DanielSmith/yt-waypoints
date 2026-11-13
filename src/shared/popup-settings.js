// Options normalization, field-intent capture, persistence, and control binding.
globalThis.WAYPOINTS_CREATE_POPUP_SETTINGS = ({
  document,
  api,
  storage,
  theme: themeService,
  formats,
  enqueue,
  getSettings,
  onPersisted,
  refresh,
  updateFormatUI,
  setStatus,
  closeFormatMenu,
}) => {
  const policy = WAYPOINTS_SETTINGS_POLICY;
  const { defaults, numeric } = policy;
  let thumbnailChangePending = false;
  const optionsPanel = document.getElementById("options-panel");
  const groups = [...optionsPanel.querySelectorAll(".option-group")];
  const disclosures = WAYPOINTS_CREATE_DISCLOSURES(".option-group-content");

  function resetGroups() {
    disclosures.settle();
    for (const group of groups) group.open = false;
    optionsPanel.scrollTop = 0;
  }

  function focusFirstGroup() {
    groups[0]?.querySelector("summary").focus();
  }

  function navigateGroups(event) {
    if (
      event.defaultPrevented ||
      event.isComposing ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.shiftKey ||
      !["ArrowUp", "ArrowDown"].includes(event.key)
    )
      return;
    const headings = groups.map((group) => group.querySelector("summary"));
    const index = headings.indexOf(document.activeElement);
    // Never take arrows from sliders, selects, inputs or the transcript picker.
    if (index < 0) return;
    const next = Math.max(
      0,
      Math.min(headings.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)),
    );
    event.preventDefault();
    event.stopPropagation();
    headings[next].focus();
    headings[next].scrollIntoView({ block: "nearest" });
  }

  const themeSelect = document.getElementById("theme-select");
  const deletionModeEl = document.getElementById("deletion-mode");
  const trashDaysEl = document.getElementById("trash-days");
  const showTrashEl = document.getElementById("show-trash");
  const emptyTrashEl = document.getElementById("empty-trash");
  const autoBookmarkEl = document.getElementById("auto-bookmark");
  const includeChannelsEl = document.getElementById("include-channel-names");
  const thumbnailsEl = document.getElementById("show-thumbnails");
  const markersEl = document.getElementById("show-markers");
  const scrubSecondsEl = document.getElementById("scrub-seconds");
  const shiftMultiplierEl = document.getElementById("shift-multiplier");
  const offerSaveFileEl = document.getElementById("offer-save-file");

  function normalizeSettings(saved = {}) {
    return {
      autoBookmark:
        typeof saved?.autoBookmark === "boolean" ? saved.autoBookmark : defaults.autoBookmark,
      includeChannelNames:
        typeof saved?.includeChannelNames === "boolean"
          ? saved.includeChannelNames
          : defaults.includeChannelNames,
      showThumbnails:
        typeof saved?.showThumbnails === "boolean" ? saved.showThumbnails : defaults.showThumbnails,
      showMarkers:
        typeof saved?.showMarkers === "boolean" ? saved.showMarkers : defaults.showMarkers,
      scrubSeconds: policy.normalizeInteger(saved?.scrubSeconds, numeric.scrubSeconds),
      shiftMultiplier: policy.normalizeInteger(saved?.shiftMultiplier, numeric.shiftMultiplier),
      transcriptFormat: formats.get(saved?.transcriptFormat).id,
      offerSaveFile:
        typeof saved?.offerSaveFile === "boolean" ? saved.offerSaveFile : defaults.offerSaveFile,
      theme: themeService.normalize(saved?.theme),
      deletionMode: saved?.deletionMode === "permanent" ? "permanent" : defaults.deletionMode,
      trashDays: storage.retentionDays(saved?.trashDays),
      showTrash: typeof saved?.showTrash === "boolean" ? saved.showTrash : defaults.showTrash,
    };
  }

  function updateSettingsUI() {
    const settings = getSettings();
    const themeLabel = themeService.choices.find((theme) => theme.id === settings.theme)?.label;
    const summaries = {
      appearance: `${themeLabel} · thumbnails ${settings.showThumbnails ? "on" : "off"} · markers ${settings.showMarkers ? "on" : "off"}`,
      bookmarks: `Auto-bookmark ${settings.autoBookmark ? "on" : "off"} · ${settings.includeChannelNames ? "titles & channels" : "titles only"}`,
      playback: `${settings.scrubSeconds}s · Shift ${settings.scrubSeconds * settings.shiftMultiplier}s`,
      trash: `${settings.deletionMode === "timed" ? `Trash for ${settings.trashDays} days` : "Delete immediately"} · ${settings.showTrash ? "visible" : "hidden"}`,
      transcripts: formats.get(settings.transcriptFormat).label,
      backup: `JSON transfer · file offer ${settings.offerSaveFile ? "on" : "off"}`,
    };
    for (const [group, summary] of Object.entries(summaries))
      document.getElementById(`${group}-summary`).textContent = summary;
    deletionModeEl.value = settings.deletionMode;
    trashDaysEl.value = String(settings.trashDays);
    showTrashEl.checked = settings.showTrash;
    themeSelect.value = settings.theme;
    themeService.apply(settings.theme);
    autoBookmarkEl.checked = settings.autoBookmark;
    includeChannelsEl.checked = settings.includeChannelNames;
    thumbnailsEl.checked = settings.showThumbnails;
    markersEl.checked = settings.showMarkers;
    thumbnailsEl.disabled = thumbnailChangePending;
    offerSaveFileEl.checked = settings.offerSaveFile;
    updateFormatUI(settings.transcriptFormat);
    scrubSecondsEl.value = settings.scrubSeconds;
    shiftMultiplierEl.value = settings.shiftMultiplier;
    document.getElementById("scrub-value").textContent = `${settings.scrubSeconds} s`;
    document.getElementById("multiplier-value").textContent = `×${settings.shiftMultiplier}`;
    document.getElementById("shift-preview").textContent =
      `Shift + ← or → moves ${settings.scrubSeconds * settings.shiftMultiplier} seconds.`;
  }

  function changeSetting(name, value) {
    // Capture intent at the event, before an earlier save refreshes the form.
    return enqueue(() => persistSettings(normalizeSettings({ ...getSettings(), [name]: value })));
  }
  function toggleMarkers() {
    return enqueue(async () => {
      const showMarkers = !getSettings().showMarkers;
      await persistSettings({ ...getSettings(), showMarkers });
      setStatus(showMarkers ? "Markers shown." : "Markers hidden.");
    });
  }

  async function persistSettings(next) {
    const autoBookmarkChanged = next.autoBookmark !== getSettings().autoBookmark;
    await api.storage.local.set({ settings: next });
    onPersisted(next, autoBookmarkChanged);
    updateSettingsUI();
    await storage.expire();
    await refresh();
  }

  async function setThumbnails(show) {
    if (thumbnailChangePending) return;
    thumbnailChangePending = true;
    updateSettingsUI();
    try {
      await enqueue(() => persistSettings({ ...getSettings(), showThumbnails: show }));
    } finally {
      thumbnailChangePending = false;
      updateSettingsUI();
    }
  }

  function initControls() {
    for (const [control, rule] of [
      [scrubSecondsEl, numeric.scrubSeconds],
      [shiftMultiplierEl, numeric.shiftMultiplier],
      [trashDaysEl, numeric.trashDays],
    ]) {
      control.min = String(rule.min);
      control.max = String(rule.max);
      control.step = "1";
      control.defaultValue = String(rule.defaultValue);
    }
    document.getElementById("trash-expiry-help").textContent =
      `Default: ${numeric.trashDays.defaultValue} days${numeric.trashDays.defaultValue === 7 ? " (one week)" : ""}. Applies to existing trash too. Cleanup runs while this popup or a YouTube tab with the extension is active.`;
    optionsPanel.addEventListener("keydown", navigateGroups);
    for (const group of groups) {
      group.querySelector("summary").addEventListener("click", (event) => {
        event.preventDefault();
        // Closing a group also dismisses any active format preview it contains.
        closeFormatMenu(false);
        disclosures.toggle(group);
      });
    }
    markersEl.addEventListener("change", () => changeSetting("showMarkers", markersEl.checked));
    themeSelect.replaceChildren(
      ...themeService.choices.map((theme) => {
        const option = document.createElement("option");
        option.value = theme.id;
        option.textContent = theme.label;
        return option;
      }),
    );
    themeSelect.addEventListener("change", () => {
      const theme = themeService.normalize(themeSelect.value);
      enqueue(() => persistSettings({ ...getSettings(), theme }));
    });
    autoBookmarkEl.addEventListener("change", () =>
      changeSetting("autoBookmark", autoBookmarkEl.checked),
    );
    includeChannelsEl.addEventListener("change", () =>
      changeSetting("includeChannelNames", includeChannelsEl.checked),
    );
    offerSaveFileEl.addEventListener("change", () =>
      changeSetting("offerSaveFile", offerSaveFileEl.checked),
    );
    deletionModeEl.addEventListener("change", () =>
      changeSetting("deletionMode", deletionModeEl.value),
    );
    showTrashEl.addEventListener("change", () => changeSetting("showTrash", showTrashEl.checked));
    trashDaysEl.addEventListener("change", () => {
      const days = Number(trashDaysEl.value);
      if (!policy.isIntegerInRange(days, numeric.trashDays)) {
        updateSettingsUI();
        return setStatus(
          `Choose a trash retention time from ${numeric.trashDays.min} to ${numeric.trashDays.max} days.`,
        );
      }
      changeSetting("trashDays", days);
    });
    thumbnailsEl.addEventListener("change", () => {
      setThumbnails(thumbnailsEl.checked).catch((error) => setStatus(error.message));
    });
    for (const slider of [scrubSecondsEl, shiftMultiplierEl]) {
      slider.addEventListener("input", () => {
        document.getElementById("scrub-value").textContent = `${scrubSecondsEl.value} s`;
        document.getElementById("multiplier-value").textContent = `×${shiftMultiplierEl.value}`;
        document.getElementById("shift-preview").textContent =
          `Shift + ← or → moves ${Number(scrubSecondsEl.value) * Number(shiftMultiplierEl.value)} seconds.`;
      });
      slider.addEventListener("change", () =>
        changeSetting(
          slider === scrubSecondsEl ? "scrubSeconds" : "shiftMultiplier",
          Number(slider.value),
        ),
      );
    }
  }

  function enable() {
    for (const control of [deletionModeEl, trashDaysEl, showTrashEl, emptyTrashEl])
      control.disabled = false;
  }

  return Object.freeze({
    resetGroups,
    focusFirstGroup,
    normalizeSettings,
    updateSettingsUI,
    changeSetting,
    toggleMarkers,
    setThumbnails,
    initControls,
    enable,
  });
};
