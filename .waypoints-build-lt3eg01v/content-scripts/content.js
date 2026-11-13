(function() {
  "use strict";
  function defineContentScript(definition2) {
    return definition2;
  }
  (() => {
    const MAX_MARKERS = 1e5;
    const MAX_TIME = 315576e3;
    const own = (object, key) => {
      const descriptor = Object.getOwnPropertyDescriptor(object, key);
      if (!descriptor) return void 0;
      if (!Object.hasOwn(descriptor, "value")) throw new Error(`Invalid marker ${key}.`);
      return descriptor.value;
    };
    function text(value, name, limit) {
      if (typeof value !== "string" || value.length > limit || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
        throw new Error(`Invalid ${name}.`);
      }
      return value;
    }
    function note(value) {
      return text(value, "annotation", 1e4);
    }
    function chapterId(t) {
      return `c:${Math.round(t * 1e3)}`;
    }
    function normalize(markers) {
      if (!Array.isArray(markers) || markers.length > MAX_MARKERS) {
        throw new Error(`Invalid markers (maximum ${MAX_MARKERS}).`);
      }
      const seen = /* @__PURE__ */ new Set();
      return Array.from(markers, (marker) => {
        if (!marker || typeof marker !== "object" || Array.isArray(marker))
          throw new Error("Invalid marker.");
        const id = own(marker, "id"), t = own(marker, "t"), origin = own(marker, "origin");
        if (typeof id !== "string" || !/^(?:u:[A-Za-z0-9_-]{1,80}|c:\d{1,12})$/.test(id) || seen.has(id)) {
          throw new Error("Invalid or duplicate marker ID.");
        }
        if (typeof t !== "number" || !Number.isFinite(t) || t < 0 || t > MAX_TIME || Math.abs(t * 1e3 - Math.round(t * 1e3)) > 1e-6) {
          throw new Error("Invalid marker timestamp.");
        }
        if (origin !== "chapter" && origin !== "user") throw new Error("Invalid marker origin.");
        if (origin === "chapter" && id !== chapterId(t) || origin === "user" && !id.startsWith("u:")) {
          throw new Error("Marker identity does not match its origin/time.");
        }
        seen.add(id);
        const clean = { id, t, origin };
        for (const [key, limit] of [
          ["title", 1e3],
          ["label", 200],
          ["note", 1e4]
        ]) {
          const value = own(marker, key);
          if (value !== void 0) clean[key] = text(value, `marker ${key}`, limit);
        }
        const removed = own(marker, "removed");
        if (removed !== void 0) {
          if (typeof removed !== "boolean") throw new Error("Invalid marker removal state.");
          clean.removed = removed;
        }
        if (clean.removed) {
          delete clean.note;
          delete clean.label;
        }
        return clean;
      }).sort((a, b) => a.t - b.t || a.id.localeCompare(b.id));
    }
    function merge(local = [], incoming = []) {
      const markers = new Map(normalize(local).map((marker) => [marker.id, marker]));
      for (const marker of normalize(incoming)) markers.set(marker.id, marker);
      return normalize([...markers.values()]);
    }
    function anchor(markers, currentId) {
      const marker = normalize(markers).find((item) => item.id === currentId && !item.removed);
      return marker ? { markerId: marker.id, t: marker.t } : { markerId: null, t: 0 };
    }
    function annotation(marker) {
      if (!marker || marker.removed) return "";
      return Object.hasOwn(marker, "note") ? marker.note : marker.origin === "chapter" ? marker.title || "" : "";
    }
    function refreshChapters(local, chapters) {
      const markers = new Map(normalize(local).map((marker) => [marker.id, marker]));
      for (const chapter of normalize(chapters)) {
        if (chapter.origin !== "chapter") throw new Error("Invalid chapter refresh.");
        const source = { id: chapter.id, t: chapter.t, origin: "chapter" };
        if (Object.hasOwn(chapter, "title")) source.title = chapter.title;
        markers.set(chapter.id, { ...markers.get(chapter.id), ...source });
      }
      return normalize([...markers.values()]);
    }
    globalThis.WAYPOINTS_MARKERS = Object.freeze({
      normalize,
      merge,
      note,
      chapterId,
      anchor,
      annotation,
      refreshChapters,
      MAX_MARKERS
    });
  })();
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
      title: document.title.replace(/^\(\d+\)\s*/, "").replace(/\s*-\s*YouTube$/, "")
    };
    const owner = (watch || document).querySelector(
      "#owner #channel-name a[href], ytd-video-owner-renderer #channel-name a[href], ytm-slim-owner-renderer a[href], ytm-video-owner-renderer a[href]"
    );
    const name = owner?.textContent?.trim().replace(/\s+/g, " ");
    if (!name) return info;
    try {
      const url = new URL(owner.getAttribute("href"), location.href);
      if (!["youtube.com", "www.youtube.com", "m.youtube.com"].includes(url.hostname) || url.protocol !== "https:" || url.username || url.password || url.port || !/^\/(?:@[^/]+|channel\/[^/]+|c\/[^/]+|user\/[^/]+)\/?$/.test(url.pathname))
        return info;
      info.channelName = name;
      info.channelUrl = "https://www.youtube.com" + url.pathname.replace(/\/$/, "");
    } catch {
    }
    return info;
  };
  (() => {
    const MAX_SECONDS = Math.floor(Number.MAX_SAFE_INTEGER / 1e3);
    const MAX_SEGMENTS = 5e4;
    const MAX_TRANSCRIPT_TEXT = 2e6;
    const invalid = (detail) => {
      throw new Error(
        "Invalid player response: " + detail + ". Reload the YouTube tab and try again."
      );
    };
    const isId = (value) => typeof value === "string" && /^[A-Za-z0-9_-]{11}$/.test(value);
    function fields(value, allowed) {
      if (!value || typeof value !== "object" || Array.isArray(value)) invalid("expected an object");
      const keys = Reflect.ownKeys(value);
      if (keys.length > allowed.length || keys.some((key) => !allowed.includes(key)))
        invalid("unexpected fields");
      const result2 = /* @__PURE__ */ Object.create(null);
      for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !Object.hasOwn(descriptor, "value"))
          invalid("accessor fields are not allowed");
        result2[key] = descriptor.value;
      }
      return result2;
    }
    function text(value, name, limit, empty = false) {
      if (typeof value !== "string" || value.length > limit) invalid("invalid " + name);
      const clean = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
      if (!empty && !clean) invalid("missing " + name);
      return clean;
    }
    function seconds(value, name, integer = true) {
      if (!Number.isFinite(value) || value < 0 || value > MAX_SECONDS || integer && !Number.isSafeInteger(value)) {
        invalid("invalid " + name);
      }
      return value;
    }
    function identity(result2, expectedId) {
      if (!isId(expectedId) || !isId(result2.id) || result2.id !== expectedId)
        invalid("video identity does not match");
    }
    function position(result2, knownDuration = true) {
      const t = seconds(result2.t, "position");
      const duration = seconds(result2.duration, "duration");
      if (knownDuration && duration <= 0 || duration > 0 && t > duration)
        invalid("position is outside the video duration");
      if (typeof result2.paused !== "boolean") invalid("invalid playback state");
      return { id: result2.id, t, duration, paused: result2.paused };
    }
    function metadata(value, expectedId) {
      const result2 = fields(value, ["id", "t", "duration", "title", "channelName", "channelUrl"]);
      identity(result2, expectedId);
      const t = seconds(result2.t, "position");
      const duration = seconds(result2.duration, "duration");
      if (duration > 0 && t > duration) invalid("position is outside the video duration");
      const clean = {
        id: result2.id,
        t,
        duration,
        title: text(result2.title, "title", 1e3, true) || result2.id
      };
      if (Object.hasOwn(result2, "channelName"))
        clean.channelName = text(result2.channelName, "channel name", 200, true);
      if (Object.hasOwn(result2, "channelUrl")) {
        const value2 = result2.channelUrl;
        if (typeof value2 !== "string" || value2.length > 2048 || /[\u0000-\u0020\u007f]/.test(value2))
          invalid("invalid channel URL");
        let url, decodedPath;
        try {
          url = new URL(value2);
          decodedPath = decodeURIComponent(url.pathname);
        } catch {
          invalid("invalid channel URL");
        }
        if (url.protocol !== "https:" || url.username || url.password || url.port || !["youtube.com", "www.youtube.com", "m.youtube.com"].includes(url.hostname) || /[\u0000-\u0020\u007f]/.test(decodedPath) || !/^\/(?:@[^/\\?#\s]+|channel\/[^/\\?#\s]+|c\/[^/\\?#\s]+|user\/[^/\\?#\s]+)\/?$/.test(
          decodedPath
        ))
          invalid("invalid channel URL");
        clean.channelUrl = "https://www.youtube.com" + url.pathname.replace(/\/$/, "");
        if (clean.channelUrl.length > 2048) invalid("invalid channel URL");
      }
      return clean;
    }
    function transcript(value, expectedId) {
      const result2 = fields(value, ["id", "segments", "duration", "complete", "source", "language"]);
      identity(result2, expectedId);
      if (result2.complete !== true || !["youtube-transcript-response", "youtube-panel-response"].includes(result2.source))
        invalid("transcript completeness is unverified");
      const startsOnly = result2.source === "youtube-panel-response";
      const language = text(result2.language, "transcript language", 200);
      const duration = result2.duration === null ? null : seconds(result2.duration, "duration", false);
      if (duration === 0 || !Array.isArray(result2.segments) || !result2.segments.length || result2.segments.length > MAX_SEGMENTS)
        invalid("invalid transcript size or duration");
      if (Reflect.ownKeys(result2.segments).length !== result2.segments.length + 1)
        invalid("unexpected transcript array fields");
      let total = 0;
      let previous = -1;
      const segments = [];
      for (let index = 0; index < result2.segments.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(result2.segments, String(index));
        if (!descriptor || !Object.hasOwn(descriptor, "value")) invalid("invalid transcript segment");
        const segment = fields(descriptor.value, ["start", "end", "text"]);
        const start = seconds(segment.start, "caption timestamp", false);
        const end = startsOnly && segment.end === null ? null : seconds(segment.end, "caption end", false);
        if (startsOnly && end !== null || end !== null && (end <= start || duration !== null && end > duration))
          invalid("invalid caption end");
        const caption = text(segment.text, "caption text", 1e4);
        total += segment.text.length;
        if (total > MAX_TRANSCRIPT_TEXT || start < previous || duration !== null && start >= duration)
          invalid("invalid transcript size or timing");
        previous = start;
        segments.push({ start, end, text: caption });
      }
      return { id: result2.id, duration, segments, complete: true, source: result2.source, language };
    }
    function validate(operation, value, expectedId, args = []) {
      if (value && typeof value === "object" && Object.hasOwn(value, "error")) {
        const result3 = fields(value, ["error"]);
        return { error: text(result3.error, "error message", 500) };
      }
      if (operation === "bookmark") return metadata(value, expectedId);
      if (operation === "chapters") {
        const result3 = fields(value, ["id", "duration", "available", "chapters"]);
        identity(result3, expectedId);
        const duration = seconds(result3.duration, "duration");
        if (!duration || typeof result3.available !== "boolean" || !Array.isArray(result3.chapters) || result3.chapters.length > 1e3 || !result3.available && result3.chapters.length)
          invalid("invalid chapter list");
        let previous = -1;
        const chapters = Array.from(result3.chapters, (item) => {
          const chapter = fields(item, ["t", "title"]);
          const t = seconds(chapter.t, "chapter timestamp", false);
          if (t >= duration || t <= previous || Math.abs(t * 1e3 - Math.round(t * 1e3)) > 1e-6)
            invalid("invalid chapter timing");
          previous = t;
          return { t, title: text(chapter.title, "chapter title", 1e3) };
        });
        return { id: result3.id, duration, available: result3.available, chapters };
      }
      if (operation === "transcript") return transcript(value, expectedId);
      const mode = operation === "playback" ? args[0] : operation;
      if (!["position", "seek", "seekTo", "toggle", "frame", "rate"].includes(mode))
        invalid("unknown operation");
      const allowed = mode === "rate" ? ["id", "rate"] : ["id", "t", "duration", "paused", ...mode === "frame" ? ["fps"] : []];
      const result2 = fields(value, allowed);
      identity(result2, expectedId);
      if (mode === "rate") {
        if (!Number.isFinite(result2.rate) || result2.rate <= 0 || result2.rate > 16)
          invalid("invalid playback rate");
        return { id: result2.id, rate: result2.rate };
      }
      const clean = position(result2, mode !== "toggle");
      if (mode === "frame") {
        if (!Number.isFinite(result2.fps) || result2.fps <= 0 || result2.fps > 240 || result2.paused !== true)
          invalid("invalid frame-step state");
        clean.fps = result2.fps;
      }
      return clean;
    }
    globalThis.WAYPOINTS_PLAYER_RESULTS = Object.freeze({ validate, metadata, isId, MAX_SECONDS });
  })();
  (() => {
    const api = globalThis.browser ?? globalThis.chrome;
    const PREFIX = "waypoints.bookmarks.v2:";
    const LEGACY = [0, "legacy"];
    const COMPACT_AT = 64;
    const cloneJson = (value) => JSON.parse(JSON.stringify(value));
    const compareVersions = (leftVersion, rightVersion) => leftVersion[0] - rightVersion[0] || (leftVersion[1] < rightVersion[1] ? -1 : leftVersion[1] > rightVersion[1] ? 1 : 0);
    const sameVersion = (leftVersion, rightVersion) => compareVersions(leftVersion, rightVersion) === 0;
    const sameValue = (leftValue, rightValue) => JSON.stringify(leftValue) === JSON.stringify(rightValue);
    function flattenVideo(video) {
      const fields = Object.fromEntries(Object.entries(video).filter(([name]) => name !== "markers"));
      if (Object.hasOwn(video, "startNote"))
        fields.startNote = WAYPOINTS_MARKERS.note(video.startNote);
      if (Object.hasOwn(video, "markers")) {
        fields.$markers = true;
        for (const marker of WAYPOINTS_MARKERS.normalize(video.markers)) {
          for (const [name, value] of Object.entries(marker)) {
            if (name !== "id") fields[`$marker:${encodeURIComponent(marker.id)}:${name}`] = value;
          }
        }
      }
      return fields;
    }
    function materializeVideo(fields) {
      const video = /* @__PURE__ */ Object.create(null);
      const markers = /* @__PURE__ */ new Map();
      let hasMarkers = false;
      for (const [name, field] of Object.entries(fields)) {
        if (field.removed) continue;
        if (name === "$markers") {
          hasMarkers = true;
          continue;
        }
        if (name.startsWith("$marker:")) {
          const [, encodedId, property] = name.split(":");
          const id = decodeURIComponent(encodedId);
          if (!markers.has(id)) markers.set(id, { id });
          markers.get(id)[property] = cloneJson(field.value);
          hasMarkers = true;
        } else video[name] = cloneJson(field.value);
      }
      if (hasMarkers) video.markers = WAYPOINTS_MARKERS.normalize([...markers.values()]);
      return video;
    }
    function versionedFields(video, fieldVersion) {
      return Object.fromEntries(
        Object.entries(flattenVideo(video)).map(([name, value]) => [
          name,
          { v: fieldVersion, value }
        ])
      );
    }
    function nextLifetime(snapshot, id, automatic = false) {
      return [
        (snapshot.records[id]?.life.v[0] || 0) + 1,
        (automatic ? "0:" : "1:") + crypto.randomUUID()
      ];
    }
    function mergeRecord(left, right) {
      if (!left) return cloneJson(right);
      const order = compareVersions(left.life.v, right.life.v);
      const result2 = cloneJson(order < 0 ? right : left);
      if (order === 0) {
        for (const [name, field] of Object.entries(right.fields)) {
          if (!result2.fields[name] || compareVersions(field.v, result2.fields[name].v) > 0) {
            result2.fields[name] = cloneJson(field);
          }
        }
      }
      const boundaries = [
        left.purged,
        right.purged,
        left.life.deleted ? left.life.v : null,
        right.life.deleted ? right.life.v : null
      ].filter(Boolean);
      if (boundaries.length)
        result2.purged = boundaries.reduce((a, b) => compareVersions(a, b) > 0 ? a : b);
      return result2;
    }
    function decode(raw) {
      const records = /* @__PURE__ */ Object.create(null);
      for (const [id, video] of Object.entries(raw.videos || {})) {
        records[id] = {
          life: {
            v: LEGACY,
            deleted: false,
            ...raw.importedPositions?.videos?.[id] ? {
              imported: raw.importedPositions.videos[id],
              importRevision: raw.importedPositions.revision
            } : {}
          },
          fields: versionedFields(video, LEGACY)
        };
      }
      let clock = 0;
      const keys = [];
      for (const [key, entry] of Object.entries(raw)) {
        if (!key.startsWith(PREFIX) || entry?.version !== 2) continue;
        keys.push(key);
        clock = Math.max(clock, entry.clock);
        for (const [id, record] of Object.entries(entry.records)) {
          records[id] = mergeRecord(records[id], record);
        }
      }
      const videos = /* @__PURE__ */ Object.create(null);
      const trash = /* @__PURE__ */ Object.create(null);
      const trashTimes = /* @__PURE__ */ Object.create(null);
      const targets = /* @__PURE__ */ Object.create(null);
      const revisions = [];
      for (const [id, record] of Object.entries(records)) {
        if (record.life.deleted) continue;
        const video = materializeVideo(record.fields);
        if (record.life.status === "trash") {
          trash[id] = video;
          trashTimes[id] = record.life.trashedAt;
          continue;
        }
        videos[id] = video;
        const imported2 = record.life.imported || (sameVersion(record.life.v, LEGACY) ? raw.importedPositions?.videos?.[id] : null);
        if (imported2) {
          targets[id] = {
            ...imported2,
            revision: sameVersion(record.life.v, LEGACY) ? record.life.importRevision || raw.importedPositions?.revision : JSON.stringify(record.life.v)
          };
          revisions.push([
            id,
            sameVersion(record.life.v, LEGACY) ? record.life.importRevision || raw.importedPositions?.revision : record.life.v
          ]);
        }
      }
      const importedPositions = revisions.length ? {
        revision: JSON.stringify(revisions.sort(([a], [b]) => a.localeCompare(b))),
        videos: targets
      } : null;
      const legacyKeys = ["videos", "importedPositions"].filter((key) => Object.hasOwn(raw, key));
      const retiredPayload = Object.entries(raw.videos || {}).some(([id]) => records[id]?.purged) || keys.some(
        (key) => Object.entries(raw[key].records).some(([id, record]) => {
          const purged = records[id]?.purged;
          return purged && compareVersions(record.life.v, purged) <= 0 && (Object.keys(record.fields).length > 0 || record.life.imported);
        })
      );
      return {
        videos,
        trash,
        trashTimes,
        importedPositions,
        records,
        clock,
        keys,
        legacyKeys,
        retiredPayload,
        settings: raw.settings || {}
      };
    }
    async function read() {
      const snapshot = decode(await api.storage.local.get(null));
      snapshot.original = cloneJson(snapshot.videos);
      return snapshot;
    }
    async function compact(force = false, retries = 2) {
      const snapshot = await read();
      if (!force && snapshot.keys.length < COMPACT_AT && !snapshot.retiredPayload) return;
      const key = PREFIX + crypto.randomUUID();
      await api.storage.local.set({
        [key]: {
          version: 2,
          kind: "checkpoint",
          clock: snapshot.clock,
          records: snapshot.records
        }
      });
      await api.storage.local.remove([...snapshot.keys, ...snapshot.legacyKeys]);
      if (retries > 0 && (await read()).retiredPayload) await compact(true, retries - 1);
    }
    async function write(records, clock, kind, purge2 = false) {
      if (!Object.keys(records).length) return;
      await api.storage.local.set({
        [PREFIX + crypto.randomUUID()]: { version: 2, kind, clock, records }
      });
      try {
        await compact(purge2);
      } catch (error) {
        if (purge2)
          throw new Error(
            "Deletion recorded, but stored-content cleanup failed. Retry Empty trash. " + error.message
          );
      }
    }
    async function save(snapshot) {
      const v = [snapshot.clock + 1, crypto.randomUUID()];
      const records = /* @__PURE__ */ Object.create(null);
      for (const id of /* @__PURE__ */ new Set([
        ...Object.keys(snapshot.original),
        ...Object.keys(snapshot.videos)
      ])) {
        const before = snapshot.original[id];
        const after = snapshot.videos[id];
        if (sameValue(before, after)) continue;
        if (!before || !after) {
          const lifeVersion = nextLifetime(snapshot, id);
          records[id] = {
            life: { v: lifeVersion, deleted: !after },
            ...!after ? { purged: lifeVersion } : {},
            fields: after ? versionedFields(after, v) : {}
          };
          continue;
        }
        const fields = /* @__PURE__ */ Object.create(null);
        const beforeFields = flattenVideo(before);
        const afterVideo = { ...after };
        if (before.markers) {
          const next = new Map(
            (Object.hasOwn(after, "markers") ? WAYPOINTS_MARKERS.normalize(after.markers) : []).map(
              (marker) => [marker.id, marker]
            )
          );
          for (const marker of before.markers) {
            if (!next.has(marker.id)) next.set(marker.id, { ...marker, removed: true });
          }
          afterVideo.markers = [...next.values()];
        }
        const afterFields = flattenVideo(afterVideo);
        for (const name of /* @__PURE__ */ new Set([...Object.keys(beforeFields), ...Object.keys(afterFields)])) {
          if (sameValue(beforeFields[name], afterFields[name])) continue;
          fields[name] = Object.hasOwn(afterFields, name) ? { v, value: afterFields[name] } : { v, removed: true };
        }
        records[id] = { life: snapshot.records[id].life, fields };
      }
      await write(
        records,
        v[0],
        "edit",
        Object.values(records).some((record) => record.life.deleted)
      );
    }
    async function importVideos(incoming) {
      const snapshot = await read();
      const { videos, counts } = WAYPOINTS_TRANSFER.merge(snapshot.videos, incoming);
      const v = [snapshot.clock + 1, crypto.randomUUID()];
      const records = /* @__PURE__ */ Object.create(null);
      const positions = /* @__PURE__ */ Object.create(null);
      for (const id of Object.keys(incoming)) {
        const video = videos[id];
        positions[id] = { t: video.t, duration: video.duration };
        records[id] = {
          life: { v: nextLifetime(snapshot, id), deleted: false, imported: positions[id] },
          fields: versionedFields(video, v)
        };
      }
      await write(records, v[0], "import");
      return { counts, positions };
    }
    function retentionDays(value) {
      return Number.isInteger(value) && value >= 1 && value <= 365 ? value : 7;
    }
    async function move(id, toTrash) {
      const snapshot = await read();
      const video = (toTrash ? snapshot.videos : snapshot.trash)[id];
      if (!video) return false;
      const v = [snapshot.clock + 1, crypto.randomUUID()];
      const life = {
        v: nextLifetime(snapshot, id),
        deleted: false,
        status: toTrash ? "trash" : "current",
        ...toTrash ? { trashedAt: Date.now() } : {}
      };
      await write(
        {
          [id]: {
            life,
            fields: versionedFields(video, v)
          }
        },
        v[0],
        toTrash ? "trash" : "restore"
      );
      return true;
    }
    async function purge(ids, snapshot, automatic = false) {
      snapshot ||= await read();
      const v = [snapshot.clock + 1, crypto.randomUUID()];
      const records = /* @__PURE__ */ Object.create(null);
      for (const id of ids) {
        if (!snapshot.videos[id] && !snapshot.trash[id]) continue;
        const lifeVersion = nextLifetime(snapshot, id, automatic);
        records[id] = { life: { v: lifeVersion, deleted: true }, purged: lifeVersion, fields: {} };
      }
      if (Object.keys(records).length) await write(records, v[0], "purge", true);
      else if (snapshot.retiredPayload) await compact(true);
      const current = await read();
      return Object.keys(records).filter((id) => current.records[id]?.life.deleted).length;
    }
    async function emptyTrash() {
      const snapshot = await read();
      return purge(Object.keys(snapshot.trash), snapshot, true);
    }
    async function expire(now = Date.now()) {
      const snapshot = await read();
      const duration = retentionDays(snapshot.settings.trashDays) * 864e5;
      const ids = Object.keys(snapshot.trash).filter(
        (id) => snapshot.trashTimes[id] + duration <= now
      );
      return ids.length ? purge(ids, snapshot, true) : 0;
    }
    function changed(changes) {
      return Boolean(changes.videos || Object.keys(changes).some((key) => key.startsWith(PREFIX)));
    }
    function imported(changes) {
      return Boolean(
        changes.importedPositions || Object.entries(changes).some(
          ([key, change]) => key.startsWith(PREFIX) && change.newValue?.kind === "import"
        )
      );
    }
    globalThis.WAYPOINTS_STORAGE = Object.freeze({
      read,
      save,
      importVideos,
      compact,
      changed,
      imported,
      decode,
      retentionDays,
      trash: (id) => move(id, true),
      restore: (id) => move(id, false),
      purge,
      emptyTrash,
      expire
    });
  })();
  function startAutosave(context) {
    let active = true;
    context?.onInvalidated(() => {
      active = false;
    });
    const api = globalThis.browser ?? globalThis.chrome;
    const INTERVAL_MS = 5e3;
    let lastSaved = { id: null, t: -1 };
    function currentVideoId() {
      if (location.pathname !== "/watch") return null;
      return new URLSearchParams(location.search).get("v");
    }
    let importGeneration = 0;
    let importRevision = null;
    const handledImports = /* @__PURE__ */ new Set();
    function adoptImportedPosition(request, videos) {
      if (!request || typeof request.revision !== "string") return true;
      const id = currentVideoId();
      if (!id || !request.videos || !Object.hasOwn(request.videos, id)) return true;
      const target = request.videos[id];
      const revision = target.revision || request.revision;
      if (revision !== importRevision) {
        importRevision = revision;
        handledImports.clear();
      }
      if (handledImports.has(id)) return true;
      const entry = videos[id];
      if (!entry || entry.t !== target.t || !Number.isSafeInteger(target.t) || target.t < 0) {
        handledImports.add(id);
        return true;
      }
      const video = document.querySelector("video");
      const watch = document.querySelector("ytd-watch-flexy:not([hidden])");
      if (!video || !isFinite(video.duration) || video.duration <= 0 || document.querySelector(".html5-video-player.ad-showing") || watch?.getAttribute("video-id") && watch.getAttribute("video-id") !== id)
        return false;
      try {
        video.currentTime = Math.min(video.duration, target.t);
      } catch {
        return false;
      }
      handledImports.add(id);
      lastSaved = { id: null, t: -1 };
      return true;
    }
    async function followImport() {
      const generation = importGeneration;
      const { videos = {}, importedPositions } = await WAYPOINTS_STORAGE.read();
      if (active && generation === importGeneration) adoptImportedPosition(importedPositions, videos);
    }
    const onStorageChanged = (changes, area) => {
      if (!active) return;
      if (area !== "local" || !WAYPOINTS_STORAGE.imported(changes)) return;
      importGeneration++;
      followImport().catch(() => {
      });
    };
    api.storage.onChanged.addListener(onStorageChanged);
    context?.onInvalidated(() => api.storage.onChanged.removeListener(onStorageChanged));
    followImport().catch(() => {
    });
    WAYPOINTS_STORAGE.expire().catch(() => {
    });
    async function autosave() {
      if (!active) return;
      const id = currentVideoId();
      const video = document.querySelector("video");
      if (!id || !video) return;
      const generation = importGeneration;
      const snapshot = await WAYPOINTS_STORAGE.read();
      const { videos, importedPositions } = snapshot;
      if (!active || generation !== importGeneration || currentVideoId() !== id || document.querySelector("video") !== video || !adoptImportedPosition(importedPositions, videos))
        return;
      if (document.querySelector(".html5-video-player.ad-showing")) return;
      if (!Number.isFinite(video.currentTime) || video.currentTime < 0) return;
      const t = Math.floor(video.currentTime);
      if (t < 5) return;
      let info;
      try {
        info = WAYPOINTS_PLAYER_RESULTS.metadata(WAYPOINTS_READ_METADATA(id), id);
      } catch {
        return;
      }
      if (info.t !== t) return;
      const entry = videos[id];
      if (!entry) return;
      const lifetime = JSON.stringify(snapshot.records[id].life.v);
      if (lastSaved.id === id && lastSaved.lifetime === lifetime && lastSaved.t === t && lastSaved.channelName === info.channelName && lastSaved.channelUrl === info.channelUrl)
        return;
      const duration = info.duration;
      if ((duration || entry.duration) && t > (duration || entry.duration)) return;
      if (entry.duration && duration && Math.abs(entry.duration - duration) > 2) return;
      const channel = info.channelName ? { channelName: info.channelName, channelUrl: info.channelUrl } : {};
      videos[id] = {
        ...entry,
        ...channel,
        t,
        duration: duration || entry.duration,
        updated: Date.now()
      };
      await WAYPOINTS_STORAGE.save(snapshot);
      if (generation === importGeneration)
        lastSaved = { id, t, lifetime, channelName: info.channelName, channelUrl: info.channelUrl };
    }
    function tick() {
      WAYPOINTS_STORAGE.expire().catch(() => {
      });
      const video = document.querySelector("video");
      if (video && !video.paused) autosave().catch(() => {
      });
    }
    if (context) context.setInterval(tick, INTERVAL_MS);
    else setInterval(tick, INTERVAL_MS);
    function listen(target, type, callback, capture = false) {
      target.addEventListener(type, callback, capture);
      context?.onInvalidated(() => target.removeEventListener(type, callback, capture));
    }
    listen(document, "loadedmetadata", () => autosave().catch(() => {
    }), true);
    listen(document, "pause", () => autosave().catch(() => {
    }), true);
    listen(document, "visibilitychange", () => {
      if (document.visibilityState === "hidden") autosave().catch(() => {
      });
    });
    listen(window, "pagehide", () => autosave().catch(() => {
    }));
  }
  const definition = defineContentScript({
    matches: ["*://*.youtube.com/*"],
    runAt: "document_idle",
    // WXT can signal reinjection through document events without page messages.
    noScriptStartedPostMessage: true,
    main(context) {
      startAutosave(context);
    }
  });
  function print$1(method, ...args) {
    return;
  }
  const logger$1 = {
    debug: (...args) => print$1(console.debug, ...args),
    log: (...args) => print$1(console.log, ...args),
    warn: (...args) => print$1(console.warn, ...args),
    error: (...args) => print$1(console.error, ...args)
  };
  const browser$1 = globalThis.browser?.runtime?.id ? globalThis.browser : globalThis.chrome;
  const browser = browser$1;
  var WxtLocationChangeEvent = class WxtLocationChangeEvent2 extends Event {
    static EVENT_NAME = getUniqueEventName("wxt:locationchange");
    constructor(newUrl, oldUrl) {
      super(WxtLocationChangeEvent2.EVENT_NAME, {});
      this.newUrl = newUrl;
      this.oldUrl = oldUrl;
    }
  };
  function getUniqueEventName(eventName) {
    return `${browser?.runtime?.id}:${"content"}:${eventName}`;
  }
  const supportsNavigationApi = typeof globalThis.navigation?.addEventListener === "function";
  function createLocationWatcher(ctx) {
    let lastUrl;
    let watching = false;
    return { run() {
      if (watching) return;
      watching = true;
      lastUrl = new URL(location.href);
      if (supportsNavigationApi) globalThis.navigation.addEventListener("navigate", (event) => {
        const newUrl = new URL(event.destination.url);
        if (newUrl.href === lastUrl.href) return;
        window.dispatchEvent(new WxtLocationChangeEvent(newUrl, lastUrl));
        lastUrl = newUrl;
      }, { signal: ctx.signal });
      else ctx.setInterval(() => {
        const newUrl = new URL(location.href);
        if (newUrl.href !== lastUrl.href) {
          window.dispatchEvent(new WxtLocationChangeEvent(newUrl, lastUrl));
          lastUrl = newUrl;
        }
      }, 1e3);
    } };
  }
  var ContentScriptContext = class ContentScriptContext2 {
    static SCRIPT_STARTED_MESSAGE_TYPE = getUniqueEventName("wxt:content-script-started");
    id;
    abortController;
    locationWatcher = createLocationWatcher(this);
    constructor(contentScriptName, options) {
      this.contentScriptName = contentScriptName;
      this.options = options;
      this.id = Math.random().toString(36).slice(2);
      this.abortController = new AbortController();
      this.stopOldScripts();
      this.listenForNewerScripts();
    }
    get signal() {
      return this.abortController.signal;
    }
    abort(reason) {
      return this.abortController.abort(reason);
    }
    get isInvalid() {
      if (browser.runtime?.id == null) this.notifyInvalidated();
      return this.signal.aborted;
    }
    get isValid() {
      return !this.isInvalid;
    }
    /**
    * Add a listener that is called when the content script's context is
    * invalidated.
    *
    * @example
    *   browser.runtime.onMessage.addListener(cb);
    *   const removeInvalidatedListener = ctx.onInvalidated(() => {
    *     browser.runtime.onMessage.removeListener(cb);
    *   });
    *   // ...
    *   removeInvalidatedListener();
    *
    * @returns A function to remove the listener.
    */
    onInvalidated(cb) {
      this.signal.addEventListener("abort", cb);
      return () => this.signal.removeEventListener("abort", cb);
    }
    /**
    * Return a promise that never resolves. Useful if you have an async function
    * that shouldn't run after the context is expired.
    *
    * @example
    *   const getValueFromStorage = async () => {
    *     if (ctx.isInvalid) return ctx.block();
    *
    *     // ...
    *   };
    */
    block() {
      return new Promise(() => {
      });
    }
    /**
    * Wrapper around `window.setInterval` that automatically clears the interval
    * when invalidated.
    *
    * Intervals can be cleared by calling the normal `clearInterval` function.
    */
    setInterval(handler, timeout) {
      const id = setInterval(() => {
        if (this.isValid) handler();
      }, timeout);
      this.onInvalidated(() => clearInterval(id));
      return id;
    }
    /**
    * Wrapper around `window.setTimeout` that automatically clears the interval
    * when invalidated.
    *
    * Timeouts can be cleared by calling the normal `setTimeout` function.
    */
    setTimeout(handler, timeout) {
      const id = setTimeout(() => {
        if (this.isValid) handler();
      }, timeout);
      this.onInvalidated(() => clearTimeout(id));
      return id;
    }
    /**
    * Wrapper around `window.requestAnimationFrame` that automatically cancels
    * the request when invalidated.
    *
    * Callbacks can be canceled by calling the normal `cancelAnimationFrame`
    * function.
    */
    requestAnimationFrame(callback) {
      const id = requestAnimationFrame((...args) => {
        if (this.isValid) callback(...args);
      });
      this.onInvalidated(() => cancelAnimationFrame(id));
      return id;
    }
    /**
    * Wrapper around `window.requestIdleCallback` that automatically cancels the
    * request when invalidated.
    *
    * Callbacks can be canceled by calling the normal `cancelIdleCallback`
    * function.
    */
    requestIdleCallback(callback, options) {
      const id = requestIdleCallback((...args) => {
        if (!this.signal.aborted) callback(...args);
      }, options);
      this.onInvalidated(() => cancelIdleCallback(id));
      return id;
    }
    addEventListener(target, type, handler, options) {
      if (type === "wxt:locationchange") {
        if (this.isValid) this.locationWatcher.run();
      }
      target.addEventListener?.(type.startsWith("wxt:") ? getUniqueEventName(type) : type, handler, {
        ...options,
        signal: this.signal
      });
    }
    /**
    * @internal
    * Abort the abort controller and execute all `onInvalidated` listeners.
    */
    notifyInvalidated() {
      this.abort("Content script context invalidated");
      logger$1.debug(`Content script "${this.contentScriptName}" context invalidated`);
    }
    stopOldScripts() {
      document.dispatchEvent(new CustomEvent(ContentScriptContext2.SCRIPT_STARTED_MESSAGE_TYPE, { detail: {
        contentScriptName: this.contentScriptName,
        messageId: this.id
      } }));
      if (!this.options?.noScriptStartedPostMessage) window.postMessage({
        type: ContentScriptContext2.SCRIPT_STARTED_MESSAGE_TYPE,
        contentScriptName: this.contentScriptName,
        messageId: this.id
      }, "*");
    }
    verifyScriptStartedEvent(event) {
      const isSameContentScript = event.detail?.contentScriptName === this.contentScriptName;
      const isFromSelf = event.detail?.messageId === this.id;
      return isSameContentScript && !isFromSelf;
    }
    listenForNewerScripts() {
      const cb = (event) => {
        if (!(event instanceof CustomEvent) || !this.verifyScriptStartedEvent(event)) return;
        this.notifyInvalidated();
      };
      document.addEventListener(ContentScriptContext2.SCRIPT_STARTED_MESSAGE_TYPE, cb);
      this.onInvalidated(() => document.removeEventListener(ContentScriptContext2.SCRIPT_STARTED_MESSAGE_TYPE, cb));
    }
  };
  function initPlugins() {
  }
  function print(method, ...args) {
    return;
  }
  const logger = {
    debug: (...args) => print(console.debug, ...args),
    log: (...args) => print(console.log, ...args),
    warn: (...args) => print(console.warn, ...args),
    error: (...args) => print(console.error, ...args)
  };
  const result = (async () => {
    try {
      initPlugins();
      const { main, ...options } = definition;
      return await main(new ContentScriptContext("content", options));
    } catch (err) {
      logger.error(`The content script "${"content"}" crashed on startup!`, err);
      throw err;
    }
  })();
  return result;
})();
//# sourceMappingURL=content.js.map
