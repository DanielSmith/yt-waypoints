module.exports = async function alapBackup({ cases, check, waitFor, settleActions }) {
  const id = "aaaaaaaaaaa";
  const key = "waypoints.macros.v1";
  const snapshot = await WAYPOINTS_STORAGE.read();
  const video = { ...snapshot.videos[id], tags: ["research"] };
  const library = { version: 1, macros: { pick: { linkItems: ".research *limit:1*" } } };
  const backup = {
    format: "yt-waypoints",
    version: 3,
    videos: { [id]: video },
    macroLibrary: library,
  };
  function paste(data) {
    const clipboard = new DataTransfer();
    clipboard.setData("text/plain", JSON.stringify(data));
    document.dispatchEvent(
      new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: clipboard,
      }),
    );
  }
  paste(backup);
  await settleActions();
  const first = await WAYPOINTS_STORAGE.read();
  check(first.videos[id].tags[0] === "research", "Tagged backup reaches the real storage owner");
  check(
    (await browser.storage.local.get(key))[key].library.macros.pick.linkItems ===
      library.macros.pick.linkItems,
    "Macro reaches its separate registry",
  );
  cases.push("paste imports tagged bookmark and macro registry");

  const conflict = structuredClone(backup);
  conflict.videos[id].t = video.t + 1;
  conflict.macroLibrary.macros.pick.linkItems = ".research *limit:3*";
  paste(conflict);
  const dialog = document.getElementById("macro-import-dialog");
  await waitFor(() => dialog.open, "Macro conflict dialog did not open");
  check(
    (await WAYPOINTS_STORAGE.read()).videos[id].t === video.t,
    "Bookmarks wait for conflict choice",
  );
  dialog.querySelector('button[value="cancel"]').click();
  await settleActions();
  check((await WAYPOINTS_STORAGE.read()).videos[id].t === video.t, "Cancel preserves bookmarks");
  check(
    (await browser.storage.local.get(key))[key].library.macros.pick.linkItems ===
      library.macros.pick.linkItems,
    "Cancel preserves macros",
  );
  paste(conflict);
  await waitFor(() => dialog.open, "Macro conflict dialog did not reopen");
  dialog.querySelector('button[value="rename"]').click();
  await settleActions();
  const macros = (await browser.storage.local.get(key))[key].library.macros;
  check(
    macros.pick_imported_1.linkItems === conflict.macroLibrary.macros.pick.linkItems,
    "Rename saves both",
  );
  check(
    (await WAYPOINTS_STORAGE.read()).videos[id].t === conflict.videos[id].t,
    "Bookmarks follow macro save",
  );
  cases.push("macro conflict dialog cancels or renames before writing");

  let copied;
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: async (text) => {
        copied = JSON.parse(text);
      },
    },
  });
  const copy = document.getElementById("copy-videos");
  copy.click();
  await waitFor(() => copied?.macroLibrary, "Full copy omitted the macro library");
  check(
    copied.version === 3 &&
      copied.videos[id].tags[0] === "research" &&
      copied.macroLibrary.macros.pick_imported_1.linkItems === macros.pick_imported_1.linkItems,
    "Full copy contains tags and macros",
  );
  paste({ format: "yt-waypoints", version: 3, videos: { [id]: { ...video, tags: [] } } });
  await settleActions();
  check(!(await WAYPOINTS_STORAGE.read()).videos[id].tags, "Explicit empty tags clear local tags");
  cases.push("full backup copies tags and macros, and explicit empty tags clear");
};
