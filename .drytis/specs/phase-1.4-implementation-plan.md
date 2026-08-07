# Phase 1.4 Implementation Plan — Type Safety Gate

**Date:** 2026-08-07
**Baseline:** Commit `6beb1a8` (after Phase 1.3 + TD-1 + plan approved with refinements)
**Goal:** Reduce all 400 tsc errors to zero. Establish `tsc --noEmit` as a permanent CI gate. No `@ts-ignore`, no `as any`, no type suppressions.

---

## Governing Invariant

**The objective of Phase 1.4 is not merely to achieve zero TypeScript errors. The objective is for the type system to faithfully represent the runtime architecture. If reaching zero errors requires weakening types or changing runtime behavior, stop and escalate rather than forcing the compiler to pass.**

---

## Error Census (400 total: 88 source, 312 test)

| Category | Count | Description |
|----------|-------|-------------|
| **(1) True correctness issues** | 18 | Code that will break or silently misbehave |
| **(2) Test-only debt** | 263 | Test fixtures don't match current types |
| **(3) Type definition gaps** | 93 | Types don't describe what the code already does |
| **(4) Unused imports/vars** | 125 | Dead imports left from refactoring |
| **(5) Deferred architectural debt** | 1 | Message type union needs expansion |

---

## Category Analysis

### Category 1 — True Correctness Issues (18 errors, fix in Track 1)

These are real bugs — code that accesses properties that don't exist or misuses APIs.

#### 1a. `readonly` arrays being `.push()`ed (2 errors)

**Files:** `src/domain/entities/capability.ts` (lines 286, 294)
**Error:** TS2339 — Property 'push' does not exist on type 'readonly ...[]'
**Root cause:** `ConflictResolution.conflictDetails` and `enrichmentChanges` are typed `readonly` but the code mutates them with `.push()`.
**Fix:** Change the field types from `readonly T[]` to `T[]` (mutable arrays). The values are built incrementally during enrichment — they were never intended to be immutable after creation.
**Risk:** Low. The fields are internal to the Capability domain. No consumer depends on immutability.
**Frozen system:** Capability Engine — but this is a type fix, not a logic change. The `.push()` calls already execute successfully at runtime; only the type is wrong.

#### 1b. `null` passed where non-null required (3 errors)

**Files:**
- `src/background/service-worker.ts:357` — `fragment: null` not assignable to `ApplicationKnowledgeFragment`
- `src/runtime/component-runtime.ts:106` — `string | null` not assignable to `string` (lifecycleId)
- `src/execution/ir-executor-impl.ts:437` — `Record<string, string|null>` not assignable to `ElementIdentity`

**Root cause:** Type signatures are stricter than the runtime contract. The Understanding Layer is absent (Track 3), so `fragment` is always null. The `lifecycleId` field was added in Phase 1.3 but the caller can pass null.
**Fix:**
- `UnderstandingResult.fragment`: change type to `ApplicationKnowledgeFragment | null` (it already says "null if derivation failed" in the docstring — the type was always wrong).
- `component-runtime.ts:106`: add a null guard — if `pageId` is null, use a fallback string `'unknown'`. This is a safety net, not a logic change.
- `ir-executor-impl.ts:437`: the code constructs a partial ElementIdentity from a Record. Add the missing required fields or change the function signature to accept a partial identity.
**Risk:** Low. These are type-level fixes that make the code's existing behavior explicit.
**Frozen system:** Component Runtime (lifecycleId guard) — adding a null fallback doesn't change process() logic.

#### 1c. `ComponentEndState` not assignable to `ComponentState` (2 errors)

