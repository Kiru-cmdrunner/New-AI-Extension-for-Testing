# Layer 0 Audit — Event Capture & Identity Extraction (`deff878`)

**Date:** 2026-08-11
**Baseline:** `deff878a0cfdf6f42d65f19d4b0c62ec39edf8a8`
**Scope:** `src/tap/event-tap.ts`, `src/tap/identity-extractor.ts`, `src/definitions/dom-context-extractor.ts`, `src/recorder/phase5/recorder-entry.ts`, `src/tap/state-cache-listeners.ts`
**Method:** Read-only source inspection of deff878 worktree. No modifications.

---

## 🔴 CRITICAL

### C-1: mouseenter/mouseleave may not fire for child elements — REQUIRES REAL CHROME VALIDATION

These events do NOT bubble. Registered via `document.addEventListener(type, handler, {capture: true})`.
Per DOM spec, mouseenter/mouseleave fire only on the element with the listener — not propagating
through ancestors like click does. A document-level listener may only receive mouseenter when the
pointer enters `document`, NOT when it enters a child `<div>` inside the page.

The Hover definition's trigger (mouseenter) and lifecycle (mouseleave) depend on receiving these
events for child elements. In jsdom tests they appear to work (jsdom dispatches differently), but
real Chrome behavior may differ.

**Status: REQUIRES REAL CHROME VALIDATION — not a confirmed bug.**
The workaround would be to use `mouseover`/`mouseout` (which DO bubble) instead.

### C-2: No pointer/touch/drag events

Zero capture of `pointerdown/up/move, touchstart/end/move, dragstart/dragend/drop, dblclick, wheel`.
Entire classes of modern interactions are invisible: drag-and-drop, touch gestures, pointer-based
sliders, pinch-zoom, double-click. By-design limitation at deff878 (DF-1 addresses it).

### C-3: `elementId` always empty string

`extractIdentity()` hardcodes `elementId: ''` (identity-extractor.ts:365). The type says "Assigned
by background" but no code ever assigns it. IR Bridge uses it for dedup (ir-bridge.ts:292),
repository uses it for capability matching (capability-matching-service.ts:80), executor uses it
for locator resolution (ir-executor-impl.ts:260). All operate on `''`.

---

## 🟠 HIGH

### H-1: `resolveTarget()` called twice per event

`handleRawEvent()` calls `resolveTarget(rawEvent)` at line 182, then passes `rawEvent` to
`assembleObservedEvent()` which calls `resolveTarget(rawEvent)` again at line 215. Doubles
composedPath traversal + getComputedStyle calls. Measurable for mousemove at 20fps.

### H-2: SessionStorage buffer is O(n²) per session

`pushToBuffer` does JSON.parse → push → JSON.stringify on growing array (up to 500).
`removeFromBuffer` does JSON.parse → filter → JSON.stringify. At 100 events: ~200 full-array
serializations. Pure content-script main-thread cost per captured event.

### H-3: `deepGetElementById`/`deepQuerySelector` are O(n) per call

These do `root.querySelectorAll('*')` iterating all elements, recursing into shadow roots.
Called by `computeAccessibleName()` for aria-labelledby resolution and label[for] lookup.
Synchronous in capture-phase event handler.

### H-4: CSS selectors don't mark shadow boundaries

`generateCssSelector()` walks parentElement up to 5 levels. When hitting shadow root,
parentElement returns null and selector terminates — does NOT cross boundary or include host.
No `>>>` or `>>` marker. Selectors correct within shadow scope but ambiguous across document.

### H-5: `checkedBefore` timing on click may be wrong

Comment says "checkedBefore captured before browser updates state." Per DOM spec, click fires
during target phase; activation behavior (toggling .checked) happens after default action — but
some browsers update .checked before the click handler runs. Actual captured value depends on
browser implementation. If already toggled, checkedBefore captures AFTER state.

---

## 🟡 MEDIUM

### M-1: Modifier keys read via wrong cast

Lines 286-289: `shiftKey: mouseEvent.shiftKey ?? false` — mouseEvent is `rawEvent as MouseEvent`
but for keydown the object is KeyboardEvent. Works at runtime (KeyboardEvent inherits from UIEvent)
but semantically wrong and confusing.

### M-2: No `keyup` capture

Only keydown captured. Key release timing (hold duration, modifier release) lost. Custom
components with keydown+keyup patterns partially captured.

### M-3: No `submit` event

Form submission inferred from submit button click, not form submit event. Programmatic
form.submit() without button click is lost.

### M-4: Scroll delta is absolute, not relative

`scrollDeltaY/X` captures current scrollTop/scrollLeft (absolute position), not delta from
previous scroll. Consumers must compute delta themselves.

### M-5: CSS selector max depth 5, XPath max depth 10

Inconsistent depth limits. CSS selectors truncate at 5 levels; XPath at 10. Deeply nested
elements without IDs may get non-unique CSS selectors.

### M-6: `aria-controls` not captured

Not in INTERACTIVE_SELECTOR or DomContext. This attribute links comboboxes to listboxes, tab
controls to tabpanels. Definitions must rely on structural heuristics instead of ARIA relationship.

### M-7: `pageId` uses Date.now() — collision risk across tabs

`pageId = 'p' + Date.now().toString(36)`. Two tabs starting within same millisecond generate
same pageId. Event IDs (evt-{pageId}-{counter}) may collide in multi-tab recording.

### M-8: `NON_INTERACTIVE_TAGS` is incomplete

Excludes structural SVG elements but not TBODY, THEAD, SPAN, DIV, P, LABEL, etc. Strategy 4
(raw target fallback) returns these when clicked, generating Unclassified with non-interactive
targets. Technically correct per INV-1 (capture everything) but produces noise.

---

## 🟢 LOW

### L-1: No `inputType` for non-`<input>` elements

getInputType() returns null for everything except `<input>`. Custom date pickers with
`<div role="textbox">` have no inputType.

### L-2: CSS selector prefers `#id` unconditionally

If element has id, selector is just `#id`. IDs not guaranteed unique in real-world HTML.
Duplicate-ID page produces selectors matching multiple elements.

### L-3: Navigation captureSeq uses performance.now()

Real events use rawEvent.timeStamp. Navigation events use performance.now(). Both are
performance.timeOrigin-relative so should be comparable, but spec for event.timeStamp has
changed across Chrome versions — ordering may not be perfectly monotonic.

### L-4: No rate limiting on mouseenter/mouseleave

Only mousemove (50ms) and scroll (16ms) are rate-limited. If mouseenter/mouseleave DO fire
for child elements, rapid mouse movement across many small elements could flood the pipeline.

### L-5: `TEST_HOOK.forceTrusted` is mutable exported object

Test code mutates this to bypass isTrusted filter. If cleanup doesn't reset it, subsequent
tests may capture synthetic events.
