// Copyright 2026 Daniel Smith
// SPDX-License-Identifier: Apache-2.0
import { THEME_LIMITS, normalizeTheme, normalizeThemeBackup } from "./theme-data.mjs";
import {
  checkThemeText,
  detectThemeFormat,
  readGhosttyColors,
  readITermColors,
} from "./theme-readers.mjs";
import { convertTheme, themeSlug } from "./theme-convert.mjs";
import { downloadFile } from "./file-download.mjs";

export function createThemeImportController({
  document,
  service,
  getSelection,
  setStatus,
  openPicker,
}) {
  const $ = (id) => document.getElementById(id);
  let draft = null,
    revision = 0,
    busy = false,
    previewValid = false;
  function message(text, error = false) {
    $("theme-message").textContent = text;
    $("theme-message").classList.toggle("error", error);
  }
  function refresh() {
    const custom = service.choices.some(
      (item) => item.id === getSelection() && item.id.startsWith("theme:"),
    );
    $("theme-export").disabled = busy || Boolean(draft) || !custom;
    $("theme-remove").disabled = busy || Boolean(draft) || !custom;
    $("theme-backup").disabled =
      busy || !service.choices.some((item) => item.id.startsWith("theme:"));
    for (const id of [
      "theme-import",
      "theme-import-save",
      "theme-import-cancel",
      "theme-reset",
      "theme-import-name",
      "theme-import-choice",
      "theme-import-appearance",
      "theme-import-conflict",
    ])
      $(id).disabled = busy;
    $("theme-import-save").disabled = busy || !previewValid;
  }
  function chosen() {
    return Number($("theme-import-choice").value) || 0;
  }
  function finishOperation() {
    busy = false;
    refresh();
    if (!draft && !$("settings-panel").hidden) $("theme-import").focus({ preventScroll: true });
  }
  function buildTheme() {
    if (!draft) return null;
    let theme,
      diagnostics = null;
    if (draft.native) {
      const original = draft.themes[chosen()];
      const name = $("theme-import-name").value.trim();
      const renamed = name !== original.name;
      const id = renamed
        ? (draft.renameIds[chosen()] ||= `theme:${crypto.randomUUID()}`)
        : original.id;
      theme = normalizeTheme({ ...original, name, id });
      draft.pending = draft.pending.map((item, index) => (index === chosen() ? theme : item));
    } else {
      const result = convertTheme(draft.source, $("theme-import-name").value, draft.filename, {
        appearance: $("theme-import-appearance").value,
      });
      draft.id ||= result.theme.id;
      theme = { ...result.theme, id: draft.id };
      diagnostics = result.diagnostics;
    }
    draft.theme = theme;
    $("theme-import-format").textContent =
      `${draft.native ? "Waypoints backup" : draft.source.format === "ghostty" ? "Ghostty" : "iTerm XML"} · ${theme.appearance}`;
    $("theme-import-notes").textContent = diagnostics
      ? `${diagnostics.contrast.checks} contrast checks passed.\n${diagnostics.adjustments.map((item) => `${item.role}: ${item.from} → ${item.to}`).join("\n")}\n${diagnostics.fallbacks.map((item) => `${item.role}: ${item.reason}`).join("\n")}`
      : "Saved colors and converter revision are preserved without reconversion.";
    const source = theme.source;
    $("theme-import-credits").textContent =
      [
        source.name,
        source.attribution?.author,
        source.attribution?.license,
        source.attribution?.notice,
        source.attribution?.url,
      ]
        .filter(Boolean)
        .join("\n") || "No source credits supplied.";
    return theme;
  }
  async function preview() {
    if (!draft || busy) return;
    const token = revision;
    previewValid = false;
    try {
      const theme = buildTheme();
      await service.preview(theme);
      if (token !== revision) return;
      previewValid = true;
      $("theme-import-save").disabled = false;
      const duplicate = service.choices.some(
        (item) => item.id.startsWith("theme:") && item.name === theme.name,
      );
      message(
        duplicate
          ? "A saved theme has this name. Separate IDs keep the copies distinct."
          : "Preview only; nothing saved yet.",
      );
    } catch (error) {
      if (token !== revision) return;
      $("theme-import-save").disabled = true;
      $("theme-import-format").textContent = "Preview unavailable";
      $("theme-import-notes").textContent = "";
      await service.cancelPreview();
      if (token !== revision) return;
      message(error.message, true);
    }
  }
  async function cancel({ focus = true } = {}) {
    const token = ++revision;
    previewValid = false;
    draft = null;
    $("theme-import-preview").hidden = true;
    await service.cancelPreview();
    if (token !== revision) return;
    message("");
    refresh();
    if (focus) $("theme-import").focus();
  }
  async function loadFile(file) {
    if (!file || busy) return;
    const token = ++revision;
    draft = null;
    previewValid = false;
    $("theme-import-preview").hidden = true;
    for (const id of ["theme-import-format", "theme-import-notes", "theme-import-credits"])
      $(id).textContent = "";
    await service.cancelPreview();
    if (token !== revision) return;
    try {
      if (file.size > THEME_LIMITS.backupBytes) throw new Error("Theme file exceeds 1 MiB.");
      if (file.size > THEME_LIMITS.sourceFileBytes) {
        const prefix = await file.slice(0, THEME_LIMITS.sourceFileBytes).text();
        const content = prefix.trimStart().replace(/^\uFEFF/, "");
        if (content && !content.startsWith("{"))
          throw new Error("Terminal theme files must be at most 256 KiB.");
      }
      const buffer = await file.arrayBuffer();
      if (token !== revision) return;
      const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
      const format = detectThemeFormat(text);
      if (format === "waypoints") {
        const backup = normalizeThemeBackup(
          JSON.parse(checkThemeText(text, THEME_LIMITS.backupBytes)),
        );
        const themes = backup.format === "yt-waypoints-theme" ? [backup.theme] : backup.themes;
        if (!themes.length) {
          message("This theme collection is empty. Nothing changed.");
          return;
        }
        draft = { native: true, themes, pending: themes, renameIds: {}, filename: file.name };
      } else {
        const source =
          format === "ghostty"
            ? readGhosttyColors(text)
            : format === "iterm"
              ? readITermColors(text)
              : null;
        if (!source)
          throw new Error("Choose Ghostty, iTerm .itermcolors, or a Waypoints theme backup.");
        draft = { native: false, source, filename: file.name };
      }
      $("theme-import-choice").replaceChildren();
      if (draft.native)
        for (const [index, theme] of draft.themes.entries()) {
          const option = document.createElement("option");
          option.value = String(index);
          option.textContent = `${theme.name} (${theme.id.slice(6)})`;
          $("theme-import-choice").append(option);
        }
      $("theme-import-choice").value = "0";
      $("theme-import-choice-label").hidden = !draft.native || draft.themes.length < 2;
      $("theme-import-conflict-label").hidden = !draft.native;
      $("theme-import-conflict").value = "error";
      $("theme-import-appearance-label").hidden = draft.native;
      $("theme-import-appearance").value = "auto";
      $("theme-import-name").value = draft.native
        ? draft.themes[0].name
        : themeSlug(file.name.replace(/\.(?:ghostty|itermcolors|json|txt)$/i, ""));
      $("theme-import-save").textContent = draft.native ? "Restore themes" : "Save and use";
      $("theme-import-description").textContent = draft.native
        ? `Restore ${draft.themes.length} theme${draft.themes.length === 1 ? "" : "s"}. Your current selection stays unchanged.`
        : "Preview the colors, then save this theme and use it. Cancel returns to your saved selection.";
      $("theme-import-preview").hidden = false;
      refresh();
      await preview();
      if (token === revision) $("theme-import-name").focus({ preventScroll: true });
    } catch (error) {
      if (token !== revision) return;
      draft = null;
      $("theme-import-preview").hidden = true;
      await service.cancelPreview();
      if (token !== revision) return;
      message(error.message, true);
    }
  }
  async function save() {
    if (!draft || busy) return;
    const token = revision;
    try {
      const theme = buildTheme();
      busy = true;
      refresh();
      const result = draft.native
        ? await service.restore(
            { format: "yt-waypoints-themes", version: 1, themes: draft.pending },
            { conflict: $("theme-import-conflict").value, select: false },
          )
        : await service.save(theme, { select: true });
      if (token !== revision) return;
      const native = draft.native;
      await cancel();
      message(
        native
          ? `Restored: ${result.added} added, ${result.replaced} replaced, ${result.kept} unchanged. Selection preserved.`
          : `Saved and selected ${theme.name}.`,
      );
      setStatus(native ? "Theme backup restored." : `Theme: ${theme.name}`);
    } catch (error) {
      if (!busy) {
        previewValid = false;
        $("theme-import-format").textContent = "Preview unavailable";
        $("theme-import-notes").textContent = "";
        await service.cancelPreview();
      }
      if (token === revision) message(error.message, true);
    } finally {
      finishOperation();
    }
  }
  async function download(all) {
    try {
      const text = await service.export(all ? undefined : getSelection());
      const backup = JSON.parse(text);
      const filename = all
        ? "waypoints.waypoints-themes.json"
        : `${themeSlug(backup.theme.name) || "theme"}.waypoints-theme.json`;
      downloadFile(document, { text, mime: "application/json;charset=utf-8", filename });
      message(`Download requested: ${filename}`);
    } catch (error) {
      message(`Could not export themes: ${error.message}`, true);
    }
  }
  async function remove() {
    if (busy) return;
    const token = revision;
    busy = true;
    refresh();
    try {
      await service.remove(getSelection());
      if (token !== revision) return;
      await cancel();
      message("Theme removed. Other saved themes are unchanged.");
    } catch (error) {
      message(error.message, true);
    } finally {
      finishOperation();
    }
  }
  function init() {
    if (openPicker) {
      $("theme-import").textContent = "Import themes in a tab…";
      $("theme-import-help").textContent =
        "Firefox can close this popup during file selection. Opens a local theme tab; saved themes appear here too.";
    }
    $("theme-import").addEventListener("click", async () => {
      if (!openPicker) return $("theme-file").click();
      try {
        await openPicker();
      } catch (error) {
        message(`Could not open theme manager: ${error.message}`, true);
      }
    });
    $("theme-file").addEventListener("change", () => {
      loadFile($("theme-file").files?.[0]);
      $("theme-file").value = "";
    });
    $("theme-import").addEventListener("dragover", (event) => {
      if (event.dataTransfer?.types.includes("Files")) {
        event.preventDefault();
        $("theme-import").classList.add("dragging");
      }
    });
    $("theme-import").addEventListener("dragleave", () =>
      $("theme-import").classList.remove("dragging"),
    );
    $("theme-import").addEventListener("drop", (event) => {
      if (!event.dataTransfer?.files.length) return;
      event.preventDefault();
      $("theme-import").classList.remove("dragging");
      if (event.dataTransfer.files.length !== 1)
        return message("Choose one theme file or collection backup at a time.", true);
      loadFile(event.dataTransfer.files[0]);
    });
    $("theme-import-save").addEventListener("click", save);
    $("theme-import-cancel").addEventListener("click", () => cancel());
    $("theme-import-name").addEventListener("change", preview);
    $("theme-import-appearance").addEventListener("change", preview);
    $("theme-import-choice").addEventListener("change", () => {
      if (!draft?.native) return;
      $("theme-import-name").value = draft.pending[chosen()].name;
      preview();
    });
    $("theme-export").addEventListener("click", () => download(false));
    $("theme-backup").addEventListener("click", () => download(true));
    $("theme-remove").addEventListener("click", remove);
    $("theme-reset").addEventListener("click", async () => {
      if (busy) return;
      const token = revision;
      busy = true;
      refresh();
      try {
        await service.reset();
        if (token !== revision) return;
        await cancel();
        message("Using System. Saved themes are kept.");
      } catch (error) {
        if (token === revision) message(error.message, true);
      } finally {
        finishOperation();
      }
    });
    service.subscribe(refresh);
    refresh();
  }
  return {
    init,
    cancel,
    loadFile,
    get isBusy() {
      return busy;
    },
  };
}
