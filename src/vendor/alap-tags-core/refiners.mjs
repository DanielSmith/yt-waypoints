/**
 * Copyright 2026 Daniel Smith. SPDX-License-Identifier: Apache-2.0
 * Derived from Alap RefinerPipeline.ts; see PROVENANCE.json.
 * Only the five reviewed local operations remain. Argument checking is strict.
 */
import { fail, parseRefinerStep, TAG_PARSER_LIMITS } from "./syntax.mjs";

const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });

// Descriptor values are type names, never user-supplied comparator functions.
export function copyFieldTypes(fields, fieldTypes = {}) {
  if (
    !Array.isArray(fields) ||
    !fields.length ||
    fields.length > 32 ||
    new Set(fields).size !== fields.length ||
    fields.some(
      (field) =>
        typeof field !== "string" ||
        field.length > 64 ||
        !/^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(field) ||
        ["id", "tags"].includes(field),
    )
  )
    fail("invalid sort field names");
  if (
    !fieldTypes ||
    typeof fieldTypes !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(fieldTypes))
  )
    fail("invalid sort types");
  const result = Object.create(null);
  for (const key of Reflect.ownKeys(fieldTypes)) {
    if (!fields.includes(key)) fail("unknown sort type field");
    const descriptor = Object.getOwnPropertyDescriptor(fieldTypes, key);
    if (
      !descriptor.enumerable ||
      !Object.hasOwn(descriptor, "value") ||
      !["number", "string"].includes(descriptor.value)
    )
      fail("invalid sort type");
  }
  for (const field of fields)
    result[field] = Object.hasOwn(fieldTypes, field) ? fieldTypes[field] : "string";
  return result;
}

export function applyRefiners(
  items,
  steps,
  { fields = ["label"], fieldTypes = {}, random = Math.random } = {},
) {
  const types = copyFieldTypes(fields, fieldTypes);
  if (!Array.isArray(steps) || steps.length > TAG_PARSER_LIMITS.refiners) fail("too many refiners");
  // Validate all stages before a shuffle or any other stage can execute.
  const checked = steps.map(({ name, args }) =>
    parseRefinerStep([name, ...args].join(":"), fields),
  );
  let result = [...items];
  for (const step of checked) {
    switch (step.name) {
      case "sort": {
        const field = step.args[0];
        const numeric = types[field] === "number";
        const known = (value) =>
          numeric
            ? typeof value === "number" && Number.isFinite(value)
            : typeof value === "string" && value.trim().length > 0;
        result = [...result].sort((a, b) => {
          const av = a[field],
            bv = b[field],
            ak = known(av),
            bk = known(bv);
          if (ak !== bk) return ak ? -1 : 1;
          if (!ak) return 0;
          return numeric ? av - bv : collator.compare(av, bv);
        });
        break;
      }
      case "reverse":
        result = [...result].reverse();
        break;
      case "limit":
        result = result.slice(0, step.args[0]);
        break;
      case "skip":
        result = result.slice(step.args[0]);
        break;
      case "shuffle":
        for (let i = result.length - 1; i > 0; i--) {
          const value = random();
          if (!Number.isFinite(value) || value < 0 || value >= 1) fail("invalid shuffle source");
          const j = Math.floor(value * (i + 1));
          [result[i], result[j]] = [result[j], result[i]];
        }
        break;
    }
  }
  return result;
}
