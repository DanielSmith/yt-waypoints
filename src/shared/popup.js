// Copyright 2026 Daniel Smith
// SPDX-License-Identifier: Apache-2.0
import { createPopupRefresh } from "./popup-refresh.mjs";
import { createAlapTransfer, importAlapBackup } from "./alap-transfer.mjs";
import { createMacroStore } from "./alap-macro-store.mjs";
import { createThemeImportController } from "./popup-theme-import.mjs";

const api = globalThis.browser ?? globalThis.chrome;
const backupTransfer = createAlapTransfer(WAYPOINTS_TRANSFER);
const macroStore = createMacroStore(api);

function chooseMacroConflicts(names) {
  const dialog = document.getElementById("macro-import-dialog");
  const form = document.getElementById("macro-import-form");
  const preview = names
    .slice(0, 8)
    .map((name) => "@" + name)
    .join(", ");
  document.getElementById("macro-import-names").textContent =
    preview + (names.length > 8 ? ` and ${names.length - 8} more` : "");
  return new Promise((resolve) => {
    function closed() {
      const choice = dialog.returnValue;
      resolve(["keep", "replace", "rename"].includes(choice) ? choice : null);
    }
    form.reset();
    dialog.returnValue = "";
    dialog.showModal();
    dialog.addEventListener("close", closed, { once: true });
  });
}

const fmt = WAYPOINTS_TIME_FORMAT.displayTimestamp;
const shortcuts = WAYPOINTS_SHORTCUTS;
const WATCH_RE = /^https:\/\/(www\.|m\.)?youtube\.com\/watch\?/;
const CHAPTER_REFRESH_INTERVAL_MS = 5000;
const TRASH_CLEANUP_INTERVAL_MS = 60000;
let queue = Promise.resolve();
const refreshCoordinator = createPopupRefresh({
  read: () => WAYPOINTS_STORAGE.read(),
  commit: renderSnapshot,
});

const playerClient = WAYPOINTS_CREATE_PLAYER_CLIENT({
  api,
  actions: WAYPOINTS_PLAYER_ACTIONS,
  resultSchema: WAYPOINTS_PLAYER_RESULTS,
  legacyFallback: WAYPOINTS_PLAYER_LEGACY_FALLBACK,
  watchPattern: WATCH_RE,
});
const { activeTab, videoIdOf, navigateVideo, linkFor } = playerClient;

const listEl = document.getElementById("list");
const statusEl = document.getElementById("status");
const restoreBookmarkEl = document.getElementById("restore-bookmark");
let deletedBookmark = null;
let showRestoreBookmark = false;
let searchRequested = false;

const searchEl = document.getElementById("search");
const searchControl = document.getElementById("search-control");
const actionsEl = document.querySelector(".actions");
const clearSearchEl = document.getElementById("clear-search");
let savedVideos = {};
let trashVideos = {};
let currentDeleted = false;
const hintEl = document.getElementById("hint");
hintEl.textContent = `${shortcuts.hint("focusSearch")} search · ${shortcuts.hint("playPause")} play · ${shortcuts.hint("openVideo")} open · ${shortcuts.hint("help")} help`;
const settingsToggle = document.getElementById("settings-toggle");
settingsToggle.setAttribute("title", `Settings (${shortcuts.label("settings")})`);
settingsToggle.setAttribute("aria-keyshortcuts", shortcuts.definitions.settings.keys.join(" "));
const settingsPanel = document.getElementById("settings-panel");
const emptyTrashEl = document.getElementById("empty-trash");
let settings;
const settingsController = WAYPOINTS_CREATE_POPUP_SETTINGS({
  document,
  api,
  storage: WAYPOINTS_STORAGE,
  theme: WAYPOINTS_THEME,
  formats: WAYPOINTS_TRANSCRIPT,
  enqueue,
  getSettings: () => settings,
  onPersisted(next, autoBookmarkChanged) {
    settings = next;
    if (autoBookmarkChanged) searchRequested = false;
  },
  refresh: () => render(),
  setStatus,
  closeFormatMenu: (restoreFocus) => exportsController.closeFormatMenu(restoreFocus),
  updateFormatUI: (formatId) => exportsController.updateFormatUI(formatId),
  onThemeChange: () =>
    themeImports.cancel({ focus: false }).catch((error) => setStatus(error.message)),
});
const { normalizeSettings, updateSettingsUI, changeSetting, setThumbnails } = settingsController;
settings = normalizeSettings();
let onVideo = false;
let currentId = null;
let settingsOpen = false;

