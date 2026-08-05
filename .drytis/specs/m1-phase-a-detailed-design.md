# M1 Phase A — Detailed Coding Design
## Types + Element State Cache + State Cache Listeners

**Baseline:** a43df53 (clean — no prior M1/M2 code present)
**Phase A scope:** Foundation types + before-state solution. Zero changes to existing recording behavior.

---

## 1. What Phase A Delivers

Phase A produces three things and nothing more:

1. **`observation-types.ts`** — All TypeScript types that later phases (B–E) will consume. This is the shared vocabulary for the entire M1 system.

2. **`element-state-cache.ts`** — A `WeakMap`-backed cache that captures and serves element state snapshots for the **interacted element**. This solves the **property-level before-state problem** for DOM properties (`.value`, `.checked`) that MutationObserver cannot see — essential for native controls where the mousedown target IS the state holder.

3. **`state-cache-listeners.ts`** — Two capture-phase event listeners (`mousedown`, `focus`) that silently populate the cache. These run independently of EventTap and the recording pipeline — they do not intercept, modify, or block any existing event flow.

### Complementary Two-Source Before-State Strategy

M1 captures before-state from two independent sources. **Neither alone covers every case.** Together they provide complete coverage:

| Source | What It Captures | Before-State Mechanism | Covers |
|--------|-----------------|----------------------|--------|
| **Phase A: Element State Cache** | DOM **properties** (`.value`, `.checked`) | mousedown/focus capture-phase snapshot of the interacted element | Native controls (checkbox, radio, select, slider, text field) where mousedown target == state holder |
| **Phase B: MutationObserver** | DOM **attributes** (aria-checked, aria-expanded, class) + **text content** + **structural changes** | `attributeOldValue: true` + `characterDataOldValue: true` — every mutation record carries its own `oldValue` | Custom components where the state holder is an ancestor or sibling of the clicked element (Amazon `<i aria-checked>`, accordion `<div aria-expanded>`, custom dropdowns) |

**Phase A does NOT assume mousedown.target is always the state holder.** For custom components, the cache snapshot of the clicked element (e.g., a `<span>`) may honestly show no meaningful state change. The meaningful before-state for those cases comes from Phase B's MutationObserver `oldValue` on the actual state-holding element's attribute change.

**No component-specific state-holder detection is added.** Phase A captures what the user physically interacted with. Future milestones correlate "user clicked span" + "aria-checked changed on ancestor i" to understand the component.

**Phase A does NOT:**
- Open observation windows (Phase C)
- Capture DOM mutations (Phase B)
- Send messages to the service worker (Phase D)
- Display anything in the side panel (Phase E)
- Modify EventTap, recorder-entry, service-worker, or any other existing file
- Change any existing behavior whatsoever

---

## 2. Files Created by Phase A

### File 1: `src/shared/observation-types.ts` (~130 lines)

**Purpose:** Define all data structures used across M1. No runtime logic — pure type exports.

**Location rationale:** Lives in `src/shared/` alongside `component-types.ts` and `types.ts` because it is imported by both the content script layer (tap/) and the background layer (service-worker, sw-integration).

**Exact contents:**

