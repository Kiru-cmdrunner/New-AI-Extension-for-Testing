# R3: Behavioral Semantic Reasoning — Design Document (Revised)

> **Status:** ✅ IMPLEMENTED. Post-R3 baseline: commit `1b2fa89`.
>
> **Baseline:** Commit `5a6f5d5` (R2 complete, frozen).
>
> **Roadmap Reference:** `CANONICAL_ROADMAP.md` §3 Phase R3.
>
> **Architectural Objective:** Complete the evidence engine so it can classify interactions based on observable behavioral effects — **including effects produced by the application's own event handlers** — not just structural attributes present before the handler runs. This is the phase that **completes the vision**: a general-purpose semantic recorder that understands what the user did regardless of how the web app implements the interaction.
>
> **Revision History:**
> - Initial design: R3.4 proposed a post-click attribute poll (50/150/400ms) to capture class/aria transitions. Design review discovered this **cannot work**: the Click definition completes synchronously in the capture phase, before the page's handler runs. The evidence engine has already finalized classification before any post-handler data arrives.
> - **Revised design** replaced the polling approach with Click lifecycle deferral: the Click definition enters a brief active state, a content-script re-snapshot captures post-handler behavioral data, and classification runs after both pre-handler and post-handler data are available.
>
> ---
>
> ## ⚠️ Implementation Deviation — Annotation Deferral (ACTUAL ARCHITECTURE)
>
> **The approved design specified Click lifecycle deferral** (Click definition changes from immediate completion to a brief active window via `isInScope`/`handleEvent`/`shouldCompleteOnOutside` modifications in `click.ts`).
>
> **The actual implementation uses annotation deferral instead.** During implementation, the Click lifecycle approach broke 23 test files that simulate the runtime directly and expect Click to emit immediately from a single `process()` call.
>
> **What was implemented:**
> - Click definition remains synchronous (unchanged from pre-R3)
> - The Click emits normally via `onEmit` in `sw-integration.ts`
> - Instead of calling `annotateWithEvidence()` immediately, the SW integration layer holds the Click in a `pendingAnnotations` list keyed by `stableId`
> - When the `attribute-change` event arrives from EventTap's `setTimeout(0)` re-snapshot, the pending Click is annotated with full post-handler behavioral data (`attributeChanges` in metadata)
> - If no `attribute-change` event arrives (next event or `stopRecording`), the Click is annotated with pre-handler data only (same as pre-R3 behavior)
>
> **Architectural equivalence:** Both approaches achieve the same outcome — the evidence engine sees post-handler behavioral data before classification finalizes. The mechanism differs:
> - Lifecycle deferral: Click stays active on the runtime stack, classification deferred at the component definition level
> - Annotation deferral: Click emits immediately, annotation deferred at the SW integration layer
>
> **This is the canonical architecture going forward.** Future work must not assume the Click definition has a lifecycle window. The annotation deferral pattern in `src/runtime/sw-integration.ts` is the mechanism for ensuring post-handler data reaches the evidence engine.
>
> **Design note:** `.drytis/notes/r3-step6-annotation-deferral-decision.md` documents the decision process.
>
> ---

---

## §1. What R3 Makes Possible That Is Not Possible Today

### The Problem (Today, Post-R2)

The evidence engine — the designated semantic reasoning layer — classifies **only** Click interactions that no lifecycle definition claimed, using **only** structural attributes (ARIA roles, tags, CSS classes) snapshotted at DOM capture time. The DOM capture phase fires **before** the page's own click handler. So:

- Class transitions (`opt` → `opt selected`) — invisible. The handler hasn't run yet.
- aria-expanded transitions (absent → `true`) — invisible. Same reason.
- Value changes on the clicked element — invisible (except for the focused-input post-click value check, which creates a separate interaction, not augmenting the Click).

Additionally, 10 behavioral/structural fields captured by the recorder never reach the evidence engine (data propagation gap), and the `select`/`input` intent derivation paths are stubbed.

**Result:** When a lifecycle definition misses a novel implementation, the evidence engine cannot recover because it sees only the pre-handler structural state — not the behavioral effect of the click. The "regardless of implementation" requirement fails.

### What R3 Delivers (After Implementation)

| Capability | Before R3 | After R3 |
|---|---|---|
| Evidence engine has behavioral data from **after** the handler runs | ❌ Not possible — Click frozen before handler | ✅ Click lifecycle deferred; re-snapshot captures post-handler state |
| Div-checkbox (no ARIA, no input, class toggle only) | → Click (no signal) | → Checkbox (behavioral generator detects class state change) |
| Novel combobox (no ARIA, panel appears on click) | → Click (no signal at capture time) | → Dropdown (behavioral generator detects panel emergence) |
| Evidence engine intent coverage | 4 of 6 intents have generators | 6 of 6 intents have generators |
| Evidence engine input fields | 14 fields (15% behavioral) | ~24 fields (~50% behavioral) |
| Unrecognized interactions | Silent degradation to Click | Surfaced with evidence trail (confidence below threshold, flagged) |

---

## §2. How R3 Fits the Existing Architecture

R3 is **evolution, not redesign**. The three architectural primitives are unchanged:

| Primitive | R3 Change | Why |
|---|---|---|
| `EvidenceGenerator` interface | **Unchanged** | New generators follow the same `{ id, generate(features) → IntentVote[] }` contract |
| `fuseEvidence()` signature | **Unchanged** | The fusion algorithm is the same; new generators just add more votes |
| `SemanticIntent` enum | **Unchanged** | Same 6 values |
| `FeatureViewInput` interface | **Extended** (add fields) | More data exposed to generators; all additive |
| `deriveType()` switch | **Two cases implemented** | `select` and `input` were stubbed returning Click; now derive real types |
| `EvidenceClassifier` signature | **Extended** | Accept full `ComponentInteraction` for attribute-transition access |
| Component Runtime | **Unchanged** | Priority sorting, lifecycle management, dedup — all untouched |
| Click definition | **Lifecycle change** | `isInScope`/`handleEvent`/`buildResult` gain a brief active window |
| IR Bridge | **Unchanged** | Already handles all InteractionType values |
| Playwright generation | **Unchanged** | |
| Assertion engine | **Unchanged** | |
| Pattern Registry | **Unchanged** | |

**No new types (beyond the small `AttributeChange` data struct), no new architectural layers, no contract breaks.**

