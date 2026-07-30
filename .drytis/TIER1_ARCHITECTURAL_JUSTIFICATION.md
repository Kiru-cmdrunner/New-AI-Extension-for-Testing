# Tier 1 Architectural Justification

> **Purpose**: Before implementation, justify each Tier 1 interaction against the
> current architecture. Every item must strengthen the recorder's generic capability,
> not add a special case. This document is the design gate — implementation does not
> begin until each justification holds up to review.

---

## Item 1: ModalDialog — Container Lifecycle

### 1. Why Tier 1

The recorder currently captures interactions inside a modal as **loose, ungrouped
events**. A modal form (open dialog → fill name → select option → click Save)
produces four independent interactions with no structural relationship. When the
IR bridge generates Playwright code, it emits four flat steps — the test has no
concept of "these actions happen inside a modal context."

This is the single biggest semantic gap in the recorder. Modals, drawers,
bottom sheets, popovers, and confirmation dialogs are omnipresent in modern web
applications. The **container lifecycle pattern** — a compound interaction that
opens a surface, collects all events inside it as subActions, and completes on
close — solves this for all overlay types at once.

**Why before everything else:** Five other Tier 2 variants (Drawer, Popover,
Bottom Sheet, Lightbox, Confirmation Dialog) are direct reuse of the same
container lifecycle. Building ModalDialog first means those five become metadata
variants, not new definitions. No other Tier 1 item has this multiplier effect.

### 2. Architectural Approach

The ModalDialog is **not a new lifecycle pattern** — it is the Dropdown's
multi-config pattern applied at a higher level:

| Aspect | Dropdown (existing) | ModalDialog (new) |
|--------|--------------------|--------------------|
| Trigger | Click on combobox/select | Click that opens a modal surface |
| Surface claimed | Dropdown panel (listbox/popover) | Modal surface (dialog/alertdialog) |
| Events inside | Options, steppers, toggles | All interactions (text, clicks, selects) |
| Completion | Option click / Done button / outside | Close button / backdrop / Escape / surface removal |
| SubActions | selectOption, increment, toggle, fillInput | Any interaction type |

The implementation is a new `ModalDialog` definition at **priority 8** (before
DatePicker at 10). This is critical: ModalDialog must claim the modal surface
before any lower-priority definition tries to handle events inside it.

**Lifecycle:**
```
Trigger: click/mousedown that results in a modal surface appearing
         (detected via surfaceId change — the next event carries a
          surfaceId of type 'modal' that wasn't there before)

Active:  ALL events inside the modal's surfaceId are claimed.
         Each event is classified as a subAction using the existing
         classifySubAction logic from Dropdown.

Completion:
  - Click on close/cancel/X button → completed
  - Click outside the modal (backdrop) → completed
  - Escape key → completed
  - Surface removed (closedAt set by detectSurfaceClosure) → completed
  - Flush (navigation away) → interrupted (downcast: keep as ModalDialog
    since subActions may have real value)
```

**The trigger problem:** The modal doesn't appear synchronously with the click.
React portals render asynchronously — the surfaceId appears on the NEXT event
(after the modal has rendered). So the trigger can't be detected on the click
itself. Instead:

- `detectTrigger` fires on any click/mousedown.
- After creating the session, the runtime's `trackSurface` runs and binds the
  new surface to this session (existing infrastructure).
- If no surface appears within a short window (next 2-3 events), the session
  is abandoned (and downcasts to Click via the existing protocol).
- If a surface DOES appear, `trackSurface` binds it to the ModalDialog session,
  and subsequent events inside that surface are claimed.

This "optimistic trigger with surface confirmation" is a new trigger strategy,
but it uses existing infrastructure (trackSurface, surfaceStack).

### 3. Reuse vs New

**Reused (no changes):**
- Surface tracking infrastructure (`trackSurface`, `detectSurfaceClosure`,
  `closeAllSurfaces`, surfaceStack) — lines 661-820 of component-runtime.ts
- Surface detection in DOM context extractor (`detectSurface` already
  recognizes `role="dialog"`, `aria-modal="true"`, `<dialog>`, and framework
  CSS patterns) — lines 19-107 of dom-context-extractor.ts
- SubAction classification (`classifySubAction` from Dropdown — the exact same
  logic for identifying clicks, toggles, text inputs, etc.)
