# Phase 1 — Click Architecture Review & Redesign

**Baseline:** v2.0.0-alpha (commit 4c6b0b8) — 15 core content scripts, 24 test files, 437 tests, zero enterprise code.

**Status:** DESIGN ONLY — no code changes, no implementation.

---

## 1. Complete Click Architecture Review

### End-to-End Flow (Browser Event → Stored Recording)

```
User clicks element
       │
       ▼ (capture phase — fires BEFORE app handlers)
┌─────────────────────────────────────────────────────────┐
│ click-content-script.ts (374 lines)                      │
│                                                          │
│ 1. Check event.button === 0 (left click only)            │
│ 2. Check isRecording flag (synced from chrome.storage)   │
│ 3. target = event.target (RAW — NO ancestor resolution)  │
│ 4. Double-click dedup check:                             │
│    a. If pendingClick exists AND elementsMatch()          │
│       → cancel pending, return (wait for dblclick)        │
│    b. If pendingClick on DIFFERENT element                │
│       → cancel it, start new pending                      │
│ 5. Store PendingClick {target, timer: 300ms}             │
│ 6. After 300ms timeout → emitClick(target)               │
│                                                          │
│ emitClick:                                                │
│   extractElementIdentityInline(target)                   │
│   → sends {type:'CLICK_CAPTURED', payload: identity}     │
│                                                          │
│ NO ancestor normalization                                 │
│ NO skip checks for other interaction types               │
│ NO confidence model                                       │
│ NO data-cmdrunner-handled signal                          │
└─────────────────────────────────────────────────────────┘
       │ chrome.runtime.sendMessage
       ▼
┌─────────────────────────────────────────────────────────┐
│ service-worker.ts → onMessage → CLICK_CAPTURED           │
│                                                          │
│ processAction(message.payload, 'click', tabId)           │
│                                                          │
│ 1. Look up registry config for 'click'                   │
│ 2. config.addToSession(session, identity) → session.addClick() │
│ 3. ScreenshotService.capture(tabId, actionId, ...)       │
│ 4. Build ActionElementInfo {actionType, text, tag, role} │
│ 5. AIService.understand(elementInfo)                     │
│    → on success: updateEventWithAI() → buildStep() → addStep() │
│    → on failure: markEventAIFailed() → buildStep() → addStep() │
│                                                          │
│ NO cross-action dedup                                    │
│ NO awareness of other actions on same element            │
│ NO temporal window check                                 │
└─────────────────────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────┐
│ recording-session.ts → addAction('click')                │
│                                                          │
│ 1. Generate actionId: click-NNNN (sequential)            │
│ 2. Generate elementId: elem-NNNN (sequential)            │
│ 3. Create ClickEvent {actionId, type, timestamp,          │
│    elementIdentity}                                      │
│ 4. Push to events array                                  │
│ 5. Persist to chrome.storage.local                       │
│                                                          │
│ NO dedup against recent events                           │
│ NO check for same-element prior actions                  │
└─────────────────────────────────────────────────────────┘
       │
       ▼ (async, after AI completes or fails)
┌─────────────────────────────────────────────────────────┐
│ step-builder.ts → buildStep(event, understanding)        │
│                                                          │
│ 1. generatePlainEnglish(identity, understanding, 'click')│
│    → clickConfig.toPlainEnglish()                        │
│    → 'Click the "displayName"'                           │
│    → or 'Click the "displayName" to {intent}' with AI    │
│ 2. buildExecutionJson(event)                             │
│    → buildLocators(identity): testId → dataCy → dataQa  │
│      → id → ariaLabel → name → css → xpath               │
│    → ExecutionJson {action:'click', primaryLocator, ...} │
│ 3. Return TestStep {stepId, plainEnglish, executionJson} │
└─────────────────────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────┐
│ storage-service.ts → persist TestStep                    │
│ timeline-renderer.ts → render in side panel              │
│   → badge: "CLICK" (#2563eb blue)                        │
│   → title: accessibleName || tag                         │
│   → identity chips: tag · role · id · testId · ...       │
│   → AI card: businessName, controlType, userIntent, %    │
└─────────────────────────────────────────────────────────┘
```

### Identity Engine (inlined in click-content-script.ts)

The element identity engine runs entirely inside the content script (isolated world, no imports). It produces a `RawElementIdentity` object with 16 fields.

