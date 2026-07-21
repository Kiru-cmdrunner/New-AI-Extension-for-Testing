# Phase 3 Integration — Step 1: Stage 3a Semantic Classification

## Objective

Integrate the existing `semantic-classifier.ts` into the production generation pipeline so that semantic classification becomes the primary source of interaction understanding.

**Target Pipeline:** Timeline → semantic-classifier.ts → ClassifiedInteraction[] → canonical-step-generator.ts

## Requirements

- The `generation-engine.ts` must call `classifyInteractions(timeline)` between reading the Timeline from storage and passing it to the canonical-step-generator.
- The `canonical-step-generator.ts` must consume `ClassifiedInteraction[]` using `canonicalType` instead of raw `event.type` for the `actionType` field on the generated `CanonicalStep`.
- Preserve existing recording behaviour.
- Do not modify Stage 3b (Execution JSON generation).
- Do not modify Playwright generation.
- Do not remove legacy code unless it becomes completely unused.

## Design

### Integration Point: generation-engine.ts

Between line 74 (read timeline) and line 112 (call canonical-step-generator), insert:

```ts
import { classifyInteractions } from '../engine/semantic-classifier';
// ...
const classified = classifyInteractions(timeline);
```

Then pass `classified` to the canonical-step-generator input alongside `timeline` and `recordingContext`.

### Input Contract Evolution

`CanonicalStepGeneratorInput` gains a `classified: ClassifiedInteraction[]` field. This is additive — the existing `timeline` field remains for backward compatibility (navigation context etc.).

### canonical-step-generator.ts Changes

1. `generate()` now iterates `classified` (ClassifiedInteraction[]) instead of `timeline` (SessionEvent[]).
2. `transformEventToStep` uses `classified.canonicalType` for `step.actionType` instead of `event.type`.
3. Plain English generation still uses the legacy registry (`getInteractionType`) to preserve identical user-visible output. The registry is keyed by the raw event.type (which is still accessible via `classified.originalEvent.type`), so plain English remains unchanged.
4. Navigation events are still handled identically.
5. Extras extraction (value, checked, dateType/displayValue) still reads from the original event.

### Action Type Mapping

| event.type | canonicalType |
|------------|--------------|
| navigation | navigate |
| click (generic) | click |
| click (selection target) | select |
| click (toggle) | toggle |
| text | fill |
| text (date-like) | selectDate |
| checkbox | toggle |
| radio | select |
| select | select |
| hover | hover |
| dateSelect | selectDate |

### Impact on Execution JSON (unchanged in Step 1)

The Execution JSON Generator's `mapActionType()` currently reads `step.actionType`. After this change, `step.actionType` will be a `CanonicalType` (e.g. `'toggle'` instead of `'checkbox'`, `'select'` instead of `'radio'`, `'selectDate'` instead of `'dateSelect'`). This means the execution JSON verb mapping WILL CHANGE unless we add compatibility.

**Step 1 solution:** Extend `mapActionType()` to handle both the old and new actionType values. This preserves Step 1 scope (don't modify Execution JSON generation) while preventing regressions.

| canonicalType (new) | Old type | mapActionType result |
|---------------------|----------|---------------------|
| navigate | navigation | navigate |
| click | click | click |
| fill | text | fill |
| select | radio/select | select |
| toggle | checkbox | check/uncheck (based on `checked`) |
| selectDate | dateSelect | fill |
| hover | hover | hover |

### Acceptance Criteria

- [ ] generation-engine.ts calls classifyInteractions() before invoking canonical-step-generator
- [ ] canonical-step-generator.ts accepts ClassifiedInteraction[] and uses canonicalType for actionType
- [ ] Generated canonical steps have canonical actionType values (navigate, click, fill, select, toggle, selectDate, hover)
- [ ] Plain English output is unchanged from pre-integration behaviour
- [ ] Execution JSON verbs are unchanged (mapActionType extended for new types)
- [ ] All 1090 existing tests pass
- [ ] New tests verify classifier integration
- [ ] Recording behaviour is unchanged
- [ ] Committed separately
