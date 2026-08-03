# Root Cause Analysis: 7bfd949 → 82d2c65 → 1b61149

**Methodology:** Byte-level comparison of every source file across three commits, with full diff content for all changed files. All evidence is concrete code, not assumptions.

---

## Executive Summary

The regression chain is now fully understood:

| Commit | What Changed | Impact |
|---|---|---|
| **7bfd949** | Baseline — Component Runtime + Event Tap + 13 definitions | ✅ Works on traditional apps (OrangeHRM) |
| **82d2c65** | `resolveToNamedAncestor()` wraps EVERY `resolveTarget()` return + Tier 12 ancestor walk in `computeAccessibleName()` | ⚠️ Double ancestor traversal on every event. Target identity shifts to parents unpredictably. |
| **1b61149** | BCT parallel capture path + orchestrator + confidence scoring + CDP/AX + async init/stop | ❌ Two parallel processing paths race and conflict. 75-line `onEmit` callback silently drops interactions. |

**Root Cause:** The regression is NOT in the Component Runtime (it's byte-identical across all three commits). The regression is caused by **layered changes to the periphery** — target resolution, event routing, and the `onEmit` callback — that destabilize the stable core.

---

## 1. What Worked in 7bfd949 That Was Lost

### The Stable Core (Untouched — Still Present)

The Component Runtime engine (`component-runtime.ts`, 548 lines) is **byte-for-byte identical** (md5: `57f904bef415fcd8892e502f460bd87b`) across all three commits. It was never modified. Its algorithm:

```
process(event):
  1. Dedup (seenEventIds, cap 500)
  2. Navigation flush → interrupt active components
  3. Stale cleanup (15s timeout)
  4. Active stack offer (top → bottom):
     - isInScope → handleEvent → complete or stay active
     - outside → shouldCancelOnOutside? / shouldCompleteOnOutside?
  5. Discovery (if !handled):
     - Non-Click definitions by priority (ascending: 10→120)
     - Click fallback (priority 180)
```

This engine works because it's **deterministic and synchronous**. Event in → interaction out. No race conditions, no async paths, no parallel engines.

### What 7bfd949 Did Well on Traditional Apps

Traditional web applications (OrangeHRM, vanilla HTML forms) have predictable DOM structure:

1. **Target resolution was precise.** `resolveTarget()` returned the **exact interactive element** (the `<input>`, `<button>`, `<select>`, `<a>`). The event target IS the element the user intended to interact with.

2. **Identity was stable.** The `ElementIdentity` snapshot (18 fields) captured the right element, so accessibleName, CSS selector, and element key all pointed at the correct target.

3. **Definitions matched correctly.** Because the target was the right element, the 13 component definitions could evaluate their trigger conditions against the actual interactive element. OrangeHRM's OXD components use standard roles and classes that the definitions recognize.

4. **The `onEmit` callback was 4 lines:**
   ```ts
   onEmit: (interaction) => {
     enrichInteraction(interaction);
     liveInteractions.push(interaction);
     persistLiveInteractions();
   }
   ```
   Every emitted interaction was enriched, pushed, and persisted. **No interaction was ever dropped.**

### What Was Lost in Later Commits

| Loss | Commit | Cause |
|---|---|---|
| **Precise target resolution** | 82d2c65 | `resolveToNamedAncestor()` redirects the target to a parent element, changing which element definitions evaluate against |
| **Synchronous, failure-free emit** | 1b61149 | 75-line `onEmit` with orchestrator routing, setTimeout safety-nets, and async AX enrichment — exceptions silently drop interactions |
| **Single processing path** | 1b61149 | Two parallel engines (CR + BCT) process every event, requiring dedup that can suppress valid interactions |
| **Simple init/stop** | 1b61149 | `initRecording()` changed from sync to async (CDP debugger attach) — if CDP fails, recording start is blocked or degraded |

---

## 2. Which Specific Code Changes Introduced Regressions

### Regression 1: `resolveToNamedAncestor()` (82d2c65)

**File:** `src/tap/identity-extractor.ts`

**The change:** Every `return el` in `resolveTarget()` was replaced with `return resolveToNamedAncestor(el)`:

```ts
// BEFORE (7bfd949) — returns the exact interactive element
if (el.matches(INTERACTIVE_SELECTOR)) return el;

// AFTER (82d2c65) — may return a PARENT element instead
if (el.matches(INTERACTIVE_SELECTOR)) return resolveToNamedAncestor(el);
```

**The new function:**
```ts
function resolveToNamedAncestor(el: Element): Element {
  // If the element itself has text or aria-label, use it directly
  if (directText) return el;
  if (directAriaLabel) return el;

  // Walk up to 5 parents looking for one with text
  for (let depth = 0; depth < 5 && parent; depth++) {
    if (ancestorAriaLabel) return parent;
    if (ancestorText && ancestorText.length <= 80) return parent;
    parent = parent.parentElement;
  }
  return el;
}
```

**Why this breaks traditional apps:**

On OrangeHRM, consider a form field structure:
```html
<div class="oxd-input-group">
  <label>Employee Name</label>
  <div class="oxd-input-wrapper">
    <input type="text" />  <!-- user clicks here -->
  </div>
</div>
```

- At 7bfd949: `resolveTarget()` returns the `<input>`. The identity says "Employee Name" (from label association). TextEntry definition activates. ✅
- At 82d2c65: `resolveTarget()` calls `resolveToNamedAncestor(input)`. The `<input>` has no `innerText`, so it walks to `.oxd-input-wrapper` (no text), then `.oxd-input-group` (has "Employee Name" text via innerText including the label). It returns `.oxd-input-group` as the target. Now:
  - The target is a `<div>`, not an `<input>`.
  - TextEntry definition's trigger check (`el.matches('input, textarea, [contenteditable]')`) fails because the target is a `<div>`.
  - Click definition catches it as a generic click ("Click Employee Name" instead of "Enter text in Employee Name").
  - **Result:** TextEntry interactions become Click interactions. The recorder loses the distinction between "clicking a field" and "typing in a field."

**The same ancestor walk was ALSO added to `computeAccessibleName()` as Tier 12**, causing the same parent walk to happen twice per event (once in `resolveToNamedAncestor`, once in `computeAccessibleName`).

**Performance impact:** Every event triggers 2× ancestor walks, each up to 5 levels deep, with `innerText` and `getComputedStyle` calls. On complex pages, `innerText` forces a reflow. This is the hottest code path in the system.

### Regression 2: The 75-line `onEmit` Callback (1b61149)

**File:** `src/runtime/sw-integration.ts`

**The change:** The 4-line `onEmit` became 75 lines:

```
BEFORE (7bfd949):
onEmit → enrich → push → persist (4 lines, synchronous, no failure path)

AFTER (1b61149):
onEmit →
  IF orchestrator enabled:
    orchestrator.onComponentRuntimeInteraction(interaction)
    IF claimed:
      setTimeout(() => {  // safety net
        if not yet committed:
          push directly
      }, commitWindow * 2)
    ELSE:
      // fall through to direct path
  IF AX provider available:
    await enrichInteractionAsync(interaction)  // ← ASYNC inside sync callback
  ELSE:
    enrichInteraction(interaction)
  push + persist
```

**Why this breaks:**

1. **Async enrichment inside a synchronous callback.** The `onEmit` callback is called by the Component Runtime's `process()` function. If `enrichInteractionAsync()` is called, it returns a Promise that may not resolve before the next event arrives. The interaction may be pushed to `liveInteractions` before enrichment completes, or worse, an unhandled rejection silently drops it.

2. **The orchestrator safety-net setTimeout.** When the orchestrator "claims" an interaction, it goes into a holding pattern with a setTimeout safety net. If the orchestrator's commit window doesn't fire before the user stops recording, the interaction is lost. The safety net fires at `commitWindow * 2`, but if the service worker is terminated by MV3 before the timeout fires, the interaction is gone.

3. **Exception swallowing.** Any exception in the 75-line callback (e.g., orchestrator throws, AX provider fails, confidence scorer produces NaN) silently prevents the interaction from being pushed to `liveInteractions`. The user sees nothing — the interaction just doesn't appear.

### Regression 3: Dual Processing Paths (1b61149)

**The change:** Every DOM event now triggers two processing paths:

```
DOM Event
├── onEvent → serialize → OBSERVED_EVENT → Component Runtime
└── onRawEvent → ControlTracker.processEvent()
                     │
                 MutationObserver
                     │
                 BCT_* messages → SW (parallel to CR)
```

**Why this breaks:**

1. **Duplicate interactions.** CR detects a dropdown click → emits a Dropdown interaction. BCT also detects the same dropdown click → emits a BCT Dropdown interaction. The SW's dedup logic must reconcile them. If dedup fails (different element keys due to `resolveToNamedAncestor` changing CR's target), both appear in the timeline.

