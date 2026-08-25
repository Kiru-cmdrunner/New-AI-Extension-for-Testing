# Engineering Handover — Semantic Test Intelligence (CmdRunner)

> ⚠️ **SUPERSEDED FOR CURRENT STATE (2026-08-24).** This handover is frozen at
> 2026-08-07 / HEAD `be03f78` (pre-6E). Since then: 6E-M2, 6F-M1/M2a/M2b/M3-W1, WARN-4,
> 7.0-KR, 7.1-W1/W2, 7.2-M1, 7.3 W-B all shipped. **Read `.drytis/HANDOVER-2026-08-24.md`
> first** — it carries the current HEAD, open/parked state, the doctrine as it evolved
> (no timing rules, genericity constraint, two-commit closure), and instructions.
> This document stays valid for frozen vision (P1–P9), principles, and history.

**Date:** 2026-08-07
**Branch:** `capability-v1-complete`
**HEAD:** `be03f78` — "fix: M5 reviewer warnings — ledger persistence on every event + verification self-consistency"
**Tests:** 4072/4072 passing (175 files)
**Build:** Extension v10.9.0, 47 files
**Repository:** `github.com/Kiru-cmdrunner/New-AI-Extension-for-Testing`

---

## How to Use This Document

This is the **canonical handover** for a new AI continuing this project. It covers: vision, architecture, invariants, evolution reasoning, completed work, remaining roadmap, known debt, and rules to follow. Read it top to bottom before touching code.

**Key files to read alongside this:**
- `.drytis/notes/master-architectural-assessment.md` — debt analysis and dead code inventory
- `.drytis/notes/agreed-architecture-principles.md` — 10 architectural principles with rejected alternatives
- `.drytis/notes/content-script-not-injected-root-cause.md` — the silent capture killer (history)
- `.drytis/specs/end-to-end-capture-guarantee.md` — the Evidence Ledger architecture spec
- `.drytis/specs/e2e-capture-guarantee-milestones.md` — M1–M5 milestone plan
- `.drytis/specs/workflow-normalizer.md` — the subsumption filter spec
- `.drytis/specs/product-foundation-design-v1.0.md` — frozen product vision
- `.drytis/specs/product-architecture-design-v1.0.md` — frozen product architecture

---

## 1. Project Vision

### What Is CmdRunner?

CmdRunner is a **Test Case Generation Platform** built as a Chrome Extension (Manifest V3). The core idea: a user records their interactions on a web application, and the system generates reusable Playwright test code from those interactions.

The product thesis is: **"recording is a capability, not the product; Test Cases are permanent."**

### The User Journey

```
Home → New Test Case (enter details) → Start Recording → Record → Stop
  → Interaction Timeline → Canonical Steps + Execution JSON → Playwright Test
  → Review & Edit → Approve → Save to Repository
```

### Foundational Principles (P1–P9)

1. **Test Case Centric** — everything revolves around Test Cases, not recordings
2. **Record First, Analyze Later** — no step generation during recording; everything happens post-Stop
3. **Single Source of Truth** — Canonical Steps + Execution JSON; all exports derive from them
4. **Framework Agnostic** — canonical representation knows nothing about Playwright
5. **Approval Is a Gate** — only approved Test Cases enter the Repository
6. **Capture Intent, Not Events** — "Submit the form," not "fire mousedown on #submit"
7. **One-Way Derivation** — Timeline → Steps → Execution JSON → Playwright Test; never backward
8. **Transient ≠ Permanent** — recording sessions are ephemeral; Test Cases are permanent
9. **Additive Extensibility** — new interaction types are added without touching existing code

### Test Case Lifecycle

```
DRAFT → RECORDED → GENERATED → UNDER_REVIEW → APPROVED → SAVED
```

---

## 2. Technology Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Chrome Extension Manifest V3 (Service Worker) |
| Language | TypeScript 5.5 |
| Bundler | Vite 5.4 + `@crxjs/vite-plugin` |
| Storage | `chrome.storage.local` (session state) + Dexie/IndexedDB (repository) |
| Testing | Vitest (4072 tests, 175 files) |
| Test Framework Target | Playwright |
| Dependencies | `dexie` (IndexedDB), `fake-indexeddb` (test mocking) |
| Version | 10.9.0 |

**Build:** `npm run build` → Vite build + pack ZIP → `dist/` + `download/cmdrunner-extension.zip`

**Test:** `npm test` → `vitest run`

---

## 3. Architecture: The 6-Layer Recording Pipeline

This is the production pipeline — everything that actually runs. Understanding this is prerequisite to any change.

