# Comprehensive Interaction Taxonomy

> **Purpose**: Complete catalogue of every generic interaction pattern in modern web
> applications, with lifecycle analysis, reuse mapping, and implementation priority.
> This document drives systematic implementation — patterns are built by
> architectural complexity, not discovered one website at a time.

---

## Architecture Primer: The Component Lifecycle Model

Every interaction in the recorder is a `ComponentDefinition` — a state machine with
this lifecycle:

```
                     detectTrigger(event)
                     → returns ComponentTrigger
                              │
                     ┌────────▼────────┐
                     │     active       │  ← isInScope / handleEvent / accumulate
                     │  (ctx.data bag)  │     called for each event
                     └────────┬────────┘
                              │
              ┌───────────────┼───────────────┐
              │               │               │
         handleEvent     shouldCancel     flush() /
         returns         OnOutside        timeout
         completion      → abandoned      → interrupted
         → completed          │                │
              │               │                │
              │          downcast?         downcast?
              │          → Click           → Click
              │          (if empty)        (if empty)
              ▼               ▼                ▼
        ┌─────────────────────────────────────────┐
        │          buildResult → metadata          │
        │          → ComponentInteraction emitted  │
        └─────────────────────────────────────────┘
```

**Key infrastructure available for reuse:**

| Mechanism | What it does | Where |
|-----------|-------------|-------|
| **Surface tracking** | Portal-rendered panels (modals, dropdowns, popovers) get a stable `surfaceId`. Sessions bind to surfaces. Outside-click closes surface-bound sessions. | `component-runtime.ts` surfaceStack |
| **SubActions** | A compound interaction accumulates ordered sub-actions (selectOption, increment, decrement, toggle, fillInput, confirm). | `dropdown.ts` classifySubAction |
| **Downcast protocol** | A false-positive trigger from a high-priority definition converts to Click instead of vanishing. | `completeComponent` |
| **Concurrent sessions** | When a new trigger conflicts with an active session on a different surface, the old session is interrupted/completed. | `resolveConcurrentSessions` |
| **Stale cleanup** | Components older than 15s are abandoned automatically. | `cleanupStaleComponents` |
| **Pattern Registry** | Three-tier CSS/ARIA pattern matching: GENERIC → FRAMEWORK → DOMAIN. | `pattern-registry.ts` |

---

## Category 1: Dropdowns & Selection Lists

### Variant Catalogue

| ID | Variant | How it differs | Trigger | Completion | Surface? |
|----|---------|---------------|---------|------------|----------|
| **DD-01** | Native `<select>` | HTML select element, OS-rendered dropdown | click on SELECT | `change` event | No (OS overlay) |
| **DD-02** | Custom dropdown (div-based) | React/Vue/Angular component, portal panel | click on trigger div | option click OR outside click | Yes |
| **DD-03** | Searchable dropdown / typeahead | Text input filters options as you type | click on combobox input | option click OR Enter | Yes (suggestion list) |
| **DD-04** | Multi-select dropdown | Multiple options selectable, values show as chips | click on trigger | done button OR outside click | Yes |
| **DD-05** | Checkbox dropdown | Options are checkboxes inside a panel | click on trigger | done button OR outside click | Yes |
| **DD-06** | Tag / chip selector | Type text → Enter creates a tag → repeat | focus on input | Enter / comma / blur | No (inline) |
| **DD-07** | Configuration dropdown | Panel contains steppers, toggles, radio groups | click on trigger | done button | Yes |
| **DD-08** | Cascading / nested dropdown | Select in dropdown A populates dropdown B | click on trigger A | each dropdown completes independently | Yes (sequential) |
| **DD-09** | Tree dropdown | Expandable tree nodes inside a dropdown panel | click on trigger | node selection OR outside click | Yes |
| **DD-10** | Virtualized dropdown | Options rendered in a virtual scroller (react-window) | click on trigger | option click | Yes (virtual list) |
| **DD-11** | Async / lazy-loaded dropdown | Options fetched from server on open or search | click on trigger | option click (after loading) | Yes (loading state) |
| **DD-12** | Split-button dropdown | Button + caret: click button = primary action, click caret = dropdown | click on caret | option click | Yes |
| **DD-13** | Command palette | Cmd+K → search → select command | keyboard shortcut | command selection | Yes (overlay) |
| **DD-14** | Autocomplete with free text | Typeahead that allows custom values not in the list | focus on input | option click OR blur with typed value | Yes |

### Lifecycle Grouping

**Group A — Simple Select (immediate completion):**
DD-01 (native), DD-02 (custom, single-select), DD-10 (virtualized), DD-11 (async)

These share one lifecycle: trigger → surface opens → single option click → complete.
The only difference is HOW options arrive (static DOM, virtual window, async fetch).
The existing Dropdown definition already handles DD-01 and DD-02. DD-10 and DD-11
need no lifecycle changes — options just appear via DOM mutation.

**Group B — Text-Filtered Select:**
DD-03 (searchable), DD-13 (command palette), DD-14 (autocomplete with free text)

These share: trigger → text entry inside surface → filtered options appear →
option click → complete. This is a **compound lifecycle**: TextEntry runs INSIDE
a Dropdown surface. The current architecture handles this via subActions
(`fillInput` + `selectOption`), but the text-entry-in-surface path needs explicit
support — the TextEntry definition must NOT compete with the Dropdown for focus
events inside the surface.

**Group C — Multi-Selection Panel:**
DD-04 (multi-select), DD-05 (checkbox dropdown), DD-07 (configuration)

These share: trigger → surface opens → multiple interactions (clicks, toggles,
steppers) → done button OR outside click → complete. **Already implemented**
via the Dropdown multi-config infrastructure (subActions, isMultiConfig).

**Group D — Independent Tag Input:**
DD-06 (tag/chip selector)

Unique lifecycle: focus → type → Enter/comma → tag created → repeat → blur.
This is NOT a dropdown — it's a TextEntry variant that produces discrete tokens.
Needs its own definition or a TextEntry sub-mode.