---

## §3. The Timing Problem and Its Solution

### 3.1 The Timing Problem (Why R3.4's Original Approach Failed)

```
DOM Event: user clicks a div-checkbox
  ↓
EventTap (content script, capture phase)
  ↓ Snapshot DOM state (classes, ARIA, values — all PRE-handler)
  ↓ Send ObservedEvent → service worker (async chrome.runtime.sendMessage)
  ↓
Service Worker receives ObservedEvent
  ↓ ComponentRuntime.process(event)
  ↓ Click detectTrigger → match
  ↓ Click handleEvent → { completed }  ← IMMEDIATE
  ↓ Click buildResult → ComponentInteraction
  ↓ onEmit → annotateWithEvidence → classify → persist
  ↓ ← Click is NOW FROZEN with pre-handler data only
  ↓
[Some time later: 50/150/400ms]
  ↓ Page's click handler has run: div.classList.toggle('selected')
  ↓ Post-click poll detects class change
  ↓ But Click is already emitted/classified/persisted — no re-annotation path
```

### 3.2 The Revised Approach: Click Lifecycle Deferral (DESIGN — SUPERSEDED BY IMPLEMENTATION)

> **⚠️ SUPERSEDED:** The design specified Click lifecycle deferral as described below. The actual implementation uses **annotation deferral** at the SW integration layer instead. See the implementation deviation note at the top of this document. The description below is retained for design history but does **not** reflect the implemented architecture. Future work must reference the annotation deferral pattern in `src/runtime/sw-integration.ts`, not the lifecycle changes described here.

The Click definition changes from **immediate completion** to a **brief active lifecycle** — the same pattern already used by Hover and Scroll. The lifecycle window is long enough to absorb a post-handler behavioral snapshot from the content script, then completes with both pre-handler and post-handler data available.

**The complete revised lifecycle:**

```
DOM Event: user clicks a div-checkbox
  ↓
EventTap (content script, capture phase)
  ↓ Snapshot DOM state (PRE-handler classes, ARIA, values)
  ↓ Send ObservedEvent → service worker
  ↓ Schedule attribute re-snapshot: setTimeout(0) after current event loop
  ↓     (fires after capture phase + bubble phase + page handler completes)
  ↓
Service Worker receives ObservedEvent
  ↓ ComponentRuntime.process(event)
  ↓ Click detectTrigger → match
  ↓ Click handleEvent → null  ← NOT completed; stays active
  ↓ Click is on the active stack
  ↓
[Next macrotask — content script]
  ↓ Attribute re-snapshot fires (setTimeout(0))
  ↓ Re-reads element: classes NOW include 'selected' (handler ran)
  ↓ Diffs pre/post attributes → AttributeChange[]
  ↓ Sends supplementary ObservedEvent with attributeChanges in domContext
  ↓
Service Worker receives supplementary event
  ↓ ComponentRuntime.process(supplementaryEvent)
  ↓ Active-stack loop: Click isInScope → true (claims attribute-transition events)
  ↓ Click handleEvent → { completed }  ← NOW completes with full data
  ↓ Click buildResult → includes attributeChanges from member events
  ↓ onEmit → annotateWithEvidence → classify with BOTH pre + post behavioral data
  ↓ ← Click is emitted with behavioral evidence
```

### 3.3 Why This Solves the Problem

1. **The Click is not frozen until after the handler runs.** `handleEvent` returns `null` on the triggering click — the Click stays active on the stack.
2. **The re-snapshot fires after the page's handler.** `setTimeout(0)` in the content script schedules the re-snapshot as a macrotask, which runs after the current synchronous event dispatch (capture + bubble + default action + the page's handler).
3. **The supplementary event reaches the runtime.** It arrives as a new `OBSERVED_EVENT` message (following the proven `schedulePostClickValueCheck` pattern). The active Click claims it via `isInScope`.
4. **Classification runs after full data is available.** `annotateWithEvidence` executes in `onEmit`, which fires when Click completes — after the supplementary event with post-handler data has been absorbed.

---

## §4. Scope

### 4.1 In Scope

| Item | Description | Type |
|---|---|---|
| R3.1 | Expand `FeatureViewInput` with ~10 behavioral/structural fields already captured | Data propagation |
| R3.2 | Implement `select` and `input` intent derivation in `type-deriver.ts` | Logic completion |
| R3.3 | Add behavioral evidence generators for `select`, `input`, `explore`, and enhanced `toggle` | Extension |
| R3.4 | **REVISED:** Click lifecycle deferral + content-script attribute re-snapshot | Lifecycle change + new capture |
| R3.5 | Add confidence threshold for unrecognized interactions | Behavioral |

### 4.2 Out of Scope (Deliberately Deferred)

| Item | Why Deferred | Roadmap Phase |
|---|---|---|
| Multi-interaction temporal context (autocomplete sequences, stepper patterns) | Improves confidence but not a prerequisite for single-interaction behavioral classification | Optional Enhancement O6 |
| AI-assisted intent classification | Platform Phase P3/P6 (AI features) | Not architectural |
| Cross-frame semantic resolution | Iframe content classified by frame-local recorder; cross-frame reasoning is platform concern | Platform Phase P7 |
| Continuous MutationObserver (always-on DOM observation) | Performance risk; short-window post-interaction re-snapshot is sufficient | Never (architectural decision) |
| Novel interaction types beyond the 23 InteractionType values | R3 maps behavioral evidence to **existing** types | Platform Phase P1 |
| Visual appearance inference (computed styles, layout position) | Out of scope — visual analysis is a different signal class | Never (architectural decision) |

### 4.3 Confirmation: Deferred Items Are Not Required for the R3 Objective

- **Multi-element temporal patterns (O6):** R3 classifies single interactions. Even if a sibling radio button loses its `selected` class, the clicked element's own class-gaining-`selected` is sufficient behavioral signal for classification. Temporal correlation improves confidence but is not needed for correct classification.
- **Continuous MutationObserver:** The `setTimeout(0)` re-snapshot captures post-handler state. A continuous observer would add more data (delayed state changes) but is not required for the primary behavioral cases.
- **AI-assisted classification:** Behavioral evidence is deterministic (class changed, value changed, panel appeared). No probabilistic reasoning needed.
- **Novel InteractionType values:** R3 maps behavioral evidence to existing types. If behavioral signals suggest "select intent" but no structural context narrows it further, the result is Dropdown (generic select). This is sufficient.
- **Visual inference:** Not needed — behavioral effects (class changes, ARIA state transitions, value changes) are semantically meaningful without visual analysis.