**Files:** `src/runtime/component-runtime.ts` (lines 252, 360)
**Error:** TS2322 — assigning 'completed'|'abandoned'|'interrupted'|'discarded' to 'triggering'|'active'|'completed'
**Root cause:** `ComponentContext.state` is typed as `ComponentState` (3 values) but the runtime assigns `ComponentEndState` (4 values) at completion. The `interrupted` and `discarded` states aren't in `ComponentState`.
**Fix:** Add `'interrupted'` and `'discarded'` to the `ComponentState` union. The runtime already produces these values — the type was incomplete.
**Risk:** Low. Widening a union to include values already produced at runtime.
**Frozen system:** Component Runtime — type widening, not logic change.

#### 1d. `cmdrunner_live_interactions` not in `StorageKeys` enum (3 errors)

**Files:** `src/background/service-worker.ts:309`, `src/sidepanel/sidepanel.ts:1156,1174`
**Error:** TS2345 — string literal not assignable to StorageKeys enum
**Root cause:** `LIVE_INTERACTIONS_KEY` is a plain string constant, not a `StorageKeys` enum member. `StorageService.setRaw()` requires `StorageKeys`.
**Fix:** Either add `LIVE_INTERACTIONS = 'cmdrunner_live_interactions'` to the `StorageKeys` enum, OR change `setRaw()` to accept `string`. Preferred: add the enum member (consistent with existing pattern).
**Risk:** Low. Adding an enum value doesn't change behavior.
**Frozen system:** None.

#### 1e. `evidenceLedger` possibly null (2 errors)

**Files:** `src/runtime/sw-integration.ts:207`
**Error:** TS18047 — possibly null
**Root cause:** `RuntimeConfig.evidenceLedger` is optional (`?`). The code accesses it without null-checking.
**Fix:** Add a null guard: `if (evidenceLedger) { ... }` or assert with early return.
**Risk:** Low. The ledger is always present in production (the SW creates it). The guard is defensive.
**Frozen system:** Evidence Ledger — adding a null check in the integration layer, not changing the ledger itself.

#### 1f. `PromiseSettledResult.value` accessed without type guard (2 errors)

**Files:** `src/recorder/phase5/recorder-entry.ts` (lines 232, 300)
**Error:** TS2339 — Property 'value' does not exist on `PromiseSettledResult<T>` (which is a union of fulfilled/rejected)
**Root cause:** The code accesses `.value` without checking `.status === 'fulfilled'` first.
**Fix:** Add status check or use a type guard.
**Risk:** Low. The code already filters by status at runtime.
**Frozen system:** Recorder — type narrowing, not behavior change.

#### 1g. `WeakRef` not found (2 errors)

**Files:** `src/tap/observation-coordinator.ts` (lines 81, 136)
**Error:** TS2304 — Cannot find name 'WeakRef'
**Root cause:** `WeakRef` is a browser API available in the extension's service worker context but not in the default `lib` configuration.
**Fix:** Add `"DOM"` to `lib` in `tsconfig.json` if not present, or add a minimal type declaration.
**Risk:** Low. The runtime already uses WeakRef successfully.
**Frozen system:** Recorder — config change, not behavior.

#### 1h. Implicit `any` from self-referencing initializer (4 errors)

**Files:** `src/tap/document-observer.ts:345`, `src/tap/observation-coordinator.ts:290,294`
**Error:** TS7022/TS18046 — `parent` implicitly has type 'any', `'s'` is of type 'unknown'
**Root cause:** Variable initialization references itself before type annotation.
**Fix:** Add explicit type annotations.
**Risk:** Low.
**Frozen system:** Recorder — type annotation only.

---

### Category 2 — Test-Only Debt (263 errors, fix in Track 1)

Test fixtures use incomplete or stale object literals. The runtime code is correct — the tests just don't satisfy TypeScript's structural checks.

#### How shared helpers eliminate errors without weakening tests

**The problem:** Each test file constructs `ElementIdentity`, `ObservedEvent`, and `DomContext` by hand, writing only the 3-4 fields the test cares about. TypeScript requires all 15-20+ fields. Currently the tests "pass" because esbuild strips types — but they would silently produce `undefined` at runtime for any field they omitted, which could mask real regressions.

