# Capability Model Removal Impact — Final Verification at deff878

**Baseline:** `deff878a0cfdf6f42d65f19d4b0c62ec39edf8a8`
**Date:** 2026-08-11
**Method:** Exhaustive import/call-site/storage/UI/test trace from frozen worktree
**Purpose:** Verify the previous impact analysis, find hidden dependencies

---

## Verification Result: CONFIRMED — Removal cannot affect recording, classification, observation, enrichment, IR generation, Playwright generation, or Repository V2 session persistence.

Three hidden dependencies found (detailed below). All are test-only or schema-level, easily addressed.

---

## 1. Import Trace — Complete

### Who imports FROM capability code (src/capabilities/ and capability domain entities)

| File | Imports | Capability system | Removal action |
|------|---------|-------------------|----------------|
| `service-worker.ts:38-41` | `runCapabilityInference`, `serializeCapabilityRecords` from `capability-bridge` | System A | Delete import + call block |
| `capability-bridge.ts:18` | `SemanticEffect` type from `semantics/effect-types` | System A → semantics | (Bridge file deleted; semantics preserved) |
| `evidence-extractor.ts:18` | `SemanticEffect` type from `semantics/effect-types` | System A → semantics | (File deleted; semantics preserved) |
| `capability-engine.ts:18` | `SemanticEffect` type from `semantics/effect-types` | System A → semantics | (File deleted; semantics preserved) |
| `session-persistence-service.ts:25,35-40` | `UnderstandingResult`, `createCapability`, `enrichCapability`, capability types, `matchCapability`, `candidateToCreateInput`, `candidateToEnrichInput` | System B | Remove imports + dead block (lines 106-143) |
| `capability-matching-service.ts:25-26` | `CapabilityCandidate`, `Capability` types | System B | (File deleted) |
| `dexie-capability-repository.ts:5-6` | `Capability`, `CapabilityRepository` | System B | (File deleted) |
| `dexie-database.ts:17` | `Capability` type for table schema | System B | Remove from schema (or leave empty table) |
| `dexie-unit-of-work.ts:18,27` | `CapabilityRepository` type + `DexieCapabilityRepository` class | System B | Remove from transaction scope |
| `unit-of-work.ts:18` | `CapabilityRepository` type | System B | Remove from RepositorySet |
| `repository-page.ts:30-31` | `Capability`, `EnrichmentEvent`, `CapabilityInput`, `CapabilityValidationRule`, `CapabilityOutcome` types | System B (UI) | Remove capability view code |
| `understanding-result.ts:33` | `CapabilityCandidate` type | System B (type definition) | Remove `capability` field or leave as null |

### Who capability code imports FROM (reverse direction — confirms no reverse dependency)

| Capability file | Imports from | Impact of removal |
|-----------------|-------------|-------------------|
| `capability-bridge.ts` | `shared/component-types` (ComponentInteraction), `semantics/effect-types` (SemanticEffect) | **Semantics does NOT import back from capabilities.** One-directional. |
| `capability-engine.ts` | `shared/component-types` (ComponentInteraction), `semantics/effect-types` (SemanticEffect) | Same |
| `evidence-extractor.ts` | `shared/component-types`, `semantics/effect-types` | Same |

**Verdict:** Zero reverse dependencies. Capability code reads from shared types and semantics, but nothing in shared types or semantics reads from capability code.

---

## 2. Call-Site Trace — Complete

### Production call sites for System A (Runtime Engine)

| Location | Code | What it does | Removal effect |
|----------|------|-------------|----------------|
| `service-worker.ts:296-303` | `runCapabilityInference(productionInteractions)` then `serializeCapabilityRecords(records)` then `StorageService.setRaw(CAPABILITY_RECORDS, ...)` | Batch inference post-recording | Remove block. `productionInteractions` array NOT mutated by this call — it's read-only. |

**Critical verification:** `runCapabilityInference` receives `productionInteractions` but does it mutate them? Let me confirm:

`capability-bridge.ts:runCapabilityInference()` calls `engine.inferCapabilities(interactions, effectsMap)` which calls `inferOne(interaction)` for each — `inferOne` calls `extractEvidence(interaction, ...)` which reads `interaction.trigger`, `interaction.metadata`, `interaction.behavioralObservations` — all READ-ONLY. The engine builds new `CapabilityRecord[]` objects. It never writes back to the interaction.

