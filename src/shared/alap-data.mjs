// Pure production contract for video-wide tags and global named Alap queries.
// No parser dependency, evaluation, DOM, storage or bookmark-transfer wiring.
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

// Syntax checks only: matching/evaluation remains the shared Alap parser's job.
// Stored macro definitions contain complete expressions, never token fragments.
export function inspectAlapExpression(value) {
  if (
    typeof value !== "string" ||
    value.length > ALAP_LIMITS.expressionCharacters ||
    /[^\x20-\x7e\t\r\n]/.test(value)
  )
    fail("invalid or oversized expression");
  const expression = value.trim();
  if (!expression) fail("empty expression");
  const references = new Set();
  let position = 0,
    count = 0,
    depth = 0,
    needsTerm = true;
  while (position < expression.length) {
    const ch = expression[position];
    if (/[ \t\r\n]/.test(ch)) {
      position++;
      continue;
    }
    if (++count > ALAP_LIMITS.tokens) fail("too many expression tokens");
    if (ch === "." || ch === "@") {
      if (!needsTerm) fail("missing operator between terms");
      const match = /^[a-z0-9_]+/.exec(expression.slice(position + 1));
      if (!match) fail("expected a canonical tag or macro name");
      validateAlapName(match[0]);
      if (ch === "@") references.add(match[0]);
      position += match[0].length + 1;
      needsTerm = false;
    } else if (ch === "(") {
      if (!needsTerm || ++depth > ALAP_LIMITS.groupDepth) fail("invalid or excessive grouping");
      position++;
    } else if (ch === ")") {
      if (needsTerm || --depth < 0) fail("unmatched or empty group");
      needsTerm = false;
      position++;
    } else if (ch === "+" || ch === "|" || ch === "-") {
      if (needsTerm) fail("operator without a left term");
      needsTerm = true;
      position++;
    } else fail("only .tags, @macros, +, |, -, and parentheses are supported");
  }
  if (needsTerm || depth) fail("incomplete expression or group");
  return { expression, references: [...references].sort() };
}
function checkExpanded(expression) {
  // Reuse syntax bounds after expansion without applying the source-length cap.
  if (expression.length > ALAP_LIMITS.expandedCharacters) fail("expanded expression is too large");
  // Split into canonical tokens after source definitions have been inspected.
  const tokens = expression.match(/\.[a-z0-9_]+|[()+|\-]/g) || [];
  if (tokens.length > ALAP_LIMITS.tokens) fail("too many expanded expression tokens");
  let depth = 0;
  for (const token of tokens) {
    if (token === "(" && ++depth > ALAP_LIMITS.groupDepth) fail("excessive expanded grouping");
    if (token === ")") depth--;
  }
}
export function normalizeMacros(value) {
  object(value);
  const keys = Reflect.ownKeys(value);
  if (keys.length > ALAP_LIMITS.macros) fail("too many macros");
  const macros = Object.create(null),
    inspections = new Map();
  for (const name of keys) {
    validateAlapName(name);
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (!descriptor.enumerable || !own(descriptor, "value")) fail("expected macro data fields");
    const item = fields(descriptor.value, ["linkItems"]);
    const inspection = inspectAlapExpression(item.linkItems);
    macros[name] = { linkItems: inspection.expression };
    inspections.set(name, inspection);
  }
  // Check graph first; no partial registry escapes when any name is invalid.
  const heights = new Map();
  function visit(name, chain) {
    if (!own(macros, name)) fail(`unknown macro @${name}`);
    if (chain.includes(name)) fail(`circular macro reference @${name}`);
    if (chain.length >= ALAP_LIMITS.macroDepth) fail("macro nesting exceeds 10 levels");
    if (heights.has(name)) return heights.get(name);
    let height = 1;
    for (const ref of inspections.get(name).references) {
      height = Math.max(height, 1 + visit(ref, [...chain, name]));
    }
    if (height > ALAP_LIMITS.macroDepth) fail("macro nesting exceeds 10 levels");
    heights.set(name, height);
    return height;
  }
  for (const name of keys) visit(name, []);
  // Alap substitutes text without injecting grouping. Bound allocation while
  // expanding, rather than creating an unbounded intermediate string first.
  const expansions = new Map();
  function expand(name) {
    if (expansions.has(name)) return expansions.get(name);
    const source = macros[name].linkItems;
    const pattern = /@([a-z0-9_]+)/g;
    let result = "",
      previous = 0;
    for (const match of source.matchAll(pattern)) {
      const part = source.slice(previous, match.index) + expand(match[1]);
      if (result.length + part.length > ALAP_LIMITS.expandedCharacters)
        fail("expanded expression is too large");
      result += part;
      previous = match.index + match[0].length;
    }
    const tail = source.slice(previous);
    if (result.length + tail.length > ALAP_LIMITS.expandedCharacters)
      fail("expanded expression is too large");
    const expanded = result + tail;
    expansions.set(name, expanded);
    return expanded;
  }
  for (const name of keys) checkExpanded(expand(name));
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
    if (other !== name && inspectAlapExpression(item.linkItems).references.includes(name))
      fail(`@${other} depends on @${name}`);
  }
  delete library.macros[name];
  return library;
}
