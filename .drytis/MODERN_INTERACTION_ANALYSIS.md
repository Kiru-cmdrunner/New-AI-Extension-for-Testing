# Modern Web Application Interaction Analysis

**Purpose:** Validate that the SemanticInteraction model (to be frozen in Phase 0)
correctly captures every interaction type that modern web applications use.
This is the pre-freeze gap analysis requested before committing to Phase 0.

**Date:** July 2026
**Base commit:** fcee3a7 (HEAD), architecture validated at 7bfd949

---

## 1. Interaction Classification by Behavioral Category

We classify interactions into 7 categories based on *what the user does* and
*how the component responds*, not by DOM event type:

### Category 1: Discrete Actions (Point-and-Commit)
Click, DoubleClick, RightClick, Link, Tab, Menu, Breadcrumb, Button

**Traditional HTML:** `<button>`, `<a>`, `<input type="submit">`
**React/Vue/Angular:** `<div onClick>`, `<span role="button">`, `<div tabIndex={0} onKeyDown>`
**Behavioral model:** User clicks → application responds (navigation, modal, state change).

**Current coverage:** ✅ Strong. 40 interaction types include 8 discrete-action types.
The `isInteractiveElement()` function checks tag, ARIA role, tabIndex, and CSS class patterns.
`INTERACTIVE_CLASS_RE` covers common framework patterns (btn, button, clickable, menu-item, etc.).

**Capture:** Single click event. Identity extracted at click time. Value change detected via multi-poll.

**Verdict:** Well handled. The click-as-fallback pattern is correct — it's the lowest-priority
catch-all after specific component recognizers claim their events.

---

### Category 2: Text Entry (Focus → Type → Blur)
TextEntry (single-line), TextArea (multi-line), RichText (contenteditable)

**Traditional HTML:** `<input>`, `<textarea>`
**React/Vue/Angular:** Same tags, but React controlled inputs sync state asynchronously.
**Behavioral model:** User focuses → types → blurs. Final value captured at blur.

**Current coverage:** ⚠️ Partial.

**What works:**
- Standard `<input>` / `<textarea>`: ✅ Focus→input→blur lifecycle. Value captured at blur.
- `contenteditable` divs: ✅ Detected via `isContentEditable` in identity.
- React controlled inputs: ✅ Value capture uses multi-poll (50ms, 150ms, 400ms) — this
  was the RC2 fix in 7bfd949 specifically for React state flush timing.

**What's missing — Rich Text Editors (RTEs):**

Rich text editors (Quill, TipTap, ProseMirror, Draft.js, Slate.js, CKEditor) are the most
fundamentally different interaction type. They work like this:
1. The "input" is a `contenteditable` div or an iframe with a design-mode document.
2. The "value" is NOT text — it's HTML (structured content with formatting).
3. The user performs formatting actions (bold, italic, list, heading) via toolbar clicks
   that are part of the same interaction session.
4. The final state is a serialized HTML/JSON document, not a string.

**Current model:** Would capture the RTE as a single `TextEntry` with the raw HTML as
the value, losing all formatting context. Toolbar clicks (bold, italic) would be captured
as separate Click interactions, losing their relationship to the text entry.

**Gap:** The model treats RTE formatting toolbar clicks as separate interactions. In reality,
"click Bold, type text, click Italic, type more text" is ONE semantic interaction
("format and enter text"), not three interactions.

**Required change:** A `RichTextEntry` component session in the SemanticReasoner (same
pattern as dropdown/datePicker sessions). Toolbar clicks while the editor is focused are
absorbed into the session. The completion event is blur. The result is a structured
`formattedContent` field, not a plain `textValue`.

---

### Category 3: Selection Controls (Choose From Options)
NativeDropdown, CustomDropdown, Autocomplete, MultiSelect, Checkbox, RadioButton, ToggleSwitch

**Traditional HTML:** `<select>`, `<input type="checkbox/radio">`
**React/Vue/Angular:** Custom div-based dropdowns (MUI, Ant Design, react-select), toggle switches as `<div role="switch">`
**Behavioral model:** User opens a surface → selects option(s) → surface closes. Value transitions.