**Confirmed:** `productionInteractions` is consumed read-only. After capability inference, the same array is passed to `buildIRPlan()` at line 316 — that call is unaffected by removing capability inference.

### Production call sites for System B (Domain Entity)

| Location | Code | What it does | Removal effect |
|----------|------|-------------|----------------|
| `service-worker.ts:350-364` | `persistSession(uowFactory, { understanding: { ..., capability: null } })` | Persists session | Remove `capability` from object literal (or leave as null) |
| `session-persistence-service.ts:110-143` | `if (candidate) { matchCapability... }` | Capability matching | Dead code — `candidate` always null. Remove block. |

**No other production code calls any capability function.**

---

## 3. Storage Key Trace — Complete

| Storage Key | Written by | Read by | Removal action |
|-------------|-----------|---------|----------------|
| `CAPABILITY_RECORDS` (`capability_records`) | `service-worker.ts:300` | `sidepanel.ts:720` | Remove key + both code sites |
| `CAPABILITY_CANDIDATE` (`capability_candidate`) | **NOWHERE** (never written) | `sidepanel.ts:1121` (remove on clear) | Remove enum entry + clear call |
| `REPOSITORY_CAPABILITY_ID` (`repo_capability_id`) | `service-worker.ts:367` (writes null) | `sidepanel.ts:829,836` | Remove enum entry + both sites |
| `REPOSITORY_CAPABILITY_DECISION` (`repo_capability_decision`) | `service-worker.ts:368` (writes 'none') | `sidepanel.ts:830,837` | Remove enum entry + both sites |
| `UNDERSTANDING_RESULT` (`understanding_result`) | **NOWHERE** (never written) | `sidepanel.ts:1120` (remove on clear) | Leave or remove — orphaned key |

**No storage key is consumed by IR generation, Playwright generation, or Repository V2 persistence.**

---

## 4. UI Consumer Trace — Complete

### Side Panel (`sidepanel.ts`)

| Code | Purpose | Capability dependency |
|------|---------|----------------------|
| Lines 111-113: DOM elements `capability-records-section`, `capability-records-list`, `capability-records-count` | Capability badges display | **Direct** — remove |
| Lines 457: `loadAndRenderCapabilityRecords()` called in `loadDetectedData()` | Load capability display | **Direct** — remove call |
| Lines 674-685: `SerializableCapabilityRecord` interface + `evidence.semanticEffects` field | Serialization type for display | **Direct** — remove |
| Lines 718-811: `loadCapabilityRecords()`, `renderCapabilityRecords()`, `loadAndRenderCapabilityRecords()` | Capability badge rendering | **Direct** — remove |
| Lines 829-830, 836-837: Read `REPOSITORY_CAPABILITY_ID/DECISION` for repo status display | Show capability decision status | **Direct** — remove |
| Lines 1120-1124: Clear capability-related storage keys on "Record Another" | Cleanup | **Direct** — remove clears |

### Repository Page (`repository-page.ts`)

| Code | Purpose | Capability dependency |
|------|---------|----------------------|
| Lines 30-31: Import Capability types | Type imports for capability view | **Direct** — remove |
| Lines 42-89: `displayCapabilities` Map, `selectedCapabilityId` | State for capability view | **Direct** — remove |
| Lines 108-230+: `refreshCapabilities()`, `renderCapabilities()`, `createCapabilityCard()`, `showCapabilityDetail()` | Capability-centric view | **Direct** — remove |

### Settings Page (`settings.ts`)

| Code | Purpose | Capability dependency |
|------|---------|----------------------|
| Line 97: Comment "updates capabilities badges" | Comment mentions "capabilities" | **NONE** — refers to AI provider capabilities (chat, function-calling). Completely separate. |
| Line 115: `renderCapabilities(provider?.capabilities)` | AI provider capability badges | **NONE** — `ProviderCapabilities`, not Capability Model |
| Line 154: `renderCapabilities()` function | AI provider capability display | **NONE** |

### Interaction Renderer (`interaction-renderer.ts`)

| Code | Purpose | Capability dependency |
|------|---------|----------------------|
| Lines 221-262: `componentType`, `componentFramework`, `businessMeaning` display | Enrichment display | **NONE** — these are Layer 3 Enrichment fields, not Capability Model |
| Lines 278-300: Behavioral evidence + semantic effects rendering | Layer 1 + Semantics display | **NONE** — semantics layer preserved |

---

## 5. Test Trace — Complete

### Tests to DELETE (16 files, ~8,205 LOC)

