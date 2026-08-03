# Click Architecture Review & Redesign — v2.0 Foundation

**Status: DESIGN REVIEW — awaiting approval before implementation**

---

## 1. Complete Click Architecture Review

### Current Flow (Browser Event → Stored Recording)

```
User clicks element
       │
       ▼
┌──────────────────────────────────────────────┐
│ Browser dispatches events (capture → target → bubble) │
└──────────────────────────────────────────────┘
       │
       ▼ (capture phase — fires BEFORE app handlers)
┌──────────────────────────────────────────────┐
│ click-content-script.ts click handler        │
│                                               │
│ 1. Check isRecording flag                     │
│ 2. Skip if isInsideGrid(target)               │
│ 3. Find clickable ancestor (a, button,        │
│    [role=button], input[type=button/submit])  │
│ 4. Skip if data-cmdrunner-download-pending     │
│ 5. Skip if data-cmdrunner-drag-active          │
│ 6. Store as PendingClick (300ms delay)        │
│ 7. If dblclick arrives within 300ms on same   │
│    element → cancel pending, emit dblclick    │
│ 8. After 300ms → emitClick() → sends          │
│    CLICK_CAPTURED message                     │
└──────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────┐
│ service-worker.ts → processAction()           │
│                                               │
│ 1. Look up registry config for 'click'        │
│ 2. config.addToSession(session, identity)     │
│ 3. Capture screenshot                         │
│ 4. Send element info to AI service            │
│ 5. On AI response: buildStep() → addStep()    │
│ 6. On AI failure: buildStep() → addStep()     │
│                                               │
│ NO cross-action dedup. NO awareness of other  │
│ actions on same element.                      │
└──────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────┐
│ recording-session.ts → addAction()            │
│                                               │
│ 1. Generate actionId (click-NNNN)             │
│ 2. Generate elementId                         │
│ 3. Create ClickEvent object                   │
│ 4. Push to events array                       │
│ 5. Persist to chrome.storage                  │
│                                               │
│ NO dedup across action types. NO check for   │
│ recent events on same element.                │
└──────────────────────────────────────────────┘
```

### Key Observations

1. **Click has no ownership awareness.** It only defers to 3 specific scripts (grid, download, drag). It has no mechanism to know when tabs, accordion, tree, RTE, modal, stepper, scheduler, or toggle scripts have claimed the same click.

2. **No cross-action dedup anywhere in the pipeline.** The service-worker's `processAction()` processes each message independently. The recording session's `addAction()` creates a new event for every call with no check for recent events on the same element.

3. **Click fires on a 300ms delay.** This is purely for double-click detection. It means enterprise scripts (which fire immediately on capture-phase click) always fire first.

4. **Element normalization is inconsistent.** Click-content-script uses `target.closest('a, button, [role="button"], input[type="button"], input[type="submit"]')`. This misses many interactive elements: `[role="tab"]`, `[role="menuitem"]`, `[role="option"]`, `[role="switch"]`, `[role="link"]`, `summary`, `select`, `.btn`, and any custom interactive element.

---

## 2. Weakness Analysis

### Weakness #1 — Double Emission (Critical)

**Problem:** Clicking a tab, accordion header, tree node, RTE editor, dialog button, stepper step, scheduler cell, or toggle switch produces TWO recorded events: the specialized interaction AND a generic click.

**Root cause:** Click-content-script only checks 3 skip conditions. The other 8 enterprise scripts set internal dedup attributes (e.g., `data-cmdrunner-toggle-processed`) but click-content-script doesn't read them.

**Impact:** Every click inside an enterprise component creates a duplicate step in the recording. This is the #1 source of noisy recordings.

**Affected scripts:** toggle, tree-view, rich-text-editor, modal-dialog, tabs, accordion, stepper, scheduler (8 of 10 click-intercepting scripts).

### Weakness #2 — Incomplete Clickable Ancestor Resolution (High)

**Problem:** Click normalization only walks up to `a, button, [role="button"], input[type="button"], input[type="submit"]`. Many clickable elements are missed:

| Element Type | Example | Current Behavior |
|-------------|---------|-----------------|
| `[role="tab"]` | `<div role="tab">Products</div>` | Records the inner `<span>` — wrong identity |
| `[role="menuitem"]` | `<li role="menuitem">Edit</li>` | Records the inner text node |
| `[role="option"]` | `<div role="option">Active</div>` | Records inner element |
| `[role="switch"]` | `<div role="switch"></div>` | Records inner element |
| `[role="link"]` | `<div role="link">Details</div>` | Records inner element |
| `<summary>` | `<summary>Section 1</summary>` | Not found — records child |
| `.btn` (Bootstrap) | `<div class="btn">Save</div>` | Not found |
| SVG icons inside buttons | `<button><svg>...</svg></button>` | Usually handled, but if the SVG has no clickable ancestor match, it fails |
| `[data-action]` | `<tr data-action="edit">` | Not found |
| `[tabindex]` elements | `<div tabindex="0">Custom</div>` | Not found |

**Impact:** The recorded element identity (and therefore the locator) targets the wrong element — usually a `<span>` or `<svg>` inside the real interactive container. This produces unstable locators and confusing Plain English.

### Weakness #3 — 300ms Click Delay Causes Race Conditions (Medium)

**Problem:** Every click emission is delayed 300ms for double-click detection. This means:

- Enterprise scripts fire at T+0ms (immediate on capture-phase click)
- Click fires at T+300ms

If a navigation occurs between T+0ms and T+300ms (SPA route change triggered by the click), the click message may fire on a different page context or fail silently.

**Impact:** Missed clicks in SPA navigation scenarios.

### Weakness #4 — No Cross-Action Temporal Dedup (Medium)

**Problem:** If the same element receives both a specialized interaction and a generic click within a short window, both are stored as separate events. There's no mechanism to detect "a click-0007 and a tab-0003 are the same user action on the same element" and remove the redundant one.

**Impact:** Recordings contain redundant steps that a manual tester would never write.

### Weakness #5 — Locator Quality Depends on Element Identity (Low-Medium)

**Problem:** `generateCssSelector()` generates `tag:nth-of-type` chains up to 5 levels deep, or uses `id` if present. But:
- `id` attributes in React/Angular apps are often auto-generated (e.g., `#react-aria-9-1`) and unstable
- `nth-of-type` chains are fragile when list order changes
- No use of `data-testid`, `aria-label`, or semantic role in the locator priority order

### Weakness #6 — Shadow DOM Detection Exists but Click Handler Doesn't Use It (Low)

**Problem:** `isInShadowDom()` is implemented in the identity engine, but click normalization (`closest()`) doesn't cross shadow boundaries. If a click target is inside a Shadow DOM, the `closest()` call for clickable ancestors only searches within the same shadow root.

### Weakness #7 — No Confidence Model (Low — Architectural)

**Problem:** Click has no concept of "confidence." It either fires or doesn't. There's no mechanism to say "I'm 60% sure this is a tab click, 100% sure it's a generic click — fall back to click."

**Impact:** This is the architectural gap the entire v2.0 direction addresses.

---

## 3. Proposed Click Architecture

### Design Principle

**Click is the default owner of all mouse-based interactions.** Enterprise interactions earn ownership through high-confidence evidence, not by racing to fire first.

### New Flow

```
User clicks element
       │
       ▼
┌──────────────────────────────────────────────┐
│ click-content-script.ts (REDESIGNED)          │
│                                               │
│ 1. Check isRecording flag                     │
│ 2. Normalize: resolveInteractiveAncestor()    │
│    — comprehensive selector list              │
│    — walks up DOM to find the real target     │
│ 3. Check if handled by enterprise script      │
│    via data-cmdrunner-handled attribute       │
│ 4. Store as PendingClick (300ms delay)        │
│    — same double-click detection as before    │
│ 5. After 300ms → emit click                   │
└──────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────┐
│ NEW: Cross-Action Dedup in processAction()    │
│                                               │
│ Check: was a different action type recorded   │
│ on the same element within the last 500ms?    │
│ If yes → skip this generic click.             │
└──────────────────────────────────────────────┘
```

### Key Architectural Decisions

**Decision 1: Unified "Handled" Signal**

Every enterprise content script that intercepts clicks will set `data-cmdrunner-handled="<action-type>"` on the clicked element. Click-content-script checks this attribute. If present, it skips.