- Concurrent session resolution — already handles "new trigger inside
  different surface" and "new trigger outside surface"
- Downcast protocol — if no surface appears, downcast to Click

**New (genuinely new capabilities):**
- **Surface-confirmation trigger strategy**: detectTrigger fires optimistically,
  and the session is validated when trackSurface binds a surface to it. This is
  new because no existing definition triggers before the surface appears.
- **Nested subAction dispatch**: currently, classifySubAction identifies 6 action
  types (selectOption, increment, decrement, toggle, fillInput, confirm). For
  ModalDialog, some subActions are themselves lifecycle interactions (a Dropdown
  inside a modal should produce a Dropdown subAction, not a generic selectOption).
  This requires the runtime to support nested discovery inside a claiming
  session — a new capability.

### 4. Generic / Framework-Independent

| Detection Layer | Mechanism | Specificity |
|----------------|-----------|-------------|
| Primary | ARIA `role="dialog"`, `role="alertdialog"`, `aria-modal="true"` | Standard — works everywhere |
| Secondary | `<dialog>` HTML element | Standard HTML5 |
| Tertiary | SurfaceId structural computation (DOM position-based) | Framework-independent |
| Fallback | Pattern Registry FRAMEWORK tier (MuiDialog-root, ant-modal, etc.) | Extensible, not hardcoded |

No AdaniOne-specific or domain-specific patterns in core detection. Framework
patterns are plugins in the Pattern Registry, swappable without touching the
definition.

### 5. Validation Plan

**Fixtures (Gate 6 — framework independence):**
1. Native `<dialog>` element (HTML5)
2. React portal modal with form inside
3. MUI Dialog component
4. AntD Modal component
5. Bootstrap modal

Each fixture contains: a trigger button, a modal with a text input + a dropdown
+ a submit button, and a close mechanism (X button + backdrop click + Escape).

**Gates verified:**
- Gate 1: Correct trigger on modal-opening click; no false positive on non-modal
  surface changes (e.g., a dropdown opening is NOT a modal)
- Gate 2: Surface containment — events inside modal claimed; events outside
  modal cause completion
- Gate 3: subActions array with correct action/label/value per inner interaction
- Gate 4: IR bridge expands ModalDialog into individual steps + dialog open/close
- Gate 5: Playwright code renders `page.locator('[role=dialog]').waitFor()` +
  individual actions + close
- Gate 6: Works across native, React, MUI, AntD, Bootstrap

### 6. Regression Risk

**Low risk** if priority is correct. ModalDialog (priority 8) triggers only when
a modal surface opens. Non-modal interactions are completely unaffected —
they never produce a modal surfaceId, so ModalDialog's optimistic trigger never
fires (or fires and immediately downcasts to Click when no surface appears).

