# Track 1 Roadmap — Stabilize, Clean Up, and Establish Type Safety

**Date:** 2026-08-07
**Baseline:** `c4e4ade` (Engineering Handover + First Day Guide)
**Status:** Planning — awaiting final approval

## Purpose

The 6-layer recording pipeline is architecturally complete (M1–M5).
Before adding new interaction types (Track 2) or AI understanding (Track 3),
we must stabilize the codebase: remove dead code that creates confusion,
establish type safety, fix output quality issues, and unify the dual type system.

The goal is **honest foundations**: every test exercises live code, every type
is checked, every output interaction carries real identity.

---

## Architectural Freeze

**Track 1 is a stabilization track. It must not alter runtime behavior.**

The following systems are **frozen** for the entire duration of Track 1:

| Frozen System | What It Does | Why It Must Not Change |
|---------------|-------------|----------------------|
| **Recorder Behavior** | EventTap capture, content script delivery, health-check re-sync | The click-loss fix (M1–M5) is the project's most validated work; changing capture logic risks reintroducing the Amazon.in click-loss bug |
| **Interaction Semantics** | 14 Component Definitions, priority ordering, lifecycle state machine | Definitions define what a "Click" vs "Dropdown" vs "DatePicker" *means* — changing them changes the product's output contract |
| **Capture Guarantee** | Every discrete event (`click`, `contextmenu`, `mousedown`, `keydown`) MUST produce a ledger entry with disposition | INV-1 through INV-7 are invariants that survived the entire M1–M5 evolution; Track 1 must not weaken any of them |
| **Projection Engine** | `projectInteractions()` — partitions completedOnly, creates Unclassified stubs from unclaimed/pending entries | The Projection Engine is the authoritative source of output interactions (M5). Its contract is mechanical completeness, not semantic judgment. |
| **Workflow Normalizer** | `normalizeWorkflow()` — 500ms gesture window, subsumption of Unclassified by recognized on same elementKey | The Normalizer was validated on Amazon.in with zero noise. Its policy is a semantic refinement layer, not a filtering layer. |
| **Capability Engine** | Conflict resolution, capability model, 13 capability types + Unclassified | The capability model is the product's semantic vocabulary. Track 2 (new interaction types) will extend it; Track 1 must not reshape it. |

**Concretely, Track 1 phases:**
- May add fields to types (`LedgerEntry` in 1.2)
- May remove dead code and dead tests (1.1)
- May change type signatures and eliminate casts (1.3)
- May add type checking to CI (1.4)
- May **NOT** change any `process()` logic, any definition, any normalizer rule, any projection partition, any capability resolution

If a phase requires touching a frozen system to proceed, **STOP** and escalate. The roadmap is wrong; the freeze is not.

---

## Phase Approval Gate

**No phase may begin until the previous phase has been reviewed and explicitly approved.**

After each phase's commit, the following must happen before the next phase starts:

1. **Automated checks pass:**
   - `npm test` — all tests green
   - `npm run build` — extension builds
   - tsc baseline diff — zero new errors in live code

2. **Manual review:**
   - Read every line of the phase's `git diff`
   - Verify no frozen system was modified (check against the Architectural Freeze table)
   - Verify the phase met its exit criteria

3. **Explicit approval:**
   - The human reviews the phase summary (what changed, test count, build status, tsc diff)
   - The human says "proceed" (or equivalent)
   - Only then does the next phase begin

**No exceptions.** If automated checks pass but the human hasn't approved, the track is paused. Track 1 is too important to rush — a bad phase 1.1 (dead code removal) could cascade into 1.2/1.3/1.4 failures.

---

## Track 1 Phases

```
Phase 1.0 — Type Baseline Snapshot      (diagnostic artifact, no code change)
Phase 1.1 — Dead Code Removal            (isolation, zero behavior change)
Phase 1.2 — Diagnostic Identity           (LedgerEntry gains target fields)
Phase 1.3 — Type Bridge Unification       (kill the any[] casts)
Phase 1.4 — Type Safety Gate              (tsc --noEmit in CI)
```

Each phase is independently committable and independently revertable.
Phase 1.0 produces no commit (diagnostic only).

---

## Phase 1.0 — Type Baseline Snapshot

### Goal
Capture the current type-checking state as a frozen reference artifact. Every
subsequent phase will diff against this baseline to verify that no new type
errors are introduced in live code.

### Architectural Reasoning
The project has no type-checking step today. `vitest` and `vite build` both use
esbuild, which strips types without checking them. This means type errors can
exist indefinitely without detection.

We cannot establish a *passing* `tsc --noEmit` gate yet — there are 626 pre-
existing errors (135 from dead code, 491 from live code — predominantly unused
imports and partial object construction in tests). Fixing all 491 live errors
before dead code removal would be wasted work: many will change after Phase 1.3
(Type Bridge Unification) alters the type signatures.

Instead, we capture the current error list as a **frozen baseline**. After each
phase, we re-run `tsc --noEmit` and diff against this baseline. Any error
appearing in a live file that was NOT in the baseline is a regression —
introduced by our changes, not pre-existing.

### Artifacts Captured

