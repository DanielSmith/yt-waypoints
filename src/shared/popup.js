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
let trashVideos = {};
let currentDeleted = false;
const hintEl = document.getElementById("hint");
const optionsToggle = document.getElementById("options-toggle");
const optionsPanel = document.getElementById("options-panel");
const themeSelect = document.getElementById("theme-select");
const deletionModeEl = document.getElementById("deletion-mode");
const trashDaysEl = document.getElementById("trash-days");
const showTrashEl = document.getElementById("show-trash");
const emptyTrashEl = document.getElementById("empty-trash");
const autoBookmarkEl = document.getElementById("auto-bookmark");
const includeChannelsEl = document.getElementById("include-channel-names");
const thumbnailsEl = document.getElementById("show-thumbnails");
const scrubSecondsEl = document.getElementById("scrub-seconds");
const shiftMultiplierEl = document.getElementById("shift-multiplier");
const copyVideosEl = document.getElementById("copy-videos");
const formatToggle = document.getElementById("transcript-format-toggle");
const formatMenu = document.getElementById("transcript-format-menu");
const formatList = document.getElementById("transcript-format-list");
const transcriptCopyEl = document.getElementById("copy-transcript");
const offerSaveFileEl = document.getElementById("offer-save-file");
const fileSaveDialog = document.getElementById("file-save-dialog");
const fileNameFields = document.getElementById("file-name-fields");
const fileSaveName = document.getElementById("file-save-name");
const fileSaveConfirm = document.getElementById("file-save-confirm");
let fileSaveOutput = null;
let fileSavePreviousFocus = null;
let formatMenuOpen = false;
let formatPreviewIndex = 0;
let transcriptTargetId = null;
const formatChoices = [];
const helpDialog = document.getElementById("help-dialog");
const helpToggle = document.getElementById("help-toggle");
const helpClose = document.getElementById("help-close");
const aboutDialog = document.getElementById("about-dialog");
const aboutToggle = document.getElementById("about-toggle");
let helpPreviousFocus = null;
let helpPreviousRowId = null;
let helpEscapeHeld = false;
const DEFAULT_SETTINGS = { autoBookmark: true, scrubSeconds: 10, shiftMultiplier: 3, showThumbnails: true, includeChannelNames: true, transcriptFormat: "markdown-linked", offerSaveFile: false, theme: "system", deletionMode: "timed", trashDays: 7, showTrash: false };
let settings = { ...DEFAULT_SETTINGS };
let thumbnailChangePending = false;
let onVideo = false;
let currentId = null;
let optionsOpen = false;
let activeScrubber = null;

function normalizeSettings(saved = {}) {
  const bounded = (value, fallback, max) => Number.isInteger(value) && value >= 1 && value <= max ? value : fallback;
  return {
    autoBookmark: typeof saved?.autoBookmark === "boolean" ? saved.autoBookmark : true,
    includeChannelNames: typeof saved?.includeChannelNames === "boolean" ? saved.includeChannelNames : true,
    showThumbnails: typeof saved?.showThumbnails === "boolean" ? saved.showThumbnails : true,
    scrubSeconds: bounded(saved?.scrubSeconds, 10, 60),
    shiftMultiplier: bounded(saved?.shiftMultiplier, 3, 10),
    transcriptFormat: WAYPOINTS_TRANSCRIPT.get(saved?.transcriptFormat).id,
    offerSaveFile: saved?.offerSaveFile === true,
    theme: WAYPOINTS_THEME.normalize(saved?.theme),
    deletionMode: saved?.deletionMode === "permanent" ? "permanent" : "timed",
    trashDays: WAYPOINTS_STORAGE.retentionDays(saved?.trashDays),
    showTrash: saved?.showTrash === true,
  };
}

function updateSettingsUI() {
  deletionModeEl.value = settings.deletionMode;
  trashDaysEl.value = String(settings.trashDays);
  showTrashEl.checked = settings.showTrash;
  themeSelect.value = settings.theme;
  WAYPOINTS_THEME.apply(settings.theme);
  autoBookmarkEl.checked = settings.autoBookmark;
  includeChannelsEl.checked = settings.includeChannelNames;
  thumbnailsEl.checked = settings.showThumbnails;
  thumbnailsEl.disabled = thumbnailChangePending;
  offerSaveFileEl.checked = settings.offerSaveFile;
  formatToggle.textContent = WAYPOINTS_TRANSCRIPT.get(settings.transcriptFormat).label;
  formatChoices.forEach(choice => choice.setAttribute("aria-selected", String(choice.dataset.format === settings.transcriptFormat)));
  scrubSecondsEl.value = settings.scrubSeconds;
  shiftMultiplierEl.value = settings.shiftMultiplier;
  document.getElementById("scrub-value").textContent = `${settings.scrubSeconds} s`;
  document.getElementById("multiplier-value").textContent = `×${settings.shiftMultiplier}`;
  document.getElementById("shift-preview").textContent = `Shift + ← or → moves ${settings.scrubSeconds * settings.shiftMultiplier} seconds.`;
}

