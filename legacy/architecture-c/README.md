# Architecture C — Archived

> **These files are not compiled, executed, or imported by the active runtime.**
> They are preserved as reference for the design decisions that shaped the
> current architecture. See `docs/handover/11-architectural-decision-log.md`
> (ADR-007 through ADR-014) for the context behind Architecture C.

## What Was Architecture C?

Architecture C was a capture-first, classify-second pipeline designed to
replace the deterministic recorder's merged capture+classify approach.
It introduced:

- **Universal Interaction Observer** — a single content script capturing
  all events in the capture phase with rich DOM snapshots
- **Snapshot Coalescer** — grouping raw events into temporal windows
- **State Tracker** — maintaining a real-time inventory of page state
  (surfaces, mutations, ARIA state)
- **Interaction Assembler** — collapsing composite interactions
  (dropdown open → select → close) into transactions
- **Architecture C Pipeline** — orchestrating the above into a unified
  session event stream

## Why Was It Archived?

The deterministic recorder evolved to cover most of Architecture C's
capabilities through its own capture layer + the V1/V2 evidence engine
post-hoc classification. Architecture C was never activated in production.

See the architectural review in the project documentation for the full
rationale.

## What Replaced It?

The active pipeline:

```
Deterministic Recorder → V1/V2 Classifier → Domain Adapter
  → Recognition Orchestrator → Enrichment Orchestrator → Generation Engine
```

## File Inventory

| Original Location | Archived To |
|-------------------|-------------|
| `src/recorder/pipeline/architecture-c-pipeline.ts` | `pipeline/architecture-c-pipeline.ts` |
| `src/recorder/pipeline/interaction-assembler.ts` | `pipeline/interaction-assembler.ts` |
| `src/recorder/coalescer/snapshot-coalescer.ts` | `coalescer/snapshot-coalescer.ts` |
| `src/recorder/observer/universal-observer-init.ts` | `observer/universal-observer-init.ts` |
| `src/recorder/observer/universal-interaction-observer.ts` | `observer/universal-interaction-observer.ts` |
| `src/recorder/observer/observer-helpers.ts` | `observer/observer-helpers.ts` |
| `src/recorder/context/state-tracker-init.ts` | `context/state-tracker-init.ts` |
| `src/recorder/context/state-tracker.ts` | `context/state-tracker.ts` |
| `src/ai/ai-understanding.ts` | `ai/ai-understanding.ts` |

Tests are in `tests/`.