| Artifact | File | How Produced |
|----------|------|-------------|
| tsc error list (sorted, deduplicated) | `.drytis/baselines/tsc-baseline-c4e4ade.txt` | `npx tsc --noEmit 2>&1 \| grep "error TS" \| sort` |
| Error count summary | `.drytis/baselines/tsc-baseline-summary.md` | Manual count by category (dead/live, error code) |
| Test status snapshot | `.drytis/baselines/test-baseline-c4e4ade.txt` | `npx vitest run 2>&1 \| grep -E "Test Files\|Tests "` |
| Build status snapshot | `.drytis/baselines/build-baseline-c4e4ade.txt` | `npm run build 2>&1 \| tail -5` |
| Error count by code | (included in summary) | `grep "error TS" \| sed 's/.*error //' \| cut -d: -f1 \| sort \| uniq -c \| sort -rn` |
| Error count by directory | (included in summary) | Group by top-level src/ or tests/ subdirectory |

### How the Baseline Diff Works (After Each Phase)

```bash
# 1. Run tsc on the current codebase
npx tsc --noEmit 2>&1 | grep "error TS" | sort > /tmp/tsc-current.txt

# 2. Diff against the frozen baseline
diff .drytis/baselines/tsc-baseline-c4e4ade.txt /tmp/tsc-current.txt
```

The diff produces three categories:

| Diff Category | Meaning | Action |
|---------------|---------|--------|
| **Lines removed** (in baseline, not in current) | Errors that disappeared | ✅ Good — dead code errors gone, or fixes resolved live errors |
| **Lines unchanged** | Pre-existing errors that persist | ⏸️ Expected — will be fixed in 1.3/1.4 |
| **Lines added** (in current, not in baseline) | New errors introduced by our changes | ❌ **REGRESSION** — must fix before committing |

### What Constitutes a Regression

A **regression** is any `tsc` error in a live source file or live test file that:
1. Was NOT present in the baseline (`tsc-baseline-c4e4ade.txt`), AND
2. Appears after a phase's code changes

Regressions must be fixed before the phase's commit. No exceptions.

Specifically NOT a regression:
- A dead-code error disappearing (expected after 1.1)
- A live error that moved to a different line number but is the same error on the same symbol (file restructuring)
- A live error changing its message because a type definition improved (e.g., more precise error after adding fields in 1.2)

### Exit Criteria

- [ ] `tsc-baseline-c4e4ade.txt` created with 626 errors, sorted
- [ ] `tsc-baseline-summary.md` created with breakdown (by code, by directory, by dead/live)
- [ ] `test-baseline-c4e4ade.txt` created (4,072 tests, 175 files)
- [ ] `build-baseline-c4e4ade.txt` created (v10.9.0, 47 files)
- [ ] Baseline files committed to `.drytis/baselines/`

### Rollback
N/A — diagnostic only, no code changes.

---

## Phase 1.1 — Dead Code Removal

### Goal
Remove ~9,675 lines of dead code and ~39 dead test files. The production pipeline does not change. The test count drops to ~3,208 (honest live count).

### Architectural Reasoning
The dead code (V1/V2 classifier, recognition layer, enrichment pipeline, old orchestrator) represents three superseded architectural eras. It inflates the test count by ~864 tests, creates a cognitive trap for anyone reading the codebase, and blocks meaningful type checking. The Engineering Handover already resolved the "revive enrichment?" question: AI Understanding will be built greenfield as a post-recording analysis pass, not by reviving `src/recorder/enrichment/`.

### The Complication: `DetectedInteraction` Type Coupling

The dead `src/classifier/interaction-types.ts` exports `DetectedInteraction`, which is **imported by live code**:

| Live File | What It Imports |
|-----------|----------------|
| `src/generation/ir-bridge.ts` | `DetectedInteraction`, `InteractionType` |
| `src/generation/ir-bridge-input.ts` | `DetectedInteraction` |
| `src/domain/entities/recording-session.ts` | `DetectedInteraction` |
| `src/repository/services/session-persistence-service.ts` | `DetectedInteraction` |
| `src/sidepanel/timeline-renderer.ts` | `DetectedInteraction`, `TYPE_DISPLAY` |
| `src/sidepanel/interaction-renderer.ts` | uses `TYPE_DISPLAY` (own copy) |

We **cannot** simply `rm -rf src/classifier/` — it would break compilation. The `DetectedInteraction` type and `TYPE_DISPLAY` constant must be extracted to a live location before the dead directories are removed.

### Steps (in order)

**1.1a — Extract shared types to live code**

Move `DetectedInteraction`, the `InteractionType` union, `InteractionMetadata`, and `TYPE_DISPLAY` from `src/classifier/interaction-types.ts` into `src/shared/bridge-types.ts`. This is a verbatim copy — no refactoring, no renaming. All live imports are repointed to the new location.

The filename `bridge-types.ts` signals a temporary compatibility bridge between the old classifier type system and the new ComponentInteraction pipeline. A bridge is inherently temporary — you cross it to get somewhere, you don't live on it. Phase 1.3 (Type Bridge Unification) will demolish this bridge once both sides speak the same type.

**1.1b — Remove dead directories**

Delete:
- `src/classifier/` (4,595 lines)
- `src/recorder/recognition/` (2,515 lines)
- `src/recorder/enrichment/` (2,010 lines)
- `src/recorder/pipeline/` (555 lines)

Verify no remaining live imports point at deleted paths.

**1.1c — Remove dead tests**

