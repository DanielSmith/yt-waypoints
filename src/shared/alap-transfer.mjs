// Copyright 2026 Daniel Smith
// SPDX-License-Identifier: Apache-2.0
import {
  normalizeMacroLibrary,
  normalizeMacros,
  normalizeVideoTags,
  ALAP_MACROS_VERSION,
} from "./alap-data.mjs";

const FORMAT = "yt-waypoints";
const PRIVATE_FORMAT = "yt-waypoints-alap-editor";
const VERSION = 3;
const VIDEO_FIELDS = [
  "id",
  "title",
  "t",
  "duration",
  "updated",
  "channelName",
  "channelUrl",
  "markers",
  "startNote",
  "tags",
];

function checkFields(value, names, description) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !names.includes(key))
  ) {
    throw new Error(`Invalid or unsupported ${description} fields.`);
  }
}

export function createAlapTransfer(legacy) {
  function parse(text) {
    const data = legacy.parseJSON(text);
    const privateFormat = data?.format === PRIVATE_FORMAT;
    if (!privateFormat && !(data?.format === FORMAT && data.version === VERSION))
      return { videos: legacy.parseLegacy(data), macros: null, includeTags: false };

    let payload = data;
    let macros = null;
    if (privateFormat) {
      checkFields(data, ["format", "version", "bookmarks", "macros"], "private editor export");
      payload = data.bookmarks;
      checkFields(payload, ["format", "version", "videos"], "private editor bookmarks");
      if (
        data.version !== 1 ||
        payload.format !== FORMAT ||
        ![1, 2].includes(payload.version) ||
        !Object.hasOwn(data, "macros")
      )
        throw new Error("Unsupported private editor export version.");
      macros = normalizeMacros(data.macros);
    } else {
      checkFields(data, ["format", "version", "videos", "macroLibrary"], "bookmark export");
      if (Object.hasOwn(data, "macroLibrary"))
        macros = normalizeMacroLibrary(data.macroLibrary).macros;
    }
    if (!payload.videos || typeof payload.videos !== "object" || Array.isArray(payload.videos))
      throw new Error("This export must contain a videos object.");

    const videos = Object.create(null);
    for (const [id, record] of Object.entries(payload.videos)) {
      checkFields(record, VIDEO_FIELDS, "video");
      const video = legacy.normalize(record, id);
      if (Object.hasOwn(record, "tags")) video.tags = normalizeVideoTags(record.tags);
      videos[id] = video;
    }
    return { videos, macros, includeTags: true };
  }

  function stringify(videos, library) {
    const legacyText = legacy.stringify(videos);
    const hasMacros = library && Object.keys(library.macros).length > 0;
    if (!hasMacros && !Object.values(videos).some((video) => Object.hasOwn(video, "tags"))) {
      if (legacyText.length > legacy.MAX_IMPORT_CHARACTERS)
        throw new Error("Backup exceeds the import size limit.");
      return legacyText;
    }
    const payload = JSON.parse(legacyText);
    payload.version = VERSION;
    for (const [id, record] of Object.entries(payload.videos))
      record.tags = normalizeVideoTags(videos[id].tags ?? []);
    if (hasMacros) payload.macroLibrary = normalizeMacroLibrary(library);
    const text = JSON.stringify(payload, null, 2);
    if (text.length > legacy.MAX_IMPORT_CHARACTERS)
      throw new Error("Backup exceeds the import size limit.");
    return text;
  }
  return { parse, stringify };
}

export function macroConflicts(local, incoming) {
  return Object.keys(incoming).filter(
    (name) => Object.hasOwn(local, name) && local[name].linkItems !== incoming[name].linkItems,
  );
}

const rewriteReferences = (expression, names) =>
  expression.replace(/@([a-z0-9_]+)/g, (reference, name) =>
    names.has(name) ? "@" + names.get(name) : reference,
  );

function renamedMacros(local, incoming) {
  const names = new Map();
  const additions = Object.create(null);
  // Validated macro definitions form an acyclic graph. Resolve dependencies
  // first so each candidate can be compared in its final, rewritten form.
  function resolve(name) {
    if (names.has(name)) return;
    for (const [, dependency] of incoming[name].linkItems.matchAll(/@([a-z0-9_]+)/g))
      resolve(dependency);
    const linkItems = rewriteReferences(incoming[name].linkItems, names);
    let target = name;
    if (Object.hasOwn(local, name) && local[name].linkItems !== linkItems) {
      for (let attempt = 1; ; attempt++) {
        const suffix = `_imported_${attempt}`;
        target = name.slice(0, 64 - suffix.length).replace(/_+$/, "") + suffix;
        if (
          !Object.hasOwn(incoming, target) &&
          !Object.hasOwn(additions, target) &&
          (!Object.hasOwn(local, target) || local[target].linkItems === linkItems)
        )
          break;
      }
    }
    names.set(name, target);
    additions[target] = { linkItems };
  }
  for (const name of Object.keys(incoming).sort()) resolve(name);
  return additions;
}

export function mergeMacroBackup(library, incoming, policy) {
  const local = library.macros;
  const conflicts = macroConflicts(local, incoming);
  if (conflicts.length && !["keep", "replace", "rename"].includes(policy))
    throw new Error("Choose how to resolve the conflicting macro names.");
  const additions = policy === "rename" ? renamedMacros(local, incoming) : incoming;
  const macros = Object.assign(Object.create(null), local);
  for (const [name, macro] of Object.entries(additions)) {
    if (policy !== "keep" || !Object.hasOwn(macros, name)) macros[name] = macro;
  }
  return normalizeMacroLibrary({ version: ALAP_MACROS_VERSION, macros });
}

export async function importAlapBackup(incoming, { storage, macroStore, chooseConflicts }) {
  let macroSaved = false;
  if (incoming.macros && Object.keys(incoming.macros).length) {
    const current = await macroStore.read();
    const conflicts = macroConflicts(current.library.macros, incoming.macros);
    const policy = conflicts.length ? await chooseConflicts(conflicts) : null;
    if (conflicts.length && !policy) return null;
    const next = mergeMacroBackup(current.library, incoming.macros, policy);
    const saved = await macroStore.replace(current.revision, next);
    macroSaved = current.revision !== saved.revision;
  }

  // Write macros first. If the bookmark write fails, retrying the backup does
  // not replay any saved playback positions. Identical macros are reused.
  try {
    const result = await storage.importVideos(incoming.videos, {
      includeTags: incoming.includeTags,
    });
    return { ...result, macroSaved };
  } catch (error) {
    if (macroSaved)
      throw new Error(
        `Macros saved. Bookmark import failed. Paste the same backup again and repeat your conflict choice to retry. ${error.message}`,
      );
    throw error;
  }
}
