module.exports = async function themeImportCases({ cases, check, waitFor, flush }) {
  const $ = (id) => document.getElementById(id);
  const themeKey = "waypoints.themes.v1";
  const original = (await api.storage.local.get("settings")).settings;
  const canonical = (value) =>
    value && typeof value === "object"
      ? Array.isArray(value)
        ? value.map(canonical)
        : Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((key) => [key, canonical(value[key])]),
          )
      : value;
  const beforeVideos = JSON.stringify(canonical((await WAYPOINTS_STORAGE.read()).videos));
  const source = "background=#20242a\nforeground=#f0f0f0\npalette=4=#5591dd\n";
  const make = (text, name = "Controller Sample.ghostty") =>
    new File([text], name, { type: "text/plain" });
  const drop = (target, files) => {
    const transfer = new DataTransfer();
    files.forEach((file) => transfer.items.add(file));
    const event = new DragEvent("drop", {
      dataTransfer: transfer,
      bubbles: true,
      cancelable: true,
    });
    target.dispatchEvent(event);
    return event;
  };
  const pick = (file) => {
    const transfer = new DataTransfer();
    transfer.items.add(file);
    $("theme-file").files = transfer.files;
    $("theme-file").dispatchEvent(new Event("change"));
  };
  const opened = () =>
    waitFor(
      () => !$("theme-import-preview").hidden && !$("theme-import-save").disabled,
      "Theme preview did not become ready",
    );
  const cancelled = async () => {
    $("theme-import-cancel").click();
    await waitFor(
      () =>
        $("theme-import-preview").hidden &&
        !document.documentElement.style.getPropertyValue("--color-surface"),
      "Theme preview did not cancel",
    );
  };
  setSettingsOpen(true);
  $("settings-appearance").open = true;
  let localPickerClicks = 0;
  const inputClick = $("theme-file").click;
  $("theme-file").click = () => {
    localPickerClicks++;
  };
  $("theme-import").click();
  if (WAYPOINTS_THEME_PICKER_IN_TAB) {
    await waitFor(
      () => keyboardFixture.themeTabs.length > 0,
      "Firefox picker did not open the persistent theme page",
    );
    check(
      keyboardFixture.themeTabs.at(-1).url === "https://extension.test/themes.html",
      "Firefox picker routed to the wrong page",
    );
    check(localPickerClicks === 0, "Firefox opens a native dialog in the transient toolbar popup");
  } else check(localPickerClicks === 1, "Chromium picker routing unexpectedly changed");
  $("theme-file").click = inputClick;
  cases.push("firefox-picker-opens-persistent-theme-page-without-opening-popup-file-dialog");
  const count = keyboardFixture.settingsWrites;
  pick(make(source));
  await opened();
  check(
    $("theme-import-format").textContent.includes("Ghostty"),
    "Picker did not detect Ghostty content",
  );
  check(
    document.documentElement.style.getPropertyValue("--color-surface") === "#20242a",
    "Picker preview is not applied",
  );
  check(keyboardFixture.settingsWrites === count, "Picker preview persists preferences");
  await api.storage.local.set({
    settings: { ...(await api.storage.local.get("settings")).settings, theme: "light" },
  });
  await flush();
  await cancelled();
  check(
    document.documentElement.dataset.theme === "light",
    "Cancel did not follow the latest external selection",
  );
  cases.push("theme-picker-preview-cancel-follows-latest-selection-without-saving");
  check(
    !drop(document.body, [make(source)]).defaultPrevented,
    "Theme import consumes drops outside its area",
  );
  check(
    drop($("theme-import"), [make(source)]).defaultPrevented,
    "Import area did not accept a file drop",
  );
  await opened();
  $("theme-import-name").value = "long-" + "theme".repeat(15);
  $("theme-import-name").dispatchEvent(new Event("change"));
  $("theme-import-appearance").value = "light";
  $("theme-import-appearance").dispatchEvent(new Event("change"));
  await flush();
  check(
    document.documentElement.dataset.theme === "light",
    "Explicit appearance correction did not apply",
  );
  $("theme-import-name").focus();
  $("theme-import-name").scrollIntoView({ block: "nearest" });
  const rect = $("theme-import-name").getBoundingClientRect();
  check(rect.left >= 0 && rect.right <= 360, "Long import name does not fit the popup");
  check(
    getComputedStyle($("theme-import-name")).outlineStyle !== "none",
    "Import name has no focus indication",
  );
  $("theme-import-save").click();
  await waitFor(
    () =>
      $("theme-import-preview").hidden &&
      settings.theme.startsWith("theme:") &&
      !$("theme-export").disabled,
    "Save-and-use did not persist/select the theme",
  );
  const selected = settings.theme;
  check(
    (await api.storage.local.get(themeKey))[themeKey].themes.some((theme) => theme.id === selected),
    "Saved file is missing from the library",
  );
  cases.push("theme-drop-save-and-use-appearance-correction-and-long-label-fit");
  const requests = [],
    blobs = [];
  const oldClick = HTMLAnchorElement.prototype.click,
    oldCreate = URL.createObjectURL;
  const clipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  let clipboardCalls = 0;
  try {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText() {
          clipboardCalls++;
          throw Error("Clipboard disabled");
        },
      },
    });
    URL.createObjectURL = (blob) => {
      blobs.push(blob);
      return oldCreate(blob);
    };
    HTMLAnchorElement.prototype.click = function () {
      requests.push(this.download);
    };
    $("theme-export").click();
    await waitFor(() => requests.length === 1, "Export theme did not request a download");
    $("theme-backup").click();
    await waitFor(() => requests.length === 2, "Back up themes did not request a download");
    check(
      JSON.parse(await blobs[0].text()).theme.id === selected,
      "Single-theme download contains the wrong theme",
    );
    check(JSON.parse(await blobs[1].text()).themes.length > 0, "Collection download is empty");
    check(
      requests[0].endsWith(".waypoints-theme.json") &&
        requests[1].endsWith(".waypoints-themes.json"),
      "Download filenames are incorrect",
    );
    check(
      clipboardCalls === 0 && !$("file-save-dialog").open,
      "Theme export depends on clipboard/file offers",
    );
    check(!document.querySelector("a[download]"), "Download anchor was not removed");
  } finally {
    HTMLAnchorElement.prototype.click = oldClick;
    URL.createObjectURL = oldCreate;
    if (clipboard) Object.defineProperty(navigator, "clipboard", clipboard);
    else delete navigator.clipboard;
  }
  cases.push("theme-single-and-collection-direct-downloads-ignore-clipboard-and-offer-settings");
  const fixtures = Object.values(keyboardFixture.themeFixtures);
  const backup = { format: "yt-waypoints-themes", version: 1, themes: fixtures };
  pick(make(JSON.stringify(backup), "backup.json"));
  await opened();
  check(
    $("theme-import-appearance-label").hidden &&
      $("theme-import-save").textContent === "Restore themes",
    "Native backups are treated as terminal sources",
  );
  $("theme-import-choice").value = "1";
  $("theme-import-choice").dispatchEvent(new Event("change"));
  await flush();
  $("theme-import-save").click();
  await waitFor(() => $("theme-import-preview").hidden, "Collection restore did not finish");
  check(settings.theme === selected, "Native collection restore switches the current selection");
  const stored = (await api.storage.local.get(themeKey))[themeKey].themes;
  for (const theme of fixtures)
    check(
      JSON.stringify(canonical(stored.find((item) => item.id === theme.id))) ===
        JSON.stringify(canonical(theme)),
      "Native restore changes saved colors or provenance",
    );
  cases.push("theme-collection-restore-preserves-records-and-current-selection");
  pick(
    make(
      JSON.stringify({
        format: "yt-waypoints-theme",
        version: 1,
        theme: { ...fixtures[0], name: "Conflict copy" },
      }),
      "conflict.json",
    ),
  );
  await opened();
  $("theme-import-save").click();
  await waitFor(
    () => $("theme-message").classList.contains("error"),
    "Conflicting backup did not report an error",
  );
  check(
    (await api.storage.local.get(themeKey))[themeKey].themes.length === stored.length,
    "Conflict partially restores a backup",
  );
  $("theme-import-conflict").value = "keep-both";
  $("theme-import-save").click();
  await waitFor(() => $("theme-import-preview").hidden, "Explicit keep-both did not finish");
  check(
    (await api.storage.local.get(themeKey))[themeKey].themes.length === stored.length + 1,
    "Keep-both did not create a separate record",
  );
  cases.push("theme-restore-conflicts-require-explicit-resolution");
  const xml =
    '<plist version="1.0"><dict>' +
    ["Background Color", "Foreground Color"]
      .map(
        (name, index) =>
          `<key>${name}</key><dict><key>Color Space</key><string>sRGB</string><key>Red Component</key><real>${1 - index}</real><key>Green Component</key><real>${1 - index}</real><key>Blue Component</key><real>${1 - index}</real></dict>`,
      )
      .join("") +
    "</dict></plist>";
  pick(make(xml, "native-parser.itermcolors"));
  await opened();
  check(
    $("theme-import-format").textContent.includes("iTerm XML"),
    "iTerm file was not parsed through DOMParser",
  );
  setSettingsOpen(false);
  await waitFor(() => $("theme-import-preview").hidden, "Closing Settings leaves an active draft");
  setSettingsOpen(true);
  $("settings-appearance").open = true;
  pick(make("invalid data"));
  await waitFor(
    () => $("theme-message").classList.contains("error"),
    "Invalid file was not rejected",
  );
  check($("theme-import-preview").hidden, "Invalid file leaves a preview visible");
  pick(new File(["x".repeat(1048577)], "oversize"));
  await waitFor(
    () => $("theme-message").textContent.includes("1 MiB"),
    "Oversize file was not rejected",
  );
  cases.push("theme-iterm-native-parser-close-cancel-and-invalid-file-recovery");
  $("theme-remove").click();
  await waitFor(
    () => settings.theme === "system" && $("theme-remove").disabled,
    "Selected theme was not removed/reset",
  );
  check(
    !(await api.storage.local.get(themeKey))[themeKey].themes.some(
      (theme) => theme.id === selected,
    ),
    "Removed theme remains in storage",
  );
  const savedCount = (await api.storage.local.get(themeKey))[themeKey].themes.length;
  $("theme-reset").click();
  await flush();
  check(
    (await api.storage.local.get(themeKey))[themeKey].themes.length === savedCount,
    "System reset deletes saved themes",
  );
  check(
    JSON.stringify(canonical((await WAYPOINTS_STORAGE.read()).videos)) === beforeVideos,
    "Theme UI changes bookmark data",
  );
  cases.push("theme-ui-remove-and-system-reset-preserve-other-themes-and-bookmarks");
  const text = new DataTransfer();
  text.setData("text/plain", "native text");
  const textDrop = new DragEvent("drop", { dataTransfer: text, bubbles: true, cancelable: true });
  $("theme-import-name").dispatchEvent(textDrop);
  check(!textDrop.defaultPrevented, "Import steals ordinary text editing drops");
  drop($("theme-import"), [make(source), make(source, "second")]);
  check(
    $("theme-message").textContent.includes("one theme file"),
    "Multiple-file drop is not diagnosed",
  );
  await api.storage.local.set({ settings: original });
  await flush();
  setSettingsOpen(false);
  cases.push("theme-drop-scoping-and-native-text-editing-preserved");
};
