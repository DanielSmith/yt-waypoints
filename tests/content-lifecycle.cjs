// Run the actual WXT content bundle twice, as happens during a reload.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const flavor = process.argv[2] || "firefox";
const source = fs.readFileSync(
  path.join(__dirname, `../yt-waypoints-${flavor}/content-scripts/content.js`),
  "utf8",
);
const storageListeners = new Set();
const timers = new Set();
const document = new EventTarget();
document.querySelector = () => null;
const api = {
  runtime: { id: "waypoints-lifecycle-test" },
  storage: {
    onChanged: {
      addListener: (callback) => storageListeners.add(callback),
      removeListener: (callback) => storageListeners.delete(callback),
    },
    local: { get: async () => ({}), set: async () => {}, remove: async () => {} },
  },
};
const context = vm.createContext({
  [flavor === "firefox" ? "browser" : "chrome"]: api,
  document,
  window: new EventTarget(),
  location: { pathname: "/", search: "" },
  AbortController,
  Event,
  CustomEvent,
  URL,
  URLSearchParams,
  crypto: { randomUUID: require("node:crypto").randomUUID },
  setInterval(callback, milliseconds) {
    assert.equal(milliseconds, 5000);
    timers.add(callback);
    return callback;
  },
  clearInterval: (id) => timers.delete(id),
});
(async () => {
  await vm.runInContext(source, context);
  assert.equal(storageListeners.size, 1);
  assert.equal(timers.size, 1);
  const oldTimer = [...timers][0];
  await vm.runInContext(source, context);
  assert.equal(storageListeners.size, 1, "reinjection removes the old storage listener");
  assert.equal(timers.size, 1, "reinjection removes the old autosave interval");
  assert.ok(!timers.has(oldTimer));
  console.log(`PASS: ${flavor} WXT content reinjection retains one autosaver and storage listener`);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