**Critical regression guard:** The priority-8 placement means ModalDialog checks
before DatePicker (10), DragDrop (15), and Dropdown (20). If ModalDialog's
detectTrigger is too broad (claims clicks that don't open modals), it will
starve lower-priority definitions. The downcast protocol (abandon + downcast
to Click if no surface appears within 2-3 events) is the safety net, but it
adds latency. The trigger must be conservative: only fire on elements that are
likely modal triggers (buttons with `data-toggle="modal"`, elements with
`aria-haspopup="dialog"`, or any click — relying on surface confirmation).

**Test additions:** Snapshot tests for: (a) modal form produces grouped
subActions, (b) non-modal click is NOT claimed by ModalDialog, (c) Escape closes
modal, (d) backdrop click closes modal, (e) nested dropdown inside modal works.

### 7. Long-Term Vision Impact

ModalDialog establishes the **container lifecycle** as a first-class pattern in
the recorder. Once the runtime supports "a session that claims all events inside
its surface and dispatches them as typed subActions," the same mechanism serves:
- Wizards (multi-step container)
- Drawers and bottom sheets (container variant)
- Popovers (lightweight container)
- Command palettes (container + embedded search)

This is the foundation for treating any overlay-based UI as a structured
compound interaction, which is how test engineers think about these flows.

---

## Item 2: Searchable Dropdown — Compound Text-in-Surface

### 1. Why Tier 1

Searchable dropdowns (comboboxes with typeahead) are one of the most common
compound interactions: the user focuses an input, types to filter options, then
clicks a suggestion. Currently this is captured as a TextEntry (the typed text)
plus a separate Click (the suggestion), or absorbed by Dropdown as a raw
`fillInput` subAction — but the text value is captured **before** the SPA
flushes the filtered state, so the typed text is often stale.

This is Tier 1 because the "text entry inside a surface" pattern is reused by:
command palettes (DD-13), autocomplete with free text (DD-14), @mentions inside
text areas (KB-06), and slash commands (KB-05). Solving it generically unblocks
five interaction variants.

### 2. Architectural Approach

**This is NOT a new definition.** It is an enhancement to two existing
definitions: Dropdown (subAction handling) and TextEntry (deferred blur inside
surfaces).

The core problem: when a focus event occurs inside a Dropdown surface on an
element matching TextEntry's trigger, two things should happen:
1. The Dropdown session should claim the focus (it does — `isInScope` returns
   true for surface events)
2. The text value should be captured with deferred blur (it doesn't — Dropdown
   classifies it as `fillInput` with `event.valueAfter` at click time, not at
   blur time)

**Solution: Deferred value subActions.** When Dropdown's `classifySubAction`
detects a text input focus inside its surface, it:
1. Records the focus as a `fillInput` subAction with a `pending: true` flag
2. When the subsequent blur event arrives (also inside the surface), reads the
   element value using the same deferred mechanism as TextEntry
3. Updates the subAction's value with the real post-flush value
4. If a suggestion click follows, records a `selectOption` subAction

This keeps the single-session model (no nested sessions) while reusing
TextEntry's value extraction logic.

**The deferred blur inside a surface is the key new capability.** Currently,
TextEntry's deferred blur (setTimeout 0) works because TextEntry IS the active
session. When Dropdown is the active session, the blur event goes to Dropdown's
`handleEvent`, which classifies it as a subAction — but the deferred value
read needs to happen. The fix: Dropdown's handleEvent, on detecting a blur on
a text input element, schedules the same deferred value check that TextEntry
uses, and updates the pending fillInput subAction when the value arrives.

### 3. Reuse vs New

**Reused:**
- Dropdown multi-config infrastructure (subActions, isMultiConfig)
- TextEntry's deferred blur value reading mechanism (schedulePostClickValueCheck
  pattern from event-tap.ts)
- Pattern Registry combobox detection

**New:**
- Deferred value subAction: a subAction whose value is populated asynchronously
  after the blur event. This is a minor extension to the subAction data model
  (add `pending?: boolean` and `valueResolvedAt?: number`).

### 4. Generic / Framework-Independent

The text-in-surface pattern is detected via:
1. A focus event on an `<input>` or `contentEditable` element inside an active
   Dropdown surface (detected via surfaceId or CSS class fallback)
2. The element matches `isTextEntry()` (existing pattern)

No framework-specific logic. The deferred value reading uses the same
`element.value` / `element.textContent` extraction that TextEntry already uses.

### 5. Validation Plan

**Fixtures:**
1. Native HTML combobox (input + datalist)
2. React-Select / Downshift combobox
3. MUI Autocomplete
4. AntD AutoComplete
5. Google Places-style search (async results)

**Verified:** User types "Ban" → suggestion "Bangalore" appears → click suggestion.
Expected: Dropdown with subActions [fillInput "Ban" → selectOption "Bangalore"],
OR TextEntry "Bangalore" if the final value is in the input.

### 6. Regression Risk

**Very low.** The change is inside Dropdown's handleEvent — it only affects
events inside an active Dropdown surface. Non-dropdown text entry is completely
unaffected. The deferred value mechanism is additive (updates a subAction
field), not a change to the event flow.

### 7. Long-Term Vision Impact

Establishes the **compound subAction with deferred value resolution** pattern.
Once a subAction can have its value populated asynchronously (after SPA state
flush), the same mechanism serves any "value-bearing interaction inside a
container" — form fields inside modals, filter inputs inside drawers, etc.

---

## Item 3: Standalone Stepper — Independent Counter

### 1. Why Tier 1

Steppers outside dropdowns (quantity selectors, room counters, age selectors)
are captured as loose Click interactions on "+" and "−" buttons. The recorder
loses the semantic grouping: three clicks on "Adults +" should be one
interaction ("set Adults to 3"), not three separate clicks. The increment/
decrement detection logic already exists (in Dropdown's `isStepperPlus`/
`isStepperMinus`), but it only runs inside a Dropdown surface.

