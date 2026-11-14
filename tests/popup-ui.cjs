const assert = require("node:assert/strict");
const vm = require("node:vm");
const { readModule } = require("./runtime.cjs");
const escapedIds = [];
const context = vm.createContext({
  CSS: {
    escape(value) {
      escapedIds.push(value);
      return "escaped-row";
    },
  },
});
for (const name of ["display-time.js", "popup-dom.js", "transcript.js"])
  vm.runInContext(readModule(name), context);
const displayTimestamp = context.WAYPOINTS_TIME_FORMAT.displayTimestamp;
const { navigateSummaries, restoreFocus, bindDialogDismissal } = context.WAYPOINTS_POPUP_DOM;
assert.ok(Object.isFrozen(context.WAYPOINTS_TIME_FORMAT));
assert.ok(Object.isFrozen(context.WAYPOINTS_POPUP_DOM));

for (const [seconds, expected] of [
  [0, "0:00"],
  [-1, "0:00"],
  [0.9, "0:00"],
  [1, "0:01"],
  [59.99, "0:59"],
  [60, "1:00"],
  [90.125, "1:30"],
  [3599.99, "59:59"],
  [3600, "1:00:00"],
  [3661.5, "1:01:01"],
  [86400, "24:00:00"],
])
  assert.equal(displayTimestamp(seconds), expected);
let coercions = 0;
for (const value of [
  undefined,
  null,
  NaN,
  Infinity,
  -Infinity,
  true,
  false,
  "90",
  [],
  [90],
  {
    valueOf() {
      coercions++;
      return 90;
    },
    toString() {
      coercions++;
      return "90";
    },
  },
  Symbol("time"),
  90n,
])
  assert.equal(displayTimestamp(value), "0:00");
assert.equal(coercions, 0);
const formats = context.WAYPOINTS_TRANSCRIPT;
const prepared = formats.prepare(
  { id: "aaaaaaaaaaa", title: "Clock" },
  {
    complete: true,
    duration: 4000,
    segments: [
      { start: 90.125, end: 94.5, text: "Timing" },
      { start: 3661.5, end: 3662.5, text: "Hour" },
    ],
  },
);
assert.ok(formats.output(prepared, "text-timed").text.includes("1:30 · Timing"));
assert.ok(formats.output(prepared, "markdown").text.includes("**1:01:01** · Hour"));
assert.ok(formats.output(prepared, "srt").text.includes("00:01:30,125 --> 00:01:34,500"));
assert.ok(formats.output(prepared, "vtt").text.includes("00:01:30.125 --> 00:01:34.500"));
console.log(
  "PASS: shared display clocks handle boundaries/invalid values without coercion; subtitle milliseconds stay separate",
);

function event(key, extra = {}) {
  return {
    key,
    prevented: 0,
    stopped: 0,
    preventDefault() {
      this.prevented++;
    },
    stopPropagation() {
      this.stopped++;
    },
    ...extra,
  };
}
let focused = null;
function node(name, extra = {}) {
  return {
    name,
    isConnected: true,
    focus() {
      focused = this;
    },
    scrollIntoView(options) {
      this.scrollBlock = options.block;
    },
    ...extra,
  };
}
const headings = [node("first"), node("middle"), node("last")];
for (const [active, key, expected] of [
  [headings[0], "ArrowUp", 0],
  [headings[0], "ArrowDown", 1],
  [headings[1], "ArrowUp", 0],
  [headings[1], "ArrowDown", 2],
  [headings[2], "ArrowDown", 2],
]) {
  const e = event(key);
  assert.equal(navigateSummaries(e, headings, active), true);
  assert.equal(focused, headings[expected]);
  assert.equal(focused.scrollBlock, "nearest");
  assert.equal(e.prevented, 1);
  assert.equal(e.stopped, 1);
}
for (const [key, expected] of [
  ["ArrowDown", 0],
  ["ArrowUp", 2],
]) {
  const e = event(key);
  navigateSummaries(e, headings, node("Close"), { enterFromOutside: true });
  assert.equal(focused, headings[expected]);
  assert.equal(e.prevented, 1);
}
for (const control of [node("range"), node("select"), node("checkbox")]) {
  const e = event("ArrowDown");
  focused = control;
  assert.equal(navigateSummaries(e, headings, control), false);
  assert.equal(focused, control);
  assert.equal(e.prevented, 0);
}
for (const guard of [
  "defaultPrevented",
  "isComposing",
  "ctrlKey",
  "metaKey",
  "altKey",
  "shiftKey",
]) {
  const e = event("ArrowDown", { [guard]: true });
  assert.equal(navigateSummaries(e, headings, headings[0]), false);
  assert.equal(e.prevented, 0);
}
for (const key of ["ArrowLeft", "ArrowRight", "Home", "End", "Tab", "Enter", " "]) {
  const e = event(key);
  assert.equal(navigateSummaries(e, headings, headings[0]), false);
  assert.equal(e.prevented, 0);
}
assert.equal(navigateSummaries(event("ArrowDown"), [], null, { enterFromOutside: true }), false);
const repeated = event("ArrowDown", { repeat: true });
assert.equal(navigateSummaries(repeated, headings, headings[0]), true);
assert.equal(focused, headings[1]);
console.log(
  "PASS: bounded summary navigation preserves edge entry, form-control ownership, repeats and modifier/composition guards",
);

