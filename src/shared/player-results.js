// Copyright 2026 Daniel Smith
// SPDX-License-Identifier: Apache-2.0
// Extension-side boundary for data read from a page or returned by executeScript.
// Injected functions cannot close over this module; validation runs after return.
(() => {
  const MAX_SECONDS = Math.floor(Number.MAX_SAFE_INTEGER / 1000);
  const MAX_SEGMENTS = 50000;
  const MAX_TRANSCRIPT_TEXT = 2000000;
  const MAX_TITLE_CHARACTERS = 1000;
  const MAX_CHANNEL_NAME_CHARACTERS = 200;
  const MAX_LANGUAGE_CHARACTERS = 200;
  const MAX_CAPTION_CHARACTERS = 10000;
  const MAX_ERROR_CHARACTERS = 500;
  const MAX_CHAPTERS = 1000;
  const MILLISECOND_PRECISION_EPSILON = 0.000001;
  const MAX_PLAYBACK_RATE = 16;
  const MAX_FRAME_RATE = 240;
  const invalid = (detail) => {
    throw new Error(
      "Invalid player response: " + detail + ". Reload the YouTube tab and try again.",
    );
  };
  const { isVideoId: isId, normalizeChannelUrl } = WAYPOINTS_YOUTUBE_VALUES;

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
      title: text(result.title, "title", MAX_TITLE_CHARACTERS, true) || result.id,
    };
    if (Object.hasOwn(result, "channelName"))
      clean.channelName = text(
        result.channelName,
        "channel name",
        MAX_CHANNEL_NAME_CHARACTERS,
        true,
      );
    if (Object.hasOwn(result, "channelUrl")) {
      const channel = normalizeChannelUrl(result.channelUrl);
      if (channel.issue) invalid("invalid channel URL");
      clean.channelUrl = channel.url;
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
    const language = text(result.language, "transcript language", MAX_LANGUAGE_CHARACTERS);
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
      const caption = text(segment.text, "caption text", MAX_CAPTION_CHARACTERS);
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
      return { error: text(result.error, "error message", MAX_ERROR_CHARACTERS) };
    }
    if (operation === "bookmark") return metadata(value, expectedId);
    if (operation === "chapters") {
      const result = fields(value, ["id", "duration", "available", "chapters"]);
      identity(result, expectedId);
      const duration = seconds(result.duration, "duration");
      if (
        !duration ||
        typeof result.available !== "boolean" ||
        !Array.isArray(result.chapters) ||
        result.chapters.length > MAX_CHAPTERS ||
        (!result.available && result.chapters.length)
      )
        invalid("invalid chapter list");
      let previous = -1;
      const chapters = Array.from(result.chapters, (item) => {
        const chapter = fields(item, ["t", "title"]);
        const t = seconds(chapter.t, "chapter timestamp", false);
        if (
          t >= duration ||
          t <= previous ||
          Math.abs(t * 1000 - Math.round(t * 1000)) > MILLISECOND_PRECISION_EPSILON
        )
          invalid("invalid chapter timing");
        previous = t;
        return { t, title: text(chapter.title, "chapter title", MAX_TITLE_CHARACTERS) };
      });
      return { id: result.id, duration, available: result.available, chapters };
    }
    if (operation === "transcript") return transcript(value, expectedId);
    const mode = operation === "playback" ? args[0] : operation;
    if (!["position", "seek", "seekTo", "toggle", "frame", "rate"].includes(mode))
      invalid("unknown operation");
    const allowed =
      mode === "rate"
        ? ["id", "rate"]
        : ["id", "t", "duration", "paused", ...(mode === "frame" ? ["fps"] : [])];
    const result = fields(value, allowed);
    identity(result, expectedId);
    if (mode === "rate") {
      if (!Number.isFinite(result.rate) || result.rate <= 0 || result.rate > MAX_PLAYBACK_RATE)
        invalid("invalid playback rate");
      return { id: result.id, rate: result.rate };
    }
    const clean = position(result, mode !== "toggle");
    if (mode === "frame") {
      if (
        !Number.isFinite(result.fps) ||
        result.fps <= 0 ||
        result.fps > MAX_FRAME_RATE ||
        result.paused !== true
      )
        invalid("invalid frame-step state");
      clean.fps = result.fps;
    }
    return clean;
  }

  globalThis.WAYPOINTS_PLAYER_RESULTS = Object.freeze({ validate, metadata, isId, MAX_SECONDS });
})();
