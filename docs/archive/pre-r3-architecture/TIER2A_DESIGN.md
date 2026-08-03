# Tier 2A Design — Interaction Enrichment Pass

**Status:** Design Document — pre-implementation
**Scope:** Unified design for evidence engine wiring, assertion improvements, and F5 fix
**Principle:** One cohesive enrichment layer, not three isolated features
**Supersedes:** Prior drafts using the name "Semantic Quality Enhancement Layer (SQEL)"

---

## §0. Terminology — The Enrichment Stage Model

This project has a multi-stage pipeline. Enrichment — the act of adding
derived semantic metadata to recorded interactions — occurs at three
structurally distinct scopes. This document defines the **first** of these
stages and draws explicit boundaries against the others so future work
extends the architecture rather than bypassing it.

| Stage | Name | Scope | Input | Output | When |
|-------|------|-------|-------|--------|------|
| **E1** | **Interaction Enrichment Pass** | Per-interaction | `ComponentInteraction[]` | Enriched `ComponentInteraction[]` | After classification, before IR generation |
| E2 | Sequence Enrichment Pass *(future)* | Cross-interaction | Full interaction list | Interactions + cross-step metadata | After E1, before IR generation |
| E3 | IR Optimization Pass *(future)* | Post-IR | `ExecutionIRPlan` | Optimized `ExecutionIRPlan` | After IR Bridge, before rendering |

**E1 (this document) handles:**
- Confidence propagation from evidence engine → IR-ready
- Assertion derivation with locator backfill (fixes F5)
- Structural assertion generation (presence, visibility)
- Semantic intent and evidence trail mapping to IR steps

**E1 does NOT handle:**
- Cross-interaction state dependencies (e.g., "step 3 depends on step 1's login")
- Semantic grouping of interactions into workflows
- IR-level optimizations (POM extraction, step merging, variable resolution)

**Why E1, E2, E3 are separate stages, not one:**

Each stage requires a different scope of context and operates on a
different data shape. Merging them creates a monolithic transform that
is hard to test, hard to extend, and impossible to bypass selectively.
Keeping them separate means:

1. E1 is a pure function testable in isolation — given interactions
   + events, assert enriched output. No IR Plan needed.
2. E2 is a pure function testable in isolation — given the full
   interaction list, assert cross-step metadata. No IR Plan needed.
3. E3 is a pure function testable in isolation — given an IR Plan,
   assert optimized output. No interactions needed.
4. AI integration slots into the appropriate stage: intent reasoning
   at E1 (via `fuseEvidence()`), sequence reasoning at E2, test
   optimization at E3. Each AI concern has a clean insertion point.
5. The IR Bridge remains a pure transform (`ComponentInteraction[]` →
   `ExecutionIRPlan`) — it reads enriched data but does not enrich.

---

## §1. Problem Statement

The recording pipeline classifies interactions correctly (Phase 3
validation confirms this) but produces **semantically impoverished
output**. Three separate subsystems are each partially broken:

1. **Evidence engine** runs in `onEmit` and annotates interactions with
   `intent`, `confidence`, and `evidenceTrail` — but the IR Bridge
   **discards all of it**, overriding confidence with a crude
   `endState ? 1.0 : 0.5` and never reading `intent` or `evidenceTrail`.

2. **Assertion deriver** generates state verification assertions from
   metadata — but creates them with **empty locator arrays**, causing the
   Playwright renderer to crash (F5 bug). Any interaction with state
   assertions produces zero Playwright output.

3. **Description generator** builds human-readable step descriptions — but
   has no access to semantic intent, so descriptions are purely mechanical
   ("Fill X in Y") without business meaning.

These are not three independent bugs. They are symptoms of a single
architectural gap: **there is no unified post-classification enrichment
pass between the Component Runtime output and the IR Bridge input.** The
evidence engine fills some fields, the assertion deriver fills others,
and the IR Bridge ignores or breaks both.

---

## §2. Current Data Flow (Broken)

