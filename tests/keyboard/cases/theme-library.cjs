module.exports = async function themeLibraryCases({ cases, check, flush, waitFor }) {
  const service = WAYPOINTS_THEME;
  const { dark, light } = keyboardFixture.themeFixtures;
  const root = document.documentElement;
  const originalSettings = (await api.storage.local.get("settings")).settings;
  const beforeVideos = JSON.stringify((await WAYPOINTS_STORAGE.read()).videos);
  await service.save(dark, { select: true });
  await waitFor(
    () => document.getElementById("theme-select").value === dark.id,
    "Saved selection did not reach Settings",
  );
  for (const [role, value] of Object.entries(dark.colors))
    check(
      root.style.getPropertyValue(`--color-${role}`) === value,
      `Custom role did not render: ${role}`,
    );
  const rgb = (hex) =>
    `rgb(${[1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16)).join(", ")})`;
  check(
    getComputedStyle(document.body).backgroundColor === rgb(dark.colors.surface),
    "Actual popup surface does not use custom colors",
  );
  check(getComputedStyle(root).colorScheme === "dark", "Custom native color scheme is wrong");
  const backup = JSON.parse(await service.export(dark.id));
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
  check(
    JSON.stringify(canonical(backup.theme)) === JSON.stringify(canonical(dark)),
    "Single-theme backup changes saved colors or metadata",
  );
  cases.push("saved-custom-theme-renders-all-roles-and-exports-exactly");
  const writes = keyboardFixture.settingsWrites;
  await service.preview(light);
  check(keyboardFixture.settingsWrites === writes, "Preview persists settings");
  check(
    getComputedStyle(document.body).backgroundColor === rgb(light.colors.surface),
    "Unsaved preview is not visible",
  );
  await service.select("light");
  await service.preview(dark);
  await api.storage.local.set({
    settings: { ...(await api.storage.local.get("settings")).settings, theme: "dark" },
  });
  await flush();
  check(
    root.style.getPropertyValue("--color-surface") === dark.colors.surface,
    "External selection discards an unsaved preview",
  );
  await service.cancelPreview();
  check(
    !root.style.getPropertyValue("--color-surface") && !root.style.getPropertyValue("color-scheme"),
    "Cancel leaves custom overrides behind",
  );
  check(root.dataset.theme === "dark", "Cancel did not restore the latest persisted selection");
  cases.push("custom-theme-preview-is-unsaved-and-cancel-follows-latest-selection");
  await service.select(dark.id);
  await service.remove(dark.id);
  await flush();
  check(
    !root.style.getPropertyValue("--color-text"),
    "Removing selected theme leaves stale custom colors",
  );
  check(
    (await api.storage.local.get("settings")).settings.theme === "system",
    "Selected removal did not reset preference",
  );
  check(
    JSON.stringify((await WAYPOINTS_STORAGE.read()).videos) === beforeVideos,
    "Theme operations modify bookmark data",
  );
  await api.storage.local.set({ settings: originalSettings });
  await flush();
  cases.push("selected-custom-theme-removal-recovers-builtins-with-bookmarks-untouched");
};
