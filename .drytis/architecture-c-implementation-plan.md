# Architecture C — Implementation Plan

**Status:** Approved implementation roadmap
**Date:** 2026-07-17
**Blueprint:** `.drytis/architecture-c-production.md`
**Current version:** 6.1.0

---

## Table of Contents

1. [Phase Design Principles](#1-phase-design-principles)
2. [Phase Dependency Graph](#2-phase-dependency-graph)
3. [Phase Summary Table](#3-phase-summary-table)
4. [Phase 0 — Shared Types & Contracts](#phase-0--shared-types--contracts)
5. [Phase 1 — Multi-Tier Semantic Classifier](#phase-1--multi-tier-semantic-classifier)
6. [Phase 2 — Snapshot Coalescer](#phase-2--snapshot-coalescer)
7. [Phase 3 — State Tracker (Session Context L1)](#phase-3--state-tracker-session-context-l1)
8. [Phase 4 — Universal Interaction Observer](#phase-4--universal-interaction-observer)
9. [Phase 5 — Pipeline Integration & Feature Flag](#phase-5--pipeline-integration--feature-flag)
10. [Phase 6 — AI Observer Enhancement](#phase-6--ai-observer-enhancement)
11. [Phase 7 — Legacy Script Retirement](#phase-7--legacy-script-retirement)
12. [Risk Register](#12-risk-register)
13. [Validation Strategy](#13-validation-strategy)

---

## 1. Phase Design Principles

### PD1 — Bottom-up construction

Build the deepest dependencies first. The classifier is a pure function that depends on nothing — build it first. The observer depends on message contracts — build those first, then the observer. No phase depends on a later phase.

### PD2 — Independent testability

Every phase produces a testable artifact without requiring later phases:
- Pure-function phases (0, 1, 2) are unit-tested with synthetic inputs.
- Browser-dependent phases (3, 4) are tested with targeted content-script tests against fixture pages.
- Integration phases (5, 6) are tested end-to-end against the preview URL with the tester sub-agent.
- At no point does a phase require a later phase to validate its own correctness.

### PD3 — Zero regression guarantee

At every phase boundary, the extension loads, records, and generates identically to v6.1.0. The old pipeline remains the default until Phase 5's feature flag is explicitly enabled. No phase breaks existing functionality.

### PD4 — Atomic commits

Each phase is a single, reviewable unit of work. The phase is not "done" until: all new files exist, all tests pass, the extension loads without errors, and the old pipeline still works. The phase ends with a git commit.

### PD5 — Feature-flag isolation

The new pipeline is developed behind a feature flag (`chrome.storage.local` key `USE_ARCHITECTURE_C`, default `false`). Until Phase 7, both pipelines coexist. This means:
- If a phase introduces a bug, the user flips the flag and the old pipeline works.
- The feature flag is the single switch between architectures.
- No phase modifies the old pipeline's behavior.

---

## 2. Phase Dependency Graph

```
Phase 0: Shared Types & Contracts
    │
    ├──► Phase 1: Multi-Tier Classifier (pure function)
    │        │
    │        └──► (Phase 6: AI Observer feeds Tier 3)
    │
    ├──► Phase 2: Snapshot Coalescer (service worker logic)
    │
    ├──► Phase 3: State Tracker (Session Context L1)
    │        │
    │        └──► (Phase 6: AI Observer reads L1)
    │
    └──► Phase 4: Universal Interaction Observer (content script)
             │
             ▼
        Phase 5: Pipeline Integration & Feature Flag
             │
             ├── (old pipeline still active, feature flag OFF)
             │
             ▼
        Phase 6: AI Observer Enhancement
             │
             ▼
        Phase 7: Legacy Script Retirement
```

**Critical path:** 0 → 4 → 5 → 6 → 7

**Parallelizable:** Phases 1, 2, 3 can be built in any order after Phase 0 (they don't depend on each other). However, the recommended order (1 → 2 → 3) prioritizes the highest-value, lowest-risk components first.

---

## 3. Phase Summary Table

| Phase | Name | Risk | New Files | Modifies | Independently Testable | Builds On |
|-------|------|------|-----------|----------|------------------------|-----------|
| **0** | Shared Types & Contracts | Very Low | 2 | 0 | ✅ TypeScript compilation | — |
| **1** | Multi-Tier Semantic Classifier | Low | 2 | 0 | ✅ Unit tests (synthetic snapshots) | Phase 0 |
| **2** | Snapshot Coalescer | Medium | 2 | 0 | ✅ Unit tests (synthetic evidence streams) | Phase 0 |
| **3** | State Tracker | Medium | 2 | 1 | ✅ Unit tests + browser fixture | Phase 0 |
| **4** | Universal Interaction Observer | High | 2 | 1 | ✅ Browser fixture tests | Phase 0 |
| **5** | Pipeline Integration & Feature Flag | High | 2 | 2 | ✅ E2E browser tests (feature flag) | Phases 1–4 |
| **6** | AI Observer Enhancement | Medium | 2 | 2 | ✅ E2E with AI provider configured | Phase 5 |
| **7** | Legacy Script Retirement | Low | 0 | 3 | ✅ Full regression test | Phase 6 |

**Totals:** 14 new files, 9 modified files, 8 phases.

---

## Phase 0 — Shared Types & Contracts

### Goal

Define the typed interfaces that every subsequent phase depends on. No logic — just types. This is the foundation.

### Why first

Every other phase imports from these types. Building them first prevents type mismatches and interface drift during later phases. This phase has zero risk — it adds type definitions that nothing imports yet.

### Files created

| File | Content |
|------|---------|
| `src/shared/evidence-types.ts` | `RawEvidence`, `MutationSummary`, `InteractionSnapshot`, `ClassifiedInteraction`, `ClassificationEvidence`, `CanonicalType` (re-export from architecture-types), `SnapshotForAI`, `AIIntentResult`, `CoalescingConfig` |
| `src/shared/classifier-constants.ts` | `DWELL_THRESHOLD`, `COALESCING_WINDOW_MS`, `FOCUS_DEBOUNCE_MS`, `AI_CONFIDENCE_THRESHOLD`, `DATE_REGEX_PATTERNS`, `SELECTION_CLASS_PATTERNS`, `CANONICAL_TYPES` array, `RULE` enum (rule IDs for evidence trails) |

### Files modified

None.

### Detailed content

#### `src/shared/evidence-types.ts`

Defines the data structures from §13 of the architecture document:

```typescript
// RawEvidence — Observer → Coalescer
export interface RawEvidence { ... }
export interface MutationSummary { ... }

// InteractionSnapshot — Coalescer → Classifier
export interface InteractionSnapshot { ... }

// ClassifiedInteraction — Classifier → Timeline
export interface ClassifiedInteraction { ... }
export interface ClassificationEvidence { ... }

// SnapshotForAI — Classifier → AI Observer
export interface SnapshotForAI { ... }

// AIIntentResult — AI Observer → Classifier
export interface AIIntentResult { ... }

// CoalescingConfig — configurable thresholds
export interface CoalescingConfig {
  windowMs: number;          // default: 500
  dwellThresholdMs: number;  // default: 500
  focusDebounceMs: number;   // default: 300
  aiConfidenceThreshold: number; // default: 0.7
}
```

All types are **interfaces** (structural typing), not classes — consistent with the existing codebase pattern (`shared/types.ts`, `shared/architecture-types.ts`).

#### `src/shared/classifier-constants.ts`

Centralizes all configurable thresholds and pattern definitions so classifier rules can reference them by name:

```typescript
export const DWELL_THRESHOLD = 500;
export const COALESCING_WINDOW_MS = 500;
export const AI_CONFIDENCE_THRESHOLD = 0.70;
export const DATE_REGEX_PATTERNS = [
  /^\d{4}-\d{2}-\d{2}$/,           // ISO: 2026-07-18
  /^\d{2}\/\d{2}\/\d{4}$/,         // US: 07/18/2026
  /^\d{2}-\d{2}-\d{4}$/,           // alt: 18-07-2026
  /^\w{3} \d{1,2},? \d{4}$/,       // Jul 18, 2026
  /^\d{1,2} \w{3} \d{4}$/,         // 18 Jul 2026
];
export const SELECTION_CLASS_PATTERNS = [
  'selected', 'active', 'checked', 'current', 'is-selected'
];
export const RULE = {
  NAVIGATE: 'R1',
  TEXT_ENTRY: 'R2',
  // ... R3–R16
} as const;
```

### Acceptance criteria

- [ ] `evidence-types.ts` defines all 8 interfaces from the architecture document §13
- [ ] `classifier-constants.ts` defines all thresholds and patterns
- [ ] TypeScript compiles with zero errors (`npx tsc --noEmit`)
- [ ] No existing imports break (new files are not imported by anything yet)
- [ ] Types are consistent with `architecture-types.ts` (re-use `CanonicalType`, `ElementIdentity`, `SessionEvent` — do not redefine)

### Validation

```bash
npx tsc --noEmit   # must pass with zero errors
```

### Estimated new lines

~250 lines across 2 files.

---

## Phase 1 — Multi-Tier Semantic Classifier

### Goal

Build the 16-rule, 3-tier classifier as a pure function. It takes an `InteractionSnapshot` (+ optional `AIIntentResult` + optional `SessionContext`) and returns a `ClassifiedInteraction`. Fully unit-testable with synthetic snapshots — no browser, no service worker, no DOM.

### Why second

This is the highest-value component (it's the entire reason for the architecture change) and the lowest-risk (pure function, no side effects, no dependencies on browser APIs). Building it first lets us validate the classification logic in isolation before wiring it into the extension.

It's also the component with the most rules (16) and the most testable surface area. Getting it right early means later phases can trust its output.

### Files created

| File | Content |
|------|---------|
| `src/generation/engine/multi-tier-classifier.ts` | The `classifySnapshot()` pure function implementing all 16 rules across 3 tiers |
| `tests/multi-tier-classifier.test.ts` | Comprehensive unit tests — one test per rule, plus edge cases and tier-precedence tests |

### Files modified

None. This is an isolated pure function.

### Detailed design

#### `classifySnapshot()` function signature

```typescript
interface ClassifyInput {
  snapshot: InteractionSnapshot;
  aiResult?: AIIntentResult;        // optional — null when AI unavailable
  sessionContext?: SessionContext;  // optional — null when not yet built
}

interface ClassifyOutput {
  classified: ClassifiedInteraction;
  // For Phase 2 reclassification: indicates if AI could improve this
  aiEligible: boolean;
}

export function classifySnapshot(input: ClassifyInput): ClassifyOutput;
```

#### Rule implementation structure

Each rule is a pure predicate function that tests an `InteractionSnapshot`:

```typescript
// Tier 1 — Strong Deterministic
function rule1_navigate(snapshot): ClassificationResult | null;
function rule2_textEntry(snapshot): ClassificationResult | null;
function rule3_nativeDateInput(snapshot): ClassificationResult | null;
function rule4_nativeSelect(snapshot): ClassificationResult | null;
function rule5_checkboxToggle(snapshot): ClassificationResult | null;
function rule6_radioSelect(snapshot): ClassificationResult | null;

// Tier 2 — Behavioral Evidence
function rule7_dateValueOutcome(snapshot): ClassificationResult | null;
function rule8_dateCalendarContext(snapshot): ClassificationResult | null;
function rule9_arialOptionInListbox(snapshot): ClassificationResult | null;
function rule10_arialMenuItemInMenu(snapshot): ClassificationResult | null;
function rule11_segmentedControl(snapshot): ClassificationResult | null;
function rule12_cssClassDifferential(snapshot): ClassificationResult | null;
function rule13_toggleIndicator(snapshot): ClassificationResult | null;
function rule14_hoverDwellMutation(snapshot): ClassificationResult | null;

// Tier 3 — AI Advisory + Fallback
function rule15_aiAdvisory(snapshot, aiResult): ClassificationResult | null;
function rule16_defaultFallback(snapshot): ClassificationResult;
```

#### Classification flow

```typescript
export function classifySnapshot(input: ClassifyInput): ClassifyOutput {
  const { snapshot, aiResult, sessionContext } = input;
  const rules = input.aiResult
    ? [...tier1Rules, ...tier2Rules, ...tier3Rules]
    : [...tier1Rules, ...tier2Rules, fallbackRule];

  for (const rule of rules) {
    const result = rule.fn(snapshot, aiResult, sessionContext);
    if (result) {
      return {
        classified: {
          canonicalType: result.canonicalType,
          actionId: snapshot.identity.elementId, // link to source
          originalSnapshot: snapshot,
          classificationTier: result.tier,
          evidence: result.evidence,
        },
        aiEligible: result.tier < 3 && result.confidence < 0.9,
      };
    }
  }
  // rule16 always matches — this is unreachable
  throw new Error('Classifier reached impossible state');
}
```

#### Evidence Sovereignty enforcement

The function signature enforces AP4 structurally:
- Tier 1/2 rules don't receive `aiResult` (they can't be influenced by AI).
- Tier 3 rules receive `aiResult` but only fire when no Tier 1/2 rule matched.
- `aiEligible` flag tells the caller whether Phase 2 AI refinement could change this classification.

### Test plan

| Test Category | Tests |
|---|---|
| **Tier 1 rules (6 tests)** | One synthetic snapshot per rule — verify correct canonical type, tier=1, confidence ≥ 0.95 |
| **Tier 2 rules (8 tests)** | One synthetic snapshot per rule — verify correct canonical type, tier=2, appropriate confidence |
| **Tier 3 — AI advisory (2 tests)** | Snapshot where no T1/T2 matches + AI result with conf ≥ 0.7 → uses AI type; AI conf < 0.7 → falls to R16 |
| **Tier 3 — no AI (1 test)** | Same ambiguous snapshot without AI result → falls to R16 (click) |
| **Tier precedence (3 tests)** | Snapshot matching both a T1 rule and T2 rule → T1 wins. Snapshot matching T2 and AI → T2 wins (Evidence Sovereignty). Snapshot matching only AI → AI applies. |
| **Evidence trail (2 tests)** | Every result has `evidence.ruleId`, `evidence.matchedSignals[]`, `evidence.tier`. Verify for a representative T1 and T2 result. |
| **Date detection (3 tests)** | ISO date string → `isDateLike=true`. US format → `isDateLike=true`. Non-date string → `isDateLike=false`. |
| **Edge cases (4 tests)** | Empty snapshot (minimal fields). Snapshot with conflicting evidence (e.g., ARIA says checkbox but no state change). Navigation snapshot. Null identity fields. |

**Total: ~29 unit tests.**

### Acceptance criteria

- [ ] `classifySnapshot()` implemented with all 16 rules
- [ ] Tier 1 rules fire before Tier 2; Tier 2 before Tier 3 (priority ordering)
- [ ] Evidence Sovereignty: when a Tier 1 rule matches, AI result is ignored
- [ ] `aiEligible` flag correctly indicates whether Phase 2 could change the result
- [ ] Every result includes a complete `ClassificationEvidence` trail
- [ ] All ~29 unit tests pass
- [ ] No imports from browser APIs (`chrome.*`, `document`, `window`) — pure function
- [ ] TypeScript compiles with zero errors

### Validation

```bash
npx vitest run tests/multi-tier-classifier.test.ts
npx tsc --noEmit
```

### What this proves

The classifier correctly determines interaction types from rich evidence — even before it's wired into the extension. This validates the core intellectual claim of Architecture C: that evidence-based classification produces better results than selector-based capture-time classification.

### Estimated new lines

~500 lines (classifier) + ~400 lines (tests) = ~900 lines across 2 files.

---

## Phase 2 — Snapshot Coalescer

### Goal

Build the event-grouping logic that converts a stream of `RawEvidence` messages into `InteractionSnapshot` objects. Runs in the service worker. Unit-testable with synthetic evidence streams.

### Why third

The coalescer sits between the observer (Phase 4) and the classifier (Phase 1). It depends on Phase 0 types but not on the observer or classifier being built. Building it before the observer lets us test it with synthetic evidence streams — we can simulate "user clicked a date picker" by feeding in the right sequence of RawEvidence messages and verifying the output snapshot.

Medium risk: temporal windowing and event grouping are the most complex algorithmic logic in the pipeline. Getting it right in isolation is important.

### Files created

| File | Content |
|------|---------|
| `src/recorder/coalescer/snapshot-coalescer.ts` | The `SnapshotCoalescer` class — manages coalescing windows, groups events, computes evidence enrichment |
| `tests/snapshot-coalescer.test.ts` | Unit tests with synthetic evidence streams |

### Files modified

None. The coalescer is a standalone module.

### Detailed design

#### `SnapshotCoalescer` class

```typescript
export class SnapshotCoalescer {
  private openWindow: CoalescingWindow | null;
  private config: CoalescingConfig;
  private onSnapshot: (snapshot: InteractionSnapshot) => void;

  constructor(config: CoalescingConfig, onSnapshot: (s: InteractionSnapshot) => void);

  /** Called when a new RawEvidence arrives from the observer */
  ingest(evidence: RawEvidence): void;

  /** Called when a navigation event arrives (separate evidence source) */
  ingestNavigation(navInfo: { url: string; timestamp: string }): void;

  /** Force-close any open window (called on STOP_RECORDING) */
  flush(): void;

  /** Reset state (called on START_RECORDING) */
  reset(): void;
}

interface CoalescingWindow {
  elementKey: string;        // identity hash for grouping
  events: RawEvidence[];
  openedAt: number;          // timestamp
  preValue: string | null;   // value captured at focus/mousedown
  preState: string | null;   // checked/aria state at mousedown
  mutationObserver: {        // accumulated mutations during this window
    childListAdded: number;
    childListRemoved: number;
    attributeChanges: number;
    visibilityChanges: number;
    semanticChanges: string[];
  };
}
```

#### Grouping logic

The coalescer maintains a single open window. When a new `RawEvidence` arrives:

1. **Compute element key** — a hash of the element identity (tag + role + accessibleName + id + name). This determines if the event targets the "same" element as the open window.

2. **Check relatedness** — even if the element key differs, events may be related if they're in the same ancestor chain (e.g., clicking a calendar cell triggers a change on the date input field). The coalescer checks ancestor context overlap.

3. **Window decision:**
   - Same element key + within `windowMs` → add to open window
   - Different element key but related (ancestor overlap) + within `windowMs` → add to open window
   - Different element key, unrelated → close current window (emit snapshot), open new window

4. **On window close** — compute the `InteractionSnapshot`:
   - Determine `primaryEvent` (see §5 of architecture doc)
   - Compute `valueChange` from `preValue` and the last value in the window
   - Compute `stateChange` from `preState` and the last state
   - Build `ancestorContext` from the element's DOM hierarchy
   - Build `ariaAttributes` from the element's identity
   - Compute `dwellTime` from mouseenter → mouseleave/click timestamps
   - Summarize `domMutations` from accumulated mutation data
   - Call `onSnapshot(snapshot)` — hands off to classifier

#### Primary event selection algorithm

```typescript
function selectPrimaryEvent(events: RawEvidence[]): RawEvidence {
  // Priority: change > click > mousedown > blur > mouseenter > focus > keydown
  const priority = ['change', 'click', 'mousedown', 'blur', 'mouseenter', 'focus', 'keydown', 'input'];

  for (const type of priority) {
    const match = events.find(e => e.eventType === type);
    if (match) return match;
  }
  return events[0]; // fallback
}
```

#### Date detection helper

```typescript
function isDateLike(value: string): boolean {
  return DATE_REGEX_PATTERNS.some(pattern => pattern.test(value.trim()));
}
```

This replaces the current `isDateLikeTextInput()` heuristic (which checks element attributes for keywords like "depart", "date") with actual value-format detection — a fundamentally more reliable signal.

### Test plan

| Test Category | Tests |
|---|---|
| **Basic grouping (4 tests)** | mousedown+click on same element → 1 snapshot. focus+blur on same input → 1 snapshot. click on element A then click on element B (different) → 2 snapshots. Rapid clicks on same element within 500ms → 1 snapshot. |
| **Complex grouping (4 tests)** | Click on calendar cell + change on date input → 1 snapshot with valueChange. mousedown+click+change on checkbox → 1 snapshot with stateChange. mouseenter + 600ms dwell + mouseleave → 1 snapshot with dwellTime. focus + 3×input + blur → 1 snapshot with valueChange. |
| **Window timeout (2 tests)** | Events 600ms apart on same element → 2 separate snapshots. Event arrives after window closes → new window. |
| **Value computation (3 tests)** | Text input: pre="" post="hello" → valueChange. Select: pre="opt1" post="opt2" → valueChange. Checkbox: pre=false post=true → stateChange. |
| **Date detection (3 tests)** | Value "2026-07-18" → isDateLike=true. Value "hello world" → isDateLike=false. Value "07/18/2026" → isDateLike=true. |
| **Navigation (2 tests)** | Navigation event → standalone snapshot with primaryEvent=navigation. Navigation after click → closes click window, emits click snapshot, then navigation snapshot. |
| **Flush (2 tests)** | flush() on open window → emits snapshot. flush() with no open window → no-op. |
| **Reset (1 test)** | reset() clears open window and all state. |
| **Cross-element relatedness (2 tests)** | Click on calendar cell + change on sibling date input (shared ancestor) → 1 snapshot. Click on element in dialog + change on element outside dialog → 2 snapshots (no shared ancestor). |

**Total: ~23 unit tests.**

### Acceptance criteria

- [ ] `SnapshotCoalescer` correctly groups related events into single snapshots
- [ ] Temporal windowing respects `COALESCING_WINDOW_MS`
- [ ] Value/state/class diffs are correctly computed from pre/post snapshots
- [ ] Primary event selection follows the priority order
- [ ] Date detection uses value format, not element attributes
- [ ] Navigation events produce standalone snapshots
- [ ] `flush()` emits any pending snapshot; `reset()` clears state
- [ ] Cross-element relatedness correctly identifies calendar/dropdown/family interactions
- [ ] All ~23 unit tests pass
- [ ] No imports from browser APIs (pure logic, operates on data structures)

### Validation

```bash
npx vitest run tests/snapshot-coalescer.test.ts
npx tsc --noEmit
```

### What this proves

The coalescer correctly reconstructs user interactions from raw browser events. This validates the "capture-first" claim: that grouping events after the fact produces richer, more accurate interaction models than capturing typed events at event time.

### Estimated new lines

~600 lines (coalescer) + ~500 lines (tests) = ~1,100 lines across 2 files.

---

## Phase 3 — State Tracker (Session Context L1)

### Goal

Build the Deterministic State tracker — the component that maintains Layer 1 of Session Context. It observes the page DOM and tracks current URL, open dialogs/dropdowns, active form, and active element. MV3-safe (persists to storage).

### Why fourth

The State Tracker is independent of the classifier and coalescer. It can be built and tested in parallel with Phases 1–2. However, it's placed after Phase 2 because it's less critical to the core pipeline — the classifier and coalescer are the priority.

The State Tracker's output (Deterministic State) is consumed by the classifier (Tier 2 context) and the AI Observer (prompt context). But the classifier works without it (it's optional input). So the State Tracker can be built late without blocking the core pipeline.

Medium risk: `MutationObserver` in a content script needs careful lifecycle management (must disconnect on page navigation, reconnect on new page load). The existing hover script already does this (C3.3), so the pattern is proven.

### Files created

| File | Content |
|------|---------|
| `src/recorder/context/state-tracker.ts` | Content script that maintains `DeterministicState` via MutationObserver + webNavigation |
| `tests/state-tracker.test.ts` | Unit tests for state derivation logic (pure helpers extracted from the observer) |

### Files modified

| File | Changes |
|------|---------|
| `src/shared/architecture-types.ts` | No changes — `DeterministicState`, `ElementDescriptor` already defined. Just import and use. |

### Detailed design

#### Content script vs. service worker

The State Tracker runs as a **content script** (it needs DOM access for MutationObserver). It communicates its state to the service worker via messages:

```
State Tracker (content script)
  → chrome.runtime.sendMessage({ type: 'STATE_UPDATE', payload: DeterministicState })
Service Worker
  → Stores in chrome.storage.local under 'SESSION_CONTEXT_L1'
  → Available to classifier and AI Observer
```

This is registered as a separate content script in the manifest (alongside the future universal observer). It runs in the same isolated world.

#### `StateTracker` class

```typescript
export class StateTracker {
  private observer: MutationObserver | null;
  private currentState: DeterministicState;

  constructor();

  /** Start tracking on the current page */
  start(): void;

  /** Stop tracking and disconnect observer */
  stop(): void;

  /** Compute current deterministic state from the live DOM */
  private computeState(): DeterministicState;

  /** Handle DOM mutations — recompute state if relevant attributes changed */
  private onMutation(mutations: MutationRecord[]): void;

  /** Handle navigation — reset and recompute for new page */
  onNavigation(url: string, title: string): void;
}
```

#### State computation

```typescript
private computeState(): DeterministicState {
  return {
    currentUrl: window.location.href,
    pageTitle: document.title,
    openDialogs: this.findOpenDialogs(),
    openDropdowns: this.findOpenDropdowns(),
    activeForm: this.findActiveForm(),
    activeElement: this.describeElement(document.activeElement),
  };
}

private findOpenDialogs(): ElementDescriptor[] {
  // Query: [role="dialog"], [aria-modal="true"], .modal:not(.hidden)
  return Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"]'))
    .filter(el => this.isVisible(el))
    .map(el => this.describeElement(el));
}

private findOpenDropdowns(): ElementDescriptor[] {
  // Query: [aria-expanded="true"], [role="listbox"]:not([hidden])
  return Array.from(document.querySelectorAll('[aria-expanded="true"]'))
    .filter(el => this.isVisible(el))
    .map(el => this.describeElement(el));
}
```

#### MutationObserver strategy

```typescript
private onMutation(mutations: MutationRecord[]): void {
  // Only recompute if relevant attributes changed
  const relevant = mutations.some(m =>
    m.type === 'attributes' && (
      m.attributeName === 'aria-expanded' ||
      m.attributeName === 'aria-modal' ||
      m.attributeName === 'aria-hidden' ||
      m.attributeName === 'hidden' ||
      m.attributeName === 'class'
    ) ||
    m.type === 'childList'
  );

  if (relevant) {
    this.currentState = this.computeState();
    this.emit();
  }
}
```

The observer watches `attribute` changes (for `aria-expanded`, `aria-modal`, `class`) and `childList` changes (for dialog/dropdown insertion/removal). It does NOT watch `subtree` character data (too noisy).

#### MV3 persistence

The SW stores L1 state in `chrome.storage.local` under key `SESSION_CONTEXT_L1`. On SW restart, the SW reads the last known L1 state. The content script re-syncs on the next mutation/navigation event (which happens quickly as the user interacts).

### Test plan

Since the State Tracker is a content script (needs DOM), the pure logic is extracted into testable helper functions:

| Test Category | Tests |
|---|---|
| **`findOpenDialogs` (3 tests)** | Page with `[role="dialog"]` visible → returns descriptor. Page with dialog hidden via `display:none` → not returned. Page with no dialogs → returns []. |
| **`findOpenDropdowns` (3 tests)** | Element with `aria-expanded="true"` visible → returned. Element with `aria-expanded="false"` → not returned. Nested expanded elements → all returned. |
| **`findActiveForm` (2 tests)** | Focused element inside `<form>` → returns form descriptor. Focused element outside any form → returns null. |
| **`describeElement` (2 tests)** | Button with text "Submit" → { tag: 'button', role: 'button', accessibleName: 'Submit', className: '...' }. Element with no accessible name → accessibleName: ''. |
| **Mutation relevance filter (2 tests)** | Mutation on `aria-expanded` → relevant. Mutation on `style` → not relevant (skip recompute). |
| **Navigation reset (1 test)** | `onNavigation()` resets state and triggers recompute. |

**Total: ~13 unit tests** (using jsdom or vitest's DOM environment).

### Acceptance criteria

- [ ] `StateTracker` correctly tracks open dialogs, dropdowns, active form, active element
- [ ] MutationObserver only fires on relevant attribute/childList changes (not on every DOM mutation)
- [ ] State is emitted to SW via message and persisted to `chrome.storage.local`
- [ ] Navigation triggers state reset and recompute
- [ ] Observer disconnects on stop, reconnects on start
- [ ] All ~13 unit tests pass
- [ ] TypeScript compiles

### Validation

```bash
npx vitest run tests/state-tracker.test.ts   # jsdom environment
npx tsc --noEmit
```

### What this proves

Session Context L1 works — the system can track "what's open on the page" deterministically. This is the prerequisite for the classifier's Tier 2 behavioral rules and the AI Observer's prompt context.

### Estimated new lines

~400 lines (state tracker) + ~300 lines (tests) = ~700 lines across 2 files.

---

## Phase 4 — Universal Interaction Observer

### Goal

Build the single content script that replaces all six current content scripts. Captures ALL browser events + DOM context and sends `RawEvidence` messages to the service worker. No classification, no skipping, no ownership.

### Why fifth

This is the **highest-risk phase** — it's the component that interacts directly with the live DOM across arbitrary web pages. It must:
- Capture all relevant event types without missing any
- Handle Shadow DOM, iframes, and dynamic content
- Manage MutationObserver lifecycle during interaction windows
- Not interfere with the page's own JavaScript

It's built after Phases 0–3 because:
- It depends on Phase 0 types (`RawEvidence`, `MutationSummary`)
- The coalescer (Phase 2) must exist to receive its output
- The classifier (Phase 1) must exist to consume the coalescer's output

It does NOT replace the old scripts yet — it runs alongside them with a feature flag. Both pipelines operate in parallel; only one produces Timeline entries (controlled by the flag in Phase 5).

### Files created

| File | Content |
|------|---------|
| `src/recorder/observer/universal-interaction-observer.ts` | The single content script |
| `tests/universal-interaction-observer.test.ts` | Unit tests for extracted helpers (identity extraction, value tracking, mutation summarization) |

### Files modified

| File | Changes |
|------|---------|
| `src/manifest.json` | Add the new content script entry (alongside existing entries). NOT replacing yet. |

### Detailed design

#### Event listeners

```typescript
export class UniversalInteractionObserver {
  private listeners: Array<{ event: string; handler: EventListener }> = [];
  private mutationObserver: MutationObserver | null;
  private mutationWindow: { active: boolean; start: number } = { active: false, start: 0 };

  start(): void {
    this.addListener('click', this.onCaptureEvent, true);       // capture phase
    this.addListener('mousedown', this.onCaptureEvent, true);
    this.addListener('change', this.onCaptureEvent, true);
    this.addListener('focus', this.onFocusEvent, true);
    this.addListener('blur', this.onBlurEvent, true);
    this.addListener('input', this.onInputEvent, true);
    this.addListener('mouseenter', this.onMouseEnterEvent, true);
    this.addListener('mouseleave', this.onMouseLeaveEvent, true);
    this.addListener('keydown', this.onKeyEvent, true);
  }

  stop(): void {
    this.removeAllListeners();
    this.stopMutationObservation();
  }
}
```

All listeners use the **capture phase** (`true` as third argument) to intercept events before the page's own handlers. This matches the current content scripts' behavior.

#### Event → RawEvidence transformation

```typescript
private onCaptureEvent(event: Event): void {
  if (!this.isRecording()) return;
  if (!(event instanceof MouseEvent) && !(event instanceof Event)) return;

  const target = this.resolveTarget(event);
  if (!target) return;

  // Start mutation observation window on interaction
  if (event.type === 'mousedown' || event.type === 'click') {
    this.startMutationObservation(target);
  }

  const evidence: RawEvidence = {
    eventType: event.type,
    identity: this.extractIdentity(target),
    timestamp: new Date().toISOString(),
    isTrusted: event.isTrusted,
    value: this.captureValue(target),
    checked: this.captureCheckedState(target),
    mutations: this.getMutationSummary(),
  };

  chrome.runtime.sendMessage({ type: 'RAW_EVIDENCE', payload: evidence });
}
```

#### What is reused from current scripts

The observer extracts and consolidates the shared logic from all 6 scripts:

| Helper function | Current location (duplicated 6×) | Observer location |
|---|---|---|
| `extractIdentity()` (18-field ElementIdentity) | Each script has its own copy | Single copy in observer |
| `computeAccessibleName()` (9-level cascade) | Duplicated in click, checkbox, select, datepicker | Single copy |
| `generateCssSelector()` | Duplicated in click, hover | Single copy |
| `generateXPath()` | Duplicated in click, hover | Single copy |
| `resolveTarget()` (composedPath walk) | In click script only | In observer, used for all events |
| `isInShadowDom()` | Duplicated in click, select | Single copy |
| `extractIframeContext()` | Duplicated in click, select | Single copy |
| `checkRecording()` (storage sync) | Duplicated in all 6 | Single copy |
| Visibility detection (C3.3 algorithm) | In hover script only | Moves to observer's MutationObserver module |

#### What is removed

| Removed logic | Why |
|---|---|
| All skip selectors (Decisions 2b–2i) | No skipping — capture everything |
| `data-cmdrunner-handled` ownership protocol | No ownership — single script |
| `data-cmdrunner-pending-select` optimistic claims | No claims |
| Per-type 5-Gate decision trees | Classification moves to classifier |
| Per-type message types (CLICK_CAPTURED, CHECKBOX_CAPTURED, etc.) | One message type: `RAW_EVIDENCE` |

#### MutationObserver lifecycle

```typescript
private startMutationObservation(target: Element): void {
  this.stopMutationObservation(); // close any previous window

  this.mutationWindow = { active: true, start: Date.now() };
  this.mutationObserver = new MutationObserver((mutations) => {
    this.accumulateMutations(mutations);
  });

  this.mutationObserver.observe(document.body, {
    childList: true,
    attributes: true,
    attributeFilter: ['class', 'style', 'aria-expanded', 'aria-hidden', 'aria-selected', 'aria-checked', 'aria-pressed', 'hidden'],
    subtree: true,
  });

  // Auto-close after 500ms (matches coalescing window)
  setTimeout(() => this.stopMutationObservation(), COALESCING_WINDOW_MS);
}
```

### Test plan

The observer is a content script, so pure logic is extracted into testable helpers:

| Test Category | Tests |
|---|---|
| **Identity extraction (4 tests)** | Button with text → identity with accessibleName. Input with aria-label → identity with ariaLabel. Element in shadow DOM → identity with shadowDom=true. Element in iframe → identity with iframe context. |
| **Value capture (3 tests)** | Input with value → captures value. Select with selected option → captures value. Checkbox → captures checked state. |
| **Mutation summarization (3 tests)** | Child added → childListAdded++. Class changed to include 'selected' → semanticChanges includes 'class:selected-added'. Element visibility transition → visibilityChanges++. |
| **Event filtering (2 tests)** | Untrusted event (script-generated) → not captured. Event during non-recording state → not captured. |
| **MutationObserver lifecycle (2 tests)** | mousedown starts observation. 500ms timeout stops observation. |

**Total: ~14 unit tests** (using jsdom).

Plus **browser fixture tests** (manual or automated):
- Load a test page with standard controls (button, input, checkbox, select, date input)
- Start the observer
- Interact with each control
- Verify the SW receives `RAW_EVIDENCE` messages for every interaction
- Verify no messages are skipped and no ownership attributes are written to the DOM

### Acceptance criteria

- [ ] Observer captures all event types: click, mousedown, change, focus, blur, input, mouseenter, mouseleave, keydown
- [ ] Every captured event includes a complete `ElementIdentity` (18 fields)
- [ ] Value and checked state are captured at event time
- [ ] MutationObserver starts on mousedown/click, stops after 500ms
- [ ] No `data-cmdrunner-*` attributes written to the DOM
- [ ] No selector-based skipping — all events on all elements captured
- [ ] Shadow DOM elements resolved via `composedPath()`
- [ ] Untrusted events (script-generated) filtered out
- [ ] Observer starts/stops cleanly with recording state
- [ ] All ~14 unit tests pass
- [ ] Extension loads without errors with both old and new scripts registered
- [ ] Old pipeline still works (feature flag OFF)

### Validation

```bash
npx vitest run tests/universal-interaction-observer.test.ts
npx tsc --noEmit
# Manual: load extension, open any page, interact, check chrome.storage for RAW_EVIDENCE messages
```

### What this proves

A single observer can capture all interaction types without skipping or ownership. This validates the "capture-first" claim at the DOM level — the observer doesn't need to know what type of interaction it's capturing.

### Estimated new lines

~1,200 lines (observer) + ~400 lines (tests) = ~1,600 lines across 2 files.

### Risk mitigation

This is the highest-risk phase. Mitigations:
1. **Parallel operation**: The observer runs alongside existing scripts. If it fails, old scripts still work.
2. **No Timeline writes**: The observer only sends `RAW_EVIDENCE` messages. It doesn't write to the Timeline. Even if it's buggy, it can't corrupt recordings.
3. **Feature flag**: The observer's output is only consumed when `USE_ARCHITECTURE_C` is `true` (Phase 5).
4. **Incremental testing**: Start with the simplest events (click, change) and progressively add event types.

---

## Phase 5 — Pipeline Integration & Feature Flag

### Goal

Wire the four components (observer, coalescer, classifier, state tracker) into a functional pipeline in the service worker. Control the pipeline with a feature flag. When the flag is ON, the new pipeline produces Timeline entries. When OFF, the old pipeline runs as before.

### Why sixth

This is the integration phase — it connects everything built in Phases 0–4. It's high-risk because it's the first time the new pipeline produces actual Timeline entries that feed into generation. But it's de-risked by:
- Each component was individually validated in Phases 1–4
- The feature flag means we can test the new pipeline without affecting users
- The generation pipeline is unchanged, so Timeline entries in the new format still work with existing generators

### Files created

| File | Content |
|------|---------|
| `src/recorder/pipeline/architecture-c-pipeline.ts` | Orchestrates: observer evidence → coalescer → classifier → Timeline entry |
| `tests/architecture-c-pipeline.test.ts` | Integration tests: synthetic evidence → full pipeline → verify Timeline entry |

### Files modified

| File | Changes |
|------|---------|
| `src/background/service-worker.ts` | Add feature flag check; route `RAW_EVIDENCE` messages to the coalescer when flag is ON; keep old message handlers when flag is OFF |
| `src/sidepanel/timeline-renderer.ts` | Support Phase 2 reclassification: listen for `chrome.storage.onChanged` and re-render when an event's type changes |

### Detailed design

#### Feature flag

```typescript
// In service-worker.ts
async function isArchitectureCEnabled(): Promise<boolean> {
  const result = await chrome.storage.local.get('USE_ARCHITECTURE_C');
  return result.USE_ARCHITECTURE_C === true;
}
```

The flag defaults to `false`. It can be toggled from the settings page (a future UI addition) or from `chrome.storage.local` directly during testing.

#### Pipeline wiring

```typescript
// In service-worker.ts message handler
case 'RAW_EVIDENCE':
  if (await isArchitectureCEnabled()) {
    architectureCPipeline.ingestEvidence(message.payload);
  }
  // If flag is OFF, ignore (old scripts send their own typed messages)
  break;

// Old message handlers remain for when flag is OFF:
case 'CLICK_CAPTURED':
  if (!(await isArchitectureCEnabled())) {
    processAction('click', message.payload);
  }
  break;
```

#### `ArchitectureCPipeline` class

```typescript
export class ArchitectureCPipeline {
  private coalescer: SnapshotCoalescer;
  private classifier: typeof classifySnapshot;
  private sessionContext: SessionContext | null;

  constructor(sessionEvents: SessionEvent[]) {
    this.coalescer = new SnapshotCoalescer(
      DEFAULT_COALESCING_CONFIG,
      (snapshot) => this.onSnapshot(snapshot)
    );
  }

  /** Called when observer sends raw evidence */
  ingestEvidence(evidence: RawEvidence): void {
    this.coalescer.ingest(evidence);
  }

  /** Called when coalescer produces a snapshot */
  private onSnapshot(snapshot: InteractionSnapshot): void {
    // Phase 1: deterministic classification (immediate)
    const result = classifySnapshot({
      snapshot,
      aiResult: null,       // no AI yet (Phase 6)
      sessionContext: this.sessionContext,
    });

    // Convert ClassifiedInteraction → SessionEvent and append to Timeline
    const event = this.toSessionEvent(result.classified, snapshot);
    this.appendToTimeline(event);

    // If AI-eligible, kick off async AI refinement (Phase 6)
    if (result.aiEligible) {
      this.requestAIRefinement(snapshot, event.actionId);
    }
  }

  /** Convert classification result to a Timeline-compatible SessionEvent */
  private toSessionEvent(
    classified: ClassifiedInteraction,
    snapshot: InteractionSnapshot
  ): SessionEvent {
    // Map canonical type to Timeline event type prefix
    const typePrefix = this.canonicalToTimelineType(classified.canonicalType);
    const actionId = generateActionId(typePrefix);

    return {
      actionId,
      type: typePrefix,
      elementIdentity: snapshot.identity,
      timestamp: snapshot.primaryEvent.timestamp,
      // Type-specific fields populated based on canonicalType
      ...(classified.canonicalType === 'fill' && snapshot.valueChange
        ? { value: snapshot.valueChange.after }
        : {}),
      ...(classified.canonicalType === 'selectDate' && snapshot.valueChange
        ? { isoValue: snapshot.valueChange.after, displayValue: snapshot.valueChange.after }
        : {}),
      ...(classified.canonicalType === 'select' && snapshot.valueChange
        ? { value: snapshot.valueChange.after }
        : {}),
      ...(classified.canonicalType === 'toggle' && snapshot.stateChange
        ? { checked: snapshot.stateChange.after === 'true' }
        : {}),
      // Classification evidence trail (new field — doesn't break existing code)
      classificationEvidence: classified.evidence,
    };
  }

  /** Phase 2 reclassification (AI refinement) */
  private async requestAIRefinement(snapshot: InteractionSnapshot, actionId: string): Promise<void> {
    // Phase 6 implements this — for now, it's a no-op stub
    // Phase 6 will: call AI Observer → get AIIntentResult → re-classify → update Timeline
  }
}
```

#### Phase 2 reclassification display

The timeline renderer needs to handle event type updates:

```typescript
// In timeline-renderer.ts
// Listen for storage changes (already done for new events)
chrome.storage.onChanged.addListener((changes) => {
  if (changes.SESSION_EVENTS) {
    // Re-render — events may have been updated (type changed, AI enriched)
    renderTimeline(changes.SESSION_EVENTS.newValue);
  }
});
```

The renderer already re-renders on storage changes (it does for new events). Phase 2 reclassification updates the same storage key, so the existing listener handles it. The only change is ensuring the renderer reads the potentially-updated `type` field rather than caching it.

### Test plan

| Test Category | Tests |
|---|---|
| **Flag OFF — old pipeline (3 tests)** | Flag OFF + CLICK_CAPTURED → old handler processes. Flag OFF + RAW_EVIDENCE → ignored. Flag OFF → no ArchitectureCPipeline created. |
| **Flag ON — new pipeline (4 tests)** | Flag ON + RAW_EVIDENCE → coalescer receives it. Coalescer emits snapshot → classifier runs. Classifier produces event → appended to Timeline. Flag ON + CLICK_CAPTURED → ignored (old handler suppressed). |
| **End-to-end synthetic (3 tests)** | Feed synthetic evidence stream (mousedown+click+change on checkbox) → verify Timeline has 1 event with type='checkbox' and stateChange evidence. Feed date-picker evidence stream → verify type='dateSelect'. Feed text-entry evidence stream → verify type='text'. |
| **toSessionEvent mapping (4 tests)** | canonicalType='fill' → event.type='text', value populated. canonicalType='selectDate' → event.type='dateSelect', isoValue populated. canonicalType='toggle' → event.type='checkbox', checked populated. canonicalType='navigate' → event.type='navigate', url populated. |
| **AI eligibility (2 tests)** | High-confidence Tier 1 result → aiEligible=false. Low-confidence Tier 3 result → aiEligible=true. |

**Total: ~16 integration tests.**

Plus **browser E2E validation** (after wiring):
- Enable feature flag
- Record on a test page with standard controls
- Verify Timeline shows correct types (not generic clicks)
- Stop recording → verify generation pipeline produces correct output
- Verify old pipeline still works when flag is toggled OFF

### Acceptance criteria

- [ ] Feature flag (`USE_ARCHITECTURE_C`) controls which pipeline is active
- [ ] When flag is ON: `RAW_EVIDENCE` → coalescer → classifier → Timeline
- [ ] When flag is OFF: old message handlers work exactly as v6.1.0
- [ ] `toSessionEvent()` correctly maps all 10 canonical types to Timeline-compatible events
- [ ] Timeline entries from the new pipeline feed into the generation pipeline without errors
- [ ] Generation output (steps, execution JSON, Playwright) is identical quality to old pipeline for standard controls
- [ ] Phase 2 reclassification display works (renderer updates on type change)
- [ ] All ~16 integration tests pass
- [ ] Extension loads without errors in both flag states
- [ ] No `data-cmdrunner-*` attributes written to DOM when flag is ON

### Validation

```bash
npx vitest run tests/architecture-c-pipeline.test.ts
npx tsc --noEmit
# Browser: enable flag, record on test pages, verify Timeline + generation
```

### What this proves

The new pipeline works end-to-end. Evidence-based classification produces correct results for standard controls — without AI, without selectors, without ownership. This is the proof-of-concept for Architecture C.

### Estimated new lines

~500 lines (pipeline) + ~400 lines (tests) = ~900 lines across 2 new files.
~100 lines modified across 2 existing files.

---

## Phase 6 — AI Observer Enhancement

### Goal

Enhance the AI integration from "decorative enrichment" to "structural advisory classification." The AI Observer receives `SnapshotForAI` (rich context), returns `AIIntentResult` (classification advisory), and the classifier's Tier 3 rules consume it. Wire the Confidence Engine and Workflow Analyzer into the Mental Model.

### Why seventh

This is the phase that delivers the user's core expectation: "since we're using AI, the recorder should understand the user's interaction." It depends on Phase 5 (the pipeline must be wired) because the AI Observer's output needs to flow through the classifier to the Timeline.

Medium risk: the AI prompt redesign is the most uncertain part (LLM behavior is non-deterministic). Mitigated by Evidence Sovereignty (deterministic rules always override AI) and graceful degradation (AI is optional).

### Files created

| File | Content |
|------|---------|
| `src/ai/ai-observer.ts` | The AI Observer — receives `SnapshotForAI`, calls LLM, returns `AIIntentResult`, updates Mental Model |
| `tests/ai-observer.test.ts` | Unit tests for prompt construction, response parsing, Mental Model updates |

### Files modified

| File | Changes |
|------|---------|
| `src/recorder/pipeline/architecture-c-pipeline.ts` | Implement `requestAIRefinement()` — call AI Observer, re-classify, update Timeline |
| `src/ai/ai-understanding.ts` | Redesign prompt for `SnapshotForAI` input; parse `AIIntentResult` output |

### Detailed design

#### `AIObserver` class

```typescript
export class AIObserver {
  private providerManager: ProviderManager;
  private mentalModel: MentalModel | null;
  private confidenceEngine: ConfidenceEngine;

  constructor(providerManager: ProviderManager);

  /** Understand a single interaction */
  async understand(
    snapshot: SnapshotForAI,
    sessionContext: SessionContext
  ): Promise<AIIntentResult | null> {

    // 1. Build prompt from semantic snapshot + session context
    const prompt = this.buildPrompt(snapshot, sessionContext);

    // 2. Call LLM via provider manager
    const response = await this.providerManager.complete(prompt);
    if (!response) return null; // graceful degradation

    // 3. Parse and validate response
    const result = this.parseResponse(response);
    if (!this.validateResult(result, snapshot)) return null; // P7: hallucination rejection

    // 4. Update Mental Model (L2 of Session Context)
    this.updateMentalModel(result, snapshot, sessionContext);

    return result;
  }

  /** Build a prompt that gives the LLM semantic context, not raw mechanics */
  private buildPrompt(snapshot: SnapshotForAI, context: SessionContext): string {
    // The prompt includes:
    // - Element semantics (tag, accessibleName, ariaRole, className)
    // - Behavioral context (valueChanged, valueAfter, stateChanged, dwellTime)
    // - Structural context (ancestorRoles, hasCalendarContext, etc.)
    // - Session context (currentUrl, workflowHint)
    // - Instruction: classify the interaction type + provide businessName + intent + confidence
    // - Constraint: respond in strict JSON format
  }

  /** Parse LLM response into AIIntentResult */
  private parseResponse(response: string): AIIntentResult | null {
    // Parse JSON, extract suggestedType, businessName, userIntent, confidence
    // Clamp confidence to [0.05, 0.95] per P5
  }

  /** P7: Hallucination rejection — validate AI output against observed evidence */
  private validateResult(result: AIIntentResult, snapshot: SnapshotForAI): boolean {
    // If AI says 'selectDate' but valueAfter is not date-like AND no calendar context → reject
    // If AI says 'toggle' but no stateChanged → reject
    // If AI says 'fill' but no valueChanged → reject
    // Prefer null over fabrication (P7)
  }

  /** Update Mental Model (L2) — progressive understanding */
  private updateMentalModel(
    result: AIIntentResult,
    snapshot: SnapshotForAI,
    context: SessionContext
  ): void {
    // Update appIdentity hypothesis (what app is this?)
    // Update workflow hypothesis (what flow is the user in?)
    // Update currentFocus hypothesis (what UI area?)
    // Update userIntent hypothesis (what are they trying to do?)
    // Update recentChange analysis (what just changed?)
    // Compute confidence via ConfidenceEngine (5-track weighted)
    // Enforce P4: max 3 competing hypotheses per domain
    // Persist to chrome.storage.local under SESSION_CONTEXT_L2
  }
}
```

#### Prompt design principles

The prompt gives the LLM **semantic** information, not **mechanical** information:

| What the LLM sees | What the LLM does NOT see |
|---|---|
| `tagName: 'div'` | CSS selectors |
| `accessibleName: 'Departure Date'` | XPath |
| `ariaRole: null` | Element IDs (unless semantically meaningful) |
| `valueChanged: true` | Shadow DOM mechanics |
| `valueAfter: '2026-07-18'` | Iframe implementation details |
| `ancestorRoles: ['grid']` | Framework-specific internals |
| `hasCalendarContext: true` | Generated React/Angular IDs |
| `currentUrl: 'adanione.com/flight-booking'` | |
| `workflowHint: 'flight-search'` | |

The LLM is asked to classify the interaction based on its understanding of what the user is doing, not on DOM plumbing.

#### Pipeline integration (Phase 2 refinement)

```typescript
// In architecture-c-pipeline.ts
private async requestAIRefinement(
  snapshot: InteractionSnapshot,
  actionId: string
): Promise<void> {
  const snapshotForAI = this.toSnapshotForAI(snapshot);
  const sessionContext = await this.getSessionContext();

  const aiResult = await this.aiObserver.understand(snapshotForAI, sessionContext);
  if (!aiResult) return; // AI unavailable or rejected

  // Re-classify with AI advisory
  const result = classifySnapshot({
    snapshot,
    aiResult,
    sessionContext,
  });

  // If type changed, update the Timeline entry
  if (result.classified.canonicalType !== this.getEventType(actionId)) {
    this.updateTimelineEntry(actionId, result.classified);
  }

  // Always enrich with AI business name and intent
  this.enrichTimelineEntry(actionId, {
    businessName: aiResult.businessName,
    userIntent: aiResult.userIntent,
    confidence: aiResult.confidence,
  });
}
```

#### Confidence Engine activation

The `ConfidenceEngine` (already implemented in `confidence-engine.ts`) is wired into the AI Observer:

```typescript
// In ai-observer.ts updateMentalModel()
const confidence = this.confidenceEngine.compute({
  intent: result.confidence,           // AI's confidence in its classification
  workflow: workflowHypothesis?.confidence ?? 0.1,
  appFocus: appIdentityHypothesis?.confidence ?? 0.1,
  uiFocus: currentFocusHypothesis?.confidence ?? 0.1,
  change: changeAnalysis?.confidence ?? 0.1,
});
// Returns weighted average, clamped to [0.05, 0.95]
```

#### Workflow Analyzer activation

The `WorkflowAnalyzer` (already implemented in `workflow-analyzer.ts`) detects patterns in the Timeline:

```typescript
// On each new Timeline entry:
const workflowUpdate = this.workflowAnalyzer.analyze(
  sessionContext.layer3,  // the Timeline
  latestEvent,
);
// Returns: { workflowType, currentStep, totalSteps, confidence }
// Stored in Mental Model's `workflow` field
```

### Test plan

| Test Category | Tests |
|---|---|
| **Prompt construction (3 tests)** | Snapshot with full context → prompt includes all semantic fields. Snapshot with minimal context → prompt handles nulls gracefully. Session context with workflow hint → prompt includes workflow. |
| **Response parsing (3 tests)** | Valid JSON response → parsed correctly. Malformed JSON → returns null (graceful degradation). Missing fields → returns null. |
| **Confidence clamping (2 tests)** | AI returns confidence 1.0 → clamped to 0.95. AI returns confidence 0.0 → clamped to 0.05. |
| **Hallucination rejection (3 tests)** | AI says 'selectDate' but no date evidence → rejected. AI says 'toggle' but no state change → rejected. AI says 'fill' but no value change → rejected. |
| **Evidence Sovereignty (2 tests)** | Tier 1 classified as 'select' (conf 1.0) + AI says 'click' → type stays 'select'. Tier 3 fallback 'click' (conf 0.3) + AI says 'select' (conf 0.85) → type changes to 'select'. |
| **Mental Model updates (3 tests)** | First interaction → Mental Model created with initial hypotheses. Subsequent interaction → hypotheses updated, confidence increases. Contradictory evidence → hypothesis revised (P4). |
| **Confidence Engine (2 tests)** | 5 tracks with values → weighted average computed correctly. All tracks at 0.5 → composite is 0.5. |
| **Pipeline integration (2 tests)** | Phase 1 result with aiEligible=true → AI Observer called. AI returns different type → Timeline entry updated. |

**Total: ~20 unit tests.**

Plus **browser E2E validation with AI**:
- Configure an AI provider in Settings
- Enable feature flag
- Record on a page with custom (non-ARIA) controls
- Verify Timeline initially shows tentative types, then updates after AI responds
- Verify AI business names appear in element enrichment
- Verify Phase 2 reclassification works (type badge changes)

### Acceptance criteria

- [ ] AI Observer receives `SnapshotForAI` and returns `AIIntentResult`
- [ ] Prompt includes semantic context (tag, name, role, behavioral signals, session context)
- [ ] Prompt does NOT include raw selectors, XPath, or framework-generated IDs
- [ ] AI output validated against evidence (P7: hallucination rejection)
- [ ] Confidence clamped to [0.05, 0.95] (P5)
- [ ] Evidence Sovereignty: Tier 1/2 results override AI
- [ ] Mental Model (L2) updated progressively across interactions
- [ ] Mental Model persisted to `chrome.storage.local` (MV3-safe)
- [ ] Confidence Engine wired and producing 5-track weighted scores
- [ ] Workflow Analyzer wired and producing workflow hypotheses
- [ ] Phase 2 reclassification works: Timeline updates when AI changes the type
- [ ] AI enrichment (businessName, userIntent) appears in Timeline entries
- [ ] System works without AI (flag ON, no provider configured → Tier 1/2 only)
- [ ] All ~20 unit tests pass

### Validation

```bash
npx vitest run tests/ai-observer.test.ts
npx tsc --noEmit
# Browser: configure AI, enable flag, record on custom controls, verify classification + enrichment
```

### What this proves

AI is a structural participant in classification. The recorder "understands" user interactions — not just capturing events, but reasoning about intent. This is the core value proposition of an AI-powered recorder.

### Estimated new lines

~600 lines (AI Observer) + ~400 lines (tests) = ~1,000 lines across 2 new files.
~200 lines modified across 2 existing files.

---

## Phase 7 — Legacy Script Retirement

### Goal

Remove the six old content scripts and their associated message handlers, ownership protocol, and skip selectors. The feature flag is removed — Architecture C is the only pipeline.

### Why last

Only after Phase 6 is validated in real-world usage. This is a cleanup phase — no new functionality, just removal. Low risk because the new pipeline has been proven. But it's irreversible (the old code is deleted), so it comes last.

### Files deleted

| File | Lines |
|------|-------|
| `src/recorder/click-content-script.ts` | ~1,005 |
| `src/recorder/text-entry-content-script.ts` | ~317 |
| `src/recorder/hover-content-script.ts` | ~1,561 |
| `src/recorder/checkbox-radio-content-script.ts` | ~846 |
| `src/recorder/select-content-script.ts` | ~1,538 |
| `src/recorder/datepicker-content-script.ts` | ~1,132 |

**Total deleted:** ~6,399 lines.

### Files modified

| File | Changes |
|------|---------|
| `src/manifest.json` | Remove 6 old content_script entries; keep the universal observer + state tracker |
| `src/background/service-worker.ts` | Remove old message handlers (CLICK_CAPTURED, CHECKBOX_CAPTURED, etc.); remove feature flag check; Architecture C pipeline is the only path |
| `src/recorder/interaction-types.ts` | Retain for timeline rendering (badge colors, labels, titles). Remove any dead code related to `addToSession()` or content script coordination. |

### Acceptance criteria

- [ ] All 6 old content scripts deleted
- [ ] `manifest.json` has only: universal observer + state tracker content scripts
- [ ] Service worker only handles `RAW_EVIDENCE` messages (no old typed messages)
- [ ] Feature flag (`USE_ARCHITECTURE_C`) removed — Architecture C is always on
- [ ] No references to `data-cmdrunner-handled`, `data-cmdrunner-pending-select`, or skip selectors anywhere in codebase
- [ ] Extension loads, records, and generates correctly
- [ ] Full regression: all validation workflows from the validation plan produce correct results
- [ ] TypeScript compiles with zero errors
- [ ] No dead code (no unused imports, no orphaned functions)
- [ ] Codebase is smaller than before (net deletion despite new files)

### Validation

```bash
npx tsc --noEmit
npx vitest run                          # all tests pass
# Full browser regression: all 15 validation workflows from the validation plan
```

### What this proves

Architecture C is the sole architecture. The migration is complete. The codebase is simpler, more maintainable, and AI-native.

### Estimated change

-6,399 lines (deleted) across 6 files.
~200 lines modified across 3 files.
**Net codebase reduction: ~3,000+ lines** (new files add ~4,000, old files remove ~6,400).

---

## 12. Risk Register

| Risk | Phase | Likelihood | Impact | Mitigation |
|------|-------|-----------|--------|------------|
| Coalescer groups unrelated events together | 2 | Medium | Medium (wrong classification) | Temporal window + element-key + ancestor-overlap checks. Unit tests with adversarial evidence streams. |
| Coalescer splits related events apart | 2 | Low | Medium (missing evidence → generic click) | 500ms window is generous. Ancestor-overlap catches calendar/dropdown families. |
| Observer misses events on dynamic SPAs | 4 | Medium | High (missing interactions) | `document_start` run_at; re-attach listeners on SPA navigation via webNavigation API. |
| Observer MutationObserver is too noisy | 4 | Medium | Low (performance) | Attribute filter limits to relevant attributes. Auto-stop after 500ms. |
| AI prompt produces inconsistent results | 6 | High | Medium (wrong advisory classification) | Evidence Sovereignty ensures deterministic rules always win. Hallucination rejection validates output. |
| AI latency too high for real-time | 6 | Medium | Low (timeline shows tentative type briefly) | Phase 1 renders immediately; Phase 2 updates when AI responds. User sees instant feedback. |
| Feature flag race condition | 5 | Low | High (mixed pipeline) | Flag is read once per recording session start. Cannot change mid-recording. |
| MV3 SW kill during AI call | 6 | Medium | Medium (AI refinement lost) | Phase 1 result is already in Timeline. Lost Phase 2 refinement is cosmetic — the event is already correctly typed (just not AI-enriched). |
| Old and new scripts conflict (DOM attributes) | 4 | Low | Medium (recording corruption) | New script writes NO DOM attributes. Old scripts' `data-cmdrunner-*` attributes are read by old scripts only. No shared DOM state. |
| Generation pipeline rejects new event shapes | 5 | Low | High (generation fails) | `toSessionEvent()` produces the same `SessionEvent` shape. New field (`classificationEvidence`) is additive. Generation pipeline ignores unknown fields. |

---

## 13. Validation Strategy

### Per-phase validation

Each phase has its own acceptance criteria and test suite (detailed above). Phases are validated incrementally — a phase is not complete until all its tests pass.

### Integration validation (Phase 5)

After Phase 5, run the full browser E2E validation:
1. Enable feature flag
2. Record on each of the 15 validation workflows from the original validation plan
3. Compare results with old pipeline (flag OFF)
4. New pipeline must match or exceed old pipeline on every workflow

### AI validation (Phase 6)

After Phase 6, run validation with AI configured:
1. Configure an AI provider (Gemini/OpenAI/Claude)
2. Record on pages with custom (non-ARIA) controls
3. Verify AI advisory classification works for ambiguous elements
4. Verify Phase 2 reclassification (timeline updates)
5. Verify AI enrichment (business names, intent descriptions)

### Final regression (Phase 7)

After Phase 7, run the complete validation:
1. All 15 validation workflows
2. All unit tests pass
3. TypeScript compiles
4. No console errors during recording
5. No `data-cmdrunner-*` attributes in DOM
6. Codebase is smaller than v6.1.0

### Version target

- Phases 0–5 complete → **v7.0.0** (Architecture C pipeline, no AI advisory)
- Phase 6 complete → **v7.1.0** (AI Observer enhancement)
- Phase 7 complete → **v8.0.0** (Legacy retirement, Architecture C is sole pipeline)

---

## Summary

| Phase | Deliverable | Risk | Dependencies |
|-------|------------|------|-------------|
| 0 | Shared types & contracts | Very Low | None |
| 1 | Multi-tier classifier (pure function) | Low | Phase 0 |
| 2 | Snapshot coalescer (event grouping) | Medium | Phase 0 |
| 3 | State tracker (Session Context L1) | Medium | Phase 0 |
| 4 | Universal interaction observer | High | Phase 0 |
| 5 | Pipeline integration + feature flag | High | Phases 1–4 |
| 6 | AI Observer enhancement | Medium | Phase 5 |
| 7 | Legacy script retirement | Low | Phase 6 |

**Recommended order:** 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7

Each phase is independently testable, commits atomically, and preserves the zero-regression guarantee. The feature flag ensures the old pipeline remains available until Phase 7. By Phase 5, the new pipeline is functional end-to-end. By Phase 6, AI participates in classification. By Phase 7, the migration is complete and the codebase is simpler than before.