const previousRow = node("old row", { isConnected: false, dataset: { id: "changed-after-open" } });
const replacement = node("replacement row");
const header = node("current header");
let fallbackCalls = 0;
const fallback = () => {
  fallbackCalls++;
  return header;
};
const list = {
  querySelector(selector) {
    assert.equal(selector, '.main[data-id="escaped-row"]');
    return replacement;
  },
};
restoreFocus({ previousFocus: previousRow, rowId: 'original-row"', listEl: list, fallback });
assert.equal(focused, replacement);
assert.equal(escapedIds.at(-1), 'original-row"');
assert.equal(fallbackCalls, 0);
restoreFocus({
  previousFocus: previousRow,
  rowId: "removed",
  listEl: { querySelector: () => null },
  fallback,
});
assert.equal(focused, header);
assert.equal(fallbackCalls, 1);
const control = node("surviving control");
const noLookup = {
  querySelector() {
    throw Error("Non-row controls must not query a bookmark");
  },
};
restoreFocus({ previousFocus: control, listEl: noLookup, fallback });
assert.equal(focused, control);
restoreFocus({
  previousFocus: node("detached control", { isConnected: false }),
  listEl: noLookup,
  fallback,
});
assert.equal(focused, header);
assert.equal(fallbackCalls, 2);
focused = null;
restoreFocus({ previousFocus: null, listEl: noLookup, fallback });
assert.equal(focused, null);
assert.equal(fallbackCalls, 2);
console.log(
  "PASS: focus returns to the current row/control, with live header fallback for missing rows or detached controls",
);

function dialog() {
  return {
    listeners: {},
    addEventListener(type, fn) {
      this.listeners[type] = fn;
    },
    getBoundingClientRect() {
      return { left: 10, right: 110, top: 20, bottom: 120 };
    },
  };
}
const help = dialog();
let closes = 0;
bindDialogDismissal(help, () => closes++);
help.listeners.click({ target: {}, clientX: 0, clientY: 0 });
for (const [clientX, clientY] of [
  [50, 50],
  [10, 20],
  [110, 120],
])
  help.listeners.click({ target: help, clientX, clientY });
assert.equal(closes, 0);
for (const [clientX, clientY] of [
  [9, 50],
  [111, 50],
  [50, 19],
  [50, 121],
])
  help.listeners.click({ target: help, clientX, clientY });
assert.equal(closes, 4);
const cancel = event("Escape");
help.listeners.cancel(cancel);
assert.equal(cancel.prevented, 1);
assert.equal(closes, 5);
const save = dialog();
let saveCloses = 0;
bindDialogDismissal(save, () => saveCloses++, { outsideClick: false });
save.listeners.click?.({ target: save, clientX: 0, clientY: 0 });
assert.equal(saveCloses, 0);
const saveCancel = event("Escape");
save.listeners.cancel(saveCancel);
assert.equal(saveCancel.prevented, 1);
assert.equal(saveCloses, 1);
console.log(
  "PASS: dialog dismissal preserves strict outside bounds and cancel-only file-save behavior",
);
