// Stringified into the real popup module's scope by fixture.cjs. Free application
// names deliberately resolve to the actual emitted bundle, not a second model.
module.exports = function createHelpers() {
  const cases = [];
  function check(condition, message) {
    if (!condition) throw Error(message);
  }
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  async function reset(position = 100) {
    const snapshot = await bookmarks.loadSnapshot();
    const { videos } = snapshot;
    videos.aaaaaaaaaaa.t = position;
    await bookmarks.saveSnapshot(snapshot);
    await render();
    await flush();
    keyboardFixture.operations = [];
    keyboardFixture.position = 700;
  }
  async function settleActions() {
    const work = queue;
    let completed = false;
    work.then(
      () => {
        completed = true;
      },
      () => {
        completed = true;
      },
    );
    // Virtual time can finish before macOS headless compositor animations do.
    // These keyboard cases test commands, not elapsed animation time. Explicit
    // motion cases below still sample/finish their own native animations.
    for (let attempt = 0; attempt < 100 && !completed; attempt++) {
      await flush();
      for (const motion of document.getElementById("annotation-editor").getAnimations())
        motion.finish();
    }
    check(completed, "Queued action did not settle after editor motion completed");
    await work;
  }

  async function press(target, key, extra = {}) {
    target.focus();
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...extra });
    target.dispatchEvent(event); // Native DOM capture -> target -> bubble phases.
    await settleActions();
    await flush();
    return event;
  }
  async function position() {
    return (await WAYPOINTS_STORAGE.read()).videos.aaaaaaaaaaa.t;
  }
  async function waitFor(predicate, message, { attempts = 100, interval = 20 } = {}) {
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
    check(predicate(), message);
  }
  const noteField = document.getElementById("annotation-text");
  const originalMatchMedia = globalThis.matchMedia;
  return {
    cases,
    check,
    flush,
    reset,
    settleActions,
    press,
    position,
    waitFor,
    noteField,
    originalMatchMedia,
  };
};
