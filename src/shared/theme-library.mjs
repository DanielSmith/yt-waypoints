// Copyright 2026 Daniel Smith
// SPDX-License-Identifier: Apache-2.0
// Theme-only persistence. No bookmark access, parsing terminal files or color derivation.
import {
  normalizeTheme,
  normalizeThemeBackup,
  THEMES_FORMAT,
  THEME_FORMAT,
  THEME_SCHEMA_VERSION,
  THEME_LIMITS,
} from "./theme-data.mjs";
export const THEME_LIBRARY_KEY = "waypoints.themes.v1";
const BUILTINS = ["system", "light", "dark"];
const empty = () => ({ format: THEMES_FORMAT, version: THEME_SCHEMA_VERSION, themes: [] });
export const normalizeThemeSelection = (id, themes) =>
  BUILTINS.includes(id) || themes.some((theme) => theme.id === id) ? id : "system";

export function parseThemeBackup(input) {
  if (typeof input === "string") {
    if (new TextEncoder().encode(input).length > THEME_LIMITS.backupBytes)
      throw new Error("Theme backup exceeds 1 MiB.");
    try {
      input = JSON.parse(input);
    } catch {
      throw new Error("Invalid theme backup JSON.");
    }
  }
  return normalizeThemeBackup(input);
}
export function serializeThemeBackup(themes, id) {
  const backup =
    id === undefined
      ? { ...empty(), themes }
      : {
          format: THEME_FORMAT,
          version: THEME_SCHEMA_VERSION,
          theme: themes.find((theme) => theme.id === id),
        };
  return JSON.stringify(normalizeThemeBackup(backup));
}

export function createThemeLibrary(api, { locks = globalThis.navigator?.locks } = {}) {
  let queue = Promise.resolve();
  const get = () => api.storage.local.get([THEME_LIBRARY_KEY, "settings"]);
  function decode(raw) {
    const backup =
      raw[THEME_LIBRARY_KEY] === undefined ? empty() : normalizeThemeBackup(raw[THEME_LIBRARY_KEY]);
    if (backup.format !== THEMES_FORMAT) throw new Error("Invalid local theme library.");
    return {
      themes: backup.themes,
      selected: normalizeThemeSelection(raw.settings?.theme, backup.themes),
    };
  }
  function transact(action, required = true) {
    if (locks?.request) return locks.request("yt-waypoints-theme-library-v1", action);
    if (required)
      return Promise.reject(new Error("Theme saving requires browser support for Web Locks."));
    const pending = queue.then(action);
    queue = pending.catch(() => {});
    return pending;
  }
  const read = async () => decode(await get());
  async function restore(input, { conflict = "error", select = false } = {}) {
    const backup = parseThemeBackup(input);
    if (!["error", "replace", "keep-both"].includes(conflict))
      throw new Error("Unknown theme conflict policy.");
    const incoming = backup.format === THEME_FORMAT ? [backup.theme] : backup.themes;
    return transact(async () => {
      const raw = await get(),
        previous = decode(raw);
      const themes = previous.themes.slice();
      let added = 0,
        replaced = 0,
        kept = 0,
        lastId;
      for (let theme of incoming) {
        let index = themes.findIndex((item) => item.id === theme.id);
        if (index >= 0 && JSON.stringify(themes[index]) === JSON.stringify(theme)) {
          kept++;
          lastId = theme.id;
          continue;
        }
        if (index >= 0) {
          if (conflict === "error")
            throw new Error(
              `Theme already exists with different content: ${theme.name}. Choose replace or keep both.`,
            );
          if (conflict === "keep-both") {
            do {
              theme = { ...theme, id: `theme:${crypto.randomUUID()}` };
            } while (themes.some((item) => item.id === theme.id));
            index = -1;
          }
        }
        if (index >= 0) {
          themes[index] = theme;
          replaced++;
        } else {
          themes.push(theme);
          added++;
        }
        lastId = theme.id;
      }
      // Validate the complete merged library before the one atomic set. Portable
      // IDs never become storage keys; unrelated themes/settings remain intact.
      const library = normalizeThemeBackup({ ...empty(), themes });
      const changes = {};
      if (added || replaced) changes[THEME_LIBRARY_KEY] = library;
      if (select && lastId && raw.settings?.theme !== lastId)
        changes.settings = { ...raw.settings, theme: lastId };
      if (Object.keys(changes).length) await api.storage.local.set(changes);
      return { ...decode({ ...raw, ...changes }), added, replaced, kept };
    });
  }
  async function remove(id) {
    return transact(async () => {
      const raw = await get(),
        state = decode(raw);
      const themes = state.themes.filter((theme) => theme.id !== id);
      if (themes.length === state.themes.length) return state;
      const changes = { [THEME_LIBRARY_KEY]: normalizeThemeBackup({ ...empty(), themes }) };
      if (raw.settings?.theme === id) changes.settings = { ...raw.settings, theme: "system" };
      await api.storage.local.set(changes);
      return decode({ ...raw, ...changes });
    });
  }
  async function select(id) {
    return transact(async () => {
      const raw = await get(),
        state = decode(raw);
      if (normalizeThemeSelection(id, state.themes) !== id)
        throw new Error("Unknown theme selection.");
      if (raw.settings?.theme !== id)
        await api.storage.local.set({ settings: { ...raw.settings, theme: id } });
      return { ...state, selected: id };
    }, !BUILTINS.includes(id));
  }
  async function reset() {
    // Selection recovery must work even if the saved library is malformed.
    return transact(async () => {
      const raw = await get();
      await api.storage.local.set({ settings: { ...raw.settings, theme: "system" } });
    }, false);
  }
  async function persistSettings(next, fields, normalize = (value) => value) {
    return transact(async () => {
      const raw = await get();
      const latest = normalize(raw.settings || {});
      const merged = Object.fromEntries(
        Object.entries(next).map(([key, value]) => [
          key,
          fields.includes(key) ? value : (latest[key] ?? value),
        ]),
      );
      // Existing settings writes may not reintroduce a deleted custom selection.
      let themes = [];
      try {
        themes = decode(raw).themes;
      } catch {
        /* Preserve corrupt records for recovery. */
      }
      merged.theme = normalizeThemeSelection(
        fields.includes("theme") ? next.theme : raw.settings?.theme,
        themes,
      );
      await api.storage.local.set({ settings: merged });
      return merged;
    }, false);
  }
  return {
    read,
    restore,
    remove,
    select,
    reset,
    persistSettings,
    save: (theme, options) =>
      restore(
        { format: THEME_FORMAT, version: THEME_SCHEMA_VERSION, theme: normalizeTheme(theme) },
        options,
      ),
    export: async (id) => serializeThemeBackup((await read()).themes, id),
  };
}
