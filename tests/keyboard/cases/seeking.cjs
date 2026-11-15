// Executed in the actual popup bundle scope; helpers are explicit test ports.
module.exports = async function seekingCases({ cases, check, reset, press, position }) {
  for (const [key, shiftKey, expected] of [
    ["ArrowRight", false, 107],
    ["ArrowLeft", false, 93],
    ["ArrowRight", true, 128],
    ["ArrowLeft", true, 72],
  ]) {
    await reset();
    const event = await press(document.querySelector(".bar"), key, { shiftKey });
    check(
      keyboardFixture.operations.length === 1 &&
        keyboardFixture.operations[0].operation === "seekTo",
      "Duplicate/wrong slider seek: " + JSON.stringify(keyboardFixture.operations),
    );
    check((await position()) === expected, "Wrong slider position");
    check(event.defaultPrevented, "Native range action was not cancelled");
    check(
      document.activeElement === document.querySelector(".bar"),
      "Slider lost focus after render",
    );
    await press(document.activeElement, key, { shiftKey, repeat: true });
    check(
      keyboardFixture.operations.length === 2 &&
        keyboardFixture.operations.every((op) => op.operation === "seekTo"),
      "Repeat changed key ownership",
    );
    cases.push(key + (shiftKey ? " + Shift" : "") + ", repeat and focus");
  }
  for (const extra of [
    { ctrlKey: true },
    { altKey: true },
    { metaKey: true },
    { isComposing: true },
  ]) {
    await reset();
    const event = await press(document.querySelector(".bar"), "ArrowRight", extra);
    check(
      !event.defaultPrevented &&
        keyboardFixture.operations.length === 0 &&
        (await position()) === 100,
      "Modified/composition key was intercepted",
    );
    cases.push("Native key preserved: " + Object.keys(extra)[0]);
  }
  for (const [start, key, expected, count] of [
    [5, "ArrowLeft", 0, 1],
    [995, "ArrowRight", 1000, 1],
    [0, "ArrowLeft", 0, 0],
    [1000, "ArrowRight", 1000, 0],
  ]) {
    await reset(start);
    await press(document.querySelector(".bar"), key);
    check(
      (await position()) === expected && keyboardFixture.operations.length === count,
      "Range boundary/unchanged position failed",
    );
    cases.push("Bounded " + key + " at " + start);
  }
  await reset();
  keyboardFixture.open = false;
  await press(document.querySelector(".bar"), "ArrowRight");
  check(
    (await position()) === 107 && keyboardFixture.operations.length === 0,
    "Closed video should update once without injection",
  );
  cases.push("Closed-video slider");
  keyboardFixture.open = true;
  await reset();
  await press(document.querySelector(".main"), "ArrowRight");
  check(
    keyboardFixture.operations.length === 1 &&
      keyboardFixture.operations[0].operation === "seek" &&
      (await position()) === 707,
    "Row-relative scrub changed",
  );
  cases.push("Row-relative arrow");
  await reset();
  const searchEvent = await press(document.getElementById("search"), "ArrowRight");
  check(
    !searchEvent.defaultPrevented && keyboardFixture.operations.length === 0,
    "Search arrow intercepted",
  );
  cases.push("Native search arrow");
};
