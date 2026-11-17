import { normalizeTheme, THEME_COLOR_ROLES } from "./theme-data.mjs";
import {
  createThemeLibrary,
  THEME_LIBRARY_KEY,
  normalizeThemeSelection,
} from "./theme-library.mjs";

export function initializeTheme() {
  // The single validated palette owner, initialized in <head> before styles.
  const api = globalThis.browser ?? globalThis.chrome;
  const store = api?.storage?.local ? createThemeLibrary(api) : null;
  const media = globalThis.matchMedia?.("(prefers-color-scheme: dark)");
  const root = document.documentElement;
  const builtins = [
    { id: "system", label: "System" },
    { id: "light", label: "Light" },
    { id: "dark", label: "Dark" },
  ];
  const listeners = new Set();
  let themes = [],
    preference = "system",
    preview = null,
    revision = 0,
    previewRevision = 0;
  const normalize = (id) => normalizeThemeSelection(id, themes);
  function clearColors() {
    for (const role of THEME_COLOR_ROLES) root.style.removeProperty(`--color-${role}`);
    root.style.removeProperty("color-scheme");
  }
  function render() {
    const custom = preview || themes.find((theme) => theme.id === preference);
    clearColors();
    root.dataset.theme =
      custom?.appearance ||
      (preference === "system" ? (media?.matches ? "dark" : "light") : preference);
    if (custom) {
      for (const role of THEME_COLOR_ROLES)
        root.style.setProperty(`--color-${role}`, custom.colors[role]);
      root.style.setProperty("color-scheme", custom.appearance);
    }
  }
  function apply(id) {
    revision++;
    previewRevision++;
    preview = null;
    preference = normalize(id);
    render();
  }
  function accept(state) {
    themes = state.themes;
    preference = normalize(state.selected);
    if (!preview) render();
    for (const listener of listeners) listener(preference);
  }
  async function reload() {
    const token = ++revision;
    try {
      const state = await store.read();
      if (token === revision) accept(state);
    } catch {
      if (token === revision) accept({ themes: [], selected: "system" });
    }
  }
  render();
  media?.addEventListener("change", () => {
    if (preference === "system" && !preview) render();
  });
  const initialRevision = revision;
  const ready = store
    ? store
        .read()
        .then((state) => {
          if (revision === initialRevision) accept(state);
        })
        .catch(() => {
          if (revision === initialRevision) accept({ themes: [], selected: "system" });
        })
    : Promise.resolve();
  api?.storage?.onChanged?.addListener((changes, area) => {
    if (area === "local" && (changes.settings || changes[THEME_LIBRARY_KEY])) reload();
  });
  const service = {
    get choices() {
      return [
        ...builtins,
        ...themes.map((theme) => ({
          id: theme.id,
          name: theme.name,
          label:
            themes.filter((other) => other.name === theme.name).length > 1
              ? `${theme.name} (${theme.id.slice(6)})`
              : theme.name,
        })),
      ];
    },
    normalize,
    apply,
    ready,
    sync(id) {
      preference = normalize(id);
      if (!preview) render();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async preview(theme) {
      revision++;
      previewRevision++;
      try {
        preview = normalizeTheme(theme);
        render();
      } catch (error) {
        preview = null;
        render();
        throw error;
      }
    },
    async cancelPreview() {
      previewRevision++;
      preview = null;
      if (store) await reload();
      else render();
    },
    async select(id) {
      const token = previewRevision;
      await store.select(id);
      if (token === previewRevision) preview = null;
      await reload();
    },
    async save(theme, options) {
      const token = previewRevision;
      const state = await store.save(theme, options);
      if (options?.select && token === previewRevision) preview = null;
      await reload();
      return state;
    },
    async restore(input, options) {
      const token = previewRevision;
      const state = await store.restore(input, options);
      if (options?.select && token === previewRevision) preview = null;
      await reload();
      return state;
    },
    async remove(id) {
      const state = await store.remove(id);
      await reload();
      return state;
    },
    async reset() {
      const token = previewRevision;
      await store.reset();
      if (token === previewRevision) preview = null;
      await reload();
    },
    export: (id) => store.export(id),
    persistSettings: (next, fields, normalize) => store.persistSettings(next, fields, normalize),
  };
  globalThis.WAYPOINTS_THEME = service;
  return service;
}
