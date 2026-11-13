// Optional real-DOM keyboard regression. No npm dependencies or user profile.
// Build first, then: node tests/keyboard-browser.cjs chrome|firefox
// Both adapters run in headless Chrome; this does not claim Firefox-engine E2E.
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const flavor = process.argv[2] || "chrome";
const markerPreview = process.argv.includes("--preview-help-expanded")
  ? "help-expanded"
  : process.argv.includes("--preview-help")
    ? "help"
    : process.argv.includes("--preview-editor")
      ? "editor"
      : process.argv.includes("--preview")
        ? "list"
        : process.env.WAYPOINTS_MARKER_PREVIEW || "";
const previewTheme = process.argv.includes("--dark")
  ? "dark"
  : process.env.WAYPOINTS_PREVIEW_THEME || "light";
assert.ok(["chrome", "firefox"].includes(flavor), "Choose chrome or firefox");
const extension = path.resolve(__dirname, "../yt-waypoints-" + flavor);
const candidates = [
  process.env.WAYPOINTS_CHROME_BINARY,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);
const binary = candidates.find((candidate) => fs.existsSync(candidate));
assert.ok(binary, "Install Chrome/Chromium or set WAYPOINTS_CHROME_BINARY to its executable");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "waypoints-keyboard-"));

function setupFixture() {
  const data = {
    settings: { autoBookmark: false, showThumbnails: false, scrubSeconds: 7, shiftMultiplier: 4 },
    videos: {
      aaaaaaaaaaa: {
        id: "aaaaaaaaaaa",
        title: "Keyboard regression fixture",
        t: 100,
        duration: 1000,
        updated: 1,
      },
    },
  };
  const subscribers = [];
  const fixture = (globalThis.keyboardFixture = { operations: [], open: true, position: 700 });
  const api = {
    runtime: { getManifest: () => ({ version: "test" }) },
    storage: {
      local: {
        async get(keys) {
          return structuredClone(
            keys == null
              ? data
              : Object.fromEntries(
                  (Array.isArray(keys) ? keys : [keys]).map((key) => [key, data[key]]),
                ),
          );
        },
        async set(values) {
          const changes = {};
          for (const [key, value] of Object.entries(values)) {
            changes[key] = { newValue: structuredClone(value) };
            data[key] = structuredClone(value);
          }
          subscribers.forEach((fn) => fn(changes, "local"));
        },
        async remove(keys) {
          const changes = {};
          for (const key of keys) {
            changes[key] = { oldValue: data[key] };
            delete data[key];
          }
          subscribers.forEach((fn) => fn(changes, "local"));
        },
      },
      onChanged: { addListener: (fn) => subscribers.push(fn) },
    },
    tabs: {
      async query(query) {
        return query.active
          ? [{ id: 1, url: "https://example.com/" }]
          : fixture.open
            ? [{ id: 7, url: "https://www.youtube.com/watch?v=aaaaaaaaaaa" }]
            : [];
      },
    },
    scripting: {
      async executeScript(request) {
        const operation = request.func.name;
        if (operation === "chapters")
          return [
            {
              frameId: 0,
              result: { id: "aaaaaaaaaaa", duration: 1000, available: false, chapters: [] },
            },
          ];
        fixture.operations.push({ operation, args: request.args });
        if (operation === "seek") fixture.position += request.args[0];
        else if (operation === "seekTo") fixture.position = request.args[0];
        else if (operation !== "position") throw Error("Unexpected operation: " + operation);
        fixture.position = Math.min(1000, Math.max(0, fixture.position));
        return [
          {
            frameId: 0,
            result: { id: "aaaaaaaaaaa", t: fixture.position, duration: 1000, paused: true },
          },
        ];
      },
    },
  };
  // The platform adapter chooses the browser API; supplying browser works for
  // both adapters without touching Chrome's real extension APIs or accounts.
  globalThis.browser = api;
}