```typescript
/**
 * Observation Types — M1 Behavioral Observation Data Structures
 *
 * These types define the shape of evidence captured during the 3-second
 * observation window following a user interaction (click or change event).
 *
 * Design principle: M1 captures evidence only — no semantic meaning,
 * no classification, no causation claims.
 *
 * Architecture: `.drytis/specs/m1-complete-design.md`
 */

// ── Mutation Record ───────────────────────────────────────────────────

/**
 * Compact representation of a single DOM mutation captured during an
 * observation window. O(1) to create — reads only the properties needed,
 * no DOM traversal. Created in Phase B's DocumentObserver callback.
 *
 * One MutationRecord2 = one MutationObserver entry.
 */
export interface MutationRecord2 {
  /** Sequential record ID within the recording session. */
  id: number;
  /** Mutation type from the DOM MutationObserver. */
  type: 'attributes' | 'childList' | 'characterData';
  /** CSS selector path from document.body to the target element. */
  targetPath: string;
  /** Target element's tagName for quick deferred filtering. */
  targetTag: string;
  /** Attribute name when type='attributes', null otherwise. */
  attributeName: string | null;
  /** Previous attribute value or text content (from MutationObserver oldValue config). */
  oldValue: string | null;
  /** Current attribute value or text content (read immediately — DOM mutates). */
  newValue: string | null;
  /** Number of nodes added (type='childList'). */
  addedNodesCount: number;
  /** Number of nodes removed (type='childList'). */
  removedNodesCount: number;
  /** Timestamp relative to recording start (performance.now()). */
  timestamp: number;
  /** Which observation window(s) were active when this mutation occurred. */
  windowIds: string[];
}

// ── Element State Snapshot ────────────────────────────────────────────

/**
 * A point-in-time snapshot of an element's observable state.
 *
 * Captures properties that MutationObserver may miss:
 * - `.value` on input/select (not reflected as DOM attributes)
 * - `.checked` on checkbox/radio (not reflected as DOM attributes)
 *
 * Used for the TARGET element (the one the user clicked/changed) to
 * produce a before → after diff.
 *
 * Each snapshot is a frozen copy — stored inside an observation window,
 * it can never be mutated by later interactions.
 */
export interface ElementStateSnapshot {
  /** Input/select value. null for non-value elements. */
  value: string | null;
  /** Checked state (checkbox/radio, aria-checked, aria-pressed). null if N/A. */
  checked: boolean | null;
  /** className attribute (empty string if absent). */
  className: string;
  /** disabled attribute or aria-disabled='true'. */
  disabled: boolean;
  /** aria-expanded attribute value. null if attribute absent. */
  ariaExpanded: boolean | null;
  /** aria-checked attribute value. null if attribute absent. */
  ariaChecked: boolean | null;
  /** aria-pressed attribute value. null if attribute absent. */
  ariaPressed: boolean | null;
  /** Direct text content, truncated to 200 chars. null if empty. */
  textContent: string | null;
  /** Number of direct child element nodes. */
  childCount: number;
  /** When this snapshot was taken (Date.now()). */
  capturedAt: number;
}

// ── Observation Window ────────────────────────────────────────────────

/**
 * Why an observation window closed.
 */
export type WindowEndReason =
  | 'completed'       // 3-second timer elapsed
  | 'element-removed' // target element gone from DOM at close time
  | 'recording-stopped'; // stopRecording called mid-window

/**
 * Internal representation of one interaction's observation window.
 * Lives in the ObservationCoordinator (Phase C) while open.
 *
 * The beforeSnapshot and finalSnapshot are frozen copies — they are
 * independent plain objects, NOT references to the cache.
 */
export interface ObservationWindow {
  /** Unique window ID: `obs-{eventId}`. */
  windowId: string;
  /** The ObservedEvent.eventId that triggered this observation. */
  sourceEventId: string;
  /** Event type: 'click' or 'change'. */
  sourceEventType: string;
  /** CSS path of the target element at window open time. */
  sourceElementPath: string;
  /** performance.now() when window opened. */
  openedAt: number;
  /** performance.now() when window closed (null while open). */
  closedAt: number | null;
  /** Why the window closed (null while open). */
  endReason: WindowEndReason | null;
  /** Before-state snapshot from cache at window open. May be null on first interaction. */
  beforeSnapshot: ElementStateSnapshot | null;
  /** After-state snapshot captured at window close. */
  finalSnapshot: ElementStateSnapshot | null;
}

// ── Observation Result (delivered to service worker) ──────────────────

/**
 * The complete behavioral evidence for one interaction.
 * Serialized and sent via chrome.runtime.sendMessage in Phase D.
 *
 * This is what gets attached to ComponentInteraction.behavioralObservations.
 */
export interface ObservationResult {
  /** The ObservedEvent.eventId that triggered this observation. */
  sourceEventId: string;
  /** Event type: 'click' or 'change'. */
  sourceEventType: string;
  /** Window ID. */
  windowId: string;
  /** performance.now() when window opened. */
  openedAt: number;
  /** performance.now() when window closed. */
  closedAt: number;
  /** Duration in milliseconds (closedAt - openedAt). */
  durationMs: number;
  /** Why the window closed. */
  endReason: WindowEndReason;
  /** Target element state before the interaction. null if no prior cache. */
  beforeSnapshot: ElementStateSnapshot | null;
  /** Target element state after the observation window. */
  finalSnapshot: ElementStateSnapshot | null;
  /** All mutations attributed to this window (from shared buffer). */
  mutations: MutationRecord2[];
  /** Count of mutations in the mutations array. */
  mutationCount: number;
  /** Total mutations across the entire document during this window (noise context). */
  documentWideMutationTotal: number;
}
```

**Design notes for observation-types.ts:**

- `MutationRecord2.windowIds` is `string[]` — when a mutation occurs while windows A and B are both open, the record carries `['obs-evt-1', 'obs-evt-2']`. This preserves attribution ambiguity without duplicating the record.
- `ElementStateSnapshot.checked` collapses three ARIA attributes (`aria-checked`, `aria-pressed`, native `checked`) into one field. The cache's `readChecked` method has a priority order: native `checked` > `aria-checked` > `aria-pressed`.
- `ObservationWindow` is the internal type used by the coordinator. `ObservationResult` is the serialized version delivered to the service worker. The coordinator converts window → result on close.
- All types use `null` (not `undefined`) for absent values. This ensures clean JSON serialization — `undefined` fields are stripped by `JSON.stringify`, which would lose type information.