**Group E — Hierarchical:**
DD-08 (cascading), DD-09 (tree dropdown)

DD-08 is two sequential independent dropdowns — no new lifecycle needed.
DD-09 needs expand/collapse tracking inside the surface, similar to accordion
nodes inside a dropdown.

### Reuse Analysis

| Variant | Reuse existing model? | What's needed |
|---------|----------------------|---------------|
| DD-01 Native | ✅ Dropdown definition | Done |
| DD-02 Custom | ✅ Dropdown definition | Done |
| DD-03 Searchable | 🔶 Dropdown + TextEntry sub-action | Allow TextEntry inside surface without competing for focus |
| DD-04 Multi-select | ✅ Dropdown multi-config | Done (isMultiConfig) |
| DD-05 Checkbox dropdown | ✅ Dropdown multi-config | Done |
| DD-06 Tag selector | ⬜ New: TagInput definition | New lifecycle (token creation on Enter/comma) |
| DD-07 Configuration | ✅ Dropdown multi-config | Done |
| DD-08 Cascading | ✅ Sequential Dropdowns | No change — each is independent |
| DD-09 Tree dropdown | 🔶 Dropdown + tree expansion | Add expand/collapse subAction type |
| DD-10 Virtualized | ✅ Dropdown definition | No change — DOM mutation handles it |
| DD-11 Async | ✅ Dropdown definition | Loading state in metadata (no lifecycle change) |
| DD-12 Split-button | ⬜ New detection logic | Caret vs button click disambiguation |
| DD-13 Command palette | 🔶 KeyboardShortcut + Dropdown | Cmd+K triggers → text search → option select |
| DD-14 Free-text autocomplete | 🔶 Dropdown + TextEntry | Allow blur-with-typed-value as completion |

### Implementation Order (most complex → simplest)

| Priority | Variant | Complexity | Reason |
|----------|---------|-----------|--------|
| 1 | DD-03 Searchable | High | Compound lifecycle (text inside surface) |
| 2 | DD-13 Command palette | High | Cross-definition (keyboard → text → dropdown) |
| 3 | DD-09 Tree dropdown | Medium-High | Hierarchical expand/collapse in surface |
| 4 | DD-06 Tag selector | Medium | New lifecycle (token creation) |
| 5 | DD-14 Free-text autocomplete | Medium | Dual completion paths |
| 6 | DD-08 Cascading | Low | Sequential existing dropdowns |
| 7 | DD-12 Split-button | Low | Detection refinement |
| 8 | DD-11 Async | Low | Metadata only |
| 9 | DD-10 Virtualized | Trivial | Already works |
| 10 | DD-04/DD-05/DD-07 | Done | Already production-ready |

---

## Category 2: Text & Input

### Variant Catalogue

| ID | Variant | How it differs | Trigger | Completion |
|----|---------|---------------|---------|------------|
| **TI-01** | Single-line text input | Standard `<input type="text/email/number/...">` | focus | blur (deferred) |
| **TI-02** | Textarea | Multi-line `<textarea>` | focus | blur (deferred) |
| **TI-03** | Searchable input (autocomplete) | Text input with suggestion dropdown | focus | blur or suggestion click |
| **TI-04** | Masked / formatted input | Input with format pattern (phone, card) | focus | blur (value is formatted) |
| **TI-05** | Number input with stepper | `<input type="number">` with up/down spinners | focus + spinner click | blur |
| **TI-06** | OTP / PIN input | Multiple single-char inputs, auto-advance | focus on first input | all filled OR blur on last |
| **TI-07** | Tag / chip input | Text entry producing discrete tokens | focus | Enter/comma → repeat → blur |
| **TI-08** | Password input with toggle | Input with show/hide button | focus | blur (+ optional toggle click) |
| **TI-09** | Search box with submit | Text entry + search button/Enter | focus | blur OR Enter (submit) |
| **TI-10** | ContentEditable (basic) | `<div contenteditable="true">` | focus | blur (value = textContent) |
| **TI-11** | Rich text editor | Draft.js, Slate, Quill, TinyMCE | focus | blur (value = HTML/markdown) |
| **TI-12** | Code editor | Monaco, CodeMirror, Ace | focus | blur (value = text) |

### Lifecycle Grouping

**Group A — Simple Text Entry (focus → blur):**
TI-01, TI-02, TI-04, TI-08, TI-09, TI-10

All share the existing TextEntry lifecycle: focus → deferred blur → value capture.
TI-04 (masked) and TI-08 (password) need no lifecycle change — the value is
captured the same way. TI-09 (search) may include an Enter/submit event that
should be recorded as a separate action.

**Group B — Text + Compound Action:**
TI-03 (autocomplete), TI-05 (number + stepper), TI-07 (tag input)

These need TextEntry to coexist with another interaction:
- TI-03: TextEntry + Dropdown option click (already partially handled)
- TI-05: TextEntry + stepper click (needs sub-action tracking)
- TI-07: TextEntry with token creation (new lifecycle — discrete output per token)

**Group C — Multi-Input:**
TI-06 (OTP/PIN)

Unique: multiple inputs are logically one field. Needs grouping logic —
consecutive focus/blur on adjacent single-char inputs should be captured as
one "enter PIN: 123456" interaction, not six separate text entries.

**Group D — Rich Content:**
TI-11 (rich text editor), TI-12 (code editor)

Different value extraction: rich text editors store content in a shadow DOM
or internal model, not `element.value`. Quill uses `.ql-editor.textContent`;
Draft.js uses a React state snapshot; Monaco uses `editor.getValue()`.
Capture lifecycle is the same (focus → blur), but value extraction needs
editor-specific adapters.

### Reuse Analysis