**None of the deferred items are necessary to claim R3 achieves the architectural objective.**

---

## §5. Architectural Approach

### 5.1 R3.1 — Expand FeatureViewInput (Data Propagation)

**What:** Add ~10 fields to `FeatureViewInput` that are already captured but not propagated to the evidence engine.

**Where:**
- `src/classifier/evidence/types.ts` — extend interface
- `src/classifier/evidence/feature-view.ts` — map fields in `buildFeatureView()`

**New fields:**

```typescript
// Value transitions (behavioral — the most important addition)
readonly valueBefore: string | null;
readonly valueAfter: string | null;

// ARIA state (behavioral + structural)
readonly ariaExpanded: boolean | null;
readonly ariaHasPopup: string | null;
readonly ariaAutoComplete: string | null;
readonly ariaValueNow: string | null;

// Element properties (structural)
readonly inputType: string | null;
readonly isContentEditable: boolean;

// Context (structural — for disambiguation)
readonly ancestorClasses: string[];

// Attribute transition (from R3.4 — populated when available)
readonly hasAttributeTransition: boolean;
readonly attributeChanges: ReadonlyArray<AttributeChange>;
```

Where `AttributeChange` is:
```typescript
interface AttributeChange {
  attribute: string;   // 'class', 'aria-expanded', 'aria-checked', 'aria-selected', 'style'
  before: string | null;
  after: string | null;
}
```

**Design principle:** All new fields are `readonly` and nullable (or default to empty). Existing generators that don't read them are unaffected. `buildFeatureView()` is the single mapping point — no other code changes.

### 5.2 R3.2 — Implement select and input Intent Derivation

**What:** The `deriveType()` switch has `select` and `input` cases that return `Click`. Implement them based on the feature view.

**Where:** `src/classifier/evidence/type-deriver.ts`

**Derivation logic:**

```
select intent:
  IF ariaHasPopup is set AND (ariaExpanded === true OR attribute transition on aria-expanded) → Dropdown
  ELSE IF attribute transition on aria-expanded → Dropdown
  ELSE IF ariaValueNow is set → Slider
  ELSE IF ancestorRoles include listbox/menu/tablist → Dropdown (generic select)
  ELSE → Click (insufficient behavioral signal for a specific select type)

input intent:
  IF valueBefore !== valueAfter (value changed) → TextEntry
  ELSE IF isContentEditable → TextEntry
  ELSE → Click (no value transition observed)
```

**Extended `DerivedInteractionType`:** Add `'Dropdown'`, `'Slider'`, `'TextEntry'`, `'RadioButton'` to the return union.

**Design principle:** Derivation is conservative — if behavioral signals are ambiguous, fall back to Click rather than guessing. The evidence trail preserves the audit of what was observed.

### 5.3 R3.3 — Behavioral Evidence Generators

**What:** Add generators that vote for `select`, `input`, and `explore` based on behavioral signals.

**Where:** `src/classifier/evidence/generators.ts` (add to existing file, register in `EVIDENCE_GENERATORS`)

**New generators:**

#### Value Change Generator (`value-change`)
**Intent:** `input`
**Signals:** `valueBefore !== valueAfter` OR `isContentEditable === true`
**Weight:** +0.6 (behavioral), +0.5 for contentEditable (structural-but-strong)
**Negative:** suppress `trigger` at −0.2

#### Panel Emergence Generator (`panel-emergence`)
**Intent:** `select`
**Signals:** `ariaExpanded === true`, OR attribute transition on `aria-expanded`, OR `ariaHasPopup` present
**Weight:** +0.6 for transition (behavioral), +0.5 for static ariaExpanded (structural), +0.3 for ariaHasPopup (hint)
**Negative:** suppress `navigate` at −0.2

#### Selection State Generator (`selection-state`)
**Intent:** `select` and `toggle`
**Signals:** Attribute transitions on `class` that add/remove selection-related tokens
**Weight:** +0.4 (class-based — intentionally below ARIA)
**Logic:**
- Class gained token matching `/select|active|chosen|current|picked/i` → vote `select` at +0.4
- Class gained token matching `/check|toggle|on|enabled/i` → vote `toggle` at +0.4

#### Slider Value Generator (`slider-value`)
**Intent:** `select`
**Signals:** `ariaValueNow` is set
**Weight:** +0.5

**Weight calibration rationale:**

| Signal Class | Weight Range | Rationale |
|---|---|---|
| Standards (ARIA declared) | 0.7–0.9 | Explicit semantic declaration by the developer |
| Behavioral (observed effect) | 0.5–0.7 | The application's code actually did this — strong but indirect |
| Structural (CSS/context) | 0.1–0.4 | Convention-based — may be decorative |
| Negative (suppression) | −0.2 to −0.3 | Contextual disambiguation |

### 5.4 R3.4 — Click Lifecycle Deferral and Attribute Re-Snapshot (REVISED)

This is the most complex and critical change in R3. It has two coordinated parts:

#### 5.4.1 Content-Script: Attribute Re-Snapshot

**What:** After the click event is captured and sent, the content script schedules a `setTimeout(0)` re-snapshot of the clicked element's attributes. If attributes changed, a supplementary event is sent.

**Where:** `src/tap/event-tap.ts`

**Implementation:**

```typescript
const ATTRIBUTES_TO_TRACK = [
  'class', 'aria-expanded', 'aria-checked',
  'aria-selected', 'style', 'aria-pressed',
];

function schedulePostClickAttributeSnapshot(
  targetEl: Element,
  preClickAttrs: Map<string, string | null>,
): void {
  // setTimeout(0) — fires after capture + bubble phase + page handler
  setTimeout(() => {
    if (!targetEl.isConnected) return;

    const postClickAttrs = snapshotAttributes(targetEl);
    const changes: AttributeChange[] = [];

    for (const attr of ATTRIBUTES_TO_TRACK) {
      const before = preClickAttrs.get(attr) ?? null;
      const after = postClickAttrs.get(attr) ?? null;
      if (before !== after) {
        changes.push({ attribute: attr, before, after });
      }
    }

    if (changes.length > 0) {
      // Emit a synthetic 'attribute-transition' event following the
      // proven pattern of schedulePostClickValueCheck
      const syntheticEvent = buildAttributeTransitionEvent(targetEl, changes);
      config.onEvent(syntheticEvent);
    }
  }, 0);
}
```