---

### File 2: `src/tap/element-state-cache.ts` (~100 lines)

**Purpose:** Maintain a rolling cache of element states keyed by DOM element reference. Provides the before-state for observation windows.

**Location rationale:** Lives in `src/tap/` because it operates on live DOM elements and is consumed by the content script layer.

**Exact contents:**

```typescript
/**
 * Element State Cache — Before-State Preservation
 *
 * A WeakMap-backed cache of element states. Populated silently by
 * capture-phase mousedown and focus listeners (via state-cache-listeners.ts)
 * and by observation window open/close (Phase C).
 *
 * Purpose: When a change event fires (e.g., selecting an option from a
 * native <select>), the browser has ALREADY changed .value. Without this
 * cache, the observation window would see new→new instead of old→new.
 *
 * The DOM event ordering guarantee: at capture phase of mousedown and
 * focus, no default action has run, no activation behavior has toggled
 * anything, and no derived event has fired. The element's state is
 * exactly as it was before the user's input reached the DOM.
 *
 * Architecture: `.drytis/specs/m1-complete-design.md` §4.1
 */

import type { ElementStateSnapshot } from '../shared/observation-types';

export class ElementStateCache {
  /**
   * The cache. WeakMap so removed elements are GC'd automatically.
   * Persists for the entire recording session.
   */
  private map = new WeakMap<Element, ElementStateSnapshot>();

  /**
   * Read the element's current state and store it in the cache.
   * Returns the snapshot. O(1) — reads 9 properties, no traversal.
   *
   * Called by:
   * - state-cache-listeners.ts on mousedown capture
   * - state-cache-listeners.ts on focus capture
   * - ObservationCoordinator on window open (Phase C)
   * - ObservationCoordinator on window close (Phase C)
   */
  capture(el: Element): ElementStateSnapshot {
    const snap = this.readState(el);
    this.map.set(el, snap);
    return snap;
  }

  /**
   * Return the cached state WITHOUT reading or modifying the element.
   * Returns null if the element has never been cached.
   *
   * Called by ObservationCoordinator on window open (Phase C) to get
   * the before-state. This is the critical call that solves Case 4.
   *
   * IMPORTANT: Returns the stored snapshot object directly. The caller
   * (ObservationCoordinator) must treat it as read-only. In Phase C,
   * the coordinator stores this reference in window.beforeSnapshot —
   * since the next capture() replaces the WeakMap entry (not the
   * snapshot object), the stored reference is immutable by design.
   */
  peek(el: Element): ElementStateSnapshot | null {
    return this.map.get(el) ?? null;
  }

  /**
   * Clear the cache. Called on stopRecording only.
   * WeakMap has no clear() method — reassign the reference.
   */
  clear(): void {
    this.map = new WeakMap<Element, ElementStateSnapshot>();
  }

  // ── Internal ────────────────────────────────────────────────────────

  /**
   * Read 9 observable properties from an element. No traversal.
   * Safe for any element type — uses instanceof checks.
   */
  private readState(el: Element): ElementStateSnapshot {
    const isInput = el instanceof HTMLInputElement;
    const isSelect = el instanceof HTMLSelectElement;
    const htmlEl = el as HTMLElement;

    return {
      value: this.readValue(isInput, isSelect, el),
      checked: this.readChecked(isInput, el),
      className: el.getAttribute('class') ?? '',
      disabled: htmlEl.hasAttribute('disabled') ||
                el.getAttribute('aria-disabled') === 'true',
      ariaExpanded: this.readBooleanAttr(el, 'aria-expanded'),
      ariaChecked: this.readBooleanAttr(el, 'aria-checked'),
      ariaPressed: this.readBooleanAttr(el, 'aria-pressed'),
      textContent: this.readTruncatedText(el),
      childCount: el.children.length,
      capturedAt: Date.now(),
    };
  }

  private readValue(isInput: boolean, isSelect: boolean, el: Element): string | null {
    if (isInput) return (el as HTMLInputElement).value ?? null;
    if (isSelect) return (el as HTMLSelectElement).value ?? null;
    return null;
  }

  /**
   * Read checked state. Priority: native > aria-checked > aria-pressed.
   * Returns null if none applicable.
   */
  private readChecked(isInput: boolean, el: Element): boolean | null {
    if (isInput) {
      const input = el as HTMLInputElement;
      if (input.type === 'checkbox' || input.type === 'radio') {
        return input.checked;
      }
    }
    const ariaChecked = this.readBooleanAttr(el, 'aria-checked');
    if (ariaChecked !== null) return ariaChecked;
    return this.readBooleanAttr(el, 'aria-pressed');
  }

  /**
   * Read an ARIA boolean attribute. Returns true, false, or null (absent).
   */
  private readBooleanAttr(el: Element, name: string): boolean | null {
    const val = el.getAttribute(name);
    if (val === null) return null;
    return val === 'true';
  }

  private readTruncatedText(el: Element): string | null {
    const text = el.textContent ?? '';
    return text.length > 0 ? text.substring(0, 200) : null;
  }
}
```

