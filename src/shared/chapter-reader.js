// Self-contained: executeScript serializes this reader into the YouTube page.
// Only read chapter models already loaded for the requested watch video.
globalThis.WAYPOINTS_READ_CHAPTERS = function chapters(expectedId) {
  try {
    const fail = (message) => {
      throw new Error(message);
    };
    const pageObject = (value) => value?.wrappedJSObject || value;
    const page = pageObject(globalThis);
    const watch = document.querySelector("ytd-watch-flexy:not([hidden])");
    const matches = () =>
      new URLSearchParams(location.search).get("v") === expectedId &&
      document.querySelector("ytd-watch-flexy:not([hidden])") === watch &&
      watch?.getAttribute("video-id") === expectedId;
    if (!matches())
      fail("The video is still changing. Wait for it to load before reading chapters.");
    if (document.querySelector(".html5-video-player.ad-showing"))
      fail("Wait for the YouTube ad to finish before reading chapters.");
    const video = document.querySelector("video");
    if (!video || !Number.isFinite(video.duration) || video.duration <= 0)
      fail("The video's duration is not ready for chapters.");
    const duration = Math.floor(video.duration);
    const text = (value) => {
      let result = typeof value === "string" ? value : (value?.simpleText ?? value?.content);
      if (result === undefined && Array.isArray(value?.runs) && value.runs.length <= 100) {
        result = value.runs
          .map((run) =>
            typeof run?.text === "string" && run.text.length <= 1000
              ? run.text
              : fail("Invalid chapter title."),
          )
          .join("");
      }
      if (typeof result !== "string" || result.length > 1000) fail("Invalid chapter title.");
      result = result
        .replace(/[\u0000-\u001f\u007f]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (!result) fail("Missing chapter title.");
      return result;
    };
    const number = (value, millis = false) => {
      if (typeof value === "string" && /^\d+(?:\.\d{1,3})?$/.test(value)) value = Number(value);
      if (
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        value < 0 ||
        (millis && !Number.isSafeInteger(value))
      )
        fail("Invalid chapter timestamp.");
      const t = millis ? value / 1000 : value;
      if (t >= duration || Math.abs(t * 1000 - Math.round(t * 1000)) > 0.000001)
        fail("Chapter timestamp is outside the video.");
      return t;
    };
    const list = (items, read, continuations) => {
      if (continuations != null && (!Array.isArray(continuations) || continuations.length))
        fail("Chapter list is still loading.");
      if (!Array.isArray(items) || !items.length || items.length > 1000)
        fail("Invalid chapter list.");
      let previous = -1;
      return Array.from(items, (item) => {
        const chapter = read(item);
        if (chapter.t <= previous) fail("Chapter timestamps are not strictly ordered.");
        previous = chapter.t;
        return chapter;
      });
    };
    const ownId = (root) =>
      root?.currentVideoEndpoint?.watchEndpoint?.videoId ||
      root?.contents?.twoColumnWatchNextResults?.currentVideoEndpoint?.watchEndpoint?.videoId;
    const candidates = [];
    const roots = [pageObject(watch)?.data, page.ytInitialData];
    for (let root of roots) {
      root = pageObject(root);
      if (!root || typeof root !== "object") continue;
      const rootId = ownId(root);
      if (rootId && rootId !== expectedId) continue;
      const overlay = root.playerOverlays?.playerOverlayRenderer;
      const decorated = overlay?.decoratedPlayerBarRenderer;
      const bar =
        decorated?.decoratedPlayerBarRenderer?.playerBar?.chapteredPlayerBarRenderer ||
        decorated?.playerBar?.chapteredPlayerBarRenderer;
      // Bar entries don't carry video IDs, so require a video-bound root.
      if (rootId === expectedId && bar?.chapters !== undefined) {
        candidates.push(() =>
          list(
            bar.chapters,
            (item) => ({
              t: number(item?.chapterRenderer?.timeRangeStartMillis, true),
              title: text(item?.chapterRenderer?.title),
            }),
            bar.continuations,
          ),
        );
      }
      const panels = root.engagementPanels;
      if (!Array.isArray(panels)) continue;
      if (panels.length > 100) fail("Too many chapter panels.");
      for (const entry of panels) {
        const panel = entry?.engagementPanelSectionListRenderer;
        if (
          typeof panel?.targetId !== "string" ||
          !/^engagement-panel-macro-markers-[a-z-]*chapters$/.test(panel.targetId)
        )
          continue;
        const contents = panel.content?.macroMarkersListRenderer?.contents;
        if (contents === undefined) continue;
        candidates.push(() =>
          list(
            contents,
            (item) => {
              const marker =
                item?.macroMarkersListItemRenderer || item?.macroMarkersPanelItemViewModel;
              const endpoint =
                marker?.onTap?.watchEndpoint || marker?.onTap?.innertubeCommand?.watchEndpoint;
              if (endpoint?.videoId && endpoint.videoId !== expectedId)
                fail("Chapter belongs to another video.");
              if (rootId !== expectedId && endpoint?.videoId !== expectedId)
                fail("Chapter video identity is unavailable.");
              let t;
              if (endpoint?.startTimeSeconds !== undefined) t = number(endpoint.startTimeSeconds);
              else {
                const stamp = text(marker?.timeDescription);
                if (!/^\d+:\d{2}(?::\d{2})?$/.test(stamp))
                  fail("Invalid chapter time description.");
                const parts = stamp.split(":").map(Number);
                if (parts.slice(1).some((part) => part > 59))
                  fail("Invalid chapter time description.");
                t = number(parts.reduce((total, part) => total * 60 + part, 0));
              }
              return { t, title: text(marker?.title) };
            },
            panel.content.macroMarkersListRenderer.continuations,
          ),
        );
      }
    }
    // Pick one independently validated complete model, never a mix of partial
    // rows. A loading/unsupported bar can coexist with a usable chapter panel.
    let chapters = [],
      available = false,
      failure = null;
    for (const candidate of candidates) {
      try {
        chapters = candidate();
        available = true;
        break;
      } catch (error) {
        failure = error;
      }
    }
    if (candidates.length && !available) throw failure;
    if (
      !matches() ||
      document.querySelector("video") !== video ||
      Math.floor(video.duration) !== duration
    )
      fail("The video changed while reading chapters.");
    return { id: expectedId, duration, available, chapters };
  } catch (error) {
    return { error: String(error?.message || "Chapters are unavailable.").slice(0, 500) };
  }
};