**The pre-click snapshot is captured during `handleRawEvent`** — at the same point where the click event is assembled. The `extractDomContext` call already captures attribute values; the pre-click snapshot simply stores them for the diff.

**Why `setTimeout(0)` instead of 50/150/400ms?**

The page's click handler runs **synchronously during event dispatch**. After the event dispatch completes (capture + bubble + default action + handler), the next macrotask fires. `setTimeout(0)` schedules the re-snapshot as the next macrotask — immediately after the handler. This is faster and more deterministic than the 50ms polling interval.

Some frameworks (React 16 async mode, concurrent features) batch updates across macrotasks. For these cases, the initial `setTimeout(0)` may miss a delayed state flush. However:
- React 17+ uses synchronous flushing for event handlers
- The existing `schedulePostClickValueCheck` pattern with 50/150/400ms is retained for the VALUE check (which targets focused inputs, not the clicked element) — this catches delayed value updates
- For attribute transitions specifically, the `setTimeout(0)` approach covers the dominant case (synchronous handler). If empirical testing reveals frequent misses, the re-snapshot can be upgraded to a 2-poll pattern (0ms + 50ms). But start simple.

#### 5.4.2 Click Definition: Brief Lifecycle (DESIGN — SUPERSEDED)

> **⚠️ SUPERSEDED BY IMPLEMENTATION:** The section below describes the lifecycle change to `click.ts` that was designed but **not implemented**. The actual implementation uses annotation deferral in `src/runtime/sw-integration.ts` instead. The Click definition remains synchronous. See the implementation deviation note at the top of this document.
>
> **What was actually implemented (R3.4 Part 2):**
> - `sw-integration.ts` maintains a `pendingAnnotations: PendingAnnotation[]` list
> - When a Click is emitted without a subtype, it enters `pendingAnnotations` instead of being immediately annotated
> - When an `attribute-change` event arrives, `processObservedEvent()` finds the matching pending Click by `stableId`, attaches the attribute changes to `interaction.metadata`, and calls `finalizeAnnotation()` which runs `enrichInteraction()` + `annotateWithEvidence()` + pushes to `liveInteractions`
> - Fallback: `finalizeAllPendingAnnotations()` runs on the next `processObservedEvent()` call or on `stopRecording()` — annotates with pre-handler data only
> - No changes to `click.ts`, `component-runtime.ts`, or any lifecycle definition

**What (designed, not implemented):** The Click definition changes from immediate completion to a brief active window.

**Where:** `src/definitions/click.ts`, `src/runtime/component-runtime.ts`

**Changes to `click.ts`:**

```typescript
// isInScope: claim attribute-transition events for the active Click
isInScope(event: ObservedEvent, ctx: ComponentContext): boolean {
  // Only claim attribute-transition events on the same element
  if (event.eventType !== 'attribute-transition') return false;
  return event.target.stableId === ctx.trigger.stableId;
},

// handleEvent: don't complete on trigger; complete on attribute-transition
handleEvent(event, ctx): ComponentCompletion | null {
  if (event.eventType === 'attribute-transition') {
    // Store the attribute changes for buildResult
    const changes = event.domContext?.attributeChanges;
    if (changes) {
      ctx.data.attributeChanges = changes;
    }
    return { endState: 'completed' };
  }

  // Trigger event (click/dblclick/contextmenu) — stay active
  // Store pre-handler data, schedule nothing (content script handles re-snapshot)
  return null;
},

// shouldCompleteOnOutside: complete if next event is a different interaction
// (prevents Click from absorbing subsequent real interactions)
shouldCompleteOnOutside(event, ctx): boolean {
  // Any non-attribute-transition event completes the Click
  // This handles: next click, keypress, navigation, etc.
  return true;
},
```

**But there's a problem with the above:** `shouldCompleteOnOutside` completing on the next event means the Click completes when the next real interaction arrives — which could be a long time later (user pauses between clicks). During that time, the Click is on the active stack and the evidence engine hasn't run yet.

**Resolution: A hybrid approach.** The Click lifecycle has TWO completion triggers:

1. **Primary: attribute-transition event** (from the `setTimeout(0)` re-snapshot). This fires within the same macrotask cycle. If attributes changed, the Click completes with full behavioral data.

2. **Fallback: `shouldCompleteOnOutside`** returning `true`. If no attribute-transition event arrives (because no attributes changed), the Click completes on the next event with pre-handler-only data. This is the same data the evidence engine sees today — no regression.

3. **Safety net: stale timeout.** If no events arrive at all, the 15-second `MAX_LIFECYCLE_DURATION_MS` cleanup handles it. This is unlikely (user interactions are frequent) but safe.

**However**, there's a subtlety: the 15-second stale timeout is far too long for Click. If the user clicks once and waits, the Click stays on the stack for 15 seconds, blocking the evidence engine. This is unacceptable latency.

**Better approach: Content-script always sends a completion event.** The `setTimeout(0)` re-snapshot ALWAYS fires — it just finds zero attribute changes if the handler didn't modify any tracked attributes. In that case, it sends an empty attribute-transition event (or a `click-complete` event). The Click `handleEvent` completes on receiving ANY event from the re-snapshot, whether or not attributes changed.

**Final Click lifecycle:**

```
Trigger (click/dblclick/contextmenu) arrives
  ↓ Click detectTrigger → match
  ↓ Click handleEvent → null (stays active)
  ↓ Content script: setTimeout(0) fires after handler
  ↓ Content script: re-snapshot element attributes
  ↓ Content script: send 'click-complete' event with attributeChanges (possibly empty)
  ↓ SW: ComponentRuntime.process(clickCompleteEvent)
  ↓ Click isInScope → true (same element)
  ↓ Click handleEvent → { completed }, stores attributeChanges
  ↓ Click buildResult → ComponentInteraction with attributeChanges
  ↓ onEmit → annotateWithEvidence → classify with full data
  ↓ Click removed from active stack
```

**This approach guarantees:**
- The Click completes within ~1-5ms of the handler finishing (one macrotask + message roundtrip)
- No 15-second zombie risk
- Attribute data is always available (empty array if nothing changed)
- The evidence engine always sees post-handler state

