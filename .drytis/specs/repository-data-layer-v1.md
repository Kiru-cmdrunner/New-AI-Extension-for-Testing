# Task Spec: Repository Data Layer — Domain Model + Dexie Implementation

**Status:** Active
**Date:** 2026-07-20
**Blueprint reference:** `domain-schema.md`, `domain-erd.md`, `domain-scope.md`
**Scope:** Implement the three foundational aggregates (Project, Approved Test Case, Element Repository) with pure domain entities, repository interfaces, Unit of Work abstraction, and Dexie.js V1 storage.

---

## Context

The existing `src/repository/` uses the OLD hierarchy model (Project→Feature→Scenario→TestCase) stored flat in `chrome.storage.local`. This task creates a NEW domain layer (`src/domain/`) and NEW repository infrastructure (`src/repository/v2/`) that implement the frozen V1 architecture. The old code remains untouched and functional — this is additive.

## Files to Create

### Domain Layer (pure TypeScript — zero storage imports)

```
src/domain/
  enums.ts                              — All domain enums
  entities/
    project.ts                          — Project entity + factory
    approved-test-case.ts              — ATC identity + ATC Version + Step + Validation + AIMetadata
    element.ts                          — Element + LocatorStrategy
  errors/
    invariant-errors.ts                — Invariant violation error classes
```

### Repository Interfaces (storage-agnostic)

```
src/repository/v2/
  interfaces/
    project-repository.ts              — ProjectRepository interface
    test-case-repository.ts            — TestCaseRepository interface
    element-repository.ts              — ElementRepository interface
    unit-of-work.ts                    — UnitOfWork + RepositoryFactory interfaces
```

### Dexie Implementation (V1 storage)

```
src/repository/v2/
  dexie/
    dexie-database.ts                  — Dexie DB schema + table definitions
    dexie-unit-of-work.ts             — DexieUnitOfWork (wraps db.transaction)
    dexie-project-repository.ts       — DexieProjectRepository
    dexie-test-case-repository.ts     — DexieTestCaseRepository
    dexie-element-repository.ts       — DexieElementRepository
    dexie-repository-factory.ts       — Factory that creates repos within a UoW
```

### Tests

```
tests/
  domain/
    project.test.ts                    — Project entity creation + invariants
    approved-test-case.test.ts        — ATC/Version/Step creation + invariants
    element.test.ts                    — Element creation + invariants
  repository-v2/
    project-repository.test.ts        — ProjectRepository CRUD via Dexie
    test-case-repository.test.ts      — TestCaseRepository CRUD + versioning via Dexie
    element-repository.test.ts        — ElementRepository CRUD + referential integrity via Dexie
    unit-of-work.test.ts              — Cross-repository atomic operations
```

## Acceptance Criteria

### Domain Layer

- [ ] **AC-1:** Every entity type matches `schema.md` field definitions exactly (field names, types, required/optional).
- [ ] **AC-2:** Entity factory functions enforce required-field validation (throw on missing required fields).
- [ ] **AC-3:** Enums match `schema.md` enum values.
- [ ] **AC-4:** Steps reference elements by `elementId` string, never by name or selector (INV-ATCV4).
- [ ] **AC-5:** ATC Version `versionNumber` starts at 1 and increments monotonically (INV-ATCV2).
- [ ] **AC-6:** Each Step has `elementId` required for all actions except `navigate` and `wait`.
- [ ] **AC-7:** Element `locatorStrategies` is always a non-empty array (INV-EL4).
- [ ] **AC-8:** LocatorStrategy priorities are unique within an element (no two strategies with the same priority).
- [ ] **AC-9:** Domain layer imports NOTHING from Dexie, chrome.storage, or any storage module.

### Repository Interfaces

- [ ] **AC-10:** `ProjectRepository` interface has: `getById`, `getAll`, `create`, `update`, `delete`.
- [ ] **AC-11:** `TestCaseRepository` interface has: `getById`, `getVersion`, `getCurrentVersion`, `createVersion`, `listVersions`, `updateMetadata`, `getByProject`, `getByTag`.
- [ ] **AC-12:** `ElementRepository` interface has: `getById`, `getByProject`, `getByPageComponent`, `create`, `update`, `delete`, `isReferenced`.
- [ ] **AC-13:** `UnitOfWork` interface has: `projects`, `testCases`, `elements` (repository accessors), `commit`, `rollback`.
- [ ] **AC-14:** All interface methods return `Promise<T>` (async from day one).

### Dexie Implementation

- [ ] **AC-15:** Dexie database has tables: `projects`, `testCases`, `testCaseVersions`, `elements`.
- [ ] **AC-16:** Steps and Validations are stored inline within `testCaseVersions` records (value objects within aggregate).
- [ ] **AC-17:** LocatorStrategies are stored inline within `elements` records.
- [ ] **AC-18:** `DexieUnitOfWork.commit()` is a no-op (Dexie transactions auto-commit); `rollback()` aborts the transaction.
- [ ] **AC-19:** Deleting an Element referenced by any ATC Version throws (INV-EL3 enforced).
- [ ] **AC-20:** Creating an ATC without Version 1 in the same transaction throws (INV-ATC1).
- [ ] **AC-21:** Tag-based query (`getByTag`) uses Dexie multi-entry index.

### Tests

- [ ] **AC-22:** Domain entity tests cover: valid creation, missing required fields, invariant violations.
- [ ] **AC-23:** Repository tests cover: CRUD lifecycle, versioning chain, referential integrity (element deletion blocked).
- [ ] **AC-24:** Unit of Work test: create Element + ATC Version atomically; verify rollback on error.
- [ ] **AC-25:** All tests pass with `npx vitest run`.

## Dependencies to Install

- `dexie` — IndexedDB wrapper
- `fake-indexeddb` (dev) — In-memory IndexedDB for tests

## Key Design Decisions

1. **IDs are UUIDs** generated via `crypto.randomUUID()` (available in Chrome extensions and Node 19+).
2. **Value objects (Step, Validation, LocatorStrategy) are TypeScript interfaces**, not classes — they're plain data. The entity factories construct and validate them.
3. **Entities have factory functions** (`createProject()`, `createTestCaseVersion()`, etc.) that enforce invariants at construction time. This is constructor-level validation.
4. **The old `src/repository/` code is untouched** — new code lives in `src/domain/` and `src/repository/v2/`.
5. **Timestamps are ISO strings** (`new Date().toISOString()`), consistent with the existing codebase.

## Edge Cases

- Creating a test case version with a step whose `elementId` doesn't exist yet (allowed at domain level — the Element may be created in the same UoW transaction; referential integrity is enforced at delete time, not create time).
- Creating a version with `parentVersionId` pointing to a non-existent version (allowed — the chain is advisory for diff purposes).
- Empty tag list on a test case (valid — tags are optional).
- Element with only one locator strategy (valid — minimum is 1).
