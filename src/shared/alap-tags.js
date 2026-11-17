// Copyright 2026 Daniel Smith
// SPDX-License-Identifier: Apache-2.0
// Small validator shared with the bookmark journal and Alap contract.
(() => {
  const MAX_TAGS = 100;
  const MAX_NAME = 64;
  const NAME = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;
  const fail = (message) => {
    throw new Error(`Invalid Alap data: ${message}.`);
  };

  function validateAlapName(value) {
    if (typeof value !== "string" || value.length > MAX_NAME || !NAME.test(value)) {
      fail(
        "names require 1–64 lowercase ASCII letters/digits with single underscores between words",
      );
    }
    return value;
  }

  function normalizeVideoTags(value) {
    if (!Array.isArray(value) || value.length > MAX_TAGS) fail("expected at most 100 video tags");
    // Reject sparse arrays, getters, symbols and custom properties before access.
    for (const key of Reflect.ownKeys(value)) {
      if (key === "length") continue;
      if (typeof key !== "string" || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)
        fail("invalid tag array field");
      const d = Object.getOwnPropertyDescriptor(value, key);
      if (!d.enumerable || !Object.hasOwn(d, "value")) fail("expected tag data elements");
    }
    const tags = [];
    for (let i = 0; i < value.length; i++) {
      if (!Object.hasOwn(value, i)) fail("sparse tags are unsupported");
      tags.push(validateAlapName(value[i]));
    }
    if (new Set(tags).size !== tags.length) fail("duplicate video tag");
    return tags.sort();
  }

  globalThis.WAYPOINTS_ALAP_TAGS = Object.freeze({
    MAX_TAGS,
    MAX_NAME,
    normalizeVideoTags,
    validateAlapName,
  });
})();
