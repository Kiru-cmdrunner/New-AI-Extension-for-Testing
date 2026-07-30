# Observation Model — Formal Design Document

**Document Status:** Design — pending review and agreement
**Date:** 2026-07-29
**Supersedes:** `OBSERVATION_LAYER_DESIGN.md` (first-draft concepts, retained for history)
**Relationship to existing architecture:** Extends `CMDRECORDER_ARCHITECTURE.md` §4–9 with a formal observation model. Does not replace the architecture document — it formalizes the observation layer that the architecture was trying to express.

---

## Table of Contents

1. [Purpose and Scope](#1-purpose-and-scope)
2. [Design Principles](#2-design-principles)
3. [Core Concepts](#3-core-concepts)
4. [Concept Relationships](#4-concept-relationships)
5. [Event Model](#5-event-model)
6. [Surface Model](#6-surface-model)
7. [Session Model](#7-session-model)
8. [Interaction Model](#8-interaction-model)
9. [Context Model](#9-context-model)
10. [State Transition Model](#10-state-transition-model)
11. [Ownership and Correlation](#11-ownership-and-correlation)
12. [Lifecycle](#12-lifecycle)
13. [Invariants](#13-invariants)
14. [Responsibilities and Boundaries](#14-responsibilities-and-boundaries)
15. [Framework Agnosticism](#15-framework-agnosticism)
16. [Integration with Existing Architecture](#16-integration-with-existing-architecture)
17. [Type Contracts](#17-type-contracts)
18. [Validation Criteria](#18-validation-criteria)

---

## 1. Purpose and Scope

### 1.1 Purpose

This document defines the observation layer of the CmdRunner recorder from first principles. The observation layer is the part of the recorder that captures what the user physically does in the DOM and correlates raw browser events into complete, meaningful interactions.

The observation layer sits between the browser's DOM event system and the semantic/capability layers that interpret what the observations mean:

```
Browser DOM Events
        ↓
  ┌──────────────────────────────────┐
  │    OBSERVATION LAYER             │
  │                                  │
  │  EventTap → Component Runtime    │
  │  → ComponentInteraction[]        │
  └──────────────┬───────────────────┘
                 ↓
  ┌──────────────────────────────────┐
  │    SEMANTIC LAYER                │
  │                                  │
  │  Classifier → SemanticReasoner   │
  │  → SemanticInteraction[]         │
  └──────────────┬───────────────────┘
                 ↓
  ┌──────────────────────────────────┐
  │    CAPABILITY LAYER              │
  │                                  │
  │  CapabilityDeriver → Capability  │
  └──────────────────────────────────┘
```

The observation layer answers: **"What did the user do?"**
The semantic layer answers: **"What kind of interaction was that?"**
The capability layer answers: **"What business capability was the user exercising?"**

### 1.2 Scope

**In scope:**
- Event capture and representation
- Surface detection, identity, and lifecycle
- Session management and event correlation
- Interaction production and deduplication
- Context capture and immutability
- State transition observation
- The boundary between observation and interpretation

**Out of scope:**
- Semantic classification (Dropdown vs. DatePicker vs. Checkbox)
- Evidence-based classification (V1/V2/merge pipeline)
- Semantic reasoning (component session collapse, multiConfig detection)
- Capability derivation
- IR generation and test code generation
- Execution and healing

### 1.3 What This Document Replaces

This document formalizes concepts that were partially expressed across:
- `CMDRECORDER_ARCHITECTURE.md` §4 (Event Capture), §9 (Lifecycle Architecture)
- `component-types.ts` (type definitions)
- `patterns.ts` (CSS class pattern matching)
- `dom-context-extractor.ts` (surface detection)
- `component-runtime.ts` (session management)

The formal model does not discard these implementations — it defines the correct contracts and invariants they should satisfy. Implementation refactoring follows from the model, not the other way around.

---

## 2. Design Principles

### P1: Observation, Not Interpretation

The observation layer records physical facts about what happened in the DOM. It never records what those facts mean in business or semantic terms.

- ✅ "User clicked a div with role=option and accessibleName='Premium Economy' inside a container with surfaceId='surf-003'"
- ❌ "User selected Premium Economy as their travel class"

The first is an observation. The second is an interpretation. The observation layer produces the first; the semantic/capability layers produce the second.

### P2: Surface as Spatial Boundary

Event ownership is determined by spatial containment — which surface the event occurred inside — not by CSS class patterns or temporal ordering.

When two dropdowns are open simultaneously, the event inside dropdown A's popover belongs to dropdown A's session because the event's `surfaceId` matches A's `openedSurface`. This is a structural fact, not a heuristic.

### P3: Immutability of Observations

Once an event is captured or an interaction is emitted, it is immutable. The observation layer does not retroactively modify, re-classify, or re-interpret observations. Downstream layers that need different interpretations create projections that reference the immutable observation by ID.

### P4: Framework Agnosticism

The observation model must work for any UI framework (React, Vue, Angular, Svelte, vanilla JS) and any component library (MUI, Ant Design, Bootstrap, custom) without framework-specific code in the core model.

Framework-specific CSS class patterns are permitted as **fallback hints** for trigger detection — but they are never the primary signal for event ownership, session boundary, or interaction completion.

### P5: Bounded Complexity

The model must handle arbitrarily complex UIs (nested modals, dropdowns inside dropdowns, portals, shadow DOM) without per-pattern logic. The surface hierarchy model (Section 6) provides this: nesting is just surface-stacking, not a new concept per pattern.

### P6: Temporal Ordering with Structural Disambiguation

Events are processed in temporal order. When temporal ordering is insufficient to determine ownership (concurrent sessions of the same type), surface identity disambiguates. Temporal proximity alone never determines ownership — it is a secondary signal for deduplication, not for correlation.

---

## 3. Core Concepts

The observation layer is built on six concepts. Each is a first-class entity with its own identity, lifecycle, and invariants.

| Concept | Section | What It Is | What It Owns |
|---------|---------|-----------|--------------|
| **Event** | §5 | A single immutable DOM occurrence | Its own identity, element, context, values |
| **Surface** | §6 | A transient DOM container for an interaction | Its identity, type, label, the session that opened it |
| **Session** | §7 | The lifecycle of one interaction | Its trigger event, surface, member events, state |
| **Interaction** | §8 | A completed unit of user behavior | Its trigger, member events, result, surface context |
| **Context** | §9 | An immutable DOM snapshot at event time | Element identity, ancestors, surface, values |
| **State Transition** | §10 | Observed change between two events | Before state, after state, what changed |

No additional concepts are needed. The Adani One issues (cross-wiring, missed captures, stale labels) are fully explained by the absence of surface identity (§6) and the resulting inability to enforce event ownership (§11).

---

## 4. Concept Relationships

```
                    ┌──────────┐
                    │  Event   │  (immutable, captured at DOM event time)
                    └────┬─────┘
                         │ carries
                         ▼
                    ┌──────────┐
                    │ Context  │  (immutable DOM snapshot)
                    └────┬─────┘
                         │ references
                         ▼
                    ┌──────────┐
                    │ Surface  │  (transient DOM container)
                    └────┬─────┘
              opened by  │  contains events
                    ┌────▼─────┐
                    │ Session  │  (lifecycle of one interaction)
                    └────┬─────┘
              produces   │
                    ┌────▼──────┐
                    │Interaction│  (completed user action)
                    └───────────┘
                         │ observes
                         ▼
                    ┌────────────────┐
                    │State Transition│  (before → after)
                    └────────────────┘
```

### Relationship Rules

1. **Event → Context**: Every event carries exactly one Context, captured at the moment the DOM event fired. The Context is immutable.

2. **Context → Surface**: A Context may reference a Surface (if the event occurred inside an open surface). If no surface is open, the reference is null.

3. **Session → Surface**: A Session may open a Surface (if the interaction creates a transient container). A Session may also live inside a Surface (if the interaction occurs within an already-open surface, e.g., a dropdown inside a modal).

4. **Session → Events**: A Session owns its trigger event and zero or more member events. Every event belongs to at most one Session (or is an immediate interaction with no session lifecycle).

5. **Session → Interaction**: A Session produces exactly one Interaction on completion. An abandoned or interrupted Session produces an Interaction with `endState: 'abandoned'` or `endState: 'interrupted'`.

6. **Interaction → State Transition**: An Interaction observes exactly one primary State Transition (the result of the interaction). The state transition is derived from the member events' before/after values.

---

## 5. Event Model

### 5.1 Definition

An Event is an immutable record of a single occurrence in the DOM — a user input (click, focus, keydown, input, scroll) or a framework-driven change (navigation, synthetic value change from post-click polling).

### 5.2 Event Identity

Every event has a unique `eventId` (string, format `evt-NNNN`). This ID is assigned by the service worker when the event arrives from the content script. Once assigned, it never changes.

### 5.3 Event Fields

```
Event {
  eventId: string                    // unique identifier (evt-NNNN)
  eventType: BrowserEventType        // click | focus | blur | input | change | ...
  timestamp: number                  // epoch milliseconds
  isTrusted: boolean                 // true = user-initiated, false = synthetic
  target: ElementIdentity            // identity of the DOM element
  domContext: DomContext             // structural snapshot (includes surfaceId)
  valueBefore: string | null         // element value before the event
  valueAfter: string | null          // element value after the event
  checkedBefore: boolean | null      // checked state before (checkboxes/radios)
  checkedAfter: boolean | null       // checked state after
  pageUrl: string                    // URL of the page where the event occurred
  pageTitle: string                  // page title at event time
  // Pointer/keyboard/scroll fields as needed
}
```

### 5.4 Event Categories

| Category | Event Types | Characteristics |
|----------|------------|-----------------|
| **User input** | click, mousedown, contextmenu, focus, blur, keydown, input | `isTrusted: true`. The primary source of interaction triggers and completions. |
| **Framework change** | change, scroll | `isTrusted: true` for native change; `isTrusted: false` for synthetic change from post-click polling. |
| **Navigation** | navigation | Not a DOM event — synthesized by the EventTap from History API monkey-patching or `webNavigation` API. Carries URL + title instead of target identity. |
| **Hover** | mouseenter, mouseleave, mousemove | Rate-limited (50ms for mousemove). Used for Hover interactions; otherwise noise. |

### 5.5 Synthetic Events

The EventTap's post-click value poll produces synthetic `change` events when it detects that an input's value changed after a click. These events have `isTrusted: false`.

Synthetic events are legitimate observations — the value DID change. But they must carry the same `surfaceId` as the event that started the session, so the runtime can correlate them to the correct session. (See §11.3.)

### 5.6 Event Immutability

Once an Event is constructed (in the content script, at DOM event capture time), its fields never change. The EventTap's deferred blur value capture (setTimeout(0) for SPA flush) mutates the Event before it is sent to the service worker — this is acceptable because the Event hasn't been observed by the runtime yet. Once the runtime processes the Event, it is immutable.

---

## 6. Surface Model

### 6.1 Definition

A Surface is a transient DOM container that appears after a user action and disappears after the resulting interaction completes. It is the **spatial boundary** of an interaction.

Examples: dropdown popover, calendar grid, modal dialog, drawer, autocomplete suggestion list, tooltip, context menu, bottom sheet, command palette.

### 6.2 Surface Identity

A Surface has a stable identity (`surfaceId`) that distinguishes it from all other surfaces, including surfaces of the same type.

```
SurfaceId = structural identity of the surface container element
```

`surfaceId` is derived from the surface container's element identity — the same kind of identity used for `ElementIdentity`:
- If the container has a `data-testid`, `id`, or `data-cy`: use it directly
- Otherwise: compose from `tag + role + aria-label + structural position` (nth-child index in parent, depth from body)

This is **not** a CSS class name (which mutates when React re-renders). It is a structural identity that remains stable across re-renders because it is based on the element's position in the DOM tree, not its styling.

### 6.3 Surface Fields

```
Surface {
  surfaceId: string                  // stable structural identity
  type: SurfaceType                  // 'modal' | 'popover' | 'drawer' | 'tooltip' | 'sheet'
  role: string | null                // ARIA role of the container (dialog, listbox, menu, ...)
  label: string | null               // human-readable label (from aria-label, heading, or title)
  openedByEventId: string | null     // the event that caused this surface to appear
  openedAt: number                   // timestamp when the surface was first detected
  closedAt: number | null            // timestamp when the surface was removed from the DOM
}
```

### 6.4 Surface Types

| Type | Typical ARIA Role | Typical CSS Pattern | Example |
|------|------------------|--------------------|---------|
| `modal` | dialog, alertdialog | `.modal`, `.MuiDialog`, `.ant-modal` | Login dialog, confirmation modal |
| `popover` | listbox, menu, grid, tooltip | `.popover`, `.dropdown-menu`, `.react-datepicker` | Dropdown list, calendar grid, context menu |
| `drawer` | — | `.drawer`, `.MuiDrawer`, `.ant-drawer` | Side panel, filter drawer |
| `sheet` | — | `.bottom-sheet`, `.MuiBottomSheet` | Mobile bottom sheet |
| `tooltip` | tooltip | `.tooltip`, `.MuiTooltip` | Hover tooltip (non-interactive) |

### 6.5 Surface Detection

Surfaces are detected by the content script's DOM context extractor, which walks the element's ancestor chain at event capture time. The extractor already detects surface **type** (`detectSurface()` in `dom-context-extractor.ts`). The model adds surface **identity** — the structural identity of the surface container.

Detection signals (in priority order):
1. **ARIA role**: `dialog`, `alertdialog`, `menu`, `listbox`, `tree`, `grid`, `tooltip`
2. **ARIA attribute**: `aria-modal="true"`
3. **HTML element**: `<dialog>` element
4. **CSS class patterns** (fallback): matches against known framework patterns

The first three signals are framework-independent. The fourth is a fallback for frameworks that don't use ARIA.

### 6.6 Surface Hierarchy

Surfaces can nest: a dropdown inside a modal creates a surface hierarchy (modal surface → popover surface). The hierarchy is tracked by the `insideSurface` field on the Session (§7.3), not by a parent-child relationship on Surface itself. The runtime's surface stack (§11.4) maintains the hierarchy implicitly through ordering.

### 6.7 Surface Lifecycle

```
                    Surface does not exist
                            │
                     user action (click/focus
                     on trigger element)
                            │
                            ▼
                    ┌───────────────────┐
                    │  Surface Appeared  │  detected by mutation observer
                    │  openedBy = evt-N  │  or first event inside it
                    └────────┬──────────┘
                             │
                    user interacts inside surface
                    (events carry surfaceId)
                             │
                    ┌────────┴──────────┐
                    │                   │
                    ▼                   ▼
          option selected        outside click / Esc
          surface closes         surface closes
                    │                   │
                    └────────┬──────────┘
                             │
                             ▼
                    ┌───────────────────┐
                    │  Surface Closed    │  container removed from DOM
                    │  closedAt = T      │  or outside click detected
                    └───────────────────┘
```

A surface's lifecycle is bounded by its appearance and disappearance in the DOM. The observation layer detects both:
- **Appearance**: MutationObserver detects a new container element matching surface patterns, OR the first event whose `domContext.surfaceId` references a surface not yet in the surface stack.
- **Disappearance**: MutationObserver detects the container's removal from the DOM, OR an outside-click event fires and no subsequent events reference the surface.

---

## 7. Session Model

### 7.1 Definition

A Session is the lifecycle of a single interaction — from the triggering event to the completing event. It is the **unit of ownership** in the observation layer.

### 7.2 Session Identity

Every session has a unique identity derived from its type and the runtime's interaction counter:

```
sessionId = `${type}-${interactionCounter}`
// e.g., "Dropdown-5", "DatePicker-7", "Click-12"
```

### 7.3 Session Fields

```
Session {
  sessionId: string                  // unique identity
  type: InteractionType              // Dropdown | DatePicker | Click | ...
  state: SessionState                // 'active' | 'completed' | 'abandoned' | 'interrupted'
  trigger: ElementIdentity           // the element the user interacted with
  triggerEvent: Event                // the event that started this session
  memberEvents: Event[]              // all events belonging to this session
  openedSurface: SurfaceId | null    // surface this session created (if any)
  insideSurface: SurfaceId | null    // surface this session lives inside (if nested)
  startTime: number                  // timestamp of triggerEvent
  endTime: number                    // timestamp of completion/abandonment
  data: Record<string, unknown>      // per-type scratch space (selectedValue, typedText, ...)
}
```

### 7.4 Session States

```
            trigger event
                 │
                 ▼
          ┌─────────────┐
          │   active     │
          └──────┬───────┘
                 │
    ┌────────────┼────────────┐
    │            │            │
    ▼            ▼            ▼
┌────────┐ ┌──────────┐ ┌────────────┐
│completed│ │abandoned │ │interrupted │
└────────┘ └──────────┘ └────────────┘
```

| State | Meaning | Produces Interaction? |
|-------|---------|----------------------|
| `active` | Session is accumulating events. | No — waiting for completion. |
| `completed` | A completion event fired (option click, value change, surface close). | Yes — with `endState: 'completed'`. |
| `abandoned` | Session exceeded the timeout (15s) without completing. | Yes — with `endState: 'abandoned'`, if it has useful state. Suppressed if empty. |
| `interrupted` | A new session started on a different surface, indicating context switch. | Yes — with `endState: 'interrupted'`, if it has useful state. Suppressed if empty. |

### 7.5 Session-Surface Binding

When a session activates:
- If the trigger event's `domContext.surfaceId` is non-null AND references an already-open surface → the session lives inside that surface: `insideSurface = surfaceId`, `openedSurface = null`.
- If the trigger event indicates a surface will open (`aria-haspopup`, `aria-expanded: true`, or a mutation observer detects a new surface appearing after this event) → the session owns that surface: `openedSurface = newSurfaceId`, `insideSurface = null` (or the parent surface if nested).
- If no surface is involved (simple Click, TextEntry) → both are null.

### 7.6 Session Scope

A session claims events that are:
1. **On the trigger element itself** — `elementKey(event.target) === elementKey(ctx.trigger)`
2. **Inside the session's opened surface** — `event.domContext.surfaceId === ctx.openedSurface`
3. **On a surface control** — e.g., calendar navigation buttons inside a date picker surface

A session does NOT claim events that:
- Are inside a DIFFERENT session's surface (even if the same type)
- Are outside all surfaces and not on the trigger element
- Would start a new interaction (different trigger element, different surface)

---

## 8. Interaction Model

### 8.1 Definition

An Interaction is the output of a completed Session — a single, immutable record of one user action. It is what the side panel displays, what the classifier consumes, and what eventually becomes a SemanticInteraction.

### 8.2 Interaction Fields

```
Interaction {
  interactionId: string              // int-NNNN
  type: InteractionType              // Dropdown | DatePicker | Click | ...
  trigger: ElementIdentity           // the element the user interacted with
  triggerEvent: Event                // the first event of the interaction
  memberEvents: Event[]              // all events that composed this interaction
  startTime: number                  // when the interaction started
  endTime: number                    // when the interaction completed
  endState: ComponentEndState        // 'completed' | 'abandoned' | 'interrupted' | 'discarded'
  metadata: Record<string, unknown>  // type-specific result data
  surfaceContext: SurfaceContext | null  // surface information at interaction time
}
```

### 8.3 Interaction Production

An Interaction is produced when a Session completes (state transitions to `completed`, `abandoned`, or `interrupted`). The production steps:

1. Build metadata from the session's accumulated state (via the definition's `buildResult`)
2. Check for duplicates (§8.4)
3. If not a duplicate: assign `interactionId`, emit via `onEmit` callback
4. If a duplicate: suppress (return null, no emission)

### 8.4 Interaction Deduplication

Two interactions are duplicates if all of the following hold:
1. **Same type** (both Dropdown, both DatePicker, etc.)
2. **Within the dedup window** (`endTime_prev → startTime_next ≤ DEDUP_WINDOW_MS`, currently 2000ms)
3. **Same element identity** — `elementKey(trigger_prev) === elementKey(trigger_next)`, OR same surface identity for cross-element interactions (e.g., calendar cell click + synthetic change on input both inside the same surface)
4. **Same result** — same `selectedValue`, same `dateValue`, same `typedText` (type-specific comparison)

The dedup is **per-type**: a Dropdown interaction does not dedup against a DatePicker interaction, even on the same element.

### 8.5 Interaction Immutability

Once emitted, an Interaction is immutable. The metadata, trigger, member events, and surface context never change. Downstream layers that need different representations create projections (SemanticInteraction, IRStep, etc.) that reference the Interaction by ID.

---

## 9. Context Model

### 9.1 Definition

Context is the immutable structural snapshot of the DOM at the moment an event fired. It is the only evidence of what the DOM looked like, because the DOM mutates continuously (React re-renders, Vue patches).

### 9.2 Context Fields

```
DomContext {
  // ── Element state ──
  inputType: string | null           // 'text', 'date', 'range', 'checkbox', ...
  ariaExpanded: boolean | null       // is this element expanded?
  ariaHasPopup: string | null        // does this element open a popup? ('dialog', 'listbox', ...)
  isContentEditable: boolean
  disabled: boolean
  readOnly: boolean
  required: boolean

  // ── Ancestor chain ──
  ancestorRoles: string[]            // ARIA roles of ancestors (max 10 depth)
  ancestorClasses: string[]          // CSS classes of ancestors (max 10 depth)

  // ── Surface context ──
  surfaceId: string | null           // NEW: stable identity of the surface container
  surfaceType: string | null         // 'modal', 'popover', 'drawer', 'tooltip'
  surfaceRole: string | null         // ARIA role of the surface container
  surfaceLabel: string | null        // human-readable label of the surface
  surfaceOpenedBy: string | null     // NEW: eventId that caused this surface to appear

  // ── ARIA value state ──
  ariaValueNow: string | null
  ariaValueText: string | null
  ariaValueMin: string | null
  ariaValueMax: string | null
  nativeMin: string | null
  nativeMax: string | null
}
```

### 9.3 What Changed from the Current Model

Two fields are added:
- `surfaceId` — stable structural identity of the surface container
- `surfaceOpenedBy` — eventId of the event that caused the surface to appear

These are the minimum additions needed to make event ownership deterministic (§11). The existing `surfaceType`, `surfaceRole`, and `surfaceLabel` fields remain — they provide the surface's kind and label, while `surfaceId` provides its identity.

### 9.4 Context Capture

Context is captured by the content script's DOM context extractor at the moment the DOM event fires. The extractor walks the element's ancestor chain (up to 10 levels) and captures:
- The element's own attributes (inputType, ariaExpanded, etc.)
- Ancestor roles and classes
- The nearest surface container (by walking ancestors and checking surface patterns)

The `surfaceId` is computed from the surface container element's structural identity, using the same identity-extraction logic already used for the event target element.

### 9.5 Context Immutability

Context is frozen at construction time. No field ever changes after the Event is assembled. This is enforced by the content script — the DOM context extractor produces a plain object, and the Event assembler includes it in the ObservedEvent, which is then sent to the service worker as an immutable message.

---

## 10. State Transition Model

### 10.1 Definition

A State Transition is the observed change in an element's or surface's state between two events. It is the **result** of an interaction — what the user accomplished, expressed as a before→after fact.

### 10.2 Types of State Transitions

| Transition Type | Before | After | Example |
|----------------|--------|-------|---------|
| **Value** | `valueBefore` on trigger event | `valueAfter` on completion event | Dropdown: "Economy" → "Premium Economy" |
| **Checked** | `checkedBefore` on trigger event | `checkedAfter` on completion event | Checkbox: false → true |
| **Surface** | Surface does not exist | Surface exists (or vice versa) | Dropdown: no popover → popover open |
| **Navigation** | Previous URL | New URL | Click "Search" → `/flight-results` |
| **Text** | Input empty or previous text | Final text value | TextEntry: "" → "Bangalore" |

### 10.3 Role in Interaction Production

The state transition determines:
1. **Whether the interaction is a no-op**: if `before === after` for the primary transition, the interaction is suppressed (e.g., selecting an already-selected dropdown option).
2. **The interaction's result metadata**: `selectedValue`, `dateValue`, `typedText`, `checked`, `pageUrl` — all derived from the state transition.
3. **Deduplication comparison**: two interactions are duplicates if they produce the same state transition (same type, same element, same before→after).

### 10.4 State Transition vs Observation

The state transition is an observation, not an interpretation:
- ✅ "The dropdown's value changed from 'Economy' to 'Premium Economy'" — observed fact
- ❌ "The user upgraded their cabin class" — interpretation

The state transition is derived from the member events' before/after values. It does not require any semantic classification — it's a direct comparison of captured values.

---

## 11. Ownership and Correlation

### 11.1 The Ownership Problem

When an event arrives at the runtime, it must be assigned to exactly one of these fates:
1. **Absorbed** by an existing session (it's a member event of an ongoing interaction)
2. **Completes** an existing session (it's the completion event)
3. **Starts** a new session (it's a trigger event for a new interaction)
4. **Passed through** as an immediate interaction (completes instantly, no session lifecycle)

The current runtime assigns ownership by offering the event to sessions on the active stack **top → bottom**, and the first session where `isInScope()` returns true claims it. This is correct in principle but broken in implementation because `isInScope` uses CSS class patterns that match ANY surface of the same type, not the session's specific surface.

### 11.2 The Correct Ownership Rule

**An event belongs to the session whose surface it is inside.**

Formally:
1. If `event.domContext.surfaceId` is non-null AND there exists an active session `S` where `S.openedSurface === event.domContext.surfaceId` → the event belongs to `S`.
2. If `event.domContext.surfaceId` is non-null AND there exists an active session `S` where `S.insideSurface === event.domContext.surfaceId` → the event belongs to `S` (it's inside a surface that `S` lives in).
3. If the event's target element matches an active session's trigger element → the event belongs to that session (e.g., re-focus on the dropdown trigger).
4. If no session claims the event → it goes through discovery (may start a new session or become an immediate interaction).

### 11.3 Synthetic Event Correlation

The post-click value poll produces synthetic `change` events. These must be correlated to the session that owns the element being polled.

**Current behavior:** The poll tracks a global `lastFocusedEl`. The synthetic event fires on this element regardless of which session is active.

**Correct behavior:** The synthetic event carries the `surfaceId` of the surface that was open when the tracked element was focused. This binds it to the correct session via the ownership rule above.

If no surface was open (the element was focused in the base page), the synthetic event is correlated by element identity — it belongs to the session whose trigger element matches.

### 11.4 Surface Stack

The runtime maintains a surface stack alongside the session stack:

```
SurfaceStack: Surface[]   // ordered by appearance time, newest at top
```

When a new surface is detected (by mutation observer or by the first event referencing it), it is pushed onto the surface stack. When a surface closes (container removed or outside click), it is popped, and any sessions that opened it or live inside it are completed.

The surface stack is NOT a hierarchy tree — it is a flat stack ordered by appearance. Nesting is implied by the `insideSurface` field on sessions: if session B's `insideSurface` is the surface that session A opened, then B is nested inside A.

### 11.5 Concurrent Session Resolution

When a new session's trigger event arrives and there is already an active session of the same type:

1. **If the new trigger is OUTSIDE the existing session's surface** → the user switched contexts. The existing session is completed as `interrupted` (or `abandoned` if it has no useful state). The new session activates.

2. **If the new trigger is INSIDE the existing session's surface** → nested interaction (e.g., a dropdown inside a modal). The new session activates with `insideSurface` set to the existing session's `openedSurface`. Both coexist.

3. **If neither session has a surface** (both are surface-less interactions on the same element) → temporal deduplication applies. If within `DEDUP_WINDOW_MS`, the new session is suppressed as a duplicate.

This resolution is **structural** (based on surface containment), not heuristic (based on CSS classes or timing).

---

## 12. Lifecycle

### 12.1 Event Lifecycle

```
DOM event fires
      │
      ▼
EventTap captures (content script)
      │  - resolveTarget via composedPath
      │  - extract identity
      │  - extract DOM context (including surfaceId)
      │  - capture value before/after
      │  - assign eventId
      ▼
Event sent to Service Worker (chrome.runtime.sendMessage)
      │
      ▼
Service Worker forwards to Component Runtime
      │  - process(event)
      ▼
Runtime assigns event to a session (§11)
      │
      ├── absorbed → added to session.memberEvents
      ├── completes → session produces Interaction, session removed
      ├── triggers → new session created, event is triggerEvent
      └── immediate → Click/Checkbox/etc. completes instantly
```

### 12.2 Surface Lifecycle

```
Surface does not exist
      │
      │  trigger event on element with aria-haspopup
      │  OR mutation observer detects new container
      │  OR first event with domContext.surfaceId referencing unknown surface
      ▼
Surface detected → pushed to surface stack
      │  surfaceId, type, label, openedByEventId captured
      ▼
Surface is active — events inside it carry its surfaceId
      │
      │  option selected → completing event fires inside surface
      │  OR outside click detected
      │  OR Escape key pressed
      │  OR mutation observer detects container removal
      │  OR 15s timeout
      ▼
Surface closed → popped from surface stack
      │  sessions with openedSurface = this surfaceId are completed
      │  sessions with insideSurface = this surfaceId are completed
      ▼
Surface no longer exists
```

### 12.3 Session Lifecycle

```
Event arrives at runtime
      │
      ├── ownership rule assigns to existing session (§11.2)
      │       │
      │       ├── isInScope + handleEvent → absorbed
      │       │       │  session.memberEvents.push(event)
      │       │       │  session.data updated (e.g., selectedValue)
      │       │       └── session remains active
      │       │
      │       └── handleEvent returns completion
      │               │  session.state = 'completed'
      │               │  session.endTime = event.timestamp
      │               │  buildResult → metadata
      │               │  dedup check
      │               │  ├── not duplicate → emit Interaction
      │               │  └── duplicate → suppress
      │               │  remove session from active stack
      │               │  if session.openedSurface → close surface
      │               └── done
      │
      └── no session claims event → discovery
              │
              ├── detectTrigger matches → new session created
              │       │  session.state = 'active'
              │       │  session.triggerEvent = event
              │       │  session.openedSurface/insideSurface set
              │       │  if handleEvent returns completion → immediate interaction
              │       │  else → session remains active on stack
              │       └── done
              │
              └── no definition matches → event dropped (noise)
```

### 12.4 Timeout

Sessions that remain active for more than `MAX_LIFECYCLE_DURATION_MS` (15 seconds) without completing are expired:

- If the session has useful state (absorbed events, data) → completed as `abandoned`
- If the session is empty (only the trigger event) → silently removed

The timeout is a **safety net**, not the primary completion mechanism. With surface-bound session identity, sessions complete when their surface closes (which is usually immediate — the user selects an option and the popover closes). The timeout only fires if surface detection fails or the user abandons an interaction.

---

## 13. Invariants

These invariants must hold at all times. Any implementation that violates them is incorrect.

### I1: Event Uniqueness
> Every event has a unique `eventId`. No two events share the same ID.

### I2: Event Immutability
> Once an event is processed by the runtime, its fields never change.

### I3: Event-Session Ownership
> Every event is owned by at most one session. An event is either:
> - A trigger event for a new session (owned by that session)
> - A member event of an existing session (owned by that session)
> - An immediate interaction (owned by no session — completes instantly)
> - Dropped as noise (owned by no session)
>
> No event is a member of two sessions.

### I4: Surface-Session Binding
> If a session has `openedSurface = S`, then all events with `domContext.surfaceId = S` are owned by that session (unless claimed by a nested session inside S).
>
> If a session has `openedSurface = null` and `insideSurface = null`, the session's events are owned by element identity match only.

### I5: Surface Uniqueness
> At any point in time, each open surface has a unique `surfaceId`. No two concurrent surfaces share the same `surfaceId`.

### I6: Session Produces At Most One Interaction
> A session produces exactly zero or one Interactions. Zero if it is suppressed by dedup. One if it completes, is abandoned, or is interrupted with useful state.

### I7: Interaction Immutability
> Once an Interaction is emitted, it is immutable. Its fields never change.

### I8: Context Immutability
> A Context, once captured, is frozen. No field changes after the Event is constructed.

### I9: Dedup Correctness
> Two interactions with the same type, same element identity (or same surface), same result state transition, and within the dedup window are duplicates. Exactly one is emitted.

### I10: No Cross-Surface Claim
> A session never claims an event inside a DIFFERENT session's surface. If `event.domContext.surfaceId = S1` and the session's `openedSurface = S2` where `S1 ≠ S2`, the event does not belong to this session.

### I11: Surface Closure Completes Sessions
> When a surface closes, all sessions with `openedSurface = S` or `insideSurface = S` are completed (or abandoned if they have no useful state).

### I12: No Interpretation in Observations
> The observation layer never records business meaning, semantic grouping, or capability-level information. These are projections computed by downstream layers.

---

## 14. Responsibilities and Boundaries

### 14.1 Observation Layer IS Responsible For

| Responsibility | Description |
|---------------|-------------|
| Event capture | Capturing every trusted DOM event with full identity and context |
| Surface detection | Detecting when surfaces appear and disappear, capturing their identity |
| Event correlation | Determining which session an event belongs to (via surface containment + element identity) |
| Session management | Creating, maintaining, completing, and expiring sessions |
| Interaction production | Building and emitting completed interactions with correct trigger, metadata, and surface context |
| Deduplication | Suppressing interactions that represent the same user action as a recently-emitted one |
| No-op detection | Suppressing interactions where no state transition occurred |
| Context capture | Capturing immutable DOM snapshots at event time |

### 14.2 Observation Layer is NEVER Responsible For

| Non-Responsibility | Why | Where It Belongs |
|-------------------|-----|-----------------|
| Interpreting intent | "The user was configuring cabin class" is interpretation | Capability layer (Phase 2+) |
| Semantic grouping | "These 3 interactions form one action" is capability composition | Capability layer (Phase 2+) |
| Business meaning | "This dropdown is for travel class" is interpretation | Semantic layer (existing reasoner) |
| Cross-session reasoning | "The Done button confirms cabin class" is a capability relationship | Capability layer (Phase 2+) |
| Application-specific heuristics | CSS class patterns like `oxd-select-text` are framework detection aids, not observation logic | Pattern matching (fallback only, §15) |
| Retrospective re-analysis | Re-interpreting an emitted interaction is a projection, not an observation | Semantic/capability layers |
| Test case generation | Producing IR plans and Playwright code | IR generation (Phase 3+) |
| Execution | Running tests against the application | Execution engine (Phase 5+) |

### 14.3 Boundary Contracts

The observation layer has two boundary contracts — one upstream (what it receives) and one downstream (what it produces):

**Upstream (from Browser DOM):**
- Input: Raw DOM events (trusted, from `addEventListener` capture phase)
- Input: DOM mutations (from `MutationObserver`)
- Input: Navigation signals (from History API, `webNavigation`)

**Downstream (to Semantic/Capability layers):**
- Output: `ComponentInteraction[]` — completed interactions with trigger, member events, metadata, and surface context
- Contract: Interactions are immutable once emitted
- Contract: Every interaction has a unique ID
- Contract: No two interactions share the same events
- Contract: Surface context is populated on every interaction that occurred inside a surface

---

## 15. Framework Agnosticism

### 15.1 The Principle

The observation model must work for any UI framework without framework-specific code in the core model. This is achieved by using **structural signals** (ARIA attributes, DOM structure, surface containment) as the primary identification mechanism, with CSS class patterns as fallback hints only.

### 15.2 Primary Signals (Framework-Independent)

| Signal | What It Detects | Used For |
|--------|----------------|---------|
| `aria-haspopup` | "This element opens something when clicked" | Trigger detection |
| `aria-expanded` | "This element has opened something" | Trigger detection, surface state |
| `role` attributes | "This element is a combobox/dialog/listbox/menu" | Trigger detection, surface type |
| `aria-modal` | "This surface is a modal" | Surface type |
| `<dialog>` element | "This is a native dialog" | Surface detection |
| DOM structure (composedPath) | "This event is inside this container" | Surface containment, event ownership |
| Surface identity (surfaceId) | "This is THIS specific surface, not any surface" | Event ownership, session disambiguation |
| MutationObserver | "A container appeared/disappeared" | Surface lifecycle detection |

### 15.3 Fallback Signals (Framework-Specific)

| Signal | When It's Used | Risk |
|--------|---------------|------|
| CSS class patterns (`oxd-select-text`, `MuiSelect`, etc.) | ARIA is absent and surface detection via mutation observer is delayed | May match wrong element — should never be the sole signal for event ownership |
| `cursor: pointer` heuristic | No ARIA, no interactive role, no framework class | Very loose — used only for resolveTarget as a last resort |

### 15.4 How the Model Handles Each UI Pattern

| UI Pattern | Primary Signal | Surface Role | Session Type |
|-----------|---------------|-------------|-------------|
| **Dropdown** (native SELECT) | `tag === 'SELECT'` | No surface (native rendering) | Dropdown, completes on `change` |
| **Dropdown** (custom SPA) | `aria-haspopup` + mutation observer detects popover | Popover surface | Dropdown, completes on option click inside surface |
| **Date picker** (native) | `inputType === 'date'` | No surface (native rendering) | DatePicker, completes on `change` |
| **Date picker** (custom SPA) | `aria-haspopup` + mutation observer detects calendar | Popover surface | DatePicker, completes on cell click inside surface |
| **Stepper** (+/- buttons) | Click inside a multiConfig surface | Lives inside parent surface (e.g., passenger panel) | Click or MultiConfig, absorbed by parent session |
| **Modal dialog** | `role="dialog"` or `aria-modal="true"` or `<dialog>` | Modal surface | Click/TextEntry/etc. inside modal (sessions have `insideSurface` set) |
| **Menu** | `role="menu"` | Popover surface | Dropdown, completes on menu item click |
| **Filter panel** | Mutation observer detects panel | Popover or drawer surface | Multiple child sessions (Checkbox, Dropdown) inside the surface |
| **Tree** (expandable nodes) | `role="tree"` + `aria-expanded` on tree items | No surface (inline expansion) | Click, completes immediately |
| **Table** (sort/select) | Click on th or row | No surface | Click, completes immediately |
| **Shadow DOM** | `composedPath()` traverses shadow roots | SurfaceId traverses shadow roots | Same as non-shadow — structural identity is shadow-DOM-aware |
| **Portals** (React Portal) | Mutation observer detects container in different DOM subtree | SurfaceId captures Portal root | Same as non-portal — surfaceId is structural, not CSS-based |
| **Floating overlays** | Mutation observer detects overlay container | Popover or sheet surface | Same as popover — surfaceId disambiguates concurrent overlays |
| **Autocomplete** | `role="combobox"` + `aria-expanded` | Popover surface (suggestion list) | Dropdown, completes on suggestion click inside surface |
| **Bottom sheet** (mobile) | Mutation observer detects sheet container | Sheet surface | Same as drawer — surfaceId disambiguates |

### 15.5 Adding New UI Patterns

A new UI pattern that creates a transient container is automatically handled by the surface model — no new code needed. The surface is detected by the mutation observer, given a `surfaceId`, and events inside it are owned by the session that opened it.

A new UI pattern that doesn't create a container (e.g., inline toggle, accordion) is handled as an immediate interaction (Click/Checkbox) — no surface needed.

The only case requiring new code is a pattern with a novel trigger signal not covered by `aria-haspopup`, `aria-expanded`, or known ARIA roles. In that case, a new `detectTrigger` implementation is added for the new interaction type — but the session model, surface model, and ownership rules remain unchanged.

---

## 16. Integration with Existing Architecture

### 16.1 What Changes

| Component | Current | Proposed | Impact |
|-----------|---------|----------|--------|
| `DomContext` | `surfaceType`, `surfaceRole`, `surfaceLabel` | Add `surfaceId`, `surfaceOpenedBy` | Two new fields — backward compatible |
| `ComponentContext` | No surface fields | Add `openedSurface`, `insideSurface` | Two new fields — backward compatible |
| `isInScope` | CSS class patterns (`isInsideDropdownSurface`) | Surface identity (`event.domContext.surfaceId === ctx.openedSurface`) | Rewrite implementation, same interface |
| `detectTrigger` | CSS class patterns primary | ARIA attributes + mutation observer primary, CSS patterns fallback | Rewrite implementation, same interface |
| Component Runtime | `activeStack` only | `activeStack` + `surfaceStack` | New data structure, same process() flow |
| EventTap | Global `lastFocusedEl` for post-click poll | Session-surface-bound synthetic events | Synthetic events carry `surfaceId` |
| `dom-context-extractor.ts` | `detectSurface()` returns type/role/label | Also returns `surfaceId` (structural identity) | Extended return value |

### 16.2 What Does NOT Change

| Component | Why It Stays |
|-----------|-------------|
| EventTap capture-phase listeners | Correct — capture all trusted events |
| `ObservedEvent` structure | Already correct — just gains `surfaceId` in its `DomContext` |
| `ComponentInteraction` output | Already correct — surface context flows through `DomContext` on member events |
| Definition stack pattern | Each definition handles one type, priority-ordered — correct |
| `ComponentDefinition` interface | `detectTrigger`, `isInScope`, `handleEvent`, `buildResult` — same interface, new implementations |
| SemanticInteraction boundary | Observations are facts, projections are interpretations — unchanged |
| Capability Model | Consumes SemanticInteraction[], doesn't participate in observation — unchanged |
| V1/V2/merge pipeline | Consumes ComponentInteraction[], doesn't produce them — unchanged (but benefits from better input) |
| Side panel rendering | Reads ComponentInteraction[] — unchanged (but displays correct interactions) |

### 16.3 Integration with the Unified Master Roadmap

This design is the formal specification for **Phase 0b (Type Unification)** in the Unified Master Roadmap. Specifically:

| Roadmap Phase 0b Item | This Design Section |
|----------------------|---------------------|
| Unified DomContext | §9 (adds `surfaceId`, `surfaceOpenedBy`) |
| Unified InteractionType | §8 (Interaction model — no change to type enum) |
| Unified event type | §5 (Event model — no change to event types) |
| Session model correction | §7 (Session-surface binding), §11 (Ownership), §12 (Lifecycle) |
| Surface context correctness | §6 (Surface model), §9 (Context model) |

The design does not introduce new roadmap phases. It formalizes the work that Phase 0b already covers, making the implementation tasks explicit and verifiable against the invariants in §13.

### 16.4 Frozen Contract Respect

The design respects all frozen contracts from the Unified Master Roadmap:

| Frozen Contract | Design Compliance |
|----------------|------------------|
| `DomContext` (Phase 0b) | Extended, not replaced — two new fields are additive |
| `InteractionType` (Phase 0b) | Unchanged — same 13 types |
| `SemanticInteraction` 22+3 fields (Phase 0d) | The `surfaceContext` and `overlayContext` fields in SemanticInteraction are populated from the observation layer's `surfaceId` and `surfaceType` — the design makes these fields correct |
| Observation/Projection boundary (Phase 0d) | The design enforces this at the observation layer level (§14, invariant I12) |

---

## 17. Type Contracts

### 17.1 DomContext (Extended)

```typescript
interface DomContext {
  // ── Existing fields (unchanged) ──
  inputType: string | null;
  ariaExpanded: boolean | null;
  ariaHasPopup: string | null;
  isContentEditable: boolean;
  disabled: boolean;
  readOnly: boolean;
  required: boolean;
  ancestorRoles: string[];
  ancestorClasses: string[];
  surfaceType: string | null;
  surfaceRole: string | null;
  surfaceLabel: string | null;
  ariaValueNow: string | null;
  ariaValueText: string | null;
  ariaValueMin: string | null;
  ariaValueMax: string | null;
  nativeMin: string | null;
  nativeMax: string | null;

  // ── New fields ──
  /** Stable structural identity of the surface container element.
   *  Null if the event occurred outside any surface. */
  surfaceId: string | null;
  /** eventId of the event that caused this surface to appear.
   *  Null if the surface was not caused by a recorded event
   *  (e.g., page-load modal). */
  surfaceOpenedBy: string | null;
}
```

### 17.2 ComponentContext (Extended)

```typescript
interface ComponentContext {
  // ── Existing fields (unchanged) ──
  type: InteractionType;
  state: ComponentState;
  trigger: ElementIdentity;
  triggerEvent: ObservedEvent;
  memberEvents: ObservedEvent[];
  scopeKeys: Set<string>;
  startTime: number;
  endTime: number;
  data: Record<string, unknown>;

  // ── New fields ──
  /** Surface this session opened (if the interaction creates a surface).
   *  Null for surface-less interactions (Click, TextEntry, Scroll). */
  openedSurface: string | null;
  /** Surface this session lives inside (if the trigger was inside an
   *  already-open surface). Null for base-page interactions. */
  insideSurface: string | null;
}
```

### 17.3 SurfaceEntry (New)

```typescript
/** Entry in the runtime's surface stack. */
interface SurfaceEntry {
  /** Stable structural identity of the surface container. */
  surfaceId: string;
  /** Surface type: 'modal', 'popover', 'drawer', 'tooltip', 'sheet'. */
  type: string;
  /** ARIA role of the surface container, if any. */
  role: string | null;
  /** Human-readable label from aria-label, heading, or title. */
  label: string | null;
  /** eventId of the event that caused this surface to appear. */
  openedByEventId: string | null;
  /** Timestamp when the surface was first detected. */
  openedAt: number;
  /** Timestamp when the surface was closed. Null while open. */
  closedAt: number | null;
}
```

### 17.4 SurfaceContext (on ComponentInteraction)

```typescript
/** Surface context carried on a completed interaction. */
interface SurfaceContext {
  /** Type of the surface this interaction occurred inside or opened. */
  type: string;
  /** Label of the surface, if available. */
  label: string | null;
  /** True if this interaction opened the surface. */
  openedByThisInteraction: boolean;
  /** SurfaceId of the surface. */
  surfaceId: string | null;
}
```

---

## 18. Validation Criteria

The observation model is correct if and only if:

### 18.1 Invariant Verification

- [ ] All 12 invariants (§13) hold under every test scenario
- [ ] No event is owned by two sessions simultaneously
- [ ] No session claims an event inside a different session's surface
- [ ] Every interaction has a unique ID
- [ ] Every interaction is immutable after emission

### 18.2 Adani One Scenario Verification

- [ ] Two concurrent dropdowns (Trip Type + Cabin Class) produce correctly-attributed interactions — no cross-wiring
- [ ] Date picker selection produces exactly one interaction — no duplicate from post-click poll
- [ ] Passenger count changes are captured — not lost to session timeout
- [ ] "Done" button click inside the passenger panel is captured with correct surface context
- [ ] Text entry labels reflect the typed value, not the pre-focus stale value
- [ ] Same flow recorded twice produces the same interactions (deterministic)

### 18.3 Framework Agnosticism Verification

- [ ] Recording on a React SPA (Adani One) produces correct interactions without React-specific code
- [ ] Recording on a Vue SPA produces correct interactions without Vue-specific code
- [ ] Recording on a page with Shadow DOM components produces correct interactions
- [ ] Recording on a page with React Portals produces correct interactions
- [ ] Recording on a vanilla JS page (no framework) produces correct interactions

### 18.4 Regression Verification

- [ ] All existing tests pass (4200+ tests)
- [ ] OrangeHRM recording produces the same interactions as before (no regression)
- [ ] Side panel displays the same or better interaction quality
- [ ] IR plan generation receives the same or better input quality

---

## Appendix A: Adani One Issue Resolution Matrix

| Adani One Issue | Root Cause in Current Model | How the Observation Model Resolves It |
|----------------|---------------------------|--------------------------------------|
| Trip Type change not captured | CSS class pattern too broad, trigger detection fails for some elements | Behavioral trigger detection (aria-haspopup + mutation observer) catches it regardless of CSS class |
| Passenger count not captured | Session timeout (15s) abandons the panel session before the user clicks +/- | Surface-bound session stays alive as long as the passenger panel surface is open — no timeout dependency |
| Cabin class attributed to Trip Type trigger | `isInScope` matches ANY dropdown surface, not the specific session's surface | Surface identity (`surfaceId`) ensures events inside the Cabin Class popover are owned by the Cabin Class session only |
| "Premium Economy" duplicated with different trigger names | Post-click value poll fires synthetic change on wrong element, creating a new session | Synthetic events carry `surfaceId` — they complete the correct session, not a new one |
| Inconsistent capture (timing-dependent) | Race between React state flush and post-click poll | Surface closure (mutation observer) is the primary completion signal, not value polling — timing-independent |
| Stale field labels ("From - DEL") | `accessibleName` captured at focus time, before React re-renders | `surfaceId` is structural (based on DOM position, not rendered text) — stable across re-renders. Label may still be stale, but the interaction is attributed to the correct element via `surfaceId`. |

## Appendix B: Glossary

| Term | Definition |
|------|-----------|
| **Event** | A single immutable DOM occurrence (click, focus, input, etc.) |
| **Surface** | A transient DOM container that appears and disappears with an interaction (popover, modal, drawer) |
| **Session** | The lifecycle of a single interaction, from trigger to completion |
| **Interaction** | A completed unit of user behavior, produced by a session |
| **Context** | An immutable DOM snapshot captured at event time |
| **State Transition** | The observed before→after change produced by an interaction |
| **Surface Identity** | A stable structural identity for a surface container (`surfaceId`) |
| **Event Ownership** | The determination of which session an event belongs to |
| **Surface Containment** | The relationship between an event and a surface — "this event occurred inside this surface" |
| **Session-Surface Binding** | The association between a session and the surface it opened or lives inside |
| **Concurrent Sessions** | Two or more active sessions of the same type simultaneously |
| **Deduplication** | Suppression of an interaction that represents the same user action as a recently-emitted one |
| **Observation** | A physical fact captured at recording time — immutable |
| **Projection** | A derived interpretation computed by a consumer — mutable, disposable |
