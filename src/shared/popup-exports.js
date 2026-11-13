// Clipboard-first export flows, transcript format UI, and optional file offers.
globalThis.WAYPOINTS_CREATE_POPUP_EXPORTS = ({
  document,
  formats,
  transfer,
  player,
  getSettings,
  getVideos,
  getCurrentId,
  changeSetting,
  setStatus,
  listEl,
  headerControl,
  closeOtherDialogs,
}) => {
  const copyVideosEl = document.getElementById("copy-videos");
  const formatToggle = document.getElementById("transcript-format-toggle");
  const formatMenu = document.getElementById("transcript-format-menu");
  const formatList = document.getElementById("transcript-format-list");
  const transcriptCopyEl = document.getElementById("copy-transcript");
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
  const { findVideoTab, inPlayer } = player;

  function updateTranscriptTarget() {
    const video =
      getVideos()[transcriptTargetId] ||
      (transcriptTargetId && transcriptTargetId === getCurrentId()
        ? { title: "Current YouTube video" }
        : null);
    document.getElementById("transcript-target").textContent = video
      ? `Video: ${video.title || transcriptTargetId}`
      : "Select a bookmark before opening Settings, or open a YouTube video.";
    transcriptCopyEl.disabled = transcriptPending || !video;
  }

  function previewFormat(index, focus = false) {
    formatPreviewIndex = index;
    const format = formats.formats[index];
    document.getElementById("transcript-format-use").textContent = format.use;
    document.getElementById("transcript-format-description").textContent = format.description;
    document.getElementById("transcript-format-example").textContent = format.example;
    formatChoices.forEach((choice, choiceIndex) => {
      choice.tabIndex = choiceIndex === index ? 0 : -1;
      choice.classList.toggle("preview", choiceIndex === index);
    });
    if (focus) formatChoices[index]?.focus();
  }

  function closeFormatMenu(restoreFocus = true) {
    if (!formatMenuOpen) return;
    formatMenuOpen = false;
    formatMenu.hidden = true;
    formatToggle.setAttribute("aria-expanded", "false");
    if (restoreFocus) formatToggle.focus();
  }

  function openFormatMenu() {
    formatMenuOpen = true;
    formatMenu.hidden = false;
    formatToggle.setAttribute("aria-expanded", "true");
    // Keep the picker and its examples in view inside the fixed Options frame.
    formatToggle.scrollIntoView({ block: "start" });
    previewFormat(
      formats.formats.findIndex((format) => format.id === getSettings().transcriptFormat),
      true,
    );
  }

  function selectFormat(index) {
    const format = formats.formats[index];
    closeFormatMenu();
    changeSetting("transcriptFormat", format.id);
  }

  function initTranscriptControls() {
    formats.formats.forEach((format, index) => {
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
    formatToggle.addEventListener("click", () =>
      formatMenuOpen ? closeFormatMenu() : openFormatMenu(),
    );
    formatToggle.addEventListener("keydown", (event) => {
      if (!formatMenuOpen && ["ArrowDown", "ArrowUp"].includes(event.key)) {
        event.preventDefault();
        event.stopPropagation();
        openFormatMenu();
      }
    });
    document.addEventListener("click", (event) => {
      if (
        formatMenuOpen &&
        !document.getElementById("transcript-format-picker").contains(event.target)
      )
        closeFormatMenu(false);
    });
    transcriptCopyEl.addEventListener("click", () => exportTranscript(transcriptTargetId));
    fileSaveConfirm.addEventListener("click", confirmFileSave);
    document.getElementById("file-save-cancel").addEventListener("click", closeFileSave);
    fileSaveDialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      closeFileSave();
    });
    fileSaveName.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        if (!event.repeat) confirmFileSave();
      }
    });
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

  async function copyVideos(videos = getVideos(), allVideos = true) {
    const text = transfer.stringify(videos);
    const copied = await copyText(
      text,
      `Copied ${Object.keys(videos).length} videos as JSON.`,
      "Could not copy JSON. Please try again.",
    );
    if (copied && allVideos) {
      offerFileSave({
        text,
        filename: `yt-waypoints-bookmarks-${new Date().toISOString().slice(0, 10)}.json`,
        mime: "application/json;charset=utf-8",
      });
    }
  }

  function offerFileSave(output) {
    if (!getSettings().offerSaveFile || fileSaveDialog.open) return;
    closeOtherDialogs();
    closeFormatMenu(false);
    fileSavePreviousFocus = document.activeElement;
    fileSaveOutput = output;
    fileNameFields.hidden = true;
    fileSaveName.value = output.filename;
    fileSaveConfirm.textContent = "Yes";
    document.getElementById("file-save-cancel").textContent = "No thanks";
    document.getElementById("file-save-title").textContent = "Also save to file?";
    document.getElementById("file-save-description").textContent =
      `Already copied to the clipboard. Suggested file: ${output.filename}`;
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
    if (
      !filename ||
      filename === "." ||
      filename === ".." ||
      /[\\/:*?"<>|\u0000-\u001f]/.test(filename)
    ) {
      document.getElementById("file-save-error").textContent =
        'Enter a filename without folder paths or these characters: / \\ : * ? " < > |';
      fileSaveName.focus();
      return;
    }
    const extension = fileSaveOutput.filename.split(".").at(-1);
    if (!filename.toLowerCase().endsWith(`.${extension}`)) filename += `.${extension}`;
    try {
      const url = URL.createObjectURL(
        new Blob([fileSaveOutput.text], { type: fileSaveOutput.mime }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.append(link);
      try {
        link.click();
      } finally {
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
      }
      closeFileSave();
      setStatus(`Copied to clipboard. File download requested: ${filename}`);
    } catch (error) {
      document.getElementById("file-save-error").textContent =
        `Could not save file: ${error.message}. Your clipboard copy is unchanged.`;
    }
  }

  let transcriptPending = false;
  async function exportTranscript(id) {
    if (transcriptPending) return;
    if (!id) return setStatus("Select a bookmark or open a YouTube video first.");
    const formatId = getSettings().transcriptFormat;
    const video = { ...(getVideos()[id] || { id, title: id }) };
    transcriptPending = true;
    updateTranscriptTarget();
    try {
      const tab = await findVideoTab(id);
      if (!tab) return setStatus("Open this video on YouTube first to copy its transcript.");
      setStatus("Loading transcript…");
      const result = await inPlayer(tab.id, "transcript", [id]);
      if (result?.error) return setStatus(`Could not copy transcript: ${result.error}`);
      const transcript = formats.prepare(video, result);
      const output = formats.output(transcript, formatId);
      const copied = await copyText(
        output.text,
        "Copied video transcript.",
        "Could not copy transcript. Please try again.",
      );
      if (copied) offerFileSave(output);
    } catch (error) {
      setStatus(error.message);
    } finally {
      transcriptPending = false;
      updateTranscriptTarget();
    }
  }

  function handleFormatKey(e) {
    if (!formatMenuOpen) return false;
    if (e.ctrlKey || e.altKey || e.metaKey) return true;
    if (e.key === "Escape") {
      e.preventDefault();
      closeFormatMenu();
    } else if (e.key === "Tab") {
      closeFormatMenu();
    } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
      e.preventDefault();
      const index =
        e.key === "Home"
          ? 0
          : e.key === "End"
            ? formatChoices.length - 1
            : Math.max(
                0,
                Math.min(
                  formatChoices.length - 1,
                  formatPreviewIndex + (e.key === "ArrowDown" ? 1 : -1),
                ),
              );
      previewFormat(index, true);
    } else if (["Enter", " "].includes(e.key)) {
      e.preventDefault();
      if (!e.repeat) selectFormat(formatPreviewIndex);
    }
    return true;
  }

  function captureTarget() {
    transcriptTargetId =
      document.activeElement?.dataset?.id || transcriptTargetId || getCurrentId();
    updateTranscriptTarget();
  }

  function updateFormatUI(formatId) {
    formatToggle.textContent = formats.get(formatId).label;
    formatChoices.forEach((choice) =>
      choice.setAttribute("aria-selected", String(choice.dataset.format === formatId)),
    );
  }

  function init() {
    initTranscriptControls();
    copyVideosEl.addEventListener("click", () => copyVideos());
    document.addEventListener("focusin", (event) => {
      if (event.target?.dataset?.id) transcriptTargetId = event.target.dataset.id;
    });
  }

  return Object.freeze({
    init,
    updateFormatUI,
    captureTarget,
    handleFormatKey,
    copyText,
    copyVideos,
    exportTranscript,
    closeFormatMenu,
    closeFileSave,
    get fileSaveOpen() {
      return fileSaveDialog.open;
    },
  });
};