```
ComponentRuntime.onEmit(interaction)
  ├── enrichInteraction(interaction)           → componentType, businessMeaning
  ├── annotateWithEvidence(interaction)         → intent, confidence, evidenceTrail
  │     ↓ SETS ci.confidence = 0.0-1.0
  │     ↓ SETS ci.intent = 'toggle'|'select'|...
  │     ↓ SETS ci.evidenceTrail = IntentVote[]
  └── persistLiveInteractions()
        ↓
stopRecording()
  ├── runtime.flush()
  └── enrichConfigurationSession(interactions)
        ↓
        NO ENRICHMENT PASS EXISTS HERE  ← ← ← THE GAP
        ↓
IR Bridge: build(input)
  ├── toBridgeInteraction(ci)
  │     ↓ DISCARDS ci.confidence, replaces with endState ? 1.0 : 0.5
  │     ↓ DISCARDS ci.intent (not mapped to BridgeInteraction)
  │     ↓ DISCARDS ci.evidenceTrail (not mapped to BridgeInteraction)
  ├── deriveStateAssertions(interaction)
  │     ↓ Creates assertions with EMPTY resolvedLocators
  ├── assertions = [...constraint, ...state]
  │     ↓ Assertions have no locators → F5 crash in Playwright renderer
  └── step.executionParameters.waitStrategy
        ↓ Uses discarded confidence (always 1.0 for completed) → never triggers 'visible' wait
```

---

## §3. Proposed Architecture: Interaction Enrichment Pass (E1)

### 3.1 Design Principle

The Interaction Enrichment Pass is a **single enrichment function** that
runs between `stopRecording()`'s flush and the IR Bridge's `build()`. It
consolidates three concerns that are currently scattered or missing:

1. **Assertion derivation + locator backfill** — assertions carry real
   locators (fixes F5)
2. **Confidence propagation** — evidence confidence flows to the IR Bridge
   instead of being overridden
3. **Structural assertion generation** — new assertions that verify the
   action had a visible effect (presence, visibility)

The pass is a **pure function** — no side effects, no mutations to the
input interactions. It returns derived data (assertions, locators) that
the IR Bridge reads during `build()`.

### 3.2 Formal Contract

```
enrichInteractions(input: EnrichmentInput): EnrichmentOutput
```

**Input (`EnrichmentInput`):**
| Field | Type | Source |
|-------|------|--------|
| `interactions` | `ComponentInteraction[]` | From `stopRecording()` — already evidence-annotated via `onEmit` |
| `events` | `ObservedEvent[]` | Full event log from the recording session — needed for locator resolution context |
| `fragment` | `ApplicationKnowledgeFragment \| null` | Optional knowledge fragment for constraint assertions |

**Output (`EnrichmentOutput`):**
| Field | Type | Consumer |
|-------|------|----------|
| `assertions` | `Map<string, IRAssertion[]>` keyed by `interactionId` | IR Bridge `build()` — replaces inline `deriveStateAssertions` + `deriveAssertions` |
| `locators` | `Map<string, ResolvedLocator[]>` keyed by `interactionId` | IR Bridge `build()` — for assertion target backfill and step target resolution |

**Responsibilities:**
| # | Responsibility | How |
|---|---------------|-----|
| R1 | Resolve locators for every interaction's trigger element | Call existing `resolveLocatorsForIR(interaction.trigger)` |
| R2 | Derive state assertions (value, checked, selected) from interaction metadata | Call existing `deriveStateAssertions()` |
| R3 | Derive constraint assertions from knowledge fragment | Call existing `deriveAssertions()` from IR Bridge |
| R4 | Backfill resolved locators into every assertion's target | Copy `resolvedLocators` into `assertion.target.resolvedLocators` |
| R5 | Generate structural assertions (presence, visibility) | New: `AssertionProvider` pattern (see §4.3) |

**Non-responsibilities (explicitly out of scope):**
| # | Non-responsibility | Why |
|---|-------------------|-----|
| N1 | Semantic intent inference | Already done by evidence engine in `onEmit` via `annotateWithEvidence()` |
| N2 | Component type / business meaning enrichment | Already done by `enrichInteraction()` in `onEmit` |
| N3 | Configuration session transformation | Already done by `enrichConfigurationSession()` in `stopRecording()` |
| N4 | Cross-interaction analysis | Scope of future Sequence Enrichment Pass (E2) |
| N5 | IR-level optimization (POM extraction, step merging) | Scope of future IR Optimization Pass (E3) |
| N6 | AI-powered reasoning | Slots into existing positions: `fuseEvidence()` at E1's evidence stage, provider registration at E1's assertion stage |

### 3.3 Placement in the Pipeline

