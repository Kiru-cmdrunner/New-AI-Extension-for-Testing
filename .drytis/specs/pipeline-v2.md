# Pipeline V2 — Intent-Based Interaction Pipeline

## Overview

Replaces the Architecture C pipeline (Snapshot Coalescer → Multi-Tier Classifier → Transaction
State-Machine Assembler) with a new layered pipeline that uses State Diff as the primary signal
and Pattern Registry as an accelerator (not a gatekeeper).

**8 learnings from the Drytis Recorder failed implementation:**
1. ✅ Single canonical event schema shared by every layer
2. ✅ Closed event vocabulary — exhaustive switch prevents silent drops
3. ✅ End-to-end browser validation per phase, not just unit tests
4. ✅ Every event type in the vocabulary has a real producer
5. ✅ Runtime traceability — every event's journey through all layers is visible
6. ✅ No stale comments — content script accurately describes what it captures
7. ✅ collectIdentity() populates ALL fields the assembler reads
8. ✅ Full verification: unit + integration + browser

## Architecture

```
V2 Event Observer (content script)
  → PIPELINE_EVENT messages
    → BoundaryDetector: groups events into InteractionUnit
      → StateDiffEngine: computes before/after DOM state diff
        → PatternRegistry: matches generic interaction behaviors
          → InteractionAssembler: collapses composite interactions
            → IntentResolver: resolves final business action from diff + pattern
              → toSessionEvent(): produces SessionEvent (same 8 types)
                → session.addArchCEvent()
```

## Component Disposition

| Component | Status |
|-----------|--------|
| V2 Event Observer | New — replaces Universal Interaction Observer |
| BoundaryDetector | New — replaces SnapshotCoalescer |
| StateDiffEngine | New — extends StateTracker concept |
| PatternRegistry | New — replaces MultiTierClassifier |
| InteractionAssembler | New — replaces old InteractionAssembler |
| IntentResolver | New — replaces Architecture C classifier+AI path |
| PipelineV2 | New — replaces ArchitectureCPipeline |
| RecordingSession | **Unchanged** — addArchCEvent() works generically |
| GenerationEngine | **Unchanged** — reads SessionEvent[] |
| All Generators | **Unchanged** — read SessionEvent[] / CanonicalStep[] |
| StorageService | **Unchanged** |
| SidePanel | **Unchanged** (trace view added separately) |
| Service Worker | **Extended** — new PIPELINE_V2_ENABLED branch |
| 6 Legacy Scripts | **Unchanged** — gated behind ARCHITECTURE_C_ENABLED |

## Integration Contract

The new pipeline emits the same `SessionEvent` union (8 variants):
navigation, click, text, hover, checkbox, radio, select, dateSelect.

No downstream component requires modification.

## Feature Flag

`PIPELINE_V2_ENABLED` in chrome.storage.local, default false during development.
Read once at START_RECORDING (same pattern as ARCHITECTURE_C_ENABLED).

Priority: PIPELINE_V2_ENABLED > ARCHITECTURE_C_ENABLED > legacy scripts.

## Phases

### Phase 0: Canonical Event Schema + Event Vocabulary
- Define PipelineEvent interface (shared by all layers)
- Define RecordedEventType enum (closed vocabulary)
- Define InteractionUnit, StateDiff, PatternMatch, ResolvedAction types
- Define PipelineTracer types
- Unit tests for schema compliance

### Phase 1: Boundary Detector
- Groups PipelineEvents into InteractionUnit objects
- Detects boundaries: surface open/close, temporal gaps, focus changes
- Unit tests + browser validation

### Phase 2: State Diff Engine
- Snapshots DOM state before/after each interaction unit
- Computes structured StateDiff
- Unit tests + browser validation

### Phase 3: Pattern Registry
- ~12 generic interaction behavior patterns
- Framework-agnostic — behavior-based, not component-based
- Unit tests + browser validation

### Phase 4: Interaction Assembler
- Collapses composite interaction units into single business actions
- Uses state diff confirmation
- Unit tests + browser validation

### Phase 5: Intent Resolver
- Resolves final business action from diff + pattern + boundary scope
- Always produces a business action (graceful degradation)
- Confidence scoring
- Unit tests + browser validation

### Phase 6: V2 Event Observer
- Content script that captures DOM events
- Emits PipelineEvent using canonical schema
- Every event type has a real producer
- Unit tests + browser validation

### Phase 7: Pipeline V2 Orchestrator + Service Worker
- Wires all layers together
- Same interface as ArchitectureCPipeline (onEvent, ingestEvidence, flush, reset)
- Service worker START_RECORDING branch
- Unit + integration tests

### Phase 8: Runtime Tracer + Trace UI
- PipelineTracer logs every event's journey
- Trace entries visible in DevTools console
- Side panel trace view (optional — if time permits)
- Unit tests

### Phase 9: Demo App + End-to-End Validation
- Demo app with all interaction types
- Comprehensive browser testing via tester sub-agent

## Acceptance Criteria

- [ ] Canonical event schema defined and unit tested
- [ ] Event vocabulary is closed (exhaustive switch enforced)
- [ ] Boundary Detector correctly groups events into interaction units
- [ ] State Diff Engine captures all state model fields
- [ ] Pattern Registry has ~12 generic behavior patterns
- [ ] Interaction Assembler collapses composite interactions
- [ ] Intent Resolver always produces a business action
- [ ] V2 Event Observer produces every event type in the vocabulary
- [ ] Pipeline V2 emits valid SessionEvent objects
- [ ] Service worker wiring works with feature flag
- [ ] Runtime tracer shows event flow through all layers
- [ ] Demo app validates all interaction types end-to-end
- [ ] All existing tests still pass (no regression)
- [ ] No hardcoded secrets, URLs, or credentials