```
┌─────────────────────────────────────────────────────────────────────┐
│  CONTENT SCRIPT (one per tab)                                        │
│                                                                      │
│  EventTap ──► ObservedEvent ──► chrome.runtime.sendMessage           │
│     │                              │                                 │
│  DocumentObserver              BehavioralObservation                 │
│  (MutationObserver)            (correlated by sourceEventId)         │
└──────────────────────────────────┬──────────────────────────────────┘
                                   │
                    ┌──────────────▼──────────────┐
                    │   SERVICE WORKER (MV3)       │
                    │                              │
                    │  processObservedEvent()      │
                    │    1. evidenceLedger.append()│ ◄── capture guarantee
                    │    2. runtime.process()      │ ◄── classification
                    │    3. persist ledger+snapshot│ ◄── MV3 durability
                    └──────────────┬───────────────┘
                                   │
                    ┌──────────────▼──────────────┐
                    │   COMPONENT RUNTIME          │
                    │   (component-runtime.ts)     │
                    │                              │
                    │  14 definitions by priority  │
                    │  Lifecycle management        │
                    │  Dedup, stale cleanup        │
                    │  Returns ComponentInteraction│
                    └──────────────┬───────────────┘
                                   │
                    ┌──────────────▼──────────────┐
                    │   EVIDANCE LEDGER            │
                    │   (evidence-ledger.ts)       │
                    │                              │
                    │  Dispositions:               │
                    │  pending → absorbed →         │
                    │    (claimed | unclaimed)      │
                    └──────────────┬───────────────┘
                                   │
              ┌────────────────────▼────────────────────────┐
              │  stopRecording() (sw-integration.ts)         │
              │                                              │
              │  1. flush()         — interrupt active        │
              │  2. projectInteractions() — merge completed   │
              │     + Unclassified(unclaimed/pending)         │
              │  3. self-consistency verification             │
              │  4. return projected output (authoritative)   │
              └────────────────────┬─────────────────────────┘
                                   │
                    ┌──────────────▼──────────────┐
                    │  PROJECTION ENGINE           │
                    │  (projection-engine.ts)      │
                    │                              │
                    │  Pure function:              │
                    │  completed + Unclassified    │
                    │  (unclaimed/pending entries) │
                    └──────────────┬───────────────┘
                                   │
                    ┌──────────────▼──────────────┐
                    │  WORKFLOW NORMALIZER         │
                    │  (workflow-normalizer.ts)    │
                    │                              │
                    │  Removes subsumed Unclassified│
                    │  (same element, 500ms window) │
                    └──────────────┬───────────────┘
                                   │
                    ┌──────────────▼──────────────┐
                    │  OUTPUT ADAPTER              │
                    │  (output-adapter.ts)         │
                    │                              │
                    │  filterProductionInteractions│
                    │  toIRActions()               │
                    └──────────────┬───────────────┘
                                   │
                    ┌──────────────▼──────────────┐
                    │  CAPABILITY ENGINE           │
                    │  (capabilities/)             │
                    │                              │
                    │  12 capability types         │
                    │  Evidence-based classification│
                    │  Conflict resolution          │
                    └──────────────┬───────────────┘
                                   │
                    ┌──────────────▼──────────────┐
                    │  IR BRIDGE + CODE GENERATOR  │
                    │  (ir-bridge.ts)              │
                    │                              │
                    │  ExecutionIRPlan             │
                    │  PlaywrightCodeGenerator     │
                    └──────────────┬───────────────┘
                                   │
                    ┌──────────────▼──────────────┐
                    │  REPOSITORY V2               │
                    │  (Dexie/IndexedDB)           │
                    │                              │
                    │  Persistent storage          │
                    └─────────────────────────────┘
```

### Layer Responsibilities and Contracts

#### Layer 1: EventTap (content script)
**Contract:** Capture every DOM event that could represent a deliberate user action. Produce a complete `ObservedEvent` with 18-field `ElementIdentity`, `DomContext`, value transitions, pointer/keyboard fields, and a monotonic `captureSeq` (from `rawEvent.timeStamp`).

**What it does NOT do:** No classification, no filtering (except rate-limiting mousemove), no semantic analysis.

#### Layer 2: Evidence Ledger
**Contract:** Every discrete event is appended before classification. Dispositions are written as classification proceeds. Terminal dispositions (`claimed`, `unclaimed`) are immutable.

**Dispositions:** `pending → absorbed → (claimed | unclaimed)`
- `pending`: appended, not yet processed
- `absorbed`: runtime's lifecycle consumed this event
- `claimed`: a completed interaction backs this event (terminal)
- `unclaimed`: no completed interaction backs this event (terminal)

**MV3 durability:** On SW restart, `resetAbsorbedToUnclaimed()` fires — absorbed entries lose their claimant (the in-memory active stack is gone). Claimed entries survive (backed by persisted interactions).

#### Layer 3: Component Runtime
**Contract:** Classify events through the definition stack. Manage component lifecycles (triggering → active → completed/abandoned/interrupted). Dedup, stale cleanup (15s timeout).

**What it does NOT do (post-M5):** Emit Unclassified interactions. The runtime returns `[]` for unmatched discrete events. The Projection Engine surfaces them.

**14 Definitions (by priority, lower = checked first):**