**The principle:** A test's *intent* lives in what it *asserts*, not in the boilerplate fields of its input fixtures. A test that verifies "Click on a checkbox toggles to checked" cares about `type: 'Checkbox'`, `trigger.accessibleName: 'Accept Terms'`, and `metadata.checked: true`. It does NOT care about `trigger.cssSelector`, `trigger.inIframe`, or `trigger.dataQa` — yet their absence is a type error.

**The approach:** Shared helpers provide *complete, type-correct objects with sensible defaults*. Tests override only the fields relevant to their assertion:

```typescript
// Before (3 errors: missing 12 fields):
const identity = { accessibleName: 'Email', tag: 'INPUT', ariaRole: 'textbox' };

// After (0 errors — helper provides defaults, test overrides what matters):
const identity = makeElementIdentity({ accessibleName: 'Email', tag: 'INPUT', ariaRole: 'textbox' });
```

**What changes:** Fixture construction. The test's arrange-act-assert structure stays identical. Every assertion stays identical. The helper is a pure data factory — no logic, no behavior, no side effects.

**What does NOT change:**
- What each test verifies (the `expect()` calls)
- The input values the test cares about (passed as overrides)
- The test's name, describe block, or structure
- The test's pass/fail outcome

**Why defaults are safe:** The helper fills non-assertion fields with inert values (`null`, `false`, `''`, `'elem-default'`). These values do not affect test outcomes because the tests don't assert on them. If a test DID assert on a defaulted field, it would already override that field — and the override takes precedence.

**Stale fixtures (TS2353):** These use field names that no longer exist on the type (`elementKey`, `cssPath`, `stepId`, `events`, `id`). These are genuinely wrong — the test is constructing an object that doesn't match any real type. The fix is to remove the stale field or rename it to the current name. This *strengthens* the test by ensuring its fixtures match reality.

#### 2a. Incomplete ElementIdentity fixtures (95 errors, TS2740)

**Files:** `tests/capabilities/*.test.ts`, `tests/enrichment.test.ts`, etc.
**Problem:** Tests construct `ElementIdentity` with only 3-4 fields (`accessibleName`, `tag`, `ariaRole`). The type requires 15+ fields.
**Fix:** Create a shared `makeElementIdentity()` test helper in `tests/helpers/` that provides all required fields with sensible defaults. Update all test files to use it.
**Risk:** Low. Mechanical fixture replacement.
**Frozen system:** None (tests only).

#### 2b. Incomplete ObservedEvent fixtures (included in TS2740 count)

**Problem:** Same pattern — tests construct partial `ObservedEvent` objects.
**Fix:** Shared `makeObservedEvent()` helper already exists at `tests/helpers/make-event.ts`. Extend it to cover the remaining fields and use it everywhere.
**Risk:** Low.

#### 2c. Stale fixture properties (41 errors, TS2353)

**Problem:** Tests use property names that no longer exist: `elementKey`, `cssPath`, `textContent`, `inputType`, `type`, `stepId`, `events`, `id`.
**Fix:** Remove stale properties from fixtures or map them to current names.
**Risk:** Low.

#### 2d. Unused test imports (89 errors, TS6133)

**Problem:** Leftover imports from refactored types.
**Fix:** Remove unused imports.
**Risk:** Zero.

#### 2e. Wrong enum usage / type assignments (38 errors, TS2322/TS2345/TS2820)

**Problem:** Tests use string literals where enum values are expected (`'navigate'` instead of `IRAction.NAVIGATE`, `'chromium'` instead of `'chrome'`, `'VISIBILITY'` instead of `ValidationType.VISIBILITY`).
**Fix:** Replace string literals with enum members.
**Risk:** Low.

---

### Category 3 — Type Definition Gaps (93 errors, fix in Track 1)

Types that don't describe what the code already does. The runtime works correctly — the types are incomplete.

#### 3a. DomContext missing 6 fields (6 errors)

