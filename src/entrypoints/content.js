import { defineContentScript } from "wxt/utils/define-content-script";
import "../shared/settings-policy.js";
import "../shared/youtube-values.js";
import "../shared/marker-data.js";
import "../shared/metadata.js";
import "../shared/player-results.js";
import "../shared/storage.js";
import { startAutosave } from "../shared/content.js";

export default defineContentScript({
  matches: ["*://*.youtube.com/*"],
  runAt: "document_idle",
  // WXT can signal reinjection through document events without page messages.
  noScriptStartedPostMessage: true,
  main(context) {
    startAutosave(context);
  },
});