**Design notes for element-state-cache.ts:**

**Why WeakMap (not Map):**
- Elements removed from the DOM should not hold memory. WeakMap lets the GC reclaim both the key (element) and the value (snapshot) when the element is no longer referenced elsewhere.
- Map would hold strong references to elements, creating a memory leak — every element ever interacted with would be pinned in memory for the entire session.
- WeakMap has no iteration or size property, which is fine — we only ever look up by element reference.

**Why `peek` returns the stored object directly (immutability guarantee):**

The critical immutability mechanism is subtle but important. Here's the exact sequence:

```
Step 1: mousedown fires → cache.capture(checkbox) creates snapshot S1
        WeakMap: { checkbox → S1{checked:false} }

Step 2: click fires → coordinator calls cache.peek(checkbox) → returns S1
        window.beforeSnapshot = S1    ← stores REFERENCE to S1

Step 3: window closes → coordinator calls cache.capture(checkbox)
        readState creates S2{checked:true}
        WeakMap: { checkbox → S2 }    ← S1 is no longer in the map
        window.finalSnapshot = S2     ← stores REFERENCE to S2

Step 4: Later interaction → cache.capture(checkbox) creates S3
        WeakMap: { checkbox → S3 }
        But window.beforeSnapshot still points to S1 — S1 was never mutated.
        And window.finalSnapshot still points to S2 — S2 was never mutated.
```

Each `capture()` call creates a **brand new object** and stores it in the WeakMap. It never mutates the previously stored object. So snapshots held by closed windows are immutable by construction — they are plain objects that nobody holds a reference to except the window itself.

**Why `readChecked` has a priority order:**
Native `checked` is the ground truth for real checkboxes/radios. `aria-checked` is used by custom widgets (e.g., ARIA button with `aria-pressed`). `aria-pressed` is used by toggle buttons. The priority ensures we don't read a stale ARIA value when the native property is available.

**Why `textContent` is truncated:**
Some elements (e.g., large `<div>`s) can have kilobytes of text. Truncating to 200 chars prevents the cache from holding large strings while still capturing the meaningful label/content for diff display.

---

### File 3: `src/tap/state-cache-listeners.ts` (~55 lines)

**Purpose:** Register two capture-phase event listeners (`mousedown`, `focus`) that silently populate the element state cache. These are the mechanism that guarantees before-state on the first interaction.

**Location rationale:** Lives in `src/tap/` alongside other DOM-touching code. Separate from `element-state-cache.ts` because the listeners are a lifecycle concern (start/stop with recording) while the cache is a data structure.

**Exact contents:**

```typescript
/**
 * State Cache Listeners — Before-State Pre-Population
 *
 * Two capture-phase event listeners that silently populate the
 * ElementStateCache BEFORE the browser changes element state.
 *
 * DOM Event Ordering Guarantee:
 *   1. Capture phase (document → target)    ← OUR LISTENERS RUN HERE
 *   2. Target phase
 *   3. Bubble phase (target → document)     ← application JS runs here
 *   4. Default actions / activation behavior ← browser changes STATE here
 *   5. Derived events (input, change)       ← fire AFTER state changed
 *
 * At capture phase of mousedown and focus, no default action has run,
 * no activation behavior has toggled anything. The element's state is
 * exactly as it was before the user's input reached the DOM.
 *
 * Architecture: `.drytis/specs/m1-complete-design.md` §4.1
 */

import type { ElementStateCache } from './element-state-cache';

/**
 * Register capture-phase listeners that populate the state cache.
 *
 * Call on recording start. The returned cleanup function removes
 * the listeners — call on recording stop.
 *
 * @param cache The ElementStateCache to populate
 * @returns cleanup function that removes the listeners
 */
export function setupStateCacheListeners(
  cache: ElementStateCache,
): () => void {
  const onMouseDown = (event: Event): void => {
    const el = event.target;
    if (el instanceof HTMLElement) {
      cache.capture(el);
    }
  };

  const onFocus = (event: Event): void => {
    // Focus events can fire on document or window in edge cases.
    // Only capture for actual elements.
    const el = event.target;
    if (el instanceof HTMLElement) {
      cache.capture(el);
    }
  };

  // Capture phase: runs BEFORE bubble-phase application handlers and
  // BEFORE default actions that change element state.
  // passive: true — we don't call preventDefault(), so the browser
  // can optimize dispatch.
  document.addEventListener('mousedown', onMouseDown, {
    capture: true,
    passive: true,
  });
  document.addEventListener('focus', onFocus, {
    capture: true,
    passive: true,
  });

  // Return cleanup
  return () => {
    document.removeEventListener('mousedown', onMouseDown, {
      capture: true,
    } as EventListenerOptions);
    document.removeEventListener('focus', onFocus, {
      capture: true,
    } as EventListenerOptions);
  };
}
```

