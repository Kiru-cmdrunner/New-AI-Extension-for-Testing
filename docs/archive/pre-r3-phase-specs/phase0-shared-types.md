# Phase 0 — Shared Types & Contracts

## Objective
Define the typed interfaces for Architecture C's evidence pipeline. No logic — just types and constants.

## Files to Create
1. `src/shared/evidence-types.ts` — RawEvidence, MutationSummary, InteractionSnapshot, ClassifyInput, ClassifyOutput, SnapshotForAI, AIIntentResult, CoalescingConfig
2. `src/shared/classifier-constants.ts` — Thresholds, date regex patterns, selection class patterns, RULE enum

## Files to Modify
None.

## Acceptance Criteria
- [ ] All interfaces defined per architecture-c-production.md §13
- [ ] CanonicalType, ElementIdentity, SessionEvent, AIUnderstanding re-exported (not redefined)
- [ ] ClassifiedInteraction and ClassificationEvidence extend (not duplicate) architecture-types.ts definitions
- [ ] TypeScript compiles with zero errors (`npx tsc --noEmit`)
- [ ] No existing imports break
- [ ] No imports from browser APIs

## Validation
```bash
npx tsc --noEmit   # must pass with zero errors
```
