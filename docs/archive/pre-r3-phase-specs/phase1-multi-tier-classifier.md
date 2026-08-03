# Phase 1 — Multi-Tier Semantic Classifier

## Objective
Build the 16-rule, 3-tier classifier as a pure function. Takes InteractionSnapshot (+ optional AIIntentResult + optional SessionContext), returns ClassifiedInteraction. Fully unit-testable — no browser, no service worker, no DOM.

## Files to Create
1. `src/generation/engine/multi-tier-classifier.ts` — `classifySnapshot()` pure function with all 16 rules
2. `tests/multi-tier-classifier.test.ts` — ~29 unit tests (one per rule + precedence + edge cases)

## Files to Modify
None.

## Acceptance Criteria
- [ ] All 16 rules implemented (R1–R16)
- [ ] Tier 1 fires before Tier 2; Tier 2 before Tier 3
- [ ] Evidence Sovereignty: Tier 1/2 result overrides AI
- [ ] aiEligible flag correct (tier < 3 AND confidence < 0.9)
- [ ] Every result includes complete ClassificationEvidence trail
- [ ] All ~29 unit tests pass
- [ ] No browser API imports — pure function
- [ ] TypeScript compiles