const fileSaveController = WAYPOINTS_CREATE_FILE_SAVE({
  document,
  listEl,
  headerControl,
  setStatus,
  beforeOpen() {
    closeHelp();
    closeAbout();
    exportsController.closeFormatMenu(false);
  },
});

const exportsController = WAYPOINTS_CREATE_POPUP_EXPORTS({
  document,
  formats: WAYPOINTS_TRANSCRIPT,
  transfer: backupTransfer,
  readMacroLibrary: async () => (await macroStore.read()).library,
  player: playerClient,
  getSettings: () => settings,
  getVideos: () => savedVideos,
  getCurrentId: () => currentId,
  changeSetting,
  setStatus,
  fileSave: fileSaveController,
});
const { closeFormatMenu } = exportsController;
const themeImports = createThemeImportController({
  document,
  service: WAYPOINTS_THEME,
  getSelection: () => settings.theme,
  setStatus,
  openPicker: WAYPOINTS_THEME_PICKER_IN_TAB
    ? () => api.tabs.create({ url: api.runtime.getURL("themes.html") })
    : undefined,
});
function setSettingsOpen(open) {
  if (open && markers.editorOpen) return setStatus("Save or cancel the open note first.");
  const opening = open && !settingsOpen;
  if (open) {
    exportsController.captureTarget();
    if (!settingsOpen) settingsController.resetGroups();
  } else {
    closeFormatMenu(false);
    themeImports.cancel({ focus: false }).catch((error) => setStatus(error.message));
  }
  settingsOpen = open;
  settingsPanel.hidden = !open;
  document.body.classList.toggle("settings-open", open);
  document.documentElement.classList.toggle("settings-open", open);
  updateHeaderMode();
  actionsEl.classList.toggle("settings-open", open);
  listEl.hidden = open;
  hintEl.hidden = open;
  document.getElementById("settings-toggle-label").hidden = !open;
  const toggleLabel = open ? "Hide settings" : "Settings";
  settingsToggle.setAttribute("aria-label", toggleLabel);
  settingsToggle.setAttribute("title", `${toggleLabel} (${shortcuts.label("settings")})`);
  settingsToggle.setAttribute("aria-expanded", String(open));
  // Capture the selected video first, then move into the now-visible headings.
  if (opening) settingsController.focusFirstGroup();
}
// Factories expose methods first; init() binds controls after all wiring exists.
const dialogs = WAYPOINTS_CREATE_POPUP_DIALOGS({
  document,
  getSettings: () => settings,
  escapeClosesPopup: WAYPOINTS_ESCAPE_CLOSES_POPUP,
  isFileSaveOpen: () => exportsController.fileSaveOpen,
  closeFormatMenu,
  listEl,
  headerControl,
});
const { updateHint, closeHelp, closeAbout } = dialogs;

const bookmarks = WAYPOINTS_CREATE_POPUP_BOOKMARKS({
  storage: WAYPOINTS_STORAGE,
  storeBackup: (incoming) =>
    importAlapBackup(incoming, {
      storage: WAYPOINTS_STORAGE,
      macroStore,
      chooseConflicts: chooseMacroConflicts,
    }),
  player: playerClient,
  watchPattern: WATCH_RE,
  getSettings: () => settings,
  getCurrentId: () => currentId,
  setStatus,
  showPlayer,
  fmt,
  refresh: () => render(),
  openVideo,
  async onImport() {
    showRestoreBookmark = false;
    searchRequested = true;
    searchEl.value = "";
    setSettingsOpen(false);
    await render();
    searchEl.focus();
  },
  onTrash(bookmark) {
    deletedBookmark = bookmark;
    showRestoreBookmark = true;
  },
  clearRestoreState(showSearch = true) {
    deletedBookmark = null;
    showRestoreBookmark = false;
    if (showSearch) searchRequested = true;
  },
  getRestoreBookmark: () => (showRestoreBookmark ? deletedBookmark : null),
});
const { bookmarkCurrent, refreshCurrentChannel, restoreBookmark, emptyTrash } = bookmarks;

