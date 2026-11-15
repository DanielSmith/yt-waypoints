// Executed in the actual popup bundle scope; helpers are explicit test ports.
module.exports = async function editorCases({ cases, check, flush, waitFor, noteField }) {
  // A bottom-of-list bookmark must retain its row while the one shared editor
  // expands below it, including during a storage refresh from another context.
  const baseline = await WAYPOINTS_STORAGE.read();
  const scrollIds = Array.from({ length: 12 }, (_, i) => `bbbbbbbbb${String(i).padStart(2, "0")}`);
  const seeded = await WAYPOINTS_STORAGE.read();
  for (const [index, id] of scrollIds.entries())
    seeded.videos[id] = {
      id,
      title: `Scroll fixture bookmark ${index + 1}`,
      t: 20,
      duration: 1000,
      updated: index + 1,
      startNote: `Loaded on demand: ${index + 1}`,
    };
  await WAYPOINTS_STORAGE.save(seeded);
  await render();
  const sourceRow = listEl.querySelector(`.main[data-id="${scrollIds[0]}"]`);
  sourceRow.focus();
  sourceRow.scrollIntoView({ block: "end" });
  const startScroll = listEl.scrollTop;
  check(
    getComputedStyle(noteField).minHeight === "40px" &&
      getComputedStyle(noteField).maxHeight === "160px",
    "Default annotation input bounds changed",
  );
  document.documentElement.style.setProperty("--annotation-input-min-height", "48px");
  document.documentElement.style.setProperty("--annotation-input-max-height", "72px");
  document.documentElement.style.setProperty("--annotation-scroll-clearance", "6px");
  await markers.edit(scrollIds[0]);
  const inlineEditor = document.getElementById("annotation-editor");
  const inlineRow = sourceRow.parentElement;
  const inlineDraft = annotationEditor.draft;
  check(
    Object.isFrozen(inlineDraft) &&
      inlineDraft.id === scrollIds[0] &&
      inlineDraft.markerId === null &&
      inlineDraft.originalNote === "Loaded on demand: 1" &&
      !Object.hasOwn(inlineDraft, "snapshot"),
    "Inline UI must receive only the immutable domain draft context",
  );
  check(
    inlineEditor.parentElement === inlineRow && inlineRow.contains(sourceRow),
    "Editor must be attached beneath its source bookmark",
  );
  check(
    document.querySelectorAll("#annotation-editor").length === 1 &&
      document.querySelectorAll("#annotation-text").length === 1,
    "Editor must be one shared on-demand form",
  );
  check(
    noteField.value === "Loaded on demand: 1",
    "Opening did not dynamically load the selected note",
  );
  const reveal = inlineEditor.getAnimations()[0];
  check(
    reveal &&
      reveal.effect.getTiming().duration === 500 &&
      parseFloat(reveal.effect.getKeyframes()[0].height) === 0,
    "Inline editor must ease open from zero over 500ms",
  );
  reveal.pause();
  reveal.currentTime = 250;
  await flush();
  check(
    inlineEditor.getBoundingClientRect().height > 0 &&
      inlineEditor.getBoundingClientRect().height < inlineEditor.scrollHeight,
    "Inline editor opening has no intermediate height",
  );
  reveal.finish();
  await flush();
  await flush();
  const visibleEditor = () => {
    const viewport = listEl.getBoundingClientRect();
    const source = sourceRow.getBoundingClientRect();
    const expanded = inlineEditor.getBoundingClientRect();
    const actions = document.getElementById("annotation-cancel").getBoundingClientRect();
    check(expanded.top >= source.bottom - 1, "Annotation editor covers its bookmark row");
    const previousFocus = document.activeElement;
    for (const id of ["annotation-save", "annotation-cancel"]) {
      const button = document.getElementById(id);
      button.focus({ preventScroll: true });
      const bounds = button.getBoundingClientRect();
      const style = getComputedStyle(button);
      const ring = parseFloat(style.outlineWidth) + Math.max(0, parseFloat(style.outlineOffset));
      check(
        bounds.left - ring >= expanded.left &&
          bounds.right + ring <= expanded.right &&
          bounds.bottom + ring <= expanded.bottom,
        "Annotation action focus outline is clipped: " + id,
      );
    }

    previousFocus?.focus({ preventScroll: true });
    check(
      source.top >= viewport.top - 1 &&
        expanded.bottom <= viewport.bottom + 1 &&
        actions.bottom <= viewport.bottom,
      "Source row or editor/actions are clipped by the list viewport",
    );
  };
  await waitFor(() => {
    const viewport = listEl.getBoundingClientRect();
    const source = sourceRow.getBoundingClientRect();
    const expanded = inlineEditor.getBoundingClientRect();
    return source.top >= viewport.top - 1 && expanded.bottom <= viewport.bottom + 1;
  }, "Inline editor layout did not settle");
  visibleEditor();
  check(
    getComputedStyle(noteField).minHeight === "48px" &&
      getComputedStyle(noteField).maxHeight === "72px",
    "Inline sizing calculation does not follow the CSS input bounds",
  );

  check(
    listEl.scrollTop > startScroll,
    "Opening a bottom-row note did not scroll the source row upward",
  );
  cases.push(
    "One dynamically populated inline editor, 500ms reveal and full bottom-row visibility",
  );
  noteField.value = "Unsaved draft survives background storage updates";
  noteField.focus();
  noteField.setSelectionRange(4, 12);
  const concurrent = await WAYPOINTS_STORAGE.read();
  concurrent.videos.aaaaaaaaaaa.t += 1;
  concurrent.videos[scrollIds[0]].startNote = "Changed by another editor";
  await WAYPOINTS_STORAGE.save(concurrent);
  await render();
  check(
    inlineEditor.parentElement === inlineRow && listEl.contains(inlineRow),
    "Storage refresh detached the inline editor/source row",
  );
  check(
    noteField.value === "Unsaved draft survives background storage updates" &&
      noteField.selectionStart === 4 &&
      noteField.selectionEnd === 12 &&
      document.activeElement === noteField,
    "Storage refresh lost the draft, selection or focus",
  );
  await markers.saveEditor();
  check(
    document.getElementById("annotation-error").textContent.includes("changed elsewhere"),
    "Conflicting save must preserve the draft with an explanation",
  );
  await waitFor(() => {
    const viewport = listEl.getBoundingClientRect();
    const source = sourceRow.getBoundingClientRect();
    const expanded = inlineEditor.getBoundingClientRect();
    return source.top >= viewport.top - 1 && expanded.bottom <= viewport.bottom + 1;
  }, "Inline editor layout did not settle");
  visibleEditor();
  cases.push(
    "Background refresh preserves the inline draft/selection and validation stays visible",
  );
  check(
    annotationEditor.draft === inlineDraft,
    "Background conflict changed the editor's original draft identity",
  );
  const collapse = markers.closeEditor();
  check(
    annotationEditor.isBusy && annotationEditor.isOpen,
    "Editor must retain its draft while closing",
  );
  check(
    markers.closeEditor() === collapse,
    "Repeated close calls must share one lifecycle promise",
  );
  await markers.edit(scrollIds[1]);
  check(
    annotationEditor.draft === inlineDraft,
    "A new edit request must not replace a closing draft",
  );
  const collapseMotion = inlineEditor.getAnimations()[0];
  check(
    collapseMotion &&
      collapseMotion.effect.getTiming().duration === 500 &&
      parseFloat(collapseMotion.effect.getKeyframes().at(-1).height) === 0,
    "Inline editor must ease closed to zero over 500ms",
  );
  collapseMotion.finish();
  await collapse;
  check(
    annotationEditor.draft === null && !annotationEditor.isBusy,
    "Closing must clear the editor session and pending lifecycle",
  );
  check(
    inlineEditor.hidden &&
      !listEl.contains(inlineEditor) &&
      noteField.value === "" &&
      document.getElementById("annotation-target").textContent === "",
    "Closed editor must detach and clear its dynamic data",
  );
  check(
    document.activeElement?.dataset.id === scrollIds[0],
    "Closing did not restore source-row focus",
  );
  for (const token of [
    "--annotation-input-min-height",
    "--annotation-input-max-height",
    "--annotation-scroll-clearance",
  ])
    document.documentElement.style.removeProperty(token);
  // Restore the fixture's saved-only view before the existing preview driver.
  const cleanup = await WAYPOINTS_STORAGE.read();
  cleanup.videos = baseline.videos;
  await WAYPOINTS_STORAGE.save(cleanup);
  await render();
  cases.push("Inline editor 500ms collapse, cleared parked form and source-row focus return");
};
