# M9.1 — Signal Extraction Framework + View/Navigation Signals

## Overview

First increment of M9 (Application Understanding). Builds the deterministic signal
extraction pipeline that reads M1–M8 BehavioralEvidence and produces semantic signals.

**No Dexie V5. No ApplicationState persistence. No Page Content Observer. No LLM.**
Signals are computed in-memory only.

## Scope

- Type definitions for all M9 signals (`src/understanding/types.ts`)
- Signal extractor interface + pipeline coordinator
- Navigation signal extractor (URL → view change signals)
- Network signal extractor (URL → API operation signals)
- Configurable View Registry with URL patterns
- Focused unit/integration tests

## M1–M8 Preservation

All new code lives under `src/understanding/`. Zero imports from M1–M8 source files
except read-only type imports from `behavioral-evidence-types.ts` and `component-types.ts`.
No existing file is modified.

## Files to Add

| File | Purpose |
|------|---------|
| `src/understanding/types.ts` | Signal types, ViewDescriptor, ViewPattern, etc. |
| `src/understanding/signal-extractors/signal-extractor.ts` | Extractor interface + coordinator |
| `src/understanding/signal-extractors/navigation-signals.ts` | NavigationEvidence → ViewChangeSignal |
| `src/understanding/signal-extractors/network-signals.ts` | NetworkActivity → ApiOperationSignal |
| `src/understanding/signal-extractors/view-registry.ts` | Configurable URL→view pattern matching |
| `tests/understanding/signal-extraction.test.ts` | Focused tests |

## Acceptance Criteria

- [ ] types.ts defines: Signal, ViewChangeSignal, ApiOperationSignal, SignalSet, ViewDescriptor, ViewPattern, OutcomeHint
- [ ] SignalExtractor interface + SignalExtractionCoordinator that runs all extractors
- [ ] ViewRegistry with configurable patterns, ships with e-commerce defaults
- [ ] NavigationSignalExtractor extracts view changes from NavigationEvidence URLs
- [ ] NetworkSignalExtractor classifies API operations from NetworkActivity URLs
- [ ] Amazon example: search → product → cart URLs produce correct view signals
- [ ] Amazon example: /suggestions, /cart/add-to-cart produce correct API operation signals
- [ ] Unknown URLs produce no false signals (graceful degradation)
- [ ] No signal extraction for interactions without behavioralEvidence
- [ ] All 2,515+ existing tests pass unchanged
- [ ] TSC 0 errors
- [ ] Build succeeds
