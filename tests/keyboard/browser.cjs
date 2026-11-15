const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const features = require("./cases.cjs");

function runBrowser({ fixturePath, temporary, options }) {
  const candidates = [
    process.env.WAYPOINTS_CHROME_BINARY,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);
  const binary = candidates.find((candidate) => fs.existsSync(candidate));
  assert.ok(binary, "Install Chrome/Chromium or set WAYPOINTS_CHROME_BINARY to its executable");
  const result = spawnSync(
    binary,
    [
      "--headless",
      "--disable-gpu",
      "--disable-background-networking",
      "--no-first-run",
      "--allow-file-access-from-files",
      "--user-data-dir=" + path.join(temporary, "profile"),
      `--window-size=${options.windowSize.width},${options.windowSize.height}`,
      "--virtual-time-budget=20000",
      "--dump-dom",
      ...(options.preview ? ["--screenshot=" + path.join(temporary, "popup.png")] : []),
      pathToFileURL(fixturePath).href,
    ],
    { encoding: "utf8", timeout: 45000, maxBuffer: 2_000_000 },
  );
  // Retain diagnostics on both success and failure, outside real browser profiles.
  fs.writeFileSync(path.join(temporary, "browser.stderr.log"), result.stderr || "");
  fs.writeFileSync(path.join(temporary, "dom.html"), result.stdout || "");
  assert.ifError(result.error);
  assert.equal(result.status, 0, `Browser exited ${result.status}; see ${temporary}`);
  const match = result.stdout.match(/<pre id="keyboard-result"[^>]*>([^<]+)<\/pre>/);
  assert.ok(match, `No browser test report; inspect ${fixturePath}`);
  const report = JSON.parse(decodeURIComponent(match[1]));
  fs.writeFileSync(path.join(temporary, "result.json"), JSON.stringify(report, null, 2));
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
}

module.exports = { runBrowser };