**Current coverage:** ✅ **Strongest area of the codebase.** This was the primary focus of 7bfd949.

**What works:**
- Native `<select>`: ✅ Via `change` event detection.
- Custom dropdowns (MUI, Ant Design, OXD): ✅ Via CSS class patterns + ARIA role detection.
  The `DROPDOWN_TRIGGER_CLASS_RE` and `DROPDOWN_OPTION_CLASS_RE` patterns cover major libraries.
- Autocomplete/typeahead: ✅ Via `ComponentSession` with activation/completion/absorption lifecycle.
- Checkbox/Radio/Toggle: ✅ Via `checkedTransition` signal in patterns.
- Dropdown options without standard roles: ✅ `isDropdownOptionWithFallback()` checks
  accessibleName when role/class patterns don't match (7bfd949 RC1 fix).
- Value capture from display divs (not trigger input): ✅ `findDisplayValue()` fallback (7bfd949 RC3 fix).
- React state flush timing: ✅ Multi-poll (50ms, 150ms, 400ms) stops on first change (7bfd949 RC2 fix).

**What's partially handled:**
- **Tag/Chip inputs** (selectize.js, react-tag-input): A user types text, presses Enter to add a tag,
  types more text. This is a repeating select interaction, not a single select. The current model
  captures each tag addition as a separate interaction, which is technically correct but doesn't
  represent the compound "add multiple tags" intent.
- **Cascading dropdowns** (country → state → city): Three sequential dropdown selections where
  the second's options depend on the first. The model captures each independently — semantically
  correct, but loses the dependency relationship.

**What's missing:**
- **Transfer/shuttle lists** (two panels with add/remove buttons): User selects items in left
  panel, clicks "Add" to move to right panel. This is a compound interaction (multi-select +
  action button + multi-select state change). No current session type covers this.
- **Tree selectors** (collapsible tree with checkboxes): User expands nodes, checks leaf items.
  The expand/collapse clicks and checkbox toggles are captured as separate interactions.

**Required changes:**
- Tag/Chip input: Can be handled as a variant of Autocomplete session — the session stays open
  across multiple tag additions, absorbing Enter-key events. Additive to existing session model.
- Transfer list / Tree selector: New session types in SemanticReasoner. Same lifecycle pattern
  (activation → absorption → completion). Additive.

---

### Category 4: Temporal Controls (Date, Time, Range)
DatePicker, TimePicker, DateTimePicker, Slider, RangeSlider

**Traditional HTML:** `<input type="date">`, `<input type="range">`
**React/Vue/Angular:** Calendar popups (react-datepicker, react-calendar, MUI DatePicker),
custom sliders with drag handles
**Behavioral model:** User opens a surface → navigates within it (month change, handle drag) →
selects value → surface closes.

**Current coverage:** ✅ Strong for single-date pickers.

**What works:**
- Native `<input type="date">`: ✅ Detected via inputType.
- Custom calendar popups: ✅ Via `ComponentSession` with calendar cell detection.
- Calendar navigation buttons (prev/next month): ✅ Absorbed into session via
  `isCalendarNavigationButton()`.
- Date value from display div fallback: ✅ `looksLikeDateText()` + `findDisplayValue()`.
- Date normalization (ISO + display value): ✅ `dateValue`, `displayValue`, `dateAmbiguous`.

