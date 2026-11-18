// Copyright 2026 Daniel Smith
// SPDX-License-Identifier: Apache-2.0
import "./youtube-values.js";
import { suggestTagSlug } from "./alap-data.mjs";

// Serialized by executeScript. Read only metadata Chrome/Firefox can see
// in the loaded page. Never follow URLs or execute strings from the page.
export function readCreatorTags(expectedId) {
  const currentId = () => new URLSearchParams(location.search).get("v");
  const currentWatch = () => document.querySelector("ytd-watch-flexy:not([hidden])");
  const watch = currentWatch();
  const matches = () =>
    location.pathname === "/watch" &&
    currentId() === expectedId &&
    currentWatch() === watch &&
    (watch ? watch.getAttribute("video-id") === expectedId : location.hostname === "m.youtube.com");
  if (!matches()) return { state: "changing" };

  const page = globalThis.wrappedJSObject || globalThis;
  const element = document.querySelector("#movie_player");
  const player = element?.wrappedJSObject || element;
  let response;
  try {
    response = player?.getPlayerResponse?.();
  } catch {
    // The initial response remains a fallback when the player API is absent.
  }
  const matching = [response, page.ytInitialPlayerResponse].filter(
    (candidate) => candidate?.videoDetails?.videoId === expectedId,
  );
  if (!matching.length) return { state: "unavailable" };
  const source = matching.find((candidate) => Array.isArray(candidate.videoDetails.keywords));
  const items = source?.videoDetails.keywords || [];
  const keywords = [];
  for (let i = 0; i < Math.min(items.length, 100); i++) {
    const item = items[i];
    if (typeof item === "string" && item.length > 0 && item.length <= 256) keywords.push(item);
  }
  if (!matches()) return { state: "changing" };
  return { state: "ready", id: expectedId, keywords };
}

const watchPatterns = [
  "https://www.youtube.com/watch*",
  "https://m.youtube.com/watch*",
  "https://youtube.com/watch*",
];
function matchesWatch(value, id) {
  try {
    const url = new URL(value);
    return (
      ["https://www.youtube.com", "https://m.youtube.com", "https://youtube.com"].includes(
        url.origin,
      ) &&
      url.pathname === "/watch" &&
      url.searchParams.get("v") === id
    );
  } catch {
    return false;
  }
}

export async function fetchCreatorTags(api, id) {
  if (!WAYPOINTS_YOUTUBE_VALUES.isVideoId(id)) throw new Error("Invalid video ID.");
  const tabs = await api.tabs.query({ url: watchPatterns });
  const tab = tabs.find(
    (candidate) => Number.isInteger(candidate.id) && matchesWatch(candidate.url, id),
  );
  if (!tab) throw new Error("Open this video on YouTube first, then try again.");
  const request = { target: { tabId: tab.id, frameIds: [0] }, func: readCreatorTags, args: [id] };
  let results;
  try {
    results = await api.scripting.executeScript({ ...request, world: "MAIN" });
  } catch (error) {
    // Older Firefox rejects MAIN. In the isolated world the reader uses
    // wrappedJSObject to inspect the same page-owned metadata.
    if (
      !/world.*(?:MAIN|unsupported|invalid)|(?:unexpected|unsupported).*world/i.test(error.message)
    )
      throw new Error(
        "Could not read creator tags. Check that Waypoints has access to the YouTube tab.",
      );
    results = await api.scripting.executeScript(request);
  }
  if (
    !Array.isArray(results) ||
    results.length !== 1 ||
    results[0]?.frameId !== 0 ||
    results[0].error
  )
    throw new Error("Could not read a valid response from the YouTube page.");
  const payload = results[0].result;
  let after;
  try {
    after = await api.tabs.get(tab.id);
  } catch {
    /* The tab may have closed. */
  }
  if (!matchesWatch(after?.url, id) || payload?.state === "changing")
    throw new Error("The YouTube tab changed videos. Open the matching video and try again.");
  if (payload?.state === "unavailable")
    throw new Error(
      "Creator tags are not available yet. Wait for YouTube to load, or reload the video.",
    );
  if (
    payload?.state !== "ready" ||
    payload.id !== id ||
    !Array.isArray(payload.keywords) ||
    payload.keywords.length > 100
  )
    throw new Error("YouTube returned an invalid creator-tag response.");
  for (const item of payload.keywords) {
    if (typeof item !== "string" || !item.length || item.length > 256)
      throw new Error("YouTube returned an invalid creator tag.");
  }
  return [...new Set(payload.keywords)];
}

export function creatorTagOptions(keywords, tags, removedTags) {
  const seen = new Set(tags);
  return keywords.map((original) => {
    let tag;
    try {
      tag = suggestTagSlug(original);
    } catch {
      return { original, reason: "Can’t make a tag from this." };
    }
    const present = seen.has(tag);
    seen.add(tag);
    if (removedTags.has(tag)) return { original, tag, reason: "Removed in this draft." };
    if (present) return { original, tag, reason: "Already added or suggested." };
    return { original, tag };
  });
}