| Priority | Type | Trigger | File |
|----------|------|---------|------|
| 10 | DatePicker | focus on date input | `date-picker.ts` |
| 15 | ColorInput | click on color input | `color-input.ts` |
| 20 | Dropdown | click on select/listbox | `dropdown.ts` |
| 25 | Slider | focus on range input | `slider.ts` |
| 30 | Checkbox | click on checkbox | `checkbox.ts` |
| 35 | FileUpload | change on file input | `file-upload.ts` |
| 40 | RadioButton | click on radio | `radio-button.ts` |
| 50 | TextEntry | focus on text input | `text-entry.ts` |
| 60 | Hover | mouseenter on interactive | `hover.ts` |
| 65 | Tab | click on tab control | `tab.ts` |
| 70 | Link | click on `<a>` | `link.ts` |
| 110 | Scroll | scroll gesture | `scroll.ts` |
| 120 | Navigation | page navigation | `navigation.ts` |
| 180 | Click | click (universal fallback) | `click.ts` |

**Unclassified** has no definition file — it is synthesized by the Projection Engine.

#### Layer 4: Projection Engine
**Contract:** Produce the complete interaction list from the ledger's final dispositions. This is a **pure function** — no side effects, no reconciliation, no recovery. It projects what the ledger says.

**Algorithm:**
1. Partition interactions: only `endState === 'completed'` appear in output
2. Build `coveredEventIds` from completed interactions' triggerEvent + memberEvents
3. Find ledger entries with disposition `unclaimed` or `pending` not in coveredEventIds
4. Synthesize `Unclassified` interactions for each
5. Return `[...completedOnly, ...projectedUnclassified]`

**Why only completed:** Interrupted/abandoned lifecycles started but didn't produce a meaningful result. Their events are released to `unclaimed` via `releaseClaims()`, and surface as Unclassified.

#### Layer 5: Workflow Normalizer
**Contract:** Remove Unclassified interactions that are semantically subsumed by a recognized interaction on the same element within a 500ms gesture window. This is a **view filter** — no evidence is deleted.

**Subsumption conditions (ALL must hold):**
1. Candidate is `Unclassified`
2. Temporal: `0 ≤ (recognized.startTime - unclassified.startTime) ≤ 500ms`
3. Target affinity: same `elementKey()`
4. Subsumer is a recognized type (not Unclassified)

**Why it exists:** Browsers fire `mousedown` + `click` as separate DOM events. Both enter the ledger. If the Click definition handles the click, the mousedown is absorbed → claimed. But in some cases the mousedown isn't claimed by the completed Click interaction and surfaces as Unclassified(mousedown) noise.

#### Layer 6: Output Adapter + Capability Engine + IR Bridge
- `filterProductionInteractions()` — removes incidental Hovers, Scrolls, no-op selections
- `toIRActions()` — maps 15 interaction types to 10 IR action types (CLICK, FILL, SELECT, TOGGLE, SELECT_DATE, NAVIGATE, HOVER, WAIT, RIGHT_CLICK)
- `runCapabilityInference()` — 12 capability types with evidence-based classification
- `buildIRPlan()` — constructs `ExecutionIRPlan`
- `PlaywrightCodeGenerator` — renders to Playwright test code

---

## 4. Architectural Principles and Invariants

### The 7 Capture Guarantee Invariants (INV-1 through INV-7)

| ID | Invariant | Enforced By |
|----|-----------|-------------|
| INV-1 | Capture Precedes Classification | `processObservedEvent` appends to ledger before `runtime.process()` |
| INV-2 | Every Entry Receives Exactly One Disposition | `setDisposition` called once per event at each decision point |
| INV-3 | Classification Cannot Erase Evidence | Absorbed entries released to `unclaimed` if lifecycle fails, never deleted |
| INV-4 | Browser-Ordered Ledger | `captureSeq` = `rawEvent.timeStamp` (monotonic per page) |
| INV-5 | MV3 Durability | Ledger persisted on every discrete event; runtime snapshot persisted on every emission |
| INV-6 | Document Boundaries Preserved | `pageId` grouping in ledger entries |
| INV-7 | Projection Is a Pure Function | No reconciliation, no recovery, no side effects |

### The 10 Architecture Principles (from `agreed-architecture-principles.md`)

1. **Three Separate Layers:** Observation (what happened) / Performance (was it fast enough) / Validation (was it the right outcome). Never mixed.
2. **Deterministic-First, AI Last:** Browser evidence → existing knowledge → deterministic reasoning → AI only when all else fails. AI is never the default path. AI output is hypothesis + confidence, never ground truth.
3. **Bounded Broad Capture + Deferred Analysis:** During recording, capture broadly. During analysis (post-Stop), filter and interpret deeply. "Capture broadly ≠ process everything deeply in real time."
4. **Region-Aware Observation (future):** Identify logical regions from structural evidence. Don't assume component type first.
5. **Five-Case Interaction Model (future):** Case 1 (response + consistency → silent), Case 2 (no response → prompt), Case 3 (inconsistent → prompt), Case 4 (search validation), Case 5 (navigation validation).
6. **First Recording ≠ Everything UNKNOWN:** Deterministic evidence alone is often sufficient.
7. **Performance Budget:** 3-second observation window hard cap.
8. **Stability Quiet Period:** 500ms quiet period (revised from 200ms after real-world testing showed React/Vue/Angular async at 300ms). 3000ms hard cap.
9. **Before-State Preservation (future):** Rolling element state cache.
10. **Temporary Rich Evidence → Consolidation (future):** Rich during recording, consolidated after.