function updateHint() {
  document.getElementById("help-escape").textContent = WAYPOINTS_ESCAPE_CLOSES_POPUP
    ? "Close entire popup (Firefox)" : "Close help";
  document.getElementById("help-scrub").textContent = `Scrub ${settings.scrubSeconds} seconds`;
  document.getElementById("help-multiplier").textContent = `×${settings.shiftMultiplier} (${settings.scrubSeconds * settings.shiftMultiplier} seconds)`;
}

function openHelp() {
  if (helpDialog.open) return;
  helpPreviousFocus = document.activeElement;
  helpPreviousRowId = helpPreviousFocus?.dataset?.id;
  updateHint();
  document.body.classList.add("help-open");
  helpDialog.showModal();
}

function closeHelp() {
  if (!helpDialog.open) return;
  helpDialog.close();
  document.body.classList.remove("help-open");
  const row = helpPreviousRowId && listEl.querySelector(`.main[data-id="${CSS.escape(helpPreviousRowId)}"]`);
  (row || (helpPreviousRowId ? headerControl() : helpPreviousFocus))?.focus();
}

function openAbout() {
  if (aboutDialog.open || helpDialog.open || fileSaveDialog.open) return;
  closeFormatMenu(false);
  document.getElementById("about-version").textContent = `Version ${api.runtime.getManifest().version}`;
  document.body.classList.add("about-open");
  aboutDialog.showModal();
}

function closeAbout() {
  if (!aboutDialog.open) return;
  aboutDialog.close();
  document.body.classList.remove("about-open");
  aboutToggle.focus();
}

function changeSetting(name, value) {
  // Capture intent at the event, before an earlier save refreshes the form.
  return enqueue(() => persistSettings(normalizeSettings({ ...settings, [name]: value })));
}

async function persistSettings(next) {
  const autoBookmarkChanged = next.autoBookmark !== settings.autoBookmark;
  await api.storage.local.set({ settings: next });
  settings = next;
  if (autoBookmarkChanged) searchRequested = false;
  updateSettingsUI();
  await WAYPOINTS_STORAGE.expire();
  await render();
}

