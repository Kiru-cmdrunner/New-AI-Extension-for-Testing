# Phase 1.3 Implementation Plan — Type Bridge Unification

**Date:** 2026-08-07
**Baseline:** Commit `ed7a6f7` (after Phase 1.2 + INV-LE-8)
**Goal:** Eliminate the `DetectedInteraction` type system. The Generation Layer accepts `ComponentInteraction[]` directly and owns its own input interfaces. Delete `bridge-types.ts`.

---

## Architectural Decisions (Already Approved)

1. **Approach A: In-Place Refactor** — rewrite `ir-bridge.ts` to accept `ComponentInteraction[]`
2. **Generation Layer owns its input contracts** — no imports from `UnderstandingResult` or any future subsystem
3. **`GenerationEnrichment`** — compiler-owned type replacing `UnderstandingResult` in the input
4. **Delete dead understanding functions** from `ir-bridge.ts` (Track 3 will add adapter logic at the SW call site)
5. **Delete timeline-renderer.ts DetectedInteraction functions** — unused at runtime, `interaction-renderer.ts` handles the live sidepanel
6. **Delete `action-phrasing.test.ts`** — tests dead code

---

## Milestone Breakdown

### Milestone 1.3.1 — Define Generation Layer Input Types

**Files:**
- **CREATE** `src/generation/generation-types.ts` — new file with `GenerationInput`, `RecordingContext`, `GenerationEnrichment`, `GenerationAssertion`

**What it does:**
Defines the compiler's own input boundary. All types the Generation Layer accepts live here. No imports from `src/domain/entities/` or `src/shared/bridge-types.ts`.

**Key types:**
```typescript
// Replaces IRBridgeRecordingContext
interface RecordingContext {
  readonly startUrl: string;
  readonly title: string | null;
}

// Replaces UnderstandingResult in the input
interface GenerationEnrichment {
  readonly elementAssertions?: ReadonlyMap<string, GenerationAssertion[]>;
  readonly businessLabels?: ReadonlyMap<string, string>;
  readonly surfaceTags?: readonly string[];
}

// Replaces the domain-layer InteractionContract → IRAssertion mapping
interface GenerationAssertion {
  readonly kind: 'presence' | 'textMatch' | 'range' | 'length' | 'options';
  readonly property: string;
  readonly comparison: string;
  readonly expectedValue: unknown;
  readonly severity: 'hard' | 'soft';
}

// Replaces IRBridgeInput
interface GenerationInput {
  readonly interactions: ComponentInteraction[];
  readonly recordingContext: RecordingContext;
  readonly testCaseName: string;
  readonly enrichment?: GenerationEnrichment;
}
```

**Imports from:** `src/shared/component-types.ts` (ComponentInteraction) only.
**Does NOT import:** SessionEvent, UnderstandingResult, ApplicationKnowledgeFragment, DetectedInteraction.

**Dependencies:** None (first milestone).
**Risk:** Zero — new file, no existing code changes.
**Validation:** `npx tsc --noEmit` — zero new errors (file compiles cleanly).

---

### Milestone 1.3.2 — Rewrite ir-bridge-input.ts

**Files:**
- **MODIFY** `src/generation/ir-bridge-input.ts`

**What it does:**
- Delete the entire current content (62 lines)
- Re-export `GenerationInput`, `RecordingContext`, `GenerationEnrichment`, `GenerationAssertion` from `generation-types.ts`
- Keep `IRBridgeInput` as a deprecated type alias for `GenerationInput` (backward compat during migration, deleted at end of phase)

**Alternative approach:** Delete `ir-bridge-input.ts` entirely and have consumers import from `generation-types.ts`. **Decision: delete the file.** Its only exports are moving to `generation-types.ts`. Keeping a re-export wrapper adds a file with no value.

**Revised plan:** Delete `ir-bridge-input.ts`. Update all consumers to import from `generation-types.ts`.