Delete:
- `tests/evidence-engine/` (33 files)
- `tests/recognition/` (5 files)
- `tests/recorder/` (1 file)

**1.1d — Baseline diff check**

```bash
npx tsc --noEmit 2>&1 | grep "error TS" | sort > /tmp/tsc-after-1.1.txt
diff .drytis/baselines/tsc-baseline-c4e4ade.txt /tmp/tsc-after-1.1.txt
```

Expected: ~135 lines removed (dead code errors gone). **Zero lines added.** Any added line is a regression from a broken import — fix before committing.

**1.1e — Verify and commit**

- `npm test` → ~3,208 tests, 137 files
- `npm run build` → extension builds
- tsc diff shows zero new live errors
- Commit: `refactor: remove dead code (9,675 lines) — classifier, recognition, enrichment, old pipeline`

### Dependencies
Phase 1.0 (baseline snapshot must exist for diff).

### Risks
- **Missed import:** A live file imports something from a dead directory we didn't catch. Mitigation: grep all imports before deletion; tsc baseline diff catches any miss.
- **`DetectedInteraction` shape drift:** The extracted type may not exactly match what live code expects. Mitigation: copy verbatim, don't refactor.

### Exit Criteria
- [ ] Dead directories deleted
- [ ] Dead tests deleted
- [ ] `DetectedInteraction`, `InteractionType`, `InteractionMetadata`, and `TYPE_DISPLAY` extracted to `src/shared/bridge-types.ts`
- [ ] All remaining tests pass (~3,208, 137 files)
- [ ] Extension builds
- [ ] tsc baseline diff: zero new errors in live code
- [ ] No live code imports from deleted directories

### Rollback
`git revert <commit>`. Single commit, no behavior change.

---

## Phase 1.2 — Diagnostic Identity for LedgerEntry

### Goal
Add `targetTag`, `targetName`, `targetRole` to `LedgerEntry` so that projected Unclassified interactions carry real element identity instead of stubs (`tag: 'UNKNOWN'`, `accessibleName: ''`).

### Architectural Reasoning
Currently, when the Projection Engine creates an Unclassified interaction from a ledger entry (`createUnclassifiedFromLedger`), it produces a stub with no element identity. This means:
- The output shows "Unclassified — unknown element" instead of "Unclassified — DIV 'exchange-option'"
- Post-mortem debugging requires timestamp/sequence correlation instead of direct lookup
- The Workflow Normalizer's `elementKey()` can't match subsumed Unclassified to recognized interactions (they have empty selectors)

Adding diagnostic identity to `LedgerEntry` is:
- **Additive:** new fields, no existing fields change
- **Immutable:** set at `append()`, never modified by `setDisposition`
- **Privacy-safe:** strict subset of what `liveInteractions` already stores
- **INV-2 compliant:** one disposition per entry (identity is orthogonal)
- **INV-3 compliant:** classification can't erase evidence (identity preserved regardless of disposition)

### Steps

**1.2a — Extend `LedgerEntry` interface**

Add three fields:
```typescript
targetTag: string;        // e.g., 'DIV', 'BUTTON', 'SPAN'
targetName: string;       // accessibleName, truncated to 80 chars
targetRole: string | null; // ariaRole
```

**1.2b — Populate in `append()`**

Extract from `ObservedEvent.target` when appending:
```typescript
targetTag: event.target.tag,
targetName: (event.target.accessibleName || '').slice(0, 80),
targetRole: event.target.ariaRole,
```

**1.2c — Update `createUnclassifiedFromLedger`**

Use `entry.targetTag`, `entry.targetName`, `entry.targetRole` instead of stubs. The Unclassified interaction now carries real identity through to the Workflow Normalizer and the output.

**1.2d — Update `snapshot()` / `restore()`**

The snapshot already serializes the full entry object. New fields are automatically included. `restore()` needs no changes (it reconstructs from snapshot data). Backward compatibility: old snapshots without these fields will have `undefined` — the Projection Engine should default to `tag: 'UNKNOWN'` if `targetTag` is falsy.

**1.2e — Baseline diff check**

```bash
npx tsc --noEmit 2>&1 | grep "error TS" | sort > /tmp/tsc-after-1.2.txt
diff .drytis/baselines/tsc-baseline-c4e4ade.txt /tmp/tsc-after-1.2.txt
```

Expected: some live errors removed (better typing in projection-engine.ts), possibly a few changed. **Zero entirely new errors.**

**1.2f — Tests**

Update existing tests:
- `evidence-ledger.test.ts` — verify new fields are populated
- `projection-engine` tests — verify Unclassified carries real identity
- `disposition-tracking.test.ts` — verify identity fields survive disposition changes
- `verification-regression.test.ts` — verify self-consistency with identity

### Dependencies
Phase 1.0 (baseline). Recommended after 1.1 (cleaner codebase, fewer test files to update).

### Risks
- **Storage size:** 3 new string fields per entry. At ~100 bytes/entry and typical recordings of 10–50 discrete events, this adds ~1–5KB. Negligible vs. liveInteractions routinely at 50KB+.
- **Backward compatibility:** Old persisted ledgers (in chrome.storage.local) won't have these fields. Mitigation: defensive defaults in `createUnclassifiedFromLedger`.

