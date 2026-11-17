// Copyright 2026 Daniel Smith
// SPDX-License-Identifier: Apache-2.0
// Persistent file-picker context. Reuse trusted popup markup and the same owner;
// never initialize bookmark, player, transcript or active-tab controllers here.
import popupHTML from "../entrypoints/popup.html?raw";
import { createThemeImportController } from "./popup-theme-import.mjs";

export async function initializeThemeManager() {
  const api = globalThis.browser ?? globalThis.chrome;
  const service = globalThis.WAYPOINTS_THEME;
  const source = new DOMParser().parseFromString(popupHTML, "text/html");
  const panel = document.getElementById("settings-panel");
  for (const selector of ['label[for="theme-select"]', ".theme-tools"])
    panel.append(document.importNode(source.querySelector(selector), true));
  const select = document.getElementById("theme-select");
  let selection = "system",
    choiceSignature = "";
  const setStatus = (text) => {
    document.getElementById("theme-manager-status").textContent = text;
  };
  function refresh(id) {
    selection = id;
    const signature = JSON.stringify(service.choices);
    if (signature !== choiceSignature) {
      choiceSignature = signature;
      select.replaceChildren(
        ...service.choices.map((choice) => {
          const option = document.createElement("option");
          option.value = choice.id;
          option.textContent = choice.label;
          return option;
        }),
      );
    }
    select.value = selection;
  }
  const controller = createThemeImportController({
    document,
    service,
    getSelection: () => selection,
    setStatus,
  });
  async function closeTab() {
    if (controller.isBusy)
      return setStatus("Wait for the theme operation to finish before closing.");
    try {
      await controller.cancel({ focus: false });
      const tab = await api.tabs.getCurrent();
      if (tab?.id === undefined) throw new Error("This page is not in a browser tab.");
      await api.tabs.remove(tab.id);
    } catch (error) {
      setStatus(
        `Could not close this tab: ${error.message}. You can close it using the browser's tab button.`,
      );
    }
  }
  for (const id of ["theme-manager-close", "theme-manager-done"])
    document.getElementById(id).addEventListener("click", closeTab);
  document.addEventListener("dragover", (event) => {
    if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
  });
  document.addEventListener("drop", (event) => {
    if (event.defaultPrevented || !event.dataTransfer?.files.length) return;
    event.preventDefault();
    if (event.dataTransfer.files.length !== 1)
      return setStatus("Choose one theme file or collection backup at a time.");
    controller.loadFile(event.dataTransfer.files[0]);
  });
  service.subscribe(refresh);
  await service.ready;
  const { settings } = await api.storage.local.get("settings");
  refresh(service.normalize(settings?.theme));
  controller.init();
  select.addEventListener("change", async () => {
    const id = select.value;
    try {
      await controller.cancel({ focus: false });
      await service.select(id);
    } catch (error) {
      setStatus(error.message);
    }
  });
  return controller;
}
