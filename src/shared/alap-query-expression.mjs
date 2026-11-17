// Local bounded macro expansion and supported-language preflight. Set evaluation
// belongs to the pruned Alap derivative. Never inject grouping during expansion.
import {
  ALAP_LIMITS,
  inspectAlapExpression,
  inspectExpandedAlapExpression,
  normalizeMacros,
} from "./alap-data.mjs";
import { createMacroExpander } from "./alap-macro-expansion.mjs";
export function prepareAlapQuery(value, definitions = {}) {
  const { expression } = inspectAlapExpression(value);
  const macros = normalizeMacros(definitions);
  const expandedExpression = createMacroExpander(macros, ALAP_LIMITS).expandQuery(expression);
  // Validate the whole query after substitution: several individually valid
  // macros can together exceed the parser's token or nesting ceiling.
  inspectExpandedAlapExpression(expandedExpression);
  return { expression, expandedExpression, macros };
}