**Handling `dblclick` and `contextmenu`:**

These events bypass `isInteractiveElement` and produce subtypes (`DoubleClick`, `RightClick`). They use the same lifecycle mechanism:

- `dblclick`/`contextmenu` triggers → Click enters active state
- Content script schedules `setTimeout(0)` re-snapshot (same as click)
- `click-complete` event arrives → Click completes
- `buildResult` checks `ctx.triggerEvent.eventType` for the subtype

**No change to subtype logic** — it reads `triggerEvent.eventType` at `buildResult` time, which is preserved through the lifecycle.

**Handling rapid consecutive clicks:**

If a second click arrives while the first Click is still active (within the `setTimeout(0)` window):

1. The second click goes through active-stack routing first
2. Click's `isInScope` returns false for 'click' events (only claims 'click-complete' / 'attribute-transition')
3. Click's `shouldCompleteOnOutside` is called → returns true → **first Click completes with pre-handler data only**
4. Second click proceeds to discovery → new Click starts

This means: the first Click in a rapid burst may not get post-handler attribute data. This is acceptable — the first Click's evidence is the same as today (pre-handler snapshot). The second Click gets the full lifecycle. In practice, rapid bursts on the same element are either double-clicks (handled by `dblclick` event) or repeated clicks on the same control (where behavioral evidence is the same for each click).

**Actually — reconsider:** The `shouldCompleteOnOutside` returning `true` means ANY next event completes the pending Click. If the `click-complete` event from the re-snapshot arrives BEFORE the next user event (which it will, since `setTimeout(0)` fires before any user can click again), this race is irrelevant. The Click completes via the `click-complete` event, not via `shouldCompleteOnOutside`. The `shouldCompleteOnOutside = true` is a safety net that only fires if the content script's `setTimeout(0)` somehow fails to produce a message (extension context invalidated, etc.).

**Handling dedup:**

Dedup compares same-type + same-element + gap ≤ 2s. With lifecycle deferral:
- Click A triggers → stays active → `click-complete` arrives → completes → dedup record set
- Click B triggers → stays active → `click-complete` arrives → completes → dedup check: same type, same element, gap < 2s → **suppressed**

This is correct — same behavior as today. Dedup runs at `completeComponent` time, which is when the Click actually emits.

### 5.4.3 Component Runtime: No Changes Required

The runtime already supports this pattern:
- `handleEvent` returning `null` keeps a component active (used by Hover, Scroll)
- `isInScope` routing to active components (used by Hover, Scroll, Dropdown)
- `shouldCompleteOnOutside` completing on outside events (used by Scroll)
- Dedup at completion time

The Click definition's changes are self-contained within `click.ts`. The runtime code does not change.

### 5.4.4 New Event Type: `click-complete`

A new synthetic `BrowserEventType` value `'click-complete'` is emitted by the content script after the attribute re-snapshot. This is an internal type — it carries:
- `eventType: 'click-complete'`
- `target`: same ElementIdentity as the original click
- `domContext.attributeChanges`: `AttributeChange[]` (possibly empty)

The Click definition's `triggerEventTypes` includes this (for `detectTrigger` to potentially recognize it — but actually, the Click is already active, so this goes through `isInScope`, not discovery). The `isInScope` check returns true for `click-complete` events on the same element.

Actually — cleaner approach: Don't add a new event type. Use the existing `change` event type for the synthetic event, and carry the attribute changes in `domContext`. The Click definition's `isInScope` checks for `change` events on the same element that carry `domContext.attributeChanges`. This avoids adding a new BrowserEventType.

**Even cleaner:** Add a dedicated `attribute-change` BrowserEventType. This is semantically distinct from `change` (which means input value change). The new type clearly signals "post-handler attribute re-snapshot." It's internal — the user never sees it. The Click definition registers it in `triggerEventTypes` for completeness, but since the Click is already active, it goes through `isInScope`.

**Decision:** Use a new BrowserEventType `'attribute-change'`. It's semantically correct, avoids overloading `change`, and is easy to filter/test.

### 5.5 R3.5 — Unrecognized Interaction Threshold

**What:** When the evidence engine produces a classification with confidence below a threshold, flag the interaction.

**Where:** `src/classifier/evidence/annotation-layer.ts`

**New behavior:**
- `UNRECOGNIZED_THRESHOLD = 0.3`
- If confidence < threshold AND max evidence weight < 0.3:
  - Set `interaction.metadata.unrecognized = true`
  - Set `interaction.metadata.recognitionNote = 'No evidence generator produced meaningful signal'`

**Design principle:** Surface unknowns, don't hide them. The evidence trail always shows WHY the classification was made (or not made).

---

## §6. Implementation Boundaries — What Remains Unchanged

| Component | Change? | Notes |
|---|---|---|
| `ComponentDefinition` interface | ❌ Unchanged | |
| `ComponentRuntime` | ❌ Unchanged | Already supports lifecycle definitions |
| `EvidenceGenerator` interface | ❌ Unchanged | |
| `fuseEvidence()` | ❌ Unchanged | |
| `SemanticIntent` enum | ❌ Unchanged | |
| `IntentVote` interface | ❌ Unchanged | |
| IR Bridge | ❌ Unchanged | |
| Playwright generation | ❌ Unchanged | |
| Assertion engine | ❌ Unchanged | |
| Pattern Registry | ❌ Unchanged | |
| Golden master corpus | ✅ Extended | New behavioral-only fixtures |
| `FeatureViewInput` | ✅ Extended | ~10 new fields |
| `buildFeatureView()` | ✅ Extended | Map new fields + read interaction data |
| `classifyByEvidence()` | ✅ Extended | Accept full interaction |
| `deriveType()` | ✅ Extended | `select`/`input` implemented |
| `EVIDENCE_GENERATORS` array | ✅ Extended | 4 new generators |
| EventTap | ✅ Extended | `schedulePostClickAttributeSnapshot()` |
| Click definition | ❌ Unchanged | **Annotation deferral implemented at SW integration layer instead of lifecycle change. See implementation deviation note.** |
| DomContext | ✅ Extended | `attributeChanges` field |
| annotation-layer.ts | ✅ Extended | Unrecognized threshold, pass full interaction |
| sw-integration.ts | ✅ Extended | **Annotation deferral**: `pendingAnnotations` list, `finalizeAnnotation()`, `finalizeAllPendingAnnotations()`. Click annotations deferred until `attribute-change` event arrives |