**Dependencies:** 1.3.1 must be complete.
**Risk:** Low — consumers will break on import path change, fixed in 1.3.3–1.3.5.
**Validation:** Not yet runnable (consumers broken). Proceed to 1.3.3.

---

### Milestone 1.3.3 — Rewrite ir-bridge.ts

**Files:**
- **MODIFY** `src/generation/ir-bridge.ts` (685 lines → ~350 lines estimated)

**What changes:**

#### Delete entirely:
- `import type { DetectedInteraction, InteractionType } from '../shared/bridge-types'` — line 39
- `import type { ApplicationKnowledgeFragment, InteractionContract, LogicalAction } from '../domain/entities/application-knowledge'` — lines 40-44
- `import type { IRBridgeInput } from './ir-bridge-input'` — line 49
- `buildEventIndex()` — lines 435-441 (dead — events always [])
- `findCorrespondingEvent()` — lines 443-456 (dead — events always [])
- `findLogicalAction()` — lines 458-479 (dead — understanding always null)
- `deriveAssertions()` — lines 307-327 (dead — understanding always null)
- `constraintsToAssertions()` — lines 329-428 (dead — understanding always null)
- `deriveTags(fragment, ...)` — lines 651-685 (rewrite to not take fragment)

#### Rewrite:
- `import` block → import `ComponentInteraction, InteractionType` from `../shared/component-types`, import `GenerationInput` from `./generation-types`
- `INTERACTION_TO_IR_ACTION` → key by `ComponentInteractionType` (14 types):
  ```typescript
  const INTERACTION_TO_IR_ACTION: Record<InteractionType, IRAction> = {
    Click:          IRAction.CLICK,
    TextEntry:      IRAction.FILL,
    Dropdown:       IRAction.SELECT,
    Checkbox:       IRAction.TOGGLE,
    RadioButton:    IRAction.CLICK,   //RadioButton clicks
    DatePicker:     IRAction.SELECT_DATE,
    Hover:          IRAction.HOVER,
    Link:           IRAction.CLICK,
    FileUpload:     IRAction.FILL,
    Slider:         IRAction.FILL,
    ColorInput:     IRAction.FILL,
    Tab:            IRAction.CLICK,
    Navigation:     IRAction.NAVIGATE,
    Unclassified:   IRAction.CLICK,
    Scroll:         IRAction.CLICK,   // filtered as noise
  };
  ```
