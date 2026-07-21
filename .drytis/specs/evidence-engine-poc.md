# Evidence Engine POC — Custom Dropdown Detection

## Overview

Build a proof-of-concept evidence-based interaction detection system that runs **in parallel** with the existing `detectInteractions()` classifier. The POC does NOT replace the current system — it produces its own `DetectedInteraction[]` output that can be A/B compared against the existing classifier's output.

## Architecture

```
RecordedEvent[] (existing raw events)
         │
         ├──────────────────────┐
         ▼                      ▼
   Existing Classifier     Evidence Engine (NEW)
   (detectInteractions)    (detectInteractionsV2)
         │                      │
         ▼                      ▼
   DetectedInteraction[]   DetectedInteraction[]
         │                      │
         └────── A/B ───────────┘
              comparison tests
```

## New Files

All new files under `src/classifier/evidence/`:

1. `types.ts` — Evidence, EvidenceProvider, InteractionHypothesis, DomContext interfaces
2. `providers/dom-provider.ts` — DOM structure evidence (tag name, input.type)
3. `providers/aria-provider.ts` — ARIA roles and state attributes
4. `providers/event-sequence-provider.ts` — Event pattern matching
5. `providers/mutation-provider.ts` — DOM mutation tracking (synthetic — inferred from events since we don't have real MutationObserver in the event stream)
6. `combination.ts` — Weighted voting + confidence scoring
7. `engine.ts` — InteractionEngine: buffers events, collects evidence, commits interactions
8. `detector.ts` — `detectInteractionsV2()` entry point (parallel to existing `detectInteractions()`)

## Evidence Model

```typescript
interface Evidence {
  provider: string;           // provider name
  suggestedType: InteractionType | null;
  confidence: number;         // 0.0–1.0
  weight: number;             // 0.0–1.0
  metadata?: Partial<InteractionMetadata>;
  reason: string;             // human-readable
}

interface EvidenceProvider {
  name: string;
  onEvent(event: RecordedEvent, buffer: InteractionBuffer): Evidence[];
  onCommit?(buffer: InteractionBuffer): Evidence[];  // final evidence at commit time
}
```

## Commit Signals (generic, not type-specific)

1. **Element switch** — next event targets a different element key
2. **Navigation** — navigation event in the stream
3. **Standalone events** — dblclick, contextmenu, scroll, mouseenter, dragstart, drop → flushed immediately
4. **End of stream** — all pending buffers flushed

## Interaction Buffer

```typescript
interface InteractionBuffer {
  elementKey: string;
  events: RecordedEvent[];
  evidence: Evidence[];
  startTime: number;
  lastEventTime: number;
}
```

## Acceptance Criteria

- [ ] `detectInteractionsV2()` accepts `RecordedEvent[]` and returns `DetectedInteraction[]`
- [ ] All 4 providers implemented and produce evidence
- [ ] Combination function uses weighted voting with commit threshold
- [ ] Custom dropdown (click trigger → options appear → option click → value change) classified as `CustomDropdown` with confidence > 0.5
- [ ] Native `<select>` classified as `NativeDropdown` with confidence > 0.7
- [ ] Simple click on a button classified as `Click` with confidence > 0.7
- [ ] Checkbox click classified as `Checkbox` with confidence > 0.7
- [ ] Text entry (focus → blur with value change) classified as `TextEntry` with confidence > 0.7
- [ ] Every emitted interaction includes a full evidence trail
- [ ] Unit tests for each provider (minimum: 3 test cases each)
- [ ] Unit tests for combination function (minimum: 5 test cases)
- [ ] Integration test: full custom dropdown event sequence
- [ ] A/B comparison test: evidence engine vs existing classifier on identical event sequences
- [ ] All existing tests still pass (no regressions)
- [ ] TypeScript compiles with zero errors under strict mode

## Scope — NOT in this POC

- No changes to the content script (deterministic-recorder.ts)
- No changes to the service worker or storage
- No changes to the side panel or timeline renderer
- No replacement of detectInteractions() — the old classifier runs untouched
- No MutationObserver in the content script (mutation evidence is synthetic/inferred)
- No timing-based logic (no debounce, no dwell timers, no grouping windows)