function setOptionsOpen(open) {
  if (open) {
    transcriptTargetId = document.activeElement?.dataset?.id || transcriptTargetId || currentId;
    updateTranscriptTarget();
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

function updateTranscriptTarget() {
  const video = savedVideos[transcriptTargetId] || (transcriptTargetId && transcriptTargetId === currentId ? { title: "Current YouTube video" } : null);
  document.getElementById("transcript-target").textContent = video
    ? `Video: ${video.title || transcriptTargetId}` : "Select a bookmark before opening Options, or open a YouTube video.";
  transcriptCopyEl.disabled = transcriptPending || !video;
}

function previewFormat(index, focus = false) {
  formatPreviewIndex = index;
  const format = WAYPOINTS_TRANSCRIPT.formats[index];
  document.getElementById("transcript-format-use").textContent = format.use;
  document.getElementById("transcript-format-description").textContent = format.description;
  document.getElementById("transcript-format-example").textContent = format.example;
  formatChoices.forEach((choice, i) => { choice.tabIndex = i === index ? 0 : -1; choice.classList.toggle("preview", i === index); });
  if (focus) formatChoices[index]?.focus();
}

function closeFormatMenu(restoreFocus = true) {
  if (!formatMenuOpen) return;
  formatMenuOpen = false;
  formatMenu.hidden = true;
  formatToggle.setAttribute("aria-expanded", "false");
  document.body.classList.remove("format-menu-open");
  if (restoreFocus) formatToggle.focus();
}

function openFormatMenu() {
  formatMenuOpen = true;
  formatMenu.hidden = false;
  formatToggle.setAttribute("aria-expanded", "true");
  document.body.classList.add("format-menu-open");
  previewFormat(WAYPOINTS_TRANSCRIPT.formats.findIndex(format => format.id === settings.transcriptFormat), true);
}

function selectFormat(index) {
  const format = WAYPOINTS_TRANSCRIPT.formats[index];
  closeFormatMenu();
  enqueue(() => persistSettings({ ...settings, transcriptFormat: format.id }));
}

function initTranscriptControls() {
  WAYPOINTS_TRANSCRIPT.formats.forEach((format, index) => {
    const choice = document.createElement("button");
    choice.type = "button";
    choice.className = "transcript-format-choice";
    choice.dataset.format = format.id;
    choice.textContent = format.label;
    choice.setAttribute("role", "option");
    choice.setAttribute("aria-describedby", "transcript-format-detail");
    choice.tabIndex = -1;
    choice.addEventListener("mouseenter", () => previewFormat(index));
    choice.addEventListener("focus", () => previewFormat(index));
    choice.addEventListener("click", () => selectFormat(index));
    formatChoices.push(choice);
    formatList.append(choice);
  });
  formatToggle.addEventListener("click", () => formatMenuOpen ? closeFormatMenu() : openFormatMenu());
  formatToggle.addEventListener("keydown", event => {
    if (!formatMenuOpen && ["ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); event.stopPropagation(); openFormatMenu(); }
  });
  document.addEventListener("click", event => {
    if (formatMenuOpen && !document.getElementById("transcript-format-picker").contains(event.target)) closeFormatMenu(false);
  });
  transcriptCopyEl.addEventListener("click", () => exportTranscript(transcriptTargetId));
  fileSaveConfirm.addEventListener("click", confirmFileSave);
  document.getElementById("file-save-cancel").addEventListener("click", closeFileSave);
  fileSaveDialog.addEventListener("cancel", event => { event.preventDefault(); closeFileSave(); });
  fileSaveName.addEventListener("keydown", event => {
    if (event.key === "Enter") { event.preventDefault(); if (!event.repeat) confirmFileSave(); }
  });
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

const videoSnapshots = new WeakMap();
async function loadVideos() {
  const snapshot = await WAYPOINTS_STORAGE.read();
  videoSnapshots.set(snapshot.videos, snapshot);
  return snapshot.videos;
}

async function saveVideos(videos) {
  await WAYPOINTS_STORAGE.save(videoSnapshots.get(videos));
}

function copyWithSelection(text) {
  // Compatibility fallback only. The temporary selection stays offscreen and
  // is removed immediately; JSON is never displayed in the Options panel.
  const field = document.createElement("textarea");
  const previousFocus = document.activeElement;
  field.value = text;
  field.readOnly = true;
  field.tabIndex = -1;
  field.className = "clipboard-copy-buffer";
  document.body.append(field);
  try {
    field.select();
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    field.remove();
    previousFocus?.focus();
  }
}

async function copyText(text, success, failure) {
  let copied = false;
  try {
    const clipboard = globalThis.navigator?.clipboard;
    if (clipboard?.writeText) {
      await clipboard.writeText(text);
      copied = true;
    } else copied = copyWithSelection(text);
  } catch {
    copied = copyWithSelection(text);
  }
  setStatus(copied ? success : failure);
  return copied;
}

async function copyVideos(videos = savedVideos, allVideos = true) {
  const text = WAYPOINTS_TRANSFER.stringify(videos);
  const copied = await copyText(text,
    `Copied ${Object.keys(videos).length} videos as JSON.`, "Could not copy JSON. Please try again.");
  if (copied && allVideos) offerFileSave({ text, filename: `yt-waypoints-bookmarks-${new Date().toISOString().slice(0, 10)}.json`, mime: "application/json;charset=utf-8" });
}

function offerFileSave(output) {
  if (!settings.offerSaveFile || fileSaveDialog.open) return;
  if (helpDialog.open) closeHelp();
  if (aboutDialog.open) closeAbout();
  closeFormatMenu(false);
  fileSavePreviousFocus = document.activeElement;
  fileSaveOutput = output;
  fileNameFields.hidden = true;
  fileSaveName.value = output.filename;
  fileSaveConfirm.textContent = "Yes";
  document.getElementById("file-save-cancel").textContent = "No thanks";
  document.getElementById("file-save-title").textContent = "Also save to file?";
  document.getElementById("file-save-description").textContent = `Already copied to the clipboard. Suggested file: ${output.filename}`;
  document.getElementById("file-save-error").textContent = "";
  document.body.classList.add("file-save-open");
  fileSaveDialog.showModal();
}

function closeFileSave() {
  fileSaveDialog.close();
  fileSaveOutput = null;
  document.body.classList.remove("file-save-open");
  const rowId = fileSavePreviousFocus?.dataset?.id;
  const row = rowId && listEl.querySelector(`.main[data-id="${CSS.escape(rowId)}"]`);
  (row || (rowId ? headerControl() : fileSavePreviousFocus))?.focus();
}

function confirmFileSave() {
  if (!fileSaveOutput) return;
  if (fileNameFields.hidden) {
    fileNameFields.hidden = false;
    document.getElementById("file-save-title").textContent = "Save a copy";
    fileSaveConfirm.textContent = "Save file";
    document.getElementById("file-save-cancel").textContent = "Cancel";
    fileSaveName.focus();
    fileSaveName.select();
    return;
  }
  let filename = fileSaveName.value.trim();
  if (!filename || filename === "." || filename === ".." || /[\\/:*?"<>|\u0000-\u001f]/.test(filename)) {
    document.getElementById("file-save-error").textContent = "Enter a filename without folder paths or these characters: / \\ : * ? \" < > |";
    fileSaveName.focus();
    return;
  }
  const extension = fileSaveOutput.filename.split(".").at(-1);
  if (!filename.toLowerCase().endsWith(`.${extension}`)) filename += `.${extension}`;
  try {
    const url = URL.createObjectURL(new Blob([fileSaveOutput.text], { type: fileSaveOutput.mime }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    try { link.click(); } finally {
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    }
    closeFileSave();
    setStatus(`Copied to clipboard. File download requested: ${filename}`);
  } catch (error) { document.getElementById("file-save-error").textContent = `Could not save file: ${error.message}. Your clipboard copy is unchanged.`; }
}

async function importVideos(incoming) {
  const { counts, positions } = await WAYPOINTS_STORAGE.importVideos(incoming);
  showRestoreBookmark = false;
  searchRequested = true;
  searchEl.value = "";
  setOptionsOpen(false);
  await render();
  searchEl.focus();
  setStatus(`Import: ${counts.added} added, ${counts.updated} updated, ${counts.kept} unchanged.`);
  if (Object.keys(positions).length) {
    try {
      const tabs = await api.tabs.query({ url: "*://*.youtube.com/watch*" });
      const outcomes = await Promise.allSettled(tabs.filter(tab => Object.hasOwn(positions, videoIdOf(tab.url)))
        .map(tab => inPlayer(tab.id, "seekTo", [positions[videoIdOf(tab.url)].t, videoIdOf(tab.url)])));
      const failed = outcomes.filter(outcome => outcome.status === "rejected" || outcome.value?.error).length;
      if (failed) setStatus(`Import saved; could not move ${failed} open ${failed === 1 ? "player" : "players"} to the imported position.`);
    } catch { /* The saved positions remain available even if a tab disappears. */ }
  }
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
    const id = new URL(url).searchParams.get("v");
    return WAYPOINTS_PLAYER_RESULTS.isId(id) ? id : null;
  } catch {
    return null;
  }
}

// Parse video links, never navigate to raw clipboard text. Every accepted link
// is rebuilt by linkFor() on www.youtube.com with just an ID and a timestamp.
function parseVideoLink(text) {
  let value = text.trim();
  if (/^(?:(?:www\.|m\.)?youtube\.com|youtu\.be)\//i.test(value)) value = "https://" + value;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  let id;
  const parts = url.pathname.replace(/\/$/, "").split("/").filter(Boolean);
  if (url.hostname === "youtu.be" && parts.length === 1) {
    id = parts[0];
  } else if (["youtube.com", "www.youtube.com", "m.youtube.com"].includes(url.hostname)) {
    if (url.pathname === "/watch" && url.searchParams.getAll("v").length === 1) {
      id = url.searchParams.get("v");
    } else if (parts.length === 2 && ["shorts", "live", "embed"].includes(parts[0])) {
      id = parts[1];
    }
  }
  if (!/^[A-Za-z0-9_-]{11}$/.test(id || "")) return null;
  const stamp = url.searchParams.get("t") ?? url.searchParams.get("start") ??
    new URLSearchParams(url.hash.slice(1)).get("t");
  let t = null;
  if (stamp !== null) {
    if (/^\d+$/.test(stamp)) {
      t = Number(stamp);
    } else {
      const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(stamp);
      if (!match || !match.slice(1).some(Boolean)) return null;
      t = Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0);
    }
    if (!Number.isSafeInteger(t)) return null;
  }
  return { id, t };
}

// The open tab (any window) that's playing this video, if any.
async function findVideoTab(id) {
  const tabs = await api.tabs.query({ url: "*://*.youtube.com/watch*" });
  return tabs.find((t) => videoIdOf(t.url) === id);
}

// Run only in the main frame, then validate the page-derived payload in the
// extension world. Errors are distinct from the absence of an open video tab.
function playerError(error) {
  let message = typeof error === "string" ? error : Object.getOwnPropertyDescriptor(error || {}, "message")?.value;
  if (typeof message !== "string") message = "Unknown script failure";
  return message.slice(0, 500).replace(/[\u0000-\u001f\u007f]/g, " ").trim() || "Unknown script failure";
}

async function inPlayer(tabId, operation, args = []) {
  const expectedId = operation === "playback" ? args[2]
    : ["seek", "seekTo"].includes(operation) ? args[1] : args[0];
  if (!WAYPOINTS_PLAYER_RESULTS.isId(expectedId)) return { error: "Invalid video identity. Reload the YouTube tab and try again." };
  try {
    const request = { target: { tabId, frameIds: [0] }, func: WAYPOINTS_PLAYER_ACTIONS[operation], args };
    let results;
    if (operation === "playback" || operation === "transcript") {
      try { results = await api.scripting.executeScript({ ...request, world: "MAIN" }); }
      catch (error) {
        if (!WAYPOINTS_PLAYER_LEGACY_FALLBACK || !/world.*(?:MAIN|unsupported|invalid)|(?:unexpected|unsupported).*world/i.test(playerError(error))) throw error;
        results = await api.scripting.executeScript(request);
      }
    } else results = await api.scripting.executeScript(request);
    if (!Array.isArray(results) || results.length !== 1) return { error: "Invalid player response: expected one main-frame result." };
    const response = results[0];
    if (!response || Object.getOwnPropertyDescriptor(response, "frameId")?.value !== 0) return { error: "Invalid player response: unexpected frame." };
    const failure = Object.getOwnPropertyDescriptor(response, "error");
    if (failure) return { error: `Player script failed: ${playerError(failure.value)}` };
    const payload = Object.getOwnPropertyDescriptor(response, "result");
    if (!payload || !Object.hasOwn(payload, "value") || payload.value == null) {
      return { error: "The player script returned no result. Wait for the video to load or reload the YouTube tab." };
    }
    return WAYPOINTS_PLAYER_RESULTS.validate(operation, payload.value, expectedId, args);
  } catch (error) {
    return { error: playerError(error) };
  }
}

async function bookmarkCurrent() {
  const tab = await activeTab();
  if (!tab?.url || !WATCH_RE.test(tab.url)) {
    setStatus("Open a YouTube video first.");
    return;
  }
  const info = await inPlayer(tab.id, "bookmark", [videoIdOf(tab.url)]);
  if (info.error) return setStatus(info.error);
  const videos = await loadVideos();
  if ((await WAYPOINTS_STORAGE.read()).trash[info.id]) {
    await restoreTrashVideo(info.id);
    return;
  }
  videos[info.id] = { ...info, updated: Date.now() };
  await saveVideos(videos);
  setStatus(`Saved at ${fmt(info.t)}.`);
}

// Enrich an existing bookmark without overwriting its saved time or recency.
async function refreshCurrentChannel() {
  const tab = await activeTab();
  if (!tab || videoIdOf(tab.url) !== currentId) return;
  const info = await inPlayer(tab.id, "bookmark", [videoIdOf(tab.url)]);
  if (info.error) return setStatus(info.error);
  if (!info.channelName) return;
  const videos = await loadVideos();
  const entry = videos[currentId];
  if (!entry || (entry.channelName === info.channelName && entry.channelUrl === info.channelUrl)) return;
  videos[currentId] = { ...entry, channelName: info.channelName, channelUrl: info.channelUrl };
  await saveVideos(videos);
}

// If the video is already open in some tab, switch to it. Otherwise load it
// at the saved time.
async function navigateVideo(v, applyTimestamp = false) {
  const existing = await findVideoTab(v.id);
  if (existing) {
    if (applyTimestamp) await api.tabs.update(existing.id, { url: linkFor(v) });
    await focusTab(existing);
  } else {
    const tab = await activeTab();
    if (tab?.url && WATCH_RE.test(tab.url)) {
      await api.tabs.update(tab.id, { url: linkFor(v) });
    } else {
      await api.tabs.create({ url: linkFor(v) });
    }
  }
}

async function openVideo(v) {
  await navigateVideo(v);
  window.close();
}

async function openPastedVideo(link) {
  const videos = await loadVideos();
  const target = { id: link.id, t: link.t ?? videos[link.id]?.t ?? 0 };
  await navigateVideo(target, link.t !== null);
  searchEl.value = "";
  renderList();
  window.close();
}

function pasteIntoPopup(event) {
  if (event.defaultPrevented || helpDialog.open || aboutDialog.open || fileSaveDialog.open) return;
  const text = event.clipboardData?.getData("text/plain").trim();
  if (!text) return;
  if (/^[\[{]/.test(text)) {
    event.preventDefault();
    let incoming;
    try {
      // Validate the entire payload before queuing a single merge/write.
      incoming = WAYPOINTS_TRANSFER.parse(text);
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
  showRestoreBookmark = false;
  searchRequested = true;
  setOptionsOpen(false);
  searchEl.value = text;
  renderList();
  searchEl.focus();
  if (link) enqueue(() => openPastedVideo(link));
}

function headerControl() {
  return showingBookmarkButton() ? restoreBookmarkEl : searchEl;
}

function showingBookmarkButton() {
  return showRestoreBookmark || (!searchRequested && onVideo && !savedVideos[currentId] &&
    (!settings.autoBookmark || Boolean(trashVideos[currentId]) || currentDeleted));
}

function updateHeaderMode() {
  const showButton = showingBookmarkButton();
  searchControl.hidden = optionsOpen || showButton;
  restoreBookmarkEl.hidden = optionsOpen || !showButton;
  restoreBookmarkEl.textContent = showRestoreBookmark || trashVideos[currentId] ? "Restore bookmark" : "Add bookmark";
  restoreBookmarkEl.title = showRestoreBookmark && deletedBookmark
    ? `Restore ${deletedBookmark.title || deletedBookmark.id}`
    : "Bookmark the current video";
  if (!optionsOpen && ((showButton && document.activeElement === searchEl) ||
      (!showButton && document.activeElement === restoreBookmarkEl))) {
    headerControl().focus();
  }
}

async function deleteVideo(id) {
  const snapshot = await WAYPOINTS_STORAGE.read();
  const inTrash = Boolean(snapshot.trash[id]);
  if (!snapshot.videos[id] && !inTrash) return;
  if (settings.deletionMode === "timed" && !inTrash) {
    await WAYPOINTS_STORAGE.trash(id);
    deletedBookmark = { id, title: snapshot.videos[id].title };
    showRestoreBookmark = true;
    setStatus(`Moved to trash. Permanently deleted after ${settings.trashDays} days.`);
  } else {
    // Permanent means no in-memory Undo copy and no retained row payload.
    deletedBookmark = null;
    showRestoreBookmark = false;
    searchRequested = true;
    await WAYPOINTS_STORAGE.purge([id]);
    setStatus("Bookmark permanently deleted.");
  }
  await render();
}

async function restoreTrashVideo(id) {
  const restored = await WAYPOINTS_STORAGE.restore(id);
  deletedBookmark = null;
  showRestoreBookmark = false;
  searchRequested = true;
  await render();
  setStatus(restored ? "Bookmark moved to current." : "Bookmark is no longer in trash.");
}

async function restoreBookmark() {
  if (showRestoreBookmark && deletedBookmark) {
    await restoreTrashVideo(deletedBookmark.id);
  } else {
    await bookmarkCurrent();
    await render();
  }
}

async function emptyTrash() {
  deletedBookmark = null;
  showRestoreBookmark = false;
  const count = await WAYPOINTS_STORAGE.emptyTrash();
  await render();
  setStatus(count ? `Permanently deleted ${count} trashed ${count === 1 ? "bookmark" : "bookmarks"}.` : "Trash is empty.");
}

// Move a resume point by delta seconds. If the video is open in a tab, seek
// the live player (from where it actually is) and save that position.
// Leaves `updated` alone so the row doesn't jump to the top while scrubbing.
async function scrub(id, delta) {
  const videos = await loadVideos();
  const v = videos[id];
  if (!v) return;

  const tab = await findVideoTab(id);
  const live = tab ? await inPlayer(tab.id, "seek", [delta, id]) : null;

  if (live?.error) return setStatus(live.error);
  if (live) {
    v.t = live.t;
    v.duration = live.duration;
    showPlayer(live);
  } else {
    v.t = Math.min(v.duration || Infinity, Math.max(0, v.t + delta));
    setStatus(`Resume point ${fmt(v.t)}`);
  }
  await saveVideos(videos);
}

async function controlPlayback(id, operation, direction) {
  const videos = operation === "frame" ? await loadVideos() : null;
  if (operation === "frame" && !videos[id]) return;
  const tab = await findVideoTab(id);
  if (!tab) return setStatus("Open this video on YouTube first.");
  const result = await inPlayer(tab.id, "playback", [operation, direction, id]);
  if (!result) return setStatus("YouTube playback controls are unavailable. Wait for the video to load and try again.");
  if (result.error) return setStatus(result.error);
  if (operation === "rate") return setStatus(`Playback speed ${result.rate}×`);
  if (videos[id]) {
    videos[id].t = result.t;
    videos[id].duration = result.duration;
    await saveVideos(videos);
  }
  setStatus(`${direction > 0 ? "Next" : "Previous"} frame (${result.fps} fps).`);
}

let transcriptPending = false;
async function exportTranscript(id) {
  if (transcriptPending) return;
  if (!id) return setStatus("Select a bookmark or open a YouTube video first.");
  const formatId = settings.transcriptFormat;
  const video = { ...(savedVideos[id] || { id, title: id }) };
  transcriptPending = true;
  updateTranscriptTarget();
  try {
    const tab = await findVideoTab(id);
    if (!tab) return setStatus("Open this video on YouTube first to copy its transcript.");
    setStatus("Loading transcript…");
    const result = await inPlayer(tab.id, "transcript", [id]);
    if (result?.error) return setStatus(`Could not copy transcript: ${result.error}`);
    const transcript = WAYPOINTS_TRANSCRIPT.prepare(video, result);
    const output = WAYPOINTS_TRANSCRIPT.output(transcript, formatId);
    const copied = await copyText(output.text, "Copied video transcript.", "Could not copy transcript. Please try again.");
    if (copied) offerFileSave(output);
  } catch (error) {
    setStatus(error.message);
  } finally {
    transcriptPending = false;
    updateTranscriptTarget();
  }
}

// Bind a slider action to the bookmark lifetime read before the seek. The
// storage module merges unrelated edits and rejects superseded lifetimes.
async function seekTo(id, time) {
  const videos = await loadVideos();
  const v = videos[id];
  if (!v) return;
  const tab = await findVideoTab(id);
  const live = tab ? await inPlayer(tab.id, "seekTo", [time, id]) : null;
  if (live?.error) return setStatus(live.error);
  if (live) {
    v.t = live.t;
    v.duration = live.duration;
    showPlayer(live);
  } else {
    v.t = Math.floor(Math.min(v.duration, Math.max(0, time)));
    setStatus(`Resume point ${fmt(v.t)}`);
  }
  await saveVideos(videos);
}

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
        await render();
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
    if (event.isComposing || event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey) return;
    if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const step = settings.scrubSeconds * (event.shiftKey ? settings.shiftMultiplier : 1);
    slider.value = String(Math.min(v.duration,
      Math.max(0, value() + (event.key === "ArrowRight" ? step : -step))));
    preview();
    commit();
  });
  return slider;
}

// Space: play/pause the video in its open tab. Not open → open it (like Enter).
async function togglePlay(id) {
  const videos = await loadVideos();
  const v = videos[id];
  if (!v) return;

  const tab = await findVideoTab(id);
  if (!tab) return openVideo(v);

  const state = await inPlayer(tab.id, "toggle", [id]);
  if (state?.error) return setStatus(state.error);
  if (!state) {
    setStatus("Player isn't ready in that tab yet.");
    return;
  }
  showPlayer(state);
  if (!state.duration && v.duration && state.t > v.duration) return setStatus("Invalid player response: position exceeds the saved video duration.");
  v.t = state.t;
  v.duration = state.duration || v.duration || 0;
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
  if (aboutDialog.open) {
    if (e.key === "Escape" && !WAYPOINTS_ESCAPE_CLOSES_POPUP) {
      e.preventDefault();
      e.stopPropagation();
      closeAbout();
    }
    return;
  }
  // Native select navigation/type-ahead must not invoke popup shortcuts.
  if ([themeSelect, deletionModeEl, trashDaysEl].includes(document.activeElement)) return;
  if (fileSaveDialog.open) {
    if (e.key === "Escape") { e.preventDefault(); closeFileSave(); }
    return;
  }
  if (formatMenuOpen) {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.key === "Escape") { e.preventDefault(); closeFormatMenu(); }
    else if (e.key === "Tab") closeFormatMenu();
    else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
      e.preventDefault();
      const index = e.key === "Home" ? 0 : e.key === "End" ? formatChoices.length - 1
        : Math.max(0, Math.min(formatChoices.length - 1, formatPreviewIndex + (e.key === "ArrowDown" ? 1 : -1)));
      previewFormat(index, true);
    } else if (["Enter", " "].includes(e.key)) {
      e.preventDefault();
      if (!e.repeat) selectFormat(formatPreviewIndex);
    }
    return;
  }
  // Chromium can consume Escape here. Firefox reserves it for closing the
  // entire toolbar popup, outside the control of content event listeners.
  if (e.key === "Escape" && WAYPOINTS_ESCAPE_CLOSES_POPUP) return;
  if (e.key === "Escape" && (helpDialog.open || helpEscapeHeld)) {
    e.preventDefault();
    e.stopPropagation();
    helpEscapeHeld = true;
    closeHelp();
    return;
  }
  if (document.activeElement?.type === "checkbox") return;
  const modified = e.ctrlKey || e.altKey || e.metaKey;
  const helpKey = e.key === "?" || e.key.toLowerCase() === "h";
  if (helpDialog.open) {
    if (!modified && helpKey) {
      e.preventDefault();
      if (!e.repeat) closeHelp();
    }
    return;
  }
  if (modified) return;
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
  if (e.key === "t" && !e.ctrlKey && !e.altKey && !e.metaKey &&
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
  // The document runs in capture, before a range can stop propagation.
  // Its arrows belong to that control, not the enclosing bookmark row.
  const keyTarget = e.target || document.activeElement;
  if (keyTarget?.type === "range" && ["ArrowLeft", "ArrowRight"].includes(e.key)) return;
  const items = focusables();
  const row = items.find((item) => item.dataset.id && item.dataset.id === document.activeElement?.dataset?.id)
    || document.activeElement;
  const i = items.indexOf(row);
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    const next = e.key === "ArrowDown" ? Math.min(items.length - 1, i + 1) : Math.max(0, i - 1);
    items[next]?.focus();
    return;
  }
  if (!row?.classList.contains("main")) return;
  const id = row.dataset.id;
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
    enqueue(() => controlPlayback(id, rate ? "rate" : "frame", [".", ">"].includes(e.key) ? 1 : -1));
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
    pendingFocusIndex = i; // same position after re-render
    enqueue(() => deleteVideo(id));
  }
}, true);

document.addEventListener("keyup", (e) => {
  if (e.key !== "Escape" || !helpEscapeHeld) return;
  e.preventDefault();
  e.stopPropagation();
  helpEscapeHeld = false;
}, true);

async function render() {
  const snapshot = await WAYPOINTS_STORAGE.read();
  savedVideos = snapshot.videos;
  videoSnapshots.set(savedVideos, snapshot);
  trashVideos = snapshot.trash;
  currentDeleted = snapshot.records[currentId]?.life.deleted === true;
  document.getElementById("trash-count").textContent = `${Object.keys(trashVideos).length} in trash. Empty trash permanently deletes these bookmarks.`;
  updateHint();
  renderList();
}

function renderList() {
  // Native range dragging must retain the same DOM node until release/cancel.
  if (activeScrubber) return;
  updateHeaderMode();
  const query = searchEl.value.trim().toLocaleLowerCase();
  clearSearchEl.hidden = searchEl.value.length === 0;
  const videos = [...Object.values(savedVideos), ...(settings.showTrash ? Object.values(trashVideos) : [])]
    .filter((v) => !query || (v.title || "").toLocaleLowerCase().includes(query) ||
      (settings.includeChannelNames && (v.channelName || "").toLocaleLowerCase().includes(query)))
    .sort((a, b) => Number(Object.hasOwn(trashVideos, a.id)) - Number(Object.hasOwn(trashVideos, b.id)) ||
      b.updated - a.updated);
  // Keep keyboard focus on the same row or slider across re-renders.
  const focusedId = document.activeElement?.dataset?.id;
  const focusedSlider = document.activeElement?.type === "range" && document.activeElement.classList.contains("bar");
  listEl.replaceChildren();
  if (!videos.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = query ? "No matching videos." : "No bookmarks yet.";
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

    details.append(title);
    if (v.channelName) {
      const channel = document.createElement("div");
      channel.className = "channel-name";
      channel.textContent = v.channelName;
      details.append(channel);
    }
    if (inTrash) meta.textContent = `Trash · ${meta.textContent}`;
    details.append(meta);

    if (v.duration && !inTrash) {
      details.append(makeScrubber(v, meta, when));
    }
    main.append(details);

    const del = document.createElement("button");
    del.className = "del";
    del.tabIndex = -1;
    del.textContent = "×";
    del.title = inTrash || settings.deletionMode === "permanent" ? "Permanently delete" : "Move to trash";
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

async function init() {
  let expiryError = null;
  try { await WAYPOINTS_STORAGE.expire(); } catch (error) { expiryError = error.message; }
  document.getElementById("shortcut-help").textContent = WAYPOINTS_SHORTCUT_HELP;
  const [{ settings: saved }, tab] = await Promise.all([
    api.storage.local.get("settings"), activeTab(),
  ]);
  settings = normalizeSettings(saved);
  onVideo = WATCH_RE.test(tab?.url || "") && Boolean(videoIdOf(tab.url));
  currentId = onVideo ? videoIdOf(tab.url) : null;
  themeSelect.replaceChildren(...WAYPOINTS_THEME.choices.map(theme => {
    const option = document.createElement("option");
    option.value = theme.id;
    option.textContent = theme.label;
    return option;
  }));
  themeSelect.addEventListener("change", () => {
    const theme = WAYPOINTS_THEME.normalize(themeSelect.value);
    enqueue(() => persistSettings({ ...settings, theme }));
  });
  initTranscriptControls();
  updateSettingsUI();
  copyVideosEl.addEventListener("click", () => copyVideos());
  helpToggle.addEventListener("click", openHelp);
  aboutToggle.addEventListener("click", openAbout);
  document.getElementById("about-close").addEventListener("click", closeAbout);
  aboutDialog.addEventListener("cancel", (event) => { event.preventDefault(); closeAbout(); });
  aboutDialog.addEventListener("click", (event) => {
    const bounds = aboutDialog.getBoundingClientRect();
    if (event.target === aboutDialog && (event.clientX < bounds.left || event.clientX > bounds.right ||
        event.clientY < bounds.top || event.clientY > bounds.bottom)) closeAbout();
  });
  helpClose.addEventListener("click", closeHelp);
  helpDialog.addEventListener("cancel", (event) => { event.preventDefault(); closeHelp(); });
  helpDialog.addEventListener("click", (event) => {
    const bounds = helpDialog.getBoundingClientRect();
    if (event.target === helpDialog && (event.clientX < bounds.left || event.clientX > bounds.right ||
        event.clientY < bounds.top || event.clientY > bounds.bottom)) closeHelp();
  });
  restoreBookmarkEl.addEventListener("click", () => enqueue(restoreBookmark));
  searchEl.addEventListener("input", renderList);
  document.addEventListener("focusin", event => {
    if (event.target?.dataset?.id) transcriptTargetId = event.target.dataset.id;
  });
  document.addEventListener("paste", pasteIntoPopup);
  clearSearchEl.addEventListener("click", () => {
    searchEl.value = "";
    renderList();
    searchEl.focus();
  });
  optionsToggle.addEventListener("click", () => {
    setOptionsOpen(!optionsOpen);
  });
  autoBookmarkEl.addEventListener("change", () => changeSetting("autoBookmark", autoBookmarkEl.checked));
  includeChannelsEl.addEventListener("change", () => changeSetting("includeChannelNames", includeChannelsEl.checked));
  offerSaveFileEl.addEventListener("change", () => changeSetting("offerSaveFile", offerSaveFileEl.checked));
  deletionModeEl.addEventListener("change", () => changeSetting("deletionMode", deletionModeEl.value));
  showTrashEl.addEventListener("change", () => changeSetting("showTrash", showTrashEl.checked));
  trashDaysEl.addEventListener("change", () => {
    const days = Number(trashDaysEl.value);
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      updateSettingsUI();
      return setStatus("Choose a trash retention time from 1 to 365 days.");
    }
    changeSetting("trashDays", days);
  });
  emptyTrashEl.addEventListener("click", () => enqueue(emptyTrash));
  thumbnailsEl.addEventListener("change", () => {
    setThumbnails(thumbnailsEl.checked).catch((error) => setStatus(error.message));
  });
  for (const slider of [scrubSecondsEl, shiftMultiplierEl]) {
    slider.addEventListener("input", () => {
      document.getElementById("scrub-value").textContent = `${scrubSecondsEl.value} s`;
      document.getElementById("multiplier-value").textContent = `×${shiftMultiplierEl.value}`;
      document.getElementById("shift-preview").textContent = `Shift + ← or → moves ${Number(scrubSecondsEl.value) * Number(shiftMultiplierEl.value)} seconds.`;
    });
    slider.addEventListener("change", () => changeSetting(slider === scrubSecondsEl ? "scrubSeconds" : "shiftMultiplier", Number(slider.value)));
  }
  // Only bookmark on popup activation, never as a side effect of rendering.
  if (onVideo) {
    const { videos, trash, records } = await WAYPOINTS_STORAGE.read();
    if (settings.autoBookmark && !videos[currentId] && !trash[currentId] && !records[currentId]?.life.deleted) await bookmarkCurrent();
    else if (videos[currentId]) await refreshCurrentChannel();
  }
  await render();
  searchEl.disabled = false;
  optionsToggle.disabled = false;
  for (const control of [deletionModeEl, trashDaysEl, showTrashEl, emptyTrashEl]) control.disabled = false;
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

// Refresh live when bookmarks or preferences change.
api.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.settings) {
    const next = normalizeSettings(changes.settings.newValue);
    if (next.autoBookmark !== settings.autoBookmark) searchRequested = false;
    settings = next;
    updateSettingsUI();
  }
  if (WAYPOINTS_STORAGE.changed(changes) || changes.settings) render().catch((e) => setStatus(e.message));
});
if (typeof setInterval === "function") {
  setInterval(() => WAYPOINTS_STORAGE.expire().catch(error => setStatus(error.message)), 60000);
}
init().catch((e) => setStatus(`Couldn't open YT Waypoints: ${e.message}`));
