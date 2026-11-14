// Unit fixtures load authored modules. Popup integration/keyboard fixtures load
// actual WXT packages; metadata also exercises the packaged content script.
const fs = require("node:fs");
const path = require("node:path");
function readModule(name) {
  let source = fs.readFileSync(path.join(__dirname, "../src/shared", name), "utf8");
  if (name === "transcript.js") {
    source =
      fs.readFileSync(path.join(__dirname, "../src/shared/display-time.js"), "utf8") +
      "\n" +
      source;
  }
  if (["player-results.js", "transfer.js", "transcript.js"].includes(name)) {
    source =
      fs.readFileSync(path.join(__dirname, "../src/shared/youtube-values.js"), "utf8") +
      "\n" +
      source;
  }
  if (name === "storage.js") {
    source =
      fs.readFileSync(path.join(__dirname, "../src/shared/settings-policy.js"), "utf8") +
      "\n" +
      source;
  }
  if (["storage.js", "transfer.js"].includes(name)) {
    source =
      fs.readFileSync(path.join(__dirname, "../src/shared/marker-data.js"), "utf8") + "\n" + source;
  }
  if (name === "content.js") {
    source = source.replace("export function startAutosave", "function startAutosave");
    source += "\nstartAutosave();";
  }
  return source;
}
function readBundle(extension, name) {
  return fs.readFileSync(path.join(extension, name), "utf8");
}
module.exports = { readModule, readBundle };
