// Preview staging runs only after every feature check passes. It never skips
// checks or changes the launcher viewport. Stringified into the popup scope.
module.exports = async function preparePreview({ preview, theme }, { flush, waitFor }) {
  if (preview === "theme-import") {
    setSettingsOpen(true);
    document.getElementById("settings-appearance").open = true;
    const source =
      theme === "dark"
        ? "background=#20242a\nforeground=#f0f0f0"
        : "background=#fafafa\nforeground=#222222";
    await themeImports.loadFile(new File([source], "preview-theme.ghostty"));
    const save = document.getElementById("theme-import-save");
    save.focus();
    save.scrollIntoView({ block: "nearest" });
    return;
  }
  if (preview.startsWith("settings")) {
    setSettingsOpen(true);
    if (preview === "settings-expanded") document.getElementById("settings-appearance").open = true;
    if (preview === "settings-bookmarks") {
      document.getElementById("settings-bookmarks").open = true;
      document.getElementById("auto-bookmark").focus();
    }
    if (preview === "settings-transcripts") {
      document.getElementById("settings-transcripts").open = true;
      document.getElementById("transcript-format-toggle").click();
    }
  }
  if (preview === "editor") {
    await markers.edit("aaaaaaaaaaa");
    for (const motion of document.getElementById("annotation-editor").getAnimations())
      motion.finish();
    await flush();
    await waitFor(
      () => document.getElementById("annotation-editor").getBoundingClientRect().height > 0,
      "Editor preview did not expand",
    );
    document.getElementById("annotation-save").focus({ preventScroll: true });
  }
  if (preview.startsWith("help")) {
    dialogs.openHelp();
    if (preview === "help-expanded") {
      document.querySelectorAll(".shortcut")[0].open = true;
      document.querySelectorAll(".shortcut")[2].open = true;
    }
  }
  WAYPOINTS_THEME.apply(theme);
};
