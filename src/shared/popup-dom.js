// Narrow popup interaction helpers. Owners retain view state and close actions.
(() => {
  function navigateSummaries(event, headings, activeElement, { enterFromOutside = false } = {}) {
    if (
      event.defaultPrevented ||
      event.isComposing ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.shiftKey ||
      !["ArrowUp", "ArrowDown"].includes(event.key) ||
      !headings.length
    )
      return false;
    const index = headings.indexOf(activeElement);
    if (index < 0 && !enterFromOutside) return false;
    const down = event.key === "ArrowDown";
    const next =
      index < 0
        ? down
          ? 0
          : headings.length - 1
        : Math.max(0, Math.min(headings.length - 1, index + (down ? 1 : -1)));
    event.preventDefault();
    event.stopPropagation();
    headings[next].focus();
    headings[next].scrollIntoView({ block: "nearest" });
    return true;
  }

  function restoreFocus({ previousFocus, rowId, listEl, fallback }) {
    // Find the current row, not the DOM node that may have been replaced while
    // a dialog was open. Detached non-row controls also need a live fallback.
    const row = rowId && listEl.querySelector(`.main[data-id="${CSS.escape(rowId)}"]`);
    const target =
      row || (rowId || previousFocus?.isConnected === false ? fallback() : previousFocus);
    target?.focus();
  }

  function bindDialogDismissal(dialog, close, { outsideClick = true } = {}) {
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      close();
    });
    if (!outsideClick) return;
    dialog.addEventListener("click", (event) => {
      if (event.target !== dialog) return;
      const bounds = dialog.getBoundingClientRect();
      if (
        event.clientX < bounds.left ||
        event.clientX > bounds.right ||
        event.clientY < bounds.top ||
        event.clientY > bounds.bottom
      )
        close();
    });
  }

  globalThis.WAYPOINTS_POPUP_DOM = Object.freeze({
    navigateSummaries,
    restoreFocus,
    bindDialogDismissal,
  });
})();