| Field | Source | Quality |
|-------|--------|---------|
| `accessibleName` | `computeAccessibleName()`: aria-label → aria-labelledby → innerText → textContent → placeholder → value → title | Good — follows WAI-ARIA priority |
| `ariaRole` | Explicit `role` attr → `getImplicitRole(tag, el)` via lookup tables | Good — covers native + ARIA |
| `ariaLabel` | `el.getAttribute('aria-label')` | Direct read |
| `ariaLabelledBy` | `el.getAttribute('aria-labelledby')` | Direct read |
| `placeholder` | `el.getAttribute('placeholder')` | Direct read |
| `tag` | `el.tagName` (uppercase) | Direct read |
| `name` | `el.getAttribute('name')` | Direct read |
| `stableId` | `el.id` | **Unreliable** — React auto-generates IDs |
| `testId` | `data-testid` | Good — but only if present |
| `dataCy` | `data-cy` | Good — but only if present |
| `dataQa` | `data-qa` | Good — but only if present |
| `cssSelector` | `generateCssSelector()`: id → testId chain → tag:nth-of-type chain (max 5 levels) | **Fragile** for dynamic apps |
| `xPath` | `generateXPath()`: positional index chain (max 10 levels) | **Fragile** — breaks on re-order |
| `inIframe` | `window.self !== window.top` | Good |
| `shadowDom` | Walks `parentNode` checking for `ShadowRoot` | Good — but `closest()` can't cross boundary |
| `iframeContext` | `extractIframeContext()`: frameSrc, frameName, frameId, frameSelector, frameXPath, frameIndex, frameDepth | Good for same-origin; cross-origin returns minimal data |

### Locator Strategy (step-builder.ts buildLocators)

```
Priority Order:
1. testId    (data-testid)
2. testId    (data-cy — mislabeled as testId type)
3. testId    (data-qa — mislabeled as testId type)
4. id        (el.id — includes unstable React IDs)
5. ariaLabel (aria-label attribute)
6. name      (name attribute)
7. css       (generated CSS selector)
8. xpath     (generated XPath)
```

---

## 2. Weakness Analysis

### W1 — No Target Normalization (Critical)

**Problem:** Click uses `event.target` directly with zero ancestor resolution. When a user clicks a `<svg>` icon inside a `<button>`, the recorder captures the `<svg>`, not the `<button>`.

**Real-world examples:**
```
<button onclick="save()">
  <svg class="icon-save">…</svg>    ← event.target = <svg>
  <span>Save</span>                  ← accessibleName = ''
</button>

<a href="/products">
  <img src="logo.png" />             ← event.target = <img>
  Products                           ← accessibleName = '' (img has no text)
</a>

<div role="button" tabindex="0">
  <span class="label">Click Me</span> ← event.target = <span>
</div>
```

**Impact:**
- Wrong `tag` recorded (`svg` instead of `button`)
- Wrong `accessibleName` (empty string — SVG has no text content)
- Wrong `cssSelector` (targets the icon, not the button)
- Wrong `xpath` (positional path to the icon)
- Wrong Plain English ("Click the SVG" instead of "Click the Save button")
- Fragile locators — the icon can be re-rendered without the button changing

**Severity: Critical** — affects every click on any element with nested children, which is the majority of real-world clicks.

### W2 — Unstable ID in Locator Priority (High)

**Problem:** `generateCssSelector()` returns `#id` whenever `el.id` is present, and `buildLocators()` puts `id` at priority 4. But React, Angular, and Vue auto-generate IDs that change between page loads:

```
React:    id="react-aria-9-1"     ← changes on every render
Angular:  id="mat-input-3"        ← changes based on component count
Vue:      id="input-abc123"       ← random per build
```

The recorder treats these as stable and makes them the primary locator. On replay, the locator fails.

**Impact:** Locators that work during recording but fail during playback.

**Severity: High** — directly undermines execution reliability.

### W3 — No Ownership/Coordination Mechanism (High — Forward-Looking)

**Problem:** On the clean baseline there are no enterprise scripts, so no contention exists today. But the architecture provides no mechanism for when enterprise interactions are reintroduced. Click-content-script has:
- No `data-cmdrunner-handled` check
- No skip conditions whatsoever
- No way for another script to say "I claimed this click"

When enterprise scripts return, the exact same double-emission problem from v1.x will recur.

**Impact:** Without a coordination mechanism built into Click now, every future enterprise interaction will require retrofitting.

**Severity: High** — architectural debt that will compound.

### W4 — `elementsMatch()` Too Broad (Medium)

**Problem:** Double-click dedup uses:
```typescript
function elementsMatch(a: Element, b: Element): boolean {
  return a === b || a.contains(b) || b.contains(a);
}
```

