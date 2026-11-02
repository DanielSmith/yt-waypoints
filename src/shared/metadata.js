// Self-contained so the same function works in a content script and when
// scripting.executeScript serializes it into the YouTube page.
globalThis.WAYPOINTS_READ_METADATA = () => {
  const id = new URLSearchParams(location.search).get("v");
  const video = document.querySelector("video");
  const info = {
    id,
    t: video ? Math.floor(video.currentTime) : 0,
    duration: video && isFinite(video.duration) ? Math.floor(video.duration) : 0,
    title: document.title.replace(/^\(\d+\)\s*/, "").replace(/\s*-\s*YouTube$/, ""),
  };
  const watch = document.querySelector("ytd-watch-flexy:not([hidden])");
  // During in-page navigation the previous video's owner can still be visible.
  if (watch?.getAttribute("video-id") && watch.getAttribute("video-id") !== id) return info;
  const owner = (watch || document).querySelector(
    "#owner #channel-name a[href], ytd-video-owner-renderer #channel-name a[href], " +
    "ytm-slim-owner-renderer a[href], ytm-video-owner-renderer a[href]"
  );
  const name = owner?.textContent?.trim().replace(/\s+/g, " ");
  if (!name) return info;
  try {
    const url = new URL(owner.getAttribute("href"), location.href);
    if (!["youtube.com", "www.youtube.com", "m.youtube.com"].includes(url.hostname) ||
        url.protocol !== "https:" || url.username || url.password || url.port ||
        !/^\/(?:@[^/]+|channel\/[^/]+|c\/[^/]+|user\/[^/]+)\/?$/.test(url.pathname)) return info;
    info.channelName = name;
    info.channelUrl = "https://www.youtube.com" + url.pathname.replace(/\/$/, "");
  } catch {
    // Missing or changing owner metadata must never prevent bookmarking.
  }
  return info;
};