### Key Design Decisions (and why)

**Decision: Runtime does NOT emit Unclassified (M5)**
- *Why:* The runtime's job is classification. When it also emitted Unclassified fallbacks, the ledger dispositions became inconsistent (fallback paths didn't call `setDisposition`). Decoupling classification from completeness ensures the ledger is the single source of truth for what happened.
- *Alternative rejected:* Post-hoc reconciliation (Architecture A) — would require a separate reconciliation pass to deduplicate mousedown→click. More complex, less deterministic.

**Decision: Projection Engine excludes non-completed interactions**
- *Why:* Interrupted/abandoned lifecycles started but didn't produce a meaningful result. Their events surface as Unclassified via `releaseClaims()`. Including them would double-count the trigger event.
- *Consequence:* `flush()` emits interrupted interactions into `liveInteractions`, but the Projection Engine filters them out. The verification self-consistency check accounts for this.

**Decision: Workflow Normalizer is a separate layer, not in the Projection Engine**
- *Why:* The Projection Engine's contract is *mechanical completeness* (every discrete event represented). The Normalizer's contract is *semantic correctness* (each interaction = one distinct user intention). Putting subsumption in the Projection Engine would violate its own invariant (INV-PE-2: every discrete event represented). Subsumption removes events from presentation, not from evidence.
- *Normalizer is permanent:* Streaming classification is necessarily lossy with respect to user intent. The gap between "best streaming classification" and "correct semantic model" cannot be eliminated without abandoning streaming.

**Decision: `captureSeq` uses `rawEvent.timeStamp`, not `Date.now()`**
- *Why:* `Date.now()` is subject to clock skew and SW sleep. `rawEvent.timeStamp` is assigned by the browser's event dispatcher, monotonic within a page, and unaffected by SW lifecycle. This gives deterministic event ordering for the ledger.

**Decision: Health-check re-sync (alive && !recording → send START_RECORDING)**
- *Why:* SPA navigations through tracking redirects (e.g., Amazon Sponsored Products) clear `sessionStorage`, which prevents the content script's auto-resume. The health check now detects this and re-sends `START_RECORDING`. This was the root cause of intermittent click loss on product pages.
- *Alternative rejected:* Persisting recording state in `chrome.storage.session` — more complex, same race conditions.

**Decision: `startRecording()` has a guard `if (isRecording) return`**
- *Why:* The health-check re-sync sends `START_RECORDING` to tabs that are alive but not recording. If the tab IS recording (race), the guard prevents duplicate EventTap installation. No double listeners, no duplicate capture.

---

## 5. Architecture Evolution — How We Got Here

### Era 1: V1 Classifier (dead — ~4,595 lines)
Original architecture used a pipeline of interaction detectors + evidence providers + an evidence engine. Complex, brittle, hard to test. **Superseded** by the Component Runtime's simpler definition-stack approach.

### Era 2: Recognition + Enrichment Pipeline (dead — ~4,565 lines)
Built a recognition layer (structural + behavioral recognizers) and a 7-step Application Knowledge Model enrichment pipeline. Designed to produce `AIUnderstanding` and semantic workflow grouping. **Never wired into production.** The enrichment DOM inspector is a no-op in the Service Worker context.

### Era 3: Component Runtime + Capability Model (current — live)
Complete rewrite. 14 definitions with the `ComponentDefinition` contract. Capability Model (12 types, evidence-based). This is what runs today.

### Era 4: Evidence Ledger + Projection Engine (current — live, M1–M5)
Added the append-only Evidence Ledger with disposition tracking. The Projection Engine surfaces unclaimed events as Unclassified. This eliminated the runtime fallback inconsistency and established the capture guarantee invariant.

### Era 5: Workflow Normalizer (current — live)
Pure function that removes semantically subsumed Unclassified interactions. Eliminates the mousedown→click duplication noise.

### Era 6: Health-Check Fix (current — live)
Fixed the root cause of intermittent click loss: `pingTabContentScript` now returns `{alive, recording}`, and `ensureContentScriptInjected` re-syncs `START_RECORDING` for alive-but-not-recording tabs.

### Key Bug: The Silent Capture Killer
Chrome does NOT re-inject content scripts into already-open tabs when an extension is reloaded. The fix was programmatic injection via `chrome.scripting.executeScript` + a periodic health check via `chrome.alarms` (every ~5s while recording). The health-check re-sync (Era 6) closed the final gap for SPA navigations.

---

## 6. Completed Milestones (Commit History)

### Recent Architecture Work (this session)

| Commit | Milestone | What |
|--------|-----------|------|
| `be03f78` | M5 fix | Ledger persistence on every event + verification self-consistency |
| `7736a7c` | M3+M5 | Projection Engine authoritative, Workflow Normalizer, health-check fix |
| `9e4e08c` | M4 | Projection Engine + Verification Mode (shadow) |
| `8ce85f0` | M3 | Runtime disposition tracking (7 decision points) |
| `e333306` | M2 | EvidenceLedger append-only store with dispositions (216 lines) |
| `a78a973` | M1 | captureSeq field for browser-assigned monotonic event ordering |