---

## §7. Implementation Steps

### Step 1: FeatureViewInput Expansion (R3.1)

**Files:** `types.ts`, `feature-view.ts`, `component-types.ts`
**Changes:**
1. Add `AttributeChange` interface to `component-types.ts`
2. Add `attributeChanges?: AttributeChange[]` to `DomContext` interface
3. Add new fields to `FeatureViewInput` interface (all readonly, nullable)
4. Update `buildFeatureView()` to map new fields

**Regression gate:** `tsc --noEmit` — 0 src errors. Golden master unchanged. Existing generators compile unchanged.

### Step 2: Evidence Classifier Signature Evolution

**Files:** `evidence-classifier.ts`, `annotation-layer.ts`
**Changes:**
1. Change `classifyByEvidence(target, event)` → `classifyByEvidence(interaction: ComponentInteraction)`
2. Extract `interaction.trigger` and `interaction.triggerEvent` internally
3. Pass interaction data to `buildFeatureView` for member-event/metadata access
4. Update annotation-layer.ts call site

**Regression gate:** `tsc --noEmit` — 0 src errors. Golden master unchanged. Evidence tests pass.

### Step 3: Type Deriver Implementation (R3.2)

**Files:** `type-deriver.ts`
**Changes:**
1. Extend `DerivedInteractionType` union
2. Implement `select` case
3. Implement `input` case
4. Extend `deriveMetadata()` for select/input intents

**Regression gate:** `tsc --noEmit` — 0 src errors. Golden master unchanged (no generators vote select/input yet).

### Step 4: Behavioral Evidence Generators (R3.3)

**Files:** `generators.ts`
**Changes:**
1. Implement `valueChangeEvidence` generator
2. Implement `panelEmergenceEvidence` generator
3. Implement `selectionStateEvidence` generator
4. Implement `sliderValueEvidence` generator
5. Register all 4 in `EVIDENCE_GENERATORS`

**Regression gate:**
- `tsc --noEmit` — 0 src errors
- Golden master: some Clicks may reclassify. **Expected and desired.** Review diffs, regenerate.
- Existing toggle/navigate/trigger evidence tests pass (generators unchanged)

### Step 5: Content-Script Attribute Re-Snapshot (R3.4 Part 1)

**Files:** `event-tap.ts`, `component-types.ts`
**Changes:**
1. Add `'attribute-change'` to `BrowserEventType`
2. Add `AttributeChange` interface to `component-types.ts`
3. Add `attributeChanges?: AttributeChange[]` to `DomContext`
4. Implement `snapshotAttributes()` helper
5. Implement `schedulePostClickAttributeSnapshot()` — captures pre-click attrs, schedules `setTimeout(0)` re-snapshot, sends synthetic `'attribute-change'` event with `domContext.attributeChanges` (always sends, even if empty)
6. Call from the click/mousedown handler alongside existing `schedulePostClickValueCheck()`

**Regression gate:**
- `tsc --noEmit` — 0 src errors
- EventTap tests pass
- Full suite — the synthetic events are new; existing tests don't expect them. **Click definition doesn't handle them yet** (that's Step 6). The synthetic events should be ignored by all lifecycle definitions (no definition's `triggerEventTypes` or `isInScope` claims them). Verify they pass through harmlessly.

### Step 6: Click Definition Lifecycle Change (R3.4 Part 2)

**Files:** `click.ts`
**Changes:**
1. Add `'attribute-change'` to `triggerEventTypes` (for discovery fallback — see below)
2. Change `isInScope`: return true for `'attribute-change'` events on the same element
3. Change `handleEvent`: return `null` for click/dblclick/contextmenu; return `{ completed }` for `'attribute-change'`, storing attribute changes in `ctx.data`
4. Add `shouldCompleteOnOutside`: return true (safety net for edge cases)
5. Update `buildResult`: read `ctx.data.attributeChanges`, include in metadata

**The critical sequencing detail:** When the `'attribute-change'` event arrives at the runtime:
- Active-stack loop runs first: Click is on the stack, `isInScope` returns true, `handleEvent` returns completed
- Click completes with attribute data

If the Click is NOT on the stack (e.g., it was already completed by a prior event), the `'attribute-change'` event goes to discovery. No definition's `detectTrigger` matches `'attribute-change'` → event is dropped. Safe.

**Regression gate:**
- `tsc --noEmit` — 0 src errors
- Golden master: **Review all changes.** Some Clicks now have slightly different timing (completing one macrotask later). Verify no interaction ordering changes in the output. Attribute changes appear in metadata for Clicks where the handler modified attributes.
- Domain adapter tests — verify 1-transition-per-interaction still holds
- E2E pipeline tests — verify no ordering changes
- Full suite — verify no regressions

### Step 7: Unrecognized Interaction Threshold (R3.5)

**Files:** `annotation-layer.ts`
**Changes:**
1. Add `UNRECOGNIZED_THRESHOLD = 0.3`
2. In `annotateClick()`, flag low-confidence interactions

**Regression gate:** `tsc --noEmit` — 0 src errors. Golden master: some low-confidence Clicks may get `unrecognized: true`. Review diffs.

### Step 8: Golden Master Behavioral Fixtures

**Files:** `tests/golden-master/corpus.ts`, new snapshot files
**Changes:**
1. Add fixtures for behavioral-only scenarios (see §9.1)
2. Generate snapshots
3. Verify the evidence engine classifies these correctly

### Step 9: R3 Gate Test Suite

**Files:** `tests/r3-behavioral-gates.test.ts`
**Changes:** Gate tests G9-G17 (see §8)

---

## §8. Regression Gates Summary

