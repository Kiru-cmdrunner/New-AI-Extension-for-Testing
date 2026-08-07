# Master Architectural Assessment — Semantic Test Intelligence

**Date:** 2026-08-06
**Scope:** Complete project review — architecture, implementation status, technical debt, roadmap.

## Key Finding: Two Parallel Architectures

The project has evolved through multiple architectural eras. The critical discovery is that
**~9,675 lines of code (~20% of total source) are DEAD** — never called from the production
pipeline. These represent earlier architectural approaches (V1/V2 classifier, recognition
layer, Application Knowledge Model enrichment) that were superseded by the Component Runtime
+ Capability Model pipeline.

The production pipeline is:
1. EventTap → ObservedEvent
2. ComponentRuntime.process() → ComponentInteraction[]
3. enrichInteraction() (component type + framework + business meaning)
4. ObservationCoordinator → M1 behavioral windows → M2 semantic effects
5. filterProductionInteractions()
6. runCapabilityInference() → CapabilityRecord[]
7. toIRActions() → IRAction[]
8. buildIRPlan({understanding: null}) → ExecutionIRPlan
9. PlaywrightCodeGenerator.generate() → .spec.ts files
10. persistSession() → Repository V2 (Dexie)

Dead subsystems (never called from production):
- src/classifier/ (V1 interaction-detector + V2 evidence engine + 5 providers) — 4,595 lines
- src/recorder/recognition/ (structural + behavioral recognizers) — 2,515 lines
- src/recorder/enrichment/ (7-step Application Knowledge Model) — 2,010 lines
- src/recorder/pipeline/pipeline-runner.ts + domain-adapter.ts — 555 lines

The IR Bridge was designed to accept an ApplicationKnowledgeFragment for assertions and
workflow structure, but receives `null` in production. The enrichment orchestrator that
would produce it is never called.

## What's Working Well
- EventTap + ComponentRuntime: solid capture-first foundation, capture-guarantee-v2
- 14 component definitions with lifecycle management
- M1/M2 behavioral observation + semantic effects (fully wired)
- Capability Model (12 types, all rules, conflict resolution — fully wired)
- Execution IR + Playwright code generation (fully wired)
- Repository V2 (Dexie persistence — fully wired)
- 3,962 tests passing
- 9,675 lines of dead code have tests but serve no production purpose

## Critical Gaps
- G1: Drag-and-drop completely invisible
- G3: keydown captured but not consumed by most definitions
- AI enrichment: `understanding: null` in IR Bridge — the designed-for enrichment never runs
- Unclassified interactions bypass dedup (theoretical duplication risk)
- Enrichment DOM inspector is a no-op in SW context
- Service worker uses `any[]` casts to adapt ComponentInteraction → IR Bridge input

## Architectural Decision Point
The project needs to decide: revive the recognition + enrichment pipeline (which would give
assertions, workflow structure, and semantic grouping), or build those capabilities into
the live ComponentRuntime + CapabilityModel pipeline directly. The dead code represents
significant investment but also significant architectural complexity.
