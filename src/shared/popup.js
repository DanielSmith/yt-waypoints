const api = globalThis.browser ?? globalThis.chrome;
const WATCH_RE = /^https:\/\/(www\.|m\.)?youtube\.com\/watch\?/;
let queue = Promise.resolve();

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
const optionsToggle = document.getElementById("options-toggle");
const optionsPanel = document.getElementById("options-panel");
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
  updateFormatUI: (formatId) => exportsController.updateFormatUI(formatId),
});
const { normalizeSettings, updateSettingsUI, changeSetting, setThumbnails } = settingsController;
settings = normalizeSettings();
let onVideo = false;
let currentId = null;
let optionsOpen = false;

const exportsController = WAYPOINTS_CREATE_POPUP_EXPORTS({
  document,
  formats: WAYPOINTS_TRANSCRIPT,
  transfer: WAYPOINTS_TRANSFER,
  player: playerClient,
  getSettings: () => settings,
  getVideos: () => savedVideos,
  getCurrentId: () => currentId,
  changeSetting,
  setStatus,
  listEl,
  headerControl,
  closeOtherDialogs() {
    closeHelp();
    closeAbout();
  },
});
const { closeFormatMenu } = exportsController;
function setOptionsOpen(open) {
  if (open) {
    exportsController.captureTarget();
  } else closeFormatMenu(false);
  optionsOpen = open;
  optionsPanel.hidden = !open;
  updateHeaderMode();
  actionsEl.classList.toggle("options-open", open);
  listEl.hidden = open;
  hintEl.hidden = open;
  optionsToggle.textContent = open ? "Hide options" : "Show options";
  optionsToggle.setAttribute("aria-expanded", String(open));
}
// Factories expose methods first; init() binds controls after all wiring exists.
const dialogs = WAYPOINTS_CREATE_POPUP_DIALOGS({
  document,
  api,
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
    setOptionsOpen(false);
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
});
const { renderList } = listController;

const inputController = WAYPOINTS_CREATE_POPUP_INPUT({
  document,
  transfer: WAYPOINTS_TRANSFER,
  player: playerClient,
  actions: bookmarks,
  dialogs,
  exportsController,
  listController,
  getSettings: () => settings,
  getVideos: () => savedVideos,
  getTrash: () => trashVideos,
  searchEl,
  clearSearchEl,
  optionsToggle,
  isOptionsOpen: () => optionsOpen,
  setOptionsOpen,
  updateHeaderMode,
  escapeClosesPopup: WAYPOINTS_ESCAPE_CLOSES_POPUP,
  requestSearch() {
    showRestoreBookmark = false;
    searchRequested = true;
  },
  enqueue,
  setThumbnails,
  setStatus,
  closePopup: () => window.close(),
});

// Holding an arrow key fires keydowns faster than storage round-trips;
// run scrub/play actions one at a time so writes don't clobber each other.
function enqueue(fn) {
  queue = queue.then(fn).catch((e) => setStatus(e.message));
  return queue;
}

function fmt(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = String(sec % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
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
  searchControl.hidden = optionsOpen || showButton;
  restoreBookmarkEl.hidden = optionsOpen || !showButton;
  restoreBookmarkEl.textContent =
    showRestoreBookmark || trashVideos[currentId] ? "Restore bookmark" : "Add bookmark";
  restoreBookmarkEl.title =
    showRestoreBookmark && deletedBookmark
      ? `Restore ${deletedBookmark.title || deletedBookmark.id}`
      : "Bookmark the current video";
  if (
    !optionsOpen &&
    ((showButton && document.activeElement === searchEl) ||
      (!showButton && document.activeElement === restoreBookmarkEl))
  ) {
    headerControl().focus();
  }
}

async function render() {
  const snapshot = await WAYPOINTS_STORAGE.read();
  savedVideos = snapshot.videos;
  bookmarks.rememberSnapshot(snapshot);
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
  ]);
  settings = normalizeSettings(saved);
  onVideo = WATCH_RE.test(tab?.url || "") && Boolean(videoIdOf(tab.url));
  currentId = onVideo ? videoIdOf(tab.url) : null;
  settingsController.initControls();
  exportsController.init();
  updateSettingsUI();
  dialogs.init();
  restoreBookmarkEl.addEventListener("click", () => enqueue(restoreBookmark));
  inputController.initControls();
  optionsToggle.addEventListener("click", () => {
    setOptionsOpen(!optionsOpen);
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
  optionsToggle.disabled = false;
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
}

inputController.installKeyboard();

// Refresh live when bookmarks or preferences change.
api.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.settings) {
    const next = normalizeSettings(changes.settings.newValue);
    if (next.autoBookmark !== settings.autoBookmark) searchRequested = false;
    settings = next;
    updateSettingsUI();
  }
  if (WAYPOINTS_STORAGE.changed(changes) || changes.settings)
    render().catch((e) => setStatus(e.message));
});
if (typeof setInterval === "function") {
  setInterval(() => WAYPOINTS_STORAGE.expire().catch((error) => setStatus(error.message)), 60000);
}
init().catch((e) => setStatus(`Couldn't open YT Waypoints: ${e.message}`));