This replaces the current ad-hoc pattern where only download and drag set signals, and replaces the `isInsideGrid()` approach with a unified mechanism.

```typescript
// Enterprise script fires:
element.setAttribute('data-cmdrunner-handled', 'tab');

// Click script checks (capture phase, same cycle):
if (target.closest('[data-cmdrunner-handled]')) return;
```

The attribute is set synchronously during the capture-phase click handler, before click-content-script's 300ms timer expires.

**Decision 2: Comprehensive Click Normalization**

Replace the narrow `closest('a, button, [role="button"], input[type="button"], input[type="submit"]')` with a comprehensive interactive ancestor resolver:

```typescript
const INTERACTIVE_SELECTOR = [
  // Semantic tags
  'a', 'button', 'summary', 'select',
  'input[type="button"]', 'input[type="submit"]', 'input[type="reset"]',
  'input[type="image"]', 'input[type="checkbox"]', 'input[type="radio"]',
  // ARIA roles
  '[role="button"]', '[role="link"]', '[role="tab"]',
  '[role="menuitem"]', '[role="menuitemcheckbox"]', '[role="menuitemradio"]',
  '[role="option"]', '[role="switch"]', '[role="treeitem"]',
  '[role="checkbox"]', '[role="radio"]',
  // Framework patterns
  '.btn', '.button', '[data-action]',
  // Anything with explicit onclick
  '[onclick]',
  // tabindex makes element interactive
  '[tabindex]',
].join(', ');
```

**Decision 3: Temporal Dedup in Service-Worker (Belt-and-Suspenders)**

Even with the `data-cmdrunner-handled` signal, add a temporal dedup check in `processAction()`. If a generic `click` arrives within 500ms of a different action type on the same element, skip the click.

This catches any edge case where the signal attribute wasn't set (timing, dynamic DOM removal, etc.).

**Decision 4: Click Remains the Default Fallback**

If no enterprise script claims ownership, click fires. This is the core principle: **absence of evidence for enterprise classification = evidence of a generic click.**

---

## 4. Interaction Ownership Rules

### Rule Set

| Rule | Condition | Owner | Rationale |
|------|-----------|-------|-----------|
| **1. Click is default** | No enterprise script claims the click | `click` | Foundation principle |
| **2. Enterprise claims via signal** | Enterprise script sets `data-cmdrunner-handled` on the element | Enterprise type | Script has specific knowledge of the component |
| **3. Grid containment** | Click target is inside a grid container | `grid_interaction` | Grid has complex internal interactions |
| **4. Native form controls** | Target is `input[type=checkbox]`, `input[type=radio]`, `select` | Respective form type | These are unambiguous native elements |
| **5. Temporal dedup** | Different action on same element within 500ms | First action wins | Prevents double-emission regardless of signal |
| **6. Download/Drag signals** | `data-cmdrunner-download-pending` or `data-cmdrunner-drag-active` | `file_download` / `drag_drop` | Already implemented — preserved |

### Priority Order (highest to lowest)

1. **Form controls** (checkbox, radio, select, slider, date picker, multi-select, file upload) — detected by `change` events, not click events. No contention with click.
2. **Drag/Download** — detected by mousedown/dragstart/click with data attributes. Already signals to click.
3. **Grid** — detected by container containment. Already signals to click.
4. **Enterprise click-based** (toggle, tree, RTE, modal, tabs, accordion, stepper, scheduler) — MUST signal to click via `data-cmdrunner-handled`.
5. **Click** — default fallback for everything else.

### When Click Yields

Click yields ONLY when:
- `data-cmdrunner-handled` attribute is present on the clicked element or its ancestor
- `isInsideGrid()` returns true
- `data-cmdrunner-download-pending` is present
- `data-cmdrunner-drag-active` is present
- A temporal dedup check in the service-worker catches a recent specialized action on the same element

### When Click Does NOT Yield

Click does NOT yield when:
- The element is a plain button, link, or div without enterprise markers
- The element is inside an enterprise container but the enterprise script did NOT set the handled signal (low confidence)
- The element matches a broad selector but has no structural evidence of being that component

---

