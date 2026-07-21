# Milestone 2 — Click Interaction Architecture & Technical Design

**Status:** DESIGN ONLY — no implementation, no code.

**Product Spec:** `.drytis/specs/milestone1-click-product-spec.md`
**Session Lifecycle:** `.drytis/specs/milestone0-recording-session-lifecycle.md`

---

## Architectural Principles

1. **Product drives architecture** — every technical decision traces back to the product spec.
2. **Click is the canonical interaction** — it is the default owner, the pipeline template, and the foundation for all future types.
3. **Classification is the bridge** — raw browser events exist upstream; interactions exist downstream. The classification step is where one becomes the other.
4. **Only detection logic changes per interaction type** — everything else in the pipeline is identical.
5. **Capture identity early, process later** — the element's identity must be extracted at the moment of the click, before virtual DOM frameworks can re-render or detach the node.
6. **Classified identity is immutable** — once a Click has been classified, its identity becomes immutable. Later DOM updates, re-renders, or framework reconciliation must never change what the user clicked. The interaction is a snapshot of intent at a moment in time.
7. **Record only interactions that actually occur** — the recorder records what genuinely happened. If a disabled button produces no click event, there is nothing to record. The recorder does not suppress real interactions; it simply does not invent ones that didn't fire.
8. **Confident classification or nothing** — every interaction must answer one question: *"Can I confidently classify the user's intent?"* If the answer is no, the recorder records nothing. This principle eliminates false positives across the entire recorder. Uncertainty is never an interaction.
9. **Single responsibility** — every interaction should have exactly one responsibility. The Click interaction answers only one question: *"Did the user intentionally perform a Click?"* It does not attempt to infer navigation, dropdown opening, modal opening, tab switching, accordion expansion, checkbox selection, radio selection, file upload, or hover behavior. Those belong to their own interaction types. If another interaction provides a better representation of the user's intent, that interaction should own it. This keeps every interaction small, predictable, and easy to validate.

**Approved and frozen.** No further architectural, design, or product changes. The architecture implements the product contract from Milestone 1. From this point forward, implementation is a purely engineering exercise.

---

## Click Decision Tree

Every Click passes through this decision tree. Each node is a behavioral question — not an implementation detail. If any node answers NO, the click is silently dropped. The tree exists to ensure that only confident, genuine classifications become interactions.

```
User clicks element
       │
       ▼
  ┌────────────────────────────┐     NO     ┌─────────────┐
  │ Is it a genuine user       │ ─────────→ │   DISCARD   │
  │ interaction?               │            │ (synthetic) │
  │ (event.isTrusted === true) │            └─────────────┘
  └──────────────┬─────────────┘
       │ YES
       ▼
  ┌────────────────────────────┐     NO     ┌─────────────┐
  │ Does another interaction   │ ─────────→ │   DISCARD   │
  │ own it?                    │            │ (owned by   │
  │ (data-cmdrunner-handled)   │            │  another)   │
  └──────────────┬─────────────┘            └─────────────┘
       │ NO (Click owns it)
       ▼
  ┌────────────────────────────┐     NO     ┌─────────────┐
  │ Can the target be          │ ─────────→ │   DISCARD   │
  │ resolved?                  │            │ (no target) │
  │ (composedPath finds an     │            └─────────────┘
  │  interactive element)      │
  └──────────────┬─────────────┘
       │ YES
       ▼
  ┌────────────────────────────┐     NO     ┌─────────────┐
  │ Can the interaction be     │ ─────────→ │   DISCARD   │
  │ confidently classified     │            │ (unclassif. │
  │ as a Click?                │            │  or dedup)  │
  │ (not a double-click,       │            └─────────────┘
  │  identity extractable)     │
  └──────────────┬─────────────┘
       │ YES
       ▼
  ┌────────────────────────────┐
  │   ★ RECORD CLICK ★         │
  │   Classify → Extract       │
  │   Identity → Send through  │
  │   pipeline                 │
  └────────────────────────────┘
```

### Decision Tree as Rules

1. **Is it genuine?** — `event.isTrusted === true`. No programmatic `.click()`, no synthetic events from frameworks, no test automation. If not genuine → DISCARD.
2. **Does another interaction own it?** — Check `data-cmdrunner-handled`. If another content script claimed this element → DISCARD (Click defers).
3. **Can the target be resolved?** — Walk `composedPath()` to find the interactive element the user intended. If no element resolves → DISCARD.
4. **Can it be confidently classified?** — Is it a single click (not part of a double-click)? Can identity be extracted? If NO to either → DISCARD.
5. **RECORD** — The click is now an interaction. Identity is extracted, message is sent, pipeline takes over.