const annotationEditor = WAYPOINTS_CREATE_ANNOTATION_EDITOR({
  document,
  enqueue,
  maxNoteCharacters: WAYPOINTS_MARKERS.MAX_NOTE_CHARACTERS,
  fmt,
  refresh: () => render(),
  focusRow(id) {
    (listEl.querySelector(`.main[data-id="${CSS.escape(id)}"]`) || headerControl()).focus();
  },
  onSaved: () => setStatus("Annotation saved."),
});
const markers = WAYPOINTS_CREATE_POPUP_MARKERS({
  document,
  storage: WAYPOINTS_STORAGE,
  data: WAYPOINTS_MARKERS,
  player: playerClient,
  getSettings: () => settings,
  annotationEditor,
  refresh: () => render(),
  setStatus,
  fmt,
});

const listController = WAYPOINTS_CREATE_POPUP_LIST({
  document,
  listEl,
  searchEl,
  clearSearchEl,
  getVideos: () => savedVideos,
  getTrash: () => trashVideos,
  getSettings: () => settings,
  updateHeaderMode,
  headerControl,
  fmt,
  linkFor,
  openVideo,
  actions: bookmarks,
  enqueue,
  setStatus,
  refresh: () => render(),
  markers,
});
const { renderList } = listController;

const inputController = WAYPOINTS_CREATE_POPUP_INPUT({
  document,
  transfer: backupTransfer,
  isImportDialogOpen: () => document.getElementById("macro-import-dialog")?.open,
  player: playerClient,
  actions: bookmarks,
  dialogs,
  exportsController,
  listController,
  markers,
  getSettings: () => settings,
  getVideos: () => savedVideos,
  getTrash: () => trashVideos,
  searchEl,
  clearSearchEl,
  settingsToggle,
  isSettingsOpen: () => settingsOpen,
  setSettingsOpen,
  updateHeaderMode,
  escapeClosesPopup: WAYPOINTS_ESCAPE_CLOSES_POPUP,
  requestSearch() {
    showRestoreBookmark = false;
    searchRequested = true;
  },
  enqueue,
  setThumbnails,
  toggleMarkers: settingsController.toggleMarkers,
  setStatus,
  closePopup: () => window.close(),
});

// Holding an arrow key fires keydowns faster than storage round-trips;
// run scrub/play actions one at a time so writes don't clobber each other.
function enqueue(fn) {
  queue = queue.then(fn).catch((e) => setStatus(e.message));
  return queue;
}

function setStatus(msg) {
  statusEl.textContent = msg;
}

function showPlayer(state) {
  setStatus(`${state.paused ? "⏸ Paused" : "▶ Playing"} at ${fmt(state.t)}`);
}

async function openVideo(v) {
  await navigateVideo(v);
  window.close();
}

function headerControl() {
  return showingBookmarkButton() ? restoreBookmarkEl : searchEl;
}

function showingBookmarkButton() {
  return (
    showRestoreBookmark ||
    (!searchRequested &&
      onVideo &&
      !savedVideos[currentId] &&
      (!settings.autoBookmark || Boolean(trashVideos[currentId]) || currentDeleted))
  );
}

function updateHeaderMode() {
  const showButton = showingBookmarkButton();
  searchControl.hidden = settingsOpen || showButton;
  restoreBookmarkEl.hidden = settingsOpen || !showButton;
  restoreBookmarkEl.textContent =
    showRestoreBookmark || trashVideos[currentId] ? "Restore bookmark" : "Add bookmark";
  restoreBookmarkEl.title =
    showRestoreBookmark && deletedBookmark
      ? `Restore ${deletedBookmark.title || deletedBookmark.id}`
      : "Bookmark the current video";
  if (
    !settingsOpen &&
    ((showButton && document.activeElement === searchEl) ||
      (!showButton && document.activeElement === restoreBookmarkEl))
  ) {
    headerControl().focus();
  }
}

