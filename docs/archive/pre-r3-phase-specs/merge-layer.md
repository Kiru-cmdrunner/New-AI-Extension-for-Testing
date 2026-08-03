# Merge Layer — V2-Primary with V1 Event-Segment Fallback

## Goal
Combine V2 (Evidence Engine) and V1 (Interaction Detector) outputs so V2 handles
what it can classify confidently, and V1 fills in the gaps for events V2 couldn't
claim. Every interaction is tagged with its source engine for debugging.

## Architecture

```
Raw Events
    │
    ├─→ V2 (detectInteractionsV2) → v2Results[]
    │       Each result has eventIds[] + confidence + type
    │
    ├─→ V1 (detectInteractions)   → v1Results[]
    │       Runs on FULL event stream (preserves grouping)
    │
    └─→ Merge Layer
            1. Partition V2: confident (type≠Unknown, conf≥threshold) vs unconfident
            2. Build v2ClaimedEventIds from confident V2 results
            3. Filter V1: keep only interactions with ZERO eventId overlap with claimed set
            4. Merge: confident V2 + filtered V1
            5. Tag each interaction: engine='v2' | engine='v1-fallback'
            6. Compute metrics
```

## Key Decisions
- V1 runs on the FULL event stream — its grouping windows need temporal context
- Dedup unit = eventId. If ANY eventId in a V1 interaction overlaps with a
  confident V2 interaction's eventIds, the V1 interaction is dropped (V2 wins)
- Threshold for "confident" = 0.5 (existing COMMIT_THRESHOLD)
- V2 interactions with type='Unknown' or confidence < threshold do NOT claim
  their events — those events fall through to V1

## Files
- `src/classifier/evidence/merge-layer.ts` — mergeV1V2() function + MergeMetrics
- `src/classifier/interaction-types.ts` — add `engine?: string` to DetectedInteraction
- `tests/evidence-engine/merge-layer.test.ts` — comprehensive unit tests
- `src/background/service-worker.ts` — wire merge into STOP_RECORDING

## Acceptance Criteria
- [ ] mergeV1V2() runs V2 primary, V1 fallback for unclaimed events
- [ ] Every interaction tagged engine='v2' or engine='v1-fallback'
- [ ] No eventId appears in more than one interaction (dedup guarantee)
- [ ] Metrics include: total, v2 count, v1 count, percentages, unclaimed events
- [ ] V1 gets full event stream (grouping not broken by event extraction)
- [ ] Unknown-confidence V2 interactions don't claim events
- [ ] Existing V1-only and V2-only behavior unchanged when called independently
- [ ] Merged output stored in DETECTED_INTERACTIONS_MERGED storage key
- [ ] A/B comparison extended to show merged vs V1 disagreements
