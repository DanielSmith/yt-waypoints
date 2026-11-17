import { defineUnlistedScript } from "wxt/utils/define-unlisted-script";
import { initializeThemeManager } from "../shared/theme-manager.mjs";

export default defineUnlistedScript(() => {
  initializeThemeManager().catch((error) => {
    document.getElementById("theme-manager-status").textContent =
      `Could not open theme settings: ${error.message}`;
  });
});
