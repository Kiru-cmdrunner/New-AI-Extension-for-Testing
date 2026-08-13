# M9.2 — State Builder + Entity/Collection/Counter Tracking

## Overview

Second increment of M9. Consumes the SignalSet output from M9.1 and builds
an accumulating ApplicationState across interactions. State is in-memory only.

## Scope

- New signal types: NotificationSignal, CounterChangeSignal, ListChangeSignal, InputValueChangeSignal
- New signal extractors: NotificationSignalExtractor, CounterSignalExtractor, ListSignalExtractor, TargetStateSignalExtractor
- SignalSet expansion (additive fields on existing interface)
- ApplicationState type + StateBuilder (stateful accumulator)
- EntityTracker, CollectionTracker, CounterTracker, NotificationTracker
- Focused tests + Amazon workflow validation

## NOT in scope
- Outcome determination (M9.3)
- Relationships (M9.3)
- Page Content Observer (M9.4)
- Dexie V5 / persistence (M9.5)
- LLM interpretation (M9.7)

## M9.1 modifications (additive only)
- types.ts: add new signal types + expand SignalSet
- signal-extractor.ts: add new switch cases in coordinator
- index.ts: add new exports

## Files to Add

| File | Purpose |
|------|---------|
| `src/understanding/state-builder/types.ts` | ApplicationState, Entity, Collection, Counter, NotificationRecord |
| `src/understanding/state-builder/state-builder.ts` | Stateful accumulator: signals → state |
| `src/understanding/state-builder/entity-tracker.ts` | Entity create/update/lookup |
| `src/understanding/state-builder/collection-tracker.ts` | Collection tracking |
| `src/understanding/state-builder/counter-tracker.ts` | Counter history |
| `src/understanding/state-builder/notification-tracker.ts` | Notification history |
| `src/understanding/signal-extractors/notification-signals.ts` | SurfaceChange → NotificationSignal |
| `src/understanding/signal-extractors/counter-signals.ts` | DomChangeSummary → CounterChangeSignal |
| `src/understanding/signal-extractors/list-signals.ts` | DomChangeSummary → ListChangeSignal |
| `src/understanding/signal-extractors/target-state-signals.ts` | TargetEvidence → InputValueChangeSignal |
| `tests/understanding/state-builder.test.ts` | Focused tests |

## Acceptance Criteria

- [ ] 4 new signal extractors produce correct signals from evidence
- [ ] ApplicationState accumulates view changes across interactions
- [ ] EntityTracker creates/updates entities from view + target evidence
- [ ] CollectionTracker tracks list sizes from DOM mutation signals
- [ ] CounterTracker tracks numeric text changes with before→after deltas
- [ ] NotificationTracker captures surface text and lifecycle
- [ ] Amazon workflow: state evolves correctly across all interactions
- [ ] State continuity: each interaction sees the previous state
- [ ] All 2,553+ existing tests pass unchanged
- [ ] TSC 0 errors, build succeeds
