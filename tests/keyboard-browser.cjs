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
        fixture.operations.push({ operation, args: request.args });
        if (operation === "seek") fixture.position += request.args[0];
        else if (operation === "seekTo") fixture.position = request.args[0];
        else throw Error("Unexpected operation: " + operation);
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
  try { report.textContent = encodeURIComponent(JSON.stringify({ pass: true, cases: await (${exerciseKeyboard.toString()})() })); }
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
    pathToFileURL(fixturePath).href,
  ],
  { encoding: "utf8", timeout: 45000, maxBuffer: 2_000_000 },
);
assert.ifError(result.error);
assert.equal(result.status, 0, result.stderr);
const match = result.stdout.match(/<pre id="keyboard-result">([^<]+)<\/pre>/);
assert.ok(match, "No browser test report; inspect fixture: " + fixturePath + "\n" + result.stderr);
const report = JSON.parse(decodeURIComponent(match[1]));
fs.writeFileSync(path.join(temporary, "result.json"), JSON.stringify(report, null, 2));
assert.equal(report.pass, true, report.error);
assert.equal(report.cases.length, 15);
console.log(
  `PASS: ${flavor} adapter, ${report.cases.length} real-DOM keyboard cases in headless Chrome`,
);
console.log("Evidence: " + path.join(temporary, "result.json"));
