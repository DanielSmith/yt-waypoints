// Copyright 2026 Daniel Smith
// SPDX-License-Identifier: Apache-2.0
import {
  ALAP_MACROS_STORAGE_KEY as KEY,
  ALAP_MACROS_VERSION,
  normalizeMacroLibrary,
  renameMacro,
  removeMacro,
} from "./alap-data.mjs";

const LOCK = "yt-waypoints-macro-library-v1";

export function createMacroStore(api, { locks = globalThis.navigator?.locks } = {}) {
  async function read() {
    const raw = (await api.storage.local.get(KEY))[KEY];
    if (raw === undefined) {
      return { revision: null, library: { version: ALAP_MACROS_VERSION, macros: {} } };
    }
    if (
      !raw ||
      !Object.hasOwn(raw, "revision") ||
      !Object.hasOwn(raw, "library") ||
      Object.keys(raw).length !== 2 ||
      typeof raw.revision !== "string" ||
      !raw.revision
    )
      throw new Error("Invalid local macro registry revision.");
    return { revision: raw.revision, library: normalizeMacroLibrary(raw.library) };
  }

  async function edit(expectedRevision, update) {
    if (!locks?.request) throw new Error("Macro saving requires browser support for Web Locks.");
    return locks.request(LOCK, async () => {
      const current = await read();
      if (current.revision !== expectedRevision)
        throw new Error("Macros changed in another editor. Reload the saved macros before saving.");
      const library = update(current.library);
      if (JSON.stringify(library) === JSON.stringify(current.library)) return current;
      const next = { revision: crypto.randomUUID(), library };
      await api.storage.local.set({ [KEY]: next });
      return next;
    });
  }

  return Object.freeze({
    read,
    replace: async (revision, library) => {
      const validated = normalizeMacroLibrary(library);
      return edit(revision, () => validated);
    },
    rename: (revision, oldName, newName) =>
      edit(revision, (library) => renameMacro(library, oldName, newName)),
    remove: (revision, name) => edit(revision, (library) => removeMacro(library, name)),
    subscribe(callback) {
      function listener(changes, area) {
        if (area === "local" && Object.hasOwn(changes, KEY)) callback();
      }
      api.storage.onChanged.addListener(listener);
      return () => api.storage.onChanged.removeListener(listener);
    },
  });
}