| Variant | Reuse | What's needed |
|---------|-------|---------------|
| TI-01–TI-02 | ✅ TextEntry | Done |
| TI-03 Autocomplete | 🔶 TextEntry + Dropdown | TextEntry must yield to Dropdown inside surface |
| TI-04 Masked | ✅ TextEntry | Done (value captured at blur) |
| TI-05 Number + stepper | 🔶 TextEntry + Dropdown | Spinner clicks as subActions |
| TI-06 OTP/PIN | ⬜ New grouping logic | Adjacent-input grouping in runtime |
| TI-07 Tag input | ⬜ New: TagInput | Token creation lifecycle |
| TI-08 Password + toggle | ✅ TextEntry | Toggle click captured as separate Click |
| TI-09 Search + submit | ✅ TextEntry | Enter captured as KeyboardShortcut or Click |
| TI-10 ContentEditable | 🔶 TextEntry | Add contenteditable value extraction |
| TI-11 Rich text | ⬜ Editor adapter | Value extraction strategy per editor type |
| TI-12 Code editor | ⬜ Editor adapter | Same as TI-11 |

### Implementation Order

| Priority | Variant | Complexity | Reason |
|----------|---------|-----------|--------|
| 1 | TI-11 Rich text editor | Very High | Editor-specific value extraction (Draft.js, Slate, Quill, TinyMCE) |
| 2 | TI-12 Code editor | High | Monaco/CodeMirror integration |
| 3 | TI-06 OTP/PIN input | Medium-High | Multi-input grouping logic |
| 4 | TI-07 Tag input | Medium | New token-creation lifecycle |
| 5 | TI-03 Autocomplete | Medium | Compound TextEntry + Dropdown |
| 6 | TI-05 Number + stepper | Low-Medium | Spinner click subActions |
| 7 | TI-10 ContentEditable | Low | Value extraction method |
| 8 | TI-09 Search + submit | Low | Enter as separate action |
| 9 | TI-08 Password toggle | Trivial | Already works |
| 10 | TI-04 Masked | Trivial | Already works |

---

## Category 3: Date & Time Pickers

### Variant Catalogue

| ID | Variant | How it differs | Trigger | Completion |
|----|---------|---------------|---------|------------|
| **DT-01** | Calendar popup (single date) | Click date cell in calendar widget | click on trigger | cell click → complete |
| **DT-02** | Native date input | `<input type="date">` | click on input | native picker or manual text |
| **DT-03** | Date range picker | Two dates: start + end | click on trigger | second cell click → complete |
| **DT-04** | Time picker | Select hour/minute from clock/list | click on trigger | time selection |
| **DT-05** | Date-time picker | Combined date + time selection | click on trigger | date cell + time selection |
| **DT-06** | Month/Year picker | Navigate months/years, select month | click on trigger | month/year selection |
| **DT-07** | Inline calendar | Calendar always visible (no popup) | click on date cell | cell click → immediate |
| **DT-08** | Recurring schedule picker | Date + recurrence pattern (daily/weekly/monthly) | click on trigger | pattern config + done |

### Lifecycle Grouping

**Group A — Calendar Surface (trigger → surface → cell → complete):**
DT-01, DT-03, DT-06, DT-07 (inline = no trigger, surface always present)

All share the DatePicker lifecycle. DT-03 needs TWO cell selections (start + end)
before completing — the current DatePicker completes on first cell click and would
miss the end date. DT-07 is just a DatePicker without a trigger (surface always open).

**Group B — Native Input:**
DT-02

Handled as TextEntry (typing the date) or DatePicker (native picker). The value
extraction is the same.

**Group C — Time Selection:**
DT-04, DT-05

Time pickers have different UIs: clock dial (analog), dropdown lists (hour/minute
selects), or stepper inputs. DT-05 combines date + time in one surface. These
need time-specific metadata (hour, minute, period) and may reuse Dropdown
(hour/minute as select options) or Slider (clock dial drag).

### Reuse Analysis

| Variant | Reuse | What's needed |
|---------|-------|---------------|
| DT-01 Calendar popup | ✅ DatePicker | Done |
| DT-02 Native date | 🔶 DatePicker or TextEntry | Detect `<input type="date">` |
| DT-03 Date range | 🔶 DatePicker | Track two selections, don't complete on first |
| DT-04 Time picker | ⬜ New or Dropdown variant | Time-specific UI patterns |
| DT-05 Date-time | ⬜ DatePicker + time | Combined metadata |
| DT-06 Month/year | 🔶 DatePicker | Navigation clicks (prev/next month) |
| DT-07 Inline calendar | 🔶 DatePicker | No trigger, always-active surface |
| DT-08 Recurring schedule | ⬜ DatePicker + config panel | Compound interaction |

### Implementation Order

| Priority | Variant | Complexity | Reason |
|----------|---------|-----------|--------|
| 1 | DT-08 Recurring schedule | High | Compound (date + recurrence config) |
| 2 | DT-05 Date-time picker | Medium-High | Combined date + time UI |
| 3 | DT-03 Date range | Medium | Dual-selection lifecycle |
| 4 | DT-04 Time picker | Medium | New UI patterns (clock dial, time selects) |
| 5 | DT-06 Month/year | Low-Medium | Navigation between calendar pages |
| 6 | DT-07 Inline calendar | Low | Remove trigger requirement |
| 7 | DT-02 Native date | Low | Detection refinement |
| 8 | DT-01 Calendar popup | Done | Already production-ready |

---

## Category 4: Tables & Data Grids

### Variant Catalogue

| ID | Variant | How it differs | Events |
|----|---------|---------------|--------|
| **TB-01** | Sortable column header | Click header → sort asc/desc/none | click on `<th>` |
| **TB-02** | Row selection (checkbox) | Checkbox per row + select-all | click on row checkbox |
| **TB-03** | Cell click | Click cell → detail view or edit | click on `<td>` |
| **TB-04** | Inline cell edit | Double-click cell → edit → Enter/blur | dblclick → input → blur |
| **TB-05** | Row expansion | Click row → expand sub-row details | click on expand caret |
| **TB-06** | Column resize | Drag column border | mousedown → mousemove → mouseup |
| **TB-07** | Column reorder | Drag column header to new position | dragstart → drop |
| **TB-08** | Infinite scroll table | Rows loaded as user scrolls | scroll event |
| **TB-09** | Filterable table | Filter inputs per column | TextEntry per column |
| **TB-10** | Grouped/expandable rows | Group header → expand/collapse group | click on group header |

