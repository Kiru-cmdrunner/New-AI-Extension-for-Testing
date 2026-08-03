# Phase 3 Task Spec — Type System Unification

**Design document:** `.drytis/PHASE3_DESIGN.md` (Revision 2, includes §9 Equivalence Validation Strategy)

## Goal

Eliminate the three-vocabulary type fragmentation (23 Component Runtime types → 46 classifier types → 12 IR actions) in favor of a single, compiler-enforced `InteractionType` union flowing through the entire pipeline.

## Files to change

### Primary (rewiring)
- `src/shared/component-types.ts` — Expand `InteractionType` union, deprecate `interactionSubtype`
- `src/generation/ir-bridge.ts` — Consume `ComponentInteraction` directly, `Record<InteractionType, ...>` map
- `src/generation/ir-bridge-input.ts` — Change `interactions` type to `ComponentInteraction[]`
- `src/generation/assertion-deriver.ts` — Import from component-types, accept `ComponentInteraction`
- `src/recorder/pipeline/domain-adapter-v2.ts` — Accept `ComponentInteraction[]`
- `src/recorder/pipeline/pipeline-runner.ts` — Remove adapter call, take `ComponentInteraction[]`
- `src/background/service-worker.ts` — Remove `adaptToDetected()` call
- `src/classifier/evidence/type-deriver.ts` — Import from component-types

### Deletion (Step 6, after all gates pass)
- `src/classifier/interaction-detector.ts` (879 lines)
- `src/classifier/interaction-types.ts` (345 lines)
- `src/generation/component-to-classifier-adapter.ts` (243 lines)
- Their test files

## Acceptance Criteria

### Equivalence Gates (§9.4) — must ALL pass before Step 6
- [ ] G1: `tsc --noEmit` reports zero errors
- [ ] G2: Full test suite green (minus V1 classifier/adapter tests deleted in Step 6)
- [ ] G3: All 63 corpus fixtures: `newType == oldType`
- [ ] G4: All 63 corpus fixtures: `deepEqual(newPlan, goldenPlan)`
- [ ] G5: All 63 corpus fixtures: Playwright renders without error (or same LocatorRenderError)
- [ ] G6: Corpus fixtures with promoted subtypes: identical intent/confidence/evidenceTrail
- [ ] G7: `grep -r 'DetectedInteraction' src/` → zero; `grep -r 'ClassifierInteractionType' src/` → zero
- [ ] G8: End-to-end recording session produces byte-identical Playwright output

### Structural Criteria
- [ ] `INTERACTION_TO_IR_ACTION` typed `Record<InteractionType, IRAction | 'NOISE'>`
- [ ] All `Record<string, …>` maps keyed on `InteractionType` retyped
- [ ] `interactionSubtype?: string` field removed from `ComponentInteraction`
- [ ] `engine: 'legacy' | 'control'` parameter removed from `runPipeline()`
- [ ] Dead code removed: interaction-detector.ts, interaction-types.ts, adapter, their tests

## Tests
- `tests/golden-master/corpus.ts` — 63 fixtures (Layer 1: per-type, Layer 2: edge cases, Layer 3: sequences)
- `tests/golden-master/golden-master.test.ts` — Differential equivalence (130 tests)
- `tests/golden-master/capture-golden-outputs.test.ts` — Golden snapshot capture
- `tests/golden-master/snapshots/*.json` — 63 golden IR plan snapshots + manifest

## Edge cases
- Metadata field name drift between definitions and bridge (audit in Step 1a)
- Scroll interactions filtered as noise (preserve NOISE filtering semantics)
- Configuration session expansion (multi-field dropdowns)
- Modal subActions expansion
- Abandoned/interrupted interactions (lower confidence)
- iframe context propagation
