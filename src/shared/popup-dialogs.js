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
  const helpDialog = document.getElementById("help-dialog");
  const helpToggle = document.getElementById("help-toggle");
  const helpClose = document.getElementById("help-close");
  const aboutDialog = document.getElementById("about-dialog");
  const aboutToggle = document.getElementById("about-toggle");
  let helpPreviousFocus = null;
  let helpPreviousRowId = null;

  function updateHint() {
    const settings = getSettings();
    document.getElementById("help-escape").textContent = escapeClosesPopup
      ? "Close entire popup (Firefox)"
      : "Close help";
    document.getElementById("help-scrub").textContent = `Scrub ${settings.scrubSeconds} seconds`;
    document.getElementById("help-multiplier").textContent =
      `×${settings.shiftMultiplier} (${settings.scrubSeconds * settings.shiftMultiplier} seconds)`;
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
    const row =
      helpPreviousRowId &&
      listEl.querySelector(`.main[data-id="${CSS.escape(helpPreviousRowId)}"]`);
    (row || (helpPreviousRowId ? headerControl() : helpPreviousFocus))?.focus();
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
    helpToggle.addEventListener("click", openHelp);
    aboutToggle.addEventListener("click", openAbout);
    document.getElementById("about-close").addEventListener("click", closeAbout);
    aboutDialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      closeAbout();
    });
    aboutDialog.addEventListener("click", (event) => {
      const bounds = aboutDialog.getBoundingClientRect();
      if (
        event.target === aboutDialog &&
        (event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom)
      )
        closeAbout();
    });
    helpClose.addEventListener("click", closeHelp);
    helpDialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      closeHelp();
    });
    helpDialog.addEventListener("click", (event) => {
      const bounds = helpDialog.getBoundingClientRect();
      if (
        event.target === helpDialog &&
        (event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom)
      )
        closeHelp();
    });
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
