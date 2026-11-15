// Executed in the actual popup bundle scope; helpers are explicit test ports.
module.exports = async function markersCases({
  cases,
  check,
  reset,
  press,
  settleActions,
  noteField,
}) {
  await reset();
  const originalRowHeight = document
    .querySelector(".main")
    .parentElement.getBoundingClientRect().height;
  await press(document.querySelector(".main"), "m");
  let saved = (await WAYPOINTS_STORAGE.read()).videos.aaaaaaaaaaa;
  const personalId = saved.markers[0].id;
  check(
    saved.markers[0].t === 700 && saved.t === 100,
    "Marker used saved time instead of live time or changed resume",
  );
  check(
    document.querySelector(".main").parentElement.getBoundingClientRect().height ===
      originalRowHeight,
    "Markers added row height",
  );
  check(
    !document.querySelector(".marker-panel") && !document.querySelector(".marker-tick"),
    "Separate marker controls remain",
  );
  cases.push("Live marker position without seek or extra row height");
  keyboardFixture.operations = [];
  for (const extra of [
    { repeat: true },
    { ctrlKey: true },
    { altKey: true },
    { metaKey: true },
    { isComposing: true },
  ]) {
    await press(document.querySelector(".main"), "m", extra);
  }
  check(keyboardFixture.operations.length === 0, "Modified/repeated marker command leaked");
  cases.push("Marker repeat and modifier guards");
  await press(document.querySelector(".main"), "a");
  noteField.value = "A personal observation\nWorth returning to.";
  for (const key of ["m", "M", "a", "[", "]", "c", "C", "t", "h"]) {
    const event = await press(noteField, key);
    check(!event.defaultPrevented, "Annotation typing was intercepted: " + key);
  }
  await press(noteField, "Enter", { ctrlKey: true });
  saved = (await WAYPOINTS_STORAGE.read()).videos.aaaaaaaaaaa;
  check(
    saved.markers[0].note === "A personal observation\nWorth returning to.",
    "Annotation not saved",
  );
  check(document.getElementById("annotation-editor").hidden, "Editor did not close");
  cases.push("Native annotation editing and save");
  await press(document.querySelector(".main"), "a");
  check(
    noteField.value === "A personal observation\nWorth returning to.",
    "a did not open the existing annotation",
  );
  document.getElementById("annotation-cancel").click();
  await settleActions();
  cases.push("a opens existing annotation at current marker");
  await press(document.querySelector(".main"), "M", { shiftKey: true });
  check(!document.querySelector(".marker-overlay"), "M did not hide marker lines");
  check(
    (await WAYPOINTS_STORAGE.read()).settings.showMarkers === false,
    "M visibility did not persist",
  );
  check(
    (await WAYPOINTS_STORAGE.read()).videos.aaaaaaaaaaa.markers[0].note,
    "Hiding erased annotation",
  );
  await press(document.querySelector(".main"), "M", { shiftKey: true, repeat: true });
  check(!document.querySelector(".marker-overlay"), "Repeated M toggled visibility");
  await press(document.querySelector(".main"), "M", { shiftKey: true });
  check(document.querySelector(".marker-overlay"), "M did not restore marker lines");
  cases.push("M toggles visibility with repeat guard and preserves annotations");
  const withChapter = await WAYPOINTS_STORAGE.read();
  withChapter.videos.aaaaaaaaaaa.markers.push({
    id: "c:120000",
    t: 120,
    origin: "chapter",
    title: "Understanding the main idea",
  });
  await WAYPOINTS_STORAGE.save(withChapter);
  await render();
  keyboardFixture.position = 500;
  await press(document.querySelector(".main"), "[");
  check(keyboardFixture.position === 120, "[ did not navigate to chapter marker");
  await press(document.querySelector(".main"), "]");
  check(keyboardFixture.position === 700, "] did not navigate to personal marker");
  cases.push("Keyboard previous/next marker navigation");
  await press(document.querySelector(".main"), "m");
  saved = (await WAYPOINTS_STORAGE.read()).videos.aaaaaaaaaaa;
  check(
    saved.markers.find((point) => point.id === personalId).note === undefined,
    "Deleting marker retained annotation",
  );
  await press(document.querySelector(".main"), "a");
  check(
    document.getElementById("annotation-target").textContent.includes("Video start 0:00"),
    "No current marker did not fall back to start",
  );
  noteField.value = "A note about the whole video.";
  await press(noteField, "Enter", { metaKey: true });
  check(
    (await WAYPOINTS_STORAGE.read()).videos.aaaaaaaaaaa.startNote ===
      "A note about the whole video.",
    "Start note failed",
  );
  await press(document.querySelector(".main"), "m");
  saved = (await WAYPOINTS_STORAGE.read()).videos.aaaaaaaaaaa;
  check(
    saved.markers.find((point) => point.origin === "user" && !point.removed).note === undefined,
    "Re-add revived old annotation",
  );
  cases.push("Marker deletion clears annotation; fallback and re-add remain clean");
  await press(document.querySelector(".main"), "[");
  await press(document.querySelector(".main"), "a");
  noteField.value = "The chapter title stays separate from this note.";
  await press(noteField, "Enter", { ctrlKey: true });
  saved = (await WAYPOINTS_STORAGE.read()).videos.aaaaaaaaaaa;
  check(
    saved.markers.find((point) => point.id === "c:120000").origin === "chapter",
    "Note changed chapter origin",
  );
  const chapterLine = document.querySelector(".marker-line.marker-chapter");
  const personalLine = document.querySelector(".marker-line.marker-user");
  check(chapterLine && personalLine, "Missing marker lines");
  check(
    getComputedStyle(chapterLine).width === "1px" && getComputedStyle(personalLine).width === "1px",
    "Markers are not thin vertical lines",
  );
  check(
    getComputedStyle(document.querySelector(".marker-overlay")).pointerEvents === "none",
    "Markers steal slider pointer events",
  );
  const lineRect = chapterLine.getBoundingClientRect(),
    barRect = document.querySelector(".bar").getBoundingClientRect();
  check(
    lineRect.top >= barRect.top && lineRect.bottom <= barRect.bottom,
    "Marker is not over the timeline",
  );
  check(
    document.querySelector(".main").parentElement.getBoundingClientRect().height ===
      originalRowHeight,
    "Marker UI wastes vertical space",
  );
  cases.push("Thin overlaid marker lines and chapter annotations");
};
