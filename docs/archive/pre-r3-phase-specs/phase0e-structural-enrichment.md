# Phase 0e: Structural Semantic Enrichment — Task Spec

## Overview

Implements the Structural Semantic Enrichment layer — a pure transform
that converts action sequences (subActions[]) into state-based field
representations (ConfigurationSession). This sits between the Observation
Layer (Component Runtime) and the IR Bridge.

## Design Document

`docs/architecture/STRUCTURAL_SEMANTIC_ENRICHMENT_DESIGN.md` (1,045 lines)

## Files Changed

### New Files
- `src/enrichment/structural-enrichment.ts` — Core enrichment module
- `tests/enrichment/structural-enrichment.test.ts` — 28 unit tests
- `tests/enrichment/structural-enrichment-integration.test.ts` — 10 integration tests

### Modified Files
- `src/runtime/sw-integration.ts` — Wired enrichment into stopRecording pipeline
- `src/sidepanel/timeline-renderer.ts` — Configuration session display
- `src/generation/ir-bridge.ts` — Field-based IR step expansion + buildFieldStep()
- `docs/architecture/UNIFIED_MASTER_ROADMAP.md` — Phase 0e added

## Acceptance Criteria

- [x] enrichConfigurationSession() is a pure function (no I/O, no DOM, no side effects)
- [x] Discrimination rule: enrich only when hasConfirmAction OR multipleFieldChanges
- [x] ConfigurationField has: label, kind, finalValue, delta, subActionCount, evidence
- [x] StructuralPattern recognizes: singleSelect, multiFieldConfig, filterApply, searchSubmit, toggleBatch, uncommitted
- [x] Counter fields produce FILL IR actions with final value (idempotent)
- [x] Select fields produce CLICK IR actions
- [x] Toggle fields produce TOGGLE IR actions with boolean input
- [x] Text fields produce FILL IR actions
- [x] Commit action produces CLICK IR action as final step
- [x] Each field step has unique elementId + locator (not merged by readability rules)
- [x] Timeline renders field-based summary ("Configure Economy: Adults=2, Children=1, Class=Premium Economy")
- [x] Existing single-select dropdowns unaffected (no enrichment for simple selects)
- [x] Idempotency: running enrichment twice produces identical results
- [x] Unit tests: 28/28 pass
- [x] Integration tests: 10/10 pass
- [x] Full suite: 4272/4274 (2 pre-existing JSDOM timing flakes)
- [x] Build succeeds: v10.9.0, 148.8 KB

## Invariants

- I1: Pure transform — no mutation of input
- I2: Additive — only adds metadata.configurationSession
- I3: Structural — recognizes patterns, never assigns business meaning
- I4: Idempotent — enrichment of enriched interaction is a no-op
- I5: Graceful degradation — returns input unchanged if no subActions

## Test Coverage

### Unit Tests (28)
- shouldEnrich: 6 tests (confirm action, multiple fields, single-select rejection, empty, missing, idempotency)
- enrichConfigurationSession: 16 tests (multi-field config, counter delta, filter pattern, toggle batch, single select, uncommitted, idempotency, graceful degradation, field normalization)
- renderConfigurationSummary: 4 tests (multi-field, uncommitted suffix, toggle on/off, counter delta)

### Integration Tests (10)
- Multi-field config: 5 tests (step count, FILL for counter, CLICK for select, CLICK for commit, step ordering)
- Toggle field: 2 tests (checked→true, unchecked→false)
- Text input: 1 test (FILL for text)
- Counter final value: 1 test (uses last value, not intermediate)
- Regression: 1 test (non-enriched interaction still works)
