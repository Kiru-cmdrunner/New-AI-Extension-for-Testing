# Architecture Evolution Blueprint

## Context

The current workspace is the `integration` branch codebase — a working, production-grade recorder (v10.4.18) with 17,000+ lines of TypeScript and 3,056 passing tests. It captures real-world user interactions reliably.

This document defines the **target architecture** we're evolving toward and the **principles** that guide every change. The `upstream/integration` branch remains untouched as a permanent reference.

---

## Target Architecture: Semantic Evidence Pipeline

The target architecture replaces the current ad-hoc classification + dual-engine + merge-layer approach with a **single, declarative pipeline** that processes evidence through well-defined stages.

### Target Pipeline

```
DOM Event
  → Content Script: EventTap
    → Evidence Channels (A-E) collect structured evidence
    → EvidenceBatch assembled (per interaction, not per raw event)
    → DeliveryCoordinator sends to Service Worker

Service Worker: SessionManager
  → Buffers EvidenceBatch[]
  → On STOP: runs the STOP Pipeline

STOP Pipeline:
  Stage 1 — Classification (Recognition)
    → EventGrouper: merges related batches into interaction candidates
    → RecognitionPipeline: declarative pattern matching + confidence gate
    → Produces: RecognitionResult[] (RecognisedInteraction | UnrecognisedInteraction)

  Stage 2 — Lifecycle
    → LifecycleEngine: groups recognised interactions into SemanticActions
    → State machine: TARGET → ACTIVATE → INTERMEDIATE → COMMIT | CANCEL
    → Produces: LifecycleResult[] (SemanticAction | UnrecognisedInteraction)

  Stage 3 — Semantic Enrichment
    → EnrichmentPipeline: behavioral contracts, capabilities, coverage, workflows
    → Produces: EnrichedRecording (actions + unrecognised)

  Stage 4 — Output
    → RecordingArtifact: metadata + plain English + ExecutionIR + evidence traces
    → Playwright code generation
```

### Key Principles

1. **Declarative over procedural** — knowledge lives in data (pattern definitions, lifecycle configs, capability models), not in if/else cascades
2. **Single classification path** — no V1/V2 dual-engine, no merge layer. One pipeline.
3. **Evidence-first** — every classification decision traces back to structured evidence records
4. **Non-fatal stages** — the recording always completes; a stage failure degrades gracefully
5. **Modular content script** — Vite-bundled ES modules, not a single monolithic file
6. **Proven behaviour preserved** — every architectural change is validated against the same real-world interactions the current recorder handles
7. **Architecture wins** — when old patterns conflict with the new architecture, the architecture wins

### What Changes vs What Stays

| Component | Current | Target | Strategy |
|---|---|---|---|
| Content script | 2,727-line monolith | Modular ES modules via Vite | Gradually extract subsystems into modules |
| Event capture | All logic in one file | EventTap + channels + detectors | Extract each subsystem, preserve behaviour |
| Classification | V1 if/else (807 lines) + V2 evidence engine + merge layer | Declarative recognition pipeline | Port classification knowledge as pattern definitions |
| Recognition | Structural + behavioral recognizers (separate) | Unified recognition pipeline (5 steps) | Consolidate into one pipeline |
| Lifecycle | Not present as separate concept | LifecycleEngine with state machine | New — groups recognised interactions |
| Enrichment | 10 modules, tightly coupled | EnrichmentPipeline with 5 clean steps | Refactor for modularity |
| Output | IR Bridge + Playwright generator | OutputStage → RecordingArtifact | Keep generation, restructure entry point |
| Persistence | RecordingSession + Repository V2 | SessionManager + evidence buffer | Preserve crash recovery |
| Messaging | AppMessage union + chrome.runtime | Typed SWMessage + SidePanelMessage | Strengthen type safety |
| State | RecordingState enum (3 states) | 6-state lifecycle with transitions | Add STARTING, STOPPING, COMPLETED, ERROR_RECOVERY |
| UI | sidepanel.ts (1,301 lines) | Modular side panel components | Gradually extract |

### What Does NOT Change
- Manifest V3 structure (side panel, content script, service worker)
- Chrome APIs used (storage, webNavigation, scripting, tabs, alarms)
- The user's experience — same Start/Stop, same timeline, same generated tests
- Test coverage — all 3,056 tests must pass at every step

---

## Evolution Strategy

### Rule 1: Every change leaves the codebase architecturally better
We never make a change that *only* adds a feature. Every change also improves structure, reduces coupling, or moves toward the target architecture.

