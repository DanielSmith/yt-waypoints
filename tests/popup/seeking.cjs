const assert = require("node:assert/strict");
const vm = require("node:vm");

module.exports = async ({ createPopupFixture }) => {
  const seekData = {
    settings: { autoBookmark: false, scrubSeconds: 7, shiftMultiplier: 4 },
    videos: {
      aaaaaaaaaaa: { id: "aaaaaaaaaaa", title: "Scrub me", t: 100, duration: 1000, updated: 123 },
    },
  };
  // Relative saved-only movement retains fractional time and treats unknown
  // duration as unbounded. Absolute slider commits floor and retain a zero bound.
  for (const [method, time, duration, value, expected] of [
    ["scrub", 100.75, 1000, 7.5, 108.25],
    ["scrub", 100.75, 1000, -200, 0],
    ["scrub", 995.5, 1000, 10, 1000],
    ["scrub", 100.75, 0, 7.5, 108.25],
    ["seekTo", 100.75, 1000, 108.75, 108],
    ["seekTo", 100.75, 1000, -10, 0],
    ["seekTo", 100.75, 1000, 1500, 1000],
    ["seekTo", 0, 0, 108.75, 0],
  ]) {
    const saved = await createPopupFixture(
      {
        ...seekData,
        videos: { aaaaaaaaaaa: { ...seekData.videos.aaaaaaaaaaa, t: time, duration } },
      },
      "https://example.com/",
    );
    await vm.runInContext(`bookmarks.${method}("aaaaaaaaaaa", ${value})`, saved.context);
    assert.equal(saved.data.videos.aaaaaaaaaaa.t, expected, `${method}, duration ${duration}`);
    assert.equal(saved.data.videos.aaaaaaaaaaa.updated, 123);
    assert.equal(saved.data.videos.aaaaaaaaaaa.duration, duration);
    assert.equal(
      saved.els.status.textContent,
      `Resume point ${Math.floor(expected / 60)}:${String(Math.floor(expected % 60)).padStart(2, "0")}`,
    );
    assert.equal(saved.executions.length, 0);
  }
  for (const [method, operation] of [
    ["scrub", "seek"],
    ["seekTo", "seekTo"],
  ]) {
    for (const paused of [false, true]) {
      const seeking = await createPopupFixture(seekData, "https://example.com/", {
        tabs: [{ id: 7, url: "https://www.youtube.com/watch?v=aaaaaaaaaaa" }],
        executeScript: async () => [
          { result: { id: "aaaaaaaaaaa", t: 750, duration: 1200, paused } },
        ],
      });
      seeking.executions.length = 0; // Exclude the startup chapter probe.
      await vm.runInContext(`bookmarks.${method}("aaaaaaaaaaa", 7.5)`, seeking.context);
      assert.deepEqual(seeking.executions, [{ operation, args: [7.5, "aaaaaaaaaaa"], tabId: 7 }]);
      assert.equal(
        seeking.data.videos.aaaaaaaaaaa.t,
        750,
        "use the validated live position rather than calculating from saved time",
      );
      assert.equal(seeking.data.videos.aaaaaaaaaaa.duration, 1200);
      assert.equal(seeking.data.videos.aaaaaaaaaaa.updated, 123);
      assert.equal(seeking.writes(), 1);
      assert.equal(seeking.els.status.textContent, `${paused ? "⏸ Paused" : "▶ Playing"} at 12:30`);
      await vm.runInContext(`bookmarks.${method}("missing", 7.5)`, seeking.context);
      assert.equal(seeking.executions.length, 1, "missing bookmarks cannot request a seek");
      assert.equal(seeking.writes(), 1);
    }
  }
  console.log(
    "PASS: shared seek flow preserves relative/absolute bounds, fractional/rounded saved times, live results, recency, status and one request/save",
  );

  const drag = await createPopupFixture(seekData, "https://example.com/");
  const findSlider = () => {
    const walk = (el) => (el.className === "bar" ? el : el.children.map(walk).find(Boolean));
    return walk(drag.els.list);
  };
  let slider = findSlider();
  assert.equal(slider.type, "range");
  assert.equal(slider.value, "100");
  let stopped = false;
  slider.events.click({
    stopPropagation() {
      stopped = true;
    },
  });
  assert.equal(stopped, true);
  slider.events.pointerdown({ button: 0, pointerId: 1, stopPropagation() {} });
  slider.value = "650";
  slider.events.input();
  assert.equal(drag.data.videos.aaaaaaaaaaa.t, 100, "drag only previews before release");
  assert.equal(drag.writes(), 0);
  assert.equal(slider.style["--progress"], "65%");
  await vm.runInContext(
    '(async () => { const snapshot = await bookmarks.loadSnapshot(); const { videos } = snapshot; videos.extra000001 = {id: "extra000001",title: "Concurrent bookmark",t:5,duration:60,updated:1}; videos.aaaaaaaaaaa.t = 105; await bookmarks.saveSnapshot(snapshot); })()',
    drag.context,
  );
  const writesBeforeDragCommit = drag.writes();
  await vm.runInContext("render()", drag.context);
  assert.equal(findSlider(), slider, "autosave rerender keeps the native dragging element");
  assert.equal(slider.value, "650");
  slider.events.pointerup();
  slider.events.change();
  await drag.settle();
  assert.equal(drag.data.videos.aaaaaaaaaaa.t, 650);
  assert.equal(drag.data.videos.aaaaaaaaaaa.updated, 123);
  assert.equal(drag.writes(), writesBeforeDragCommit + 1, "pointerup/change commits once");
  assert.ok(drag.data.videos.extra000001);
  assert.equal(drag.navigation.length, 0);
  assert.equal(drag.closed(), 0);
  slider = findSlider();
  slider.events.pointerdown({ button: 0, pointerId: 2, stopPropagation() {} });
  slider.value = "850";
  slider.events.input();
  slider.events.pointercancel();
  slider.events.change();
  await drag.settle();
  assert.equal(
    drag.data.videos.aaaaaaaaaaa.t,
    650,
    "cancelled drag restores original saved position",
  );
  assert.equal(findSlider().value, "650");
  assert.equal(drag.writes(), writesBeforeDragCommit + 1);
  slider = findSlider();
  slider.events.pointerdown({ button: 0, pointerId: 3, stopPropagation() {} });
  slider.events.pointerup();
  await drag.settle();
  assert.equal(
    drag.writes(),
    writesBeforeDragCommit + 1,
    "clicking an unchanged position cannot freeze rendering or write",
  );
  slider = findSlider();
  slider.focus();
  slider.events.keydown({
    key: "ArrowRight",
    shiftKey: true,
    preventDefault() {},
    stopPropagation() {},
  });
  await drag.settle();
  assert.equal(
    drag.data.videos.aaaaaaaaaaa.t,
    678,
    "slider keyboard follows configured Shift multiplier",
  );
  const live = await createPopupFixture(seekData, "https://example.com/", {
    tabs: [{ id: 7, windowId: 1, url: "https://www.youtube.com/watch?v=aaaaaaaaaaa" }],
    executeScript: async (request, data) => {
      data.videos.late0000001 = { id: "late0000001", title: "Added while seeking", t: 2, duration: 50 };
      return [{ result: { id: "aaaaaaaaaaa", t: 750, duration: 1000, paused: true } }];
    },
  });
  const liveSlider = live.els.list.querySelectorAll(".bar")[0];
  liveSlider.value = "750";
  liveSlider.events.input();
  liveSlider.events.change();
  await live.settle();
  assert.equal(live.data.videos.aaaaaaaaaaa.t, 750);
  assert.ok(live.data.videos.late0000001);
  assert.deepEqual(live.executions.at(-1), {
    operation: "seekTo",
    args: [750, "aaaaaaaaaaa"],
    tabId: 7,
  });
  assert.equal(live.navigation.length, 0);
  assert.equal(live.closed(), 0);
  assert.ok(live.els.status.textContent.includes("Paused"));
  console.log(
    "PASS: drag preview/commit/cancel, no row-open click, active drag survives autosave, single commit, configured keyboard steps, live seek and saved-only seek preserve other bookmarks",
  );
  // Deliver the same key through document capture and then the focused target.
  // Calling only slider.events.keydown misses the original duplicate-seek bug.
  async function dispatchKey(popup, target, key, extra = {}) {
    let stopped = false;
    const event = {
      key,
      target,
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
      stopPropagation() {
        stopped = true;
      },
      ...extra,
    };
    target.focus();
    popup.doc.listeners.keydown(event);
    if (!stopped) target.events.keydown?.(event);
    await popup.settle();
    return event;
  }
  const barOf = (popup) => {
    const walk = (element) =>
      element.className === "bar" ? element : element.children.map(walk).find(Boolean);
    return walk(popup.els.list);
  };
  for (const [key, shiftKey, expected] of [
    ["ArrowRight", false, 107],
    ["ArrowLeft", false, 93],
    ["ArrowRight", true, 128],
    ["ArrowLeft", true, 72],
  ]) {
    const keyboardSlider = await createPopupFixture(seekData, "https://example.com/", {
      tabs: [{ id: 7, url: "https://www.youtube.com/watch?v=aaaaaaaaaaa" }],
      executeScript: async (request) => [
        {
          result: {
            id: "aaaaaaaaaaa",
            t: request.func.name === "seek" ? 700 + request.args[0] : request.args[0],
            duration: 1000,
            paused: true,
          },
        },
      ],
    });
    const event = await dispatchKey(keyboardSlider, barOf(keyboardSlider), key, { shiftKey });
    assert.deepEqual(
      keyboardSlider.executions
        .filter((call) => call.operation !== "chapters")
        .map((call) => call.operation),
      ["seekTo"],
      "one slider arrow must issue exactly one absolute seek",
    );
    assert.deepEqual(keyboardSlider.executions.find((call) => call.operation === "seekTo").args, [
      expected,
      "aaaaaaaaaaa",
    ]);
    assert.equal(keyboardSlider.data.videos.aaaaaaaaaaa.t, expected);
    assert.equal(keyboardSlider.writes(), 1);
    assert.equal(event.defaultPrevented, true, "prevent the native extra range step");
    assert.equal(
      keyboardSlider.doc.activeElement,
      barOf(keyboardSlider),
      "keep keyboard focus on the updated slider",
    );
    await dispatchKey(keyboardSlider, keyboardSlider.doc.activeElement, key, {
      shiftKey,
      repeat: true,
    });
    assert.deepEqual(
      keyboardSlider.executions
        .filter((call) => call.operation !== "chapters")
        .map((call) => call.operation),
      ["seekTo", "seekTo"],
    );
  }
  const guardedSlider = await createPopupFixture(seekData, "https://example.com/");
  for (const extra of [
    { ctrlKey: true },
    { altKey: true },
    { metaKey: true },
    { isComposing: true },
  ]) {
    const event = await dispatchKey(guardedSlider, barOf(guardedSlider), "ArrowRight", extra);
    assert.equal(event.defaultPrevented, false, "modified/composition keys remain native");
  }
  assert.equal(guardedSlider.writes(), 0);
  assert.equal(guardedSlider.data.videos.aaaaaaaaaaa.t, 100);
  const closedSlider = await createPopupFixture(seekData, "https://example.com/");
  await dispatchKey(closedSlider, barOf(closedSlider), "ArrowRight", { shiftKey: true });
  assert.equal(closedSlider.data.videos.aaaaaaaaaaa.t, 128);
  assert.equal(closedSlider.writes(), 1);
  assert.equal(closedSlider.executions.length, 0);
  const rowArrows = await createPopupFixture(seekData, "https://example.com/", {
    tabs: [{ id: 7, url: "https://www.youtube.com/watch?v=aaaaaaaaaaa" }],
    executeScript: async () => [
      { result: { id: "aaaaaaaaaaa", t: 707, duration: 1000, paused: true } },
    ],
  });
  await dispatchKey(rowArrows, rowArrows.els.list.querySelectorAll(".main")[0], "ArrowRight");
  assert.deepEqual(
    rowArrows.executions
      .filter((call) => call.operation !== "chapters")
      .map((call) => call.operation),
    ["seek"],
    "row arrows retain relative playback scrubbing",
  );
  console.log(
    "PASS: capture/target keyboard ownership, one seek per slider arrow, Shift/repeat/focus, native modifier/composition keys, closed-video updates, and row-relative arrows",
  );
};
