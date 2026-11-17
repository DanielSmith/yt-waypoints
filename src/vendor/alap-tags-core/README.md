# Waypoints Alap local query core

Revision **waypoints-refiners-r2**, derived from the pinned Alap parser and
RefinerPipeline sources in PROVENANCE.json. Copyright Daniel Smith, Apache-2.0;
the full license is included. This is a maintained pruned derivative, not the
complete framework. All three module hashes are checked before builds.

- `syntax.mjs`: strict bounded tokens and segment/group AST, shared with validation.
- `refiners.mjs`: reused sort/reverse/limit/skip/shuffle operations; strict arguments.
- `index.mjs`: detached tag catalog, ordered set evaluation and local pipelines.

Operators evaluate left to right; refiners act on a segment after selection.
Parentheses refine individual groups. Whole-query validation precedes evaluation,
including unsupported stages on empty selections. There are no protocol/source
handlers, regex, DOM/item atoms, comma queries, settings stages, custom registries,
host/network APIs or dynamic imports. Imports stay inside this reviewed folder.

R2 supports copied allowlisted scalar fields with trusted string/number type
names. Stable string comparison uses a fixed English natural/case-insensitive
collator; finite numbers compare numerically. Unknown values sort last ascending;
reverse remains literal. The generic modules do not know bookmark field names.
The Waypoints profile and catalog own duration/update/publication semantics.

`query(expression, evaluation)` retains the ID-array API. `resolve` returns IDs,
`hasRefiners`, `hasShuffle`, `refinerCount`, `rootInputCount` and `resultCount`.
A root count exists only for a terminal root pipeline; grouped refiners do not
create a fictional unrefined total. The evaluator copies catalog arrays/scalars
and never mutates the source. Randomness is supplied per evaluation, not retained
in an engine-wide cache. The caller owns view snapshots and refresh lifecycle.

Macros are expanded by the separate bounded data layer (ten definitions per
chain, unknown/cycle rejection, complete expanded bounds). Definitions can be
complete selections or modifier chains. A modifier alone is not an all-items
query. No automatic grouping is injected. Input catalogs are copied from own
JSON data properties; the evaluator does not mutate authoritative bookmarks.

The optional shuffle random source in the generic pipeline is for trusted
callers/tests, not stored JSON, query syntax or user-defined executable handlers.
The field-name list is supplied by trusted application policy, never by a macro.

Builds use these checked-in readable files; no sibling checkout, npm Alap package
or upstream generation/download is needed. Review source changes and all hashes
and provenance together. Preserve unsupported-capability regression checks.
