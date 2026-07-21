# Merge Layer Implementation

## Architecture
V2 (Evidence Engine) is primary, V1 (Interaction Detector) fills gaps for events V2 couldn't classify.

## Pipeline (in service-worker STOP_RECORDING handler)
```
1. events = session.getEvents()
2. v1Interactions = detectInteractions(events)     → DETECTED_INTERACTIONS (production UI)
3. v2Interactions = detectInteractionsV2(events)   → DETECTED_INTERACTIONS_V2 (dev)
4. { merged, metrics } = mergeV1V2(v2, v1, events.length) → DETECTED_INTERACTIONS_MERGED
5. logMergeMetrics(metrics)                         → console (dev)
```

## mergeV1V2() Algorithm
1. Partition V2 into confident (type≠Unknown AND confidence≥0.5) vs unconfident
2. Build claimedEventIds set from confident V2 results
3. Filter V1: drop any interaction with ANY eventId overlap with claimed set
4. Tag: confident V2 → engine='v2', surviving V1 → engine='v1-fallback'
5. Sort merged by first eventId
6. Compute metrics: counts, percentages, unclaimed events

## Key Properties
- Dedup guarantee: no eventId in more than one interaction (enforced by Set-based claim)
- V1 runs on FULL event stream (grouping windows need temporal context)
- V2 Unknown/below-threshold interactions don't claim events → fall through to V1
- V1 interaction with partial overlap dropped entirely (not split) — V2 always wins
- Every interaction tagged with engine source for debugging

## Storage Keys
- DETECTED_INTERACTIONS — V1 (production UI source of truth, unchanged)
- DETECTED_INTERACTIONS_V2 — V2 raw output (dev-only)
- DETECTED_INTERACTIONS_MERGED — merged output (ready for UI cutover)

## Files Changed
- src/classifier/interaction-types.ts — added `engine?: string` to DetectedInteraction
- src/shared/types.ts — added DETECTED_INTERACTIONS_MERGED storage key
- src/classifier/evidence/merge-layer.ts — mergeV1V2() + MergeMetrics + logMergeMetrics()
- src/background/service-worker.ts — wired merge into STOP_RECORDING handler
- tests/evidence-engine/merge-layer.test.ts — 27 tests

## Metrics Output (console at STOP_RECORDING)
```
══════════════════════════════════════════════════
  Merge Metrics
══════════════════════════════════════════════════
  V2 (Evidence Engine):     7 interactions (70%)
  V1 (Fallback):            3 interactions (30%)
  V2 Unconfident:           1 (didn't claim events)
  V1 Dropped (overlap):     4
  Events claimed by V2:     15/20
  Events in V1 fallback:    5/20
══════════════════════════════════════════════════
```

## Test Coverage: 2126 tests across 75 files (all passing)
- 27 merge-layer tests: basic merge, dedup guarantee, threshold, ordering, metrics, real-world simulations, edge cases
- 28 graceful-failure tests (from prior validation)
- 2071 pre-existing tests (no regressions)

## Next Steps
- UI cutover: switch side panel to read DETECTED_INTERACTIONS_MERGED
- Real-world validation on large recordings across multiple sites
- Track V2/V1 ratio via metrics to monitor migration progress
- As each wave migrates more types, V1 fallback rate drops toward zero