This means clicking a `<span>` inside a `<button>`, then clicking the `<button>` itself within 300ms, would be treated as a double-click and suppressed. But these are two different single clicks.

**Scenario:**
1. User clicks the icon inside a tab → pending click on `<svg>`
2. User clicks the tab label text → `elementsMatch(svg, span)` → svg.contains(span)? No. span.contains(svg)? No. → Actually different elements.

Wait — in the current implementation, if they're NOT ancestor/descendant, it's fine. But if the user clicks a button, then clicks a child of the SAME button within 300ms (e.g., the button has two icons), the second click is wrongly suppressed.

**Impact:** Rare but real — missed single clicks when a user clicks different children of the same container in quick succession.

**Severity: Medium** — edge case, but the logic is fundamentally wrong.

### W5 — `generateCssSelector()` Quality Issues (Medium)

**Problems:**
1. **Uses `nth-of-type` which is fragile.** If list order changes (filtering, sorting, dynamic insertion), the selector breaks.
2. **MAX_DEPTH = 5 is too shallow for deeply nested components.** Many React components are 8-10 levels deep.
3. **No text-based fallback.** A selector like `button:has-text("Save")` is more resilient than `div > div > button:nth-of-type(2)` but is not generated.
4. **No use of role or aria attributes in CSS selector.** `[role="button"]` is more stable than `div:nth-of-type(3)`.

**Impact:** Locators that work today but break when the page layout changes.

**Severity: Medium** — degrades over time as apps evolve.

### W6 — Shadow DOM Boundary Limitation (Medium)