function render() {
  return refreshCoordinator.refresh();
}

function renderSnapshot(snapshot) {
  markers.sync(snapshot);
  savedVideos = snapshot.videos;
  trashVideos = snapshot.trash;
  currentDeleted = snapshot.records[currentId]?.life.deleted === true;
  document.getElementById("trash-count").textContent =
    `${Object.keys(trashVideos).length} in trash. Empty trash permanently deletes these bookmarks.`;
  updateHint();
  renderList();
}

async function init() {
  let expiryError = null;
  try {
    await WAYPOINTS_STORAGE.expire();
  } catch (error) {
    expiryError = error.message;
  }
  document.getElementById("shortcut-help").textContent = WAYPOINTS_SHORTCUT_HELP;
  const [{ settings: saved }, tab] = await Promise.all([
    api.storage.local.get("settings"),
    activeTab(),
    WAYPOINTS_THEME.ready,
  ]);
  settings = normalizeSettings(saved);
  onVideo = WATCH_RE.test(tab?.url || "") && Boolean(videoIdOf(tab.url));
  currentId = onVideo ? videoIdOf(tab.url) : null;
  settingsController.initControls();
  themeImports.init();
  fileSaveController.init();
  exportsController.init();
  updateSettingsUI();
  dialogs.init();
  annotationEditor.init();
  restoreBookmarkEl.addEventListener("click", () => enqueue(restoreBookmark));
  inputController.initControls();
  settingsToggle.addEventListener("click", () => {
    setSettingsOpen(!settingsOpen);
  });
  emptyTrashEl.addEventListener("click", () => enqueue(emptyTrash));
  // Only bookmark on popup activation, never as a side effect of rendering.
  if (onVideo) {
    const { videos, trash, records } = await WAYPOINTS_STORAGE.read();
    if (
      settings.autoBookmark &&
      !videos[currentId] &&
      !trash[currentId] &&
      !records[currentId]?.life.deleted
    )
      await bookmarkCurrent();
    else if (videos[currentId]) await refreshCurrentChannel();
  }
  await render();
  searchEl.disabled = false;
  settingsToggle.disabled = false;
  settingsController.enable();
  const currentRow = currentId
    ? listEl.querySelector(`.main[data-id="${CSS.escape(currentId)}"]`)
    : null;
  if (currentRow) {
    currentRow.focus();
    currentRow.scrollIntoView({ block: "nearest" });
  } else {
    headerControl().focus();
  }
  if (expiryError) setStatus(expiryError);
  refreshOpenChapters();
}

let chapterRefreshPending = false;
async function refreshOpenChapters() {
  if (chapterRefreshPending) return;
  chapterRefreshPending = true;
  try {
    const tabs = await playerClient.listVideoTabs();
    const ids = new Set(tabs.map((tab) => videoIdOf(tab.url)).filter(Boolean));
    for (const id of ids) await markers.refreshChapters(id);
  } catch {
    // Unavailable chapter models must not block manual markers or overwrite data.
  } finally {
    chapterRefreshPending = false;
  }
}

inputController.installKeyboard();

// Refresh live when bookmarks or preferences change.
WAYPOINTS_THEME.subscribe?.((theme) => {
  settings = normalizeSettings({ ...settings, theme });
  updateSettingsUI();
});
api.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.settings) {
    const next = normalizeSettings(changes.settings.newValue);
    if (next.autoBookmark !== settings.autoBookmark) searchRequested = false;
    settings = next;
    updateSettingsUI();
  }
  if (WAYPOINTS_STORAGE.changed(changes) || changes.settings)
    refreshCoordinator.schedule(queue).catch((e) => setStatus(e.message));
});
if (typeof setInterval === "function") {
  setInterval(refreshOpenChapters, CHAPTER_REFRESH_INTERVAL_MS);
  setInterval(
    () => WAYPOINTS_STORAGE.expire().catch((error) => setStatus(error.message)),
    TRASH_CLEANUP_INTERVAL_MS,
  );
}
init().catch((e) => setStatus(`Couldn't open YT Waypoints: ${e.message}`));