**This decision tree is the architectural expression of Principle 8.** Every interaction type in the future will have its own decision tree following the same pattern — the questions change, but the structure is identical: genuine → owned → resolvable → classifiable → record.

---

## 1. Detection Strategy

### What Signals to Observe

The content script listens to the `click` event on `document` in the **capture phase** (fires before application handlers — no interference risk).

**One event, one signal.** The recorder does not listen to `mousedown`, `mouseup`, `pointerdown`, or `pointerup` for Click detection. The `click` event is the browser's own synthesis of "the user pressed and released on the same element" — it is exactly the semantic signal we want.

Listening to lower-level events and reconstructing a click from them would violate the core principle: *capture user intent, not browser events.* The `click` event IS the intent.

### What the Click Handler Checks

In order, at the moment a `click` event fires:

| Check | Purpose | Rejected If |
|-------|---------|-------------|
| `event.isTrusted` | Only genuine user clicks | Synthetic/programmatic `.click()` |
| `event.button === 0` | Left button only | Right-click, middle-click |
| Recording is active | Session must be recording | Extension idle or stopped |
| `event.target` exists | Sanity check | Null target (edge case) |

If all four checks pass, the event proceeds to **target resolution**.

### Double-Click Detection

The recorder must suppress duplicate Click interactions originating from the same user action.

**Behavioral requirement:**

1. When a click occurs, the recorder holds the interaction briefly before committing it.
2. If a second click arrives on the **same resolved target** within this window, the first click is suppressed — the user is performing a double-click, which is a different interaction.
3. If the holding window expires with no second click, the click interaction is committed.
4. A `dblclick` event handler emits a Double-Click interaction (future interaction type).

**Key design decision: identity stored, not Element reference.** Virtual DOM frameworks may destroy and recreate the DOM node between the click and commit. Storing the identity instead of the `Element` reference is safe against detachment.

**The holding window duration is an implementation detail** — it should be short enough to feel instant and long enough to distinguish single from double clicks. The exact value is decided during implementation, not architecture.

### What Is NOT Detected

- `mousedown` / `mouseup` — too low-level, not intent
- `pointerdown` / `pointerup` — redundant with `click`
- `touchstart` / `touchend` — click event fires after touch sequence; no need to handle separately
- `contextmenu` — handled by the future Right-Click interaction, not Click
- Focus / blur events — implementation detail, not user intent

---

## 2. Interaction Pipeline

### Complete Click Pipeline

```
USER CLICKS ELEMENT
       │
       ▼
┌──────────────────────────────────────────┐
│ 1. DETECTION                              │
│    Content script: click event listener   │
│    (capture phase)                        │
│    Checks: isTrusted, button, recording   │
└──────────────────┬───────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────┐
│ 2. TARGET RESOLUTION                      │
│    resolveClickTarget(event)              │
│    Walk composedPath() to find the        │
│    interactive element the user           │
│    intended to click                      │
└──────────────────┬───────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────┐
│ 3. OWNERSHIP CHECK                        │
│    Check data-cmdrunner-handled           │
│    attribute on resolved target           │
│    If present → another interaction       │
│    claimed this → Click exits             │
└──────────────────┬───────────────────────┘
                   │ (Click owns it)
                   ▼
┌──────────────────────────────────────────┐
│ 4. VALIDATION                             │
│    - Is it a single click (not dblclick)? │
│    - Is it genuine (isTrusted)?           │
│    If invalid → Click exits silently      │
└──────────────────┬───────────────────────┘
                   │ (valid click)
                   ▼
┌──────────────────────────────────────────┐
│ 5. DOUBLE-CLICK DEDUP                     │
│    Same resolved target within            │
│    holding window?                        │
│    → cancel pending, wait for dblclick    │
│    Different element?                     │
│    → flush pending immediately             │
│    Window expires → proceed               │
└──────────────────┬───────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────┐
│ 6. IDENTITY EXTRACTION                    │
│    Extract full RawElementIdentity        │
│    at this moment (before DOM can         │
│    re-render)                             │
│    - Accessible name (9-level priority)   │
│    - Role, tag, attributes                │
│    - CSS selector, XPath                  │
│    - Shadow DOM detection                 │
│    - Iframe context                       │
└──────────────────┬───────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────┐
│ 7. CLASSIFICATION                         │
│    ★ This is where the click BECOMES      │
│      an interaction.                      │
│    Message: CLICK_CAPTURED + identity     │
│    Sent to background service worker      │
│    Until this message is sent, there is   │
│    NO interaction.                        │
└──────────────────┬───────────────────────┘
                   │ chrome.runtime.sendMessage
                   ▼
┌──────────────────────────────────────────┐
│ 8. SESSION STORAGE (Background SW)        │
│    Service worker receives CLICK_CAPTURED │
│    processAction(identity, 'click', tabId)│
│    → session.addAction(identity, 'click', │
│       'click')                            │
│    → event persisted to storage           │
│    → screenshot captured (fire-and-forget)│
└──────────────────┬───────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────┐
│ 9. AI UNDERSTANDING (Background SW)       │
│    Build ActionElementInfo                │
│    → AIService.understand(elementInfo)    │
│    → registry.buildPrompt() for Click     │
│    → On success: updateEventWithAI()      │
│    → On failure: markEventAIFailed()      │
└──────────────────┬───────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────┐
│ 10. STEP GENERATION (Background SW)       │
│     buildStep(event, understanding,       │
│       registry.toPlainEnglish,            │
│       registry.executionExtras)           │
│     → Plain English: Click "Login"        │
│     → Execution JSON: locators + metadata │
│     → session.addStep(step)               │
│     → step persisted to storage           │
└──────────────────┬───────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────┐
│ 11. TIMELINE RENDERING (Side Panel)       │
│     Side panel detects storage change     │
│     → timeline-renderer.createActionElem  │
│     → registry.renderTitle() for Click    │
│     → Badge: "CLICK" (#2563eb blue)       │
│     → Title, identity chips, AI card      │
└──────────────────────────────────────────┘
```