### Rule 2: One subsystem at a time
We don't refactor everything simultaneously. We pick one subsystem, evolve it toward the target, verify all tests pass, then move to the next.

### Rule 3: The old recorder is the reference
When porting behaviour, we study the current implementation, understand *why* it works, then express that behaviour in the target architecture's form.

### Rule 4: No parallel implementations
We never create a "new version alongside the old." We evolve the existing code in place, one step at a time.

### Rule 5: Tests are the safety net
The 3,056 existing tests define the behaviour contract. New tests are added for new architectural elements. No test is deleted unless the behaviour it tests is genuinely being replaced.

---

## Phased Evolution

### Phase 1: Foundation — Type System & Evidence Model
Establish the type vocabulary that the target architecture needs.

- Define `EvidenceRecord`, `EvidenceBatch`, `ElementIdentity` (enhanced), `DomContext`
- Define `ChannelId`, `SignalType` enumerations
- Define pipeline types: `PipelineStage`, `PipelineResult`, `RecognitionResult`
- Define target types: `SemanticAction`, `EnrichedRecording`, `RecordingArtifact`
- These types coexist with existing types — no removals yet

### Phase 2: Evidence Channels
Extract the content script's identity/DOM-context/value-tracking logic into modular evidence channels.

- Channel A (Accessibility): role, ARIA states, accessible name
- Channel B (DOM Structure): tag, classes, hierarchy, text
- Channel C (Behavioural): event sequence, interaction pattern, value transitions
- Channel D (Runtime Mutations): surface detection, hover reveal
- Channel E (Focus & Overlay): focus chain, overlay stack

### Phase 3: EventTap + Delivery
Restructure the content script's event handling into EventTap + DeliveryCoordinator.

- EventTap: manages listeners, produces EvidenceBatches
- Event filtering: port suppression rules (label dedup, text-entry keystroke, scroll)
- Value tracking: port before/after strategy
- DeliveryCoordinator: batch and deliver to SW

### Phase 4: Classification — Recognition Pipeline
Replace the V1/V2 dual-engine + merge layer with a single recognition pipeline.

- EventGrouper: group related batches into interaction candidates
- Pattern Registry: port classification knowledge as declarative patterns
- RecognitionPipeline: 5 steps (target resolution → context expansion → evidence collection → pattern matching → confidence gate)
- All 15+ interaction types must be classifiable

### Phase 5: Lifecycle Engine
Add the lifecycle state machine that groups recognised interactions into SemanticActions.

### Phase 6: Enrichment Pipeline
Refactor the 10 enrichment modules into a clean 5-step pipeline.

### Phase 7: Output Stage
Restructure the IR Bridge + Playwright generator as an OutputStage producing a RecordingArtifact.

### Phase 8: Service Worker Modernization
Refactor the SW into SessionManager + message router + pipeline orchestrator.

### Phase 9: Side Panel Modernization
Extract the 1,301-line sidepanel.ts into modular components.

---

## Current Codebase Inventory

### What We Have (Working, Tested)
- ✅ 13 capture-phase event listeners with proven suppression rules
- ✅ 3-strategy target resolution (interactive selector → clickable heuristic → raw)
- ✅ Element identity extraction (22 fields including shadow DOM, iframe context)
- ✅ Value tracking with before/after snapshots
- ✅ Surface detection (modal/drawer/popover/tooltip via MutationObserver)
- ✅ Hover detection (CSS :hover rule analysis + MutationObserver)
- ✅ Date picker capture (debounced value-outcome model)
- ✅ Page-world interception (alert/confirm/prompt/open)
- ✅ Navigation capture (webNavigation API)
- ✅ Event grouping (EventGrouper with time+element windows)
- ✅ Classification (15+ interaction types, deterministic)
- ✅ Recognition (structural ARIA + behavioral evidence)
- ✅ Enrichment (10 modules: contracts, capabilities, workflows, surfaces)
- ✅ IR Bridge + Playwright code generation
- ✅ Repository V2 persistence (Dexie/IndexedDB)
- ✅ Content script health (ping/inject/resync)
- ✅ MV3 crash recovery (session restore from storage)
- ✅ 3,056 tests, all passing

### What We Need to Build/Evolve
- Evidence channel architecture (A-E modular collectors)
- EvidenceBatch data model
- Declarative pattern registry (replacing if/else classifier)
- Recognition pipeline (5 steps, replacing V1/V2/merge)
- Lifecycle engine (state machine for interaction grouping)
- EnrichedRecording type (unified output)
- RecordingArtifact type (pipeline deliverable)
- Pipeline orchestrator (stage runner with non-fatal error handling)
