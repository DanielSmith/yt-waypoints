// Copyright 2026 Daniel Smith
// SPDX-License-Identifier: Apache-2.0
// Color-only terminal readers. XML uses the browser parser, with DTDs removed
// before parsing. Neither reader follows includes, fetches URLs or executes data.
import { normalizeSourcePalette, THEME_LIMITS } from "./theme-data.mjs";

function fail(message) {
  throw new Error(message);
}
export function checkThemeText(text, limit = THEME_LIMITS.sourceFileBytes) {
  if (typeof text !== "string" || !text.trim()) fail("Enter theme data first.");
  if (text.length > limit || new TextEncoder().encode(text).length > limit)
    fail(`Theme input exceeds ${limit / 1024} KiB.`);
  return text.replace(/^\uFEFF/, "");
}
export function detectThemeFormat(text) {
  const value = checkThemeText(text, THEME_LIMITS.backupBytes).trimStart();
  if (value.startsWith("{")) {
    try {
      const data = JSON.parse(value);
      if (["yt-waypoints-theme", "yt-waypoints-themes"].includes(data?.format)) return "waypoints";
    } catch {
      /* The import operation supplies the final diagnostic. */
    }
    return "unknown";
  }
  if (value.startsWith("<")) return "iterm";
  if (/^\s*(?:background|foreground|palette)\s*=/m.test(value)) return "ghostty";
  return "unknown";
}
function hex(value) {
  const unquoted = value.replace(/^"([^"\\]*)"$/, "$1");
  if (!/^#?[\da-f]{6}$/i.test(unquoted)) fail("Expected a six-digit RGB color.");
  return "#" + unquoted.replace(/^#/, "").toLowerCase();
}
export function readGhosttyColors(input) {
  const text = checkThemeText(input);
  const palette = { palette: {} };
  const names = {
    background: "background",
    foreground: "foreground",
    "selection-background": "selectionBackground",
    "selection-foreground": "selectionForeground",
    "cursor-color": "cursorColor",
    "cursor-text": "cursorText",
  };
  const seen = new Set();
  let ignored = 0;
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    const value = line.trim();
    if (!value || value.startsWith("#")) continue;
    const assignment = /^([a-zA-Z][\w-]*)\s*=\s*(.*)$/.exec(value);
    if (!assignment) fail(`Invalid setting assignment on line ${index + 1}.`);
    const [, key, raw] = assignment;
    if (key !== "palette" && !Object.hasOwn(names, key)) {
      ignored++;
      continue;
    }
    try {
      if (key === "palette") {
        const slot = /^(0|[1-9]\d{0,2})\s*=\s*(.*)$/.exec(raw);
        if (!slot || Number(slot[1]) > 255) fail("Palette indices must be 0–255.");
        if (seen.has(`palette:${slot[1]}`)) fail("Duplicate palette index.");
        seen.add(`palette:${slot[1]}`);
        palette.palette[slot[1]] = hex(slot[2]);
      } else {
        if (seen.has(key)) fail("Duplicate color setting.");
        seen.add(key);
        palette[names[key]] = hex(raw);
      }
    } catch (error) {
      fail(`${key}, line ${index + 1}: ${error.message}`);
    }
  }
  if (!palette.background || !palette.foreground)
    fail("A theme must supply background and foreground colors.");
  return { format: "ghostty", palette: normalizeSourcePalette(palette), ignored };
}

