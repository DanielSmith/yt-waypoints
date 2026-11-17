// Settings normalization, field-intent capture, persistence, and control binding.
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
  onThemeChange = () => {},
}) => {
  const { navigateSummaries } = WAYPOINTS_POPUP_DOM;
  const policy = WAYPOINTS_SETTINGS_POLICY;
  const { defaults, numeric } = policy;
  let thumbnailChangePending = false;
  const settingsPanel = document.getElementById("settings-panel");
  const groups = [...settingsPanel.querySelectorAll(".settings-group")];
  const headings = groups.map((group) => group.querySelector("summary"));
  const disclosures = WAYPOINTS_CREATE_DISCLOSURES(".settings-group-content");

  function resetGroups() {
    disclosures.settle();
    for (const group of groups) group.open = false;
    settingsPanel.scrollTop = 0;
  }

  function focusFirstGroup() {
    headings[0]?.focus();
  }

  function navigateGroups(event) {
    // Unlike Help, arrows from form controls must not enter the headings.
    navigateSummaries(event, headings, document.activeElement);
  }

  const themeSelect = document.getElementById("theme-select");
  let themeChoices = "";
  function populateThemeChoices() {
    const choices = themeService.choices;
    const signature = JSON.stringify(choices);
    if (signature === themeChoices) return;
    themeChoices = signature;
    themeSelect.replaceChildren(
      ...choices.map((theme) => {
        const option = document.createElement("option");
        option.value = theme.id;
        option.textContent = theme.label;
        return option;
      }),
    );
  }
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
  const scrubValueEl = document.getElementById("scrub-value");
  const multiplierValueEl = document.getElementById("multiplier-value");
  const shiftPreviewEl = document.getElementById("shift-preview");
  const trashExpiryHelpEl = document.getElementById("trash-expiry-help");
  const summaryEls = Object.fromEntries(
    ["appearance", "bookmarks", "playback", "trash", "transcripts", "backup"].map((name) => [
      name,
      document.getElementById(`${name}-summary`),
    ]),
  );
  // Plain checkboxes share one field binding; thumbnails retain their pending guard.
  const checkboxControls = [
    ["autoBookmark", autoBookmarkEl],
    ["includeChannelNames", includeChannelsEl],
    ["showMarkers", markersEl],
    ["offerSaveFile", offerSaveFileEl],
    ["showTrash", showTrashEl],
  ];

  function updateScrubPreview({ scrubSeconds, shiftMultiplier }) {
    scrubValueEl.textContent = `${scrubSeconds} s`;
    multiplierValueEl.textContent = `×${shiftMultiplier}`;
    shiftPreviewEl.textContent = `Shift + ← or → moves ${Number(scrubSeconds) * Number(shiftMultiplier)} seconds.`;
  }

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
    populateThemeChoices();
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
      summaryEls[group].textContent = summary;
    deletionModeEl.value = settings.deletionMode;
    trashDaysEl.value = String(settings.trashDays);
    themeSelect.value = settings.theme;
    if (themeService.sync) themeService.sync(settings.theme);
    else themeService.apply(settings.theme);
    for (const [name, control] of checkboxControls) control.checked = settings[name];
    thumbnailsEl.checked = settings.showThumbnails;
    thumbnailsEl.disabled = thumbnailChangePending;
    updateFormatUI(settings.transcriptFormat);
    scrubSecondsEl.value = settings.scrubSeconds;
    shiftMultiplierEl.value = settings.shiftMultiplier;
    updateScrubPreview(settings);
  }

  function changeSetting(name, value) {
    // Capture intent at the event, before an earlier save refreshes the form.
    return enqueue(() =>
      persistSettings(normalizeSettings({ ...getSettings(), [name]: value }), [name]),
    );
  }
  function toggleMarkers() {
    // Shortcut toggles must observe preceding queued writes. They are not
    // absolute form values to capture early or enqueue again via changeSetting.
    return enqueue(async () => {
      const showMarkers = !getSettings().showMarkers;
      await persistSettings({ ...getSettings(), showMarkers }, ["showMarkers"]);
      setStatus(showMarkers ? "Markers shown." : "Markers hidden.");
    });
  }

  async function persistSettings(next, fields) {
    const autoBookmarkChanged = next.autoBookmark !== getSettings().autoBookmark;
    if (themeService.persistSettings) {
      next = normalizeSettings(await themeService.persistSettings(next, fields, normalizeSettings));
    } else await api.storage.local.set({ settings: next });
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
      await changeSetting("showThumbnails", show);
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
    trashExpiryHelpEl.textContent = `Default: ${numeric.trashDays.defaultValue} days${numeric.trashDays.defaultValue === 7 ? " (one week)" : ""}. Applies to existing trash too. Cleanup runs while this popup or a YouTube tab with the extension is active.`;
    settingsPanel.addEventListener("keydown", navigateGroups);
    for (const [index, group] of groups.entries()) {
      headings[index].addEventListener("click", (event) => {
        event.preventDefault();
        // Closing a group also dismisses any active format preview it contains.
        closeFormatMenu(false);
        disclosures.toggle(group);
      });
    }
    populateThemeChoices();
    themeSelect.addEventListener("change", () => {
      onThemeChange();
      changeSetting("theme", themeService.normalize(themeSelect.value));
    });
    for (const [name, control] of checkboxControls)
      control.addEventListener("change", () => changeSetting(name, control.checked));
    deletionModeEl.addEventListener("change", () =>
      changeSetting("deletionMode", deletionModeEl.value),
    );
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
        // Preview the current controls, not the last persisted settings. Saving
        // still happens only on change, with each field captured at that event.
        updateScrubPreview({
          scrubSeconds: scrubSecondsEl.value,
          shiftMultiplier: shiftMultiplierEl.value,
        });
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
