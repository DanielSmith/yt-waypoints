// Copyright 2026 Daniel Smith
// SPDX-License-Identifier: Apache-2.0
// The one on-demand annotation form. Domain snapshots stay in its bound save
// operation; the UI receives only immutable identity, original note and lifetime.
globalThis.WAYPOINTS_CREATE_ANNOTATION_EDITOR = ({
  document,
  enqueue,
  maxNoteCharacters,
  fmt,
  refresh,
  focusRow,
  onSaved,
}) => {
  let session = null;
  const editorEl = document.getElementById("annotation-editor");
  const contentEl = editorEl.querySelector(".annotation-content");
  const targetEl = document.getElementById("annotation-target");
  const editorHome = editorEl.parentNode || document.body;
  const listEl = document.getElementById("list");
  let editorRow = null;
  let editorMotion = null;
  let closingEditor = null;
  let editorObserver = null;

  function ensureEditorVisible() {
    if (!editorRow || typeof editorRow.getBoundingClientRect !== "function") return;
    const row = editorRow.getBoundingClientRect();
    const viewport = listEl.getBoundingClientRect();
    const inputHeight = noteEl.getBoundingClientRect().height;
    const rowHeight = row.height - editorEl.getBoundingClientRect().height;
    const otherEditorHeight = contentEl.getBoundingClientRect().height - inputHeight;
    // Read the pixel tokens that also constrain the native input; CSS owns the
    // dimensions, while this calculation only fits them into the current row.
    const layout = globalThis.getComputedStyle(noteEl);
    const minimumInputHeight = parseFloat(layout.getPropertyValue("--annotation-input-min-height"));
    const maximumInputHeight = parseFloat(layout.getPropertyValue("--annotation-input-max-height"));
    const scrollClearance = parseFloat(layout.getPropertyValue("--annotation-scroll-clearance"));
    const inputLimit = Math.floor(
      Math.max(
        minimumInputHeight,
        Math.min(
          maximumInputHeight,
          viewport.height - rowHeight - otherEditorHeight - 2 * scrollClearance,
        ),
      ),
    );
    // Leave room for the source row, actions and validation text. Long notes
    // scroll within the textarea rather than pushing Save/Cancel offscreen.
    const limit = `${inputLimit}px`;
    if (noteEl.style.getPropertyValue("--annotation-input-max") !== limit)
      noteEl.style.setProperty("--annotation-input-max", limit);
    // Follow the growing row as it reveals. Reserving a few pixels also keeps
    // the bottom border and control focus rings off the scrollport edge.
    if (row.bottom > viewport.bottom - scrollClearance)
      listEl.scrollTop += row.bottom - viewport.bottom + scrollClearance;
    else if (row.top < viewport.top + scrollClearance)
      listEl.scrollTop += row.top - viewport.top - scrollClearance;
  }

  function revealEditor() {
    editorEl.hidden = false;
    document.body.classList.add("annotation-open");
    document.documentElement.classList.add("annotation-open");
    if (typeof globalThis.ResizeObserver === "function") {
      editorObserver = new ResizeObserver(ensureEditorVisible);
      editorObserver.observe(editorEl);
      editorObserver.observe(listEl);
      editorObserver.observe(contentEl);
    }
    const height = typeof editorEl.animate === "function" ? editorEl.scrollHeight : 0;
    const animation = WAYPOINTS_ANIMATE_HEIGHT(editorEl, 0, height);
    editorMotion = animation;
    if (animation) {
      animation.finished.then(
        () => {
          if (editorMotion !== animation) return;
          editorMotion = null;
          animation.cancel();
          ensureEditorVisible();
        },
        () => {},
      );
    }
    noteEl.focus({ preventScroll: true });
    ensureEditorVisible();
  }
  const noteEl = document.getElementById("annotation-text");
  noteEl.maxLength = maxNoteCharacters;
  const saveEl = document.getElementById("annotation-save");
  const cancelEl = document.getElementById("annotation-cancel");
  const errorEl = document.getElementById("annotation-error");

  function open({ draft, save }) {
    if (session || closingEditor) return false;
    const row = listEl.querySelector(`.main[data-id="${CSS.escape(draft.id)}"]`);
    if (!row) throw new Error("This bookmark is no longer visible.");
    session = Object.freeze({ draft, save });
    editorRow = row.parentNode;
    editorRow.append(editorEl);
    noteEl.value = draft.originalNote;
    targetEl.textContent = `${draft.markerId ? "Marker" : "Video start"} ${fmt(draft.time)}`;
    errorEl.textContent = "";
    saveEl.disabled = false;
    cancelEl.disabled = false;
    revealEditor();
    return true;
  }
  function close() {
    if (closingEditor) return closingEditor;
    if (!session) return Promise.resolve();
    const id = session.draft.id;
    const from =
      typeof editorEl.animate === "function" ? editorEl.getBoundingClientRect().height : 0;
    editorMotion?.cancel();
    const animation = WAYPOINTS_ANIMATE_HEIGHT(editorEl, from, 0);
    editorMotion = animation;
    closingEditor = (async () => {
      if (animation) await animation.finished.catch(() => {});
      editorObserver?.disconnect();
      editorObserver = null;
      editorEl.hidden = true;
      animation?.cancel();
      editorMotion = null;
      editorHome.append(editorEl);
      editorRow = null;
      session = null;
      noteEl.value = "";
      noteEl.style.removeProperty?.("--annotation-input-max");
      errorEl.textContent = "";
      saveEl.disabled = false;
      cancelEl.disabled = false;
      targetEl.textContent = "";
      document.body.classList.remove("annotation-open");
      document.documentElement.classList.remove("annotation-open");
      await refresh();
      focusRow(id);
    })().finally(() => {
      closingEditor = null;
    });
    return closingEditor;
  }

  async function save() {
    if (!session || saveEl.disabled) return;
    const pending = session;
    const note = noteEl.value;
    saveEl.disabled = true;
    cancelEl.disabled = true;
    errorEl.textContent = "";
    try {
      await pending.save(pending.draft, note);
      // Direct callers can close while persistence is pending. A late result
      // belongs to this session, never to a subsequently opened draft.
      if (session !== pending) return;
      await close();
      onSaved();
    } catch (error) {
      if (session === pending) {
        errorEl.textContent = error.message;
        ensureEditorVisible();
      }
    } finally {
      if (!session || session === pending) {
        saveEl.disabled = false;
        cancelEl.disabled = false;
      }
    }
  }

  function init() {
    saveEl.addEventListener("click", () => enqueue(save));
    cancelEl.addEventListener("click", () => enqueue(close));
    saveEl.disabled = false;
    cancelEl.disabled = false;
  }

  return Object.freeze({
    open,
    save,
    close,
    init,
    get draft() {
      return session?.draft || null;
    },
    get isOpen() {
      return Boolean(session);
    },
    get isBusy() {
      return Boolean(session || closingEditor);
    },
  });
};