## 5. Implementation Plan

### Phase 1: Unified Handled Signal (Content Scripts)

**Goal:** Every enterprise content script that intercepts clicks sets `data-cmdrunner-handled="<type>"` on the clicked element.

**Files changed (8 enterprise scripts):**
- `toggle-content-script.ts`
- `tree-view-content-script.ts`
- `rich-text-editor-content-script.ts`
- `modal-dialog-content-script.ts`
- `tabs-content-script.ts`
- `accordion-content-script.ts`
- `stepper-content-script.ts`
- `scheduler-content-script.ts`

**Change per file (1 line each):**
```typescript
// At the point where the script decides "this is my interaction":
el.setAttribute('data-cmdrunner-handled', 'tab'); // or 'accordion', etc.
```

### Phase 2: Click Content Script Hardening

**Goal:** Redesign click-content-script.ts with comprehensive normalization and handled-signal check.

**Files changed (1):**
- `click-content-script.ts`

**Changes:**
- Replace narrow `closest()` selector with comprehensive `INTERACTIVE_SELECTOR`
- Add check for `data-cmdrunner-handled` attribute (replaces individual checks)
- Preserve existing grid/download/drag checks as belt-and-suspenders
- Improve identity extraction for better locators

### Phase 3: Service-Worker Temporal Dedup

**Goal:** Add cross-action dedup in `processAction()` as a safety net.

**Files changed (1):**
- `service-worker.ts`

**Changes:**
- Track last action per element (elementId → {actionType, timestamp})
- When a generic `click` arrives, check if a different action type was recorded on the same element within 500ms
- If yes, skip the click

### Phase 4: Tests & Validation

**Goal:** Comprehensive tests for all new behavior.

**Files changed:**
- `tests/click-dedup.test.ts` (new)
- Update existing tests if any expectations change

### Phase 5: Build, Regression, Commit

- Full test suite must pass
- Build must succeed
- No regressions in any interaction type

---

## 6. Regression Impact

### Files That WILL Change

| File | Change | Risk |
|------|--------|------|
| `click-content-script.ts` | Normalization + handled check | Medium — core interaction |
| `service-worker.ts` | Temporal dedup | Low — additive safety net |
| `toggle-content-script.ts` | +1 line (setAttribute) | Very Low |
| `tree-view-content-script.ts` | +1 line (setAttribute) | Very Low |
| `rich-text-editor-content-script.ts` | +1 line (setAttribute) | Very Low |
| `modal-dialog-content-script.ts` | +1 line (setAttribute) | Very Low |
| `tabs-content-script.ts` | +1 line (setAttribute) | Very Low |
| `accordion-content-script.ts` | +1 line (setAttribute) | Very Low |
| `stepper-content-script.ts` | +1 line (setAttribute) | Very Low |
| `scheduler-content-script.ts` | +1 line (setAttribute) | Very Low |
| `tests/click-dedup.test.ts` | New test file | None |

### Files That WILL NOT Change

| File | Why Untouched |
|------|--------------|
| `interaction-types.ts` | Click registry config unchanged |
| `recording-session.ts` | Session logic unchanged |
| `step-builder.ts` | Step building unchanged |
| `ai-understanding.ts` | AI prompt unchanged |
| `types.ts` | Type definitions unchanged |
| `manifest.json` | No new content scripts |
| All form-control scripts (dropdown, checkbox, radio, date-picker, slider, multi-select, file-upload) | Use `change` events, not click events — no contention |
| `hover-content-script.ts` | Uses mouseover, not click — already has mousedown suppression |
| `scroll-content-script.ts` | No click involvement |
| `right-click-content-script.ts` | Separate event (contextmenu) |
| `double-click-content-script.ts` | Handled within click-content-script.ts |

### How Regressions Are Avoided

1. **Additive changes only** — the handled signal is additive. If an enterprise script doesn't set it, click still fires as before.
2. **Belt-and-suspenders** — even if the signal fails, the service-worker temporal dedup catches it.
3. **No pipeline changes** — registry, session, step-builder, AI, types all untouched.
4. **Existing test suite** — all 941 tests must pass unchanged.
5. **Each enterprise script change is 1 line** — minimal surface area for breakage.