- `NOISE_TYPES` → `new Set<InteractionType>(['Scroll', 'Unclassified'])`
- `generateDescription()` — switch on 14 ComponentInteractionTypes instead of 40 DetectedInteraction types. Read `interaction.trigger.accessibleName` instead of `interaction.target?.accessibleName`. Read metadata via bracket access: `interaction.metadata['textValue']` instead of `interaction.metadata.textValue`.
- `extractInputValue()` — same switch/metadata changes.
- `getElementDisplayName()` — read from `interaction.trigger` (non-optional) instead of `interaction.target?` (optional).
- `generatePlainEnglish()` — pass-through, minimal change.
- `build()` function → accept `GenerationInput`. Remove `events`, `understanding`, `fragment`. Replace with `enrichment` lookup. Remove confidence-based waitStrategy (field doesn't exist on ComponentInteraction — use default). Remove `deriveAssertions` call — read `enrichment?.elementAssertions?.get(elementId) ?? []`.
- `deriveTags()` → take `recordingContext` only (not fragment). Just URL path segment. Surface tags come from `enrichment?.surfaceTags`.
- `extractAIEnrichment()` — delete (was reading from SessionEvent, which is always absent).

#### Keep unchanged:
- `resolveLocatorsForIR()` — already works with ElementIdentity
- `resolveElementTarget()` — already works with ElementIdentity
- `resolveUrlTarget()` — unchanged
- `applyReadabilityRules()` — unchanged (works on IRStep[], not interaction types)

**Dependencies:** 1.3.1 (new types), 1.3.2 (old input file deleted).
**Risk:** Highest milestone — ~300 lines of logic changes. The type→action mapping and metadata access patterns change.
**Validation:** `npx tsc --noEmit` (compile check), then proceed to tests.

---

### Milestone 1.3.4 — Update service-worker.ts

**Files:**
- **MODIFY** `src/background/service-worker.ts`

**What changes:**

#### Delete:
- `import { toIRActions } from '../presentation/output-adapter'` — line 47 (remove toIRActions from import, keep filterProductionInteractions if still used)
- `const irActions = toIRActions(productionInteractions)` — line 314
- `const events: any[] = []` — line 318
- `const interactionsForIR: any[] = ...` — lines 319-327 (the entire synthetic construction)
- `StorageService.setRaw(StorageKeys.DETECTED_INTERACTIONS, interactionsForIR)` — line 329
- `StorageService.setRaw(StorageKeys.DETECTED_INTERACTIONS_MERGED, interactionsForIR)` — line 330

#### Rewrite:
- `buildIRPlan` call (lines 340-349) → pass `productionInteractions` directly as `GenerationInput`:
  ```typescript
  const { compileToIR } = await import('../generation/ir-bridge');
  const irPlan = compileToIR({
    interactions: productionInteractions,
    recordingContext: {
      startUrl: recordingStartUrl || tab?.url || 'about:blank',
      title: recordingStartTitle || tab?.title || null,
    },
    testCaseName: (await StorageService.getTestCaseDraft())?.name ?? 'Recorded Test',
  });
  ```
- Repository V2 persistence call (lines 384-385) → pass `productionInteractions` instead of `interactionsForIR`:
  ```typescript
  interactions: productionInteractions,
  events: [],  // archival — no events collected in current pipeline
  ```

**Dependencies:** 1.3.3 (new function name/signature).
**Risk:** Medium — touches the runtime path. Errors here break test generation.
**Validation:** `npm run build` succeeds. Manual smoke test: `curl` the preview URL.

---

### Milestone 1.3.5 — Update recording-session.ts and session-persistence-service.ts

**Files:**
- **MODIFY** `src/domain/entities/recording-session.ts`
- **MODIFY** `src/repository/services/session-persistence-service.ts`

**What changes:**

#### recording-session.ts:
- `import type { DetectedInteraction } from '../../shared/bridge-types'` → `import type { ComponentInteraction } from '../../shared/component-types'`
- `rawInteractions: readonly DetectedInteraction[]` → `rawInteractions: readonly ComponentInteraction[]`
- `CreateRecordingSessionInput.rawInteractions: DetectedInteraction[]` → `ComponentInteraction[]`
- Runtime logic: zero changes (spread-only usage, opaque archival blob)

#### session-persistence-service.ts:
- `import type { DetectedInteraction } from '../../shared/bridge-types'` → `import type { ComponentInteraction } from '../../shared/component-types'`
- `SessionPersistenceInput.interactions: DetectedInteraction[]` → `ComponentInteraction[]`
- Runtime logic: zero changes (spread-only at line 102: `[...input.interactions]`)

**Dependencies:** None (type annotation only).
**Risk:** Zero — no runtime behavior changes.
**Validation:** `npx tsc --noEmit`.

---

### Milestone 1.3.6 — Delete timeline-renderer.ts DetectedInteraction Functions + action-phrasing.test.ts

**Files:**
- **MODIFY** `src/sidepanel/timeline-renderer.ts` — delete `createDetactedInteractionElement()`, `actionDescription()`, `formatInteractionMetadata()` (all take `DetectedInteraction`). Remove imports from `bridge-types.ts`.
- **DELETE** `tests/action-phrasing.test.ts` (327 lines, 29 tests) — tests the dead functions above.

**What stays in timeline-renderer.ts:**
- Any functions that work with `ComponentInteraction` or generic types.
- The file itself is NOT deleted — only the DetectedInteraction-specific functions are removed.

**Decision point:** After removing DetectedInteraction functions, check if any imports from `bridge-types.ts` remain. If not, remove the import. If the file becomes empty or near-empty, consider whether the entire file should be deleted (check for external callers).

**Dependencies:** 1.3.5 (no more bridge-types consumers expected).
**Risk:** Low — functions are unused at runtime. `interaction-renderer.ts` handles the live sidepanel.
**Validation:** `npx tsc --noEmit` — verify no new errors from removed functions.

---

### Milestone 1.3.7 — Delete bridge-types.ts and ir-bridge-input.ts

**Files:**
- **DELETE** `src/shared/bridge-types.ts` (191 lines)
- **DELETE** `src/generation/ir-bridge-input.ts` (62 lines, already emptied in 1.3.2)

**Pre-check:** Verify zero imports of `bridge-types` remain:
```bash
grep -rn "bridge-types" src/ tests/ --include="*.ts"
```

**Dependencies:** 1.3.1–1.3.6 all complete.
**Risk:** Low — cleanup step. Any remaining import will fail at compile time.
**Validation:** `npx tsc --noEmit` — zero errors from this deletion.

---

### Milestone 1.3.8 — Rewrite Test Files

**Files:**
- **REWRITE** `tests/ir-bridge.test.ts` (828 lines, 41 tests)
- **REWRITE** `tests/ir-bridge-input.test.ts` → rename to `tests/generation-types.test.ts` (254 lines, 10 tests) or delete if tests are pure input-construction tests with no logic
- **MODIFY** `tests/session-persistence-service.test.ts` (513 lines, 16 tests) — fixture changes only

**What changes in ir-bridge.test.ts:**

The test helpers `makeInteraction()` and `makeInput()` must construct `ComponentInteraction` instead of `DetectedInteraction`. This means:

- `makeInteraction()` returns `ComponentInteraction` with `trigger`, `triggerEvent`, `memberEvents`, `metadata: Record<string, unknown>`, `endState`, `startTime`, `endTime`
- `makeInput()` returns `GenerationInput` with `interactions: ComponentInteraction[]`
- Remove all `ApplicationKnowledgeFragment` fixture construction — the compiler no longer takes fragment. Tests for assertion derivation and logical-action enrichment are deleted (Track 3 re-implements them at the adapter site).
- Expected `IRAction` values change for some types (TextEntry → FILL, Dropdown → SELECT, Checkbox → TOGGLE, DatePicker → SELECT_DATE). Currently ALL map to CLICK due to the type-string mismatch bug. The new mapping is correct.

**Test count impact:** Expect ~41 tests to reduce to ~25-30 (fragment-related tests deleted, fixture-construction tests simplified). The remaining tests verify:
1. Type → action mapping (14 types)
2. Locator resolution (unchanged)
3. Input value extraction (14 types, bracket-access metadata)
4. Description generation (14 types)
5. Noise filtering (Scroll, Unclassified)
6. Readability rules (duplicate click merge)
7. Empty inputs (graceful degradation)
8. Full plan construction (end-to-end)

**Dependencies:** 1.3.1–1.3.7 all complete.
**Risk:** Medium — fixture rewriting is labor-intensive but mechanical. Must verify each expected IRAction matches the new 14-type mapping.
**Validation:** `npx vitest run` — all tests pass.

---

### Milestone 1.3.9 — tsc Baseline Diff, Full Validation, Commit

**Steps:**
1. `npx tsc --noEmit 2>&1 | grep "error TS" | sort > /tmp/tsc-after-1.3.txt`
2. `diff /tmp/tsc-after-1.2-final.txt /tmp/tsc-after-1.3.txt`
3. Categorize every diff line (removed = expected, added = must investigate)
4. `npx vitest run` — all tests pass
5. `npm run build` — extension builds, v10.9.0
6. `git diff --stat HEAD` — review scope
7. Commit

**Expected tsc outcome:**
- Significant reduction in errors (elimination of all bridge-types-related errors, all Understanding Layer import errors in ir-bridge.ts, all DetectedInteraction type errors)
- Possible new errors from test files not yet updated — must be zero

**Expected test count:**
- ~2,640-2,660 (slight reduction from 2,660 due to deleted fragment tests and action-phrasing.test.ts, offset by rewritten ir-bridge tests)

**Expected build:**
- v10.9.0, 47 files
- service-worker hash will change (generation code changed)

---

## Dependency Graph

```
1.3.1 (new types) ─────► 1.3.2 (delete old input file) ──► 1.3.3 (rewrite ir-bridge.ts)
                                                                    │
                                                                    ▼
1.3.5 (type annotations) ◄──────────────────────────── 1.3.4 (update service-worker)
      │
      ▼
1.3.6 (delete dead UI functions + test) ──► 1.3.7 (delete bridge-types.ts)
                                                   │
                                                   ▼
                                          1.3.8 (rewrite tests)
                                                   │
                                                   ▼
                                          1.3.9 (validate + commit)
```

Critical path: 1.3.1 → 1.3.2 → 1.3.3 → 1.3.4 → 1.3.8 → 1.3.9

Milestones 1.3.5 and 1.3.6 can run in parallel with 1.3.4 (no interdependencies).

---

## Risks Summary

| Risk | Milestone | Severity | Mitigation |
|------|-----------|----------|------------|
| IRAction mapping changes break generated code | 1.3.3 | Medium | This is a bugfix — current behavior is wrong (universal CLICK). Test the generated output for TextEntry, Dropdown, DatePicker. |
| Metadata bracket-access typos | 1.3.3 | Low | Test each metadata key extraction. Use const string keys where possible. |
| Test fixture rewriting is extensive | 1.3.8 | Low (labor) | Mechanical change — construct ComponentInteraction instead of DetectedInteraction. |
| Service worker runtime path breaks | 1.3.4 | Medium | Smoke test: build extension, verify generation runs without console errors. |
| Dead functions had hidden callers | 1.3.6 | Low | tsc will catch any missing import. |
| Bridge-types deletion leaves orphan import | 1.3.7 | Low | grep before delete, tsc after delete. |

---

## Rollback Plan

Phase 1.3 is a single commit. Rollback:
```bash
git revert <commit>
```

The change is self-contained — it modifies the generation layer, service-worker call site, type annotations, and tests. No database migrations, no storage format changes, no background service changes.

**Intermediate rollback points:** If a milestone fails midway, `git checkout .` restores to the Phase 1.2 commit (`ed7a6f7`). No intermediate commits during implementation — the full phase is one commit.

---

## Frozen System Check (Post-Implementation)

| Frozen System | Modified? |
|---------------|-----------|
| Recorder Behavior | ❌ No |
| Interaction Semantics (14 definitions) | ❌ No |
| Capture Guarantee | ❌ No |
| Projection Engine | ❌ No |
| Workflow Normalizer | ❌ No |
| Capability Engine | ❌ No |

The Generation Layer is NOT a frozen system — it sits *after* the pipeline. Phase 1.3 rewrites its internals but preserves its output contract (`ExecutionIRPlan` shape unchanged).

---

## Exit Criteria

- [ ] `GenerationInput` and `GenerationEnrichment` defined in `src/generation/generation-types.ts`
- [ ] `ir-bridge.ts` imports from `component-types.ts` and `generation-types.ts` only (INV-GEN-8, INV-GEN-10)
- [ ] Zero imports from `bridge-types.ts` in all of `src/` and `tests/`
- [ ] `bridge-types.ts` deleted
- [ ] `ir-bridge-input.ts` deleted
- [ ] Synthetic `any[]` construction deleted from `service-worker.ts`
- [ ] `toIRActions()` not called by service worker
- [ ] TextEntry generates `IRAction.FILL` (not CLICK)
- [ ] Dropdown generates `IRAction.SELECT` (not CLICK)
- [ ] DatePicker generates `IRAction.SELECT_DATE` (not CLICK)
- [ ] All tests pass
- [ ] Extension builds
- [ ] tsc baseline diff: zero new errors in live code
