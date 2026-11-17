// Copyright 2026 Daniel Smith
// SPDX-License-Identifier: Apache-2.0
// One reader/commit path for action refreshes and storage notifications.
// A request invalidates earlier reads even when its eventual flush is deferred.
export function createPopupRefresh({ read, commit }) {
  let requested = 0;
  let committed = 0;
  let inFlight = null;

  async function drain() {
    while (committed < requested) {
      const revision = requested;
      let snapshot;
      try {
        snapshot = await read();
      } catch (error) {
        // An obsolete read failure must not discard a newer pending request.
        if (revision !== requested) continue;
        throw error;
      }
      if (revision !== requested) continue;
      commit(snapshot);
      committed = revision;
    }
  }

  function flush() {
    if (!inFlight) {
      const run = Promise.resolve().then(drain);
      inFlight = run;
      const clear = () => {
        if (inFlight === run) inFlight = null;
      };
      run.then(clear, clear);
    }
    return inFlight.then(() => {
      // A request can arrive after drain's last check but before its promise
      // settles. Its caller must still await a fresh read, rather than lose it.
      if (committed < requested) return flush();
    });
  }

  function refresh() {
    requested++;
    return flush();
  }

  function schedule(after = Promise.resolve()) {
    const revision = ++requested;
    const whenReady = () => (committed < revision ? flush() : undefined);
    // Local actions may perform their own awaited refresh. Waiting for them
    // lets that read satisfy their storage notification without a second paint.
    return Promise.resolve(after).then(whenReady, whenReady);
  }

  return Object.freeze({ refresh, schedule });
}
