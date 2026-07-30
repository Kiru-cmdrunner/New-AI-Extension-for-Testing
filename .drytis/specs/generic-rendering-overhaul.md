# Generic Rendering Overhaul for Configuration Sessions

## Problem
The timeline summary shows `Configure 1Economy: Counter +3, Premium Economy=Premium Economy, Done` which has three issues:
1. **Duplicated rendering logic** — 3 copies of the same field-rendering switch across 2 files
2. **Redundant label=value** — "Premium Economy=Premium Economy" is tautological
3. **Raw trigger names** — "1Economy" is a raw accessible name with a count prefix; "Counter +3" merges distinct stepper buttons

## Design Principles
- **Generic and application-independent** — no AdaniOne-specific rules
- **Pattern-aware** — the verb changes based on the structural pattern
- **Readable** — avoid redundancy; if label equals value, show only the label
- **Consistent** — single source of truth for rendering logic

## Changes

### 1. Consolidate rendering — single source of truth
Both `interaction-renderer.ts` and `timeline-renderer.ts` must call `renderConfigurationSummary()` from `structural-enrichment.ts` instead of reimplementing the same switch logic. Delete the inline copies.

### 2. Pattern-aware verb selection
| Pattern | Verb | Example |
|---------|------|---------|
| `singleSelect` | Select | `Select "Premium Economy" from Economy` |
| `searchSubmit` | Search | `Search "flight tickets"` |
| `filterApply` | Filter | `Filter Economy: Star Rating=4, Price=Low to High, Apply` |
| `toggleBatch` | Configure | `Configure Settings: Notifications=on, Newsletter=off, Save` |
| `multiFieldConfig` | Configure | `Configure Passengers: Adults=2, Children=1, Class=Premium Economy, Done` |
| `uncommitted` | Changed | `Changed Sort: Relevance (not confirmed)` |

### 3. Label-value deduplication
When `label === finalValue` for a select field, show only the value (not `Label=Label`). E.g., `Premium Economy` instead of `Premium Economy=Premium Economy`.

### 4. Trigger label normalization
Clean the trigger label by:
- Splitting digit prefixes from text: "1Economy" → "Economy" (the "1" is a badge/count, not part of the name)
- Stripping leading/trailing whitespace

### 5. Counter rendering
- When `delta > 0` and no `finalValue`: `Field +N`
- When `delta < 0` and no `finalValue`: `Field -N`
- When `finalValue` exists: `Field=N`
- Bare "+"/"-" labels with no contextual name → sequential `Passenger 1`, `Passenger 2` (already implemented)

## Acceptance Criteria

- [ ] Single `renderConfigurationSummary()` function used by all renderers
- [ ] No inline rendering duplication in interaction-renderer.ts or timeline-renderer.ts
- [ ] `singleSelect` pattern renders as `Select "X" from Y` (not `Configure Y: X=X`)
- [ ] Redundant label=value eliminated (Premium Economy=Premium Economy → Premium Economy)
- [ ] Trigger label normalization splits "1Economy" → "Economy"
- [ ] Pattern-aware verbs (Select, Configure, Filter, Search, Changed)
- [ ] Comprehensive test suite covering: singleSelect, multiFieldConfig, filterApply, searchSubmit, toggleBatch, uncommitted
- [ ] No application-specific rules — all transformations are generic
- [ ] No regressions in existing tests

## Files Changed
- `src/enrichment/structural-enrichment.ts` — `renderConfigurationSummary()` overhaul, `normalizeTriggerLabel()`
- `src/sidepanel/interaction-renderer.ts` — call shared function
- `src/sidepanel/timeline-renderer.ts` — call shared function
- `tests/enrichment/structural-enrichment.test.ts` — comprehensive pattern tests
