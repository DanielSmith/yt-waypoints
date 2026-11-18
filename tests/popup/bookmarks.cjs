const assert = require("node:assert/strict");
const vm = require("node:vm");
const { bookmarkSeed } = require("./seeds.cjs");

module.exports = async ({ createPopupFixture }) => {
  const initial = bookmarkSeed();
  const undo = await createPopupFixture(initial);
  await vm.runInContext('bookmarks.deleteVideo("bbbbbbbbbbb")', undo.context);
  assert.equal(undo.els["restore-bookmark"].hidden, false);
  assert.equal(undo.els["search-control"].hidden, true);
  undo.els["settings-toggle"].click();
  assert.equal(undo.els["restore-bookmark"].hidden, true);
  undo.els["settings-toggle"].click();
  assert.equal(undo.els["restore-bookmark"].hidden, false);
  undo.els["restore-bookmark"].click();
  await undo.settle();
  assert.deepEqual(
    undo.data.videos.bbbbbbbbbbb,
    initial.videos.bbbbbbbbbbb,
    "restore exact deleted entry/time, not the active video",
  );
  assert.equal(undo.els["restore-bookmark"].hidden, true);
  assert.equal(undo.els["search-control"].hidden, false);
  await vm.runInContext('bookmarks.deleteVideo("bbbbbbbbbbb");', undo.context);
  await vm.runInContext('bookmarks.deleteVideo("ccccccccccc");', undo.context);
  undo.els["restore-bookmark"].click();
  await undo.settle();
  assert.equal(undo.data.videos.bbbbbbbbbbb, undefined);
  assert.deepEqual(undo.data.videos.ccccccccccc, initial.videos.ccccccccccc);
  await vm.runInContext('bookmarks.deleteVideo("ccccccccccc")', undo.context);
  await vm.runInContext(
    '(async () => { const snapshot = await bookmarks.loadSnapshot(); const { videos } = snapshot; videos.ccccccccccc = { id: "ccccccccccc", title: "Video animation tips", t: 999, updated: 1 }; await bookmarks.saveSnapshot(snapshot); })()',
    undo.context,
  );
  undo.els["restore-bookmark"].click();
  await undo.settle();
  assert.equal(undo.data.videos.ccccccccccc.t, 999, "undo must not overwrite a newly saved entry");
  console.log(
    "PASS: deletion shows restore button, undo preserves original bookmark, latest deletion wins, slash returns to search, settings hide button, newer saves preserved",
  );
  const defaults = await createPopupFixture(initial);
  assert.equal(defaults.els["show-thumbnails"].checked, true, "missing preference defaults to on");
  const thumbs = await createPopupFixture({
    ...initial,
    settings: { ...initial.settings, showThumbnails: false },
  });
  // Use tag-aware traversal for img checks, independent of row markup.
  const collect = (el, tag) =>
    el.children.flatMap((c) => [...(c.tag === tag ? [c] : []), ...collect(c, tag)]);
  assert.equal(collect(defaults.els.list, "img").length, 3, "default setting renders thumbnails");
  assert.equal(collect(thumbs.els.list, "img").length, 0, "explicit off preference is preserved");
  const row = thumbs.els.list.querySelectorAll(".main")[1];
  row.focus();
  thumbs.doc.listeners.keydown({ key: "t", preventDefault() {} });
  await thumbs.settle();
  assert.equal(
    thumbs.els["settings-panel"].hidden,
    true,
    "t toggles without opening Settings or a confirmation",
  );
  assert.equal(thumbs.data.settings.showThumbnails, true);
  assert.equal(thumbs.els["show-thumbnails"].checked, true);
  assert.equal(thumbs.doc.activeElement.dataset.id, row.dataset.id);
  let imgs = collect(thumbs.els.list, "img");
  assert.equal(imgs.length, 3);
  assert.equal(imgs[0].src, "https://i.ytimg.com/vi/aaaaaaaaaaa/mqdefault.jpg");
  assert.equal(imgs[0].referrerPolicy, "no-referrer");
  assert.equal(imgs[0].loading, "lazy");
  imgs[0].events.error();
  assert.equal(imgs[0].hidden, true, "unavailable image hides broken-image icon");
  const writes = thumbs.writes();
  thumbs.doc.listeners.keydown({ key: "t", repeat: true, preventDefault() {} });
  await thumbs.settle();
  assert.equal(thumbs.writes(), writes, "held shortcut toggles only once");
  thumbs.doc.listeners.keydown({
    key: "t",
    ctrlKey: true,
    preventDefault() {
      throw Error("modified t intercepted");
    },
  });
  thumbs.els.search.focus();
  thumbs.doc.listeners.keydown({
    key: "t",
    preventDefault() {
      throw Error("search t intercepted");
    },
  });
  assert.equal(thumbs.data.settings.showThumbnails, true);
  thumbs.els["settings-toggle"].click();
  thumbs.els["show-thumbnails"].checked = false;
  thumbs.els["show-thumbnails"].events.change();
  await thumbs.settle();
  assert.equal(thumbs.data.settings.showThumbnails, false);
  assert.equal(collect(thumbs.els.list, "img").length, 0);
  thumbs.els["show-thumbnails"].checked = true;
  thumbs.els["show-thumbnails"].events.change();
  await thumbs.settle();
  assert.equal(thumbs.data.settings.showThumbnails, true);
  thumbs.els["scrub-seconds"].value = "12";
  thumbs.els["shift-multiplier"].value = "4";
  thumbs.els["scrub-seconds"].events.change();
  await thumbs.settle();
  assert.equal(
    thumbs.data.settings.showThumbnails,
    true,
    "other preference edits preserve thumbnail choice",
  );
  const reopened = await createPopupFixture(thumbs.data);
  assert.equal(reopened.els["show-thumbnails"].checked, true, "preference survives reopening");
  assert.equal(collect(reopened.els.list, "img").length, 3);
  thumbs.els["settings-toggle"].click();
  thumbs.els.search.value = "resolve";
  thumbs.els.search.events.input();
  assert.equal(collect(thumbs.els.list, "img").length, 1, "only matching rows load images");
  const upgraded = await createPopupFixture({
    ...initial,
    settings: { autoBookmark: false, showThumbnails: true, thumbnailNoticeAccepted: true },
  });
  assert.equal(
    upgraded.els["show-thumbnails"].checked,
    true,
    "existing thumbnail preference survives the update",
  );
  assert.equal(collect(upgraded.els.list, "img").length, 3);
  console.log(
    "PASS: direct thumbnail shortcut/checkbox without permissions API; setting persists; typing/modifiers/repeat safe; filtered images/focus/error fallback; upgrade keeps preference",
  );
  const videoId = "dQw4w9WgXcQ";
  const pasted = await createPopupFixture({ settings: { autoBookmark: false } });
  assert.equal(pasted.doc.activeElement, pasted.els["restore-bookmark"]);
  assert.equal(await pasted.paste(`https://youtu.be/${videoId}?si=tracking&t=1m30s`), true);
  assert.deepEqual(pasted.navigation, [
    { type: "update", id: 1, url: `https://www.youtube.com/watch?v=${videoId}&t=90s` },
  ]);
  assert.equal(pasted.els.search.value, "");
  assert.equal(pasted.els["clear-search"].hidden, true);
  assert.equal(pasted.els["search-control"].hidden, false);
  assert.equal(pasted.closed(), 1);
  assert.equal(pasted.writes(), 0, "pasting does not modify bookmarks");
  const bookmark = { id: videoId, title: "Saved", t: 123, duration: 1000, updated: 1 };
  const saved = { settings: { autoBookmark: false }, videos: { [videoId]: bookmark } };
  const tab = { id: 9, windowId: 3, url: `https://www.youtube.com/watch?v=${videoId}` };
  const existingPaste = await createPopupFixture(saved, undefined, { tabs: [tab] });
  await existingPaste.paste(tab.url + "&ignored=invalid");
  assert.deepEqual(existingPaste.navigation, [
    { type: "window", id: 3, focused: true },
    { type: "update", id: 9, active: true },
  ]);
  const timed = await createPopupFixture(saved, undefined, { tabs: [tab] });
  await timed.paste(tab.url + "&t=80");
  assert.equal(timed.navigation[0].url, tab.url + "&t=80s");
  assert.equal(timed.navigation.at(-1).active, true);
  const newTab = await createPopupFixture(saved, "https://example.com/");
  newTab.els["settings-toggle"].click();
  await newTab.paste(tab.url + "&list=playlist&si=tracking");
  assert.deepEqual(newTab.navigation, [{ type: "create", url: tab.url + "&t=123s" }]);
  assert.equal(newTab.els["settings-panel"].hidden, true);
  const queryPaste = await createPopupFixture(initial);
  queryPaste.els.search.focus();
  await queryPaste.paste(tab.url);
  assert.equal(queryPaste.closed(), 1);
  const textPaste = await createPopupFixture(initial);
  textPaste.els.list.querySelectorAll(".main")[0].focus();
  assert.equal(await textPaste.paste("VIDEO"), true);
  assert.equal(textPaste.doc.activeElement, textPaste.els.search);
  assert.deepEqual(
    textPaste.els.list.querySelectorAll(".main").map((r) => r.dataset.id),
    ["bbbbbbbbbbb", "ccccccccccc"],
  );
  assert.equal(textPaste.navigation.length, 0);
  assert.equal(textPaste.closed(), 0);
  assert.equal(
    await textPaste.paste("more text"),
    false,
    "ordinary paste in search uses native text editing",
  );
  const failed = await createPopupFixture({ settings: { autoBookmark: false } }, undefined, {
    failNavigation: true,
  });
  await failed.paste(tab.url);
  assert.equal(failed.closed(), 0);
  assert.equal(failed.els.search.value, tab.url);
  assert.equal(failed.els.status.textContent, "Navigation failed");
  const parsed = (value) =>
    JSON.parse(
      vm.runInContext(
        "JSON.stringify(playerClient.parseVideoLink(" + JSON.stringify(value) + "))",
        pasted.context,
      ),
    );
  for (const link of [
    tab.url,
    `https://youtube.com/watch?v=${videoId}`,
    `www.youtube.com/watch?v=${videoId}`,
    `https://m.youtube.com/shorts/${videoId}`,
    `https://www.youtube.com/live/${videoId}`,
    `https://www.youtube.com/embed/${videoId}`,
  ]) {
    assert.deepEqual(parsed(link), { id: videoId, t: null });
  }
  assert.equal(parsed(tab.url + "&t=1h2m3s").t, 3723);
  assert.equal(parsed(tab.url + "#t=45s").t, 45);
  assert.equal(parsed(`https://www.youtube.com/embed/${videoId}?start=0`).t, 0);
  for (const invalid of [
    "javascript:alert(1)",
    "data:text/html,test",
    "file:///tmp/video",
    `https://www.youtube.com.evil.example/watch?v=${videoId}`,
    `https://youtube.com@evil.example/watch?v=${videoId}`,
    `https://someone@www.youtube.com/watch?v=${videoId}`,
    `https://www.youtube.com:8443/watch?v=${videoId}`,
    `https://www.youtube.com/redirect?q=${encodeURIComponent(tab.url)}`,
    `https://www.youtube.com/channel/${videoId}`,
    tab.url + "&v=aaaaaaaaaaa",
    tab.url + "&t=-1",
    tab.url + "&t=oops",
    tab.url + "&t=999999999999999999999999",
    "https://youtube.com/watch?v=short",
    "https://youtube.com/watch?v=%3Cscript%3E",
    tab.url + " " + tab.url,
  ]) {
    assert.equal(parsed(invalid), null, invalid);
    const bad = await createPopupFixture({ settings: { autoBookmark: false } });
    await bad.paste(invalid);
    assert.equal(bad.navigation.length, 0, invalid);
    assert.equal(bad.writes(), 0);
  }
  console.log(
    "PASS: paste anywhere navigates using canonical YouTube links, honors timestamps/resume points, clears search on success, keeps failed input, text filters normally, unsafe URLs never navigate",
  );
  const channelData = {
    settings: { autoBookmark: false, showThumbnails: false },
    videos: {
      aaaaaaaaaaa: {
        id: "aaaaaaaaaaa",
        title: "The EV push",
        channelName: "Bloomberg",
        channelUrl: "https://www.youtube.com/@Bloomberg",
        t: 30,
        updated: 2,
      },
      bbbbbbbbbbb: {
        id: "bbbbbbbbbbb",
        title: "Bloomberg interview recap",
        channelName: "Tech Talks",
        t: 15,
        updated: 1,
      },
      ccccccccccc: { id: "ccccccccccc", title: "Old bookmark", t: 10, updated: 0 },
    },
  };
  const channels = await createPopupFixture(channelData);
  const urlChannels = await createPopupFixture({
    settings: { autoBookmark: false, showThumbnails: false },
    videos: {
      aaaaaaaaaaa: {
        id: "aaaaaaaaaaa",
        title: "Recursive self-improvement has started",
        channelName: "Bloomberg",
        channelUrl: "https://www.youtube.com/@Business/",
        t: 676,
        duration: 2666,
        updated: 1,
      },
      bbbbbbbbbbb: { id: "bbbbbbbbbbb", title: "Business in a title", t: 0, updated: 0 },
    },
  });
  const searchUrl = (query) => {
    urlChannels.els.search.value = query;
    urlChannels.els.search.events.input();
    return urlChannels.els.list.querySelectorAll(".main").map((row) => row.dataset.id);
  };
  assert.deepEqual(searchUrl("@bUsInEsS"), ["aaaaaaaaaaa"]);
  assert.deepEqual(searchUrl("business"), ["aaaaaaaaaaa", "bbbbbbbbbbb"]);
  assert.deepEqual(searchUrl("Bloomberg"), ["aaaaaaaaaaa"]);
  assert.deepEqual(searchUrl("youtube.com"), [], "Search only the URL's final segment");
  urlChannels.els["include-channel-names"].checked = false;
  urlChannels.els["include-channel-names"].events.change();
  await urlChannels.settle();
  assert.deepEqual(searchUrl("@Business"), []);
  assert.deepEqual(searchUrl("Bloomberg"), []);
  assert.deepEqual(searchUrl("business"), ["bbbbbbbbbbb"], "Title search remains enabled");
  console.log(
    "PASS: channel URL segment and display-name search share the existing toggle; titles remain searchable",
  );
  assert.equal(channels.els["include-channel-names"].checked, true);
  channels.doc.listeners.keydown({ key: "/", preventDefault() {} });
  channels.els.search.value = "bLoOmBeRg";
  channels.els.search.events.input();
  const channelRows = () => channels.els.list.querySelectorAll(".main").map((r) => r.dataset.id);
  assert.deepEqual(
    channelRows(),
    ["aaaaaaaaaaa", "bbbbbbbbbbb"],
    "default search matches channel or title, ignoring case",
  );
  channels.els["settings-toggle"].click();
  channels.els["include-channel-names"].checked = false;
  channels.els["include-channel-names"].events.change();
  await channels.settle();
  assert.deepEqual(channelRows(), ["bbbbbbbbbbb"], "disabling channel search keeps title matches");
  assert.equal(channels.data.settings.includeChannelNames, false);
  channels.els["settings-toggle"].click();
  const channelReopen = await createPopupFixture(channels.data);
  assert.equal(
    channelReopen.els["include-channel-names"].checked,
    false,
    "explicit off preference persists",
  );
  channels.els["settings-toggle"].click();
  channels.els["include-channel-names"].checked = true;
  channels.els["include-channel-names"].events.change();
  await channels.settle();
  assert.deepEqual(channelRows(), ["aaaaaaaaaaa", "bbbbbbbbbbb"]);
  assert.deepEqual(
    channels.data.videos,
    channelData.videos,
    "search preference never edits bookmarks",
  );
  const legacy = {
    settings: { autoBookmark: false },
    videos: {
      aaaaaaaaaaa: {
        id: "aaaaaaaaaaa",
        title: "Original title",
        t: 42,
        duration: 1000,
        updated: 123,
      },
    },
  };
  const metadata = {
    id: "aaaaaaaaaaa",
    title: "Page title",
    t: 900,
    duration: 1000,
    channelName: "Bloomberg",
    channelUrl: "https://www.youtube.com/@Bloomberg",
  };
  const enriched = await createPopupFixture(legacy, undefined, { metadata });
  assert.equal(enriched.data.videos.aaaaaaaaaaa.channelName, "Bloomberg");
  assert.equal(enriched.data.videos.aaaaaaaaaaa.t, 42);
  assert.equal(enriched.data.videos.aaaaaaaaaaa.updated, 123);
  assert.equal(enriched.data.videos.aaaaaaaaaaa.title, "Original title");
  assert.equal(enriched.writes(), 1);
  const present = await createPopupFixture(enriched.data, undefined, { metadata });
  assert.equal(present.writes(), 0);
  const unavailable = await createPopupFixture(enriched.data);
  assert.equal(unavailable.data.videos.aaaaaaaaaaa.channelName, "Bloomberg");
  const wrong = await createPopupFixture(legacy, undefined, {
    metadata: { ...metadata, id: "previous" },
  });
  assert.equal(wrong.data.videos.aaaaaaaaaaa.channelName, undefined);
  assert.equal(wrong.writes(), 0);
  const newBookmark = await createPopupFixture({ settings: { autoBookmark: false } }, undefined, {
    metadata,
  });
  newBookmark.els["restore-bookmark"].click();
  await newBookmark.settle();
  assert.equal(newBookmark.data.videos.aaaaaaaaaaa.channelName, "Bloomberg");
  console.log(
    "PASS: case-insensitive title/channel search, default on, persisted off toggle, missing channel tolerated, channel capture/backfill preserves saved time and recency",
  );
};
