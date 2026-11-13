// Named, self-contained functions: executeScript serializes each into the page.
// The popup uses these operations to read or control the YouTube player.
globalThis.WAYPOINTS_PLAYER_ACTIONS = {
  bookmark: globalThis.WAYPOINTS_READ_METADATA,
  chapters: globalThis.WAYPOINTS_READ_CHAPTERS,
  position: (expectedId) => {
    const id = new URLSearchParams(location.search).get("v");
    if (id !== expectedId)
      return { error: "This tab changed videos. Try again on the current video." };
    const watch = document.querySelector("ytd-watch-flexy:not([hidden])");
    if (watch?.getAttribute("video-id") && watch.getAttribute("video-id") !== id)
      return { error: "The video is still changing. Wait for it to load." };
    if (document.querySelector(".html5-video-player.ad-showing"))
      return { error: "Wait for the YouTube ad to finish before using markers." };
    const video = document.querySelector("video");
    if (
      !video ||
      !Number.isFinite(video.currentTime) ||
      !Number.isFinite(video.duration) ||
      video.duration <= 0
    )
      return { error: "The video's duration is not ready. Wait for it to load." };
    return {
      id,
      t: Math.floor(video.currentTime),
      duration: Math.floor(video.duration),
      paused: video.paused,
    };
  },
  seek: (delta, expectedId) => {
    const id = new URLSearchParams(location.search).get("v");
    if (id !== expectedId)
      return { error: "This tab changed videos. Select the current video and try again." };
    const watch = document.querySelector("ytd-watch-flexy:not([hidden])");
    if (watch?.getAttribute("video-id") && watch.getAttribute("video-id") !== id)
      return { error: "The video is still changing. Wait for it to load and try again." };
    const el = document.querySelector("video");
    if (
      !el ||
      !Number.isFinite(el.duration) ||
      el.duration <= 0 ||
      !Number.isFinite(el.currentTime) ||
      !Number.isFinite(delta)
    )
      return null;
    if (document.querySelector(".html5-video-player.ad-showing")) return null;
    el.currentTime = Math.min(el.duration, Math.max(0, el.currentTime + delta));
    return {
      id,
      t: Math.floor(el.currentTime),
      duration: Math.floor(el.duration),
      paused: el.paused,
    };
  },
  seekTo: (time, expectedId) => {
    const id = new URLSearchParams(location.search).get("v");
    if (id !== expectedId)
      return { error: "This tab changed videos. Select the current video and try again." };
    const watch = document.querySelector("ytd-watch-flexy:not([hidden])");
    if (watch?.getAttribute("video-id") && watch.getAttribute("video-id") !== id)
      return { error: "The video is still changing. Wait for it to load and try again." };
    const el = document.querySelector("video");
    if (!el || !Number.isFinite(el.duration) || el.duration <= 0 || !Number.isFinite(time))
      return null;
    if (document.querySelector(".html5-video-player.ad-showing")) return null;
    el.currentTime = Math.min(el.duration, Math.max(0, time));
    return {
      id,
      t: Math.floor(el.currentTime),
      duration: Math.floor(el.duration),
      paused: el.paused,
    };
  },
  toggle: (expectedId) => {
    const id = new URLSearchParams(location.search).get("v");
    if (id !== expectedId)
      return { error: "This tab changed videos. Select the current video and try again." };
    const watch = document.querySelector("ytd-watch-flexy:not([hidden])");
    if (watch?.getAttribute("video-id") && watch.getAttribute("video-id") !== id)
      return { error: "The video is still changing. Wait for it to load and try again." };
    const el = document.querySelector("video");
    if (
      !el ||
      !Number.isFinite(el.currentTime) ||
      document.querySelector(".html5-video-player.ad-showing")
    )
      return null;
    if (el.paused) el.play().catch(() => {});
    else el.pause();
    return {
      id,
      t: Math.floor(el.currentTime),
      duration: Number.isFinite(el.duration) ? Math.floor(el.duration) : 0,
      paused: el.paused,
    };
  },
  // YouTube exposes frame rate and supported speeds on its page player.
  playback: (operation, direction, expectedId) => {
    const MAX_FRAME_RATE = 240;
    const RATE_STEPS_PER_UNIT = 4;
    const RATE_COMPARISON_EPSILON = 0.001;
    const FALLBACK_MAX_RATE = 2;
    try {
      const id = new URLSearchParams(location.search).get("v");
      if (id !== expectedId)
        return { error: "This tab changed videos. Select the current video and try again." };
      const watch = document.querySelector("ytd-watch-flexy:not([hidden])");
      if (watch?.getAttribute("video-id") && watch.getAttribute("video-id") !== id)
        return { error: "The video is still changing. Wait for it to load and try again." };
      const el =
        document.querySelector("#movie_player video") ||
        document.querySelector("video.html5-main-video") ||
        document.querySelector("video");
      if (!el)
        return {
          error: "No video player found in this tab. Reload the YouTube tab and try again.",
        };
      if (!Number.isFinite(el.duration) || el.duration <= 0)
        return { error: "The video's duration is not ready. Wait for it to load and try again." };
      if (document.querySelector(".html5-video-player.ad-showing"))
        return { error: "Wait for the YouTube ad to finish before controlling this video." };
      const playerEl = document.getElementById("movie_player");
      // Only Firefox <128 uses the isolated-world fallback. Avoid invoking array
      // methods from page objects with extension callbacks across that boundary.
      let player = playerEl;
      try {
        player = playerEl?.wrappedJSObject || playerEl;
      } catch {
        /* MAIN world needs no wrapper. */
      }
      const readPlayer = (method) => {
        try {
          return typeof player?.[method] === "function" ? player[method]() : null;
        } catch {
          return null;
        }
      };
      if (operation === "frame") {
        if (!Number.isFinite(el.currentTime))
          return {
            error: "The playback position is not ready. Wait for it to load and try again.",
          };
        let stats = readPlayer("getVideoStats");
        if (typeof stats === "string") {
          try {
            stats = JSON.parse(stats);
          } catch {
            stats = null;
          }
        }
        let response = readPlayer("getPlayerResponse");
        if (!response && globalThis.ytInitialPlayerResponse?.videoDetails?.videoId === expectedId)
          response = globalThis.ytInitialPlayerResponse;
        const itag = Number.parseInt(stats?.fmt, 10);
        let formatFps = null;
        const matchingRates = new Set();
        for (const formats of [
          response?.streamingData?.adaptiveFormats,
          response?.streamingData?.formats,
        ]) {
          if (!formats || !Number.isInteger(formats.length)) continue;
          for (let i = 0; i < formats.length; i++) {
            const format = formats[i];
            if (!Number.isFinite(format?.fps) || format.fps <= 0) continue;
            if (Number(format.itag) === itag) formatFps = format.fps;
            if (
              el.videoWidth > 0 &&
              el.videoHeight > 0 &&
              format.width === el.videoWidth &&
              format.height === el.videoHeight
            )
              matchingRates.add(format.fps);
          }
        }
        const fps = Number(
          stats?.fps ??
            formatFps ??
            readPlayer("getVideoData")?.fps ??
            (matchingRates.size === 1 ? [...matchingRates][0] : null),
        );
        if (!Number.isFinite(fps) || fps <= 0 || fps > MAX_FRAME_RATE) {
          return { error: "Could not read this video's frame rate." };
        }
        if (!el.paused) el.pause();
        el.currentTime = Math.min(el.duration, Math.max(0, el.currentTime + direction / fps));
        return {
          id,
          t: Math.floor(el.currentTime),
          duration: Math.floor(el.duration),
          paused: true,
          fps,
        };
      }
      if (operation !== "rate") return { error: "Unknown playback action." };
      const rates = readPlayer("getAvailablePlaybackRates");
      const choices = [];
      if (rates && Number.isInteger(rates.length)) {
        for (let i = 0; i < rates.length; i++) {
          const rate = rates[i];
          if (
            Number.isFinite(rate) &&
            rate > 0 &&
            (direction > 0
              ? rate > el.playbackRate + RATE_COMPARISON_EPSILON
              : rate < el.playbackRate - RATE_COMPARISON_EPSILON)
          )
            choices.push(rate);
        }
      } else {
        // HTMLMediaElement remains usable when YouTube hides its private API.
        // Standard shortcuts use quarter-speed steps; retain a higher current
        // speed without assuming that a premium speed is available to everyone.
        const next =
          direction > 0
            ? (Math.floor(el.playbackRate * RATE_STEPS_PER_UNIT + RATE_COMPARISON_EPSILON) + 1) /
              RATE_STEPS_PER_UNIT
            : (Math.ceil(el.playbackRate * RATE_STEPS_PER_UNIT - RATE_COMPARISON_EPSILON) - 1) /
              RATE_STEPS_PER_UNIT;
        choices.push(
          Math.min(
            Math.max(FALLBACK_MAX_RATE, el.playbackRate),
            Math.max(1 / RATE_STEPS_PER_UNIT, next),
          ),
        );
      }
      const rate = choices.length
        ? direction > 0
          ? Math.min(...choices)
          : Math.max(...choices)
        : el.playbackRate;
      try {
        if (typeof player?.setPlaybackRate === "function") player.setPlaybackRate(rate);
      } catch {
        /* Use the video element below. */
      }
      el.playbackRate = rate;
      return { id, rate: el.playbackRate };
    } catch (error) {
      return { error: `YouTube playback failed: ${error?.message || String(error)}` };
    }
  },
  // The separate reader remains self-contained when executeScript serializes it.
  transcript: globalThis.WAYPOINTS_READ_TRANSCRIPT,
};
