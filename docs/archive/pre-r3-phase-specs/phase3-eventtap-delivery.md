# Phase 3: EventTap + Delivery

## Summary
Implement the new content script architecture as standalone modules: target resolver,
identity extractor (producing TargetElementIdentity from Phase 1), value tracker,
batch assembler (producing EvidenceBatch from Phase 1), delivery coordinator
(sessionStorage buffer + exponential backoff), and the EventTap orchestrator.

These modules are NOT yet wired into the content script — they coexist alongside
the existing deterministic-recorder.ts. The existing recorder continues to function
exactly as today. Wiring happens in a later phase when we switch the content script.

## Design Decisions
1. **sessionStorage buffer + exponential backoff** — adopted from working-better (proven MV3 reliability)
2. **Per-event valueBefore/After** — simpler than session-wide valueTracker, no state loss on navigation
3. **Evidence channels integration** — EventTap calls collectAllEvidence() to produce EvidenceRecord[]
4. **TargetElementIdentity output** — identity extractor produces Phase 1 types directly (not the old ElementIdentity)
5. **EvidenceBatch output** — batch assembler produces Phase 1 EvidenceBatch directly

## Files to Create
- src/pipeline/tap/target-resolver.ts
- src/pipeline/tap/identity-extractor.ts
- src/pipeline/tap/value-tracker.ts
- src/pipeline/tap/batch-assembler.ts
- src/pipeline/tap/delivery-coordinator.ts
- src/pipeline/tap/event-tap.ts
- src/pipeline/tap/index.ts (barrel)
- tests/unit/pipeline/tap/*.test.ts (comprehensive)

## Acceptance Criteria
- [ ] Target resolver implements 3-strategy cascade (composedPath → interactive selector → clickable heuristic)
- [ ] Identity extractor produces TargetElementIdentity with all locators resolved
- [ ] Value tracker provides per-event valueBefore/After and checkedBefore/After
- [ ] Batch assembler produces EvidenceBatch combining identity + evidence records
- [ ] Delivery coordinator implements sessionStorage buffer + exponential backoff (5 retries)
- [ ] Delivery coordinator handles pagehide flush + pageshow resume
- [ ] EventTap orchestrates: listen → resolve → extract → collect evidence → assemble batch → deliver
- [ ] EventTap listens for 12+ event types on capture phase, passive
- [ ] EventTap throttles scroll (16ms) and mousemove (50ms)
- [ ] All modules are standalone (no content script dependency)
- [ ] Existing deterministic-recorder.ts is NOT modified
- [ ] Full test suite passes with 0 new failures
- [ ] TypeCheck: 0 new errors
- [ ] Build succeeds
