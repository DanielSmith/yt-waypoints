// Copyright 2026 Daniel Smith
// SPDX-License-Identifier: Apache-2.0
import { build } from "wxt";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const [browser, destination] = process.argv.slice(2);
if (!["firefox", "chrome"].includes(browser) || !destination) {
  throw new Error("Usage: node scripts/build-wxt.mjs <firefox|chrome> <output-directory>");
}
const output = path.resolve(destination);
await build({
  root,
  browser,
  manifestVersion: 3,
  mode: "production",
  outDir: path.dirname(output),
  outDirTemplate: path.basename(output),
});
