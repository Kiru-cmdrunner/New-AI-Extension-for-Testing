# Phase 11 — Self-Healing Locators

## Objective

Detect when stored element locators go stale (DOM changed between recording and execution)
and automatically re-resolve them using cross-session evidence from new recordings.

## Architecture

```
Recording Session B (fresh DOM evidence)
  → Element Matching Service (identity signature, ignores fragile locators)
  → Staleness Detector (compare stored vs. fresh LocatorStrategy[])
  → healElement() (additive merge, append HealEvent)
  → Repository (Element updated)
  → IR regeneration trigger (if referenced by ExecutionIRArtifact)
```

## Key Design Decisions

1. **healElement() is a pure function** — same pattern as enrichCapability().
2. **Healing is additive** — new locator strategies merged alongside existing, never removed.
3. **Identity matching ignores fragile locators** (CSS, XPath excluded from match score).
4. **Shared locator-ranking abstraction** — rankLocatorCandidates() extracted now,
   used by both recording-time resolveLocatorsForIR() and future execution-time healing.
5. **Healing is non-fatal** — wrapped in try/catch, recording session still valid if healing fails.

## Milestones

### Milestone 11.1 — Shared Locator Ranking + healElement() Domain Function
- [x] Extract rankLocatorCandidates() shared helper from resolveLocatorsForIR()
- [x] Refactor resolveLocatorsForIR() to use rankLocatorCandidates()
- [x] Add healElement() pure function to element.ts
- [x] Add HealContext type
- [x] Extend updateElement() write-path for healHistory/lastHealedAt/status
- [x] Tests for all new functions
- [x] All existing tests still pass

### Milestone 11.2 — Element Matching Service
- [x] ElementMatchingService with weighted identity signature comparison
- [x] Match score weights: accessibleName 30%, ariaRole/tag 25%, ancestorRoleChain 25%, testId/dataCy/dataQa 15%, pageOrComponent 5%
- [x] Threshold: ≥ 0.70 match
- [x] Tests: same-element match, different-element rejection, partial identity, missing fields

### Milestone 11.3 — Healing Service + Pipeline Wiring
- [x] HealingService orchestrating match → detect → heal → persist
- [x] Wire into handleStopRecording after persistSession() (non-fatal)
- [x] Store healing summary in chrome.storage.local
- [x] Integration tests for full flow

### Milestone 11.4 — Staleness Detection Wiring
- [x] checkStaleness() implemented and tested (15 tests in staleness.test.ts)
- [x] detectLocatorChanges() implemented and tested (compares IR plans)
- [x] Healing bumps element.updatedAt — the signal checkStaleness() reads
- [x] Element detail shows staleness warning when healHistory > 0
- [x] checkStaleness() will be called by Phase 12 (Execution Engine) before
      serving cached IR artifacts — the function is ready, tested, and exported
- [x] IR regeneration: IR is derived and regenerable; Phase 12 will regenerate
      on demand when staleness is detected

### Milestone 11.5 — UI: Element Status + Heal History
- [x] Repository page: element status badges (ACTIVE/STALE/BROKEN)
- [x] Element detail: heal history timeline
- [x] Side panel: brief healing summary after recording
