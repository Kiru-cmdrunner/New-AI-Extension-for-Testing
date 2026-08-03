# Phase 4 — Component Registry & Recognition Orchestrator

> **Status:** Implementation complete. All acceptance criteria verified.

## Objective

Validate that recognition orchestration — identity resolution, evidence accumulation,
lifecycle progression, and tentative rejection — fits naturally on top of the three
foundational entities without requiring entity changes.

## Design Decisions

### 1. Recognition vs. Enrichment

Structural recognition establishes component identity (authoritative). Behavioral
processing enriches the component with observed behavior. Both run for every
interaction — they serve different purposes.

### 2. Generic Evidence Accumulation

The registry does NOT track matchCount/mismatchCount. Instead it tracks a generic
list of supporting and contradicting evidence entries. The rejection algorithm is
one consumer of this evidence; future recognition sources (AI, vision, heuristics)
can contribute evidence through the same mechanism.

### 3. Tentative Rejection via Accumulated Contradiction

A tentative component accumulates supporting and contradicting evidence. When
contradiction net (contradicting - supporting) exceeds a threshold, the component
is rejected. The rejection algorithm is swappable without changing the registry.

## Components

### ComponentRegistry

Session-scoped store managing ComponentGrouping lifecycle.

```
ComponentRegistry
├── components: Map<groupingId, ComponentGrouping>
├── elementIndex: Map<elementId, groupingId>
├── evidenceLedger: Map<groupingId, EvidenceEntry[]>
│
├── register(result, source) → ComponentGrouping
│   Identity resolution → create new or merge existing
├── addEvidence(groupingId, evidence) → void
├── addTransition(groupingId, transition) → void
├── checkLifecycle(groupingId) → ComponentGrouping (maybe promoted)
├── getComponent(id) / getByElement(elementId) / getAll()
└── rejectComponent(groupingId) → void
```

### EvidenceEntry

```
EvidenceEntry
├── source: RecognitionSource    (structural, behavioral, ai-assisted)
├── disposition: 'supporting' | 'contradicting' | 'neutral'
├── description: string
├── timestamp: number
```

### Identity Resolution

1. EXACT ROOT MATCH: rootElementId matches → same component
2. ROOT-IN-CONSTITUENTS: root is a constituent of existing → same
3. CONSTITUENT OVERLAP: Jaccard ≥ 0.34 → same
4. NO OVERLAP → different component

### Merge Rules

- patternType: structural wins (if tiers disagree)
- rootElementId: structural root preferred
- constituents: union, structural roles win on conflict
- recognitionSource: upgrade only (structural > behavioral > ai-assisted)
- recognitionConfidence: structural (0.95) is authoritative
- lifecycleState: accumulates regardless of source

### Lifecycle Progression

When ALL operations in pattern's expectedLifecycle set have been observed
on the component's transitions → promote to CONFIRMED.

### Rejection Algorithm

```
netContradiction = contradicting - supporting
if netContradiction >= CONTRADICTION_THRESHOLD (3):
  rejectComponent()
```

### RecognitionOrchestrator

```
processInteraction(input):
  1. Structural recognition attempt
  2. Behavioral recognition attempt (on accumulated transitions)
  3. Identity resolution + merge
  4. Add evidence + transition
  5. Check lifecycle progression
  6. Check rejection
```

## Files

- `src/recorder/recognition/component-registry.ts` — registry + evidence model
- `src/recorder/recognition/orchestrator.ts` — per-interaction flow
- `src/recorder/recognition/pattern-catalogue.ts` — add expectedLifecycle to MODAL, TABS
- `tests/recognition/component-registry.test.ts`
- `tests/recognition/orchestrator.test.ts`

## Acceptance Criteria

- [x] Zero pattern-specific logic in orchestrator
- [x] Identity resolution correctly merges multi-tier observations of same component
- [x] Structural classification is authoritative (never overridden by behavioral)
- [x] Behavioral enrichment runs for structurally-recognized components
- [x] Lifecycle promotion driven by expectedLifecycle from pattern definitions
- [x] Tentative rejection via accumulated evidence, not immediate contradiction
- [x] Generic evidence ledger (not coupled to match/mismatch algorithm)
- [x] No changes to the three foundational entities
- [x] All existing tests pass