| Gate | Check | When |
|---|---|---|
| G1 | `tsc --noEmit` — 0 errors in `src/` | After every step |
| G2 | Golden master — all fixtures pass | After Steps 4, 6, 7, 8 |
| G3 | Domain adapter V2 — 38 tests | After all steps |
| G4 | Full test suite — same pass rate as R2 baseline | After all steps |
| G5 | E2E pipeline — 17 tests | After all steps |
| G7 | R2 slider gates — 16 tests | After all steps (no regression) |
| G9 | FeatureViewInput propagation — all new fields populated | After Step 1 |
| G10 | select/input derivation — correct types | After Step 3 |
| G11 | Behavioral generator coverage — each generator votes correctly | After Step 4 |
| G12 | Attribute re-snapshot — post-handler class/aria changes captured | After Step 5 |
| G13 | **Timing proof: classification data includes post-handler state** | After Step 6 |
| G14 | Div-checkbox end-to-end: no ARIA, class toggle → Checkbox | After Steps 1-7 |
| G15 | Novel dropdown end-to-end: panel appears → Dropdown | After Steps 1-7 |
| G16 | Misleading-signal: link-styled toggle → Checkbox (not Link) | After Steps 1-7 |
| G17 | Unrecognized interaction flagging | After Step 7 |
| G18 | Rapid click safety: no lost clicks, no duplicate interactions | After Step 6 |
| G19 | Performance: attribute re-snapshot adds no measurable latency | After Step 5 |

---

## §9. Validation Strategy — Proving Behavioral Classification Works

### 9.1 The Core Principle: Tests Must Prove Post-Handler Data Drove the Classification

The validation must demonstrate that the classification was based on behavioral data **produced by the application's handler**, not merely on pre-existing structural attributes. Every behavioral test case must prove this by:

1. **Setting up an element with NO structural signal** for the expected type (no ARIA role, no semantic tag, no framework class)
2. **Defining a handler that produces the behavioral signal** (class toggle, aria-expanded set, value change)
3. **Verifying the classification uses the post-handler behavioral data** — not just that the right type was produced, but that the evidence trail cites behavioral generators

This prevents synthetic tests that accidentally bypass the timing problem (e.g., by pre-setting attributes that would have been handler-created).

### 9.2 Negative-Signal Validation Scenarios

| Scenario | Element Setup (NO structural signal) | Handler Behavior | Expected Classification | Evidence Trail Must Cite |
|---|---|---|---|---|
| **Div-checkbox** | `<div class="opt" tabindex="0">` (no role, no input) | `classList.toggle('selected')` | Checkbox (toggle) | `selection-state` generator, behavioral weight |
| **Novel combobox** | `<div class="combo" tabindex="0">` (no role, no popup attr) | Sets `aria-expanded="true"` on self | Dropdown (select) | `panel-emergence` generator, behavioral weight |
| **Custom segmented control** | `<div class="seg-btn" tabindex="0">` | `classList.add('active')` | Select intent → Click* | `selection-state` generator |
| **ContentEditable** | `<div contenteditable="true">` | (no handler needed — static property) | TextEntry (input) | `value-change` generator, structural weight |
| **Value-change input** | `<div class="display" tabindex="0">` | Sets `textContent` to new value | TextEntry (input) | `value-change` generator, behavioral weight |

*Segmented control: R3 classifies based on single-element signals. Sibling de-selection is multi-element temporal context (deferred to O6).

### 9.3 Misleading-Signal Validation Scenarios

| Scenario | Structural Signal (misleading) | Behavioral Signal (correct) | Expected Result | Why Behavioral Wins |
|---|---|---|---|---|
| **Link-styled toggle** | `<a class="filter-link">` (tag=A → navigate) | Handler toggles class `active` | Checkbox (toggle) | `selection-state` votes toggle +0.4; structural votes navigate +0.4; behavioral evidence of state change is stronger signal of intent |
| **Button-styled dropdown** | `<button>` (tag=BUTTON → trigger) | Handler sets `aria-expanded="true"` | Dropdown (select) | `panel-emergence` votes select +0.6; trigger votes trigger +0.3; behavioral panel emergence is stronger |

**Weight calibration for misleading signals:** In the link-styled toggle case, structural signals vote navigate (+0.4 from tag) and the behavioral signal votes toggle (+0.4 from class change). The scores tie. The fusion function picks the first-ranked on ties. **This means the behavioral signal needs to be slightly stronger to reliably win.**