### Where Each Stage Lives

| Stage | Component | Context |
|-------|-----------|---------|
| 1-6 Detection → Dedup | click-content-script.ts | Content script (isolated world) |
| 7 Classification | click-content-script.ts → sendMessage | Content script → Background |
| 8 Session Storage | service-worker.ts → recording-session.ts | Background SW |
| 9 AI Understanding | service-worker.ts → ai-understanding.ts → ai-service.ts | Background SW |
| 10 Step Generation | service-worker.ts → step-builder.ts → interaction-types.ts | Background SW |
| 11 Timeline | timeline-renderer.ts | Side panel |

### Why This Split?

The **content script** is the only thing that can see the DOM. It does the minimal work required: detect, resolve, validate, extract identity, and send a message. It has no access to the session, the registry, or the AI.

The **service worker** is the orchestrator. It receives the message, runs the pipeline, and persists results. It has access to everything except the DOM.

This separation is not a design choice — it is a constraint of Chrome's extension architecture (MV3). The architecture respects it rather than fighting it.

---

## 3. Target Resolution

### The Problem

The browser sets `event.target` to the **deepest element under the cursor**. This is frequently a child of the element the user intended to interact with:

```
User clicks the SAVE button:
┌────────────────────────────────┐
│  [svg icon]  Save              │  ← <button>  (intended)
│   ↑ event.target               │  ← <svg>     (actual)
└────────────────────────────────┘
```

### Resolution Strategy

```
function resolveClickTarget(event):
    1. Get event.composedPath()
       (crosses Shadow DOM boundaries — unlike closest())

    2. Walk the path from event.target upward
       For each element in the path:
         If element matches INTERACTIVE_SELECTOR:
           → return this element (FOUND)

    3. If no interactive element found in composedPath:
       Fall back to manual parentElement walk
       (doesn't cross shadow, but better than raw target)

    4. If still nothing found:
       Return the raw event.target (best effort)
```

### Interactive Selector

The selector defines what counts as a "clickable" element. It covers three categories:

**Native semantic tags:**
`a[href]`, `button`, `summary`, `select`, `option`, `input[type=button]`, `input[type=submit]`, `input[type=reset]`, `input[type=image]`, `input[type=checkbox]`, `input[type=radio]`

**ARIA interactive roles:**
`[role=button]`, `[role=link]`, `[role=tab]`, `[role=menuitem]`, `[role=menuitemcheckbox]`, `[role=menuitemradio]`, `[role=option]`, `[role=switch]`, `[role=treeitem]`, `[role=checkbox]`, `[role=radio]`, `[role=gridcell]`

**Explicit interactivity signals:**
`[tabindex]`, `[onclick]`, `[data-action]`, `[data-toggle]`, `[data-bs-toggle]`

### Why composedPath() Instead of closest()?

`closest()` cannot cross Shadow DOM boundaries. If a user clicks a button inside a Shadow DOM web component, `closest()` stops at the shadow root and never finds a parent in the light DOM.

`composedPath()` returns the full event path including shadow DOM ancestors. This is the only reliable way to resolve targets across shadow boundaries.

### Resolution Examples