2. **Interference.** BCT's MutationObserver fires on DOM changes that CR's definitions also react to. When BCT detects a surface and sends `BCT_SURFACE_ASSOCIATED`, the orchestrator creates a session that may suppress the next CR interaction for the same component.

3. **Race conditions.** CR processes synchronously (deterministic). BCT processes via MutationObserver callbacks (async, macrotask queue). The SW receives CR's `OBSERVED_EVENT` and BCT's `BCT_INTERACTION` at different times for the same user action. The orchestrator tries to reconcile, but timing windows (`surfaceDetectionWindowMs: 500`, commit windows) create races.

### Regression 4: Async init/stop with CDP (1b61149)

**The change:** `initRecording()` became async:

```ts
// BEFORE (7bfd949)
export function initRecording(): void {
  runtime = createRuntime(ALL_DEFINITIONS, config);
}

// AFTER (1b61149)
export async function initRecording(): Promise<void> {
  await initAxProvider();  // CDP debugger attach
  orchestrator = new RecorderOrchestrator({ onEmit: ... });
  runtime = createRuntime(ALL_DEFINITIONS, config);
}
```

**Why this breaks:**

1. **CDP debugger attachment can fail.** If another debugger is attached (DevTools, another extension), `chrome.debugger.attach()` throws. The code catches this and disables AX enrichment, but the orchestrator still runs in a degraded mode.