### Lifecycle Grouping

**Group A — Click-based (immediate):**
TB-01 (sort), TB-03 (cell click), TB-05 (expand), TB-10 (group expand)

These are all Click interactions on table elements. No new definition needed —
the Click definition handles them. The value is in **metadata enrichment**:
recognizing that the click target is a column header (sort action) vs a row
expand caret (expand action) and producing the right semantic label.

**Group B — Selection-based:**
TB-02 (row checkbox)

Checkbox interactions inside a table. The existing Checkbox definition handles
individual checkboxes, but the **select-all** checkbox is a compound action
(affecting all rows) that needs special metadata.

**Group C — Edit-based:**
TB-04 (inline edit)

Compound lifecycle: double-click → TextEntry → blur. Needs the double-click
trigger (not yet implemented — see Keyboard/Mouse section) plus TextEntry.

**Group D — Drag-based:**
TB-06 (resize), TB-07 (reorder)

Reuse DragDrop with table-specific metadata (column index, new position).

**Group E — Scroll-based:**
TB-08 (infinite scroll)

Reuse Scroll definition. The challenge is knowing when new rows have loaded
(DOM mutation observation).

### Reuse Analysis

| Variant | Reuse | What's needed |
|---------|-------|---------------|
| TB-01 Sort | ✅ Click | Metadata: "Sort by [column] [direction]" |
| TB-02 Row checkbox | ✅ Checkbox | Metadata: row context, select-all detection |
| TB-03 Cell click | ✅ Click | Metadata: row/column context |
| TB-04 Inline edit | 🔶 dblclick + TextEntry | Double-click trigger |
| TB-05 Row expand | ✅ Click | Metadata: expand/collapse state |
| TB-06 Column resize | ✅ DragDrop | Metadata: column identity |
| TB-07 Column reorder | ✅ DragDrop | Metadata: source/target columns |
| TB-08 Infinite scroll | ✅ Scroll | Scroll is captured; row-load is metadata |
| TB-09 Column filter | ✅ TextEntry | Per-column text inputs |
| TB-10 Group expand | ✅ Click | Metadata: group identity |

### Implementation Order

| Priority | Variant | Complexity | Reason |
|----------|---------|-----------|--------|
| 1 | TB-04 Inline edit | Medium | Double-click trigger + TextEntry compound |
| 2 | TB-01 Sort | Low-Medium | Semantic enrichment (sort direction) |
| 3 | TB-02 Row checkbox | Low-Medium | Select-all compound logic |
| 4 | TB-07 Column reorder | Low | DragDrop with metadata |
| 5 | TB-06 Column resize | Low | DragDrop with metadata |
| 6 | TB-05/TB-10 Expand | Trivial | Click with metadata |
| 7 | TB-03/TB-08/TB-09 | Trivial | Already captured |

---

## Category 5: Drag & Drop

### Variant Catalogue

| ID | Variant | How it differs | Drag method |
|----|---------|---------------|-------------|
| **DD-01** | List reordering | Drag item to new position in same list | Mouse / HTML5 |
| **DD-02** | Kanban / board card move | Drag card between columns | Mouse / HTML5 |
| **DD-03** | File drop zone | Drag OS file onto browser element | HTML5 only |
| **DD-04** | Slider handle drag | Drag handle along a constrained track | Mouse |
| **DD-05** | Tree node drag | Drag node to new parent in tree | Mouse / HTML5 |
| **DD-06** | Resize handle drag | Drag resize handle to change element size | Mouse |
| **DD-07** | Split pane divider | Drag divider to resize panes | Mouse |
| **DD-08** | Draw/selection rectangle | Drag to draw a rectangle on canvas/map | Mouse |

### Lifecycle Grouping

All variants share the DragDrop lifecycle (mousedown → mousemove* → mouseup with
displacement threshold). The differences are:

- **DD-04** (slider) and **DD-07** (split pane) are **constrained drags** —
  the handle moves along a single axis. These overlap with the Slider definition.
  Architecture decision: Slider should handle these (it has explicit min/max/range
  semantics), while DragDrop handles unconstrained drags.
- **DD-03** (file drop) uses HTML5 DnD exclusively (OS file → browser). The
  dragstart comes from outside the DOM, so only `dragover` + `drop` fire.
- **DD-08** (draw rectangle) produces a geometric result (bounding box), not a
  source→target move. Needs different metadata.

### Reuse Analysis

| Variant | Reuse | What's needed |
|---------|-------|---------------|
| DD-01 List reorder | ✅ DragDrop | Done |
| DD-02 Kanban move | ✅ DragDrop | Done |
| DD-03 File drop zone | ✅ DragDrop (HTML5 path) | Metadata: file identity |
| DD-04 Slider handle | ✅ Slider definition | Slider handles this |
| DD-05 Tree node drag | ✅ DragDrop | Metadata: source/target tree path |
| DD-06 Resize handle | ✅ DragDrop | Metadata: resize direction/delta |
| DD-07 Split pane | ✅ Slider or DragDrop | Constrained-axis detection |
| DD-08 Draw rectangle | ⬜ New metadata | Bounding box instead of source→target |

### Implementation Order

| Priority | Variant | Complexity | Reason |
|----------|---------|-----------|--------|
| 1 | DD-08 Draw/selection | Medium | Different metadata model (geometry) |
| 2 | DD-03 File drop zone | Low-Medium | HTML5 file identity capture |
| 3 | DD-05 Tree node drag | Low | Tree path metadata |
| 4 | DD-06/DD-07 Resize/split | Low | Axis constraint + delta |
| 5 | DD-01/DD-02 | Done | Already production-ready |

---

## Category 6: File Upload

### Variant Catalogue

| ID | Variant | How it differs |
|----|---------|---------------|
| **FU-01** | Button → file dialog | Click button → OS file picker opens |
| **FU-02** | Drag & drop zone | Drag files from OS onto a drop area |
| **FU-03** | Paste file | Ctrl+V to paste file from clipboard |
| **FU-04** | Multiple files | Select multiple files at once |
| **FU-05** | Progress / chunked upload | Upload with progress bar, chunked transfer |