| event.target | Walks Up To | Correct? |
|-------------|-------------|----------|
| `<svg>` inside `<button>` | `<button>` | ✅ |
| `<span>` inside `<button>` | `<button>` | ✅ |
| `<img>` inside `<a href>` | `<a href>` | ✅ |
| `<path>` inside `<svg>` inside `<button>` | `<button>` | ✅ |
| `<span>` inside `<div role=button>` | `<div role=button>` | ✅ |
| Shadow DOM `<button>` inside `<my-widget>` | `<button>` (via composedPath) | ✅ |
| Plain `<div>` (non-interactive) | No match → raw `<div>` | Correct (records click on div — it might have a framework click handler) |

### Why Not Resolve to a "Higher" Element?

If the user clicks a `<span>` inside a non-interactive `<div>` inside a `<button>`, resolution stops at the `<button>` — the first interactive ancestor. We do NOT keep going higher. The button is what the user intended to click.

If the user clicks a `<span>` inside a `<p>` inside a `<div>` (no interactive ancestor), resolution returns the raw `<span>`. This is correct — the click might be on a framework-managed element with a JavaScript click handler. The recorder captures it and lets the user decide if it's meaningful.

---

## 4. Ownership Model

### Design

Click is the **default owner** of every pointer activation. It owns the interaction unless another type explicitly claims it.

### The Ownership Signal

```
data-cmdrunner-handled="<type>"
```

A DOM attribute set by specialized content scripts (when they exist) on the resolved target. The presence of this attribute means "another interaction has already classified this click."

### How Click Checks Ownership

After target resolution, before anything else:

```
if (resolvedTarget.closest('[data-cmdrunner-handled]'))
    → return;  // Another interaction owns this. Click exits.
```

`closest()` checks the element AND all ancestors — a specialized script might set the attribute on a container rather than the exact clicked element.

### When No Specialized Scripts Are Present (Current State)

On the clean v2.2.0 baseline, no specialized content scripts exist. The `data-cmdrunner-handled` check always passes — Click owns everything. This is correct.

When future interactions are introduced (Checkbox, Dropdown, etc.), their content scripts will set `data-cmdrunner-handled` during their own capture-phase handlers. Click's check will then defer to them.

### Ownership Priority (Future)

When specialized interactions are introduced:

```
1. Form controls (change-event based)
   → No click contention. They use change/input events.

2. Drag & Drop
   → Sets data-cmdrunner-drag-active during drag
   → Click checks this before emitting

3. Enterprise click-based (tabs, accordion, modal, etc.)
   → Set data-cmdrunner-handled="<type>" synchronously
   → Click defers

4. Click (default)
   → Owns everything not claimed above
```

### Why Binary, Not Probabilistic?

At the content-script layer, ownership is binary: either a specialized script set the signal or it didn't. There is no "70% confident this is a tab click" — that kind of ambiguity creates false positives, which are worse than false negatives.

Probabilistic classification happens at the **AI layer** (post-capture), where the AI can enrich the description but cannot change the interaction type.

---

## 5. Interaction Classification

### When Is a Click "Classified"?

A click is classified — and therefore an interaction — at the moment the content script sends the `CLICK_CAPTURED` message to the background service worker.

Everything before that message is raw signal. Everything after is product.

```
Raw browser events → DETECTION → RESOLUTION → VALIDATION → DEDUP
                                                                │
                                          ┌─────────────────────┘
                                          │
                                          ▼
                              IDENTITY EXTRACTION
                                          │
                                          ▼
                              CLASSIFICATION = sendMessage('CLICK_CAPTURED')
                                          │
                              ═══════════════════════════
                              ║ INTERACTION NOW EXISTS  ║
                              ═══════════════════════════
                                          │
                                          ▼
                              SESSION STORAGE → AI → STEP → TIMELINE
```

### Classification Criteria

A click is classified as a Click interaction when ALL of these are true:

1. ✅ `event.isTrusted === true` (genuine user action)
2. ✅ `event.button === 0` (left click)
3. ✅ Recording is active
4. ✅ Target resolved to an element
5. ✅ No `data-cmdrunner-handled` signal from another interaction
6. ✅ Double-click dedup timer expired (not part of a double-click)
7. ✅ Identity successfully extracted

**Note on disabled/hidden elements:** The recorder does not actively check for disabled or hidden elements because it records only interactions that actually occur. The browser does not fire click events on natively disabled elements, so the recorder simply never sees them. For framework-managed elements using `aria-disabled` or CSS hiding, the click event does fire — the recorder captures it faithfully, and the user can remove it during Review.

If any criterion fails, there is **no interaction**. The click is silently dropped. This is correct — we capture only genuine, meaningful, classified clicks.

### What Classification Does NOT Decide

Classification does not decide:
- **The element's display name** — that's resolved during identity extraction.
- **The plain English text** — that's generated by the registry config.
- **The execution locators** — that's built by the step builder.
- **The AI understanding** — that's async, post-capture.