### End-to-End Capture Guarantee Milestones

| M | Goal | Status |
|---|------|--------|
| M1 | Add `captureSeq` field (additive, no downstream use) | ✅ Done |
| M2 | EvidenceLedger class (append-only, dispositions, snapshot/restore) | ✅ Done |
| M3 | Wire ledger into runtime — disposition tracking at every decision point | ✅ Done |
| M4 | Projection Engine + Verification Mode (shadow comparison) | ✅ Done |
| M5 | Remove runtime fallbacks — Projection Engine is authoritative | ✅ Done |

### Earlier Milestones

| Commit | What |
|--------|------|
| `71a103f` | Capture Guarantee v2 — capture-first, classify-second contract |
| `f25bfdd` | Capability V1 complete + real-world fixes (Navigation exclusion, Hover CSS, production filtering) |
| `17714c1` | M0.5 tabIndex + Slider lifecycle, Pre-Capability G4/G5/G6/G8/G15 |
| `b49a465` | M1 Behavioral Observation, M2 Semantic Effect Interpretation, performance optimization |
| Earlier | Phase 1–10: foundation, definitions, behavioral observation, IR bridge, Playwright generation, repository |

---

## 7. Known Technical Debt

### P0: Dead Code (~9,675 lines, ~20% of source)

Three entire subsystems are built, tested, but **never called from the production pipeline**:

| Dead Subsystem | Lines | Location |
|----------------|-------|----------|
| V1/V2 Classifier + Evidence Engine + 5 providers | ~4,595 | `src/classifier/` |
| Recognition layer (structural + behavioral) | ~2,515 | `src/recorder/recognition/` |
| Enrichment pipeline (7-step Application Knowledge Model) | ~2,010 | `src/recorder/enrichment/` |
| Old pipeline orchestrator | ~555 | `src/recorder/pipeline/` |

These have tests (which inflate the 4072 count). They represent earlier architectural approaches that were superseded.

**The unresolved decision:** Whether to revive the enrichment pipeline (gives assertions, workflow structure, AI understanding) or build those capabilities into the live ComponentRuntime + CapabilityModel.

### P1: Missing Interaction Coverage

- **Drag-and-drop:** Completely invisible. No definitions, no event types. Specs exist (`drag-drop.md`, `drag-drop-grouping.md`).
- **Keyboard interactions:** `keydown` captured in ledger but most definitions don't model keyboard semantics.
- **FileUpload / Tab:** Captured but map to `null` in IR (not replayable as Playwright actions).
- **Scroll maps to WAIT:** Not replayable as an action.

### P2: Code Quality

- `any[]` casts in service worker adapting `ComponentInteraction` → IR Bridge types
- Two parallel `IRAction` type systems (`output-adapter.ts` vs `execution-ir/types.ts`) not unified
- Dead code has tests — test count is misleading (live test count is lower)
- No lint script, no `tsc --noEmit` in CI
- `createUnclassifiedFromLedger` in Projection Engine produces stubs with `tag: 'UNKNOWN'`, empty `accessibleName` — no real element identity

### P3: AI Understanding Never Implemented

`buildIRPlan({understanding: null})` — the designed-for enrichment never runs. The AI Observer & Session Context architecture (1016-line spec) was validated and frozen but never implemented. The `AIUnderstanding` type exists in `src/shared/types.ts` but is never populated in production. The `src/ai/` directory has a provider connection layer (API key management, connection testing) but no code feeds recording data to an AI.

### Deliberately Postponed (not debt — deferred by design)

1. **mousedown/click coalescing in the Projection Engine** — handled by the Workflow Normalizer instead
2. **Fixing the `select` regex** (`DROPDOWN_TRIGGER_CLASS_RE` in patterns.ts) — broad regex causes false-positive Dropdowns; no longer causes data loss
3. **Persisting `activeStack`** — intentionally NOT done; `resetAbsorbedToUnclaimed` handles SW restart
4. **Fixing `ensureSessionRestored()` async race** — ledger sorts by `captureSeq`, so it's harmless
5. **Adding diagnostic identity fields to LedgerEntry** — discussed extensively, deferred. Current `LedgerEntry` has `eventId`, `eventType`, `timestamp`, `disposition`, `claimedBy`, `claimType` but NO target identity (`targetTag`, `targetName`, `targetRole`). Debugging requires timestamp/sequence correlation or checking `liveInteractions`.

---

## 8. Remaining Work and Roadmap

### Recommended Implementation Order

**Phase 1: Stabilize and Clean Up (immediate)**
1. Remove dead code (~9,675 lines) OR clearly mark it as archived
2. Remove dead tests (reduces test count to accurate live count)
3. Add `tsc --noEmit` to CI
4. Unify the two `IRAction` type systems
5. Fix `createUnclassifiedFromLedger` to carry element identity (add `targetTag`, `targetName`, `targetRole` to `LedgerEntry`)

