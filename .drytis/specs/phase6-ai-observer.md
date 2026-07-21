# Phase 6 — AI Observer Enhancement

**Status:** In Progress  
**Blueprint:** `.drytis/architecture-c-production.md` §6  
**Implementation Plan:** `.drytis/architecture-c-implementation-plan.md` Phase 6  

## Goal

Enhance AI from "decorative enrichment" to "structural advisory classification." The AI Observer receives `SnapshotForAI`, calls the LLM, returns `AIIntentResult` (classification advisory + business name + intent), and updates the Mental Model.

## Files to Create

| File | Content |
|------|---------|
| `src/ai/ai-observer.ts` | AIObserver class — prompt construction, LLM call, response parsing, hallucination rejection, Mental Model updates |
| `tests/ai-observer.test.ts` | Unit tests for prompt construction, response parsing, hallucination rejection, confidence clamping, evidence sovereignty |

## Files to Modify

| File | Changes |
|------|---------|
| `src/recorder/pipeline/architecture-c-pipeline.ts` | Implement `requestAIRefinement()` — call AI Observer, re-classify, enrich Timeline |

## Design Decisions

1. **Bypass AIService.understand()**: The existing `understand()` returns `AIUnderstanding` (businessName + controlType + userIntent + confidenceScore). The AI Observer needs `AIIntentResult` which adds `suggestedType: CanonicalType`. We call providers directly via `AIService.resolve()`.
2. **Functional modules reused**: `updateConfidence()` and `analyzeWorkflow()` are free functions (not classes). The AI Observer calls them directly.
3. **P7 Hallucination rejection**: Validate AI output against observed evidence before accepting. AI saying "selectDate" without date-like values is rejected.
4. **P5 Confidence clamping**: Always clamp to [0.05, 0.95].
5. **Graceful degradation**: All AI failures return null. The classifier's Tier 1/2 rules still produce correct results without AI.

## Acceptance Criteria

- [ ] AI Observer receives SnapshotForAI and returns AIIntentResult
- [ ] Prompt includes semantic context only (no raw selectors/XPath)
- [ ] P7: hallucination rejection works
- [ ] P5: confidence clamped to [0.05, 0.95]
- [ ] Mental Model (L2) updated with hypotheses
- [ ] Confidence Engine produces 5-track weighted scores
- [ ] System works without AI (graceful degradation)
- [ ] All ~20 unit tests pass
- [ ] TypeScript compiles, build succeeds