This is Tier 1 because steppers are one of the most common e-commerce and
booking interactions, and the metadata loss (field name, final value, delta)
makes the generated test code brittle — it clicks + three times without knowing
why.

### 2. Architectural Approach

**New `Stepper` definition at priority 28** (after Checkbox at 30, before
RadioButton at 40). This is NOT the same as Dropdown's stepper subActions —
those are captured inside a surface. Standalone steppers have no surface; they
are independent +/- button pairs on the page.

**Lifecycle:**
```
Trigger: click on an element matching isStepperPlus() or isStepperMinus()
         (the same patterns used by Dropdown's subAction classifier)

Active:  stay active and accumulate +/- clicks. Group by field identity:
         two buttons belong to the same field if they share an ancestor
         container (detected via ancestorClasses or a common parent).

Completion:
  - Click on a non-stepper element → completed (outside click)
  - Timeout (5s of inactivity) → completed
  - Flush (navigation) → completed (via shouldCompleteOnFlush)
```

**Field grouping:** The definition extracts the field name from:
1. Ancestor container's accessible name or aria-label
2. Adjacent label text
3. The counter display element (the number between + and −)

This reuses the same `extractStepperLabel()` logic from Dropdown (lines 121-170
of dropdown.ts), which already handles aria-label parsing, CSS selector
inference, and ancestor class extraction.

**SubAction model:** Each click is a subAction:
```
{ action: 'increment', field: 'Adults', delta: +1, runningTotal: 2 }
{ action: 'increment', field: 'Adults', delta: +1, runningTotal: 3 }
```

The IR bridge collapses these into a single step: "Set Adults to 3" → either
`fill()` if a target input exists, or `click()` on the + button 2 times.

### 3. Reuse vs New

**Reused:**
- `isStepperPlus()` / `isStepperMinus()` detection (from Dropdown)
- `extractStepperLabel()` field name extraction (from Dropdown)
- Pattern Registry stepper class patterns
- SubAction accumulation and dedup (addSubAction from Dropdown)
- shouldCompleteOnFlush pattern (from Scroll)

**New:**
- **Field grouping by ancestor proximity**: determining that two buttons
  belong to the same stepper group by checking their ancestor containers. This
  is new because Dropdown uses surface containment (surfaceId), but standalone
  steppers have no surface — grouping is by DOM proximity.
- **Running total tracking**: reading the counter display element after each
  click to track the current value. This needs the same post-click poll
  mechanism from event-tap.ts.

### 4. Generic / Framework-Independent

Stepper detection is via:
1. Element accessible name matching symbol patterns (+, −, +1, −1)
2. Element accessible name matching word patterns (add, increase, remove, decrease)
3. ARIA role="button" with aria-label containing increment/decrement language
4. Pattern Registry stepper CSS classes (GENERIC tier: add-btn, remove-btn,
   qty-btn, counter, stepper, plus, minus)

No domain-specific patterns in core detection.

### 5. Validation Plan

**Fixtures:**
1. Native +/- buttons with number display (vanilla HTML)
2. MUI ButtonGroup with +/− buttons
3. AntD InputNumber with stepper spinners
4. Bootstrap input-group with +/− addons
5. AdaniOne-style standalone stepper (div-based, no surface)

**Verified:** Click + three times on Adults → one interaction "Increment Adults
to 3" with delta=+3. Click + on Adults, then + on Children → two separate
interactions with correct field names.

### 6. Regression Risk

**Low.** The Stepper definition has priority 28 — it only triggers on elements
matching `isStepperPlus`/`isStepperMinus`. These patterns are specific enough
that generic clicks (on buttons, links, divs) won't trigger it. The main risk
is priority conflicts: if a stepper button is inside a Dropdown surface, Dropdown
(priority 20) claims it first as a subAction. This is correct behavior — the
Stepper definition is for standalone steppers only.

**Guard:** If the Stepper definition triggers on a +/- button that's inside an
active Dropdown/ModalDialog surface, the surface-owning session should claim it
first (via isInScope). The Stepper definition should check: if the event has a
surfaceId, defer to the surface-owning session.

### 7. Long-Term Vision Impact

Establishes **DOM-proximity grouping** — grouping independent clicks by their
ancestral relationship rather than surface containment. This pattern is reused
by: OTP/PIN input grouping (TI-06, adjacent inputs grouped), checkbox groups
(S7, checkboxes in the same fieldset), and radio groups without explicit
container semantics.

