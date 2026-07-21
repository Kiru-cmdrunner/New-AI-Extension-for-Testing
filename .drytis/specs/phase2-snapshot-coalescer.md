# Phase 2 — Snapshot Coalescer

## Objective
Build the event-grouping logic that converts a stream of RawEvidence messages into InteractionSnapshot objects. Runs in the service worker context but is implemented as a standalone, unit-testable class.

## Files to Create
1. `src/recorder/coalescer/snapshot-coalescer.ts` — SnapshotCoalescer class
2. `tests/snapshot-coalescer.test.ts` — ~23 unit tests with synthetic evidence streams

## Files to Modify
None.

## Acceptance Criteria
- [ ] Correctly groups related events (mousedown+click, focus+blur, click+change)
- [ ] Temporal windowing respects COALESCING_WINDOW_MS (500ms)
- [ ] Value/state/class diffs computed from pre/post snapshots
- [ ] Primary event selection follows priority order
- [ ] Date detection uses value format (isDateLikeValue), not element attributes
- [ ] Navigation events produce standalone snapshots
- [ ] flush() emits pending snapshot; reset() clears state
- [ ] Cross-element relatedness via ancestor overlap
- [ ] All ~23 unit tests pass
- [ ] No browser API imports
