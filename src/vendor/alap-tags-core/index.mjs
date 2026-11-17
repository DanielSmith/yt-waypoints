/**
 * Copyright 2026 Daniel Smith
 * SPDX-License-Identifier: Apache-2.0
 *
 * Modified Alap derivative for YT Waypoints. See PROVENANCE.json and README.md.
 * Tag sets, left-to-right operators, grouping and bounded refiners remain. There are no
 * host APIs, plugin hooks, named sources or executable query definitions.
 */
import { tokenize, parseTokens, fail } from "./syntax.mjs";
import { applyRefiners, copyFieldTypes } from "./refiners.mjs";
export { TAG_PARSER_LIMITS } from "./syntax.mjs";
const namePattern = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;

function dataField(value, name) {
  const descriptor = Object.getOwnPropertyDescriptor(value, name);
  if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) fail("expected data fields");
  return descriptor.value;
}
export class TagExpressionParser {
  #catalog = new Map();
  #fields;
  #fieldTypes;
  constructor(allLinks, { fields = ["label"], fieldTypes = {} } = {}) {
    this.#fieldTypes = copyFieldTypes(fields, fieldTypes);
    this.#fields = [...fields];
    if (!allLinks || typeof allLinks !== "object" || Array.isArray(allLinks))
      fail("expected a tag catalog");
    const prototype = Object.getPrototypeOf(allLinks);
    if (prototype !== null && prototype !== Object.prototype) fail("expected a plain catalog");
    for (const id of Reflect.ownKeys(allLinks)) {
      if (typeof id !== "string") fail("invalid catalog key");
      const record = dataField(allLinks, id);
      if (
        !record ||
        typeof record !== "object" ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(record)) ||
        Reflect.ownKeys(record).some((key) => key !== "tags" && !this.#fields.includes(key))
      )
        fail("catalog records contain only tags and allowed scalars");
      const tags = dataField(record, "tags");
      if (!Array.isArray(tags) || tags.length > 100) fail("invalid tag list");
      // Copy values without invoking accessors or array methods supplied by input.
      if (Reflect.ownKeys(tags).length !== tags.length + 1) fail("invalid tag list properties");
      const copy = [];
      for (let index = 0; index < tags.length; index++) {
        const tag = dataField(tags, String(index));
        if (typeof tag !== "string" || tag.length > 64 || !namePattern.test(tag))
          fail("invalid catalog tag");
        copy.push(tag);
      }
      const detached = { id, tags: copy };
      for (const field of this.#fields) {
        if (!Object.hasOwn(record, field)) continue;
        const value = dataField(record, field);
        if (
          value !== null &&
          (typeof value !== this.#fieldTypes[field] ||
            (typeof value === "number" && !Number.isFinite(value)))
        )
          fail("invalid catalog scalar");
        detached[field] = value;
      }
      this.#catalog.set(id, detached);
    }
  }
  query(expression, evaluation = {}) {
    return this.resolve(expression, evaluation).ids;
  }
  resolve(expression, { random = Math.random } = {}) {
    const tokens = tokenize(expression, { fields: this.#fields });
    const tree = parseTokens(tokens);
    if (typeof random !== "function") fail("invalid shuffle source");
    const result = this.#evaluate(tree, random);
    const steps = tokens.filter((token) => token.type === "REFINER");
    return {
      ids: result.ids,
      hasRefiners: steps.length > 0,
      hasShuffle: steps.some((token) => token.step.name === "shuffle"),
      refinerCount: steps.length,
      rootInputCount: result.inputCount,
      resultCount: result.ids.length,
    };
  }
  #evaluate(node, random) {
    if (node.type === "tag") {
      const ids = [];
      for (const [id, record] of this.#catalog) if (record.tags.includes(node.value)) ids.push(id);
      return { ids, inputCount: null };
    }
    let result = this.#evaluate(node.first, random).ids;
    for (const { operator, right } of node.operations) {
      const rightIds = this.#evaluate(right, random).ids,
        rightSet = new Set(rightIds);
      if (operator === "+") result = result.filter((id) => rightSet.has(id));
      else if (operator === "|") result = [...new Set([...result, ...rightIds])];
      else result = result.filter((id) => !rightSet.has(id));
    }
    const inputCount = node.refiners.length ? result.length : null;
    const ids = applyRefiners(
      result.map((id) => this.#catalog.get(id)),
      node.refiners,
      { fields: this.#fields, fieldTypes: this.#fieldTypes, random },
    ).map((record) => record.id);
    return { ids, inputCount };
  }
}