Classification is narrow: it says "this raw signal is a Click interaction" and sends it into the pipeline. Everything downstream is the pipeline's job.

---

## 6. Plain English Generation

### Where It Lives

Plain English generation lives in the **registry config** for Click (`clickConfig.toPlainEnglish()`), called by the step builder during step generation in the background service worker.

### Name Resolution Priority

```
1. AI business name (if AI completed)
   → "Login Button" → Click "Login Button"

2. Accessible name (computed at click time)
   a. aria-label            → "Save Changes"
   b. aria-labelledby       → "Shipping Address" (supports multi-ID)
   c. <label for>           → "Email Address" (form controls only)
   d. innerText             → "Submit"
   e. textContent           → "Submit"
   f. placeholder           → "Search..."
   g. value                 → "John"
   h. alt text              → "Company Logo"
   i. title                 → "Help tooltip"

3. Tag name (fallback)
   → "BUTTON" → Click the BUTTON
```

### Generation Format

```
Click "[name]"
```

Examples:
```
Click "Login"
Click "Save Changes"
Click "Add to Cart"
```

### Icon and Image Handling

When the element has no text but has an `aria-label` or `alt`:
```
Click the "Search" icon
Click the "Company Logo" image
```

When the element has neither text nor label:
```
Click the button
Click the profile image
```

### AI-Enhanced Format

When AI understanding succeeds, the step can be enriched:
```
Without AI: Click "Submit"
With AI:    Click "Submit" to send the application form
```

The base format (`Click "[name]"`) must always work without AI. AI is enrichment, not a dependency.

### Where Disambiguation Happens

Disambiguation (e.g., "Click 'Edit' in the 'Shipping' section") is an AI-layer concern. The registry provides the element name; the AI adds context if needed. The base format does not attempt structural disambiguation — that requires DOM analysis the content script doesn't perform at the Plain English stage.

---

## 7. Execution JSON

### Design

The Execution JSON must contain enough information for the execution engine to **locate and activate** the clicked element on a fresh page load.

### Structure

```
{
  // ── Identity ──
  action:           "click"
  actionId:         "click-0001"
  elementId:        "elem-0001"

  // ── Locators (priority order) ──
  primaryLocator:   { type: "testId", value: "login-btn" }
  fallbackLocators: [
    { type: "ariaLabel", value: "Login" },
    { type: "css", value: "#login-btn" },
    { type: "xpath", value: "//button[@id='login-btn']" }
  ]

  // ── Element Metadata ──
  tag:              "BUTTON"
  accessibleName:   "Login"
  ariaRole:         "button"

  // ── Frame Context ──
  inIframe:         false
  shadowDom:        false
  iframeContext:    null  (or IframeContext object if in iframe)
}
```

### Locator Generation Priority

| Priority | Type | Source | Stability |
|----------|------|--------|-----------|
| 1 | testId | `data-testid` | Highest — explicitly placed for automation |
| 2 | testId | `data-cy` | High — Cypress convention |
| 3 | testId | `data-qa` | High — QA convention |
| 4 | id | `el.id` | Medium — only if not auto-generated (future: heuristic filter) |
| 5 | ariaLabel | `aria-label` | Medium-High — stable for icon buttons |
| 6 | name | `name` attribute | Medium — stable for form controls |
| 7 | css | Generated selector | Low — structural, breaks on layout changes |
| 8 | xpath | Generated XPath | Lowest — positional, breaks on re-order |

### Why Multiple Locators?

No single locator survives all real-world conditions:
- `data-testid` is absent on most production apps.
- IDs are auto-generated by React (`:r1:`), Angular (`mat-3`), Vue.
- Text changes with internationalization.
- CSS selectors break when layouts change.

Providing multiple strategies lets the execution engine try the most resilient first and fall back as needed. This is a product requirement from the spec, not an optimization.

### What Execution JSON Does NOT Include

- ❌ Browser event details (mouse coordinates, timing)
- ❌ DOM snapshots
- ❌ Screenshot data
- ❌ Internal recorder state (pending click, dedup state)
- ❌ Content script internals

---

## 8. Error Handling

### Invalid Targets

**Scenario:** Click resolves to an element that is not interactive and has no click handler.

**Behavior:** Record the click anyway. The user clicked something — it may have a framework-managed handler we can't detect. The user can delete the step during Review if it's noise.

**Rationale:** False negatives (missing a real click) are worse than false positives (recording a noise click that the user deletes).

### Disabled Elements

**Scenario:** Element has `disabled` attribute or `aria-disabled="true"`.

