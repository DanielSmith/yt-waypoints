// Copyright 2026 Daniel Smith
// SPDX-License-Identifier: Apache-2.0
// Pure production contract for video-wide tags and global named Alap queries.
// Shared syntax dependency only: no evaluation, DOM, storage or transfer wiring.
import { inspectExpression as inspectSyntax } from "../vendor/alap-tags-core/syntax.mjs";
import { ALAP_SORT_FIELDS } from "./alap-refiner-profile.mjs";
import { createMacroExpander } from "./alap-macro-expansion.mjs";

export const ALAP_MACROS_VERSION = 1;
// Reserved for the future persistence owner; this module never reads/writes it.
export const ALAP_MACROS_STORAGE_KEY = "waypoints.macros.v1";
export const ALAP_LIMITS = Object.freeze({
  nameCharacters: 64,
  rawTagCharacters: 256,
  tagsPerVideo: 100,
  macros: 100,
  expressionCharacters: 4096,
  expandedCharacters: 16384,
  tokens: 1024,
  groupDepth: 32,
  macroDepth: 10,
  refiners: 32,
  refinerCount: 1000000,
  macroLibraryBytes: 262144,
});
const NAME = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;
const own = (object, key) => Object.hasOwn(object, key);
const fail = (message) => {
  throw new Error(`Invalid Alap data: ${message}.`);
};

function object(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("expected a plain object");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== null && prototype !== Object.prototype) fail("expected a plain object");
  return value;
}
function fields(value, allowed, required = allowed) {
  object(value);
  const result = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    if (!allowed.includes(key)) fail("unexpected field");
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor.enumerable || !own(descriptor, "value"))
      fail("expected enumerable data fields");
    result[key] = descriptor.value;
  }
  if (required.some((key) => !own(result, key))) fail("missing required field");
  return result;
}
export function validateAlapName(value) {
  if (typeof value !== "string" || value.length > ALAP_LIMITS.nameCharacters || !NAME.test(value)) {
    fail("names require 1–64 lowercase ASCII letters/digits with single underscores between words");
  }
  return value;
}
// Explicit suggestion/editor operation. Stored/imported names use validation,
// never silent sanitization. Non-Latin letters require deliberate transliteration.
export function suggestTagSlug(value) {
  if (
    typeof value !== "string" ||
    value.length > ALAP_LIMITS.rawTagCharacters ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    fail("invalid source tag text");
  const folded = value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  if (/[^\x00-\x7f]/.test(folded)) fail("transliterate non-ASCII source text first");
  return validateAlapName(
    folded
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, ""),
  );
}
export function normalizeVideoTags(value) {
  if (!Array.isArray(value) || value.length > ALAP_LIMITS.tagsPerVideo)
    fail("expected at most 100 video tags");
  // Reject sparse arrays, getters, symbols and custom properties before access.
  for (const key of Reflect.ownKeys(value)) {
    if (key === "length") continue;
    if (typeof key !== "string" || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)
      fail("invalid tag array field");
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (!d.enumerable || !own(d, "value")) fail("expected tag data elements");
  }
  const tags = [];
  for (let i = 0; i < value.length; i++) {
    if (!own(value, i)) fail("sparse tags are unsupported");
    tags.push(validateAlapName(value[i]));
  }
  if (new Set(tags).size !== tags.length) fail("duplicate video tag");
  return tags.sort();
}
function tagField(record) {
  object(record);
  const descriptor = Object.getOwnPropertyDescriptor(record, "tags");
  if (!descriptor) return undefined;
  if (!descriptor.enumerable || !own(descriptor, "value")) fail("expected a tags data field");
  return normalizeVideoTags(descriptor.value);
}
// Legacy records display as untagged. No record is mutated or eagerly migrated.
export function readVideoTags(record) {
  return tagField(record) ?? [];
}
// An import owns tags only when it supplies them, including an explicit [].
export function resolveImportedTags(localRecord, incomingRecord) {
  const local = readVideoTags(localRecord);
  return tagField(incomingRecord) ?? local;
}

// Selection and modifier definitions share the same grammar as direct evaluation.
function inspectExpression(value, characterLimit, modifier = false) {
  try {
    return inspectSyntax(value, {
      macros: true,
      modifier,
      fields: ALAP_SORT_FIELDS,
      characters: characterLimit,
    });
  } catch (error) {
    fail(error.message);
  }
}
export function inspectAlapExpression(value) {
  return inspectExpression(value, ALAP_LIMITS.expressionCharacters);
}
export function inspectMacroExpression(value) {
  return inspectExpression(value, ALAP_LIMITS.expressionCharacters, true);
}
export function inspectExpandedAlapExpression(value, { modifier = false } = {}) {
  const result = inspectExpression(value, ALAP_LIMITS.expandedCharacters, true);
  if (result.references.length) fail("unresolved macro in expanded expression");
  if (!modifier && result.kind === "modifier") fail("Choose a tag or view before this modifier");
  return result;
}
export function normalizeMacros(value) {
  object(value);
  const keys = Reflect.ownKeys(value);
  if (keys.length > ALAP_LIMITS.macros) fail("too many macros");
  const macros = Object.create(null);
  for (const name of keys) {
    validateAlapName(name);
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (!descriptor.enumerable || !own(descriptor, "value")) fail("expected macro data fields");
    const item = fields(descriptor.value, ["linkItems"]);
    const inspection = inspectMacroExpression(item.linkItems);
    macros[name] = { linkItems: inspection.expression };
  }
  const expander = createMacroExpander(macros, ALAP_LIMITS);
  for (const name of keys)
    inspectExpandedAlapExpression(expander.expandMacro(name), { modifier: true });
  const sorted = Object.fromEntries(
    Object.keys(macros)
      .sort()
      .map((name) => [name, macros[name]]),
  );
  if (
    new TextEncoder().encode(JSON.stringify({ version: ALAP_MACROS_VERSION, macros: sorted }))
      .length > ALAP_LIMITS.macroLibraryBytes
  )
    fail("macro library exceeds 256 KiB");
  return sorted;
}
export function normalizeMacroLibrary(value) {
  const data = fields(value, ["version", "macros"]);
  if (data.version !== ALAP_MACROS_VERSION) fail("unsupported macro library version");
  return { version: ALAP_MACROS_VERSION, macros: normalizeMacros(data.macros) };
}
export function renameMacro(value, oldName, newName) {
  const library = normalizeMacroLibrary(value);
  validateAlapName(oldName);
  validateAlapName(newName);
  if (!own(library.macros, oldName)) fail(`unknown macro @${oldName}`);
  if (oldName !== newName && own(library.macros, newName)) fail(`macro @${newName} already exists`);
  const next = Object.create(null);
  for (const [name, item] of Object.entries(library.macros)) {
    next[name === oldName ? newName : name] = {
      linkItems: item.linkItems.replace(/@([a-z0-9_]+)/g, (token, ref) =>
        ref === oldName ? `@${newName}` : token,
      ),
    };
  }
  return normalizeMacroLibrary({ version: ALAP_MACROS_VERSION, macros: next });
}
export function removeMacro(value, name) {
  const library = normalizeMacroLibrary(value);
  validateAlapName(name);
  if (!own(library.macros, name)) fail(`unknown macro @${name}`);
  for (const [other, item] of Object.entries(library.macros)) {
    if (other !== name && inspectMacroExpression(item.linkItems).references.includes(name))
      fail(`@${other} depends on @${name}`);
  }
  delete library.macros[name];
  return library;
}
