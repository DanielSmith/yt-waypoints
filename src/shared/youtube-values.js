// Pure extension-side value validation. Serialized page readers keep their own
// independent checks and must not close over this shared service.
(() => {
  const MAX_CHANNEL_URL_CHARACTERS = 2048;
  const CHANNEL_URL_ISSUE = Object.freeze({
    MALFORMED: "malformed",
    NOT_CHANNEL: "not-channel",
  });
  const isVideoId = (value) => typeof value === "string" && /^[A-Za-z0-9_-]{11}$/.test(value);

  // Return an issue rather than caller-specific error text. Page results and
  // imported records have different diagnostics for the same invalid value.
  function normalizeChannelUrl(value) {
    const rejected = (issue) => ({ url: null, issue });
    if (
      typeof value !== "string" ||
      value.length > MAX_CHANNEL_URL_CHARACTERS ||
      /[\u0000-\u0020\u007f]/.test(value)
    )
      return rejected(CHANNEL_URL_ISSUE.MALFORMED);
    let url, decodedPath;
    try {
      url = new URL(value);
      decodedPath = decodeURIComponent(url.pathname);
    } catch {
      return rejected(CHANNEL_URL_ISSUE.MALFORMED);
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
      return rejected(CHANNEL_URL_ISSUE.NOT_CHANNEL);
    const canonical = "https://www.youtube.com" + url.pathname.replace(/\/$/, "");
    if (canonical.length > MAX_CHANNEL_URL_CHARACTERS) return rejected(CHANNEL_URL_ISSUE.MALFORMED);
    return { url: canonical, issue: null };
  }

  globalThis.WAYPOINTS_YOUTUBE_VALUES = Object.freeze({
    isVideoId,
    normalizeChannelUrl,
    CHANNEL_URL_ISSUE,
  });
})();
