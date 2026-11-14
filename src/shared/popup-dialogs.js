// Help and About lifecycle, including return to a surviving row/control.
globalThis.WAYPOINTS_CREATE_POPUP_DIALOGS = ({
  document,
  api,
  getSettings,
  escapeClosesPopup,
  isFileSaveOpen,
  closeFormatMenu,
  listEl,
  headerControl,
}) => {
  const { navigateSummaries, restoreFocus, bindDialogDismissal } = WAYPOINTS_POPUP_DOM;
  const helpDialog = document.getElementById("help-dialog");
  const helpToggle = document.getElementById("help-toggle");
  const helpClose = document.getElementById("help-close");
  const aboutDialog = document.getElementById("about-dialog");
  const aboutToggle = document.getElementById("about-toggle");
  let helpPreviousFocus = null;
  let helpPreviousRowId = null;
  const explanations = WAYPOINTS_CREATE_DISCLOSURES(".shortcut-explanation");
  const helpRows = [...helpDialog.querySelectorAll(".shortcut")];
  const helpHeadings = helpRows.map((row) => row.querySelector("summary"));

  function navigateHelp(event) {
    if (!helpDialog.open) return;
    navigateSummaries(event, helpHeadings, document.activeElement, { enterFromOutside: true });
  }

  function updateHint() {
    const settings = getSettings();
    document.getElementById("help-escape").textContent = escapeClosesPopup
      ? "Close popup"
      : "Close help";
    document.getElementById("help-escape-detail").textContent = escapeClosesPopup
      ? "Firefox reserves Escape for closing the entire toolbar popup. Use Close, h, or ? to close only this help and return to your selected row."
      : "Close this help and return focus to the selected row or control. In the annotation editor, Escape cancels the draft. Outside these views, the browser can close the popup.";
    document.getElementById("help-scrub").textContent = `Scrub ${settings.scrubSeconds}s`;
    document.getElementById("help-scrub-detail").textContent =
      `Move the selected video's live or saved position by ${settings.scrubSeconds} seconds. On a progress slider, arrows change that slider once; playing or paused state is preserved.`;
    document.getElementById("help-multiplier").textContent =
      `Scrub ${settings.scrubSeconds * settings.shiftMultiplier}s`;
    document.getElementById("help-multiplier-detail").textContent =
      `Hold Shift with the scrub arrows to apply your ×${settings.shiftMultiplier} multiplier, moving ${settings.scrubSeconds * settings.shiftMultiplier} seconds. Configure both values in Settings.`;
  }

  function openHelp() {
    if (helpDialog.open) return;
    helpPreviousFocus = document.activeElement;
    helpPreviousRowId = helpPreviousFocus?.dataset?.id;
    updateHint();
    document.body.classList.add("help-open");
    document.documentElement.classList.add("help-open");
    helpDialog.showModal();
  }

  function closeHelp() {
    if (!helpDialog.open) return;
    explanations.settle();
    helpDialog.close();
    document.body.classList.remove("help-open");
    document.documentElement.classList.remove("help-open");
    restoreFocus({
      previousFocus: helpPreviousFocus,
      rowId: helpPreviousRowId,
      listEl,
      fallback: headerControl,
    });
  }

  function openAbout() {
    if (aboutDialog.open || helpDialog.open || isFileSaveOpen()) return;
    closeFormatMenu(false);
    document.getElementById("about-version").textContent =
      `Version ${api.runtime.getManifest().version}`;
    document.body.classList.add("about-open");
    aboutDialog.showModal();
  }

  function closeAbout() {
    if (!aboutDialog.open) return;
    aboutDialog.close();
    document.body.classList.remove("about-open");
    aboutToggle.focus();
  }

  function init() {
    helpDialog.addEventListener("keydown", navigateHelp);
    for (const [index, row] of helpRows.entries()) {
      helpHeadings[index].addEventListener("click", (event) => {
        event.preventDefault();
        explanations.toggle(row);
      });
    }
    helpToggle.addEventListener("click", openHelp);
    aboutToggle.addEventListener("click", openAbout);
    document.getElementById("about-close").addEventListener("click", closeAbout);
    bindDialogDismissal(aboutDialog, closeAbout);
    helpClose.addEventListener("click", closeHelp);
    bindDialogDismissal(helpDialog, closeHelp);
  }

  return Object.freeze({
    init,
    updateHint,
    openHelp,
    closeHelp,
    openAbout,
    closeAbout,
    get helpOpen() {
      return helpDialog.open;
    },
    get aboutOpen() {
      return aboutDialog.open;
    },
  });
};