**File:** `src/recorder/deterministic-recorder.ts:1002-1007`
**Problem:** Code reads `ariaValueNow`, `ariaValueText`, `ariaValueMin`, `ariaValueMax`, `nativeMin`, `nativeMax` from `DomContext`, but these fields aren't in the interface.
**Fix:** Add these 6 fields to the `DomContext` interface in `src/shared/types.ts` (or `component-types.ts` wherever it's defined).
**Risk:** Low. The recorder already produces these values at runtime.
**Frozen system:** Recorder — adding fields to a type definition. Does NOT change capture logic.

#### 3b. UnitOfWork missing 4 members (6 errors)

**Files:** `src/background/service-worker.ts`, `src/execution/ir-executor-impl.ts`
**Problem:** Code calls `uow.elements`, `uow.executionRuns`, `uow.commit()`, `uow.rollback()` but these aren't in the `UnitOfWork` interface.
**Fix:** Add these members to the `UnitOfWork` interface in `src/repository/v2/interfaces/unit-of-work.ts`. The Dexie implementation already provides them.
**Risk:** Low. Interface widening to match existing implementation.
**Frozen system:** None (repository layer).

#### 3c. RecordingSession missing `addAction` (7 errors)

**File:** `src/recorder/interaction-types.ts:348-795`
**Problem:** Code calls `session.addAction()` but the current `RecordingSession` entity doesn't have this method. The old recorder used a different session shape.
**Fix:** Investigate — `interaction-types.ts` may be partially dead code. If the `addAction` calls are in live code paths, add the method. If in dead code paths, remove them.
**Risk:** Medium. Needs investigation per call site.
**Frozen system:** Recorder — but `interaction-types.ts` may be legacy code that predates the current pipeline.

#### 3d. `ElementIdentity` not re-exported from `component-types.ts` (2+13 errors)

**Files:** `src/enrichment/component-detector.ts`, `src/runtime/component-runtime.ts`, plus 13 test files
**Problem:** These files import `ElementIdentity` from `'../shared/component-types'` but `component-types.ts` only imports it (doesn't re-export).
**Fix:** Re-export `ElementIdentity` from `component-types.ts` (`export type { ElementIdentity } from './types';`). Single-line fix eliminates 15 errors.
**Risk:** Zero.
**Frozen system:** None.

#### 3e. Wrong module paths (3 errors)

**Files:**
- `src/presentation/output-adapter.ts:19-20` — imports from `'./component-types'` (should be `'../shared/component-types'`)
- `src/recorder/surface-detector.ts:15` — imports from `'../recorded-event.ts'` (should be `'./recorded-event'` without `.ts`)

**Fix:** Correct the import paths.
**Risk:** Zero.

#### 3f. Message type union missing 2 members (2 errors)

**File:** `src/background/service-worker.ts:821,828`
**Problem:** `'OBSERVED_EVENT'` and `'BEHAVIORAL_EFFECTS'` are handled in the message switch but aren't in the `AppMessage` type union.
**Fix:** Add these message types to the union in `src/shared/types.ts`.
**Risk:** Low. The messages already arrive at runtime — the type was incomplete.
**Frozen system:** None. This is the deferred architectural debt item.

---

### Category 4 — Unused Imports/Vars (125 errors, fix in Track 1)

Pure dead-code cleanup. 36 in source, 89 in tests.

**Fix:** Remove every unused import/variable.
**Risk:** Zero.
**Frozen system:** None (removing dead code doesn't change behavior).

---

### Category 5 — Investigation Gate: `recorder/interaction-types.ts` (7 errors)

#### Investigation findings (conclusive — pending approval)

**Verdict: DEAD CODE. Should be deleted.**

**Evidence:**

1. **Zero live imports.** No file in `src/` imports from `src/recorder/interaction-types.ts`. The only reference is a comment in `src/domain/entities/application-knowledge.ts:135` that *mentions* the file by name in a docstring — not an import.

2. **Zero test imports.** No test file imports from `interaction-types.ts` or references any of its exported symbols (`registerInteractionType`, `getInteractionType`, `getRegisteredTypes`, `InteractionTypeConfig`, `ActionElementInfo`, `PlainEnglishContext`, `ActionExtras`, `BaseActionEvent`, `SHARED_JSON_INSTRUCTION`, `buildPromptHeader`, `resolveDisplayName`).

3. **Zero build references.** Not in `vite.config.ts`, not in `manifest.json`, not in any HTML file, not in the service worker's dynamic imports.

4. **Its dependency is also dead.** `interaction-types.ts` imports `RecordingSession` from `src/recorder/recording-session.ts` (the *class*-based Phase 1 session). That file is imported by zero live source files — only by two test files (`deterministic-recorder-integration.test.ts`, `recording-session-phase1.test.ts`). The live pipeline uses `src/domain/entities/recording-session.ts` (the *entity* with `createRecordingSession()`), which is a completely different file with different exports.

5. **Architectural context.** `interaction-types.ts` (810 lines) was the Phase 1-3 interaction type registry — a plugin system where each interaction type registered a config with `toPlainEnglish()`, `buildPromptHeader()`, etc. This was superseded by the Phase 6 Component Definition system (`src/definitions/*.ts`) which replaced the registry pattern with the `ComponentDefinition` interface. The file was missed during Phase 1.1 dead code removal because it lives in `src/recorder/` (not `src/classifier/`).

6. **Its 7 errors are self-contained.** All 7 are `session.addAction()` calls inside the file's own functions. No external code triggers these calls.

**Proposed action (Milestone 1.4.4):**
- Delete `src/recorder/interaction-types.ts` (810 lines)
- Investigate whether `src/recorder/recording-session.ts` (256 lines, the Phase 1 class) is also dead — if its only consumers are tests of dead code, delete it and those tests too
- Record as TD-2 in the Technical Debt Register

**Risk:** Zero. Nothing imports these files.

**Awaiting approval before deletion.**

---

## Milestone Breakdown

### Milestone 1.4.1 — Re-export ElementIdentity + fix module paths (18 errors eliminated)

**Files:**
- `src/shared/component-types.ts` — add `export type { ElementIdentity } from './types';`
- `src/presentation/output-adapter.ts` — fix import path `'./component-types'` → `'../shared/component-types'`
- `src/recorder/surface-detector.ts` — fix import path `'../recorded-event.ts'` → `'./recorded-event'`

**Validation:** tsc diff. Expect ~18 errors removed, 0 added.

### Milestone 1.4.2 — Type definition gaps (27 errors eliminated)

**Files:**
- `src/shared/types.ts` (or wherever DomContext lives) — add 6 ARIA/native min-max fields
- `src/repository/v2/interfaces/unit-of-work.ts` — add `elements`, `executionRuns`, `commit()`, `rollback()`
- `src/shared/types.ts` — add `OBSERVED_EVENT`, `BEHAVIORAL_EFFECTS` to AppMessage union
- `src/shared/types.ts` — add `LIVE_INTERACTIONS` to StorageKeys enum

**Validation:** tsc diff. Expect ~27 errors removed, 0 added.

### Milestone 1.4.3 — Correctness fixes (18 errors eliminated)

**Files:**
- `src/domain/entities/capability.ts` — readonly → mutable arrays
- `src/domain/entities/understanding-result.ts` — fragment: `ApplicationKnowledgeFragment | null`
- `src/runtime/component-runtime.ts` — null guard for lifecycleId, widen ComponentState union
- `src/runtime/sw-integration.ts` — null guard for evidenceLedger
- `src/recorder/phase5/recorder-entry.ts` — PromiseSettledResult type guard
- `src/execution/ir-executor-impl.ts` — fix ElementIdentity construction
- `src/tap/observation-coordinator.ts` — WeakRef type declaration
- `src/tap/document-observer.ts` + `observation-coordinator.ts` — explicit type annotations

**Validation:** tsc diff + full test suite.

### Milestone 1.4.4 — Delete dead code: `interaction-types.ts` + dependents (7+ errors resolved)

**Investigation result (approved separately before execution):**

`src/recorder/interaction-types.ts` (810 lines) is conclusively dead code — Phase 1-3 interaction type registry superseded by the Phase 6 Component Definition system. Zero live imports, zero test imports, zero build references. Its dependency `src/recorder/recording-session.ts` (256 lines, Phase 1 class) is also dead — imported by zero live source files.

**Task:**
- Delete `src/recorder/interaction-types.ts`
- Delete `src/recorder/recording-session.ts` (if confirmed dead after checking its test consumers)
- Delete tests that exclusively test these files (`deterministic-recorder-integration.test.ts`, `recording-session-phase1.test.ts`)
- Record as TD-2 in the Technical Debt Register

**Validation:** tsc diff + full test suite + confirm zero new import errors elsewhere.

### Milestone 1.4.5 — Remove all unused source imports (36 errors eliminated)

**Files:** ~20 source files (see census above).
**Task:** Remove every `TS6133`/`TS6196` in `src/`.

**Validation:** tsc diff. Expect 36 removed, 0 added.

### Milestone 1.4.6 — Test helpers: shared fixture builders (est. 120 errors eliminated)

**Files:**
- `tests/helpers/make-event.ts` — extend to full ObservedEvent + ElementIdentity + DomContext
- All test files with TS2740/TS2353 errors — replace inline partial objects with helper calls

**Validation:** tsc diff + full test suite.

### Milestone 1.4.7 — Test cleanup: unused imports + stale fixtures (est. 130 errors eliminated)

**Files:** ~60 test files.
**Task:** Remove all `TS6133` in tests, fix all `TS2353` (stale properties), fix `TS2322`/`TS2345` (wrong enum values).

**Validation:** tsc diff + full test suite.

### Milestone 1.4.8 — Final gate: zero errors, CI integration

**Task:**
1. Run `npx tsc --noEmit` — must show 0 errors.
2. Run full test suite — all tests pass.
3. Run build — extension builds.
4. Add `tsc --noEmit` to `package.json` scripts as `"typecheck"`.
5. Update setup script if needed.
6. Commit.

**Validation:** Zero tsc errors. Zero test failures. Build succeeds.

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Adding DomContext fields changes serialization | Low | Medium | Verify Dexie schema doesn't break — fields are optional |
| Widening ComponentState union changes behavior | Very Low | Low | Runtime already produces these values |
| `interaction-types.ts` is live and needs `addAction` | Medium | Medium | Investigate first (1.4.4), fix before proceeding |
| Test fixture changes break runtime assertions | Low | Low | Run full test suite after each milestone |
| WeakRef/lib fix changes compilation target | Low | Low | Verify build still produces same output |

---

## What This Phase Does NOT Do

- No `@ts-ignore`, `as any`, or type suppression of any kind
- No changes to process() logic in any Component Definition
- No changes to the Projection Engine's partition logic
- No changes to the Workflow Normalizer's subsumption policy
- No changes to the Evidence Ledger's field set (INV-LE-8 holds)
- No changes to the Capture Guarantee (INV-1 through INV-7)
- No architectural changes — this phase makes existing types accurate

---

## Rollback Plan

Single commit per phase. `git revert` restores the previous state. No data migrations, no schema changes, no environment changes. The type system is compile-time only — reverting cannot affect deployed extensions or stored data.

---

## Expected Outcome

- **0 tsc errors** (down from 400)
- **~2600 tests pass** (count may shift slightly as fixtures are corrected)
- **Build v10.9.0** (unchanged)
- **Permanent typecheck gate** via `npm run typecheck`
- **Foundation complete** for Track 2 and Track 3
