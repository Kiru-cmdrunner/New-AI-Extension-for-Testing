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
- [ ] Extract rankLocatorCandidates() shared helper from resolveLocatorsForIR()
- [ ] Refactor resolveLocatorsForIR() to use rankLocatorCandidates()
- [ ] Add healElement() pure function to element.ts
- [ ] Add HealContext type
- [ ] Extend updateElement() write-path for healHistory/lastHealedAt/status
- [ ] Tests for all new functions
- [ ] All existing tests still pass

### Milestone 11.2 — Element Matching Service
- [ ] ElementMatchingService with weighted identity signature comparison
- [ ] Match score weights: accessibleName 30%, ariaRole/tag 25%, ancestorRoleChain 25%, testId/dataCy/dataQa 15%, pageOrComponent 5%
- [ ] Threshold: ≥ 0.70 match
- [ ] Tests: same-element match, different-element rejection, partial identity, missing fields

### Milestone 11.3 — Healing Service + Pipeline Wiring
- [ ] HealingService orchestrating match → detect → heal → persist
- [ ] Wire into handleStopRecording after persistSession() (non-fatal)
- [ ] Store healing summary in chrome.storage.local
- [ ] Integration tests for full flow

### Milestone 11.4 — Staleness Detection Wiring
- [ ] Call checkStaleness() before serving cached IR artifacts
- [ ] Wire detectLocatorChanges() to produce heal events
- [ ] IR regeneration trigger when elements are healed

### Milestone 11.5 — UI: Element Status + Heal History
- [ ] Repository page: element status badges (ACTIVE/STALE/BROKEN)
- [ ] Element detail: heal history timeline
- [ ] Side panel: brief healing summary after recording
