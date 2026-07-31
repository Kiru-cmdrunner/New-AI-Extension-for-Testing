# Phase 1 — types.ts Export Collision

## What happened
Rewrote `src/classifier/evidence/types.ts` from scratch, replacing all exports
with new Phase 1 types. This broke the pre-existing Phase 2+ evidence engine
(engine.ts, detector.ts, combination.ts, 4 providers) which imports
`Evidence`, `EvidenceProvider`, `InteractionBuffer`, `CombinationResult`,
`InteractionHypothesis`, `elementKey`, `elementKeyFromTarget` from types.ts.

Result: 430 new test failures (435 vs 5 pre-existing).

## Root cause
The evidence/ directory already had a complete provider-based engine from a
prior phase. I treated types.ts as if it only existed for Phase 1.

## Fix
Restore original types.ts, append Phase 1 types with non-colliding names.
Rename new `Evidence` → `IntentVote` (better name anyway — it's a vote for
an intent). Update all Phase 1 modules + tests.

## Lesson
Always `git diff` a file before rewriting it. Check what imports it.
