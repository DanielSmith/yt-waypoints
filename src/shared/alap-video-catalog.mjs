// A detached, minimal query view. No independently editable bookmark library.
import "./youtube-values.js";
import { readVideoTags } from "./alap-data.mjs";
import { readPostedTime } from "./alap-posted-time.mjs";
const { isVideoId, channelUrlSegment } = globalThis.WAYPOINTS_YOUTUBE_VALUES;
function scalar(record, field) {
  const descriptor = Object.getOwnPropertyDescriptor(record, field);
  if (!descriptor) return undefined;
  if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value"))
    throw new Error("Search requires own data fields.");
  return descriptor.value;
}
const text = (value) => (typeof value === "string" ? value : "");
const positive = (value) =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
export function createVideoCatalog(videos) {
  if (!Array.isArray(videos)) throw new Error("Search requires a video array.");
  const seen = new Set(),
    records = [],
    allLinks = Object.create(null),
    videoIds = new Map();
  for (const video of videos) {
    if (
      !video ||
      typeof video !== "object" ||
      Array.isArray(video) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(video))
    )
      throw new Error("Search requires plain bookmark records.");
    const id = scalar(video, "id");
    if (!isVideoId(id) || seen.has(id)) throw new Error("Search requires unique, valid video IDs.");
    seen.add(id);
    const record = {
      id,
      title: text(scalar(video, "title")),
      channelName: text(scalar(video, "channelName")),
      channelHandle: channelUrlSegment(scalar(video, "channelUrl")),
      tags: readVideoTags(video),
    };
    const key = `video_${records.length}`;
    allLinks[key] = {
      tags: [...record.tags],
      label: record.title,
      title: record.title,
      channel: record.channelName,
      duration: positive(scalar(video, "duration")),
      updated: positive(scalar(video, "updated")),
      posted: readPostedTime(scalar(video, "posted")),
    };
    videoIds.set(key, record.id);
    records.push(record);
  }
  return { records, allLinks, videoIds };
}
export function matchVideoText(records, text, { includeChannelNames = true } = {}) {
  const needle = text.toLocaleLowerCase();
  return records
    .filter(
      (record) =>
        !needle ||
        record.title.toLocaleLowerCase().includes(needle) ||
        record.tags.some((tag) => tag.includes(needle)) ||
        (includeChannelNames &&
          [record.channelName, record.channelHandle].some((value) =>
            value.toLocaleLowerCase().includes(needle),
          )),
    )
    .map((record) => record.id);
}
