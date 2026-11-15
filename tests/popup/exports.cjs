const assert = require("node:assert/strict");
const vm = require("node:vm");

module.exports = async ({ createPopupFixture, flavor }) => {
  const scrubber = await createPopupFixture({
    settings: { autoBookmark: false, scrubSeconds: 7, shiftMultiplier: 4 },
    videos: {
      aaaaaaaaaaa: { id: "aaaaaaaaaaa", title: "Saved", t: 100, duration: 1000, updated: 1 },
    },
  });
  scrubber.doc.listeners.keydown({ key: "ArrowRight", preventDefault() {} });
  await scrubber.settle();
  assert.equal(scrubber.data.videos.aaaaaaaaaaa.t, 107);
  scrubber.doc.listeners.keydown({ key: "ArrowLeft", shiftKey: true, preventDefault() {} });
  await scrubber.settle();
  assert.equal(scrubber.data.videos.aaaaaaaaaaa.t, 79);
  for (const key of [">", "<", ".", ","]) {
    scrubber.doc.listeners.keydown({ key, preventDefault() {} });
    await scrubber.settle();
    assert.equal(
      scrubber.data.videos.aaaaaaaaaaa.t,
      79,
      "frame/rate controls never change a closed video resume point",
    );
    assert.match(scrubber.els.status.textContent, /Open this video/);
  }
  console.log("PASS: ordinary popup uses saved arrow scrub distance and Shift multiplier");
  const controlsId = "abcdefghijk";
  const timedTranscript = {
    id: controlsId,
    complete: true,
    source: "youtube-transcript-response",
    language: "English",
    segments: [
      { start: 0, end: 5, text: "First line" },
      { start: 90, end: 95, text: "Second line" },
    ],
    duration: 100,
  };
  let transcriptResult = timedTranscript;
  const controls = await createPopupFixture(
    {
      settings: { autoBookmark: false },
      videos: {
        [controlsId]: { id: controlsId, title: "Saved", t: 100, duration: 1000, updated: 1 },
      },
    },
    "https://example.com/",
    {
      tabs: [{ id: 7, url: `https://www.youtube.com/watch?v=${controlsId}` }],
      executeScript: async (request) => {
        if (request.func.name === "transcript") return [{ result: transcriptResult }];
        assert.equal(request.world, "MAIN");
        return [
          {
            result:
              request.args[0] === "rate"
                ? { id: controlsId, rate: 1.25 }
                : { id: controlsId, t: 101, duration: 1000, paused: true, fps: 60 },
          },
        ];
      },
    },
  );
  const controlKey = async (key, extra = {}) => {
    controls.doc.listeners.keydown({ key, preventDefault() {}, ...extra });
    await controls.settle();
  };
  controls.els.list.querySelectorAll(".main")[0].focus();
  for (const [key, extra, action, direction] of [
    [",", {}, "frame", -1],
    [".", {}, "frame", 1],
    ["<", {}, "rate", -1],
    [">", {}, "rate", 1],
    [",", { shiftKey: true }, "rate", -1],
    [".", { shiftKey: true }, "rate", 1],
  ]) {
    await controlKey(key, extra);
    assert.deepEqual(controls.executions.at(-1), {
      operation: "playback",
      args: [action, direction, controlsId],
      tabId: 7,
    });
  }
  await controlKey("T", { shiftKey: true });
  assert.match(
    controls.clipboardWrites.at(-1),
    /\[1:30\]\(https:\/\/www.youtube.com\/watch\?v=abcdefghijk&t=90s\) · Second line/,
  );
  assert.equal(controls.els["offer-save-file"].checked, false);
  assert.ok(!controls.els["file-save-dialog"].open, "default does not offer a file");
  assert.notEqual(
    controls.data.settings.showThumbnails,
    false,
    "uppercase T must not toggle thumbnails",
  );
  const executionCount = controls.executions.length;
  for (const extra of [{ repeat: true }, { ctrlKey: true }, { metaKey: true }, { altKey: true }])
    await controlKey("T", extra);
  assert.equal(controls.executions.length, executionCount);
  controls.els.search.focus();
  for (const key of ["T", ",", ".", "<", ">"])
    await controlKey(key, {
      preventDefault() {
        throw Error("search intercepted");
      },
    });
  assert.equal(controls.executions.length, executionCount);
  controls.els.list.querySelectorAll(".main")[0].focus();
  await controlKey("h");
  await controlKey("T");
  assert.equal(controls.executions.length, executionCount);
  await controlKey("h");
  const transcriptCopies = controls.clipboardWrites.length;
  for (const result of [{ error: "No transcript available." }, { text: "" }, null]) {
    transcriptResult = result;
    await controlKey("T");
    assert.equal(
      controls.clipboardWrites.length,
      transcriptCopies,
      "unavailable transcript preserves clipboard",
    );
    assert.match(controls.els.status.textContent, /transcript/);
  }
  scrubber.doc.listeners.keydown({ key: "T", preventDefault() {} });
  await scrubber.settle();
  assert.match(scrubber.els.status.textContent, /Open this video/);
  assert.equal(scrubber.clipboardWrites.length, 0);
  console.log(
    "PASS: frame/speed shortcut routing, open-tab requirement, uppercase transcript copy, repeats/modifiers/search/help guards",
  );
  for (const [result, message] of [
    [{ error: new Error("Permission denied to page method") }, "Permission denied to page method"],
    [{}, "returned no result"],
  ]) {
    const failure = await createPopupFixture(
      { settings: { autoBookmark: false } },
      "https://example.com/",
      {
        executeScript: async () => [result],
      },
    );
    const response = await vm.runInContext(
      'playerClient.inPlayer(7,"playback",["frame",1,"abcdefghijk"])',
      failure.context,
    );
    assert.ok(
      response.error.includes(message),
      "injection failures must retain an actionable reason",
    );
  }
  let worldAttempts = [];
  const compatibility = await createPopupFixture(
    { settings: { autoBookmark: false } },
    "https://example.com/",
    {
      executeScript: async (request) => {
        worldAttempts.push(request.world);
        if (request.world === "MAIN")
          throw Error("Invalid value MAIN for world: unsupported world");
        return [{ result: { id: request.args[2], rate: 1.25 } }];
      },
    },
  );
  const compatibilityResult = await vm.runInContext(
    'playerClient.inPlayer(7,"playback",["rate",1,"abcdefghijk"])',
    compatibility.context,
  );
  if (flavor === "firefox") {
    assert.equal(compatibilityResult.rate, 1.25);
    assert.deepEqual(worldAttempts, ["MAIN", undefined]);
  } else {
    assert.match(compatibilityResult.error, /Invalid value/);
    assert.deepEqual(worldAttempts, ["MAIN"]);
  }

  transcriptResult = timedTranscript;
  controls.els["settings-toggle"].click();
  assert.match(controls.els["transcript-target"].textContent, /Saved/);
  controls.els["transcript-format-toggle"].click();
  assert.equal(controls.els["transcript-format-menu"].hidden, false);
  const choices = controls.els["transcript-format-list"].children;
  assert.equal(choices.length, 7);
  const currentLabel = controls.els["transcript-format-toggle"].textContent;
  choices[4].events.mouseenter();
  assert.match(controls.els["transcript-format-use"].textContent, /Subtitle editors/);
  assert.equal(
    controls.els["transcript-format-toggle"].textContent,
    currentLabel,
    "hover previews without committing",
  );
  await controlKey("Escape");
  assert.equal(controls.els["transcript-format-menu"].hidden, true);
  assert.equal(controls.doc.activeElement, controls.els["transcript-format-toggle"]);
  controls.els["transcript-format-toggle"].click();
  await controlKey("End");
  assert.match(controls.els["transcript-format-use"].textContent, /Scripts/);
  await controlKey("Enter");
  assert.equal(controls.data.settings.transcriptFormat, "json");
  assert.equal(controls.els["transcript-format-menu"].hidden, true);
  controls.els["copy-transcript"].click();
  await controls.settle();
  assert.equal(JSON.parse(controls.clipboardWrites.at(-1)).segments[1].end, 95);
  controls.els["offer-save-file"].checked = true;
  controls.els["offer-save-file"].events.change();
  await controls.settle();
  assert.equal(controls.data.settings.offerSaveFile, true);
  controls.els["copy-transcript"].click();
  await controls.settle();
  assert.equal(controls.els["file-save-dialog"].open, true);
  assert.equal(controls.downloads.length, 0, "offering never downloads automatically");
  assert.equal(controls.els["file-name-fields"].hidden, true);
  const beforeSaveCopy = controls.clipboardWrites.at(-1);
  controls.els["file-save-confirm"].click();
  assert.equal(controls.doc.activeElement, controls.els["file-save-name"]);
  controls.els["file-save-name"].value = "../bad";
  controls.els["file-save-confirm"].click();
  assert.equal(controls.downloads.length, 0);
  assert.match(controls.els["file-save-error"].textContent, /filename/);
  controls.els["file-save-name"].value = "my-transcript";
  controls.els["file-save-confirm"].click();
  assert.equal(controls.downloads.at(-1).filename, "my-transcript.json");
  assert.equal(controls.clipboardWrites.at(-1), beforeSaveCopy, "saving never replaces clipboard");
  const jsonFile = await (await fetch(controls.downloads.at(-1).href)).text();
  assert.equal(JSON.parse(jsonFile).video.id, controlsId);
  assert.equal(controls.els["file-save-dialog"].open, false);
  controls.els["copy-videos"].click();
  await controls.settle();
  const allVideosCopy = controls.clipboardWrites.at(-1);
  assert.equal(JSON.parse(allVideosCopy).format, "yt-waypoints");
  assert.equal(
    controls.els["file-save-dialog"].open,
    true,
    "global JSON uses the same offer toggle",
  );
  assert.match(controls.els["file-save-name"].value, /^yt-waypoints-bookmarks-.*\.json$/);
  controls.els["file-save-cancel"].click();
  assert.equal(controls.clipboardWrites.at(-1), allVideosCopy);
  assert.equal(controls.downloads.length, 1);
  controls.els["copy-videos"].click();
  await controls.settle();
  controls.els["file-save-confirm"].click();
  controls.els["file-save-name"].value = "all-videos.json";
  controls.els["file-save-confirm"].click();
  const savedBookmarks = await (await fetch(controls.downloads.at(-1).href)).text();
  assert.equal(
    savedBookmarks,
    controls.clipboardWrites.at(-1),
    "saved global JSON exactly matches clipboard",
  );
  controls.els["copy-videos"].click();
  await controls.settle();
  const duringPrompt = controls.clipboardWrites.length;
  await controlKey("C");
  await controlKey("t");
  assert.equal(
    controls.clipboardWrites.length,
    duringPrompt,
    "save dialog blocks background shortcuts",
  );
  await controls.paste("{bad");
  assert.equal(controls.clipboardWrites.length, duringPrompt);
  await controlKey("Escape");
  assert.equal(controls.els["file-save-dialog"].open, false);
  controls.els["copy-videos"].click();
  await controls.settle();
  const failedSaveCopy = controls.clipboardWrites.at(-1);
  controls.els["file-save-confirm"].click();
  controls.context.Blob = class {
    constructor() {
      throw Error("Download unavailable");
    }
  };
  controls.els["file-save-confirm"].click();
  assert.equal(controls.els["file-save-dialog"].open, true);
  assert.match(controls.els["file-save-error"].textContent, /clipboard copy is unchanged/);
  assert.equal(controls.clipboardWrites.at(-1), failedSaveCopy);
  controls.context.Blob = Blob;
  controls.els["file-save-cancel"].click();
  controls.els["settings-toggle"].click();
  controls.els.list.querySelectorAll(".main")[0].focus();
  await controlKey("c");
  assert.equal(
    controls.els["file-save-dialog"].open,
    false,
    "single-row copy is outside the global JSON offer",
  );
  await controlKey("C");
  assert.equal(
    controls.els["file-save-dialog"].open,
    true,
    "uppercase C offers the all-bookmark file",
  );
  controls.els["file-save-cancel"].click();
  controls.els["settings-toggle"].click();
  controls.els["offer-save-file"].checked = false;
  controls.els["offer-save-file"].events.change();
  await controls.settle();
  controls.els["copy-videos"].click();
  await controls.settle();
  assert.equal(
    controls.els["file-save-dialog"].open,
    false,
    "turning the shared setting off suppresses JSON offers",
  );
  controls.els["copy-transcript"].click();
  await controls.settle();
  assert.equal(
    controls.els["file-save-dialog"].open,
    false,
    "turning the shared setting off suppresses transcript offers",
  );
  controls.els["offer-save-file"].checked = true;
  controls.els["offer-save-file"].events.change();
  await controls.settle();
  const reopenedFormats = await createPopupFixture(controls.data, "https://example.com/");
  assert.equal(
    reopenedFormats.els["transcript-format-toggle"].textContent,
    "JSON with timed segments",
  );
  assert.equal(reopenedFormats.els["offer-save-file"].checked, true);
  const invalidFormat = await createPopupFixture(
    { settings: { autoBookmark: false, transcriptFormat: "bad" } },
    "https://example.com/",
  );
  assert.equal(
    invalidFormat.els["transcript-format-toggle"].textContent,
    "Markdown with linked timestamps",
  );
  invalidFormat.els["settings-toggle"].click();
  assert.equal(invalidFormat.els["copy-transcript"].disabled, true);
  const failedClipboard = await createPopupFixture(
    {
      settings: { autoBookmark: false, offerSaveFile: true },
      videos: { [controlsId]: { id: controlsId, title: "Saved", t: 0 } },
    },
    "https://example.com/",
    {
      tabs: [{ id: 7, url: `https://www.youtube.com/watch?v=${controlsId}` }],
      failClipboard: true,
      failLegacyClipboard: true,
      executeScript: async () => [{ result: timedTranscript }],
    },
  );
  failedClipboard.els["copy-videos"].click();
  await failedClipboard.settle();
  assert.ok(!failedClipboard.els["file-save-dialog"].open);
  assert.match(failedClipboard.els.status.textContent, /Could not copy JSON/);
  failedClipboard.els.list.querySelectorAll(".main")[0].focus();
  failedClipboard.doc.listeners.keydown({ key: "T", preventDefault() {} });
  await failedClipboard.settle();
  assert.ok(!failedClipboard.els["file-save-dialog"].open);
  assert.match(failedClipboard.els.status.textContent, /Could not copy transcript/);
  const saveFiles = await createPopupFixture(
    {
      settings: { autoBookmark: false, offerSaveFile: true },
      videos: { [controlsId]: { id: controlsId, title: "Save lifecycle", t: 0 } },
    },
    "https://example.com/",
  );
  const createdUrls = [];
  const revokedUrls = [];
  const urlTimers = [];
  saveFiles.context.URL = class extends URL {
    static createObjectURL(blob) {
      const url = URL.createObjectURL(blob);
      createdUrls.push(url);
      return url;
    }
    static revokeObjectURL(url) {
      revokedUrls.push(url);
      URL.revokeObjectURL(url);
    }
  };
  saveFiles.context.setTimeout = (fn, delay) => urlTimers.push({ fn, delay });
  let releaseCopy;
  const copyGate = new Promise((resolve) => (releaseCopy = resolve));
  const clipboardWrite = saveFiles.context.navigator.clipboard.writeText;
  saveFiles.context.navigator.clipboard.writeText = async (text) => {
    await copyGate;
    return clipboardWrite(text);
  };
  const copying = vm.runInContext("exportsController.copyVideos()", saveFiles.context);
  await saveFiles.settle();
  assert.equal(
    saveFiles.els["file-save-dialog"].open,
    undefined,
    "no prompt before clipboard resolves",
  );
  assert.equal(createdUrls.length, 0);
  releaseCopy();
  await copying;
  saveFiles.context.navigator.clipboard.writeText = clipboardWrite;
  assert.equal(saveFiles.els["file-save-dialog"].open, true);
  const copiedOutput = saveFiles.clipboardWrites.at(-1);
  saveFiles.els["file-save-confirm"].click();
  for (const invalidName of [
    "",
    " ",
    ".",
    "..",
    "../bad",
    "folder\\bad",
    "bad:name",
    "bad\u0000name",
  ]) {
    saveFiles.els["file-save-name"].value = invalidName;
    saveFiles.els["file-save-confirm"].click();
    assert.equal(saveFiles.doc.activeElement, saveFiles.els["file-save-name"]);
    assert.match(saveFiles.els["file-save-error"].textContent, /filename/);
    assert.equal(createdUrls.length, 0, "invalid filenames allocate no download resources");
  }
  saveFiles.els["file-save-name"].value = "  Backup.JSON  ";
  saveFiles.els["file-save-name"].events.keydown({
    key: "Enter",
    repeat: true,
    preventDefault() {},
  });
  assert.equal(createdUrls.length, 0, "held Enter cannot request a download");
  saveFiles.els["file-save-name"].events.keydown({
    key: "Enter",
    repeat: false,
    preventDefault() {},
  });
  assert.equal(saveFiles.downloads.at(-1).filename, "Backup.JSON");
  const savedResponse = await fetch(createdUrls[0]);
  assert.equal(savedResponse.headers.get("content-type"), "application/json;charset=utf-8");
  assert.equal(await savedResponse.text(), copiedOutput);
  assert.equal(urlTimers[0].delay, 30000);
  assert.deepEqual(revokedUrls, [], "download URL survives until the cleanup delay");
  urlTimers[0].fn();
  assert.deepEqual(revokedUrls, [createdUrls[0]]);
  await assert.rejects(fetch(createdUrls[0]), "cleanup releases the real Blob URL");
  assert.equal(
    saveFiles.doc.body.children.some((el) => el.tag === "a"),
    false,
  );

  const createElement = saveFiles.doc.createElement;
  const append = saveFiles.doc.body.append;
  for (const stage of ["create", "append", "click"]) {
    await vm.runInContext("exportsController.copyVideos()", saveFiles.context);
    saveFiles.els["file-save-confirm"].click();
    saveFiles.doc.createElement = (tag) => {
      if (tag === "a" && stage === "create") throw Error("Anchor creation failed");
      const element = createElement(tag);
      if (tag === "a" && stage === "click")
        element.click = () => {
          throw Error("Click failed");
        };
      return element;
    };
    saveFiles.doc.body.append = function (...elements) {
      if (stage === "append" && elements.some((el) => el.tag === "a")) throw Error("Append failed");
      return append.apply(this, elements);
    };
    const before = createdUrls.length;
    saveFiles.els["file-save-confirm"].click();
    assert.equal(createdUrls.length, before + 1);
    assert.equal(saveFiles.els["file-save-dialog"].open, true, "failed download remains retryable");
    assert.match(saveFiles.els["file-save-error"].textContent, /clipboard copy is unchanged/);
    assert.equal(saveFiles.clipboardWrites.at(-1), copiedOutput);
    assert.equal(
      saveFiles.doc.body.children.some((el) => el.tag === "a"),
      false,
    );
    assert.equal(urlTimers.at(-1).delay, 30000);
    urlTimers.at(-1).fn();
    assert.equal(revokedUrls.at(-1), createdUrls.at(-1));
    saveFiles.doc.createElement = createElement;
    saveFiles.doc.body.append = append;
    if (stage === "click") {
      saveFiles.els["file-save-confirm"].click();
      assert.equal(
        saveFiles.els["file-save-dialog"].open,
        false,
        "retry succeeds with the retained output",
      );
      assert.equal(await (await fetch(createdUrls.at(-1))).text(), copiedOutput);
      urlTimers.at(-1).fn();
    } else saveFiles.els["file-save-cancel"].click();
    // Closing clears the output; a stale confirm cannot allocate another URL.
    const afterClose = createdUrls.length;
    saveFiles.els["file-save-confirm"].click();
    assert.equal(createdUrls.length, afterClose);
  }
  console.log(
    "PASS: extracted file-save owner waits for clipboard, validates names/Enter and releases real Blob URLs after success or anchor construction/append/click failures",
  );

  for (const timer of controls.timers) timer();
  console.log(
    "PASS: default linked Markdown, dropdown hover/focus, keyboard commit/Escape, persistent preferences, transcript/global JSON clipboard-first offers, filename validation, downloads and cancellation",
  );
};
