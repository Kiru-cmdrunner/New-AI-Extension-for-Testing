# Architecture C — Production Blueprint

**Status:** Canonical target architecture — approved direction
**Date:** 2026-07-17
**Supersedes:** Phase 2 recommendation (`.drytis/specs/phase2-semantic-interaction-architecture.md`) — that document was an architecture *recommendation*. This document is the *production blueprint* derived from it, expanded with the AI Philosophy (P1–P8), Session Context architecture, and full component lifecycle definitions.
**Current version:** 6.1.0

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Architectural Principles](#2-architectural-principles)
3. [Architecture Overview](#3-architecture-overview)
4. [Layer 1 — Universal Interaction Observer](#4-layer-1--universal-interaction-observer)
5. [Layer 2 — Snapshot Coalescer](#5-layer-2--snapshot-coalescer)
6. [Layer 3 — Semantic Classifier](#6-layer-3--semantic-classifier)
7. [Layer 4 — AI Observer](#7-layer-4--ai-observer)
8. [Layer 5 — Session Context](#8-layer-5--session-context)
9. [Layer 6 — Timeline](#9-layer-6--timeline)
10. [Layer 7 — Generation Pipeline](#10-layer-7--generation-pipeline)
11. [Supporting Layer — Infrastructure](#11-supporting-layer--infrastructure)
12. [The Interaction Lifecycle](#12-the-interaction-lifecycle)
13. [Data Structures](#13-data-structures)
14. [Component Inventory — Reuse, Replace, Create](#14-component-inventory--reuse-replace-create)
15. [Dependency Graph](#15-dependency-graph)
16. [Trade-off Analysis](#16-trade-off-analysis)
17. [Consistency Review Against Frozen Decisions](#17-consistency-review-against-frozen-decisions)
18. [Current Limitations and Future Phases](#18-current-limitations-and-future-phases)

---

## 1. Executive Summary

### What this document defines

Architecture C is a **capture-first, classify-second** design for the CmdRunner Smart Recorder. It replaces the current six-content-script + heuristic-classification model with a single universal observer that collects evidence, a centralized multi-tier classifier that determines interaction type from that evidence, and an AI Observer that participates as a first-class reasoning partner.

### Why the architecture changed

The current architecture (v6.1.0) classifies interaction types **at capture time** inside six concurrent content scripts. Each script must know its own domain and every other script's domain, creating O(n²) cross-script coordination. Classification happens with the weakest available evidence — CSS selectors — before state changes are observable, before AI responds, and without page context. Misclassifications are **irreversible** because the post-recording classifier only has the frozen element snapshot.

Architecture C separates evidence collection from classification:

```
Current:   6 scripts (capture + classify) → AI (decorative) → post-hoc classifier (identity mapping)
                    ↓
Architecture C:  1 observer (capture only) → coalescer → multi-tier classifier (deterministic + behavioral + AI advisory)
```

### What changes

| Area | Current (v6.1.0) | Architecture C |
|------|-------------------|----------------|
| Content scripts | 6 specialized scripts with skip rules | 1 universal observer, no skipping |
| Classification timing | At capture time (synchronous, irreversible) | After evidence collection (deferred, revisable) |
| Classification evidence | CSS selectors, ARIA roles | DOM structure + behavioral state changes + AI intent + session context |
| AI role in classification | Decorative (enrichment metadata only) | Structural (Tier 3 advisory classification) |
| Adding a new interaction type | New content script + skip rules in all others + registry + generator changes | New classifier rules (one file, additive) |
| Recovery from misclassification | Impossible (frozen at capture) | Possible (multi-tier, revisable, deferred) |

### What does NOT change

The entire generation pipeline — canonical-step generation, semantic templates, verb mapping, execution JSON, locator resolution, Playwright generation — is **unchanged**. Architecture C modifies only the recording layer: how events enter the Timeline. Everything downstream sees the same typed `SessionEvent[]` it always has.

---

## 2. Architectural Principles

These principles are the foundational design decisions. Every component in this architecture derives from them.

### AP1 — Separation of Evidence and Classification

The observer captures; the classifier decides. No component that touches the DOM makes a type determination. This is the single most important principle — it is why every other problem the current architecture has exists (classification at capture time with insufficient evidence) and why Architecture C resolves them.

**Rationale:** Classification is a reasoning task. Reasoning requires evidence. Capture time is the moment of *least* evidence — the `change` event hasn't fired, the calendar hasn't appeared, the AI hasn't responded. Deferring classification to after evidence collection is structurally correct, not merely convenient.

**Trade-off accepted:** Slightly higher latency (~5–10ms for Phase 1, ~200–500ms for Phase 2 AI). This is imperceptible to users and far less costly than misclassification.

### AP2 — Graceful Degradation

The system produces correct results without AI. AI improves accuracy on ambiguous cases but is never a hard dependency.

**Rationale:** LLM latency (200ms–2s), cost, and availability are variable. A recorder that stops working when AI is unavailable or misconfigured is unacceptable. The deterministic tiers (Tier 1 + Tier 2) handle the vast majority of interactions correctly. AI (Tier 3) handles the long tail.

**Trade-off accepted:** Without AI, ambiguous interactions (custom dropdowns with no ARIA, unconventional date pickers) may be classified as generic clicks — same as today. But this is the floor, not the ceiling. The current architecture has this same floor with no ceiling.

### AP3 — Progressive Classification

Classification happens in phases. Each phase uses the best available evidence at that moment. Earlier classifications are revisable by later phases.

- **Phase 1 (immediate, <10ms):** Deterministic evidence rules. Timeline renders immediately.
- **Phase 2 (async, ~200–500ms):** AI advisory refinement. Timeline updates if type changes.
- **Phase 3 (on Stop):** Full re-classification with complete timeline context.

**Rationale:** Users expect real-time timeline updates during recording. But the richest evidence (AI understanding, behavioral outcomes, page context) arrives asynchronously. Two-phase classification gives users instant feedback while allowing the system to refine its understanding as more evidence arrives.

**Trade-off accepted:** Rare cases (<5% estimated) where the timeline briefly shows one type then updates to another (e.g., "Click" → "Select Date" after AI responds). This is a visual refinement, not a jarring change. The more common Phase 2 update is name enrichment (raw tag → AI business name), which is natural.

### AP4 — Evidence Sovereignty

Deterministic evidence always overrides AI. When deterministic rules produce a clear answer (confidence ≥ 0.9), AI is informational only. AI can break ties on ambiguous evidence but cannot override strong evidence.

This is principle **P3 (Evidence Sovereignty)** from the AI Philosophy, applied to the classifier:

> "Deterministic evidence is the ground truth; AI understanding is always subordinate."

**Rationale:** AI hallucinates. It may confidently assert an element is a "submit button" when the DOM clearly shows a checkbox. Evidence must win. This prevents the most dangerous failure mode: AI confidently misclassifying an interaction that deterministic rules would have gotten right.

### AP5 — Linear Data Flow

Data flows in one direction through the pipeline. No back-references, no circular dependencies, no feedback loops during a single interaction's processing.

```
Observer → Coalescer → Classifier → Timeline → Generation
                ↑            ↑
          Session Context   AI Observer (advisory)
```

**Rationale:** Linear pipelines are testable, debuggable, and predictable. Each stage's output is the next stage's input. The only "feedback" is the Phase 2 reclassification, which is a forward-only revision (a later phase updating an earlier output), not a circular dependency.

### AP6 — Contract-Based Boundaries

Every layer communicates through typed interfaces (contracts). No layer reaches into another layer's internals. This allows each layer to evolve independently as long as the contract is honored.

**Rationale:** The current architecture's tightest coupling is between content scripts (shared DOM attributes, duplicated helpers, cross-references via selectors). Contract-based boundaries eliminate this. If we later replace the AI provider system or add a Cypress generator, the contracts ensure no ripple changes.

### AP7 — Additive Extensibility

Adding a new interaction type means adding classifier rules to one file. It does NOT mean new content scripts, new skip selectors, new message types, or new ownership protocols.

**Rationale:** The cost of adding interaction types should scale O(1), not O(n²). In the current architecture, adding `drag` would require a new content script, new skip rules in the click script, new ownership attributes, new message handlers, and new registry config. In Architecture C, it means adding rules to the classifier and extending the semantic templates — additive, no existing rules change.

---

## 3. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           RECORDING LAYER                               │
│                                                                         │
│   ┌─────────────────┐                                                   │
│   │   Browser DOM    │  click, change, focus, blur, mouseenter,        │
│   │   Events         │  mouseleave, keydown, mousedown, input           │
│   └────────┬────────┘                                                   │
│            │                                                             │
│            ▼                                                             │
│   ┌─────────────────┐                                                   │
│   │  Layer 1:        │  ONE content script. Captures ALL events         │
│   │  Universal       │  + DOM context. NO classification, NO skipping,  │
│   │  Interaction     │  NO ownership. Collects evidence only.           │
│   │  Observer        │                                                  │
│   └────────┬────────┘                                                   │
│            │ RawEvidence[] (message stream)                             │
│            ▼                                                             │
│   ┌─────────────────┐                                                   │
│   │  Layer 2:        │  Service worker. Groups related raw events       │
│   │  Snapshot        │  within temporal windows. Deduplicates.          │
│   │  Coalescer       │  Computes value diffs, state changes, DOM        │
│   │                  │  mutations, ancestor context.                    │
│   └────────┬────────┘                                                   │
│            │ InteractionSnapshot                                        │
│            ├────────────────────────────────────────┐                   │
│            ▼                                        ▼                   │
│   ┌─────────────────┐                   ┌────────────────────┐        │
│   │  Layer 3:        │  ◄── advisory ──│  Layer 4:           │        │
│   │  Semantic        │     (optional)   │  AI Observer        │        │
│   │  Classifier      │                  │                     │        │
│   │                  │                  │  Understands intent │        │
│   │  Tier 1: Strong  │                  │  from semantic      │        │
│   │  evidence (DOM)  │                  │  snapshot. Returns  │        │
│   │                  │                  │  suggestedType +    │        │
│   │  Tier 2: Behav-  │                  │  businessName +     │        │
│   │  ioral evidence  │                  │  confidence.        │        │
│   │                  │                  │                     │        │
│   │  Tier 3: AI      │                  │  Reads Session      │        │
│   │  advisory        │                  │  Context for flow   │        │
│   │  (when avail.)   │                  │  awareness.         │        │
│   └────────┬────────┘                   └────────────────────┘        │
│            │ ClassifiedInteraction                                      │
│            ▼                                                             │
│   ┌─────────────────┐                                                   │
│   │  Layer 6:        │  Typed SessionEvent[] appended to Timeline.      │
│   │  Timeline        │  Phase 1 renders immediately. Phase 2 may        │
│   │                  │  update type or enrich name.                     │
│   └─────────────────┘                                                   │
│                                                                         │
│   ┌─────────────────────────────────────────────────────────────────┐   │
│   │  Layer 5: Session Context (cross-cutting, read by Layers 3 & 4) │   │
│   │  L1: Deterministic State (page URL, open dialogs, form state)   │   │
│   │  L2: Mental Model (AI understanding — advisory, transient)      │   │
│   │  L3: Action History (the Timeline itself — immutable)           │   │
│   └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
            │ (on STOP_RECORDING — frozen Timeline)
            ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        GENERATION LAYER (UNCHANGED)                     │
│                                                                         │
│   Timeline ──► CanonicalStepGen ──► ExecJsonGen ──► PlaywrightGen       │
│                                                                         │
│   Semantic Templates (frozen §8.2)    Verb Mapping Table (frozen)       │
│   Locator Resolution Engine (B4.4)    Readability Optimizer (OR-1)      │
└─────────────────────────────────────────────────────────────────────────┘
```

### Reading the diagram

- **Layers 1–4** form the recording pipeline. Data flows top-to-bottom through them.
- **Layer 5 (Session Context)** is cross-cutting — it is read by Layers 3 and 4 but written by a separate State Tracker (L1) and the AI Observer (L2).
- **Layer 6 (Timeline)** is the output of the recording pipeline and the input to generation.
- **Layer 7 (Generation)** is entirely unchanged from v6.1.0.

---

## 4. Layer 1 — Universal Interaction Observer

### Responsibility

Capture raw browser events and DOM context. Deliver evidence to the service worker. Make **zero** classification decisions.

### What it replaces

The six current content scripts:
- `click-content-script.ts` (1005 lines)
- `text-entry-content-script.ts` (~317 lines)
- `hover-content-script.ts` (~1561 lines)
- `checkbox-radio-content-script.ts` (~846 lines)
- `select-content-script.ts` (~1538 lines)
- `datepicker-content-script.ts` (~1132 lines)

**Total replaced:** ~6,399 lines across 6 files → ~1 unified observer.

### Design

| Aspect | Specification |
|--------|---------------|
| **Manifest registration** | `matches: ["<all_urls>"], all_frames: true, run_at: "document_start"` (same as current) |
| **Isolated world** | Content script runs in Chrome's isolated world (same as current — no access to page JS) |
| **Events captured** | `click`, `mousedown`, `change`, `focus`, `blur`, `input`, `mouseenter`, `mouseleave`, `keydown` — ALL events on ALL elements. No filtering. |
| **Per-event data** | Event type, target element identity (existing 18-field `ElementIdentity`), timestamp, isTrusted, composedPath() for shadow DOM resolution |
| **Value tracking** | Captures input/select value at event time. Maintains a pre-value snapshot on focus/mousedown for before/after diff computation by the coalescer. |
| **State tracking** | Captures checkbox/radio/ARIA state at event time |
| **DOM observation** | `MutationObserver` active during interaction windows (mouseenter → mouseleave / click + 300ms settle). Records childList, attribute, and subtree mutations. Summarizes into counts + semantic descriptions. |
| **Dwell timing** | Records mouseenter timestamp for dwell computation |
| **Focus timing** | Records focus timestamp for focus-duration computation |
| **Skip rules** | **NONE.** No `data-cmdrunner-handled`, no selector-based exclusions, no ownership attributes. |
| **Ownership** | **NONE.** No DOM attributes written. No inter-script coordination needed (there is only one script). |
| **Deduplication** | **NONE at this layer.** Deduplication is the coalescer's responsibility (Layer 2). The observer sends all events and lets the coalescer group them. |
| **Message format** | `chrome.runtime.sendMessage({ type: 'RAW_EVIDENCE', payload: RawEvidence })` — one message type, one shape, for all events |
| **Recording state sync** | Reads `chrome.storage.local` for recording state (same mechanism as current scripts). Events are only captured while recording is active. |

### Why one script instead of six

The six scripts each contain ~200 lines of identical helpers (`computeAccessibleName`, `generateCssSelector`, `generateXPath`, `extractIframeContext`, `checkRecording`). One script eliminates this duplication. More importantly, one script eliminates the coordination problem entirely:

| Current coordination overhead | Architecture C |
|---|---|
| 8 skip selectors in click script (Decisions 2b–2i) | 0 — no skipping |
| `data-cmdrunner-handled` ownership protocol (6 scripts) | 0 — no ownership |
| `data-cmdrunner-pending-select` optimistic claims | 0 — no claims |
~250 lines of skip/ownership logic in click script alone | 0 |
| Race between click (fires first) and change/mousedown (fires later) | Eliminated — coalescer handles grouping |

### Evidence vs. classification: the key distinction

The observer answers only: **"What raw thing happened in the DOM?"**

It does NOT answer:
- "Was this a meaningful click or just opening a dropdown?" → classifier
- "Is this a date picker?" → classifier
- "Did the user intend to select an option?" → classifier + AI

This separation means the observer's logic is simple (capture everything, send to SW) and the classifier's logic is rich (reason over all evidence). Compare with the current architecture where the click script must simultaneously capture AND decide whether to skip — a dual responsibility that produces fragile heuristics.

### MutationObserver strategy

The observer uses a `MutationObserver` to track DOM changes during interactions. This replaces the hover script's complex visibility-transition detection (C3.3) and the select/datepicker scripts' post-click value-outcome detection.

**Activation:** Observer starts on `mouseenter` (potential hover) or `mousedown` (potential click-based interaction). Observer stops on `mouseleave` or 300ms after the last event in a coalescing window.

**What it records:**
- `childList` changes (elements added/removed — e.g., calendar appeared, dropdown opened)
- `attribute` changes (e.g., `aria-expanded` changed, `class` changed to include `selected`)
- `subtree` changes (deep DOM mutations)
- Computed style changes for visibility transitions (the C3.3 algorithm moves here)

**Output:** Summarized mutation data in the `RawEvidence` message — counts of each mutation type, plus the specific semantic changes (visibility transitions, class additions matching selection patterns).

### What is reused from current scripts

| Current asset | Reuse strategy |
|---|---|
| `ElementIdentity` (18-field) extraction (`extractIdentity()`, `resolveClickTarget()`) | Move into observer. Logic is sound — just called for all events, not filtered. |
| `computeAccessibleName()` (9-level cascade) | Inlined in observer (same as current — content scripts are self-contained). |
| `generateCssSelector()`, `generateXPath()` | Inlined in observer. Used for element identity, not for classification. |
| `isInShadowDom()`, `extractIframeContext()` | Inlined in observer. Part of identity extraction. |
| `checkRecording()` (storage sync) | Inlined in observer. Same mechanism. |
| C3.3 visibility-transition detection algorithm | Moves into observer's MutationObserver module. Logic preserved, location changed. |

---

## 5. Layer 2 — Snapshot Coalescer

### Responsibility

Group related raw evidence events into coherent **Interaction Snapshots**. Deduplicate. Enrich with computed evidence that the classifier needs.

### What it replaces

The implicit event-to-interaction mapping currently done by content scripts (each script sends a single typed message per user action). In Architecture C, the observer sends raw events; the coalescer determines which events belong to the same user action.

### Design

| Aspect | Specification |
|--------|---------------|
| **Location** | Service worker (not content script — runs in SW context, has session access) |
| **Input** | Stream of `RawEvidence` messages from the observer |
| **Output** | `InteractionSnapshot` — one per user action (see §13 for structure) |
| **Coalescing window** | 500ms on the same element (or ancestor chain) |
| **Primary dedup** | `mousedown` + `click` on same element → one snapshot (mousedown is the precursor) |
| **Value enrichment** | Computes before/after value diffs from focus/mousedown (pre) and blur/change (post) snapshots |
| **State enrichment** | Computes checkbox/radio/ARIA state transitions (before vs. after) |
| **DOM enrichment** | Summarizes MutationRecords into semantic change descriptions (calendar appeared, dialog opened, class became "selected") |
| **Navigation** | Receives `chrome.webNavigation.onCommitted` events as a separate evidence source. Creates navigation snapshots. |

### Coalescing rules

A user action generates multiple browser events. The coalescer groups them:

| User Action | Browser Events | Coalesced Into |
|-------------|---------------|----------------|
| Click a button | `mousedown` + `click` | 1 snapshot: `primaryEvent=click` |
| Select date from calendar | `mousedown` + `click` (on calendar cell) + `input.change` + `blur` (on date field) | 1 snapshot: `primaryEvent=click` + `valueChange` (date-like) |
| Type in text field | `focus` + N×`input` + `blur` | 1 snapshot: `primaryEvent=blur` + `valueChange` |
| Toggle checkbox | `mousedown` + `click` + `change` | 1 snapshot: `primaryEvent=change` + `stateChange` |
| Select from native dropdown | `change` on `<select>` (user interacts with native picker) | 1 snapshot: `primaryEvent=change` + `valueChange` |
| Hover over menu | `mouseenter` + (500ms+ dwell) + DOM mutations + `mouseleave` | 1 snapshot: `primaryEvent=mouseenter` + `dwellTime` + `domMutations` |
| Navigate to new page | `webNavigation.onCommitted` | 1 snapshot: `primaryEvent=navigation` |

### Coalescing algorithm

```
1. Receive RawEvidence message
2. Check if it belongs to an existing open coalescing window:
   a. Is the target element the same as (or a descendant/ancestor of) the
      open window's element?
   b. Is it within the 500ms temporal window?
   c. Is the event type a natural continuation (e.g., change after click,
      blur after input)?
3. If yes → add to existing window's event list, update enrichment
4. If no → close the previous window (emit its snapshot), open new window
5. When a window closes:
   a. Determine primaryEvent (the most semantically meaningful event)
   b. Compute valueChange from pre/post snapshots
   c. Compute stateChange from pre/post states
   d. Summarize DOM mutations
   e. Build ancestorContext from the element's DOM hierarchy
   f. Emit InteractionSnapshot to classifier
```

### Primary event selection

When multiple events are coalesced, the "primary event" determines the classification path:

| Event combination | Primary event | Rationale |
|---|---|---|
| `mousedown` + `click` | `click` | click is the user-meaningful event |
| `mousedown` + `click` + `change` | `change` | change indicates a value/state outcome |
| `mousedown` + `click` + `input.change` + `blur` | `click` + `valueChange` | click triggered a value change (calendar date selection) |
| `focus` + `input`×N + `blur` | `blur` | blur indicates text entry completion |
| `mouseenter` + mutations + `mouseleave` | `mouseenter` + `dwellTime` | hover detected by dwell + mutation |

### What the coalescer enables

The coalescer answers the questions the current architecture's selectors can only approximate:

| Question the classifier needs | Current approach | Coalescer approach |
|---|---|---|
| "Did a value change?" | Not available at capture time | `valueChange.before` → `valueChange.after` |
| "Did the value become a date?" | Keyword regex on placeholder/name/id | `valueChange.isDateLike` (format detection on actual value) |
| "Did a checkbox state flip?" | `change` event must fire before click captures | `stateChange.before` → `stateChange.after` |
| "Did a calendar appear?" | Class-name heuristic (`*calendar*`) | `domMutations.childListChanges > 0` + `ancestorContext.hasCalendarAncestor` |
| "Was the hover intentional?" | 6-Gate decision tree (1561 lines) | `dwellTime ≥ 500ms` + `domMutations.visibilityChanges > 0` |
| "Did a selection state change?" | CSS class differential (5th select mechanism) | `classChange.selectionPattern` (computed from mutation data) |

---

## 6. Layer 3 — Semantic Classifier

### Responsibility

Assign the final interaction type to each `InteractionSnapshot`. Multi-tier: deterministic rules first, behavioral evidence second, AI advisory third.

### What it replaces

The implicit classification currently distributed across:
- Content script gate trees (5-Gate for hover, 5-Gate for checkbox/radio, 5-Gate for select, 5-Gate for datepicker)
- Click script's 8 skip selectors (Decisions 2b–2i)
- The post-recording `semantic-classifier.ts` (14-rule chain — mostly identity mapping)

All of this logic converges into **one centralized classifier** that operates on rich evidence instead of raw selectors.

### Design

| Aspect | Specification |
|--------|---------------|
| **Location** | Service worker (pure function — deterministic rules are synchronous) |
| **Input** | `InteractionSnapshot` + optional `AIIntentResult` (from Layer 4) + `SessionContext` (from Layer 5) |
| **Output** | `ClassifiedInteraction { canonicalType, actionId, classificationTier, evidence }` |
| **Timing** | Phase 1: immediate (synchronous, <10ms). Phase 2: re-evaluation when AI responds. |
| **No-AI mode** | Fully functional. Tier 1 + Tier 2 produce correct results for standard controls. |

### Three-tier rule engine

The classifier applies ordered priority rules. First match wins within each tier; tiers are evaluated sequentially.

#### Tier 1 — Strong Deterministic Evidence (synchronous, <1ms)

These rules use unambiguous DOM evidence. They are always authoritative. If a Tier 1 rule matches, the classification is final — AI cannot override.

```
Rule 1: NAVIGATION
  IF snapshot.primaryEvent.type = 'navigation'
  THEN type = 'navigate', confidence = 1.0, tier = 1

Rule 2: TEXT ENTRY (blur with value)
  IF snapshot.primaryEvent.type = 'blur'
     AND snapshot.valueChange exists
     AND snapshot.valueChange.after is non-empty
     AND snapshot.identity.tag ∈ {INPUT, TEXTAREA}
     AND snapshot.valueChange.inputType ∈ {text, email, password, search, tel, url, number}
     AND NOT snapshot.valueChange.isDateLike
  THEN type = 'fill', confidence = 0.95, tier = 1

Rule 3: NATIVE DATE INPUT CHANGE
  IF snapshot.primaryEvent.type = 'change'
     AND snapshot.identity.tag = 'INPUT'
     AND snapshot.identity.inputType ∈ {date, datetime-local, time, month, week}
  THEN type = 'selectDate', confidence = 1.0, tier = 1

Rule 4: NATIVE SELECT CHANGE
  IF snapshot.primaryEvent.type = 'change'
     AND snapshot.identity.tag = 'SELECT'
  THEN type = 'select', confidence = 1.0, tier = 1

Rule 5: CHECKBOX TOGGLE (state change + checkbox role)
  IF snapshot.stateChange exists
     AND snapshot.stateChange.property ∈ {checked, aria-checked}
     AND snapshot.identity.ariaRole ∈ {checkbox, menuitemcheckbox, switch}
  THEN type = 'toggle', confidence = 0.95, tier = 1

Rule 6: RADIO SELECTION (state change + radio role)
  IF snapshot.stateChange exists
     AND snapshot.stateChange.property ∈ {checked, aria-checked}
     AND snapshot.identity.ariaRole ∈ {radio, menuitemradio}
  THEN type = 'select', confidence = 0.95, tier = 1
```

**Design principle:** Tier 1 rules use the strongest evidence — native element types and explicit ARIA roles. These are structural facts about the DOM. They are never wrong (if the page is accessible-compliant). AI cannot override them (AP4: Evidence Sovereignty).

#### Tier 2 — Behavioral Evidence (synchronous, ~1–5ms)

These rules use computed behavioral evidence from the snapshot. They handle cases where the element doesn't have a clear ARIA role but its *behavior* reveals its type.

```
Rule 7: DATE SELECTION (value outcome)
  IF snapshot.valueChange exists
     AND snapshot.valueChange.isDateLike = true
     AND NOT matched by Rules 1-6
  THEN type = 'selectDate', confidence = 0.90, tier = 2

Rule 8: DATE SELECTION (calendar context)
  IF snapshot.primaryEvent.type = 'click'
     AND snapshot.ancestorContext.hasCalendarAncestor = true
  THEN type = 'selectDate', confidence = 0.85, tier = 2

Rule 9: SELECT (ARIA option in listbox)
  IF snapshot.primaryEvent.type = 'click'
     AND snapshot.identity.ariaRole = 'option'
     AND snapshot.ancestorContext.hasListboxAncestor = true
  THEN type = 'select', confidence = 0.90, tier = 2

Rule 10: SELECT (ARIA menu item in menu)
  IF snapshot.primaryEvent.type = 'click'
     AND snapshot.identity.ariaRole = 'menuitem'
     AND snapshot.ancestorContext.hasMenuAncestor = true
  THEN type = 'select', confidence = 0.85, tier = 2

Rule 11: SELECT (segmented control)
  IF snapshot.primaryEvent.type = 'click'
     AND snapshot.stateChange.property = 'aria-pressed'
     AND element has aria-pressed siblings (mutually exclusive group)
  THEN type = 'select', confidence = 0.80, tier = 2

Rule 12: SELECT (CSS class differential)
  IF snapshot.primaryEvent.type = 'click'
     AND snapshot.classChange.selectionPattern = true
     AND element has siblings with same class pattern
     AND NOT matched by Rules 7-11
  THEN type = 'select', confidence = 0.70, tier = 2

Rule 13: TOGGLE (toggle indicator without checkbox role)
  IF snapshot.primaryEvent.type = 'click'
     AND snapshot.identity has toggle indicator (summary, [aria-expanded], tab role)
  THEN type = 'toggle', confidence = 0.75, tier = 2

Rule 14: HOVER (dwell + observable change)
  IF snapshot.primaryEvent.type = 'mouseenter'
     AND snapshot.dwellTime ≥ DWELL_THRESHOLD (500ms)
     AND (snapshot.domMutations.visibilityChanges > 0
          OR snapshot.domMutations.childListChanges > 0)
  THEN type = 'hover', confidence = 0.85, tier = 2
```

**Design principle:** Tier 2 rules use the snapshot's computed evidence — value changes, state changes, DOM mutations, ancestor context. This is richer evidence than any selector can provide at capture time. These rules handle the cases that the current architecture fails on: custom dropdowns, custom date pickers, unconventional controls.

#### Tier 3 — AI Advisory (async, ~200–500ms)

When Tier 1 and Tier 2 produce a low-confidence result (the click fallback), the classifier consults the AI Observer for an advisory classification.

```
Rule 15: AI ADVISORY (ambiguous click)
  IF no Tier 1 or Tier 2 rule matched
     AND snapshot.primaryEvent.type = 'click'
     AND AIIntentResult is available
     AND AIIntentResult.confidence ≥ 0.7
  THEN type = AIIntentResult.suggestedType, confidence = AIIntentResult.confidence, tier = 3

Rule 16: DEFAULT FALLBACK
  IF no rule matched (including AI)
  THEN type = 'click', confidence = 0.30, tier = 3
```

**Design principle:** Tier 3 is the AI's domain — ambiguous interactions where DOM evidence is insufficient. The AI sees the semantic snapshot (not raw selectors) and the session context (what page, what flow). Its suggestion is advisory: it only applies when confidence is ≥ 0.7 and no stronger evidence contradicts it.

**Evidence Sovereignty (AP4) in practice:**

| Scenario | Evidence result | AI result | Final type |
|---|---|---|---|
| Native `<select>` change | Tier 1 Rule 4: `select`, conf 1.0 | AI says `click` | `select` (evidence wins) |
| Custom div dropdown, no ARIA | Tier 2 Rule 12: `select`, conf 0.70 | AI says `select`, conf 0.85 | `select` (both agree) |
| Custom div with no ARIA, no class change | Falls to Tier 3 | AI says `select`, conf 0.80 | `select` (AI advisory) |
| Custom div with no ARIA, no class change | Falls to Tier 3 | AI says `click`, conf 0.60 | `click` (AI below threshold) |
| AI unavailable | Tier 1 + Tier 2 only | — | Correct for standard controls; `click` for ambiguous |

### How AI hints are consumed

AI hints are consumed differently based on the deterministic tier's confidence:

1. **Deterministic confidence ≥ 0.9** → AI is informational only (used for `businessName` enrichment, not type)
2. **Deterministic confidence 0.7–0.9** → AI `suggestedType` breaks ties if it disagrees
3. **Deterministic confidence < 0.7** (fallback click) → AI `suggestedType` is used if `confidence ≥ 0.7`
4. **AI unavailable** → evidence-only classification stands (fully functional baseline)

### How this resolves current problems

| Current Problem | Root Cause | Architecture C Resolution |
|---|---|---|
| Custom dropdown → Click | Click script's skip selector doesn't match `<div>` without `role=option` | Rule 12 (CSS class differential) or Rule 15 (AI advisory) catches it |
| Date picker → Click | Text input has no date keywords; calendar class doesn't match heuristic | Rule 7 (value outcome: `isDateLike` on actual value) or Rule 8 (calendar ancestor context) |
| Checkbox → Click | Element lacks `role=checkbox` | Rule 5 (if state change detected by coalescer) or AI advisory |
| Hover → nothing or over-triggering | 1561-line gate tree with fragile visibility detection | Rule 14 (dwell + mutation evidence, computed by coalescer) |
| Adding `drag` | New script + skip rules in all others + ownership | New rule in classifier (additive) |

---

## 7. Layer 4 — AI Observer

### Responsibility

Understand user intent from the interaction snapshot. Return structured hints to the classifier. Build and maintain the Mental Model (Session Context Layer 2).

### What it replaces / extends

The current `AIService.understand()` call in `processAction()`. The AI service currently:
- Receives `{ actionType, text, tag, role, className }` (minimal context)
- Returns `{ businessName, controlType, userIntent, confidenceScore }` (enrichment only)
- Does NOT influence classification (type already stamped)
- Does NOT maintain any state across interactions

Architecture C extends this into an **AI Observer** that:
- Receives the `InteractionSnapshot` (rich behavioral + structural context)
- Returns `{ suggestedType, businessName, userIntent, confidence }` (classification advisory + enrichment)
- Reads `SessionContext` for flow awareness (what page, what workflow)
- Writes to `MentalModel` (Layer 2) — maintains progressive understanding across interactions

### Design

| Aspect | Specification |
|--------|---------------|
| **Location** | Service worker |
| **Input** | `SnapshotForAI` (semantic subset of InteractionSnapshot — no raw selectors) + `SessionContext` |
| **Output** | `AIIntentResult { suggestedType, businessName, userIntent, confidence }` + `MentalModel` update |
| **Timing** | Async (~200ms–2s). Does NOT block Phase 1 classification. |
| **Cadence** | One call per coalesced interaction (same frequency as current `AIService.understand()`) |
| **Provider** | Uses existing `ProviderManager` (6 providers: Gemini, OpenAI, Claude, OpenRouter, Azure, Custom) |
| **When unavailable** | Classifier proceeds with evidence-only rules (AP2: Graceful Degradation) |

### What the AI receives (semantic snapshot, not raw mechanics)

```typescript
interface SnapshotForAI {
  // ── Element semantics (NOT raw selectors) ──
  tagName: string;
  accessibleName: string;
  ariaRole: string | null;
  className: string | null;

  // ── Behavioral context ──
  primaryEvent: string;          // 'click', 'change', 'mouseenter', 'blur'
  valueChanged: boolean;
  valueAfter: string;            // the new value (for understanding intent)
  stateChanged: boolean;
  dwellTime: number | null;

  // ── Structural context ──
  ancestorRoles: string[];       // ['grid', 'menu', 'listbox', 'dialog']
  hasCalendarContext: boolean;
  hasDropdownContext: boolean;
  hasFormContext: boolean;

  // ── Temporal context (from Session Context) ──
  precedingType: string | null;  // type of previous interaction
  currentUrl: string;            // page URL (from L1 Deterministic State)
  workflowHint: string | null;   // AI's current workflow hypothesis (from L2)
}
```

**NOT sent to AI:** CSS selectors, XPath, element IDs, test attributes, iframe implementation details, shadow DOM mechanics. AI understands intent from semantics, not from DOM plumbing. This is consistent with the AI Philosophy: "AI should understand the user's intent rather than browser mechanics."

### What the AI returns

```typescript
interface AIIntentResult {
  suggestedType: CanonicalType;    // 'click' | 'fill' | 'select' | 'selectDate' | 'toggle' | 'hover' | ...
  businessName: string;            // "Departure Date Picker"
  userIntent: string;              // "Select a departure date for the flight"
  confidence: number;              // 0.05–0.95 (P5: never absolute)
}
```

### AI operating principles (from AI Philosophy, frozen P1–P8)

The AI Observer operates under eight frozen principles. These are not suggestions — they are structural constraints enforced by the architecture:

| Principle | How Architecture C enforces it |
|---|---|
| **P1: Observation First** | AI receives evidence (snapshot); never generates from imagination |
| **P2: Progressive Understanding** | Mental Model accumulates across interactions (L2 of Session Context) |
| **P3: Evidence Sovereignty** | Classifier Tier 1/2 always overrides Tier 3 AI (AP4) |
| **P4: Hypothesis Discipline** | Mental Model maintains max 3 competing hypotheses per domain |
| **P5: Honest Confidence** | Confidence clamped to [0.05, 0.95]; never 0 or 1 |
| **P6: Evidence Citation** | Every AI conclusion cites supporting action IDs |
| **P7: Hallucination Rejection** | AI output validated against observed evidence; prefer null over fabrication |
| **P8: Provider Independence** | Structural validation, not prompt engineering — works with any provider |

### AI constraints (what AI must NEVER do)

These are negative constraints — the AI Observer is architecturally prohibited from:

1. **Never modify, delete, merge, or reorder** Timeline actions
2. **Never determine the final interaction type** (advisory only — classifier decides)
3. **Never generate execution JSON or Playwright code**
4. **Never block the pipeline** (async, non-blocking)
5. **Never override deterministic evidence** (P3/Evidence Sovereignty)
6. **Never write to Layer 1** (Deterministic State — owned by State Tracker)
7. **Never write to Layer 3** (Timeline — owned by Recorder)

These constraints are enforced structurally: the AI Observer has no reference to the Timeline, the generation pipeline, or the execution JSON generator. It can only write to Layer 2 (Mental Model) and return advisory results to the classifier.

### Evidence hierarchy

The AI Observer reasons across four evidence tiers (frozen by AI Philosophy):

| Tier | Evidence type | Authority |
|------|---|---|
| T1 | Deterministic facts (DOM structure, ARIA, value changes) | Highest — always authoritative |
| T2 | Structural context (ancestor roles, container types) | High — feeds Tier 2 rules |
| T3 | Behavioral patterns (dwell time, mutation patterns, sequences) | Medium — feeds Tier 2 rules |
| T4 | Semantic inference (AI's interpretation of intent) | Lowest — needs corroboration |

The classifier consumes these in order: T1 evidence produces Tier 1 rules; T2+T3 produce Tier 2 rules; T4 produces Tier 3 advisory.

### Confidence model

The AI Observer contributes to a 5-track confidence model (defined in `architecture-types.ts:ConfidenceState`, frozen by AI Philosophy P5):

| Track | Weight | What it measures |
|---|---|---|
| `intent` | 35% | Confidence in the user's intent classification |
| `workflow` | 25% | Confidence in the workflow pattern detection |
| `appFocus` | 15% | Confidence in application identity |
| `uiFocus` | 15% | Confidence in current UI focus |
| `change` | 10% | Confidence in change analysis |

Composite = weighted average, clamped to [0.05, 0.95]. Thresholds:
- ≥ 0.85: AI may override ambiguous evidence (Tier 3 classification)
- 0.60–0.85: AI serves as tie-breaker for ambiguous Tier 2 results
- < 0.35: AI output is ignored (too uncertain to be useful)

**Note:** The 5-track `ConfidenceEngine` is fully implemented (`confidence-engine.ts`) but not yet wired into the pipeline. Architecture C makes it a structural component of the AI Observer.

---

## 8. Layer 5 — Session Context

### Responsibility

Provide cross-cutting context to the classifier and AI Observer: what page is the user on, what dialogs/menus are open, what workflow are they in, what did they just do.

### What it replaces

The current architecture has **no session context**. Each content script captures events in isolation. The classifier has no knowledge of what page the user is on or what flow they're in. The `SessionContext` type exists in `architecture-types.ts` but no code constructs or populates it.

### Three-layer structure (frozen by AI Observer Architecture)

```
SessionContext
├── Layer 1: DeterministicState    — written by State Tracker (MV3-safe)
│   ├── currentUrl
│   ├── pageTitle
│   ├── openDialogs[]
│   ├── openDropdowns[]
│   ├── activeForm
│   └── activeElement
│
├── Layer 2: MentalModel           — written by AI Observer (transient)
│   ├── appIdentity (Hypothesis)
│   ├── workflow (WorkflowHypothesis)
│   ├── currentFocus (Hypothesis)
│   ├── userIntent (Hypothesis)
│   ├── recentChange (ChangeAnalysis)
│   └── confidence (ConfidenceState)
│
└── Layer 3: Action History        — written by Recorder (immutable)
    └── SessionEvent[] (the Timeline)
```

### Write-protection boundary

Each layer has exactly one writer. No component writes to a layer it doesn't own. Readers receive deep copies — cannot mutate originals.

| Layer | Writer | Readers |
|---|---|---|
| L1: Deterministic State | State Tracker only | Classifier (Tier 2 context), AI Observer |
| L2: Mental Model | AI Observer only | Classifier (Tier 3 advisory), Review Engine (future) |
| L3: Action History | Recorder/Coalescer only | Classifier, Generation Pipeline, Review Engine |

This write-protection boundary is the architectural mechanism that enforces Evidence Sovereignty (AP4/P3). The AI Observer cannot modify the Timeline. The classifier cannot modify the Mental Model. Each component reasons over layers it reads but can only affect the layer it writes.

### State Tracker (L1 writer)

A new component — the **State Tracker** — maintains the Deterministic State (L1). It uses a `MutationObserver` on the page to track:

- Current URL and page title (via `webNavigation` events)
- Open dialogs (`[role="dialog"]`, `[aria-modal="true"]`)
- Open dropdowns/menus (`[aria-expanded="true"]`)
- Active form context (the `<form>` containing the currently focused element)
- Active element (currently focused element descriptor)

The State Tracker is **MV3-safe**: it persists L1 to `chrome.storage.local` on each update, so it survives SW restarts.

### Mental Model (L2)

The Mental Model is the AI Observer's progressive understanding of the recording session. It accumulates across interactions:

| Domain | What it tracks | Example |
|---|---|---|
| `appIdentity` | What application is the user on? | "Adani One Flight Booking" (conf 0.85) |
| `workflow` | What workflow is the user performing? | "flight-search" step 2 of 4 |
| `currentFocus` | What UI area is the user focused on? | "date selection" |
| `userIntent` | What is the user trying to do right now? | "Select departure date" |
| `recentChange` | What just changed? | "calendar appeared" |

The Mental Model is **advisory only**. It informs the classifier's Tier 3 rules and the AI Observer's prompt context. It never determines the final type.

### What Session Context enables

Without Session Context, classification is element-level only. With it:

| Classification question | Without Session Context | With Session Context |
|---|---|---|
| "Is this click on a `<div>` a dropdown selection?" | Must rely on ARIA roles or CSS class patterns | Also knows "a dropdown is open" (L1) and "the user is in a form-filling workflow" (L2) |
| "Is this hover intentional?" | Must rely on dwell time + mutation count | Also knows "the user hovered over a menu item that has a submenu" (L1) |
| "What type is this ambiguous element?" | DOM evidence alone | AI has workflow context: "user is selecting a flight date" → `selectDate` is likely |

### Persistence

| Layer | Persisted? | Where | Why |
|---|---|---|---|
| L1: Deterministic State | Yes | `chrome.storage.local` | Must survive MV3 SW restart |
| L2: Mental Model | Yes | `chrome.storage.local` | AI understanding must survive SW restart (progressive) |
| L3: Action History | Yes | `chrome.storage.local` | Timeline must survive SW restart (already persisted in v6.1.0) |

---

## 9. Layer 6 — Timeline

### Responsibility

Store the typed `SessionEvent[]` — the immutable record of the user's recording session. This is the single source of truth for the generation pipeline.

### Status: REUSED FROM CURRENT ARCHITECTURE

The Timeline is **unchanged** from v6.1.0. Same structure (`SessionEvent[]`), same storage (`chrome.storage.local` under `SESSION_EVENTS`), same immutability invariant.

### The one addition: Phase 2 reclassification

In the current architecture, once an event is stored, its type never changes. In Architecture C, Phase 2 (AI advisory) may reclassify an event:

1. Phase 1 stores an event with a tentative type (e.g., `click`)
2. AI responds 200ms later with high confidence: "this is a `selectDate`"
3. The classifier updates the event's type in the Timeline
4. The side panel's live listener picks up the storage change and re-renders

After `STOP_RECORDING`, the Timeline is frozen — no further updates. This preserves the immutability invariant for the generation pipeline.

### Timeline event shape (unchanged)

```typescript
interface SessionEvent {
  actionId: string;           // "click-0001" (type-specific prefix)
  type: string;               // discriminator: 'click' | 'text' | 'hover' | ...
  elementIdentity: ElementIdentity;
  timestamp: string;
  // type-specific fields (value, checked, displayValue, isoValue, etc.)
  aiUnderstanding?: AIUnderstanding;
  aiError?: string;
}
```

The Timeline's `type` field now reflects the classifier's output (potentially revised by Phase 2), not the content script's raw capture type. But the shape is identical.

---

## 10. Layer 7 — Generation Pipeline

### Status: ENTIRELY UNCHANGED

The generation pipeline is the strongest part of the current architecture. It is clean, contract-based, deterministic, and produces high-quality output. Architecture C does not touch it.

### Pipeline

```
Timeline (SessionEvent[])
  ↓
  ↓ Stage 3a: semantic-classifier.ts (classifyInteractions)
  ↓   → Classifies each event into CanonicalType
  ↓   → NOTE: In Architecture C, classification already happened during recording.
  ↓     This stage becomes a verification/re-classification pass with full context.
  ↓
  ↓ canonical-step-generator.ts
  ↓   → Renders plain English from frozen §8.2 templates
  ↓   → Applies readability optimizer (OR-1 merge)
  ↓
CanonicalStep[] (plainEnglish + identity + aiEnrichment, executionJson=null)
  ↓
  ↓ execution-json-generator.ts
  ↓   → Resolves action verb via verb-mapping-table.ts
  ↓   → Resolves locators via locator-resolution-engine.ts (B4.4 priority)
  ↓   → Constructs B5.2 six-section ExecutionJsonObject
  ↓
CanonicalStep[] (executionJson populated)
  ↓
  ↓ playwright-generator.ts
  ↓   → Translates locators to Playwright API calls
  ↓   → Translates action verbs to Playwright methods
  ↓   → Wraps in test structure
  ↓
Playwright test code (string)
```

### Components reused without modification

| Component | File | Status |
|---|---|---|
| Generation Engine | `generation-engine.ts` | **Reused** — orchestrates the 3-generator chain |
| Generator Registry | `generator-registry.ts` | **Reused** — topological sort of generators |
| Canonical Step Generator | `canonical-step-generator.ts` | **Reused** — transforms classified events into steps |
| Execution JSON Generator | `execution-json-generator.ts` | **Reused** — populates B5.2 contract |
| Playwright Generator | `playwright-generator.ts` | **Reused** — generates test code |
| Semantic Templates | `semantic-templates.ts` | **Reused** — frozen §8.2, immutable |
| Verb Mapping Table | `verb-mapping-table.ts` | **Reused** — frozen, immutable |
| Locator Resolution Engine | `locator-resolution-engine.ts` | **Reused** — B4.4 priority, pure function |
| Readability Optimizer | `readability-optimizer.ts` | **Reused** — OR-1 merge |
| Execution JSON Types | `execution-json-types.ts` | **Reused** — frozen B5.2 contract |

---

## 11. Supporting Layer — Infrastructure

### Status: PARTIALLY IMPLEMENTED, NEEDS WIRING

The following components are **fully implemented** in the codebase but **not wired into the pipeline**. Architecture C activates them.

| Component | File | Current Status | Architecture C Role |
|---|---|---|---|
| Confidence Engine (5-track) | `confidence-engine.ts` | Implemented, never called | Active component of AI Observer — computes composite confidence |
| Workflow Analyzer | `workflow-analyzer.ts` | Implemented, never called | Feeds `workflow` hypothesis in Mental Model |
| Audit Manager | `infrastructure/audit-manager.ts` | Implemented, never called | Structured audit logging for debugging/compliance |
| Logging Manager | `infrastructure/logging-manager.ts` | Implemented, never called | Structured, leveled logging |
| Error Handler | `infrastructure/error-handler.ts` | Implemented, never called | Centralized error categorization and recovery |

### Why these matter

In the current architecture, these components are orphaned — there's no place for their output to go. In Architecture C:

- The **Confidence Engine** feeds the Mental Model's `confidence` field, which the classifier uses to decide whether AI advisory applies
- The **Workflow Analyzer** feeds the Mental Model's `workflow` hypothesis, which gives the AI Observer flow context
- The **Audit Manager** records classification decisions, AI calls, and reclassifications — critical for debugging why an interaction was classified a certain way
- The **Logging Manager** provides the structured logging that the multi-layer pipeline needs for observability
- The **Error Handler** catches and categorizes failures at layer boundaries (e.g., coalescer timeout, AI provider failure, classifier no-match)

---

## 12. The Interaction Lifecycle

This is the complete lifecycle of a single user interaction — from DOM event to Timeline entry — in Architecture C.

### Phase 1: Capture (immediate)

```
1. User performs action on web page
   (e.g., clicks a calendar date cell)

2. Browser fires DOM events:
   mousedown → click on the cell
   input.change on the date text field
   blur on the date text field

3. Universal Interaction Observer captures ALL events:
   - Captures mousedown: { target: cell, identity: {tag:'td', role:'gridcell', ...} }
   - Captures click:     { target: cell, identity: {...}, isTrusted: true }
   - Captures change:    { target: input, value: '2026-07-18', identity: {tag:'input', type:'text'} }
   - Captures blur:      { target: input, identity: {...} }
   Each → sendMessage({ type: 'RAW_EVIDENCE', payload: RawEvidence })

4. Snapshot Coalescer receives 4 raw evidence messages:
   - Opens coalescing window on mousedown (cell element)
   - click arrives → same element, within 500ms → add to window
   - change arrives → different element (input field) but related (ancestor
     chain connects them via the calendar container) → add to window
   - blur arrives → same input element, within 500ms → add to window
   - Window closes (no more events within 500ms)
   - Computes:
     primaryEvent = click (most meaningful event)
     valueChange = { before: '', after: '2026-07-18', isDateLike: true }
     ancestorContext = { hasCalendarAncestor: true }
     domMutations = { childListChanges: 0, visibilityChanges: 0 }
   - Emits InteractionSnapshot to classifier

5. Semantic Classifier Phase 1 (synchronous, <10ms):
   - Rule 1 (navigation)? No.
   - Rule 2 (text entry blur)? primaryEvent is click, not blur. No.
   - Rule 3 (native date input)? tag is INPUT but inputType is text, not date. No.
   - Rule 7 (date value outcome)? valueChange.isDateLike = true. YES.
   - → type = 'selectDate', confidence = 0.90, tier = 2
   - → Creates SessionEvent with type 'dateSelect'
   - → Appends to Timeline (L3)
   - → Triggers screenshot capture
   - → Timeline renders in side panel: amber "Date" badge, "Select 2026-07-18 as Departure Date"

6. (Simultaneously) AI Observer receives the snapshot:
   - Builds SnapshotForAI (semantic subset)
   - Reads SessionContext: L1 says "currentUrl: adanione.com/flight-booking",
     L2 says "workflow: flight-search, step 2"
   - Calls AI provider
   - (Async — takes 200ms-2s)
```

### Phase 2: AI Refinement (async, ~200ms–2s later)

```
7. AI Observer returns:
   { suggestedType: 'selectDate', businessName: 'Departure Date', confidence: 0.88 }

8. Classifier re-evaluates:
   - Phase 1 result: 'selectDate', confidence 0.90 (Tier 2)
   - AI result: 'selectDate', confidence 0.88
   - Both agree → no reclassification needed
   - But AI provides businessName: 'Departure Date'
   - → Enriches event with AI understanding (businessName, userIntent, confidence)
   - → Updates Timeline entry (Phase 2 update)
   - → Side panel re-renders: element name changes from raw tag to 'Departure Date'

   ALTERNATIVE: If Phase 1 said 'click' (no rule matched) and AI says 'selectDate' conf 0.85:
   - Phase 1 result: 'click', confidence 0.30 (Tier 3 fallback)
   - AI result: 'selectDate', confidence 0.85 ≥ 0.7 threshold
   - → Reclassify: update event type from 'click' to 'dateSelect'
   - → Update Timeline entry
   - → Side panel re-renders: badge changes from blue "Click" to amber "Date"
```

### Phase 3: Stop & Generate

```
9. User clicks Stop Recording
   → STOP_RECORDING message → service worker

10. GenerationEngine.generate():
    - Reads frozen Timeline
    - Runs Stage 3a classifier as a VERIFICATION pass:
      (classification already happened during recording, but this catches
       any events that weren't reclassified in Phase 2)
    - Runs canonical-step-generator:
      → type 'dateSelect' → template: "Select {value} as the {elementName}"
      → value: '2026-07-18', elementName: 'Departure Date' (from AI)
      → plainEnglish: "Select 2026-07-18 as the Departure Date"
      → OR-1 merge: checks if a preceding click should merge (no — different element)
    - Runs execution-json-generator:
      → action.type: 'selectDate' → verb mapping: 'fill'
      → locators: resolves via B4.4 priority (testId → dataCy → aria → id → ...)
      → context: { iframe: false, shadowDom: false }
      → meta: { status: 'generated', warnings: [], generatedAt: ... }
    - Runs playwright-generator:
      → page.fill('input#onward', '2026-07-18')
    - Persists all steps + Playwright code to storage

11. Side panel shows stopped view:
    - Generated step: "Select 2026-07-18 as the Departure Date"
    - Execution JSON (expandable): all 6 sections populated
    - Playwright code (expandable): page.fill(...)
```

### Timing diagram

```
Time →
0ms      5ms       10ms         200ms-2s        (on Stop)
│        │          │            │                │
▼        ▼          ▼            ▼                ▼
Event    Snapshot   Phase 1      Phase 2         Generation
fired    built      classified   (AI refines)    (full pipeline)
                    → Timeline   → Timeline       → Steps+JSON+Code
                      renders     updates
```

### Navigation lifecycle

```
chrome.webNavigation.onCommitted (frameId=0, http/https)
  → Coalescer creates navigation snapshot
  → Classifier Rule 1: type = 'navigate', confidence = 1.0
  → Timeline entry: "Navigate to {url}"
  → State Tracker updates L1 (currentUrl, pageTitle)
  → AI Observer may update L2 (appIdentity, workflow)
```

---

## 13. Data Structures

### RawEvidence (Observer → Coalescer)

```typescript
interface RawEvidence {
  /** Browser event type: click, mousedown, change, focus, blur, mouseenter, mouseleave, keydown, input */
  eventType: string;
  /** Target element identity (existing 18-field ElementIdentity) */
  identity: ElementIdentity;
  /** ISO timestamp */
  timestamp: string;
  /** Whether the event is trusted (user-initiated, not script) */
  isTrusted: boolean;
  /** Input/select value at the time of this event (if applicable) */
  value?: string;
  /** Checkbox/radio checked state at event time (if applicable) */
  checked?: boolean;
  /** Mouse dwell time (for mouseenter → mouseleave sequences) */
  dwellTime?: number;
  /** DOM mutation summary (if MutationObserver was active) */
  mutations?: MutationSummary;
}

interface MutationSummary {
  childListAdded: number;
  childListRemoved: number;
  attributeChanges: number;
  /** Elements that transitioned from hidden to visible (or vice versa) */
  visibilityChanges: number;
  /** Specific semantic changes detected */
  semanticChanges: string[];  // e.g., ["calendar-appeared", "class:selected-added"]
}
```

### InteractionSnapshot (Coalescer → Classifier)

```typescript
interface InteractionSnapshot {
  // ── Identity ──
  identity: ElementIdentity;

  // ── Event Evidence ──
  primaryEvent: {
    type: 'click' | 'change' | 'focus' | 'blur' | 'mouseenter' | 'mouseleave' | 'keydown' | 'navigation';
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
    childListChanges: number;
    attributeChanges: number;
    visibilityChanges: number;
    observedWindow: number;     // ms the MutationObserver was active
  };

  // ── Temporal Context ──
  precedingSnapshotType?: string;  // type of the previous interaction
  timestamp: string;
}
```

### ClassifiedInteraction (Classifier → Timeline)

```typescript
interface ClassifiedInteraction {
  canonicalType: CanonicalType;  // 'navigate' | 'click' | 'fill' | 'select' | 'toggle' | 'selectDate' | 'hover' | 'pressKey' | 'upload' | 'drag'
  actionId: string;              // references the source SessionEvent
  originalEvent: SessionEvent;   // the raw event being classified
  classificationTier: 1 | 2 | 3; // which tier made the decision
  evidence: ClassificationEvidence; // structured evidence trail
}
```

### AIIntentResult (AI Observer → Classifier)

```typescript
interface AIIntentResult {
  suggestedType: CanonicalType;
  businessName: string;
  userIntent: string;
  confidence: number;            // 0.05–0.95 (P5: never absolute)
}
```

### SessionContext (cross-cutting)

```typescript
interface SessionContext {
  layer1: DeterministicState;       // written by State Tracker
  layer2: MentalModel | null;       // written by AI Observer (null when AI unavailable)
  layer3: SessionEvent[];           // the Timeline (written by Recorder, immutable)
}
```

Types for `DeterministicState`, `MentalModel`, `Hypothesis`, `WorkflowHypothesis`, `ChangeAnalysis`, and `ConfidenceState` are already defined in `src/shared/architecture-types.ts` and are **reused without modification**.

---

## 14. Component Inventory — Reuse, Replace, Create

### Components REUSED (no changes needed)

| Component | Location | Why it's reused |
|---|---|---|
| Generation Engine | `generation/engine/generation-engine.ts` | Contract-based orchestrator — works with any Timeline |
| Generator Registry | `generation/registry/generator-registry.ts` | Topological sort — generic |
| Canonical Step Generator | `generation/generators/canonical-step-generator.ts` | Transforms classified events → steps. Input shape unchanged. |
| Execution JSON Generator | `generation/generators/execution-json-generator.ts` | Populates B5.2 from steps. Input shape unchanged. |
| Playwright Generator | `generation/generators/playwright-generator.ts` | Generates test code. Input shape unchanged. |
| Semantic Templates | `generation/engine/semantic-templates.ts` | Frozen §8.2. Immutable by design. |
| Verb Mapping Table | `generation/verb-mapping-table.ts` | Frozen. Immutable by design. |
| Locator Resolution Engine | `generation/engine/locator-resolution-engine.ts` | B4.4 priority. Pure function. |
| Readability Optimizer | `generation/engine/readability-optimizer.ts` | OR-1 merge. Pure function. |
| Execution JSON Types | `generation/contracts/execution-json-types.ts` | Frozen B5.2 six-section contract. |
| Generator Contracts | `generation/contracts/generator-contract.ts` | Input/output interfaces. |
| AI Provider System | `ai/providers/*`, `ai/provider-manager.ts` | 6 providers, interface-based. Only the prompt changes. |
| Connection Tester | `ai/connection-tester.ts` | Provider testing. Unchanged. |
| Recording Session | `recorder/recording-session.ts` | Session lifecycle + event store. Unchanged. |
| Storage Service | `storage/storage-service.ts` | chrome.storage.local wrapper. Unchanged. |
| Schema Versioning | `storage/schema-version.ts` | Unchanged. |
| ID Generators | `recorder/action-id.ts`, `recorder/element-id-generator.ts`, `recorder/step-id-generator.ts` | Prefix-NNNN generators. Unchanged. |
| Screenshot Service | `screenshots/screenshot-service.ts` | Fire-and-forget capture. Unchanged. |
| Repository Service | `repository/repository-service.ts` | CRUD for test cases. Unchanged. |
| Side Panel (structure) | `sidepanel/sidepanel.ts`, `sidepanel/timeline-renderer.ts` | State machine + rendering. Minor update for Phase 2 reclassification display. |
| Settings Page | `settings/settings.ts` | AI provider config. Unchanged. |
| Element Identity (18-field) | `shared/types.ts` | Core domain type. Unchanged. |
| Architecture Types | `shared/architecture-types.ts` | Type definitions for SessionContext, MentalModel, etc. Already defined. |
| Confidence Engine | `generation/engine/confidence-engine.ts` | 5-track model. Implemented but unwired — Architecture C activates it. |
| Workflow Analyzer | `generation/engine/workflow-analyzer.ts` | Pattern detection. Implemented but unwired — Architecture C activates it. |
| Audit Manager | `infrastructure/audit-manager.ts` | Audit logging. Implemented but unwired. |
| Logging Manager | `infrastructure/logging-manager.ts` | Structured logging. Implemented but unwired. |
| Error Handler | `infrastructure/error-handler.ts` | Error pipeline. Implemented but unwired. |

### Components REPLACED

| Current Component | Replaced By | Why |
|---|---|---|
| `click-content-script.ts` (1005 lines) | Universal Interaction Observer | Fused capture+classification. Skip selectors are the root cause of misclassification. |
| `text-entry-content-script.ts` (~317 lines) | Universal Interaction Observer | Same — capture only, classify in SW |
| `hover-content-script.ts` (~1561 lines) | Universal Interaction Observer + Coalescer | Hover detection moves to evidence (dwell + mutation) in classifier Rule 14 |
| `checkbox-radio-content-script.ts` (~846 lines) | Universal Interaction Observer + Coalescer | State change detected by coalescer; classified by Rule 5/6 |
| `select-content-script.ts` (~1538 lines) | Universal Interaction Observer + Coalescer | Value/class change detected by coalescer; classified by Rules 9–12 |
| `datepicker-content-script.ts` (~1132 lines) | Universal Interaction Observer + Coalescer | Date value outcome detected by coalescer; classified by Rules 7/8 |
| `semantic-classifier.ts` (post-recording only) | Multi-tier Classifier (during recording + verification on Stop) | Currently runs only on Stop; Architecture C runs during recording (Phase 1/2) and verifies on Stop |

### Components CREATED (new)

| Component | Purpose | Derives From |
|---|---|---|
| **Universal Interaction Observer** | Single content script: capture all events + DOM context | Merge of 6 scripts' capture logic, minus classification |
| **Snapshot Coalescer** | Group raw events into InteractionSnapshots | New — no current equivalent |
| **Multi-tier Classifier** | Classify snapshots into canonical types | Extends `semantic-classifier.ts` with 3-tier rules + during-recording execution |
| **AI Observer** | Understand intent, return advisory hints, maintain Mental Model | Extends `AIService.understand()` with snapshot input + advisory output + L2 writing |
| **State Tracker** | Maintain Deterministic State (L1 of Session Context) | New — no current equivalent. Uses MutationObserver. |
| **Session Context Manager** | Container for L1/L2/L3, enforces write-protection boundary | New — type exists in `architecture-types.ts`, no manager class |

### Components MODIFIED (minor)

| Component | Change | Why |
|---|---|---|
| `service-worker.ts` | Replace 6 message handlers with 1 (`RAW_EVIDENCE`); wire coalescer + classifier + AI observer pipeline | New pipeline routing |
| `manifest.json` | Replace 6 content script entries with 1; add MutationObserver permission if needed | Single observer |
| `interaction-types.ts` | Retain for timeline rendering (badge colors, labels, titles). Remove `addToSession()` responsibility (coalescer handles). | Registry becomes display-only |
| `ai/ai-understanding.ts` | Redesign prompt for `SnapshotForAI` input instead of minimal element info | Richer AI context |
| `sidepanel/timeline-renderer.ts` | Support Phase 2 reclassification (re-render on type update) | Live refinement display |
| `semantic-classifier.ts` (generation engine) | Becomes verification pass on Stop (already-classified events get a final review with full timeline context) | Catches anything missed in Phase 1/2 |

---

## 15. Dependency Graph

### Architecture C dependency graph

```
Universal Interaction Observer (content script)
    │
    │  RawEvidence[] messages
    ▼
Snapshot Coalescer (service worker)
    │
    ├──► InteractionSnapshot
    │       │
    │       ▼
    │    Semantic Classifier
    │       │
    │       ├── (Tier 1/2) deterministic rules ──► ClassifiedInteraction
    │       │                                      │
    │       │                                      ▼
    │       │                                   Timeline (L3)
    │       │                                      │
    │       └── (Tier 3) AI advisory ◄─────────────┤
    │                    │                          │
    │                    ▼                          │
    │              AI Observer                      │
    │                    │                          │
    │              ┌─────┴─────┐                   │
    │              ▼           ▼                    │
    │         AIIntentResult  Mental Model (L2)     │
    │              │           │                    │
    │              └───────────┴────────────────────┘
    │                          │
    │                    Session Context
    │                    ┌─────┼─────┐
    │                    │     │     │
    │                   L1    L2    L3
    │              (State     (Mental  (Timeline)
    │             Tracker)    Model)
    │
    ▼ (on STOP_RECORDING)
Generation Pipeline (unchanged)
    │
    ├── CanonicalStepGenerator
    ├── ExecutionJsonGenerator
    └── PlaywrightGenerator
```

### Coupling assessment

| Component → Component | Coupling Level | Interface |
|---|---|---|
| Observer → Coalescer | LOW | `RawEvidence` message (one type, one shape) |
| Coalescer → Classifier | LOW | `InteractionSnapshot` (typed contract) |
| Classifier → AI Observer | LOW | `SnapshotForAI` (semantic subset) |
| AI Observer → Classifier | LOW | `AIIntentResult` (typed result) |
| Classifier → Timeline | LOW | `ClassifiedInteraction` → `SessionEvent` |
| Session Context → Classifier | LOW | Read-only access to L1/L2/L3 |
| Session Context → AI Observer | LOW | Read-only access to L1/L2; write to L2 |
| Generation → Timeline | LOW | Read-only `SessionEvent[]` (unchanged) |
| **Total cross-component coordination points** | **ZERO** | No skip rules, no ownership, no DOM attributes |

Compare with current architecture: 30 coordination points (6 scripts × 5 other scripts).

---

## 16. Trade-off Analysis

### What Architecture C gains

| Gain | Impact |
|---|---|
| Eliminated cross-script coordination | 8 skip checks × 6 scripts = 48 coordination points → 0 |
| Eliminated ~1,200 lines of duplicated helpers | 6 copies of `computeAccessibleName`, `generateCssSelector`, etc. → 1 copy |
| New interaction types are additive | Add classifier rules to one file. No content script changes. |
| Richer AI context | AI sees value changes, state changes, DOM context — not just tag + role |
| Evidence-only baseline | System works without AI (graceful degradation per AP2) |
| Fully testable classification | Classifier is a pure function — unit-testable without a browser |
| Simpler mental model | One observer → one coalescer → one classifier → one timeline |
| Revisable classification | Phase 2 reclassification + Phase 3 verification catch misclassifications |
| AI is structural, not decorative | AI participates in the core intellectual task (classification) |
| Planned components activated | Confidence Engine, Workflow Analyzer, Mental Model all have a role |

### What Architecture C trades

| Trade-off | Cost | Mitigation |
|---|---|---|
| One larger content script | Replaces 6 medium scripts (~6,400 lines → ~1,500 estimated). Organized internally by concern. | Clear internal module structure: event capture, identity extraction, mutation observation, value tracking. |
| Classification moves to service worker | SW is heavier. Content script is thinner. | SW already handles generation, AI, storage. Classification rules are lightweight (<10ms). |
| Phase 1 may misclassify edge cases | Rare — Tier 1/2 rules cover standard controls. | Phase 2 AI refinement corrects. Phase 3 Stop verification catches remaining. Current architecture misclassifies too (worse — irrecoverably). |
| Event coalescing is new complexity | Temporal windowing, event grouping, primary-event selection. | Replaces ownership protocol complexity (net reduction). Unit-testable with synthetic evidence streams. |
| Migration period with two pipelines | Temporary complexity during transition. | Feature flag controls old vs. new path. Binary flag — no partial states. Old code removed after validation. |
| Higher per-interaction AI cost (potentially) | AI receives richer context → slightly larger prompt. | Tier 1/2 handle most cases without AI. AI only consulted on ambiguous clicks (Tier 3). Same call frequency as current. |
| Timeline updates (Phase 2) may cause brief flicker | Rare (<5% of cases). | Phase 1 evidence rules are accurate enough that reclassification is rare. Most Phase 2 updates are name enrichment, not type changes. |

### Net assessment

The gains significantly outweigh the trades. The primary cost (migration complexity) is temporary and managed by the feature-flag approach. The ongoing costs (one larger script, SW heavier) are structurally simpler than the current 6-script coordination problem. Every trade has a mitigation; several trades are net reductions (coalescer replaces ownership protocol; testable classifier replaces untestable content-script heuristics).

---

## 17. Consistency Review Against Frozen Decisions

Architecture C modifies only the recording layer. All frozen product decisions and generation contracts are preserved.

### Against Product Foundation

| Frozen Decision | Consistent? | Notes |
|---|---|---|
| Manifest V3 Chrome Extension | ✅ | One content script instead of 6, still MV3 |
| Side Panel as primary UI | ✅ | Timeline rendering unchanged |
| chrome.storage.local for state | ✅ | Feature flag, Session Context, Timeline all in storage |
| Modular folder structure | ✅ | New modules follow existing `src/recorder/`, `src/generation/` structure |

### Against B1 (Artifact Generation Design)

| Frozen Decision | Consistent? | Notes |
|---|---|---|
| Generation order: Timeline → Steps → JSON → Playwright | ✅ | Generation pipeline untouched |
| Canonical Steps + Exec JSON = source of truth | ✅ | Same inputs to generators |
| 1:1 mapping (Step → Exec Object → Playwright) | ✅ | Timeline events still 1:1 |
| Timeline immutability | ✅ | Phase 1→2 updates happen BEFORE Stop; after Stop, immutable |
| AI-free generation | ✅ | AI is in recording layer, not generation |

### Against B2 (Artifact Generation Architecture)

| Frozen Decision | Consistent? | Notes |
|---|---|---|
| GenerationEngine as sole orchestrator | ✅ | Unchanged |
| Generator contracts (pure functions) | ✅ | Unchanged |
| Batch persistence | ✅ | Unchanged |
| Extension by addition (registry) | ✅ | Unchanged |

### Against B4.1–B4.5 (Execution Model)

| Frozen Decision | Consistent? | Notes |
|---|---|---|
| Three sources of truth | ✅ | Timeline still feeds Steps |
| Execution JSON 6-section contract | ✅ | Unchanged |
| Locator resolution priority (B4.4) | ✅ | Unchanged |

### Against B5.1–B5.3 (Execution JSON)

| Frozen Decision | Consistent? | Notes |
|---|---|---|
| Locator Resolution Engine (pure function) | ✅ | Unchanged |
| Per-step error isolation | ✅ | Unchanged |
| Validation rules VR-1 through VR-13 | ✅ | Unchanged |

### Against B6 (Playwright Generator)

| Frozen Decision | Consistent? | Notes |
|---|---|---|
| translateLocator / translateAction | ✅ | Unchanged |
| iframe frameLocator prefixing | ✅ | Unchanged |

### Against B7.1–B7.2 (Readability Optimizer)

| Frozen Decision | Consistent? | Notes |
|---|---|---|
| OR-1 merge rule | ✅ | Still operates on Timeline |
| Readability touches plainEnglish only | ✅ | Unchanged |

### Against B8 (Validation Framework)

| Frozen Decision | Consistent? | Notes |
|---|---|---|
| 15 workflow categories | ✅ | All still testable |
| 9 defect classification codes | ✅ | Same categories apply |

### Against C3 (Hover)

| Frozen Decision | Consistent? | Notes |
|---|---|---|
| Hover = dwell + observable behavior | ✅ | Classifier Rule 14 implements same logic |
| DWELL_THRESHOLD = 500ms | ✅ | Configurable constant in classifier |
| 6-Gate decision tree | ✅ | Gates become evidence fields in snapshot; classifier applies same checks |
| Visibility transition detection (C3.3) | ✅ | Algorithm moves to Observer's MutationObserver module |

### Against C4 (Checkbox/Radio)

| Frozen Decision | Consistent? | Notes |
|---|---|---|
| State-based, not click-based | ✅ | Classifier Rules 5–6 check stateChange evidence |
| 5-Gate decision tree | ✅ | Gates become evidence checks in classifier |
| Ownership priority over Click | ✅ | Classifier rules 5–6 fire before Rule 15 (click fallback) |

### Against C5 (Dropdown/Select)

| Frozen Decision | Consistent? | Notes |
|---|---|---|
| One interaction type 'select' | ✅ | Classifier produces 'select' type |
| Record only meaningful value changes | ✅ | Classifier checks valueChange/stateChange evidence |
| 5-Gate decision tree | ✅ | Gates become evidence checks in classifier |
| Unified Canonical Step "Select X" | ✅ | Semantic template unchanged |

### Against C6 (Date Picker)

| Frozen Decision | Consistent? | Notes |
|---|---|---|
| One interaction type 'selectDate' | ✅ | Classifier produces 'selectDate' type |
| Value-outcome model | ✅ | Classifier Rule 7 checks valueChange.isDateLike |
| 5-Gate decision tree | ✅ | Gates become evidence checks in classifier |
| Distinct execution verb | ✅ | Verb mapping table unchanged |
| Sub-type Canonical Steps | ✅ | Semantic template unchanged |

### Against AI Philosophy (P1–P8)

| Principle | Consistent? | Notes |
|---|---|---|
| P1: Observation First | ✅ | AI receives evidence (snapshot); classifier reasons over evidence |
| P2: Progressive Understanding | ✅ | Mental Model accumulates across interactions |
| P3: Evidence Sovereignty | ✅ | Tier 1/2 always overrides Tier 3 (AP4) |
| P4: Hypothesis Discipline | ✅ | Max 3 hypotheses; Mental Model prunes |
| P5: Honest Confidence | ✅ | Clamped [0.05, 0.95]; never absolute |
| P6: Evidence Citation | ✅ | ClassificationEvidence cites rule + matched signals |
| P7: Hallucination Rejection | ✅ | AI output validated; prefer null over fabrication |
| P8: Provider Independence | ✅ | Structural validation, not prompt engineering |

### Against AI Observer Architecture

| Decision | Consistent? | Notes |
|---|---|---|
| Session Context 3-layer structure | ✅ | L1/L2/L3 as specified |
| Write-protection boundary | ✅ | Each layer has one writer; readers get deep copies |
| AI Observer is sole writer to L2 | ✅ | No other component writes to Mental Model |
| Stage 3a reads Mental Model as advisory | ✅ | Classifier Tier 3 reads L2 |
| Confidence 5-track weighted model | ✅ | ConfidenceEngine activated |
| AI constraints (10 negative) | ✅ | Enforced structurally (no references to Timeline/generation) |

### Overall consistency verdict

**All frozen decisions are preserved.** Architecture C changes only how events enter the Timeline (the recording layer). Everything downstream — Timeline shape, generation pipeline, artifact contracts, locator resolution, Playwright generation, AI operating philosophy — is untouched. The frozen C-series product rules (gate trees, canonical step formats, ownership priorities, execution verbs) are all expressible as classifier rules operating on snapshot evidence.

---

## 18. Current Limitations and Future Phases

### What Architecture C does NOT include (by design)

These components are planned for future architectural phases. They are not part of Architecture C's scope but are designed to accommodate.

| Future Component | What It Would Add | How Architecture C Prepares |
|---|---|---|
| **Review Layer** | Post-generation quality gate: reviews each step against evidence, flags low-confidence steps, suggests corrections. The Review Engine reads `EvidenceBundle` (screenshot + identity + classification evidence + AI understanding) and produces `ReviewItem`s. | The classifier's `ClassificationEvidence` trail and the AI Observer's evidence citations provide exactly what the Review Engine needs. The `ReviewItem`, `ValidationResult`, and `EvidenceBundle` types are already defined in `architecture-types.ts`. |
| **Export / Download** | File export of recordings, execution JSON, and Playwright code. The `downloads` permission is already declared in the manifest. | No architectural dependency. Export reads from the same storage the generation pipeline writes to. Can be added as a UI feature without pipeline changes. |
| **Copy to Clipboard** | Copy buttons on Playwright code and execution JSON. | UI feature, no architecture impact. |
| **Recording Sensitivity Settings** | User control over hover threshold, coalescing window, capture filters. | The classifier's constants (`DWELL_THRESHOLD`, coalescing window) are configurable. Settings page extension would surface these. |
| **Multimodal AI (Vision)** | Screenshot analysis for AI understanding. Vision-capable providers (Gemini, GPT-4o) currently receive text-only prompts. | The `SnapshotForAI` interface could be extended with a screenshot field. Provider capability flags already exist. The AI Observer's prompt would include the image. |
| **Step Editing / Re-recording** | Edit individual steps, re-record specific interactions. | Requires Timeline mutability (currently immutable after Stop). The Review Layer is the prerequisite — once steps can be reviewed and edited, re-recording becomes possible. |
| **Session Resume** | Pause and resume recording across browser restarts. | Session state is persisted to chrome.storage.local. Resumption requires re-initializing the observer + coalescer + state tracker from persisted state. |

### Components that Architecture C activates (already implemented, currently unwired)

| Component | Architecture C Role |
|---|---|
| Confidence Engine (5-track) | Active — computes composite confidence for AI advisory decisions |
| Workflow Analyzer | Active — feeds `workflow` hypothesis in Mental Model |
| Audit Manager | Active — logs classification decisions for debugging |
| Logging Manager | Active — structured logging across all layers |
| Error Handler | Active — catches and categorizes failures at layer boundaries |

### Why these are separate from Architecture C

Architecture C is focused on the **recording layer** — the pipeline from DOM event to typed Timeline entry. The Review Layer, export, and editing are **post-generation** features that operate on the output of the generation pipeline. They are independent concerns that can be built on top of Architecture C's foundation without modifying the recording or generation layers.

The key insight is that Architecture C produces the evidence trail (`ClassificationEvidence`, `EvidenceBundle`, audit logs) that these future features need. Without Architecture C, these features would have no data to work with — the current architecture discards classification evidence at capture time.

---

## Summary

Architecture C is a capture-first, classify-second design that separates evidence collection from semantic classification. It replaces six concurrent content scripts with one universal observer, introduces a snapshot coalescer that groups raw browser events into rich evidence bundles, and centralizes classification in a multi-tier rule engine where deterministic evidence is authoritative and AI is a structural advisory partner.

The generation pipeline — the strongest part of the current architecture — is entirely preserved. The AI Philosophy (P1–P8), Session Context architecture, and all frozen product decisions are honored. Every component that can be reused is reused; every component that needs replacement has a clear rationale.

This architecture makes AI a first-class participant in the recording process while maintaining deterministic reliability. It scales additively (new interaction types = new rules, not new scripts). It is fully testable at every layer. And it provides the evidence foundation that future phases (Review Layer, export, editing) will build upon.