```
ComponentRuntime.onEmit(interaction)
  ├── enrichInteraction(interaction)           → componentType, businessMeaning
  ├── annotateWithEvidence(interaction)         → intent, confidence, evidenceTrail
  └── persistLiveInteractions()
        ↓
stopRecording()
  ├── runtime.flush()
  ├── enrichConfigurationSession(interactions)
  │
  ├── ★ enrichInteractions(interactions, events, fragment)   ← NEW: E1 pass
  │     ├── Phase 1: Resolve locators for every interaction's trigger
  │     ├── Phase 2: Derive assertions + backfill locators into assertion targets
  │     └── Phase 3: Generate structural assertions (presence, visibility)
  │
  └── return { interactions, enrichment }   ← E1 output passed alongside interactions
        ↓
IR Bridge: build(input, enrichment)
  ├── toBridgeInteraction(ci)
  │     ↓ READS ci.confidence (from evidence, not endState)
  │     ↓ Maps ci.intent → step metadata
  │     ↓ Maps ci.evidenceTrail → step metadata
  ├── Uses pre-derived assertions (from enrichment) instead of calling deriveStateAssertions
  └── Step assertions have locators → Playwright renders correctly
```

### 3.4 Why E1 is Outside the IR Bridge, Not Inside It

The evidence engine already runs in `onEmit` (per-interaction, synchronous,
before persistence). This is correct — it annotates the
`ComponentInteraction` before it's stored. The Interaction Enrichment Pass
doesn't replace this; it **extends** it with assertion derivation and
locator backfill that need cross-interaction context (the events array for
locator resolution, the fragment for constraint assertions).

Keeping the pass outside the IR Bridge means:

1. **The IR Bridge becomes a pure transform.** Its job is
   `ComponentInteraction[] → ExecutionIRPlan` — translation, not
   enrichment. It reads pre-enriched data but never derives semantic
   properties.
2. **The pass is testable in isolation.** Given interactions + events,
   assert the enriched output. No IR Plan construction needed.
3. **Future enrichment extends the pass, not the bridge.** Adding a new
   assertion provider, wiring AI intent reasoning, or extending
   structural assertions all happen in `interaction-enrichment.ts` — the
   IR Bridge code doesn't change.
4. **The pass can be skipped or partially applied.** Tests that only
   verify classification don't need it. Production always runs it.

### 3.5 Component Diagram

```
                    ComponentInteraction[] (from runtime)
                     already annotated with:
                       • componentType, businessMeaning (enrich.ts)
                       • intent, confidence, evidenceTrail (annotation-layer.ts)
                       • configurationSession (structural-enrichment.ts)
                           │
                           ▼
                 ┌─────────────────────────────────┐
                 │    Interaction Enrichment Pass   │  (E1 — NEW)
                 │                                  │
                 │  Phase 1: Resolve locators       │  ElementIdentity → ResolvedLocator[]
                 │           for every interaction  │
                 │                                  │
                 │  Phase 2: Derive assertions      │  Interaction metadata → IRAssertion[]
                 │           + backfill locators    │  assertion.target gets resolved locators
                 │           into assertion targets │  (FIXES F5)
                 │                                  │
                 │  Phase 3: Generate structural    │  Action type → presence/visibility
                 │           assertions             │  IRAssertion[] via providers
                 └──────────────┬──────────────────┘
                                │
                    EnrichmentOutput:
                      assertions: Map<interactionId, IRAssertion[]>
                      locators: Map<interactionId, ResolvedLocator[]>
                                │
                                ▼
                 ┌─────────────────────────────────┐
                 │          IR Bridge               │  (MODIFIED — reads E1 output)
                 │                                  │
                 │  Reads: confidence               │  (from ci.confidence, not endState)
                 │  Reads: assertions               │  (from enrichment, not re-derived)
                 │  Reads: locators                 │  (from enrichment, not re-resolved)
                 │  Reads: intent, evidenceTrail    │  (maps to optional IRStep fields)
                 └──────────────┬──────────────────┘
                                │
                                ▼
                 ┌─────────────────────────────────┐
                 │     Playwright Adapter           │  (UNCHANGED)
                 │                                  │
                 │  Renders assertions              │  ← locators now populated (F5 fixed)
                 │  with real locators              │
                 └─────────────────────────────────┘
```

### 3.6 Boundary Against Future Stages

The diagram below shows how E1 sits relative to E2 and E3. Each stage has
its own contract and its own insertion point. They are composed in
sequence but do not call each other.

