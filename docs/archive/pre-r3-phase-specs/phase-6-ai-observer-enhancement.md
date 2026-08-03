# Phase 6 — AI Observer Enhancement

**Blueprint:** `.drytis/architecture-c-implementation-plan.md` §Phase 6
**Depends on:** Phase 5 (Pipeline Integration & Feature Flag) — COMPLETE
**Feature flag:** `ARCHITECTURE_C_ENABLED` (default OFF; legacy pipeline unaffected)

## Goal

Enhance AI integration from "decorative enrichment" to "structural advisory classification." Wire the AI Observer into the Architecture C pipeline so that:

1. When the classifier marks a snapshot `aiEligible=true`, the pipeline asynchronously calls the AI Observer.
2. The AI Observer receives a `SnapshotForAI` (semantic context only — no selectors/XPath), calls the LLM, and returns an `AIIntentResult`.
3. The pipeline re-classifies the snapshot WITH the AI advisory and updates the Timeline entry if the canonical type changed (Phase 2 reclassification).
4. AI enrichment data (businessName, userIntent, confidence) is attached to Timeline entries.
5. The Mental Model (L2) is updated progressively and persisted to `chrome.storage.local` for MV3 safety.

## Current State

**Already built (part of prior session work):**
- `src/ai/ai-observer.ts` — `AIObserver` class, `buildAIPrompt()`, `parseAIResponse()`, `validateAIResult()`, `toSnapshotForAI()`. Prompt, parsing, hallucination rejection, confidence clamping all implemented.
- `src/generation/engine/confidence-engine.ts` — 5-track weighted confidence model.
- `src/generation/engine/workflow-analyzer.ts` — workflow pattern detection.
- `src/generation/engine/multi-tier-classifier.ts` — Tier 3 R15 (AI advisory) rule already consumes `AIIntentResult`.
- `tests/ai-observer.test.ts` — 30 tests for prompt, parsing, hallucination rejection, confidence clamping, toSnapshotForAI.

**Not yet done (this phase):**
- `ArchitectureCPipeline.requestAIRefinement()` — currently a no-op stub.
- Mental Model persistence to `chrome.storage.local`.
- Phase 2 reclassification callback (pipeline → timeline update on type change).
- AI enrichment attachment to Timeline entries.
- `ai-understanding.ts` — bridge for SnapshotForAI input + AIIntentResult output.
- Integration tests for the full pipeline flow.

## Files to Change

### Modified
| File | Changes |
|------|---------|
| `src/recorder/pipeline/architecture-c-pipeline.ts` | Add AIObserver instance; implement `requestAIRefinement()`; add `onEventUpdate` callback for reclassification; add `updateTimelineEntry()` and `enrichTimelineEntry()` helpers |
| `src/ai/ai-observer.ts` | Add `persistMentalModel()` + `loadMentalModel()` (MV3-safe storage); add `setTimeline()` so workflow analyzer can use current events |
| `src/ai/ai-understanding.ts` | Add `buildSemanticPrompt(SnapshotForAI)` and `parseIntentResponse(string)` as bridge functions re-exporting from ai-observer.ts |
| `src/background/service-worker.ts` | Wire `pipeline.onEventUpdate` callback to update session events on reclassification |
| `tests/ai-observer.test.ts` | Add Mental Model persistence tests, Evidence Sovereignty integration tests, progressive update tests |
| `tests/architecture-c-pipeline.test.ts` | Add Phase 2 AI refinement integration tests: aiEligible → AI called → type changed → update; AI unavailable → deterministic preserved |

## Acceptance Criteria

### AI Observer Functionality
- [x] AI Observer receives `SnapshotForAI` and returns `AIIntentResult`
- [x] Prompt includes semantic context (tag, name, role, behavioral signals, session context)
- [x] Prompt does NOT include raw selectors, XPath, or framework-generated IDs
- [x] AI output validated against evidence (P7: hallucination rejection)
- [x] Confidence clamped to [0.05, 0.95] (P5)
- [x] Evidence Sovereignty: Tier 1/2 results override AI (structurally enforced by classifier rule ordering)

### Pipeline Integration
- [ ] `requestAIRefinement()` calls AI Observer when `aiEligible=true`
- [ ] Re-classification with AI advisory updates Timeline when type changes
- [ ] AI enrichment (businessName, userIntent, confidence) attached to Timeline entries
- [ ] `onEventUpdate` callback fires when reclassification changes the type

### Mental Model
- [ ] Mental Model (L2) updated progressively across interactions
- [ ] Mental Model persisted to `chrome.storage.local` (MV3-safe)
- [ ] Confidence Engine wired and producing 5-track weighted scores
- [ ] Workflow Analyzer wired and producing workflow hypotheses

### Graceful Degradation
- [ ] System works without AI (flag ON, no provider configured → Tier 1/2 only, no errors)
- [ ] When AI returns low-confidence result → deterministic classification preserved
- [ ] When AI is rejected by hallucination check → deterministic classification preserved
- [ ] Zero regression: all existing tests pass

### ai-understanding Bridge
- [ ] `buildSemanticPrompt()` re-exports from ai-observer.ts
- [ ] `parseIntentResponse()` re-exports from ai-observer.ts

## Deterministic vs AI Interaction Model

```
Phase 1 (immediate, synchronous):
  snapshot → classifySnapshot(aiResult=null) → SessionEvent → Timeline
  If aiEligible=true → trigger Phase 2

Phase 2 (async, ~200ms–2s):
  snapshot → toSnapshotForAI() → AIObserver.understand() → AIIntentResult
  → classifySnapshot(snapshot, aiResult) → re-classify
  → if type changed: update Timeline entry (Phase 2 reclassification)
  → always: attach enrichment data (businessName, userIntent)

Conflict Resolution (Evidence Sovereignty / AP4):
  Tier 1 rules (R1–R6): always authoritative. AI CANNOT override.
  Tier 2 rules (R7–R14): always override AI. AI CANNOT override.
  Tier 3 rules (R15–R16): AI advisory ONLY fires when no T1/T2 matched.
    R15: AI conf ≥ threshold → use AI type
    R16: fallback click (conf 0.3)

  Result: deterministic evidence always wins. AI only helps for ambiguous clicks
  that no deterministic rule can classify.
```
