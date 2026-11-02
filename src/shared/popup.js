const api = globalThis.browser ?? globalThis.chrome;
const WATCH_RE = /^https:\/\/(www\.|m\.)?youtube\.com\/watch\?/;

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
const hintEl = document.getElementById("hint");
const optionsToggle = document.getElementById("options-toggle");
const optionsPanel = document.getElementById("options-panel");
const autoBookmarkEl = document.getElementById("auto-bookmark");
const thumbnailsEl = document.getElementById("show-thumbnails");
const scrubSecondsEl = document.getElementById("scrub-seconds");
const shiftMultiplierEl = document.getElementById("shift-multiplier");
const DEFAULT_SETTINGS = { autoBookmark: true, scrubSeconds: 10, shiftMultiplier: 3, showThumbnails: true };
let settings = { ...DEFAULT_SETTINGS };
let thumbnailChangePending = false;
let onVideo = false;
let currentId = null;
let optionsOpen = false;

function normalizeSettings(saved = {}) {
  const bounded = (value, fallback, max) => Number.isInteger(value) && value >= 1 && value <= max ? value : fallback;
  return {
    autoBookmark: typeof saved?.autoBookmark === "boolean" ? saved.autoBookmark : true,
    showThumbnails: typeof saved?.showThumbnails === "boolean" ? saved.showThumbnails : true,
    scrubSeconds: bounded(saved?.scrubSeconds, 10, 60),
    shiftMultiplier: bounded(saved?.shiftMultiplier, 3, 10),
  };
}

function updateSettingsUI() {
  autoBookmarkEl.checked = settings.autoBookmark;
  thumbnailsEl.checked = settings.showThumbnails;
  thumbnailsEl.disabled = thumbnailChangePending;
  scrubSecondsEl.value = settings.scrubSeconds;
  shiftMultiplierEl.value = settings.shiftMultiplier;
  document.getElementById("scrub-value").textContent = `${settings.scrubSeconds} s`;
  document.getElementById("multiplier-value").textContent = `×${settings.shiftMultiplier}`;
  document.getElementById("shift-preview").textContent = `Shift + ← or → moves ${settings.scrubSeconds * settings.shiftMultiplier} seconds.`;
}

function updateHint() {
  hintEl.textContent = `/ search · ↑↓ pick · ↵ open · ←→ ±${settings.scrubSeconds}s\nspace play/pause · ⌫ remove · t thumbs`;
}

async function saveSettings() {
  const next = normalizeSettings({
    ...settings,
    autoBookmark: autoBookmarkEl.checked,
    scrubSeconds: Number(scrubSecondsEl.value),
    shiftMultiplier: Number(shiftMultiplierEl.value),
  });
  await persistSettings(next);
}

async function persistSettings(next) {
  const autoBookmarkChanged = next.autoBookmark !== settings.autoBookmark;
  await api.storage.local.set({ settings: next });
  settings = next;
  if (autoBookmarkChanged) searchRequested = false;
  updateSettingsUI();
  await render();
}

function setOptionsOpen(open) {
  optionsOpen = open;
  optionsPanel.hidden = !open;
  updateHeaderMode();
  actionsEl.classList.toggle("options-open", open);
  listEl.hidden = open;
  hintEl.hidden = open;
  optionsToggle.textContent = open ? "Hide options" : "Show options";
  optionsToggle.setAttribute("aria-expanded", String(open));
}

async function setThumbnails(show) {
  if (thumbnailChangePending) return;
  thumbnailChangePending = true;
  updateSettingsUI();
  try {
    await enqueue(() => persistSettings({ ...settings, showThumbnails: show }));
  } finally {
    thumbnailChangePending = false;
    updateSettingsUI();
  }
}

async function loadVideos() {
  const { videos = {} } = await api.storage.local.get("videos");
  return videos;
}

async function saveVideos(videos) {
  await api.storage.local.set({ videos });
}

// Holding an arrow key fires keydowns faster than storage round-trips;
// run scrub/play actions one at a time so writes don't clobber each other.
let queue = Promise.resolve();
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

