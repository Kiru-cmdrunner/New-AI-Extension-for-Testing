# Task Spec: Execution IR — Type System + Generator + Staleness

**Status:** Active
**Date:** 2026-07-20
**Blueprint reference:** `execution-ir-design.md`, `domain-schema.md` §3.9
**Scope:** Implement the Execution IR type system, generator, staleness detection, adapter interfaces, and repository persistence.

---

## Context

The repository layer (Project, ATC, Element, SourceArtifact) is complete and validated. The Execution IR is the next architectural milestone — a framework-neutral execution contract derived from the ATC + Element Repository. It sits between the canonical domain model and execution/code-generation adapters.

## Files to Create

### Domain Layer — IR Types
```
src/domain/execution-ir/
  types.ts                    — IRAction, ResolvedLocator, ResolvedTarget, IRAssertion,
                                ExecutionParameters, IRInput, IRStep, IREnvironment,
                                ExecutionIRPlan, RenderingEngine, RenderingFormat,
                                Rendering, ExecutionIRArtifact
  staleness.ts                — IRStalenessStatus, IRStalenessReport, StalenessReason,
                                checkStaleness(), detectLocatorChanges()
  generator.ts                — IRGenerator interface + DefaultIRGenerator implementation
  index.ts                    — barrel export
  adapters/
    ir-executor.ts            — IRExecutor interface + result types
    ir-code-generator.ts      — IRCodeGenerator interface + GeneratorConfig + result types
    index.ts                  — barrel export
```

### Repository Layer
```
src/repository/v2/interfaces/
  execution-ir-repository.ts  — getById, getByTestCaseVersion, save, delete
src/repository/v2/dexie/
  dexie-execution-ir-repository.ts
```

### Database + UoW Updates
- `dexie-database.ts` — add `executionIRs` table
- `dexie-unit-of-work.ts` — wire ExecutionIRRepository into transaction

### Tests
```
tests/domain/execution-ir/
  types.test.ts               — type validation, defaults, IRAction superset
  generator.test.ts           — ATC+Elements → IR plan generation
  staleness.test.ts           — staleness detection + locator diff
tests/repository-v2/
  execution-ir-repository.test.ts — CRUD + caching semantics
```

## Acceptance Criteria

### Type System
- [ ] AC-1: `IRAction` is a superset of `StepAction` (all 9 business-authored actions present with identical string values).
- [ ] AC-2: `ResolvedTarget` is a discriminated union with kind: 'element' | 'url' | 'none'.
- [ ] AC-3: `ElementTarget` carries `elementId`, `elementName`, `pageOrComponent`, `resolvedLocators[]`.
- [ ] AC-4: `IRStep` is self-contained (no references to other steps).
- [ ] AC-5: `ExecutionParameters` has all 4 fields (timeoutMs, retryCount, retryDelayMs, waitStrategy).
- [ ] AC-6: `ExecutionIRPlan` contains testCaseId, testCaseVersionId, testCaseVersionNumber, title, tags, environment, steps[].
- [ ] AC-7: `ExecutionIRArtifact` wraps plan with id, generatedAt, generatorVersion, renderings.
- [ ] AC-8: IR types import ONLY from `src/domain/enums.ts` — no Dexie, no repository, no adapter imports.

### Generator
- [ ] AC-9: `DefaultIRGenerator.generate()` takes ApprovedTestCase + TestCaseVersion + Map<string, Element> + IREnvironment, returns ExecutionIRArtifact. (4 params: ATC provides title/tags, Version provides steps, Map provides elements, Environment provides baseUrl/browser/viewport.)
- [ ] AC-10: Each ATC step's `elementId` is resolved to concrete locators from the Element map.
- [ ] AC-11: `StepAction → IRAction` mapping is 1:1 identity for all 9 business-authored actions.
- [ ] AC-12: Navigation steps resolve relative URLs against `baseUrl` from IREnvironment.
- [ ] AC-13: Generator injects `WAIT_FOR_ELEMENT` steps before element-interacting steps when waitStrategy != 'none'.
- [ ] AC-14: Default ExecutionParameters applied (timeoutMs=30000, retryCount=0, retryDelayMs=1000, waitStrategy='visible').
- [ ] AC-15: Generator is stateless and pure (same inputs → same output, modulo timestamps and UUIDs).

### Staleness
- [ ] AC-16: `checkStaleness()` returns 'missing' when no artifact exists.
- [ ] AC-17: Returns 'stale' when any referenced element's updatedAt > artifact.generatedAt.
- [ ] AC-18: Returns 'stale' when generatorVersion differs.
- [ ] AC-19: Returns 'fresh' when all checks pass.
- [ ] AC-20: `detectLocatorChanges()` compares old and new IR plans, returns diffs per element.

### Adapter Interfaces
- [ ] AC-21: `IRExecutor` interface defined with `execute(plan, options)` returning `IRExecutionResult`.
- [ ] AC-22: `IRCodeGenerator` interface defined with `generate(plan, config)` returning `GenerationResult`.
- [ ] AC-23: `GeneratorConfig` has language, pattern, assertions, fileStructure fields.

### Repository
- [ ] AC-24: `ExecutionIRRepository` has getById, getByTestCaseVersion, save (replace semantics), delete.
- [ ] AC-25: Dexie table `executionIRs` with indexes on id and testCaseVersionId.
- [ ] AC-26: save() replaces existing artifact for the same testCaseVersionId (INV-IR7).
- [ ] AC-27: ExecutionIRRepository wired into UnitOfWork transaction.

### Tests
- [ ] AC-28: All domain execution-ir tests pass.
- [ ] AC-29: Repository tests pass (CRUD + replace semantics).
- [ ] AC-30: Full suite has zero regressions.

## Key Design Decisions

1. **Plan vs. Artifact separation** — Adapters receive `ExecutionIRPlan`, not `ExecutionIRArtifact`.
2. **WAIT_FOR_ELEMENT injection** — Generator inserts execution-only steps; business intent unchanged.
3. **save() replaces, doesn't append** — One cached IR per ATC version (INV-IR7).
4. **Generator is a pure function** — Takes pre-fetched data, doesn't query the DB.
5. **pageOrComponent stays flat** — Component hierarchy is a future Component entity, not a structured string.

## Edge Cases

- ATC step with elementId pointing to an Element not in the map → generator throws (referenced element must exist at generation time).
- Navigation step with absolute URL → used as-is, baseUrl not prepended.
- Navigation step with relative URL → baseUrl prepended.
- Step with empty validations → assertions = [].
- Multiple elements on same pageOrComponent → each carries the same pageOrComponent value independently.
