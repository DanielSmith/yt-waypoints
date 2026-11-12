// Runs in <head> before styles, resolving System to a concrete theme selector.
// Keep the palette in CSS; register only theme IDs and labels here.
globalThis.WAYPOINTS_THEME = (() => {
  const choices = [
    { id: "system", label: "System" },
    { id: "light", label: "Light" },
    { id: "dark", label: "Dark" },
  ];
  const normalize = value => choices.some(theme => theme.id === value) ? value : "system";
  const media = globalThis.matchMedia?.("(prefers-color-scheme: dark)");
  let preference = "system";
  let revision = 0;
  function render() {
    document.documentElement.dataset.theme = preference === "system" ? (media?.matches ? "dark" : "light") : preference;
  }
  function apply(value) {
    revision++;
    preference = normalize(value);
    render();
  }
  render();
  media?.addEventListener("change", () => { if (preference === "system") render(); });
  const initialRevision = revision;
  const api = globalThis.browser ?? globalThis.chrome;
  // A delayed startup read must not overwrite a selection already made by
  // the popup. Storage errors leave the system theme usable.
  if (api?.storage?.local) {
    api.storage.local.get("settings").then(({ settings }) => {
      if (revision === initialRevision) apply(settings?.theme);
    }).catch(() => {});
  }
  return { choices, normalize, apply };
})();
