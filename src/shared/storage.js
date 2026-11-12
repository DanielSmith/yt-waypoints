// Shared bookmark mutations without a background process or read/modify/write lock.
// Each write owns a unique key. Reads merge field versions and bookmark lifetimes;
// deletion/import/re-add starts a new lifetime, so stale patches cannot revive it.
(() => {
  const api = globalThis.browser ?? globalThis.chrome;
  const PREFIX = "waypoints.bookmarks.v2:";
  const LEGACY = [0, "legacy"];
  const COMPACT_AT = 64;
  const cloneJson = (value) => JSON.parse(JSON.stringify(value));
  const compareVersions = (leftVersion, rightVersion) =>
    leftVersion[0] - rightVersion[0] ||
    (leftVersion[1] < rightVersion[1] ? -1 : leftVersion[1] > rightVersion[1] ? 1 : 0);
  const sameVersion = (leftVersion, rightVersion) =>
    compareVersions(leftVersion, rightVersion) === 0;
  const sameValue = (leftValue, rightValue) =>
    JSON.stringify(leftValue) === JSON.stringify(rightValue);

  // Version each marker property independently. Playback writes never touch
  // these fields; simultaneous edits to different markers/notes can both win.
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
    const video = Object.create(null);
    const markers = new Map();
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

  // Keep the persisted field key `v`; callers supply the field-version tuple.
  function versionedFields(video, fieldVersion) {
    return Object.fromEntries(
      Object.entries(flattenVideo(video)).map(([name, value]) => [
        name,
        { v: fieldVersion, value },
      ]),
    );
  }

  function nextLifetime(snapshot, id, automatic = false) {
    // Per-video generations keep transitions ordered independently of edits in
    // other videos. At the same generation, explicit restore beats timed expiry.
    return [
      (snapshot.records[id]?.life.v[0] || 0) + 1,
      (automatic ? "0:" : "1:") + crypto.randomUUID(),
    ];
  }

  function mergeRecord(left, right) {
    if (!left) return cloneJson(right);
    const order = compareVersions(left.life.v, right.life.v);
    const result = cloneJson(order < 0 ? right : left);
    if (order === 0) {
      for (const [name, field] of Object.entries(right.fields)) {
        if (!result.fields[name] || compareVersions(field.v, result.fields[name].v) > 0) {
          result.fields[name] = cloneJson(field);
        }
      }
    }
    // Keep the purge boundary even after a deliberate re-add. Older payloads
    // must be removed from storage, not merely hidden from the materialized list.
    const boundaries = [
      left.purged,
      right.purged,
      left.life.deleted ? left.life.v : null,
      right.life.deleted ? right.life.v : null,
    ].filter(Boolean);
    if (boundaries.length)
      result.purged = boundaries.reduce((a, b) => (compareVersions(a, b) > 0 ? a : b));
    return result;
  }

  function decode(raw) {
    const records = Object.create(null);
    for (const [id, video] of Object.entries(raw.videos || {})) {
      records[id] = {
        life: {
          v: LEGACY,
          deleted: false,
          ...(raw.importedPositions?.videos?.[id]
            ? {
                imported: raw.importedPositions.videos[id],
                importRevision: raw.importedPositions.revision,
              }
            : {}),
        },
        fields: versionedFields(video, LEGACY),
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
    const videos = Object.create(null);
    const trash = Object.create(null);
    const trashTimes = Object.create(null);
    const targets = Object.create(null);
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
      const imported =
        record.life.imported ||
        (sameVersion(record.life.v, LEGACY) ? raw.importedPositions?.videos?.[id] : null);
      if (imported) {
        targets[id] = {
          ...imported,
          revision: sameVersion(record.life.v, LEGACY)
            ? record.life.importRevision || raw.importedPositions?.revision
            : JSON.stringify(record.life.v),
        };
        revisions.push([
          id,
          sameVersion(record.life.v, LEGACY)
            ? record.life.importRevision || raw.importedPositions?.revision
            : record.life.v,
        ]);
      }
    }
    const importedPositions = revisions.length
      ? {
          revision: JSON.stringify(revisions.sort(([a], [b]) => a.localeCompare(b))),
          videos: targets,
        }
      : null;
    const legacyKeys = ["videos", "importedPositions"].filter((key) => Object.hasOwn(raw, key));
    const retiredPayload =
      Object.entries(raw.videos || {}).some(([id]) => records[id]?.purged) ||
      keys.some((key) =>
        Object.entries(raw[key].records).some(([id, record]) => {
          const purged = records[id]?.purged;
          return (
            purged &&
            compareVersions(record.life.v, purged) <= 0 &&
            (Object.keys(record.fields).length > 0 || record.life.imported)
          );
        }),
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
      settings: raw.settings || {},
    };
  }

  async function read() {
    const snapshot = decode(await api.storage.local.get(null));
    // Original values are private to this snapshot, for field-specific diffs.
    snapshot.original = cloneJson(snapshot.videos);
    return snapshot;
  }

  async function compact(force = false, retries = 2) {
    const snapshot = await read();
    if (!force && snapshot.keys.length < COMPACT_AT && !snapshot.retiredPayload) return;
    // Durably checkpoint all live/trash data before removing its source keys,
    // including the old recovery baseline. Tombstones contain identity only.
    const key = PREFIX + crypto.randomUUID();
    await api.storage.local.set({
      [key]: {
        version: 2,
        kind: "checkpoint",
        clock: snapshot.clock,
        records: snapshot.records,
      },
    });
    await api.storage.local.remove([...snapshot.keys, ...snapshot.legacyKeys]);
    // An older in-flight writer/compactor may have published retired content
    // during cleanup. Its own completion also runs this check.
    if (retries > 0 && (await read()).retiredPayload) await compact(true, retries - 1);
  }

  async function write(records, clock, kind, purge = false) {
    if (!Object.keys(records).length) return;
    await api.storage.local.set({
      [PREFIX + crypto.randomUUID()]: { version: 2, kind, clock, records },
    });
    try {
      await compact(purge);
    } catch (error) {
      if (purge)
        throw new Error(
          "Deletion recorded, but stored-content cleanup failed. Retry Empty trash. " +
            error.message,
        );
      // A failed routine checkpoint does not undo a successful edit.
    }
  }

  async function save(snapshot) {
    const v = [snapshot.clock + 1, crypto.randomUUID()];
    const records = Object.create(null);
    for (const id of new Set([
      ...Object.keys(snapshot.original),
      ...Object.keys(snapshot.videos),
    ])) {
      const before = snapshot.original[id];
      const after = snapshot.videos[id];
      if (sameValue(before, after)) continue;
      if (!before || !after) {
        const lifeVersion = nextLifetime(snapshot, id);
        records[id] = {
          life: { v: lifeVersion, deleted: !after },
          ...(!after ? { purged: lifeVersion } : {}),
          fields: after ? versionedFields(after, v) : {},
        };
        continue;
      }
      const fields = Object.create(null);
      const beforeFields = flattenVideo(before);
      const afterVideo = { ...after };
      if (before.markers) {
        const next = new Map(
          (Object.hasOwn(after, "markers") ? WAYPOINTS_MARKERS.normalize(after.markers) : []).map(
            (marker) => [marker.id, marker],
          ),
        );
        for (const marker of before.markers) {
          if (!next.has(marker.id)) next.set(marker.id, { ...marker, removed: true });
        }
        afterVideo.markers = [...next.values()];
      }
      const afterFields = flattenVideo(afterVideo);
      for (const name of new Set([...Object.keys(beforeFields), ...Object.keys(afterFields)])) {
        if (sameValue(beforeFields[name], afterFields[name])) continue;
        fields[name] = Object.hasOwn(afterFields, name)
          ? { v, value: afterFields[name] }
          : { v, removed: true };
      }
      records[id] = { life: snapshot.records[id].life, fields };
    }
    await write(
      records,
      v[0],
      "edit",
      Object.values(records).some((record) => record.life.deleted),
    );
  }

  async function importVideos(incoming) {
    const snapshot = await read();
    const { videos, counts } = WAYPOINTS_TRANSFER.merge(snapshot.videos, incoming);
    const v = [snapshot.clock + 1, crypto.randomUUID()];
    const records = Object.create(null);
    const positions = Object.create(null);
    for (const id of Object.keys(incoming)) {
      const video = videos[id];
      positions[id] = { t: video.t, duration: video.duration };
      // Even identical reimports start a new lifetime and renew player adoption.
      records[id] = {
        life: { v: nextLifetime(snapshot, id), deleted: false, imported: positions[id] },
        fields: versionedFields(video, v),
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
      ...(toTrash ? { trashedAt: Date.now() } : {}),
    };
    await write(
      {
        [id]: {
          life,
          fields: versionedFields(video, v),
        },
      },
      v[0],
      toTrash ? "trash" : "restore",
    );
    return true;
  }

  async function purge(ids, snapshot, automatic = false) {
    snapshot ||= await read();
    const v = [snapshot.clock + 1, crypto.randomUUID()];
    const records = Object.create(null);
    for (const id of ids) {
      if (!snapshot.videos[id] && !snapshot.trash[id]) continue;
      const lifeVersion = nextLifetime(snapshot, id, automatic);
      records[id] = { life: { v: lifeVersion, deleted: true }, purged: lifeVersion, fields: {} };
    }
    if (Object.keys(records).length) await write(records, v[0], "purge", true);
    else if (snapshot.retiredPayload) await compact(true); // Retry an earlier failed cleanup.
    const current = await read();
    return Object.keys(records).filter((id) => current.records[id]?.life.deleted).length;
  }

  async function emptyTrash() {
    const snapshot = await read();
    return purge(Object.keys(snapshot.trash), snapshot, true);
  }

  async function expire(now = Date.now()) {
    const snapshot = await read();
    const duration = retentionDays(snapshot.settings.trashDays) * 86400000;
    const ids = Object.keys(snapshot.trash).filter(
      (id) => snapshot.trashTimes[id] + duration <= now,
    );
    return ids.length ? purge(ids, snapshot, true) : 0;
  }

  function changed(changes) {
    return Boolean(changes.videos || Object.keys(changes).some((key) => key.startsWith(PREFIX)));
  }

  function imported(changes) {
    return Boolean(
      changes.importedPositions ||
      Object.entries(changes).some(
        ([key, change]) => key.startsWith(PREFIX) && change.newValue?.kind === "import",
      ),
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
    expire,
  });
})();