**Design notes for state-cache-listeners.ts:**

**Why `mousedown` and not `click`:**
EventTap already listens for `click` — but click fires after the activation behavior for some elements. `mousedown` is the earliest signal of a mouse-driven interaction. At mousedown capture, nothing has changed yet.

For checkboxes and radios: the click activation behavior toggles `.checked`. This runs AFTER all click listeners (including capture phase). So even at click capture, `.checked` is still the old value. But we use `mousedown` anyway because:
1. It's earlier — provides maximum guarantee margin.
2. It covers drag interactions (slider) where click may not fire.
3. It doesn't conflict with EventTap's click handler — they serve different purposes.

**Why `focus` and not `keydown`:**
Keyboard-driven interactions begin with focus. Tabbing into a field fires `focus` before any typing. At focus capture, the field's value is whatever it was before the user started interacting with it. `keydown` fires after focus, potentially after the first keystroke has been processed.

**Why `{ capture: true, passive: true }`:**
- `capture: true` — we must run in capture phase to guarantee pre-change timing. If we used bubble phase, application JS may have already mutated state.
- `passive: true` — we never call `preventDefault()`. Telling the browser this allows it to dispatch the event without blocking for our listener, improving scroll/performance. This is especially important for `mousedown` which can be followed by scrolling.

**Why `instanceof HTMLElement` check:**
`event.target` can be `Document`, `Window`, or a text node in edge cases. Only `HTMLElement` instances have the properties we read (value, checked, className, etc.). SVG elements are `SVGElement`, not `HTMLElement` — but in practice SVGs rarely have form state, so filtering them is correct.

**Why the cleanup function matches `{ capture: true }`:**
`removeEventListener` must match the same options (`capture`) used in `addEventListener`. If `capture` doesn't match, the listener is NOT removed. The `passive` flag does not need to match — it only affects dispatch, not identity. We cast to `EventListenerOptions` to avoid the TypeScript issue where `passive` isn't part of `EventListenerOptions`.

**What happens if a listener throws:**
The cache's `readState` uses standard property reads that won't throw on valid HTMLElements. If the element is in a weird state (e.g., detached), property reads return defaults. The `try/catch` is implicit — the listener is a simple function call. If it somehow throws, the browser's event dispatch continues normally (listeners are isolated). No impact on EventTap or the recording pipeline.

---

## 3. Files Phase A Does NOT Touch

| File | Why not |
|------|---------|
| `src/tap/event-tap.ts` | Phase D adds `onAfterEvent`. Phase A has no reason to modify it. |
| `src/recorder/phase5/recorder-entry.ts` | Phase D wires the coordinator. Phase A has no reason to modify it. |
| `src/shared/component-types.ts` | Phase D adds `behavioralObservations` field. Phase A has no reason to modify it. |
| `src/background/service-worker.ts` | Phase D adds the message handler. |
| `src/runtime/sw-integration.ts` | Phase D adds pending effects. |
| `src/sidepanel/*` | Phase E adds display. |
| Any other existing file | Zero changes. |

---

## 4. Integration Point — Where Phase A Plugs In Later

Phase A creates self-contained, independently testable modules. They are NOT wired into the recording pipeline until Phase D. The integration points are:

**Phase D will wire:**
```typescript
// In recorder-entry.ts startRecording():
import { ElementStateCache } from '../../tap/element-state-cache';
import { setupStateCacheListeners } from '../../tap/state-cache-listeners';

const stateCache = new ElementStateCache();
let cacheCleanup: (() => void) | null = null;

// Inside startRecording():
cacheCleanup = setupStateCacheListeners(stateCache);

// Inside stopRecording():
cacheCleanup?.();
cacheCleanup = null;
stateCache.clear();
```

**Phase C will use:**
```typescript
// In observation-coordinator.ts openWindow():
const beforeSnapshot = stateCache.peek(targetEl);  // Phase A's API
stateCache.capture(targetEl);  // refresh cache with current state

// In observation-coordinator.ts closeWindow():
const finalSnapshot = stateCache.capture(targetEl); // Phase A's API
```

Phase A's API is consumed by later phases. Phase A itself needs no external dependencies beyond the DOM.

---

## 5. Data Flow and Lifecycle

### Phase A's Runtime Lifecycle

