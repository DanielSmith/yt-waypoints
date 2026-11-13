// One motion contract for Help, Settings and the on-demand annotation editor.
globalThis.WAYPOINTS_ANIMATE_HEIGHT = (content, from, to) => {
  if (
    globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ||
    typeof content.animate !== "function" ||
    from === to
  )
    return null;
  return content.animate([{ height: `${from}px` }, { height: `${to}px` }], {
    duration: 500,
    easing: "cubic-bezier(0.22, 1, 0.36, 1)",
    fill: "both",
  });
};

// Reversible, reduced-motion-aware disclosures shared by Help and Settings.
globalThis.WAYPOINTS_CREATE_DISCLOSURES = (contentSelector) => {
  const motions = new Map();

  function settle() {
    for (const [row, motion] of motions) {
      motion.animation.cancel();
      row.open = motion.open;
    }
    motions.clear();
  }

  function toggle(row) {
    const content = row.querySelector(contentSelector);
    const previous = motions.get(row);
    const open = previous ? !previous.open : !row.open;
    // Closed details can still report their content's laid-out height. Start
    // expansion at zero; only open or reversing disclosures have a visible height.
    const from = row.open ? content.getBoundingClientRect().height : 0;
    previous?.animation.cancel();
    motions.delete(row);
    row.open = true;
    const to = open ? content.scrollHeight : 0;
    const animation = WAYPOINTS_ANIMATE_HEIGHT(content, from, to);
    if (!animation) {
      row.open = open;
      return;
    }
    motions.set(row, { animation, open });
    animation.finished.then(
      () => {
        if (motions.get(row)?.animation !== animation) return;
        row.open = open;
        motions.delete(row);
        animation.cancel();
      },
      () => {
        /* A rapid toggle or closing the view intentionally cancels motion. */
      },
    );
  }

  return Object.freeze({ toggle, settle });
};