### Lifecycle Grouping

**Group A — File Selection (capture the intent, not the file):**
FU-01 (button), FU-02 (drag-drop), FU-03 (paste)

All produce the same semantic action: "user uploaded a file." The recorder
cannot access the actual file (OS dialog is outside the DOM), so the
interaction captures: the trigger element, the file input's `files` property
(after selection), and the number/type of files.

**Group B — Upload Monitoring:**
FU-05 (progress)

This is not an interaction — it's a state change (progress bar). Captured as
a Scroll-like gesture or simply ignored (the upload is the interaction, not
the progress bar).

### Reuse Analysis

| Variant | Reuse | What's needed |
|---------|-------|---------------|
| FU-01 Button | ✅ FileUpload | Done |
| FU-02 Drag-drop | ✅ DragDrop + FileUpload | DragDrop → drop on file input → FileUpload reads files |
| FU-03 Paste | ✅ KeyboardShortcut + FileUpload | Paste event → read files from clipboard |
| FU-04 Multiple | ✅ FileUpload | Already captures `files[]` |
| FU-05 Progress | ⬜ Not an interaction | Filter as noise |

### Implementation Order

| Priority | Variant | Complexity |
|----------|---------|-----------|
| 1 | FU-02 Drag-drop upload | Low (DragDrop→FileUpload handoff) |
| 2 | FU-03 Paste upload | Low (paste event detection) |
| 3 | FU-01/FU-04 | Done |

---

## Category 7: Keyboard Interactions

### Variant Catalogue

| ID | Variant | How it differs |
|----|---------|---------------|
| **KB-01** | Modifier shortcut | Ctrl+S, Cmd+K, Ctrl+Shift+P |
| **KB-02** | Special key (no modifier) | Escape, Enter, Tab, F1-F12, Arrow keys |
| **KB-03** | Keyboard navigation | Tab cycling through focusable elements |
| **KB-04** | Command palette trigger | Cmd+K opens search overlay |
| **KB-05** | Slash command | Type "/" to open command menu |
| **KB-06** | In-text shortcut | Type "@mention" or "#hashtag" inside text |
| **KB-07** | Hotkey sequence | "g then d" (Gmail-style two-key sequence) |
| **KB-08** | Copy/paste | Ctrl+C / Ctrl+V with clipboard context |

### Lifecycle Grouping

**Group A — Discrete Key Press (immediate):**
KB-01 (modifier), KB-02 (special key)

Already implemented via KeyboardShortcut definition.

**Group B — Key Sequence:**
KB-04 (command palette), KB-07 (two-key sequence)

These need a multi-key lifecycle: the first key doesn't complete — it starts
a "listening" state that waits for the next key. KB-04 is a compound: shortcut
→ text search → option select.

**Group C — Text-Embedded:**
KB-05 (slash command), KB-06 (@mention)

These occur INSIDE a TextEntry session. The recorder should detect the special
character and capture the resulting action (menu open + selection) as a
sub-action of the TextEntry, similar to autocomplete.

### Reuse Analysis

| Variant | Reuse | What's needed |
|---------|-------|---------------|
| KB-01 Modifier shortcut | ✅ KeyboardShortcut | Done |
| KB-02 Special key | ✅ KeyboardShortcut | Done |
| KB-03 Tab navigation | ✅ KeyboardShortcut | Done (Tab key) |
| KB-04 Command palette | 🔶 KeyboardShortcut + Dropdown | Cross-definition trigger |
| KB-05 Slash command | 🔶 TextEntry + Dropdown | Sub-action detection |
| KB-06 @mention | 🔶 TextEntry + Dropdown | Sub-action detection |
| KB-07 Hotkey sequence | ⬜ New lifecycle | Two-key timeout window |
| KB-08 Copy/paste | ✅ KeyboardShortcut | Metadata: clipboard content type |

### Implementation Order

| Priority | Variant | Complexity |
|----------|---------|-----------|
| 1 | KB-04 Command palette | High (cross-definition) |
| 2 | KB-07 Hotkey sequence | Medium (new lifecycle) |
| 3 | KB-05/KB-06 Slash/mention | Medium (in-text sub-action) |
| 4 | KB-08 Copy/paste | Low (metadata) |
| 5 | KB-01/KB-02/KB-03 | Done |

---

## Category 8: Dialogs & Overlays

### Variant Catalogue

| ID | Variant | How it differs | Surface type |
|----|---------|---------------|-------------|
| **DG-01** | Modal dialog | Overlay + backdrop, focus trap | modal |
| **DG-02** | Drawer / side panel | Slide-in from edge, pushes content | drawer/sheet |
| **DG-03** | Popover | Anchored to trigger, no backdrop | popover |
| **DG-04** | Tooltip | Transient, informational, hover-triggered | tooltip |
| **DG-05** | Toast / Snackbar | Auto-dismiss notification | (no surface) |
| **DG-06** | Lightbox / image viewer | Full-screen media overlay | modal |
| **DG-07** | Bottom sheet | Mobile-style slide-up panel | sheet |
| **DG-08** | Confirmation dialog | Modal with confirm/cancel buttons | modal |

### Lifecycle Grouping

**Group A — Dialog Lifecycle (open → interact → close):**
DG-01 (modal), DG-02 (drawer), DG-07 (bottom sheet), DG-08 (confirmation)

These share a compound lifecycle:
1. Trigger element opens the overlay (Click)
2. User interacts with elements inside the overlay (various)
3. Overlay closes (confirm button, cancel button, backdrop click, Escape key)

The **key architectural question**: should the recorder treat a modal as a
container that groups all interactions inside it, or as independent interactions
that happen to be inside a surface?

**Recommendation: Container model.** A modal session opens on the trigger click,
claims all events inside its surface, and completes on close. This groups the
interactions as subActions (like the Dropdown multi-config pattern), producing
cleaner test steps: "Open dialog → fill name → select option → click Save."

