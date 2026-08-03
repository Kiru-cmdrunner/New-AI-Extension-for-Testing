# Phase 5 — Pipeline Integration & Feature Flag

**Status:** Complete  
**Blueprint:** `.drytis/architecture-c-production.md` §4-§6  
**Implementation Plan:** `.drytis/architecture-c-implementation-plan.md` Phase 5  

## Goal

Wire the four Architecture C components (observer, coalescer, classifier, state tracker) into a functional pipeline. Control with a feature flag (`USE_ARCHITECTURE_C`). When ON, the new pipeline produces Timeline entries. When OFF, the old pipeline runs as before.

## Files Created

| File | Content |
|------|---------|
| `src/recorder/pipeline/architecture-c-pipeline.ts` | `ArchitectureCPipeline` class — orchestrates evidence → coalescer → classifier → SessionEvent |
| `src/recorder/observer/universal-observer-init.ts` | Content script entry point for UniversalInteractionObserver |
| `src/recorder/context/state-tracker-init.ts` | Content script entry point for StateTracker |
| `tests/architecture-c-pipeline.test.ts` | Integration tests (20 tests) |

## Files Modified

| File | Changes |
|------|---------|
| `src/background/service-worker.ts` | Feature flag check; route RAW_EVIDENCE to pipeline; gate old handlers when flag ON; navigation routing; pipeline init/flush lifecycle |
| `src/shared/types.ts` | ARCHITECTURE_C_ENABLED in StorageKeys; RAW_EVIDENCE + DETERMINISTIC_STATE in AppMessage |
| `src/recorder/recording-session.ts` | addArchCEvent() method for pipeline-produced events |
| `src/manifest.json` | Version 7.0.0; added universal-observer-init.ts and state-tracker-init.ts content scripts |
| `src/sidepanel/timeline-renderer.ts` | Classification evidence badge for Arch C events |
| `src/sidepanel/sidepanel.css` | Classification badge CSS (tier1 blue, tier2 amber, tier3 pink) |

## Canonical Type → SessionEvent Mapping

| CanonicalType | SessionEvent type | ID prefix |
|---|---|---|
| click | click | click |
| fill | text | text |
| select | select | select |
| selectDate | dateSelect | dateSelect |
| toggle | checkbox | checkbox (or radio if role=radio) |
| hover | hover | hover |
| navigate | navigation | nav |
| pressKey | click | click (no separate key event type) |
| upload | click | click (no separate upload event type) |
| drag | click | click (no separate drag event type) |

## Acceptance Criteria

- [x] Feature flag controls which pipeline is active
- [x] RAW_EVIDENCE → coalescer → classifier → SessionEvent when flag ON
- [x] Old message handlers work exactly as v6.1.0 when flag OFF
- [x] All 10 canonical types map to valid SessionEvents
- [x] Timeline entries feed into generation pipeline without errors
- [x] All integration tests pass (20 tests)
- [x] TypeScript compiles (162 errors, all pre-existing — 0 new)
- [x] Build succeeds
- [x] Classification evidence displayed in timeline (R1-R16 badge with tier)
- [x] No duplicate events when flag ON (legacy handlers gated)