```
Recording starts (Phase D will trigger this)
  │
  ├── setupStateCacheListeners(stateCache) called
  │   ├── Registers mousedown capture listener on document
  │   └── Registers focus capture listener on document
  │
  ├── Listeners are now LIVE on the document
  │   │
  │   │  User clicks a checkbox (previously unchecked)
  │   │  ┌─────────────────────────────────────────────────┐
  │   │  │ mousedown fires [capture phase]                 │
  │   │  │   el = checkbox                                 │
  │   │  │   cache.capture(checkbox)                       │
  │   │  │   → readState creates S1{checked:false, ...}    │
  │   │  │   → WeakMap.set(checkbox, S1)                   │
  │   │  └─────────────────────────────────────────────────┘
  │   │  ... later ...
  │   │  ┌─────────────────────────────────────────────────┐
  │   │  │ click fires [capture phase via EventTap]        │
  │   │  │   (EventTap captures ObservedEvent normally)    │
  │   │  │   (Phase A listeners do NOT react to click)     │
  │   │  └─────────────────────────────────────────────────┘
  │   │  ... browser toggles checked to true ...
  │   │  ... later, change event fires ...
  │   │  ┌─────────────────────────────────────────────────┐
  │   │  │ change fires [capture phase via EventTap]       │
  │   │  │   (EventTap captures ObservedEvent normally)    │
  │   │  │   (Phase A listeners do NOT react to change)    │
  │   │  └─────────────────────────────────────────────────┘
  │   │
  │   │  User tabs into a text field (keyboard)
  │   │  ┌─────────────────────────────────────────────────┐
  │   │  │ focus fires [capture phase]                     │
  │   │  │   el = text input                               │
  │   │  │   cache.capture(textInput)                      │
  │   │  │   → readState creates S2{value:"", ...}         │
  │   │  │   → WeakMap.set(textInput, S2)                  │
  │   │  └─────────────────────────────────────────────────┘
  │
Recording stops (Phase D will trigger this)
  │
  ├── cacheCleanup() called
  │   ├── removeEventListener('mousedown', ...)
  │   └── removeEventListener('focus', ...)
  │
  └── stateCache.clear() called
      └── WeakMap reassigned to new empty WeakMap
```

### Before-State Flow (the Case 4 solution)

```
Fresh page load. Select shows "Economy". Cache is empty.

1. User clicks the <select>
   mousedown [capture]: cache.capture(select)
     → S1{value:"Economy"} → WeakMap: {select → S1}

   click [capture]: EventTap captures ObservedEvent normally
     (Phase A does nothing on click)
   ... native dropdown opens ...

2. User picks "Premium Economy" from native dropdown
   Browser sets select.value = "Premium Economy"   ← STATE CHANGED

   change [capture]: EventTap captures ObservedEvent normally

   Phase C (future) will:
     coordinator.openWindow(eventId, 'change', select)
       beforeSnapshot = cache.peek(select)  →  S1{value:"Economy"}  ← TRUE BEFORE-STATE
       cache.capture(select)
         → S2{value:"Premium Economy"} → WeakMap: {select → S2}
     ...
     [3 seconds later] window closes:
       finalSnapshot = cache.capture(select)  →  S2{value:"Premium Economy"}

   Result: before = "Economy", after = "Premium Economy"  ✓
```

### First-Interaction Guarantee

```
Fresh page load. No prior interaction with this element.

Checkbox is unchecked. User clicks it.

1. mousedown [capture]: cache.capture(checkbox)
   → S1{checked:false} → WeakMap: {checkbox → S1}

2. click [capture]: EventTap captures
   ... browser toggles checked to true ...
3. change [capture]: EventTap captures

   Phase C coordinator.openWindow(eventId, 'click', checkbox):
     beforeSnapshot = cache.peek(checkbox) → S1{checked:false}  ← BEFORE-STATE EXISTS
     ... 3 seconds later ...
     finalSnapshot = cache.capture(checkbox) → S2{checked:true}

   Result: before = unchecked, after = checked  ✓
```

The `mousedown` listener fires at the very first physical interaction — the mouse button press. At that point, the cache is empty for this element, so `capture` reads the current (pre-change) state and stores it. By the time `click` fires and the window opens, `peek` finds the cached before-state.

### Slider Before-State (the Case that needed mousedown)

```
Slider at value 20. User drags to 50.

1. mousedown [capture] on slider thumb/track: cache.capture(slider)
   → S1{value:"20"} → WeakMap: {slider → S1}

2. Browser starts drag, fires input events with intermediate values
   ... input events fire, value changes: 25, 30, 40, 50 ...

3. mouseup → change [capture]: EventTap captures

   Phase C coordinator.openWindow(eventId, 'change', slider):
     beforeSnapshot = cache.peek(slider) → S1{value:"20"}  ✓
     ... 3 seconds later ...
     finalSnapshot = cache.capture(slider) → S2{value:"50"}

   Result: before = 20, after = 50  ✓
```

