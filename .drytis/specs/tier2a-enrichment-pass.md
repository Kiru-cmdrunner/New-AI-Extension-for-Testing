# Task Spec: Interaction Enrichment Pass (Tier 2A)

**Design:** `.drytis/TIER2A_DESIGN.md`
**Baseline:** Commit `c158e59` (Phase 2 + Phase 3 type unification + Tier 1 validation fixes)

## Goal

Implement the Interaction Enrichment Pass (E1) — a single enrichment function that consolidates locator resolution, assertion derivation with backfill, confidence propagation, and structural assertion generation into one cohesive pass between `stopRecording()` and `IR Bridge build()`.

## Migration Steps (each independently verifiable)

### Step 1: Fix F5 — Locator backfill in IR Bridge build()
**Files:** `src/generation/ir-bridge.ts` (5-line addition between assertion derivation and step creation)
**Acceptance:**
- [ ] Backfill resolved locators into every assertion.target where kind='element'
- [ ] F5 validation test passes (interactions with assertions produce non-null Playwright output)
- [ ] Golden master: 130/130 pass
- [ ] Full test suite: no new failures
- [ ] `tsc --noEmit`: 0 src errors

### Step 2: Wire confidence — Read ci.confidence in toBridgeInteraction
**Files:** `src/generation/ir-bridge.ts` (1-line change at line 311)
**Acceptance:**
- [ ] `confidence: ci.confidence ?? (ci.endState === 'completed' ? 1.0 : 0.5)`
- [ ] Evidence-calibrated confidence reaches IR steps
- [ ] Golden master: snapshots updated with justification or 130/130 pass
- [ ] Full test suite: no new failures
- [ ] `tsc --noEmit`: 0 src errors

### Step 3: Extract Interaction Enrichment Pass module
**Files:** `src/generation/interaction-enrichment.ts` (NEW), `src/generation/ir-bridge.ts` (modified), `src/runtime/sw-integration.ts` (modified)
**Acceptance:**
- [ ] `enrichInteractions(input: EnrichmentInput): EnrichmentOutput` exists as pure function
- [ ] IR Bridge `build()` accepts optional `EnrichmentOutput` parameter
- [ ] When enrichment provided, bridge uses pre-derived assertions instead of calling `deriveStateAssertions`
- [ ] When enrichment omitted (backward compat), bridge falls back to current behavior
- [ ] Unit tests for `interaction-enrichment.ts` pass
- [ ] Golden master: 130/130 pass
- [ ] Full test suite: no new failures
- [ ] `tsc --noEmit`: 0 src errors

### Step 4: Structural assertion providers
**Files:** `src/generation/assertion-providers.ts` (NEW), `src/generation/interaction-enrichment.ts` (modified)
**Acceptance:**
- [ ] `ElementPresenceProvider` generates PRESENCE assertion for Click
- [ ] `SurfaceStateProvider` generates VISIBILITY assertion for Tab (panel visible) and Dropdown (panel closed)
- [ ] New assertions are SOFT severity
- [ ] Provider pattern extensible
- [ ] Golden master: snapshots updated with justification or pass
- [ ] Full test suite: no new failures
- [ ] `tsc --noEmit`: 0 src errors

### Step 5: Map semantic intent to IR steps
**Files:** `src/domain/execution-ir/types.ts` (additive), `src/generation/ir-bridge.ts` (modified)
**Acceptance:**
- [ ] `IRStep` has optional `intent?: SemanticIntent` and `evidenceTrail?: IntentVote[]`
- [ ] IR Bridge maps these from interaction to step
- [ ] Downstream consumers ignore unknown optional fields
- [ ] Golden master: snapshots updated or pass
- [ ] Full test suite: no new failures
- [ ] `tsc --noEmit`: 0 src errors

## Regression Gates (after all 5 steps)
- [ ] Validation harness: all tests pass, F5 resolved
- [ ] Golden master: 130/130 pass (or all snapshot changes documented)
- [ ] Full test suite: no new failures vs baseline
- [ ] `tsc --noEmit`: 0 src errors
- [ ] IR Bridge `build()` no longer calls `deriveStateAssertions` when enrichment is provided
- [ ] `interaction-enrichment.ts` is a pure function
