// Copyright 2026 Daniel Smith
// SPDX-License-Identifier: Apache-2.0
import { defineUnlistedScript } from "wxt/utils/define-unlisted-script";
import "../shared/settings-policy.js";
import "../shared/youtube-values.js";
import "../shared/marker-data.js";
import "../shared/alap-tags.js";
import "../shared/storage.js";
import { initializeThemeManager } from "../shared/theme-manager.mjs";
import { initializeSearchWorkspace } from "../shared/workspace-search.mjs";

export default defineUnlistedScript(() => {
  const byId = (id) => document.getElementById(id);
  const themes = byId("workspace-themes");
  let loadingThemes;
  function route() {
    const showingThemes = location.hash === "#themes";
    themes.hidden = !showingThemes;
    byId("workspace-search").hidden = showingThemes;
    byId("themes-tab").setAttribute("aria-current", showingThemes ? "page" : "false");
    byId("search-tab").setAttribute("aria-current", showingThemes ? "false" : "page");
    if (showingThemes) {
      loadingThemes ??= initializeThemeManager({ dropTarget: themes }).catch((error) => {
        byId("theme-manager-status").textContent = error.message;
      });
    }
  }
  addEventListener("hashchange", route);
  route();
  initializeSearchWorkspace().catch((error) => {
    byId("workspace-tag-status").textContent = `Could not load Search: ${error.message}`;
  });
});