---

## Item 4: Rich Text Editor — EditorAdapter Interface

### 1. Why Tier 1

Rich text editors (Quill, Draft.js, Slate, TinyMCE, CKEditor) are used in every
CMS, email client, and content management interface. They are completely
unsupported: the TextEntry definition detects `contentEditable` elements but
extracts `element.value` (undefined for contentEditable), producing empty text
values. The entire interaction is silently lost.

This is Tier 1 because it introduces the **adapter pattern** — a pluggable
extension point for value extraction. Once the EditorAdapter interface exists,
supporting a new editor is a one-file addition (not a definition change).

### 2. Architectural Approach

**This is NOT a new definition.** It is an extension to TextEntry's value
extraction layer.

```typescript
// src/definitions/editor-adapters/types.ts
interface EditorAdapter {
  /** Does this adapter handle the given element? */
  matches(element: Element): boolean;
  /** Extract the editor's content as plain text */
  extractText(element: Element): string;
  /** Extract the editor's content as HTML (if supported) */
  extractHtml?(element: Element): string;
  /** Human-readable editor name for metadata */
  readonly name: string;
}
```

**Registration:** Adapters are registered in priority order. TextEntry's
`buildResult` checks: if the trigger element is `contentEditable`, iterate
adapters. First match wins. If no adapter matches, fall back to
`element.textContent`.

**Adapter chain:**

| Priority | Adapter | Detection | Extraction |
|----------|---------|-----------|------------|
| 1 | Quill | `.ql-editor` class | `.ql-editor.textContent` |
| 2 | Draft.js | `[data-contents]` attribute | `.textContent` of `[data-contents]` |
| 3 | Slate.js | `[data-slate-editor]` attribute | `.textContent` |
| 4 | TinyMCE | `iframe[tox-edit-area]` ancestor | `tinymce.activeEditor.getContent()` |
| 5 | CKEditor 5 | `.ck-editor__editable` class | `.ck-editor__editable.textContent` |
| 6 | ProseMirror | `.ProseMirror` class | `.ProseMirror.textContent` |
| 99 | Generic contentEditable | `contentEditable === 'true'` | `element.textContent` |

### 3. Reuse vs New

**Reused:**
- TextEntry lifecycle (focus → deferred blur → value capture)
- Deferred blur value reading
- Pattern Registry (can register editor class patterns)

**New:**
- **EditorAdapter interface** — a new extension point in the definition layer.
  This is the only genuinely new architectural concept. It establishes the
  precedent that definitions can have pluggable extraction strategies.
- **HTML value capture** — TextEntry currently captures plain text. Rich text
  editors need HTML/markdown output for accurate replay. This adds an optional
  `htmlValue` field to TextEntry metadata.

### 4. Generic / Framework-Independent

Each adapter detects its editor via **the editor's own published DOM structure**
(not CSS class heuristics). Quill always renders `.ql-editor`. Draft.js always
sets `data-contents`. Slate always sets `data-slate-editor`. These are stable
API contracts of the libraries, not website-specific patterns.

