// Each suite gets fresh seed data; fixtures/VMs never cross suite boundaries.
function bookmarkSeed() {
  return {
    settings: { autoBookmark: false },
    videos: {
      a: { id: "a", title: "Dario and Daniela", t: 100, updated: 3 },
      b: { id: "b", title: "Making Videos in Resolve", t: 50, updated: 2 },
      c: { id: "c", title: "Video animation tips", t: 20, updated: 1 },
    },
  };
}

function transferSeed() {
  const a = "aaaaaaaaaaa",
    b = "bbbbbbbbbbb",
    c = "ccccccccccc",
    d = "ddddddddddd";
  const record = (id, t, updated) => ({ id, title: "Video " + id, t, duration: 1000, updated });
  const local = {
    settings: { autoBookmark: false, showThumbnails: false, includeChannelNames: false },
    videos: { [a]: record(a, 10, 100), [b]: record(b, 80, 300), [d]: record(d, 1, 9) },
  };
  return { a, b, c, d, record, local };
}

module.exports = { bookmarkSeed, transferSeed };
