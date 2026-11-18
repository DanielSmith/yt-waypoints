// Copyright 2026 Daniel Smith
// SPDX-License-Identifier: Apache-2.0
import { classifySearchInput } from "./alap-search-input.mjs";
import { createVideoSearchSnapshot } from "./alap-query.mjs";
import { prepareAlapQuery } from "./alap-query-expression.mjs";

const fingerprint = (videos) =>
  JSON.stringify(
    videos.map((video) => [
      video.id,
      video.title,
      video.channelName,
      video.channelUrl,
      video.tags,
      video.duration,
      video.updated,
      video.posted,
    ]),
  );

// Standalone handle matching preserves the pre-Alap search path. Grouping a
// macro name forces Alap, while quoting a whole query forces ordinary text.
export function classifyPopupSearch(value, macros) {
  const input = classifySearchInput(value);
  const { text } = input;
  // A bare sigil is normal while typing. Keep the list visible until a name
  // supplies a search term. The private editor retains its strict parser.
  if (text === "." || text === "@") return { kind: "text", text: "" };
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"'))
    return { kind: "text", text: text.slice(1, -1) };
  if (
    /^@[\p{L}\p{N}\p{M}_.-]+$/u.test(text) &&
    !text.includes("-.") &&
    !Object.hasOwn(macros, text.slice(1))
  )
    return { kind: "text", text };
  if (/^\.(?:\.+|[A-Z][\p{L}\p{N}_.-]*)$/u.test(text)) return { kind: "text", text };
  return input;
}

export function createAlapSearchView({
  classify = classifySearchInput,
  random = () => Math.random(),
} = {}) {
  let state;
  const invalid = (error, invalidated = false) => ({
    ids: [],
    error,
    invalidated,
    stale: invalidated,
    rootInputCount: null,
    resultCount: 0,
  });

  function read(
    { videos, macros = {}, scope, includeChannelNames = true, retired = {}, macroError },
    value,
    { refresh = false } = {},
  ) {
    const text = value.trim();
    const sameQuery = state?.text === text;
    const continuing = sameQuery && !refresh && state.scope === scope;
    try {
      // A saved view must not silently become a literal handle search after
      // its definition disappears, or adopt a changed definition on repaint.
      const input =
        sameQuery && state.expanded !== null ? { kind: "alap", text } : classify(text, macros);
      if (macroError && input.kind === "alap" && input.text.includes("@"))
        throw new Error(macroError);
      const expanded =
        input.kind === "alap" ? prepareAlapQuery(input.text, macros).expandedExpression : null;
      if (
        continuing &&
        (state.invalidated || (state.expanded !== null && expanded !== state.expanded))
      ) {
        state.invalidated = true;
        return invalid("Saved search changed. Refresh to apply its current definition.", true);
      }
      if (!continuing || !state.result.hasRefiners) {
        const result = createVideoSearchSnapshot(videos).search(input.text, {
          macros,
          includeChannelNames,
          evaluation: { random },
          literal: input.kind === "text",
        });
        state = {
          text,
          scope,
          expanded,
          result,
          retired,
          invalidated: false,
          fingerprint: result.hasRefiners ? fingerprint(videos) : null,
          dirty: false,
        };
      } else {
        state.dirty ||= fingerprint(videos) !== state.fingerprint;
        const eligible = new Set(videos.map(({ id }) => id));
        const ids = state.result.ids.filter(
          (id) => eligible.has(id) && state.retired[id] === retired[id],
        );
        state.dirty ||= ids.length !== state.result.ids.length;
        state.result.ids = ids;
      }
      const result = state.result;
      return {
        ...result,
        ids: [...result.ids],
        resultCount: result.ids.length,
        rootInputCount: state.dirty ? null : result.rootInputCount,
        stale: state.dirty,
        invalidated: false,
        error: null,
      };
    } catch (error) {
      if (sameQuery && state.expanded !== null) {
        state.invalidated = true;
        return invalid(`Saved search unavailable. ${error.message}`, true);
      }
      state = null;
      return invalid(error.message);
    }
  }

  return { read };
}