The generic fallback (adapter #99) handles any contentEditable element via
`textContent`, ensuring unknown editors still produce a value.

### 5. Validation Plan

**Fixtures:** One HTML page per editor with a known initial content and a known
edit. The test verifies:
- `matches()` returns true for the correct editor
- `extractText()` returns the expected content after editing
- TextEntry metadata includes the editor name and both text + HTML values
- The IR step generates a `fill()` with the extracted text

### 6. Regression Risk

**Zero risk to non-contentEditable interactions.** The adapter chain only runs
when `isContentEditable` is true on the trigger element. Regular `<input>` and
`<textarea>` elements are unaffected — they never enter the adapter chain.

**Risk to existing contentEditable support:** Currently, contentEditable produces
empty values (bug). The adapter chain can only improve this — the generic
fallback (`textContent`) is strictly better than the current `element.value`
(undefined).

### 7. Long-Term Vision Impact

Establishes the **pluggable adapter pattern** for definitions. Once TextEntry
has EditorAdapters, the same pattern serves:
- Code editors (Monaco, CodeMirror) — CodeAdapter interface
- Color pickers — ColorAdapter interface
- Any interaction where value extraction is framework-specific

This is the architectural precedent for extensibility without definition changes.

---

## Item 5: Slider Drag — Constrained-Axis Drag Tracking

### 1. Why Tier 1

The Slider definition currently captures clicks on slider handles but doesn't
track the drag. A user dragging a slider from 25% to 75% is recorded as a click
at the final position. For native `<input type="range">`, this is OK (Playwright's
`fill()` works). But for custom sliders (div-based, used by 80% of React/Vue
apps), the only way to set the value in Playwright is to drag the handle — and
the recorder doesn't capture enough information to replay the drag.

This is Tier 1 because sliders are common in filter UIs (price range, brightness,
volume), and the metadata gap (no start/end value, no drag trajectory) makes the
generated test code fail on custom sliders.

### 2. Architectural Approach

**Enhance the existing Slider definition** (priority 25), not a new definition.

Current Slider lifecycle: trigger on click/focus on slider handle → immediate
completion. No drag tracking.

Enhanced lifecycle:
```
Trigger: mousedown on element with role="slider", or input[type=range],
         or CSS class patterns (range-slider, slider-handle, ui-slider-handle)

Active:  track mousemove events. Calculate the value from handle position
         relative to the track. Use the same displacement tracking as DragDrop
         (mousedown → mousemove → mouseup), but constrained to one axis.

Completion:
  - mouseup → completed (final value from handle position)
  - If no mousemove between mousedown and mouseup (just a click) → completed
    with click-position value
```

**Value calculation:** The Slider definition needs the track element (parent of
the handle) and the handle's position within it. The value is:
```
percent = (handle.offsetLeft - track.offsetLeft) / track.offsetWidth
value = min + percent * (max - min)
```

For ARIA sliders, `aria-valuemin`, `aria-valuemax`, and `aria-valuenow` provide
the value directly — no position calculation needed.

**Relationship to DragDrop:** Slider and DragDrop both track mouse drags, but
they differ fundamentally:
- DragDrop: unconstrained 2D drag, source → target, produces element identity
- Slider: constrained 1D drag, produces a numeric value

The Slider should NOT delegate to DragDrop. It has its own completion semantics
(numeric value), its own metadata (min, max, value), and its own trigger
detection (role="slider"). The DragDrop drag-tracking code (mousemove →
displacement calculation) is a pattern to reuse, not a dependency.

### 3. Reuse vs New

**Reused:**
- Mouse drag tracking pattern (mousedown → mousemove → mouseup) from DragDrop
- Pattern Registry slider class patterns
- shouldCompleteOnFlush (for interrupted drags)

**New:**
- **Constrained-axis value calculation**: reading ARIA value attributes or
  computing position-to-value from DOM geometry. This is new logic not present
  in any existing definition.
- **Track element detection**: finding the slider track (parent container of
  the handle) to calculate position percentage. This uses DOM traversal
  (parentElement walk), not surface tracking.

### 4. Generic / Framework-Independent

Slider detection is via:
1. ARIA `role="slider"` (primary — standard, universal)
2. `<input type="range">` (standard HTML5)
3. Pattern Registry FRAMEWORK tier: `ui-slider-handle` (jQuery UI), `rc-slider`
   (React Slider), `MuiSlider` (MUI), `ant-slider` (AntD)

Value extraction:
1. ARIA: `aria-valuenow` (primary — instant, no geometry)
2. Native input: `element.value` (primary)
3. Geometry fallback: position percentage calculation (works for any visual
   slider, even without ARIA)

### 5. Validation Plan

**Fixtures:**
1. Native `<input type="range">` (vanilla HTML)
2. ARIA slider (`role="slider"` with `aria-valuenow`)
3. MUI Slider component
4. AntD Slider component
5. jQuery UI slider
6. Custom div-based slider (no ARIA, no framework classes)

**Verified:** Drag from 25% to 75% → Slider interaction with startValue=25,
endValue=75. Click at 50% → Slider with value=50. Keyboard arrow keys →
Slider with adjusted value.

### 6. Regression Risk

**Low.** The Slider definition (priority 25) only triggers on elements with
`role="slider"`, `input[type=range]`, or slider CSS classes. The enhancement
adds mousemove/mouseup tracking to the existing lifecycle — it doesn't change
when the definition triggers.

**Interaction with DragDrop (priority 15):** DragDrop triggers on mousedown on
non-excluded elements. Slider handles are not in DragDrop's exclusion list
(which excludes form controls and ARIA combobox/listbox/slider/checkbox/radio).
Wait — `slider` IS in the ARIA exclusion list! So DragDrop already excludes
elements with `role="slider"`. Good — no conflict.

**Guard:** Verify that `role="slider"` is in DragDrop's exclusion list (it
should be, based on the `isExcluded` function). If not, add it.

