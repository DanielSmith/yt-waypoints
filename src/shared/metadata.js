// Copyright 2026 Daniel Smith
// SPDX-License-Identifier: Apache-2.0
// Self-contained so the same function works in a content script and when
// scripting.executeScript serializes it into the YouTube page.
globalThis.WAYPOINTS_READ_METADATA = (expectedId = null) => {
  const id = new URLSearchParams(location.search).get("v");
  if (expectedId && id !== expectedId)
    return { error: "This tab changed videos. Select the current video and try again." };
  const watch = document.querySelector("ytd-watch-flexy:not([hidden])");
  if (watch?.getAttribute("video-id") && watch.getAttribute("video-id") !== id)
    return { error: "The video is still changing. Wait for it to load and try again." };
  const video = document.querySelector("video");
  if (video && !Number.isFinite(video.currentTime))
    return { error: "The playback position is not ready. Wait for it to load and try again." };
  const info = {
    id,
    t: video ? Math.floor(video.currentTime) : 0,
    duration: video && Number.isFinite(video.duration) ? Math.floor(video.duration) : 0,
    title: document.title.replace(/^\(\d+\)\s*/, "").replace(/\s*-\s*YouTube$/, ""),
  };
  const owner = (watch || document).querySelector(
    "#owner #channel-name a[href], ytd-video-owner-renderer #channel-name a[href], " +
      "ytm-slim-owner-renderer a[href], ytm-video-owner-renderer a[href]",
  );
  const name = owner?.textContent?.trim().replace(/\s+/g, " ");
  if (!name) return info;
  try {
    const url = new URL(owner.getAttribute("href"), location.href);
    if (
      !["youtube.com", "www.youtube.com", "m.youtube.com"].includes(url.hostname) ||
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      !/^\/(?:@[^/]+|channel\/[^/]+|c\/[^/]+|user\/[^/]+)\/?$/.test(url.pathname)
    )
      return info;
    info.channelName = name;
    info.channelUrl = "https://www.youtube.com" + url.pathname.replace(/\/$/, "");
  } catch {
    // Missing or changing owner metadata must never prevent bookmarking.
  }
  return info;
};
