# Workflow Normalizer — Implementation Spec

## Overview

A pure, stateless post-projection layer that removes Unclassified interactions
whose semantic content is fully subsumed by a recognized interaction on the
same element within a temporal gesture window.

The first application: eliminating `Unclassified(mousedown)` noise that appears
alongside every recognized Click/Link/Checkbox interaction.

## Architecture

```
EventTap → EvidenceLedger → ComponentRuntime → liveInteractions
                                                        ↓
                                           stopRecording()
                                                        ↓
                                           normalizeWorkflow()       ← NEW
                                                        ↓
                                           filterProductionInteractions()
                                                        ↓
                                           Consumers (IR, Capability, UI)
```

The normalizer sits between `stopRecording()` (raw evidence) and
`filterProductionInteractions()` (production filtering). It is a view filter —
subsumed interactions remain in `liveInteractions` and the Evidence Ledger.

M4 Verification Mode runs BEFORE normalization — it compares raw
`liveInteractions` vs projected output.

## Contract

> Each interaction in the output represents exactly one distinct user intention.
> Interactions whose semantic content is fully subsumed by another interaction
> on the same element within the same gesture window are removed.

## Subsumption conditions (ALL must hold)

1. **Candidate is Unclassified** — only Unclassified interactions are
   candidates. Recognized interactions are never removed.
2. **Temporal precedence** — `0 ≤ (recognized.startTime - unclassified.startTime)
   ≤ GESTURE_WINDOW_MS` (500ms).
3. **Target affinity** — both interactions have the same `elementKey()`.
4. **Subsumer is recognized** — subsuming interaction has
   `type !== 'Unclassified'`.

## Files

- `src/presentation/workflow-normalizer.ts` — the normalizer function
- `tests/presentation/workflow-normalizer.test.ts` — unit tests
- `src/background/service-worker.ts` — wire-in (1 import + 1 line)

## Milestones

### M1: Pure function + tests (no wiring)
- Create `workflow-normalizer.ts` with `normalizeWorkflow()`
- Create test file with ~20 tests
- No changes to existing files
- Validation: tests pass, build succeeds

### M2: Wire into handleStopRecording
- Add import and one call in service-worker.ts
- Add integration test
- Validation: full test suite passes, build succeeds, M4 verification
  still computed from raw output

### M3: Manual validation
- Amazon.in, OrangeHRM, drag test
- Verify no paired Unclassified(mousedown) noise
- Verify raw evidence preserved in storage