```
  ComponentRuntime
       │
       ▼
  onEmit enrichment (per-interaction, synchronous)
    enrichInteraction() → componentType, businessMeaning
    annotateWithEvidence() → intent, confidence, evidenceTrail
       │
       ▼
  stopRecording()
    enrichConfigurationSession() → configurationSession metadata
       │
       ▼
  ┌──────────────────────────────────────────────────────┐
  │  E1: Interaction Enrichment Pass (THIS DOCUMENT)     │
  │  Contract: ComponentInteraction[] → EnrichmentOutput │
  │  Scope: Per-interaction (locators, assertions, conf) │
  └──────────────────────────────────────────────────────┘
       │
       ▼
  ┌──────────────────────────────────────────────────────┐
  │  E2: Sequence Enrichment Pass (FUTURE)               │
  │  Contract: interactions[] → interactions[] +         │
  │            cross-step metadata                       │
  │  Scope: Cross-interaction                            │
  │    • State dependencies (step 3 needs login from 1)  │
  │    • Semantic grouping (these 5 steps = "checkout")  │
  │    • Ordering constraints                            │
  │    • AI sequence reasoning                           │
  └──────────────────────────────────────────────────────┘
       │
       ▼
  IR Bridge: build()
    ComponentInteraction[] → ExecutionIRPlan
       │
       ▼
  ┌──────────────────────────────────────────────────────┐
  │  E3: IR Optimization Pass (FUTURE)                   │
  │  Contract: ExecutionIRPlan → ExecutionIRPlan         │
  │  Scope: Post-IR                                      │
  │    • POM extraction (deduplicate locators into page   │
  │      objects)                                        │
  │    • Step merging (consecutive fills → form fill)    │
  │    • Variable resolution (hardcoded → data-driven)   │
  │    • AI test optimization                             │
  └──────────────────────────────────────────────────────┘
       │
       ▼
  Playwright Adapter (renders ExecutionIRPlan)
```

**Key invariant:** the IR Bridge sits between E1/E2 (pre-IR) and E3
(post-IR). It is the transform boundary. Nothing in E1 or E2 produces or
consumes `ExecutionIRPlan`. Nothing in E3 produces or consumes
`ComponentInteraction[]`. The IR Bridge is the only code that crosses
that boundary.

---

## §4. Detailed Design

### 4.1 Module: `src/generation/interaction-enrichment.ts`

```typescript
/**
 * Interaction Enrichment Pass (E1)
 *
 * A single enrichment pass that runs after classification (evidence
 * annotation in onEmit) and before IR generation (IR Bridge build()).
 * It consolidates three concerns into one cohesive transform:
 *
 * 1. Locator resolution — every interaction's trigger element gets
 *    resolved locators, stored for assertion backfill.
 * 2. Assertion derivation + backfill — state and constraint assertions
 *    are derived and given real locators (fixes F5 crash).
 * 3. Structural assertion generation — action-type-specific assertions
 *    (presence, visibility) that verify the action had an effect.
 *
 * Design principle: the IR Bridge should be a pure transform that reads
 * pre-enriched data, not a layer that re-derives semantic properties.
 *
 * Boundary: this pass handles per-interaction enrichment only.
 * Cross-interaction enrichment (state dependencies, semantic grouping)
 * belongs in a future Sequence Enrichment Pass (E2). Post-IR
 * optimization (POM extraction, step merging) belongs in a future IR
 * Optimization Pass (E3).
 */

import type { ComponentInteraction } from '../shared/component-types';
import type { ObservedEvent } from '../shared/component-types';
import type { ResolvedLocator } from '../domain/locator-ranking';
import type { IRAssertion } from '../domain/execution-ir/types';
import type { ApplicationKnowledgeFragment } from '../domain/knowledge-fragment';

// ── Contract Types ────────────────────────────────────────────────────

export interface EnrichmentInput {
  /** Interactions from stopRecording(), already evidence-annotated. */
  interactions: ComponentInteraction[];
  /** Full event log — for locator resolution context. */
  events: ObservedEvent[];
  /** Optional knowledge fragment for constraint assertions. */
  fragment: ApplicationKnowledgeFragment | null;
}

export interface EnrichmentOutput {
  /** Pre-derived assertions per interaction, keyed by interactionId. */
  assertions: Map<string, IRAssertion[]>;
  /** Resolved locators per interaction, keyed by interactionId. */
  locators: Map<string, ResolvedLocator[]>;
}

// ── Public API ────────────────────────────────────────────────────────

export function enrichInteractions(input: EnrichmentInput): EnrichmentOutput {
  const assertions = new Map<string, IRAssertion[]>();
  const locators = new Map<string, ResolvedLocator[]>();

  for (const interaction of input.interactions) {
    // Phase 1: Resolve locators from the interaction's trigger element
    const resolvedLocators = resolveLocatorsForIR(interaction.trigger);
    locators.set(interaction.interactionId, resolvedLocators);

    // Phase 2: Derive state + constraint assertions, then backfill locators
    const bridgeInteraction = toBridgeInteraction(interaction);
    const stateAssertions = deriveStateAssertions(bridgeInteraction);
    const constraintAssertions = deriveAssertions(
      /* elementId */ interaction.trigger.elementId,
      input.fragment,
    );
    const structuralAssertions = deriveStructuralAssertions(
      bridgeInteraction,
      resolvedLocators,
    );
    const allAssertions = [
      ...constraintAssertions,
      ...stateAssertions,
      ...structuralAssertions,
    ];

    // R4: Backfill resolved locators into every assertion target
    for (const assertion of allAssertions) {
      if (assertion.target.kind === 'element') {
        assertion.target = {
          ...assertion.target,
          resolvedLocators: resolvedLocators,
          elementId: interaction.trigger.elementId,
          elementName: interaction.trigger.accessibleName
            || interaction.trigger.ariaLabel
            || interaction.trigger.tag,
        };
      }
    }

    if (allAssertions.length > 0) {
      assertions.set(interaction.interactionId, allAssertions);
    }
  }

  return { assertions, locators };
}
```