```
tests/capabilities.test.ts                                    (89 LOC)
tests/capabilities/phase1-core-infrastructure.test.ts         (827 LOC)
tests/capabilities/phase2-physical-rules.test.ts              (663 LOC)
tests/capabilities/phase3-navigation-rules.test.ts            (702 LOC)
tests/capabilities/phase4-content-change-rules.test.ts        (701 LOC)
tests/capabilities/phase4-helpers.ts                           (99 LOC)
tests/capabilities/phase5-form-value-rules.test.ts            (642 LOC)
tests/capabilities/phase6-engine-integration.test.ts          (565 LOC)
tests/capabilities/phase7-realworld-validation.test.ts        (641 LOC)
tests/capability-matching-service.test.ts                    (507 LOC)
tests/domain/capability.test.ts                              (524 LOC)
tests/domain/capability-understanding-types.test.ts          (306 LOC)
tests/repository-ui/repository-ui.test.ts                    (334 LOC)
```

### Tests to MODIFY

| File | Modification needed | Reason |
|------|---------------------|--------|
| `tests/session-persistence-service.test.ts` (512 LOC) | Remove capability matching tests (lines 231-460+), remove CapabilityCandidate import (line 19), remove makeCapabilityCandidate helper (line 25) | Tests System B matching that is dead code |
| `tests/healing-service.test.ts` (414 LOC) | Remove `db.capabilities.clear()` at line 123 | **HIDDEN DEPENDENCY #1** (see below) |

### Tests UNAFFECTED

```
tests/semantics/*                    ← PRESERVE (semantics layer stays)
tests/domain/ui-element.test.ts      ← PRESERVE (IntrinsicCapability ≠ Capability Model)
tests/repository-v2/*                ← PRESERVE (no capability references found)
tests/runtime-healing-integration.test.ts ← PRESERVE (no capability references found)
```

---

## 6. Repository Dependency Trace — Complete

### Dexie Schema

The `capabilities` table is defined in schema versions V2 and V3. Two removal strategies:

**Strategy A — V4 migration (clean):** Add `.version(4).stores({ ..., capabilities: null })` to drop the table. Requires migration code.

**Strategy B — Leave empty table (zero-risk):** Keep the `capabilities` table in the schema. It's harmless — no code writes to it after System B removal. No migration needed. The table exists but stays empty forever.

### RepositorySet Interface

`unit-of-work.ts:56`: `readonly capabilities: CapabilityRepository;`
After removal: delete this line. `DexieUnitOfWork` constructor no longer creates `DexieCapabilityRepository`.

### RecordingSessionRepository Interface

`recording-session-repository.ts:33`: `getByCapabilityId(capabilityId: string): Promise<RecordingSession[]>;`
This method queries `understandingResult.capability`. After removal:
- **Option 1:** Remove the method from the interface and implementation. Zero callers in production or tests.
- **Option 2:** Leave it. It filters on `understandingResult.capability` which will always be null → returns `[]`. Harmless.

### Transaction Scope

`dexie-unit-of-work.ts:61-71`: Transaction includes `this.db.capabilities` in the `rw!` scope.
After removal: remove `this.db.capabilities` from the array. Safe — no surviving code writes to it.

---

## 7. Hidden Dependencies Found

### Hidden Dependency #1: `healing-service.test.ts:123` references `db.capabilities.clear()`

```typescript
afterEach(async () => {
  await db.elements.clear();
  await db.projects.clear();
  await db.testCases.clear();
  await db.capabilities.clear();    // ← references Dexie capabilities table
  await db.recordingSessions.clear();
  db.close();
});
```

**Impact:** If the `capabilities` table is removed from the Dexie schema (Strategy A above), this test file fails at teardown. If the table is left in schema (Strategy B), this line is harmless — it clears an already-empty table.

**Fix:** Remove line 123. No behavioral impact — healing-service tests don't create or read capabilities.

**Severity:** LOW — test-only, trivial fix.

### Hidden Dependency #2: `tests/domain/ui-element.test.ts` imports `IntrinsicCapability`

This is a **name collision**, not a real dependency. `IntrinsicCapability` (click, focus, hover, toggle, etc.) is an enum in `domain/enums.ts` that describes what a DOM element can physically do. It has nothing to do with the Capability Model (FilterSelection, Navigate, SortSelection, etc.).

**Impact:** ZERO. Removing the Capability Model does not affect `IntrinsicCapability` or `ui-element.ts`. No action needed.

