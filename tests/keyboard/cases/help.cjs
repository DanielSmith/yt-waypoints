// Executed in the actual popup bundle scope; helpers are explicit test ports.
module.exports = async function helpCases({ cases, check, press, flush, originalMatchMedia }) {
  const beforeHelp = JSON.stringify((await WAYPOINTS_STORAGE.read()).videos);
  const bookmarkFocusStyle = getComputedStyle(document.querySelector(".main").parentElement);
  const bookmarkFocusShadow = bookmarkFocusStyle.boxShadow;
  const bookmarkFocusBackground = bookmarkFocusStyle.backgroundColor;
  dialogs.openHelp();
  const helpRows = [...document.querySelectorAll(".shortcut")];
  const shortcutLabels = [
    ...document.getElementById("help-dialog").querySelectorAll("[data-shortcut-label]"),
  ];
  check(
    shortcutLabels.length === 22 &&
      shortcutLabels.every(
        (label) => label.textContent === WAYPOINTS_SHORTCUTS.label(label.dataset.shortcutLabel),
      ),
    "Help labels do not match the shared shortcut metadata",
  );
  check(
    document.getElementById("help-toggle").title === "Help (h / ?)" &&
      document.getElementById("settings-toggle").getAttribute("aria-keyshortcuts") === "*" &&
      document.getElementById("hint").textContent === "/ search · space play · ↵ open · h / ? help",
    "Toolbar shortcut hints or accessible keys changed",
  );
  check(
    helpRows.length === 22 && helpRows.every((row) => !row.open),
    "Help must start with 22 collapsed rows",
  );
  for (const row of helpRows) {
    const summary = row.querySelector("summary");
    check(summary.getBoundingClientRect().height <= 22, "Shortcut summary wraps or is too tall");
    for (const span of summary.querySelectorAll("span"))
      check(
        span.scrollWidth <= span.clientWidth + 1,
        "Shortcut summary clips: " + span.textContent,
      );
  }
  const helpBounds = document.getElementById("help-dialog");
  const helpFrameGeometry = () => {
    const dialog = helpBounds.getBoundingClientRect();
    const summary = helpRows[0].querySelector("summary").getBoundingClientRect();
    return [
      dialog.left,
      dialog.width,
      summary.left,
      summary.width,
      document.getElementById("help-close").getBoundingClientRect().left,
      dialog.top,
      dialog.height,
      document.documentElement.getBoundingClientRect().height,
      document.documentElement.scrollHeight,
      document.body.getBoundingClientRect().height,
    ];
  };
  const collapsedHelpGeometry = helpFrameGeometry();
  check(
    helpBounds.scrollHeight <= helpBounds.clientHeight + 1,
    `Collapsed shortcut list does not fit without scrolling: scroll=${helpBounds.scrollHeight}, client=${helpBounds.clientHeight}, viewport=${innerWidth}x${innerHeight}, rect=${JSON.stringify(helpBounds.getBoundingClientRect().toJSON())}`,
  );
  cases.push("All shortcut summaries fit one compact line and scan without scrolling");
  const summaryOf = (row) => row.querySelector("summary");
  async function finishExplanation(row) {
    for (const animation of row.querySelector(".shortcut-explanation").getAnimations())
      animation.finish();
    await flush();
  }
  await press(document.getElementById("help-close"), "ArrowDown");
  check(
    getComputedStyle(helpRows[0]).boxShadow === bookmarkFocusShadow &&
      bookmarkFocusShadow !== "none",
    "Help focus outline must match the bookmark row",
  );
  check(
    getComputedStyle(helpRows[0]).backgroundColor === bookmarkFocusBackground,
    "Help focus background must match the bookmark row",
  );
  check(
    getComputedStyle(summaryOf(helpRows[0])).outlineStyle === "none",
    "Help summary still has the old outline",
  );
  check(
    document.activeElement === summaryOf(helpRows[0]),
    "Down from Close must reach first shortcut",
  );
  await press(document.activeElement, "ArrowDown", { repeat: true });
  check(document.activeElement === summaryOf(helpRows[1]), "Down did not move row focus");
  await press(document.activeElement, "ArrowUp");
  await press(document.activeElement, "ArrowUp");
  check(document.activeElement === summaryOf(helpRows[0]), "Up should stop at the first row");
  await press(summaryOf(helpRows.at(-1)), "ArrowDown");
  check(document.activeElement === summaryOf(helpRows.at(-1)), "Down should stop at the last row");
  const modifiedHelpArrow = await press(summaryOf(helpRows[0]), "ArrowDown", { ctrlKey: true });
  check(!modifiedHelpArrow.defaultPrevented, "Modified help arrow intercepted");
  check(
    helpRows.every((row) => !row.open),
    "Arrow navigation toggled a disclosure",
  );
  cases.push("Up/Down help focus, repeat, bounds and modifier ownership");
  globalThis.matchMedia = (query) =>
    query === "(prefers-reduced-motion: reduce)"
      ? { matches: false }
      : originalMatchMedia.call(globalThis, query);
  const content = helpRows[0].querySelector(".shortcut-explanation");
  const measureContent = content.getBoundingClientRect;
  content.getBoundingClientRect = function () {
    return helpRows[0].open ? measureContent.call(this) : { height: 120 };
  };
  summaryOf(helpRows[0]).click();
  delete content.getBoundingClientRect;
  const opening = content.getAnimations()[0];
  check(
    opening && Math.abs(opening.effect.getTiming().duration - 500) < 0.01,
    "Help toggle duration must be 500ms",
  );
  check(opening.effect.getTiming().easing.includes("cubic-bezier"), "Help toggle easing missing");
  check(
    parseFloat(opening.effect.getKeyframes()[0].height) === 0,
    "Help expansion must start at zero even when closed content reports its full height",
  );
  opening.pause();
  opening.currentTime = 250;
  const midway = content.getBoundingClientRect().height;
  check(
    helpFrameGeometry().every(
      (value, index) => Math.abs(value - collapsedHelpGeometry[index]) < 0.5,
    ),
    "Help frame moved or resized during animation",
  );
  check(
    midway > 0 && midway < content.scrollHeight,
    "Help reveal did not animate intermediate height",
  );
  summaryOf(helpRows[0]).click();
  const closing = content.getAnimations()[0];
  check(
    closing && Math.abs(parseFloat(closing.effect.getKeyframes()[0].height) - midway) < 1,
    "Rapid toggle did not reverse from current height",
  );
  check(
    closing.effect.getTiming().duration === 500 &&
      parseFloat(closing.effect.getKeyframes().at(-1).height) === 0,
    "Help collapse must ease to zero over 500ms",
  );
  await finishExplanation(helpRows[0]);
  check(
    !helpRows[0].open && content.getAnimations().length === 0,
    "Closing animation did not clean up",
  );
  cases.push("500ms eased opening/closing animation with interruption and cleanup");
  helpRows[0].querySelector("summary").click();
  helpRows[1].querySelector("summary").click();
  await finishExplanation(helpRows[0]);
  await finishExplanation(helpRows[1]);
  check(helpRows[0].open && helpRows[1].open, "Help disclosures must open independently");
  check(
    helpBounds.scrollHeight > helpBounds.clientHeight,
    "Expanded help should exercise scrollbar appearance",
  );
  check(
    helpFrameGeometry().every(
      (value, index) => Math.abs(value - collapsedHelpGeometry[index]) < 0.5,
    ),
    "Help frame moved or resized when its scrollbar appeared",
  );
  const expandedBackground = getComputedStyle(helpRows[0]).backgroundColor;
  const selectedBackground = getComputedStyle(helpRows[0])
    .getPropertyValue("--color-selected")
    .trim();
  check(
    expandedBackground.replace(/\s/g, "") === selectedBackground.replace(/\s/g, ""),
    "Expanded help must use selected-row theme background",
  );
  check(
    expandedBackground !== getComputedStyle(helpRows[2]).backgroundColor,
    "Expanded help has no distinct background",
  );
  cases.push("Expanded explanations use the existing selected-row background");
  helpRows[0].querySelector("summary").click();
  await finishExplanation(helpRows[0]);
  check(!helpRows[0].open && helpRows[1].open, "Closing one explanation collapsed another");
  cases.push("Click expands/collapses rows independently");
  for (const key of ["Enter", " "]) {
    const event = await press(helpRows[2].querySelector("summary"), key);
    check(
      !event.defaultPrevented && document.getElementById("help-dialog").open,
      "Native disclosure activation was intercepted",
    );
  }
  check(
    JSON.stringify((await WAYPOINTS_STORAGE.read()).videos) === beforeHelp,
    "Help ran a background shortcut",
  );
  cases.push("Help rows retain native Enter/Space activation without running commands");
  for (const row of helpRows) await finishExplanation(row);
  globalThis.matchMedia = (query) =>
    query === "(prefers-reduced-motion: reduce)"
      ? { matches: true }
      : originalMatchMedia.call(globalThis, query);
  summaryOf(helpRows[0]).click();
  check(
    helpRows[0].open && content.getAnimations().length === 0,
    "Reduced motion should open without animation",
  );
  summaryOf(helpRows[0]).click();
  check(!helpRows[0].open, "Reduced motion should close immediately");
  globalThis.matchMedia = originalMatchMedia;
  cases.push("Reduced-motion preference preserves instant disclosure controls");
  const originalSettings = settings;
  settings = { ...settings, scrubSeconds: 11, shiftMultiplier: 2 };
  updateHint();
  check(document.getElementById("help-scrub").textContent === "Scrub 11s", "Scrub summary stale");
  check(
    document.getElementById("help-multiplier").textContent === "Scrub 22s",
    "Shift summary stale",
  );
  check(
    document.getElementById("help-multiplier-detail").textContent.includes("×2"),
    "Full scrub explanation stale",
  );
  settings = originalSettings;
  updateHint();
  helpRows.forEach((row) => {
    row.open = false;
  });
  check(
    helpBounds.scrollHeight <= helpBounds.clientHeight + 1,
    "Help scrollbar did not disappear after collapse",
  );
  check(
    helpFrameGeometry().every(
      (value, index) => Math.abs(value - collapsedHelpGeometry[index]) < 0.5,
    ),
    "Help frame moved or resized when its scrollbar disappeared",
  );
  cases.push(
    "Fixed help frame and reserved gutter prevent resizing or shifts during expansion/collapse",
  );
  dialogs.closeHelp();
  cases.push("Help summaries and explanations reflect current settings");
};