The surface tracking infrastructure already detects modal surfaces (ARIA role
`dialog`, `aria-modal="true"`, CSS patterns). A `ModalDialog` definition at
priority 18 (before Dropdown at 20) would claim the trigger click, open a surface,
and collect subActions.

**Group B — Transient Overlays:**
DG-03 (popover), DG-04 (tooltip)

Popovers are similar to modals but have no backdrop and don't trap focus.
Tooltips are already handled by Hover (meaningful hover triggers tooltip
display). Popovers need their own lightweight lifecycle (similar to Dropdown
but without the selection semantics).

**Group C — Notifications:**
DG-05 (toast)

Toasts are notifications, not user interactions. They should be filtered as
noise (the recorder captures what the user DOES, not what the app shows).

### Reuse Analysis

| Variant | Reuse | What's needed |
|---------|-------|---------------|
| DG-01 Modal | ⬜ New: ModalDialog definition | Container lifecycle (open → subActions → close) |
| DG-02 Drawer | 🔶 ModalDialog variant | Slide-in direction in metadata |
| DG-03 Popover | 🔶 Lightweight ModalDialog | No backdrop, anchored to trigger |
| DG-04 Tooltip | ✅ Hover | Done |
| DG-05 Toast | ⬜ Noise filter | Not an interaction |
| DG-06 Lightbox | 🔶 ModalDialog | Image-specific metadata |
| DG-07 Bottom sheet | 🔶 ModalDialog variant | Mobile orientation metadata |
| DG-08 Confirmation | ✅ ModalDialog | Confirm/cancel are subActions |

### Implementation Order

| Priority | Variant | Complexity | Reason |
|----------|---------|-----------|--------|
| 1 | DG-01 Modal dialog | High | New container lifecycle, surface management |
| 2 | DG-03 Popover | Medium | Anchored overlay lifecycle |
| 2 | DG-02 Drawer | Medium | ModalDialog variant with direction |
| 4 | DG-07 Bottom sheet | Low | ModalDialog variant |
| 5 | DG-06 Lightbox | Low | ModalDialog variant |
| 6 | DG-08 Confirmation | Low | ModalDialog with 2-button close |
| 7 | DG-05 Toast | Trivial | Noise filter |

---

## Category 9: Rich Text Editors

### Variant Catalogue

| ID | Variant | Value extraction method |
|----|---------|----------------------|
| **RT-01** | ContentEditable (basic) | `element.textContent` or `innerHTML` |
| **RT-02** | Draft.js | `editorState.getCurrentContent().getPlainText()` |
| **RT-03** | Slate.js | `editor.children` serialized to text |
| **RT-04** | Quill | `.ql-editor.textContent` |
| **RT-05** | TinyMCE | `tinymce.get(id).getContent()` |
| **RT-06** | CKEditor 5 | `editor.getData()` |
| **RT-07** | ProseMirror | `editorView.doc.textContent` |

### Lifecycle Grouping

All share the same lifecycle (focus → type → blur), differing only in value
extraction. The architectural challenge is detecting which editor is present
and calling the right extraction method.

**Architecture recommendation**: An **EditorAdapter** interface with per-editor
implementations. The TextEntry definition detects contentEditable elements and
delegates value extraction to the adapter chain:

```typescript
interface EditorAdapter {
  matches(element: Element): boolean;
  extractValue(element: Element): string;
}
```

### Implementation Order

| Priority | Variant | Complexity |
|----------|---------|-----------|
| 1 | RT-01 ContentEditable | Medium (value extraction) |
| 2 | RT-04 Quill | Low (`.ql-editor` selector) |
| 3 | RT-02 Draft.js | Medium (React internal access) |
| 4 | RT-07 ProseMirror | Medium |
| 5 | RT-03 Slate.js | Medium |
| 6 | RT-06 CKEditor 5 | Medium |
| 7 | RT-05 TinyMCE | Medium (iframe context) |

---

## Category 10: Trees

### Variant Catalogue

| ID | Variant | How it differs |
|----|---------|---------------|
| **TR-01** | Expand/collapse node | Click caret to toggle children visibility |
| **TR-02** | Select node | Click node label to select |
| **TR-03** | Checkbox tree | Checkbox per node, cascading to children |
| **TR-04** | Drag node to reparent | Drag node onto another node |
| **TR-05** | Lazy-loaded tree | Children fetched on expand (async) |
| **TR-06** | Multi-select tree | Ctrl+click for multi-select |

### Lifecycle Grouping

**Group A — Node Toggle (immediate click):**
TR-01 (expand/collapse), TR-02 (select)

Both are Click interactions with tree-specific metadata (node path, depth,
expand/collapse direction). No new lifecycle needed — this is metadata enrichment.

**Group B — Cascading Checkbox:**
TR-03 (checkbox tree)

Checkbox with cascade semantics (checking parent checks all children). Needs
metadata: affected node count, cascade direction.

**Group C — Drag:**
TR-04 (reparent)

DragDrop with tree-specific metadata (source path → target path).

### Reuse Analysis

| Variant | Reuse | What's needed |
|---------|-------|---------------|
| TR-01 Expand | ✅ Click | Metadata: node path, expand/collapse |
| TR-02 Select | ✅ Click | Metadata: node path |
| TR-03 Checkbox tree | ✅ Checkbox | Metadata: cascade count |
| TR-04 Drag reparent | ✅ DragDrop | Metadata: source/target tree path |
| TR-05 Lazy expand | ✅ Click | Async metadata (same as DD-11) |
| TR-06 Multi-select | ✅ Click + Ctrl modifier | Metadata: selection mode |

### Implementation Order

| Priority | Variant | Complexity |
|----------|---------|-----------|
| 1 | TR-03 Checkbox tree | Low-Medium (cascade metadata) |
| 2 | TR-04 Drag reparent | Low (DragDrop metadata) |
| 3 | TR-01/TR-02 | Trivial (Click metadata) |

---

## Category 11: Sliders & Range Controls

### Variant Catalogue