**Severity:** NONE — false positive from shared naming.

### Hidden Dependency #3: `UnderstandingResult.capability` field type references `CapabilityCandidate`

```typescript
// understanding-result.ts:61
readonly capability: CapabilityCandidate | null;
```

If `capability-candidate.ts` is deleted, this type reference breaks compilation. Two options:

**Option 1 (minimal):** Keep `capability-candidate.ts` as a type-only file. It's 187 LOC of pure interfaces with no runtime code. `UnderstandingResult` keeps the `capability` field (always null).

**Option 2 (clean):** Remove `capability-candidate.ts`. Change `UnderstandingResult.capability` to `null` or remove the field. Requires updating `RecordingSession` type (which references UnderstandingResult) and any test that constructs UnderstandingResult.

**Impact on recording/classification/generation/persistence:** ZERO either way. The `capability` field is always `null` at the call site.

**Severity:** LOW — type-level only, straightforward to resolve.

---

## 8. Pipeline Safety Verification

### Recording pipeline (Layer 0: EventTap → IdentityExtractor)

| Dependency on capability | NONE |
|--------------------------|------|
| event-tap.ts imports | Only browser APIs and identity-extractor |
| identity-extractor.ts imports | Only browser APIs |
| recorder-entry.ts imports | event-tap, identity-extractor, shared types |

### Behavioral Observation (Layer 1: Observation Coordinator → Document Observer)

| Dependency on capability | NONE |
|--------------------------|------|
| observation-coordinator.ts imports | observation-types, element-state-cache, document-observer |
| document-observer.ts imports | observation-types |
| observation-types.ts imports | `SemanticEffect` type from semantics (PRESERVED) |

### Component Runtime / Classification (Layer 2)

| Dependency on capability | NONE |
|--------------------------|------|
| component-runtime.ts imports | component-types, evidence-ledger, definitions, enrichment |
| evidence-ledger.ts imports | component-types |
| projection-engine.ts imports | component-types |

### Enrichment (Layer 3)

| Dependency on capability | NONE |
|--------------------------|------|
| enrich.ts imports | component-detector, meaning-resolver |
| component-detector.ts imports | shared types only |
| meaning-resolver.ts imports | shared types only |

### IR Generation / Playwright (Layer 5)

| Dependency on capability | NONE |
|--------------------------|------|
| ir-bridge.ts `build()` receives | `GenerationInput { interactions, recordingContext, testCaseName, enrichment? }` |
| `enrichment` parameter | **Never passed** at call site (service-worker.ts:316). Always undefined. |
| ir-bridge.ts imports | generation-types only (no capability imports) |
| `deriveAssertions()` | Always returns `[]` — enrichment always absent |
| Playwright renderers | Import from execution-ir/types only |

### Repository V2 Session Persistence (Layer 6)

| Dependency on capability | System B matching block is dead code (capability always null) |
|--------------------------|------|
| `persistSession()` | Creates RecordingSession (preserved), stores IR artifact (preserved). Capability matching block (lines 106-143) never executes. |
| `RecordingSession.understandingResult` | Preserved — UnderstandingResult stays. `capability` field stays as null. |
| `DexieRecordingSessionRepository` | Preserved. `getByCapabilityId()` can be removed or left (returns `[]`). |

---

## 9. Final Confirmation

**Removing the Capability Model from deff878 cannot affect:**

- ✅ Recording (event capture, identity extraction, sessionStorage buffering, delivery)
- ✅ Interaction capture and classification (Component Runtime, 14 definitions, EvidenceLedger)
- ✅ Behavioral Observation (observation windows, document observer, element state cache)
- ✅ Enrichment (component detection, framework detection, meaning resolution)
- ✅ IR generation (ir-bridge build(), merge rules, locator ranking, action mapping)
- ✅ Playwright generation (project generator, renderers, all 6 adapters)
- ✅ Repository V2 session persistence (RecordingSession, IR artifact, project creation)

**The only user-visible changes are:**
1. Side panel loses capability badges (cosmetic)
2. Repository page loses empty capability tab (was always empty)

**The three hidden dependencies are all LOW severity:**
1. `healing-service.test.ts:123` — one line to remove (`db.capabilities.clear()`)
2. `IntrinsicCapability` — false positive, no action needed
3. `UnderstandingResult.capability` type — keep `capability-candidate.ts` or update type

**No modifications were made. Frozen worktree untouched.**
