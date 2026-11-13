export function initializeTheme() {
  // Runs in <head> before styles, resolving System to a concrete theme selector.
  // Keep the palette in CSS; register only theme IDs and labels here.
  globalThis.WAYPOINTS_THEME = (() => {
    const SYSTEM_THEME_ID = "system";
    const DEFAULT_THEME_ID = SYSTEM_THEME_ID;
    const choices = [
      { id: SYSTEM_THEME_ID, label: "System" },
      { id: "light", label: "Light" },
      { id: "dark", label: "Dark" },
    ];
    const normalize = (value) =>
      choices.some((theme) => theme.id === value) ? value : DEFAULT_THEME_ID;
    const media = globalThis.matchMedia?.("(prefers-color-scheme: dark)");
    let preference = DEFAULT_THEME_ID;
    let revision = 0;
    function render() {
      document.documentElement.dataset.theme =
        preference === SYSTEM_THEME_ID ? (media?.matches ? "dark" : "light") : preference;
    }
    function apply(value) {
      revision++;
      preference = normalize(value);
      render();
    }
    render();
    media?.addEventListener("change", () => {
      if (preference === SYSTEM_THEME_ID) render();
    });
    const initialRevision = revision;
    const api = globalThis.browser ?? globalThis.chrome;
    // A delayed startup read must not overwrite a selection already made by
    // the popup. Storage errors leave the system theme usable.
    if (api?.storage?.local) {
      api.storage.local
        .get("settings")
        .then(({ settings }) => {
          if (revision === initialRevision) apply(settings?.theme);
        })
        .catch(() => {});
    }
    return { choices, normalize, apply };
  })();
}
