# Spec: Unify the Dual Type System

## Problem
Two independent classification paths run on the same events:
- **Component Runtime** (13 types) → `ComponentInteraction[]` → sidepanel display
- **Classifier Pipeline** (40 types) → `DetectedInteraction[]` → IR generation + code gen

The service worker extracts raw events *out of* ComponentInteraction[] objects and re-classifies them through the old V1/V2 detector pipeline — meaning every interaction is classified twice through different logic, and results can diverge.

## Strategy: Bridge, Don't Rewrite

Make the Component Runtime the single source of truth. Eliminate the redundant re-classification while preserving the classifier's richer type vocabulary where it adds value.

## Changes

### Step 1: Add `interactionSubtype` to ComponentInteraction
File: `src/shared/component-types.ts`

Add an optional `interactionSubtype?: string` field to ComponentInteraction. This carries the fine-grained classification (e.g., 'NativeDropdown', 'CustomDropdown', 'PageNavigation') that the 40-type model provides.

### Step 2: Assign subtypes in definitions
File: each definition in `src/definitions/*.ts`

Each definition's `buildResult` sets the subtype where useful:
- Dropdown: 'NativeDropdown' (native SELECT) vs 'CustomDropdown' (custom combobox)
- Navigation: 'PageNavigation' vs 'Back' vs 'Forward' vs 'Refresh'
- Scroll: 'PageScroll' vs 'ContainerScroll'
- Click stays 'Click' (already the right granularity)

### Step 3: Create ComponentToClassifierAdapter
File: `src/generation/component-to-classifier-adapter.ts`

Pure function that maps `ComponentInteraction` → `DetectedInteraction` using type + subtype + metadata. This replaces the V1/V2 re-detection pipeline.

### Step 4: Wire IR bridge to consume ComponentInteractions
File: `src/background/service-worker.ts`

Replace the `extractEvents → detectInteractions → mergeV1V2 → reasonAboutInteractions` chain with:
```
ComponentInteraction[] → ComponentToClassifierAdapter → DetectedInteraction[] → IR Bridge
```

### Step 5: Remove dead code
- `output-adapter.ts`: `toIRAction()` and `toIRActions()` (dead — replaced by IR bridge)
- `timeline-renderer.ts`: `renderDetectedInteractions()` and `actionDescription()` (dead — sidepanel uses component model)
- `output-adapter.ts`: Keep `filterProductionInteractions()` (still active for storage filtering)

## Acceptance Criteria
- [ ] ComponentInteraction has an optional `interactionSubtype` field
- [ ] Dropdown definition assigns NativeDropdown/CustomDropdown subtype
- [ ] Navigation definition assigns PageNavigation/Back/Forward/Refresh subtype
- [ ] Scroll definition assigns PageScroll/ContainerScroll subtype
- [ ] ComponentToClassifierAdapter maps all 13 types → correct classifier types
- [ ] Service worker uses adapter instead of V1/V2 re-detection for IR generation
- [ ] IR bridge output is identical for the same input events (no regression)
- [ ] Sidepanel rendering unchanged (still uses ComponentInteraction[])
- [ ] All existing tests pass
- [ ] Dead code removed

## What This Does NOT Change
- ComponentDefinitions lifecycle (trigger/scope/completion) — unchanged
- Sidepanel rendering — unchanged (still ComponentInteraction[])
- IR bridge internals — unchanged (still consumes DetectedInteraction[])
- IR executor — unchanged
- The classifier detector/reasoner code is NOT deleted yet — it's bypassed for IR generation. Full removal is a follow-up after validation.
