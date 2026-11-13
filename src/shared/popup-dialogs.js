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
  const explanations = WAYPOINTS_CREATE_DISCLOSURES(".shortcut-explanation");

  function navigateHelp(event) {
    if (
      !helpDialog.open ||
      event.defaultPrevented ||
      event.isComposing ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.shiftKey ||
      !["ArrowDown", "ArrowUp"].includes(event.key)
    )
      return;
    const rows = [...helpDialog.querySelectorAll(".shortcut > summary")];
    if (!rows.length) return;
    const index = rows.indexOf(document.activeElement);
    const down = event.key === "ArrowDown";
    const next =
      index < 0
        ? down
          ? 0
          : rows.length - 1
        : Math.max(0, Math.min(rows.length - 1, index + (down ? 1 : -1)));
    event.preventDefault();
    event.stopPropagation();
    rows[next].focus();
    rows[next].scrollIntoView({ block: "nearest" });
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
    helpDialog.addEventListener("keydown", navigateHelp);
    for (const row of helpDialog.querySelectorAll(".shortcut")) {
      row.querySelector("summary").addEventListener("click", (event) => {
        event.preventDefault();
        explanations.toggle(row);
      });
    }
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
