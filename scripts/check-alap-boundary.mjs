// Copyright 2026 Daniel Smith
// SPDX-License-Identifier: Apache-2.0
// Submission tripwire for the deliberately local, pruned Alap profile.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
export const ALAP_QUERY_SOURCES = Object.freeze([
  "src/shared/alap-data.mjs",
  "src/shared/alap-tags.js",
  "src/shared/alap-refiner-profile.mjs",
  "src/shared/alap-posted-time.mjs",
  "src/shared/alap-macro-expansion.mjs",
  "src/shared/alap-search-input.mjs",
  "src/shared/alap-query-expression.mjs",
  "src/shared/alap-video-catalog.mjs",
  "src/shared/alap-query.mjs",
  "src/shared/alap-search-view.mjs",
  "src/shared/youtube-values.js",
  "src/vendor/alap-tags-core/index.mjs",
  "src/vendor/alap-tags-core/syntax.mjs",
  "src/vendor/alap-tags-core/refiners.mjs",
]);
export function checkAlapBoundary(root) {
  const fail = (message) => {
    throw new Error(`Alap submission boundary: ${message}`);
  };
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
  for (const group of ["dependencies", "devDependencies", "optionalDependencies"]) {
    if (Object.hasOwn(pkg[group] || {}, "alap")) fail("full Alap package dependency is forbidden");
  }
  if (Object.keys(lock.packages).some((key) => /(?:^|\/)node_modules\/alap$/.test(key)))
    fail("full Alap package appears in lockfile");
  const folder = path.join(root, "src/vendor/alap-tags-core");
  const expected = [
    "LICENSE",
    "PROVENANCE.json",
    "README.md",
    "index.mjs",
    "syntax.mjs",
    "refiners.mjs",
  ].sort();
  if (JSON.stringify(fs.readdirSync(folder).sort()) !== JSON.stringify(expected))
    fail("unexpected pruned-module files");
  const provenance = JSON.parse(fs.readFileSync(path.join(folder, "PROVENANCE.json"), "utf8"));
  const digest = createHash("sha256")
    .update(fs.readFileSync(path.join(folder, "index.mjs")))
    .digest("hex");
  if (digest !== provenance.derivativeSha256)
    fail("pruned parser hash changed; review source and provenance together");
  for (const name of ["index.mjs", "syntax.mjs", "refiners.mjs"]) {
    const actual = createHash("sha256")
      .update(fs.readFileSync(path.join(folder, name)))
      .digest("hex");
    if (actual !== provenance.derivativeFiles?.[name])
      fail(`pruned module hash changed: ${name}; review source and provenance together`);
  }
  const allowed = new Set(ALAP_QUERY_SOURCES);
  const forbidden =
    /\b(?:fetch|eval|require|importScripts)\s*\(|\bnew\s+(?:Function|XMLHttpRequest|WebSocket|EventSource|Worker|SharedWorker)\b|\b(?:window|document|navigator|chrome|browser)\s*\.|\bimport\s*\(/;
  for (const relative of ALAP_QUERY_SOURCES) {
    const source = fs.readFileSync(path.join(root, relative), "utf8");
    if (forbidden.test(source)) fail(`host/dynamic execution capability in ${relative}`);
    const imports = [
      ...source.matchAll(/\b(?:import|export)\s+(?:[^;]*?\s+from\s*)?["']([^"']+)["']/g),
    ];
    for (const [, specifier] of imports) {
      if (!specifier.startsWith(".")) fail(`external dependency ${specifier}`);
      const dependency = path
        .relative(root, path.resolve(path.dirname(path.join(root, relative)), specifier))
        .split(path.sep)
        .join("/");
      if (!allowed.has(dependency)) fail(`unreviewed dependency ${dependency}`);
    }
  }
  return { revision: provenance.revision, sha256: digest, sources: [...allowed] };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const report = checkAlapBoundary(root);
  console.log(
    `PASS: Alap submission boundary (${report.revision}; ${report.sources.length} reviewed local source files)`,
  );
}