2. **`debugger` permission.** The manifest now requires `"debugger"` permission. Chrome shows a prominent warning ("Reads and changes all your data") and some enterprise policies block extensions with this permission.

---

## 3. What Is Genuinely Improving vs Accidental Complexity

### Genuine Improvements in Later Commits

| Improvement | Commit | Why It's Good |
|---|---|---|
| **AdaniOne-specific regex patterns** | 82d2c65 | `journey-card`, `flight-selector`, `search-field`, `city-field`, `date-field` added to `DROPDOWN_TRIGGER_CLASS_RE`. Correct identification of AdaniOne's dropdown triggers. |
| **BCT surface detection concept** | 1b61149 | Using MutationObserver to detect dynamic surfaces (dropdowns, date pickers) is the RIGHT approach for React/modern SPAs. CSS class heuristics alone are insufficient. |
| **`bctBridge.toComponentInteraction()`** | 1b61149 | Clean adapter from BCT's TrackedInteraction to CR's ComponentInteraction type. Good abstraction boundary. |
| **Surface detector** | 1b61149 | Priority-ordered surface detection (ARIA → portal-position → overlay → content-structure) is the correct multi-signal approach. |
| **Control lifecycle states** | 1b61149 | opening → open → closing → completed/abandoned is the right state machine for dynamic surfaces. |

### Accidental Complexity

