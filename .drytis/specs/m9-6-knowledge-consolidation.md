# M9.6 — Application Knowledge Consolidation & Consistency

## Objective

A **read-only** consolidation layer that turns M9.5's accumulated
observations into a coherent application model. No writes, no schema
changes, no LLM interpretation. Confidence, duplicate, and stale detection
**report findings only** — they never delete, overwrite, merge, or
downgrade persisted knowledge.

## Self-Review Summary

M9.1–M9.4 produce in-memory signals, state, and outcomes per session.
M9.5 persists these into 9 Dexie tables. What's missing is the ability to:

- Load and assemble persisted rows into a coherent read model
- Score knowledge confidence from observation frequency / recency / source diversity
- Detect stale, duplicate, or evolving entities (report only)
- Reconstruct an ordered user journey from scattered transitions + outcomes
- Preload prior-session knowledge into StateBuilder for cross-session continuity
- Validate consistency between in-memory ApplicationState and persisted knowledge

M9.6 fills all six gaps with a pure read layer over KnowledgeRepository.

## Architecture

```
At session START:
  KnowledgeLoader.load(appId) → ApplicationKnowledge
  KnowledgePreloader.seed(ApplicationKnowledge) → StateBuilderSeed
  StateBuilder initialized with seed

At session END (after M9.5 persist):
  KnowledgeLoader.load(appId) → refreshed ApplicationKnowledge
  ConflictDetector.check(ApplicationKnowledge) → findings
  JourneyReconstructor.reconstruct(appId) → JourneyTimeline
  ConsistencyChecker.check(applicationState, persistedKnowledge) → gaps
```

All components are pure consumers of `KnowledgeRepository` (M9.5).
Zero writes. Zero schema changes.

## Confidence Scoring Formula

Three factors, each 0.0–1.0, weighted equally:

1. **Observation count** — `min(revision / 5, 1.0)` for entities,
   `min(visitCount / 5, 1.0)` for views.
2. **Recency** — `1.0` if seen in the latest session, decaying by
   `0.15` per session since last seen (min 0.1).
3. **Source diversity** — entities only: `distinctSources / 4`.
   Views/outcomes: fixed 1.0.

Final: `(observationScore + recencyScore + sourceScore) / 3`.

## Conflict Detection (report only)

- **Duplicate entities** — same type + ≥50% overlapping attribute keys with
  different entityIds.
- **Stale knowledge** — `lastSeenAt` more than N sessions behind app's
  latest session (default 5).
- **Evolving entities** — `revision > 1` (attributes changed across sessions).
- **Orphaned transitions** — state transitions referencing views/entities
  not present in knowledge base.

None of these findings mutate data. They are returned as structured reports.

## Journey Reconstruction

Orders persisted `KnowledgeStateTransitionRow` + `KnowledgeOutcomeRow`
by timestamp. Groups by session, then by view. Produces a
`JourneyTimeline` with ordered steps, coverage %, and gap detection.

## Files

| File | Purpose |
|------|---------|
| `src/understanding/consolidation/application-knowledge.ts` | Read-model types |
| `src/understanding/consolidation/knowledge-loader.ts` | Assemble + score |
| `src/understanding/consolidation/conflict-detector.ts` | Report findings |
| `src/understanding/consolidation/journey-reconstructor.ts` | Ordered timeline |
| `src/understanding/consolidation/knowledge-preloader.ts` | StateBuilder seed |
| `src/understanding/consolidation/consistency-checker.ts` | State vs persisted |
| `tests/understanding/knowledge-consolidation.test.ts` | Focused tests |

Only additive change: `src/understanding/index.ts` (exports).

## Acceptance Criteria

- [ ] ApplicationKnowledge assembles from persisted rows
- [ ] Confidence scoring: multi-session entities score higher than single-session
- [ ] Duplicate detection: same-type overlapping-attribute entities flagged
- [ ] Stale detection: entities not seen in N+ sessions flagged with age
- [ ] Journey reconstruction: ordered timeline with coverage %, handles gaps
- [ ] Knowledge preloader: seeds StateBuilder with prior entities/views/counters
- [ ] Consistency checker: compares in-memory vs persisted entity IDs
- [ ] All read-only — zero writes, zero schema changes
- [ ] No M9.1–M9.5 or M1–M8 files modified (except additive index.ts)
- [ ] Full regression: 2,641+ tests pass
- [ ] TSC 0 errors, clean build
