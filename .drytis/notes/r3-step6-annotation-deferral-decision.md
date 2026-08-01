# R3 Step 6 Decision: Annotation Deferral Instead of Click Lifecycle

## Problem
Changing Click from immediate completion to a brief lifecycle breaks 23 test files because they simulate the runtime directly and expect Click to emit immediately from a single `process()` call.

## Considered Approaches

### Option A: Click Lifecycle Deferral (design doc approach)
- Click stays active until attribute-change event arrives
- Cleanest architecturally, but requires all test simulations to send attribute-change events
- 23 test files break, all needing modification to send synthetic attribute-change events

### Option B: Annotation Deferral (revised)
- Click emits immediately (unchanged from pre-R3)
- `annotateWithEvidence` is NOT called synchronously in onEmit for Clicks
- Instead, a deferred annotation is scheduled (via a pending list + attribute-change event listener)
- When the attribute-change event arrives from the EventTap, the pending Click is annotated with full behavioral data
- If no attribute-change event arrives within a short window (e.g., next process() call), the Click is annotated with pre-handler data only
- No Click lifecycle change needed → no test breakage

### Option C: Immediate Click emit + attribute-change event updates metadata on the runtime's pending Click
- Click completes immediately as before
- But the runtime emits a `pendingAnnotation` signal alongside the Click
- The SW's onEmit holds the interaction in a "pending annotation" state
- When attribute-change arrives, the annotation runs with the attribute data
- If a timeout/next-event fires, annotation runs with whatever's available

## Decision: Option B (Annotation Deferral)
- Minimal test breakage (tests that check `interaction.intent` after immediate process() need updating)
- Preserves the Click lifecycle for all existing tests
- The annotation happens at the SW integration layer, not in the Click definition
- The attribute-change events are already being emitted by EventTap (Step 5)
- SW integration layer can track "pending annotation" Clicks and complete them

## Implementation
1. SW integration: Click emits immediately, but annotation is deferred
2. SW tracks `pendingAnnotationInteractions` — Clicks waiting for attribute-change events
3. When attribute-change event arrives in `processObservedEvent`:
   - Find matching pending Click by stableId
   - Run `annotateWithEvidence` with the attribute-change data
   - Remove from pending list
4. Safety: if another event arrives and the pending Click's attribute-change hasn't been processed, annotate with pre-handler data
