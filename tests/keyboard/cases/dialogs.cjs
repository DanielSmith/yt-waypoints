// Executed in the actual popup bundle scope; helpers are explicit test ports.
module.exports = async function dialogsCases({ cases, check, press }) {
  const helpBounds = document.getElementById("help-dialog");
  const focusSource = document.querySelector(".main");
  focusSource.focus();
  dialogs.openHelp();
  await render();
  const replacementSource = document.querySelector(".main");
  check(
    replacementSource !== focusSource && !focusSource.isConnected,
    "Focus test did not replace the bookmark row",
  );
  dialogs.closeHelp();
  check(
    document.activeElement === replacementSource,
    "Help must return to the replacement row rather than its detached predecessor",
  );
  dialogs.openHelp();
  replacementSource.parentElement.remove();
  dialogs.closeHelp();
  check(
    document.activeElement === headerControl(),
    "A missing Help source row must return to the current header control",
  );
  await render();
  const transient = document.createElement("button");
  transient.textContent = "Temporary focus fixture";
  document.body.append(transient);
  transient.focus({ preventScroll: true });
  dialogs.openHelp();
  transient.remove();
  dialogs.closeHelp();
  check(
    document.activeElement === headerControl(),
    "Detached non-row controls need a live focus fallback",
  );
  dialogs.openAbout();
  const about = document.getElementById("about-dialog");
  about.querySelector("strong").click();
  check(about.open, "A click inside About must not dismiss it");
  const aboutRect = about.getBoundingClientRect();
  about.dispatchEvent(
    new MouseEvent("click", {
      bubbles: true,
      clientX: aboutRect.left - 1,
      clientY: aboutRect.top + 5,
    }),
  );
  check(
    !about.open && document.activeElement === document.getElementById("about-toggle"),
    "Outside About dismissal must restore its toolbar button",
  );
  dialogs.openHelp();
  const helpRect = helpBounds.getBoundingClientRect();
  helpBounds.dispatchEvent(
    // MouseEvent rounds coordinates to integer pixels. At a fractional dialog
    // edge, rounding down would synthesize an outside click instead of inside.
    new MouseEvent("click", {
      bubbles: true,
      clientX: Math.ceil(helpRect.left),
      clientY: Math.ceil(helpRect.top),
    }),
  );
  check(helpBounds.open, "The Help boundary is inside, not an outside-click dismissal");
  helpBounds.dispatchEvent(
    new MouseEvent("click", {
      bubbles: true,
      clientX: helpRect.right + 1,
      clientY: helpRect.top + 5,
    }),
  );
  check(
    !helpBounds.open && document.activeElement === document.getElementById("about-toggle"),
    "Help outside dismissal must return to the surviving previous control",
  );
  const saveDialog = document.getElementById("file-save-dialog");
  saveDialog.showModal();
  saveDialog.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: -1, clientY: -1 }));
  check(saveDialog.open, "File-save prompts must not inherit outside-click dismissal");
  const saveCancel = new Event("cancel", { cancelable: true });
  saveDialog.dispatchEvent(saveCancel);
  check(
    saveCancel.defaultPrevented && !saveDialog.open,
    "File-save native cancel must use its owner close action",
  );
  cases.push(
    "Shared dialog helpers preserve current-row/control focus, outside-click bounds and cancel-only file-save policy",
  );

  const saveSource = () => document.querySelector('.main[data-id="aaaaaaaaaaa"]');
  saveSource().focus();
  fileSaveController.offer({
    text: "Fixture copy",
    filename: "fixture.json",
    mime: "application/json",
  });
  check(
    saveDialog.open && document.activeElement.id === "file-save-cancel",
    "File offer must focus No thanks",
  );
  document.getElementById("file-save-confirm").click();
  const saveName = document.getElementById("file-save-name");
  check(
    document.activeElement === saveName &&
      saveName.selectionStart === 0 &&
      saveName.selectionEnd === saveName.value.length,
    "Yes must reveal and select the filename",
  );
  saveName.value = "../bad";
  await press(saveName, "Enter");
  check(
    saveDialog.open &&
      document.activeElement === saveName &&
      document.getElementById("file-save-error").textContent.includes("filename"),
    "Invalid filename must keep the dialog and input focus",
  );
  await render();
  const saveEscape = await press(saveName, "Escape");
  // Synthetic key events do not perform the native dialog-cancel default.
  // Filename editing leaves Escape native; dispatch the browser's cancel event.
  if (!saveEscape.defaultPrevented)
    saveDialog.dispatchEvent(new Event("cancel", { cancelable: true }));
  check(
    !saveDialog.open && document.activeElement === saveSource(),
    "File-save Escape must restore the surviving current row",
  );
  fileSaveController.offer({ text: "Next copy", filename: "next.json", mime: "application/json" });
  check(
    document.getElementById("file-name-fields").hidden &&
      !document.getElementById("file-save-error").textContent,
    "A new file offer must reset filename stage and errors",
  );
  document.getElementById("file-save-cancel").click();
  check(document.activeElement === saveSource(), "No thanks must restore row focus");
  cases.push(
    "Extracted file-save dialog preserves offer/filename stages, input selection, invalid-name focus, Escape return and reopening",
  );
};
