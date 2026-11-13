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
}) => {
  let thumbnailChangePending = false;
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
    const bounded = (value, fallback, max) =>
      Number.isInteger(value) && value >= 1 && value <= max ? value : fallback;
    return {
      autoBookmark: typeof saved?.autoBookmark === "boolean" ? saved.autoBookmark : true,
      includeChannelNames:
        typeof saved?.includeChannelNames === "boolean" ? saved.includeChannelNames : true,
      showThumbnails: typeof saved?.showThumbnails === "boolean" ? saved.showThumbnails : true,
      showMarkers: typeof saved?.showMarkers === "boolean" ? saved.showMarkers : true,
      scrubSeconds: bounded(saved?.scrubSeconds, 10, 60),
      shiftMultiplier: bounded(saved?.shiftMultiplier, 3, 10),
      transcriptFormat: formats.get(saved?.transcriptFormat).id,
      offerSaveFile: saved?.offerSaveFile === true,
      theme: themeService.normalize(saved?.theme),
      deletionMode: saved?.deletionMode === "permanent" ? "permanent" : "timed",
      trashDays: storage.retentionDays(saved?.trashDays),
      showTrash: saved?.showTrash === true,
    };
  }

  function updateSettingsUI() {
    const settings = getSettings();
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
      if (!Number.isInteger(days) || days < 1 || days > 365) {
        updateSettingsUI();
        return setStatus("Choose a trash retention time from 1 to 365 days.");
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
    normalizeSettings,
    updateSettingsUI,
    changeSetting,
    toggleMarkers,
    setThumbnails,
    initControls,
    enable,
  });
};
