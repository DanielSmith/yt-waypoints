// Copyright 2026 Daniel Smith
// SPDX-License-Identifier: Apache-2.0
// Headless search owner. Callers supply eligible videos in their base display
// order; refined results preserve evaluator order. No storage or view cache here.
import { ALAP_SORT_FIELDS, ALAP_SORT_TYPES } from "./alap-refiner-profile.mjs";
import { TagExpressionParser } from "../vendor/alap-tags-core/index.mjs";
import { classifySearchInput } from "./alap-search-input.mjs";
import { prepareAlapQuery } from "./alap-query-expression.mjs";
import { createVideoCatalog, matchVideoText } from "./alap-video-catalog.mjs";

// Detached snapshot for one committed view. R3 owns when to replace the snapshot
// or re-evaluate a shuffled query; rerenders should reuse its previous result.
export function createVideoSearchSnapshot(videos) {
  const catalog = createVideoCatalog(videos);
  let parser;
  return Object.freeze({
    search(
      value,
      { macros = {}, includeChannelNames = true, evaluation = {}, literal = false } = {},
    ) {
      const input = classifySearchInput(value);
      if (literal || input.kind === "text") {
        const ids = matchVideoText(catalog.records, input.text, { includeChannelNames });
        return {
          kind: "text",
          ids,
          hasRefiners: false,
          hasShuffle: false,
          refinerCount: 0,
          rootInputCount: null,
          resultCount: ids.length,
        };
      }
      const prepared = prepareAlapQuery(input.text, macros);
      parser ??= new TagExpressionParser(catalog.allLinks, {
        fields: ALAP_SORT_FIELDS,
        fieldTypes: ALAP_SORT_TYPES,
      });
      const resolved = parser.resolve(prepared.expandedExpression, evaluation);
      const ordered = resolved.ids.map((key) => catalog.videoIds.get(key));
      const matching = new Set(ordered);
      // Preserve historical caller ordering for unrefined queries only.
      const ids = resolved.hasRefiners
        ? ordered
        : catalog.records.filter((record) => matching.has(record.id)).map((record) => record.id);
      return { ...resolved, kind: "alap", ids };
    },
  });
}
export function searchVideos(videos, value, options = {}) {
  return createVideoSearchSnapshot(videos).search(value, options);
}
