// Optional built-workspace smoke test. Exercises both adapters in headless Chrome.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const setupFixture = require("./keyboard/setup.cjs");
const { runBrowser } = require("./keyboard/browser.cjs");

async function exercise() {
  const $ = (id) => document.getElementById(id);
  const check = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  const waitFor = async (condition, message) => {
    for (let i = 0; i < 100; i++) {
      if (condition()) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(message);
  };
  const fill = (id, value, type = "input") => {
    $(id).value = value;
    $(id).dispatchEvent(new Event(type, { bubbles: true }));
  };
  const submit = (id) => $(id).requestSubmit();
  const cases = [];
  const recordId = "aaaaaaaaaaa";
  await waitFor(() => $("workspace-videos").querySelector("button"), "Workspace did not load");
  check(
    location.hash === "#search" && $("search-tab").getAttribute("aria-current") === "page",
    "Search deep link did not select the tab",
  );
  $("workspace-videos").querySelector("button").click();
  await waitFor(() => !$("workspace-tags").hidden, "Tag draft did not open");
  fill("workspace-tag-input", "Research Notes");
  check(/research_notes/.test($("workspace-slug").textContent), "Missing canonical tag preview");
  submit("workspace-tags");
  fill("workspace-filter", "no matching title");
  check(
    !$("workspace-tags").hidden && /research_notes/.test($("workspace-tag-list").textContent),
    "Filtering out the selected video lost its draft",
  );
  $("themes-tab").click();
  await waitFor(
    () => !$("workspace-themes").hidden && $("theme-select")?.options.length,
    "Themes tab did not initialize",
  );
  fill("theme-select", "dark", "change");
  await waitFor(
    () => document.documentElement.dataset.theme === "dark",
    "Dark theme did not apply",
  );
  $("search-tab").click();
  await waitFor(() => !$("workspace-search").hidden, "Search tab did not reopen");
  check(/research_notes/.test($("workspace-tag-list").textContent), "Tab switch lost draft");
  $("workspace-tags-save").click();
  await waitFor(() => $("workspace-tag-status").textContent === "Tags saved.", "Tag save failed");
  const bookmark = (await WAYPOINTS_STORAGE.read()).videos[recordId];
  check(
    bookmark.tags.includes("research_notes") && bookmark.t === 100,
    "Tag save changed playback",
  );
  cases.push("deep link, canonical tag, filtering, drafts across tabs and dark theme");

  const youtubeURL = "https://www.youtube.com/watch?v=" + recordId;
  const originalQuery = browser.tabs.query;
  const originalGet = browser.tabs.get;
  const originalExecute = browser.scripting.executeScript;
  browser.tabs.query = async () => [];
  $("workspace-creator-read").click();
  await waitFor(
    () => /Open this video/.test($("workspace-creator-status").textContent),
    "Closed video guidance missing",
  );
  browser.tabs.query = async () => [{ id: 7, url: youtubeURL }];
  browser.tabs.get = async () => ({ url: youtubeURL });
  browser.scripting.executeScript = async () => [
    {
      frameId: 0,
      result: { state: "ready", id: recordId, keywords: ["Research Notes", "Creator Topic"] },
    },
  ];
  $("workspace-creator-read").click();
  await waitFor(() => !$("workspace-creator-add").hidden, "Creator suggestions missing");
  const unmatched = $("workspace-creator-list").querySelector('input[value="creator_topic"]');
  check(
    !unmatched.checked &&
      $("workspace-creator-list").querySelector('input[value="research_notes"]').disabled,
    "Suggestions must start unchecked and existing tags are disabled",
  );
  unmatched.click();
  $("workspace-creator-add").click();
  check(
    /creator_topic/.test($("workspace-tag-list").textContent) &&
      !(await WAYPOINTS_STORAGE.read()).videos[recordId].tags.includes("creator_topic"),
    "Adding a suggestion should affect the draft only",
  );
  $("workspace-tag-list").querySelector('[data-tag="creator_topic"]').click();
  check(
    $("workspace-creator-list").querySelector('input[value="creator_topic"]').disabled,
    "Removed suggestion must stay removed in this draft",
  );
  browser.tabs.query = originalQuery;
  browser.tabs.get = originalGet;
  browser.scripting.executeScript = originalExecute;
  cases.push("closed-video guidance, opt-in creator tags, and draft-only changes");

  $("workspace-macro-new").click();
  fill("workspace-macro-name", "watchlist");
  fill("workspace-macro-expression", ".research_notes +");
  await waitFor(
    () => /^Preview:/.test($("workspace-preview-count").textContent),
    "Invalid syntax not shown",
  );
  fill("workspace-macro-expression", "*limit:1*");
  await waitFor(() => !$("workspace-preview-source").hidden, "Modifier needs a starting set");
  check(
    /Enter a tag or saved search/.test($("workspace-preview-count").textContent),
    "An empty modifier preview should explain what to type",
  );
  fill("workspace-preview-selection", ".research_notes");
  await waitFor(
    () => /1 of 1/.test($("workspace-preview-count").textContent),
    "Modifier preview failed",
  );
  fill("workspace-macro-expression", ".missing");
  await waitFor(
    () => $("workspace-preview-count").textContent === "0 matches",
    "Empty preview not shown",
  );
  check($("workspace-preview-source").hidden, "Complete searches should hide the input");
  fill("workspace-macro-expression", ".research_notes *limit:1*");
  await waitFor(
    () => /1 of 1/.test($("workspace-preview-count").textContent),
    "No matching preview",
  );
  submit("workspace-macro-form");
  await waitFor(
    () => $("workspace-macro-status").textContent === "Saved @watchlist.",
    "Macro save failed",
  );
  const key = "waypoints.macros.v1";
  const registry = (await browser.storage.local.get(key))[key];
  check(
    registry.library.macros.watchlist.linkItems === ".research_notes *limit:1*",
    "Stored macro mismatch",
  );
  cases.push("macro validation, accurate preview, and save");

  await browser.storage.local.set({
    [key]: {
      revision: "dependent",
      library: {
        version: 1,
        macros: { ...registry.library.macros, later: { linkItems: "@watchlist" } },
      },
    },
  });
  await waitFor(
    () => /draft is kept/.test($("workspace-macro-status").textContent),
    "Missing revision conflict",
  );
  check(
    $("workspace-macro-expression").value === ".research_notes *limit:1*" &&
      $("workspace-macro-save").disabled,
    "Conflicting update did not preserve the macro draft",
  );
  $("workspace-macro-cancel").click();
  fill("workspace-macros", "watchlist", "change");
  fill("workspace-macro-name", "research");
  submit("workspace-macro-form");
  await waitFor(
    () => $("workspace-macro-status").textContent === "Saved @research.",
    "Macro rename failed",
  );
  const renamed = (await browser.storage.local.get(key))[key];
  check(
    renamed.library.macros.later.linkItems === "@research" && !renamed.library.macros.watchlist,
    "Rename did not rewrite references",
  );
  $("workspace-macro-delete").click();
  await waitFor(
    () => /depends on/.test($("workspace-macro-status").textContent),
    "Deleting a referenced macro must report the dependency",
  );
  fill("workspace-macros", "later", "change");
  $("workspace-macro-delete").click();
  await waitFor(
    () => $("workspace-macro-status").textContent === "Macro deleted.",
    "Delete failed",
  );
  const deleted = (await browser.storage.local.get(key))[key];
  check(
    !deleted.library.macros.later && deleted.library.macros.research,
    "Delete affected another macro",
  );
  cases.push("stale draft, atomic macro rename, and guarded deletion");

  const popup = document.createElement("iframe");
  popup.title = "Popup backed by the same fixture storage";
  popup.src = new URL("popup.html", location.href);
  document.body.append(popup);
  await waitFor(() => {
    const input = popup.contentDocument?.getElementById("search");
    return input && !input.disabled;
  }, "Popup did not load");
  const popupSearch = popup.contentDocument.getElementById("search");
  popupSearch.value = "@research";
  popupSearch.dispatchEvent(new popup.contentWindow.Event("input", { bubbles: true }));
  const rows = popup.contentDocument.querySelectorAll("#list .main");
  check(
    rows.length === 1 && rows[0].dataset.id === recordId,
    "Popup could not use the saved search",
  );
  popup.remove();
  cases.push("saved tags and macro run in the packaged popup");

  fill("workspace-tag-input", "draft still here");
  await WAYPOINTS_STORAGE.trash(recordId);
  await waitFor(
    () => /draft is kept/.test($("workspace-tag-status").textContent),
    "Missing lifetime conflict",
  );
  check(
    $("workspace-tag-input").value === "draft still here" && $("workspace-tags-save").disabled,
    "Trashing the video lost the draft or allowed a stale save",
  );
  $("workspace-tags-cancel").click();
  check($("workspace-tags").hidden, "Cancel did not close the tag draft");
  cases.push("trashed bookmark preserves and blocks stale tag edits");
  return cases;
}

async function main() {
  const flavor = process.argv[2] || "chrome";
  assert.ok(["chrome", "firefox"].includes(flavor));
  const extension = path.resolve(__dirname, "../yt-waypoints-" + flavor);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "waypoints-workspace-"));
  const fixturePath = path.join(temporary, "workspace.html");
  const stage = `
    <script>(${setupFixture.toString()})({});
      location.hash = "#search";
      const requests = [];
      globalThis.fetch = (...args) => { requests.push(args); throw Error("Unexpected network request"); };
      addEventListener("load", async () => {
        let report;
        try {
          const cases = await (${exercise.toString()})();
          if (requests.length) throw Error("Workspace tried to fetch over the network");
          report = { pass: true, features: [{ name: "workspace", cases: cases.length }], cases };
        } catch (error) {
          report = { pass: false, stage: "workspace", error: error.stack || error.message };
        }
        const node = document.createElement("pre");
        node.id = "keyboard-result";
        node.hidden = true;
        node.textContent = encodeURIComponent(JSON.stringify(report));
        document.body.append(node);
      });
    </script>`;
  const root = pathToFileURL(extension + path.sep).href;
  const html = fs
    .readFileSync(path.join(extension, "workspace.html"), "utf8")
    .replace(/\b(src|href)="\/(?!\/)/g, '$1="')
    .replace(
      /href="(#(?:search|themes))"/g,
      (_, hash) => `href="${pathToFileURL(fixturePath).href}${hash}"`,
    )
    .replace("<head>", `<head><base href="${root}">${stage}`);
  fs.writeFileSync(fixturePath, html);
  const bridge = `<script>
    const shared = parent.browser;
    window.browser = { ...shared, storage: {
      ...shared.storage,
      local: { ...shared.storage.local, async get(keys) {
        return structuredClone(await shared.storage.local.get(keys));
      } },
    } };
  </script>`;
  const popupHtml = fs
    .readFileSync(path.join(extension, "popup.html"), "utf8")
    .replace(/\b(src|href)="\/(?!\/)/g, '$1="')
    .replace("<head>", `<head><base href="${root}">${bridge}`);
  fs.writeFileSync(path.join(temporary, "popup.html"), popupHtml);
  try {
    const report = await runBrowser({
      fixturePath,
      temporary,
      options: { windowSize: { width: 1000, height: 760 } },
      expectedFeatures: [{ name: "workspace", expectedCases: 6 }],
    });
    console.log(`PASS: ${flavor} workspace, ${report.cases.length} browser scenario groups`);
  } finally {
    console.log("Evidence:", temporary);
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
