# M9.8 — Entity Type Generalization & Extensible Detection

## Goal
Remove the hard-coded 8-value `EntityType` union and replace it with `string`,
backed by a configurable `EntityTypeRegistry` that maps detection evidence
to entity type strings. Existing behavior for Amazon (product, cart-item,
search-query, order, user, filter, page-content, unknown) is preserved
exactly. New types (employee, leave-request, issue, pull-request, commit,
comment, candidate, build) are registered and detectable through configuration.

## Files to Change

### Modified (M9.2 only)
- `src/understanding/state-builder/types.ts` — widen `EntityType` from union to `string`
- `src/understanding/state-builder/entity-tracker.ts` — `getByType` param: `EntityType` → `string`
- `src/understanding/state-builder/collection-tracker.ts` — default param type: `EntityType` → `string`
- `src/understanding/state-builder/state-builder.ts` — remove cast, accept registry, use registry for new types
- `src/understanding/index.ts` — keep `EntityType` re-export (now just `string` alias)

### New
- `src/understanding/state-builder/entity-type-registry.ts` — registry + detection rules
- `tests/understanding/entity-type-registry.test.ts` — focused tests

## Design

### EntityTypeRegistry
```typescript
interface EntityTypeDetectionRule {
  entityType: string;
  pageContentKind?: string;   // match M9.4 observed entity kind
  viewId?: string;             // match view ID (exact)
  urlPattern?: string;         // regex to match URL
  urlIdGroup?: string;         // named capture from urlPattern for entity ID
  apiOperation?: string;       // match M9.1 API operation type
}
```

Resolution priority:
1. StateBuilder's existing hard-coded logic (product-detail→product, add-to-cart→cart-item, etc.)
2. EntityTypeRegistry rules for page-content kinds
3. EntityTypeRegistry rules for view-based detection
4. Fallback: `obs.entityType ?? 'unknown'`

### Backward Compatibility
- The 8 existing types continue to work via the StateBuilder's hard-coded derivation
- The registry adds new types that the hard-coded logic doesn't know about
- No M9.3–M9.7 file is modified (all already use `string`)

## Acceptance Criteria
- [ ] Existing 8 entity types work unchanged
- [ ] employee, leave-request, issue, pull-request, commit, comment, candidate, build registered
- [ ] Custom entity types addable via registry.register() without code changes
- [ ] M9.5 persistence round-trips arbitrary types
- [ ] M9.6 consolidation preserves arbitrary types
- [ ] M9.7 works with arbitrary types
- [ ] No Amazon regression
- [ ] TSC = 0
- [ ] Full test suite passes
- [ ] Clean build
