# Observation Layer Design — First Principles

**Date:** 2026-07-29
**Status:** Design document — no implementation
**Purpose:** Define the observation layer from first principles so it works across any UI framework without per-application heuristics

---

## 1. Fundamental Concepts

The observation layer must understand six concepts. No more, no fewer.

### 1.1 Event

**What it is:** A single, immutable, timestamped record of something that happened in the DOM — a user input (click, focus, keydown, input, scroll) or a framework-driven state change (navigation, mutation).

**What it captures:** Element identity (who), event type (what), value transitions (before/after), DOM context (where, structurally), timestamp (when), page context (which page).

**What it never captures:** Intent. An event is a physical fact, not an interpretation. "The user clicked a div with class `travel-class-option` and accessibleName 'Premium Economy'" — that's an event. "The user was configuring cabin class" — that's not an event.

**What it is NOT:** An event is not an interaction. Multiple events (focus, click, synthetic change) may compose into a single interaction. One event may be absorbed by an existing interaction. Events are atoms; interactions are molecules.

### 1.2 Interaction

**What it is:** A completed unit of user behavior — the observable outcome of one or more events that represent a single user action. "Selected 'Premium Economy' from the Cabin Class dropdown" is an interaction. It was produced by a focus event (opened the dropdown), a click event (selected the option), and a synthetic change event (value propagated).

**What it captures:** The trigger element (what was interacted with), the member events (what physically happened), the result (what value/state changed), the start/end timestamps (when it happened), and the surface context (what dynamic UI was open).

**What it is NOT:** An interaction is not a capability. "Selected Premium Economy" is an interaction. "Configured travel class for flight search" is a capability. The interaction is the observed fact; the capability is the interpretation of that fact in business terms.

### 1.3 Surface

**What it is:** A transient DOM container that appears after a user action and disappears after the resulting interaction completes. Popovers, modals, drawers, dropdowns, date pickers, autocomplete lists, tooltips — all are surfaces. A surface is the **spatial boundary** of an interaction: events inside the surface belong to the interaction that opened it; events outside don't.

**What it captures:** Surface identity (which DOM element is the container), surface type (modal, popover, drawer, tooltip), surface label (human-readable name from aria-label, heading, or title), and the interaction that opened it (causal provenance).

**Why it's fundamental:** Without surfaces, the runtime cannot distinguish between two concurrent interactions of the same type. "Is this click inside the Cabin Class popover or the Trip Type popover?" is a surface-identity question. The answer determines which session the event belongs to. This is the root cause of the Adani One cross-wiring.

**What it is NOT:** A surface is not a component. A surface is a DOM-space concept (a container exists in the DOM). A component is an interaction-space concept (a session that manages events). One surface may host multiple component sessions (e.g., a modal with a dropdown inside it).

### 1.4 Session

**What it is:** The lifecycle of a single interaction — from the triggering event to the completing event. A session owns a set of events, accumulates intermediate state, and produces a single interaction on completion.

**What it captures:** The trigger event (what started it), the trigger element identity (what was interacted with), the surface it opened (if any), accumulated state (selected value, typed text, scroll delta), and member events (all events that belong to this interaction).

**Why it's fundamental:** The session is the unit of ownership. Every event processed by the runtime must either:
- Belong to an existing session (absorbed as a member event)
- Complete an existing session (the completing event)
- Start a new session (the triggering event)
- Be passed through as an immediate interaction (events that complete instantly, like a simple click)

Without sessions, the runtime can't answer "which interaction does this event belong to?" — and it answers incorrectly by defaulting to the topmost session on the stack, which may be the wrong one.

**What a session owns:**
- Its trigger element (the element the user interacted with)
- Its surface (the container that opened, if the interaction opens one)
- Its member events (all events absorbed during the lifecycle)
- Its intermediate state (per-definition data: selectedValue, typedText, etc.)