### 7. Long-Term Vision Impact

Establishes **geometry-based value extraction** — deriving a semantic value
(numeric position) from DOM geometry (pixel position). This pattern is reused
by: range sliders (dual-thumb), color picker sliders (hue/saturation), progress
bars (seek position), and any interaction where the user's intent is a position
or percentage, not an element identity.

---

## Item 6: Iframe Interaction — Cross-Context Event Capture

### 1. Why Tier 1

Cross-origin iframes (Stripe payment forms, embedded maps, third-party widgets)
block event propagation to the parent document. The content script's capture-
phase listeners never see events inside cross-origin iframes. This means entire
interaction flows — filling a credit card form, interacting with a Google Map,
using an embedded widget — are invisible to the recorder.

This is Tier 1 because: (a) it's the only Tier 1 item that requires
infrastructure rather than a definition change, (b) without it, the recorder
has a blind spot in one of the most critical user flows (payment), and (c) the
cross-context relay pattern is reused by any future multi-context recording
(popup windows, web workers, shared workers).

### 2. Architectural Approach

**This is an infrastructure change, not a definition change.** No new
ComponentDefinition. The change is in the content script layer.

**Architecture:**
```
┌─────────────────────────────────────────┐
│  Parent Page (main content script)       │
│                                           │
│  EventTap ← capture-phase listeners      │
│      ↓                                    │
│  Component Runtime                        │
│                                           │
│  IframeRelay ← postMessage listener      │
│      ↑                                    │
└──────┼───────────────────────────────────┘
       │ postMessage (cross-origin safe)
┌──────┼───────────────────────────────────┐
│  Iframe (injected relay script)          │
│                                           │
│  MiniEventTap ← capture-phase listeners  │
│      ↓                                    │
│  postMessage → parent IframeRelay         │
└─────────────────────────────────────────┘
```

**Implementation:**
1. The main content script detects iframes on the page (MutationObserver +
   initial scan)
2. For each iframe, it injects a **relay content script** via
   `chrome.tabs.executeScript` or manifest `all_frames: true`
3. The relay script runs a **mini EventTap** — the same capture-phase listeners
   as the main EventTap, but instead of calling `config.onEvent`, it serializes
   the ObservedEvent and `postMessage`s it to the parent
4. The parent's IframeRelay receives the message, deserializes the ObservedEvent,
   stamps it with `inIframe: true` and the iframe's identity, and feeds it to
   the Component Runtime