Without the mousedown listener, `change` would be the first time we touch this element. At that point `.value` is already 50. The cache would be empty, `peek` would return null, and before-state would be lost.

### Keyboard Text Entry Before-State (the Case that needed focus)

```
Empty text field. User tabs into it and types "Chennai".

1. focus [capture]: cache.capture(textField)
   → S1{value:""} → WeakMap: {textField → S1}

2. User types: input events fire, value changes through intermediate values

3. blur → change [capture]: EventTap captures

   Phase C coordinator.openWindow(eventId, 'change', textField):
     beforeSnapshot = cache.peek(textField) → S1{value:""}  ✓
     ... 3 seconds later ...
     finalSnapshot = cache.capture(textField) → S2{value:"Chennai"}

   Result: before = "", after = "Chennai"  ✓
```

### Repeated Interactions — Immutability Guarantee

```
Checkbox starts unchecked.

Action 1 — Check:
  mousedown [capture]: cache.capture(cb) → S1{checked:false}
  click [capture]: EventTap captures
    Phase C: window A opens
      A.beforeSnapshot = cache.peek(cb) → S1{checked:false}
      cache.capture(cb) → S2{checked:false}  (state not yet toggled at click capture)
    ... browser toggles to checked ...
    ... 3s later, window A closes:
      A.finalSnapshot = cache.capture(cb) → S3{checked:true}

Action 2 — Uncheck (2+ seconds later, after Window A closed):
  mousedown [capture]: cache.capture(cb) → S4{checked:true}
  click [capture]: EventTap captures
    Phase C: window B opens
      B.beforeSnapshot = cache.peek(cb) → S4{checked:true}
      cache.capture(cb) → S5{checked:true}
    ... browser toggles to unchecked ...
    ... 3s later, window B closes:
      B.finalSnapshot = cache.capture(cb) → S6{checked:false}

Result:
  A: before=S1{checked:false}, after=S3{checked:true}  ← immutable, never changes
  B: before=S4{checked:true}, after=S6{checked:false}  ← immutable, never changes
  Cache (current): {cb → S6{checked:false}}             ← mutable, always latest

Updating the cache for Action 2 creates S4, S5, S6 — new objects.
S1 and S3 are not in the WeakMap anymore, but window A holds
references to them. They cannot be modified.
```

---

## 6. Existing Baseline Functions Phase A Relates To

Phase A's `ElementStateCache.readState()` reads similar properties to existing a43df53 functions, but serves a different purpose:

| Existing Function | File | What It Does | Phase A Relationship |
|---|---|---|---|
| `captureValue(el)` | `identity-extractor.ts` | Reads `.value` for ObservedEvent.valueBefore/valueAfter | Reads value at event capture time for the event record. Phase A's cache reads value at mousedown/focus for before-state. Complementary, not overlapping. |
| `captureCheckedState(el)` | `identity-extractor.ts` | Reads checked/aria-checked/aria-pressed/CSS-class | Reads checked at event capture time. Phase A's cache reads checked at mousedown/focus. Complementary. |
| `extractDomContext(el)` | `dom-context-extractor.ts` | Reads domContext fields (inputType, ariaExpanded, disabled, ancestorRoles, etc.) | Extracted for ObservedEvent.domContext. Phase A reads a subset (ariaExpanded, disabled) for snapshots. No conflict. |
| `extractIdentity(el)` | `identity-extractor.ts` | Reads 18-field ElementIdentity | For ObservedEvent.target. Phase A does not touch identity. |

**No overlap, no conflict.** Phase A reads DOM properties at different times (mousedown/focus vs. click/change) for different purposes (before-state cache vs. event record). The same property may be read multiple times at different event phases — this is correct, not redundant.

---

## 7. Test Design

### Test File: `tests/tap/element-state-cache.test.ts`

**Pattern:** Matches the existing a43df53 test style — `describe`/`it`/`expect` from vitest, JSDOM DOM manipulation, direct function calls.

**Test cases (10):**

```
describe('ElementStateCache', () => {

  describe('capture', () => {
    1. captures checkbox state (checked, aria-checked)
    2. captures select value
    3. captures text input value
    4. captures div state (className, textContent, childCount)
    5. captures aria-expanded, aria-pressed on custom elements
    6. overwrites previous snapshot on re-capture (same element)
  });

  describe('peek', () => {
    7. returns null for uncached element (first interaction)
    8. returns stored snapshot for cached element
  });

  describe('clear', () => {
    9. clears all cached states (peek returns null after clear)
  });

  describe('immutability', () => {
    10. stored snapshot is not modified when cache is re-captured
        — capture(el) twice, verify first snapshot unchanged
  });
});
```