| ID | Variant | How it differs |
|----|---------|---------------|
| **SL-01** | Single-thumb slider | One handle on a track |
| **SL-02** | Range slider (two thumbs) | Min + max handles |
| **SL-03** | Discrete slider | Handle snaps to predefined steps |
| **SL-04** | Slider with input | Slider + adjacent number input |
| **SL-05** | Color picker slider | Slider for hue/saturation/lightness |
| **SL-06** | Rating slider | Star rating or numeric score |

### Lifecycle Grouping

All share the Slider lifecycle (mousedown on handle → mousemove → mouseup).
The current Slider definition captures clicks but doesn't track the drag gesture.
SL-02 (range) needs two handles tracked independently.

### Reuse Analysis

| Variant | Reuse | What's needed |
|---------|-------|---------------|
| SL-01 Single | 🔶 Slider | Add drag tracking (currently click-only) |
| SL-02 Range | 🔶 Slider | Track two handles, produce min+max |
| SL-03 Discrete | ✅ Slider | Snap-to-step metadata |
| SL-04 Slider + input | 🔶 Slider + TextEntry | Compound interaction |
| SL-05 Color picker | ⬜ New metadata | Color value (hex/hsl) |
| SL-06 Rating | ✅ Click or Slider | Star count metadata |

### Implementation Order

| Priority | Variant | Complexity |
|----------|---------|-----------|
| 1 | SL-01 Single slider drag | Medium (add drag to Slider) |
| 2 | SL-02 Range slider | Medium (dual-handle) |
| 3 | SL-05 Color picker | Medium (color extraction) |
| 4 | SL-04 Slider + input | Low (compound) |
| 5 | SL-03/SL-06 | Low (metadata) |

---

## Category 12: Steppers, Wizards & Multi-Step Flows

### Variant Catalogue

| ID | Variant | How it differs |
|----|---------|---------------|
| **ST-01** | Counter stepper (inside dropdown) | +/- buttons for quantity |
| **ST-02** | Standalone stepper | +/- buttons outside any dropdown |
| **ST-03** | Wizard navigation | Next/Back buttons through form steps |
| **ST-04** | Progress stepper (clickable) | Click step indicator to jump |
| **ST-05** | Vertical stepper | Top-to-bottom step progression |

### Lifecycle Grouping

**Group A — Counter (increment/decrement):**
ST-01 (inside dropdown), ST-02 (standalone)

ST-01 is already handled as a Dropdown subAction. ST-02 needs the same
increment/decrement detection but as an independent definition (not inside
a dropdown surface).

**Group B — Navigation Steps:**
ST-03 (wizard), ST-04 (clickable progress), ST-05 (vertical)

These are Click interactions on "Next"/"Back" buttons or step indicators.
The semantic value is in metadata: "Go to step 3 of 5." The recorder should
detect step indicators (numbered circles, progress bars) and annotate the
navigation with step context.

### Reuse Analysis

| Variant | Reuse | What's needed |
|---------|-------|---------------|
| ST-01 Counter in dropdown | ✅ Dropdown subAction | Done |
| ST-02 Standalone counter | ⬜ New: Stepper definition | Independent increment/decrement |
| ST-03 Wizard next/back | ✅ Click | Metadata: step number, direction |
| ST-04 Clickable step | ✅ Click | Metadata: target step |
| ST-05 Vertical stepper | ✅ Click | Same as ST-03 |

### Implementation Order

| Priority | Variant | Complexity |
|----------|---------|-----------|
| 1 | ST-02 Standalone stepper | Medium (new definition) |
| 2 | ST-03/ST-04/ST-05 Wizard | Low (Click metadata) |

---

## Category 13: Tabs

### Variant Catalogue

| ID | Variant |
|----|---------|
| **TB-01** | Horizontal tabs |
| **TB-02** | Vertical tabs (sidebar) |
| **TB-03** | Pill / capsule tabs |
| **TB-04** | Scrollable tab bar (overflow) |
| **TB-05** | Closable tabs (with × button) |
| **TB-06** | Drag-to-reorder tabs |

### Lifecycle Grouping

All variants are Click interactions with `role="tab"`. The Tab definition
already handles TB-01–TB-03. TB-04 (overflow scroll) adds a Scroll interaction
on the tab bar. TB-05 (closable) needs two actions: tab switch + close click.
TB-06 (reorder) is DragDrop on a tab.

### Implementation Order

All are **low complexity** — Click/DragDrop with metadata enrichment. Implement
last.

---

## Category 14: Accordions

### Variant Catalogue

| ID | Variant |
|----|---------|
| **AC-01** | Single-expand accordion (one section open at a time) |
| **AC-02** | Multi-expand accordion (multiple sections open) |
| **AC-03** | Nested accordion (accordion inside accordion) |
| **AC-04** | First-section-open-by-default |

### Lifecycle Grouping

All are Click interactions on accordion headers. No new definition needed.
Metadata enrichment: section title, expand/collapse direction, depth (for nested).

### Implementation Order

Trivial — Click with metadata. Implement last.

---

## Category 15: Window & Frame Interactions

### Variant Catalogue

| ID | Variant | How it differs |
|----|---------|---------------|
| **WF-01** | New tab (target=_blank) | Link opens new browser tab |
| **WF-02** | New window (window.open) | Script opens popup window |
| **WF-03** | Iframe interaction | Interactions inside embedded frame |
| **WF-04** | Print dialog | window.print() |
| **WF-05** | Fullscreen toggle | Fullscreen API |

### Lifecycle Grouping

**Group A — Multi-Context (recorder context switch):**
WF-01 (new tab), WF-02 (new window)

The recorder's content script runs per-tab. When a new tab opens, the recorder
must detect the context switch and either: (a) follow into the new tab (inject
content script), or (b) record the "open new tab" action and stop.

Architecture decision needed: content script manifest covers all tabs vs.
on-demand injection.

**Group B — Embedded Context:**
WF-03 (iframe)

Same-origin iframes: the content script's capture-phase listeners already
catch events inside same-origin iframes. Cross-origin iframes need a separate
content script injected into the iframe.

**Group C — Browser-Level:**
WF-04 (print), WF-05 (fullscreen)

