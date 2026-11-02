// JSON-only bookmark transfer. Imported fields are validated/whitelisted before
// any storage write; browser settings and arbitrary URLs are never imported.
(() => {
  const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
  const fields = ["id", "title", "t", "duration", "updated", "channelName", "channelUrl"];
  function pick(record) {
    if (!isObject(record)) throw new Error("Each video must be a JSON object.");
    const clean = Object.create(null);
    for (const field of fields) {
      if (Object.hasOwn(record, field)) clean[field] = record[field];
    }
    return clean;
  }
  function number(value, name, fallback) {
    if (value === undefined && fallback !== undefined) return fallback;
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`Invalid ${name} in video data.`);
    }
    return value;
  }
  function text(value, name, maxLength, fallback) {
    if (value === undefined) return fallback;
    if (typeof value !== "string" || value.length > maxLength) throw new Error(`Invalid ${name}.`);
    return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim() || fallback;
  }
  function normalize(record, key) {
    record = pick(record);
    const id = Object.hasOwn(record, "id") ? record.id : key;
    if (typeof id !== "string" || !/^[A-Za-z0-9_-]{11}$/.test(id) || (key !== undefined && id !== key)) {
      throw new Error("Invalid or mismatched YouTube video ID.");
    }
    const duration = number(record.duration, "duration", 0);
    const t = number(record.t, "playback position");
    const video = {
      id, title: text(record.title, "video title", 1000, id), t: duration ? Math.min(t, duration) : t,
      duration, updated: number(record.updated, "update timestamp", 0),
    };
    if (record.channelName !== undefined) {
      const name = text(record.channelName, "channel name", 200);
      if (name) video.channelName = name;
    }
    if (record.channelUrl !== undefined) {
      if (typeof record.channelUrl !== "string" || record.channelUrl.length > 2048 ||
          /[\u0000-\u0020\u007f]/.test(record.channelUrl)) throw new Error("Invalid channel URL.");
      let url, decodedPath;
      try {
        url = new URL(record.channelUrl);
        decodedPath = decodeURIComponent(url.pathname);
      } catch { throw new Error("Invalid channel URL."); }
      if (url.protocol !== "https:" || url.username || url.password || url.port ||
          !["youtube.com", "www.youtube.com", "m.youtube.com"].includes(url.hostname) ||
          /[\u0000-\u0020\u007f]/.test(decodedPath) ||
          !/^\/(?:@[^/\\?#\s]+|channel\/[^/\\?#\s]+|c\/[^/\\?#\s]+|user\/[^/\\?#\s]+)\/?$/.test(decodedPath)) {
        throw new Error("Only YouTube channel URLs can be imported.");
      }
      video.channelUrl = "https://www.youtube.com" + url.pathname.replace(/\/$/, "");
      if (video.channelUrl.length > 2048) throw new Error("Invalid channel URL.");
    }
    return video;
  }
  function parse(text) {
    if (typeof text !== "string") throw new Error("Import must be JSON text.");
    if (text.length > 5_000_000) throw new Error("Import is too large (maximum 5 million characters).");
    let parsed;
    try { parsed = JSON.parse(text); } catch { throw new Error("Invalid JSON. Paste the complete videos export."); }
    if (!isObject(parsed) && !Array.isArray(parsed)) throw new Error("Paste a videos export, not a single JSON value.");
    if (isObject(parsed) && Object.hasOwn(parsed, "format") &&
        (parsed.format !== "yt-waypoints" || parsed.version !== 1)) {
      throw new Error("Unsupported videos export format or version.");
    }
    const records = isObject(parsed) && Object.hasOwn(parsed, "videos") ? parsed.videos : parsed;
    if (!isObject(records) && !Array.isArray(records)) throw new Error("The export must contain a videos object or array.");
    const videos = Object.create(null);
    for (const [key, record] of Object.entries(records)) {
      const video = normalize(record, Array.isArray(records) ? undefined : key);
      if (!Object.hasOwn(videos, video.id) || video.updated > videos[video.id].updated) videos[video.id] = video;
    }
    return videos;
  }
  function merge(existing, incoming) {
    const videos = Object.assign(Object.create(null), existing);
    const counts = { added: 0, updated: 0, kept: 0 };
    for (const [id, record] of Object.entries(incoming)) {
      // Enforce the boundary here too, rather than trusting every caller to
      // have gone through parse(). Never spread an incoming/raw record.
      const imported = normalize(record, id);
      if (!Object.hasOwn(videos, id)) {
        videos[id] = imported;
        counts.added++;
        continue;
      }
      const local = videos[id];
      // A deliberate manual import chooses the pasted resume point. Local
      // autosave timestamps must not silently veto the user's selected source.
      const winner = imported;
      const other = local;
      const result = pick(winner);
      for (const field of ["channelName", "channelUrl"]) {
        if (!result[field] && other[field]) result[field] = other[field];
      }
      if ((!result.title || result.title === id) && other.title) result.title = other.title;
      if (!result.duration && other.duration) result.duration = other.duration;
      if (result.duration) result.t = Math.min(result.t, result.duration);
      if (fields.some(field => result[field] !== local[field]) ||
          Object.keys(local).some(field => !fields.includes(field))) {
        videos[id] = result;
        counts.updated++;
      } else counts.kept++;
    }
    return { videos, counts };
  }
  function stringify(videos) {
    return JSON.stringify({
      format: "yt-waypoints", version: 1,
      videos: Object.fromEntries(Object.entries(videos).sort(([a], [b]) => a.localeCompare(b))
        .map(([id, record]) => [id, pick(record)])),
    }, null, 2);
  }
  globalThis.WAYPOINTS_TRANSFER = Object.freeze({ parse, merge, stringify });
})();
