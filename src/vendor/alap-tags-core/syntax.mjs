// Copyright 2026 Daniel Smith. SPDX-License-Identifier: Apache-2.0
// Strict, bounded grammar for the pruned Alap profile. No evaluation or I/O.
export const TAG_PARSER_LIMITS = Object.freeze({
  characters: 16384,
  tokens: 1024,
  groups: 32,
  refiners: 32,
  count: 1000000,
});
export const fail = (message) => {
  throw new Error(`Invalid tag expression: ${message}.`);
};
const namePattern = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;

export function parseRefinerStep(value, fields = ["label"]) {
  const [name, ...args] = value.split(":");
  if (name === "sort") {
    if (args.length > 1 || !fields.includes(args[0] ?? "label"))
      fail("unknown sort field or arguments");
    return { name, args: [args[0] ?? "label"] };
  }
  if (name === "reverse" || name === "shuffle") {
    if (args.length) fail(`${name} takes no arguments`);
    return { name, args };
  }
  if (name === "limit" || name === "skip") {
    if (args.length !== 1 || !/^[0-9]+$/.test(args[0]) || Number(args[0]) > TAG_PARSER_LIMITS.count)
      fail(`${name} needs an integer from 0 to ${TAG_PARSER_LIMITS.count}`);
    return { name, args: [Number(args[0])] };
  }
  fail("unsupported refiner");
}

export function tokenize(
  expression,
  { macros = false, fields = ["label"], characters = TAG_PARSER_LIMITS.characters } = {},
) {
  if (
    typeof expression !== "string" ||
    !expression.trim() ||
    expression.length > characters ||
    /[^\x20-\x7e\t\r\n]/.test(expression)
  )
    fail("empty, invalid or oversized expression");
  const tokens = [];
  let position = 0,
    refiners = 0;
  while (position < expression.length) {
    const ch = expression[position];
    if (/[ \t\r\n]/.test(ch)) {
      position++;
      continue;
    }
    if (tokens.length >= TAG_PARSER_LIMITS.tokens) fail("too many expression tokens");
    if ("+|-()".includes(ch)) {
      tokens.push({ type: ch });
      position++;
      continue;
    }
    if (ch === "." || (macros && ch === "@")) {
      const match = /^[a-z0-9_]+/.exec(expression.slice(position + 1));
      if (!match || match[0].length > 64 || !namePattern.test(match[0]))
        fail("expected canonical tag or macro name");
      tokens.push({ type: ch === "." ? "CLASS" : "MACRO", value: match[0] });
      position += match[0].length + 1;
      continue;
    }
    if (ch === "*") {
      const end = expression.indexOf("*", position + 1);
      if (end < 0) fail("unclosed refiner");
      if (++refiners > TAG_PARSER_LIMITS.refiners) fail("too many refiners");
      tokens.push({
        type: "REFINER",
        step: parseRefinerStep(expression.slice(position + 1, end), fields),
      });
      position = end + 1;
      continue;
    }
    fail("unsupported character");
  }
  return tokens;
}

// Build the entire tree before evaluation, so invalid tails cannot run stages.
export function parseTokens(tokens, { modifier = false } = {}) {
  let pos = 0;
  function stages() {
    const result = [];
    while (tokens[pos]?.type === "REFINER") result.push(tokens[pos++].step);
    return result;
  }
  function term(depth) {
    const token = tokens[pos++];
    if (token?.type === "CLASS") return { type: "tag", value: token.value };
    if (token?.type === "(") {
      if (depth >= TAG_PARSER_LIMITS.groups) fail("invalid or excessive grouping");
      const node = segment(depth + 1);
      if (tokens[pos++]?.type !== ")") fail("unclosed group");
      return node;
    }
    fail("expected a tag or group");
  }
  function segment(depth) {
    const first = term(depth),
      operations = [];
    while (["+", "|", "-"].includes(tokens[pos]?.type)) {
      const operator = tokens[pos++].type;
      operations.push({ operator, right: term(depth) });
    }
    return { type: "segment", first, operations, refiners: stages() };
  }
  const tree =
    modifier && tokens[0]?.type === "REFINER"
      ? { type: "modifier", refiners: stages() }
      : segment(0);
  if (pos !== tokens.length) fail("unexpected trailing token or missing operator");
  return tree;
}

export function inspectExpression(expression, options = {}) {
  const tokens = tokenize(expression, options);
  const references = [
    ...new Set(tokens.filter((token) => token.type === "MACRO").map((token) => token.value)),
  ].sort();
  // References can expand to terms OR trailing modifiers. Full grammar is checked
  // after bounded substitution; treating every @ as an atom would break modifiers.
  const tree = references.length ? null : parseTokens(tokens, options);
  return {
    expression: expression.trim(),
    references,
    kind: tree?.type === "modifier" ? "modifier" : tree ? "view" : "unresolved",
  };
}