**Resolution:** The `selection-state` generator should vote at +0.5 for class transitions that match selection-state patterns (not +0.4). This puts behavioral state-change evidence above structural tag evidence (+0.4), ensuring behavioral signals win in misleading-signal cases. Updated weight: +0.5 for class-state transitions (still below ARIA's 0.7-0.9).

### 9.4 Timing-Proof Validation

The gate tests must explicitly verify the temporal ordering:

**Gate G13 (Timing Proof):**
1. Create a div with `class="opt"` and a click handler that adds `class="selected"` after 0ms (synchronous in handler)
2. Simulate the full pipeline: EventTap capture → SW runtime → Click lifecycle → re-snapshot → classification
3. Assert: `interaction.metadata.attributeChanges` contains `{ attribute: 'class', before: 'opt', after: 'opt selected' }`
4. Assert: the evidence trail cites `selection-state` generator
5. Assert: `interaction.type` is `Checkbox` or has subtype indicating toggle
6. **Critical assertion:** Verify that the pre-handler snapshot did NOT have `class="opt selected"` (i.e., the behavioral data was genuinely produced by the handler, not pre-existing)

This last assertion is the key — it proves the test isn't accidentally bypassing the timing problem.

### 9.5 Regression Validation

All existing golden master fixtures must still classify correctly. New generators should not interfere with lifecycle-classified interactions (they run only for Click-without-subtype in the evidence engine).

**Risk scenario:** The Click lifecycle change affects timing of ALL Click interactions, not just behavioral ones. Every Click now completes one macrotask later. Verify:
- Interaction ordering is preserved (Clicks still appear in the order they occurred)
- Dedup still works (same-element rapid clicks suppressed)
- DoubleClick/RightClick subtypes preserved
- No Click is lost (if `stopRecording` is called during the lifecycle window, `flush()` handles it)

### 9.6 Performance Validation

The attribute re-snapshot adds one `setTimeout(0)` + one DOM read + one message per click. Verify:
- Milestone 4 scaling tests (1000+ elements) still pass within budget
- No measurable latency in the recording pipeline
- The re-snapshot reads only 6 attributes on 1 element

---

## §10. Exit Criteria — Measurable Completion Standards

R3 is complete when ALL of the following are true:

### Architectural Completion

| # | Criterion | Measurement |
|---|---|---|
| EC1 | Evidence engine has generators for at least 5 of 6 SemanticIntents | Generator registry — `select`, `input`, `toggle`, `navigate`, `trigger` all have voting generators |
| EC2 | `deriveType()` implements all 6 intent cases (no stubs) | Code inspection — `select`/`input` return specific types |
| EC3 | `FeatureViewInput` exposes behavioral signals | Interface — `valueBefore`, `valueAfter`, `ariaExpanded`, `attributeChanges` present |
| EC4 | Click lifecycle deferral is functional | Test — Click stays active until `attribute-change` event arrives |

### Behavioral Classification (The Vision Test)

| # | Criterion | Measurement |
|---|---|---|
| EC5 | Div-checkbox: no ARIA, no input, class toggle only → Checkbox | Golden master fixture + gate test. **Must verify no pre-existing structural signal for checkbox semantics.** |
| EC6 | Novel combobox: no ARIA, handler sets aria-expanded → Dropdown | Golden master fixture + gate test. **Must verify aria-expanded was absent at capture time.** |
| EC7 | ContentEditable click → TextEntry | Golden master fixture + gate test |
| EC8 | Misleading-signal: link-styled toggle (`<a>` + class toggle) → Checkbox, NOT Link | Gate test. **Must verify the `<a>` tag was present (structural navigate signal existed but behavioral won).** |
| EC9 | Unrecognized interactions surfaced | Gate test — low-confidence interaction has `metadata.unrecognized = true` |

### Timing Proof

| # | Criterion | Measurement |
|---|---|---|
| EC10 | Classification data includes post-handler behavioral state | Gate G13 — `attributeChanges` in metadata reflect handler-produced changes, verified absent at capture time |
| EC11 | Evidence trail for behavioral classifications cites behavioral generators | Gate test — `selection-state`, `panel-emergence`, or `value-change` in evidence trail |

### Regression Safety

| # | Criterion | Measurement |
|---|---|---|
| EC12 | `tsc --noEmit` — 0 errors in `src/` | Compilation |
| EC13 | Golden master — all fixtures pass (including new behavioral) | Test run |
| EC14 | Full test suite — same pass rate as R2 baseline | Test run |
| EC15 | E2E pipeline — 17 tests pass | Test run |
| EC16 | R2 slider gates — 16 tests pass | Test run |
| EC17 | Performance — Milestone 4 scaling tests pass within budget | Test run |

### Lifecycle Safety

| # | Criterion | Measurement |
|---|---|---|
| EC18 | No duplicate interactions from Click lifecycle deferral | Gate G18 — rapid click test produces correct count |
| EC19 | No lost clicks during lifecycle window | Gate G18 — all clicks produce interactions |
| EC20 | DoubleClick/RightClick subtypes preserved | Gate test — dblclick/contextmenu still produce correct subtypes |
| EC21 | Interaction ordering preserved | Golden master — interactions appear in correct order |
| EC22 | `flush()` handles pending Click lifecycle | Test — `stopRecording()` during active Click completes correctly |

---

## §11. Limitations Remaining After R3

These limitations are **intentionally deferred** and do not undermine the R3 objective:

| Limitation | Why It Remains | Future Phase |
|---|---|---|
| **Multi-element temporal patterns** | Requires correlating multiple interactions. R3 classifies single interactions. | O6 (Optional) |
| **Delayed framework state flushes** | `setTimeout(0)` covers synchronous handlers. React concurrent features or multi-frame animations may flush later. The existing 50/150/400ms value poll covers focused-input value changes. | Empirical tuning |
| **Confidence calibration tuning** | R3 establishes the weight framework. Empirical tuning against real-world apps is ongoing. | Continuous |
| **Continuous MutationObserver** | Short-window re-snapshot is sufficient. Always-on observation is a performance concern. | Never (architectural) |
| **Semantic role inference from visual appearance** | Visual analysis is a different signal class. | Never (architectural) |
| **Novel InteractionType values** | R3 maps to existing types. | P1 (Platform) |

---

## §12. Risk Assessment

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| **Over-classification** — behavioral generators misread decorative class changes | Medium | Incorrect classifications | Weight calibration: behavioral class-change at +0.5 (below ARIA 0.7-0.9). Selection-token regex limits to semantic words. Empirical validation before raising weights. |
| **Click lifecycle latency** — every Click now completes ~1-5ms later | Low | Side panel display delay | One macrotask + message roundtrip is imperceptible. The side panel already has message-passing latency. |
| **Rapid click edge cases** — second click arrives during first Click's lifecycle | Low | First Click completes without behavioral data | `shouldCompleteOnOutside = true` completes the first Click on the next event. First Click gets pre-handler data (same as today — no regression). |
| **`stopRecording` during lifecycle** — Click active when recording stops | Low | Click interrupted | `flush()` calls `completeComponent` for all active components. Click's `shouldCompleteOnFlush` can return true to complete normally. |
| **FeatureViewInput growth** — 14→24 fields | Low | Maintenance | Each generator reads only fields it cares about. All additions are additive. |
| **Golden master drift** — new generators reclassify Clicks | High (expected) | Snapshot changes | Review every reclassification. Regenerate only after verifying correctness. |
| **`setTimeout(0)` not fast enough for React 18 batching** | Low | Missing attribute transitions for some frameworks | React 18 event handlers flush synchronously. Start with `setTimeout(0)`; add a second poll at 50ms if empirical testing reveals gaps. |

---

## §13. Design Principles Followed

1. **Evolution, not redesign** — no new architectural layers, no new InteractionType values
2. **Extension via designated extension points** — generators in `EVIDENCE_GENERATORS`, fields on `FeatureViewInput`, derivation in `deriveType()`
3. **Behavioral signals must be post-handler** — the lifecycle deferral ensures the evidence engine sees the application's behavioral response, not just the pre-handler structural state
4. **Conservative derivation** — ambiguous behavioral signals fall back to Click
5. **Surface unknowns** — unrecognized interactions flagged, not hidden
6. **Weight calibration discipline** — behavioral signals intentionally calibrated relative to ARIA signals
7. **Safety nets for lifecycle edge cases** — `shouldCompleteOnOutside`, `shouldCompleteOnFlush`, stale timeout
8. **The observation is immutable** — attribute transitions are capture-layer data on DomContext
9. **No regression in existing behavior** — lifecycle definitions, dedup, ordering, subtypes all preserved
10. **Tests prove post-handler timing** — validation explicitly verifies behavioral data was produced by the handler, not pre-existing

---

*End of R3 Design Document (Revised). Awaiting approval before implementation.*