**Problem:** `isInShadowDom()` correctly detects shadow DOM, but `closest()` (which would be used for ancestor resolution in W1's fix) cannot cross shadow boundaries. If a click target is inside a Shadow DOM, ancestor resolution stops at the shadow root.

**Scenario:** A web component with a shadow DOM containing a `<button>`:
```
<my-widget>                        ← light DOM
  #shadow-root                     ← shadow boundary
    <button id="inner">Click</button>  ← event.target
```

`button.closest('my-widget')` returns null because `closest()` doesn't cross shadow boundaries. The recorder can't connect the click to its containing web component.

**Impact:** Incomplete ancestor resolution for web components (used by many enterprise frameworks).

**Severity: Medium** — affects Shadow DOM components (Material Web Components, Lit elements, Salesforce Lightning Web Components).

### W7 — Cross-Origin iframe Detection is Minimal (Low)

**Problem:** `extractIframeContext()` returns only `{frameSrc}` for cross-origin iframes. `frameElement` is null for cross-origin, so `frameId`, `frameName`, `frameSelector`, `frameXPath`, and `frameIndex` are all null. This means the execution engine has no way to locate the iframe element in the parent document.

**Impact:** Clicks inside cross-origin iframes (ads, third-party widgets, embedded content) can be detected but not replayed.

**Severity: Low** — cross-origin iframes are uncommon in enterprise testing scenarios.

### W8 — No Text-Based Locator (Low — Strategic Gap)

**Problem:** The locator hierarchy has no text-based locator type. The `LocatorType` union includes `'text'` but `buildLocators()` never generates one. A text locator (`button:has-text("Save")` or `getByText("Save")`) is one of the most resilient strategies for modern testing frameworks (Playwright, Cypress, Testing Library).

**Impact:** Missing a high-quality locator strategy that experienced testers prefer.

**Severity: Low** on the clean baseline (additive improvement), but **High** strategically for execution reliability.

### W9 — 300ms Double-Click Delay Adds Latency (Low)

**Problem:** Every single click is delayed 300ms before emission. For rapid interaction sequences, this means:
- 10 clicks = 3 seconds of latency in the recording pipeline
- If the page navigates before 300ms, the click is lost
- The pending click timer can fire after the recording stops

**Impact:** Minor latency, rare lost clicks on fast SPA navigations.

**Severity: Low** — acceptable tradeoff for double-click detection, but could be improved.

### W10 — Accessible Name Computation Gaps (Low)

**Problems:**
1. `aria-labelledby` only resolves a single ID. The spec allows space-separated IDs (`aria-labelledby="label1 label2"`). Current code does `document.getElementById(labelledBy.trim())` which fails for multi-ID.
2. `innerText` is used before `textContent`, which is correct (innerText respects CSS visibility), but `innerText` is expensive on large DOMs and can be null in some browsers during certain lifecycle phases.
3. No `<label>` element association for form controls. `<label for="email">Email</label><input id="email">` — the input's accessible name should be "Email" but `computeAccessibleName()` doesn't check `<label>` associations.
4. No `<figcaption>`, `<figcaption>` or `<alt>` text fallback for images.
5. Truncation at 200 chars is aggressive — some accessible names are legitimately longer.

**Impact:** Missing or incorrect accessible names for label-associated inputs, multi-ID labelledby, and images.

**Severity: Low** — degrades Plain English quality but doesn't break functionality.

---

## 3. Proposed Click Design

### Core Principle

**Click is the canonical interaction. Every pointer interaction starts as a Click. Ownership transfers to a specialized type only when that type presents very high confidence evidence. Otherwise, Click owns it.**

### Redesigned Click Content Script Flow

```
User clicks element
       │
       ▼ (capture phase)
┌─────────────────────────────────────────────────────────┐
│ Step 1: Guard Checks                                     │
│   - event.button !== 0 → return                          │
│   - !isRecording → return                                │
│   - !event.isTrusted → return (ignore synthetic clicks)  │
└─────────────────────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────┐
│ Step 2: Target Normalization                             │
│   resolveClickTarget(event.target)                       │
│   → walk up from event.target to find the element the    │
│     user INTENDED to click                               │
│   → comprehensive interactive selector                   │
│   → cross shadow boundary if needed                      │
│   → returns the resolved Element                         │
└─────────────────────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────┐
│ Step 3: Ownership Check (forward-looking)                │
│   if resolvedTarget.closest('[data-cmdrunner-handled]')  │
│   → another script claimed this click → return           │
│                                                          │
│   (On clean baseline this always passes — no enterprise  │
│    scripts. But the mechanism is in place for when they  │
│    return.)                                              │
└─────────────────────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────┐
│ Step 4: Double-Click Dedup (same element only)           │
│   if pendingClick exists                                 │
│   && pendingClick.target === resolvedTarget              │
│   → cancel pending, wait for dblclick                    │
│                                                          │
│   NOTE: EXACT match only. No ancestor/descendant match.  │
└─────────────────────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────┐
│ Step 5: Emit (after 300ms timeout)                       │
│   extractElementIdentity(resolvedTarget)                 │
│   → send CLICK_CAPTURED message                          │
└─────────────────────────────────────────────────────────┘
```

### Key Improvements Over Current

| Area | Current | Proposed |
|------|---------|----------|
| Target resolution | Raw `event.target` | `resolveClickTarget()` — walks ancestors via comprehensive selector |
| Double-click match | `a===b \|\| a.contains(b) \|\| b.contains(a)` | `a === b` (exact only) |
| Ownership | None | `data-cmdrunner-handled` attribute check |
| Synthetic click | Ignored | `event.isTrusted` guard |
| Shadow DOM | Detected but not crossed | `composedPath()` for ancestor traversal |
| ID stability | Any `el.id` treated as stable | Filter out generated IDs (heuristic) |

---

## 4. Ownership Model

### Philosophy

```
                    ┌─────────────────────┐
                    │   Click is DEFAULT  │
                    │   owner of ALL      │
                    │   pointer events    │
                    └─────────┬───────────┘
                              │
              Does another interaction have
              VERY HIGH CONFIDENCE this is theirs?
                     │           │
                    YES          NO
                     │           │
                     ▼           ▼
          ┌──────────────┐  ┌──────────────┐
          │ Ownership    │  │ Click stays  │
          │ TRANSFERS to │  │ the owner.   │
          │ specialist   │  │ Generic click│
          │              │  │ recorded.    │
          └──────────────┘  └──────────────┘
```

### When Click Owns (default — the vast majority of cases)

- Plain `<button>`, `<a>`, `<input type="button">` without enterprise markers
- `<div>` or `<span>` with `onclick` handler
- Any element with `tabindex` that responds to click
- SVG icons, images, nested spans inside interactive elements (after normalization)
- Elements inside enterprise containers where the enterprise script did NOT set a handled signal
- Form submit buttons
- Icon-only buttons
- Card clicks, list item clicks

### When Click Remains the Owner (refuses to yield)

- Enterprise script fires but confidence is ambiguous → Click wins
- Element matches a broad enterprise selector (e.g., inside a `<div class="tab-container">`) but has no structural ARIA evidence of being that component type
- Element is inside a grid but the grid script didn't claim it
- Multiple enterprise scripts could potentially claim the same click → Click wins (no split decisions)

### When Another Interaction May Take Ownership

Only when ALL of these conditions are met:
1. The specialized script sets `data-cmdrunner-handled="<type>"` on the clicked element (synchronous, during capture phase)
2. The element has structural evidence of being that component (semantic ARIA role, framework-specific class, or explicit data attribute)
3. The specialized action was recorded within the same event loop tick (no async delay)

### Confidence Threshold

**The confidence model is binary at the content-script layer and probabilistic at the AI layer:**

**Content Script Layer (synchronous):**
- An interaction either sets `data-cmdrunner-handled` (high confidence) or doesn't (zero confidence). There is no medium-confidence claiming.
- This is deliberate: medium-confidence claims create more false positives than false negatives they prevent.

**AI Layer (asynchronous, post-capture):**
- The AI understanding pipeline receives the action AFTER it's already recorded as whatever type claimed it.
- The AI can downgrade confidence (`confidenceScore < 0.5`), which flags the step for review but does NOT re-classify it.
- The AI CANNOT upgrade a click to a specialized type — that decision was made at capture time.

### Ownership Priority Order (when enterprise scripts return)

```
1. Form Controls (change-event based)
   checkbox, radio, dropdown, date_picker, slider, multi_select, file_upload
   → These use 'change'/'input' events, NOT click events. No contention.

2. Drag & Drop (mousedown/dragstart based)
   → Signals via data-cmdrunner-drag-active attribute
   → Click checks this BEFORE emitting

3. File Download (click + chrome.downloads)
   → Signals via data-cmdrunner-download-pending attribute
   → Click checks this BEFORE emitting

4. Enterprise Click-Based (capture-phase click)
   toggle, tree_view, tabs, accordion, modal_dialog, stepper, scheduler,
   rich_text_editor, grid
   → MUST set data-cmdrunner-handled="<type>" synchronously
   → Click checks this BEFORE its 300ms timer expires

5. Click (default fallback)
   → Owns everything not claimed above
```

### Rules Summary

| # | Rule | Owner | Signal |
|---|------|-------|--------|
| 1 | No enterprise script claims the click | `click` | Absence of `data-cmdrunner-handled` |
| 2 | Enterprise script sets handled signal | Enterprise type | `data-cmdrunner-handled="<type>"` present |
| 3 | Drag in progress | `drag_drop` | `data-cmdrunner-drag-active` present |
| 4 | Download pending | `file_download` | `data-cmdrunner-download-pending` present |
| 5 | Native form control fires change event | Form type | Uses `change`/`input` event — no click contention |
| 6 | Timing conflict (temporal dedup) | First action wins | Same element + different type within 500ms |

---

## 5. Target Resolution Strategy

### Problem Statement

When a user clicks, the browser sets `event.target` to the deepest element under the cursor. This is frequently a child of the element the user intended to interact with:

```
User intends to click the SAVE BUTTON:
┌─────────────────────────────────────┐
│  [icon]  Save                       │  ← <button> (intended target)
│   ↑ <svg>                           │  ← event.target (actual)
└─────────────────────────────────────┘
```

### Resolution Algorithm

```typescript
function resolveClickTarget(rawTarget: Element): Element {
  // 1. Use composedPath for shadow DOM support
  const path = event.composedPath();
  // composedPath() returns [target, ...ancestors, ..., document, window]
  // and crosses shadow boundaries

  // 2. Walk the composed path to find the first interactive element
  for (const node of path) {
    if (!(node instanceof Element)) continue;
    if (isInteractiveElement(node)) return node;
  }

  // 3. Fallback: use the raw target (better than nothing)
  return rawTarget;
}

function isInteractiveElement(el: Element): boolean {
  return el.matches(INTERACTIVE_SELECTOR);
}
```

### Interactive Selector (comprehensive)

```typescript
const INTERACTIVE_SELECTOR = [
  // ── Native semantic tags ──
  'a[href]',                    // links with href
  'button',                     // buttons
  'summary',                    // disclosure summary (details/summary)
  'select',                     // dropdown selects
  'option',                     // select options
  'textarea',                   // text areas (click to focus)
  'input[type="button"]',
  'input[type="submit"]',
  'input[type="reset"]',
  'input[type="image"]',
  'input[type="checkbox"]',
  'input[type="radio"]',

  // ── ARIA roles (interactive) ──
  '[role="button"]',
  '[role="link"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]',
  '[role="option"]',
  '[role="switch"]',
  '[role="treeitem"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="gridcell"]',

  // ── Explicit interactivity signals ──
  '[tabindex]',                 // any element made focusable
  '[onclick]',                  // elements with click handlers
  '[data-action]',              // common data attribute pattern
  '[data-toggle]',              // Bootstrap-style toggle
  '[data-bs-toggle]',           // Bootstrap 5
].join(', ');
```

### What NOT to Match

The selector deliberately EXCLUDES:
- `[contenteditable]` — handled by text-entry content script, not click
- Bare `<input>` without type — defaults to text, handled by text-entry
- `<label>` — clicking a label delegates to its associated control; the control's own event fires
- Generic `<div>`, `<span>` without interactivity signals — too broad, would capture layout containers

### Resolution Examples

| Click Target | Walks Up To | Correct? |
|-------------|-------------|----------|
| `<svg>` inside `<button>` | `<button>` | ✅ |
| `<span>` inside `<button>` | `<button>` | ✅ |
| `<img>` inside `<a href>` | `<a href>` | ✅ |
| `<path>` inside `<svg>` inside `<button>` | `<button>` | ✅ |
| `<span>` inside `<div role="button">` | `<div role="button">` | ✅ |
| `<td>` inside grid (no enterprise script) | `<td>` (not interactive) → walks to `[role="gridcell"]` or raw | Depends on structure |
| `<span>` inside `<li>` in a `<ul>` (plain list) | No interactive ancestor → raw `<span>` | Correct — list items aren't inherently interactive |
| Shadow DOM `<button>` inside `<my-widget>` | `<button>` (via `composedPath()`) | ✅ crosses shadow boundary |

### Edge Case: Click on Label

```html
<label for="email">Email Address</label>
<input type="text" id="email" />
```

Clicking the `<label>` fires a click on the `<input>` natively. The `<input>` click event fires AFTER the label click. The label is NOT in the interactive selector, so `resolveClickTarget()` walks past it. The subsequent synthetic click on the input fires `isTrusted: false` — caught by the `isTrusted` guard. Result: the label click is captured as a click on the label element (which has text "Email Address"), and the synthetic input click is suppressed.

**This is correct behavior** — the user clicked the label, and the label is what should be recorded.

### Edge Case: Pseudo-Elements

`::before` and `::after` pseudo-elements are not in the DOM tree. Clicks on them resolve to the host element. No special handling needed — `event.target` is already the host element.

### Edge Case: Dynamic DOM / Virtual DOM

React/Angular/Vue re-render elements on state change. After re-render, the DOM node identity changes even though the visual element is the same. The 300ms click delay means the resolved target might be detached from the DOM by the time `emitClick` fires.

**Mitigation:** Extract identity immediately at resolution time (not at emit time). Store the `RawElementIdentity` in `PendingClick`, not the `Element` reference.

---

## 6. Locator Strategy

### Current Priority (step-builder.ts)

```
1. testId (data-testid)     ← good
2. testId (data-cy)         ← mislabeled type
3. testId (data-qa)         ← mislabeled type
4. id                       ← DANGEROUS (unstable generated IDs)
5. ariaLabel                ← good
6. name                     ← good for form controls
7. css                      ← fragile for dynamic apps
8. xpath                    ← last resort
```

### Recommended Priority

```
1. testId     (data-testid)     — explicit test intent, most stable
2. dataCy     (data-cy)         — Cypress convention, explicit test intent
3. dataQa     (data-qa)         — QA convention, explicit test intent
4. role+name  (role="button", accessible-name="Save") — semantic, resilient
5. ariaLabel  (aria-label)      — good for icon buttons, icon-only controls
6. text       (visible text)    — "Save", "Cancel", resilient to layout changes
7. name       (form name attr)  — good for form controls, stable across renders
8. css        (semantic CSS)    — [role="button"].save-action, NOT nth-of-type
9. id         (el.id)           — ONLY if not auto-generated (heuristic filter)
10. xpath     (absolute)        — last resort, fragile
```

### Key Changes

**Change 1: Separate type for data-cy and data-qa**

Currently `data-cy` and `data-qa` are labeled as `type: 'testId'`. They should have their own types:
```typescript
type LocatorType = 'css' | 'xpath' | 'testId' | 'dataCy' | 'dataQa' | 'id' | 'ariaLabel' | 'role' | 'text' | 'name';
```

This lets the execution engine use the correct query strategy.

**Change 2: ID stability heuristic**

Before using `el.id` as a locator, filter out auto-generated IDs:

```typescript
function isStableId(id: string): boolean {
  // Reject common auto-generated ID patterns
  const unstablePatterns = [
    /^react-/,           // React: react-aria-9-1
    /^react$/,           // React (legacy)
    /^aria-/,            // React Aria
    /^\$/,               // Svelte: $-123
    /^:r/,               // React 18 useId: :r1:, :r2:
    /^__/,               // Vue internal
    /^vue/,              // Vue scoped
    /^ember/,            // Ember
    /^\d+$/,             // Pure numeric
    /^[a-z0-9]{8}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{12}$/i, // UUID
    /^mat-/,             // Angular Material auto
    /^cdk-/,             // Angular CDK auto
    /^headlessui/,       // Headless UI auto
    /^radix-/,           // Radix UI auto
    /^floating/,         // Floating UI auto
  ];
  return !unstablePatterns.some(p => p.test(id));
}
```

**Change 3: Role + Name locator**

A locator that combines the semantic role with the accessible name:
```typescript
{ type: 'role', value: 'button', name: 'Save' }
// Execution translates to: getByRole('button', { name: 'Save' })
```

This is the most resilient locator for modern testing frameworks (Playwright, Testing Library). It survives DOM restructuring as long as the role and visible name remain.

**Change 4: Text locator**

```typescript
{ type: 'text', value: 'Save' }
// Execution translates to: getByText('Save') or :has-text('Save')
```

Less precise than role+name but more resilient than CSS.

**Change 5: Semantic CSS selector**

When generating CSS selectors, prefer stable attributes:
```
[role="button"].save-action          ← good
[data-testid="save-btn"]             ← best (already covered by testId)
button.primary                       ← good (class-based)
div > div > button:nth-of-type(2)    ← bad (structural, fragile)
```

---

## 7. Implementation Plan

### Phase 1A: Target Resolution (click-content-script.ts only)

**Goal:** Implement `resolveClickTarget()` with comprehensive interactive selector and `composedPath()` for shadow DOM.

**Changes:**
- Add `INTERACTIVE_SELECTOR` constant
- Add `resolveClickTarget(rawTarget: Element, event: Event): Element`
- Add `isInteractiveElement(el: Element): boolean`
- Replace `const target = event.target` with `const target = resolveClickTarget(event.target as Element, event)`
- Store `RawElementIdentity` in `PendingClick` instead of `Element` (DOM detachment safety)

**Files:** `click-content-script.ts` only

**Tests:** New test file `tests/click-target-resolution.test.ts`
- SVG inside button → resolves to button
- Span inside button → resolves to button
- Image inside link → resolves to link
- Span inside div[role=button] → resolves to div
- Click directly on button → stays button
- Shadow DOM button → crosses boundary
- Non-interactive nested divs → returns raw target

### Phase 1B: Ownership Mechanism (click-content-script.ts only)

**Goal:** Add `data-cmdrunner-handled` check. No enterprise scripts exist yet, but the mechanism is ready.

**Changes:**
- Add check: `if (resolvedTarget.closest('[data-cmdrunner-handled]')) return;`
- Place AFTER target resolution, BEFORE double-click dedup

**Files:** `click-content-script.ts` only

**Tests:** Test that a synthetic `data-cmdrunner-handled` attribute suppresses click emission.

### Phase 1C: Double-Click Dedup Fix (click-content-script.ts only)

**Goal:** Change `elementsMatch()` to exact match only.

**Changes:**
- Replace `elementsMatch(a, b)` with `a === b` (or compare elementId/identity if element references are stored)

**Files:** `click-content-script.ts` only

**Tests:** Two different children of same parent clicked in succession → both recorded (not suppressed as double-click).

### Phase 1D: Synthetic Click Guard (click-content-script.ts only)

**Goal:** Ignore programmatic `event.click()` calls.

**Changes:**
- Add `if (!event.isTrusted) return;` at the top of the click handler

**Files:** `click-content-script.ts only`

**Tests:** Synthetic click (`el.click()`) → not recorded.

### Phase 1E: Accessible Name Improvements (click-content-script.ts only)

**Goal:** Improve `computeAccessibleName()`.

**Changes:**
- Multi-ID `aria-labelledby` (space-separated IDs)
- `<label for="id">` association for form controls
- `<img alt="">` and `<area alt="">` fallback
- `<figcaption>` fallback

**Files:** `click-content-script.ts only`

**Tests:** Label-associated input, multi-ID labelledby, alt text fallback.

### Phase 1F: ID Stability Filter (click-content-script.ts only)

**Goal:** Don't use auto-generated IDs in locators.

**Changes:**
- Add `isStableId(id: string): boolean`
- In `generateCssSelector()`, only use `id` if `isStableId(id)` returns true
- In `extractElementIdentityInline()`, set `stableId` to null if ID fails heuristic

**Files:** `click-content-script.ts only`

**Tests:** React-style ID (`:r1:`, `react-aria-9-1`) → not used as locator.

### Phase 1G: Locator Strategy Update (step-builder.ts)

**Goal:** Implement the improved locator priority order.

**Changes:**
- Add `dataCy` and `dataQa` as distinct locator types (not mislabeled as testId)
- Add `role` locator type (role + accessible name)
- Add `text` locator type (visible text content)
- Move `id` below CSS in priority, only use if `isStableId()` passes
- Update `LocatorType` in types.ts
- Update `buildLocators()` in step-builder.ts

**Files:** `step-builder.ts`, `types.ts`

**Tests:** Updated locator tests, role+name generation, text locator generation.

### Phase 1H: Temporal Dedup Safety Net (service-worker.ts)

**Goal:** Cross-action dedup as belt-and-suspenders.

**Changes:**
- Track `Map<elementId, {actionType, timestamp}>` in processAction scope
- When a `click` arrives, check if a different action type was recorded on the same element within 500ms
- If yes, skip the click

**Files:** `service-worker.ts only`

**Tests:** Tab event + click on same element within 500ms → click suppressed.

### Phase Summary

| Phase | Files Changed | Risk | Dependency |
|-------|---------------|------|------------|
| 1A | click-content-script.ts | Medium | None |
| 1B | click-content-script.ts | Very Low | None |
| 1C | click-content-script.ts | Low | None |
| 1D | click-content-script.ts | Very Low | None |
| 1E | click-content-script.ts | Low | None |
| 1F | click-content-script.ts | Low | None |
| 1G | step-builder.ts, types.ts | Medium | None |
| 1H | service-worker.ts | Low | None |

**Phases 1A–1F are all in click-content-script.ts and can be done in a single commit.** Phase 1G touches the pipeline (types + step-builder). Phase 1H touches the service worker. Each phase is independently testable.

### Recommended Implementation Order

1. **1A + 1B + 1C + 1D + 1E + 1F together** — all click-content-script.ts changes in one pass. This is the core of the Click redesign.
2. **1G** — locator strategy update (pipeline change, needs careful regression).
3. **1H** — temporal dedup (additive safety net, lowest risk).

---

## Framework Compatibility Assessment

| Framework | Target Resolution | Locator Quality | Shadow DOM | Notes |
|-----------|------------------|-----------------|------------|-------|
| **Native HTML** | ✅ Full | ✅ Good | N/A | Standard tags, semantic roles |
| **React** | ✅ Full | ⚠️ ID filtering needed | ⚠️ Rare | Auto-generated IDs (`:r1:`) must be filtered |
| **Angular** | ✅ Full | ⚠️ ID filtering needed | ⚠️ Rare | Material uses `mat-*` IDs, ViewEncapsulation can use shadow DOM |
| **Vue** | ✅ Full | ✅ Good | ⚠️ Rare | Scoped IDs prefixed with `data-v-` |
| **Svelte** | ✅ Full | ✅ Good | ⚠️ Rare | Web component mode uses shadow DOM |
| **Shadow DOM** | ✅ With `composedPath()` | ✅ | ✅ Core feature | `closest()` can't cross, but `composedPath()` can |
| **Nested Shadow** | ✅ With `composedPath()` | ✅ | ✅ | `composedPath()` traverses all shadow roots |
| **iframes (same-origin)** | ✅ Full | ✅ Good | N/A | `frameElement` accessible, full context |
| **iframes (cross-origin)** | ⚠️ Minimal | ⚠️ Minimal | N/A | Only `frameSrc` available |
| **SVG icons** | ✅ Resolves to parent | ✅ | N/A | Walks up to `<button>` or `<a>` |
| **Nested spans** | ✅ Resolves to parent | ✅ | N/A | Walks up to interactive ancestor |
| **Images in buttons** | ✅ Resolves to button | ✅ | N/A | Walks up to `<button>` |
| **Pseudo-elements** | ✅ Host element | ✅ | N/A | Browser sets target to host |
| **Dynamic DOM** | ⚠️ Store identity early | ✅ | N/A | Extract identity at resolution time, not at emit time |
| **Virtual DOM** | ⚠️ Store identity early | ✅ | N/A | Same as dynamic DOM |