**What a session does NOT own:**
- Other sessions (sessions are peers, not parents)
- The capability being exercised (that's interpretation)
- The application's business logic

### 1.5 Context

**What it is:** The immutable structural snapshot captured at event time — the element's identity, its ancestor chain, its ARIA state, the surface it's inside, and its value/checked state.

**Why it's fundamental:** The DOM mutates. React re-renders, Vue patches, Angular updates. By the time the Component Runtime processes an event (in the service worker, across a message boundary), the DOM that produced the event is gone. The context is the only evidence of what the DOM looked like when the event fired.

**What context must include:**
- Element identity (tag, role, accessibleName, ariaLabel, CSS selector, stable ID)
- Ancestor chain (roles and classes, up to a bounded depth)
- Surface context (type, label, and **identity** of the surface container)
- Value transitions (before/after for the element's value, checked state)
- ARIA state (expanded, haspopup, disabled, readonly)

**What context must NOT include:**
- Semantic grouping ("this element is part of the cabin class form")
- Business meaning ("this is a travel class selector")
- Capability hints ("the user is configuring a flight search")

### 1.6 State Transition

**What it is:** The observed change in an element's or surface's state between two events. "The input value was 'Economy' before the click and 'Premium Economy' after" is a state transition. "The popover was open and is now closed" is a surface state transition.

**Why it's fundamental:** An interaction's result is defined by the state transition it produces — not by the events that occurred. The user clicked an option; the result is that the dropdown's value changed from 'Economy' to 'Premium Economy'. If no state transition occurred, the interaction was a no-op (and should be suppressed or marked as such).

**What state transitions the observation layer tracks:**
- Value transitions: `valueBefore → valueAfter` on inputs, selects, textareas
- Checked transitions: `checkedBefore → checkedAfter` on checkboxes, radios
- Surface transitions: surface appeared (popover opened), surface disappeared (popover closed)
- Navigation transitions: URL changed

---

## 2. Responsibilities and Boundaries

### The observation layer IS responsible for:

1. **Capturing events** — every trusted DOM event that occurs during recording, with its full element identity and DOM context, as an immutable ObservedEvent.

2. **Correlating events into interactions** — determining which events belong to which interaction, using surface identity and temporal ordering. This is the session management function.

3. **Detecting surfaces** — identifying when a transient DOM container (popover, modal, drawer) has appeared, capturing its identity, and associating it with the interaction that opened it.

4. **Resolving event ownership** — when multiple active sessions exist, determining which session an event belongs to by checking surface containment (is this event inside this session's surface?).

5. **Producing completed interactions** — accumulating events and intermediate state until the interaction is complete, then emitting a ComponentInteraction with the correct trigger, member events, metadata, and surface context.

6. **Preventing duplicates** — suppressing interactions that represent the same user action as a recently-emitted interaction, using temporal proximity, element identity, and state transition comparison.

7. **Detecting no-ops** — suppressing interactions where no state transition occurred (e.g., selecting an already-selected option).

### The observation layer is NEVER responsible for:

1. **Interpreting intent** — "the user was configuring cabin class" is not an observation. The observation is "the user selected 'Premium Economy' from a dropdown whose trigger was labeled 'Economy'."

2. **Semantic grouping** — "these three interactions form one 'configure flight search' action" is capability-level work. The observation layer emits individual interactions; the capability layer groups them.

3. **Business meaning** — "this dropdown is for selecting travel class" is interpretation. The observation layer records "a dropdown with trigger accessibleName 'Economy' and selectedValue 'Premium Economy'."

4. **Cross-session reasoning** — "the Done button confirms the cabin class selection" is a capability relationship. The observation layer records "the user clicked a button labeled 'Done' inside a modal surface."

5. **Application-specific heuristics** — CSS class patterns like `oxd-select-text`, `MuiSelect`, `ant-select` are framework detection aids, not observation logic. They help identify what kind of element was interacted with, but they must not determine session ownership or interaction completion.

6. **Retrospective re-analysis** — the observation layer is real-time. Once an interaction is emitted, it's immutable. Re-interpretation (changing what the interaction means) happens in the semantic/capability layers, which derive projections from the immutable observation.

---

## 3. Framework-Agnostic Representation

### The Problem with the Current Model

The current `ComponentDefinition` interface uses CSS class regex patterns to identify elements:

```typescript
detectTrigger(event): ComponentTrigger | null
isInScope(event, ctx): boolean
handleEvent(event, ctx): ComponentCompletion | null
```

These methods inspect `event.target.className` and `event.domContext.ancestorClasses` against regex patterns. This works when:
- Each UI framework uses distinct, predictable CSS class names
- Only one framework is used per page
- The same class name doesn't appear on logically different elements

Adani One violates all three assumptions: React renders logically different controls with overlapping class names, multiple UI libraries coexist, and the same token (`select`, `economy`, `class`) appears on different containers.

### The Proposed Model: Surface-Bounded Sessions

The observation layer should determine event ownership through **surface containment**, not CSS class patterns. Here's how:

#### 3.1 Surface Identity (not just surface type)

The current `DomContext` has:
```typescript
surfaceType?: string | null;    // 'modal', 'popover', 'drawer', 'tooltip'
surfaceRole?: string | null;    // ARIA role of the surface
surfaceLabel?: string | null;  // human-readable label
```

This is insufficient. Two concurrent popovers both have `surfaceType: 'popover'`. The runtime can't tell them apart.

**Proposed addition:**
```typescript
surfaceId?: string | null;       // stable identity of the surface container
surfaceOpenedBy?: string | null; // eventId of the interaction that opened this surface
```

`surfaceId` is a stable identity for the surface container element — not its CSS class (which mutates) but a structural identity: the element's tag + stableId, or its role + aria-label + position in the ancestor chain, or a computed hash of its structural position. This is the same kind of identity already used for `ElementIdentity` — extended to surface containers.

`surfaceOpenedBy` records which event triggered the surface to appear — establishing causal provenance. If the user clicked the Cabin Class dropdown trigger (event `evt-42`), and that opened a popover, the popover's `surfaceOpenedBy` is `evt-42`. When a later event fires inside this popover, the runtime can trace it back to the session that `evt-42` started.

#### 3.2 Session-Surface Binding

When a session activates, it may open a surface. The session records:

```typescript
interface ComponentContext {
  // ... existing fields ...
  /** The surface this session opened, if any. Null if the interaction
   *  doesn't open a surface (e.g., simple Click, TextEntry). */
  openedSurface?: SurfaceId | null;
  /** The surface this session lives inside, if the trigger was inside
   *  an already-open surface. Null if the session started in the base page. */
  insideSurface?: SurfaceId | null;
}
```

This gives the session **spatial boundaries**: events inside `openedSurface` belong to this session (or a child session nested inside it); events outside don't.

#### 3.3 Event Ownership via Surface Containment

The `isInScope` check changes from:

**Current (CSS-class based):**
```typescript
isInScope(event, ctx): boolean {
  // Is this event's target inside ANY dropdown surface?
  return isInsideDropdownSurface(event.domContext.ancestorClasses);
}
```

**Proposed (surface-identity based):**
```typescript
isInScope(event, ctx): boolean {
  // Is this event inside THIS session's surface?
  if (ctx.openedSurface && event.domContext.surfaceId === ctx.openedSurface) {
    return true;
  }
  // Is this event on the trigger element itself?
  if (elementKey(event.target) === elementKey(ctx.trigger)) {
    return true;
  }
  return false;
}
```

This is **framework-agnostic** because:
- It doesn't check CSS class names at all
- It checks structural containment (is this event's surface the same as my session's surface?)
- It works equally for MUI, Ant Design, Bootstrap, React-DatePicker, custom SPAs, and future frameworks
- It works for Shadow DOM (surfaceId traverses shadow roots)
- It works for Portals (React Portal elements have their own DOM subtree — surfaceId captures the Portal root)

#### 3.4 Surface Lifecycle Tracking

The runtime needs to track which surfaces are currently open. This is a **surface stack**:

```typescript
interface RuntimeState {
  /** Active component sessions, ordered by activation time. */
  activeSessions: ComponentContext[];
  /** Currently open surfaces, ordered by appearance. 
   *  Each entry links to the session that opened it. */
  openSurfaces: SurfaceEntry[];
}

interface SurfaceEntry {
  surfaceId: string;
  type: string;           // 'modal', 'popover', 'drawer', 'tooltip'
  label: string | null;
  openedBy: string;        // sessionId
  openedAt: number;        // timestamp
}
```

When a session activates and its trigger event indicates `ariaHasPopup` or `aria-expanded: true`, the runtime knows a surface will appear. It then watches subsequent events for evidence of the surface (mutation observer callback, or the first event whose `domContext.surfaceId` matches the new surface).

When a surface disappears (detected by: the surface's element is removed from the DOM, or a mutation observer fires, or an outside-click event fires and no subsequent events reference the surface), the runtime completes the session that opened it.

#### 3.5 Why This Works for All Listed UI Patterns

| UI Pattern | How Surface-Bounded Sessions Handle It |
|-----------|---------------------------------------|
| Dropdowns | Trigger click opens a popover surface → session owns the popover → option clicks inside the popover are absorbed → session completes on option click or surface close |
| Date pickers | Trigger focus opens a calendar surface → session owns the calendar → cell clicks are absorbed → session completes on cell click |
| Stepper controls | Trigger click inside a multiConfig surface (e.g., passenger panel) → session lives inside the parent surface → +/- clicks are absorbed → session completes on surface close (Done button) |
| Dialogs | Trigger click opens a modal surface → modal session owns the modal → interactions inside the modal are children (their `insideSurface` = modal's surfaceId) |
| Menus | Same as dropdowns — menu is a popover surface |
| Filters | Filter panel is a surface → each filter control inside is a child session |
| Trees | Tree node expansion is a surface event → expanding a node creates a child surface for the subtree |
| Tables | Table interactions (sort, row select) are immediate — no surface needed |
| Shadow DOM | surfaceId traverses shadow roots via composedPath — the surface container is identified structurally, not by CSS class |
| Portals | React Portal elements are in a different DOM subtree — surfaceId captures the Portal's root element, which is the structural boundary |
| Floating overlays | Overlays are surfaces — the runtime tracks them by their surfaceId, not their z-index or CSS class |
| Future UI patterns | Any new pattern that creates a transient container will be detected by the surface detection (mutation observer + structural identity) without requiring new CSS class patterns |

### 3.6 How trigger detection works without CSS heuristics

The current `detectTrigger` methods rely on CSS class patterns (`DROPDOWN_TRIGGER_CLASS_RE`). This is the other half of the framework-specific logic.

**The insight:** trigger detection should use **behavioral signals**, not CSS class patterns:

| Signal | What It Means | How to Detect |
|--------|--------------|---------------|
| `aria-haspopup` | This element opens something when clicked | ARIA attribute — framework-independent |
| `aria-expanded` | This element has already opened something | ARIA attribute — framework-independent |
| `role="combobox"` | This is a dropdown trigger | ARIA role — framework-independent |
| Focus triggers a surface | Opening a surface follows focus | Mutation observer detects new surface container |
| Click triggers a surface | Opening a surface follows click | Mutation observer detects new surface container |

**The fallback heuristic:** when ARIA is absent (custom SPA with no ARIA), use the **surface creation signal**: if a click on element X is followed by the appearance of a new surface container in the DOM (detected by mutation observer), then X is the trigger for that surface. This is behavioral — it doesn't care about CSS classes, only about cause and effect.

This eliminates the need for `DROPDOWN_TRIGGER_CLASS_RE` entirely. The trigger is identified by what it does (opens a surface), not by what CSS classes it has.

---

## 4. Do the Proposed Fixes Naturally Emerge?

Yes — all three proposed fixes are natural consequences of the observation model, not Adani One-specific patches.

### 4.1 Surface-bound session identity

**Emerges from:** Section 3.2 (Session-Surface Binding) and 3.3 (Event Ownership via Surface Containment).

**Why it's fundamental, not Adani One-specific:** The model says "a session owns its surface" and "events are owned by the session whose surface they're inside." This is not a heuristic for Adani One — it's the definition of event ownership in any UI. Two concurrent dropdowns on any application (OrangeHRM, Salesforce, any SPA) would be disambiguated the same way.

**What it replaces:** The current `isInScope` implementation checks `isInsideDropdownSurface(ancestorClasses)` — which matches ANY surface. The model replaces this with `event.domContext.surfaceId === ctx.openedSurface` — which matches only THIS session's surface. This is not a new heuristic; it's correcting a broken implementation of the same concept.

### 4.2 Concurrent session resolution

**Emerges from:** Section 3.4 (Surface Lifecycle Tracking) and the surface stack.

**Why it's fundamental:** The model defines that when a new session activates while another is active:
- If the new session's trigger is OUTSIDE the old session's surface → the user switched contexts → the old session completes as "interrupted"
- If the new session's trigger is INSIDE the old session's surface → nested interaction → both coexist, with the child knowing its `insideSurface`

This is not an Adani One rule. It's the structural definition of how transient UI containers interact — applicable to any application with overlapping popovers, modals within modals, or dropdowns within dialogs.

### 4.3 Post-click poll specificity

**Emerges from:** Section 1.1 (Event) and the principle that events are immutable observations.

**Why it's fundamental:** The post-click value poll creates synthetic events. The model says these synthetic events must carry the same identity as the element that produced them — specifically, they must carry the `surfaceId` of the surface that was open when the original interaction occurred. This binds the synthetic event to the correct session.

The current implementation uses a global `lastFocusedEl` — which is not a session-bound concept. It's an implementation artifact. The model replaces it with: "the synthetic change event belongs to the session whose trigger element matches the event's target, AND whose surface (if any) matches the event's surface context."

---

## 5. What Changes in the Architecture

### 5.1 EventTap (content script)

**Current:** Captures events, tracks `lastFocusedEl` globally, polls values after clicks, emits synthetic change events.

**Changes:**
- The EventTap continues to capture events as before — this is correct.
- The post-click value poll should emit synthetic change events that carry the same `surfaceId` as the original focus/click event that started the session. This requires the EventTap to track which surface was open when the tracked element was focused — not just which element was focused.
- Surface appearance detection: the EventTap (or a companion MutationObserver) detects when a new surface container appears in the DOM and emits a "surface appeared" signal. This doesn't need to be a full ObservedEvent — it can be a field on the next ObservedEvent's `DomContext` (`surfaceId` populated by the mutation observer).

### 5.2 DomContext

**Current:** Has `surfaceType`, `surfaceRole`, `surfaceLabel`.

**Changes:** Add `surfaceId` (stable structural identity of the surface container) and `surfaceOpenedBy` (eventId of the event that caused the surface to appear). These are capture-time facts — immutable, structural.

### 5.3 Component Runtime

**Current:** Maintains `activeStack`. Offers events to sessions top→bottom. `isInScope` uses CSS class patterns.

**Changes:**
- `isInScope` checks surface containment, not CSS classes
- `ComponentContext` gains `openedSurface` and `insideSurface` fields
- The runtime maintains a `surfaceStack` alongside `activeStack`
- Concurrent session resolution: when a new session activates, check if its trigger is inside an existing session's surface

### 5.4 Component Definitions

**Current:** `detectTrigger` checks CSS class patterns. `isInScope` checks CSS class patterns.

**Changes:**
- `detectTrigger` uses behavioral signals (aria-haspopup, aria-expanded, surface creation) with CSS class patterns as a fallback, not the primary signal
- `isInScope` checks surface containment against the session's bound surface, not generic surface class patterns

### 5.5 What Does NOT Change

- **EventTap's capture-phase listeners** — correct, stay as-is
- **ObservedEvent structure** — already immutable, stay as-is (just add surfaceId to DomContext)
- **ComponentInteraction output** — already carries trigger, memberEvents, metadata — stay as-is (surface context flows through DomContext)
- **The definition stack pattern** — each definition handles one interaction type, priority-ordered — stay as-is
- **The SemanticInteraction boundary** — observations are facts, projections are interpretations — stay as-is
- **The Capability Model** — consumes SemanticInteraction[], doesn't participate in observation — stay as-is

---

## 6. Why This Is Better Than What We Have

### 6.1 Eliminates per-framework heuristics

The current model has 15+ CSS class regex patterns in `patterns.ts`, each covering a specific framework (OXD, MUI, Ant Design, Bootstrap, generic). Adding a new framework means adding new regex patterns. Adding a new UI pattern means adding new patterns AND updating every definition's `detectTrigger` and `isInScope`.

The proposed model uses structural identity (surfaceId) and behavioral signals (aria-haspopup, surface creation) — both framework-independent. New frameworks work without code changes.

### 6.2 Eliminates the concurrent session problem

Two Dropdown sessions with different surfaces are disambiguated by surfaceId — not by stack order or CSS class patterns. This is deterministic, not timing-dependent.

### 6.3 Eliminates the 15-second timeout as a correctness mechanism

The 15-second timeout becomes a safety net, not the primary lifecycle mechanism. Sessions complete when their surface closes (detected by mutation observer or by the completing event). The timeout only fires if the surface detection fails — a rare edge case, not the common path.

### 6.4 Eliminates the stale label problem

The surfaceId is captured at event time — it doesn't depend on React state flushes. The trigger's accessibleName is still captured at focus time, but the surface identity is structural (based on element position in the DOM, not on the element's rendered text). So even if React re-renders the label, the surfaceId remains stable.

### 6.5 Naturally extends to future UI patterns

New UI patterns that create transient containers (drag-and-drop preview, context menus, command palettes, floating action button menus) are automatically handled by the surface detection — no new definitions needed.

---

## 7. Relationship to the Unified Master Roadmap

This design is NOT a new phase. It is the **content of Phase 0b (type unification)** made explicit:

| Roadmap Phase 0b | This Design |
|------------------|-------------|
| Type unification (adapter shim elimination) | surfaceId replaces CSS class patterns as the primary identity |
| Session model correction | Session-surface binding, concurrent session resolution |
| Surface context correctness | surfaceId + surfaceOpenedBy in DomContext |

The design confirms that the roadmap's phase ordering is correct: the observation layer must be fixed (Phase 0b) before the SemanticInteraction contract is materialized (Phase 0d), because the contract's `surfaceContext` and `overlayContext` fields depend on the runtime producing correct surface identity.

**One adjustment to the roadmap scope:** Phase 0b should explicitly include:
1. Adding `surfaceId` and `surfaceOpenedBy` to `DomContext`
2. Rewriting `isInScope` to use surface containment instead of CSS class patterns
3. Adding session-surface binding to `ComponentContext`
4. Adding concurrent session resolution to the Component Runtime
5. Making `detectTrigger` use behavioral signals (aria-haspopup, surface creation) as primary, CSS patterns as fallback
6. Binding the post-click value poll to the session's surface

These are the implementation tasks that the first-principles design produces. They are not Adani One fixes — they are the correct implementation of the observation model that the architecture was trying to express all along.
