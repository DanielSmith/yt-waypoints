// Bounded local text substitution only. Callers first validate definition shapes
// and grammar. No matching, registry extensions, I/O or executable definitions.
export function createMacroExpander(macros, limits) {
  const cache = new Map();
  const fail = (message) => {
    throw new Error(`Invalid Alap data: ${message}.`);
  };
  function substitute(source, chain) {
    let text = "",
      previous = 0,
      childHeight = 0;
    const append = (part) => {
      if (text.length + part.length > limits.expandedCharacters)
        fail("expanded expression is too large");
      text += part;
    };
    for (const match of source.matchAll(/@([a-z0-9_]+)/g)) {
      const child = resolve(match[1], chain);
      append(source.slice(previous, match.index));
      append(child.text);
      childHeight = Math.max(childHeight, child.height);
      previous = match.index + match[0].length;
    }
    append(source.slice(previous));
    return { text, childHeight };
  }
  function resolve(name, chain) {
    if (!Object.hasOwn(macros, name)) fail(`unknown macro @${name}`);
    if (chain.includes(name)) fail(`circular macro reference @${name}`);
    if (chain.length >= limits.macroDepth)
      fail(`macro nesting exceeds ${limits.macroDepth} levels`);
    if (cache.has(name)) {
      const cached = cache.get(name);
      // Cached subtree heights keep the limit independent of definition order.
      if (chain.length + cached.height > limits.macroDepth)
        fail(`macro nesting exceeds ${limits.macroDepth} levels`);
      return cached;
    }
    const result = substitute(macros[name].linkItems, [...chain, name]);
    const expanded = { text: result.text, height: 1 + result.childHeight };
    cache.set(name, expanded);
    return expanded;
  }
  return {
    expandMacro: (name) => resolve(name, []).text,
    expandQuery: (expression) => substitute(expression, []).text,
  };
}