### Exit Criteria
- [ ] `LedgerEntry` has `targetTag`, `targetName`, `targetRole`
- [ ] `append()` populates from `ObservedEvent.target`
- [ ] `createUnclassifiedFromLedger` uses real identity
- [ ] Unclassified interactions in output show real element name/tag
- [ ] Workflow Normalizer can match Unclassified by `elementKey` (same element, 500ms window)
- [ ] All tests pass
- [ ] Extension builds
- [ ] tsc baseline diff: zero new errors in live code

### Rollback
`git revert <commit>`. Additive change, no downstream breakage.

### INV-LE-8: LedgerEntry Minimum Diagnostic Surface Invariant

**LedgerEntry stores the minimum identity for "what happened." It must not
become a second ElementIdentity.**

The three diagnostic fields (`targetTag`, `targetName`, `targetRole`) are the
complete, final field set for element identity on LedgerEntry. They are
diagnostic — they answer "what element did this event target?" — not semantic
("what component is this?") or structural ("where is this in the DOM?").

**If a future consumer (Workflow Normalizer, Capability Model, Knowledge
Repository) needs more identity than these three fields provide, the answer
is NEVER "add a field to LedgerEntry." The answer is one of:**

1. **The consumer should use `ComponentInteraction.trigger`** (full
   `ElementIdentity`) instead of reading from LedgerEntry. The ledger is a
   diagnostic projection; consumers that need canonical identity should use
   the canonical source.

2. **The consumer needs a new architectural concept** — e.g., a component
   matching layer for the Knowledge Repository. This gets its own design,
   its own types, and its own architectural review.

3. **The Projection Engine needs richer data at projection time** — the fix
   is to preserve a reference to the original `ObservedEvent` (or a
   deliberately-designed serialized subset), not to trickle more fields
   into the flat diagnostic interface.

**Any change to LedgerEntry's field set requires:**
- Explicit identification of which consumer needs the field and why
- Evaluation of whether that consumer should instead use
  `ComponentInteraction.trigger`
- Evidence that the new field is diagnostic (what happened), not semantic
  (what something is) or structural (where something is)
- Written justification in the commit message and an update to this invariant

---

## Phase 1.3 — Type Bridge Unification

### Goal
Eliminate the `any[]` cast bridge in `service-worker.ts` (lines 317–330) and the dual `DetectedInteraction` / `ComponentInteraction` type system. The IR Bridge should accept `ComponentInteraction[]` directly.

### Architectural Reasoning
The service worker currently:
1. Has `ComponentInteraction[]` (from the runtime/projection)
2. Maps each to a synthetic `DetectedInteraction`-shaped object via `any[]` casts
3. Passes the synthetic objects to `buildIRPlan()`
4. The IR Bridge processes them as `DetectedInteraction`

This is the single largest type-safety hole in the codebase. The `any[]` casts silence the compiler — any field mismatch, typo, or structural drift between the two types is invisible until runtime.