**Phase 2: Missing Interaction Types (next)**
1. Drag-and-drop (spec exists: `drag-drop.md`, `drag-drop-grouping.md`)
2. Keyboard interaction modeling (keydown consumption by definitions)
3. FileUpload IR mapping (currently `null`)
4. Tab interaction IR mapping

**Phase 3: AI Understanding (medium-term)**
1. Implement AI Observer architecture (frozen spec: `milestone-ai-observer-session-context.md`)
2. Wire enrichment pipeline to populate `AIUnderstanding`
3. Feed recording data to AI provider, write back understanding
4. Generate assertions from enriched interactions

**Phase 4: Product Completeness (longer-term)**
1. Test Case lifecycle (DRAFT → RECORDED → GENERATED → UNDER_REVIEW → APPROVED → SAVED)
2. Review & Edit UI for canonical steps
3. Approval workflow
4. Repository browser enhancement
5. Execution engine (replay recorded tests)

### Validation Sites (for testing interaction capture)

Three sites were used for real-world validation:
1. **Amazon.in** — complex SPA, Sponsored Products redirects, exchange options, carousels
2. **OrangeHRM** — enterprise UI, OXD custom components, dropdowns, date pickers, checkboxes
3. **Avis Ford** — booking widgets, autocomplete, date pickers

### M4 Equivalence Gate Checklist (for future regression testing)

| Site | Workflow | Interaction Types Exercised |
|------|----------|---------------------------|
| Amazon.in | Search → click 'With Exchange' → Add to Cart | Click, Unclassified(mousedown), Navigation, Scroll |
| OrangeHRM | Login → Admin → Users → Add → dropdowns → Cancel → PIM | TextEntry, Dropdown, Click, Navigation |
| Avis.com | Booking widget autocomplete, DatePicker, TextEntry | DatePicker, TextEntry, Click |

**Verification result location:** `chrome.storage.local` key `cmdrunner_verification_result`
**Pass criteria:** `match: true`, every discrete ledger event represented in projection

---

## 9. Testing Strategy

### Current State
- 4072 tests across 175 files (Vitest)
- Tests cover: definitions, runtime, evidence-ledger, projection-engine, workflow-normalizer, capabilities, output-adapter, IR bridge, repository, behavioral observation, semantic effects
- Test helpers: `make-event.ts` (constructs `ObservedEvent`), `mock-chrome.ts` (mocks Chrome APIs)

### Testing Conventions
- **Unit tests** test functions/classes in isolation (e.g., definition `detectTrigger`, `projectInteractions`)
- **Integration tests** test multi-step flows (e.g., ledger append → runtime process → flush → projection → verify self-consistency)
- Tests use `processFull()` helper (ledger + runtime + flush + projection) to verify the full M5 pipeline
- No browser tests in the test suite — browser testing was done manually via the Chrome Extension

### How to Validate Changes

1. **Always run:** `npm test` — all 4072 tests must pass
2. **Always run:** `npm run build` — extension must build successfully
3. **For architecture changes:** Add a self-consistency test: process events through the full pipeline (ledger → runtime → flush → projection), verify every discrete event is represented
4. **For interaction changes:** Test with the real-world validation sites
5. **For new definitions:** Add tests for trigger detection, lifecycle completion, and IR mapping

### Post-Mortem Debugging

**If clicks are intermittently lost:**
1. Dump `cmdrunner_live_interactions`, `cmdrunner_evidence_ledger`, `cmdrunner_verification_result` from SW DevTools console
2. If event's `eventId` is NOT in the ledger → never reached `processObservedEvent` → upstream failure (content script not recording)
3. If event IS in the ledger → check disposition:
   - `claimed` → interaction backs it, check `liveInteractions`
   - `absorbed` → lifecycle consumed it, check if lifecycle completed
   - `unclaimed` → released, should be in projection
   - `pending` → runtime never processed it (SW restore race)
4. Check `sessionStorage cmdrunner_is_recording` on the page — if `null`, content script isn't recording

**SW console diagnostic snippet** (paste into SW DevTools console after a recording):
```javascript
const [li, el, vr] = await Promise.all([
  chrome.storage.local.get('cmdrunner_live_interactions'),
  chrome.storage.local.get('cmdrunner_evidence_ledger'),
  chrome.storage.local.get('cmdrunner_verification_result'),
]);
const interactions = li.cmdrunner_live_interactions || [];
const ledger = el.cmdrunner_evidence_ledger || [];
const verify = vr.cmdrunner_verification_result;
console.log(`Interactions: ${interactions.length}`);
interactions.forEach((i, idx) => {
  console.log(`  [${idx}] ${i.type} — ${i.metadata?.targetName || i.metadata?.accessibleName || '?'}`);
});
console.log(`\nLedger: ${ledger.length} entries`);
const dispositions = {};
ledger.forEach(e => { dispositions[e.disposition] = (dispositions[e.disposition] || 0) + 1; });
console.log('Dispositions:', dispositions);
console.log(`\nVerification: match=${verify?.match}`);
if (!verify?.match) console.log(JSON.stringify(verify, null, 2));
```

