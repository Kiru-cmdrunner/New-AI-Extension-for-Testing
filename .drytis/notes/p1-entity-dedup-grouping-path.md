# P1 entity-dedup refinement (real-Chrome finding, 2026-08-19)

During Phase 1 real-Chrome validation (Add-to-Cart), the cart captured only 1
of 3 product entities. Root cause: `getElementPath` (dom-observer) is a
GROUPING path — sibling `<li data-asin>` items share the identical path string
`ul > li` (no nth-child), and PageContentObserver's `seenPaths` dedup kept only
the first per path.

Fix (in page-content-observer.ts scan loop, commit pending): entity-kind items
dedup by `entity:<idAttribute value>` when `idAttribute` is configured;
everything else still dedups by path. Two unit tests pin it (sibling capture +
duplicate-id dedup). All M9.4 bounds unchanged.

Phase 2 implication: StateBuilder.processPageContent upserts entities by
`{type}:{entityId}` — multiple snapshot entities with distinct ids now upsert
distinct rows; no double-record risk. `domPath` remains the dedup key ONLY for
counter/collection skip-guards (unchanged).