**Key test — immutability (test 10):**

```typescript
it('stored snapshot is not modified when cache is re-captured', () => {
  document.body.innerHTML = '<input type="checkbox" id="cb">';
  const cb = document.getElementById('cb') as HTMLInputElement;
  cb.checked = false;

  const snap1 = cache.capture(cb);       // S1{checked:false}
  cb.checked = true;
  const snap2 = cache.capture(cb);       // S2{checked:true}

  // snap1 must NOT have changed
  expect(snap1.checked).toBe(false);     // still the old snapshot
  expect(snap2.checked).toBe(true);      // new snapshot
  expect(snap1).not.toBe(snap2);         // different objects
});
```

This test directly verifies the immutability guarantee that underpins the "repeated interactions remain separate" requirement.

### Test File: `tests/tap/state-cache-listeners.test.ts`

**Pattern:** Same JSDOM style. Uses `TEST_HOOK.forceTrusted = true` pattern from existing event-tap tests for dispatching events.

**Test cases (8):**

```
describe('State Cache Listeners', () => {

  describe('setupStateCacheListeners', () => {
    1. captures element state on mousedown (capture phase)
    2. captures element state on focus (capture phase)
    3. populates cache BEFORE state changes (timing guarantee)
       — dispatch mousedown on unchecked checkbox, then set checked=true,
         verify cache.peek shows checked:false
    4. ignores non-HTMLElement targets (document, text nodes)
    5. does not interfere with EventTap event flow
       — register both listeners and EventTap, verify EventTap still gets events

    describe('cleanup', () => {
      6. removes listeners on cleanup (no capture after cleanup)
      7. cleanup function is idempotent (safe to call twice)
    });

    8. multiple elements cached independently
       — mousedown on element A, then element B, peek both
  });
});
```

**Key test — timing guarantee (test 3):**

```typescript
it('populates cache BEFORE state changes (timing guarantee)', () => {
  document.body.innerHTML = '<input type="checkbox" id="cb">';
  const cb = document.getElementById('cb') as HTMLInputElement;
  cb.checked = false;

  const cache = new ElementStateCache();
  const cleanup = setupStateCacheListeners(cache);

  // Simulate the real event order: mousedown fires, THEN state changes
  cb.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

  // NOW change state (simulating browser activation behavior)
  cb.checked = true;

  // Cache must have the pre-change state
  const before = cache.peek(cb);
  expect(before).not.toBeNull();
  expect(before!.checked).toBe(false);  // pre-change state

  cleanup();
});
```

This test validates the core claim: at capture phase, the element's state has not yet been changed by the browser's default action.

---

## 8. Acceptance Criteria for Phase A

- [ ] **AC-A1:** `observation-types.ts` exports all 5 types/interfaces: `MutationRecord2`, `ElementStateSnapshot`, `ObservationWindow`, `WindowEndReason`, `ObservationResult`
- [ ] **AC-A2:** `ElementStateCache.capture(el)` reads and stores 9 properties: value, checked, className, disabled, ariaExpanded, ariaChecked, ariaPressed, textContent, childCount
- [ ] **AC-A3:** `ElementStateCache.peek(el)` returns the previously captured snapshot, or null if never captured
- [ ] **AC-A4:** `ElementStateCache.clear()` makes all subsequent peek() calls return null
- [ ] **AC-A5:** Snapshots are immutable — re-capturing an element creates a new snapshot object, the previous one is unchanged
- [ ] **AC-A6:** `setupStateCacheListeners()` captures element state on mousedown capture phase
- [ ] **AC-A7:** `setupStateCacheListeners()` captures element state on focus capture phase
- [ ] **AC-A8:** The cache is populated BEFORE the browser changes element state (verified by test 3)
- [ ] **AC-A9:** Cleanup function removes both listeners
- [ ] **AC-A10:** Non-HTMLElement targets are ignored
- [ ] **AC-A11:** Phase A creates zero modifications to any existing file
- [ ] **AC-A12:** All 18 Phase A tests pass
- [ ] **AC-A13:** Full existing test suite passes (no regressions)

---

## 9. Phase A Checklist (Implementation Order)

```
[ ] Create src/shared/observation-types.ts
[ ] Create tests/tap/element-state-cache.test.ts (write tests first)
[ ] Create src/tap/element-state-cache.ts (implement to pass tests)
[ ] Create tests/tap/state-cache-listeners.test.ts (write tests first)
[ ] Create src/tap/state-cache-listeners.ts (implement to pass tests)
[ ] Run element-state-cache tests → all pass
[ ] Run state-cache-listeners tests → all pass
[ ] Run full test suite → zero regressions
[ ] Phase A complete
```

**Total new code:** ~285 lines source + ~300 lines tests = ~585 lines
**Files modified:** 0
**Existing behavior changed:** none