export function readITermColors(input) {
  let text = checkThemeText(input);
  // Conventional Apple plist DOCTYPE is common in exported files. Recognize
  // and remove it without loading it. All custom DTD/entity declarations fail.
  text = text.replace(
    /<!DOCTYPE\s+plist\s+PUBLIC\s+(["'])-\/\/Apple\/\/DTD PLIST 1\.0\/\/EN\1\s+(["'])https?:\/\/www\.apple\.com\/DTDs\/PropertyList-1\.0\.dtd\2\s*>/,
    "",
  );
  if (/<!\s*(?:DOCTYPE|ENTITY)/i.test(text))
    fail("Custom XML DTDs and entities are not supported.");
  if (typeof DOMParser !== "function") fail("iTerm XML reading requires a browser XML parser.");
  const document = new DOMParser().parseFromString(text, "application/xml");
  if (document.getElementsByTagName("parsererror").length) fail("Invalid iTerm XML.");
  let nodes = 0;
  function children(element, depth) {
    if (++nodes > 4096 || depth > 12) fail("The plist structure exceeds supported limits.");
    if (element.namespaceURI) fail("XML namespaces are not supported in an iTerm plist.");
    const allowedAttributes = element.tagName === "plist" ? ["version"] : [];
    for (const attribute of element.attributes)
      if (!allowedAttributes.includes(attribute.name)) fail("Unsupported plist attribute.");
    const result = [];
    for (const node of element.childNodes) {
      if (node.nodeType === 1) result.push(node);
      else if (node.nodeType !== 8 && !(node.nodeType === 3 && !node.textContent.trim()))
        fail("Unexpected content in plist structure.");
    }
    return result;
  }
  function scalar(element, depth) {
    if (
      ++nodes > 4096 ||
      depth > 12 ||
      element.attributes.length ||
      element.namespaceURI ||
      element.children.length
    )
      fail("Invalid plist value.");
    const value = element.textContent;
    if (["string", "key", "data", "date"].includes(element.tagName)) return value;
    if (["true", "false"].includes(element.tagName)) {
      if (value.trim()) fail("Invalid plist boolean.");
      return element.tagName === "true";
    }
    if (
      !["real", "integer"].includes(element.tagName) ||
      !(
        element.tagName === "integer"
          ? /^[+-]?\d+$/
          : /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i
      ).test(value.trim())
    )
      fail("Unsupported or invalid plist value.");
    const number = Number(value);
    if (!Number.isFinite(number)) fail("Invalid plist number.");
    return number;
  }
  function read(element, depth = 0) {
    if (element.tagName === "dict") {
      const parts = children(element, depth);
      if (parts.length % 2) fail("Unpaired plist key/value.");
      const result = new Map();
      for (let index = 0; index < parts.length; index += 2) {
        if (parts[index].tagName !== "key") fail("Expected a plist key.");
        const key = scalar(parts[index], depth + 1);
        if (result.has(key)) fail("Duplicate plist key.");
        result.set(key, read(parts[index + 1], depth + 1));
      }
      return result;
    }
    if (element.tagName === "array")
      return children(element, depth).map((child) => read(child, depth + 1));
    return scalar(element, depth);
  }
  const root = document.documentElement;
  if (!root || root.tagName !== "plist" || root.getAttribute("version") !== "1.0")
    fail("Expected a version 1.0 iTerm plist.");
  const roots = children(root, 0);
  if (roots.length !== 1 || roots[0].tagName !== "dict") fail("Expected one theme dictionary.");
  const entries = read(roots[0], 1);
  function rgb(value) {
    if (!(value instanceof Map) || value.get("Color Space") !== "sRGB")
      fail("Only explicitly declared sRGB iTerm colors are supported. Export the preset in sRGB.");
    const alpha = value.has("Alpha Component") ? value.get("Alpha Component") : 1;
    if (alpha !== 1) fail("Translucent source colors are not supported.");
    return (
      "#" +
      ["Red Component", "Green Component", "Blue Component"]
        .map((key) => {
          const component = value.get(key);
          if (
            typeof component !== "number" ||
            !Number.isFinite(component) ||
            component < 0 ||
            component > 1
          )
            fail("RGB components must be numbers from 0 to 1.");
          return Math.round(component * 255)
            .toString(16)
            .padStart(2, "0");
        })
        .join("")
    );
  }
  const palette = { palette: {} };
  const names = {
    "Background Color": "background",
    "Foreground Color": "foreground",
    "Selection Color": "selectionBackground",
    "Selected Text Color": "selectionForeground",
    "Cursor Color": "cursorColor",
    "Cursor Text Color": "cursorText",
    "Link Color": "linkColor",
    "Bold Color": "boldColor",
  };
  let ignored = 0;
  for (const [key, value] of entries) {
    const slot = /^Ansi (0|[1-9]\d{0,2}) Color$/.exec(key);
    if (key.startsWith("Ansi ") && (!slot || Number(slot[1]) > 255))
      fail("ANSI palette indices must be 0–255 without leading zeros.");
    if (slot && Number(slot[1]) <= 255) palette.palette[slot[1]] = rgb(value);
    else if (Object.hasOwn(names, key)) palette[names[key]] = rgb(value);
    else ignored++;
  }
  if (!palette.background || !palette.foreground)
    fail("The file must contain Background Color and Foreground Color at its root.");
  return { format: "iterm", palette: normalizeSourcePalette(palette), ignored };
}
