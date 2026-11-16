// Real-time CDP runner: virtual time can outrun native Web Lock delivery.
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const features = require("./cases.cjs");

async function runBrowser({ fixturePath, temporary, options }) {
  const candidates = [
    process.env.WAYPOINTS_CHROME_BINARY,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);
  const binary = candidates.find((candidate) => fs.existsSync(candidate));
  assert.ok(binary, "Install Chrome/Chromium or set WAYPOINTS_CHROME_BINARY to its executable");
  const child = spawn(
    binary,
    [
      "--headless",
      "--disable-gpu",
      "--disable-background-networking",
      "--no-first-run",
      "--allow-file-access-from-files",
      "--remote-debugging-pipe",
      `--user-data-dir=${path.join(temporary, "profile")}`,
    ],
    { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] },
  );
  const log = fs.createWriteStream(path.join(temporary, "browser.stderr.log"));
  child.stderr.pipe(log);
  const pending = new Map();
  let buffer = "",
    id = 0;
  child.stdio[4].on("data", (data) => {
    buffer += data.toString();
    let end;
    while ((end = buffer.indexOf("\0")) >= 0) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      if (!line) continue;
      const message = JSON.parse(line),
        request = pending.get(message.id);
      if (!request) continue;
      pending.delete(message.id);
      message.error
        ? request.reject(Error(JSON.stringify(message.error)))
        : request.resolve(message.result);
    }
  });
  const failPending = (error) => {
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  };
  child.on("error", failPending);
  child.on("exit", () => failPending(Error("Browser closed before completing the request")));
  const call = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const key = ++id;
      pending.set(key, { resolve, reject });
      child.stdio[3].write(
        JSON.stringify({ id: key, method, params, ...(sessionId ? { sessionId } : {}) }) + "\0",
      );
    });
  const timeout = setTimeout(() => {
    failPending(Error("Browser test exceeded 45 seconds"));
    child.kill();
  }, 45000);
  let report, sessionId;
  const evaluate = async (expression) => {
    const result = await call("Runtime.evaluate", { expression, returnByValue: true }, sessionId);
    if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  try {
    const target = await call("Target.createTarget", { url: "about:blank" });
    ({ sessionId } = await call("Target.attachToTarget", {
      targetId: target.targetId,
      flatten: true,
    }));
    await call(
      "Emulation.setDeviceMetricsOverride",
      { ...options.windowSize, deviceScaleFactor: 1, mobile: false },
      sessionId,
    );
    await call("Page.navigate", { url: pathToFileURL(fixturePath).href }, sessionId);
    const deadline = Date.now() + 44000;
    while (Date.now() < deadline) {
      const encoded = await evaluate('document.getElementById("keyboard-result")?.textContent');
      if (encoded) {
        report = JSON.parse(decodeURIComponent(encoded));
        if (report.pass || !report.error.includes("DOM run did not complete")) break;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    fs.writeFileSync(
      path.join(temporary, "dom.html"),
      await evaluate("document.documentElement.outerHTML"),
    );
    fs.writeFileSync(path.join(temporary, "result.json"), JSON.stringify(report || {}, null, 2));
    if (options.preview) {
      const screenshot = await call(
        "Page.captureScreenshot",
        { format: "png", captureBeyondViewport: false },
        sessionId,
      );
      fs.writeFileSync(path.join(temporary, "popup.png"), Buffer.from(screenshot.data, "base64"));
    }
    assert.ok(report, `No browser test report; inspect ${fixturePath}`);
    assert.equal(report.pass, true, `${report.stage}: ${report.error}`);
    assert.deepEqual(
      report.features,
      features.map(({ name, expectedCases }) => ({ name, cases: expectedCases })),
    );
    assert.equal(
      report.cases.length,
      features.reduce((total, feature) => total + feature.expectedCases, 0),
    );
    return report;
  } finally {
    clearTimeout(timeout);
    await call("Browser.close").catch(() => {});
  }
}
module.exports = { runBrowser };
