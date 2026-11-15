// Actual DOM coverage for compact editing and selected-marker channel previews.
module.exports = async function annotationPreviewCases({ cases, check, press, noteField }) {
  const baseline = await WAYPOINTS_STORAGE.read();
  const snapshot = await WAYPOINTS_STORAGE.read();
  const video = snapshot.videos.aaaaaaaaaaa;
  video.channelName = "Some Long Channel Name With More Words";
  video.t = 0;
  video.markers = [
    {
      id: "u:preview",
      t: 10,
      origin: "user",
      note: "Frothurn - Autumn Feels\nA very long annotation that must fit on one line",
    },
    { id: "c:20000", t: 20, origin: "chapter", title: "Chapter default" },
    { id: "c:30000", t: 30, origin: "chapter", title: "Cleared title", note: "" },
    { id: "u:removed", t: 40, origin: "user", note: "Removed note", removed: true },
  ];
  await WAYPOINTS_STORAGE.save(snapshot);
  await render();
  keyboardFixture.open = false;
  const row = () => listEl.querySelector('.main[data-id="aaaaaaaaaaa"]');
  const channel = () => row().querySelector(".channel-name");
  const excerpt = () => row().querySelector(".annotation-excerpt");
  check(!excerpt(), "An unselected marker must not supply a preview");
  const height = row().parentElement.getBoundingClientRect().height;
  await press(row(), "]");
  check(
    excerpt()?.textContent ===
      "Frothurn - Autumn Feels A very long annotation that must fit on one line",
    "Marker navigation must show the selected note as single-line plain text",
  );
  for (const theme of ["light", "dark"]) {
    WAYPOINTS_THEME.apply(theme);
    check(excerpt().scrollWidth > excerpt().clientWidth, "Long annotation must be clipped");
    check(getComputedStyle(excerpt()).textOverflow === "ellipsis", "Preview needs an ellipsis");
    check(channel().scrollWidth <= channel().clientWidth + 1, "Channel preview overflows its row");
    check(
      row().parentElement.getBoundingClientRect().height === height,
      "Channel annotation must not add row height",
    );
    const wrapper = row().querySelector(".channel-annotation");
    check(
      getComputedStyle(wrapper, "::before").content === '"("' &&
        getComputedStyle(wrapper, "::after").content === '")"',
      "Clipped annotation must retain both parentheses",
    );
  }
  WAYPOINTS_THEME.apply(settings.theme);
  cases.push("Selected annotation clips inside parentheses beside the channel in both themes");
  await press(row(), "a");
  for (const motion of document.getElementById("annotation-editor").getAnimations())
    motion.finish();
  const heading = document.getElementById("annotation-heading");
  const target = document.getElementById("annotation-target");
  check(heading.textContent === "Edit Annotation", "Editor heading must use the requested name");
  check(
    Math.abs(heading.getBoundingClientRect().bottom - target.getBoundingClientRect().bottom) <= 3,
    "Heading and marker time must share one line",
  );
  check(
    !document.querySelector('#annotation-editor label[for="annotation-text"]'),
    "Redundant Annotation label remains",
  );
  check(
    noteField.getAttribute("aria-labelledby") === heading.id &&
      noteField.getAttribute("aria-describedby").split(" ").includes(target.id),
    "Textarea must retain an accessible label and marker context",
  );
  const closing = markers.closeEditor();
  for (const motion of document.getElementById("annotation-editor").getAnimations())
    motion.finish();
  await closing;
  cases.push("Compact Edit Annotation header keeps time inline and textarea labelled");
  await press(row(), "]");
  check(
    excerpt()?.textContent === "Chapter default",
    "Chapter title should supply the default preview",
  );
  await press(row(), "]");
  check(!excerpt(), "An explicit empty note must suppress the chapter default and parentheses");
  await press(row(), "[");
  check(excerpt()?.textContent === "Chapter default", "Previous marker must update the preview");
  await press(row(), "m");
  check(!excerpt(), "Removing the selected marker must clear its preview");
  cases.push("Marker preview follows previous/next, chapter defaults, explicit clears and removal");
  const cleanup = await WAYPOINTS_STORAGE.read();
  cleanup.videos = baseline.videos;
  await WAYPOINTS_STORAGE.save(cleanup);
  await render();
};
