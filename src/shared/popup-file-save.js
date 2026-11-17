import { downloadFile } from "./file-download.mjs";
// Optional save UI owns only transient copied output, focus and download resources.
// Export orchestration decides whether to offer a file after a successful copy.
globalThis.WAYPOINTS_CREATE_FILE_SAVE = ({
  document,
  listEl,
  headerControl,
  setStatus,
  beforeOpen,
}) => {
  const { restoreFocus, bindDialogDismissal } = WAYPOINTS_POPUP_DOM;
  const fileSaveDialog = document.getElementById("file-save-dialog");
  const fileNameFields = document.getElementById("file-name-fields");
  const fileSaveName = document.getElementById("file-save-name");
  const fileSaveConfirm = document.getElementById("file-save-confirm");
  let fileSaveOutput = null;
  let fileSavePreviousFocus = null;

  function offerFileSave(output) {
    if (fileSaveDialog.open) return;
    beforeOpen();
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
    restoreFocus({
      previousFocus: fileSavePreviousFocus,
      rowId: fileSavePreviousFocus?.dataset?.id,
      listEl,
      fallback: headerControl,
    });
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
      downloadFile(document, { ...fileSaveOutput, filename });
      closeFileSave();
      setStatus(`Copied to clipboard. File download requested: ${filename}`);
    } catch (error) {
      document.getElementById("file-save-error").textContent =
        `Could not save file: ${error.message}. Your clipboard copy is unchanged.`;
    }
  }

  function init() {
    fileSaveConfirm.addEventListener("click", confirmFileSave);
    document.getElementById("file-save-cancel").addEventListener("click", closeFileSave);
    bindDialogDismissal(fileSaveDialog, closeFileSave, { outsideClick: false });
    fileSaveName.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        if (!event.repeat) confirmFileSave();
      }
    });
  }

  return Object.freeze({
    init,
    offer: offerFileSave,
    close: closeFileSave,
    get isOpen() {
      return fileSaveDialog.open;
    },
  });
};
