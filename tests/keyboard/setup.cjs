// Runs before the production module in a disposable page, never a user profile.
module.exports = function setupFixture() {
  const data = {
    settings: { autoBookmark: false, showThumbnails: false, scrubSeconds: 7, shiftMultiplier: 4 },
    videos: {
      aaaaaaaaaaa: {
        id: "aaaaaaaaaaa",
        title: "Keyboard regression fixture",
        t: 100,
        duration: 1000,
        updated: 1,
      },
    },
  };
  const subscribers = [];
  const fixture = (globalThis.keyboardFixture = {
    operations: [],
    open: true,
    position: 700,
    settingsWrites: 0,
  });
  const api = {
    runtime: { getManifest: () => ({ version: "test" }) },
    storage: {
      local: {
        async get(keys) {
          return structuredClone(
            keys == null
              ? data
              : Object.fromEntries(
                  (Array.isArray(keys) ? keys : [keys]).map((key) => [key, data[key]]),
                ),
          );
        },
        async set(values) {
          if (Object.hasOwn(values, "settings")) fixture.settingsWrites++;
          const changes = {};
          for (const [key, value] of Object.entries(values)) {
            changes[key] = { newValue: structuredClone(value) };
            data[key] = structuredClone(value);
          }
          subscribers.forEach((fn) => fn(changes, "local"));
        },
        async remove(keys) {
          const changes = {};
          for (const key of keys) {
            changes[key] = { oldValue: data[key] };
            delete data[key];
          }
          subscribers.forEach((fn) => fn(changes, "local"));
        },
      },
      onChanged: { addListener: (fn) => subscribers.push(fn) },
    },
    tabs: {
      async query(query) {
        return query.active
          ? [{ id: 1, url: "https://example.com/" }]
          : fixture.open
            ? [{ id: 7, url: "https://www.youtube.com/watch?v=aaaaaaaaaaa" }]
            : [];
      },
    },
    scripting: {
      async executeScript(request) {
        const operation = request.func.name;
        if (operation === "chapters")
          return [
            {
              frameId: 0,
              result: { id: "aaaaaaaaaaa", duration: 1000, available: false, chapters: [] },
            },
          ];
        fixture.operations.push({ operation, args: request.args });
        if (operation === "seek") fixture.position += request.args[0];
        else if (operation === "seekTo") fixture.position = request.args[0];
        else if (operation !== "position") throw Error("Unexpected operation: " + operation);
        fixture.position = Math.min(1000, Math.max(0, fixture.position));
        return [
          {
            frameId: 0,
            result: { id: "aaaaaaaaaaa", t: fixture.position, duration: 1000, paused: true },
          },
        ];
      },
    },
  };
  // The platform adapter chooses the browser API; supplying browser works for
  // both adapters without touching Chrome's real extension APIs or accounts.
  globalThis.browser = api;
};
