# Capability Model — Removal Impact Analysis at deff878

**Baseline:** `deff878a0cfdf6f42d65f19d4b0c62ec39edf8a8`
**Date:** 2026-08-11
**Method:** Read-only source inspection of frozen git worktree at `/workspace/tmp/deff878-audit`
**Purpose:** Determine what the Capability Model does, what depends on it, what would break if removed, and what would continue unchanged. No modifications made.

---

## Table of Contents

1. [What "Capability Model" Means at deff878](#1-what-capability-model-means)
2. [System A — Runtime Capability Engine (ACTIVE)](#2-system-a)
3. [System B — Domain Capability Entity (INACTIVE)](#3-system-b)
4. [The Semantics Layer — Shared Dependency](#4-semantics-layer)
5. [What the Capability Model Actually Does](#5-what-it-does)
6. [What Depends on It](#6-what-depends)
7. [What Happens If We Remove It Completely](#7-removal-impact)
8. [What Would Continue Working Unchanged](#8-unchanged)
9. [Precise File Inventory for Removal](#9-file-inventory)
10. [Test Inventory for Removal](#10-test-inventory)
11. [Integration Point Analysis](#11-integration-points)
12. [Risk Assessment](#12-risk-assessment)

---

## 1. What "Capability Model" Means at deff878 <a name="1-what-capability-model-means"></a>

At deff878, "Capability Model" refers to **two separate, disconnected systems** that share the word "capability" but have no code-level connection:

| System | Description | Status | LOC |
|--------|-------------|--------|-----|
| **System A** — Runtime Capability Engine | 12-rule batch inference from ComponentInteractions → CapabilityRecords. Runs at stopRecording. Output is display-only (side panel). | **ACTIVE** (runs in production) | ~2,400 |
| **System B** — Domain Capability Entity | Mutable accumulated Capability with matching/enrichment. Designed for Repository V2 persistence and cross-session learning. | **INACTIVE** (never receives non-null input) | ~1,400 |
| **Shared** — Semantics Layer | Effect interpreter that translates behavioral observations into SemanticEffects. Consumed by System A for behavioral evidence. Also consumed by side panel for display. | **ACTIVE** (runs in production, dual consumer) | ~820 |

**Key insight:** System A produces `CapabilityRecord[]` (runtime inference). System B would consume `CapabilityCandidate` (domain entity from UnderstandingResult). They never interact. `persistSession()` receives `understanding.capability: null`, so System B's matching/enrichment/persistence code never executes.

The Semantics Layer is shared infrastructure — it feeds System A's evidence extraction AND the side panel's behavioral evidence display. Removing the capability model does NOT require removing the semantics layer.

---

## 2. System A — Runtime Capability Engine (ACTIVE) <a name="2-system-a"></a>

### What it does

At `stopRecording()`, after `filterProductionInteractions()`:

1. `buildEffectsMap(interactions)` — collects `SemanticEffect[]` from each interaction's `behavioralObservations[].semanticEffects[]`
2. `createCapabilityEngine()` — instantiates engine with all 12 rules
3. `engine.inferCapabilities(interactions, effectsMap)` — for each interaction: extracts evidence, runs 12 rules, resolves conflicts, builds `CapabilityRecord`
4. Filters out Navigation interactions (they're consequence events)
5. `serializeCapabilityRecords(records)` — converts Sets to arrays for JSON
6. Stores to `chrome.storage.local` under `capability_records` key

### Output consumers

The serialized `CapabilityRecord[]` is consumed by exactly ONE thing:
- **Side panel** (`sidepanel.ts:718-811`): `loadCapabilityRecords()` reads from `capability_records`, `renderCapabilityRecords()` displays capability badges in a dedicated section.

It is NOT consumed by:
- IR Bridge (generation layer)
- persistSession (persistence layer)
- Repository V1
- Repository V2 (via UnderstandingResult)
- Any test generation or execution path

### Files (19 source files, ~3,544 LOC)

```
src/capabilities/
├── capability-bridge.ts          (203 LOC) — SW integration, buildEffectsMap, serialize
├── capability-engine.ts          (192 LOC) — batch orchestrator
├── capability-rule.ts             (48 LOC) — interface contract
├── capability-types.ts           (186 LOC) — CapabilityType, CapabilityRecord, CapabilityClaim
├── conflict-resolver.ts          (138 LOC) — 6-rule conflict resolution
├── evidence-extractor.ts         (451 LOC) — transforms interactions → ExtractedEvidence
├── keyword-dictionary.ts         (144 LOC) — 8-category keyword lookup
└── rules/
    ├── adjust-value.ts           (106 LOC)
    ├── expand-collapse.ts         (97 LOC)
    ├── filter-selection.ts       (140 LOC)
    ├── navigate.ts               (103 LOC)
    ├── open-detail.ts            (112 LOC)
    ├── paginate.ts               (130 LOC)
    ├── search.ts                 (125 LOC)
    ├── select-option.ts          (114 LOC)
    ├── sort-selection.ts         (128 LOC)
    ├── submit-form.ts            (122 LOC)
    ├── toggle-control.ts         (107 LOC)
    └── upload-file.ts             (76 LOC)
```

---

## 3. System B — Domain Capability Entity (INACTIVE) <a name="3-system-b"></a>

### What it does

**Nothing in production.** The code path is:

```
service-worker.ts handleStopRecording()
  → persistSession(uowFactory, {
      understanding: {
        capability: null,    ← HARDCODED NULL
        fragment: null,      ← HARDCODED NULL
      },
      ...
    })
  → session-persistence-service.ts persistSession()
    → const candidate = input.understanding.capability;  // null
    → if (candidate) { ... }                              // NEVER ENTERS
```

No system at deff878 produces a `CapabilityCandidate`. The `ApplicationKnowledgeFragment` is also `null`. The entire Understanding Layer is a shell.

### What it WOULD do (if connected)

1. `matchCapability(candidate, existingCapabilities)` — 4-factor weighted scoring (entryElement 35%, inputs 30%, outcome 25%, name 10%)
2. Auto-merge (≥0.75): enrich existing Capability with new observations
3. New capability (<0.50): create Capability from candidate
4. Ambiguous (≥0.50, <0.75): leave candidate in RecordingSession, defer to human

### Files (8 source files, ~1,400 LOC)

```
src/domain/entities/
├── capability.ts                 (434 LOC) — Capability entity + create/enrich functions
├── capability-candidate.ts       (187 LOC) — CapabilityCandidate type (Understanding Layer output)
├── understanding-result.ts        (68 LOC) — UnderstandingResult aggregate (fragment + capability)
└── application-knowledge.ts      (327 LOC) — ApplicationKnowledgeFragment type (never produced)

src/repository/services/
├── capability-matching-service.ts (418 LOC) — 4-factor weighted matching
└── (session-persistence-service.ts — partially: lines 106-143 are capability matching code)

src/repository/v2/
├── interfaces/capability-repository.ts — interface contract
└── dexie/dexie-capability-repository.ts (39 LOC) — Dexie CRUD for capabilities table
```

### Dexie infrastructure that exists for System B

- **Dexie schema V2** adds `capabilities` table (indexed by `id`, `projectId`, `*sessionIds` multi-entry)
- `DexieUnitOfWork` includes `capabilities` in its transaction scope
- `RepositorySet` interface includes `capabilities: CapabilityRepository`
- `repository-page.ts` (1180 LOC) has a capability-centric view that queries V2 — but since no capabilities are ever created, this view always shows an empty state

---

## 4. The Semantics Layer — Shared Dependency <a name="4-semantics-layer"></a>

### What it does

The semantics layer interprets behavioral observation windows into `SemanticEffect[]`. It is called from two places in `sw-integration.ts`:
1. `onEmit` callback (line 114) — interprets observations for each emitted interaction
2. `restoreFromStorage` callback (line 411) — reinterprets after SW restart recovery

### Consumers of SemanticEffect

| Consumer | Purpose | Survives capability removal? |
|----------|---------|------------------------------|
| **System A — capability-bridge** | `buildEffectsMap()` collects effects for capability rules | **NO** — this consumer would be removed |
| **Side panel — behavioral-renderer** | `renderSemanticEffects()` displays effects in interaction detail | **YES** — independent of capability model |
| **Side panel — interaction-renderer** | Renders behavioral evidence section | **YES** — independent |
| **Side panel — sidepanel.ts** | `SerializableCapabilityRecord.evidence.semanticEffects` | **DEPENDS** — this specific field would be removed, but the side panel's own behavioral rendering survives |
| **observation-types.ts** | `semanticEffects?: SemanticEffect[]` field on `ObservationResult` | **YES** — this is a type annotation, not a capability dependency |

### Files (5 source files, ~822 LOC)

```
src/semantics/
├── effect-interpreter.ts          (78 LOC) — orchestrator: runs rules in priority order
├── effect-rules.ts               (567 LOC) — 7 rule functions (state-toggle, expand-collapse, etc.)
├── effect-types.ts                (87 LOC) — EffectCategory, SemanticEffect types
├── interpretation-context.ts      (23 LOC) — minimal context for interpretation
└── sw-bridge.ts                   (67 LOC) — SW integration: interpretBehavioralObservations()
```

### Verdict: Semantics layer should be preserved

The semantics layer is independent infrastructure. It translates behavioral observations into semantic categories. Its only capability-model-specific consumer is `buildEffectsMap()` in `capability-bridge.ts`. If capability-bridge is removed, the semantics layer continues serving the side panel's behavioral evidence display.

---

## 5. What the Capability Model Actually Does <a name="5-what-it-does"></a>

### In production at deff878:

| Function | Actually Runs? | Output | Consumed By |
|----------|---------------|--------|------------|
| Capability inference (12 rules) | ✅ YES | `CapabilityRecord[]` | Side panel display only |
| Capability serialization | ✅ YES | JSON-safe records | chrome.storage.local |
| Capability matching (4-factor) | ❌ NO | Never called | — |
| Capability creation/enrichment | ❌ NO | Never called | — |
| Capability persistence (Dexie) | ❌ NO | Table always empty | — |
| Repository page capability view | ✅ Runs but empty | Empty state | User sees "No capabilities" |
| Semantic effect interpretation | ✅ YES | `SemanticEffect[]` on observations | Capability engine + side panel |

### Net production effect of the capability model:

1. **Side panel shows capability badges** — "FilterSelection (HIGH)", "Navigate (HIGH)", "Unclassified (LOW)" for each interaction
2. **Side panel shows semantic effects** — "state-toggle: unchecked → checked", "content-change: child elements 12→2" (shared with semantics layer, survives removal)
3. **Repository page shows empty capabilities** — always "No capabilities found" because System B never creates any
4. **chrome.storage.local holds capability_records** — read on side panel load, cleared on new recording

That's it. No test is generated differently. No persistence differs. No execution path changes. The capability model is a **display-only overlay** at deff878.

---

## 6. What Depends on It <a name="6-what-depends"></a>

### Production code dependencies (src/, excluding tests):

| File | Depends On | How | Impact of Removal |
|------|-----------|-----|-------------------|
| `service-worker.ts` | `capability-bridge.ts` | Imports `runCapabilityInference`, `serializeCapabilityRecords`. Calls at lines 296-303. | Remove import + call block (lines 38-41, 290-303, 367-368) |
| `service-worker.ts` | `semantics/sw-bridge.ts` | Imports `interpretBehavioralObservations`. Called from sw-integration at lines 112-114, 411. | **PRESERVE** — not part of capability model |
| `sw-integration.ts` | `semantics/sw-bridge.ts` | Same as above | **PRESERVE** |
| `sidepanel.ts` | `capability_records` storage key | `loadCapabilityRecords()`, `renderCapabilityRecords()`, `SerializableCapabilityRecord` type (lines 111-113, 457, 674-685, 718-811) | Remove capability display section + related code |
| `sidepanel.ts` | `REPOSITORY_CAPABILITY_ID/DECISION` storage keys | Lines 829-830, 836-837, 1123-1124 | Remove (always null/`'none'` anyway) |
| `interaction-renderer.ts` | `behavioral-renderer.ts` → `semantics/effect-types` | `renderSemanticEffects()` | **PRESERVE** — semantics layer stays |
| `behavioral-renderer.ts` | `semantics/effect-types` | Type imports | **PRESERVE** |
| `shared/types.ts` | `StorageKeys.CAPABILITY_RECORDS`, `REPOSITORY_CAPABILITY_ID`, `REPOSITORY_CAPABILITY_DECISION` | Enum entries | Remove 3 enum entries |
| `shared/observation-types.ts` | `semantics/effect-types` (`SemanticEffect`) | Type import for `ObservationResult.semanticEffects` | **PRESERVE** |
| `shared/component-types.ts` | `behavioralObservations?: ObservationResult[]` field | Type definition on ComponentInteraction | **PRESERVE** — behavioral observations are Layer 1, not capability |
| `session-persistence-service.ts` | `capability-matching-service`, `capability.ts`, `capability-candidate.ts`, `understanding-result.ts` | Imports for matching/enrichment block (lines 25-40, 106-143) | Remove capability matching block + related imports |
| `capability-matching-service.ts` | `capability-candidate.ts`, `capability.ts` | Type imports | Entire file deleted |
| `dexie-capability-repository.ts` | `capability.ts`, `capability-repository.ts` | Type imports | Entire file deleted |
| `dexie-database.ts` | `capability.ts` | Type import for `capabilities` table schema | Remove table from schema (V4 migration) |
| `dexie-unit-of-work.ts` | `capability-repository.ts`, `DexieCapabilityRepository` | Transaction scope + RepositorySet | Remove from transaction set |
| `interfaces/unit-of-work.ts` | `capability-repository.ts` | RepositorySet interface | Remove `capabilities` from interface |
| `interfaces/capability-repository.ts` | `capability.ts` | Interface contract | Entire file deleted |
| `repository-page.ts` | `capability.ts` | Capability-centric view (lines 30-31, 42-89, 108-230+) | Remove capability view or leave as empty-state code |
| `domain/entities/understanding-result.ts` | `capability-candidate.ts`, `application-knowledge.ts` | UnderstandingResult aggregate | Remove `capability` field or leave as optional null |
| `domain/entities/recording-session.ts` | `understanding-result.ts` | RecordingSession stores UnderstandingResult | UnderstandingResult stays but `capability` field becomes permanently null |
| `generation/generation-types.ts` | Mentions `CapabilityCandidate` in INV-GEN-10 comment | Comment only | Update comment |

### Dependency graph (simplified):

```
                    ┌─────────────────────┐
                    │  service-worker.ts  │
                    └──────┬──────┬───────┘
                           │      │
              ┌────────────┘      └─────────────┐
              ▼                                  ▼
┌─────────────────────────┐         ┌────────────────────────┐
│ capability-bridge.ts    │         │ semantics/sw-bridge.ts │ ← PRESERVE
│ (runCapabilityInference)│         │ (interpretBehavioral   │
└──────────┬──────────────┘         │  Observations)         │
           │                        └────────────┬───────────┘
           ▼                                     │
┌─────────────────────────┐                      │
│ capability-engine.ts    │                      ▼
│ evidence-extractor.ts   │           ┌────────────────────────┐
│ conflict-resolver.ts    │           │ semantics/effect-*.ts  │ ← PRESERVE
│ keyword-dictionary.ts   │           │ (interpretation rules) │
│ rules/*.ts (12 files)   │           └────────────────────────┘
└─────────────────────────┘                      │
                                                 ▼
                                     ┌────────────────────────┐
                                     │ shared/observation-    │ ← PRESERVE
                                     │ types.ts               │
                                     │ (SemanticEffect field) │
                                     └────────────────────────┘
```

---

## 7. What Happens If We Remove It Completely <a name="7-removal-impact"></a>

### System A removal (Runtime Capability Engine)

| What changes | Impact |
|-------------|--------|
| `runCapabilityInference` no longer called at stopRecording | No CapabilityRecord[] produced. ~0ms savings (batch post-recording, non-blocking). |
| `capability_records` key not written to chrome.storage.local | Side panel can't display capability badges. Minor UX reduction. |
| `CAPABILITY_RECORDS` enum entry orphaned | Remove from types.ts |
| Side panel capability section hidden/removed | User sees fewer labels per interaction. Semantic effects still visible. |
| `SerializableCapabilityRecord` interface in sidepanel.ts | Remove |
| `REPOSITORY_CAPABILITY_ID/DECISION` keys always null | Already always null — no behavior change |

**Functional impact:** Side panel loses capability badges. Nothing else changes. Test generation, persistence, execution — all unaffected.

### System B removal (Domain Capability Entity)

| What changes | Impact |
|-------------|--------|
| `persistSession` capability matching block (lines 106-143) removed | Already dead code (capability always null). Zero behavior change. |
| `capability-matching-service.ts` deleted | Dead code removal. Zero behavior change. |
| `dexie-capability-repository.ts` deleted | Dexie `capabilities` table becomes orphaned. Needs V4 schema migration to drop it. |
| `domain/entities/capability.ts` deleted | Type references in session-persistence-service.ts and repository-page.ts need cleanup. |
| `domain/entities/capability-candidate.ts` deleted | UnderstandingResult.capability type reference needs cleanup. |
| `understanding-result.ts` simplified | `capability` field removed or left as `null` permanently. |
| `repository-page.ts` capability view removed | User loses capability-centric repository browser tab (which was always empty). |
| Dexie schema V2 `capabilities` table orphaned | Needs V4 migration to drop table. Or leave as empty table (harmless). |
| `DexieUnitOfWork` transaction scope | Remove `capabilities` from transaction table list. |
| `RepositorySet` interface | Remove `capabilities: CapabilityRepository`. |

**Functional impact:** Zero. System B never runs. All removed code is dead infrastructure.

### Semantics layer removal (NOT RECOMMENDED but analyzed)

| What changes | Impact |
|-------------|--------|
| `interpretBehavioralObservations()` no longer called | Observations not interpreted. `semanticEffects` field on ObservationResult stays undefined. |
| Side panel behavioral evidence display | Loses semantic effect labels. Raw mutation data still available via behavioral-renderer's `renderBehavioralEvidence()`. |
| System A loses behavioral evidence input | Moot — System A is being removed too. |
| ObservationResult.semanticEffects field | Stays in type but always undefined. |

**Functional impact:** Side panel loses semantic effect interpretation of behavioral evidence. Raw behavioral data (mutations, timing) still displayed. Since the semantics layer also serves the side panel independently of capabilities, removing it is a separate decision from removing the capability model.

---

## 8. What Would Continue Working Unchanged <a name="8-unchanged"></a>

### After removing BOTH System A + System B:

| Feature | Status | Why |
|---------|--------|-----|
| Event capture (12 event types) | ✅ Unchanged | Layer 0 independent |
| Identity extraction | ✅ Unchanged | Layer 0 independent |
| Behavioral observation windows | ✅ Unchanged | Layer 1 independent |
| Document observer mutations | ✅ Unchanged | Layer 1 independent |
| Component Runtime classification (14 definitions) | ✅ Unchanged | Layer 2 independent |
| Evidence Ledger | ✅ Unchanged | Layer 2 independent |
| Enrichment (component type + business meaning) | ✅ Unchanged | Layer 3 independent |
| IR Bridge → Playwright generation | ✅ Unchanged | Layer 5 never receives capability data |
| Repository V1 (user-facing test repository) | ✅ Unchanged | V1 never reads capability data |
| Repository V2 session/IR persistence | ✅ Unchanged | Sessions persist without capability |
| Test execution (IR executor) | ✅ Unchanged | Execution reads IR plan, not capabilities |
| Side panel recording controls | ✅ Unchanged | Independent of capability model |
| Side panel interaction list | ✅ Unchanged | Interactions shown without capability badges |
| Side panel behavioral evidence | ✅ Unchanged | **If semantics layer preserved** (recommended) |
| MV3 recovery / SW restart resilience | ✅ Unchanged | Independent |
| Audit trail | ✅ Unchanged | Independent |
| Semantic effect interpretation | ✅ Unchanged | **If semantics layer preserved** (recommended) |

### The ONLY user-visible changes:

1. **Side panel loses capability badges** — the "Capability Records" section showing "FilterSelection (HIGH)" etc. disappears.
2. **Repository page loses capability view** — the capability-centric browser tab (always empty) disappears.

That's the complete user-visible impact. Everything else is invisible dead-code removal.

---

## 9. Precise File Inventory for Removal <a name="9-file-inventory"></a>

### Delete entirely (27 source files, ~4,944 LOC):

**System A — Runtime Capability Engine (19 files):**
```
src/capabilities/capability-bridge.ts
src/capabilities/capability-engine.ts
src/capabilities/capability-rule.ts
src/capabilities/capability-types.ts
src/capabilities/conflict-resolver.ts
src/capabilities/evidence-extractor.ts
src/capabilities/keyword-dictionary.ts
src/capabilities/rules/adjust-value.ts
src/capabilities/rules/expand-collapse.ts
src/capabilities/rules/filter-selection.ts
src/capabilities/rules/navigate.ts
src/capabilities/rules/open-detail.ts
src/capabilities/rules/paginate.ts
src/capabilities/rules/search.ts
src/capabilities/rules/select-option.ts
src/capabilities/rules/sort-selection.ts
src/capabilities/rules/submit-form.ts
src/capabilities/rules/toggle-control.ts
src/capabilities/rules/upload-file.ts
```

**System B — Domain Capability Entity (5 files):**
```
src/domain/entities/capability.ts
src/domain/entities/capability-candidate.ts
src/repository/services/capability-matching-service.ts
src/repository/v2/interfaces/capability-repository.ts
src/repository/v2/dexie/dexie-capability-repository.ts
```

**Note:** `src/domain/entities/understanding-result.ts` and `src/domain/entities/application-knowledge.ts` are NOT deleted — UnderstandingResult is still used by RecordingSession. Only the `capability` field reference changes.

### Modify (8 source files):

| File | Changes Needed |
|------|----------------|
| `src/background/service-worker.ts` | Remove capability-bridge import (lines 38-41), capability inference block (lines 290-303), REPOSITORY_CAPABILITY_ID/DECISION writes (lines 367-368). Preserve semantics/sw-bridge import. |
| `src/runtime/sw-integration.ts` | No changes needed — it imports `interpretBehavioralObservations` from semantics, not capabilities. |
| `src/repository/services/session-persistence-service.ts` | Remove capability-matching imports (lines 35-40), capability matching block (lines 106-143). Simplify return to always return `capabilityId: null, capabilityDecision: 'none'`. |
| `src/shared/types.ts` | Remove `CAPABILITY_RECORDS`, `REPOSITORY_CAPABILITY_ID`, `REPOSITORY_CAPABILITY_DECISION` from StorageKeys enum. |
| `src/sidepanel/sidepanel.ts` | Remove `SerializableCapabilityRecord` interface (lines 674-685), `loadCapabilityRecords()` (lines 718-725), `renderCapabilityRecords()` (lines 728-796), `loadAndRenderCapabilityRecords()` (lines 799-813), capability section DOM references (lines 111-113), capability-related storage reads (lines 829-830, 836-837), capability storage clears (lines 1123-1124). |
| `src/repository/v2/dexie/dexie-database.ts` | Remove `capabilities` table from schema. Requires V4 schema migration. |
| `src/repository/v2/dexie/dexie-unit-of-work.ts` | Remove `capabilities` from transaction scope and `RepositorySet`. |
| `src/repository/v2/interfaces/unit-of-work.ts` | Remove `capabilities: CapabilityRepository` from `RepositorySet`. |
| `src/repository/repository-page.ts` | Remove capability-centric view code (significant portion of 1180 LOC). |
| `src/domain/entities/understanding-result.ts` | Remove `capability` field or leave as optional `CapabilityCandidate | null` with comment that it's permanently null. |
| `src/generation/generation-types.ts` | Update INV-GEN-10 comment. |

### Preserve (NOT part of capability model):

```
src/semantics/effect-interpreter.ts     ← PRESERVE (shared infrastructure)
src/semantics/effect-rules.ts           ← PRESERVE
src/semantics/effect-types.ts           ← PRESERVE
src/semantics/interpretation-context.ts ← PRESERVE
src/semantics/sw-bridge.ts              ← PRESERVE
src/domain/entities/understanding-result.ts ← PRESERVE (modified, not deleted)
src/domain/entities/application-knowledge.ts ← PRESERVE (fragment type, separate concern)
src/domain/entities/recording-session.ts ← PRESERVE
src/sidepanel/behavioral-renderer.ts    ← PRESERVE (renders behavioral evidence, not capabilities)
src/sidepanel/interaction-renderer.ts   ← PRESERVE (renders behavioral evidence section)
```

---

## 10. Test Inventory for Removal <a name="10-test-inventory"></a>

### Delete entirely (16 test files, ~8,205 LOC):

**System A tests:**
```
tests/capabilities.test.ts                         (89 LOC)
tests/capabilities/phase1-core-infrastructure.test.ts  (827 LOC)
tests/capabilities/phase2-physical-rules.test.ts       (663 LOC)
tests/capabilities/phase3-navigation-rules.test.ts     (702 LOC)
tests/capabilities/phase4-content-change-rules.test.ts (701 LOC)
tests/capabilities/phase4-helpers.ts                   (99 LOC)
tests/capabilities/phase5-form-value-rules.test.ts     (642 LOC)
tests/capabilities/phase6-engine-integration.test.ts   (565 LOC)
tests/capabilities/phase7-realworld-validation.test.ts (641 LOC)
```

**System B tests:**
```
tests/capability-matching-service.test.ts         (507 LOC)
tests/domain/capability.test.ts                   (524 LOC)
tests/domain/capability-understanding-types.test.ts (306 LOC)
```

### Modify (2 test files):

| File | Changes |
|------|---------|
| `tests/session-persistence-service.test.ts` (512 LOC, 16 tests) | Remove capability matching tests (auto-merge, ambiguous, null capability path). Tests using synthetic UnderstandingResult with populated capability need updating. |
| `tests/repository-v2/unit-of-work.test.ts` (220 LOC, 5 tests) | Remove capability table from transaction tests if testing table presence. |

### Preserve:

```
tests/semantics/effect-interpreter.test.ts        ← PRESERVE (semantics layer)
tests/semantics/effect-rules.test.ts              ← PRESERVE
tests/semantics/sw-bridge.test.ts                 ← PRESERVE
tests/semantics/g6-details-expand-collapse.test.ts ← PRESERVE
tests/semantics/net-node-delta.test.ts            ← PRESERVE
tests/semantics/fixtures.ts                       ← PRESERVE
```

---

## 11. Integration Point Analysis <a name="11-integration-points"></a>

### Integration Point 1: service-worker.ts → capability-bridge.ts

**Current code (lines 38-41, 290-303):**
```typescript
import { runCapabilityInference, serializeCapabilityRecords } from '../capabilities/capability-bridge';

// ... in handleStopRecording:
let capabilityRecords = [];
try {
  const records = runCapabilityInference(productionInteractions);
  capabilityRecords = serializeCapabilityRecords(records);
  await StorageService.setRaw(StorageKeys.CAPABILITY_RECORDS, capabilityRecords);
} catch (e) {
  console.warn('[Capability Engine] error:', e);
}
```

**After removal:** Delete import + entire try/catch block. `productionInteractions` still used for `buildIRPlan` — no other consumer of this data is affected.

**Risk:** NONE. The capability inference is a pure post-processing step with no side effects on the interactions array or any downstream consumer.

### Integration Point 2: service-worker.ts → persistSession (capability fields)

**Current code (lines 356-357, 367-368):**
```typescript
understanding: { ..., capability: null },
// ...
await StorageService.setRaw(StorageKeys.REPOSITORY_CAPABILITY_ID, persistenceResult.capabilityId);
await StorageService.setRaw(StorageKeys.REPOSITORY_CAPABILITY_DECISION, persistenceResult.capabilityDecision);
```

**After removal:** Remove capability from understanding object (or leave as null). Remove the two storage writes (they write null/'none' anyway).

**Risk:** NONE. These are already dead writes.

### Integration Point 3: session-persistence-service.ts capability matching block

**Current code (lines 106-143):** Entire capability matching/enrichment block wrapped in `if (candidate)` — never entered because `candidate` is always null.

**After removal:** Delete the block. Return `capabilityId: null, capabilityDecision: 'none'` unconditionally.

**Risk:** NONE. Dead code removal.

### Integration Point 4: side panel capability display

**Current code:** Multiple functions for loading and rendering capability records.

**After removal:** Remove capability DOM section, related JS functions. The side panel's interaction list and behavioral evidence sections remain.

**Risk:** LOW. Must ensure no JS errors from missing DOM elements. The capability section is conditionally hidden anyway (`capabilityRecordsSection.hidden = true` when no records).

### Integration Point 5: Dexie schema (capabilities table)

**Current:** V2 schema adds `capabilities` table. Removing it requires a V4 migration.

**After removal:** Two options:
- **Option A:** V4 migration drops the table. Clean but requires migration code.
- **Option B:** Leave the empty table. Harmless — Dexie ignores unused tables. No migration needed.

**Risk:** LOW. Option B is zero-risk.

### Integration Point 6: repository-page.ts capability view

**Current:** 1180-LOC page with capability-centric view that queries Dexie. Always shows empty state.

**After removal:** Remove capability view code. The page's tree-view (Repository V1) functionality remains.

**Risk:** LOW. Need to verify the page still initializes without capability DOM elements.

---

## 12. Risk Assessment <a name="12-risk-assessment"></a>

### Compilation risks

After removing the 27 source files:
- `service-worker.ts` needs import cleanup (2 import lines)
- `session-persistence-service.ts` needs import cleanup (5 import lines)
- `dexie-unit-of-work.ts` needs import + constructor cleanup (3 lines)
- `unit-of-work.ts` interface needs `capabilities` field removed (2 lines)
- `sidepanel.ts` needs ~100 lines of capability display code removed
- `repository-page.ts` needs ~200 lines of capability view removed
- `types.ts` needs 3 enum entries removed
- `understanding-result.ts` needs `capability` field type reference updated

Estimated: ~15 TypeScript files need modification. All changes are straightforward import/field removals.

### Test risks

- 16 test files deleted (8,205 LOC)
- 2 test files modified
- Remaining tests should pass unchanged — no surviving code imports from deleted files
- `tsc --noEmit` will flag any missed import references
- `vitest run` will confirm no surviving test imports from deleted files

### Behavioral risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Side panel JS error from missing DOM element | LOW | Side panel blank | Test in browser after removal |
| Dexie schema mismatch (V2 promises capabilities table) | ZERO | — | Table can stay empty |
| Recording pipeline regression | ZERO | — | Capability inference runs AFTER all other processing |
| Generation pipeline regression | ZERO | — | Generation never reads capability data |
| Persistence regression | ZERO | — | persistSession already receives null capability |

### Overall assessment

**Removing the capability model from deff878 is LOW RISK.** The capability model is a display-only overlay with zero downstream consumers. The semantics layer (which IS connected to the recording pipeline) can be preserved independently.

**Net effect of removal:**
- ~4,944 LOC source deleted
- ~8,205 LOC test deleted
- ~15 source files modified (import/field cleanup)
- ~2 test files modified
- Zero functional regression
- Side panel loses capability badges (cosmetic)
- Repository page loses capability tab (was always empty)
