// Optional real-DOM regression. Both adapters run in headless Chrome, not native
// Firefox. Build first: node tests/keyboard-browser.cjs chrome|firefox [preview].
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { parseOptions } = require("./keyboard/options.cjs");
const { writeFixture } = require("./keyboard/fixture.cjs");
const { runBrowser } = require("./keyboard/browser.cjs");

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const extension = path.resolve(__dirname, "../yt-waypoints-" + options.flavor);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "waypoints-keyboard-"));
  try {
    const fixturePath = writeFixture({ extension, temporary, options });
    const report = await runBrowser({ fixturePath, temporary, options });
    console.log(
      `PASS: ${options.flavor} adapter, ${report.cases.length} real-DOM cases in headless Chrome (${report.viewport.width}×${report.viewport.height})`,
    );
  } finally {
    console.log("Evidence: " + temporary);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
