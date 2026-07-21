# Phase 3 Integration — Step 2: Stage 3b Integration & Execution JSON

## Objective

Integrate Stage 3b (Canonical Step Generation from semantic interactions) and replace the inline `mapActionType()` with the frozen `verb-mapping-table.ts`.

**Target Pipeline:** Timeline → Stage 3a → ClassifiedInteraction → Stage 3b → SemanticInteraction → lookupExecutionVerb() → Execution JSON Generator

## Design

### SemanticInteraction Type

A new intermediate type that carries the canonical interaction type plus execution-relevant metadata. It bridges Stage 3b output (CanonicalStep) and Stage 4 (Execution JSON Generator) by explicitly declaring the semantic interaction in the canonical language.

```typescript
interface SemanticInteraction {
  canonicalType: CanonicalType;
  actionId: string;
  stepId: string;
  value: string | null;
  checked: boolean | null;
}
```

### Stage 3b Integration

Stage 3b IS the canonical-step-generator (already integrated in Step 1). The SemanticInteraction is derived from each CanonicalStep — it extracts the canonicalType and execution metadata. A utility function `stepToSemanticInteraction()` performs this derivation.

### Normalization

When a step's `actionType` is a legacy type (e.g. when classified was not provided), normalize it to canonical before verb lookup:

| Legacy type | Canonical type |
|-------------|---------------|
| navigation  | navigate      |
| text        | fill          |
| checkbox    | toggle        |
| radio       | select        |
| dateSelect  | selectDate    |

Types already canonical (click, select, hover, navigate, fill, toggle, selectDate) pass through unchanged.

### mapActionType() Replacement

The inline `mapActionType()` function is replaced by:
1. `normalizeToCanonical(actionType)` — maps any actionType to CanonicalType
2. `lookupExecutionVerb(canonicalType, checked)` — from verb-mapping-table.ts

This ensures Execution JSON verbs come exclusively from the frozen verb mapping table.

### Acceptance Criteria

- [ ] SemanticInteraction type defined
- [ ] stepToSemanticInteraction() utility converts CanonicalStep → SemanticInteraction
- [ ] normalizeToCanonical() maps legacy types to canonical
- [ ] Execution JSON generator uses lookupExecutionVerb() instead of mapActionType()
- [ ] mapActionType() removed (no longer referenced)
- [ ] All 1113 existing tests pass
- [ ] New tests verify verb mapping correctness
- [ ] Execution JSON verbs are deterministic and match the frozen table
- [ ] Playwright generation is unchanged
- [ ] Committed separately