These are browser-level events, not DOM events. Capture via the `chrome.*` API
or ignore (low value for test recording).

### Implementation Order

| Priority | Variant | Complexity |
|----------|---------|-----------|
| 1 | WF-03 Iframe | High (cross-origin content script) |
| 2 | WF-01 New tab | Medium (context tracking) |
| 3 | WF-02 New window | Medium (popup tracking) |
| 4 | WF-04/WF-05 | Low (chrome API events) |

---

## Category 16: Scroll & Viewport

### Variant Catalogue

| ID | Variant |
|----|---------|
| **SC-01** | Page scroll (main viewport) |
| **SC-02** | Container scroll (bounded element) |
| **SC-03** | Infinite scroll (auto-load on scroll) |
| **SC-04** | Horizontal scroll |
| **SC-05** | Scroll-to-element (click triggers smooth scroll) |

### Status

Already implemented (SC-01, SC-02). SC-03 needs DOM mutation detection after
scroll. SC-04 needs horizontal delta tracking. SC-05 is a Click followed by
scroll — already handled by independent capture.

### Implementation Order

| Priority | Variant | Complexity |
|----------|---------|-----------|
| 1 | SC-03 Infinite scroll | Medium (mutation observation) |
| 2 | SC-04 Horizontal | Low (delta direction) |
| 3 | SC-01/SC-02 | Done |

---

## Cross-Category Implementation Priority

### Tier 1 — Architecturally Most Complex (build first)

These variants introduce **new lifecycle patterns** that other variants build upon:

| # | Variant | New Pattern | Enables |
|---|---------|-------------|---------|
| 1 | **DG-01 Modal Dialog** | Container lifecycle (open → subActions → close) | DG-02, DG-03, DG-06, DG-07, DG-08 |
| 2 | **DD-03 Searchable Dropdown** | TextEntry inside surface without competing | DD-13, DD-14, TI-03, KB-04 |
| 3 | **ST-02 Standalone Stepper** | Independent increment/decrement | ST-03 wizard navigation |
| 4 | **TI-11 Rich Text Editor** | EditorAdapter interface | RT-01 through RT-07 |
| 5 | **SL-01 Slider Drag** | Constrained-axis drag tracking | SL-02, SL-05 |
| 6 | **WF-03 Iframe** | Cross-context event capture | WF-01, WF-02 |

### Tier 2 — High Value, Moderate Complexity

| # | Variant | Builds on |
|---|---------|-----------|
| 7 | DD-06 Tag Input | New lifecycle (token creation) |
| 8 | TI-06 OTP/PIN Input | Multi-input grouping |
| 9 | DT-03 Date Range Picker | DatePicker dual-selection |
| 10 | KB-07 Hotkey Sequence | Two-key timeout window |
| 11 | DD-09 Tree Dropdown | Expand/collapse in surface |
| 12 | TB-04 Inline Cell Edit | Double-click + TextEntry |

### Tier 3 — Metadata Enrichment Only

These variants reuse existing definitions and only need better metadata:

| # | Variants |
|---|---------|
| 13 | TB-01 Sort, TB-02 Row Checkbox, TB-05 Expand |
| 14 | TR-01 Tree Expand, TR-02 Tree Select |
| 15 | ST-03/ST-04 Wizard Navigation |
| 16 | AC-01–AC-04 Accordions |
| 17 | TB-01–TB-06 Tabs |
| 18 | N4 Breadcrumb, N5 Menu, N6 Pagination |

### Tier 4 — Already Production-Ready

| # | Variants |
|---|---------|
| 19 | DD-01 Native Dropdown, DD-02 Custom Dropdown, DD-04/05/07 Multi-select/Config |
| 20 | TI-01/02 Text Entry, TI-04 Masked, TI-08 Password |
| 21 | DT-01 Calendar Date Picker |
| 22 | P1 Click, P4 Hover, P5 Drag&Drop |
| 23 | KB-01/02/03 Keyboard Shortcuts |
| 24 | N1 Link, N2 SPA Navigation, N3 Tab Switch |
| 25 | SC-01/02 Scroll |

---

## New Definitions Required

Based on the taxonomy, these **new ComponentDefinition files** are needed:

| Definition | Priority | Lifecycle Pattern | Enables |
|-----------|----------|-------------------|---------|
| `ModalDialog` | 8 | Container: trigger → surface open → subActions → close | All overlay types |
| `Stepper` | 28 | Independent increment/decrement (not inside dropdown) | Standalone counters |
| `TagInput` | 45 | Focus → type → Enter → token → repeat → blur | Chip selectors |
| `OtpInput` | 48 | Grouped adjacent single-char inputs | PIN/OTP entry |
| `Accordion` | 75 | Header click → expand/collapse section | Collapsible sections |

All other variants are handled by **extending existing definitions** (metadata,
subActions, detection patterns) rather than creating new lifecycle types.

---

## New Infrastructure Required

| Mechanism | Purpose | For |
|-----------|---------|-----|
| **Double-click detection** | `dblclick` event in BrowserEventType + detection logic | TB-04 inline edit, general |
| **EditorAdapter interface** | Pluggable value extraction for rich text editors | RT-01–RT-07 |
| **Clipboard event capture** | `copy`/`paste`/`cut` events in BrowserEventType | KB-08 |
| **DOM mutation observer** | Detect async content changes (lazy-load, infinite scroll) | DD-11, SC-03, TR-05 |
| **Cross-frame event bridge** | PostMessage relay for cross-origin iframe events | WF-03 |
| **Double-selection lifecycle** | DatePicker completes on second cell click | DT-03 |

---

## Summary Statistics

| Metric | Count |
|--------|-------|
| Total interaction variants identified | **96** |
| Variants already production-ready | **25** |
| Variants reusing existing definitions (metadata only) | **35** |
| Variants needing existing definition extension | **25** |
| Variants needing new definitions | **6** |
| Variants needing new infrastructure | **5** |
| Variants classified as noise (not interactions) | **2** |
| **Estimated net new work** | **~11 definition files + 5 infrastructure pieces** |