---

## 10. Architectural Rules for Future Implementations

### MUST Follow

1. **Every env variable goes through `add_environment_key` / `bulk_add_environment_keys`** — NEVER edit `.env` files via shell or `write_file`. The backend regenerates `.env` on every deploy.

2. **Every long-running process is registered via `add_background_service`** with a production command. Never `nohup`, `&`, `screen`, `tmux`, `bg`, `disown`. Never register dev commands (`npm run dev`, `vite`, `next dev`).

3. **All schema changes go through the framework's migration system.** Never raw `ALTER TABLE` / `CREATE TABLE`. (Note: this project uses Dexie/IndexedDB, versioned via `schema-version.ts`.)

4. **No hardcoded secrets, URLs, or credentials in source.** Use env variables. This project uses `chrome.storage.local` and `IndexedDB` — no `.env` files are needed for the extension itself, but the workspace server has env keys for the download endpoint.

5. **New interaction types follow the definition pattern:** Create a file in `src/definitions/`, implement `ComponentDefinition`, import in `src/definitions/index.ts`. No other files need to change (AP7: Additive Extensibility).

6. **Evidence Ledger is append-only.** Never delete entries. Dispositions follow `pending → absorbed → (claimed | unclaimed)`. Terminal states are immutable.

7. **Projection Engine is a pure function.** No side effects, no reconciliation, no recovery. It projects what the ledger says.

8. **Workflow Normalizer is a view filter.** It removes from presentation, not from evidence. Subsumed interactions remain in `liveInteractions` and the ledger.

9. **The runtime does NOT emit Unclassified.** This is handled by the Projection Engine. Adding fallback emission back would break disposition consistency.

10. **Ledger persists on every discrete event.** Not just when interactions are emitted. Absorbed events change disposition too.

11. **Setup script must install deps and build.** The setup script runs on every deploy. `npm ci --no-audit --no-fund && npm run build`.

### MUST NOT Do

1. **Do NOT use `processObservedEvent` without `ledger.append()` first.** Capture must precede classification (INV-1).
2. **Do NOT add mousedown/click coalescing or timeouts to the Component Runtime.** The runtime does only evidence classification and lifecycle management. Gesture correlation is the Workflow Normalizer's job.
3. **Do NOT compare raw `liveInteractions` against projection for verification.** Under M5, they intentionally diverge (non-completed interactions are excluded from projection). Use the self-consistency check instead.
4. **Do NOT persist `activeStack` in `RuntimeSnapshot`.** Intentionally not done. SW restart resets absorbed → unclaimed.
5. **Do NOT assume content scripts are injected on already-open tabs.** Always use `ensureContentScriptInjected()` with the health-check re-sync.

---

## 11. Critical Context a New AI Would Otherwise Lose

### The `ok:true` Amplifier Vulnerability

The content script sends events to the SW via `chrome.runtime.sendMessage`. The SW's `handleObservedEvent` responds `{ok: true}` **synchronously** before the async `processObservedEvent` completes. The content script removes the event from its buffer on `ok:true`. **Any SW-side failure (exception, crash, race) permanently loses the event.** This is a known vulnerability that hasn't been fixed yet — it's acceptable because the health check catches the common case (content script not recording), and individual processing failures are rare.

### The `DROPDOWN_TRIGGER_CLASS_RE` Regex

Located in `src/definitions/patterns.ts`. Has a bare `'select'` alternative that matches ANY className containing "select" (e.g., "a-button-select", "exchange-selected", "noselect"). This causes false-positive Dropdown lifecycles. It was previously thought to cause click loss, but the Evidence Ledger proved it only causes classification noise. The regex should be tightened but it's not urgent.

### The Two `IRAction` Type Systems

There are two separate `IRAction` types:
1. `src/presentation/output-adapter.ts` — used by the recording pipeline (SW → IR Bridge). Simple.
2. `src/domain/execution-ir/types.ts` — designed for the ATC (Approved Test Case) path. Richer, with locators, assertions, execution parameters.

The service worker bridges them with `any[]` casts. This is known debt.

### The Dead `ai/` Directory

`src/ai/` has a provider connection layer (`provider-manager.ts`, `connection-tester.ts`). It lets users configure an AI provider (API key, endpoint) and test the connection. But **no code feeds recording data to an AI and writes back `AIUnderstanding`**. The provider connection UI exists in the side panel but the actual AI inference pipeline was never built.

### The Three Behavioral Observation Layers (M1/M2)

These are fully wired and production-active:
- **M1 Behavioral Observation:** `ObservationCoordinator` + `DocumentObserver` in the content script. Captures DOM mutations in a bounded window after meaningful interactions. Stability quiet period: 500ms (revised from 200ms).
- **M2 Semantic Effects:** `effect-interpreter.ts` + `effect-rules.ts` in the service worker. Interprets observed mutations as semantic effects (content-changed, visibility-changed, value-updated, etc.).
- Flow: Content script captures mutations → sends as `BEHAVIORAL_EFFECTS` message → SW correlates by `sourceEventId` → attaches to `ComponentInteraction.behavioralObservations[]`.

