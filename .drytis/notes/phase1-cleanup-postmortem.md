# Phase 1 Cleanup — Postmortem

## Date: 2026-07-31

## Objective
Full architectural cleanup before freezing Phase 1 as foundation for Phase 2.

## Runtime Bugs Fixed
1. **`RecordingState.Error` missing** — Added `Error = 'error'` to enum. Was referenced at SW line 219 but didn't exist → TypeError on internal page guard.
2. **UnitOfWork interface violation** (3 locations) — SW staleness check (line 618), execution run persistence (line 712), and ir-executor-impl.ts (line 440) all accessed `uow.elements`/`uow.commit()` directly instead of using `uow.execute(async (repos) => {...})`. Fixed all three.
3. **AppMessage type holes** — Added `OBSERVED_EVENT` and `IFRAME_SELECTORS` to AppMessage union (were handled at runtime but not in the type).
4. **`as any` casts in ObservedEvent → RecordedEvent conversion** — Replaced with typed casts (`ElementRecordedEvent['eventType']`, `DomContext | undefined`).

## Dead Subsystems Removed (72 source files, ~20,500 lines)
- `src/pipeline/` — entire directory (31 files, ~6,700 lines)
- `src/types/` — entire directory (8 files, ~2,100 lines)
- `src/classifier/semantic/` — entire directory (5 files, ~2,100 lines)
- `src/classifier/evidence/providers/` — 5 files, ~3,200 lines
- `src/classifier/evidence/engine.ts`, `detector.ts`, `combination.ts`, `ab-comparison.ts`, `merge-layer.ts` — 5 files, ~1,500 lines
- `src/recorder/deterministic-recorder.ts` — 3,120 lines (the v1 god-module)
- `src/recorder/recording-session.ts`, `interaction-types.ts`, `surface-detector.ts`, `element-id-generator.ts`, `step-id-generator.ts` — v1 recorder files
- `src/recorder/v2/interaction-recognizer.ts`
- `src/execution/action-executor.ts`, `assertion-evaluator.ts`, `executor-content-script.ts`, `locator-resolver.ts`
- `src/infrastructure/audit-manager.ts`, `error-handler.ts`, `logging-manager.ts` + removed empty dir

## Type System Fixes
- **ElementIdentity re-export** — Added `export type { ElementIdentity }` to both `component-types.ts` and `recorded-event.ts`. Eliminated 22 TS2459 errors across 24 files in one shot.
- **InteractionMetadata** — Added missing optional fields: `targetName`, `tags`, `otpValue`, `sequenceDisplay`, `playwrightSequence`, `isMultiConfig`, `configurationSession`, `subActions`, `pageTitle`, `pageUrl`.
- **SearchableDropdown** — Removed from INTERACTION_CATEGORIES (not in InteractionType union).
- **ComponentState** — Added `'discarded'` to match `ComponentEndState`.
- **Dead provider-based types** — Removed from `evidence/types.ts` (kept only intent-based types, 147 lines from 299).
- **Broken import paths** — Fixed `../recorder/recorded-event` → `../recorded-event` in pipeline-runner.ts and domain-adapter-v2.ts; fixed `./component-types` → `../shared/component-types` in output-adapter.ts.
- **StorageService** — Widened `setRaw`/`getRaw`/`onKeyChanged` to accept `StorageKeys | string` for dynamic keys like `cmdrunner_live_interactions`.

## Code Hygiene
- Removed all unused imports, variables, and dead regex patterns (~57 items)
- Prefixed intentional unused params with `_`
- Removed 7 unused regex constants from patterns.ts
- Removed dead `parseAncestorRoles` function
- Removed dead `renderTimeline`/`renderRecordingTimeline` wrappers in sidepanel
- Updated stale comments referencing deleted `deterministic-recorder.ts`

## Metrics
| Metric | Before | After | Delta |
|--------|--------|-------|-------|
| Source files | 234 | 162 | -72 (−31%) |
| Source lines | 63,681 | 43,152 | −20,529 (−32%) |
| Test files | 210 | 136 | −74 |
| Test lines | 90,527 | 55,493 | −35,034 |
| Source TS errors | 188 | 0 | −188 |
| Test TS errors | 544 | 346 | −198 |
| Tests passing | 4,811/4,813 | 2,991/2,992 | (dead tests removed) |

## Remaining Technical Debt
1. **346 test TS errors** — tests run via esbuild (strips types), but aren't type-checked. Lower priority since the test suite passes.
2. **`as unknown as` casts** (3 remaining) — in ir-executor-impl.ts, enrichment-orchestrator.ts, service-worker.ts. These bridge structural type mismatches between RecordedEvent and SessionEvent that would require a deeper type unification.
3. **Flaky perf benchmark** — `milestone4-performance-scaling.test.ts` has JSDOM timing sensitivity. Passes in isolation.
4. **Magic constants** — Evidence weights still inline in generators.ts. Not blocking but would improve maintainability.
