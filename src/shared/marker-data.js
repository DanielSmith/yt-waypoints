// Marker transfer/storage contract. No page access, UI, or playback side effects.
(() => {
  // Structural safety ceiling; the existing 5-million-character transfer and
  // browser storage quotas constrain real payloads well before this count.
  const MAX_MARKERS = 100000;
  const MAX_TIME = 315576000;
  const own = (object, key) => {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    if (!descriptor) return undefined;
    if (!Object.hasOwn(descriptor, "value")) throw new Error(`Invalid marker ${key}.`);
    return descriptor.value;
  };
  function text(value, name, limit) {
    if (
      typeof value !== "string" ||
      value.length > limit ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)
    ) {
      throw new Error(`Invalid ${name}.`);
    }
    return value;
  }
  function note(value) {
    return text(value, "annotation", 10000);
  }
  function chapterId(t) {
    return `c:${Math.round(t * 1000)}`;
  }
  function normalize(markers) {
    if (!Array.isArray(markers) || markers.length > MAX_MARKERS) {
      throw new Error(`Invalid markers (maximum ${MAX_MARKERS}).`);
    }
    const seen = new Set();
    return Array.from(markers, (marker) => {
      if (!marker || typeof marker !== "object" || Array.isArray(marker))
        throw new Error("Invalid marker.");
      const id = own(marker, "id"),
        t = own(marker, "t"),
        origin = own(marker, "origin");
      if (
        typeof id !== "string" ||
        !/^(?:u:[A-Za-z0-9_-]{1,80}|c:\d{1,12})$/.test(id) ||
        seen.has(id)
      ) {
        throw new Error("Invalid or duplicate marker ID.");
      }
      if (
        typeof t !== "number" ||
        !Number.isFinite(t) ||
        t < 0 ||
        t > MAX_TIME ||
        Math.abs(t * 1000 - Math.round(t * 1000)) > 0.000001
      ) {
        throw new Error("Invalid marker timestamp.");
      }
      // A changed/unknown video duration must not silently move stored markers.
      if (origin !== "chapter" && origin !== "user") throw new Error("Invalid marker origin.");
      if (
        (origin === "chapter" && id !== chapterId(t)) ||
        (origin === "user" && !id.startsWith("u:"))
      ) {
        throw new Error("Marker identity does not match its origin/time.");
      }
      seen.add(id);
      const clean = { id, t, origin };
      for (const [key, limit] of [
        ["title", 1000],
        ["label", 200],
        ["note", 10000],
      ]) {
        const value = own(marker, key);
        if (value !== undefined) clean[key] = text(value, `marker ${key}`, limit);
      }
      const removed = own(marker, "removed");
      if (removed !== undefined) {
        if (typeof removed !== "boolean") throw new Error("Invalid marker removal state.");
        clean.removed = removed;
      }
      return clean;
    }).sort((a, b) => a.t - b.t || a.id.localeCompare(b.id));
  }
  function merge(local = [], incoming = []) {
    const markers = new Map(normalize(local).map((marker) => [marker.id, marker]));
    // Import is an explicit choice: matching incoming IDs replace their marker;
    // omitted IDs preserve local points and chapter-removal records.
    for (const marker of normalize(incoming)) markers.set(marker.id, marker);
    return normalize([...markers.values()]);
  }
  function anchor(markers, currentId) {
    const marker = normalize(markers).find((item) => item.id === currentId && !item.removed);
    return marker ? { markerId: marker.id, t: marker.t } : { markerId: null, t: 0 };
  }
  function refreshChapters(local, chapters) {
    const markers = new Map(normalize(local).map((marker) => [marker.id, marker]));
    for (const chapter of normalize(chapters)) {
      if (chapter.origin !== "chapter") throw new Error("Invalid chapter refresh.");
      // Page-derived titles may change; page data cannot overwrite personal
      // labels, notes, or a local removal. Missing old points are retained.
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
    refreshChapters,
    MAX_MARKERS,
  });
})();