**Behavior:** The recorder records only interactions that actually occur. Natively disabled elements (`<button disabled>`) do not fire click events in the browser — the recorder simply never sees a click on them. For framework-managed elements that use `aria-disabled` or CSS-only disabling, the browser DOES fire a click event — the recorder captures it faithfully. The user can remove it during Review.

**Architectural stance:** The recorder does not filter disabled elements because it is not the recorder's job to predict what the application considers "interactive." It records what genuinely happened. The Review phase is where the user decides what to keep.

### Hidden Elements

**Scenario:** Element has `display: none`, `visibility: hidden`, or `opacity: 0`.

**Behavior:** Same principle as disabled elements: the recorder records what actually occurs. A click event on a hidden element is rare but possible (e.g., overlap, fast hide after click). The recorder captures it. The user can remove it during Review.

**Architectural stance:** No computed style checks are performed during Click processing. The recorder does not second-guess the DOM — it captures genuine user interactions and lets the user filter during Review.

### Dynamic Elements / Detached Nodes

**Scenario:** React/Angular/Vue re-renders the element between click time and dedup holding window expiry.

**Behavior:** Identity is extracted **at click time**, not at timer expiry. The `PendingClick` stores the identity, not the `Element` reference. When the holding window expires, it emits the stored identity — even if the original element is gone from the DOM.

**Key implementation detail:**
```
PendingClick {
  identity: RawElementIdentity   // ← extracted at click time
  identityKey: string            // ← for dedup comparison
  timer: setTimeout handle
}
// NOT: { element: Element, timer }  ← element may detach
```

### Cross-Origin Iframes

**Scenario:** Click inside a cross-origin iframe. The content script IS injected (manifest specifies `all_frames: true`), so clicks are detected. But `extractIframeContext()` cannot access the parent document.

