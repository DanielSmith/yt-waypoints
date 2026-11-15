// Executed in the actual popup bundle scope; helpers are explicit test ports.
module.exports = async function settingsCases({
  cases,
  check,
  press,
  flush,
  settleActions,
  originalMatchMedia,
}) {
  const helpRows = [...document.querySelectorAll(".shortcut")];
  const settingsButton = document.getElementById("settings-toggle");
  const gear = settingsButton.querySelector(".settings-icon");
  check(
    settingsButton.getAttribute("aria-label") === "Settings" &&
      settingsButton.title === "Settings (*)",
    "Closed settings button lacks an accessible label or tooltip",
  );
  check(
    gear && getComputedStyle(gear).display !== "none",
    "Closed settings button must show a gear",
  );
  check(
    document.getElementById("settings-toggle-label").hidden,
    "Closed settings button shows text instead of its gear",
  );
  const gearImage = new Image();
  gearImage.src = new URL("icons/settings.svg", document.baseURI).href;
  await gearImage.decode();
  check(
    gearImage.naturalWidth === 18 && gearImage.naturalHeight === 18,
    "External gear failed to load at its original dimensions",
  );
  check(!settingsButton.querySelector("svg"), "Gear geometry must remain in its external asset");
  for (const theme of ["light", "dark"]) {
    WAYPOINTS_THEME.apply(theme);
    const style = getComputedStyle(gear);
    check(style.width === "18px" && style.height === "18px", "Gear dimensions changed");
    check(style.maskImage.includes("icons/settings.svg"), "Gear must use its external SVG mask");
    check(
      style.backgroundColor === getComputedStyle(settingsButton).color,
      "Gear color must follow the theme's button text color",
    );
  }
  WAYPOINTS_THEME.apply(settings.theme);
  const shortcutRow = document.querySelector(".main");
  const starOpen = await press(shortcutRow, "*", { shiftKey: true });
  check(
    starOpen.defaultPrevented && !document.getElementById("settings-panel").hidden,
    "Star must open Settings",
  );
  check(
    document.activeElement === document.querySelector(".settings-group > summary"),
    "Star opening must focus the first Settings group",
  );
  await press(document.activeElement, "*", { shiftKey: true, repeat: true });
  check(
    !document.getElementById("settings-panel").hidden,
    "Held star must not repeatedly toggle Settings",
  );
  await press(document.activeElement, "*");
  check(
    document.getElementById("settings-panel").hidden && document.activeElement === settingsButton,
    "Star must close Settings and return focus to gear",
  );
  const typedStar = await press(searchEl, "*", { shiftKey: true });
  check(
    !typedStar.defaultPrevented && document.getElementById("settings-panel").hidden,
    "Star must remain typable in search",
  );
  for (const modifier of ["ctrlKey", "metaKey", "altKey"]) {
    const event = await press(settingsButton, "*", { [modifier]: true });
    check(
      !event.defaultPrevented && document.getElementById("settings-panel").hidden,
      "Modified star must retain native behavior",
    );
  }
  check(
    helpRows.some(
      (row) =>
        row.querySelector(".shortcut-key").textContent === "*" &&
        row.querySelector(".shortcut-name").textContent === "Toggle settings",
    ),
    "Help must document the Settings shortcut",
  );
  cases.push(
    "Star toggles Settings with immediate focus, repeat guard, typing/modifier ownership and Help entry",
  );
  settingsButton.focus();
  settingsButton.click();
  check(
    settingsButton.getAttribute("aria-label") === "Hide settings" &&
      !document.getElementById("settings-toggle-label").hidden,
    "Open settings button must say Hide settings",
  );
  check(getComputedStyle(gear).display === "none", "Open settings button still shows the gear");
  cases.push("Settings gear, tooltip, accessible label and Hide settings toggle");
  const groups = [...document.querySelectorAll(".settings-group")];
  const headings = groups.map((group) => group.querySelector("summary"));
  check(
    document.activeElement === headings[0],
    "Opening Settings must focus its first group immediately",
  );
  await press(document.activeElement, "ArrowDown");
  check(
    document.activeElement === headings[1],
    "Down must navigate Settings immediately after opening without Tab",
  );
  await press(document.activeElement, "ArrowUp");
  check(
    document.activeElement === headings[0],
    "Up must navigate Settings immediately after opening without Tab",
  );
  for (const [id, min, max, fallback] of [
    ["scrub-seconds", "1", "60", "10"],
    ["shift-multiplier", "1", "10", "3"],
    ["trash-days", "1", "365", "7"],
  ]) {
    const control = document.getElementById(id);
    check(
      control.min === min &&
        control.max === max &&
        control.step === "1" &&
        control.defaultValue === fallback,
      "Settings policy did not initialize native input constraints: " + id,
    );
  }
  check(
    document.getElementById("annotation-text").maxLength === 10000,
    "Annotation input limit differs from its stored-data contract",
  );
  const panel = document.getElementById("settings-panel");
  const geometry = () => [
    document.body.getBoundingClientRect().width,
    document.body.getBoundingClientRect().height,
    panel.getBoundingClientRect().left,
    panel.getBoundingClientRect().width,
    panel.getBoundingClientRect().height,
    headings[0].getBoundingClientRect().left,
    headings[0].getBoundingClientRect().width,
  ];
  const fixedGeometry = geometry();
  const stable = () =>
    geometry().every((value, index) => Math.abs(value - fixedGeometry[index]) < 0.5);
  check(
    groups.length === 6 && groups.every((group) => !group.open),
    "Settings must start with six collapsed groups",
  );
  check(panel.scrollHeight <= panel.clientHeight + 1, "Collapsed groups do not fit in the panel");
  check(
    headings[5].getBoundingClientRect().bottom <= panel.getBoundingClientRect().bottom,
    "Last Settings group is below the viewport",
  );
  check(fixedGeometry[0] === 360 && fixedGeometry[1] === 520, "Settings outer frame is not fixed");
  cases.push("Six collapsed Settings groups fit in the fixed viewport");
  await press(headings[0], "ArrowDown");
  check(document.activeElement === headings[1], "Settings Down failed");
  await press(headings[1], "ArrowUp");
  check(document.activeElement === headings[0], "Settings Up failed");
  for (const key of ["Enter", " "]) {
    const event = await press(headings[0], key);
    check(!event.defaultPrevented, "Settings blocks native summary activation");
  }
  const groupFocus = getComputedStyle(groups[0]);
  check(
    groupFocus.outlineWidth === "1px" &&
      groupFocus.outlineOffset === "-1px" &&
      groupFocus.borderBottomColor === groupFocus.outlineColor,
    "Focused Settings group must have a complete inward outline including its bottom divider",
  );
  cases.push("Settings heading arrows and native disclosure activation");
  const finishGroup = async (index) => {
    for (const animation of groups[index].querySelector(".settings-group-content").getAnimations())
      animation.finish();
    await flush();
  };
  headings[0].click();
  const settingsMotion = groups[0].querySelector(".settings-group-content").getAnimations()[0];
  check(
    settingsMotion && Math.abs(settingsMotion.effect.getTiming().duration - 500) < 1,
    "Settings must share Help's eased disclosure",
  );
  check(
    parseFloat(settingsMotion.effect.getKeyframes()[0].height) === 0,
    "Settings expansion must start at zero",
  );
  settingsMotion.pause();
  settingsMotion.currentTime = 250;
  const settingsContent = groups[0].querySelector(".settings-group-content");
  check(
    settingsContent.getBoundingClientRect().height > 0 &&
      settingsContent.getBoundingClientRect().height < settingsContent.scrollHeight,
    "Settings expansion must show an intermediate height",
  );
  check(stable(), "Settings frame shifts during animation");
  await finishGroup(0);
  headings[2].click();
  await finishGroup(2);
  check(groups[0].open && groups[2].open, "Settings groups must expand independently");
  check(stable(), "Expanded Settings changes frame geometry");
  const operationsBefore = keyboardFixture.operations.length;
  const scrubInput = document.getElementById("scrub-seconds");
  const scrubEvent = await press(scrubInput, "ArrowRight");
  check(
    !scrubEvent.defaultPrevented && document.activeElement === scrubInput,
    "Settings intercepted slider arrows",
  );
  check(
    keyboardFixture.operations.length === operationsBefore,
    "Settings slider ran video playback",
  );
  const settingsPreviewWrites = keyboardFixture.settingsWrites;
  const savedMultiplier = settings.shiftMultiplier;
  const multiplierInput = document.getElementById("shift-multiplier");
  scrubInput.value = "12";
  multiplierInput.value = "5";
  scrubInput.dispatchEvent(new Event("input", { bubbles: true }));
  multiplierInput.dispatchEvent(new Event("input", { bubbles: true }));
  check(
    document.getElementById("scrub-value").textContent === "12 s" &&
      document.getElementById("multiplier-value").textContent === "×5" &&
      document.getElementById("shift-preview").textContent.includes("60 seconds"),
    "Settings preview did not combine current unsaved slider values",
  );
  check(
    keyboardFixture.settingsWrites === settingsPreviewWrites,
    "Slider preview wrote to storage",
  );
  check(
    settings.shiftMultiplier === savedMultiplier && document.activeElement === scrubInput,
    "Slider preview changed saved settings or focus",
  );
  scrubInput.dispatchEvent(new Event("change", { bubbles: true }));
  await settleActions();
  check(
    (await api.storage.local.get("settings")).settings.scrubSeconds === 12,
    "Settings did not save scrub setting",
  );
  check(
    document.getElementById("playback-summary").textContent.startsWith("12s"),
    "Settings setting summary is stale",
  );
  check(groups[0].open && groups[2].open, "Saving settings collapses Settings groups");
  check(
    settings.shiftMultiplier === savedMultiplier &&
      document.getElementById("multiplier-value").textContent === `×${savedMultiplier}` &&
      document
        .getElementById("shift-preview")
        .textContent.includes(`${12 * savedMultiplier} seconds`),
    "Scrub commit saved an unrelated draft multiplier or displayed stale output",
  );
  multiplierInput.value = "5";
  multiplierInput.dispatchEvent(new Event("change", { bubbles: true }));
  await settleActions();
  check(
    settings.shiftMultiplier === 5 &&
      document.getElementById("shift-preview").textContent.includes("60 seconds"),
    "Multiplier commit did not use the shared preview updater",
  );
  multiplierInput.value = String(savedMultiplier);
  multiplierInput.dispatchEvent(new Event("change", { bubbles: true }));
  await settleActions();

  cases.push(
    "Independent Settings groups, stable motion, native sliders and saved-setting summaries",
  );
  headings[0].click();
  await finishGroup(0);
  check(!groups[0].open && groups[2].open, "Collapsing one Settings group closes another");
  headings[4].click();
  await finishGroup(4);
  document.getElementById("transcript-format-toggle").click();
  check(stable(), "Transcript picker resizes Settings");
  const formatBounds = document.getElementById("transcript-format-menu").getBoundingClientRect();
  check(
    formatBounds.right <= panel.getBoundingClientRect().right &&
      formatBounds.left >= panel.getBoundingClientRect().left,
    "Format picker overflows Settings horizontally",
  );
  const formatChoices = [...document.querySelectorAll(".transcript-format-choice")];
  const chosenFormat = formatChoices.find(
    (choice) => choice.dataset.format !== settings.transcriptFormat,
  );
  chosenFormat.click();
  await settleActions();
  check(
    settings.transcriptFormat === chosenFormat.dataset.format &&
      document.getElementById("transcripts-summary").textContent === chosenFormat.textContent,
    "Format choice does not save or update summary",
  );
  document.getElementById("transcript-format-toggle").click();
  headings[4].click();
  await finishGroup(4);
  check(
    document.getElementById("transcript-format-menu").hidden && !groups[4].open,
    "Collapsed transcript group keeps picker active",
  );
  const afterCollapse = await press(headings[4], "ArrowDown");
  check(
    afterCollapse.defaultPrevented && document.activeElement === headings[5],
    "Hidden picker steals group navigation",
  );
  cases.push(
    "Transcript preview fits Settings and saves formats without stealing focus after collapse",
  );
  globalThis.matchMedia = (query) =>
    query === "(prefers-reduced-motion: reduce)"
      ? { matches: true }
      : originalMatchMedia.call(globalThis, query);
  headings[1].click();
  check(
    groups[1].open && !groups[1].querySelector(".settings-group-content").getAnimations().length,
    "Reduced-motion Settings still animates",
  );
  globalThis.matchMedia = originalMatchMedia;
  cases.push("Settings disclosures respect reduced motion");
  // Check both palettes and the tallest content with every group expanded.
  for (const theme of ["light", "dark"]) {
    WAYPOINTS_THEME.apply(theme);
    for (const group of groups) group.open = true;
    document.getElementById("transcript-format-toggle").click();
    check(stable(), "Settings frame changes with all groups expanded");
    check(panel.scrollHeight > panel.clientHeight, "Expanded Settings must scroll internally");
    // The document scrollHeight is at least the viewport height, even when the
    // popup body is its required 520px. Compare overflow against the viewport.
    check(
      document.documentElement.scrollHeight <= document.documentElement.clientHeight,
      "Settings causes outer page scrolling",
    );
    check(panel.scrollWidth <= panel.clientWidth + 1, "Expanded Settings has horizontal overflow");
    closeFormatMenu(false);
  }
  cases.push(
    "Both Settings themes scroll internally without outer resizing or horizontal overflow",
  );
  for (const theme of ["light", "dark"]) {
    WAYPOINTS_THEME.apply(theme);
    document.getElementById("transcript-format-toggle").click();
    const controls = [...panel.querySelectorAll("input, select, button, a")].filter(
      (control) => !control.disabled && control.getClientRects().length,
    );
    check(controls.length >= 20, "Focus clearance check must cover all Settings control types");
    for (const control of controls) {
      control.focus({ preventScroll: true });
      control.scrollIntoView({ block: "center", inline: "nearest" });
      const bounds = control.getBoundingClientRect();
      const style = getComputedStyle(control);
      const ring = parseFloat(style.outlineWidth) + Math.max(0, parseFloat(style.outlineOffset));
      check(ring > 0 && style.outlineStyle !== "none", "Settings keyboard focus indicator missing");
      for (let ancestor = control.parentElement; ancestor; ancestor = ancestor.parentElement) {
        const clip = getComputedStyle(ancestor);
        const area = ancestor.getBoundingClientRect();
        const left = area.left + ancestor.clientLeft;
        const top = area.top + ancestor.clientTop;
        const id = control.id || control.dataset.format;
        if (["hidden", "auto", "scroll", "clip"].includes(clip.overflowX))
          check(
            bounds.left - ring >= left - 1 &&
              bounds.right + ring <= left + ancestor.clientWidth + 1,
            "Settings focus ring clipped horizontally: " + id,
          );
        if (["hidden", "auto", "scroll", "clip"].includes(clip.overflowY))
          check(
            bounds.top - ring >= top - 1 && bounds.bottom + ring <= top + ancestor.clientHeight + 1,
            "Settings focus ring clipped vertically: " + id,
          );
      }
    }
    closeFormatMenu(false);
  }
  WAYPOINTS_THEME.apply(settings.theme);
  cases.push(
    "All Settings control focus rings fit inside clipping and scrolling ancestors in both themes",
  );
  setSettingsOpen(false);
  setSettingsOpen(true);
  check(
    groups.every((group) => !group.open) && panel.scrollTop === 0,
    "Reopened Settings does not reset its overview",
  );
  check(
    document.getElementById("scrub-seconds").value === "12",
    "Reopening Settings lost a saved setting",
  );
  check(stable(), "Collapsed Settings changes frame after reopening");
  check(
    document.activeElement === headings[0],
    "Reopening Settings must restore focus to its first group",
  );
  setSettingsOpen(false);
  cases.push("Reopening Settings restores the collapsed overview and preserves settings");
};
