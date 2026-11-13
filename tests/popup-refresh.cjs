const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

async function settle() {
  for (let index = 0; index < 20; index++) await Promise.resolve();
}

(async () => {
  const { createPopupRefresh } = await import(
    pathToFileURL(path.resolve(__dirname, "../src/shared/popup-refresh.mjs"))
  );
  function fixture(onCommit) {
    const reads = [];
    const commits = [];
    const coordinator = createPopupRefresh({
      read() {
        const request = deferred();
        reads.push(request);
        return request.promise;
      },
      commit(snapshot) {
        commits.push(snapshot);
        onCommit?.(snapshot);
      },
    });
    return { ...coordinator, reads, commits };
  }

  // Synchronous bursts collapse before a read starts, without changing values.
  const burst = fixture();
  const burstWaiters = Array.from({ length: 20 }, () => burst.refresh());
  assert.equal(burst.reads.length, 0);
  await settle();
  assert.equal(burst.reads.length, 1);
  const snapshot = { videos: { example: { title: "Latest burst" } } };
  burst.reads[0].resolve(snapshot);
  await Promise.all(burstWaiters);
  assert.deepEqual(burst.commits, [snapshot]);
  assert.equal(burst.commits[0], snapshot, "commit must retain the original snapshot identity");
  console.log("PASS: refresh bursts share one read and preserve snapshot identity");

  // Requests during each read invalidate its result. Nobody completes until a
  // fresh read covering the latest request is committed.
  const overlapping = fixture();
  let firstDone = false;
  const first = overlapping.refresh().then(() => {
    firstDone = true;
  });
  await settle();
  const second = overlapping.refresh();
  await settle();
  assert.equal(overlapping.reads.length, 1, "only one read may be in flight");
  overlapping.reads[0].resolve("stale first");
  await settle();
  assert.deepEqual(overlapping.commits, []);
  assert.equal(firstDone, false);
  assert.equal(overlapping.reads.length, 2);
  const third = overlapping.refresh();
  overlapping.reads[1].resolve("stale second");
  await settle();
  assert.deepEqual(overlapping.commits, []);
  assert.equal(overlapping.reads.length, 3);
  overlapping.reads[2].resolve("current");
  await Promise.all([first, second, third]);
  assert.deepEqual(overlapping.commits, ["current"]);
  console.log("PASS: requests during reads suppress stale commits and await a current snapshot");

  // Deferred notification invalidation is immediate, even before its barrier
  // settles. An action can refresh the changed state and cover the notification.
  const local = fixture();
  const action = deferred();
  const actionStart = local.refresh();
  await settle();
  const notified = local.schedule(action.promise);
  local.reads[0].resolve("invalidated by notification");
  await settle();
  assert.deepEqual(local.commits, []);
  assert.equal(local.reads.length, 2);
  local.reads[1].resolve("updated action state");
  await actionStart;
  action.resolve();
  await notified;
  assert.equal(local.reads.length, 2, "notification must not reread an already committed revision");
  assert.deepEqual(local.commits, ["updated action state"]);

  const settings = fixture();
  const save = deferred();
  const saveNotification = settings.schedule(save.promise);
  const saveRefresh = settings.refresh();
  await settle();
  assert.equal(settings.reads.length, 1);
  settings.reads[0].resolve("saved setting");
  await saveRefresh;
  save.resolve();
  await saveNotification;
  assert.equal(settings.reads.length, 1);
  assert.deepEqual(settings.commits, ["saved setting"]);
  console.log(
    "PASS: deferred storage notifications invalidate immediately and share an action refresh",
  );

  const deferredNotices = fixture();
  const work = deferred();
  const notices = Array.from({ length: 10 }, () => deferredNotices.schedule(work.promise));
  await settle();
  assert.equal(
    deferredNotices.reads.length,
    0,
    "idle deferred notifications must wait for their action",
  );
  work.resolve();
  await settle();
  assert.equal(deferredNotices.reads.length, 1);
  deferredNotices.reads[0].resolve("state after action");
  await Promise.all(notices);
  assert.deepEqual(deferredNotices.commits, ["state after action"]);

  // Notifications without local actions must still flush. A notification that
  // arrives after an action's final read also needs its own fresh read.
  const external = fixture();
  const externalWaiters = Array.from({ length: 20 }, () => external.schedule());
  await settle();
  assert.equal(external.reads.length, 1);
  external.reads[0].resolve("external update");
  await Promise.all(externalWaiters);
  const lateNotice = external.schedule();
  await settle();
  assert.equal(external.reads.length, 2);
  external.reads[1].resolve("later external update");
  await lateNotice;
  assert.deepEqual(external.commits, ["external update", "later external update"]);
  console.log("PASS: external notification bursts and later changes are not lost");

  // A failure of an invalidated read does not discard a newer pending request.
  const staleFailure = fixture();
  const staleFailureFirst = staleFailure.refresh();
  await settle();
  const staleFailureLatest = staleFailure.refresh();
  staleFailure.reads[0].reject(new Error("obsolete failure"));
  await settle();
  assert.equal(staleFailure.reads.length, 2);
  staleFailure.reads[1].resolve("recovered latest");
  await Promise.all([staleFailureFirst, staleFailureLatest]);
  assert.deepEqual(staleFailure.commits, ["recovered latest"]);

  // Current failures reach callers without spinning, and do not poison future work.
  const recovery = fixture();
  const failed = recovery.refresh();
  const rejected = assert.rejects(failed, /current storage failure/);
  await settle();
  recovery.reads[0].reject(new Error("current storage failure"));
  await rejected;
  await settle();
  assert.equal(recovery.reads.length, 1);
  assert.deepEqual(recovery.commits, []);
  const retry = recovery.refresh();
  await settle();
  recovery.reads[1].resolve("next successful request");
  await retry;
  assert.deepEqual(recovery.commits, ["next successful request"]);

  const failedAction = fixture();
  const barrier = deferred();
  const afterFailedAction = failedAction.schedule(barrier.promise);
  barrier.reject(new Error("action failed after writing"));
  await settle();
  failedAction.reads[0].resolve("partially completed action state");
  await afterFailedAction;
  assert.deepEqual(failedAction.commits, ["partially completed action state"]);
  console.log(
    "PASS: obsolete failures retry, current failures surface, and later refreshes recover",
  );

  // A request queued by commit can land between drain completion and its promise
  // cleanup. It must get a fresh read and its own completion barrier.
  let boundaryRequest;
  const boundary = fixture((value) => {
    if (value === "first commit")
      Promise.resolve().then(() => {
        boundaryRequest = boundary.refresh();
      });
  });
  const boundaryFirst = boundary.refresh();
  await settle();
  boundary.reads[0].resolve("first commit");
  await settle();
  assert.ok(boundaryRequest);
  assert.equal(boundary.reads.length, 2);
  boundary.reads[1].resolve("boundary request");
  await Promise.all([boundaryFirst, boundaryRequest]);
  assert.deepEqual(boundary.commits, ["first commit", "boundary request"]);
  console.log("PASS: requests at drain completion are not lost");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