async function exerciseKeyboard() {
  const cases = [];
  function check(condition, message) {
    if (!condition) throw Error(message);
  }
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  async function reset(position = 100) {
    const videos = await bookmarks.loadVideos();
    videos.aaaaaaaaaaa.t = position;
    await bookmarks.saveVideos(videos);
    await render();
    await flush();
    keyboardFixture.operations = [];
    keyboardFixture.position = 700;
  }
  async function press(target, key, extra = {}) {
    target.focus();
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...extra });
    target.dispatchEvent(event); // Native DOM capture -> target -> bubble phases.
    await queue;
    await flush();
    return event;
  }
  async function position() {
    return (await WAYPOINTS_STORAGE.read()).videos.aaaaaaaaaaa.t;
  }
  for (let attempt = 0; document.getElementById("search").disabled && attempt < 100; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  check(!document.getElementById("search").disabled, "Popup initialization timed out");
  for (const [key, shiftKey, expected] of [
    ["ArrowRight", false, 107],
    ["ArrowLeft", false, 93],
    ["ArrowRight", true, 128],
    ["ArrowLeft", true, 72],
  ]) {
    await reset();
    const event = await press(document.querySelector(".bar"), key, { shiftKey });
    check(
      keyboardFixture.operations.length === 1 &&
        keyboardFixture.operations[0].operation === "seekTo",
      "Duplicate/wrong slider seek: " + JSON.stringify(keyboardFixture.operations),
    );
    check((await position()) === expected, "Wrong slider position");
    check(event.defaultPrevented, "Native range action was not cancelled");
    check(
      document.activeElement === document.querySelector(".bar"),
      "Slider lost focus after render",
    );
    await press(document.activeElement, key, { shiftKey, repeat: true });
    check(
      keyboardFixture.operations.length === 2 &&
        keyboardFixture.operations.every((op) => op.operation === "seekTo"),
      "Repeat changed key ownership",
    );
    cases.push(key + (shiftKey ? " + Shift" : "") + ", repeat and focus");
  }
  for (const extra of [
    { ctrlKey: true },
    { altKey: true },
    { metaKey: true },
    { isComposing: true },
  ]) {
    await reset();
    const event = await press(document.querySelector(".bar"), "ArrowRight", extra);
    check(
      !event.defaultPrevented &&
        keyboardFixture.operations.length === 0 &&
        (await position()) === 100,
      "Modified/composition key was intercepted",
    );
    cases.push("Native key preserved: " + Object.keys(extra)[0]);
  }
  for (const [start, key, expected, count] of [
    [5, "ArrowLeft", 0, 1],
    [995, "ArrowRight", 1000, 1],
    [0, "ArrowLeft", 0, 0],
    [1000, "ArrowRight", 1000, 0],
  ]) {
    await reset(start);
    await press(document.querySelector(".bar"), key);
    check(
      (await position()) === expected && keyboardFixture.operations.length === count,
      "Range boundary/unchanged position failed",
    );
    cases.push("Bounded " + key + " at " + start);
  }
  await reset();
  keyboardFixture.open = false;
  await press(document.querySelector(".bar"), "ArrowRight");
  check(
    (await position()) === 107 && keyboardFixture.operations.length === 0,
    "Closed video should update once without injection",
  );
  cases.push("Closed-video slider");
  keyboardFixture.open = true;
  await reset();
  await press(document.querySelector(".main"), "ArrowRight");
  check(
    keyboardFixture.operations.length === 1 &&
      keyboardFixture.operations[0].operation === "seek" &&
      (await position()) === 707,
    "Row-relative scrub changed",
  );
  cases.push("Row-relative arrow");
  await reset();
  const searchEvent = await press(document.getElementById("search"), "ArrowRight");
  check(
    !searchEvent.defaultPrevented && keyboardFixture.operations.length === 0,
    "Search arrow intercepted",
  );
  cases.push("Native search arrow");
  await reset();
  const originalRowHeight = document
    .querySelector(".main")
    .parentElement.getBoundingClientRect().height;
  await press(document.querySelector(".main"), "m");
  let saved = (await WAYPOINTS_STORAGE.read()).videos.aaaaaaaaaaa;
  const personalId = saved.markers[0].id;
  check(
    saved.markers[0].t === 700 && saved.t === 100,
    "Marker used saved time instead of live time or changed resume",
  );
  check(
    document.querySelector(".main").parentElement.getBoundingClientRect().height ===
      originalRowHeight,
    "Markers added row height",
  );
  check(
    !document.querySelector(".marker-panel") && !document.querySelector(".marker-tick"),
    "Separate marker controls remain",
  );
  cases.push("Live marker position without seek or extra row height");
  keyboardFixture.operations = [];
  for (const extra of [
    { repeat: true },
    { ctrlKey: true },
    { altKey: true },
    { metaKey: true },
    { isComposing: true },
  ]) {
    await press(document.querySelector(".main"), "m", extra);
  }
  check(keyboardFixture.operations.length === 0, "Modified/repeated marker command leaked");
  cases.push("Marker repeat and modifier guards");
  await press(document.querySelector(".main"), "a");
  const noteField = document.getElementById("annotation-text");
  noteField.value = "A personal observation\nWorth returning to.";
  for (const key of ["m", "M", "a", "[", "]", "c", "C", "t", "h"]) {
    const event = await press(noteField, key);
    check(!event.defaultPrevented, "Annotation typing was intercepted: " + key);
  }
  await press(noteField, "Enter", { ctrlKey: true });
  saved = (await WAYPOINTS_STORAGE.read()).videos.aaaaaaaaaaa;
  check(
    saved.markers[0].note === "A personal observation\nWorth returning to.",
    "Annotation not saved",
  );
  check(document.getElementById("annotation-editor").hidden, "Editor did not close");
  cases.push("Native annotation editing and save");
  await press(document.querySelector(".main"), "a");
  check(
    noteField.value === "A personal observation\nWorth returning to.",
    "a did not open the existing annotation",
  );
  document.getElementById("annotation-cancel").click();
  cases.push("a opens existing annotation at current marker");
  await press(document.querySelector(".main"), "M", { shiftKey: true });
  check(!document.querySelector(".marker-overlay"), "M did not hide marker lines");
  check(
    (await WAYPOINTS_STORAGE.read()).settings.showMarkers === false,
    "M visibility did not persist",
  );
  check(
    (await WAYPOINTS_STORAGE.read()).videos.aaaaaaaaaaa.markers[0].note,
    "Hiding erased annotation",
  );
  await press(document.querySelector(".main"), "M", { shiftKey: true, repeat: true });
  check(!document.querySelector(".marker-overlay"), "Repeated M toggled visibility");
  await press(document.querySelector(".main"), "M", { shiftKey: true });
  check(document.querySelector(".marker-overlay"), "M did not restore marker lines");
  cases.push("M toggles visibility with repeat guard and preserves annotations");
  const withChapter = await WAYPOINTS_STORAGE.read();
  withChapter.videos.aaaaaaaaaaa.markers.push({
    id: "c:120000",
    t: 120,
    origin: "chapter",
    title: "Understanding the main idea",
  });
  await WAYPOINTS_STORAGE.save(withChapter);
  await render();
  keyboardFixture.position = 500;
  await press(document.querySelector(".main"), "[");
  check(keyboardFixture.position === 120, "[ did not navigate to chapter marker");
  await press(document.querySelector(".main"), "]");
  check(keyboardFixture.position === 700, "] did not navigate to personal marker");
  cases.push("Keyboard previous/next marker navigation");
  await press(document.querySelector(".main"), "m");
  saved = (await WAYPOINTS_STORAGE.read()).videos.aaaaaaaaaaa;
  check(
    saved.markers.find((point) => point.id === personalId).note === undefined,
    "Deleting marker retained annotation",
  );
  await press(document.querySelector(".main"), "a");
  check(
    document.getElementById("annotation-target").textContent.includes("Video start 0:00"),
    "No current marker did not fall back to start",
  );
  noteField.value = "A note about the whole video.";
  await press(noteField, "Enter", { metaKey: true });
  check(
    (await WAYPOINTS_STORAGE.read()).videos.aaaaaaaaaaa.startNote ===
      "A note about the whole video.",
    "Start note failed",
  );
  await press(document.querySelector(".main"), "m");
  saved = (await WAYPOINTS_STORAGE.read()).videos.aaaaaaaaaaa;
  check(
    saved.markers.find((point) => point.origin === "user" && !point.removed).note === undefined,
    "Re-add revived old annotation",
  );
  cases.push("Marker deletion clears annotation; fallback and re-add remain clean");
  await press(document.querySelector(".main"), "[");
  await press(document.querySelector(".main"), "a");
  noteField.value = "The chapter title stays separate from this note.";
  await press(noteField, "Enter", { ctrlKey: true });
  saved = (await WAYPOINTS_STORAGE.read()).videos.aaaaaaaaaaa;
  check(
    saved.markers.find((point) => point.id === "c:120000").origin === "chapter",
    "Note changed chapter origin",
  );
  const chapterLine = document.querySelector(".marker-line.marker-chapter");
  const personalLine = document.querySelector(".marker-line.marker-user");
  check(chapterLine && personalLine, "Missing marker lines");
  check(
    getComputedStyle(chapterLine).width === "1px" && getComputedStyle(personalLine).width === "1px",
    "Markers are not thin vertical lines",
  );
  check(
    getComputedStyle(document.querySelector(".marker-overlay")).pointerEvents === "none",
    "Markers steal slider pointer events",
  );
  const lineRect = chapterLine.getBoundingClientRect(),
    barRect = document.querySelector(".bar").getBoundingClientRect();
  check(
    lineRect.top >= barRect.top && lineRect.bottom <= barRect.bottom,
    "Marker is not over the timeline",
  );
  check(
    document.querySelector(".main").parentElement.getBoundingClientRect().height ===
      originalRowHeight,
    "Marker UI wastes vertical space",
  );
  cases.push("Thin overlaid marker lines and chapter annotations");
  const beforeHelp = JSON.stringify((await WAYPOINTS_STORAGE.read()).videos);
  const bookmarkFocusStyle = getComputedStyle(document.querySelector(".main").parentElement);
  const bookmarkFocusShadow = bookmarkFocusStyle.boxShadow;
  const bookmarkFocusBackground = bookmarkFocusStyle.backgroundColor;
  dialogs.openHelp();
  const helpRows = [...document.querySelectorAll(".shortcut")];
  check(
    helpRows.length === 21 && helpRows.every((row) => !row.open),
    "Help must start with 21 collapsed rows",
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
  const originalMatchMedia = globalThis.matchMedia;
  globalThis.matchMedia = (query) =>
    query === "(prefers-reduced-motion: reduce)"
      ? { matches: false }
      : originalMatchMedia.call(globalThis, query);
  summaryOf(helpRows[0]).click();
  const content = helpRows[0].querySelector(".shortcut-explanation");
  const opening = content.getAnimations()[0];
  check(
    opening && Math.abs(opening.effect.getTiming().duration - 1000 / 3) < 0.01,
    "Help toggle duration must be one third second",
  );
  check(opening.effect.getTiming().easing.includes("cubic-bezier"), "Help toggle easing missing");
  opening.pause();
  opening.currentTime = 1000 / 6;
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
  await finishExplanation(helpRows[0]);
  check(
    !helpRows[0].open && content.getAnimations().length === 0,
    "Closing animation did not clean up",
  );
  cases.push("333ms eased disclosure animation with interruption and cleanup");
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
  return cases;
}

const setup =
  '<base href="' +
  pathToFileURL(extension + path.sep).href +
  '"><script>(' +
  setupFixture.toString() +
  ")();</script>";
const driver = `window.addEventListener('load', async () => {
  const report = document.createElement('pre'); report.id = 'keyboard-result'; document.body.append(report);
  try {
    const cases = await (${exerciseKeyboard.toString()})();
    if (${JSON.stringify(markerPreview)} === "editor") {
      await markers.edit("aaaaaaaaaaa");
    }
    if (${JSON.stringify(markerPreview)}.startsWith("help")) {
      dialogs.openHelp();
      if (${JSON.stringify(markerPreview)} === "help-expanded") {
        document.querySelectorAll(".shortcut")[0].open = true;
        document.querySelectorAll(".shortcut")[2].open = true;
      }
    }
    if (${JSON.stringify(previewTheme)}) WAYPOINTS_THEME.apply(${JSON.stringify(previewTheme)});
    report.textContent = encodeURIComponent(JSON.stringify({ pass: true, cases }));
    if (${JSON.stringify(Boolean(markerPreview))}) report.hidden = true;
  }
  catch (error) { report.textContent = encodeURIComponent(JSON.stringify({ pass: false, error: error.stack || error.message })); }
});`;
const moduleFixture = path.join(temporary, "popup-fixture.mjs");
const html = fs
  .readFileSync(path.join(extension, "popup.html"), "utf8")
  // Extension-root URLs become relative to the isolated file fixture's base.
  .replace(/\b(src|href)="\/(?!\/)/g, '$1="')
  .replace("<head>", "<head>" + setup)
  .replace(
    /(<script\b[^>]*type="module"[^>]*src=")([^"]+)("[^>]*><\/script>)/,
    (_, before, source, after) => {
      // The driver shares the real emitted module's lexical scope. Production
      // bytes are copied unchanged; only this disposable test file gets a driver.
      fs.writeFileSync(
        moduleFixture,
        fs.readFileSync(path.join(extension, source), "utf8") + "\n" + driver,
      );
      return before + pathToFileURL(moduleFixture).href + after;
    },
  );
assert.ok(fs.existsSync(moduleFixture), "Expected a WXT popup module script");
const fixturePath = path.join(temporary, "fixture.html");
fs.writeFileSync(fixturePath, html);
const result = spawnSync(
  binary,
  [
    "--headless",
    "--disable-gpu",
    "--disable-background-networking",
    "--no-first-run",
    "--allow-file-access-from-files",
    "--user-data-dir=" + path.join(temporary, "profile"),
    "--virtual-time-budget=6000",
    "--dump-dom",
    ...(markerPreview
      ? ["--screenshot=" + path.join(temporary, "popup.png"), "--window-size=500,600"]
      : []),
    pathToFileURL(fixturePath).href,
  ],
  { encoding: "utf8", timeout: 45000, maxBuffer: 2_000_000 },
);
assert.ifError(result.error);
assert.equal(result.status, 0, result.stderr);
const match = result.stdout.match(/<pre id="keyboard-result"[^>]*>([^<]+)<\/pre>/);
assert.ok(match, "No browser test report; inspect fixture: " + fixturePath + "\n" + result.stderr);
const report = JSON.parse(decodeURIComponent(match[1]));
fs.writeFileSync(path.join(temporary, "result.json"), JSON.stringify(report, null, 2));
assert.equal(report.pass, true, report.error);
assert.equal(report.cases.length, 32);
console.log(
  `PASS: ${flavor} adapter, ${report.cases.length} real-DOM keyboard cases in headless Chrome`,
);
console.log("Evidence: " + path.join(temporary, "result.json"));
