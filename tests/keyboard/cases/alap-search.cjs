module.exports = async function alapSearch({ cases, check }) {
  const a = "aaaaaaaaaaa",
    b = "bbbbbbbbbbb",
    c = "ccccccccccc";
  const key = "waypoints.macros.v1";
  await browser.storage.local.set({
    settings: { ...settings, includeChannelNames: true, showTrash: false },
  });
  const video = (id, title, duration, updated, tags, extra = {}) => ({
    id,
    title,
    t: 1,
    duration,
    updated,
    tags,
    ...extra,
  });
  await bookmarks.importVideos(
    backupTransfer.parse(
      JSON.stringify({
        format: "yt-waypoints",
        version: 3,
        videos: {
          [a]: video(a, "Mr. Smith", 300, 30, ["work"], {
            channelUrl: "https://www.youtube.com/@Business",
          }),
          [b]: video(b, "Shortest", 100, 20, ["work", "other"]),
          [c]: video(c, "Details", 200, 10, ["work"]),
        },
        macroLibrary: {
          version: 1,
          macros: {
            business: { linkItems: ".work *sort:duration* *limit:1*" },
            sample: { linkItems: ".work *shuffle* *limit:2*" },
          },
        },
      }),
    ),
  );
  const input = document.getElementById("search");
  const feedback = document.getElementById("search-feedback");
  const refresh = document.getElementById("refresh-search");
  const ids = () =>
    [...document.querySelectorAll("#list .main")].map((row) => row.dataset.id).join();
  function search(text) {
    input.value = text;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }
  search("Mr. Smith");
  check(ids() === a, "Ordinary punctuation remains searchable");
  search("other");
  check(ids() === b, "Plain text finds saved tags");
  search("(.work + .other)");
  check(ids() === b, "Grouped tag expression");
  search("@Business");
  check(ids() === a, "Original handle search works");
  search("@business");
  check(ids() === b && feedback.textContent === "1 of 3 matches", "Exact macro beats handle");
  search('"@business"');
  check(ids() === a, "Quoted handle bypasses macro");
  await browser.storage.local.set({ settings: { ...settings, includeChannelNames: false } });
  await render();
  check(ids() === "", "Literal handle obeys channel setting");
  search("(@missing)");
  check(input.getAttribute("aria-invalid") === "true", "Explicit unknown macro error");
  search(".missing");
  check(
    input.getAttribute("aria-invalid") === "false" && /No matching videos/.test(listEl.textContent),
    "Empty matches differ from errors",
  );
  cases.push("legacy text, tags, exact macro and quoted handle dispatch");

  const random = Math.random;
  let draws = 0;
  Math.random = () => {
    draws++;
    return 0;
  };
  search("@sample");
  const chosen = ids();
  check(chosen === [b, c].join() && draws === 2, "Controlled shuffle selected two rows");
  const snapshot = await WAYPOINTS_STORAGE.read();
  snapshot.videos[c].t = 10;
  snapshot.videos[c].updated = 50;
  await WAYPOINTS_STORAGE.save(snapshot);
  await render();
  check(
    ids() === chosen && draws === 2 && /Refresh to update/.test(feedback.textContent),
    "Playback repaint does not reshuffle",
  );
  await WAYPOINTS_STORAGE.trash(b);
  await render();
  check(ids() === c && draws === 2, "Hidden trash prunes the row without refilling");
  refresh.click();
  check(
    ids() === [a, c].join() && draws === 3 && document.activeElement === input,
    "Refresh evaluates the current eligible set and restores search focus",
  );
  Math.random = random;
  await browser.storage.local.set({ settings: { ...settings, showTrash: true } });
  await render();
  search(".work *sort:duration* *limit:2*");
  check(
    ids() === [b, c].join() && document.querySelector("#list .trash-row .main").dataset.id === b,
    "Visible trash keeps styling without regrouping refined results",
  );
  cases.push("stable shuffle, explicit refresh, and trash eligibility");

  search("@business");
  const raw = (await browser.storage.local.get(key))[key];
  raw.library.macros.business.linkItems = ".work *sort:duration* *reverse* *limit:1*";
  await browser.storage.local.set({ [key]: { ...raw, revision: "search-test-revision" } });
  await render();
  check(
    ids() === "" && /Saved search changed/.test(feedback.textContent),
    "Changed macro invalidates the open view",
  );
  refresh.click();
  check(
    ids() === a && input.getAttribute("aria-invalid") === "false",
    "Refresh adopts the changed macro",
  );
  search("");
  cases.push("saved macro revisions require refresh");
};