| Complexity | Commit | Why It's Accidental |
|---|---|---|
| **`resolveToNamedAncestor()` applied to ALL targets** | 82d2c65 | The problem it solves (unnamed interactive elements on AdaniOne) is real, but applying it universally breaks traditional apps where targets ARE correctly named. It should be a **fallback tier in `computeAccessibleName()`**, not a target resolution redirect. |
| **Two parallel processing engines** | 1b61149 | Running BCT alongside CR for EVERY event doubles processing, requires dedup, and creates races. BCT should REPLACE CR's discovery for modern apps (detected via framework/component detector), not run in parallel. |
| **Orchestrator + confidence scoring** | 1b61149 | 2,060 lines of orchestrator + 467 lines of confidence scoring to reconcile two engines that shouldn't exist simultaneously. If there's only one engine, you don't need a reconciliation layer. |
| **AX tree via CDP** | 1b61149 | 741 lines for accessibility tree extraction via Chrome DevTools Protocol. Requires `debugger` permission. The accessibility tree is valuable, but CDP is a heavyweight integration that adds failure modes. |
| **Async init/stop** | 1b61149 | Ripple effect from CDP/AX. Makes recording start unreliable. |
| **Framework detection system** | 1b61149 | 1,239 lines for React/Vue/Angular/Svelte detection. Over-engineered for the actual need: "does this page use dynamic DOM?" |
| **Double ancestor walk** | 82d2c65 | `resolveToNamedAncestor()` walks parents, then `computeAccessibleName()` Tier 12 walks them again. Same work, twice. |

---

## 4. Why 7bfd949 Fails on Modern Apps

### The Gap Is in Target Resolution and Surface Detection, NOT in the Runtime Engine

Modern SPA applications (AdaniOne) break 7bfd949 in two specific places:

### Gap 1: `resolveTarget()` Returns the Wrong Element

On AdaniOne, interactive elements are nested in deeply structured React components:

```html
<div class="journey-card flight-selector">
  <div class="city-field" role="button" tabindex="0">
    <div class="label">From</div>
    <div class="value">Mumbai</div>      <!-- user clicks here -->
  </div>
</div>
```

At 7bfd949, `resolveTarget()` strategy:
1. Check `INTERACTIVE_SELECTOR` → `.value` div doesn't match (`role="button"` is on `.city-field`)
2. Walk parents → `.city-field` has `role="button"` → returns `.city-field` ✅

But the problem is deeper — some AdaniOne elements have NO interactive attributes at all:

```html
<div class="fare-option premium">
  <span class="fare-label">Premium Economy</span>   <!-- user clicks here -->
</div>
```

Neither the `<span>` nor the `<div>` has `role`, `tabindex`, `cursor:pointer` (set dynamically via CSS-in-JS), or any ARIA attributes. Strategy 2b's CSS class regex matches `fare-option` → returns the element. But:
- `accessibleName` is empty (no aria-label, no `<label>`, no `<title>`)
- The interaction becomes "Click element" — meaningless

**The actual gap:** `resolveTarget()` can find the element, but `computeAccessibleName()` can't extract a meaningful label from it because it has no standard naming attributes.

### Gap 2: No Surface/Popover Detection

AdaniOne renders dropdowns and date pickers as portal-based popovers:

```html
<!-- Click "From" field → React renders a portal -->
<body>
  <div id="root">... app ...</div>
  <div class="popover-portal" style="position:fixed;z-index:1000">
    <div role="listbox">
      <div class="city-option">Delhi</div>
      <div class="city-option">Mumbai</div>
    </div>
  </div>
</body>
```

At 7bfd949, the Dropdown definition:
1. Trigger detected: `.city-field` matches `DROPDOWN_TRIGGER_CLASS_RE` → activates
2. `isInScope`: Checks if the clicked element is the trigger, a dropdown option, or inside a dropdown surface
3. The dropdown surface (`.popover-portal`) is NOT a child of the trigger element — it's a portal at `body` level
4. `isInScope` returns `false` for option clicks
5. The option click falls through to Click definition (priority 180) → emitted as "Click Delhi" instead of "Select Delhi for From"

**The actual gap:** The definition's `isInScope()` checks parent/descendant relationships, but SPA portals break the DOM hierarchy assumption. The trigger and the surface are siblings in the DOM, not parent/child.

### Gap 3: No Dynamic CSS Detection

AdaniOne uses CSS-in-JS (styled-components, emotion). The `cursor:pointer` style is applied dynamically by JavaScript, not in a stylesheet. At capture time:

```ts
const style = window.getComputedStyle(el);
if (style.cursor === 'pointer') return el;
```

This DOES work (getComputedStyle resolves computed styles), but only if the element has already been styled. If the element is captured before React's layout effect applies the style (e.g., during initial render), it returns `undefined`.

---

## 5. Can Modern App Support Be Incremental?

### Answer: YES — Through Targeted Enhancements to 7bfd949

The Component Runtime engine is correct and should be preserved unchanged. The gaps are in **target resolution, identity extraction, and surface scoping**. These can be fixed incrementally:

### Enhancement 1: Ancestor Name Resolution as NAME Fallback, Not Target Redirect

**Current approach (82d2c65):** `resolveToNamedAncestor()` changes the TARGET element.
**Correct approach:** Keep the target as-is. Add the ancestor walk as Tier 12 in `computeAccessibleName()` ONLY when earlier tiers return empty.

```ts
// CORRECT: Target stays as the interactive element
// Only the NAME resolution walks ancestors

export function resolveTarget(event: Event): Element | null {
  // ... existing strategies return the actual interactive element
  // NO resolveToNamedAncestor wrapper
}

export function computeAccessibleName(el: Element): string {
  // Tiers 1-11: existing strategies
  // Tier 12: ONLY if name is still empty
  if (!name) {
    // Walk up to 5 ancestors looking for aria-label or text
  }
  return name;
}
```

**Why this preserves traditional apps:** The target stays as the `<input>`, `<button>`, etc. Definitions evaluate against the correct element. Only the displayed label is enriched from ancestors when the element itself is unnamed.

### Enhancement 2: Surface-Aware Scoping for Definitions

**Current approach (7bfd949):** Definitions check `isInScope()` using parent/descendant DOM relationships.
**Correct approach:** Add a **surface registry** that tracks active portals/popovers.

```ts
// Lightweight surface tracker (not BCT's full MutationObserver system)
// Only watches for portal/popover creation/removal

interface ActiveSurface {
  element: Element;          // the popover/portal DOM node
  triggerElement: Element;   // the trigger that opened it
  type: 'dropdown' | 'datepicker' | 'dialog';
}

const activeSurfaces: ActiveSurface[] = [];

// MutationObserver ONLY for portal/overlay detection
// (much simpler than BCT's full surface detector)
const portalObserver = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (isPortalOrOverlay(node)) {
        activeSurfaces.push({ element: node, triggerElement: lastClickedElement, type: inferType(node) });
      }
    }
    for (const node of mutation.removedNodes) {
      // Remove from activeSurfaces
    }
  }
});
```

Then definitions' `isInScope()` can check:
```ts
isInScope(ctx, event) {
  // Existing DOM hierarchy check
  if (ctx.triggerElement.contains(event.target)) return true;
  // NEW: Check active surfaces
  for (const surface of activeSurfaces) {
    if (surface.triggerElement === ctx.triggerElement && surface.element.contains(event.target)) return true;
  }
  return false;
}
```

**Why this is better than BCT:** It enhances the existing definitions instead of creating a parallel engine. The surface registry is a simple data structure that definitions query, not a competing processing pipeline.

### Enhancement 3: Display Value Fallback (Already Present)

7bfd949 already has `findDisplayValue()` in the identity extractor — it scans siblings for display-value CSS classes. This is the correct approach for React SPAs that write selected values to sibling divs. It works in 7bfd949 and needs no change.

### What This Means for Migration

**The migration can start from 7bfd949** and add modern app support through three targeted, low-risk enhancements:

1. **Ancestor name fallback** in `computeAccessibleName()` only (not in target resolution) — ~30 lines
2. **Surface-aware scoping** via lightweight portal observer + definition scoping enhancement — ~150 lines
3. **AdaniOne-specific regex patterns** in `DROPDOWN_TRIGGER_CLASS_RE` (the one good change from 82d2c65) — ~1 line

Total: ~180 lines of new code vs. 10,000+ lines of BCT/orchestrator/confidence/AX.
