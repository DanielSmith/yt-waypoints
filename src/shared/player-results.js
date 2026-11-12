// Extension-side boundary for data read from a page or returned by executeScript.
// Injected functions cannot close over this module; validation runs after return.
(() => {
  const MAX_SECONDS = Math.floor(Number.MAX_SAFE_INTEGER / 1000);
  const MAX_SEGMENTS = 50000;
  const MAX_TRANSCRIPT_TEXT = 2000000;
  const invalid = (detail) => {
    throw new Error(
      "Invalid player response: " + detail + ". Reload the YouTube tab and try again.",
    );
  };
  const isId = (value) => typeof value === "string" && /^[A-Za-z0-9_-]{11}$/.test(value);

  function fields(value, allowed) {
    if (!value || typeof value !== "object" || Array.isArray(value)) invalid("expected an object");
    const keys = Reflect.ownKeys(value);
    if (keys.length > allowed.length || keys.some((key) => !allowed.includes(key)))
      invalid("unexpected fields");
    const result = Object.create(null);
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.hasOwn(descriptor, "value"))
        invalid("accessor fields are not allowed");
      result[key] = descriptor.value;
    }
    return result;
  }

  function text(value, name, limit, empty = false) {
    if (typeof value !== "string" || value.length > limit) invalid("invalid " + name);
    const clean = value
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!empty && !clean) invalid("missing " + name);
    return clean;
  }

  function seconds(value, name, integer = true) {
    if (
      !Number.isFinite(value) ||
      value < 0 ||
      value > MAX_SECONDS ||
      (integer && !Number.isSafeInteger(value))
    ) {
      invalid("invalid " + name);
    }
    return value;
  }

  function identity(result, expectedId) {
    if (!isId(expectedId) || !isId(result.id) || result.id !== expectedId)
      invalid("video identity does not match");
  }

  function position(result, knownDuration = true) {
    const t = seconds(result.t, "position");
    const duration = seconds(result.duration, "duration");
    if ((knownDuration && duration <= 0) || (duration > 0 && t > duration))
      invalid("position is outside the video duration");
    if (typeof result.paused !== "boolean") invalid("invalid playback state");
    return { id: result.id, t, duration, paused: result.paused };
  }

  function metadata(value, expectedId) {
    const result = fields(value, ["id", "t", "duration", "title", "channelName", "channelUrl"]);
    identity(result, expectedId);
    const t = seconds(result.t, "position");
    const duration = seconds(result.duration, "duration");
    if (duration > 0 && t > duration) invalid("position is outside the video duration");
    const clean = {
      id: result.id,
      t,
      duration,
      title: text(result.title, "title", 1000, true) || result.id,
    };
    if (Object.hasOwn(result, "channelName"))
      clean.channelName = text(result.channelName, "channel name", 200, true);
    if (Object.hasOwn(result, "channelUrl")) {
      const value = result.channelUrl;
      if (typeof value !== "string" || value.length > 2048 || /[\u0000-\u0020\u007f]/.test(value))
        invalid("invalid channel URL");
      let url, decodedPath;
      try {
        url = new URL(value);
        decodedPath = decodeURIComponent(url.pathname);
      } catch {
        invalid("invalid channel URL");
      }
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.port ||
        !["youtube.com", "www.youtube.com", "m.youtube.com"].includes(url.hostname) ||
        /[\u0000-\u0020\u007f]/.test(decodedPath) ||
        !/^\/(?:@[^/\\?#\s]+|channel\/[^/\\?#\s]+|c\/[^/\\?#\s]+|user\/[^/\\?#\s]+)\/?$/.test(
          decodedPath,
        )
      )
        invalid("invalid channel URL");
      clean.channelUrl = "https://www.youtube.com" + url.pathname.replace(/\/$/, "");
      if (clean.channelUrl.length > 2048) invalid("invalid channel URL");
    }
    return clean;
  }

  function transcript(value, expectedId) {
    const result = fields(value, ["id", "segments", "duration", "complete", "source", "language"]);
    identity(result, expectedId);
    if (
      result.complete !== true ||
      !["youtube-transcript-response", "youtube-panel-response"].includes(result.source)
    )
      invalid("transcript completeness is unverified");
    const startsOnly = result.source === "youtube-panel-response";
    const language = text(result.language, "transcript language", 200);
    const duration = result.duration === null ? null : seconds(result.duration, "duration", false);
    if (
      duration === 0 ||
      !Array.isArray(result.segments) ||
      !result.segments.length ||
      result.segments.length > MAX_SEGMENTS
    )
      invalid("invalid transcript size or duration");
    if (Reflect.ownKeys(result.segments).length !== result.segments.length + 1)
      invalid("unexpected transcript array fields");
    let total = 0;
    let previous = -1;
    const segments = [];
    for (let index = 0; index < result.segments.length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(result.segments, String(index));
      if (!descriptor || !Object.hasOwn(descriptor, "value")) invalid("invalid transcript segment");
      const segment = fields(descriptor.value, ["start", "end", "text"]);
      const start = seconds(segment.start, "caption timestamp", false);
      const end =
        startsOnly && segment.end === null ? null : seconds(segment.end, "caption end", false);
      if (
        (startsOnly && end !== null) ||
        (end !== null && (end <= start || (duration !== null && end > duration)))
      )
        invalid("invalid caption end");
      const caption = text(segment.text, "caption text", 10000);
      total += segment.text.length;
      if (
        total > MAX_TRANSCRIPT_TEXT ||
        start < previous ||
        (duration !== null && start >= duration)
      )
        invalid("invalid transcript size or timing");
      previous = start;
      segments.push({ start, end, text: caption });
    }
    return { id: result.id, duration, segments, complete: true, source: result.source, language };
  }

  function validate(operation, value, expectedId, args = []) {
    // Page error messages are data too. Do not stringify arbitrary page objects.
    if (value && typeof value === "object" && Object.hasOwn(value, "error")) {
      const result = fields(value, ["error"]);
      return { error: text(result.error, "error message", 500) };
    }
    if (operation === "bookmark") return metadata(value, expectedId);
    if (operation === "transcript") return transcript(value, expectedId);
    const mode = operation === "playback" ? args[0] : operation;
    if (!["seek", "seekTo", "toggle", "frame", "rate"].includes(mode)) invalid("unknown operation");
    const allowed =
      mode === "rate"
        ? ["id", "rate"]
        : ["id", "t", "duration", "paused", ...(mode === "frame" ? ["fps"] : [])];
    const result = fields(value, allowed);
    identity(result, expectedId);
    if (mode === "rate") {
      if (!Number.isFinite(result.rate) || result.rate <= 0 || result.rate > 16)
        invalid("invalid playback rate");
      return { id: result.id, rate: result.rate };
    }
    const clean = position(result, mode !== "toggle");
    if (mode === "frame") {
      if (
        !Number.isFinite(result.fps) ||
        result.fps <= 0 ||
        result.fps > 240 ||
        result.paused !== true
      )
        invalid("invalid frame-step state");
      clean.fps = result.fps;
    }
    return clean;
  }

  globalThis.WAYPOINTS_PLAYER_RESULTS = Object.freeze({ validate, metadata, isId, MAX_SECONDS });
})();
