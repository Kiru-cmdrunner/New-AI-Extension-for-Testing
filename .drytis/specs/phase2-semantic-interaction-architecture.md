# Phase 2 — Semantic Interaction Architecture Recommendation

**Status:** Architecture design exercise — no implementation
**Date:** 2026-07-16
**Prerequisite:** Phase 1 Architecture Discovery (`.drytis/notes/phase1-architecture-discovery.md`)

---

## Table of Contents

1. [Current Architecture Assessment](#1-current-architecture-assessment)
2. [Evaluation of the Proposed Direction](#2-evaluation-of-the-proposed-direction)
3. [Recommended Architecture](#3-recommended-architecture)
4. [Layer Responsibilities](#4-layer-responsibilities)
5. [Interaction Lifecycle](#5-interaction-lifecycle)
6. [Interaction Snapshot Definition](#6-interaction-snapshot-definition)
7. [AI Intent Understanding Model](#7-ai-intent-understanding-model)
8. [Deterministic Semantic Classifier](#8-deterministic-semantic-classifier)
9. [Migration Strategy](#9-migration-strategy)
10. [Dependency Analysis](#10-dependency-analysis)
11. [Risk Assessment](#11-risk-assessment)
12. [Trade-off Analysis](#12-trade-off-analysis)
13. [Consistency Review](#13-consistency-review)

---

## 1. Current Architecture Assessment

### How interaction types are currently determined

Every content script independently classifies the interaction type at the
moment of capture, using DOM selectors and heuristic gate logic:

```
DOM Event → Content Script (selector matching + 8+ skip checks + 5-Gate tree)
  → Type determined HERE, at capture time
    → Typed message (CLICK_CAPTURED, SELECT_CAPTURED, etc.)
```

### Structural problems exposed by real-world validation

| Problem | Root Cause |
|---------|-----------|
| Date picker → Click/Select | Click and Select recorders don't know about date cells; Date picker cell selector too narrow |
| Dropdown → Click | Click recorder's skip list doesn't cover the dropdown's DOM pattern |
| Icons classified as "Italic Text" | Recorder sends `<i>` tag to AI; AI misinterprets |
| Ownership conflicts | Cross-recorder coordination via DOM attributes is fragile |
| Adding new types is expensive | Each new type requires skip rules in ALL existing recorders |

### Root cause analysis

The fundamental issue is **classification at capture time**. Each recorder
must:
1. Know its own domain (what to capture)
2. Know every other recorder's domain (what to skip)
3. Resolve ownership conflicts with other recorders
4. Apply type-specific heuristics

This creates O(n²) cross-recorder dependencies. Every new interaction type
increases the skip-rule surface area of every existing recorder.

### What works well (must preserve)

- The **generation pipeline** (Timeline → Steps → Execution JSON → Playwright)
  is clean, contract-based, and AI-free. No changes needed.
- The **Timeline** is immutable, typed, and well-structured.
- The **interaction type registry** cleanly separates per-type presentation
  (toPlainEnglish, executionExtras) from recording mechanics.
- The **locator resolution engine** is a pure function, fully decoupled.
- The **AI enrichment** during recording is async and non-blocking.

---

## 2. Evaluation of the Proposed Direction

### The proposed flow

```
Browser Events → Recorder → Interaction Snapshot → AI Intent → Deterministic Semantic → Timeline
```

### What is correct

1. **Separation of evidence collection from classification** — this is the
   core insight and it is correct. The recorder should capture, not classify.

2. **AI before deterministic classification** — AI should inform the
   deterministic classifier, not replace it. The final type must be
   deterministic.

3. **Interaction Snapshot as an intermediate representation** — this decouples
   the DOM event from the semantic decision.

### What needs refinement

**Issue 1: AI as a mandatory pipeline stage.**

The proposed flow shows AI as a required step between snapshot and classification.
This creates a hard dependency: if AI is unavailable, misconfigured, or too slow,
the pipeline stalls.

**Recommendation:** AI should be an **optional enhancement input** to the
deterministic classifier, not a mandatory pipeline stage. The classifier must
produce a correct result from evidence alone. AI improves accuracy but is not
required for function.

**Issue 2: Latency during live recording.**

The user sees the Interaction Timeline render in real time during recording.
If classification waits for AI (200ms–2s latency), the timeline freezes.

**Recommendation:** Two-phase classification:
- **Phase 1 (immediate):** Evidence-only deterministic classification. Fast
  (<5ms). May be imperfect. Displays immediately in the timeline.
- **Phase 2 (refined):** When AI responds, the classifier re-evaluates with
  AI hints. If the type changes, the timeline entry updates.

**Issue 3: Event coalescing is unspecified.**

A single user action (selecting a date from a calendar) generates multiple
browser events: mousedown, click, input change, blur. The proposed flow
doesn't address how these become one Interaction Snapshot.

**Recommendation:** An explicit **Snapshot Coalescer** that groups related
events within a temporal window into a single Interaction Snapshot.

**Issue 4: The proposed flow is linear but the real problem is fan-out.**

The flow shows one path, but the real issue is that the current architecture
has N parallel recorders each trying to classify. The fix isn't just reordering
— it's **consolidating** the recorders into one evidence collector.

### Verdict

The proposed direction is **technically sound and correct in principle**.
The refinements above make it production-viable:
- AI is optional, not mandatory
- Two-phase classification preserves live UX
- Explicit coalescing handles multi-event interactions
- Consolidated recorder eliminates cross-recorder dependencies

---

## 3. Recommended Architecture

### Architecture overview

```
┌──────────────────────────────────────────────────────┐
│                    RECORDING LAYER                       │
│                                                          │
│  ┌──────────────┐                                       │
│  │   Browser     │  click, change, focus, blur,         │
│  │   DOM Events  │  mouseenter, mouseleave, keydown     │
│  └──────┬───────┘                                       │
│         │                                                │
│         ▼                                                │
│  ┌──────────────┐                                       │
│  │   Evidence    │  ONE unified content script           │
│  │  Collector    │  Captures ALL events + DOM context    │
│  │ (content      │  NO classification, NO skip rules     │
│  │  script)      │  NO ownership checks                  │
│  └──────┬───────┘                                       │
│         │ raw evidence events                            │
│         ▼                                                │
│  ┌──────────────┐                                       │
│  │   Snapshot    │  Service worker                       │
│  │  Coalescer    │  Groups related events (temporal)     │
│  │               │  Deduplicates                         │
│  │               │  Enriches with before/after diffs     │
│  └──────┬───────┘                                       │
│         │ InteractionSnapshot                            │
│         ▼                                                │
│  ┌──────────────────────────────────┐                  │
│  │    Semantic Classifier (deterministic) │              │
│  │                                          │              │
│  │  ┌─────────────┐  ┌──────────────┐    │              │
│  │  │ Evidence     │  │ AI Intent     │    │              │
│  │  │ Rules        │  │ Hints         │    │              │
│  │  │ (REQUIRED)   │  │ (OPTIONAL)    │    │              │
│  │  └─────────────┘  └──────────────┘    │              │
│  │                                          │              │
│  │  Output: { type, confidence, snapshot } │              │
│  └──────────────────┬───────────────────┘              │
│                     │                                    │
│         ┌───────────┴───────────┐                       │
│         ▼ Phase 1 (immediate)   ▼ Phase 2 (refined)   │
│  ┌──────────────┐         ┌──────────────┐             │
│  │  Typed Event  │         │  AI Response  │             │
│  │  → Timeline   │         │  → Reclassify │             │
│  │  (best guess) │         │  → Update TL  │             │
│  └──────────────┘         └──────────────┘             │
└──────────────────────────────────────────────────────┘
         │
         ▼ Typed SessionEvent[] (Timeline — immutable once finalized)
┌──────────────────────────────────────────────────────┐
│                   GENERATION LAYER                     │
│  (UNCHANGED — Timeline → Steps → ExecJSON → Playwright) │
└──────────────────────────────────────────────────────┘
```

### Key design decisions

| Decision | Rationale |
|----------|-----------|
| ONE unified Evidence Collector | Eliminates 6 scripts, ~1200 lines of duplicated helpers, and ALL cross-recorder skip rules |
| Classification in service worker | Testable, no isolated-world constraints, access to full session context |
| AI is optional input | System degrades gracefully; no hard latency dependency |
| Two-phase classification | Phase 1 is instant (evidence rules); Phase 2 refines when AI responds |
| Evidence-only rules are primary | The classifier produces correct results without AI; AI improves accuracy on ambiguous cases |
| Timeline stores typed events | Downstream pipeline unchanged; generation sees the same SessionEvent[] shape |

---

## 4. Layer Responsibilities

### Layer 1: Evidence Collector (Content Script)

**Responsibility:** Capture raw browser events and DOM context.
**Does NOT:** Classify, skip, check ownership, determine interaction type.

| Aspect | Detail |
|--------|--------|
| Input | Browser DOM events (click, change, focus, blur, mouseenter, mouseleave, keydown) |
| Output | RawEvidence message to service worker |
| Events captured | ALL events on ALL elements — no filtering |
| Per event | eventType, target identity (18 fields), timestamp, dwell time (for mouse), focus duration (for focus/blur) |
| DOM context | Ancestor roles, aria attributes, container classes, nearby controls |
| Value tracking | Before/after snapshots of input values, checkbox states, CSS class lists |
| DOM observation | MutationObserver active during interaction windows |
| Ownership | NONE — no data-cmdrunner-handled attributes |

**Why one script instead of six:**
The current six scripts each contain ~200 lines of identical helpers
(computeAccessibleName, generateCssSelector, generateXPath, checkRecording).
One script eliminates this duplication. More importantly, one script eliminates
the coordination problem: no skip rules, no ownership claims, no cross-recorder
dependencies.

**Self-containment preserved:** Content scripts run in an isolated world.
The Evidence Collector remains self-contained (all helpers inlined). But there
is only ONE copy of each helper instead of six.

### Layer 2: Snapshot Coalescer (Service Worker)

**Responsibility:** Group related raw evidence events into coherent
Interaction Snapshots. Deduplicate. Enrich with computed evidence.

| Aspect | Detail |
|--------|--------|
| Input | Stream of RawEvidence messages from content script |
| Output | InteractionSnapshot (one per user action) |
| Coalescing window | Events within 500ms on the same element (or ancestor) are grouped |
| Dedup rule | mousedown + click on same element → one snapshot (not two) |
| Value enrichment | Computes before/after value diffs from captured snapshots |
| State enrichment | Computes checkbox/radio state transitions |
| DOM enrichment | Summarizes MutationRecords into semantic change descriptions |
| Navigation | Handles chrome.webNavigation events as a separate evidence source |

**Coalescing examples:**

| User Action | Browser Events | Coalesced Into |
|-------------|---------------|----------------|
| Click a button | mousedown + click | 1 snapshot (eventType: click) |
| Select date from calendar | mousedown + click + input.change + blur | 1 snapshot (eventType: click + valueChange) |
| Type in text field | focus + 5×input + blur | 1 snapshot (eventType: text + valueChange) |
| Toggle checkbox | mousedown + click + change | 1 snapshot (eventType: change + stateChange) |
| Hover over menu | mouseenter + (500ms dwell) + DOM mutation + mouseleave | 1 snapshot (eventType: hover + domMutation) |

### Layer 3: Semantic Classifier (Service Worker, Deterministic)

**Responsibility:** Assign the final interaction type to each Interaction
Snapshot. Deterministic rules, optionally informed by AI.

| Aspect | Detail |
|--------|--------|
| Input | InteractionSnapshot (+ optional AI hints) |
| Output | ClassifiedInteraction { type, subType?, confidence, snapshot } |
| Rules engine | Ordered priority rules (see §8 for full rule set) |
| AI integration | AI hints adjust rule confidence but do not override evidence |
| Fallback | If no rule matches → type = 'click' (same as current behavior) |
| No-AI mode | Works identically without AI (evidence rules alone) |

### Layer 4: AI Intent Service (Optional, Async)

**Responsibility:** Understand user intent from the Interaction Snapshot.
Return structured hints to the classifier.

| Aspect | Detail |
|--------|--------|
| Input | InteractionSnapshot (semantic fields only — no raw selectors) |
| Output | { suggestedType, businessName, userIntent, confidence } |
| Timing | Async (200ms–2s). Does not block Phase 1 classification. |
| Unavailable | Classifier proceeds with evidence-only rules |
| Cost | One call per coalesced interaction (same frequency as current) |

### Layer 5: Timeline (Unchanged)

SessionEvent[] with typed entries. Immutable once stored. Same shape as current.
The only difference: events may be updated once (Phase 1 → Phase 2 reclassification)
before the recording session ends.

### Layers 6-8: Generation Pipeline (Unchanged)

CanonicalStepGenerator → ExecutionJsonGenerator → PlaywrightGenerator.
No changes. The generation pipeline sees the same typed SessionEvent[] it
always has.

---

## 5. Interaction Lifecycle

### Complete lifecycle (new architecture)

```
1. User performs action on web page
2. Browser fires DOM events (click, change, focus, mouseenter, etc.)
3. Evidence Collector captures all events + DOM context
4. Evidence Collector sends RawEvidence messages to service worker
5. Snapshot Coalescer groups events into InteractionSnapshot
6. Semantic Classifier (Phase 1 — immediate):
   a. Applies evidence rules to InteractionSnapshot
   b. Assigns interaction type (e.g., 'dateSelect')
   c. Creates typed SessionEvent
   d. Appends to Timeline
   e. Triggers screenshot
   f. Timeline renders in side panel
7. AI Intent Service (Phase 2 — async, when configured):
   a. Receives InteractionSnapshot
   b. Returns intent hints (suggestedType, businessName, confidence)
   c. Semantic Classifier re-evaluates with AI hints
   d. If type changes: updates Timeline entry
   e. If type stays: enriches with businessName/userIntent
8. (On Stop Recording) Generation Pipeline runs (UNCHANGED):
   a. Reads frozen Timeline
   b. Generates Canonical Steps
   c. Generates Execution JSON
   d. Generates Playwright code
```

### Timing diagram

```
Time →
0ms      5ms       10ms        200ms-2s
│        │          │            │
▼        ▼          ▼            ▼
Event    Snapshot   Phase 1      Phase 2
fired    built      classified   (AI refines)
                    → Timeline   → Timeline
                      renders     updates
```

### Navigation lifecycle (unchanged)

```
chrome.webNavigation.onCommitted
  → Evidence Coalescer creates navigation snapshot
  → Classifier assigns type = 'navigation'
  → Timeline entry
```

---

## 6. Interaction Snapshot Definition

The Interaction Snapshot is the central data structure that decouples evidence
collection from semantic classification.

### Structure

```typescript
interface InteractionSnapshot {
  // ── Identity (existing 18-field ElementIdentity) ──
  identity: ElementIdentity;

  // ── Event Evidence ──
  primaryEvent: {
    type: 'click' | 'change' | 'focus' | 'blur' | 'mouseenter' | 'mouseleave' | 'keydown';
    timestamp: string;
    isTrusted: boolean;
  };
  secondaryEvents: Array<{
    type: string;
    timestamp: string;
  }>;

  // ── Value Evidence ──
  valueChange?: {
    before: string;
    after: string;
    inputType: string;        // 'text', 'date', 'checkbox', 'select-one', etc.
    isDateLike: boolean;      // did the value change to a date format?
  };

  // ── State Evidence ──
  stateChange?: {
    property: 'checked' | 'aria-checked' | 'aria-pressed' | 'aria-selected';
    before: string;
    after: string;
  };

  // ── CSS Class Evidence ──
  classChange?: {
    added: string[];
    removed: string[];
    selectionPattern: boolean;  // did 'selected'|'active'|'checked' class appear?
  };

  // ── DOM Context Evidence ──
  ancestorContext: {
    roles: string[];            // ['grid', 'listbox', 'menu', 'dialog', 'combobox']
    containerClasses: string[]; // classes containing 'calendar', 'datepicker', 'dropdown'
    hasCalendarAncestor: boolean;
    hasListboxAncestor: boolean;
    hasMenuAncestor: boolean;
    hasDialogAncestor: boolean;
  };

  // ── ARIA Evidence ──
  ariaAttributes: {
    role: string | null;
    ariaLabel: string | null;
    ariaHasPopup: string | null;
    ariaSelected: string | null;
    ariaChecked: string | null;
    ariaPressed: string | null;
    ariaExpanded: string | null;
  };

  // ── Behavioral Evidence ──
  dwellTime?: number;           // ms between mouseenter and mouseleave/click
  focusDuration?: number;       // ms between focus and blur
  keyEvents?: string[];         // ['Enter', 'Space', 'Escape', 'Tab']

  // ── DOM Mutation Evidence ──
  domMutations?: {
    childListChanges: number;   // count of added/removed child nodes
    attributeChanges: number;   // count of attribute changes
    visibilityChanges: number;  // elements that became visible/hidden
    observedWindow: number;     // ms the observer was active
  };

  // ── Temporal Context ──
  precedingSnapshotType?: string;  // type of the previous interaction (if any)
  timestamp: string;
}
```

### What the Snapshot enables

The classifier can answer questions like:
- "Did an input value change?" → `valueChange`
- "Did the value change to a date?" → `valueChange.isDateLike`
- "Is this inside a calendar?" → `ancestorContext.hasCalendarAncestor`
- "Is this a checkbox that toggled?" → `stateChange.property === 'checked'`
- "Did CSS selection state change?" → `classChange.selectionPattern`
- "Was this a meaningful hover?" → `dwellTime > 500 && domMutations.visibilityChanges > 0`
- "Did the user type into a field?" → `focusDuration > 0 && valueChange && !primaryEvent.type === 'click'`

These questions replace the current architecture's 8 skip rules, 5 ownership
checks, and 6 specialized gate trees.

---

## 7. AI Intent Understanding Model

### What changes from current AI integration

| Aspect | Current | Recommended |
|--------|---------|-------------|
| When AI is called | After classification (enrichment only) | Before final classification (informs type) |
| What AI receives | { actionType, text, tag, role, className } | InteractionSnapshot (semantic subset) |
| What AI returns | { businessName, controlType, userIntent, confidence } | { suggestedType, businessName, userIntent, confidence } |
| Impact on type | None (type already determined) | Adjusts confidence; may trigger reclassification |
| If AI is unavailable | No enrichment (display name falls back) | Classifier uses evidence-only rules (fully functional) |

### What AI receives (semantic subset)

```typescript
interface SnapshotForAI {
  // Element semantics (NOT raw selectors)
  tagName: string;
  accessibleName: string;
  ariaRole: string | null;
  className: string | null;

  // Behavioral context
  primaryEvent: string;         // 'click', 'change', 'mouseenter'
  valueChanged: boolean;
  valueAfter: string;           // the new value (for understanding intent)
  stateChanged: boolean;
  dwellTime: number | null;

  // Structural context
  ancestorRoles: string[];      // ['grid', 'menu', 'listbox', 'dialog']
  hasCalendarContext: boolean;
  hasDropdownContext: boolean;
  hasFormContext: boolean;

  // Preceding interaction (for sequence understanding)
  precedingType: string | null;
}
```

**NOT sent to AI:** CSS selectors, XPath, element IDs, test attributes, iframe
context, shadow DOM details. AI understands intent from semantics, not from
DOM mechanics. This is consistent with the design principle: "AI should
understand the user's intent rather than browser mechanics."

### What AI returns

```typescript
interface AIIntentResult {
  suggestedType: InteractionType;  // 'click' | 'hover' | 'text' | 'select' | ...
  businessName: string;            // "Departure Date"
  userIntent: string;             // "Select a departure date for the flight"
  confidence: number;             // 0.0 - 1.0
}
```

### How AI hints are used by the classifier

AI hints do NOT override evidence. They adjust the classification as follows:

1. If evidence rules produce a clear answer (confidence ≥ 0.9), AI is
   informational only (used for businessName enrichment).

2. If evidence rules are ambiguous (confidence 0.5–0.9), AI suggestedType
   breaks the tie.

3. If evidence rules produce no match (confidence < 0.5, fallback to 'click'),
   AI suggestedType is used if confidence ≥ 0.7.

4. If AI is unavailable, the evidence-only classification stands. This is
   the baseline — the system is fully functional without AI.

---

## 8. Deterministic Semantic Classifier

The classifier applies ordered priority rules to each InteractionSnapshot.
Each rule tests evidence conditions and produces a typed result with confidence.

### Rule set (ordered by priority)

```
Rule 1: NAVIGATION
  IF primaryEvent.type = 'navigation'
  THEN type = 'navigation', confidence = 1.0

Rule 2: TEXT ENTRY
  IF primaryEvent.type = 'blur'
     AND valueChange exists
     AND valueChange.after is non-empty
     AND identity.tag = 'INPUT' or 'TEXTAREA'
     AND valueChange.inputType ∈ {text, email, password, search, tel, url, number}
  THEN type = 'text', confidence = 0.95

Rule 3: DATE SELECTION (value outcome)
  IF valueChange exists
     AND valueChange.isDateLike = true
  THEN type = 'dateSelect', confidence = 0.95

Rule 4: DATE SELECTION (calendar context)
  IF primaryEvent.type = 'click'
     AND ancestorContext.hasCalendarAncestor = true
     AND (identity has date-like aria-label OR identity has date-like text)
  THEN type = 'dateSelect', confidence = 0.90

Rule 5: CHECKBOX TOGGLE
  IF stateChange exists
     AND stateChange.property ∈ {checked, aria-checked}
     AND identity.ariaRole ∈ {checkbox, menuitemcheckbox, switch}
  THEN type = 'checkbox', confidence = 0.95

Rule 6: RADIO SELECTION
  IF stateChange exists
     AND stateChange.property ∈ {checked, aria-checked}
     AND identity.ariaRole ∈ {radio, menuitemradio}
  THEN type = 'radio', confidence = 0.95

Rule 7: SELECT (native)
  IF primaryEvent.type = 'change'
     AND identity.tag = 'SELECT'
  THEN type = 'select', confidence = 1.0

Rule 8: SELECT (ARIA option)
  IF primaryEvent.type = 'click'
     AND identity.ariaRole = 'option'
     AND ancestorContext.hasListboxAncestor = true
  THEN type = 'select', confidence = 0.95

Rule 9: SELECT (ARIA menu item)
  IF primaryEvent.type = 'click'
     AND identity.ariaRole = 'menuitem'
     AND ancestorContext.hasMenuAncestor = true
  THEN type = 'select', confidence = 0.90

Rule 10: SELECT (segmented control)
  IF primaryEvent.type = 'click'
     AND stateChange.property = 'aria-pressed'
     AND element has aria-pressed siblings (mutually exclusive group)
  THEN type = 'select', confidence = 0.85

Rule 11: SELECT (CSS class differential)
  IF primaryEvent.type = 'click'
     AND classChange.selectionPattern = true
     AND element has siblings with same class pattern
     AND NOT matched by Rules 3-10
  THEN type = 'select', confidence = 0.70

Rule 12: HOVER
  IF primaryEvent.type = 'mouseenter'
     AND dwellTime ≥ 500ms
     AND (domMutations.visibilityChanges > 0 OR domMutations.childListChanges > 0)
  THEN type = 'hover', confidence = 0.90

Rule 13: CLICK (fallback)
  IF primaryEvent.type = 'click'
     AND NOT matched by any rule above
  THEN type = 'click', confidence = 0.50

Rule 14: DEFAULT FALLBACK
  THEN type = 'click', confidence = 0.30
```

### Rule design principles

1. **Highest-specificity rules first.** Value-outcome detection (Rule 3) is
   more reliable than CSS-class matching (Rule 11), so it's checked first.

2. **Each rule is independently testable.** Given a snapshot, the output is
   deterministic. No cross-rule side effects.

3. **Adding a new interaction type = adding new rules.** No existing rules
   change. No content script changes. New type is purely additive.

4. **Confidence is explicit.** The classifier always reports how confident
   it is. AI refinement uses this to decide whether to override.

5. **Evidence-only baseline.** Without AI, the rules still produce correct
   classifications for the vast majority of cases. AI improves edge cases.

### How this eliminates current problems

| Current Problem | How New Architecture Resolves It |
|-----------------|----------------------------------|
| Date picker → Click | Rule 3 (value outcome) or Rule 4 (calendar context) fire before Rule 13 (click fallback) |
| Dropdown → Click | Rule 8/9/10/11 fire before Rule 13 |
| Icons → "Italic Text" | AI receives `tagName: 'I'` + `className` context → returns proper businessName; or icon guard in classifier |
| Ownership conflicts | No ownership protocol exists — one collector captures everything |
| Adding new types | Add new rules to classifier; no content script changes |
| Cross-recorder skip rules | Eliminated — one collector, no skipping |

---

## 9. Migration Strategy

### Guiding principles

1. **No big-bang rewrite.** Migrate incrementally, with the system functional
   at every step.
2. **Parallel operation.** New and old systems can run side-by-side during
   migration, with feature flags controlling which path is active.
3. **Preserve all frozen contracts.** Timeline shape, generation pipeline,
   execution JSON — all unchanged.
4. **Test each layer independently.** Evidence Collector, Coalescer, and
   Classifier are each unit-testable in isolation.

### Migration phases

#### Phase M1: Build the Semantic Classifier (no content script changes)

Build the classifier as a pure function: `classify(snapshot): ClassifiedInteraction`.
Write unit tests that feed it snapshots matching each interaction type.
The classifier is not wired into the live system yet.

**Risk:** Low. New code, no existing code touched.
**Exit criteria:** All interaction types classifiable from snapshot input.

#### Phase M2: Build the Snapshot Coalescer (no content script changes)

Build the coalescer as a service-worker module: receives raw evidence,
outputs InteractionSnapshot. Unit-testable with synthetic evidence streams.

**Risk:** Low. New code, no existing code touched.
**Exit criteria:** Coalescer correctly groups events for all interaction types.

#### Phase M3: Build the Evidence Collector (new content script)

Build a new unified content script that captures all events. It runs ALONGSIDE
existing content scripts (both are registered in manifest.json). The new script
sends evidence to the service worker but does NOT affect the Timeline.

**Risk:** Medium. New content script running on all pages. Must not interfere
with existing scripts. Use a feature flag to disable it by default.
**Exit criteria:** Evidence Collector captures all events correctly. Verified
by logging, not by Timeline output.

#### Phase M4: Wire the new pipeline (feature-flagged)

Connect Evidence Collector → Coalescer → Classifier → Timeline. This path is
controlled by a feature flag (`useUnifiedRecorder: boolean` in storage).
When enabled, the new path produces Timeline entries. When disabled, the
existing 6 content scripts operate as before.

**Risk:** High. This is the cutover point. The Timeline may receive duplicate
entries (from both old and new paths) if the feature flag is misconfigured.
Mitigation: when the flag is on, suppress all old content script messages.

**Exit criteria:** With flag enabled, all interaction types record correctly
through the new pipeline. With flag disabled, existing behavior is unchanged.

#### Phase M5: AI integration refinement

Wire the AI Intent Service to feed hints to the classifier (Phase 2 refinement).
The existing AIService.understand() call is repurposed — it receives snapshot
data instead of post-classification identity.

**Risk:** Medium. AI prompt changes. Must preserve existing provider interface.
**Exit criteria:** AI hints improve classification accuracy on edge cases.
Without AI, evidence-only rules still produce correct results.

#### Phase M6: Remove old content scripts

Delete the 6 specialized content scripts and their skip rules. Remove old
message handler cases from the service worker. Update manifest.json.

**Risk:** Medium. Removing code that has been running in production. Must
verify no regression.
**Exit criteria:** Old scripts removed. Full test suite passes. Real-world
validation on Adani One and OrangeHRM confirms correct behavior.

### What does NOT change during migration

- `src/shared/types.ts` — SessionEvent union, ElementIdentity (unchanged shape)
- `src/recorder/interaction-types.ts` — Registry configs (unchanged)
- `src/recorder/recording-session.ts` — Session management (unchanged)
- `src/generation/` — All generators (unchanged)
- `src/generation/playwright-generator.ts` — Playwright generation (unchanged)
- All frozen B1-B8, C3-C6 product decisions (unchanged)

### Estimated file changes

| Phase | Files Created | Files Modified | Files Deleted |
|-------|--------------|----------------|---------------|
| M1 | classifier.ts, classifier.test.ts | — | — |
| M2 | snapshot-coalescer.ts, coalescer.test.ts | — | — |
| M3 | evidence-collector.ts (content script) | manifest.json (add entry) | — |
| M4 | pipeline wiring in service-worker.ts | service-worker.ts, storage keys | — |
| M5 | — | ai-understanding.ts, classifier.ts | — |
| M6 | — | manifest.json, service-worker.ts | 6 old content scripts |

---

## 10. Dependency Analysis

### Current dependency graph

```
6 Content Scripts ──(skip rules)──→ Each Other
       │
       ├──(messages)──→ Service Worker
       │                      │
       │                      ├──(processAction)──→ Recording Session
       │                      ├──(AI)────────────→ AI Service
       │                      └──(screenshot)────→ Screenshot Service
       │
       └──(duplicated helpers)──→ Self-contained copies
```

**Problem:** O(n²) cross-recorder dependencies. 6 scripts × 5 other scripts = 30
coordination points.

### Recommended dependency graph

```
1 Evidence Collector ──(raw evidence)──→ Snapshot Coalescer
                                              │
                                              ├──(snapshot)──→ Semantic Classifier
                                              │                      │
                                              │                      ├──(evidence rules)──→ Self
                                              │                      ├──(AI hints)────────→ AI Service (optional)
                                              │                      └──(typed event)─────→ Recording Session
                                              │
                                              └──(navigation)────────→ Recording Session
```

**Improvement:** Linear data flow. Zero cross-component skip rules. One
content script with one copy of each helper. Adding interaction types adds
classifier rules — no new content scripts, no new skip rules.

### Coupling assessment

| Component | Current Coupling | Recommended Coupling |
|-----------|-----------------|---------------------|
| Content scripts → Each other | HIGH (skip rules, ownership) | ZERO (one script) |
| Content scripts → Service worker | MEDIUM (6 message types) | LOW (1 message type: raw evidence) |
| Classifier → Content scripts | N/A (classification IN scripts) | ZERO (classifier sees snapshots, not scripts) |
| Classifier → AI | N/A (AI post-classification) | LOW (optional input) |
| Generation → Recording | LOW (contract-based) | LOW (unchanged) |
| Adding new type | 8+ files modified | 1 file modified (classifier rules) |

---

## 11. Risk Assessment

### High risks

**R1: Classification latency during live recording.**
The user sees the Timeline render in real time. Evidence-only Phase 1
classification must be fast (<10ms) to avoid perceptible lag.
*Mitigation:* Phase 1 rules are simple property checks — no DOM queries,
no async operations. Benchmarked to be <5ms.

**R2: Event coalescing correctness.**
Grouping multiple browser events into one snapshot is the most complex new
logic. Incorrect coalescing could merge separate interactions or split one.
*Mitigation:* Comprehensive unit tests for coalescing. Temporal window
(500ms) + element-identity matching. Conservative merging (when in doubt,
keep separate).

**R3: Hover detection without dedicated recorder.**
The current hover recorder is 1561 lines of complex MutationObserver +
visibility transition logic. Moving this into the evidence/coalescer model
is non-trivial.
*Mitigation:* The Evidence Collector captures MutationObserver data. The
classifier's Rule 12 evaluates hover evidence. The visibility-transition
algorithm moves into the Evidence Collector's DOM observation module. The
logic is preserved — only its location changes.

**R4: Regression on existing validated interactions.**
Adani One (hover + click + navigation) and OrangeHRM (dropdown + menu items)
have been manually validated. The migration must not break these.
*Mitigation:* Feature flag allows A/B testing old vs new pipeline. M4
validates on both apps before M6 removes old code.

### Medium risks

**R5: AI prompt changes affect all interaction types.**
Currently, AI uses one generic prompt. In the new architecture, AI receives
snapshot data (richer context). The prompt must be redesigned.
*Mitigation:* M5 is dedicated to AI integration. Prompt changes are tested
against all interaction types. Without AI, the system works (evidence-only).

**R6: Snapshot data size.**
InteractionSnapshots carry more data than current messages. Memory and
messaging overhead increases.
*Mitigation:* Snapshots are transient (processed and discarded). Only the
final typed SessionEvent is persisted. Trim snapshot fields that the
classifier doesn't use.

**R7: Two-phase classification may confuse users.**
If Phase 1 shows "Click" and Phase 2 reclassifies to "Select Date", the
Timeline flickers.
*Mitigation:* Phase 1 evidence rules are accurate enough that reclassification
is rare (<5% of cases). When it happens, it's a visual refinement, not a
jarring change. The display name enrichment (businessName) is the more
common Phase 2 update.

### Low risks

**R8: Migration period complexity.**
Two pipelines running in parallel increases code complexity temporarily.
*Mitigation:* Feature flag is binary. No partial migration states. M6
removes old code promptly after validation.

**R9: Manifest content script changes.**
Adding/removing content script entries affects all pages.
*Mitigation:* M3 adds the new script alongside existing ones. M6 removes
old ones only after validation.

---

## 12. Trade-off Analysis

### What we gain

| Gain | Impact |
|------|--------|
| Eliminated cross-recorder skip rules | 8 skip checks × 6 scripts = 48 coordination points → 0 |
| Single helper codebase | ~1200 lines of duplicated code eliminated |
| New types are additive | Add classifier rules, not content scripts |
| Richer AI context | AI sees value changes, state changes, DOM context — not just tag+role |
| Evidence-only baseline | System works without AI (graceful degradation) |
| Testable classification | Classifier is a pure function — unit testable without browser |
| Simpler mental model | One collector → one coalescer → one classifier → one timeline |

### What we trade

| Trade-off | Cost |
|-----------|------|
| One large content script | Replaces 6 medium scripts. Organized internally by concern. |
| Classification moves to service worker | Content script is thinner but service worker is heavier |
| Phase 1 may misclassify edge cases | Corrected in Phase 2 (AI) or by rule refinement. Current architecture also misclassifies (that's why we're here). |
| Migration period with two pipelines | Temporary complexity. Feature flag controls. Resolved in M6. |
| Event coalescing is new complexity | Replaces ownership protocol complexity. Net reduction. |

### What stays the same

- User-facing behavior (Timeline, Canonical Steps, Playwright code)
- Generation pipeline (all 3 generators, contracts, registry)
- Frozen product decisions (B1-B8, C3-C6)
- Locator resolution strategy (B4.4)
- Execution JSON contract (B5.2)
- Timeline immutability (B3)
- AI provider interface (6 providers)

---

## 13. Consistency Review

### Against Product Foundation (spec.md, architecture.md)

| Frozen Decision | Consistent? | Notes |
|-----------------|-------------|-------|
| Manifest V3 Chrome Extension | ✅ | One content script instead of 6, still MV3 |
| Side Panel as primary UI | ✅ | Timeline rendering unchanged |
| chrome.storage.local for state | ✅ | Feature flag stored in storage |
| Modular folder structure | ✅ | New modules follow existing structure |

### Against B1 (Artifact Generation Design)

| Frozen Decision | Consistent? | Notes |
|-----------------|-------------|-------|
| Generation order: Timeline → Steps → JSON → Playwright | ✅ | Generation pipeline untouched |
| Canonical Steps + Exec JSON = source of truth | ✅ | Same inputs to generators |
| 1:1 mapping (Step → Exec Object → Playwright) | ✅ | Timeline events still 1:1 |
| Timeline immutability | ✅ | Two-phase update happens BEFORE Stop; after Stop, immutable |
| AI-free generation | ✅ | AI is in recording layer, not generation |

### Against B2 (Artifact Generation Architecture)

| Frozen Decision | Consistent? | Notes |
|-----------------|-------------|-------|
| GenerationEngine as sole orchestrator | ✅ | Unchanged |
| Generator contracts (pure functions) | ✅ | Unchanged |
| Batch persistence | ✅ | Unchanged |
| Extension by addition (registry) | ✅ | Unchanged |

### Against B4.1-B4.5 (Execution Model)

| Frozen Decision | Consistent? | Notes |
|-----------------|-------------|-------|
| Three sources of truth | ✅ | Timeline still feeds Steps |
| Execution JSON 6-section contract | ✅ | Unchanged |
| Locator resolution priority | ✅ | Unchanged |

### Against B5.1-B5.3 (Execution JSON)

| Frozen Decision | Consistent? | Notes |
|-----------------|-------------|-------|
| Locator Resolution Engine (pure function) | ✅ | Unchanged |
| Per-step error isolation | ✅ | Unchanged |
| Validation rules VR-1 through VR-13 | ✅ | Unchanged |

### Against B6 (Playwright Generator)

| Frozen Decision | Consistent? | Notes |
|-----------------|-------------|-------|
| translateLocator / translateAction | ✅ | Unchanged |
| iframe frameLocator prefixing | ✅ | Unchanged |

### Against B7.1-B7.2 (Readability Optimizer)

| Frozen Decision | Consistent? | Notes |
|-----------------|-------------|-------|
| OR-1 merge rule | ✅ | Still operates on Timeline; same composite key |
| Readability touches plainEnglish only | ✅ | Unchanged |

### Against B8 (Validation Framework)

| Frozen Decision | Consistent? | Notes |
|-----------------|-------------|-------|
| 15 workflow categories | ✅ | All still testable |
| 9 defect classification codes | ✅ | Same categories apply |

### Against C3 (Hover)

| Frozen Decision | Consistent? | Notes |
|-----------------|-------------|-------|
| Hover = dwell + observable behavior | ✅ | Classifier Rule 12 implements same logic |
| DWELL_THRESHOLD = 500ms | ✅ | Configurable constant in classifier |
| 6-Gate decision tree | ✅ | Gates become evidence fields in snapshot; classifier applies same checks |
| Visibility transition detection | ✅ | Algorithm moves to Evidence Collector's DOM observer |

### Against C4 (Checkbox/Radio)

| Frozen Decision | Consistent? | Notes |
|-----------------|-------------|-------|
| State-based, not click-based | ✅ | Classifier Rules 5-6 check stateChange evidence |
| 5-Gate decision tree | ✅ | Gates become evidence checks in classifier |
| Ownership priority over Click | ✅ | Classifier rules 5-6 fire before rule 13 (click fallback) |

### Against C5 (Dropdown/Select)

| Frozen Decision | Consistent? | Notes |
|-----------------|-------------|-------|
| One interaction type 'select' | ✅ | Classifier produces 'select' type |
| Record only meaningful value changes | ✅ | Classifier checks valueChange/stateChange evidence |
| 5-Gate decision tree | ✅ | Gates become evidence checks in classifier |
| Unified Canonical Step "Select X" | ✅ | toPlainEnglish unchanged in registry |

### Against C6 (Date Picker)

| Frozen Decision | Consistent? | Notes |
|-----------------|-------------|-------|
| One interaction type 'dateSelect' | ✅ | Classifier produces 'dateSelect' type |
| Value-outcome model | ✅ | Classifier Rule 3 checks valueChange.isDateLike |
| 5-Gate decision tree | ✅ | Gates become evidence checks in classifier |
| Distinct execution verb | ✅ | mapActionType unchanged |
| Sub-type Canonical Steps | ✅ | toPlainEnglish unchanged in registry |

### Overall consistency verdict

**All frozen decisions are preserved.** The recommended architecture changes
only the RECORDING LAYER — how events enter the Timeline. Everything downstream
(Timeline shape, generation pipeline, artifact contracts, locator resolution,
Playwright generation) is untouched. The frozen C-series product rules
(gate trees, canonical step formats, ownership priorities, execution verbs)
are all expressible as classifier rules operating on snapshot evidence.

---

## Summary

### The problem

Interaction type classification happens at capture time inside 6 independent
content scripts, each with knowledge of every other script's domain. This
creates O(n²) cross-recorder complexity that scales poorly and produces
real-world misclassifications.

### The solution

Separate evidence collection from classification:
1. **One Evidence Collector** captures all browser events + DOM context
2. **Snapshot Coalescer** groups related events into rich evidence bundles
3. **Deterministic Semantic Classifier** assigns interaction type from evidence
   rules, optionally enhanced by AI intent hints
4. **Timeline** stores typed events (unchanged shape)
5. **Generation Pipeline** produces artifacts (unchanged)

### Why this is better

- Adding a new interaction type = adding classifier rules (one file, additive)
- Zero cross-recorder dependencies (one collector, no coordination)
- AI is optional enhancement (evidence-only baseline works without AI)
- ~1200 lines of duplicated helpers eliminated
- Classification is a pure function — fully unit-testable
- All frozen product decisions and architectural contracts preserved