### The Setup Script

The setup script (`npm ci --no-audit --no-fund && npm run build`) was missing until this session. It's now set via the workspace backend. Without it, a fresh deploy would have no built extension (`dist/` and `download/*.zip` are `.gitignore`d).

### Git Remotes

- `origin` — Drytis-managed repo (workspace-managed, auto-created)
- `github` — User's GitHub repo (`Kiru-cmdrunner/New-AI-Extension-for-Testing`)
- Branch `capability-v1-complete` is pushed to both remotes
- Branch `main` exists on both but may be behind

---

## 12. File Map (Key Source Files)

```
src/
├── background/
│   ├── service-worker.ts          # Central orchestrator, recording lifecycle, health check
│   └── ...
├── content/
│   ├── recorder-entry.ts          # Content script entry, auto-resume, PING handler
│   └── ...
├── runtime/
│   ├── component-runtime.ts       # Lifecycle management engine (686 lines)
│   ├── evidence-ledger.ts         # Append-only store with dispositions (216 lines)
│   ├── projection-engine.ts       # Pure function: completed + Unclassified projection
│   ├── verification-mode.ts       # Shadow comparison (M4) / self-consistency (M5)
│   └── sw-integration.ts          # SW bridge: processObservedEvent, stopRecording, MV3 recovery
├── definitions/
│   ├── index.ts                   # ALL_DEFINITIONS registry
│   ├── click.ts                   # Universal fallback (priority 180)
│   ├── dropdown.ts                # (priority 20)
│   ├── date-picker.ts             # (priority 10)
│   ├── text-entry.ts              # (priority 50)
│   ├── ... (14 definitions total)
│   └── patterns.ts                # Shared helpers (elementKey, DROPDOWN_TRIGGER_CLASS_RE)
├── presentation/
│   ├── output-adapter.ts          # filterProductionInteractions + toIRActions
│   └── workflow-normalizer.ts     # Subsumption filter (98 lines)
├── capabilities/
│   ├── capability-engine.ts       # 12 capability types, evidence-based
│   ├── conflict-resolver.ts       # 6 conflict resolution rules
│   ├── evidence-extractor.ts      # Extracts evidence from interactions
│   ├── rules/                     # 12 capability rule files
│   └── ...
├── semantics/
│   ├── effect-interpreter.ts      # M2: interprets mutations as semantic effects
│   ├── effect-rules.ts            # Semantic effect rules
│   ├── sw-bridge.ts               # SW bridge for behavioral observations
│   └── ...
├── shared/
│   ├── component-types.ts         # Core types (ComponentDefinition, ObservedEvent, etc.)
│   ├── types.ts                   # Legacy types (AIUnderstanding, etc.)
│   └── ...
├── domain/
│   ├── execution-ir/              # IR types, generator, staleness, adapters
│   ├── entities/                  # Domain entities (Test Case, etc.)
│   └── ...
├── adapters/
│   └── playwright/                # Playwright code generator, assertion renderer
├── generation/
│   └── ir-bridge.ts               # Maps interactions → IR plan (685 lines)
├── ai/                            # Provider connection layer (unused for inference)
├── classifier/                    # DEAD CODE (~4,595 lines)
├── recorder/
│   ├── recognition/               # DEAD CODE (~2,515 lines)
│   ├── enrichment/                # DEAD CODE (~2,010 lines)
│   └── pipeline/                  # DEAD CODE (~555 lines)
└── tap/
    └── event-tap.ts              # Event capture (content script)
```

---

## 13. Quick Reference

| What | Where |
|------|-------|
| Start recording | `service-worker.ts:handleStartRecording` |
| Stop recording | `service-worker.ts:handleStopRecording` → `sw-integration.ts:stopRecording` |
| Process event | `sw-integration.ts:processObservedEvent` |
| Runtime process | `component-runtime.ts:process()` |
| Project output | `projection-engine.ts:projectInteractions()` |
| Normalize | `workflow-normalizer.ts:normalizeWorkflow()` |
| Filter + IR map | `output-adapter.ts:filterProductionInteractions() + toIRActions()` |
| Capabilities | `capability-engine.ts:runCapabilityInference()` |
| Code generation | `ir-bridge.ts` → `PlaywrightCodeGenerator` |
| Health check | `service-worker.ts:ensureContentScriptInjected()` |
| Content script entry | `recorder-entry.ts` |
| Event capture | `event-tap.ts` |
| Element identity | `resolveTarget()` in event-tap.ts (walks `composedPath()`) |
| Storage keys | `cmdrunner_live_interactions`, `cmdrunner_evidence_ledger`, `cmdrunner_verification_result`, `cmdrunner_is_recording` |

| Test command | What it does |
|---|---|
| `npm test` | All 4072 tests |
| `npm run build` | Vite build + pack ZIP |
| `npx vitest run <file>` | Single test file |
| `npx vitest run --reporter=verbose` | Verbose output |

---

**End of Engineering Handover. This document is the canonical reference for continuing this project.**