// Clean link: only video id + time (drops tracking params like si=).
function linkFor(v) {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(v.id)}&t=${v.t}s`;
}

function setStatus(msg) {
  statusEl.textContent = msg;
}

function showPlayer(state) {
  setStatus(`${state.paused ? "⏸ Paused" : "▶ Playing"} at ${fmt(state.t)}`);
}

async function activeTab() {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function focusTab(tab) {
  await api.windows.update(tab.windowId, { focused: true });
  await api.tabs.update(tab.id, { active: true });
}

function videoIdOf(url) {
  try {
    return new URL(url).searchParams.get("v");
  } catch {
    return null;
  }
}

// The open tab (any window) that's playing this video, if any.
async function findVideoTab(id) {
  const tabs = await api.tabs.query({ url: "*://*.youtube.com/watch*" });
  return tabs.find((t) => videoIdOf(t.url) === id);
}

// Run a function against the <video> in a tab. Returns null if there's no
// usable player (not loaded yet, or an ad is showing).
async function inPlayer(tabId, operation, args = []) {
  try {
    const [res] = await api.scripting.executeScript({ target: { tabId }, func: WAYPOINTS_PLAYER_ACTIONS[operation], args });
    return res?.result ?? null;
  } catch {
    return null;
  }
}

async function bookmarkCurrent() {
  const tab = await activeTab();
  if (!tab?.url || !WATCH_RE.test(tab.url)) {
    setStatus("Open a YouTube video first.");
    return;
  }
  const info = await inPlayer(tab.id, "bookmark");
  if (!info?.id) {
    setStatus("No video id found on this page.");
    return;
  }
  const videos = await loadVideos();
  videos[info.id] = { ...info, updated: Date.now() };
  await saveVideos(videos);
  setStatus(`Saved at ${fmt(info.t)}.`);
}

// If the video is already open in some tab, switch to it. Otherwise load it
// at the saved time.
async function openVideo(v) {
  const existing = await findVideoTab(v.id);
  if (existing) {
    await focusTab(existing);
  } else {
    const tab = await activeTab();
    if (tab?.url && WATCH_RE.test(tab.url)) {
      await api.tabs.update(tab.id, { url: linkFor(v) });
    } else {
      await api.tabs.create({ url: linkFor(v) });
    }
  }
  window.close();
}

function headerControl() {
  return showingBookmarkButton() ? restoreBookmarkEl : searchEl;
}

function showingBookmarkButton() {
  return showRestoreBookmark || (!searchRequested && !settings.autoBookmark &&
    onVideo && !savedVideos[currentId]);
}

function updateHeaderMode() {
  const showButton = showingBookmarkButton();
  searchControl.hidden = optionsOpen || showButton;
  restoreBookmarkEl.hidden = optionsOpen || !showButton;
  restoreBookmarkEl.title = showRestoreBookmark && deletedBookmark
    ? `Restore ${deletedBookmark.title || deletedBookmark.id}`
    : "Bookmark the current video";
  if (!optionsOpen && ((showButton && document.activeElement === searchEl) ||
      (!showButton && document.activeElement === restoreBookmarkEl))) {
    headerControl().focus();
  }
}

async function deleteVideo(id) {
  const videos = await loadVideos();
  const removed = videos[id];
  if (!removed) return;
  delete videos[id];
  await saveVideos(videos);
  deletedBookmark = { ...removed };
  showRestoreBookmark = true;
  setStatus("Bookmark removed.");
  await render();
}

async function restoreBookmark() {
  if (!showRestoreBookmark || !deletedBookmark) {
    await bookmarkCurrent();
    await render();
    return;
  }
  const videos = await loadVideos();
  // Preserve an entry already re-added or updated in another popup/tab.
  if (!videos[deletedBookmark.id]) videos[deletedBookmark.id] = deletedBookmark;
  await saveVideos(videos);
  deletedBookmark = null;
  showRestoreBookmark = false;
  searchRequested = true;
  setStatus("Bookmark restored.");
  await render();
}

// Move a resume point by delta seconds. If the video is open in a tab, seek
// the live player (from where it actually is) and save that position.
// Leaves `updated` alone so the row doesn't jump to the top while scrubbing.
async function scrub(id, delta) {
  const videos = await loadVideos();
  const v = videos[id];
  if (!v) return;

  const tab = await findVideoTab(id);
  const live = tab ? await inPlayer(tab.id, "seek", [delta]) : null;

  if (live) {
    v.t = live.t;
    v.duration ||= live.duration;
    showPlayer(live);
  } else {
    v.t = Math.min(v.duration || Infinity, Math.max(0, v.t + delta));
    setStatus(`Resume point ${fmt(v.t)}`);
  }
  await saveVideos(videos);
}

// Space: play/pause the video in its open tab. Not open → open it (like Enter).
async function togglePlay(id) {
  const videos = await loadVideos();
  const v = videos[id];
  if (!v) return;

  const tab = await findVideoTab(id);
  if (!tab) return openVideo(v);

  const state = await inPlayer(tab.id, "toggle");
  if (!state) {
    setStatus("Player isn't ready in that tab yet.");
    return;
  }
  showPlayer(state);
  v.t = state.t;
  await saveVideos(videos);
}

// Keyboard: ↑/↓ move between search and the filtered rows,
// Enter opens, Space plays/pauses, ←/→ scrub by the configured amount,
// Delete/Backspace removes the focused row.
function focusables() {
  return [headerControl(), ...listEl.querySelectorAll(".main")];
}

let pendingFocusIndex = null;

document.addEventListener("keydown", (e) => {
  if (e.isComposing) return;
  if (e.key.toLowerCase() === "t" && !e.ctrlKey && !e.altKey && !e.metaKey &&
      document.activeElement !== searchEl) {
    e.preventDefault();
    if (!e.repeat) setThumbnails(!settings.showThumbnails).catch((error) => setStatus(error.message));
    return;
  }
  if (optionsOpen) return;
  if (e.key === "/" && !e.ctrlKey && !e.altKey && !e.metaKey && document.activeElement !== searchEl) {
    e.preventDefault();
    showRestoreBookmark = false;
    searchRequested = true;
    updateHeaderMode();
    searchEl.focus();
    return;
  }
  if (document.activeElement === optionsToggle) return;
  // Text editing keys belong to search; only ↑/↓ move into the result list.
  if (document.activeElement === searchEl && e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  const items = focusables();
  const i = items.indexOf(document.activeElement);
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    const next = e.key === "ArrowDown" ? Math.min(items.length - 1, i + 1) : Math.max(0, i - 1);
    items[next]?.focus();
    return;
  }
  const row = document.activeElement;
  if (!row?.classList.contains("main")) return;
  const id = row.dataset.id;

  if (e.key === "Enter") {
    e.preventDefault();
    row.click();
  } else if (e.key === " ") {
    e.preventDefault();
    enqueue(() => togglePlay(id));
  } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
    e.preventDefault();
    const step = settings.scrubSeconds * (e.shiftKey ? settings.shiftMultiplier : 1);
    enqueue(() => scrub(id, e.key === "ArrowRight" ? step : -step));
  } else if (e.key === "Delete" || e.key === "Backspace") {
    e.preventDefault();
    pendingFocusIndex = i; // same position after re-render
    enqueue(() => deleteVideo(id));
  }
});

async function render() {
  savedVideos = await loadVideos();
  updateHint();
  renderList();
}

function renderList() {
  updateHeaderMode();
  const query = searchEl.value.trim().toLocaleLowerCase();
  clearSearchEl.hidden = searchEl.value.length === 0;
  const videos = Object.values(savedVideos)
    .filter((v) => !query || (v.title || "").toLocaleLowerCase().includes(query))
    .sort((a, b) => b.updated - a.updated);
  // Keep keyboard focus on the same row across re-renders (scrub, auto-save).
  const focusedId = document.activeElement?.dataset?.id;
  listEl.replaceChildren();
  if (!videos.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = query ? "No matching videos." : "No bookmarks yet.";
    listEl.append(li);
  }
  for (const v of videos) {
    const li = document.createElement("li");

    const main = document.createElement("div");
    main.className = "main";
    main.tabIndex = 0;
    main.dataset.id = v.id;
    main.title = linkFor(v);
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
      img.addEventListener("error", () => { img.hidden = true; });
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

    details.append(title, meta);

    if (v.duration) {
      const bar = document.createElement("div");
      bar.className = "bar";
      const fill = document.createElement("span");
      fill.style.width = `${Math.min(100, (v.t / v.duration) * 100)}%`;
      bar.append(fill);
      details.append(bar);
    }
    main.append(details);

    const del = document.createElement("button");
    del.className = "del";
    del.tabIndex = -1;
    del.textContent = "×";
    del.title = "Delete";
    del.addEventListener("click", () => enqueue(() => deleteVideo(v.id)));

    li.append(main, del);
    listEl.append(li);
  }
  if (pendingFocusIndex !== null) {
    const items = focusables();
    items[Math.min(pendingFocusIndex, items.length - 1)]?.focus();
    pendingFocusIndex = null;
  } else if (focusedId) {
    const row = listEl.querySelector(`.main[data-id="${CSS.escape(focusedId)}"]`);
    if (row) row.focus();
    else headerControl().focus();
  }
}

async function init() {
  document.getElementById("shortcut-help").textContent = WAYPOINTS_SHORTCUT_HELP;
  const [{ settings: saved }, tab] = await Promise.all([
    api.storage.local.get("settings"), activeTab(),
  ]);
  settings = normalizeSettings(saved);
  onVideo = WATCH_RE.test(tab?.url || "") && Boolean(videoIdOf(tab.url));
  currentId = onVideo ? videoIdOf(tab.url) : null;
  updateSettingsUI();
  restoreBookmarkEl.addEventListener("click", () => enqueue(restoreBookmark));
  searchEl.addEventListener("input", renderList);
  clearSearchEl.addEventListener("click", () => {
    searchEl.value = "";
    renderList();
    searchEl.focus();
  });
  optionsToggle.addEventListener("click", () => {
    setOptionsOpen(!optionsOpen);
  });
  autoBookmarkEl.addEventListener("change", () => enqueue(saveSettings));
  thumbnailsEl.addEventListener("change", () => {
    setThumbnails(thumbnailsEl.checked).catch((error) => setStatus(error.message));
  });
  for (const slider of [scrubSecondsEl, shiftMultiplierEl]) {
    slider.addEventListener("input", () => {
      document.getElementById("scrub-value").textContent = `${scrubSecondsEl.value} s`;
      document.getElementById("multiplier-value").textContent = `×${shiftMultiplierEl.value}`;
      document.getElementById("shift-preview").textContent = `Shift + ← or → moves ${Number(scrubSecondsEl.value) * Number(shiftMultiplierEl.value)} seconds.`;
    });
    slider.addEventListener("change", () => enqueue(saveSettings));
  }
  // Only bookmark on popup activation, never as a side effect of rendering.
  if (onVideo && settings.autoBookmark && !(await loadVideos())[currentId]) {
    await bookmarkCurrent();
  }
  await render();
  searchEl.disabled = false;
  optionsToggle.disabled = false;
  const currentRow = currentId
    ? listEl.querySelector(`.main[data-id="${CSS.escape(currentId)}"]`)
    : null;
  if (currentRow) {
    currentRow.focus();
    currentRow.scrollIntoView({ block: "nearest" });
  } else {
    headerControl().focus();
  }
}

// Refresh live when bookmarks or preferences change.
api.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.settings) {
    const next = normalizeSettings(changes.settings.newValue);
    if (next.autoBookmark !== settings.autoBookmark) searchRequested = false;
    settings = next;
    updateSettingsUI();
  }
  if (changes.videos || changes.settings) render().catch((e) => setStatus(e.message));
});
init().catch((e) => setStatus(`Couldn't open YT Waypoints: ${e.message}`));