**Behavior:** Record the click with `inIframe: true` and `iframeContext.frameSrc` (the iframe's own URL). Other iframe context fields (`frameId`, `frameSelector`, `frameXPath`, `frameIndex`) are null.

**Impact:** The execution engine has the iframe URL but not a selector to locate the iframe element. Playback of cross-origin iframe clicks may require manual locator adjustment.

**Trade-off:** Accepting this limitation is better than not recording the click at all. The user can see the click in the timeline and adjust during Review.

### Shadow DOM

**Scenario:** Click inside a Shadow DOM. `event.composedPath()` correctly traverses shadow boundaries for target resolution.

**Behavior:** `shadowDom: true` is set in the identity. The CSS selector is generated relative to the shadow root (not the light DOM). The XPath follows the same pattern.

**Impact:** The execution engine must be aware that the element is in a shadow root and adjust its query strategy (e.g., pierce shadow roots in Playwright).

---

## 9. Performance

### Event Listener Overhead

**One capture-phase click listener** on `document`. This is the minimum possible — one listener for all clicks.

The listener does:
1. Four boolean checks (isTrusted, button, recording, target exists) — O(1), negligible.
2. `composedPath()` + walk — O(depth of DOM), typically 5-15 elements. Negligible.
3. Ownership check (`closest`) — O(depth), negligible.
4. Dedup check (identity key comparison) — O(1), negligible.

**Total per-click overhead:** microseconds. No perceptible impact.

### Identity Extraction Cost

Identity extraction (accessible name, CSS selector, XPath) runs once per click, only on the resolved element. This is the most expensive part:

- `computeAccessibleName()`: up to 9 string checks + up to 2 DOM queries (getElementById for labelledby, querySelector for label[for]). O(1) per check.
- `generateCssSelector()`: walks up to 5 ancestors. O(5).
- `generateXPath()`: walks up to 10 ancestors. O(10).

**Total:** O(20) DOM operations per click. Negligible for human-speed interaction (clicks are seconds apart).

### What Is NOT Running

- ❌ No `MutationObserver` (Click doesn't watch for DOM changes)
- ❌ No `ResizeObserver`
- ❌ No `IntersectionObserver`
- ❌ No polling/setInterval
- ❌ No continuous mouse tracking

### Memory

- One `PendingClick` object at a time (the previous one is cleared when a new click starts).
- No accumulation of element references.
- No caches that grow over time.

**Memory is O(1)** for the content script regardless of session length.

### Long Sessions

The content script's memory does not grow with the number of clicks. All events are stored in the background SW's `chrome.storage.local`, which has a 10MB limit (configurable to unlimited with `unlimitedStorage` permission).

For extremely long sessions (1000+ clicks), storage size is the concern, not content script memory. Each click event is ~500 bytes. 1000 clicks = ~500KB. Well within limits.

---

## 10. Testing Strategy

### Unit Tests (in tests/)

Test the isolated functions that can be extracted and tested without a browser:

| Test Area | What to Verify |
|-----------|---------------|
| `computeAccessibleName()` | aria-label priority, multi-ID labelledby, label[for], alt text, text fallback, empty case, truncation |
| `getImplicitRole()` | tag→role mapping, input type→role mapping, null for unknown |
| `generateCssSelector()` | id present, testId present, nth-of-type chain, depth limit |
| `generateXPath()` | positional path, id-based shortcut, depth limit |
| `isInteractiveElement()` | each selector category matches, non-interactive elements rejected |
| `buildLocators()` | priority order, multiple locators generated, empty case |
| `buildStep()` | step ID, plain English, execution JSON structure, AI confidence |

### Integration Tests (in tests/)

Test the pipeline end-to-end using the mocked Chrome APIs:

| Test Area | What to Verify |
|-----------|---------------|
| Recording session | addAction creates event with correct IDs, persists to storage |
| Step generation | buildStep produces correct plain English and execution JSON |
| Registry | Click config registered, toPlainEnglish produces correct text |
| Service worker routing | CLICK_CAPTURED message triggers processAction |
| AI understanding | buildPrompt generates correct prompt, parseUnderstandingResponse parses correctly |
| Timeline rendering | createActionElement produces correct DOM for click events |

### Browser Compatibility Tests

Manual or Playwright-driven tests on real DOM structures:

| Test | Setup | Expected |
|------|-------|----------|
| SVG in button | `<button><svg>...</svg>Save</button>` | Resolves to button, name="Save" |
| Span in button | `<button><span>Save</span></button>` | Resolves to button |
| Image in link | `<a href><img alt="Products"></a>` | Resolves to link |
| Div role=button | `<div role="button" tabindex="0">Click</div>` | Resolves to div |
| Shadow DOM | Custom element with shadow root containing button | Resolves to button via composedPath |
| Disabled button | `<button disabled>Save</button>` | No click event fires — nothing to record |
| Synthetic click | `el.click()` | Not recorded (isTrusted=false) |
| Double-click | Two rapid clicks same element | First suppressed, dblclick emitted |

### Framework Compatibility Tests

| Framework | Test Page | What to Verify |
|-----------|-----------|---------------|
| Native HTML | Plain buttons, links, forms | Basic resolution + identity |
| React | Component with conditional rendering | Target resolution through wrappers |
| Angular | Material button | Resolution through Angular wrappers |
| Vue | Component with scoped slots | Resolution through Vue wrappers |
| Shadow DOM | Lit element / web component | composedPath crosses boundary |

### Manual Validation Strategy

1. **Record a real flow** on a real application (e.g., GitHub, a SaaS app).
2. **Verify each step** in the timeline: correct name, correct element, correct plain English.
3. **Stop and review** the full test case.
4. **Export execution JSON** and verify it's playable.

---

## Component Responsibilities

### Files to Create/Modify

| File | Responsibility | Changes |
|------|---------------|---------|
| `src/recorder/click-content-script.ts` | **NEW** — Detection, resolution, validation, dedup, identity extraction, classification | Created from scratch |
| `src/recorder/interaction-types.ts` | Register Click config (buildPrompt, toPlainEnglish, renderTitle, executionExtras, addToSession) | Add clickConfig + registerInteractionType call |
| `src/recorder/recording-session.ts` | Add ClickEvent to SessionEvent union | Add type discriminator |
| `src/recorder/step-builder.ts` | No changes (generic buildStep already works) | None |
| `src/shared/types.ts` | Add ClickEvent interface, CLICK_CAPTURED message type | Add types |
| `src/background/service-worker.ts` | Handle CLICK_CAPTURED message | Add message case |
| `src/sidepanel/timeline-renderer.ts` | No changes (registry-driven) | None |
| `src/manifest.json` | Register click-content-script.ts | Add content_scripts entry |

### Content Script Responsibilities

The click content script is **self-contained** — it runs in an isolated world and cannot import modules. It inlines:

1. The interactive selector constant
2. `resolveClickTarget()` using `composedPath()`
3. `computeAccessibleName()` with 9-level priority
4. `getImplicitRole()` tag→role mapping
5. `generateCssSelector()` and `generateXPath()`
6. `isInShadowDom()` detection
7. `extractIframeContext()`
8. Recording state sync via `chrome.storage.onChanged`
9. Click + dblclick event listeners (capture phase)

### Service Worker Responsibilities

The service worker handles the `CLICK_CAPTURED` message:

```
case 'CLICK_CAPTURED':
    → processAction(message.payload, 'click', tabId)
    → session.addAction(identity, 'click', 'click')
    → ScreenshotService.capture(tabId, actionId, elementId, 'click')
    → AIService.understand(elementInfo)
    → buildStep(event, understanding, registry.toPlainEnglish, registry.executionExtras)
    → session.addStep(step)
```

---

## Data Flow

```
Content Script                    Service Worker                 Side Panel
─────────────                     ──────────────                 ──────────
                                                  
click event                                       
    │                                            
    ▼                                            
resolveClickTarget()                             
    │                                            
    ▼                                            
ownership check                                  
    │                                            
    ▼                                            
validation                                       
    │                                            
    ▼                                            
dedup check                                      
    │ (timer expires)                            
    ▼                                            
extract identity                                 
    │                                            
    ▼                                            
sendMessage({                                    
  type: 'CLICK_CAPTURED',       → processAction()
  payload: identity               │               
)                                 ├─→ session.addAction()
                                  │   └→ chrome.storage.local.set()
                                  │      └───────────────→ storage change event
                                  │                          → render timeline
                                  ├─→ ScreenshotService.capture()
                                  ├─→ AIService.understand()
                                  │   └→ updateEventWithAI()
                                  │      └→ chrome.storage.local.set()
                                  │         └───────────────→ storage change event
                                  │                       → update AI card
                                  └─→ buildStep()
                                     └→ session.addStep()
                                        └→ chrome.storage.local.set()
                                           └───────────────→ storage change event
                                                              → render step
```

The content script fires one message. Everything else is orchestrated by the service worker. The side panel reactively renders based on storage changes.

---

## Risks

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| React `:r1:` IDs used as stable locators | High | Medium | Future: ID stability heuristic filter (Milestone 1E from earlier design) |
| Shadow DOM `closest()` fails across boundary | Medium | Low | Already mitigated: using `composedPath()` instead of `closest()` for resolution |
| Dedup timer lost on fast SPA navigation | Low | Medium | Identity extracted at click time, not timer expiry — emitted identity is correct even if page changes |
| Cross-origin iframe clicks have incomplete context | Medium | Low | Accepted limitation — frameSrc is captured, other fields null |
| Content script not injected on restricted pages | Low | Low | Warning displayed (per session lifecycle spec) |

---

## Trade-offs

| Decision | Chosen | Alternative | Why |
|----------|--------|-------------|-----|
| Event signal | `click` only | `mousedown` + `mouseup` | click is the semantic intent; low-level events are browser details |
| Target resolution | `composedPath()` | `closest()` | composedPath crosses Shadow DOM; closest does not |
| Dedup strategy | Identity key (not Element ref) | Element reference | Virtual DOM may detach element before timer fires |
| Ownership signal | `data-cmdrunner-handled` attribute | Message-based coordination | Attribute is synchronous, available to all capture-phase listeners |
| Identity timing | At click time | At dedup window expiry | Element may be re-rendered during holding window |
| Locator types | 8 strategies | Single best locator | No single locator survives all real-world conditions |
| Validation | Record what genuinely occurs | Filter disabled/hidden | The recorder is not responsible for predicting what the application considers interactive; Review is where the user filters |

---

## Open Questions

1. **SPA route change detection** — The session lifecycle spec says SPA route changes should be captured as navigation interactions. This is a Navigation concern, not a Click concern, but it affects when navigation events appear relative to clicks. **Deferred to Navigation milestone.**

---

## Deferred Concerns

The following were identified during architecture review but are explicitly deferred to future milestones — they are locator quality and execution concerns, not Click interaction detection concerns:

- **ID stability filtering** — A heuristic to detect auto-generated IDs (React `:r1:`, Angular `mat-3`, etc.) and exclude them as locators. Future locator-quality milestone.
- **`role` + `name` locator** — A new locator type pairing ARIA role with accessible name. Future locator-quality milestone.
- **Text-based locator** — A locator type using visible element text. Future locator-quality milestone.

---

## Implementation Phases (Preview)

This is a preview only — no implementation yet. When approved, implementation will follow this order:

| Phase | Scope | Files |
|-------|-------|-------|
| 2A | Content script: detection + resolution + dedup + classification checks | click-content-script.ts |
| 2B | Content script: identity extraction (accessible name, CSS, XPath, shadow, iframe) | click-content-script.ts |
| 2C | Classification: CLICK_CAPTURED message + service worker handler | click-content-script.ts, service-worker.ts, types.ts |
| 2D | Registry: Click config registration (buildPrompt, toPlainEnglish, renderTitle, executionExtras) | interaction-types.ts |
| 2E | Tests: unit + integration | tests/click-*.test.ts |
| 2F | Manifest registration + build + full regression | manifest.json |

Phases 2A-2B can be done in one pass (single content script file). Phase 2C-2D touches pipeline files. Phase 2E-2F verifies.