**Note on imports:** `resolveLocatorsForIR`, `toBridgeInteraction`, and
`deriveAssertions` currently live inside `ir-bridge.ts` as private
functions. As part of this implementation, `resolveLocatorsForIR` and
`deriveAssertions` are **extracted** to shared modules (or exported from
the IR Bridge module) so both the enrichment pass and the IR Bridge can
call them. This eliminates code duplication, not introduces it.

### 4.2 IR Bridge Changes

The IR Bridge `build()` function needs three modifications:

**Change 1: Accept enrichment output as a parameter**

```typescript
// build() signature changes:
export function build(
  input: IRBridgeInput,
  enrichment?: EnrichmentOutput,  // NEW — from Interaction Enrichment Pass
): ExecutionIRPlan
```

When `enrichment` is provided, the bridge uses pre-derived assertions and
locators instead of calling `deriveStateAssertions` and
`resolveLocatorsForIR` inline. When omitted (legacy callers, unit tests),
the bridge falls back to its current behavior.

**Change 2: Read confidence from `ComponentInteraction`, not `endState`**

```typescript
// BEFORE (ir-bridge.ts:311)
confidence: ci.endState === 'completed' ? 1.0 : 0.5,

// AFTER
confidence: ci.confidence ?? (ci.endState === 'completed' ? 1.0 : 0.5),
```

This preserves the fallback for interactions that somehow bypass evidence
annotation, but uses the evidence-calibrated confidence when available.

**Change 3: Use pre-derived assertions when enrichment is provided**

```typescript
// BEFORE (ir-bridge.ts:1281-1287)
const constraintAssertions = deriveAssertions(elementId, fragment);
const stateAssertions = deriveStateAssertions(interaction);
const assertions = [...constraintAssertions, ...stateAssertions];

// AFTER
const assertions = enrichment?.assertions.get(interaction.interactionId)
  ?? [...deriveAssertions(elementId, fragment), ...deriveStateAssertions(interaction)];
```

**Change 4: Map semantic intent to step metadata (additive)**

Add optional `intent` and `evidenceTrail` fields to `IRStep`:

```typescript
// In IRStep interface (types.ts)
// After existing optional fields...
readonly intent?: SemanticIntent;
readonly evidenceTrail?: IntentVote[];
```

In the step construction:
```typescript
steps.push({
  // ...existing fields...
  ...(interaction.intent ? { intent: interaction.intent } : {}),
  ...(interaction.evidenceTrail?.length
    ? { evidenceTrail: interaction.evidenceTrail }
    : {}),
});
```

### 4.3 Structural Assertion Providers

Beyond fixing F5 (locator backfill), the enrichment pass introduces
**structural assertions** that verify the result of an action, not just
the state of the target element:

| Interaction Type | Current Assertions | Structural Assertions Added |
|-----------------|--------------------|-----------------------------|
| Click (on button) | None | PRESENCE assertion on the button (verifies it's still attached) |
| Tab | None | VISIBILITY assertion on the activated panel |
| ModalDialog | None | VISIBILITY assertion on the modal container |
| Dropdown (after select) | EQUALS on value | + VISIBILITY assertion that dropdown panel is hidden (closed) |
| Hover | None | None (hover is transient — no persistent state to assert) |
| Navigation | URL_MATCH | None (URL assertion already verifies the effect) |

These are **SOFT severity** by default — they verify the action had a
visible effect without failing the test on minor discrepancies.

**Provider pattern for extensibility:**

```typescript
/**
 * An assertion provider derives structural assertions for specific
 * interaction types. Providers are registered in the enrichment pass
 * and called for each matching interaction.
 *
 * This is the extension point for domain-specific assertions. A custom
 * provider can be registered to generate assertions like "after login,
 * user menu is visible" without modifying the core enrichment code.
 */
interface AssertionProvider {
  /** Unique identifier for the provider. */
  id: string;
  /** Which interaction types this provider derives assertions for. */
  derivesFor: BridgeInteractionType[];
  /** Derive assertions for a single interaction. */
  derive(interaction: BridgeInteraction, locators: ResolvedLocator[]): IRAssertion[];
}
```

Built-in providers:
- `StateValueProvider` — current behavior (text value, checked, selected, etc.)
- `ElementPresenceProvider` — new: element still attached after action
- `SurfaceStateProvider` — new: modal/dropdown visibility after compound interaction

Custom providers can be registered for domain-specific assertions.

### 4.4 Confidence Calibration

The evidence engine currently produces:
- **1.0** for all lifecycle types (deterministic match)
- **0.0–1.0** for Click (evidence fusion score)
- **0.0** for Click with no evidence (fallback)

The IR Bridge should use confidence to influence **execution strategy**:

| Confidence | waitStrategy | Retry | Notes |
|-----------|-------------|-------|-------|
| ≥ 0.8 | `immediate` | 0 | High-confidence lifecycle match |
| 0.5–0.8 | `visible` | 1 | Medium-confidence evidence match |
| < 0.5 | `visible` | 2 | Low-confidence — needs verification |

This replaces the current code at ir-bridge.ts:1292:
```typescript
// BEFORE
waitStrategy: interaction.confidence < 0.7 ? ('visible' as const) : DEFAULT_EXECUTION_PARAMETERS.waitStrategy,

// AFTER (confidence now comes from evidence, not endState)
const conf = interaction.confidence ?? 0.5;
const waitStrategy = conf >= 0.8 ? 'none' : 'visible';
const retryCount = conf >= 0.8 ? 0 : conf >= 0.5 ? 1 : 2;
```

### 4.5 Extensibility: New Assertion Types

The current assertion type system (`ValidationType` enum) covers basic
state checks. The provider pattern (§4.3) allows new assertion derivations
without modifying the enum. When a genuinely new assertion *kind* is
needed (e.g., network response assertion, visual regression), the
`ValidationType` enum is extended — but the enrichment pass code doesn't
change, only the registered providers.

---

## §5. What Stays Unchanged

| Component | Change | Reason |
|-----------|--------|--------|
| Evidence engine (`annotation-layer.ts`) | **No change** | Already correctly placed in `onEmit`. Sets `intent`, `confidence`, `evidenceTrail` on `ComponentInteraction`. |
| Evidence generators (`generators.ts`) | **No change** | 6 generators produce correct IntentVotes. They just need their output to be consumed. |
| Evidence classifier (`evidence-classifier.ts`) | **No change** | Pipeline is sound: FeatureView → generators → fusion → type derivation. |
| Enrichment layer (`enrich.ts`) | **No change** | Layer 2/3 enrichment (componentType, businessMeaning) stays in `onEmit`. |
| Structural enrichment (`structural-enrichment.ts`) | **No change** | ConfigurationSession transform stays in `stopRecording()`. |
| Playwright adapter (`assertion-renderer.ts`) | **No change** | Once assertions have locators, rendering works correctly. |
| Locator ranking pipeline (`locator-ranking.ts`) | **No change** | `extractCandidatesFromIdentity()` → `rankLocatorCandidates()` produces correct locators. The F5 bug is that assertions never receive them. |
| `ExecutionIRPlan` type | **No change** | The plan structure is unchanged. New optional fields on `IRStep` are additive. |

---

## §6. Migration Strategy

The migration follows five steps. Each step leaves the codebase compiling
and tests passing. No step is merged until the previous is verified.

### Step 1: Fix F5 (locator backfill) — Immediate, no architecture change

Add locator backfill in the IR Bridge between assertion derivation and
step creation. This is a 5-line fix inside `build()`:

```typescript
// After deriving assertions, backfill locators from the step target
if (target.kind === 'element') {
  for (const assertion of assertions) {
    if (assertion.target.kind === 'element') {
      assertion.target = {
        ...assertion.target,
        resolvedLocators: target.resolvedLocators,
        elementId: target.elementId,
        elementName: target.elementName,
      };
    }
  }
}
```

This immediately fixes the Playwright rendering crash without any
architectural change.

**Verification:** F5 test passes. Golden master: 130/130. Full suite: no
new failures.

### Step 2: Wire confidence — Small change in `toBridgeInteraction`

Change ir-bridge.ts:311 from `endState ? 1.0 : 0.5` to
`ci.confidence ?? fallback`.

**Verification:** Evidence confidence now reaches IR steps. Golden master
snapshots may need updating (confidence values change from 1.0 to
evidence-calibrated values). Document and justify each snapshot change.

### Step 3: Extract the Interaction Enrichment Pass

Create `src/generation/interaction-enrichment.ts`. Move assertion
derivation + locator resolution calls out of `build()` and into the
enrichment pass. Wire it between `stopRecording()` and `build()` in the
service worker.

Extract `resolveLocatorsForIR` and `deriveAssertions` to be callable from
both the enrichment pass and the IR Bridge (shared module or exported
function).

**Verification:** `tsc --noEmit` clean. Golden master: 130/130. Full
suite: no new failures.

### Step 4: Add structural assertion providers

Implement `ElementPresenceProvider` and `SurfaceStateProvider`. Register
them in the enrichment pass. Add tests for each provider.

**Verification:** New assertion types appear in IR output for qualifying
interactions. Golden master snapshots updated with justification.

### Step 5: Map semantic intent to IR steps — Schema extension

Add optional `intent` and `evidenceTrail` fields to `IRStep`. Map them in
the IR Bridge's step construction.

**Verification:** IR steps now carry semantic intent and evidence trail.
Downstream consumers (Playwright renderer, domain adapter) ignore unknown
optional fields.

---

## §7. Acceptance Criteria

- [ ] F5 fixed: Playwright rendering succeeds for all interactions with state assertions
- [ ] Evidence confidence flows to IR Bridge (not overridden by endState)
- [ ] Evidence intent and evidenceTrail available on IR steps
- [ ] State assertions carry resolved locators (not empty arrays)
- [ ] Structural assertions: Click produces element presence assertion
- [ ] Structural assertions: Tab produces panel visibility assertion
- [ ] Structural assertions: Dropdown produces panel-closed assertion
- [ ] Golden master: 130/130 pass (or snapshots updated with justification)
- [ ] Full test suite: 2959+/2960 pass (no new failures)
- [ ] Validation harness: all 48 tests pass, Playwright output non-null for multi-step flows
- [ ] 0 src TypeScript errors
- [ ] IR Bridge `build()` no longer calls `deriveStateAssertions` or `resolveLocatorsForIR` when enrichment output is provided
- [ ] `interaction-enrichment.ts` is a pure function (no side effects, testable in isolation)

---

## §8. Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Confidence propagation changes existing behavior | Medium | Medium | Fallback preserves `endState ? 1.0 : 0.5` when `ci.confidence` is undefined |
| Assertion locator backfill changes assertion rendering | Low | Low | Golden master catches any Playwright output changes |
| Enrichment pass adds latency | Very Low | Negligible | Pure function, synchronous, runs once per recording stop. O(n) in interaction count. |
| Extended assertions (presence, visibility) increase test flakiness | Medium | Medium | Use SOFT severity by default; HARD only for value assertions |
| New IRStep fields break downstream consumers | Low | Low | Fields are optional; existing consumers ignore unknown fields |
| `resolveLocatorsForIR` extraction introduces import cycles | Low | Medium | Place in `src/domain/locator-ranking.ts` (already the canonical location for ranking logic) |

---

## §9. Long-Term Architecture: Is This the Only Enrichment Stage?

**No.** The Interaction Enrichment Pass (E1) is the first of three
enrichment stages, but it is the only one needed *now*. The other two
stages have clearly defined contracts and insertion points but are
deferred until real-world validation demonstrates their need.

### 9.1 Why Three Stages, Not One

Each stage operates on a different data shape with a different scope:

| Stage | Data Shape | Scope | Example |
|-------|-----------|-------|---------|
| E1 | `ComponentInteraction[]` | Per-interaction | "This click has confidence 0.8 and should assert the button is present" |
| E2 | `ComponentInteraction[]` (full list) | Cross-interaction | "Steps 3-7 form a login flow; step 8 depends on step 3's session" |
| E3 | `ExecutionIRPlan` | Post-IR | "Steps 2, 5, 9 all target the same button — extract to a POM locator" |

Collapsing these into one stage would require the single function to
understand interactions, cross-interaction relationships, AND the IR Plan
structure — a god function with three reasons to change.

### 9.2 E1 is Stable

The Interaction Enrichment Pass contract
(`ComponentInteraction[] → EnrichmentOutput`) is stable because:

1. **Its inputs don't change.** `ComponentInteraction` is the output of
   the Component Runtime — the most stable type in the system. Adding
   fields to it (e.g., new metadata) doesn't break the enrichment pass.
2. **Its outputs are consumed by one caller.** Only the IR Bridge reads
   `EnrichmentOutput`. If the bridge changes, the enrichment output
   changes — but that's a single integration point.
3. **Its responsibilities are finite.** Locator resolution, assertion
   derivation, confidence propagation — these are the three things that
   must happen between classification and IR generation. New assertion
   *types* extend via the provider pattern without changing the pass
   itself.
4. **It has an escape hatch.** The `AssertionProvider` interface lets
   domain-specific enrichment plug in without modifying core code. Future
   AI reasoning can register a provider that calls an LLM to generate
   assertions.

### 9.3 When E2 and E3 Will Be Needed

| Stage | Trigger | What It Will Do |
|-------|---------|----------------|
| E2 (Sequence) | Validation shows multi-step workflows produce incoherent test narratives | Group interactions into semantic phases, infer state dependencies, generate workflow-level metadata |
| E3 (IR Optimization) | Generated tests are verbose or fragile on real apps | Extract POM locators, merge redundant steps, resolve hardcoded values to data variables |

Neither E2 nor E3 changes E1's contract. They insert between E1 and the
IR Bridge (E2) or after the IR Bridge (E3). The IR Bridge remains the
single transform boundary.

### 9.4 Where AI Reasoning Slots In

AI-powered enrichment does not create a new stage. It slots into existing
positions:

| AI Concern | Insertion Point | Mechanism |
|-----------|----------------|-----------|
| Intent inference (per-interaction) | E1, evidence stage | Replace `fuseEvidence()` body with LLM call; same interface, different implementation |
| Assertion generation (per-interaction) | E1, assertion stage | Register an AI-backed `AssertionProvider` |
| Sequence reasoning (cross-interaction) | E2 (future) | Replace sequence analysis body with LLM call |
| Test optimization (post-IR) | E3 (future) | Replace optimization rules with LML call |

The `fuseEvidence()` function in `intent-inference.ts` is the designated
swap point for per-interaction AI. It currently runs a weighted fusion of
evidence generator outputs. In the future, it can delegate to an LLM that
reads the same `FeatureView` input and returns an `IntentVote`. No
pipeline changes needed — same function signature, different
implementation.

---

## §10. Summary

The Interaction Enrichment Pass is a **single pure function** that
consolidates three currently-scattered concerns (locator resolution,
assertion derivation, confidence propagation) into one cohesive transform
with a clear contract:

```
enrichInteractions(interactions, events, fragment) → { assertions, locators }
```

It runs between `stopRecording()` and `build()`. The IR Bridge reads its
output instead of re-deriving semantic properties inline.

This is a **stable architectural boundary**, not an intermediate layer.
Future enrichment extends via:
- New `AssertionProvider` implementations (no core code change)
- AI at `fuseEvidence()` (same interface, LLM implementation)
- E2 (Sequence Enrichment Pass) and E3 (IR Optimization Pass) as
  separate stages with their own contracts

The pass does not need to be split, bypassed, or refactored later — its
scope (per-interaction, pre-IR) is structurally distinct from
cross-interaction and post-IR enrichment.
