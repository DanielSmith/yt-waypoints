// Extension-side tab access and validated page requests. No bookmark writes or UI.
globalThis.WAYPOINTS_CREATE_PLAYER_CLIENT = ({
  api,
  actions,
  resultSchema,
  legacyFallback,
  watchPattern,
}) => {
  const MAX_PLAYER_ERROR_CHARACTERS = 500;
  const WATCH_RE = watchPattern;
  // Clean link: only video id + time (drops tracking params like si=).
  function linkFor(v) {
    return `https://www.youtube.com/watch?v=${encodeURIComponent(v.id)}&t=${v.t}s`;
  }

  async function activeTab() {
    const [tab] = await api.tabs.query({ active: true, currentWindow: true });
    return tab;
  }

  async function focusTab(tab) {
    await api.windows.update(tab.windowId, { focused: true });
    await api.tabs.update(tab.id, { active: true });
  }

  function videoIdOf(url) {
    try {
      const id = new URL(url).searchParams.get("v");
      return resultSchema.isId(id) ? id : null;
    } catch {
      return null;
    }
  }

  // Parse video links, never navigate to raw clipboard text. Every accepted link
  // is rebuilt by linkFor() on www.youtube.com with just an ID and a timestamp.
  function parseVideoLink(text) {
    let value = text.trim();
    if (/^(?:(?:www\.|m\.)?youtube\.com|youtu\.be)\//i.test(value)) value = "https://" + value;
    let url;
    try {
      url = new URL(value);
    } catch {
      return null;
    }
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    let id;
    const parts = url.pathname.replace(/\/$/, "").split("/").filter(Boolean);
    if (url.hostname === "youtu.be" && parts.length === 1) {
      id = parts[0];
    } else if (["youtube.com", "www.youtube.com", "m.youtube.com"].includes(url.hostname)) {
      if (url.pathname === "/watch" && url.searchParams.getAll("v").length === 1) {
        id = url.searchParams.get("v");
      } else if (parts.length === 2 && ["shorts", "live", "embed"].includes(parts[0])) {
        id = parts[1];
      }
    }
    if (!resultSchema.isId(id)) return null;
    const stamp =
      url.searchParams.get("t") ??
      url.searchParams.get("start") ??
      new URLSearchParams(url.hash.slice(1)).get("t");
    let t = null;
    if (stamp !== null) {
      if (/^\d+$/.test(stamp)) {
        t = Number(stamp);
      } else {
        const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(stamp);
        if (!match || !match.slice(1).some(Boolean)) return null;
        t = Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0);
      }
      if (!Number.isSafeInteger(t)) return null;
    }
    return { id, t };
  }

  // The open tab (any window) that's playing this video, if any.
  function listVideoTabs() {
    return api.tabs.query({ url: "*://*.youtube.com/watch*" });
  }

  async function findVideoTab(id) {
    const tabs = await listVideoTabs();
    return tabs.find((t) => videoIdOf(t.url) === id);
  }

  // Run only in the main frame, then validate the page-derived payload in the
  // extension world. Errors are distinct from the absence of an open video tab.
  function playerError(error) {
    let message =
      typeof error === "string"
        ? error
        : Object.getOwnPropertyDescriptor(error || {}, "message")?.value;
    if (typeof message !== "string") message = "Unknown script failure";
    return (
      message
        .slice(0, MAX_PLAYER_ERROR_CHARACTERS)
        .replace(/[\u0000-\u001f\u007f]/g, " ")
        .trim() || "Unknown script failure"
    );
  }

  async function inPlayer(tabId, operation, args = []) {
    const expectedId =
      operation === "playback"
        ? args[2]
        : ["seek", "seekTo"].includes(operation)
          ? args[1]
          : args[0];
    if (!resultSchema.isId(expectedId))
      return { error: "Invalid video identity. Reload the YouTube tab and try again." };
    try {
      const request = { target: { tabId, frameIds: [0] }, func: actions[operation], args };
      let results;
      if (["playback", "transcript", "chapters"].includes(operation)) {
        try {
          results = await api.scripting.executeScript({ ...request, world: "MAIN" });
        } catch (error) {
          if (
            !legacyFallback ||
            !/world.*(?:MAIN|unsupported|invalid)|(?:unexpected|unsupported).*world/i.test(
              playerError(error),
            )
          )
            throw error;
          results = await api.scripting.executeScript(request);
        }
      } else results = await api.scripting.executeScript(request);
      if (!Array.isArray(results) || results.length !== 1)
        return { error: "Invalid player response: expected one main-frame result." };
      const response = results[0];
      if (!response || Object.getOwnPropertyDescriptor(response, "frameId")?.value !== 0)
        return { error: "Invalid player response: unexpected frame." };
      const failure = Object.getOwnPropertyDescriptor(response, "error");
      if (failure) return { error: `Player script failed: ${playerError(failure.value)}` };
      const payload = Object.getOwnPropertyDescriptor(response, "result");
      if (!payload || !Object.hasOwn(payload, "value") || payload.value == null) {
        return {
          error:
            "The player script returned no result. Wait for the video to load or reload the YouTube tab.",
        };
      }
      return resultSchema.validate(operation, payload.value, expectedId, args);
    } catch (error) {
      return { error: playerError(error) };
    }
  }

  // If the video is already open in some tab, switch to it. Otherwise load it
  // at the saved time.
  async function navigateVideo(v, applyTimestamp = false) {
    const existing = await findVideoTab(v.id);
    if (existing) {
      if (applyTimestamp) await api.tabs.update(existing.id, { url: linkFor(v) });
      await focusTab(existing);
    } else {
      const tab = await activeTab();
      if (tab?.url && WATCH_RE.test(tab.url)) {
        await api.tabs.update(tab.id, { url: linkFor(v) });
      } else {
        await api.tabs.create({ url: linkFor(v) });
      }
    }
  }

  return Object.freeze({
    activeTab,
    focusTab,
    videoIdOf,
    parseVideoLink,
    listVideoTabs,
    findVideoTab,
    inPlayer,
    navigateVideo,
    linkFor,
  });
};