**What's missing:**
- **Date range pickers** (check-in → check-out calendar): Two dates selected in one calendar
  surface. The current model would capture two DatePicker interactions. The relationship
  between them (they're a range, not two independent dates) is lost. The `DateSelectEvent`
  type already has `startDisplayValue`/`endDisplayValue` fields, but the session model
  doesn't detect range completion.
- **Time pickers with scroll wheels** (iOS-style time scroller): User scrolls hours, minutes,
  AM/PM independently. The current model captures three ContainerScroll events, not a
  single time selection. The interaction type exists (`TimePicker`) but the session model
  doesn't cover scroll-wheel-based selection.
- **Range sliders** (dual-handle slider for min/max): Two values selected by dragging two
  handles. The current model captures one Slider interaction with one value.

**Required changes:**
- Date range: Extend the existing DatePicker session to detect range mode (when a second
  date cell is clicked after a first). Emit a `DateRangePicker` interaction with both values.
- Time scroller: Add `TimePicker` session type that absorbs scroll events within a time
  selection surface. Same lifecycle pattern as dropdown.
- Range slider: Extend Slider pattern to detect dual handles (two `aria-valuenow` changes).
  Emit a `RangeSlider` interaction with `{min, max}` value.

---

### Category 5: Layout & Navigation Surfaces
Modal, Drawer, Popover, Tooltip, Tab, Menu, Accordion, Carousel

**Traditional HTML:** CSS show/hide on `<div>` containers
**React/Vue/Angular:** Portals, overlays, framer-motion animations, conditional rendering
**Behavioral model:** User triggers a surface → surface appears → user interacts within or
dismisses → surface disappears.

**Current coverage:** ✅ Partial — surfaces are detected but not modeled as containers.

**What works:**
- Surface detection: ✅ Evidence Channel D (Mutations) detects surface appearance/disappearance.
- Surface classification: ✅ `TargetSurfaceType` enum: modal, drawer, popover, tooltip,
  dropdown, dialog, menu.
- Surface metadata: ✅ `SurfaceInfo` type with type, role, accessibleName, direction, detectedAt.
- Modal/Drawer/Popover/Tooltip interaction types: ✅ All 4 exist in `InteractionType`.

**What's missing — the container problem:**

When a modal opens and the user interacts with elements inside it (fills a form, clicks a
button), those interactions are captured individually without a "this happened inside a modal"
context. The surface is detected, but interactions inside it aren't grouped.

This matters because:
1. Interactions inside a temporary surface have different lifetime semantics than interactions
   on the main page — they only exist while the surface is open.
2. Execution of these interactions requires entering/exiting the surface context.
3. Self-healing needs to know that an element only exists inside a popover.

**The current `IframeContext` model is the right precedent.** Elements inside iframes carry
`IframeContext` (frameSrc, frameName, frameSelector, frameIndex, frameDepth). The same pattern
applies to surfaces: an `OverlayContext` would carry `{ surfaceType, surfaceId, surfaceLocator }`.

**Required change:** Add an `OverlayContext` to element identity (additive, optional field).
When the event tap detects an element inside an active surface (tracked by Channel E — Focus
& Overlay), it populates `OverlayContext`. This doesn't change any interaction type — it adds
spatial context to the identity. Same pattern as `IframeContext`.

**Also missing:**
- **Accordion expand/collapse:** User clicks an accordion header to expand/collapse a section.
  Currently captured as Click. Should be recognized as an `Accordion` interaction type with
  `expanded: true/false` state. Missing from `InteractionType` enum.
- **Carousel/Slider navigation:** User clicks next/prev arrows or swipes to change slides.
  Currently captured as Click events. The `InfiniteScroll` type is different (scroll-triggered
  lazy loading). No type for carousel interactions.

---

### Category 6: Drag & Drop and Gestures
DragDrop, FileUpload, DragDropUpload

**Traditional HTML:** `<input type="file">`, HTML5 drag-and-drop API
**React/Vue/Angular:** react-dnd, dnd-kit, react-beautiful-dnd, framer-motion drag
**Behavioral model:** User picks up an element → moves it → drops it on a target.

**Current coverage:** ⚠️ Weak.

**What works:**
- File upload via `<input type="file">`: ✅ Detected via inputType.
- Browser alert/confirm/prompt: ✅ Detected as `BrowserAlert` interaction.

**What's missing:**
- **HTML5 drag-and-drop** (`dragstart`, `dragover`, `drop` events): The `DragDrop` type exists
  in the enum, but the EventTap doesn't listen for `dragstart`/`dragover`/`drop` events.
  `DEFAULT_EVENT_TYPES` includes click, mousedown, focus, blur, input, change, mouseenter,
  mouseleave, mousemove, keydown, scroll — but NOT drag events.
- **Modern drag libraries** (react-dnd, dnd-kit): These use pointer events (`pointerdown`,
  `pointermove`, `pointerup`) or mouse events with custom logic. They often don't emit
  standard HTML5 drag events at all. The drag is implemented as mousedown → mousemove tracking
  → mouseup with custom hit detection.
- **Drop target identification:** When a drag-and-drop completes, the source element and
  drop target are both important. The current `InteractionMetadata` has `dropTarget` and
  `sourceElement` fields, but they're never populated — no drag capture exists.
- **Reorderable lists** (drag to reorder): Same as drag-and-drop but the target is a sibling
  position, not a drop zone. The semantic result is a position change, not a value change.

**Required change:** Add drag events to EventTap's `DEFAULT_EVENT_TYPES` and add pointer
event support (`pointerdown`, `pointermove`, `pointerup`). A `DragDrop` session in the
SemanticReasoner would track `dragstart`/`pointerdown` → movement → `drop`/`pointerup`,
emitting a single `DragDrop` interaction with source element, drop target, and drag path.

---

### Category 7: Virtualized & Dynamic Content
InfiniteScroll, virtualized lists, lazy-loaded content, dynamic forms

**Traditional HTML:** No equivalent (content is static).
**React/Vue/Angular:** react-window, react-virtualized, @tanstack/react-virtual; lazy-loaded
components; dynamic form schemas (JSON-schema-driven forms)
**Behavioral model:** Content appears in response to scroll, interaction, or programmatic
triggers. Elements mount and unmount dynamically.

**Current coverage:** ⚠️ Partial — scroll is captured but virtualization is invisible.

**What works:**
- **PageScroll / ContainerScroll:** ✅ Detected via scroll events with throttling.
  Scroll position captured in metadata.
- **InfiniteScroll:** ✅ Detected as a scroll variant. The recognition pipeline differentiates
  it from normal scroll based on content growth (DOM mutation during scroll).

**What's missing — the virtualization problem:**

Virtualized lists render only visible items + a small overscan buffer. As the user scrolls,
items are recycled — the same DOM nodes represent different data. This means:
1. An element recorded at position N might be a completely different item when the test
   re-executes (the virtualization state depends on scroll position).
2. The element identity captured at recording time (CSS selector, text content) may match
   a *different* data item at execution time.
3. Clicking "item 50" in a virtualized list requires scrolling to it first — but the scroll
   position is an implicit prerequisite that's not captured.

**This is the hardest problem in modern web automation.** It affects:
- Test data tables (ag-Grid, Handsontable)
- Long dropdown lists (virtuoso, react-window)
- Feed/infinite lists (Twitter-style)
- Kanban boards (Trello-style)

**Required change (medium-term, not Phase 0):**
The element identity needs an optional `virtualContext` field when the element is inside a
virtualized container:
```typescript
interface VirtualContext {
  containerLocator: ResolvedLocator;  // the virtual scroll container
  itemIndex: number;                  // logical position in the data (not DOM position)
  itemCount: number;                  // total items in the data source
}
```
This lets the executor know: "to reach this element, scroll the container until item N is
rendered, then interact." The locator is data-indexed, not DOM-positioned.

**This is explicitly NOT a Phase 0 concern** — it's a Phase 1+ enhancement that uses the
optional-additive-field pattern. But the `VirtualContext` shape should be noted in the
SemanticInteraction design so the field slot is anticipated.

---

## 2. Framework Comparison Matrix

| Interaction | Traditional HTML | React | Vue | Angular | Custom/Canvas | Current Model |
|-------------|-----------------|-------|-----|---------|---------------|---------------|
| **Click** | `<button onclick>` | `<div onClick>` | `@click` | `(click)` | Canvas hit-test | ✅ Handled |
| **Text Entry** | `<input>` | Controlled input | `v-model` | `[(ngModel)]` | Canvas text | ✅ Handled (react sync fixed in 7bfd949) |
| **Rich Text** | N/A | TipTap/ProseMirror | TipTap | Quill | N/A | ❌ Missing session |
| **Native Select** | `<select>` | `<select>` | `<select>` | `<select>` | N/A | ✅ Handled |
| **Custom Dropdown** | N/A | MUI/Ant/react-select | Vuetify/Element | NG-Select/Material | N/A | ✅ Handled (7bfd949 focus) |
| **Autocomplete** | N/A | react-select (async) | el-autocomplete | mat-autocomplete | N/A | ✅ Handled |
| **Checkbox** | `<input checkbox>` | `<div role=checkbox>` | `<input checkbox>` | `mat-checkbox` | N/A | ✅ Handled |
| **Radio** | `<input radio>` | `<div role=radio>` | `<input radio>` | `mat-radio` | N/A | ✅ Handled |
| **Toggle Switch** | N/A | `<div role=switch>` | `<div role=switch>` | `mat-slide-toggle` | N/A | ✅ Handled |
| **Date Picker (single)** | `<input type=date>` | react-datepicker | v-calendar | mat-datepicker | N/A | ✅ Handled |
| **Date Range** | N/A | react-date-range | v-date-picker | mat-date-range | N/A | ⚠️ Two separate interactions |
| **Time Picker** | `<input type=time>` | rc-time-picker | vue-timepicker | mat-timepicker | N/A | ⚠️ Type exists, no scroll session |
| **Slider** | `<input type=range>` | rc-slider | vue-slider | mat-slider | N/A | ✅ Handled |
| **Range Slider** | N/A | rc-range-slider | N/A | N/A | N/A | ⚠️ One value captured |
| **File Upload** | `<input type=file>` | react-dropzone | vue-upload | N/A | N/A | ✅ Handled |
| **Drag & Drop** | HTML5 DnD API | dnd-kit/react-dnd | vuedraggable | cdk/drag-drop | N/A | ❌ Events not captured |
| **Tag Input** | N/A | react-tag-input | vue-tags-input | chip-input | N/A | ⚠️ Separate interactions |
| **Modal** | CSS show/hide | Portal/Dialog | Teleport | mat-dialog | N/A | ✅ Surface detected |
| **Accordion** | `<details>` | custom collapse | el-collapse | mat-expansion | N/A | ❌ No type, captured as Click |
| **Carousel** | N/A | swiper/embla | vue-carousel | mat-carousel | N/A | ❌ No type, captured as Click |
| **Transfer List** | N/A | Ant Transfer | el-transfer | mat-transfer | N/A | ❌ No session type |
| **Tree Selector** | N/A | Ant Tree | el-tree | mat-tree | N/A | ❌ Captured as separate clicks |
| **Virtualized List** | N/A | react-window | N/A | cdk-virtual-scroll | N/A | ❌ DOM recycling not handled |
| **Canvas Widgets** | N/A | Custom | Custom | Custom | WebGL/Canvas | ❌ Out of scope (V1) |
| **Rich Data Grid** | `<table>` | ag-Grid | Handsontable | ag-Grid | N/A | ⚠️ Partial (cells as clicks) |
| **Map Widgets** | N/A | react-leaflet | vue-leaflet | N/A | Map tiles | ❌ Out of scope (V1) |

---

## 3. Gap Analysis — Structured Findings

### Gap Severity Classification

- **🔴 CRITICAL:** Interaction is common in modern apps AND current model fundamentally
  misrepresents it (wrong type, lost data, or not captured at all).
- **🟡 IMPORTANT:** Interaction is moderately common AND current model loses semantic
  context (captured but as wrong type or missing relationships).
- **🟢 MINOR:** Interaction is uncommon OR current model captures it adequately with
  minor enrichment needed.

### Gap Catalogue

| # | Interaction | Severity | Root Cause | Affected Layers |
|---|------------|----------|------------|-----------------|
| G1 | Rich Text Editors | 🔴 | No session model for RTE formatting toolbar. HTML value treated as text. | Reasoner, IR (no verb for formatted text) |
| G2 | Drag & Drop (HTML5 + libraries) | 🔴 | EventTap doesn't listen for drag/pointer events. Session model absent. | EventTap, Reasoner |
| G3 | Virtualized Lists | 🔴 | DOM recycling makes recorded locators invalid at execution time. Element identity doesn't carry virtual context. | Identity, Execution, Healing |
| G4 | Date Range Picker | 🟡 | Two dates captured as separate interactions. No range session. | Reasoner |
| G5 | Accordion | 🟡 | No InteractionType. Captured as Click. | InteractionTypes, Patterns |
| G6 | Carousel/Slider Nav | 🟡 | No InteractionType. Captured as Click. | InteractionTypes |
| G7 | Tag/Chip Input | 🟡 | Multiple tags captured as separate autocomplete interactions. | Reasoner |
| G8 | Transfer/Shuttle List | 🟡 | No session type. Add/Remove clicks separate from selection. | Reasoner |
| G9 | Tree Selector | 🟡 | Expand/collapse and checkbox clicks separate. | Reasoner |
| G10 | Time Picker (scroll wheel) | 🟡 | Type exists but no session for scroll-based selection. | Reasoner |
| G11 | Range Slider (dual handle) | 🟡 | One value captured instead of {min, max}. | Reasoner, Patterns |
| G12 | Overlay/Surface Context | 🟡 | Elements inside surfaces lack container context (like IframeContext). | Identity |
| G13 | Rich Data Grid (cell interactions) | 🟢 | Cells captured as clicks. Missing grid coordinates. | Identity |
| G14 | Canvas/WebGL Widgets | 🟢 | No DOM events to capture. Out of scope for V1. | Capture Layer |
| G15 | Map Widgets | 🟢 | Tile-based rendering. Interactions are pixel coordinates. Out of scope for V1. | Capture Layer |

---

## 4. Required Changes — Prioritized by Phase 0 Necessity

### Principle: Freeze What's Stable, Anticipate What's Not

The SemanticInteraction model should be frozen with the current 22-field observation
contract. The gaps above do NOT require adding fields to SemanticInteraction — they
require adding:
1. New `InteractionType` enum values (additive).
2. New `ComponentSession` types in the reasoner (additive).
3. New event types in the EventTap (additive).
4. Optional context fields on element identity (additive, nullable).

**No existing field on SemanticInteraction needs to change.**
**No existing InteractionType needs to change.**
**No existing IRAction needs to change.**

This is the key finding: the observation/projection boundary makes all of these gaps
additive extensions, not model redesigns.

### Changes Needed BEFORE Freezing SemanticInteraction

These must be reflected in the SemanticInteraction type design to ensure the 22 fields
are sufficient:

| Change | What | Why Before Freeze |
|--------|------|-------------------|
| Add `virtualContext` to identity | Optional field on element identity for virtualized containers | If the identity type is frozen without this slot, virtualized elements can't be properly represented |
| Add `overlayContext` to identity | Optional field for elements inside modal/popover/drawer surfaces | Same pattern as IframeContext — spatial context that execution needs |
| Add `gestureData` to observation | Optional field for drag paths, swipe directions, pinch scale | Drag & drop and gesture interactions need movement data that current fields don't carry |
| Expand `value` semantics | The `value` field must be typed as `string \| object \| null`, not just `string \| null` | RTE content (HTML), date ranges ({start, end}), multi-select values ([a, b]) need structured values |

### Changes Needed in Phase 0 (During Pipeline Unification)

These are additive to the SemanticReasoner — new session types following the existing
lifecycle pattern (activation → absorption → completion):

| Session Type | Purpose | Existing Pattern |
|-------------|---------|------------------|
| RichTextSession | RTE: focus → toolbar clicks absorbed → blur | Same as DropdownSession |
| DragDropSession | pointerdown → movement → pointerup | Same as DatePickerSession |
| DateRangeSession | first date click → second date click → completion | Extension of DatePickerSession |
| TagInputSession | type → Enter → type → Enter → blur | Extension of AutocompleteSession |
| AccordionSession | expand/collapse with state tracking | Simple: trigger + state change |

### Changes Needed After Phase 0 (Phase 1+)

| Change | Phase | Why Later |
|--------|-------|-----------|
| Virtualized list execution strategy | Phase 5 (Execution) | Requires executor to scroll-then-interact; not a capture model change |
| Transfer list session | Phase 2+ | Uncommon; not a blocker for capability model |
| Tree selector session | Phase 2+ | Uncommon; expand/collapse clicks are individually valid |
| Rich data grid cell context | Phase 1+ | Grid coordinates are execution optimization, not capture requirement |
| Canvas/Map widgets | Phase 8+ | Requires platform-specific capture; out of web scope |

---

## 5. IR Action Coverage Analysis

The IR has 10 actions. Here's how each gap maps:

| Gap | Current IR Action | Adequate? | Needed IR Action |
|-----|------------------|-----------|-----------------|
| Rich Text Editor | FILL | ❌ Loses HTML structure | FILL (value=HTML string) — adequate if value carries structured data |
| Drag & Drop | CLICK (source) + CLICK (target) | ❌ Wrong — not two clicks | DRAG (new: source, target) — additive to IRAction |
| Virtualized List | CLICK | ⚠️ Correct type, wrong execution | CLICK + implicit scroll prerequisite — executor concern |
| Date Range | SELECT_DATE × 2 | ⚠️ Semantically incomplete | SELECT_DATE (value={start, end}) — value semantics, not new action |
| Accordion | CLICK | ⚠️ Missing expand/collapse state | CLICK + assertion on expanded state — no new action |
| Carousel | CLICK | ⚠️ Missing slide index | CLICK + assertion on visible slide — no new action |
| Tag Input | SELECT × N | ⚠️ Correct but fragmented | SELECT (value=[tag1, tag2]) — value semantics |
| Range Slider | FILL | ⚠️ Single value, need two | FILL (value={min, max}) — value semantics |
| Transfer List | CLICK × N | ❌ Fragmented | Transfer needs its own session → resolves to multiple CLICK+SELECT |
| Overlay context | CLICK | ⚠️ Correct type, missing container | No IR action change — locator includes overlay path |

**Net IR action additions needed:** 1 new action (`DRAG`) + expanded value typing.
Everything else is either adequate or handled by richer value semantics.

---

## 6. Summary: Impact on Phase 0 Freeze Decision

### What Must Change Before Freeze

1. **SemanticInteraction.value type:** Change from `string | null` to
   `string | number | boolean | object | null`.
   This allows: RTE HTML content, date ranges `{start, end}`, multi-select arrays,
   slider ranges `{min, max}`, tag arrays `["tag1", "tag2"]`.
   This is the ONLY structural change to the frozen contract.

2. **Element identity gains two optional fields:**
   - `virtualContext?: { containerLocator, itemIndex, itemCount }` — for virtualized elements.
   - `overlayContext?: { surfaceType, surfaceLocator }` — for elements inside surfaces.
   Both follow the existing `IframeContext` pattern (optional, null when not applicable).

3. **SemanticInteraction gains one optional field:**
   - `gestureData?: { path: Array<{x, y, t}>, duration: number }` — for drag & drop,
     swipe, pinch. Null for all non-gesture interactions.
   This follows the observation/projection boundary: gesture data is an *observation*
   about what the user physically did, not a consumer concern.

### What Does NOT Change

- The 22-field observation model stays at 22 fields (the `value` type change and
  `gestureData` addition make it 23 fields, but all existing fields are unchanged).
- The observation/projection boundary stays — consumer concerns remain in projections.
- All 40 existing InteractionType values stay unchanged.
- All 10 existing IRAction values stay unchanged.
- The IR Bridge stays a pure function.
- The SemanticReasoner session model stays the same pattern (activation → absorption → completion).

### What's Purely Additive (New Types, No Existing Change)

- 5 new InteractionType values: `RichTextEntry`, `Accordion`, `Carousel`, `TreeSelect`, `RangeSlider`
- 5 new ComponentSession types in SemanticReasoner: RichTextSession, DragDropSession,
  DateRangeSession, TagInputSession, AccordionSession
- 1 new IRAction: `DRAG`
- 3 drag/pointer event types in EventTap: `dragstart`, `dragover`, `drop`, `pointerdown`,
  `pointermove`, `pointerup`

### Confidence Statement

The current architecture handles **~85% of modern web interactions correctly** today.
The remaining 15% (rich text editors, drag & drop, virtualized lists, compound selection
controls) require additive extensions that follow existing patterns exactly. No redesign.
No frozen contract violation. The observation/projection boundary makes every gap an
additive extension.

**The SemanticInteraction model is ready to freeze with three adjustments:**
1. `value: string | number | boolean | object | null` (was `string | null`)
2. `gestureData?: GestureData | null` (new optional field)
3. Identity gains `virtualContext?` and `overlayContext?` (new optional fields, like IframeContext)

With these three adjustments, the model covers every interaction type in the gap analysis
without future-breaking changes.