**Element identity inside iframes:** The iframe's DOM is a separate document.
CSS selectors and XPath are relative to the iframe's document, not the parent.
The relay script computes element identity the same way (extractIdentity), and
the parent's locator generation wraps it: `page.frameLocator('iframe#payment')
.locator('input[name=cardnumber]')`.

### 3. Reuse vs New

**Reused:**
- EventTap capture logic (the same listeners, the same ObservedEvent assembly)
- extractIdentity and extractDomContext (run inside the iframe)
- Component Runtime (processes iframe events identically to main-page events)
- IR bridge and Playwright renderer (already support iframe via `inIframe` flag)

**New:**
- **Relay content script**: a stripped-down version of the content script that
  runs inside iframes. It has EventTap but no runtime — it relays events to the
  parent.
- **IframeRelay in parent**: receives postMessages from iframe relays, stamps
  events with iframe identity, feeds to runtime.
- **Frame-aware locator generation**: Playwright's `frameLocator()` chaining.
  The IR bridge already has `inIframe: true` on element identity — the renderer
  needs to wrap locators in `page.frameLocator(selector).locator(...)`.
- **Iframe lifecycle tracking**: detecting when iframes are added/removed
  (MutationObserver), and cleaning up relay scripts.

### 4. Generic / Framework-Independent

Iframe event capture is **completely framework-independent** — it operates at
the browser DOM level. The same relay script works regardless of what's inside
the iframe (React, Angular, vanilla HTML, a third-party widget). The iframe's
content is opaque to the parent; only the standard DOM events cross the
boundary via postMessage.

### 5. Validation Plan

**Fixtures:**
1. Same-origin iframe (current behavior should already work — regression test)
2. Cross-origin iframe with a form inside
3. Nested iframes (iframe inside iframe)
4. Dynamically added iframe (MutationObserver detection)
5. Third-party widget (Stripe.js mock or embedded YouTube)

**Verified:** Clicks and text entry inside the iframe produce interactions with
correct target identity. Generated Playwright code uses `frameLocator()`. The
recorder follows the user as they move between parent and iframe.

### 6. Regression Risk

**Low for same-origin iframes.** The current content script already captures
events in same-origin iframes via capture-phase listeners on `document`. The
relay script only activates for cross-origin iframes (detected via
`iframe.contentWindow === null` or try/catch access).

**Risk area:** The relay script injection uses `chrome.tabs.executeScript` or
manifest `all_frames: true`. If the manifest changes to `all_frames: true`, the
content script runs in ALL frames — the parent script must detect whether it's
running in the top frame or a sub-frame and activate the relay vs. main logic
accordingly. This is a one-time `window.self === window.top` check.

**Guard:** Add a test that verifies same-origin iframe events are still captured
by the existing mechanism (not double-captured by the relay).

### 7. Long-Term Vision Impact

Establishes **multi-context event capture** — the ability to record interactions
across DOM context boundaries (iframes, popup windows, multiple tabs). This is
the foundation for:
- Popup window recording (OAuth flows, payment popups)
- Multi-tab recording (applications that span multiple tabs)
- Shadow DOM piercing (already partially supported via `composedPath()`, but the
  relay pattern formalizes cross-boundary capture)

Without iframe support, the recorder has a structural blind spot in payment,
authentication, and embedded-content flows — the most critical user journeys
for test automation.

---

## Cross-Cutting Concerns

### Implementation Sequencing

The six Tier 1 items have dependencies:

```
                    ModalDialog (1)
                   ╱              ╲
                  ╱                ╲
    Searchable Dropdown (2)    Standalone Stepper (3)
         │
    Rich Text Editor (4)    Slider Drag (5)    Iframe (6)
```

- **ModalDialog (1) first** — establishes the container lifecycle. Searchable
  Dropdown's text-in-surface logic and Stepper's DOM-proximity grouping both
  benefit from understanding container semantics.
- **Searchable Dropdown (2) and Stepper (3)** can proceed in parallel after (1).
- **Rich Text Editor (4), Slider (5), and Iframe (6)** are independent of each
  other and can proceed in any order after (1).

### Generic Design Principles (apply to all six)

1. **ARIA-first detection.** Every definition's primary trigger is an ARIA
   attribute or semantic HTML element. CSS class patterns are fallback only,
   registered in the Pattern Registry's FRAMEWORK tier.

2. **No domain-specific logic in definitions.** AdaniOne patterns, OXD patterns,
   and other website-specific patterns live in the Pattern Registry's DOMAIN
   tier, never in definition files.

3. **The downcast protocol is the safety net.** Every new definition must
   implement `downcast()` so that false-positive triggers convert to Click
   instead of vanishing. This is non-negotiable — it's how the recorder handles
   the inherent uncertainty of pattern-based detection.

4. **Metadata drives semantics, not new types.** Wherever possible, variants are
   expressed as metadata on an existing type (Click with sort metadata, Click
   with expand metadata) rather than new InteractionType values. This keeps the
   type system small and the adapter/IR/renderer layers simple.

5. **Every new lifecycle method needs a test.** If a definition adds
   `shouldCompleteOnFlush`, `downcast`, or any new behavior, there must be a
   unit test that verifies it in isolation before integration tests run.

### Regression Strategy (apply to all six)

1. **Before implementation**: run the full certification snapshot suite (once
   built) to establish a green baseline.
2. **During implementation**: run the specific definition's unit tests after
   every change.
3. **After implementation**: run the full suite. Any failure is a regression
   that must be fixed before merge.
4. **Priority conflict test**: for each new definition, verify it doesn't
   starve lower-priority definitions. Test: fire the new definition's trigger
   event, then immediately fire a lower-priority definition's trigger event.
   Both should produce interactions.
5. **Downcast test**: trigger the new definition falsely (e.g., click that
   doesn't open a modal), verify it downcasts to Click.