`DetectedInteraction` and `ComponentInteraction` overlap significantly:
- Both have `interactionId`, `type`, `metadata`
- `ComponentInteraction` is richer (has `trigger`, `triggerEvent`, `memberEvents`, `startTime`, `endTime`, `endState`)
- `DetectedInteraction` has `confidence` and `engine` (which the IR Bridge doesn't meaningfully use)

The IR Bridge functions (`mapInteractionToAction`, `findCorrespondingEvent`, etc.) use a small subset of `DetectedInteraction` fields. We need to identify that subset and update the IR Bridge to accept `ComponentInteraction` (or a minimal interface that both satisfy).

### Steps

**1.3a — Audit IR Bridge field usage**

Grep `ir-bridge.ts` and `ir-bridge-input.ts` for every field accessed on `DetectedInteraction`. Build a list of the actual interface requirement.

**1.3b — Define a unified input type**

Create a minimal interface that `ComponentInteraction` already satisfies:
```typescript
interface IRInteractionInput {
  interactionId: string;
  type: InteractionType;
  metadata: Record<string, unknown>;
  trigger: ElementIdentity;      // from ComponentInteraction
  memberEvents: ObservedEvent[]; // from ComponentInteraction
  startTime: number;
  endTime: number;
}
```

Or simply: change IR Bridge to accept `ComponentInteraction[]` directly.

**1.3c — Update IR Bridge signatures**

Replace `DetectedInteraction` with `ComponentInteraction` (or the minimal interface) in:
- `ir-bridge.ts` (function parameters)
- `ir-bridge-input.ts` (the `IRBridgeInput` interface)
- `recording-session.ts` (domain entity)
- `session-persistence-service.ts` (repository)
- `timeline-renderer.ts` (side panel — may need `ComponentInteraction` or its own adapter)

**1.3d — Remove the cast bridge in service-worker.ts**

Delete lines 317–330 (the `interactionsForIR: any[]` mapping). Pass `productionInteractions` directly to `buildIRPlan()`.

**1.3e — Remove `DetectedInteraction` from `src/shared/bridge-types.ts`**

Now that nothing uses `DetectedInteraction`, delete it and its temporary extraction file.

**1.3f — Baseline diff check**

```bash
npx tsc --noEmit 2>&1 | grep "error TS" | sort > /tmp/tsc-after-1.3.txt
diff .drytis/baselines/tsc-baseline-c4e4ade.txt /tmp/tsc-after-1.3.txt
```

Expected: significant reduction in live errors (the `any[]` bridge errors gone, `DetectedInteraction` structural mismatches gone). **Zero entirely new errors.**

**1.3g — Snapshot test for generated code equivalence**

Before starting 1.3, generate Playwright code from a fixed set of test interactions. After 1.3, generate again from the same interactions. Diff the two outputs. They must be semantically identical (same steps, same selectors, same actions, same assertions).

**1.3h — Tests**

- Update IR Bridge tests to pass `ComponentInteraction` fixtures
- Verify generated Playwright code is unchanged (semantic equivalence)
- Run full suite

### Dependencies
- **1.1 must be complete** (dead code removed, `DetectedInteraction` extracted to known location)
- **1.2 recommended but not required** (cleaner to work on a codebase with identity fields)

### Risks
- **IR Bridge behavior change:** The IR Bridge may rely on `DetectedInteraction` fields that `ComponentInteraction` structures differently (e.g., `target` vs `trigger`, `eventIds` vs `memberEvents.map(e => e.eventId)`). Mitigation: audit field usage first (step 1.3a), adapt mappings.
- **Generated code regression:** The Playwright output must not change. Mitigation: snapshot test the generated code before and after, diff for semantic equivalence.
- **Cascade of type errors:** Changing the IR Bridge input type may surface latent type errors elsewhere. Mitigation: fix them — they were hidden by `any[]`.

### Exit Criteria
- [ ] Zero `any[]` casts in `service-worker.ts` for interaction bridging
- [ ] IR Bridge accepts `ComponentInteraction[]` (or minimal interface)
- [ ] `DetectedInteraction` type fully removed from live code
- [ ] `src/shared/bridge-types.ts` deleted (temporary bridge no longer needed)
- [ ] Generated Playwright code is semantically identical (snapshot comparison)
- [ ] All tests pass
- [ ] Extension builds
- [ ] tsc baseline diff: zero new errors in live code (expect significant reduction)

### Rollback
`git revert <commit>`. If the IR Bridge change is too invasive, revert to 1.2 state (`DetectedInteraction` in `shared/bridge-types.ts`).

---

## Phase 1.4 — Type Safety Gate

### Goal
Add `tsc --noEmit` to the project as a type-checking gate. Zero type errors.

### Architectural Reasoning
The project has no type-checking step. `vite build` uses esbuild which strips types without checking them. `vitest` similarly doesn't type-check. This means type errors can exist in the codebase indefinitely without being caught.

After Phases 1.0–1.3, the codebase should be clean enough for `tsc --noEmit` to pass. This phase formalizes the gate.

### Steps

**1.4a — Run `tsc --noEmit` and fix remaining errors**

```bash
npx tsc --noEmit
```

After 1.1–1.3, remaining errors should be:
- Unused imports/variables (TS6133) — remove the imports
- Test helpers constructing partial `ElementIdentity`/`DomContext` objects (TS2740) — use `makeTarget()`/`makeContext()` helpers or add `as const` assertions
- Possibly-null references (TS2532) — add null guards

Fix every error. No `@ts-ignore`, no `as any`, no type suppression.

**1.4b — Add `typecheck` script to `package.json`**

```json
"scripts": {
  "typecheck": "tsc --noEmit",
  "build": "vite build && node scripts/pack-zip.mjs",
  "test": "vitest run",
  ...
}
```

**1.4c — Baseline diff check (final)**

```bash
npx tsc --noEmit 2>&1 | grep "error TS" | sort > /tmp/tsc-after-1.4.txt
diff .drytis/baselines/tsc-baseline-c4e4ade.txt /tmp/tsc-after-1.4.txt
```

Expected: **empty current file** (zero errors). Every line in the baseline diff shows as removed.

**1.4d — Document in First-Day Guide**

Update the validation protocol: `npm run typecheck && npm test && npm run build`.

### Dependencies
- **1.1, 1.2, 1.3 must all be complete.** Type checking on a codebase with dead code and `any[]` casts would produce hundreds of errors.

### Risks
- **Large error count:** If 1.1–1.3 didn't catch everything, `tsc` may surface many errors. Mitigation: fix incrementally, don't suppress with `@ts-ignore`.

### Exit Criteria
- [ ] `npx tsc --noEmit` exits 0
- [ ] `npm run typecheck` script added to `package.json`
- [ ] First-Day Guide updated with typecheck step
- [ ] tsc baseline diff: empty current file (zero errors remaining)
- [ ] All tests pass
- [ ] Extension builds

### Rollback
Remove the `typecheck` script. No code changes to revert.

---

## Implementation Order Summary

```
1.0 Type Baseline    1.1 Dead Code       1.2 Diagnostic       1.3 Type Bridge      1.4 Type Safety
  Snapshot             Removal              Identity             Unification          Gate
     │                    │                    │                    │                    │
     │ Capture 626        │ Extract types      │ Add fields to      │ Kill any[] casts   │ tsc --noEmit
     │ errors as ref      │ Delete 4 dirs      │ LedgerEntry        │ Unify IR input     │ Fix remaining
     │ Diff after each    │ Delete 39 tests    │ Fix projection     │ Remove old type    │ Add CI script
     │ phase              │ Diff: 0 new errs   │ Diff: 0 new errs   │ Snapshot test      │ Diff: 0 errors
     │                    │                    │                    │ Diff: 0 new errs   │
     ▼                    ▼                    ▼                    ▼                    ▼
  Baseline file       ~3,208 tests        Identity in output   Zero any[] casts     Zero tsc errors
  committed           137 test files       Better debugging     One type system      Permanent gate
```

Each phase produces one commit (except 1.0). Each commit is independently green (tests pass, build succeeds).

---

## Baseline Diff Protocol (Applies to All Phases)

After completing code changes for any phase (1.1–1.4):

1. **Run the diff:**
   ```bash
   npx tsc --noEmit 2>&1 | grep "error TS" | sort > /tmp/tsc-current.txt
   diff .drytis/baselines/tsc-baseline-c4e4ade.txt /tmp/tsc-current.txt
   ```

2. **Categorize every diff line:**
   - `<` (removed from baseline): errors that disappeared — ✅ expected
   - `>` (added vs baseline): new errors — ❌ must investigate

3. **For each `>` line:**
   - Is it in a file we intentionally changed? → Verify the error is a consequence of a correct change, not a bug
   - Is it in a file we did NOT touch? → **Regression.** Fix before committing.

4. **No phase commits with an unexplained `>` line.**

---

## What This Track Does NOT Do

- **No new interaction types** (drag-and-drop, keyboard modeling — Track 2)
- **No AI understanding** (AI Observer, enrichment — Track 3)
- **No new product features** (Test Case lifecycle, Review UI — Track 4)
- **No changes to the recording pipeline behavior** (the 6-layer pipeline is stable)
- **No changes to the Evidence Ledger invariants** (INV-1 through INV-7 hold)
- **No changes to the runtime classification logic** (14 definitions unchanged)

---

## Validation Strategy (Track-Wide)

For every phase:
1. `npm run typecheck` (or `npx tsc --noEmit` before 1.4) — baseline diff shows zero new errors
2. `npm test` — all tests pass
3. `npm run build` — extension builds
4. `git diff --stat` — review what changed
5. Read every line of the diff before committing
6. Commit only when green
7. No `@ts-ignore`, no `as any`, no type suppression

For Phase 1.3 specifically (highest risk):
- Snapshot the generated Playwright code before the change
- After the change, diff the generated code
- Assert semantic equivalence (same steps, same selectors, same actions)

---

## After Track 1

The codebase will be:
- **Honest:** ~3,208 tests exercising only live code
- **Type-safe:** zero `tsc` errors, zero `any[]` casts
- **Identity-rich:** every Unclassified interaction carries real element identity
- **Single-typed:** one interaction type (`ComponentInteraction`) flows through the entire pipeline

This is the foundation for Track 2 (new interaction types) and Track 3 (AI understanding).

---

## Technical Debt Register

Items discovered during Track 1 that are **out of scope** for Track 1. They are
recorded here so they are not forgotten. Each item has a proposed track and
a clear statement of what is and isn't in scope.

### TD-1: RadioButton Component Definition emits insufficient metadata

**Discovered:** Phase 1.3 end-to-end verification (2026-08-07)

**Problem:** The RadioButton Component Definition's `buildResult()` only sets
`targetName` and `noOpSelection` in metadata. It does not emit `selectedValue`
(the value/label of the selected radio option). As a result:

- The Generation Layer maps RadioButton → `IRAction.SELECT` (correct).
- But `extractInputValue()` returns `null` because `metadata['selectedValue']`
  is absent.
- The Playwright adapter generates `.selectOption('')` — an empty string —
  which is semantically wrong. A radio button should produce either a
  `.click()` (on the radio element itself) or a `.selectOption('actualValue')`
  if the form widget is a `<select>`.

**Root cause:** The Component Definition, not the Generation Layer. The
Generation Layer is a passive consumer of metadata — it reads what the
definition provides and maps it faithfully. Adding synthetic values in the
compiler would violate INV-GEN-1 (determinism) and the principle that the
compiler never interprets component behavior.

**Proposed fix (Track 2 — Component Definition enhancement):**
- Update `src/definitions/radio-button.ts` `buildResult()` to include
  `selectedValue` derived from `ctx.triggerEvent.valueAfter` or the
  trigger element's `value`/`accessibleName`.
- Consider whether RadioButton should map to `IRAction.CLICK` instead of
  `IRAction.SELECT` in the INTERACTION_TO_IR_ACTION table, since Playwright
  handles radio buttons via `.click()` on the `<input type="radio">` element,
  not `.selectOption()` (which is for `<select>` elements). This is a
  semantic decision for Track 2, not a compiler fix.

**Why NOT Track 1:** Track 1's Architectural Freeze explicitly freezes
Interaction Semantics (14 Component Definitions). Changing `buildResult()`
output is a behavioral change to a frozen system.

**Acceptance criteria for the fix:**
1. `radio-button.ts` `buildResult()` emits `selectedValue` in metadata.
2. The Playwright output for a RadioButton interaction produces a semantically
   correct method (`.click()` on the radio, or `.selectOption('realValue')`).
3. A new test in `ir-bridge.test.ts` verifies non-null input extraction.
4. A new test in the Component Definition's test file verifies `selectedValue`
   is populated from the trigger event.

**Severity:** Medium — generated code is syntactically valid but semantically
incorrect for radio buttons. Does not affect recording, classification, or
non-radio test generation.

### TD-2: Legacy interaction type registry (deleted Phase 1.4.4)

**Discovered:** Phase 1.4.2 investigation (2026-08-07)
**Resolved:** Phase 1.4.4 deletion (2026-08-07)

**Problem:** `src/recorder/interaction-types.ts` (810 lines) and its
dependency `src/recorder/recording-session.ts` (256 lines) were the
original Phase 1 interaction classification system — a registry-based
approach where each interaction type was registered via
`registerInteractionType()` with config objects for display names,
prompt fragments, and action builders.

**What replaced it:** The Phase 6 **Component Definition system**
(`src/definitions/*.ts`), a self-contained, additive-extensibility
architecture where each interaction type is a `ComponentDefinition`
implementing `detectTrigger`, `handleEvent`, `buildResult`, etc. The
Component Runtime (`src/runtime/component-runtime.ts`) orchestrates
definitions through a priority-ordered lifecycle state machine.

The live `RecordingSession` is now a domain entity at
`src/domain/entities/recording-session.ts` — an immutable provenance
record with UnderstandingResult, raw events, and test-case associations.

**Why it survived until 1.4.4:** The files were in `src/recorder/`
(adjacent to live recorder code), not in an obvious legacy location.
The migration from the registry to Component Definitions happened across
Phases 2–6, and the old files were never cleaned up.

**Action taken:** Deleted in Phase 1.4.4 (commit after 5f49c80).
Also deleted `tests/recording-session-phase1.test.ts` (19 tests) and
`tests/deterministic-recorder-integration.test.ts` (10 tests) — both
exclusively tested the dead `RecordingSession` class.

**Severity:** Resolved — dead code removed.

### TD-3: Legacy deterministic-recorder.ts is dead code (~2700 lines)

**Discovered:** Track 1 final architectural audit (2026-08-08)

**Problem:** `src/recorder/deterministic-recorder.ts` (2724 lines) is the
original Phase 1 recorder. It sends `RECORDED_EVENT` messages that the
service worker no longer handles (confirmed: zero `RECORDED_EVENT`
matches in `service-worker.ts`). It is never injected at runtime (not
in `manifest.json`). It inflates the codebase by ~2700 lines of
unreachable code.

**What replaced it:** The Phase 5 recorder (`phase5/recorder-entry.ts`)
uses EventTap + IdentityExtractor to produce `OBSERVED_EVENT` messages
consumed by the Component Runtime.

**Why NOT deleted in Track 1:** Track 1's scope was type safety and dead
code from the Phase 1.4 refactoring. The deterministic-recorder was not
part of the refactoring — it predates it. Deleting it requires verifying
no test imports remain and is a standalone cleanup task.

**Proposed action (Track 2 or standalone cleanup):**
- Verify zero live imports (confirmed in audit: not in manifest.json).
- Delete `deterministic-recorder.ts` and its dedicated test files.
- Update any comments referencing it.

**Severity:** Low — unreachable code, no runtime impact. Pure clutter.

---

## Track 1 Completion Summary

**Completed:** 2026-08-08
**Final commit:** `2d17c57`

### Metrics
| Metric | Before (Track 1 start) | After (Track 1 end) |
|--------|----------------------|-------------------|
| TypeScript errors | 400 (88 source + 312 test) | **0** |
| Test files | 115 | 114 (2 dead test files deleted) |
| Tests passing | ~2600 | **2578/2578** |
| Build | v10.9.0 | v10.9.0 |
| Dead source files | 4 (interaction-types.ts, recording-session.ts, + 2 tests) | 0 (TD-3: deterministic-recorder.ts remains) |

### Phases Completed
- **Phase 1.1:** Dead code removal (commit 3c00040)
- **Phase 1.2:** Honest identity — LedgerEntry refactoring
- **Phase 1.3:** Generation Layer cleanup — 14 ComponentInteraction types verified (commit 3c00040)
- **Phase 1.4.1:** ElementIdentity re-export fix (commit 10b6504)
- **Phase 1.4.2:** Type definition gaps — DomContext, AppMessage, StorageKeys (commit 36bcd7e)
- **Phase 1.4.3:** UnitOfWork call-site fixes — 3 broken features repaired (commit 5f49c80)
- **Phase 1.4.4:** Dead code deletion — interaction-types.ts + recording-session.ts (commit bd0e7d5)
- **Phase 1.4.5:** Source-level unused import cleanup — 35 removals (commit cf9d07a)
- **Phase 1.4.6:** Test-only error elimination — 304→0 via shared fixture builders (commit 32ce53b)

### Architectural Audit (2026-08-08)
All 7 major subsystems verified architecturally correct:
1. ✅ Recorder Pipeline (Stage 1) — all 12 event types captured
2. ✅ Component Runtime (Stage 2) — 14 definitions, lifecycle intact
3. ✅ Semantic Effect Interpretation (Stage 2b) — 7 categories, idempotent
4. ✅ Three-Layer Enrichment — Layers 1-3 structurally correct
5. ✅ Capability Engine — 12 rules, conflict resolution intact
6. ✅ Generation Layer (Stage 6) — all 10 IRAction types handled
7. ✅ Repository Layer (Stage 5) — UoW pattern, healing service correct

### Readiness for Next Tracks
- **Track 2 (Capability Model + New Interaction Types):** READY. TD-1
  (RadioButton metadata) is the first item. The Component Definition
  system's additive extensibility (AP7) means new definitions are
  self-contained — create file, implement interface, register in index.ts.
- **Track 3 (AI Understanding):** READY. The UnderstandingResult domain
  entity, IR Bridge's `aiEnrichment` field, and the Generation Layer's
  compiler-owned `GenerationInput` provide clean integration points.
- **Application Knowledge Repository:** READY. The Repository v2 layer
  (UnitOfWork pattern, Dexie implementation) is structurally sound.

---

## Appendix: Capability Readiness Review (2026-08-08)

**Status:** Design review only — no implementation.
**Full report:** `/workspace/.drytis/notes/capability-readiness-review.md`

### Current State
- **14 component definitions** (Click, Link, Tab, Hover, Scroll, Navigation, TextEntry, Checkbox, RadioButton, Dropdown, Slider, DatePicker, ColorInput, FileUpload)
- **12 capability rules** (OpenDetail, UploadFile, AdjustValue, ToggleControl, Paginate, SubmitForm, ExpandCollapse, FilterSelection, SortSelection, Navigate, Search, SelectOption)
- **7 semantic effect categories** (state-toggle, expand-collapse, enable-disable, content-change, visibility-change, no-observable-effect, unclassified)
- **13 captured event types**, 18-field element identity, 11-field DOM context

### Top 5 Most Impactful Gaps

| # | Gap | Impact | Root Cause |
|---|-----|--------|------------|
| 1 | Observation windows only open for `click` + `change` | **Critical** — 70%+ of interactions have ZERO behavioral evidence | `recorder-entry.ts:362-365` only calls `onAfterEvent` for click/change |
| 2 | No drag/drop, pointer, or touch event capture | **Critical** — entire class of modern web interactions invisible | EventTap registers only 13 event types |
| 3 | CSS visibility / `aria-hidden` changes not interpreted | **Critical** — most common SPA show/hide mechanism produces "unclassified" mutations | Effect rules don't interpret computed style or `aria-hidden` |
| 4 | No `aria-selected` tracking | **High** — tab/listbox/tree selection invisible to snapshot + effects | Not in ElementStateSnapshot, not in any effect rule |
| 5 | No network/focus/selection evidence | **High** — cannot correlate actions with API calls or focus changes | No XHR/fetch interception, no `document.activeElement` tracking |

### Gap Severity Distribution

| Severity | Count | Examples |
|----------|-------|----------|
| Critical | 7 | No drag events, no touch events, observation blind to non-click/change, aria-hidden invisible, no drag-drop capability |
| High | 28 | No pointer events, no clipboard, no selection, no multi-select, no rich text, no focus evidence, no network evidence, no modal capability |
| Medium | 24 | No dblclick, no wheel, no IME, no CSS style interpretation, no timing evidence, various missing capabilities |
| Low | 18 | Minor attribute gaps, rare interaction types |

### Proposed Capability Readiness Roadmap (5 Phases)

This roadmap is PROPOSED — not yet approved. It does not replace Track 2
but may inform its scope and ordering.

**Phase CR-1: Observation Expansion** (highest ROI)
- Expand observation window triggers from `{click, change}` to ALL 13 event types
- Add `aria-selected`, `aria-hidden`, `aria-current` to ElementStateSnapshot
- Add computed `display`/`visibility` to snapshot (or a lightweight proxy)
- **Impact:** Immediately gives behavioral evidence to TextEntry, Slider, Hover, Scroll, DatePicker, ColorInput

**Phase CR-2: Event Coverage Expansion**
- Add `mouseup` (drag completion)
- Add `pointerdown/up/move` (modern drag, stylus, touch-to-pointer)
- Add `drag/dragstart/dragend/drop` (HTML5 DnD)
- Add `touchstart/end/move/cancel` (touch interactions)
- Add `copy/cut/paste` (clipboard)
- Add `selectionchange` (text selection)
- Add `submit` (form submission)
- **Impact:** Unlocks drag-drop, touch, clipboard, and selection interactions

**Phase CR-3: Effect Interpretation Enhancement**
- Add `visibility-change` rule for `aria-hidden` toggling
- Add `class-state-change` rule for semantic class toggling (active/selected/open)
- Add `focus-change` effect (document.activeElement tracking)
- Add `value-change` effect (JavaScript property mutations)
- Investigate network request correlation (XHR/fetch interception)
- **Impact:** Dramatically improves SPA interaction comprehension

**Phase CR-4: New Component Definitions**
- DragDrop (mousedown→mousemove→mouseup lifecycle)
- MultiSelect (click + modifier key semantics)
- Autocomplete (TextEntry + Click cross-element sequence)
- Carousel (next/prev + slide state)
- RichTextEditor (contentEditable + toolbar command correlation)
- Stepper (cumulative +/- clicks with value tracking)
- **Impact:** Classifies previously-uncapturable interaction patterns

**Phase CR-5: New Capability Rules**
- DragAndDrop, MultiSelect, OpenModal, CloseModal
- HoverReveal, ScrollToContent
- SetColor, SelectDate, SwitchTab
- RateItem, AddToCart, PlayMedia
- EditText/FormatText
- **Impact:** High-precision capability inference for all classified interactions
