// Packaged popup integration: all features by default, or selected suite names.
// Build first. Examples: node tests/popup.cjs firefox seeking
//                       node tests/popup.cjs chrome exports transfer
const suites = {
  policy: () => require("./popup/policy.cjs"),
  refresh: () => require("./popup/refresh.cjs"),
  markers: () => require("./popup/markers.cjs"),
  appearance: () => require("./popup/appearance.cjs"),
  navigation: () => require("./popup/navigation.cjs"),
  exports: () => require("./popup/exports.cjs"),
  bookmarks: () => require("./popup/bookmarks.cjs"),
  seeking: () => require("./popup/seeking.cjs"),
  transfer: () => require("./popup/transfer.cjs"),
  "trash-settings": () => require("./popup/trash-settings.cjs"),
  "player-boundaries": () => require("./popup/player-boundaries.cjs"),
};

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--list") {
    console.log(Object.keys(suites).join("\n"));
    return;
  }
  const flavor = args.shift() || "firefox";
  if (!["firefox", "chrome"].includes(flavor))
    throw Error(`Unknown popup adapter: ${flavor}. Choose firefox or chrome.`);
  const selected = args.length ? args : Object.keys(suites);
  for (const name of selected) {
    if (!Object.hasOwn(suites, name))
      throw Error(`Unknown popup suite: ${name}. Use node tests/popup.cjs --list.`);
  }
  const { createPopupHarness } = require("./popup/harness.cjs");
  const { createPopupFixture } = createPopupHarness(flavor);
  for (const name of selected) {
    console.log(`Popup target: ${flavor}; suite: ${name}`);
    try {
      await suites[name]()({ createPopupFixture, flavor });
    } catch (error) {
      throw new Error(`Popup ${flavor}/${name} failed: ${error.message}`, { cause: error });
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
